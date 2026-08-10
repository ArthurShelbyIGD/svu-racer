// Photograph the gear readout at the owner's real render size, and MEASURE it.
//
// WHY THIS TOOL EXISTS. The gear numeral, the shift lamp and the amber
// low-rev state are all state the game only reaches while driving, and two of
// the three are a few pixels across. "It looks fine" from a 1024-wide shot of
// the whole cockpit is exactly the kind of glance this project has been burned
// by, so this drives the state from the harness, shoots at 1440x720 — the
// owner's phone — and then counts pixels rather than admiring them.
//
// THE VIEWPORT IS THE POINT. 1440x720 with the renderer's pixel ratio pinned
// to 1, so one pixel in the PNG is one pixel on the panel and a height measured
// here is a height in device pixels. Everything else in tools/ shoots at
// 1024x559 or 1008x420, neither of which is the phone.
//
// GEARS IS PARSED OUT OF src/main.js rather than copied into this file,
// because a harness holding its own stale copy of the thing it is measuring is
// how the last six broken instruments got broken.

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { PNG } from 'pngjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PAGE = 'file://' + join(ROOT, 'docs', 'index.html');
const SHOTS = join(ROOT, 'shots');
await mkdir(SHOTS, { recursive: true });

const mainSrc = await readFile(join(ROOT, 'src', 'main.js'), 'utf8');
const GEARS = JSON.parse(/const GEARS = (\[[^\]]*\])/.exec(mainSrc)[1]);
const REDLINE = Number(/const REDLINE = ([0-9.]+)/.exec(mainSrc)[1]);

// ---- where the tacho lands on a 1440x720 panel ------------------------------
// The same arithmetic cockpit.js does, run here independently: art space to
// NDC to device pixels. If these disagree with the picture the crop will be
// obviously off-centre, which is the check.
const W = 1440, H = 720;
const AW = 1024, AH = 427, ART_A = AW / AH;
const sx = Math.max(1, ART_A / (W / H)), sy = Math.max(1, (W / H) / ART_A);
const a2dx = (ax) => ((2 * sx * (ax / AW) - sx) + 1) / 2 * W;
const a2dy = (ay) => (1 - ((2 * sy - 1) - 2 * sy * (ay / AH))) / 2 * H;
const WHEEL_X = 0.575, DIAL_DX = 0.0405, DIAL_Y = 0.845, DIAL_R = 0.095;
const TCX = a2dx((WHEEL_X - DIAL_DX) * AW), TCY = a2dy(DIAL_Y * AH);
const TR = DIAL_R * AH * (a2dy(AH) - a2dy(0)) / AH;      // dial radius, device px
const LAMP_DX = 0.205, LAMP_Y = 0.762;
const LCX = a2dx((WHEEL_X - LAMP_DX) * AW), LCY = a2dy(LAMP_Y * AH);
const RCX = a2dx((WHEEL_X + LAMP_DX) * AW);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForTimeout(1800);

await page.evaluate(() => {
  window.RACER.renderer.setPixelRatio(1);        // one PNG pixel = one panel pixel
  for (const id of ['hud', 'note', 'ctl']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
});

/**
 * Cut a region out of an already-captured frame and blow it up, nearest
 * neighbour, so a reviewer can see individual pixels. ONE screenshot per case:
 * this container has no GPU and a 1440x720 capture is expensive, and cropping
 * in the browser would also risk photographing a different frame each time.
 */
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

// The box the numeral is allowed to live in: the lower half of the dial face,
// inside the "0" and "8" graduations. Everything is measured inside it.
const numBox = (cx, cy, r) => [
  Math.round(cx - r * 0.30), Math.round(cy + r * 0.01),
  Math.round(cx + r * 0.30), Math.round(cy + r * 0.86),
];

/**
 * Is this pixel the numeral, and which state is it in?
 *
 * FOUR THINGS CAN BE BRIGHT IN THAT BOX and only two of them are the readout:
 *   the white numeral      #e8ecf0-ish, neutral, R and B within 45
 *   the amber numeral      #ffae2e-ish, G/R about 0.68, very little blue
 *   the needle             #ff6a3c, G/R 0.42 — rejected on that ratio
 *   the needle's lit edge  rgba(255,214,170), B 170 — rejected on the blue
 * The first version of this counted "bright and blue enough", which passed the
 * needle's highlight and rejected the amber numeral outright: it reported a
 * 20-pixel numeral in the one state the whole feature exists for. A measuring
 * instrument that cannot see the thing it measures is the failure this project
 * keeps finding, so both states are now named explicitly and the needle is
 * rejected by hue rather than by brightness.
 */
function classify(R, G, B) {
  const lum = 0.299 * R + 0.587 * G + 0.114 * B;
  if (lum > 120 && Math.abs(R - B) < 45) return 'white';
  if (R > 140 && G > R * 0.52 && G < R * 0.82 && B < 120) return 'amber';
  return null;
}

// THE NEEDLE'S CHROME CAP IS INSIDE THE BOX AND IS NOT THE NUMERAL. It is a
// neutral #9aa1a4 disc of about six device pixels' radius sitting on the
// spindle, which is bright enough and grey enough to pass for white — and it
// duly did: this tool reported a 44-pixel numeral when the numeral was 37 and
// the other 7 pixels were the cap. It also made the readout look insensitive
// to the size constant, which is how the error showed up at all. Anything
// within 0.15 dial radii of the spindle is the cap, and the numeral is not
// allowed there anyway.
const nearSpindle = (x, y, cx, cy, r) =>
  (x - cx) ** 2 + (y - cy) ** 2 < (r * 0.15) ** 2;

function measureNumeral(png, cx, cy, r) {
  const [x0, y0, x1, y1] = numBox(cx, cy, r);
  let top = 1e9, bot = -1e9, left = 1e9, right = -1e9, n = 0;
  let cTop = 1e9, cBot = -1e9;                   // the lit core, no soft edges
  let sr = 0, sg = 0, sb = 0, amber = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * png.width + x) * 4;
      const R = png.data[i], G = png.data[i + 1], B = png.data[i + 2];
      const cls = classify(R, G, B);
      if (!cls) continue;
      if (nearSpindle(x, y, cx, cy, r)) continue;
      if (cls === 'amber') amber++;
      if (y < top) top = y; if (y > bot) bot = y;
      if (x < left) left = x; if (x > right) right = x;
      // FULLY LIT, not half-blended into the black outline around it. The
      // difference between the two numbers below is the ink, and quoting the
      // outer one as "the numeral" would be quoting the shadow.
      if (0.299 * R + 0.587 * G + 0.114 * B > 150) {
        if (y < cTop) cTop = y; if (y > cBot) cBot = y;
      }
      n++; sr += R; sg += G; sb += B;
    }
  }
  if (!n) return null;
  return { h: bot - top + 1, w: right - left + 1, n, core: cBot - cTop + 1,
           state: amber > n * 0.5 ? 'AMBER' : 'white',
           col: [sr / n, sg / n, sb / n].map((v) => Math.round(v)) };
}

/**
 * The numeral including its ink, measured a second way and without any colour
 * threshold at all: two frames that differ ONLY in which gear is selected,
 * differenced. Whatever changed is the numeral and nothing else, so this
 * catches the black outline the colour scan cannot see and it cannot be fooled
 * by a threshold I chose.
 */
function diffNumeral(a, b, cx, cy, r) {
  const [x0, y0, x1, y1] = numBox(cx, cy, r);
  let top = 1e9, bot = -1e9, left = 1e9, right = -1e9, n = 0;
  for (let y = y0 - 12; y <= y1 + 12; y++) {
    for (let x = x0 - 12; x <= x1 + 12; x++) {
      const i = (y * a.width + x) * 4;
      const d = Math.max(Math.abs(a.data[i] - b.data[i]),
                         Math.abs(a.data[i + 1] - b.data[i + 1]),
                         Math.abs(a.data[i + 2] - b.data[i + 2]));
      if (d < 30) continue;
      if (nearSpindle(x, y, cx, cy, r)) continue;
      if (y < top) top = y; if (y > bot) bot = y;
      if (x < left) left = x; if (x > right) right = x;
      n++;
    }
  }
  return n ? { h: bot - top + 1, w: right - left + 1, n } : null;
}

/** Mean colour of a lamp lens, so "lit" is a measurement and not an opinion. */
function lampColour(png, cx, cy) {
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let y = Math.round(cy - 6); y <= Math.round(cy + 6); y++) {
    for (let x = Math.round(cx - 18); x <= Math.round(cx + 18); x++) {
      const i = (y * png.width + x) * 4;
      sr += png.data[i]; sg += png.data[i + 1]; sb += png.data[i + 2]; n++;
    }
  }
  return [sr / n, sg / n, sb / n].map((v) => Math.round(v));
}

const ONLY = process.argv.slice(2);

async function shot(tag, gear, rev, opts = {}) {
  if (ONLY.length && !ONLY.includes(tag)) return null;
  await page.evaluate(({ g, r, gears, boost, brake, steer }) => {
    const R = window.RACER;
    R.st.view = 1; R.st.x = 0; R.tilt.on = true;
    // Held rather than set: the frame loop eases st.steer toward tilt.out
    // every frame, so writing st.steer directly would be undone before the
    // shutter opened.
    R.tilt.out = steer || 0;
    R.tune.maxSpeed = 210; R.tune.freeze = true;
    R.pedal.boost = !!boost; R.pedal.brake = !!brake;
    R.st.gear = g;
    R.st.speed = R.tune.maxSpeed * (boost ? 1.35 : 1) * gears[g] * r;
  }, { g: gear, r: rev, gears: GEARS, boost: opts.boost, brake: opts.brake, steer: opts.steer });
  // SETTLE BY FRAMES, NOT BY THE CLOCK. The needle closes 28% of its gap per
  // FRAME, and this container's software renderer draws about four a second
  // under a full city — so a one-second wait leaves the needle a fifth of the
  // way from where it started, and two captures that should be identical
  // differ by a needle that is still moving. That is what made the first
  // difference measurement here report a numeral 64 pixels tall when it is 50.
  // Twenty-four frames leaves 0.03% of the sweep, a hundredth of a pixel.
  await page.evaluate(async (n) => {
    const R = window.RACER;
    const from = R.pace.drawn, t0 = performance.now();
    await new Promise((done) => {
      const poll = () => ((R.pace.drawn - from >= n || performance.now() - t0 > 30000)
        ? done() : requestAnimationFrame(poll));
      requestAnimationFrame(poll);
    });
  }, 24);

  const seen = await page.evaluate(() => ({
    calls: window.RACER.renderer.info.render.calls,
    tris: window.RACER.renderer.info.render.triangles,
    gear: window.RACER.st.gear, rev: window.RACER.st.rev,
  }));
  const buf = await page.screenshot();
  await writeFile(join(SHOTS, `gd-${tag}-full.png`), buf);
  const full = PNG.sync.read(buf);
  await cutout(full, `gd-${tag}-dial.png`,
               Math.round(TCX - TR * 1.3), Math.round(TCY - TR * 1.3),
               Math.round(TR * 2.6), Math.round(TR * 2.6), 3);
  await cutout(full, `gd-${tag}-lamps.png`,
               Math.round(LCX - 55), Math.round(LCY - 26),
               Math.round(RCX - LCX + 110), 52, 3);
  const num = measureNumeral(full, TCX, TCY, TR);
  const lampL = lampColour(full, LCX, LCY);
  const lampR = lampColour(full, RCX, LCY);
  console.log(
    `${tag.padEnd(16)} gear ${seen.gear + 1} rev ${seen.rev.toFixed(3)}  ` +
    `${String(seen.calls).padStart(2)} calls ${String(seen.tris).padStart(6)} tris  ` +
    `numeral ${num ? `${num.core}px lit /${String(num.h).padStart(3)}px inked ${num.state.padEnd(5)}` : "none".padEnd(28)}  ` +
    `lampL rgb(${lampL}) lampR rgb(${lampR})`);
  return { seen, num, png: full };
}

console.log(`tacho centre ${TCX.toFixed(0)},${TCY.toFixed(0)} device px, ` +
            `radius ${TR.toFixed(1)} (diameter ${(2 * TR).toFixed(0)})`);
console.log(`GEARS ${GEARS.join(' ')}   REDLINE ${REDLINE}\n`);

// The auto-downshift in main.js means a gear cannot be held below
// 0.45*G[i-1]/G[i] of its revs, so the low-rev cases below are the lowest each
// gear can actually be photographed at.
await shot('g1-idle', 0, 0.15);
await shot('g2-pull', 1, 0.62);
const a = await shot('g3-pull', 2, 0.60);
const b = await shot('g4-pull', 3, 0.60);
if (a && b) {
  const d = diffNumeral(a.png, b.png, TCX, TCY, TR);
  console.log(`\n  the numeral, differenced between third and fourth at the same\n` +
              `  revs, so no colour threshold is involved: ${d.h} x ${d.w} device px\n` +
              `  of changed pixels — the numeral WITH its ink outline.\n`);
}
await shot('g5-pull', 4, 0.60);
await shot('g2-lug', 1, 0.31);
await shot('g3-lug', 2, 0.34);
await shot('g5-lug', 4, 0.38);
await shot('g3-red', 2, 0.82);
await shot('g5-red', 4, 0.85);
await shot('g3-red-brake', 2, 0.82, { brake: true });
await shot('g3-mid-boost', 2, 0.60, { boost: true });
// THE WHEEL HAS TO PASS IN FRONT OF THE NUMERAL, NOT BEHIND IT. At about 43
// degrees of lock a spoke crosses the tacho; if the gear quad had been appended
// at the end of the draw order — the obvious place for it — the numeral would
// float on top of the spoke, which is the exact "web overlay" this feature is
// meant not to be. 0.31 of full lock is that angle.
//
// READ THE PICTURE FOR THIS ONE AND NOT THE NUMBER. With the numeral correctly
// hidden behind the spoke, the size measurement is measuring chrome and reports
// about 58 pixels. That is the pass condition here, not a regression.
await shot('g3-spoke', 2, 0.60, { steer: 0.31 });

if (errs.length) console.log('\nERRORS: ' + errs.slice(0, 4).join(' | '));
await browser.close();
