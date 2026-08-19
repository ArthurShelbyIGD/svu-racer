// DO THE DOCKS' SET PIECES DO WHAT THEY CLAIM?
//
// Three shapes cut into the elevation profile — a ferry, a quay jump and an
// underpass — and between them they make four claims that are all easy to get
// wrong and all invisible until someone drives into the sea:
//
//   1. THE TWO JUMPS ARE CLEARABLE AT RACING SPEED and NOT clearable if you
//      arrive slowly. A jump you cannot fail is scenery; one you cannot make
//      is a wall. bridge.js's own ballistics were right on paper and the
//      airborne integration was WRONG THREE TIMES before it matched them, so
//      the paper is not the test — driving it is.
//
//   2. THE UNDERPASS DOES NOT LAUNCH THE CAR. It is the one set piece meant to
//      keep you glued down, and the physics launches from any crest where the
//      road falls away faster than gravity, whether anyone intended a jump or
//      not. Its exit is eased for exactly this reason and the easing is a
//      calculation, which means it can be wrong.
//
//   3. NEITHER DOES THE SHORE RAMP ONTO THE FERRY. Same failure, and worse:
//      a car launched going ONTO the deck lands inside a ship.
//
//   4. AND NOTHING HAS A CLIFF IN IT. check.mjs asserts no two adjacent
//      segments differ by more than two units; these add up to nineteen units
//      of height in places and the descent across a gap has to be spread.
//
// Every run drives the real car through the real physics from a real distance
// before the feature, at a pinned speed, and reports what happened. Nothing
// here reads the arithmetic in docks.js — that would be marking my own
// homework twice.
//
//   node tools/docks.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const p = await b.newPage({ viewport: { width: 420, height: 240 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('file://' + __j(ROOT, 'docs', 'index.html') + '?track=docks', { waitUntil: 'load' });
await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
await p.evaluate(() => { window.RACER.menu.close(); window.RACER.renderer.setPixelRatio(0.3); });

const sites = await p.evaluate(() => window.RACER.sites);

/**
 * Drive at a feature from well before it, at a pinned speed, and report.
 *
 * SPEED IS PINNED WITH tune.holdSpeed, not assigned. The frame loop
 * accelerates away from an assignment before the car reaches the ramp, so an
 * "arrive at 150" test would arrive at whatever the run-up produced — which is
 * how a jump test ends up measuring the throttle. holdSpeed is released AT THE
 * LIP so the flight itself is unforced: the car leaves the ramp under the
 * physics, not under the harness.
 */
const run = async (fromSeg, toSeg, speed, releaseAtSeg) => p.evaluate(async (a) => {
  const [fromSeg, toSeg, speed, releaseAtSeg] = a;
  const R = window.RACER, SEG = R.consts.SEG_LEN;
  R.startRace();
  await new Promise((done, fail) => {
    const t = R.st.simT + R.consts.COUNTDOWN + 0.2, g = performance.now() + 60000;
    const st = () => { if (R.st.simT >= t) return done();
      if (performance.now() > g) return fail(new Error('countdown never finished'));
      requestAnimationFrame(st); };
    requestAnimationFrame(st);
  });
  R.tune.holdX = 0;
  R.tune.holdSpeed = speed;
  R.st.speed = speed;
  R.st.gear = 4;
  R.st.dist = fromSeg * SEG;
  R.st.air = 0; R.st.vy = 0;
  R.pedal.brake = false; R.pedal.boost = false;

  // THE LONGEST SINGLE FLIGHT, not the span from the first hop to the last.
  // The first version recorded airFrom on the first frame off the ground and
  // airTo on the last, so a four-segment hop onto the ferry followed by a
  // forty-segment jump off it came back as "airborne 115 segments" and I
  // nearly went looking for a physics bug. Two flights are not one flight.
  let maxAir = 0, wasAir = false, curFrom = 0, best = 0, flights = 0, crashed = false;
  let released = false;
  await new Promise((done, fail) => {
    const g = performance.now() + 120000;
    const step = () => {
      const seg = R.st.dist / SEG;
      if (!released && seg >= releaseAtSeg) { released = true; R.tune.holdSpeed = null; }
      if (R.st.air) {
        if (!wasAir) { wasAir = true; curFrom = seg; flights++; }
        const span = seg - curFrom;
        if (span > best) best = span;
        const h = R.st.y - (R.track.hill[Math.floor(seg) % R.track.n]);
        if (h > maxAir) maxAir = h;
      } else wasAir = false;
      if (R.race.state === 'crash') crashed = true;
      if (crashed || seg >= toSeg) return done();
      if (performance.now() > g) return fail(new Error('stalled'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  R.tune.holdSpeed = null; R.tune.holdX = null;
  return { crashed, flew: flights > 0, flights, airSegs: best, maxAir };
}, [fromSeg, toSeg, speed, releaseAtSeg]);

let bad = 0;
const ok = (cond, what, detail = '') => {
  if (!cond) bad++;
  console.log(`   ${cond ? 'ok  ' : 'FAIL'} ${what}${detail ? '   ' + detail : ''}`);
};

const MPH = 0.9633;
console.log('\n  THE DOCKS, SET PIECE BY SET PIECE\n');
console.log(`   sited on straight ground: underpass seg ${sites.underpass.at}, ` +
            `ferry ${sites.ferry.at}, quay jump ${sites.quayJump.at}`);
console.log(`   mean curvature at each: ${sites.underpass.curvature.toFixed(5)}, ` +
            `${sites.ferry.curvature.toFixed(5)}, ${sites.quayJump.curvature.toFixed(5)}\n`);

// ---- THE FERRY -----------------------------------------------------------
console.log('  THE FERRY\n');
const F = sites.ferry;
for (const v of [210, 180, 165, 150, 130]) {
  const r = await run(F.at - 40, F.gapFrom + F.gapLen + 25, v, F.lip - 1);
  console.log(`   arriving at ${(v * MPH).toFixed(0).padStart(3)} mph  ` +
              `${r.crashed ? 'IN THE WATER' : 'made it'}` +
              `${r.flew ? `, longest flight ${r.airSegs.toFixed(0)} segments (${r.flights} in all), ` +
                          `peak ${r.maxAir.toFixed(1)} units up` : ', never left the ground'}`);
  if (v === 210) ok(!r.crashed && r.flew, 'clears the bow ramp at the unboosted cap');
  if (v === 130) ok(r.crashed, 'and arriving slowly puts you in the sea');
}
// ONTO the deck must NOT be a jump. Driven at the fastest the car can arrive.
//
// STARTED ON THE RAMP, NOT FORTY SEGMENTS BEFORE IT. The first version began
// in open country and failed with "airborne 0 segments", which is a real hop
// of under one frame — and it was on the NATURAL profile during the run-up,
// not on the linkspan at all. At the boosted cap the Docks' own gentle
// undulations can just about unstick the car, which is true, harmless and
// nothing to do with the claim under test. A test that fails for a reason
// outside the thing it names is a test that will be ignored.
{
  const r = await run(F.at, F.deckAt + F.deckLen - 2, 284, 99999);
  ok(!r.flew, 'the shore ramp does not launch the car onto the deck, even boosted',
     r.flew ? `airborne ${r.airSegs.toFixed(1)} segments over ${r.flights} hop(s)` : 'stayed down');
}

// ---- THE QUAY JUMP -------------------------------------------------------
console.log('\n  THE QUAY JUMP\n');
const Q = sites.quayJump;
for (const v of [210, 165, 140, 120]) {
  const r = await run(Q.at - 30, Q.gapFrom + Q.gapLen + 20, v, Q.lip - 1);
  console.log(`   arriving at ${(v * MPH).toFixed(0).padStart(3)} mph  ` +
              `${r.crashed ? 'IN THE WATER' : 'made it'}` +
              `${r.flew ? `, airborne ${r.airSegs.toFixed(0)} segments` : ', never left the ground'}`);
  if (v === 210) ok(!r.crashed && r.flew, 'clears at the unboosted cap');
  if (v === 120) ok(r.crashed, 'and fails if you arrive slowly');
}

// ---- THE UNDERPASS -------------------------------------------------------
console.log('\n  THE UNDERPASS\n');
const U = sites.underpass;
for (const v of [210, 284]) {
  // Started ON the feature for the same reason the linkspan test is: the
  // approach is natural ground and its bumps are not what this is about.
  const r = await run(U.at, U.at + U.len + 25, v, 99999);
  ok(!r.flew && !r.crashed,
     `stays on the ground at ${(v * MPH).toFixed(0)} mph`,
     r.flew ? `LAUNCHED for ${r.airSegs.toFixed(0)} segments` : 'glued down');
}

// ---- AND NO CLIFFS -------------------------------------------------------
const cliff = await p.evaluate(() => {
  const R = window.RACER, h = R.track.hill, n = R.track.n;
  let worst = 0, at = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(h[(i + 1) % n] - h[i]);
    if (d > worst) { worst = d; at = i; }
  }
  return { worst, at };
});
console.log('');
ok(cliff.worst <= 2, 'no cliff anywhere in the profile',
   `worst step ${cliff.worst.toFixed(2)} units at segment ${cliff.at}`);
ok(errs.length === 0, 'no page errors', errs.join(' | ') || 'clean');

await b.close();
console.log(bad ? `\n  ${bad} FAILED\n` : '\n  every set piece behaves.\n');
process.exit(bad ? 1 : 0);
