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
// The cutting, scaling and IoU are shared with tools/faultmap.mjs, so that the
// picture of where the score is lost explains THIS number and not another one.
import { refMask, carAspect, normalise, mirror, iou } from './lib/silmask.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
// THE HARNESS MUST MEASURE THE BUILD NEXT TO IT, not a fixed path. These tools
// hard-coded /root/racer, so an agent working in a git worktree would have
// photographed master's car and graded its own work by someone else's frame.
const __ROOT = __d(__d(__f(import.meta.url)));
// WHICH CANDIDATE TO SCORE. `node tools/silhouette.mjs a` photographs the car
// that src/car/body-a.js builds; with no argument it scores the shipped one.
// Identical conditions for every candidate is the whole point of a rival-cars
// process, so the pose search, the references and the scaling all stay put and
// only the builder changes.
const BODY = process.argv[2] || '';
const PAGE = 'file://' + __j(__ROOT, 'docs', 'index.html') + (BODY ? '?body=' + BODY : '');
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
// THE TABLE WAS POINTING AT TWO FILES THAT NO LONGER EXIST, and the run died
// on the second one — so for weeks this reported a single score and then a
// stack trace, and the single score it did report was the EASIEST view there
// is. A car seen from dead astern is close to a rectangle; ours scores 93%
// against the drawing and that number cannot tell anyone whether the car looks
// like a Camaro.
//
// THE SIDE VIEW IS THE ONE THAT SETTLES IT, and it was never in this list.
// Anthony went and made a clean dead-side-on cut-out specifically because a
// three-quarter view cannot settle proportion — ref/REFERENCE.md says so at
// length and gives the hard number, 3.243 of length to height — and then the
// instrument that grades the car never looked at it.
//
// AND THEN IT LOOKED AT IT FROM THE WRONG SIDE. Three agents, working
// independently on three separate car bodies, each reported the same thing: the
// side score would not go past about 81% however good the body was, because the
// drawing and the render are MIRROR IMAGES of each other. ref/side-nobg.png has
// the nose at screen LEFT; az +PI/2 puts the camera on the car's right flank,
// where the nose comes out at screen RIGHT.
//
// The geometry, so the sign is derived rather than guessed: the car's nose
// points down -Z and the camera sits at (sin az, ., cos az) * dist. At az +PI/2
// the camera is at +X, which is the car's right-hand side, and its screen-right
// axis is -Z — the nose. At az -PI/2 the camera is at -X, screen-right is +Z,
// and the nose falls to screen left, the way the drawing has it.
//
// A near-perfect replica scored against a mirror of itself was capped at 80.9%,
// which this file was calling POOR. That is not a small calibration error: it
// meant every candidate body was being graded on how well it matched a drawing
// of a DIFFERENT car, and the differences it was rewarding were arbitrary. The
// mirror guard below now measures the thing directly and says so out loud, so
// this cannot come back silently if someone flips a sign or a reference.
const REFS = [
  // az/el in radians; az 0 looks at the car's tail, positive swings to its left
  { name: 'side on — the proportion reference', file: 'ref/side-nobg.png',
    az: -Math.PI / 2, el: 0.02, ceiling: 1.000, wide: true },
  { name: 'rear, no background', file: 'ref/rear-nobg-crop.png',
    az: 0.00, el: 0.10, ceiling: 1.000 },
];

/** How far the camera stands off, in world units. */
const DISTANCES = [11, 14, 17];


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
    R.tune.studio = { az, el, dist, clean: true };
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
let mirrorFail = false;
for (const r of REFS) {
  const ref = refMask(r.file);
  if (!ref) {
    console.log(`  ${r.name.padEnd(22)}  SKIPPED — ${r.file} is not there`);
    continue;
  }
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
  // THE MIRROR GUARD. Scored against the drawing AND against the drawing
  // reversed, every pose, at no extra render cost — the expensive part is the
  // photograph, and this is one more IoU over a 128x128 bitmap.
  //
  // Two numbers come out of it. `selfMirror` is the drawing against its own
  // reflection: the score a PERFECT replica would get if the camera were on the
  // wrong flank, and therefore the exact ceiling of the bug. `bestFlip` is our
  // car against the reflection. If bestFlip beats best, the camera is on the
  // wrong side and every score in this table is meaningless — which is the
  // condition that went unnoticed for the whole life of this file.
  const rmirror = mirror(rn.out);
  const selfMirror = iou(rn.out, rmirror);
  let bestFlip = -1;
  // Coarse: this runs under a software renderer, and 45 poses per reference
  // takes longer than the measurement is worth. Nine is enough to stop a small
  // camera mismatch masquerading as a shape difference.
  for (const daz of [-0.10, 0, 0.10]) {
    for (const del of [0]) {
      for (const dist of DISTANCES) {
        const o = await ourMask(r.az + daz, r.el + del, dist);
        const on = normalise(Uint8Array.from(o.m), o.w, o.h);
        const s = iou(rn.out, on.out);
        bestFlip = Math.max(bestFlip, iou(rmirror, on.out));
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
  if (bestFlip > best.score + 0.02) {
    mirrorFail = true;
    console.log(`  ${''.padEnd(22)} <-- WRONG FLANK: ${(100 * bestFlip).toFixed(1)}% against this ` +
                `drawing REVERSED. Turn the camera round; this score is not a shape.`);
  } else {
    console.log(`  ${''.padEnd(22)} mirror check ${(100 * bestFlip).toFixed(1)}% reversed ` +
                `(drawing vs its own mirror ${(100 * selfMirror).toFixed(1)}% — the wrong-flank ceiling)`);
  }
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
if (mirrorFail) console.log('  MIRRORED: a camera on the wrong flank. Fix the pose before reading anything above.');
await browser.close();
process.exit(worstRel >= 0.93 && !aspectFail ? 0 : 1);
