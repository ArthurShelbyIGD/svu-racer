// THE BROKEN BRIDGE: does it jump, and is the gate where it says it is?
//
// Three claims, none of which should be taken on trust:
//
//   1. THE GATE. There is an arrival speed below which you cannot clear the gap
//      and above which you can, and it is where bridge.js's ballistics say. A
//      jump you always make is spectacle; one you never make is a wall.
//
//   2. THE RULE DOES NOT FIRE ANYWHERE ELSE. main.js launches the car whenever
//      the road falls away faster than gravity can hold it — general physics,
//      not a special case bolted to the bridge. That is the honest way to write
//      it and it is also the risky way, because a natural crest at 250mph could
//      then throw the player into the scenery somewhere they did not expect.
//      So: drive the whole lap with the arch removed and print the longest hop
//      anywhere on it.
//
//   3. THE CRASH IS A CRASH. Arriving too slowly ends the lap and puts you back
//      on the grid with a full bottle, rather than leaving the car hanging over
//      the hole or quietly driving across thin air.
//
//   node tools/bridge.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));

const fails = [];
const ok = (cond, label, detail = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${detail ? '   ' + detail : ''}`);
  if (!cond) fails.push(label);
};

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const p = await b.newPage({ viewport: { width: 480, height: 240 } });
await p.goto('file://' + __j(ROOT, 'docs', 'index.html'), { waitUntil: 'load' });
await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
await p.evaluate(() => window.RACER.renderer.setPixelRatio(0.35));
await p.waitForTimeout(600);

// ---------------------------------------------------------------------------
// The shape of the thing, straight off the module, before anything is driven.
const shape = await p.evaluate(() => {
  const R = window.RACER, B = R.bridge.BRIDGE, SEG = R.consts.SEG_LEN, t = R.track;
  const s0 = B.seg0;
  // THE ARCH ALONE, not the arch plus the hillside it was built on. Measuring
  // off track.hill includes the natural climb across the same ground and
  // reported a 14.4-unit bridge as 16.0.
  const rise = [];
  for (let k = -2; k <= B.ramp + B.gap + B.far + 2; k++) rise.push(t.bridgeAdd[s0 + k] || 0);
  let worstStep = 0;
  for (let i = 1; i < t.n; i++) {
    const d = Math.abs(t.hill[i] - t.hill[i - 1]);
    if (d > worstStep) worstStep = d;
  }
  let gapCount = 0;
  for (let i = 0; i < t.n; i++) if (t.gap[i]) gapCount++;
  return {
    B, SEG, rise, worstStep, gapCount,
    lip: R.bridge.lipDist(SEG), gapW: R.bridge.gapWidth(SEG),
    crest: Math.max(...rise),
    // The steepest gradient anywhere on the climb — the launch angle.
    lipSlope: Math.max(...Array.from({ length: B.ramp }, (_, k) =>
      (t.hill[s0 + k + 1] - t.hill[s0 + k]) / SEG)),
    g: R.consts.GRAVITY,
  };
});

console.log('\n  THE ARCH, read off track.hill after shaping\n');
console.log(`   site           segment ${shape.B.seg0}, ${shape.B.ramp} up, ` +
            `${shape.B.gap} missing, ${shape.B.far} down`);
console.log(`   crest          ${shape.crest.toFixed(2)} units above the approach ` +
            `(the module says ${shape.B.height})`);
console.log(`   steepest climb ${shape.lipSlope.toFixed(4)}  (the launch angle)`);
console.log(`   the gap        ${shape.gapW} units, ${shape.gapCount} flagged segments`);
console.log(`   worst step anywhere on the lap   ${shape.worstStep.toFixed(2)} units ` +
            `(check.mjs forbids over 2)`);
ok(shape.worstStep <= 2,
   'the arch does not put a cliff in the elevation profile',
   `worst step ${shape.worstStep.toFixed(2)} units`);
ok(shape.gapCount === shape.B.gap,
   'exactly the intended segments are flagged as missing deck',
   `${shape.gapCount} of ${shape.B.gap}`);
ok(Math.abs(shape.crest - shape.B.height) < 0.05,
   'the arch is as tall as the module says it is',
   `${shape.crest.toFixed(2)} against ${shape.B.height}`);

// ---------------------------------------------------------------------------
// 1. THE GATE. Arrive at the lip at a known speed and see what happens.
//
// The car is placed short of the ramp and its speed pinned all the way to the
// lip, because a run-up long enough to reach these speeds naturally would also
// be long enough for the speed at the lip to be something other than the speed
// asked for — and then the table would be of the run-up, not of the jump.
const runOne = (mph) => p.evaluate(async (mph) => {
  const R = window.RACER, MPH = R.consts.MPH, SEG = R.consts.SEG_LEN;
  const v = mph / MPH;
  const sim = (secs) => new Promise((done, fail) => {
    const t = R.st.simT + secs, give = performance.now() + secs * 14000 + 20000;
    const step = () => {
      if (R.st.simT >= t) return done();
      if (performance.now() > give) return fail(new Error('stalled'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  R.startRace();
  await sim(R.consts.COUNTDOWN + 0.3);
  R.tune.holdX = 0; R.pedal.brake = false; R.pedal.boost = false;
  R.st.dist = R.bridge.lipDist(SEG) - 90;      // 90 units of approach
  R.st.gear = 4;

  // EVERY HOP, NOT THE FIRST ONE. The ramp's foot has a slight brow on it and
  // the car goes light over it for a single frame — which the first version of
  // this rig recorded as "the jump", stopped there, and reported the car
  // landing 25 units BEFORE the lip at every speed above 140. A landing short
  // of the lip is not the jump; it is the run-up.
  const hops = [];
  let peak = 0, crashed = false, t0 = null, y0 = 0;
  const lip = R.bridge.lipDist(SEG);
  const give = performance.now() + 60000;
  await new Promise((done, fail) => {
    const step = () => {
      if (R.race.state === 'racing' && !R.st.air) { R.st.gear = 4; R.st.speed = v; }
      if (R.st.air && t0 === null) { t0 = R.st.simT; y0 = R.st.dist; peak = 0; }
      if (R.st.air) {
        const h = R.st.y - R.track.hill[Math.floor(R.st.dist / SEG) % R.track.n];
        if (h > peak) peak = h;
      }
      if (R.race.state === 'crash') { crashed = true; return done(); }
      if (t0 !== null && !R.st.air) {
        hops.push({ air: R.st.simT - t0, from: y0, to: R.st.dist, peak });
        t0 = null;
      }
      if (R.st.dist > lip + 600) return done();
      if (performance.now() > give) return fail(new Error('stalled'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  // The jump is the hop that started on the bridge and finished past the gap.
  const gapEnd = lip + R.bridge.gapWidth(SEG);
  const jump = hops.filter((h) => h.to > gapEnd).sort((a, c) => c.air - a.air)[0] || null;
  const out = { mph, crashed, hops: hops.length,
                air: jump ? jump.air : 0, peak: jump ? jump.peak : 0,
                landedAt: jump ? jump.to - lip : null,
                launched: jump !== null };
  R.tune.holdX = null;
  return out;
}, mph);

console.log('\n  ARRIVING AT THE LIP AT A HELD SPEED\n');
console.log('   arrive     took off   airtime   peak height   landed      result');
const rows = [];
for (const mph of [70, 100, 125, 140, 150, 160, 180, 202, 240, 274]) {
  const r = await runOne(mph);
  rows.push(r);
  const where = r.crashed ? 'IN THE HOLE'
    : r.landedAt === null ? 'never cleared the gap'
    : `${r.landedAt.toFixed(0)} units past the lip, ${r.hops} hop(s) in all`;
  console.log(`   ${String(mph).padStart(3)} mph    ${(r.launched ? 'yes' : 'no ').padStart(8)}   ` +
              `${r.air.toFixed(2).padStart(5)}s   ${r.peak.toFixed(1).padStart(8)}     ` +
              `${(r.crashed ? '-' : (r.landedAt ?? 0).toFixed(0)).padStart(6)}      ${where}`);
}

// WHERE THE GATE ACTUALLY IS, read off the table rather than asserted.
const cleared = rows.filter((r) => !r.crashed);
const failed = rows.filter((r) => r.crashed);
const fastestFail = failed.length ? Math.max(...failed.map((r) => r.mph)) : null;
const slowestClear = cleared.length ? Math.min(...cleared.map((r) => r.mph)) : null;
console.log(`\n   the gate sits between ${fastestFail ?? '—'} and ${slowestClear ?? '—'} mph`);
console.log(`   bridge.js's ballistics predict about 146 mph`);

ok(failed.length > 0, 'arriving slowly puts you in the hole', `${failed.length} of ${rows.length} speeds crashed`);
ok(cleared.length > 0, 'arriving quickly clears it', `${cleared.length} of ${rows.length} speeds landed`);
ok(fastestFail !== null && slowestClear !== null && fastestFail < slowestClear,
   'the gate is a clean threshold, not a scatter',
   `every speed under ${slowestClear} failed and every speed over ${fastestFail} cleared`);
ok(slowestClear !== null && slowestClear >= 130 && slowestClear <= 175,
   'and the threshold is where the module says, within a sensible band',
   `first clean clearance at ${slowestClear} mph`);
const fast = rows.find((r) => r.mph === 202);
ok(fast && !fast.crashed && fast.air > 0.6 && fast.air < 2.0,
   'at unboosted top speed the jump lasts long enough to be a jump, and not so long it is a cutscene',
   `${fast ? fast.air.toFixed(2) : '—'}s of air`);

// ---------------------------------------------------------------------------
// 2. THE RULE ANYWHERE ELSE. Take the arch out and drive the whole lap flat.
//
// This is the check that matters most, because the launch rule is general. If
// a natural crest can throw the car at a speed a player reaches, it will happen
// somewhere unlit and unexpected and read as a bug.
console.log('\n  THE SAME LAUNCH RULE OVER THE REST OF THE LAP, arch removed\n');
const natural = await p.evaluate(async () => {
  const R = window.RACER, MPH = R.consts.MPH, SEG = R.consts.SEG_LEN;
  // FLATTEN THE ARCH AND CLEAR THE GAP FLAGS. Without clearing the flags the
  // car crashes at segment 1123 on every pass and the sweep never gets round.
  const B = R.bridge.BRIDGE;
  const n = R.track.n, saveH = Float32Array.from(R.track.hill), saveG = Uint8Array.from(R.track.gap);
  for (let k = -2; k < B.ramp + B.gap + B.far + 2; k++) {
    const i = ((B.seg0 + k) % n + n) % n;
    R.track.hill[i] = saveH[((B.seg0 - 3) % n + n) % n]
      + (saveH[((B.seg0 + B.ramp + B.gap + B.far + 3) % n + n) % n]
         - saveH[((B.seg0 - 3) % n + n) % n]) * (k + 2) / (B.ramp + B.gap + B.far + 4);
    R.track.gap[i] = 0;
  }
  const out = { hops: [], worstAir: 0, worstAt: 0, worstPeak: 0, frames: 0 };
  R.startRace();
  await new Promise((done, fail) => {
    const t = R.st.simT + R.consts.COUNTDOWN + 0.3, give = performance.now() + 30000;
    const step = () => {
      if (R.st.simT >= t) return done();
      if (performance.now() > give) return fail(new Error('stalled'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  R.tune.holdX = 0; R.st.gear = 4;
  // AT THE FASTEST THE CAR CAN EVER GO. Boosted top speed is the worst case for
  // a rule that scales with v squared, so test only that: if it is quiet here
  // it is quiet everywhere slower.
  const V = R.tune.maxSpeed * R.consts.BOOST_TOP;
  let t0 = null, peak = 0;
  const give = performance.now() + 180000;
  await new Promise((done, fail) => {
    const step = () => {
      out.frames++;
      if (!R.st.air) { R.st.gear = 4; R.st.speed = V; }
      if (R.st.air && t0 === null) { t0 = R.st.simT; peak = 0; }
      if (R.st.air) {
        const h = R.st.y - R.track.hill[Math.floor(R.st.dist / SEG) % R.track.n];
        if (h > peak) peak = h;
      }
      if (t0 !== null && !R.st.air) {
        const air = R.st.simT - t0;
        out.hops.push({ air: +air.toFixed(3), at: Math.floor(R.st.dist / SEG), peak: +peak.toFixed(2) });
        if (air > out.worstAir) { out.worstAir = air; out.worstAt = Math.floor(R.st.dist / SEG); out.worstPeak = peak; }
        t0 = null;
      }
      if (R.race.state !== 'racing') return done();
      if (performance.now() > give) return fail(new Error('stalled'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  R.track.hill.set(saveH); R.track.gap.set(saveG);
  R.tune.holdX = null;
  return out;
});
console.log(`   a whole lap at ${(210 * 1.35 * 0.9633).toFixed(0)} mph, the fastest the car can go`);
console.log(`   ${natural.hops.length} hop(s) anywhere on it`);
if (natural.hops.length) {
  console.log(`   longest: ${natural.worstAir.toFixed(3)}s, ${natural.worstPeak.toFixed(2)} units up, ` +
              `at segment ${natural.worstAt}`);
}
ok(natural.worstAir < 0.40,
   'no natural crest throws the car — at most it goes light over a brow',
   natural.hops.length ? `longest hop ${natural.worstAir.toFixed(3)}s, ${natural.worstPeak.toFixed(2)} units`
                       : 'never left the ground');
// NEGATIVE CONTROL. The sweep above found nothing; prove it CAN find something
// by putting a crest in front of it that certainly should launch the car.
const control = await p.evaluate(async () => {
  const R = window.RACER, SEG = R.consts.SEG_LEN, n = R.track.n;
  const save = Float32Array.from(R.track.hill);
  const at = 1700;
  for (let k = 0; k < 20; k++) R.track.hill[(at + k) % n] += 24 * (k < 10 ? k / 10 : (20 - k) / 10);
  R.startRace();
  await new Promise((done) => {
    const t = R.st.simT + R.consts.COUNTDOWN + 0.3;
    const step = () => R.st.simT >= t ? done() : requestAnimationFrame(step);
    requestAnimationFrame(step);
  });
  R.tune.holdX = 0; R.st.gear = 4; R.st.dist = (at - 30) * SEG;
  // THE LONGEST HOP, NOT THE FIRST. Same trap the main table fell into: the
  // foot of any ramp gives a single frame of air, and a control that stops
  // there reports 0.00s and declares itself broken while working perfectly.
  let air = 0, best = 0, t0 = null;
  const give = performance.now() + 40000;
  await new Promise((done, fail) => {
    const step = () => {
      if (!R.st.air) { R.st.gear = 4; R.st.speed = R.tune.maxSpeed; }
      if (R.st.air && t0 === null) t0 = R.st.simT;
      if (R.st.air) { air = R.st.simT - t0; if (air > best) best = air; }
      if (t0 !== null && !R.st.air) t0 = null;
      if (R.st.dist > (at + 90) * SEG) return done();
      if (performance.now() > give) return fail(new Error('stalled'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  air = best;
  R.track.hill.set(save); R.tune.holdX = null;
  return air;
});
ok(control > 0.15,
   'NEGATIVE CONTROL: a crest that SHOULD launch the car does, so the sweep above could have found one',
   `${control.toFixed(2)}s of air off a deliberately sharp brow`);

// ---------------------------------------------------------------------------
// 3. THE CRASH RESTARTS THE LAP.
console.log('\n  WHAT A CRASH ACTUALLY DOES\n');
const after = await p.evaluate(async () => {
  const R = window.RACER, SEG = R.consts.SEG_LEN;
  const sim = (secs) => new Promise((done, fail) => {
    const t = R.st.simT + secs, give = performance.now() + secs * 14000 + 20000;
    const step = () => {
      if (R.st.simT >= t) return done();
      if (performance.now() > give) return fail(new Error('stalled'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  // START FROM A CLEAN SCREEN. Earlier sections of this rig cross the finish
  // line, which puts a results card up and leaves it there — so the wait below
  // saw a card that was already showing, read "NEW BEST" off the last lap and
  // reported the crash card as saying the wrong thing. The bug was in the rig,
  // but the failure it printed was indistinguishable from a real one.
  if (R.menu) R.menu.close();
  document.getElementById('rTitle').textContent = '';
  R.startRace();
  await sim(R.consts.COUNTDOWN + 0.3);
  R.tune.holdX = 0;
  R.st.dist = R.bridge.lipDist(SEG) - 40;
  R.st.speed = 60 / R.consts.MPH; R.st.gear = 1; R.st.boostLeft = 0.31;
  // Crawl at it.
  const give = performance.now() + 60000;
  await new Promise((done, fail) => {
    const step = () => {
      if (R.race.state === 'racing') { R.st.gear = 1; R.st.speed = 60 / R.consts.MPH; }
      if (R.race.state === 'crash') return done();
      if (performance.now() > give) return fail(new Error('never crashed'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  const inWreck = { state: R.race.state, y0: R.st.y, elapsed: R.race.elapsed };
  await sim(0.6);
  const fellBy = inWreck.y0 - R.st.y;
  // AND THEN THE CARD, NOT AN AUTOMATIC RESTART. The crash used to drop you
  // straight back on the grid after CRASH_HOLD, which was right when there was
  // nowhere else to go. There is a landing page now, and Anthony asked for
  // "results card, then RETRY or MENU" — so the wreck ends with a card and the
  // game WAITS. A test that still expects the grid is testing last week.
  let guard = 0;
  while (R.race.state === 'crash' && guard++ < 200
         && document.getElementById('rTitle').textContent === '') await sim(0.15);
  const card = {
    up: document.getElementById('menu').classList.contains('show'),
    panel: document.getElementById('pResult').classList.contains('on'),
    title: document.getElementById('rTitle').textContent,
  };
  // RETRY has to put you back on the grid with everything reset.
  document.getElementById('rRetry').click();
  await sim(0.4);
  const back = { state: R.race.state, dist: R.st.dist, boost: R.st.boostLeft,
                 elapsed: R.race.elapsed, air: R.st.air, speed: R.st.speed };
  R.tune.holdX = null;
  return { inWreck, fellBy, card, back, from: R.consts.RACE_FROM };
});
console.log(`   crawling into the gap    state '${after.inWreck.state}' at ${after.inWreck.elapsed.toFixed(1)}s`);
console.log(`   the wreck keeps falling  ${after.fellBy.toFixed(1)} units in the first 0.6s`);
console.log(`   the card                 "${after.card.title}", menu up ${after.card.up}`);
console.log(`   after RETRY              state '${after.back.state}', dist ${after.back.dist.toFixed(0)}, ` +
            `bottle ${after.back.boost.toFixed(2)}, lap clock ${after.back.elapsed.toFixed(1)}s`);
ok(after.inWreck.state === 'crash', 'crawling into the gap ends the lap', `state '${after.inWreck.state}'`);
ok(after.fellBy > 1,
   'the wreck goes on falling rather than hanging over the hole',
   `${after.fellBy.toFixed(1)} units in 0.6s`);
ok(after.card.up && after.card.panel,
   'the wreck ends with the results card, not with an automatic restart',
   `"${after.card.title}"`);
ok(/HOLE/i.test(after.card.title),
   'and the card says what happened rather than just reporting a time',
   `"${after.card.title}"`);
ok(after.back.state === 'countdown' || after.back.state === 'racing',
   'and RETRY puts you back on the grid', `state '${after.back.state}'`);
ok(after.back.boost === 1, 'with a full bottle', `${after.back.boost}`);
ok(after.back.elapsed < 1, 'and the lap clock back at zero', `${after.back.elapsed.toFixed(2)}s`);
ok(after.back.air === 0, 'and the car back on the ground', `air ${after.back.air}`);

await b.close();
console.log('');
if (fails.length) { for (const f of fails) console.log(`  FAILED: ${f}`); process.exit(1); }
console.log('  the bridge behaves\n');
