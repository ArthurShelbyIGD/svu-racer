// THE MASK MATHS, SHARED — because two tools that measure the same car must
// measure it the same way.
//
// tools/silhouette.mjs scores the car and tools/faultmap.mjs says WHERE the
// score is being lost. If those two cut the car out of its background by even
// slightly different rules, the picture explains a number that was never
// computed, and the explanation is worse than no explanation: it looks like
// evidence. So the cutting, the scaling and the IoU live here and both import
// them.
//
// Everything below was lifted verbatim out of silhouette.mjs, comments and all,
// where it had already been argued into shape three times.

import { existsSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

/** Cut the drawing out of its white background. */
export function refMask(path) {
  // A MISSING REFERENCE IS A SKIP, NOT A CRASH. This file died mid-run on a
  // stale path and took the scores that came after it with it, which is a
  // worse failure than reporting nothing: it looked like a completed run.
  if (!existsSync(path)) return null;
  const png = PNG.sync.read(readFileSync(path));
  const { width: w, height: h, data } = png;
  const m = new Uint8Array(w * h);
  // ALPHA WINS WHERE THERE IS ALPHA. A cut-out PNG stores fully transparent
  // pixels as rgba(0,0,0,0), and rgb 0,0,0 is the darkest thing there is — so
  // reading colour alone would have marked the entire empty canvas as car and
  // scored a perfect match against a rectangle. Detected rather than assumed:
  // if any pixel is transparent, the file is a cut-out and alpha is the mask.
  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) { hasAlpha = true; break; }
  if (hasAlpha) {
    for (let i = 3, p = 0; i < data.length; i += 4, p++) m[p] = data[i] > 128 ? 1 : 0;
    return { m, w, h, hasAlpha };
  }
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Anything meaningfully darker than paper. The references are line art on
    // white, so this is unambiguous — but exclude the drop shadow, which is a
    // pale grey smear under the car and is not part of its shape.
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = (r + g + b) / 3;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    m[p] = (lum < 215 && (lum < 150 || sat > 18)) ? 1 : 0;
  }
  return { m, w, h, hasAlpha };
}

/**
 * THE ASPECT OF THE DRAWN CAR, WITH ITS CAST SHADOW LEFT OUT.
 *
 * The mask above keeps the shadow on purpose — it is black, the IoU cannot tell
 * it from ink, and the per-reference ceiling is exactly the price of that. But
 * the ASPECT line is a different question. It asks whether our car is the same
 * proportion as the drawn car, and a shadow is not part of the drawn car:
 *
 *     camaro-rear34   mask bbox 878 x 423  aspect 2.08
 *                     car only  864 x 354  aspect 2.44   (65 rows are shadow)
 *     camaro-plain    mask bbox 868 x 407  aspect 2.13
 *                     car only  854 x 345  aspect 2.48   (62 rows are shadow)
 *
 * So the guard was demanding that our shadowless car be fifteen to nineteen
 * percent squatter than the drawing it is copying. A pixel-perfect replica
 * would have been reported at seventeen percent drift and called a cheat, and
 * the box car passed this line at 6.7% while being sixty percent too wide —
 * the check has never once caught what it is for.
 *
 * The shadow is separated the way the drawing separates it: it is grey and the
 * car is coloured. The cut-out has no shadow and real alpha, so nothing changes
 * there and it remains the reference that means what it says.
 */
export function carAspect(path, mask, w, h) {
  const png = PNG.sync.read(readFileSync(path));
  const { data } = png;
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  let any = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!mask[y * w + x]) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) <= 30) continue;   // grey: shadow
      any = true;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return any ? (x1 - x0 + 1) / (y1 - y0 + 1) : null;
}

/** Scale a mask into a fixed box, keeping only its bounding content. */
export function normalise(mask, w, h, N = 128) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  // Column and row histograms, so a few stray pixels cannot define the box.
  const col = new Int32Array(w), row = new Int32Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { col[x]++; row[y]++; }
  const span = (hist, n, floor) => {
    let a = 0, b = n - 1;
    while (a < n && hist[a] < floor) a++;
    while (b > a && hist[b] < floor) b--;
    return [a, b];
  };
  [x0, x1] = span(col, w, 3);
  [y0, y1] = span(row, h, 3);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const out = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) {
    const sy = y0 + Math.floor((y + 0.5) * bh / N);
    for (let x = 0; x < N; x++) {
      const sx = x0 + Math.floor((x + 0.5) * bw / N);
      out[y * N + x] = mask[sy * w + sx];
    }
  }
  return { out, aspect: bw / bh };
}

/** A normalised mask, left-right reversed. The mirror guard's whole apparatus. */
export function mirror(a, N = 128) {
  const out = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[y * N + x] = a[y * N + (N - 1 - x)];
  return out;
}

export function iou(a, b, N = 128) {
  let inter = 0, union = 0;
  for (let i = 0; i < N * N; i++) {
    const p = a[i], q = b[i];
    if (p | q) union++;
    if (p & q) inter++;
  }
  return union ? inter / union : 0;
}
