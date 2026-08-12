#!/usr/bin/env node
// MENU ART: pick a size and a palette for the two landing-page images, and
// PROVE the choice with numbers rather than adjectives.
//
// The two inputs are ref/start-car-blower.png (704x321, transparent) and
// ref/start-cityscape.png (704x384, opaque). They go into src/art/menu.js as
// base64 data URLs, so every byte of them is downloaded before the game runs.
// The question is not "which looks nicest" — the 704px source always looks
// nicest — it is "how much can we take away before anyone can tell", and that
// is a measurement.
//
// WHY THIS TOOL EXISTS AND NOT A ONE-LINER: reasoning about images has been
// wrong every time it has been tried on this project. So this prints a table
// with bytes AND an error number for every candidate, measures the night sky
// for banding specifically (a 32-colour palette on a smooth gradient is
// exactly where banding comes from), and writes the chosen images into shots/
// so they can be looked at. It also runs a NEGATIVE CONTROL — an 8-colour
// version that is obviously bad — because a quality score that cannot go bad
// is not a quality score.
//
// EVERYTHING IS DONE IN-PROCESS. There is no pngquant, no oxipng, no cwebp and
// no sharp on this machine, so the resampler, the quantiser and the PNG
// encoder are all in this file. That means they could all be wrong, so:
//   - selfTest() runs first, every time, and asserts the resampler preserves a
//     flat colour, the encoder round-trips through an independent decoder
//     (pngjs) pixel-for-pixel, and the error metric reads 0 for identical
//     images and ~255 for black-vs-white.
//   - the emitted module is re-read from disk and its data URLs decoded before
//     the tool exits.
// A green run of this tool with a broken encoder should not be possible.
//
// Usage:
//   node tools/menuart.mjs           measure, write shots/, print tables
//   node tools/menuart.mjs --emit    the above, then write src/art/menu.js
//   node tools/menuart.mjs --quick   skip the full sweep (chosen rows only)

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { deflateSync, gzipSync, constants as Z } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'shots');
const EMIT = process.argv.includes('--emit');
const QUICK = process.argv.includes('--quick');

// ---------------------------------------------------------------------------
// image: { w, h, d } where d is a Uint8Array of RGBA, 4 bytes per pixel.
// ---------------------------------------------------------------------------

function readPNG(path) {
  const p = PNG.sync.read(readFileSync(path));
  return { w: p.width, h: p.height, d: new Uint8Array(p.data) };
}

function blank(w, h, rgba = [0, 0, 0, 0]) {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = rgba[0]; d[i + 1] = rgba[1]; d[i + 2] = rgba[2]; d[i + 3] = rgba[3]; }
  return { w, h, d };
}

function crop(img, x0, y0, w, h) {
  const out = blank(w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.h - 1, Math.max(0, y0 + y));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.w - 1, Math.max(0, x0 + x));
      const s = (sy * img.w + sx) * 4, o = (y * w + x) * 4;
      out.d[o] = img.d[s]; out.d[o + 1] = img.d[s + 1]; out.d[o + 2] = img.d[s + 2]; out.d[o + 3] = img.d[s + 3];
    }
  }
  return out;
}

function paste(dst, src, x0, y0) {
  for (let y = 0; y < src.h; y++) {
    const dy = y0 + y; if (dy < 0 || dy >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const dx = x0 + x; if (dx < 0 || dx >= dst.w) continue;
      const s = (y * src.w + x) * 4, o = (dy * dst.w + dx) * 4;
      dst.d[o] = src.d[s]; dst.d[o + 1] = src.d[s + 1]; dst.d[o + 2] = src.d[s + 2]; dst.d[o + 3] = src.d[s + 3];
    }
  }
}

// NEAREST-NEIGHBOUR blow-up, for detail crops only. Never for candidates: it
// is here so a 3x crop shows the actual pixels rather than a resampler's idea
// of them.
function magnify(img, n) {
  const out = blank(img.w * n, img.h * n);
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    const s = ((y / n | 0) * img.w + (x / n | 0)) * 4, o = (y * out.w + x) * 4;
    out.d[o] = img.d[s]; out.d[o + 1] = img.d[s + 1]; out.d[o + 2] = img.d[s + 2]; out.d[o + 3] = img.d[s + 3];
  }
  return out;
}

// ---------------------------------------------------------------------------
// RESAMPLING. Separable, on PREMULTIPLIED alpha (resampling straight alpha
// drags the colour of fully transparent pixels into the edge and gives you a
// dark or white halo when it is composited — the car has 6,559 partially
// transparent pixels along its ink outline, all of which are that edge).
//
// Done in sRGB space, not linear light, deliberately: this is flat comic art
// whose whole look is ink density, and the browser will do its own scaling in
// sRGB. Linear-light downsampling is measured as a variant below and it makes
// the ink lines lighter, which is the wrong direction for this art.
// ---------------------------------------------------------------------------

const KERNELS = {
  // Lanczos3: for DOWNscaling. Sharpest of the sane options.
  lanczos3: { r: 3, f: (x) => { x = Math.abs(x); if (x < 1e-8) return 1; if (x >= 3) return 0; const p = Math.PI * x; return (3 * Math.sin(p) * Math.sin(p / 3)) / (p * p); } },
  // Catmull-Rom: for UPscaling in the comparison step, because it is the
  // closest cheap match to what a browser does when it stretches a background.
  catmullrom: { r: 2, f: (x) => { x = Math.abs(x); if (x < 1) return 1.5 * x * x * x - 2.5 * x * x + 1; if (x < 2) return -0.5 * x * x * x + 2.5 * x * x - 4 * x + 2; return 0; } },
  box: { r: 0.5, f: (x) => (Math.abs(x) <= 0.5 ? 1 : 0) },
};

function weights(srcLen, dstLen, kernel) {
  const k = KERNELS[kernel];
  const scale = dstLen / srcLen;
  const fs = scale < 1 ? 1 / scale : 1;      // widen the kernel when shrinking
  const support = k.r * fs;
  const rows = [];
  for (let i = 0; i < dstLen; i++) {
    const centre = (i + 0.5) / scale;
    let a = Math.ceil(centre - support - 0.5), b = Math.floor(centre + support - 0.5);
    const idx = [], w = [];
    let sum = 0;
    for (let j = a; j <= b; j++) {
      const jj = Math.min(srcLen - 1, Math.max(0, j));   // clamp at the edges
      const v = k.f((j + 0.5 - centre) / fs);
      if (v === 0) continue;
      idx.push(jj); w.push(v); sum += v;
    }
    if (!sum) { idx.push(Math.min(srcLen - 1, Math.max(0, Math.round(centre - 0.5)))); w.push(1); sum = 1; }
    for (let n = 0; n < w.length; n++) w[n] /= sum;
    rows.push({ idx, w });
  }
  return rows;
}

function resample(img, dw, dh, kernel = 'lanczos3', { linear = false } = {}) {
  const toL = new Float32Array(256), fromL = (v) => {
    v = Math.min(1, Math.max(0, v));
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  };
  for (let i = 0; i < 256; i++) { const s = i / 255; toL[i] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }

  // premultiply into float
  const src = new Float32Array(img.w * img.h * 4);
  for (let i = 0, n = img.w * img.h; i < n; i++) {
    const a = img.d[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) {
      const v8 = img.d[i * 4 + c];
      src[i * 4 + c] = (linear ? toL[v8] : v8 / 255) * a;
    }
    src[i * 4 + 3] = a;
  }

  // horizontal
  const wx = weights(img.w, dw, kernel);
  const tmp = new Float32Array(dw * img.h * 4);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < dw; x++) {
      const { idx, w } = wx[x];
      let r = 0, g = 0, b = 0, a = 0;
      for (let n = 0; n < idx.length; n++) {
        const s = (y * img.w + idx[n]) * 4, ww = w[n];
        r += src[s] * ww; g += src[s + 1] * ww; b += src[s + 2] * ww; a += src[s + 3] * ww;
      }
      const o = (y * dw + x) * 4;
      tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a;
    }
  }

  // vertical
  const wy = weights(img.h, dh, kernel);
  const out = blank(dw, dh);
  for (let y = 0; y < dh; y++) {
    const { idx, w } = wy[y];
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let n = 0; n < idx.length; n++) {
        const s = (idx[n] * dw + x) * 4, ww = w[n];
        r += tmp[s] * ww; g += tmp[s + 1] * ww; b += tmp[s + 2] * ww; a += tmp[s + 3] * ww;
      }
      a = Math.min(1, Math.max(0, a));
      const o = (y * dw + x) * 4;
      if (a <= 0) { out.d[o] = out.d[o + 1] = out.d[o + 2] = out.d[o + 3] = 0; continue; }
      const un = [r / a, g / a, b / a];
      for (let c = 0; c < 3; c++) {
        const v = linear ? fromL(un[c]) : un[c];
        out.d[o + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
      }
      out.d[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// QUANTISATION. Median cut in RGBA to seed, then weighted k-means (Lloyd) to
// settle, both run over the COLOUR HISTOGRAM rather than the pixels — there
// are at most ~61k distinct colours in either source against 270k pixels, and
// it makes the whole sweep run in seconds instead of minutes.
//
// Fully transparent pixels are excluded from the histogram entirely and get
// their own reserved palette entry. Left in, the car's 79,273 transparent
// pixels are the single largest colour cluster in the image and median cut
// spends a chunk of the palette describing the inside of nothing.
// ---------------------------------------------------------------------------

function histogram(img) {
  const map = new Map();
  let clear = 0;
  for (let i = 0, n = img.w * img.h; i < n; i++) {
    const a = img.d[i * 4 + 3];
    if (a < 8) { clear++; continue; }             // snapped to the clear entry
    const k = ((a << 24) | (img.d[i * 4] << 16) | (img.d[i * 4 + 1] << 8) | img.d[i * 4 + 2]) >>> 0;
    map.set(k, (map.get(k) || 0) + 1);
  }
  const e = [];
  for (const [k, c] of map) e.push({ r: (k >> 16) & 255, g: (k >> 8) & 255, b: k & 255, a: (k >>> 24) & 255, n: c });
  return { entries: e, clear };
}

// SPLIT CRITERION. Which box to cut next decides where the palette goes, and
// on this cityscape it decides whether the sky bands. Three were measured
// (printed in the report): the box with the widest axis weighted by log of its
// pixel count, by the square root of it, and the box holding the most TOTAL
// SQUARED ERROR. The last one wins and is the principled one — it is greedy
// minimisation of the error the palette will actually cause.
//
// The difference is not small and it is all in the sky: the night gradient is
// a huge number of pixels spanning a NARROW range of colour, so any criterion
// that ranks by colour spread starves it. At 64 colours the log criterion
// gives the sky 3 levels; total-squared-error gives it 8, for slightly LESS
// error everywhere else as well.
const SPLIT = process.env.MENUART_SPLIT || 'sse';
function medianCut(entries, k, mode = SPLIT) {
  const boxOf = (list) => {
    let lo = [255, 255, 255, 255], hi = [0, 0, 0, 0], n = 0;
    const s = [0, 0, 0, 0];
    for (const e of list) {
      const v = [e.r, e.g, e.b, e.a];
      for (let c = 0; c < 4; c++) { if (v[c] < lo[c]) lo[c] = v[c]; if (v[c] > hi[c]) hi[c] = v[c]; s[c] += v[c] * e.n; }
      n += e.n;
    }
    const cen = s.map((x) => x / n);
    let sse = 0;
    for (const e of list) {
      const v = [e.r, e.g, e.b, e.a];
      let d = 0; for (let c = 0; c < 4; c++) { const q = v[c] - cen[c]; d += q * q; }
      sse += d * e.n;
    }
    let axis = 0, wid = -1;
    for (let c = 0; c < 4; c++) { const w = hi[c] - lo[c]; if (w > wid) { wid = w; axis = c; } }
    const score = mode === 'sse' ? sse : mode === 'sqrt' ? wid * Math.sqrt(n) : wid * Math.log2(1 + n);
    return { list, axis, wid, n, sse, score };
  };
  let boxes = [boxOf(entries)];
  while (boxes.length < k) {
    boxes.sort((p, q) => q.score - p.score);
    const b = boxes.shift();
    if (!b || b.wid <= 0 || b.list.length < 2) { if (b) boxes.push({ ...b, score: -1 }); if (boxes.every((x) => x.score < 0)) break; continue; }
    const key = ['r', 'g', 'b', 'a'][b.axis];
    const list = b.list.slice().sort((p, q) => p[key] - q[key]);
    let half = b.n / 2, acc = 0, cut = 0;
    for (let i = 0; i < list.length; i++) { acc += list[i].n; if (acc >= half) { cut = Math.max(1, Math.min(list.length - 1, i)); break; } }
    boxes.push(boxOf(list.slice(0, cut)), boxOf(list.slice(cut)));
  }
  return boxes.filter((b) => b.list.length).map((b) => {
    let r = 0, g = 0, bl = 0, a = 0, n = 0;
    for (const e of b.list) { r += e.r * e.n; g += e.g * e.n; bl += e.b * e.n; a += e.a * e.n; n += e.n; }
    return [Math.round(r / n), Math.round(g / n), Math.round(bl / n), Math.round(a / n)];
  });
}

function nearest(pal, r, g, b, a) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const p = pal[i];
    const dr = r - p[0], dg = g - p[1], db = b - p[2], da = a - p[3];
    const d = dr * dr + dg * dg + db * db + da * da;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function kmeans(entries, pal, iters = 4) {
  for (let it = 0; it < iters; it++) {
    const acc = pal.map(() => [0, 0, 0, 0, 0]);
    for (const e of entries) {
      const i = nearest(pal, e.r, e.g, e.b, e.a), t = acc[i];
      t[0] += e.r * e.n; t[1] += e.g * e.n; t[2] += e.b * e.n; t[3] += e.a * e.n; t[4] += e.n;
    }
    for (let i = 0; i < pal.length; i++) {
      const t = acc[i];
      if (t[4]) pal[i] = [Math.round(t[0] / t[4]), Math.round(t[1] / t[4]), Math.round(t[2] / t[4]), Math.round(t[3] / t[4])];
    }
  }
  return pal;
}

// Returns { pal, idx, img } — idx is one palette index per pixel, img is the
// quantised image rendered back to RGBA so it can be measured and looked at.
function quantize(img, k, { dither = false, split = SPLIT } = {}) {
  const { entries, clear } = histogram(img);
  const hasClear = clear > 0;
  const budget = Math.max(1, k - (hasClear ? 1 : 0));
  let pal;
  if (entries.length <= budget) pal = entries.map((e) => [e.r, e.g, e.b, e.a]);
  else pal = kmeans(entries, medianCut(entries, budget, split));
  if (hasClear) pal = [[0, 0, 0, 0], ...pal];

  // Palette order: everything with alpha < 255 first, so the tRNS chunk (which
  // must cover entries 0..last-non-opaque) is as short as it can be.
  pal.sort((p, q) => p[3] - q[3]);

  const n = img.w * img.h;
  const idx = new Uint8Array(n);
  const out = blank(img.w, img.h);
  const clearIdx = hasClear ? pal.findIndex((p) => p[3] === 0) : -1;

  if (!dither) {
    const cache = new Map();
    for (let i = 0; i < n; i++) {
      const a = img.d[i * 4 + 3];
      let pi;
      if (a < 8 && clearIdx >= 0) pi = clearIdx;
      else {
        const key = ((a << 24) | (img.d[i * 4] << 16) | (img.d[i * 4 + 1] << 8) | img.d[i * 4 + 2]) >>> 0;
        pi = cache.get(key);
        if (pi === undefined) { pi = nearest(pal, img.d[i * 4], img.d[i * 4 + 1], img.d[i * 4 + 2], a); cache.set(key, pi); }
      }
      idx[i] = pi;
      const p = pal[pi], o = i * 4;
      out.d[o] = p[0]; out.d[o + 1] = p[1]; out.d[o + 2] = p[2]; out.d[o + 3] = p[3];
    }
  } else {
    // Floyd-Steinberg, serpentine, error carried on all four channels. Error
    // is damped to 0.85 because full-strength diffusion on flat comic fill
    // sprays visible speckle into areas that were one solid colour.
    const buf = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) buf[i] = img.d[i];
    const push = (i, er, eg, eb, ea, f) => {
      if (i < 0 || i >= n) return;
      buf[i * 4] += er * f; buf[i * 4 + 1] += eg * f; buf[i * 4 + 2] += eb * f; buf[i * 4 + 3] += ea * f;
    };
    const DAMP = 0.85;
    for (let y = 0; y < img.h; y++) {
      const ltr = y % 2 === 0;
      for (let t = 0; t < img.w; t++) {
        const x = ltr ? t : img.w - 1 - t, i = y * img.w + x, o = i * 4;
        const r = buf[o], g = buf[o + 1], b = buf[o + 2], a = buf[o + 3];
        let pi;
        if (img.d[o + 3] < 8 && clearIdx >= 0) pi = clearIdx;
        else pi = nearest(pal, Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b)), Math.max(0, Math.min(255, a)));
        idx[i] = pi;
        const p = pal[pi];
        out.d[o] = p[0]; out.d[o + 1] = p[1]; out.d[o + 2] = p[2]; out.d[o + 3] = p[3];
        const er = (r - p[0]) * DAMP, eg = (g - p[1]) * DAMP, eb = (b - p[2]) * DAMP, ea = (a - p[3]) * DAMP;
        const nx = ltr ? 1 : -1;
        if ((ltr && x + 1 < img.w) || (!ltr && x - 1 >= 0)) push(i + nx, er, eg, eb, ea, 7 / 16);
        if (y + 1 < img.h) {
          if ((ltr && x - 1 >= 0) || (!ltr && x + 1 < img.w)) push(i + img.w - nx, er, eg, eb, ea, 3 / 16);
          push(i + img.w, er, eg, eb, ea, 5 / 16);
          if ((ltr && x + 1 < img.w) || (!ltr && x - 1 >= 0)) push(i + img.w + nx, er, eg, eb, ea, 1 / 16);
        }
      }
    }
  }
  return { pal, idx, img: out };
}

// ---------------------------------------------------------------------------
// PNG ENCODER. pngjs cannot write palette PNGs, and a palette PNG is the whole
// point of quantising, so this writes them: colour type 3 with PLTE and tRNS,
// bit-packed to 1/2/4 bits when the palette is small enough to allow it.
//
// It tries all five PNG row filters against the standard minimum-sum-of-
// absolute-differences heuristic AND an all-none pass (which usually wins for
// palette images, where neighbouring "values" are arbitrary indices and
// differencing them makes noise), then deflates each with three zlib
// strategies and keeps whichever is smallest. That is the poor man's
// replacement for oxipng, and it is worth 3-8%.
// ---------------------------------------------------------------------------

const CRCT = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRCT[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const b = Buffer.alloc(8 + data.length + 4);
  b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii');
  Buffer.from(data).copy(b, 8);
  b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
  return b;
}

function filterRows(raw, w, h, stride, bpp) {
  // returns two candidate byte streams: adaptive and all-none
  const adaptive = Buffer.alloc(h * (stride + 1));
  const none = Buffer.alloc(h * (stride + 1));
  const lines = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const cur = raw.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      lines[0][i] = cur[i];
      lines[1][i] = (cur[i] - a) & 255;
      lines[2][i] = (cur[i] - b) & 255;
      lines[3][i] = (cur[i] - ((a + b) >> 1)) & 255;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      lines[4][i] = (cur[i] - pr) & 255;
    }
    let best = 0, bs = Infinity;
    for (let f = 0; f < 5; f++) {
      let s = 0; for (let i = 0; i < stride; i++) { const v = lines[f][i]; s += v < 128 ? v : 256 - v; }
      if (s < bs) { bs = s; best = f; }
    }
    adaptive[y * (stride + 1)] = best;
    lines[best].copy(adaptive, y * (stride + 1) + 1);
    none[y * (stride + 1)] = 0;
    cur.copy(none, y * (stride + 1) + 1);
    prev = cur;
  }
  return [adaptive, none];
}

function bestDeflate(streams) {
  let best = null;
  for (const s of streams) {
    for (const strategy of [Z.Z_DEFAULT_STRATEGY, Z.Z_FILTERED, Z.Z_RLE]) {
      const z = deflateSync(s, { level: 9, memLevel: 9, strategy, windowBits: 15 });
      if (!best || z.length < best.length) best = z;
    }
  }
  return best;
}

function encodeIndexed(w, h, idx, pal) {
  const nc = pal.length;
  const bitDepth = nc <= 2 ? 1 : nc <= 4 ? 2 : nc <= 16 ? 4 : 8;
  const px = 8 / bitDepth;
  const stride = Math.ceil(w / px);
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = idx[y * w + x];
      if (bitDepth === 8) raw[y * stride + x] = v;
      else {
        const shift = 8 - bitDepth - (x % px) * bitDepth;
        raw[y * stride + (x / px | 0)] |= v << shift;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = bitDepth; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const plte = Buffer.alloc(nc * 3);
  for (let i = 0; i < nc; i++) { plte[i * 3] = pal[i][0]; plte[i * 3 + 1] = pal[i][1]; plte[i * 3 + 2] = pal[i][2]; }
  let lastT = -1;
  for (let i = 0; i < nc; i++) if (pal[i][3] < 255) lastT = i;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('PLTE', plte)];
  if (lastT >= 0) { const t = Buffer.alloc(lastT + 1); for (let i = 0; i <= lastT; i++) t[i] = pal[i][3]; parts.push(chunk('tRNS', t)); }
  parts.push(chunk('IDAT', bestDeflate(filterRows(raw, w, h, stride, 1))), chunk('IEND', Buffer.alloc(0)));
  return { buf: Buffer.concat(parts), bitDepth };
}

function encodeTruecolour(img, { alpha = true } = {}) {
  const bpp = alpha ? 4 : 3, stride = img.w * bpp;
  const raw = Buffer.alloc(stride * img.h);
  for (let i = 0, n = img.w * img.h; i < n; i++) {
    raw[i * bpp] = img.d[i * 4]; raw[i * bpp + 1] = img.d[i * 4 + 1]; raw[i * bpp + 2] = img.d[i * 4 + 2];
    if (alpha) raw[i * bpp + 3] = img.d[i * 4 + 3];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', bestDeflate(filterRows(raw, img.w, img.h, stride, bpp))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function writePNGFile(path, img) { writeFileSync(path, encodeTruecolour(img)); }

// ---------------------------------------------------------------------------
// WEBP, for comparison only, via ImageMagick if it is installed. Nothing in
// the deliverable depends on it.
// ---------------------------------------------------------------------------
function webpBytes(img, args) {
  try {
    const tmpIn = join(SHOTS, '.tmp-in.png'), tmpOut = join(SHOTS, '.tmp-out.webp');
    writePNGFile(tmpIn, img);
    execFileSync('convert', [tmpIn, ...args, tmpOut], { stdio: 'pipe' });
    return statSync(tmpOut).size;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// THE QUALITY METRIC. Candidate is upscaled back to the 704px source grid with
// Catmull-Rom (what the page will effectively do to it) and differenced
// against the source, per pixel, per channel.
//
// The car is COMPOSITED OVER THE CITY first, at the size and position the
// layout describes (about half the page width, bottom-ish), because that is
// where its alpha errors either show or do not. Differencing straight RGBA
// would score the colour of fully transparent pixels, which nobody ever sees.
// ---------------------------------------------------------------------------

function compositeOver(fg, bg) {
  const out = blank(fg.w, fg.h);
  for (let i = 0, n = fg.w * fg.h; i < n; i++) {
    const a = fg.d[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) out.d[i * 4 + c] = Math.round(fg.d[i * 4 + c] * a + bg.d[i * 4 + c] * (1 - a));
    out.d[i * 4 + 3] = 255;
  }
  return out;
}

function diff(a, b) {
  if (a.w !== b.w || a.h !== b.h) throw new Error(`diff size mismatch ${a.w}x${a.h} vs ${b.w}x${b.h}`);
  const n = a.w * a.h;
  let se = 0, over8 = 0, max = 0;
  const hist = new Int32Array(256);
  for (let i = 0; i < n; i++) {
    let pmax = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.d[i * 4 + c] - b.d[i * 4 + c]);
      se += d * d; if (d > pmax) pmax = d;
    }
    hist[pmax]++;
    if (pmax > 8) over8++;
    if (pmax > max) max = pmax;
  }
  let acc = 0, p99 = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.99) { p99 = v; break; } }
  const rmse = Math.sqrt(se / (n * 3));
  return { rmse, psnr: rmse === 0 ? Infinity : 20 * Math.log10(255 / rmse), pctOver8: (100 * over8) / n, p99, max };
}

function alphaDiff(a, b) {
  const n = a.w * a.h; let se = 0;
  for (let i = 0; i < n; i++) { const d = a.d[i * 4 + 3] - b.d[i * 4 + 3]; se += d * d; }
  return Math.sqrt(se / n);
}

// ---------------------------------------------------------------------------
// THE SKY. A night sky is a smooth vertical gradient and it is the first place
// a small palette shows as banding. This walks a strip of clean sky (chosen by
// searching the top of the source for the column band with the least
// horizontal detail, so no tower edge or star is inside it), averages each row
// across the strip, and reports how many distinct levels survive and how big
// the biggest jump between neighbouring rows is.
//
// A gradient with 40 levels over 160 rows is smooth. The same gradient with 6
// levels is six visible stripes, and the jump size is what makes them visible:
// steps of 1 are invisible, steps of 4+ on a flat dark field are Mach bands.
// ---------------------------------------------------------------------------

function findSkyStrip(img) {
  const H = Math.round(img.h * 0.42);              // top 42% is sky-and-towers
  let best = { x: 0, score: Infinity };
  const W = Math.max(4, Math.round(img.w * 0.02)); // ~14px strip at 704
  for (let x = 0; x + W < img.w; x++) {
    let s = 0;
    for (let y = 0; y < H; y++) for (let k = 0; k < W; k++) {
      const i = (y * img.w + x + k) * 4, j = (y * img.w + x + k + 1) * 4;
      s += Math.abs(img.d[i] - img.d[j]) + Math.abs(img.d[i + 1] - img.d[j + 1]) + Math.abs(img.d[i + 2] - img.d[j + 2]);
      if (y > 0) { const u = ((y - 1) * img.w + x + k) * 4; s += Math.abs(img.d[i] - img.d[u]) + Math.abs(img.d[i + 1] - img.d[u + 1]) + Math.abs(img.d[i + 2] - img.d[u + 2]); }
    }
    if (s < best.score) best = { x, score: s };
  }
  return { x0: best.x, w: W, y0: 0, h: H };
}

// THE MOON'S HALO. The strip probe above picks the FLATTEST piece of sky it
// can find, and that turned out to be the wrong place to look: at 1:1 in
// shots/stack-city-sky.png the first thing to break is not the open sky, it is
// the soft glow around the crescent moon — a radial ramp about 60px across
// that goes to visible contour rings at 64 colours while the open sky is still
// merely mottled. The auto-probe missed it because it was searching for the
// area with the LEAST detail and the halo has a gradient in it.
//
// So there is a second probe, aimed by finding the brightest pixel in the top
// half (the moon) and walking a horizontal ray out of it into the glow.
// FIRST ATTEMPT AT THIS WAS WRONG AND THE NUMBERS IT PRODUCED WERE NONSENSE:
// taking the brightest single pixel in the top of the frame finds a lit office
// window (luma 255, 4px across) at 469,58, and a ray out of THAT crosses hard
// ink edges, so the "biggest step in the gradient" came out at 78 luma for the
// source and every candidate scored "smooth" against it. A metric whose
// baseline is a hard edge cannot see a soft one.
//
// The moon is not the brightest PIXEL, it is the brightest AREA — its glow is
// tens of pixels across where a window is four. So blur hard first (a 31px box
// blur, twice, which is a decent Gaussian) and take the peak of that.
function findMoon(img) {
  const H = Math.floor(img.h * 0.5), R = 15;
  const l = new Float32Array(img.w * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < img.w; x++) {
    const i = (y * img.w + x) * 4;
    l[y * img.w + x] = 0.2126 * img.d[i] + 0.7152 * img.d[i + 1] + 0.0722 * img.d[i + 2];
  }
  const box = (src) => {
    const t = new Float32Array(src.length), o = new Float32Array(src.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < img.w; x++) {
      let s = 0, n = 0;
      for (let k = -R; k <= R; k++) { const xx = x + k; if (xx < 0 || xx >= img.w) continue; s += src[y * img.w + xx]; n++; }
      t[y * img.w + x] = s / n;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < img.w; x++) {
      let s = 0, n = 0;
      for (let k = -R; k <= R; k++) { const yy = y + k; if (yy < 0 || yy >= H) continue; s += t[yy * img.w + x]; n++; }
      o[y * img.w + x] = s / n;
    }
    return o;
  };
  const b = box(box(l));
  let bx = 0, by = 0, bl = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < img.w; x++) if (b[y * img.w + x] > bl) { bl = b[y * img.w + x]; bx = x; by = y; }
  return { x: bx, y: by, luma: bl, peakPixel: l[by * img.w + bx] };
}

// The profile is RADIALLY AVERAGED over a fan of angles up and to the right of
// the moon (that quadrant is open sky in this picture; below and left is a
// tower). A single 1px ray is too noisy to compare candidates with — averaging
// the ring is what the eye does anyway.
//
// Radii and the centre are FRACTIONS of the image, so the same physical ring is
// measured whatever size the candidate is.
// The radius window (0.048..0.113 of the width = 34..80px at 704) was picked
// by printing the source profile, not guessed. Inside 34px the fan is still on
// the moon's bright rim, outside 80px it clips a star, and either one drops a
// 23-luma cliff into what is supposed to be the SMOOTH baseline — which is
// what made an earlier version of this score every candidate "smooth",
// including the 8-colour control. In this window the source falls 16 luma with
// a biggest step of 1.4, which is what a smooth gradient actually looks like.
const HALO_ANGLES = [-40, -30, -20, -10, 0, 10].map((d) => (d * Math.PI) / 180);
function haloProfile(img, moonFrac, from = 0.048, to = 0.113) {
  const cx = moonFrac.x * img.w, cy = moonFrac.y * img.h;
  const r0 = Math.round(from * img.w), r1 = Math.round(to * img.w);
  const luma = [], seen = new Set();
  for (let r = r0; r <= r1; r++) {
    let s = 0, n = 0;
    for (const a of HALO_ANGLES) {
      const x = Math.round(cx + r * Math.cos(a)), y = Math.round(cy + r * Math.sin(a));
      if (x < 0 || x >= img.w || y < 0 || y >= img.h) continue;
      const i = (y * img.w + x) * 4;
      s += 0.2126 * img.d[i] + 0.7152 * img.d[i + 1] + 0.0722 * img.d[i + 2]; n++;
      seen.add((img.d[i] << 16) | (img.d[i + 1] << 8) | img.d[i + 2]);
    }
    if (n) luma.push(s / n);
  }
  let maxStep = 0, bands = 0;
  for (let i = 1; i < luma.length; i++) { const d = Math.abs(luma[i] - luma[i - 1]); if (d > maxStep) maxStep = d; if (d >= 1.0) bands++; }
  return { levels: seen.size, samples: luma.length, maxStep, bands, luma, span: Math.max(...luma) - Math.min(...luma) };
}

// how far the candidate's halo has drifted from the source's, in luma. This is
// the half of the measurement that catches FLATTENING, which a step count
// cannot: the 8-colour control paints the entire halo one colour, and a flat
// ramp has a maximum step of zero and would otherwise score perfect.
function haloError(cand, ref) {
  const n = Math.min(cand.luma.length, ref.luma.length);
  let se = 0;
  for (let i = 0; i < n; i++) { const d = cand.luma[i] - ref.luma[i]; se += d * d; }
  return Math.sqrt(se / n);
}

// strip given in FRACTIONS of the image, so the same physical patch of sky is
// measured whatever size the candidate is.
function skyProfile(img, frac) {
  const x0 = Math.round(frac.x0 * img.w), w = Math.max(1, Math.round(frac.w * img.w));
  const y0 = Math.round(frac.y0 * img.h), h = Math.max(2, Math.round(frac.h * img.h));
  const rows = [];
  for (let y = y0; y < y0 + h && y < img.h; y++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let x = x0; x < x0 + w && x < img.w; x++) { const i = (y * img.w + x) * 4; r += img.d[i]; g += img.d[i + 1]; b += img.d[i + 2]; n++; }
    rows.push([r / n, g / n, b / n]);
  }
  // distinct levels: on the RAW pixels of the strip (not the row average),
  // because the average of a dithered band has more levels than the eye sees.
  const seen = new Set();
  for (let y = y0; y < y0 + h && y < img.h; y++) for (let x = x0; x < x0 + w && x < img.w; x++) {
    const i = (y * img.w + x) * 4;
    seen.add((img.d[i] << 16) | (img.d[i + 1] << 8) | img.d[i + 2]);
  }
  const luma = rows.map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
  let maxStep = 0, bands = 0;
  // "bands" = how many times the strip's average brightness jumps by 1.5 luma
  // or more from one row to the next. Each one of those is a candidate visible
  // edge across the whole width of the sky. The source scores 0.
  for (let i = 1; i < luma.length; i++) { const d = Math.abs(luma[i] - luma[i - 1]); if (d > maxStep) maxStep = d; if (d >= 1.5) bands++; }
  // per-column distinct luma, averaged: how many levels a single vertical line
  // of pixels actually contains. This is the number the eye sees as "bands".
  let colLevels = 0, cols = 0;
  for (let x = x0; x < x0 + w && x < img.w; x++) {
    const s = new Set();
    for (let y = y0; y < y0 + h && y < img.h; y++) { const i = (y * img.w + x) * 4; s.add((img.d[i] << 16) | (img.d[i + 1] << 8) | img.d[i + 2]); }
    colLevels += s.size; cols++;
  }
  return { distinct: seen.size, colLevels: colLevels / cols, maxStep, bands, luma, rows: luma.length, span: Math.max(...luma) - Math.min(...luma) };
}

// ---------------------------------------------------------------------------
// SELF TEST. Runs every time. If the tools are broken the numbers below are
// fiction, and this project has caught about a dozen broken measuring tools.
// ---------------------------------------------------------------------------
function selfTest() {
  const fail = [];
  const ok = (name, cond, detail = '') => { console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!cond) fail.push(name); };

  // resampler preserves a flat colour and its alpha, both directions
  const flat = blank(64, 64, [30, 200, 90, 128]);
  const down = resample(flat, 21, 17), up = resample(flat, 100, 90, 'catmullrom');
  const flatOK = (im) => { for (let i = 0; i < im.w * im.h; i++) { if (Math.abs(im.d[i * 4] - 30) > 1 || Math.abs(im.d[i * 4 + 1] - 200) > 1 || Math.abs(im.d[i * 4 + 2] - 90) > 1 || Math.abs(im.d[i * 4 + 3] - 128) > 1) return false; } return true; };
  ok('resample keeps a flat colour (down 64->21x17)', down.w === 21 && down.h === 17 && flatOK(down));
  ok('resample keeps a flat colour (up 64->100x90)', up.w === 100 && up.h === 90 && flatOK(up));

  // resampler does not drag transparent black into the edge (premultiply)
  const half = blank(32, 32, [255, 0, 0, 255]);
  for (let y = 0; y < 32; y++) for (let x = 16; x < 32; x++) { const i = (y * 32 + x) * 4; half.d[i + 3] = 0; half.d[i] = 0; }
  const hs = resample(half, 16, 16);
  let worstR = 255;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 7; x++) { const i = (y * 16 + x) * 4; if (hs.d[i + 3] > 200) worstR = Math.min(worstR, hs.d[i]); }
  ok('premultiplied resample: no dark halo on the opaque side', worstR > 250, `min R = ${worstR}`);

  // metric floor and ceiling
  const black = blank(8, 8, [0, 0, 0, 255]), white = blank(8, 8, [255, 255, 255, 255]);
  const d0 = diff(black, black), d1 = diff(black, white);
  ok('diff(identical) == 0', d0.rmse === 0 && d0.pctOver8 === 0);
  ok('diff(black,white) == 255', Math.round(d1.rmse) === 255 && d1.pctOver8 === 100, `rmse ${d1.rmse.toFixed(1)}`);

  // encoders round-trip through an INDEPENDENT decoder (pngjs), pixel-exact
  const noisy = blank(37, 23);
  let s = 12345;
  for (let i = 0; i < 37 * 23; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; noisy.d[i * 4] = s & 255; noisy.d[i * 4 + 1] = (s >> 8) & 255; noisy.d[i * 4 + 2] = (s >> 16) & 255; noisy.d[i * 4 + 3] = i % 5 === 0 ? 0 : 255 - (i % 3); }
  const tc = PNG.sync.read(encodeTruecolour(noisy));
  let tcOK = tc.width === 37 && tc.height === 23;
  for (let i = 0; i < 37 * 23 * 4 && tcOK; i++) if (tc.data[i] !== noisy.d[i]) tcOK = false;
  ok('truecolour PNG round-trips pixel-exact through pngjs', tcOK);

  for (const k of [4, 16, 64, 256]) {
    const q = quantize(noisy, k);
    const { buf, bitDepth } = encodeIndexed(noisy.w, noisy.h, q.idx, q.pal);
    const dec = PNG.sync.read(buf);
    let same = dec.width === 37 && dec.height === 23;
    for (let i = 0; i < 37 * 23 * 4 && same; i++) if (dec.data[i] !== q.img.d[i]) same = false;
    ok(`indexed PNG k=${k} (bitDepth ${bitDepth}) round-trips through pngjs`, same);
  }

  // the quantiser must actually honour its budget
  const q32 = quantize(noisy, 32);
  ok('quantiser respects the palette budget', q32.pal.length <= 32, `${q32.pal.length} colours`);

  // sky profile must SEE banding when banding is put in front of it
  const grad = blank(20, 120), band = blank(20, 120);
  for (let y = 0; y < 120; y++) for (let x = 0; x < 20; x++) {
    const i = (y * 20 + x) * 4, v = 20 + y * 0.5, vb = 20 + Math.round(y / 24) * 12;
    grad.d[i] = grad.d[i + 1] = grad.d[i + 2] = Math.round(v); grad.d[i + 3] = 255;
    band.d[i] = band.d[i + 1] = band.d[i + 2] = vb; band.d[i + 3] = 255;
  }
  const fr = { x0: 0, w: 1, y0: 0, h: 1 };
  const pg = skyProfile(grad, fr), pb = skyProfile(band, fr);
  ok('sky profile counts levels', pg.colLevels > 50 && pb.colLevels <= 6, `smooth ${pg.colLevels.toFixed(0)} levels / banded ${pb.colLevels.toFixed(0)} levels`);
  ok('sky profile catches a big step', pg.maxStep < 1.5 && pb.maxStep > 8, `smooth step ${pg.maxStep.toFixed(1)} / banded step ${pb.maxStep.toFixed(1)}`);

  if (fail.length) { console.log(`\nSELF TEST FAILED: ${fail.join(', ')}\nEverything below would be fiction. Stopping.`); process.exit(1); }
  return true;
}

// ---------------------------------------------------------------------------
const B64 = (buf) => buf.toString('base64');
const kb = (n) => (n / 1024).toFixed(1) + 'K';
const pad = (s, n, right = false) => (right ? String(s).padStart(n) : String(s).padEnd(n));

function table(headers, widths, rows) {
  console.log(headers.map((h, i) => pad(h, Math.abs(widths[i]), widths[i] < 0)).join(' '));
  console.log(widths.map((w) => '-'.repeat(Math.abs(w))).join(' '));
  for (const r of rows) {
    if (r === null) { console.log(widths.map((w) => '-'.repeat(Math.abs(w))).join(' ')); continue; }
    console.log(r.map((c, i) => pad(c, Math.abs(widths[i]), widths[i] < 0)).join(' '));
  }
}

// ===========================================================================
mkdirSync(SHOTS, { recursive: true });

console.log('MENU ART — sizing and palette for the landing page images');
console.log('='.repeat(78));
console.log('\nSELF TEST (the measuring tools, before any measurement)');
selfTest();

const carSrc = readPNG(join(ROOT, 'ref/start-car-blower.png'));
const citySrc = readPNG(join(ROOT, 'ref/start-cityscape.png'));
console.log(`\nsources: car ${carSrc.w}x${carSrc.h} (${kb(statSync(join(ROOT, 'ref/start-car-blower.png')).size)} on disk), city ${citySrc.w}x${citySrc.h} (${kb(statSync(join(ROOT, 'ref/start-cityscape.png')).size)})`);

// -- alpha trim check -------------------------------------------------------
{
  let x0 = carSrc.w, x1 = -1, y0 = carSrc.h, y1 = -1;
  for (let y = 0; y < carSrc.h; y++) for (let x = 0; x < carSrc.w; x++) {
    if (carSrc.d[(y * carSrc.w + x) * 4 + 3] >= 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  console.log(`car alpha bbox at alpha>=8: x[${x0}..${x1}] y[${y0}..${y1}] of ${carSrc.w}x${carSrc.h} — trimming would save ${carSrc.w - (x1 - x0 + 1)}x${carSrc.h - (y1 - y0 + 1)} px. The source is already trimmed.`);
}

// -- the sky strip ----------------------------------------------------------
const strip = findSkyStrip(citySrc);
const stripFrac = { x0: strip.x0 / citySrc.w, w: strip.w / citySrc.w, y0: 0, h: strip.h / citySrc.h };
const moon = findMoon(citySrc);
const moonFrac = { x: moon.x / citySrc.w, y: moon.y / citySrc.h };
const skySrc = skyProfile(citySrc, stripFrac);
skySrc.halo = haloProfile(citySrc, moonFrac);
skySrc.halo.err = 0;
console.log(`sky strip: x ${strip.x0}..${strip.x0 + strip.w} y 0..${strip.h} (the least-detailed ${strip.w}px column band in the top ${strip.h} rows — no tower edge, no star, no moon)`);
console.log(`sky in the source: ${skySrc.distinct} distinct RGB, ${skySrc.colLevels.toFixed(1)} levels down an average single column, biggest row-to-row luma step ${skySrc.maxStep.toFixed(2)}, total luma span ${skySrc.span.toFixed(1)}`);
console.log(`moon found at ${moon.x},${moon.y} (luma ${moon.luma.toFixed(0)}); halo ray ${skySrc.halo.samples}px long, ${skySrc.halo.levels} levels, span ${skySrc.halo.span.toFixed(1)} luma, biggest step ${skySrc.halo.maxStep.toFixed(2)}`);

// -- the candidate sweep ----------------------------------------------------
// THE CHOICE, declared up here because half the report is stated relative to
// it. It is justified by the tables below, not by being written first.
const CHOICE = {
  car: { w: 704, palette: 64, dither: false },
  city: { w: 704, palette: 256, dither: false },   // 256 for the moon's halo alone; see the sky section
};

const CAR_SIZES = QUICK ? [704, 576] : [704, 640, 576, 512, 448, 384];
const CITY_SIZES = QUICK ? [704, 576] : [704, 640, 576, 512, 448, 384];
const PALETTES = QUICK ? [64, 32] : [256, 128, 64, 32];

// the background the car is judged against: the city, scaled as the layout
// will scale it (car ~half the page width) and cropped to the car's box.
function carBackdrop(w, h) {
  const bg = resample(citySrc, w * 2, Math.round(((w * 2) / citySrc.w) * citySrc.h), 'lanczos3');
  return crop(bg, Math.round(w * 0.5), Math.max(0, bg.h - h - Math.round(h * 0.12)), w, h);
}
const CAR_BG = carBackdrop(carSrc.w, carSrc.h);
const carSrcComposited = compositeOver(carSrc, CAR_BG);

function evalCandidate(kind, src, w, req, { dither = false, linear = false, truecolour = false, noalpha = false, split = SPLIT } = {}) {
  const palette = req;
  const h = Math.round((w / src.w) * src.h);
  const small = w === src.w && !linear ? src : resample(src, w, h, 'lanczos3', { linear });
  let img, bytes, bitDepth = 8, ncol;
  if (truecolour) {
    img = small;
    bytes = encodeTruecolour(small, { alpha: !noalpha }).length;
    ncol = 'true';
  } else {
    const q = quantize(small, palette, { dither, split });
    img = q.img;
    const enc = encodeIndexed(w, h, q.idx, q.pal);
    bytes = enc.buf.length; bitDepth = enc.bitDepth; ncol = q.pal.length;
  }
  // upscale back to the source grid and difference there
  const back = w === src.w ? img : resample(img, src.w, src.h, 'catmullrom');
  let m, aRMSE = 0;
  if (kind === 'car') {
    m = diff(compositeOver(back, CAR_BG), carSrcComposited);
    aRMSE = alphaDiff(back, src);
  } else {
    m = diff(back, src);
  }
  const sky = kind === 'city' ? skyProfile(img, stripFrac) : null;
  if (sky) { sky.halo = haloProfile(img, moonFrac); sky.halo.err = haloError(sky.halo, skySrc.halo); }
  const b64 = Math.ceil(bytes / 3) * 4;
  return { kind, w, h, req, palette: ncol, bitDepth, dither, linear, truecolour, bytes, b64, ...m, aRMSE, sky, img, small };
}

const rows = { car: [], city: [] };
console.log('\nsweeping…');
for (const w of CAR_SIZES) {
  rows.car.push(evalCandidate('car', carSrc, w, 0, { truecolour: true }));
  for (const p of PALETTES) rows.car.push(evalCandidate('car', carSrc, w, p));
}
for (const w of CITY_SIZES) {
  rows.city.push(evalCandidate('city', citySrc, w, 0, { truecolour: true, noalpha: true }));
  for (const p of PALETTES) rows.city.push(evalCandidate('city', citySrc, w, p));
}

// look a candidate up in the sweep, or measure it on the spot if the sweep did
// not happen to include it (--quick, or a size that is not on the grid)
const extraCache = new Map();
function pick(kind, w, p, opts = {}) {
  const key = `${kind}|${w}|${p}|${JSON.stringify(opts)}`;
  const hit = rows[kind].find((r) => r.w === w && r.req === p && !r.truecolour && !r.dither && !r.linear && !opts.dither && !opts.truecolour);
  if (hit) return hit;
  if (!extraCache.has(key)) extraCache.set(key, evalCandidate(kind, kind === 'car' ? carSrc : citySrc, w, p, opts));
  return extraCache.get(key);
}

function printTable(kind, list, extraCols = []) {
  const hdr = ['size', 'colours', 'depth', 'PNG', 'base64', 'RMSE', 'PSNR', '%px>8', 'p99', ...extraCols];
  const wid = [-9, -8, -6, -8, -8, -6, -6, -6, -4, ...extraCols.map(() => -8)];
  const out = list.map((r) => {
    const base = [`${r.w}x${r.h}`, r.truecolour ? 'true' : r.palette + (r.dither ? 'd' : ''), r.truecolour ? '8' : r.bitDepth, kb(r.bytes), kb(r.b64), r.rmse.toFixed(2), r.psnr === Infinity ? 'inf' : r.psnr.toFixed(1), r.pctOver8.toFixed(2), r.p99];
    if (kind === 'car') base.push(r.aRMSE.toFixed(2));
    if (kind === 'city') base.push(r.sky.colLevels.toFixed(1), r.sky.maxStep.toFixed(2), r.sky.halo.maxStep.toFixed(2), r.sky.halo.err.toFixed(2), skyVerdict(r));
    return base;
  });
  table(hdr, wid, out);
}

console.log('\n\nCAR — 704x321 source, transparent, judged composited over the cityscape');
console.log('(RMSE/PSNR/%px>8/p99 are against the 704px source after upscaling the candidate back;');
console.log(' aRMSE is the alpha channel on its own — the ink edge that has to survive compositing)');
printTable('car', rows.car, ['aRMSE']);

console.log('\n\nCITY — 704x384 source, opaque');
console.log('(sky = a flat strip of open night sky; halo = a ray out of the moon through its glow.');
console.log(' lvl = distinct colours along it, step = biggest jump in luma between neighbours.');
console.log(` source: sky ${skySrc.colLevels.toFixed(1)}/${skySrc.maxStep.toFixed(2)}, halo ${skySrc.halo.levels}/${skySrc.halo.maxStep.toFixed(2)})`);
printTable('city', rows.city, ['sky lvl', 'sky step', 'halo stp', 'halo err', 'sky?']);

// -- resample-space variant -------------------------------------------------
console.log('\n\nRESAMPLE SPACE (sRGB vs linear light), same size and palette');
{
  const a = evalCandidate('city', citySrc, 576, 64, {});
  const b = evalCandidate('city', citySrc, 576, 64, { linear: true });
  const c = evalCandidate('car', carSrc, 576, 64, {});
  const d = evalCandidate('car', carSrc, 576, 64, { linear: true });
  table(['image', 'space', 'PNG', 'RMSE', '%px>8'], [-7, -8, -8, -6, -6], [
    ['city', 'sRGB', kb(a.bytes), a.rmse.toFixed(2), a.pctOver8.toFixed(2)],
    ['city', 'linear', kb(b.bytes), b.rmse.toFixed(2), b.pctOver8.toFixed(2)],
    ['car', 'sRGB', kb(c.bytes), c.rmse.toFixed(2), c.pctOver8.toFixed(2)],
    ['car', 'linear', kb(d.bytes), d.rmse.toFixed(2), d.pctOver8.toFixed(2)],
  ]);
  console.log('(the RMSE here is measured against an sRGB-space reference, so it is not a fair fight —');
  console.log(' what it does show is that linear-light downsampling moves the pixels a long way, and it');
  console.log(' moves them by lightening ink lines, which is the wrong direction for comic art.)');
}

// THE BANDING VERDICT, in one place. Two conditions, because there are two
// ways to ruin a gradient: break it into steps, or flatten it away entirely.
// The thresholds are calibrated against the source (its own ring steps by 2.22
// luma, which is by definition acceptable) and against what was actually seen
// at 1:1 in shots/stack-city-sky.png — 256 colours invisible, 128 a faint ring
// round the moon, 64 an obvious one.
function skyVerdict(r) {
  const step = r.sky.halo.maxStep / skySrc.halo.maxStep, err = r.sky.halo.err;
  if (step <= 1.35 && err <= 1.2) return 'smooth';
  if (step <= 2.2 && err <= 2.5) return 'faint';
  return 'BANDS';
}

// -- the quantiser itself ---------------------------------------------------
// The palette SPLIT CRITERION turned out to matter more than a whole doubling
// of the palette does, so it gets measured too rather than assumed.
console.log('\n\nQUANTISER SPLIT CRITERION (city 704x384 — where does the palette get spent?)');
{
  const qRows = [];
  for (const mode of ['log', 'sqrt', 'sse']) {
    for (const p of [64, 128, 256]) {
      const r = evalCandidate('city', citySrc, 704, p, { split: mode });
      qRows.push([mode, p, kb(r.bytes), r.rmse.toFixed(2), r.pctOver8.toFixed(2), r.sky.colLevels.toFixed(1), r.sky.maxStep.toFixed(2)]);
    }
  }
  table(['criterion', 'colours', 'PNG', 'RMSE', '%px>8', 'sky lvls', 'sky step'], [-10, -8, -8, -6, -6, -9, -9], qRows);
  console.log(`in use: ${SPLIT}. "log" is widest-axis x log(count) — the obvious one, and the one that starves`);
  console.log('the sky: a huge number of pixels over a narrow colour range never looks worth splitting.');
  console.log('"sse" splits the box holding the most total squared error, which is what the palette is for.');
  console.log('It is NOT free — more sky levels means more distinct indices in the biggest flat area of the');
  console.log('image, and the file grows about 7%. It is a better rate than buying the same sky levels with');
  console.log('more palette: sse at 64 colours matches log at 128 in the sky for 19K less (121K vs 140K).');
}

// -- the sky, on its own ----------------------------------------------------
// This is the measurement the whole city decision turns on, so it gets its own
// section and its own picture. A night sky is a smooth 36-luma ramp over 161
// rows; a palette that cannot afford it turns the ramp into stripes.
console.log('\n\nTHE SKY GRADIENT — a 14px x 161px strip of clean night sky, before and after');
{
  const sRows = [['SOURCE 704x384', 'truecolour', skySrc.colLevels.toFixed(1), skySrc.maxStep.toFixed(2), skySrc.halo.maxStep.toFixed(2), '0.00', '-', 'smooth']];
  const skyCands = [];
  for (const p of [256, 128, 64, 32, 8]) skyCands.push([`704x384 ${p}col`, p, pick('city', 704, p)]);
  for (const p of [256, 128, 64, 32]) skyCands.push([`704x384 ${p}col +FS`, p, pick('city', 704, p, { dither: true })]);
  for (const [label, p, r] of skyCands) {
    sRows.push([label, p + (r.dither ? ' +FS' : ''), r.sky.colLevels.toFixed(1), r.sky.maxStep.toFixed(2), r.sky.halo.maxStep.toFixed(2), r.sky.halo.err.toFixed(2), kb(r.bytes), skyVerdict(r)]);
  }
  table(['candidate', 'palette', 'open lvls', 'open step', 'halo step', 'halo err', 'PNG', 'verdict'],
    [-20, -10, -9, -9, -9, -9, -8, -8], sRows);
  console.log('"open" = a flat strip of night sky; "halo" = the ring of glow around the moon, radially');
  console.log('averaged. The verdict is on the HALO because that is where the eye found it first and the');
  console.log('flat strip did not: at 1:1 the halo rings at 64 colours while the open sky is only mottled.');
  console.log(`Source halo: ${skySrc.halo.samples} samples over ${skySrc.halo.span.toFixed(1)} luma, biggest step ${skySrc.halo.maxStep.toFixed(2)}.`);
  console.log('"err" is RMS luma against the source ring, and it is there because a step count alone can');
  console.log('be fooled: the 8-colour control paints the whole halo one flat colour, whose maximum step');
  console.log('is ZERO. Flattening the gradient has to score as a failure, and err is what scores it.');

  // and a picture of it, because a table is not an eye
  const stack = [['source', citySrc], ...skyCands.map(([l, p, r]) => [l.replace('704x384 ', ''), r.img])];
  const SH = 161, SW = 56;
  const sheet = blank(stack.length * (SW + 4), SH, [0, 0, 0, 255]);
  stack.forEach(([lbl, im], i) => {
    const x0 = Math.round(stripFrac.x0 * im.w), w = Math.max(1, Math.round(stripFrac.w * im.w));
    const h = Math.max(2, Math.round(stripFrac.h * im.h));
    const strp = crop(im, x0, 0, w, h);
    const up = resample(strp, SW, SH, 'catmullrom');
    paste(sheet, up, i * (SW + 4), 0);
  });
  writePNGFile(join(SHOTS, 'sky-strip.png'), sheet);
  console.log(`\nshots/sky-strip.png — the same strip of sky from each candidate, ${SW}px wide each, in this order:`);
  console.log('  ' + stack.map(([l]) => l).join(' | '));
}

// -- dithering --------------------------------------------------------------
console.log('\n\nDITHERING (city only — the sky gradient is the only thing that could want it)');
{
  const dRows = [];
  for (const p of [256, 128, 64, 32]) {
    for (const dith of [false, true]) {
      const r = pick('city', 704, p, dith ? { dither: true } : {});
      dRows.push([`704x384`, p + (dith ? ' +FS' : ''), kb(r.bytes), kb(r.b64), r.rmse.toFixed(2), r.pctOver8.toFixed(2), r.sky.colLevels.toFixed(1), r.sky.maxStep.toFixed(2), r.sky.bands]);
    }
  }
  table(['size', 'colours', 'PNG', 'base64', 'RMSE', '%px>8', 'levels', 'step', 'bands'], [-9, -9, -8, -8, -6, -6, -7, -6, -6], dRows);
}

// -- where the city's bytes actually go -------------------------------------
// The city costs more than twice what the car costs and it is worth knowing
// why before paying it. Encode the top band (sky) and the bottom band
// (street) separately, and encode the sky again with its finest detail rounded
// off, to see how much of the bill is the artwork and how much is grain.
console.log('\n\nWHERE THE CITY\'S BYTES GO (256-colour indexed, 704 wide)');
{
  const q = pick('city', 704, 256);
  const SKYH = strip.h;                 // 161 rows: sky and the tops of towers
  const bandBytes = (img, y0, h) => {
    const c = crop(img, 0, y0, img.w, h);
    const qq = quantize(c, 256);
    return encodeIndexed(c.w, c.h, qq.idx, qq.pal).buf.length;
  };
  const skyB = bandBytes(q.img, 0, SKYH), streetB = bandBytes(q.img, SKYH, citySrc.h - SKYH);
  // Two DIAGNOSTICS, not candidates — both alter the artwork, neither ships.
  // (a) round every channel to a multiple of 4, the cheap "de-grain".
  // (b) 3x3 box blur, an actual denoise.
  // The point is to find out whether the sky's bytes are the source's fine
  // grain or something else.
  const rawSkyImg = crop(citySrc, 0, 0, citySrc.w, SKYH);
  const rawSky = bandBytes(rawSkyImg, 0, SKYH);
  const rounded = crop(rawSkyImg, 0, 0, citySrc.w, SKYH);
  for (let i = 0; i < rounded.d.length; i++) if (i % 4 !== 3) rounded.d[i] = Math.min(255, Math.round(rounded.d[i] / 4) * 4);
  const blurred = crop(rawSkyImg, 0, 0, citySrc.w, SKYH);
  for (let y = 1; y < SKYH - 1; y++) for (let x = 1; x < citySrc.w - 1; x++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += rawSkyImg.d[((y + dy) * citySrc.w + x + dx) * 4 + c];
      blurred.d[(y * citySrc.w + x) * 4 + c] = Math.round(s / 9);
    }
  }
  const roundB = bandBytes(rounded, 0, SKYH), blurB = bandBytes(blurred, 0, SKYH);
  table(['band', 'rows', 'PNG', 'per row', 'note'], [-24, -6, -8, -9, -32], [
    [`sky + tower tops`, SKYH, kb(skyB), (skyB / SKYH).toFixed(0) + ' B', `${(100 * skyB / (skyB + streetB)) | 0}% of the image's bytes`],
    [`street level`, citySrc.h - SKYH, kb(streetB), (streetB / (citySrc.h - SKYH)).toFixed(0) + ' B', 'windows, kerbs, road markings'],
    null,
    ['sky, as drawn', SKYH, kb(rawSky), '', 'baseline for the two below'],
    ['sky, channels /4', SKYH, kb(roundB), '', `saves ${kb(rawSky - roundB)} — ${(100 * (rawSky - roundB) / rawSky).toFixed(0)}%`],
    ['sky, 3x3 blurred', SKYH, kb(blurB), '', `saves ${kb(rawSky - blurB)} — ${(100 * (rawSky - blurB) / rawSky).toFixed(0)}%`],
  ]);
  console.log(`The sky band is ${(100 * skyB / (skyB + streetB)) | 0}% of the file, at ${(skyB / SKYH).toFixed(0)} bytes a row against street level's ${(streetB / (citySrc.h - SKYH)).toFixed(0)} —`);
  console.log('a near-empty gradient costs almost as much per row as the busiest part of the picture.');
  console.log('THE OBVIOUS EXPLANATION IS WRONG. Rounding the source\'s grain off before quantising saves');
  console.log(`${kb(rawSky - roundB)}, essentially nothing: at 256 colours the quantiser has already absorbed the grain.`);
  console.log(`What costs the bytes is the index field the quantiser leaves behind — with the sky's 16-luma`);
  console.log(`ramp spread over ~17 palette entries, which entry each pixel lands on is close to random,`);
  console.log(`and deflate cannot compress that. Actually denoising first (3x3 blur) does cut it, by ${(100 * (rawSky - blurB) / rawSky).toFixed(0)}%.`);
  console.log('NEITHER IS SHIPPED: both retouch someone else\'s artwork to save bytes on a budget that was');
  console.log('explicitly called not tight. The numbers are here so the trade is visible if it ever is.');
}

// -- WebP -------------------------------------------------------------------
// A fair comparison needs the same PIXELS on both sides, so each PNG row is
// paired with a WebP of the identical image: truecolour source against
// truecolour source, quantised against quantised. Comparing lossless WebP of
// the 50,000-colour source against a 64-colour PNG would just be measuring the
// quantiser twice.
console.log('\n\nWEBP, for comparison only (via ImageMagick; nothing shipped depends on it)');
{
  // GUARD: this ImageMagick build's WebP delegate silently ignores -quality.
  // q90, q80, q50 and q20 all come out at exactly the same byte count, which
  // means any "lossy WebP at quality N" number from it is fiction. Check it
  // rather than quoting it.
  const a = webpBytes(citySrc, ['-quality', '90']), b = webpBytes(citySrc, ['-quality', '20']);
  const lossyTrustworthy = a != null && b != null && a !== b;
  if (!lossyTrustworthy) {
    console.log(`!! this ImageMagick ignores -quality for WebP: q90 and q20 both give ${a} bytes.`);
    console.log('!! the lossy rows below are its DEFAULT quality (~75), not the quality named. Do not');
    console.log('!! quote them as "WebP at q90". The lossless rows do vary and are real.');
  }
  const wRows = [];
  for (const [name, src, kind] of [['car 704x321', carSrc, 'car'], ['city 704x384', citySrc, 'city']]) {
    const tc = rows[kind].find((r) => r.w === 704 && r.truecolour);
    const q = pick(kind, 704, kind === 'car' ? CHOICE.car.palette : CHOICE.city.palette);
    const pairs = [
      ['source pixels', 'PNG truecolour', tc.bytes, 1],
      ['source pixels', 'WebP lossless', webpBytes(src, ['-define', 'webp:lossless=true']), tc.bytes],
      ['source pixels', lossyTrustworthy ? 'WebP q90' : 'WebP lossy(dflt)', webpBytes(src, ['-quality', '90']), tc.bytes],
      [`${q.palette}-col pixels`, 'PNG indexed', q.bytes, 1],
      [`${q.palette}-col pixels`, 'WebP lossless', webpBytes(q.img, ['-define', 'webp:lossless=true']), q.bytes],
    ];
    for (const [pix, fmt, b, ref] of pairs) {
      wRows.push([name, pix, fmt, b == null ? 'n/a' : kb(b), b == null ? 'n/a' : kb(Math.ceil(b / 3) * 4), b == null || ref === 1 ? '' : (b / ref).toFixed(2) + 'x']);
    }
    wRows.push(null);
  }
  wRows.pop();
  table(['image', 'pixels', 'format', 'bytes', 'base64', 'vs PNG'], [-13, -15, -15, -8, -8, -7], wRows);
  console.log('WebP support: Safari from iOS 14 (Sept 2020), Chrome/Android from 4.0 lossy / 4.2 alpha,');
  console.log('Android stock browser before that: no. ~96-97% globally, and the two named targets are');
  console.log('"an old Android" and "iOS Safari" — the exact two places it can miss. A data URL cannot');
  console.log('carry a fallback the way <picture> can, and this module exports ONE url per image, so a');
  console.log('WebP here is a blank landing page on the devices we were told to care about, not a');
  console.log('degraded one. Numbers above are for the record; the choice is PNG.');
}

// ===========================================================================
// THE CHOICE — built for real, written out, and measured as shipped
// ===========================================================================
function build(kind, src, c) {
  const h = Math.round((c.w / src.w) * src.h);
  const small = c.w === src.w ? src : resample(src, c.w, h, 'lanczos3');
  const q = quantize(small, c.palette, { dither: c.dither });
  const enc = encodeIndexed(c.w, h, q.idx, q.pal);
  return { ...c, h, img: q.img, buf: enc.buf, bitDepth: enc.bitDepth, ncol: q.pal.length, b64: B64(enc.buf) };
}
const car = build('car', carSrc, CHOICE.car);
const city = build('city', citySrc, CHOICE.city);

// -- negative control -------------------------------------------------------
console.log('\n\nNEGATIVE CONTROL — the same pipeline at 8 colours, and at 256px wide.');
console.log('If the metric cannot tell these from the chosen ones it is not a metric.');
{
  const negs = [
    ['car', pick('car', 704, 8)],
    ['car', pick('car', 256, 32)],
    ['city', pick('city', 704, 8)],
    ['city', pick('city', 256, 32)],
    ['car CHOSEN', pick('car', CHOICE.car.w, CHOICE.car.palette)],
    ['city CHOSEN', pick('city', CHOICE.city.w, CHOICE.city.palette)],
  ];
  table(['what', 'size', 'colours', 'PNG', 'RMSE', 'PSNR', '%px>8', 'p99', 'max', 'sky lvls'], [-12, -9, -8, -8, -6, -6, -6, -4, -4, -8],
    negs.map(([n, r]) => [n, `${r.w}x${r.h}`, r.palette, kb(r.bytes), r.rmse.toFixed(2), r.psnr.toFixed(1), r.pctOver8.toFixed(2), r.p99, r.max, r.sky ? r.sky.colLevels.toFixed(1) : '-']));
  const bad = negs[2][1], good = negs[5][1];
  console.log(`\nthe metric separates them by ${(bad.rmse / good.rmse).toFixed(1)}x on RMSE and ${(bad.pctOver8 / Math.max(good.pctOver8, 0.001)).toFixed(0)}x on %px>8,`);
  console.log(`and the 8-colour sky collapses to ${bad.sky.colLevels.toFixed(1)} levels from the source's ${skySrc.colLevels.toFixed(1)}. It catches bad.`);
  writePNGFile(join(SHOTS, 'negative-city-8col.png'), negs[2][1].img);
  writePNGFile(join(SHOTS, 'negative-car-8col.png'), negs[0][1].img);
}

// -- the numbers the module header quotes, gathered in one place so the prose
//    cannot drift away from the measurement --------------------------------
const S = {};
S.chosen = { car: pick('car', CHOICE.car.w, CHOICE.car.palette), city: pick('city', CHOICE.city.w, CHOICE.city.palette) };
S.true = {
  car: rows.car.find((r) => r.w === CHOICE.car.w && r.truecolour),
  city: rows.city.find((r) => r.w === CHOICE.city.w && r.truecolour),
};
// the next palette down from each choice — the cheaper option that was
// rejected, and the one the header has to justify rejecting
S.half = { car: pick('car', CHOICE.car.w, CHOICE.car.palette / 2), city: pick('city', CHOICE.city.w, CHOICE.city.palette / 2) };
S.down512 = (() => {
  const c = pick('car', 512, CHOICE.car.palette), t = pick('city', 512, CHOICE.city.palette);
  return { car: c, city: t, saving: (S.chosen.car.b64 - c.b64) + (S.chosen.city.b64 - t.b64) };
})();
S.dither = pick('city', CHOICE.city.w, CHOICE.city.palette / 2, { dither: true });
S.sky = { src: skySrc, half: S.half.city.sky.halo, chosen: S.chosen.city.sky.halo };
// LIKE FOR LIKE, or the comparison is meaningless: lossless WebP of the SAME
// quantised pixels that go into the PNG. Comparing a lossy WebP of the
// 50,000-colour source against a 256-colour PNG would be measuring the
// quantiser, not the format.
S.webp = (() => {
  const same = webpBytes(S.chosen.city.img, ['-define', 'webp:lossless=true']);
  const lossy = webpBytes(citySrc, ['-quality', '90']);
  return {
    bytes: same,
    ratio: same ? (same / S.chosen.city.bytes).toFixed(2) + 'x' : 'smaller',
    lossy: lossy ? kb(lossy) : 'n/a',
  };
})();

// -- what the eye saw -------------------------------------------------------
// The brief asks which candidates are visually indistinguishable, and that is
// not a question a number answers on its own. These are observations made at
// 1:1 from the stacks in shots/, written down here so the report says what was
// SEEN and not only what was computed — and so the two can be checked against
// each other, including where they disagree.
console.log('\n\nWHAT THE EYE SAW (1:1, from shots/stack-*.png — not a computed number)');
{
  const eye = (kind, p, opts, saw) => {
    const r = pick(kind, 704, p, opts);
    const says = kind === 'city' ? 'halo ' + skyVerdict(r) : 'RMSE ' + r.rmse.toFixed(2);
    return [`${kind} 704 ${p}col${opts.dither ? '+FS' : ''}`, kb(r.bytes), says, saw];
  };
  table(['candidate', 'PNG', 'metric says', 'the eye says'], [-22, -8, -14, -44], [
    eye('city', 256, {}, 'indistinguishable from the source'),
    eye('city', 128, {}, 'FAINT RING round the moon. metric missed it'),
    eye('city', 64, {}, 'obvious contour rings round the moon'),
    eye('city', 32, {}, 'rings plus blotching in the open sky'),
    eye('city', 128, { dither: true }, 'ring gone, speckle on the moon face. worse'),
    null,
    eye('car', 64, {}, 'indistinguishable at 1:1 AND at 4x'),
    eye('car', 32, {}, 'same at 1:1, stripe posterises at 4x'),
    eye('car', 16, {}, 'bonnet shading flattens, stripe goes brown'),
  ]);
}
console.log('THE METRIC AND THE EYE DISAGREE at city 128, and the eye wins — that is the house rule and');
console.log('it was right again here. What the halo metric measures is the biggest step between');
console.log('neighbouring radii, and 128 keeps that small while still putting the steps it does have in');
console.log('one continuous ring, which is exactly the shape the eye is best at finding. Treat "smooth"');
console.log('from this metric as necessary and not sufficient.');

// -- what the choice costs --------------------------------------------------
const bundlePath = join(ROOT, 'docs/index.html');
const bundle = existsSync(bundlePath) ? readFileSync(bundlePath) : Buffer.alloc(0);
const gzNow = gzipSync(bundle, { level: 9 }).length;
S.bundle = { now: bundle.length, nowGz: gzNow, thenGz: gzNow };

// THE COST IS THE MINIFIED COST, not the size of the file on disk. The build
// runs everything through esbuild, which throws the header comment away and
// keeps the two string literals, so appending the raw module to the bundle
// overstates it by the length of the prose. Bundle the module for real and
// measure that.
async function minifiedCost(text) {
  const probe = join(SHOTS, '.probe-menu.js');
  writeFileSync(probe, text + '\nglobalThis.__menuart = [CAR_PNG, CITY_PNG];\n');
  const { build: esbuild } = await import('esbuild');
  const out = await esbuild({ entryPoints: [probe], bundle: true, format: 'iife', minify: true, target: ['es2020'], write: false, legalComments: 'none' });
  return Buffer.from(out.outputFiles[0].text);
}

// FIXED POINT. The header quotes the gzipped size of the bundle WITH this
// module in it, and the module's own text is part of what is being measured —
// so render, measure, re-render until the quoted string stops moving. Because
// minification drops the header, it settles on the first pass; the loop is
// here so that stays true rather than being assumed.
let moduleText = renderModule(car, city, S);
let minified = await minifiedCost(moduleText);
let settled = false;
for (let i = 0; i < 6; i++) {
  const gz = gzipSync(Buffer.concat([bundle, minified]), { level: 9 }).length;
  const before = kb(S.bundle.thenGz);
  S.bundle.thenGz = gz;
  const next = renderModule(car, city, S);
  if (before === kb(gz) && next === moduleText) { settled = true; break; }
  moduleText = next;
  minified = await minifiedCost(moduleText);
}
if (!settled) { console.log('\nBUNDLE SIZE DID NOT SETTLE — the header would quote a stale number. Stopping.'); process.exit(1); }
const addedRaw = Buffer.byteLength(moduleText);
const addedMin = minified.length;
const gzThen = S.bundle.thenGz;

console.log('\n\nWHAT THIS COSTS THE BUNDLE');
table(['item', 'PNG', 'base64', 'note'], [-22, -9, -9, -34], [
  [`car ${car.w}x${car.h} ${car.ncol}col`, kb(car.buf.length), kb(car.b64.length), `${car.bitDepth}-bit indexed + tRNS`],
  [`city ${city.w}x${city.h} ${city.ncol}col`, kb(city.buf.length), kb(city.b64.length), `${city.bitDepth}-bit indexed, opaque`],
  null,
  ['src/art/menu.js on disk', '', kb(addedRaw), 'including the header comment'],
  ['…after esbuild', '', kb(addedMin), 'comment stripped, strings kept — the real cost'],
]);
console.log('');
table(['bundle', 'raw', 'gzipped', 'note'], [-22, -10, -10, -30], [
  ['docs/index.html today', kb(bundle.length), kb(gzNow), ''],
  ['with menu.js', kb(bundle.length + addedMin), kb(gzThen), `+${kb(addedMin)} raw, +${kb(gzThen - gzNow)} over the wire`],
]);
console.log(`\nbase64 costs ${((car.b64.length + city.b64.length) / (car.buf.length + city.buf.length) - 1) * 100 | 0}% over the raw PNG, as it must (4 chars per 3 bytes),`);
console.log('and gzip cannot win it back: the payload is already-deflated PNG data, so the transfer');
console.log(`cost is essentially the base64 length. Pages are served gzipped; ${kb(gzThen - gzNow)} is the real download.`);

// -- shots ------------------------------------------------------------------
console.log('\n\nSHOTS (look at these; the numbers above are not a substitute)');
writePNGFile(join(SHOTS, 'menu-car.png'), car.img);
writePNGFile(join(SHOTS, 'menu-city.png'), city.img);
writeFileSync(join(SHOTS, 'menu-car-exact.png'), car.buf);
writeFileSync(join(SHOTS, 'menu-city-exact.png'), city.buf);

function sideBySide(src, chosen, name, crops) {
  const back = chosen.w === src.w ? chosen.img : resample(chosen.img, src.w, src.h, 'catmullrom');
  const GAP = 8;
  const detailH = crops.length ? Math.max(...crops.map((c) => c.h * c.z)) : 0;
  const W = src.w * 2 + GAP;
  const H = src.h + (detailH ? GAP + detailH : 0);
  const sheet = blank(W, H, [24, 24, 28, 255]);
  paste(sheet, compositeOver(src, blank(src.w, src.h, [24, 24, 28, 255])), 0, 0);
  paste(sheet, compositeOver(back, blank(src.w, src.h, [24, 24, 28, 255])), src.w + GAP, 0);
  let x = 0;
  for (const c of crops) {
    const a = magnify(crop(src, c.x, c.y, c.w, c.h), c.z);
    const b = magnify(crop(back, c.x, c.y, c.w, c.h), c.z);
    paste(sheet, compositeOver(a, blank(a.w, a.h, [24, 24, 28, 255])), x, src.h + GAP);
    paste(sheet, compositeOver(b, blank(b.w, b.h, [24, 24, 28, 255])), x + a.w + 2, src.h + GAP);
    x += a.w * 2 + 2 + GAP;
  }
  writePNGFile(join(SHOTS, name), sheet);
  console.log(`  shots/${name}  (source left, chosen right, ${sheet.w}x${sheet.h})`);
}

sideBySide(carSrc, car, 'cmp-car.png', [
  { x: 10, y: 130, w: 120, h: 60, z: 3 },     // headlights + grille, finest ink
  { x: 300, y: 190, w: 120, h: 60, z: 3 },    // front wheel + spokes
]);
sideBySide(citySrc, city, 'cmp-city.png', [
  { x: strip.x0 - 40, y: 0, w: 120, h: 60, z: 3 },   // sky gradient, where banding lives
  { x: 430, y: 20, w: 120, h: 60, z: 3 },            // tower window grid
  { x: 230, y: 15, w: 120, h: 60, z: 3 },            // the moon
]);

// PALETTE LADDER. The tables say where the error is; this says whether you can
// see it. One patch of the image, magnified, source first and then each
// palette in turn — the only honest way to pick the knee of the curve.
function ladder(kind, src, region, palettes, name, z = 4) {
  const cols = [['src', src], ...palettes.map((p) => [String(p), pick(kind, 704, p).img])];
  const GAP = 6;
  const tiles = cols.map(([lbl, im]) => magnify(crop(im, region.x, region.y, region.w, region.h), z));
  const sheet = blank(tiles.reduce((a, t) => a + t.w + GAP, -GAP), tiles[0].h, [24, 24, 28, 255]);
  let x = 0;
  for (const t of tiles) { paste(sheet, compositeOver(t, blank(t.w, t.h, [24, 24, 28, 255])), x, 0); x += t.w + GAP; }
  writePNGFile(join(SHOTS, name), sheet);
  console.log(`  shots/${name}  (${z}x, in order: ${cols.map(([l]) => l).join(' | ')})`);
}
ladder('city', citySrc, { x: strip.x0 - 50, y: 8, w: 110, h: 130 }, [256, 128, 64, 32], 'ladder-city-sky.png', 3);
ladder('city', citySrc, { x: moon.x - 55, y: Math.max(0, moon.y - 40), w: 130, h: 90 }, [256, 128, 64, 32], 'ladder-city-moon.png', 3);
ladder('city', citySrc, { x: 430, y: 20, w: 110, h: 70 }, [256, 128, 64, 32], 'ladder-city-windows.png', 4);
ladder('car', carSrc, { x: 500, y: 55, w: 110, h: 70 }, [128, 64, 32, 16], 'ladder-car-body.png', 4);
ladder('car', carSrc, { x: 30, y: 140, w: 110, h: 70 }, [128, 64, 32, 16], 'ladder-car-grille.png', 4);

// AND THE SAME THING AT 1:1, STACKED. A 4x magnifier finds differences the eye
// will never meet; the page shows these pixels at between 0.7x and 1.3x at
// DPR 1. Stacking full-width bands one above another at 1:1 is the closest
// thing to the real test that can be done without the page.
function stack1to1(kind, src, x0, y0, w, h, palettes, name) {
  const imgs = [['source', src], ...palettes.map((p) => [String(p) + 'col', pick(kind, 704, p).img])];
  const GAP = 4;
  const sheet = blank(w, imgs.length * (h + GAP) - GAP, [255, 0, 0, 255]);
  imgs.forEach(([lbl, im], i) => paste(sheet, compositeOver(crop(im, x0, y0, w, h), blank(w, h, [24, 24, 28, 255])), 0, i * (h + GAP)));
  writePNGFile(join(SHOTS, name), sheet);
  console.log(`  shots/${name}  (1:1, top to bottom: ${imgs.map(([l]) => l).join(', ')})`);
}
stack1to1('city', citySrc, 0, 0, citySrc.w, 120, [256, 128, 64, 32], 'stack-city-sky.png');
stack1to1('city', citySrc, moon.x - 90, 0, 200, 110, [256, 128, 64, 32], 'stack-city-moon.png');
{
  // the same crop, but comparing the CHEAP-WITH-DITHER options against the
  // expensive clean one. This is the 50K question for the bundle.
  const set = [['source', citySrc], ['256col', pick('city', 704, 256).img],
    ['128+FS', pick('city', 704, 128, { dither: true }).img],
    ['64+FS', pick('city', 704, 64, { dither: true }).img],
    ['32+FS', pick('city', 704, 32, { dither: true }).img]];
  const w = 200, h = 110, GAP = 4;
  const sheet = blank(w, set.length * (h + GAP) - GAP, [255, 0, 0, 255]);
  set.forEach(([l, im], i) => paste(sheet, crop(im, moon.x - 90, 0, w, h), 0, i * (h + GAP)));
  writePNGFile(join(SHOTS, 'stack-city-moon-dither.png'), sheet);
  console.log(`  shots/stack-city-moon-dither.png  (1:1, top to bottom: ${set.map(([l]) => l).join(', ')})`);
}
stack1to1('car', carSrc, 0, 40, carSrc.w, 110, [128, 64, 32, 16], 'stack-car-body.png');

{
  // the actual page, roughly: city cover-cropped to 932x430, car at half width
  const VW = 932, VH = 430;
  const s = Math.max(VW / citySrc.w, VH / citySrc.h);
  const bg = resample(citySrc, Math.round(citySrc.w * s), Math.round(citySrc.h * s), 'lanczos3');
  const page = crop(bg, Math.round((bg.w - VW) / 2), Math.round((bg.h - VH) / 2), VW, VH);
  const cw = Math.round(VW * 0.5), ch = Math.round((cw / car.w) * car.h);
  const carScaled = resample(car.img, cw, ch, 'catmullrom');
  const over = crop(page, Math.round(VW * 0.42), VH - ch - 24, cw, ch);
  paste(page, compositeOver(carScaled, over), Math.round(VW * 0.42), VH - ch - 24);
  writePNGFile(join(SHOTS, 'menu-mock.png'), page);
  console.log(`  shots/menu-mock.png  (932x430 at DPR 1 — city cover-cropped, car at half width; NOT the real layout, just the chosen pixels at the size they will be seen)`);
}
console.log('  shots/menu-car.png, shots/menu-city.png  (the chosen images, 1:1)');
console.log('  shots/menu-car-exact.png, shots/menu-city-exact.png  (the exact bytes that go in the module)');
console.log('  shots/negative-car-8col.png, shots/negative-city-8col.png  (the control, for comparison)');

// ===========================================================================
function renderModule(car, city, S) {
  const carB64 = car.b64, cityB64 = city.b64;
  const { chosen: CHOSEN, true: TRUE, half: HALF, down512: DOWN512, dither: DITH, sky: SKY, webp: WEBP, bundle: BUNDLE } = S;
  return `// LANDING PAGE ART: the car and the cityscape, as base64 data URLs.
//
// Same deal as svu.js — inlined rather than fetched, because the one-file rule
// means there are no external requests of any kind. These two are the largest
// single things in the bundle, so the sizes below were measured rather than
// guessed: tools/menuart.mjs prints the whole sweep and writes the chosen
// images into shots/ to be looked at. Re-run it with --emit to regenerate this
// file.
//
// BOTH ARE KEPT AT THE FULL 704px OF THE SOURCE. That looks like the lazy
// choice and it is not: the page is up to 932 CSS px wide at device pixel
// ratios up to 3, so the browser is UPSCALING these to as much as 2796px
// already. There is no headroom to give away. Downscaling to 512 costs ${DOWN512.city.rmse.toFixed(1)} RMSE
// on the city and ${DOWN512.car.rmse.toFixed(1)} on the car against the source, ${DOWN512.city.pctOver8.toFixed(0)}% and ${DOWN512.car.pctOver8.toFixed(0)}% of pixels
// off by more than 8/255 — the ink lines and the window grids go soft, and it
// is visible at 1:1 in shots/cmp-*.png. It would have saved ${kb(DOWN512.saving)}.
//
// PALETTES ARE INDEXED PNG, chosen per image because the two images cost their
// bytes in completely different places:
//
//   CAR — ${car.ncol} colours, ${car.bitDepth}-bit indexed, ${kb(car.buf.length)} PNG / ${kb(carB64.length)} base64.
//   Flat comic fills and hard ink lines quantise almost for free. At ${car.ncol}
//   colours it is RMSE ${CHOSEN.car.rmse.toFixed(2)} composited over the city, and at 4x magnification
//   in shots/ladder-car-body.png it cannot be told from the source; ${HALF.car.req} colours
//   (${kb(HALF.car.bytes)}, RMSE ${HALF.car.rmse.toFixed(2)}) is where the purple stripe starts to posterise and 16
//   flattens the shading on the bonnet outright. Truecolour RGBA at this size
//   is ${kb(TRUE.car.bytes)}, ${(TRUE.car.bytes / car.buf.length).toFixed(1)}x, for a difference nobody can see. The soft ink
//   edge survives as a tRNS chunk rather than a 1-bit cutout — alpha RMSE
//   ${CHOSEN.car.aRMSE.toFixed(2)} — which matters because the car is composited over the city
//   rather than over a colour we know in advance.
//
//   CITY — ${city.ncol} colours, ${city.bitDepth}-bit indexed, ${kb(city.buf.length)} PNG / ${kb(cityB64.length)} base64. It costs
//   ${(city.buf.length / car.buf.length).toFixed(1)}x the car and it gets ${city.ncol} where the car gets ${car.ncol}, for one reason:
//   THE GLOW AROUND THE MOON. Every other part of this picture is ink and flat
//   fill and quantises like the car does. The moon's halo is a soft ${SKY.src.halo.span.toFixed(0)}-luma
//   ramp about 45px wide, and a palette that cannot afford it turns it into
//   contour rings. Measured along that ring, the source steps by at most
//   ${SKY.src.halo.maxStep.toFixed(2)} luma between neighbouring radii; ${HALF.city.req} colours steps by ${SKY.half.maxStep.toFixed(2)} and
//   ${city.ncol} by ${SKY.chosen.maxStep.toFixed(2)}. Those two numbers are close and the ${HALF.city.req}-colour one is
//   ${kb(city.buf.length - HALF.city.bytes)} cheaper, so this was decided by LOOKING, at 1:1, in
//   shots/stack-city-moon.png: at ${HALF.city.req} there is a faint ring, at ${city.ncol} there is not.
//   Dithering was the obvious cheaper answer and it is not one — it removes
//   the ring but lays visible speckle over the moon's face, ${kb(DITH.bytes)} for a
//   worse-looking picture than ${city.ncol} flat (shots/stack-city-moon-dither.png).
//
// NOT WEBP, and it is a smaller win than people expect: lossless WebP of these
// exact quantised pixels is ${WEBP.ratio} the PNG, not half. Lossy WebP of the source
// would be far smaller (${WEBP.lossy} for the city) but the local encoder ignores its
// quality setting so that number is not one to plan against. Either way this
// module exports ONE url per image, and a data URL carries no fallback the way
// <picture> does, so an unsupported format here is a blank landing page rather
// than a heavy one — and the two devices named as targets, an old Android and
// iOS Safari, are precisely the two places WebP can be missing (Safari only
// got it in iOS 14). PNG never fails.
//
// Together ${kb(carB64.length + cityB64.length)} of base64 on a ${kb(BUNDLE.now)} bundle, which is the uncomfortable
// part of this and is worth stating plainly rather than burying: base64 costs
// a third over the raw PNG and gzip cannot claw it back, because the payload
// is already deflate-compressed. Over the wire the page goes from ${kb(BUNDLE.nowGz)}
// gzipped to ${kb(BUNDLE.thenGz)}. If that ever turns out to be too much, the cheapest
// real saving is the city at ${HALF.city.req} colours for ${kb(HALF.city.b64 - CHOSEN.city.b64).replace('-', '')} less, and the cost of
// it is a faint ring around the moon.
//
// The cityscape is the page background at background-size: cover and will be
// cropped; the car sits over it, so its alpha is load-bearing. Neither is a
// texture — do not feed them to three.js expecting power-of-two.
export const CAR_PNG = 'data:image/png;base64,${carB64}';

export const CITY_PNG = 'data:image/png;base64,${cityB64}';
`;
}

if (EMIT) {
  const text = moduleText;
  const path = join(ROOT, 'src/art/menu.js');
  writeFileSync(path, text);
  console.log(`\n\nWROTE src/art/menu.js  ${kb(Buffer.byteLength(text))}`);
  // read it back and decode, so "it exports two working data URLs" is a fact
  const { CAR_PNG, CITY_PNG } = await import(path + '?t=' + Date.now());
  for (const [n, url, want] of [['CAR_PNG', CAR_PNG, car], ['CITY_PNG', CITY_PNG, city]]) {
    if (!url.startsWith('data:image/png;base64,')) throw new Error(`${n} is not a png data url`);
    const dec = PNG.sync.read(Buffer.from(url.slice('data:image/png;base64,'.length), 'base64'));
    const okDim = dec.width === want.w && dec.height === want.h;
    let okPix = true;
    for (let i = 0; i < dec.data.length && okPix; i++) if (dec.data[i] !== want.img.d[i]) okPix = false;
    console.log(`  ${okDim && okPix ? 'ok  ' : 'FAIL'}  ${n} decodes to ${dec.width}x${dec.height}, ${okPix ? 'pixel-identical to the chosen image' : 'PIXELS DIFFER'}`);
    if (!okDim || !okPix) process.exit(1);
  }
} else {
  console.log('\n(run with --emit to write src/art/menu.js)');
}
