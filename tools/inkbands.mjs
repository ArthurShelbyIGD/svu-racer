// HOW MUCH INK IS IN THE FRAME, BAND BY BAND — and where it is.
//
// tools/inkmeter.mjs grades the CAR. This grades the WHOLE FRAME, and mostly
// the buildings, because they fill three quarters of it.
//
// THE INSTRUMENT IS CALIBRATED BEFORE IT IS USED, and that is the only reason
// to trust it. Run with no arguments and it first measures the two reference
// frames and prints them next to the numbers they are known to produce:
//
//     ref/target-high.png    3.2 / 43.9 / 54.6 / 55.9      (high camera)
//     ref/city-night.png    36.8 / 43.7 / 51.7 / 62.4      (low camera)
//
// If those two lines do not come out, the meter has changed and nothing it says
// about our frame means anything. The definitions those numbers pin down:
//
//   * FOUR EQUAL HORIZONTAL BANDS, top to bottom, over the entire frame
//     including sky and car. Not the drawn subject, not a crop.
//   * INK is r<62 AND g<62 AND b<74, the same test tools/inkmeter.mjs uses.
//
// THE TEST HAS A KNOWN BLIND SPOT AND IT MUST NOT BE DESIGNED AROUND.
// PAL.road is #263142, which passes (38, 49, 66 — all under). PAL.roadAlt is
// #2c384c, which fails on blue by two (44, 56, 76). So one road band in two
// counts as ink and the other does not, and DARKENING THE TARMAC WOULD RAISE
// THE SCORE WHILE MOVING THE FRAME AWAY FROM THE REFERENCE, whose road measures
// 46 and is the most saturated thing at the road edge. The bottom band is
// mostly road; read it with that in mind, and grade the top two bands, which
// are buildings, against the reference. The meter reports the road's own
// contribution separately so the two cannot be confused.
//
// It also reports STROKE WIDTH and STROKE COUNT — the horizontal run lengths of
// ink and how many runs there are per row — because "too much ink" and "too
// little ink" are the same number for two opposite defects. The reference draws
// many fine lines; a frame can match its ink PERCENTAGE with a third as many
// strokes three times too fat, and look nothing like it.
//
// REPEATABILITY, measured by running it twice on an unchanged build: third
// person is stable to +-0.3 of a percentage point, first person to +-0.6. That
// is with FORTY settle frames; at twenty-four, first person moved six points
// between runs, because a jump to a new segment takes that long to work through
// the camera. A difference under a point is noise, not progress.
//
//   node tools/inkbands.mjs            calibrate, then measure both views
//   node tools/inkbands.mjs ref        calibrate only

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';

const __ROOT = __d(__d(__f(import.meta.url)));
const PAGE = 'file://' + __j(__ROOT, 'docs', 'index.html');

const BANDS = 4;
const isInk = (r, g, b) => r < 62 && g < 62 && b < 74;
/**
 * A SECOND, STRICTER TEST THAT TARMAC CANNOT PASS.
 *
 * PAL.road is #263142 — blue 66 — so it clears the ink test by eight and
 * contributes to the headline number as if it were line work. Nothing at
 * road luminance clears this one, so the `deep` row is line work and shadow
 * only: it is the row to read when the question is "are we drawing enough
 * lines", and it is why the road cannot be darkened into a better score.
 * On the references it reads 0.6/16.2/29.6/21.0 (high) and
 * 21.0/25.0/27.0/16.7 (low).
 */
const isDeep = (r, g, b) => r < 32 && g < 32 && b < 40;
/**
 * THE SAME TEST WITH THE BLUE BOUND RAISED BY TEN, and it exists to SIZE the
 * blind spot rather than to excuse it.
 *
 * PAL.roadAlt lands on screen at #2d384c — blue 76 — and fails the ink test by
 * two. Half our tarmac therefore counts and half does not, and the gap between
 * our bottom two bands and the reference's is partly that and partly a real
 * shortfall. `near` is run over the REFERENCE as well, so the comparison is
 * like for like: if `near` closes the gap and `ink` does not, the missing ink
 * is tarmac we should not touch.
 */
const isNear = (r, g, b) => r < 62 && g < 62 && b < 84;

/**
 * The measurement itself, over an RGBA byte array. Shared by the reference
 * path and the live path so the two cannot drift apart — the previous
 * generation of tools on this project measured the reference with one piece of
 * code and the game with another, and the difference was the finding.
 */
function measure(data, w, h, flipY) {
  const band = new Array(BANDS).fill(0);
  const deep = new Array(BANDS).fill(0);
  const near = new Array(BANDS).fill(0);
  const bandN = new Array(BANDS).fill(0);
  const runs = [];
  let rows = 0, runsTotal = 0;
  // BAND EDGES BY DIVISION OF THE HEIGHT, not by rescaling the row index. 559
  // does not divide by four, and the two roundings disagree on one row at each
  // boundary — worth 0.3 of a percentage point in band 2, which is enough to
  // fail a calibration that should be exact.
  const edge = [];
  for (let k = 0; k <= BANDS; k++) edge.push(Math.floor(h * k / BANDS));
  for (let ry = 0; ry < h; ry++) {
    // A GL readback is bottom-up and a PNG is top-down. Getting this wrong
    // swaps band 1 with band 4 and the sky with the road, which is exactly the
    // sort of mistake that produces a plausible-looking table of wrong numbers.
    const y = flipY ? h - 1 - ry : ry;
    let b = BANDS - 1;
    for (let k = 0; k < BANDS; k++) if (ry >= edge[k] && ry < edge[k + 1]) { b = k; break; }
    let run = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const ink = isInk(data[i], data[i + 1], data[i + 2]);
      bandN[b]++;
      if (isDeep(data[i], data[i + 1], data[i + 2])) deep[b]++;
      if (isNear(data[i], data[i + 1], data[i + 2])) near[b]++;
      if (ink) { band[b]++; run++; }
      else if (run) { runs.push(run); runsTotal++; run = 0; }
    }
    if (run) { runs.push(run); runsTotal++; }
    rows++;
  }
  runs.sort((a, b2) => a - b2);
  const pct = (q) => (runs.length ? runs[Math.min(runs.length - 1, Math.floor(runs.length * q))] : 0);
  return {
    bands: band.map((v, i) => 100 * v / bandN[i]),
    deep: deep.map((v, i) => 100 * v / bandN[i]),
    near: near.map((v, i) => 100 * v / bandN[i]),
    median: pct(0.5), p90: pct(0.9), p98: pct(0.98),
    perRow: runsTotal / rows,
    mean: runs.length ? runs.reduce((s, v) => s + v, 0) / runs.length : 0,
  };
}

const row = (a) => a.map((v) => v.toFixed(1).padStart(5)).join(' /');
const fmt = (m) => row(m.bands) +
  `   near ${row(m.near)}   deep ${row(m.deep)}` +
  `   stroke med ${String(m.median).padStart(2)} mean ${m.mean.toFixed(1).padStart(4)}` +
  ` p90 ${String(m.p90).padStart(3)}  ${m.perRow.toFixed(1).padStart(5)}/row`;

// ------------------------------------------------------------- calibration
const KNOWN = [
  ['target-high', [3.2, 43.9, 54.6, 55.9]],
  ['city-night', [36.8, 43.7, 51.7, 62.4]],
];
console.log('\nCALIBRATION — the meter against numbers it is known to produce\n');
let ok = true;
const refs = {};
for (const [name, want] of KNOWN) {
  const p = PNG.sync.read(fs.readFileSync(__j(__ROOT, 'ref', name + '.png')));
  const m = measure(p.data, p.width, p.height, false);
  refs[name] = m;
  const good = m.bands.every((v, i) => Math.abs(v - want[i]) < 0.06);
  ok = ok && good;
  console.log(`  ${good ? 'ok  ' : 'FAIL'} ${name.padEnd(12)} ${fmt(m)}`);
  if (!good) console.log(`       expected ${want.join(' / ')}`);
}
if (!ok) {
  console.log('\n  THE METER DISAGREES WITH THE REFERENCE. Nothing below is evidence.\n');
  process.exit(1);
}
console.log('\n  the meter agrees with the reference. Now it may judge us.\n');
if (process.argv[2] === 'ref') process.exit(0);

// ------------------------------------------------------------------- ours
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
// THE SAME SHAPE AS THE REFERENCE. The bands are fractions of frame height, so
// measuring a 1008x420 letterbox against a 1024x559 reference would compare the
// reference's third quarter with our second.
const page = await browser.newPage({ viewport: { width: 1024, height: 559 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForTimeout(2400);
if (errs.length) console.log('PAGE ERRORS:', errs.slice(0, 2).join(' | '));
await page.evaluate(() => {
  for (const id of ['hud', 'note', 'ctl']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
});

const shots = await page.evaluate(async () => {
  const R = window.RACER;
  const gl = R.renderer.getContext();
  const w = R.renderer.domElement.width, h = R.renderer.domElement.height;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  R.scenery.count = 7040;
  const t = R.track;
  let seg = 0, bs = 1e9;
  for (let i = 100; i < t.n - 300; i += 5) {
    let s = 0;
    for (let k = 0; k < 160; k++) {
      const j = (i + k) % t.n;
      s += Math.abs(t.curve[j]) + Math.abs(t.hill[j] - t.hill[i]) * 0.002;
    }
    if (s < bs) { bs = s; seg = i; }
  }
  const out = [];
  for (const view of [3, 1]) {
    for (let s = 0; s < 40; s++) {
      R.st.view = view; R.st.dist = seg * R.consts.SEG_LEN; R.st.x = 0;
      R.tune.maxSpeed = 210; R.st.speed = 170; R.tune.freeze = true;
      R.tilt.on = true; R.tilt.out = 0; R.st.steer = 0;
      await frame();
    }
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    out.push({ view, buf: Array.from(buf), w, h,
               calls: R.renderer.info.render.calls, tris: R.renderer.info.render.triangles });
  }
  return out;
});

console.log('OURS — scenery 7040, the flattest straight, same 1024x559\n');
for (const s of shots) {
  const m = measure(Uint8Array.from(s.buf), s.w, s.h, true);
  console.log(`  ${(s.view === 3 ? 'third' : 'first').padEnd(12)} ${fmt(m)}`);
  console.log(`  ${''.padEnd(12)} ${String(s.calls).padStart(3)} calls  ${s.tris} tris`);
}
console.log('\n  targets   high camera  ' + fmt(refs['target-high']));
console.log('            low camera   ' + fmt(refs['city-night']));

await browser.close();
