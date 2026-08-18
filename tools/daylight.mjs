// DOES THE COMIC-BOOK LOOK SURVIVE DAYLIGHT?
//
// The whole palette was measured against a NIGHT reference — uniformly
// mid-tone, luminance 52-58, only 1% of pixels above 170 — and the ink
// weights, the fog and the tarmac were all tuned to it. The Docks is going to
// be a golden-hour track, so this answers the question on the track that
// already exists, before five miles of new one is built for it.
//
// Same track, same poses, same speed. One variable: ?theme=golden.
//
// ===========================================================================
// WHAT THIS MEASURES, AND THE METRIC THAT WAS WRONG
// ===========================================================================
//
// Version one reported "ink coverage" as the share of pixels below luminance
// 45, and had night at 45.1% against golden's 34.2%. Read straight, that says
// daylight lost a quarter of the ink and the style with it.
//
// It says nothing of the kind. At night the SKY is below 45, and so is most of
// the road, and so is the unlit side of every building. The metric was
// measuring how dark the scene is — which is the one thing we already knew had
// changed on purpose — and calling it ink. A daylight frame can have every
// outline it ever had and still score half as much.
//
// Ink is not darkness, it is a dark pixel WITH A MUCH BRIGHTER NEIGHBOUR: a
// stroke between two areas. That is what `strokes()` counts, and it is the
// number that can actually falsify the spike. `crisp()` backs it up from the
// other direction by measuring every edge in the frame regardless of colour.
//
//   node tools/daylight.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));
mkdirSync(__j(ROOT, 'shots'), { recursive: true });

// FOUR PLACES, NOT ONE. A single pose proves a single pose. These are chosen
// because each one puts DIFFERENT geometry on screen, and the theme reaches the
// scenery and the palette but not — yet — the modules that bake their own
// colours at construction. If the tunnel and the barrier come out night-blue in
// a golden frame, that is the remaining work and it should be visible here
// rather than discovered on the Docks.
const POSES = [
  { at: 1450, what: 'open street, both sides built up' },
  { at: 1108, what: 'the broken bridge and its chasm' },
  { at: 1556, what: 'inside the tunnel' },
  { at: 300,  what: 'the long straight, distance and fog' },
];

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

const shoot = async (theme) => {
  const p = await b.newPage({ viewport: { width: 720, height: 360 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + __j(ROOT, 'docs', 'index.html') + (theme ? '?theme=' + theme : ''),
               { waitUntil: 'load' });
  await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  await p.evaluate(() => { window.RACER.menu.close(); for (const id of ['hud','note','ctl','gears'])
    { const e = document.getElementById(id); if (e) e.style.display = 'none'; } window.RACER.startRace(); });
  await p.evaluate((s) => new Promise((d, f) => {
    const R = window.RACER, t = R.st.simT + s, g = performance.now() + 90000;
    const st = () => { if (R.st.simT >= t) return d();
      if (performance.now() > g) return f(new Error('stalled')); requestAnimationFrame(st); };
    requestAnimationFrame(st);
  }), 4.4);

  const out = [];
  for (const pose of POSES) {
    // POSING THE CAR, IN THE ONLY ORDER THAT IS REPEATABLE.
    //
    // holdSpeed FIRST and st.dist SECOND. The frame loop advances dist near the
    // top and applies the hold near the bottom, so writing both together still
    // lets one frame's worth of travel through — and one frame at racing speed
    // is several segments. Stopping the car, waiting for that to take, and only
    // then teleporting it means nothing moves afterwards.
    //
    // Then a long settle BEFORE freezing: the camera pitch chases the road
    // slope with a per-frame lerp, and freezing early photographs a camera
    // still aimed at wherever the car used to be. `freeze` last, and only to
    // stop the clock for the screenshot itself.
    await p.evaluate(() => { const R = window.RACER;
      R.tune.freeze = false; R.tune.holdX = 0; R.tune.holdSpeed = 0;
      R.st.speed = 0; R.st.gear = 4; R.st.air = 0; R.st.vy = 0; });
    await p.waitForTimeout(250);
    await p.evaluate((a) => { window.RACER.st.dist = a * window.RACER.consts.SEG_LEN; }, pose.at);
    await p.waitForTimeout(900);
    await p.evaluate(() => { window.RACER.tune.freeze = true; });
    await p.waitForTimeout(250);
    out.push({ pose, png: PNG.sync.read(await p.screenshot()) });
  }
  const calls = await p.evaluate(() => ({ calls: window.RACER.renderer.info.render.calls,
                                          tris: window.RACER.renderer.info.render.triangles }));
  await p.close();
  return { out, calls, errs };
};

const night = await shoot(null);
const gold = await shoot('golden');
await b.close();

const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

/** Luminance stats over horizontal bands, which is how the night reference was
 *  measured in the first place — see the head of PAL. */
const bands = (png, n = 6) => {
  const out = [];
  const h = Math.floor(png.height / n);
  for (let k = 0; k < n; k++) {
    let sum = 0, cnt = 0, hi = 0;
    for (let y = k * h; y < (k + 1) * h; y++) {
      for (let x = 0; x < png.width; x += 2) {
        const l = lum(png.data, (y * png.width + x) * 4);
        sum += l; cnt++; if (l > 170) hi++;
      }
    }
    out.push({ mean: sum / cnt, hot: 100 * hi / cnt });
  }
  return out;
};

/**
 * INK, PROPERLY: a pixel that is dark RELATIVE TO ITS SURROUNDINGS.
 *
 * A stroke is a local minimum — darker than the brightest thing within two
 * pixels of it by a wide margin. That definition holds at any overall
 * brightness, which is the entire point: a black line on white and a dark line
 * on mid-grey both count, and a dark sky counts as neither.
 */
const strokes = (png) => {
  const { width: w, height: h, data: d } = png;
  let n = 0, tot = 0;
  for (let y = 2; y < h - 2; y += 2) for (let x = 2; x < w - 2; x += 2) {
    const me = lum(d, (y * w + x) * 4);
    let hi = 0;
    for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) {
      const l = lum(d, ((y + dy) * w + (x + dx)) * 4);
      if (l > hi) hi = l;
    }
    tot++;
    if (hi - me > 40) n++;
  }
  return 100 * n / tot;
};

/** Every edge in the frame, colour included. Flat daylight is the failure mode
 *  and it shows up here before it shows up to the eye. */
const crisp = (png) => {
  let s = 0, n = 0;
  for (let y = 1; y < png.height; y += 2) for (let x = 1; x < png.width - 1; x += 2) {
    const i = (y * png.width + x) * 4, j = i + 4;
    s += Math.abs(png.data[i] - png.data[j]) + Math.abs(png.data[i + 1] - png.data[j + 1])
       + Math.abs(png.data[i + 2] - png.data[j + 2]);
    n++;
  }
  return s / n / 3;
};

/**
 * HOW BLUE THE FRAME IS, in the parts that are not sky.
 *
 * The tell for "night scene with a daylight backdrop" is a world that is still
 * cool under a warm sky, and it is exactly what the first two runs of this
 * spike found twice. Measured below the horizon only, as mean (B - R): night
 * should be strongly positive, golden should be near zero or negative, and
 * anything themed only halfway lands in between.
 */
const coolness = (png) => {
  const { width: w, height: h, data: d } = png;
  let s = 0, n = 0;
  for (let y = Math.floor(h * 0.36); y < Math.floor(h * 0.52); y += 2)
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      s += d[i + 2] - d[i]; n++;
    }
  return s / n;
};

const row = (label, f, unit = '') => {
  let line = '  ' + label.padEnd(26);
  for (let k = 0; k < POSES.length; k++) {
    const a = f(night.out[k].png), g = f(gold.out[k].png);
    line += `${a.toFixed(1).padStart(6)}${unit} ${g.toFixed(1).padStart(6)}${unit}  |`;
  }
  console.log(line);
};

console.log('\n  NIGHT vs GOLDEN, the same four poses, one variable\n');
let head = '  '.padEnd(28), sub = '  '.padEnd(28);
for (const p of POSES) { head += `  seg ${p.at}`.padEnd(17) + '|'; sub += '  night golden  |'; }
console.log(head); console.log(sub);
row('ink strokes', strokes, '%');
row('local contrast', crisp);
row('cool cast below horizon', coolness);
row('overall brightness', (p) => bands(p).reduce((s, v) => s + v.mean, 0) / 6);
row('bright pixels (>170)', (p) => bands(p).reduce((s, v) => s + v.hot, 0) / 6, '%');

console.log('\n  what each pose is:');
for (const p of POSES) console.log(`    seg ${String(p.at).padStart(4)}  ${p.what}`);

console.log(`\n  draw calls / triangles   night ${night.calls.calls}/${night.calls.tris}` +
            `   golden ${gold.calls.calls}/${gold.calls.tris}`);
console.log(`  page errors: night ${night.errs.length || 'none'}, golden ${gold.errs.length || 'none'}`);

// A contact sheet: night on top of golden, one column per pose. Looking at it
// is not optional — every metric above can be satisfied by a frame that is
// wrong in a way nobody thought to measure.
const W = night.out[0].png.width, H = night.out[0].png.height;
const CUT = Math.floor(H * 0.52);            // above the cockpit, which is unthemed
const sheet = new PNG({ width: W, height: (CUT + 4) * POSES.length * 2 });
sheet.data.fill(255);
let y0 = 0;
for (let k = 0; k < POSES.length; k++) {
  for (const src of [night.out[k].png, gold.out[k].png]) {
    for (let y = 0; y < CUT; y++)
      src.data.copy(sheet.data, ((y0 + y) * W) * 4, (y * W) * 4, (y * W + W) * 4);
    y0 += CUT + 4;
  }
}
writeFileSync(__j(ROOT, 'shots', 'daylight-sheet.png'), PNG.sync.write(sheet));
for (let k = 0; k < POSES.length; k++) {
  writeFileSync(__j(ROOT, 'shots', `day-${POSES[k].at}-night.png`), PNG.sync.write(night.out[k].png));
  writeFileSync(__j(ROOT, 'shots', `day-${POSES[k].at}-golden.png`), PNG.sync.write(gold.out[k].png));
}
console.log('  wrote shots/daylight-sheet.png (night above golden, one pair per pose)\n');
