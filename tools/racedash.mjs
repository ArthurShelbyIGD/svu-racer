// Photograph the race readout in every state it has, at the owner's render
// size, and MEASURE it.
//
// WHY THIS TOOL EXISTS. The countdown is on screen for three seconds at the
// start of a race and the lap timer is 129 x 16 device pixels of it; neither
// can be judged from a 1024-wide shot of the whole cockpit, and neither
// appears at all unless the race is driven into the state that shows it. So
// this drives race state from the harness, shoots at 1440x720 — the owner's
// phone, pixel ratio pinned to 1 so one PNG pixel is one panel pixel — and
// then counts pixels.
//
// THE THINGS IT MEASURES, and why each one is a measurement rather than a look:
//
//   the height of a clock digit in device pixels, found by differencing two
//   frames that differ ONLY in the time shown. No colour threshold is involved
//   and nothing I chose can flatter it.
//   the countdown numeral's cap height, the same way.
//   whether the readout FITS: the leftmost and rightmost lit pixel on the
//   glass against the glass's own edges. BOTH ends, because the last fit test
//   on this project checked one and shipped an overrun on the other.
//   draw calls and triangles, from renderer.info.render, every shot.

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { PNG } from 'pngjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PAGE = 'file://' + join(ROOT, 'docs', 'index.html');
const SHOTS = join(ROOT, 'shots');
await mkdir(SHOTS, { recursive: true });

// ---- where things land on a 1440x720 panel ----------------------------------
// The same art-space-to-device arithmetic cockpit.js does, run here
// independently and off the SOURCE rather than off a copy: if the constants in
// the file move and this does not, the crops come out obviously wrong, which
// is the check.
const src = await readFile(join(ROOT, 'src', 'car', 'cockpit.js'), 'utf8');
const num = (name) => {
  const m = new RegExp(`\\b${name} = ([-0-9.]+)`).exec(src);
  if (!m) throw new Error(`cannot find ${name} in cockpit.js`);
  return Number(m[1]);
};
const W = 1440, H = 720;
const AW = 1024, AH = 427, ART_A = AW / AH;
const sx = Math.max(1, ART_A / (W / H)), sy = Math.max(1, (W / H) / ART_A);
const fx2d = (fx) => ((2 * sx * fx - sx) + 1) / 2 * W;   // frame fraction -> device x
const fy2d = (fy) => (1 - ((2 * sy - 1) - 2 * sy * fy)) / 2 * H;
const RADIO_FX = num('RADIO_FX'), RADIO_FW = num('RADIO_FW');
const LCD_FX = RADIO_FX + RADIO_FW * 0.30, LCD_FW = RADIO_FW * 0.40;
const DASH_TOP_A = 0.700, DASH_TOP_B = 0.052;            // DASH_TOP(fx) = a + b*fx
const LCD_FY = DASH_TOP_A + DASH_TOP_B * 0.30 + num('RADIO_DY') + num('RADIO_FH') * 0.28;
const LCD_FH = num('RADIO_FH') * 0.42;
const LX0 = fx2d(LCD_FX), LX1 = fx2d(LCD_FX + LCD_FW);
const LY0 = fy2d(LCD_FY), LY1 = fy2d(LCD_FY + LCD_FH);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForTimeout(2000);

await page.evaluate(() => {
  window.RACER.renderer.setPixelRatio(1);
  for (const id of ['hud', 'note', 'ctl']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
  // The car is frozen for every shot: a race that is actually running would
  // move the needles between two captures that are meant to differ in one
  // digit, and the difference measurement would then measure the needle.
  window.RACER.tune.freeze = true;
});

async function cutout(png, name, x0, y0, w, h, zoom) {
  const out = new PNG({ width: w * zoom, height: h * zoom });
  for (let y = 0; y < h * zoom; y++) {
    for (let x = 0; x < w * zoom; x++) {
      const sxp = Math.min(png.width - 1, Math.max(0, x0 + Math.floor(x / zoom)));
      const syp = Math.min(png.height - 1, Math.max(0, y0 + Math.floor(y / zoom)));
      const s = (syp * png.width + sxp) * 4, d = (y * out.width + x) * 4;
      out.data[d] = png.data[s]; out.data[d + 1] = png.data[s + 1];
      out.data[d + 2] = png.data[s + 2]; out.data[d + 3] = 255;
    }
  }
  await writeFile(join(SHOTS, name), PNG.sync.write(out));
}

/**
 * The lit pixels on the glass: bright green against a background that is dark
 * green. Both the digits and the tag are the same #8af2b4, and the unlit ghost
 * segments are black at 30% over the background, which is darker than the
 * background and so cannot be counted as lit by a brightness test.
 */
function litBox(png) {
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0;
  for (let y = Math.floor(LY0) - 2; y <= Math.ceil(LY1) + 2; y++) {
    for (let x = Math.floor(LX0) - 2; x <= Math.ceil(LX1) + 2; x++) {
      const i = (y * png.width + x) * 4;
      const R = png.data[i], G = png.data[i + 1], B = png.data[i + 2];
      if (G > 130 && G > R + 40 && G > B + 25) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        n++;
      }
    }
  }
  return n ? { x0, x1, y0, y1, n } : null;
}

/** Everything that changed between two frames, inside a box. */
function diffBox(a, b, bx0, by0, bx1, by1, thresh = 30) {
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0;
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const i = (y * a.width + x) * 4;
      const d = Math.max(Math.abs(a.data[i] - b.data[i]),
                         Math.abs(a.data[i + 1] - b.data[i + 1]),
                         Math.abs(a.data[i + 2] - b.data[i + 2]));
      if (d < thresh) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      n++;
    }
  }
  return n ? { x0, x1, y0, y1, n, h: y1 - y0 + 1, w: x1 - x0 + 1 } : null;
}

/**
 * The countdown glyph, found by DIFFERENCING against a frame of the same
 * stationary car with no countdown on it.
 *
 * The first version of this looked for bright amber pixels instead and duly
 * found the city's street lamps, which are also bright and amber: it reported
 * the "3" as 348 x 563 pixels spanning half the windscreen, and it reported a
 * countdown still on screen forty seconds into the race. Nothing on the grid
 * moves between the two frames except the numeral, so the difference IS the
 * numeral, and no threshold I choose can flatter it.
 */
function glyphBox(a, base) {
  return diffBox(a, base, 0, 0, W - 1, H - 1, 40);
}

const ONLY = process.argv.slice(2);
const shots = {};

/**
 * Put the race in a state and photograph it.
 *
 * THE STATE IS WRITTEN STRAIGHT INTO race AND THEN FROZEN. main.js advances
 * the race from its own frame loop, so a state set and left alone would have
 * moved on by several tenths before the shutter opened — the countdown would
 * be photographed on a different numeral than the one asked for. tune.freeze
 * stops the physics; stepRace still runs, so race.t is re-written on every
 * frame of the settle below to hold it exactly where it was put.
 */
async function shot(tag, st) {
  if (ONLY.length && !ONLY.includes(tag)) return null;
  await page.evaluate(async (v) => {
    const R = window.RACER;
    R.st.view = 1; R.st.x = 0; R.st.gear = v.gear || 0;
    R.st.speed = v.speed || 0;
    R.tilt.on = true; R.tilt.out = 0;
    // THE PIN HAS TO OUTLIVE THIS CALL. main.js steps the race from its own
    // frame loop and tune.freeze does not stop it, so a state written once and
    // then photographed is a state that has moved on: the first run of this
    // tool asked for the race clock at 43.4s and photographed 43.9, and asked
    // for GO 0.2s into the race and photographed the frame after GO had gone.
    // So the pin is a rAF loop that keeps writing the state until the shutter
    // has closed. It is registered after main.js's frame callback, so it runs
    // immediately after each render and the most the state can drift before
    // the next one is a single clamped dt — a tenth of a second.
    window.__pin = v.race;
    if (!window.__pinning) {
      window.__pinning = true;
      const loop = () => {
        if (window.__pin) Object.assign(R.race, window.__pin);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    const from = R.pace.drawn, t0 = performance.now();
    await new Promise((done) => {
      const poll = () => ((R.pace.drawn - from >= 12 || performance.now() - t0 > 30000)
        ? done() : requestAnimationFrame(poll));
      requestAnimationFrame(poll);
    });
  }, st);
  const seen = await page.evaluate(() => ({
    calls: window.RACER.renderer.info.render.calls,
    tris: window.RACER.renderer.info.render.triangles,
    state: window.RACER.race.state, t: window.RACER.race.t,
    elapsed: window.RACER.race.elapsed,
  }));
  const buf = await page.screenshot();
  await writeFile(join(SHOTS, `rd-${tag}.png`), buf);
  const png = PNG.sync.read(buf);
  shots[tag] = png;
  await cutout(png, `rd-${tag}-lcd.png`,
               Math.round(LX0) - 6, Math.round(LY0) - 6,
               Math.round(LX1 - LX0) + 12, Math.round(LY1 - LY0) + 12, 6);
  const lit = litBox(png);
  const fit = lit
    ? `lit x ${lit.x0}..${lit.x1} in glass ${Math.round(LX0)}..${Math.round(LX1)} ` +
      `(${(lit.x0 - LX0).toFixed(0)} left, ${(LX1 - lit.x1).toFixed(0)} right clear), ` +
      `y ${lit.y0}..${lit.y1} of ${Math.round(LY0)}..${Math.round(LY1)}`
    : 'NOTHING LIT ON THE GLASS';
  console.log(`${tag.padEnd(14)} ${seen.state.padEnd(9)} t=${seen.t.toFixed(2)} ` +
              `${String(seen.calls).padStart(2)} calls ${String(seen.tris).padStart(6)} tris  ${fit}`);
  return png;
}

console.log(`the glass: x ${LX0.toFixed(1)}..${LX1.toFixed(1)} ` +
            `(${(LX1 - LX0).toFixed(1)} wide), y ${LY0.toFixed(1)}..${LY1.toFixed(1)} ` +
            `(${(LY1 - LY0).toFixed(1)} tall) device px\n`);

const R0 = { state: 'grid', t: 0, elapsed: 0, best: null, bestTop: null, fresh: false,
             topSpeed: 0, countdown: 3.2 };

await shot('grid-nobest', { race: { ...R0 } });
await shot('grid-best', { race: { ...R0, best: 64.7, bestTop: 190 } });
await shot('cd3', { race: { ...R0, state: 'countdown', t: 0.2, best: 64.7 } });
await shot('cd2', { race: { ...R0, state: 'countdown', t: 1.3, best: 64.7 } });
await shot('cd1', { race: { ...R0, state: 'countdown', t: 2.4, best: 64.7 } });
await shot('go', { race: { ...R0, state: 'racing', t: 0.2, elapsed: 0.2, best: 64.7 },
                   speed: 20, gear: 0 });
const a = await shot('race-mid', { race: { ...R0, state: 'racing', t: 40, elapsed: 43.4, best: 64.7 },
                                   speed: 180, gear: 4 });
const b = await shot('race-mid2', { race: { ...R0, state: 'racing', t: 40, elapsed: 43.5, best: 64.7 },
                                    speed: 180, gear: 4 });
const c = await shot('race-min', { race: { ...R0, state: 'racing', t: 70, elapsed: 78.9, best: 64.7 },
                                   speed: 180, gear: 4 });
await shot('done-nopb', { race: { ...R0, state: 'done', t: 1.0, elapsed: 71.2, best: 64.7,
                                  fresh: false }, speed: 0, gear: 0 });
await shot('done-nopb-best', { race: { ...R0, state: 'done', t: 4.0, elapsed: 71.2, best: 64.7,
                                       fresh: false }, speed: 0, gear: 0 });
// The blink is a second long, lit for the first 0.6 of it, and the pin above
// can drift by a tenth — so these two are aimed at the middle of each half.
await shot('done-pb-on', { race: { ...R0, state: 'done', t: 1.25, elapsed: 62.3, best: 62.3,
                                   fresh: true }, speed: 0, gear: 0 });
await shot('done-pb-off', { race: { ...R0, state: 'done', t: 1.75, elapsed: 62.3, best: 62.3,
                                    fresh: true }, speed: 0, gear: 0 });

// ---- the measurements -------------------------------------------------------
console.log('');
if (a && b) {
  // 43.4 against 43.5: ONE digit changes, the tenths, and nothing else in the
  // frame does. Whatever differs is that digit.
  const d = diffBox(a, b, Math.floor(LX0) - 4, Math.floor(LY0) - 4,
                    Math.ceil(LX1) + 4, Math.ceil(LY1) + 4);
  console.log(`  a clock digit, differenced between 43.4s and 43.5s so no colour\n` +
              `  threshold is involved: ${d ? `${d.h} x ${d.w} device px at x ${d.x0}..${d.x1}`
                                            : 'NOTHING CHANGED — the clock is not running'}`);
}
if (a && c) {
  const d = diffBox(a, c, Math.floor(LX0) - 4, Math.floor(LY0) - 4,
                    Math.ceil(LX1) + 4, Math.ceil(LY1) + 4);
  console.log(`  43.4s against 1:18.9 — the minutes place has to move too:\n` +
              `  ${d ? `${d.h} x ${d.w} device px at x ${d.x0}..${d.x1}` : 'NOTHING CHANGED'}`);
}
// THE COUNTDOWN, against the same car on the grid with nothing on the dash.
// grid-best shows the identical LCD (the best, BEST lit) so the glass cancels
// out of the difference and what is left is the numeral alone.
const base = shots['grid-best'];
if (base) {
  for (const [tag, label] of [['cd3', '3'], ['cd2', '2'], ['cd1', '1'], ['go', 'GO'],
                              ['race-mid', 'mid-race, must be nothing']]) {
    const p = shots[tag];
    if (!p) continue;
    const w = glyphBox(p, base);
    console.log(`  countdown "${label}": ${w ? `${w.h} px tall, ${w.w} wide, ` +
                `x ${w.x0}..${w.x1}, y ${w.y0}..${w.y1}, ${w.n} px changed` : 'nothing on screen'}`);
    if (w && w.n > 400) {
      await cutout(p, `rd-${tag}-crop.png`, Math.max(0, w.x0 - 40), Math.max(0, w.y0 - 30),
                   Math.min(W - w.x0, w.w + 80), Math.min(H - w.y0, w.h + 90), 1);
    }
  }
  // WHERE ITS FEET ARE. The claim is that the numeral stands on the scuttle;
  // DASH_TOP(0.5) is where the scuttle is, and this prints both so the claim
  // can be checked rather than admired.
  console.log(`  the scuttle at the middle of the frame is y ` +
              `${fy2d(DASH_TOP_A + DASH_TOP_B * 0.5).toFixed(0)} device px`);
}

if (errs.length) console.log('\nERRORS: ' + errs.slice(0, 4).join(' | '));
await browser.close();
