// Boot the built file in a real browser and assert the things that have
// actually gone wrong on this project, rather than the things that are easy to
// assert.
//
// THE HISTORY THIS IS ANSWERING. On the last project 82 tests were green while
// the shipped build would not open, because nothing ever loaded the real file
// in a real browser. And the one input bug that reached the player's hands was
// being actively asserted as correct by its own test. So this does two things
// that a unit test cannot: it loads docs/index.html exactly as a phone would,
// and it drives the car with an autopilot to find out whether the track can be
// driven at all.

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// EVERY CHECK IN HERE IS ABOUT A TRACK — the corner margins, the elevation
// cliffs, the autopilot, the draw-call budget — and there is more than one
// track now. Passing on MIDNIGHT MILE says nothing about the Docks, and the
// checks that matter most are exactly the ones a new road can break.
//   node tools/check.mjs            the night city
//   node tools/check.mjs docks      the Docks
const TRACK = process.argv[2] || '';
const FILE = 'file://' + join(ROOT, 'docs', 'index.html') + (TRACK ? '?track=' + TRACK : '');

const fails = [];
const ok = (cond, label, detail = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${detail ? '   ' + detail : ''}`);
  if (!cond) fails.push(label);
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
// A phone-shaped landscape viewport, because that is how a racer is held.
const page = await browser.newPage({ viewport: { width: 1008, height: 420 } });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(FILE, { waitUntil: 'load' });
await page.waitForTimeout(1500);

// DROP THE PIXEL RATIO FOR THE WHOLE SUITE. The shipped default is now 2.0,
// chosen from a phone measurement showing that 78% more pixels cost a tenth of
// a millisecond there. This container has no GPU at all, so the same setting
// quadruples the software rasteriser's work and the autopilot — which is bounded
// by wall clock, because a hung run must not hang the suite — covered 4,560 of
// its 9,000 units before the guard fired. Nothing here measures fill rate, so
// nothing here should pay for it.
await page.evaluate(() => { if (window.RACER) window.RACER.renderer.setPixelRatio(0.6); });

// AND LET THE CAR OFF THE LINE, FOR THE WHOLE SUITE.
//
// The race state machine pins the speed to zero in 'grid' and in 'countdown',
// and every test below drives st directly without ever touching a control — so
// from the day the lights were added the autopilot covered 0 of its 9,000
// units and reported the track as undriveable, and four more tests failed
// behind it. Nothing here was measuring the track any more; it was measuring
// the start lights.
//
// A PIN RATHER THAN ONE ASSIGNMENT. Setting the state once is not enough: the
// physics tests below drive far enough to cross the finish line, at which
// point the race goes to 'done', restarts itself six seconds later and pins
// the car again in the middle of whatever is being measured. This holds it in
// 'racing' for the duration of the suite. No test here asserts anything about
// the race, so nothing is being hidden by it — the race's own states are
// photographed and measured by tools/racedash.mjs.
await page.evaluate(() => {
    // GET THE LANDING PAGE OUT OF THE WAY. It is a DOM layer over the canvas,
    // so a page screenshot photographs the menu rather than the game — which
    // is exactly how it blinded two of these tools the day it shipped. Tools
    // that read the WebGL buffer with gl.readPixels never saw the problem,
    // because the menu is not in that buffer.
    if (window.RACER.menu) window.RACER.menu.close();
  const R = window.RACER;
  const hold = () => {
    if (R.race.state !== 'racing') { R.race.state = 'racing'; R.race.t = 0; }
    requestAnimationFrame(hold);
  };
  requestAnimationFrame(hold);
});

// ---- 1. does it boot at all -------------------------------------------------
const booted = await page.evaluate(() => !!window.RACER);
ok(booted, 'boots and exposes RACER');
if (!booted) { console.log(errors.join('\n')); await browser.close(); process.exit(1); }

ok(errors.length === 0, 'no console errors or page errors', errors.join(' | '));

// ---- 2. is anything actually being drawn ------------------------------------
// "It rendered" is not "you can see it". A scene that draws nothing still
// reports a healthy frame rate, which is how six pieces of invisible geometry
// shipped on the last project.
const drew = await page.evaluate(() => {
  const i = window.RACER.renderer.info.render;
  return { calls: i.calls, tris: i.triangles };
});
ok(drew.calls > 0 && drew.tris > 100, 'geometry reaches the GPU',
   `${drew.calls} calls, ${drew.tris} tris`);

// ---- 3. the handling arithmetic ---------------------------------------------
// TWO CLAIMS, NOT ONE, and getting only the first of them right is what caused
// the last two rounds of this:
//   every speed must be driveable WITH THE BRAKE   (or the track is broken)
//   some speed must NOT be driveable without it    (or the game plays itself)
const h = await page.evaluate(() => window.RACER.handling);
const K = await page.evaluate(() => window.RACER.consts);
console.log(`\n  worst curvature ${h.worst.toFixed(4)}   centrifugal ${h.cent.toFixed(4)}`);
for (const m of h.margins) {
  const braked = m.margin * K.BRAKE_GRIP;
  ok(braked >= 1.05, `speed ${String(m.speed).padStart(3)} can be held on the brake`,
     `${m.margin.toFixed(2)} on throttle, ${braked.toFixed(2)} braking`);
}
const demanding = h.margins.filter((m) => m.margin < 1.0);
ok(demanding.length > 0, 'the top of the speed dial demands the brake',
   demanding.length ? `braking required at ${demanding.map((m) => m.speed).join(', ')}`
                    : 'every speed holdable on the throttle — nothing to master');

// ---- 3b. THE TRACK ITSELF MUST BE CONTINUOUS --------------------------------
// Elevation used to ease from 0 up to h across a feature and then the NEXT
// feature started from 0 again — a 24.8-unit cliff, 25 times per lap. Driving
// off one was reported as "a flash to the flat track, doesn't feel like I went
// up at all, more like I went through the ramp", which is exactly what it is:
// the climb gets retracted between one segment and the next. Curvature never
// had the bug because it uses sin(pi*t) and returns to zero on its own;
// elevation is a position rather than a rate, so it has to carry forward.
const prof = await page.evaluate(() => {
  const t = window.RACER.track;
  let worst = 0, at = 0, over = 0, lo = 1e9, hi = -1e9;
  for (let i = 1; i < t.n; i++) {
    const d = Math.abs(t.hill[i] - t.hill[i - 1]);
    if (d > worst) { worst = d; at = i; }
    if (d > 2) over++;
    if (t.hill[i] < lo) lo = t.hill[i];
    if (t.hill[i] > hi) hi = t.hill[i];
  }
  return { worst, at, over, seam: Math.abs(t.hill[t.n - 1] - t.hill[0]), lo, hi };
});
console.log('');
ok(prof.worst < 2, 'no cliffs in the elevation profile',
   `worst step ${prof.worst.toFixed(2)} units between adjacent segments`);
ok(prof.over === 0, 'no segment steps over 2 units', `${prof.over} found`);
ok(prof.seam < 0.5, 'the loop seam is closed',
   `${prof.seam.toFixed(2)} units between last segment and first`);
console.log(`       (elevation runs ${prof.lo.toFixed(0)} to ${prof.hi.toFixed(0)})`);

// ---- 4. THE AUTOPILOT -------------------------------------------------------
// The real question is not "is the margin above 1" — that is arithmetic I could
// get wrong twice. It is "can something actually drive this". So: a dumb
// proportional controller, no lookahead, no skill, deliberately worse than a
// human. If it stays on the road for a lap, a person can. If it cannot, the
// track is broken regardless of what the margins say.
//
// Run at the HIGHEST speed step, which is the hardest case. The autopilot may
// brake, because a driver may brake — the design intent is that the top speed
// steps REQUIRE it through the hard corners.
// MEASURED OVER A FIXED STRETCH OF TRACK, NOT A FIXED NUMBER OF SECONDS.
// A time-boxed run covers a different set of corners every time depending on
// how fast the software renderer happens to be that minute, and the first
// version of this test duly gave 15.0 on one run and 10.5 on the next. Bounding
// it by distance makes the SAME corners get driven every time.
// ---- THE RACE HOLD, WHICH BROKE FOUR OF THESE TESTS ------------------------
//
// main.js kills the throttle and pins st.speed at zero while race.state is
// 'grid' or 'countdown' — deliberately, so a launch cannot depend on an engine
// pulling against a brake. The game boots in 'grid'. So every test below that
// writes st.speed and then expects the car to move was, from the moment the
// race state machine landed, measuring a car being held on the line: the
// autopilot covered 0 of 9,000 units and the hands-off test reported a worst
// offset of 0.0, which reads exactly like a track that cannot be driven and a
// car that steers itself perfectly. Both were true only because nothing moved.
//
// Confirmed against the commit before the gantries went in: identical
// failures, so this is the state machine's own regression and not the
// scenery's. The fix belongs here rather than in main.js — the hold is correct
// behaviour and a harness that wants to drive has to take the car off the grid
// first, which is what a player does by pressing go.
const DRIVE_FROM = 0;
const DRIVE_LEN = 9000;                          // 1500 segments, a good sample
const runDrive = (mayBrake) => page.evaluate(async ({ canBrake, from, len }) => {
  const R = window.RACER;
  const ROAD_W = R.consts.ROAD_W;
  R.race.state = 'racing';                       // off the grid, or nothing moves
  R.tune.si = 5; R.tune.maxSpeed = 300;          // hardest setting
  R.tilt.on = true;                              // pretend a phone is tilting
  // TOP GEAR, or the limiter holds the car at 30% of the speed this test exists
  // to drive the track at. Setting st.speed alone used to be enough; with a
  // gearbox, a speed without a gear is a speed the car will immediately refuse.
  R.st.x = 0; R.st.dist = from; R.st.speed = 300; R.st.gear = 4;
  let offMax = 0, offFrames = 0, frames = 0, braked = 0, sum = 0;
  const wall = performance.now();
  return await new Promise((resolve) => {
    const step = () => {
      const x = R.st.x;
      // Proportional controller: steer towards the middle of the road, hard.
      // Deliberately less skilled than a person — no lookahead at all.
      R.tilt.out = Math.max(-1, Math.min(1, -x / 4));
      // A driver brakes when the car is running wide.
      R.pedal.brake = canBrake && Math.abs(x) > 4.5;
      if (R.pedal.brake) braked++;
      const a = Math.abs(x);
      if (a > offMax) offMax = a;
      if (a > ROAD_W) offFrames++;
      sum += a; frames++;
      // THE WALL-CLOCK GUARD IS 240s, NOT 60. It exists so a hung run cannot hang
      // the suite, not to bound the test — the test is bounded by DISTANCE on
      // purpose, so the same corners get driven every time. The city got a great
      // deal heavier this round and this container has no GPU, so 60s began
      // cutting the run off at 5,850 of 9,000 units and reporting a track fault
      // that was really a rasteriser speed. A guard that fires in normal
      // operation is not a guard, it is a second hidden test with a worse name.
      const done = R.st.dist - from >= len || performance.now() - wall > 240000;
      if (done) {
        R.pedal.brake = false;
        resolve({ offMax, offFrames, frames, braked, mean: sum / frames,
                  covered: R.st.dist - from });
      } else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}, { canBrake: mayBrake, from: DRIVE_FROM, len: DRIVE_LEN });

const drive = await runDrive(true);
console.log('');
ok(drive.covered >= DRIVE_LEN * 0.99, 'autopilot drove the whole stretch',
   `${drive.covered.toFixed(0)} of ${DRIVE_LEN} units in ${drive.frames} frames`);
ok(drive.offMax <= K.ROAD_W, 'autopilot never leaves the road',
   `worst offset ${drive.offMax.toFixed(2)} of ${K.ROAD_W}`);
ok(drive.offFrames === 0, 'no frames off the road',
   `${drive.offFrames} of ${drive.frames}`);
console.log(`       (mean offset ${drive.mean.toFixed(2)}, braked on ` +
            `${(100 * drive.braked / drive.frames).toFixed(0)}% of frames)`);

// ---- 4b. HANDS OFF — THE GAME MUST NOT PLAY ITSELF --------------------------
// The mirror image of the test above, and the one that caught the last bug.
// With the centrifugal constant too weak the car tracked the road on its own:
// 25 seconds of no input at top speed drifted to a worst offset of 9.2 against
// a road edge of 9.0, so it never left. Reported from the phone as "place the
// phone against the laptop so no steering and it stays on the track, steers
// itself?!?". If nobody is driving, the car must end up in the scenery.
// Same stretch of track as the autopilot above, so the two are comparable.
const idle = await page.evaluate(async ({ from, len }) => {
  const R = window.RACER;
  const ROAD_W = R.consts.ROAD_W;
  R.race.state = 'racing';                       // off the grid, or nothing moves
  R.tune.si = 5; R.tune.maxSpeed = 300;
  R.tilt.on = true; R.tilt.out = 0;
  // TOP GEAR, or the limiter holds the car at 30% of the speed this test exists
  // to drive the track at. Setting st.speed alone used to be enough; with a
  // gearbox, a speed without a gear is a speed the car will immediately refuse.
  R.st.x = 0; R.st.dist = from; R.st.speed = 300; R.st.gear = 4;
  R.pedal.brake = false; R.pedal.boost = false;
  let offMax = 0, off = 0, frames = 0, sum = 0;
  const wall = performance.now();
  return await new Promise((resolve) => {
    const step = () => {
      R.tilt.out = 0;                            // hands off, every frame
      const a = Math.abs(R.st.x);
      if (a > offMax) offMax = a;
      if (a > ROAD_W) off++;
      sum += a; frames++;
      if (R.st.dist - from >= len || performance.now() - wall > 240000) {
        resolve({ offMax, off, frames, mean: sum / frames });
      } else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}, { from: DRIVE_FROM, len: DRIVE_LEN });
// THRESHOLDS SET BELOW WHAT WAS MEASURED, NOT AT IT. Measured on the fixed
// 9000-unit stretch: worst 15.0, mean 8.0, off the road 29% of frames. The bars
// are set with headroom underneath so an honest retune does not trip them, but
// a slide back toward self-steering does. If these ever fail, do not lower
// them — that is the trap this project already fell into once, where the smoke
// suite asserted the bug rather than the behaviour.
// ASSERT AGAINST THE CLAMP, NOT AGAINST A NUMBER I PICKED ONCE.
//
// This used to require a worst offset above ROAD_W * 1.3 = 11.7, which was
// calibrated when the car could stray to 15. The stray limit is now 11.1 —
// tightened because the first-person eye was ending up inside a building — so
// the old bar became unreachable by construction and the test failed for a
// reason that had nothing to do with the behaviour it exists to protect.
//
// The invariant that actually matters is "hands off, the car ends up as far
// off as it is allowed to get", which is clamp-relative and cannot rot the
// next time the limit moves. Lowering the old number to make it pass would
// have been the trap this suite already warns about.
ok(idle.offMax > K.STRAY_MAX * 0.97,
   'hands off, the car runs all the way to the stray limit',
   `worst offset ${idle.offMax.toFixed(1)} of a possible ${K.STRAY_MAX}, road edge ${K.ROAD_W}`);
ok(idle.mean > K.ROAD_W / 2, 'hands off, the average position is outside the middle lane',
   `mean offset ${idle.mean.toFixed(1)} vs road edge ${K.ROAD_W}`);
// Was 29% of frames when the car could wander to 15; a tighter clamp bounds
// how far each excursion travels, so it crosses the edge less often. The claim
// under test — that not driving is meaningfully worse than driving — is carried
// by the mean offset and the ratio below, both of which are unchanged.
ok(idle.off / idle.frames > 0.12, 'hands off, it is off the road much of the time',
   `${(100 * idle.off / idle.frames).toFixed(0)}% of frames`);
ok(idle.mean > drive.mean * 2, 'driving is meaningfully better than not driving',
   `mean offset ${idle.mean.toFixed(2)} hands off vs ${drive.mean.toFixed(2)} driving`);

// ---- 5. THE TOP SPEED IS ACTUALLY REACHABLE ---------------------------------
// This test exists because it failed. The old model balanced a constant push
// against a quadratic drag, which meet well below the stated cap — the car
// topped out at 145 against a "top speed" of 210, so the upper half of the
// speed dial did almost nothing. A dial that does not move the thing it names
// is worse than no dial, because it sends the player looking for the problem
// somewhere else.
const reach = await page.evaluate(async () => {
  const R = window.RACER;
  // Wait SIMULATED seconds, not wall-clock ones. The frame loop clamps dt at
  // 0.1s so a backgrounded tab cannot teleport the car down the road; the side
  // effect is that below 10fps — which this container's software GL does under
  // a full city — the sim falls behind the clock. Waiting nine real seconds and
  // then asserting the car reached its cap measured the GPU, not the physics,
  // and failed at 79% on a working build for exactly that reason.
  const settle = (secs) => new Promise((done, fail) => {
    const target = R.st.simT + secs;
    const giveUp = performance.now() + secs * 8000 + 10000;
    const poll = () => {
      // EVERY FRAME, not once at the top. A long pull crosses the finish line,
      // which puts the race into 'done' and six seconds later calls startRace()
      // — and startRace resets st.dist AND st.speed. A speed measurement that
      // silently restarts halfway through reports the acceleration of the last
      // two seconds as the top speed of the car.
      R.race.state = 'racing';
      if (R.st.simT >= target) return done();
      if (performance.now() > giveUp) return fail(new Error('sim clock stalled'));
      requestAnimationFrame(poll);
    };
    poll();
  });
  // NOW IT HAS TO DRIVE THROUGH THE GEARBOX TO GET THERE, which is a better test
  // than the one it replaces. "The top speed is reachable" should mean
  // "reachable by driving the car properly", not "reachable by holding the
  // throttle on an ungeared engine". A gearbox that could not reach the car's
  // own top speed would be a serious bug and nothing else here would catch it.
  // PIN IT ON THE TARMAC. This measures the ENGINE, and since the off-road
  // penalty landed a car left to itself drifts onto the verge during a long
  // pull and gets slowed by scenery — which reported "speed 300 reachable" at
  // 69% and looked like a broken gearbox. Third instrument invalidated by that
  // one change; the steering tests below deliberately do NOT pin it.
  R.tune.holdX = 0;
  const out = [];
  for (const si of [0, 3, 5]) {
    R.tune.si = si; R.tune.maxSpeed = [110, 140, 170, 210, 250, 300][si];
    R.st.speed = 0; R.st.gear = 0;
    R.pedal.brake = false; R.pedal.boost = false;
    let guard = 0;
    while (guard++ < 120) {
      await settle(0.5);
      if (R.st.rev >= 0.9 && R.st.gear < 4) R.st.gear++;
      if (R.st.gear === 4 && R.st.speed > R.tune.maxSpeed * 0.94) break;
    }
    out.push({ cap: R.tune.maxSpeed, got: R.st.speed, gear: R.st.gear + 1 });
  }
  R.tune.holdX = null;
  return out;
});
for (const r of reach) {
  ok(r.got > r.cap * 0.93, `speed ${String(r.cap).padStart(3)} reachable through the box`,
     `got ${r.got.toFixed(0)} (${(100 * r.got / r.cap).toFixed(0)}%) in gear ${r.gear}`);
}

// ---- 6. the pedals ----------------------------------------------------------
// "There is a brake" and "the brake works" are different claims.
const pedals = await page.evaluate(async () => {
  const R = window.RACER;
  // Wait SIMULATED seconds, not wall-clock ones. The frame loop clamps dt at
  // 0.1s so a backgrounded tab cannot teleport the car down the road; the side
  // effect is that below 10fps — which this container's software GL does under
  // a full city — the sim falls behind the clock. Waiting nine real seconds and
  // then asserting the car reached its cap measured the GPU, not the physics,
  // and failed at 79% on a working build for exactly that reason.
  const settle = (secs) => new Promise((done, fail) => {
    const target = R.st.simT + secs;
    const giveUp = performance.now() + secs * 8000 + 10000;
    const poll = () => {
      // EVERY FRAME, not once at the top. A long pull crosses the finish line,
      // which puts the race into 'done' and six seconds later calls startRace()
      // — and startRace resets st.dist AND st.speed. A speed measurement that
      // silently restarts halfway through reports the acceleration of the last
      // two seconds as the top speed of the car.
      R.race.state = 'racing';
      if (R.st.simT >= target) return done();
      if (performance.now() > giveUp) return fail(new Error('sim clock stalled'));
      requestAnimationFrame(poll);
    };
    poll();
  });
  R.tune.holdX = 0;                     // engine test, not a steering test
  R.tune.si = 3; R.tune.maxSpeed = 210;
  R.st.gear = 4;                        // the boost claim is about TOP gear
  R.pedal.brake = false; R.pedal.boost = false;
  await settle(4);
  const cruise = R.st.speed;
  R.pedal.brake = true; await settle(0.7);
  const braked = R.st.speed;
  R.pedal.brake = false; R.pedal.boost = true; await settle(4);
  const boosted = R.st.speed;
  R.pedal.boost = false;
  R.tune.holdX = null;
  return { cruise, braked, boosted, cap: R.tune.maxSpeed };
});
ok(pedals.braked < pedals.cruise - 20, 'brake slows the car',
   `${pedals.cruise.toFixed(0)} -> ${pedals.braked.toFixed(0)}`);
ok(pedals.boosted > pedals.cap * 1.05, 'boost exceeds the normal top speed',
   `${pedals.boosted.toFixed(0)} vs cap ${pedals.cap}`);

// ---- 7. draw calls AT THE WORST MOMENT, not the easiest ---------------------
// This measured with scenery at zero and reported "15 of 16 — ok" while the
// game in actual play, with scenery maxed, sat at exactly 16 and had no
// headroom at all. A budget check that samples the cheapest frame is not a
// budget check. Wind everything up first: scenery to the cap, top speed, and
// both views, and take the worst number any of them produces.
const sc = await page.evaluate(async () => {
  const R = window.RACER;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  for (let i = 0; i < 24; i++) document.getElementById('bUp').click();
  R.race.state = 'racing';
  R.tune.si = 5; R.tune.maxSpeed = 300; R.st.speed = 300;
  // PARK IT WHERE THE FRAME IS MOST EXPENSIVE, which is now on the run-in to a
  // gantry: the structure and its banner are two more calls, and they are only
  // spent when one of the two lines is inside the draw distance. Left to
  // whatever position the previous test happened to end at, this sampled a
  // gantry frame by luck on one run and an open-road frame on the next, which
  // is a budget check that reports a different budget each time.
  R.st.dist = R.consts.RACE_FROM + R.consts.RACE_LEN - 60;
  let max = 0, at = '';
  for (const view of [3, 1]) {
    R.st.view = view;
    for (let i = 0; i < 8; i++) {
      await frame();
      const c = R.renderer.info.render.calls;
      if (c > max) { max = c; at = `${view === 3 ? 'third' : 'first'} person, scenery ` +
        `${R.scenery ? R.scenery.count : 'max'}, gantry ${R.gantry ? R.gantry.stats.at : 'n/a'}`; }
    }
  }
  return { max, at, scenery: document.getElementById('hud') ? null : null };
});
// THE DRAW CALL BUDGET, itemised, because "keep it low" is not a budget:
//   road 1 · posts 1 · scenery 1 + 1 ink · car 2 + 1 ink · cockpit 2 + 1 ink
//   · gantry 1 + 1 banner
// which is 12, and 16 leaves room to be wrong about one of them. The
// placeholder box car spends 5 on itself and 5 more on its ink; the real car
// must merge by material so body and ink are three calls between them.
ok(sc.max <= 16, 'draw calls stay inside the budget at the WORST moment',
   `${sc.max} of 16, worst at ${sc.at}`);

// ---- 8. a picture, because numbers have lied on this project before ---------
await page.evaluate(() => {
  const R = window.RACER;
  R.tilt.out = 0;
  R.race.state = 'racing';
  R.st.speed = 205; R.st.gear = 4;
});
await page.waitForTimeout(600);
await page.screenshot({ path: join(ROOT, 'shot.png') });
console.log('\n  wrote shot.png');

await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.join(', ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
