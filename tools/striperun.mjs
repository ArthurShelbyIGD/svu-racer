// DOES A STRIPE READ AS ONE STRIPE?
//
// The stripes came out of the loft as a chequerboard: from the chase camera the
// deck was a grid of purple and green rectangles rather than two bands running
// the length of the car. The rail logic was right — the stripes were the right
// width and in the right place — and eyeballing it could not say what was
// wrong, because the fault was in how the LINES crossing the stripes were
// drawn, not in the stripes.
//
// So this counts, rather than looks. Take a column of pixels down the middle of
// each stripe in a chase-camera frame and split it into runs of one HUE FAMILY.
// A stripe crossed by N shut lines should be ONE purple run with N fine
// interruptions inside it. N+1 separate runs means the lines are cutting the
// stripe into blocks.
//
// The distinction the classifier makes is the whole point, and it is measured
// off ref/rear-nobg-crop.png rather than chosen:
//
//   a line crossing a stripe    49,23,70  and  56,30,78   (stripe: 116,83,142)
//   a line crossing green       45,77,38  and   0,35,0    (green:  126,184,75)
//   the stripe's own edge       49,44,51  and  63,60,69
//
// The first two carry the hue of the paint they cross — they are creases in one
// panel. The third is neutral — it is an edge between two colours. Ink belongs
// on the third and nowhere else, and this tool fails the first two if they are
// drawn in ink, because a neutral dark run breaks a hue run and a tinted one
// does not.
//
//   node tools/striperun.mjs

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';

const ROOT = __d(__d(__f(import.meta.url)));
const SHOT = __j(ROOT, 'shots', 'striperun.png');

/**
 * Which colour family a pixel belongs to.
 *
 * Purple is red-and-blue: red at least level with green, and blue well above
 * green. That is what separates a crease in the stripe (51,39,62 here, 49,23,70
 * in the drawing) from three things that are all darker-than-mid and all easy
 * to mistake for it — ink (9,9,15, blue only six above green), night tarmac
 * (44,56,76, red BELOW green) and the car's own dark glass (17,23,39, likewise).
 * Every one of those was reported as stripe by an earlier version of this test.
 */
function family(r, g, b) {
  const lum = (r + g + b) / 3;
  if (r >= g - 2 && b - g >= 12) return 'purple';
  if (g - r >= 14 && g - b >= 14) return 'green';
  if (lum < 70) return 'ink';
  return 'other';
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1008, height: 560 } });
await page.goto('file://' + __j(ROOT, 'docs', 'index.html'), { waitUntil: 'load' });
await page.waitForTimeout(2000);
await page.evaluate(() => {
  for (const id of ['hud', 'note', 'ctl']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
});
// The flattest stretch, so the car is not tilted across the frame.
const flat = await page.evaluate(() => {
  const t = window.RACER.track;
  let best = 0, bs = 1e9;
  for (let i = 100; i < t.n - 300; i += 5) {
    let s = 0;
    for (let k = 0; k < 160; k++) {
      const j = (i + k) % t.n;
      s += Math.abs(t.curve[j]) + Math.abs(t.hill[j] - t.hill[i]) * 0.002;
    }
    if (s < bs) { bs = s; best = i; }
  }
  return best;
});
// FREEZE, or the world moves between the two captures and the difference calls
// the whole frame car. The first run of this tool did exactly that and reported
// forty-odd stripes, most of them tarmac.
const set = (D) => page.evaluate((d) => {
  const R = window.RACER;
  R.tune.freeze = true;
  R.st.view = 3; R.st.dist = d; R.st.x = 0; R.tune.maxSpeed = 1e-6; R.st.speed = 0;
  R.st.steer = 0; R.st.slope = 0; R.tilt.on = true; R.tilt.out = 0;
  R.pedal.boost = false; R.pedal.brake = false;
}, D);
await set(flat * 6);
await page.waitForTimeout(500);
await set(flat * 6);
await page.waitForTimeout(200);
await page.screenshot({ path: SHOT });

// WHICH PIXELS ARE CAR. Taken the way tools/silhouette.mjs takes it — render the
// same frozen frame twice, once with the body hidden — because a night road is
// dark navy and a dark navy pixel and a purple crease are the same colour to
// within a few counts. Guessing at the car by colour is how this tool first
// reported the tarmac as a stripe.
const mask = await page.evaluate(async () => {
  const R = window.RACER;
  const gl = R.renderer.getContext();
  const w = R.renderer.domElement.width, h = R.renderer.domElement.height;
  const A = new Uint8Array(w * h * 4), B = new Uint8Array(w * h * 4);
  const fr = () => new Promise((r) => requestAnimationFrame(() => r()));
  await fr(); await fr();
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, A);
  R.tune.showBody = false;
  await fr(); await fr();
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, B);
  R.tune.showBody = true;
  await fr();
  const m = new Array(w * h).fill(0);
  for (let i = 0, p = 0; i < A.length; i += 4, p++) {
    const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
    if (d > 2) { const x = p % w, y = (p / w) | 0; m[(h - 1 - y) * w + x] = 1; }
  }
  return { m, mw: w, mh: h };
});
await browser.close();

const png = PNG.sync.read(readFileSync(SHOT));
const { width: w, height: h, data } = png;
const at = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
// THE DRAWING BUFFER IS NOT THE SCREENSHOT. main.js has a pixel-ratio control,
// so the canvas backing store can be smaller than the CSS frame; indexing the
// mask with the PNG's stride put the lane markings on the car's deck and the
// tool reported them as breaks in the stripe.
const sx = mask.mw / w, sy = mask.mh / h;
const car = (x, y) => mask.m[((y * sy) | 0) * mask.mw + ((x * sx) | 0)] === 1;

// Find the columns that are purple bodywork for the longest stretch.
const TOP = 0;
const tally = new Int32Array(w);
for (let x = 0; x < w; x++) {
  for (let y = TOP; y < h; y++) if (car(x, y) && family(...at(x, y)) === 'purple') tally[x]++;
}
const cols = [];
for (let x = 1; x < w - 1; x++) {
  if (tally[x] < 12) continue;
  if (tally[x] < tally[x - 1] || tally[x] < tally[x + 1]) continue;
  if (cols.length && x - cols[cols.length - 1] < 20) continue;
  cols.push(x);
}

console.log('\nSTRIPE CONTINUITY — a column down the middle of each stripe');
console.log('One hue run per stripe is right. One per panel is a chequerboard.\n');
let worst = 0;
for (const x of cols) {
  const runs = [];
  for (let y = TOP; y < h; y++) {
    if (!car(x, y)) continue;
    const px = at(x, y);
    const k = family(...px);
    if (k === 'other') { runs.push({ k, n: 1, first: px }); continue; }
    const last = runs[runs.length - 1];
    if (last && last.k === k) { last.n++; last.last = px; } else runs.push({ k, n: 1, first: px, last: px });
  }
  for (let i = runs.length - 1; i > 0; i--) {
    if (runs[i].k === runs[i - 1].k) { runs[i - 1].n += runs[i].n; runs.splice(i, 1); }
  }
  // THE DECK IS WHAT IS BEING MEASURED. Above it the stripe is legitimately cut
  // twice, by the windscreen and by the rear window, and no line work joins
  // paint across a pane of glass. So walk up from the bottom of the column and
  // stop at the first wide band of glass: everything below that is one panel of
  // paint — deck, boot lid, the roll over into the tail — and it must come back
  // as ONE run.
  let deck = [];
  for (let i = runs.length - 1; i >= 0; i--) {
    if ((runs[i].k === 'ink' || runs[i].k === 'other') && runs[i].n >= 8) break;
    deck.unshift(runs[i]);
  }
  const nDeck = deck.filter((r) => r.k === 'purple' && r.n >= 4).length;
  const nAll = runs.filter((r) => r.k === 'purple' && r.n >= 4).length;
  worst = Math.max(worst, nDeck);
  const shape = deck.filter((r) => r.n >= 2)
    .map((r) => `${r.k}${r.first ? '(' + r.first.join(',') + ')' : ''}x${r.n}`).join(' ');
  console.log(`  x=${String(x).padStart(4)}   deck: ${nDeck} purple run(s)` +
              `   whole column: ${nAll}`);
  console.log(`         ${shape}`);
}
console.log(`\n  worst column: ${worst} purple run(s) down the deck` +
            '   (1 is right — the deck is one panel of paint)');
console.log(worst <= 1 ? '  CONTINUOUS\n'
  : '  BROKEN — the crossing lines are cutting the stripe into blocks\n');
process.exit(worst <= 1 ? 0 : 1);
