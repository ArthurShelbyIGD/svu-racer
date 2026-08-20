// WHERE SHOULD THE CHASE CAMERA STAND?
//
// ===========================================================================
// WHY THIS IS A MEASUREMENT AND NOT A MATTER OF TASTE
// ===========================================================================
//
// Third person is being switched back on. It was shelved because the car did
// not resemble the drawing; two rounds of rival bodies later Anthony has driven
// it and said "I think we have a usable car now... Then we just have to tune
// the 3rd person viewing angle."
//
// The camera it is coming back to was last set while the car was a box, and it
// shows: at tune.camY 5.2 / camZ 11.0 the car is CLIPPED BY THE BOTTOM OF THE
// FRAME — the picture is a roof and two stripes, with the whole of the tail the
// last two days went into below the edge of the screen. That is not a taste
// judgement, it is a bounding box against a frame edge, and it is the first
// thing this file checks.
//
// Three numbers decide the shot, and each one has a reason a player would give:
//
//   IS THE CAR WHOLE? A car cut off by the frame edge reads as a bug. It also
//   throws away the only view in the game that shows the bodywork at all.
//
//   HOW FAR AHEAD CAN YOU SEE? Anthony, on an earlier version: "the POV would
//   be slightly higher as the road ahead wouldn't be visible." You cannot drive
//   what you cannot see, and on a track with three hard corners a mile the road
//   ahead is the whole game. Measured as where the horizon sits down the frame:
//   the higher up the frame it is, the more tarmac there is under it.
//
//   HOW BIG IS THE CAR? Too small and the model is wasted; too big and it hides
//   the corner. A quarter of the frame's width is the target and it is not
//   arbitrary — it is what the car measured at back when the camera was set for
//   a box, before the shelving, and the complaint then was the resemblance
//   rather than the size.
//
// THE HORIZON IS COMPUTED, NOT SAMPLED. Finding it in pixels means telling
// tarmac from building from sky, on a night track where all three are dark
// blue-grey, and that classifier would be a bigger and less trustworthy thing
// than the number it produced. The camera's own pitch gives it exactly: with
// the eye looking down by theta and a vertical half-angle of fv, the horizon
// sits at 0.5 + tan(theta)/tan(fv) of the way down the frame. Both come off the
// live camera, so it cannot drift from what is actually being rendered.
//
// THE CAR IS MEASURED, NOT COMPUTED, and with tune.solo rather than by diffing
// two frames — see the note in main.js. The car is drawn alone against a flat
// colour from the real gameplay camera, so its box is exact even where its
// paint matches whatever was behind it.
//
//   node tools/chasecam.mjs            sweep the candidates
//   node tools/chasecam.mjs 5.2 11 2.2 measure one setting and photograph it

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { mkdirSync } from 'node:fs';

const __ROOT = __d(__d(__f(import.meta.url)));
const PAGE = 'file://' + __j(__ROOT, 'docs', 'index.html');
const SHOTS = __j(__ROOT, 'shots');
mkdirSync(SHOTS, { recursive: true });

/** camY, camZ, aimY. The one at the top is what ships today. */
const ONE = process.argv.length > 4
  ? [{ name: 'given', camY: +process.argv[2], camZ: +process.argv[3], aimY: +process.argv[4] }]
  : null;
// THE LEVER IS aimY AND IT GOES DOWN, which is the opposite of the first guess.
//
// Worked out on paper before burning a sweep, and then checked by the sweep.
// The car sits at the origin and the camera some 12 units behind and 5.6 up, so
// the car is about 20 degrees below the horizontal from the eye; the eye is
// pitched down only 3.3, which leaves the car 17 degrees below the camera's
// axis and half the vertical field is 20. That is 85% of the way to the bottom
// edge before the car's own height is counted, which is why it is clipped.
//
// Raising the camera pitches it down but ALSO deepens the angle to the car, and
// the second effect is the larger of the two because the car is four times
// closer than the aim point — so the car sinks further. Lowering the AIM
// pitches the camera down without touching the angle to the car at all, so the
// car rises in the frame and the horizon rises with it. One lever, both
// problems.
const CANDIDATES = ONE || [
  // WHAT SHIPS, first, so a regression shows up at the top of the table.
  { name: 'ships', camY: 3.4, camZ: 10.5, aimY: -3.0 },
  // WHAT IT REPLACED. Set when the car was a box; the tail is off the bottom.
  { name: 'the old one', camY: 5.2, camZ: 11.0, aimY: 2.2 },
  // The neighbours, so the choice can be seen to be a choice.
  { name: 'lower', camY: 2.8, camZ: 10.5, aimY: -3.0 },
  { name: 'higher', camY: 4.2, camZ: 10.5, aimY: -3.0 },
  { name: 'closer', camY: 3.4, camZ: 9.0, aimY: -3.0 },
  { name: 'further back', camY: 3.4, camZ: 12.5, aimY: -3.0 },
  { name: 'aimed higher', camY: 3.4, camZ: 10.5, aimY: -1.0 },
  { name: 'aimed lower', camY: 3.4, camZ: 10.5, aimY: -5.0 },
];

// A phone in landscape, which is the only shape this game is played in.
const W = 812, H = 375;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });
await page.evaluate(() => {
  window.RACER.menu.close();
  for (const id of ['hud', 'note', 'ctl', 'gears']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
});

/**
 * Settle on a straight, at a speed a player actually drives at.
 *
 * AND IN THE RACING STATE, WHICH IS NOT A DETAIL. The frame loop zeroes the
 * speed every frame while the car is on the grid — "on the line the throttle is
 * dead, not fought" — and that happens BEFORE `v = st.speed / maxSpeed` is
 * taken, so on a page that has never started a race v is 0 no matter what a
 * harness writes into st.speed. The chase camera reads v twice, `camY + v*0.5`
 * and `camZ + v*1.6`, and the field of view reads it a third time.
 *
 * So a harness that pins the speed and photographs the grid is tuning a camera
 * position the player never occupies. Caught here because standing still, 170
 * and flat out on the boost came back with the car in the same box to the
 * digit — and three speeds agreeing exactly is not a result, it is a symptom.
 * tools/carshots.mjs and tools/inkmeter.mjs have the same hole in them.
 */
const pose = async () => page.evaluate(async () => {
  const R = window.RACER;
  const f = () => new Promise((r) => requestAnimationFrame(() => r()));
  R.startRace();
  await new Promise((done, fail) => {
    const t = R.st.simT + R.consts.COUNTDOWN + 0.05, g = performance.now() + 60000;
    const step = () => {
      if (R.st.simT >= t) return done();
      if (performance.now() > g) return fail(new Error('the countdown never finished'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  // The flattest, straightest run, so the shot is repeatable and the horizon
  // is the camera's rather than the hill's.
  const t = R.track, SEG = R.consts.SEG_LEN;
  let seg = 0, bs = 1e9;
  for (let i = 100; i < t.n - 300; i += 5) {
    let s = 0;
    for (let k = 0; k < 160; k++) {
      const j = (i + k) % t.n;
      s += Math.abs(t.curve[j]) + Math.abs(t.hill[j] - t.hill[i]) * 0.002;
    }
    if (s < bs) { bs = s; seg = i; }
  }
  R.st.view = 3;
  R.tune.maxSpeed = 210; R.tune.holdSpeed = 170; R.tune.holdX = 0;
  R.st.dist = seg * SEG; R.st.x = 0; R.st.steer = 0; R.st.slope = 0;
  R.tune.freeze = true;
  for (let i = 0; i < 6; i++) await f();
  R.st.dist = seg * SEG;
  for (let i = 0; i < 3; i++) await f();
  return { seg, v: R.st.speed / R.tune.maxSpeed, camY: R.camera.position.y };
});

/**
 * Measure one setting: where the horizon lands, and where the car lands.
 */
const measure = (c) => page.evaluate(async (c) => {
  const R = window.RACER;
  R.tune.camY = c.camY; R.tune.camZ = c.camZ; R.tune.aimY = c.aimY;
  const f = () => new Promise((r) => requestAnimationFrame(() => r()));
  await f(); await f(); await f();

  // --- the horizon, off the live camera --------------------------------------
  // The camera's forward axis is -Z in its own space; its world direction comes
  // straight out of the matrix. Pitch is the angle of that below level.
  const e = R.camera.matrixWorld.elements;
  const fx = -e[8], fy = -e[9], fz = -e[10];
  const flat = Math.hypot(fx, fz) || 1e-9;
  const pitch = Math.atan2(-fy, flat);              // positive = looking down
  const fovY = R.camera.fov * Math.PI / 180;
  // MINUS, AND THE SIGN WAS WRONG THE FIRST TIME. Tilting a camera down moves
  // everything in the frame UP, the horizon included — so more pitch means a
  // SMALLER fraction, and more tarmac underneath it. Caught by photographing
  // the same pose: the picture puts the vanishing point at about 43% and the
  // plus sign said 58%.
  const horizon = 0.5 - Math.tan(pitch) / Math.tan(fovY / 2) * 0.5;

  // --- the car, alone against two absurd backgrounds --------------------------
  const gl = R.renderer.getContext();
  const w = R.renderer.domElement.width, h = R.renderer.domElement.height;
  const grab = async (colour) => {
    R.tune.solo = colour;
    await f(); await f();
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    R.tune.solo = null;
    return buf;
  };
  const S1 = await grab(0xff00ff), S2 = await grab(0x003300);
  await f();
  const near = (b, i, r, g, bl) => Math.abs(b[i] - r) + Math.abs(b[i + 1] - g)
                                 + Math.abs(b[i + 2] - bl) < 12;
  // Column and row tallies, so a stray pixel cannot define the box.
  const col = new Int32Array(w), row = new Int32Array(h);
  let n = 0;
  for (let i = 0, p = 0; i < S1.length; i += 4, p++) {
    if (near(S1, i, 255, 0, 255) && near(S2, i, 0, 51, 0)) continue;
    n++;
    col[p % w]++; row[(p / w) | 0]++;
  }
  const span = (hist, len) => {
    let lo = 0, hi = len - 1;
    while (lo < len && hist[lo] < 3) lo++;
    while (hi > lo && hist[hi] < 3) hi--;
    return [lo, hi];
  };
  const [x0, x1] = span(col, w);
  const [y0r, y1r] = span(row, h);
  // readPixels is bottom-up; convert to rows down the frame.
  const top = h - 1 - y1r, bot = h - 1 - y0r;
  return {
    horizon, pitch: pitch * 180 / Math.PI, fov: R.camera.fov,
    carPx: n, w, h,
    left: x0 / w, right: (x1 + 1) / w, top: top / h, bottom: (bot + 1) / h,
    width: (x1 - x0 + 1) / w, height: (bot - top + 1) / h,
  };
}, c);

const P = await pose();
console.log(`\nCHASE CAMERA — ${W}x${H}, a phone in landscape, on the straight at segment ${P.seg}`);
console.log(`  racing, v = ${P.v.toFixed(2)} — if that is 0.00 the game is still on the grid` +
            ` and every number below is the wrong camera.\n`);
console.log('  Targets: the car whole and clear of every edge, its width about a quarter');
console.log('  of the frame, and the horizon about a third of the way down.\n');
console.log('   camY  camZ  aimY   horizon   car w   car x        car y        verdict');

const rows = [];
for (const c of CANDIDATES) {
  const m = await measure(c);
  // CLIPPED is a hard fail: a bounding box that reaches an edge is a car with
  // a piece missing, whatever else the numbers say.
  const clipped = m.left <= 0.002 || m.right >= 0.998 || m.top <= 0.002 || m.bottom >= 0.998;
  const notes = [];
  if (clipped) notes.push('CLIPPED');
  else if (m.bottom > 0.985) notes.push('touching the bottom');
  if (m.width < 0.18) notes.push('car small');
  if (m.width > 0.34) notes.push('car large');
  if (m.horizon < 0.24) notes.push('horizon high');
  if (m.horizon > 0.42) notes.push('little road ahead');
  rows.push({ c, m, clipped, notes });
  console.log(`  ${c.camY.toFixed(2)} ${c.camZ.toFixed(1).padStart(5)} ${c.aimY.toFixed(1).padStart(5)}` +
    `   ${(100 * m.horizon).toFixed(0).padStart(3)}%` +
    `    ${(100 * m.width).toFixed(0).padStart(3)}%` +
    `   ${(100 * m.left).toFixed(0).padStart(3)}-${(100 * m.right).toFixed(0).padStart(3)}%` +
    `   ${(100 * m.top).toFixed(0).padStart(3)}-${(100 * m.bottom).toFixed(0).padStart(3)}%` +
    `   ${notes.length ? notes.join(', ') : 'ok'}   ${c.name}`);

  // Photograph only the ones worth looking at, or the sweep writes fifty files.
  if (!notes.length || CANDIDATES.length <= 8) {
    await page.evaluate((c) => {
      const R = window.RACER;
      R.tune.camY = c.camY; R.tune.camZ = c.camZ; R.tune.aimY = c.aimY;
    }, c);
    await page.waitForTimeout(120);
    await page.screenshot({ path: __j(SHOTS, `chase-${c.name.replace(/[^a-z0-9]+/gi, '-')}.png`) });
  }
}

// ===========================================================================
// AND THEN THE HARD CASES, because a shot that only works at cruising speed on
// a flat straight is a shot that breaks in the first corner.
//
// The eye is not fixed: it rises and moves back with speed (+v*0.5 and +v*1.6)
// and drops on a climb (-slope*3). So the framing that matters is not the one
// on the straight at 170 — it is the WORST of standing still on the grid,
// flat out on the boost, and the steepest gradient on the lap in both
// directions. A car clipped on the start line is the first thing every tester
// would see.
if (ONE) {
  const steep = await page.evaluate(() => {
    const t = window.RACER.track;
    let up = 0, dn = 0, iu = 0, id = 0;
    for (let i = 0; i < t.n - 1; i++) {
      const d = t.hill[i + 1] - t.hill[i];
      if (d > up) { up = d; iu = i; }
      if (d < dn) { dn = d; id = i; }
    }
    return { iu, id, up, dn };
  });
  const CASES = [
    { name: 'standing on the grid', speed: 0, seg: null },
    { name: 'cruising, 170', speed: 170, seg: null },
    { name: 'flat out on the boost', speed: 284, seg: null },
    { name: 'the steepest climb', speed: 170, seg: steep.iu },
    { name: 'the steepest drop', speed: 170, seg: steep.id },
  ];
  console.log('\n  the same setting through the hard cases:');
  for (const k of CASES) {
    const m = await page.evaluate(async (k) => {
      const R = window.RACER;
      const SEG = R.consts.SEG_LEN;
      // PIN THE SPEED PROPERLY. Setting st.speed from outside does not hold —
      // freeze stops the car MOVING, not the engine accelerating, so the first
      // version of this pass measured the same speed three times and reported
      // three identical boxes for standing still, cruising and flat out. The
      // giveaway was that they agreed to the digit.
      R.tune.holdSpeed = k.speed;
      const f = () => new Promise((r) => requestAnimationFrame(() => r()));
      if (k.seg !== null) {
        // DRIVE INTO THE HILL, DO NOT ASSERT ONE.
        //
        // The camera reads st.slope, which the loop SMOOTHS toward the real
        // gradient over several frames. Writing the segment's raw gradient
        // straight into it — the first version of this — measures a car on a
        // slope the track may never sustain long enough to reach, and duly
        // reported the car clipped at a place that photographs perfectly well.
        // So: park short of the gradient, let the car actually drive onto it
        // with the loop doing its own smoothing, and freeze where it ends up.
        R.tune.freeze = false;
        R.st.dist = (k.seg - 40) * SEG;
        const stop = k.seg * SEG;
        await new Promise((done) => {
          const g = performance.now() + 20000;
          const step = () => {
            if (R.st.dist >= stop || performance.now() > g) return done();
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
        R.tune.freeze = true;
      }
      for (let q = 0; q < 4; q++) await f();
      const slope = R.st.slope;
      const gl = R.renderer.getContext();
      const w = R.renderer.domElement.width, h = R.renderer.domElement.height;
      const grab = async (colour) => {
        R.tune.solo = colour;
        await f(); await f();
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        R.tune.solo = null;
        return buf;
      };
      const S1 = await grab(0xff00ff), S2 = await grab(0x003300);
      await f();
      const near = (b, i2, r, g, bl) => Math.abs(b[i2] - r) + Math.abs(b[i2 + 1] - g)
                                     + Math.abs(b[i2 + 2] - bl) < 12;
      const col = new Int32Array(w), row = new Int32Array(h);
      for (let i2 = 0, p = 0; i2 < S1.length; i2 += 4, p++) {
        if (near(S1, i2, 255, 0, 255) && near(S2, i2, 0, 51, 0)) continue;
        col[p % w]++; row[(p / w) | 0]++;
      }
      const span = (hist, len) => {
        let lo = 0, hi = len - 1;
        while (lo < len && hist[lo] < 3) lo++;
        while (hi > lo && hist[hi] < 3) hi--;
        return [lo, hi];
      };
      const [x0, x1] = span(col, w);
      const [ya, yb] = span(row, h);
      return { left: x0 / w, right: (x1 + 1) / w,
        top: (h - 1 - yb) / h, bottom: (h - ya) / h,
        width: (x1 - x0 + 1) / w, slope };
    }, k);
    const clip = m.left <= 0.002 || m.right >= 0.998 || m.top <= 0.002 || m.bottom >= 0.998;
    console.log(`    ${k.name.padEnd(24)} car ${(100 * m.width).toFixed(0).padStart(3)}% wide, ` +
      `${(100 * m.top).toFixed(0).padStart(3)}-${(100 * m.bottom).toFixed(0).padStart(3)}% down` +
      `   slope ${m.slope.toFixed(3).padStart(6)}` +
      `   ${clip ? '<-- CLIPPED' : 'ok'}`);
  }
}

// PUT IT BACK. A harness that leaves the game posed is a harness whose next
// caller measures its leftovers.
await page.evaluate(() => {
  window.RACER.tune.freeze = false;
  window.RACER.tune.holdSpeed = null;
  window.RACER.tune.holdX = null;
});
await browser.close();

const good = rows.filter((r) => !r.notes.length);
console.log(`\n  ${good.length} of ${rows.length} settings clear every check.`);
console.log('  Pictures in shots/chase-*.png — the numbers cannot tell you whether it FEELS right.');
console.log(`  page errors: ${errs.length ? errs.join(' | ') : 'none'}\n`);
