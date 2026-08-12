// RETIRED, DELIBERATELY, AND KEPT FOR ITS REASONING.
//
// This tool answered one question: is the Armco at least as good as the teal
// posts it replaced, at the one job the posts existed for — hard edges whipping
// past at the side of vision. It answered it (peripheral pixels changed per
// frame 0.66 -> 1.18, outer fifth of the screen 0.3% -> 5.3% covered, one draw
// call either way), the barrier shipped on the strength of it, and `class
// Posts` was then deleted from main.js because nothing referenced it.
//
// Which means the BEFORE half can no longer be built. The tool patches main.js
// to swap the barrier back out for the posts, and the line it patches is gone.
//
// There were three ways to leave it and only one of them is honest:
//
//   - Leave it throwing. A permanently red tool in the suite teaches everyone
//     to ignore red tools, which is how the next real failure gets missed.
//   - Let the BEFORE run against the current build anyway. It would then
//     measure the ARMCO and label the column "posts", and print a comparison
//     of a thing against itself as though it meant something. This is the
//     worst option and it is also the easiest one to reach by accident.
//   - Say the comparison is over.
//
// It is over. What the barrier costs on its own is still measured, every run,
// by tools/check.mjs (draw calls at the worst moment) and photographed by
// tools/menufit.mjs and tools/iphone.mjs. If posts ever come back, the git
// history has this file working.
//
// The numbers it produced, and the caveats that came with them, are in the
// header of src/world/barrier.js — including the one worth remembering: the
// sense-of-speed figure moved between 1.03x and 1.97x depending on how a peak
// was detected. Above 1 every time, so the direction held; the magnitude never
// did, and it was reported that way rather than at its most flattering.
console.log(`
  tools/armco.mjs is RETIRED.

  It compared the Armco barrier against the teal posts it replaced. The posts
  were deleted from main.js when the barrier shipped, so the BEFORE half cannot
  be built any more and a comparison against nothing is not a measurement.

  What it found, before it went: peripheral motion 1.8x the posts', the outer
  fifth of the screen 0.3% -> 5.3% covered, and the same single draw call. The
  full numbers and their caveats are in the header of src/world/barrier.js.

  The barrier's ongoing cost is checked by tools/check.mjs on every run.
`);
process.exit(0);

/* eslint-disable */
// WHAT DOES SWAPPING THE POSTS FOR ARMCO ACTUALLY COST, AND WHAT DOES IT BUY?
//
//   node tools/armco.mjs            the full run, about four minutes
//   node tools/armco.mjs --quick    fewer samples, for iterating
//
// ===========================================================================
// WHAT THIS MEASURES AND WHY EACH ONE IS HERE
// ===========================================================================
//
// The posts existed for ONE stated reason: sense of speed. So the only question
// that matters about replacing them is not "does the barrier look better" — a
// still screenshot answers that and a still screenshot cannot see the failure
// mode. The failure mode is that a continuous rail is a SMOOTH RIBBON, and a
// smooth ribbon moving past you reads as stationary. It is entirely possible to
// draw a beautiful barrier that makes the game feel slower than teal boxes did.
//
// So, in order of how much they matter:
//
//   1. DRAW CALLS. The budget is 16, the worst frame spends 13, and posts cost
//      exactly one. Measured by hiding the mesh and diffing renderer.info —
//      which is also the negative control, because a diff that does not move
//      when the object disappears is not measuring the object.
//
//   2. THE CROSSING RATE. How many barrier features cross a fixed vertical line
//      on the screen per second, at a fixed speed, against the posts it
//      replaces. Measured from PIXELS, not from the spacing constant: the
//      barrier is rendered on its own, the luminance of one screen column is
//      sampled over a controlled sweep of track distance, and the peaks and
//      troughs in that signal are counted. If this comes out lower than the
//      posts' number then the barrier is worse at the one job the posts had,
//      and the tool says so in those words.
//
//   3. THE APPARENT DIRECTION OF TRAVEL, which is the trap in (2). More
//      features per second is not automatically better. The game draws at 30fps
//      by default, so a pattern repeating faster than 15 times a second aliases,
//      and an aliased pattern appears to run BACKWARDS — the wagon-wheel effect,
//      which reads as a shimmering mess rather than as speed. This is measured
//      by cross-correlating the edge strip against itself one displayed frame
//      later and reading off which way the best match lies. Posts at a normal
//      speed are the known-good case that proves the instrument works.
//
//   4. EDGE COVERAGE. Peripheral motion can only be read where there are
//      pixels. What fraction of the outer fifth of the frame does each option
//      actually paint?
//
//   5. A PICTURE OF THE SAME CORNER, before and after, because numbers have
//      lied on this project before.
//
// ===========================================================================
// EVERY MEASUREMENT HAS SOMETHING THAT CAN MAKE IT GO RED
// ===========================================================================
//
//   draw calls      hide the mesh: the diff must be exactly 1 call, and the
//                   triangle diff must equal the module's own stats.tris.
//   crossing rate   (a) run it again at HALF SPEED: the rate must halve.
//                   (b) run it again with the mesh HIDDEN: it must go to zero.
//                   (c) run it again with the car NOT MOVING: it must go to
//                       zero. This is the one that catches the rig measuring
//                       renderer noise instead of the barrier.
//   direction       feed the same frames in reverse: the sign must flip.
//   coverage        hidden mesh must measure 0.0%.
//
// A green test that cannot go red is not a test, and three tests on this
// project have been confidently green and wrong.
//
// ===========================================================================
// HOW IT DRIVES THE GAME, AND THE TWO WAYS THAT GOES WRONG
// ===========================================================================
//
// R.startRace() FIRST, then wait out the countdown. On the grid and through the
// countdown main.js pins st.speed to zero every frame, so a rig that loads the
// page and starts assigning speeds is photographing a parked car. Four harnesses
// were doing exactly that until recently.
//
// Then tune.freeze = true and st.dist written by hand. Under SwiftShader a
// frame takes a couple of hundred milliseconds, so the game's own dt is huge
// and irregular: sampling the barrier by watching the car drive would sample a
// 17-per-second flicker at 5 samples a second and alias the INSTRUMENT. freeze
// holds the car in place while keeping the speed — and therefore the field of
// view and the camera pose — at a realistic value, so the sweep can be stepped
// by an exact distance per frame and the sampling rate is whatever we choose.
// The sweep is stepped at 180 samples per simulated second, which is six times
// the display rate, so nothing in the measured signal is aliased by the tool.
//
// ===========================================================================
// HOW IT GETS A BARRIER BUILD WITHOUT COMMITTING ONE
// ===========================================================================
//
// src/main.js belongs to Anthony this week and must not be edited. So this rig
// applies the swap ITSELF, in a temp copy semantics: patch, build, measure,
// restore, rebuild — in a finally block, and it prints `git status` for
// src/main.js at the end so a crashed run cannot leave the file patched
// silently. That also makes this a test of the paste-in lines in barrier.js's
// header: the strings it substitutes are those lines. If they stop applying,
// this run fails rather than the instructions quietly rotting.

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MAIN = join(ROOT, 'src', 'main.js');
const FILE = 'file://' + join(ROOT, 'docs', 'index.html');
const SHOTS = join(ROOT, 'shots');
mkdirSync(SHOTS, { recursive: true });

const QUICK = process.argv.includes('--quick');
/** Samples per simulated second of the swept distance. Six times the 30fps
 *  display rate, so the tool never aliases what it is measuring. */
/**
 * Samples per simulated second of the swept distance. Four times the 30fps
 * display rate: high enough that the TOOL is not the thing aliasing, low
 * enough that a run finishes, and an exact multiple of 30 so the same samples
 * can be decimated to the display rate for the aliasing column.
 */
const RATE = 120;
/** How long a sweep is, in simulated seconds. The posts only produce about 14
 *  reversals a second, so a short run counts single figures and the rate comes
 *  out of a handful of events. */
const SECS = QUICK ? 0.5 : 1.0;
/** The two headline runs get longer, because they are the comparison the whole
 *  file exists for and the posts only produce a reversal every 70ms. */
const SECS_MAIN = QUICK ? 0.6 : 1.5;
/** The speed everything is measured at. Step 4 of 6, gear 4 — a fast cruise,
 *  not the boosted top end, because the top end is not where the game lives. */
const SPEED = 210;

const ORIGINAL = readFileSync(MAIN, 'utf8');
let patched = false;

function build() {
  execFileSync(join(ROOT, 'tools', 'build.sh'), { stdio: 'pipe' });
}

/** Apply the exact lines the header of src/world/barrier.js tells Anthony to
 *  paste. If these substitutions stop matching, the instructions are wrong. */
function patchMain() {
  let s = ORIGINAL;
  const imp = "import { buildFurniture } from './world/furniture.js';";
  const ctor = 'const posts = new Posts(scene, 120);';
  if (!s.includes(imp)) throw new Error('main.js: import anchor not found');
  // THE COMPARISON HAS AN EXPIRY DATE AND IT HAS EXPIRED. This tool exists to
  // answer "is the Armco at least as good as the posts it replaces", which it
  // did; the barrier then shipped and `class Posts` was deleted, so the BEFORE
  // half can no longer be reconstructed. Throwing here would leave a red tool
  // in the suite for a comparison nobody can run and nobody needs. It skips
  // the before/after and measures the barrier on its own instead, and says so
  // out loud rather than quietly reporting half a result.
  if (!s.includes(ctor)) return false;
  s = s.replace(imp, imp + "\nimport { buildBarrier } from './world/barrier.js';");
  s = s.replace(ctor,
    'const posts = buildBarrier({ scene, palette: PAL, ink: INK, roadW: ROAD_W,\n' +
    '                             segLen: SEG_LEN, segCount: SEG_COUNT, behind: BEHIND });');
  writeFileSync(MAIN, s);
  patched = true;
  build();
}

function restoreMain() {
  if (!patched) return;
  writeFileSync(MAIN, ORIGINAL);
  patched = false;
  build();
}

// ---------------------------------------------------------------- in-page
//
// Everything that touches pixels runs INSIDE the browser and returns numbers.
// A 604x252 frame is 600 KB; shipping 160 of them over the CDP bridge would
// take longer than the render.

async function session(fn, { shot = null } = {}) {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  // A phone-shaped landscape viewport, the same one check.mjs uses, because
  // that is how a racer is held and because the two numbers should be
  // comparable. 0.6 pixel ratio: this container has no GPU, and nothing here
  // measures fill rate.
  const page = await browser.newPage({ viewport: { width: 1008, height: 420 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.RACER, null, { timeout: 45000 });
  await page.evaluate(() => window.RACER.renderer.setPixelRatio(0.6));
  // Find the mesh under test. The barrier flags itself with userData.armco;
  // the posts are identified by PAL.post, which nothing else in the scene uses.
  await page.evaluate(() => {
    // GET THE LANDING PAGE OUT OF THE WAY. It is a DOM layer over the canvas,
    // so a page screenshot photographs the menu rather than the game — which
    // is exactly how it blinded two of these tools the day it shipped. Tools
    // that read the WebGL buffer with gl.readPixels never saw the problem,
    // because the menu is not in that buffer.
    if (window.RACER.menu) window.RACER.menu.close();
    window.__find = (which) => {
      let hit = null;
      window.RACER.scene.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        if (which === 'armco' && o.userData.armco) hit = o;
        if (which === 'posts' && o.material && o.material.color &&
            o.material.color.getHexString() === '4fb9a8') hit = o;
      });
      return hit;
    };
  });

  // LET THE CAR OFF THE LINE. Everything below is void without this.
  await page.evaluate(async () => {
    const R = window.RACER;
    R.startRace();
    await new Promise((done, fail) => {
      const t = R.st.simT + R.consts.COUNTDOWN + 1, give = performance.now() + 90000;
      const step = () => {
        if (R.st.simT >= t) return done();
        if (performance.now() > give) return fail(new Error('the countdown never finished'));
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    if (R.race.state !== 'racing') throw new Error(`the race is '${R.race.state}', not racing`);
    // The race finishes and restarts itself mid-run otherwise, re-pinning the
    // car in the middle of a measurement.
    const hold = () => {
      if (R.race.state !== 'racing') { R.race.state = 'racing'; R.race.t = 0; }
      requestAnimationFrame(hold);
    };
    requestAnimationFrame(hold);
  });

  let out;
  try {
    out = await fn(page);
    if (shot) await page.screenshot({ path: shot });
  } finally {
    await browser.close();
  }
  if (errs.length) console.log('   PAGE ERRORS: ' + errs.join(' | '));
  return out;
}

// ---- the two in-page routines, as source strings evaluated in the page -----

/**
 * Draw calls and triangles, at the worst moment check.mjs knows about, with and
 * without the mesh under test.
 */
async function measureCost(page, which) {
  return page.evaluate(async (which) => {
    const R = window.RACER;
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    // Wind everything up: scenery to the cap, top speed, on the run-in to a
    // gantry — the same worst case check.mjs parks at.
    for (let i = 0; i < 24; i++) document.getElementById('bUp').click();
    R.tune.si = 5; R.tune.maxSpeed = 300; R.st.speed = 300;
    R.st.dist = R.consts.RACE_FROM + R.consts.RACE_LEN - 60;
    // FROZEN, OR THE DIFFERENCE IS NOT THE OBJECT. The on/off comparison is
    // taken across two different frames, and if the car is moving then the
    // scenery, the furniture and the gantry have all changed between them too.
    // Measured unfrozen, this rig said the barrier costs 2,348 triangles when
    // the barrier's own counter said 2,060 — the gap was the rest of the world
    // moving, and it would have been reported as the barrier's cost.
    R.tune.freeze = true;
    const mesh = window.__find(which);
    if (!mesh) return { found: false };

    const sample = async () => {
      let calls = 0, tris = 0;
      for (let i = 0; i < 6; i++) {
        await frame();
        const r = R.renderer.info.render;
        if (r.calls > calls) { calls = r.calls; tris = r.triangles; }
      }
      return { calls, tris };
    };
    const views = {};
    for (const view of [3, 1]) {
      R.st.view = view;
      mesh.visible = true;
      const on = await sample();
      mesh.visible = false;
      const off = await sample();
      mesh.visible = true;
      views[view === 3 ? 'third' : 'first'] = { on, off };
    }
    const stats = R.scene.userData.armcoStats || null;
    R.tune.freeze = false;
    return { found: true, views, stats: stats && { ...stats } };
  }, which);
}
/**
 * THE PIXEL RUN, and the three ways an earlier version of it was wrong.
 *
 * 1. IT RENDERED THE OBJECT ON ITS OWN AGAINST BLACK. That looks like the
 *    cleanest possible isolation and it silently favours the teal posts: the
 *    posts are bright, so they show up on black, while the barrier's support
 *    posts are near-black and vanish into it completely. The instrument would
 *    have reported a barrier with no posts on it. So the isolation here is a
 *    DIFFERENCE instead — the same frame rendered twice, once with the mesh and
 *    once without, and the per-pixel absolute difference of the two. That is
 *    exactly "what does this object put on the screen", it works the same for a
 *    dark feature against a pale pavement as for a bright one against the
 *    night, and its negative control is airtight: hide the mesh in both renders
 *    and the difference is identically zero everywhere.
 *
 * 2. IT SAMPLED ONE COLUMN OF PIXELS. The barrier at the extreme edge of the
 *    frame is about ten units away and the horizontal field of view is 120
 *    degrees, so a feature out there crosses the screen at something like four
 *    thousand pixels a second at 210 units/s, while a support post is five
 *    pixels wide. A one-pixel column gets jumped clean over between samples:
 *    the INSTRUMENT aliases, and reports a barrier with almost no features. So
 *    the signal is a SLIT about 13 pixels wide, and the slit is placed where
 *    the work is — every position across the outer 40% of the frame is scored
 *    by the variance of its signal over the run and the best is used. Posts and
 *    barrier each get the best position for themselves.
 *
 * 3. IT COUNTED "FEATURES". What is actually countable is BRIGHTNESS
 *    REVERSALS: turning points in that signal, with a prominence threshold so
 *    that noise on a flat stretch does not read as fifty features a second. A
 *    post gives two, arriving and leaving. It is a rate, and the RATIO between
 *    the two options is what the decision rests on.
 *
 * `hide`   the mesh is hidden in both renders — the difference must be zero.
 * `still`  the distance is not advanced — nothing moves, so nothing may count.
 */
async function measureMotion(page, which, opts) {
  return page.evaluate(async ([which, o]) => {
    const R = window.RACER;
    const gl = R.renderer.getContext();
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const mesh = window.__find(which);
    if (!mesh) return { found: false };
    if (o.tune && R.scene.userData.armcoStats) Object.assign(R.scene.userData.armcoStats, o.tune);

    // THE WHOLE SCENE STAYS VISIBLE. The barrier's job is to be seen against
    // the pavement, the buildings and the ground bands that are actually there,
    // and a dark post against a pale pavement is a feature that an empty frame
    // cannot show.
    R.tune.holdX = 0;
    R.st.view = 3;
    R.st.gear = 4; R.st.speed = o.speed; R.tune.si = 4; R.tune.maxSpeed = 300;
    // freeze holds the car still at a realistic speed, so the field of view and
    // the camera pose are the ones a player sees while the distance is stepped
    // by hand at a rate the sampling can keep up with.
    R.tune.freeze = true;
    R.st.dist = o.dist0;
    await frame(); await frame();

    // THE GAME'S OWN RENDER IS TURNED OFF FOR THE DURATION, and put back
    // afterwards. Each sample needs two renders of one frame, with and without
    // the mesh; the game's own render would be a third, of a frame nobody
    // reads, and under a software rasteriser that is a third of the run time.
    // The frame LOOP still runs — the camera, the road and the barrier are all
    // updated exactly as usual — it is only the draw that is skipped.
    const realRender = R.renderer.render.bind(R.renderer);
    R.renderer.render = () => {};

    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const A = new Uint8Array(W * H * 4), Bp = new Uint8Array(W * H * 4);
    /** The periphery, for coverage and motion energy: the outer fifth. */
    const EDGE = 0.20;
    /** How far in the slit is allowed to hunt: the outer 40%. */
    const HUNT = 0.40;
    const hw = Math.round(W * HUNT), ew = Math.round(W * EDGE);
    const nCols = hw * 2;
    const cols = new Float32Array(o.n * nCols);       // per-frame column means
    const lag = Math.max(1, Math.round(o.rate / 30)); // one DISPLAYED frame
    const ring = [], pending = [], motionRaw = [];
    const frameTot = new Float32Array(o.n);
    let lit = 0, total = 0, peak = 0;

    const dd = o.still ? 0 : o.speed / o.rate;        // world units per sample

    for (let k = 0; k < o.n; k++) {
      R.st.dist = o.dist0 + k * dd;
      await frame();
      // Two renders of the SAME frame, from inside one animation callback, so
      // nothing but the mesh can differ between them.
      mesh.visible = !o.hide;
      realRender(R.scene, R.camera);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, A);
      mesh.visible = false;
      realRender(R.scene, R.camera);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, Bp);
      mesh.visible = true;

      const strip = new Float32Array(ew * 2 * H);     // the periphery only
      let c = 0, e = 0;
      for (const [a, b] of [[0, hw], [W - hw, W]]) {
        for (let x = a; x < b; x++, c++) {
          const peripheral = x < ew || x >= W - ew;
          let s = 0;
          for (let y = 0; y < H; y++) {
            const i = (y * W + x) * 4;
            // The barrier's own contribution to this pixel, as a luminance.
            const d = 0.2126 * Math.abs(A[i] - Bp[i]) +
                      0.7152 * Math.abs(A[i + 1] - Bp[i + 1]) +
                      0.0722 * Math.abs(A[i + 2] - Bp[i + 2]);
            s += d;
            if (d > peak) peak = d;
            if (peripheral) {
              strip[e * H + y] = d;
              if (d > 8) lit++;
              total++;
            }
          }
          if (peripheral) e++;
          cols[k * nCols + c] = s / H;
        }
      }
      // What this frame's difference image came to in total, so a frame the
      // renderer dropped can be recognised afterwards rather than counted as a
      // very fast feature.
      let tot = 0;
      for (let i = 0; i < nCols; i++) tot += cols[k * nCols + i];
      frameTot[k] = tot;

      ring.push(strip);
      pending.push(k);
      if (ring.length > lag) {
        const prev = ring.shift(), pk = pending.shift();
        let d2 = 0;
        for (let i = 0; i < strip.length; i++) d2 += Math.abs(strip[i] - prev[i]);
        motionRaw.push({ a: pk, b: k, v: d2 / strip.length });
      }
    }

    R.renderer.render = realRender;
    R.tune.freeze = false;

    // ---- which frames did the renderer drop? -------------------------------
    // Under SwiftShader in this container a small percentage of frames come
    // back blank or half-drawn — both renders of the pair, so the difference
    // is zero rather than wrong. That is invisible in a screenshot and lethal
    // to a peak counter. A frame whose whole-strip difference has collapsed to
    // under a fifth of the run's median is marked and excluded; the count goes
    // in the report so nobody has to take this paragraph on trust.
    const totSorted = Array.from(frameTot).sort((p2, q2) => p2 - q2);
    const totMed = totSorted[totSorted.length >> 1];
    const bad = new Uint8Array(o.n);
    let drops = 0;
    for (let k = 0; k < o.n; k++) if (totMed > 0 && frameTot[k] < totMed * 0.2) { bad[k] = 1; drops++; }
    let motion = 0, motionN = 0;
    for (const m of motionRaw) if (!bad[m.a] && !bad[m.b]) { motion += m.v; motionN++; }

    // ---- reduce -----------------------------------------------------------
    //
    // HOW WIDE THE SLIT HAS TO BE, which is arithmetic and not taste.
    //
    // A feature at eccentricity e crosses the frame at f * X * v / Z^2 pixels a
    // second, where Z is its depth at that screen position. At the outer tenth
    // of the frame the barrier is under eight units away and its posts cross at
    // something like seven thousand pixels a second. Sampled 120 times a
    // second, that is sixty pixels of travel BETWEEN samples: a slit narrower
    // than that is jumped over by half the features that pass it, and the tool
    // silently reports a barrier with half the posts on it. The first run of
    // this file used a 13-pixel slit and measured the teal posts at 10
    // reversals a second where their spacing says 14.
    //
    // So the slit is 41 pixels: wider than the travel between samples at every
    // eccentricity it is read at except the innermost, and still a small
    // fraction of the 180-to-430 pixel gap between features, so it smears the
    // signal rather than filling it in.
    const SLIT = 41;
    /**
     * THREE FIXED POSITIONS PER SIDE, NOT ONE CHOSEN BY THE TOOL.
     *
     * An auto-placed slit went to the extreme edge every time for every
     * variant, because that is where the difference image is brightest — which
     * is not the same as where it is most legible, and it hid the sampling
     * problem above inside a number that looked plausible.
     *
     * These are at 10%, 25% and 40% of the half-frame in from the edge, and
     * they are also THE INTERNAL CONSISTENCY CHECK OF THIS WHOLE MEASUREMENT:
     * the rate at which features cross a fixed ray is v / spacing, which does
     * not depend on how far down the ray they are. So all three positions must
     * report the SAME rate. Where they do not, the tool is undersampling at
     * that eccentricity, and the disagreement is printed rather than averaged
     * away.
     */
    const AT = [0.10, 0.25, 0.40];

    /** Mean of the slit centred on column `c`, in frame `k`. */
    const slit = (k, c, a, b) => {
      let s = 0, n2 = 0;
      for (let i = Math.max(a, c - (SLIT >> 1)); i <= Math.min(b - 1, c + (SLIT >> 1)); i++) { s += cols[k * nCols + i]; n2++; }
      return s / n2;
    };

    /**
     * Turning points, with prominence.
     *
     * THE SCALE IS THE 10th-TO-90th PERCENTILE OF THE SIGNAL, NOT ITS RANGE,
     * and that one change moved the measured rate from 10 a second to 29. Under
     * this container's software renderer about 2% of frames come back blank or
     * half-drawn — see `drops` below — and a single zero in a signal that
     * otherwise lives between 2.5 and 4.0 sets min-to-max at 4.0, which puts
     * the prominence threshold at 1.0 when the real features modulate by 0.3.
     * Every feature in the run then falls under the threshold and the tool
     * reports a barrier with no posts on it, confidently.
     *
     * `k` is the fraction of that spread a reversal has to come back by. It is
     * an arbitrary constant, so the report prints the answer at three values of
     * it and the ratio between the two options at each: if the conclusion moves
     * when k moves, the conclusion is the constant's and not the barrier's.
     */
    const reversals = (sg, k) => {
      const sorted = Array.from(sg).sort((p2, q2) => p2 - q2);
      const pc = (f) => sorted[Math.floor(f * (sorted.length - 1))];
      const spread = pc(0.9) - pc(0.1);
      // Under this the slit is not showing anything that moves. A twentieth of
      // a luminance level averaged over a whole slit is far below any real
      // feature and far above the renderer's own repeatability, which the
      // `still` control measures directly rather than assuming.
      if (spread < 0.05) return 0;
      const prom = spread * k;
      let n = 0, dir = 0, last = sg[0];
      for (let i = 1; i < sg.length; i++) {
        const v = sg[i];
        if (dir === 1) {
          if (v > last) last = v;
          else if (v < last - prom) { n++; dir = -1; last = v; }
        } else if (dir === -1) {
          if (v < last) last = v;
          else if (v > last + prom) { n++; dir = 1; last = v; }
        } else if (v > last + prom) { dir = 1; last = v; }
        else if (v < last - prom) { dir = -1; last = v; }
      }
      return n;
    };

    const out = { found: true, W, H, sides: {}, slitW: SLIT, at: AT, edge: EDGE, peak };
    for (const [name, a, b] of [['left', 0, hw], ['right', hw, nCols]]) {
      const rates = [], alias = [], looser = [], tighter = [];
      for (const frac of AT) {
        // 0 is the frame edge on either side.
        const c = name === 'left' ? Math.round(frac * (W / 2)) : nCols - Math.round(frac * (W / 2));
        const sg = new Float32Array(o.n);
        for (let k = 0; k < o.n; k++) sg[k] = slit(k, Math.min(Math.max(c, a), b - 1), a, b);
        // DROPOUT REPAIR. A blank frame is not a feature. Any sample whose
        // whole-frame difference collapsed is replaced by the last good one,
        // and the count of them is reported rather than swept up.
        for (let k2 = 0; k2 < o.n; k2++) if (bad[k2] && k2 > 0) sg[k2] = sg[k2 - 1];
        rates.push(reversals(sg, 0.25) / (o.n / o.rate));
        looser.push(reversals(sg, 0.15) / (o.n / o.rate));
        tighter.push(reversals(sg, 0.35) / (o.n / o.rate));

        /**
         * THE SAME SIGNAL AS THE PLAYER'S SCREEN OFFERS IT.
         *
         * The game draws 30 frames a second. Everything above is sampled at
         * 120, deliberately, so that the TOOL is not the thing aliasing — but
         * the eye is only ever shown every fourth one of those. So take every
         * fourth sample and count again. A pattern the display can carry gives
         * the same rate both ways; a pattern too fast for 30fps cannot, and the
         * gap between the two numbers is how much of the extra detail is being
         * thrown away by the frame rate rather than delivered to the player.
         *
         * Averaged over all four possible starting phases, because one phase
         * can land on the features and the next between them.
         */
        const step = Math.max(1, Math.round(o.rate / 30));
        let acc = 0, ph = 0;
        for (let p2 = 0; p2 < step; p2++) {
          const dec = [];
          for (let k = p2; k < o.n; k += step) dec.push(sg[k]);
          if (dec.length > 4) { acc += reversals(Float32Array.from(dec), 0.25) / (dec.length * step / o.rate); ph++; }
        }
        alias.push(ph ? acc / ph : 0);
      }
      out.sides[name] = { rates, alias, looser, tighter };
    }
    out.coverage = total ? lit / total : 0;
    out.motion = motionN ? motion / motionN : 0;
    out.drops = drops;
    out.secs = o.n / o.rate;
    out.lag = lag;
    return out;
  }, [which, opts]);
}

// ------------------------------------------------------------------ report

const pct = (v) => (v * 100).toFixed(1) + '%';
const f1 = (v) => v.toFixed(1);
/** The headline rate for a run: the median of the three slit positions, both
 *  sides averaged. */
/**
 * THE MEDIAN OF ALL SIX READINGS — three eccentricities on each side — and not
 * the mean. One of the six can legitimately be zero: the teal posts do not
 * reach the outer tenth of the frame at all, which is a finding about the
 * posts and not a fault in the reading, but a mean would let it drag the
 * headline down by a sixth. A median ignores it and the six raw numbers are
 * printed anyway.
 */
const med6 = (r, key) => {
  const all = [...r.sides.left[key], ...r.sides.right[key]].sort((p, q) => p - q);
  return (all[2] + all[3]) / 2;
};
const rateOf = (r) => med6(r, 'rates');
const aliasOf = (r) => med6(r, 'alias');
const looseOf = (r) => med6(r, 'looser');
const tightOf = (r) => med6(r, 'tighter');

function row(label, r) {
  const L = r.sides.left, R = r.sides.right;
  const three = (s) => s.rates.map((v) => f1(v).padStart(5)).join(' ');
  return `   ${label.padEnd(30)} ${three(L)} | ${three(R)}   ${f1(aliasOf(r)).padStart(5)}` +
         `   ${pct(r.coverage).padStart(6)}   ${r.motion.toFixed(2).padStart(6)}   ${String(r.drops).padStart(4)}`;
}

// ---------------------------------------------------------------------- run

const N = Math.round(SECS * RATE);
const NMAIN = Math.round(SECS_MAIN * RATE);
const CTRL = Math.max(24, Math.round(N / 3));
const results = {};

try {
  // ------------------------------------------------------------ BEFORE
  console.log('\n=== BEFORE: the teal posts ============================================');
  build();
  results.before = await session(async (page) => {
    const dist = await page.evaluate(() => {
      // A STRAIGHT, not a corner. On a corner the barrier sweeps across the
      // frame and adds motion that is the corner's, not the barrier's; a
      // straight is the honest, hardest case for a sense-of-speed claim.
      const t = window.RACER.track, S = window.RACER.consts.SEG_LEN;
      let best = 0, bestC = 1e9;
      for (let a = 200; a < t.n - 400; a += 20) {
        let c = 0;
        for (let k = 0; k < 120; k++) c += Math.abs(t.curve[(a + k) % t.n]);
        if (c < bestC) { bestC = c; best = a; }
      }
      // and the sharpest corner, for the photograph
      let worst = 0, worstC = -1;
      for (let a = 200; a < t.n - 400; a += 5) {
        let c = 0;
        for (let k = 0; k < 30; k++) c += Math.abs(t.curve[(a + k) % t.n]);
        if (c > worstC) { worstC = c; worst = a; }
      }
      return { straight: best * S, corner: worst * S, straightCurve: bestC, cornerCurve: worstC };
    });
    const base = { rate: RATE, n: N, speed: SPEED, dist0: dist.straight };
    const run = {};
    run.main = await measureMotion(page, 'posts', { ...base, n: NMAIN });
    run.half = await measureMotion(page, 'posts', { ...base, speed: SPEED / 2 });
    // The controls only have to come out at zero, so they get a third of the
    // samples. A control that costs as much as the measurement gets dropped.
    run.hidden = await measureMotion(page, 'posts', { ...base, n: CTRL, hide: true });
    run.still = await measureMotion(page, 'posts', { ...base, n: CTRL, still: true });
    // THE COST RUN GOES LAST, because it winds the scenery dial to the cap and
    // never winds it back — every pixel run after it would be measuring a frame
    // no player ever sees, and taking four times as long to do it.
    const cost = await measureCost(page, 'posts');
    // the photograph: the same corner, the same pose, in both builds
    await page.evaluate(async (d) => {
      const R = window.RACER;
      // The cost run left the scenery dial at the cap. Put it back where the
      // game starts, or the photograph is of a frame nobody plays.
      R.scenery.count = 3500;
      R.tune.freeze = true; R.tune.holdX = 0;
      R.st.view = 3; R.st.gear = 4; R.st.speed = 210; R.tune.si = 4; R.tune.maxSpeed = 300;
      R.st.dist = d; R.tilt.out = 0;
      for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(() => r()));
    }, dist.corner);
    return { cost, dist, run };
  }, { shot: join(SHOTS, 'armco-before.png') });

  // ------------------------------------------------------------- AFTER
  console.log('=== AFTER: the Armco barrier ==========================================');
  if (patchMain() === false) {
    console.log('  (the posts are gone from main.js, so there is no BEFORE to compare');
    console.log('   against any more — measuring the barrier on its own.)');
  }
  results.after = await session(async (page) => {
    const dist = results.before.dist;
    const base = { rate: RATE, n: N, speed: SPEED, dist0: dist.straight };
    const run = {};
    run.main = await measureMotion(page, 'armco', { ...base, n: NMAIN });
    run.half = await measureMotion(page, 'armco', { ...base, speed: SPEED / 2 });
    // The controls only have to come out at zero, so they get a third of the
    // samples. A control that costs as much as the measurement gets dropped.
    run.hidden = await measureMotion(page, 'armco', { ...base, n: CTRL, hide: true });
    run.still = await measureMotion(page, 'armco', { ...base, n: CTRL, still: true });
    // THE SPACING SWEEP. The dial is stats.postEvery / stats.seamEvery, read
    // per frame, so this costs no rebuilds. Deliberately includes spacings
    // that should come out WORSE than the posts.
    const sweep = [];
    // post/2 seam/2 IS IN THE SWEEP AS WELL AS BEING THE HEADLINE, at the
    // sweep's own shorter duration, because the headline run is 1.5s and these
    // are 1.0s and comparing a rate measured over one against rates measured
    // over the other is comparing two different amounts of quantisation noise.
    // The first version of this table did exactly that and made the splice
    // lines look like they were making the barrier worse.
    for (const t of [{ postEvery: 2, seamEvery: 2 }, { postEvery: 2, seamEvery: 0 },
                     { postEvery: 3, seamEvery: 3 }, { postEvery: 8, seamEvery: 0 }]) {
      sweep.push({ tune: t, r: await measureMotion(page, 'armco', { ...base, tune: t }) });
    }
    const cost = await measureCost(page, 'armco');
    await page.evaluate(async ([d, t]) => {
      const R = window.RACER;
      Object.assign(R.scene.userData.armcoStats, t);
      R.scenery.count = 3500;
      R.tune.freeze = true; R.tune.holdX = 0;
      R.st.view = 3; R.st.gear = 4; R.st.speed = 210; R.tune.si = 4; R.tune.maxSpeed = 300;
      R.st.dist = d; R.tilt.out = 0;
      for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(() => r()));
    }, [dist.corner, { postEvery: 2, seamEvery: 2 }]);
    return { cost, run, sweep };
  }, { shot: join(SHOTS, 'armco-after.png') });
} finally {
  restoreMain();
}
// ---------------------------------------------------------------- printing

const B = results.before, A = results.after;

console.log('\n  DRAW CALLS AND TRIANGLES, at the worst moment check.mjs knows about');
console.log('  (scenery at the cap, top speed, on the run-in to a gantry, car frozen)\n');
console.log('                            whole frame           with it hidden        the object itself');
for (const view of ['third', 'first']) {
  for (const [name, r] of [['posts', B.cost], ['armco', A.cost]]) {
    const v = r.views[view];
    console.log(`   ${(name + ', ' + view).padEnd(20)} ` +
      `${String(v.on.calls).padStart(3)} calls ${String(v.on.tris).padStart(7)} tris   ` +
      `${String(v.off.calls).padStart(3)} calls ${String(v.off.tris).padStart(7)} tris   ` +
      `${String(v.on.calls - v.off.calls).padStart(2)} calls ${String(v.on.tris - v.off.tris).padStart(6)} tris`);
  }
}
const dCallsP = B.cost.views.third.on.calls - B.cost.views.third.off.calls;
const dCallsA = A.cost.views.third.on.calls - A.cost.views.third.off.calls;
const dTrisP = B.cost.views.third.on.tris - B.cost.views.third.off.tris;
const dTrisA = A.cost.views.third.on.tris - A.cost.views.third.off.tris;
console.log('\n   SELF-CHECK  hiding the mesh must change the call count, or this tool is not');
console.log('               looking at the mesh:  posts ' + dCallsP + ', armco ' + dCallsA +
            (dCallsP === 1 && dCallsA === 1 ? '   both exactly 1 — ok' : '   NOT BOTH 1 — LOOK AT THIS'));
if (A.cost.stats) {
  console.log('   SELF-CHECK  the module says it drew ' + A.cost.stats.tris + ' triangles; the renderer says ' +
              dTrisA + (Math.abs(A.cost.stats.tris - dTrisA) <= 2 ? '   agree — ok' : '   DISAGREE'));
  console.log('   SELF-CHECK  quads dropped for want of pool space: ' + A.cost.stats.dropped +
              ' of ' + A.cost.stats.maxQuads + (A.cost.stats.dropped ? '   TRUNCATED' : '   none — ok'));
}
console.log('   THE COST OF THE SWAP: ' + (dTrisA - dTrisP > 0 ? '+' : '') + (dTrisA - dTrisP) +
            ' triangles and ' + (dCallsA - dCallsP) + ' draw calls, on a worst frame of ' +
            A.cost.views.third.on.calls + ' of 16.');

console.log('\n  SENSE OF SPEED, MEASURED FROM PIXELS');
console.log(`  ${B.run.main.secs.toFixed(2)}s of simulated time at ${SPEED} units/s (${(SPEED * 0.9633).toFixed(0)} mph),`);
console.log(`  sampled ${RATE}/s, on the STRAIGHTEST stretch of the lap, third person.`);
console.log('  The object is isolated as the DIFFERENCE between the frame with it and the');
console.log('  frame without it, so a dark post against a pale pavement counts as much as');
console.log('  a bright one against the night.\n');
console.log('   brightness reversals per second, through a fixed slit at 10% / 25% / 40%');
console.log('   of the half-frame in from each edge. THE THREE SHOULD AGREE: the rate a');
console.log('   pattern crosses a fixed ray does not depend on how far down the ray it is.\n');
console.log('                                    left edge          right edge      at 30fps    edge    motion   frames');
console.log('                                  10%   25%   40%    10%   25%   40%    as seen   covered  /frame  dropped');
console.log(row(`posts  [${B.run.main.secs.toFixed(1)}s]`, B.run.main));
console.log(row(`armco  post/2 seam/2 [${A.run.main.secs.toFixed(1)}s]`, A.run.main));
console.log('   ---- the spacing sweep, all at the same shorter duration ----');
for (const s of A.sweep) {
  console.log(row(`armco  post/${s.tune.postEvery} ` + (s.tune.seamEvery ? `seam/${s.tune.seamEvery}` : 'no seam') +
                  ` [${s.r.secs.toFixed(1)}s]`, s.r));
}

const pf = rateOf(B.run.main), af = rateOf(A.run.main);
console.log('\n   THE CLAIM, PLAINLY. The posts put ' + f1(pf) + ' brightness reversals a second through');
console.log('   a fixed slit at the edge of the frame. The barrier as built puts ' + f1(af) + '.');
console.log('   ' + (af >= pf * 1.05
  ? `That is ${(af / pf).toFixed(2)}x the posts. The barrier is BETTER at the one job the posts had.`
  : af >= pf * 0.95
  ? `That is ${(af / pf).toFixed(2)}x the posts — the same, within the error of this measurement.`
  : `That is ${(af / pf).toFixed(2)}x the posts. THE BARRIER IS WORSE AT THE ONE JOB THE POSTS HAD.`));
console.log('   A post gives two reversals, arriving and leaving, so halve for a count of');
console.log('   objects. It also covers ' + pct(A.run.main.coverage) + ' of the outer fifth of the frame against the');
console.log('   posts\' ' + pct(B.run.main.coverage) + ', and changes ' + (A.run.main.motion / B.run.main.motion).toFixed(1) +
            'x as many of those pixels per displayed frame.');
// The same configuration appears twice in the table at two durations, which is
// the closest thing to a repeat measurement this rig has. Print the gap: it is
// the error bar, and it is bigger than several of the differences in the sweep.
{
  const same = A.sweep.find((s) => s.tune.postEvery === 2 && s.tune.seamEvery === 2);
  if (same) {
    const a2 = rateOf(same.r);
    console.log(`\n   REPEATABILITY. post/2 seam/2 is measured twice above, over ${A.run.main.secs.toFixed(1)}s and over`);
    console.log(`   ${same.r.secs.toFixed(1)}s, and reads ${f1(af)} and ${f1(a2)}. That ${Math.abs(a2 - af) < 0.05 ? 'is the same number' : (Math.abs(a2 - af) / ((a2 + af) / 2) * 100).toFixed(0) + '% gap is the error bar on this'}`);
    console.log(`   column, and it is wider than the differences between the sweep rows — so`);
    console.log(`   the sweep says the post spacing barely moves this measurement, not that`);
    console.log(`   one spacing beats another. Against the posts' ${f1(pf)} the barrier is somewhere`);
    console.log(`   between ${(Math.min(af, a2) / pf).toFixed(2)}x and ${(Math.max(af, a2) / pf).toFixed(2)}x on this metric, and that is as precise as it gets.`);
  }
}

console.log('\n   IS THAT CONCLUSION THE BARRIER\'S OR THE THRESHOLD\'S? The peak counter needs');
console.log('   a prominence threshold and any value for it is arbitrary, so here is the');
console.log('   same comparison at three of them:\n');
for (const [k, pv, av] of [['0.15, loose ', looseOf(B.run.main), looseOf(A.run.main)],
                           ['0.25, used  ', pf, af],
                           ['0.35, tight ', tightOf(B.run.main), tightOf(A.run.main)]]) {
  console.log(`      threshold ${k}   posts ${f1(pv).padStart(5)}   armco ${f1(av).padStart(5)}   ` +
              `ratio ${pv ? (av / pv).toFixed(2) : 'n/a'}x`);
}

console.log('\n   AND THE PART THAT IS NOT FREE. At 30 frames a second a pattern repeating');
console.log('   faster than 15 times a second cannot be carried by the display. Sampled as');
console.log('   the screen samples it, the posts read ' + f1(aliasOf(B.run.main)) + ' against their true ' + f1(pf) +
            ', the barrier');
console.log('   ' + f1(aliasOf(A.run.main)) + ' against its true ' + f1(af) + '. ' +
            (aliasOf(A.run.main) / af < 0.8
              ? 'A LOSS OF ' + ((1 - aliasOf(A.run.main) / af) * 100).toFixed(0) +
                '% — that much of the extra detail is going past faster than the frame rate can show it.'
              : 'The display carries it.'));

console.log('\n   NEGATIVE CONTROLS — the first four must find nothing at all\n');
const ctl = (label, r) => {
  console.log(`   ${label.padEnd(34)} ${f1(rateOf(r)).padStart(5)} rev/s   ${pct(r.coverage).padStart(6)} covered   ` +
              `motion ${r.motion.toFixed(3)}`);
};
ctl('posts, mesh hidden in both renders', B.run.hidden);
ctl('armco, mesh hidden in both renders', A.run.hidden);
ctl('posts, distance not advancing', B.run.still);
ctl('armco, distance not advancing', A.run.still);
console.log('   (a hidden mesh must read 0.0% covered as well as 0 rev/s; a still car keeps');
console.log('    its coverage, because the object is still there — only the motion stops)');
const halfP = rateOf(B.run.half), halfA = rateOf(A.run.half);
console.log(`\n   at HALF speed the rate must HALVE:  posts ${f1(pf)} -> ${f1(halfP)} (${(halfP / pf).toFixed(2)}x)` +
            `   armco ${f1(af)} -> ${f1(halfA)} (${(halfA / af).toFixed(2)}x)`);
if (Math.abs(halfP / pf - 0.5) > 0.08 || Math.abs(halfA / af - 0.5) > 0.08) {
  console.log('   THIS CONTROL DID NOT COME OUT AT 0.50 AND THAT IS A REAL WEAKNESS IN THE');
  console.log('   NUMBER ABOVE, so it is printed rather than tuned away. The likeliest');
  console.log('   reading, which is an inference and not a measurement: at full speed the');
  console.log('   barrier\'s features arrive at around a third of the sampling rate, so some');
  console.log('   are missed, and halving the speed resolves them properly — which makes the');
  console.log('   half-speed number too HIGH relative to the full-speed one, i.e. the true');
  console.log('   full-speed rate is under-reported and the barrier\'s advantage is if');
  console.log('   anything larger than the table says. The posts go the other way: at half');
  console.log('   speed they produce so few reversals in the window that the count is');
  console.log('   quantisation. Neither is a reason to trust the rate column to two');
  console.log('   significant figures. The coverage and motion columns have no such problem.');
}
const spread = (r) => {
  const all = [...r.sides.left.rates, ...r.sides.right.rates].filter((v) => v > 0);
  if (all.length < 2) return 0;
  const lo = Math.min(...all), hi = Math.max(...all);
  return (hi - lo) / ((hi + lo) / 2);
};
console.log(`   the six slit readings should AGREE:  posts spread ${(spread(B.run.main) * 100).toFixed(0)}%` +
            `   armco spread ${(spread(A.run.main) * 100).toFixed(0)}%`);
console.log('   (the rate a pattern crosses a fixed ray does not depend on how far down the');
console.log('    ray it is, so a wide spread is the TOOL undersampling at one eccentricity,');
console.log('    not the barrier changing rate across the frame. Zero readings are dropped');
console.log('    from this: a zero means nothing of that object reaches that part of the');
console.log('    frame at all, which is a fact about the object.)');
console.log('\n   WHAT THIS TOOL NO LONGER CLAIMS. It used to print an "apparent drift" from');
console.log('   cross-correlating the edge strip one displayed frame apart, to catch the');
console.log('   pattern appearing to run backwards. It was removed rather than reported:');
console.log('   the true drift at the frame edge is over 150 pixels a displayed frame, the');
console.log('   correlation window was 80 wide, and the number pinned to the end of its own');
console.log('   search range. Its reverse-time control did not flip sign, which is what a');
console.log('   broken instrument looks like. The 30fps column above is what replaced it.');

console.log('\n  PICTURES, of the same corner in both builds, same pose, same distance');
console.log('   ' + join(SHOTS, 'armco-before.png'));
console.log('   ' + join(SHOTS, 'armco-after.png'));
console.log(`   (track distance ${B.dist.corner.toFixed(0)}, the sharpest corner on the lap;`);
console.log(`    the measurements above ran at ${B.dist.straight.toFixed(0)}, the straightest stretch)`);

const status = execFileSync('git', ['status', '--porcelain', 'src/main.js'], { cwd: ROOT }).toString().trim();
console.log('\n  src/main.js after the run: ' + (status ? 'MODIFIED — ' + status : 'clean, as it must be'));
console.log('');
/* end of the retired tool */
