// HOW LONG DOES THE BOTTLE LAST, AND HOW LONG UNTIL YOU CAN USE IT AGAIN?
//
// The nitrous stopped being infinite, which means two constants now decide how
// the whole lap plays: BOOST_DRAIN and BOOST_REFILL. Neither of them is
// arguable in the abstract — the questions a player actually has are "how many
// seconds of boost do I get", "how long am I waiting", and "does the bottle
// last long enough to reach the boosted top speed at all". So measure those.
//
// It also checks the two ways this feature can be broken rather than merely
// badly tuned:
//
//   THE STUTTER. At empty, one frame of refill re-arms the boost and one frame
//   of drain empties it again — so without a latch the boost chatters on and
//   off dozens of times a second, and the engine note and the dash lamp chatter
//   with it. Counted here as transitions per second at zero. It must be 0.
//
//   THE FREE REFILL. Refilling off the road would mean the grass is where you
//   go to recharge, which inverts the point of the penalty.
//
//   node tools/boost.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { PNG } from 'pngjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const p = await b.newPage({ viewport: { width: 640, height: 320 } });
await p.goto('file://' + __j(ROOT, 'docs', 'index.html'), { waitUntil: 'load' });
await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
await p.evaluate(() => window.RACER.renderer.setPixelRatio(0.4));
await p.waitForTimeout(600);

const r = await p.evaluate(async () => {
  const R = window.RACER, MPH = R.consts.MPH;
  const ROAD_W = R.consts.ROAD_W, STRAY = R.consts.STRAY_MAX;

  // WAIT ON THE SIM CLOCK, NOT THE WALL CLOCK. Under swiftshader the frame loop
  // runs at a fraction of real time and dt is clamped at 0.1s, so a rig that
  // waits ten real seconds for a ten-second bottle measures the renderer.
  const sim = (secs, tick) => new Promise((done, fail) => {
    const t = R.st.simT + secs, give = performance.now() + secs * 12000 + 15000;
    const step = () => {
      if (tick) tick();
      if (R.st.simT >= t) return done();
      if (performance.now() > give) return fail(new Error('stalled'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  // Sample every frame while waiting, so a stutter that lasts two frames is
  // still seen. Polling at a fixed interval from out here would miss it.
  const watch = (secs, sample) => sim(secs, sample);

  const race = () => { R.startRace(); return sim(R.consts.COUNTDOWN + 0.4); };

  const out = {};

  // ---- 1. A FULL BOTTLE, HELD DOWN, ON THE ROAD ---------------------------
  await race();
  R.tune.holdX = 0; R.tune.holdBoost = null;
  R.st.gear = 4; R.st.speed = R.tune.maxSpeed; R.st.boostLeft = 1;
  R.pedal.brake = false; R.pedal.boost = true;
  {
    const t0 = R.st.simT;
    let empty = null, top = 0, flips = 0, was = null, zeroT = 0, zeroFlips = 0;
    await watch(16, () => {
      const on = R.st.boostLeft > 0 && R.pedal.boost;
      // A transition of the DELIVERED boost, read off the speed ceiling rather
      // than off the button: the button never moves in this test.
      const live = R.st.speed > 0 && R.st.boostLeft > 0;
      if (was !== null && live !== was) { flips++; if (R.st.boostLeft <= 0.0001) zeroFlips++; }
      was = live;
      if (empty === null && R.st.boostLeft <= 0) empty = R.st.simT - t0;
      if (R.st.boostLeft <= 0) zeroT += 1 / 60;
      if (R.st.speed * MPH > top) top = R.st.speed * MPH;
      void on;
    });
    out.drain = { secs: empty, topReached: top, flipsAtZero: zeroFlips, zeroSecs: zeroT };
  }

  // ---- 2. HOW LONG BACK TO FULL, ON THE TARMAC ----------------------------
  R.pedal.boost = false;
  {
    const t0 = R.st.simT;
    const marks = {};
    for (const want of [0.25, 0.5, 1.0]) {
      let guard = 0;
      while (R.st.boostLeft < want - 0.001 && guard++ < 400) await sim(0.2);
      marks[want] = R.st.simT - t0;
    }
    out.refill = marks;
  }

  // ---- 3. NO REFILL IN THE GRASS ------------------------------------------
  R.st.boostLeft = 0.2;
  R.tune.holdX = ROAD_W + 0.6 * (STRAY - ROAD_W);
  await sim(6);
  out.grass = { after: R.st.boostLeft, off: R.st.off };
  R.tune.holdX = 0;
  await sim(2);
  out.backOnRoad = R.st.boostLeft;

  // ---- 4. THE LATCH: hold the button down with an empty bottle ------------
  R.st.boostLeft = 0; R.pedal.boost = true;
  R.tune.holdX = 0;
  {
    let flips = 0, was = null, samples = 0, everAbove = 0;
    await watch(5, () => {
      samples++;
      if (R.st.boostLeft > everAbove) everAbove = R.st.boostLeft;
      const live = R.st.boostLeft > 0.0001;
      if (was !== null && live !== was) flips++;
      was = live;
    });
    out.latch = { flips, samples, peak: everAbove };
  }
  R.pedal.boost = false;

  // ---- 5. A FRESH GRID GETS A FULL BOTTLE ---------------------------------
  R.st.boostLeft = 0.13;
  R.startRace();
  out.onGrid = R.st.boostLeft;
  await sim(0.5);
  out.duringCountdown = R.st.boostLeft;

  // ---- 6. WHAT A LAP'S WORTH LOOKS LIKE -----------------------------------
  // Steady state: boost for t of every lap, recharge for the rest.
  out.consts = { drain: R.consts.BOOST_DRAIN, refill: R.consts.BOOST_REFILL,
                 arm: R.consts.BOOST_ARM, top: R.consts.BOOST_TOP,
                 maxSpeed: R.tune.maxSpeed };
  R.tune.holdX = null; R.tune.holdBoost = null;
  return out;
});

// ---- 7. DOES THE GAUGE ACTUALLY READ THE GAME? --------------------------
//
// Everything above measures a NUMBER. tools/nosdash.mjs measures the NEEDLE,
// in pixels, at 1440x720 — but it pins `boostLeft` itself before drawing. So
// between them the two rigs prove that the sim has a bottle and that the dial
// can draw one, and NEITHER proves the wire between them exists. Delete the one
// line in main.js that copies st.boostLeft onto the cockpit state and both stay
// green.
//
// This closes that gap by driving for real — no pinned bottle, the boost held
// down until it runs out — and reading the nitrous needle's own vertices out of
// the geometry buffer as it goes. The needle has to travel, and it has to
// travel in step with the bottle.
//
// IT IS NOT DONE BY DIFFERENCING SCREENSHOTS, which is what this check tried
// first and what took three attempts to get honest. The frozen dash is not
// still: the lap clock counts, and at the limiter the tacho needle blinks. Two
// versions of the pixel check reported a "needle" that was four LCD digits, and
// the negative control that caught it was itself broken, because collapsing the
// needle's quad does not last — the cockpit rewrites those vertices on the very
// next frame. Reading the vertices directly has none of those failure modes and
// is exact rather than approximate. What it does NOT cover is the last step,
// mesh to glass; nosdash photographs that. The two meet at the geometry buffer.
const wireCheck = await p.evaluate(async () => {
  const R = window.RACER;
  const sim = (secs) => new Promise((done, fail) => {
    const t = R.st.simT + secs, give = performance.now() + secs * 12000 + 15000;
    const step = () => {
      if (R.st.simT >= t) return done();
      if (performance.now() > give) return fail(new Error('stalled'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  // The centroid of the needle's quad, in the cockpit's own local units.
  const tip = () => {
    const q = R.cockpit.stats.q.nos;
    const a = R.cockpit.group.children[0].geometry.getAttribute('position').array;
    let x = 0, y = 0;
    for (let k = 0; k < 4; k++) { x += a[(q * 4 + k) * 3]; y += a[(q * 4 + k) * 3 + 1]; }
    return { x: x / 4, y: y / 4 };
  };

  R.startRace();
  await sim(R.consts.COUNTDOWN + 0.4);
  R.tune.holdX = 0; R.tune.holdBoost = null;
  R.st.gear = 4; R.st.speed = R.tune.maxSpeed; R.st.boostLeft = 1;
  R.pedal.brake = false; R.pedal.boost = true;

  const samples = [];
  for (let i = 0; i < 12; i++) {
    await sim(0.9);
    samples.push({ left: R.st.boostLeft, ...tip() });
  }

  // NEGATIVE CONTROL. The same run with the bottle PINNED: the boost is being
  // held down, the car is doing the same thing, and the only difference is that
  // st.boostLeft no longer changes. If the needle moves anyway it is following
  // the speed, or the revs, or the clock — and the run above proved nothing.
  // SETTLE BEFORE SAMPLING. The needle is damped, and the pin jumps the bottle
  // from empty back to full — so the first samples would catch it still flying
  // across the dial, which is the needle doing its job and would read here as
  // the control failing. Three seconds is a dozen time constants.
  R.st.boostLeft = 1; R.tune.holdBoost = 1;
  await sim(3);
  const pinned = [];
  for (let i = 0; i < 6; i++) {
    await sim(0.9);
    pinned.push({ left: R.st.boostLeft, ...tip() });
  }
  R.tune.holdBoost = null;
  R.pedal.boost = false;
  R.tune.holdX = null;
  return { samples, pinned };
});
await b.close();

// WHAT INVARIANT IS ACTUALLY TRUE OF THIS NEEDLE? Not "x moves one way" — a
// needle sweeps, so x turns round at the bottom of the arc, and the first
// version of this check called a working gauge broken for exactly that. Not
// "the centroid lies on a circle" either, which was the second version: the
// needle is drawn from a rotated cell on the atlas and its quad is sized to
// bound that cell, so the centroid traces something flatter than a circle and
// a least-squares fit put the radius 54% out. Both of those were models of a
// needle I had invented rather than measured.
//
// What IS true, of an arc and of any smooth sweep whatever its shape: the path
// never doubles back. Consecutive steps point the same way (positive dot
// product) and turn the same way (same-signed cross product). That needs no
// pivot, no radius and no assumption about how the dial is drawn, and it still
// fails loudly for the two things worth catching — a needle that does not move,
// and a needle that jitters at random instead of tracking the bottle.
const live = wireCheck.samples;
const first = live[0], last = live[live.length - 1];
const travel = Math.hypot(last.x - first.x, last.y - first.y);
const drained = first.left - last.left;

let path = 0, reversals = 0, turnFlips = 0, turnDeg = 0;
{
  const steps = [];
  for (let i = 1; i < live.length; i++) {
    const dx = live[i].x - live[i - 1].x, dy = live[i].y - live[i - 1].y;
    path += Math.hypot(dx, dy);
    // Steps from after the bottle hits zero are noise about a parked needle and
    // have no direction worth reading. One thousandth of the path is the floor.
    if (Math.hypot(dx, dy) > 1e-4) steps.push({ dx, dy });
  }
  let turnSign = 0;
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1], b2 = steps[i];
    if (a.dx * b2.dx + a.dy * b2.dy < 0) reversals++;
    const cross = a.dx * b2.dy - a.dy * b2.dx;
    const sgn = Math.sign(cross);
    if (sgn !== 0) { if (turnSign !== 0 && sgn !== turnSign) turnFlips++; turnSign = sgn; }
    const la = Math.hypot(a.dx, a.dy), lb = Math.hypot(b2.dx, b2.dy);
    if (la > 0 && lb > 0) {
      turnDeg += Math.abs(Math.asin(Math.max(-1, Math.min(1, cross / (la * lb))))) * 180 / Math.PI;
    }
  }
}

const c = r.consts;
// Steady state over a lap: boost for t, recharge for the rest, t/drain =
// (lap - t)/refill.
const lap = 60;
const share = lap / (1 + c.refill / c.drain);

const rows = [];
const say = (name, val, note = '') => rows.push([name, val, note]);
say('a full bottle lasts', `${r.drain.secs === null ? '\u2014' : r.drain.secs.toFixed(1)}s`,
    `spec ${c.drain}s`);
say('top speed reached on it', `${r.drain.topReached.toFixed(0)} mph`,
    `unboosted cap ${(c.maxSpeed * 0.9633).toFixed(0)}, boosted ceiling ${(c.maxSpeed * c.top * 0.9633).toFixed(0)}`);
say('empty to a quarter', `${r.refill[0.25].toFixed(1)}s`, 'usable again after this');
say('empty to half', `${r.refill[0.5].toFixed(1)}s`, '');
say('empty to full', `${r.refill[1].toFixed(1)}s`, `spec ${c.refill}s`);
say('6s parked in the grass', `${r.grass.after.toFixed(3)} left`,
    `started at 0.200, off ${r.grass.off.toFixed(2)}`);
say('2s back on the tarmac', `${r.backOnRoad.toFixed(3)} left`, 'refill resumes');
say('button held on empty', `${r.latch.flips} flips in ${r.latch.samples} frames`,
    `peak refill ${r.latch.peak.toFixed(4)} — must stay under the ${c.arm} arm point`);
say('on a fresh grid', `${r.onGrid.toFixed(2)}`, 'must be 1.00');
say('held on the line', `${r.duringCountdown.toFixed(2)}`, 'must not drain before the lights');
say('boost per 60s lap', `${share.toFixed(0)}s`, `${(share / lap * 100).toFixed(0)}% of the lap`);

console.log('\n  THE NITROUS BOTTLE\n');
for (const [n, v, note] of rows) {
  console.log(`   ${n.padEnd(26)} ${String(v).padStart(22)}   ${note}`);
}

console.log('\n  AND THE WIRE FROM THE SIM TO THE GLASS\n');
console.log('   the boost held down for a real run, needle read off the mesh\n');
console.log('     bottle    needle x     needle y');
for (const s2 of live) {
  console.log(`     ${s2.left.toFixed(3).padStart(6)}   ${s2.x.toFixed(4).padStart(9)}   ${s2.y.toFixed(4).padStart(9)}`);
}
let pinnedPath = 0;
for (let i = 1; i < wireCheck.pinned.length; i++) {
  pinnedPath += Math.hypot(wireCheck.pinned[i].x - wireCheck.pinned[i - 1].x,
                           wireCheck.pinned[i].y - wireCheck.pinned[i - 1].y);
}
console.log(`\n   the bottle fell ${drained.toFixed(3)}; the needle travelled ${path.toFixed(4)} units ` +
            `along its path, ending ${travel.toFixed(4)} from where it started`);
console.log(`   it doubled back on ${reversals} step(s)   (must be 0)`);
console.log(`   it swept ${turnDeg.toFixed(0)} degrees, changing its direction of turn ${turnFlips} time(s)   (must be 0)`);
console.log(`\n   NEGATIVE CONTROL, bottle pinned while the boost is still held down`);
console.log(`   the needle travelled ${pinnedPath.toFixed(4)} units   ` +
            `(must be ~0, against ${path.toFixed(4)} live)`);

const fails = [];
const near = (got, want, tol) => Math.abs(got - want) <= tol;
if (r.drain.secs === null) fails.push('the bottle never emptied while the boost was held down');
else if (!near(r.drain.secs, c.drain, c.drain * 0.15))
  fails.push(`drain took ${r.drain.secs.toFixed(1)}s, spec says ${c.drain}s`);
if (!near(r.refill[1], c.refill, c.refill * 0.2))
  fails.push(`refill took ${r.refill[1].toFixed(1)}s, spec says ${c.refill}s`);
if (r.grass.after > 0.2005)
  fails.push(`the bottle refilled in the grass: 0.200 -> ${r.grass.after.toFixed(3)}`);
if (r.backOnRoad <= r.grass.after)
  fails.push('the bottle did not resume refilling back on the tarmac');
if (r.latch.flips > 0)
  fails.push(`the boost flickered ${r.latch.flips} times on an empty bottle — the latch is not holding`);
if (r.latch.peak >= c.arm)
  fails.push(`an empty bottle crept to ${r.latch.peak.toFixed(4)}, past the ${c.arm} arm point, with the button held`);
if (r.onGrid !== 1) fails.push(`a fresh grid started with ${r.onGrid} in the bottle, not 1`);
if (r.duringCountdown !== 1) fails.push(`the bottle drained to ${r.duringCountdown} during the countdown`);
// The bottle has to last long enough to be worth having: if it empties before
// the car has got most of the way to the boosted ceiling, the boost is a tease.
const reach = r.drain.topReached / (c.maxSpeed * c.top * 0.9633);
if (reach < 0.9) fails.push(`one bottle only reaches ${(reach * 100).toFixed(0)}% of the boosted top speed`);
if (drained < 0.5)
  fails.push(`the live run only used ${drained.toFixed(2)} of the bottle, so the needle was never asked to move far`);
if (path < 1e-3)
  fails.push('the needle did not move while the bottle emptied for real — ' +
             'the gauge is not wired to the sim');
// A NEEDLE THAT TWITCHES AT RANDOM would satisfy "did anything move". It has to
// track the bottle, which means never going back the way it came while the
// bottle is only ever falling.
if (reversals > 0)
  fails.push(`the needle doubled back on ${reversals} step(s) while the bottle was only ever ` +
             `emptying — it is following something other than the bottle`);
if (turnFlips > 0)
  fails.push(`the needle changed its direction of turn ${turnFlips} time(s) over one continuous ` +
             `drain — a sweep does not do that`);
if (turnDeg < 60)
  fails.push(`the needle swept only ${turnDeg.toFixed(0)} degrees for a nearly full bottle`);
if (pinnedPath > path * 0.02)
  fails.push(`with the bottle pinned the needle still moved ${pinnedPath.toFixed(4)} units, ` +
             `${(100 * pinnedPath / path).toFixed(0)}% of the live sweep — it is not reading the bottle`);

console.log('');
if (fails.length) { for (const f of fails) console.log(`  FAIL  ${f}`); process.exit(1); }
console.log('  the bottle behaves');
