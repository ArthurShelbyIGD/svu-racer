// IS THE COUNTDOWN CLEAR OF THE STEERING WHEEL, AND BY HOW MUCH?
//
// The owner: "The graphic countdown is in the wrong position as the steering
// wheel sits on top of the lower portion of it." It was moved. This measures
// whether it actually moved far enough, in device pixels, at 1440x720 — the
// owner's phone — for all four of 3, 2, 1 and GO.
//
// HOW IT MEASURES, AND WHY NOT BY COLOUR. tools/cdcap.mjs finds the countdown
// by matching its amber and its green, and it needs three careful exclusions to
// avoid matching the wooden dash and the lime bonnet — the comments in it are a
// list of the ways that went wrong. The wheel cannot be found that way at all:
// its rim is near-black wood and so is half the cockpit.
//
// So NOTHING here is found by colour. Each part is isolated by COLLAPSING ITS
// OWN QUAD to zero area and diffing the frame against an untouched one; every
// pixel that changed is that part and no other. It cannot match the wrong
// thing, because it is not matching anything — it is asking the renderer which
// pixels a specific quad was responsible for.
//
// TWO NUMBERS PER GLYPH:
//   the glyph's lowest pixel        the bottom of the countdown's diff box
//   the wheel's highest pixel       the top of the wheel's diff box
// and the gap between them is the clearance. Negative means they overlap, which
// is the state that was reported.
//
// AND IT PROVES IT CAN FAIL. At the end it puts the countdown back where it
// used to sit — feet on the scuttle, sunk into DASH_TOP — by writing the quad's
// corners directly, and re-measures. That configuration is known to overlap the
// rim, and if this tool reports it as clear then the tool is blind and the
// green above means nothing.
//
//   node tools/cdclear.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { PNG } from 'pngjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const ROOT = __d(__d(__f(import.meta.url)));
const PAGE = 'file://' + __j(ROOT, 'docs', 'index.html');
const OUT = __j(ROOT, 'shots');
mkdirSync(OUT, { recursive: true });

// The owner's phone: a 1440x720 canvas at dpr 2.00.
const CSS_W = 720, CSS_H = 360, DPR = 2;
const DW = CSS_W * DPR, DH = CSS_H * DPR;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({
  viewport: { width: CSS_W, height: CSS_H }, deviceScaleFactor: DPR,
});
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });

// First person, wheel straight, car still, so the only thing that differs
// between two shots is the thing being measured.
//
// AND THE CAR IS FROZEN, which is not fussiness. The GO cell only shows in the
// first 0.7s of 'racing', and 'racing' is the one state where the throttle is
// live: the first version of this let the car off the line to catch GO, the
// road scrolled between the two shots of the diff pair, and the diff box came
// back as the whole 1440x672 frame with the countdown somewhere inside it. A
// difference measurement is only a measurement of one thing if everything else
// holds still.
await page.evaluate(() => {
    // GET THE LANDING PAGE OUT OF THE WAY. It is a DOM layer over the canvas,
    // so a page screenshot photographs the menu rather than the game — which
    // is exactly how it blinded two of these tools the day it shipped. Tools
    // that read the WebGL buffer with gl.readPixels never saw the problem,
    // because the menu is not in that buffer.
    if (window.RACER.menu) window.RACER.menu.close();
  const R = window.RACER;
  R.st.view = 1; R.st.speed = 0; R.st.steer = 0;
  R.tilt.on = false; R.tilt.out = 0;
  R.tune.freeze = true;
  R.tune.holdX = 0;
});
await page.waitForTimeout(1200);

/**
 * PIN THE RACE INTO ONE COUNTDOWN CELL AND HOLD IT THERE.
 *
 * A countdown counts, so it will not sit still to be photographed. Setting
 * race.state once is not enough — main.js's own frame loop advances race.t and
 * moves on to the next numeral, and a shot taken 400ms later is a shot of a
 * different glyph. This re-pins on every animation frame for as long as the
 * hold is up, which is the same trick tools/check.mjs uses to keep the car off
 * the grid.
 *
 * cell 0..2 are the numerals 3, 2 and 1; cell 3 is GO, which is shown in the
 * first CD_HOLD seconds of 'racing' rather than during the countdown.
 */
const holdCell = (cell) => page.evaluate((k) => {
  const R = window.RACER;
  if (window.__hold) window.__hold.stop = true;
  const h = { stop: false };
  window.__hold = h;
  const CD_N = 3;
  const step = () => {
    if (h.stop) return;
    // held every frame, not once: 'racing' runs the engine, and a rev counter
    // creeping between the two shots of a diff pair is a second moving thing
    R.st.speed = 0; R.st.rev = 0; R.st.gear = 0; R.pedal.brake = false;
    R.pedal.boost = false;
    // AND THE LAP CLOCK, which is the one that actually bit. race.elapsed keeps
    // accumulating in 'racing' whatever race.t is pinned to, so the tenths digit
    // on the radio's glass rolled over between the two shots of the GO pair and
    // the diff box came back 521 wide with the radio panel inside it.
    R.race.elapsed = 0;
    if (k >= CD_N) { R.race.state = 'racing'; R.race.t = 0.1; }
    else {
      R.race.state = 'countdown';
      const cd = R.race.countdown > 0 ? R.race.countdown : 3.2;
      const per = cd / CD_N;
      // the middle of the window that shows cell k, so a frame's drift cannot
      // land on the boundary and photograph the neighbour
      R.race.t = cd - (CD_N - k - 0.5) * per;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}, cell);

const shoot = async () => {
  await page.waitForTimeout(320);
  return PNG.sync.read(await page.screenshot());
};

/** Bounding box of the pixels that differ between two frames. */
const diffBox = (a, b, thr = 10) => {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1])
              + Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (d > thr) {
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, n };
};

/** Collapse one cockpit quad to zero area, take a frame, put it back. */
const withoutQuad = async (which) => {
  await page.evaluate((w) => {
    const R = window.RACER;
    const q = R.cockpit.stats.q[w];
    const p = R.cockpit.group.children[0].geometry.getAttribute('position');
    window.__saved = new Float32Array(p.array);
    for (let k = 0; k < 4; k++) {
      p.array[(q * 4 + k) * 3] = 0;
      p.array[(q * 4 + k) * 3 + 1] = 0;
    }
    p.needsUpdate = true;
  }, which);
  const png = await shoot();
  await page.evaluate(() => {
    const R = window.RACER;
    const p = R.cockpit.group.children[0].geometry.getAttribute('position');
    p.array.set(window.__saved);
    p.needsUpdate = true;
  });
  await page.waitForTimeout(180);
  return png;
};

const crop = (png, x0, y0, w, h, name, zoom = 1) => {
  x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
  w = Math.min(Math.round(w), png.width - x0);
  h = Math.min(Math.round(h), png.height - y0);
  const out = new PNG({ width: w * zoom, height: h * zoom });
  for (let y = 0; y < h * zoom; y++) {
    for (let x = 0; x < w * zoom; x++) {
      const sx = x0 + ((x / zoom) | 0), sy = y0 + ((y / zoom) | 0);
      const si = (sy * png.width + sx) * 4, di = (y * out.width + x) * 4;
      out.data[di] = png.data[si]; out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2]; out.data[di + 3] = 255;
    }
  }
  writeFileSync(__j(OUT, name + '.png'), PNG.sync.write(out));
};

// ---- where the wheel is, once. It does not move between shots. -------------
await holdCell(-1);
const plain = await shoot();
const noWheel = await withoutQuad('wheel');
const wheelBox = diffBox(plain, noWheel);
console.log(`\n  MEASURED AT ${DW}x${DH} DEVICE PIXELS, by collapsing quads\n`);
console.log(`  the steering wheel   ${wheelBox.w} x ${wheelBox.h} px, ` +
            `topmost pixel at y ${wheelBox.y0}, x ${wheelBox.x0}..${wheelBox.x1}`);

let bad = 0;
const measure = async (cell, label) => {
  await holdCell(cell);
  const withCd = await shoot();
  const noCd = await withoutQuad('count');
  const box = diffBox(withCd, noCd);
  if (!box) {
    console.log(`  ${label.padEnd(4)}  NOT ON SCREEN  <-- the hold did not catch it`);
    bad++;
    return null;
  }
  writeFileSync(__j(OUT, `cdclear-${label}.png`), PNG.sync.write(withCd));
  // the glyph and the top of the wheel, together, so the gap can be seen
  crop(withCd, box.x0 - 40, box.y0 - 20, box.w + 80,
       (wheelBox.y0 + 60) - (box.y0 - 20), `cdclear-${label}-gap`, 1);
  const gap = wheelBox.y0 - box.y1 - 1;
  const ok = gap > 0;
  if (!ok) bad++;
  console.log(`  ${label.padEnd(4)}  glyph ${String(box.w).padStart(3)} x ${String(box.h).padStart(3)} px, ` +
              `lowest pixel y ${String(box.y1).padStart(3)}   ` +
              `CLEARANCE ${String(gap).padStart(4)} px${ok ? '' : '   <-- IT OVERLAPS THE WHEEL'}`);
  return gap;
};

console.log('');
const gaps = [];
for (const [cell, label] of [[0, '3'], [1, '2'], [2, '1'], [3, 'GO']]) {
  const gap = await measure(cell, label);
  if (gap != null) gaps.push(gap);
}

// ---- AND PROVE IT CAN FAIL ------------------------------------------------
//
// Put the countdown back where the owner complained about it — feet on the
// scuttle at DASH_TOP(0.5) + 0.006 — and re-measure. That is a real historical
// configuration and it is known to overlap the rim; if this tool calls it clear
// then everything above is decoration.
//
// Done by writing the quad's NDC corners directly rather than by rebuilding the
// cockpit: the shift is DASH_TOP(0.5) + CD_FEET - (WHEEL_INK_TOP - CD_CLEAR) of
// the frame's height, downward, which is the exact move that was made.
{
  await holdCell(0);
  // LONG ENOUGH FOR THE CELL TO SETTLE BEFORE THE QUAD IS TOUCHED, and this is
  // the bug this comment exists for. update() re-places the countdown quad on
  // the frame the CELL CHANGES — coming back from GO, that is one frame after
  // the hold flips the race into 'countdown'. The first version of this shifted
  // the quad 300ms after asking for the hold, that re-place landed afterwards,
  // and the shift was silently undone: the self-check photographed the CURRENT
  // position, reported it clear, and announced that the tool could fail while
  // proving nothing. The verify-and-retry below is what makes that impossible
  // to repeat quietly.
  await page.waitForTimeout(900);
  const shift = await page.evaluate(() => {
    const R = window.RACER;
    // the two feet positions, in frame heights, from the cockpit's own numbers
    const DASH_TOP = (fx) => 0.700 + 0.052 * fx;
    const WHEEL_Y = 1.005, WHEEL_R = 0.345, WHL_S = 512;
    const WHEEL_INK_TOP = WHEEL_Y - WHEEL_R - (7 / WHL_S) * (2 * WHEEL_R / 0.936);
    const was = DASH_TOP(0.5) + 0.006, now = WHEEL_INK_TOP - 0.030;
    const dy = was - now;                       // frame heights, downward
    const q = R.cockpit.stats.q.count;
    const p = R.cockpit.group.children[0].geometry.getAttribute('position');
    window.__saved2 = new Float32Array(p.array);
    for (let k = 0; k < 4; k++) p.array[(q * 4 + k) * 3 + 1] -= 2 * dy;   // NDC y is up
    p.needsUpdate = true;
    window.__wantY = p.array[q * 12 + 1];
    return dy;
  });
  // VERIFY THE SHIFT IS STILL THERE, and re-apply it if it is not, and say so
  // out loud if it will not stick. A self-check that measures a state it failed
  // to set up is worse than no self-check, because it reports confidence.
  let tries = 0, stuck = false;
  while (tries++ < 4) {
    await page.waitForTimeout(260);
    stuck = await page.evaluate((wantY) => {
      const R = window.RACER; const q = R.cockpit.stats.q.count;
      const p = R.cockpit.group.children[0].geometry.getAttribute('position');
      if (Math.abs(p.array[q * 12 + 1] - wantY) < 1e-6) return true;
      const dy = wantY - p.array[q * 12 + 1];
      for (let k = 0; k < 4; k++) p.array[(q * 4 + k) * 3 + 1] += dy;
      p.needsUpdate = true;
      return false;
    }, await page.evaluate(() => window.__wantY));
    if (stuck) break;
  }
  if (!stuck) { console.log('\n  SELF-CHECK COULD NOT BE SET UP — the shift will not stick'); bad++; }
  const back = await shoot();
  writeFileSync(__j(OUT, 'cdclear-selfcheck-old.png'), PNG.sync.write(back));
  const noCd = await withoutQuad('count');
  // withoutQuad restored __saved, which was taken AFTER the shift, so the
  // shifted position survives — restore the original explicitly.
  const box = diffBox(back, noCd);
  await page.evaluate(() => {
    const R = window.RACER;
    const p = R.cockpit.group.children[0].geometry.getAttribute('position');
    p.array.set(window.__saved2);
    p.needsUpdate = true;
  });
  const gap = box ? wheelBox.y0 - box.y1 - 1 : 999;
  const caught = gap <= 0;
  if (!caught) bad++;
  console.log(`\n  SELF-CHECK: the countdown put back where it was, ` +
              `${(shift * DH).toFixed(0)} px lower` +
              (box ? `   (glyph now y ${box.y0}..${box.y1})` : '   (glyph not found)'));
  console.log(`  clearance now ${gap} px  ->  ` +
              (caught ? 'CAUGHT, correctly — this tool can fail'
                      : 'NOT CAUGHT — THIS TOOL IS BLIND'));
}

await page.close();

// ---- AND ON A SQUARER SCREEN, WHICH IS WHERE THIS COULD STILL GO WRONG -----
//
// The countdown and the wheel are both in ART space and the art is scaled to
// COVER the viewport, anchored to the BOTTOM. On a screen squarer than 2.4:1 —
// which is every screen except the owner's — the horizontal scale goes above 1
// and the vertical stays at 1, so the sides are cropped and nothing moves
// vertically at all: the clearance ought to come out the same fraction of the
// height on every one of them.
//
// OUGHT. The last three bugs in this cockpit were all "ought" that nobody
// photographed: the cover fit used min instead of max for four builds, and the
// only viewport the harness looked at was 2.4:1 — the one shape where both
// branches give the same answer and neither can be wrong. So this looks.
for (const s of [{ w: 800, h: 450, name: '16:9' }, { w: 640, h: 360, name: '16:9, small' }]) {
  const p2 = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
  p2.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await p2.goto(PAGE, { waitUntil: 'load' });
  await p2.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  await p2.evaluate(() => {
    const R = window.RACER;
    // The second page needs the menu closed as much as the first one does.
    if (R.menu) R.menu.close();
    R.st.view = 1; R.st.speed = 0; R.st.steer = 0;
    R.tilt.on = false; R.tune.freeze = true; R.tune.holdX = 0;
    R.renderer.setPixelRatio(1);
    const step = () => {
      R.race.state = 'countdown'; R.race.t = 0.5;
      R.st.speed = 0; R.st.rev = 0; R.st.gear = 0; R.race.elapsed = 0;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await p2.waitForTimeout(1600);
  // Both boxes on this page, same collapse-and-diff as above.
  const grab = async (which) => {
    const base = PNG.sync.read(await p2.screenshot());
    await p2.evaluate((w) => {
      const R = window.RACER;
      const q = R.cockpit.stats.q[w];
      const pa = R.cockpit.group.children[0].geometry.getAttribute('position');
      window.__s = new Float32Array(pa.array);
      for (let k = 0; k < 4; k++) { pa.array[(q * 4 + k) * 3] = 0; pa.array[(q * 4 + k) * 3 + 1] = 0; }
      pa.needsUpdate = true;
    }, which);
    await p2.waitForTimeout(320);
    const gone = PNG.sync.read(await p2.screenshot());
    await p2.evaluate(() => {
      const R = window.RACER;
      const pa = R.cockpit.group.children[0].geometry.getAttribute('position');
      pa.array.set(window.__s); pa.needsUpdate = true;
    });
    await p2.waitForTimeout(200);
    return diffBox(base, gone, 8);
  };
  const w = await grab('wheel');
  const c = await grab('count');
  await p2.screenshot({ path: __j(OUT, `cdclear-aspect-${s.w}x${s.h}.png`) });
  const gap = (w && c) ? w.y0 - c.y1 - 1 : null;
  const ok = gap != null && gap > 0;
  if (!ok) bad++;
  console.log(`\n  ${s.name.padEnd(12)} ${s.w}x${s.h}   wheel top y ${w ? w.y0 : '?'}, ` +
              `glyph foot y ${c ? c.y1 : '?'}   CLEARANCE ${gap == null ? 'NOT MEASURABLE' : gap + ' px'}` +
              `${ok ? '' : '   <-- WRONG'}`);
  await p2.close();
}

if (errors.length) { console.log('\n  CONSOLE ERRORS: ' + errors.join(' | ')); bad++; }
console.log('');
await browser.close();
process.exit(bad ? 1 : 0);
