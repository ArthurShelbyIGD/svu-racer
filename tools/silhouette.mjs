// Does the car actually look like the reference? As a number.
//
// WHY THIS EXISTS. Anthony, on the current car: "The car is in no way detailed
// yet, it doesn't even come close to the generated images I sent over... Right
// now they would say definitely not, that's for sure." He is right, and the
// second half is the important half — an agent asked "does this resemble the
// reference?" will answer yes, because it has just spent an hour building it.
// Resemblance has to be measured or it will be asserted.
//
// WHAT IT MEASURES. The silhouette, and only the silhouette. Not colour, not
// ink, not detail — those already have their own instruments. Silhouette is the
// right thing to grade first because it is what makes our car read as 1980s: a
// muscle car's whole character is in its curves, ours is axis-aligned cuboids,
// and no amount of paint fixes an outline made of right angles.
//
// HOW. Photograph our car from the same angle as the reference drawing, cut
// both out of their backgrounds, scale each to the same box, and compute
// intersection-over-union: the area they share divided by the area they cover
// between them. Two identical shapes score 1.0. Scaling to a common box first
// is what makes it a shape comparison rather than a size comparison — the same
// trick that overturned a wrong conclusion about the character's proportions on
// the previous project, where a reference and a capture were only comparable
// once both were normalised to the same figure height.
//
//   node tools/silhouette.mjs
//
// The angles below were matched to the references by eye and then refined by
// searching for the best-scoring pose, so the score reports shape difference
// rather than a mismatch in where the camera was standing.

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
// THE HARNESS MUST MEASURE THE BUILD NEXT TO IT, not a fixed path. These tools
// hard-coded /root/racer, so an agent working in a git worktree would have
// photographed master's car and graded its own work by someone else's frame.
const __ROOT = __d(__d(__f(import.meta.url)));
const PAGE = 'file://' + __j(__ROOT, 'docs', 'index.html');
const SHOTS = __j(__ROOT, 'shots');


// THE CEILING IS PER-REFERENCE, because the drawings do not all award the same
// maximum. A cast shadow is pure black and this mask cannot tell it from an ink
// line, so a car with no shadow can never score 100 against a drawing that has
// one: 82.4% and 84.5% are the measured limits on the two originals. The flat
// 85% bar this file used to print was unreachable by construction on both, and
// it was mine.
//
// Anthony then supplied the same car with the background removed. No shadow,
// real alpha, so the mask is the car and nothing else and the ceiling is 100%.
// It is the only reference here whose score means what it appears to mean,
// which makes it the one to optimise against.
//
// ---------------------------------------------------------------------------
// TWO OF THE ANGLES BELOW WERE WRONG, AND THEY WERE WRONG IN A WAY THIS FILE
// PREDICTS. The header says they were "refined by searching for the best-scoring
// pose" — and the pose they were fitted to was the box car, which the cut-out
// then proved was sixty percent too wide for its height. Fit a camera to the
// wrong car and you get the wrong camera; correct the car and the camera is
// still wrong, and it is the car that gets blamed.
//
// Measured on the lofted body, all else equal:
//
//     rear three-quarter   at el 0.30   74.0%   aspect 1.66
//                          at el 0.16   84.0%   aspect 2.42
//     front three-quarter  at el 0.26   75.8%   aspect 1.68
//                          at el 0.16   84.2%   aspect 2.36
//
// Ten points of score and forty percent of aspect, from the camera alone. A
// scan of elevation at fixed azimuth, half the run of this file, peaks at 0.13
// and 0.10:
//
//     rear 3/4    el 0.10  83.1    0.13  84.3    0.16  82.7    0.19  80.7
//     front 3/4   el 0.10  84.9    0.13  84.5    0.16  82.5    0.19  81.4
//
// and those are the values used. They agree with the drawings independently:
// the aspect of the car drawn in each — measured with its cast shadow left out,
// see carAspect — is 2.44 and 2.48, and at el 0.13 and 0.11 our car projects
// 2.3 and 2.4 while at el 0.30 it projects 1.66. The elevation that makes the
// score right is the elevation that makes the proportion right, which is what
// a correctly placed camera looks like.
//
// The distance ladder moves out with them. At ten units an 8.2-unit car is
// photographed with a wider lens than any of these three drawings uses — the
// near end comes out nearly twice the size of the far end — and perspective
// distortion is not shape, which is the one thing this file exists to measure.
const REFS = [
  // az/el in radians; az 0 looks at the car's tail, positive swings to its left
  { name: 'rear, no background', file: 'ref/rear-nobg-crop.png', az: 0.00, el: 0.10, ceiling: 1.000 },
  { name: 'rear three-quarter', file: 'ref/camaro-rear34.png', az: 0.58, el: 0.13, ceiling: 0.824 },
  { name: 'front three-quarter', file: 'ref/camaro-plain.png', az: 3.68, el: 0.11, ceiling: 0.845 },
];

/** How far the camera stands off, in world units. */
const DISTANCES = [11, 14, 17];

/** Cut the drawing out of its white background. */
function refMask(path) {
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
function carAspect(path, mask, w, h) {
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
function normalise(mask, w, h, N = 128) {
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

function iou(a, b, N = 128) {
  let inter = 0, union = 0;
  for (let i = 0; i < N * N; i++) {
    const p = a[i], q = b[i];
    if (p | q) union++;
    if (p & q) inter++;
  }
  return union ? inter / union : 0;
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForTimeout(2000);
await page.evaluate(() => {
  for (const id of ['hud', 'note', 'ctl']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
});

/** Photograph our car and return its silhouette mask. */
async function ourMask(az, el, dist) {
  return await page.evaluate(async ({ az, el, dist }) => {
    const R = window.RACER;
    const gl = R.renderer.getContext();
    const w = R.renderer.domElement.width, h = R.renderer.domElement.height;
    const A = new Uint8Array(w * h * 4), B = new Uint8Array(w * h * 4);
    const f = () => new Promise((r) => requestAnimationFrame(() => r()));
    R.tune.freeze = true; R.st.speed = 0; R.st.steer = 0; R.st.slope = 0;
    R.tune.studio = { az, el, dist };
    await f(); await f();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, A);
    R.tune.showBody = false;
    await f(); await f();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, B);
    R.tune.showBody = true; R.tune.studio = null;
    await f();
    // The car is whatever changed. Rows come back bottom-up from readPixels.
    //
    // THE THRESHOLD IS 2, AND IT USED TO BE 16, AND 16 WAS EATING THE CAR. Both
    // passes are the same deterministic render of a frozen scene, so every
    // pixel the car does not touch comes back BIT IDENTICAL — measured, by
    // tallying the pixels the two passes agree on: the background pairs are
    // exact, 44,56,76 against 44,56,76, not approximate. There is no noise here
    // for a tolerance to absorb.
    //
    // What 16 did absorb was 185 pixels of car: the near-black tail panel
    // (15,15,21) and part of the ink outline standing against the scene's own
    // near-black ground (12,14,22), a difference of three to five. On a car of
    // thirteen thousand pixels that is 1.4 points of IoU, taken off the darkest
    // and most heavily inked part of the drawing — the part the reference is
    // most emphatic about.
    const m = new Array(w * h).fill(0);
    for (let i = 0, p = 0; i < A.length; i += 4, p++) {
      const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
      if (d > 2) {
        const x = p % w, y = (p / w) | 0;
        m[(h - 1 - y) * w + x] = 1;
      }
    }
    return { m, w, h };
  }, { az, el, dist });
}

console.log('\nSILHOUETTE MATCH — our car against the reference drawings');
console.log('Both cut out and scaled to the same box, so this is shape, not size.\n');

let worst = 1;
let worstRel = 1;
let aspectFail = false;
for (const r of REFS) {
  const ref = refMask(r.file);
  const rn = normalise(ref.m, ref.w, ref.h);
  // A CUT-OUT HAS NOTHING TO SEPARATE. Its alpha already excludes everything
  // that is not car, so its mask aspect IS the drawn car's; running the
  // saturation filter over it would throw away the tyres and the glass, which
  // are grey, and report a car 15% narrower than the one in the file.
  // THE ASPECT GUARD RUNS ONLY ON THE CUT-OUT, and that is a retreat from a
  // measurement that cannot be made honestly. On the two shadowed drawings the
  // question "where does the tyre end and the shadow begin" has no clean
  // answer. A saturation filter puts the boundary at row 457 — but the tyres
  // are black and unsaturated, so it throws them away with the shadow and
  // reports the car 8% flatter than it is. Counting horizontal spans (tyres
  // are two blobs, a shadow is one) puts it at 487. Luminance cannot separate
  // them at all: every row from 462 to 522 has a mean under 16, so the shadow
  // in this drawing is hard black, not the pale grey smear an older comment
  // in this file assumed.
  //
  // Thirty rows of a 420-row car is 7% of its height, against a guard that
  // trips at 8%. A number that depends that heavily on an arbitrary choice
  // must not be a pass/fail condition. The cut-out has real alpha and no
  // shadow, so its aspect is exact and needs no judgement — and being a
  // dead-on rear it is the view that exposes width-against-height best, which
  // is this guard's entire job. The other two still contribute their IoU;
  // their aspect is printed for information and marked shadow-inflated.
  const refAspect = ref.hasAlpha ? rn.aspect : null;
  // Search a small neighbourhood of the nominal pose, so the score reports a
  // difference in SHAPE rather than a difference in where the camera stood.
  let best = { score: -1 };
  // Coarse: this runs under a software renderer, and 45 poses per reference
  // takes longer than the measurement is worth. Nine is enough to stop a small
  // camera mismatch masquerading as a shape difference.
  for (const daz of [-0.10, 0, 0.10]) {
    for (const del of [0]) {
      for (const dist of DISTANCES) {
        const o = await ourMask(r.az + daz, r.el + del, dist);
        const on = normalise(Uint8Array.from(o.m), o.w, o.h);
        const s = iou(rn.out, on.out);
        if (s > best.score) best = { score: s, daz, del, dist, aspect: on.aspect };
      }
    }
  }
  worst = Math.min(worst, best.score);
  const rel = best.score / r.ceiling;
  worstRel = Math.min(worstRel, rel);
  const verdict = rel >= 0.98 ? 'AT THE CEILING' : rel >= 0.93 ? 'CLOSE'
                : rel >= 0.86 ? 'FAIR' : 'POOR';
  // ASPECT IS THE GUARD IoU CANNOT PROVIDE. Normalising both masks into the
  // same box throws size away on purpose, so it makes a car a third too tall
  // score BETTER, not worse — a coordinate search over the section table duly
  // found five extra points by building a van. The shape number alone will
  // always reward that; the aspect line is the only thing that catches it.
  //
  // The reference's aspect here is the DRAWN CAR's, not the mask's — see
  // carAspect. Those differ on the two drawings that have a cast shadow, by
  // fifteen and nineteen percent, all of it height the car does not have.
  const drift = refAspect === null ? null : Math.abs(best.aspect - refAspect) / refAspect;
  console.log(`  ${r.name.padEnd(22)} ${(100 * best.score).toFixed(1)}%   ${verdict}` +
              `   (ceiling ${(100 * r.ceiling).toFixed(1)}%, ${(100 * rel).toFixed(0)}% of it)`);
  if (drift === null) {
    console.log(`  ${''.padEnd(22)} aspect ours ${best.aspect.toFixed(2)}` +
                `  (drawing's ${rn.aspect.toFixed(2)} includes its cast shadow — not graded)`);
  } else {
    console.log(`  ${''.padEnd(22)} aspect ref ${refAspect.toFixed(2)} ours ${best.aspect.toFixed(2)}` +
                `  ${drift > 0.08 ? `<-- ${(100 * drift).toFixed(0)}% OFF, THE SHAPE IS CHEATING` : 'ok'}`);
    if (drift > 0.08) aspectFail = true;
  }
}

console.log('\n  Scored against each drawing\'s own measured ceiling, not against 100.');
console.log(`  worst view: ${(100 * worst).toFixed(1)}%, ${(100 * worstRel).toFixed(0)}% of its ceiling`);
if (aspectFail) console.log('  ASPECT DRIFT: the score is being bought with proportion, not shape.');
await browser.close();
process.exit(worstRel >= 0.93 && !aspectFail ? 0 : 1);
