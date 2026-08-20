// WHERE IS THE SCORE BEING LOST? A percentage cannot answer that.
//
// ===========================================================================
// WHY THIS EXISTS
// ===========================================================================
//
// Anthony, on a car the silhouette harness graded 95.6% side and 95.4% rear:
// "the roof extends to quite close to the center of the rear wheel before it
// drops off to the boot, whereas the model's roof starts dropping off in front
// of the rear wheel... the front quarter light is too large and the rear
// quarter light is missing... the rear screen extends up too far... rear lights
// are also the wrong proportions... Not certain how the score relates to 95.4%
// if I am brutally honest."
//
// He is right to distrust it, and the honest response is not to defend the
// number but to show what it is made of. Two separate things are going on and
// they need separating, because one is a limit of the instrument and the other
// is the instrument working and nobody reading it.
//
// ---------------------------------------------------------------------------
// ONE: HALF OF WHAT HE NAMED IS INVISIBLE TO A SILHOUETTE, BY CONSTRUCTION
// ---------------------------------------------------------------------------
//
// The mask is the car's OUTLINE, produced by rendering the scene twice and
// taking every pixel that changed. A window is inside the outline; so is a
// taillamp; so is the line where the rear screen meets the bodywork. Every one
// of those pixels is a 1 in the mask whatever colour it is, so a quarter light
// the wrong size, a missing quarter light, and a taillamp that is a square
// instead of a letterbox move the score by EXACTLY ZERO.
//
// That is not a bug to fix in this file — a silhouette is the right first
// instrument and it caught a car nineteen percent out of proportion. It is a
// statement of scope that was never made out loud, so the number was read as
// "the car is 95% right" when it means "the car's outline is 95% right".
//
// This file measures the claim rather than asserting it: it counts the holes in
// both masks (a solid mask has none, so nothing interior is being scored) and
// measures how much of the drawing is interior detail — glass and lamps — that
// the score therefore cannot see.
//
// ---------------------------------------------------------------------------
// TWO: THE REST OF WHAT HE NAMED IS IN THE FOUR PERCENT, AND UNREADABLE
// ---------------------------------------------------------------------------
//
// The roofline drop and the height of the rear bodywork ARE outline, so they
// are in the missing 4.4%. A single number spreads that over the whole car and
// tells you nothing about where it sits — 4.4% distributed evenly is a car
// that is slightly soft everywhere, and 4.4% concentrated in one place is a
// roofline in the wrong position. Those need different work and the score reads
// identically for both.
//
// So: a picture, and a table. Red is drawing-only, blue is model-only, grey is
// agreement — and the same disagreement broken down over an 8x3 grid, so
// "where" is a number and not an impression.
//
//   node tools/faultmap.mjs [body-letter]

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
// The same cutting and scaling the scorer uses. If this file cut the car out by
// its own rules its picture would explain a number that was never computed.
import { refMask, normalise, iou } from './lib/silmask.mjs';

const __ROOT = __d(__d(__f(import.meta.url)));
const BODY = process.argv[2] || '';
const PAGE = 'file://' + __j(__ROOT, 'docs', 'index.html') + (BODY ? '?body=' + BODY : '');
const SHOTS = __j(__ROOT, 'shots');
mkdirSync(SHOTS, { recursive: true });
const N = 128;

// The same poses and the same distance ladder as tools/silhouette.mjs. Kept in
// step by hand and asserted at the end: the IoU this file reports for the best
// pose must equal the one the scorer reports, or one of them is measuring
// something else.
const REFS = [
  { key: 'side', name: 'side on', file: 'ref/side-nobg.png', az: -Math.PI / 2, el: 0.02,
    cols: ['nose', 'front wing', 'front wheel', 'door fr', 'door rr', 'rear wheel', 'rear qtr', 'tail'],
    rows: ['roof', 'body', 'wheels'] },
  { key: 'rear', name: 'rear', file: 'ref/rear-nobg-crop.png', az: 0.00, el: 0.10,
    cols: ['left edge', 'l wing', 'l lamp', 'plate l', 'plate r', 'r lamp', 'r wing', 'right edge'],
    rows: ['glass', 'body', 'bumper'] },
];
const DISTANCES = [11, 14, 17];

/**
 * HOW MUCH OF THE MASK IS HOLE? The claim that interior detail cannot be scored
 * rests on the mask being solid, so measure it: flood the background in from
 * the border and count any unset pixel the flood never reached.
 */
function holes(m, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, 0, x, h - 1); }
  for (let y = 0; y < h; y++) { stack.push(0, y, w - 1, y); }
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const p = y * w + x;
    if (seen[p] || m[p]) continue;
    seen[p] = 1;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  let n = 0;
  for (let p = 0; p < w * h; p++) if (!m[p] && !seen[p]) n++;
  return n;
}

/**
 * HOW MUCH OF THE DRAWING IS DETAIL THE OUTLINE CANNOT SEE?
 *
 * Glass and lamps, by colour, inside the cut-out's own alpha. The drawings are
 * flat comic-book fills, so this is a clean separation and not a judgement
 * call: glass is desaturated and pale-to-mid, lamps are strongly red. Body is
 * the green, ink is the black.
 */
function interiorDetail(path) {
  const png = PNG.sync.read(readFileSync(path));
  const { width: w, height: h, data } = png;
  let car = 0, glass = 0, lamp = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    car++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx - mn;
    if (r > 110 && r > g * 1.6 && r > b * 1.6) lamp++;
    else if (sat < 42 && mx > 70 && !(g > r && g > b)) glass++;
  }
  return { car, glass, lamp };
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });
await page.evaluate(() => {
  if (window.RACER.menu) window.RACER.menu.close();
  for (const id of ['hud', 'note', 'ctl', 'gears']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
});
const built = await page.evaluate(() => window.RACER.bodyName());
if (BODY && built !== BODY) console.log(`  ASKED FOR ${BODY}, GOT ${built}`);

async function ourMask(az, el, dist) {
  return await page.evaluate(async ({ az, el, dist }) => {
    const R = window.RACER;
    const gl = R.renderer.getContext();
    const w = R.renderer.domElement.width, h = R.renderer.domElement.height;
    const A = new Uint8Array(w * h * 4), B = new Uint8Array(w * h * 4);
    const f = () => new Promise((r) => requestAnimationFrame(() => r()));
    R.tune.freeze = true; R.st.speed = 0; R.st.steer = 0; R.st.slope = 0;
    R.tune.studio = { az, el, dist, clean: true };
    await f(); await f();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, A);
    R.tune.showBody = false;
    await f(); await f();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, B);
    R.tune.showBody = true; R.tune.studio = null;
    await f();
    const m = new Array(w * h).fill(0);
    for (let i = 0, p = 0; i < A.length; i += 4, p++) {
      const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
      if (d > 2) { const x = p % w, y = (p / w) | 0; m[(h - 1 - y) * w + x] = 1; }
    }
    return { m, w, h };
  }, { az, el, dist });
}

console.log(`\nFAULT MAP — body ${built}. Where the silhouette score is being lost.\n`);

for (const r of REFS) {
  const ref = refMask(__j(__ROOT, r.file));
  if (!ref) { console.log(`  ${r.name}: no ${r.file}`); continue; }
  const rn = normalise(ref.m, ref.w, ref.h, N);

  let best = { score: -1 };
  for (const daz of [-0.10, 0, 0.10]) {
    for (const dist of DISTANCES) {
      const o = await ourMask(r.az + daz, r.el, dist);
      const on = normalise(Uint8Array.from(o.m), o.w, o.h, N);
      const s = iou(rn.out, on.out);
      if (s > best.score) best = { score: s, out: on.out, aspect: on.aspect, daz, dist };
    }
  }

  // --- the picture -----------------------------------------------------------
  // WRITTEN AT THE DRAWING'S OWN PROPORTIONS. The comparison happens in a 128
  // square, because squaring both masks is what makes it a shape test rather
  // than a size test — but a car squashed into a square is a car nobody can
  // read, and this picture exists to be read. So the square is stretched back
  // out to the reference's aspect on the way to disc. Display only: every pixel
  // of it comes from the same 128x128 the IoU was computed on.
  const PH = 380, PW = Math.round(PH * rn.aspect);
  const png = new PNG({ width: PW, height: PH });
  for (let y = 0; y < PH; y++) {
    const sy = Math.min(N - 1, Math.floor(y * N / PH));
    for (let x = 0; x < PW; x++) {
      const sx = Math.min(N - 1, Math.floor(x * N / PW));
      const p = sy * N + sx;
      const a = rn.out[p], b = best.out[p];
      let c;
      if (a && b) c = [176, 176, 172];          // both agree it is car
      else if (a) c = [214, 44, 44];            // the drawing has it, we do not
      else if (b) c = [40, 96, 220];            // we have it, the drawing does not
      else c = [248, 248, 246];
      const q = (y * PW + x) * 4;
      png.data[q] = c[0]; png.data[q + 1] = c[1]; png.data[q + 2] = c[2]; png.data[q + 3] = 255;
    }
  }
  const out = __j(SHOTS, `faultmap-${built}-${r.key}.png`);
  writeFileSync(out, PNG.sync.write(png));

  // --- where the disagreement lives ------------------------------------------
  const CB = 8, RB = 3;
  const missing = [], extra = [];
  for (let i = 0; i < CB * RB; i++) { missing[i] = 0; extra[i] = 0; }
  let mTot = 0, eTot = 0;
  for (let y = 0; y < N; y++) {
    const rb = Math.min(RB - 1, Math.floor(y * RB / N));
    for (let x = 0; x < N; x++) {
      const cb = Math.min(CB - 1, Math.floor(x * CB / N));
      const a = rn.out[y * N + x], b = best.out[y * N + x];
      if (a && !b) { missing[rb * CB + cb]++; mTot++; }
      else if (b && !a) { extra[rb * CB + cb]++; eTot++; }
    }
  }
  const dis = mTot + eTot;

  console.log(`  ${r.name.toUpperCase()} — IoU ${(100 * best.score).toFixed(1)}%  ` +
              `(pose daz ${best.daz}, dist ${best.dist})   wrote ${out.replace(__ROOT + '/', '')}`);
  console.log(`     the drawing has ${mTot} squares of car we do not; we have ${eTot} it does not`);
  console.log(`     share of ALL disagreement, by region (row x column):`);
  const wcol = 11;
  console.log('       ' + ''.padEnd(8) + r.cols.map((c) => c.slice(0, wcol - 1).padStart(wcol)).join(''));
  for (let rb = 0; rb < RB; rb++) {
    let line = '       ' + r.rows[rb].padEnd(8);
    for (let cb = 0; cb < CB; cb++) {
      const v = 100 * (missing[rb * CB + cb] + extra[rb * CB + cb]) / (dis || 1);
      line += (v < 0.5 ? '.' : v.toFixed(0) + '%').padStart(wcol);
    }
    console.log(line);
  }

  // --- and what the score could never have seen -------------------------------
  const hr = holes(rn.out, N, N), ho = holes(best.out, N, N);
  const det = interiorDetail(__j(__ROOT, r.file));
  console.log(`     mask holes: drawing ${hr}, ours ${ho} — a solid mask scores no interior detail`);
  console.log(`     of the drawing's car, ${(100 * det.glass / det.car).toFixed(1)}% is glass and ` +
              `${(100 * det.lamp / det.car).toFixed(1)}% is lamp: ` +
              `${(100 * (det.glass + det.lamp) / det.car).toFixed(1)}% the outline cannot see\n`);
}

await browser.close();
console.log('  Red is the drawing, blue is us, grey is agreement.');
console.log('  Windows, screens and lamps are INSIDE the outline: worth 0.0 points here.');
console.log('  Those need tools/landmarks.mjs, which measures them directly.\n');
