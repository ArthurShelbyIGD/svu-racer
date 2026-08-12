// IF YOU RUN WIDE ON THE WORST CORNER, CAN YOU GET BACK?
//
// Anthony, on the build with the landing page: "Running off the track on a
// heavy corner and I couldn't steer back onto it." That is the worst class of
// bug in a driving game — not a crash, not a wrong number, but a car that
// stops answering. It ends the run and there is nothing the player can do.
//
// THE ARITHMETIC SAYS IT SHOULD BE POSSIBLE, WHICH IS EXACTLY WHY IT NEEDS
// MEASURING. Two terms fight over st.x every frame:
//
//   steering      st.x += steer * STEER_RATE * dt * grip
//   the corner    st.x -= curve * speed * dt * CENTRIFUGAL
//
// Steering does not scale with speed and the corner does, so on paper the slow
// car has the advantage and running wide should be self-correcting. But `grip`
// is 0.45 + 0.55 * (speed / maxSpeed), so the slow car ALSO steers worse — and
// off the road the car is very slow indeed. Whether the fight is winnable at
// the bottom of that curve is a question about two numbers multiplied
// together, on a corner whose curvature is a third number, and nobody has ever
// checked it.
//
// So drive it. Put the car off the road at every offset on the sharpest corner
// on the lap, hold full opposite lock, and see whether it comes back.
//
//   node tools/recover.mjs
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
await p.evaluate(() => { window.RACER.menu.close(); window.RACER.renderer.setPixelRatio(0.35); });
await p.waitForTimeout(500);

const facts = await p.evaluate(() => {
  const R = window.RACER, t = R.track;
  let worst = 0, at = 0;
  for (let i = 0; i < t.n; i++) {
    const c = Math.abs(t.curve[i]);
    if (c > worst) { worst = c; at = i; }
  }
  return { worst, at, STEER_RATE: R.consts.STEER_RATE, ROAD_W: R.consts.ROAD_W,
           STRAY: R.consts.STRAY_MAX, cent: R.handling.cent, max: R.tune.maxSpeed };
});

console.log('\n  THE FIGHT OVER st.x, IN UNITS PER SECOND\n');
console.log(`   sharpest corner on the lap   curvature ${facts.worst.toFixed(5)} at segment ${facts.at}`);
console.log(`   steering, at full lock       ${facts.STEER_RATE} x grip`);
console.log(`   the corner, at speed v       ${facts.worst.toFixed(5)} x v x ${facts.cent.toFixed(3)}\n`);
console.log('   speed      grip   steering wins by');
for (const mph of [40, 60, 80, 100, 140, 200]) {
  const v = mph / 0.9633;
  const grip = 0.45 + 0.55 * Math.min(v / facts.max, 1);
  const steer = facts.STEER_RATE * grip;
  const push = facts.worst * v * facts.cent;
  console.log(`   ${String(mph).padStart(3)} mph    ${grip.toFixed(2)}   ` +
              `${(steer - push).toFixed(2).padStart(7)}  (${steer.toFixed(1)} against ${push.toFixed(1)})`);
}

// ---------------------------------------------------------------------------
// AND NOW DRIVE IT, because the table above is the model and the model is what
// is in question.
const run = (mph, frac, braking) => p.evaluate(async ({ mph, frac, braking }) => {
  const R = window.RACER, SEG = R.consts.SEG_LEN, MPH = R.consts.MPH;
  const ROAD_W = R.consts.ROAD_W, STRAY = R.consts.STRAY_MAX;
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

  // WHICH WAY THE CORNER GOES DECIDES WHICH SIDE IS THE OUTSIDE. Running wide
  // means being pushed to the OUTSIDE of the bend, and steering back means
  // steering into it. Getting this backwards would test the easy direction and
  // report the game fine.
  const at = R.tune.__worstAt;
  const sign = Math.sign(R.track.curve[at]) || 1;
  const outside = -sign;                       // the corner pushes you this way

  R.st.dist = (at - 12) * SEG;                 // just before the apex
  R.st.gear = 2;
  R.tune.holdX = null;
  R.st.x = outside * (ROAD_W + frac * (STRAY - ROAD_W));
  R.st.speed = mph / MPH;
  R.pedal.brake = !!braking;
  R.pedal.boost = false;

  // Full opposite lock, held, the way a player mashes it.
  let best = Math.abs(R.st.x), got = null;
  const t0 = R.st.simT;
  const give = performance.now() + 40000;
  await new Promise((done, fail) => {
    const step = () => {
      R.tilt.on = true; R.tilt.out = sign;     // steer INTO the corner
      R.pedal.brake = !!braking;
      const off = Math.abs(R.st.x);
      if (off < best) best = off;
      if (off <= ROAD_W && got === null) got = R.st.simT - t0;
      if (got !== null || R.st.simT - t0 > 6) return done();
      if (performance.now() > give) return fail(new Error('stalled'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  const out = { mph, frac, braking, back: got, closest: best,
                endSpeed: R.st.speed * MPH, endX: Math.abs(R.st.x) };
  R.tilt.on = false; R.tilt.out = 0; R.pedal.brake = false;
  return out;
}, { mph, frac, braking });

await p.evaluate((at) => { window.RACER.tune.__worstAt = at; }, facts.at);

console.log('\n  HELD OFF THE ROAD ON THAT CORNER, FULL OPPOSITE LOCK\n');
console.log('   arrive   how far off      back on in     closest it got');
const rows = [];
for (const mph of [40, 70, 110, 160]) {
  for (const frac of [0.5, 1.0]) {
    const r = await run(mph, frac, false);
    rows.push(r);
    console.log(`   ${String(mph).padStart(3)} mph   ` +
                `${(frac === 1 ? 'as far as it goes' : 'halfway out').padEnd(17)} ` +
                `${(r.back === null ? 'NEVER' : r.back.toFixed(1) + 's').padStart(8)}      ` +
                `${r.closest.toFixed(2)} (road edge ${facts.ROAD_W})`);
  }
}

// Braking is the other thing a player does, and BRAKE_GRIP multiplies steering
// by 1.55 — so if anything recovers, this should.
console.log('\n   and the same thing on the brakes\n');
const braked = [];
for (const mph of [40, 110]) {
  const r = await run(mph, 1.0, true);
  braked.push(r);
  console.log(`   ${String(mph).padStart(3)} mph   as far as it goes  ` +
              `${(r.back === null ? 'NEVER' : r.back.toFixed(1) + 's').padStart(8)}      ` +
              `${r.closest.toFixed(2)}`);
}

const stuck = rows.concat(braked).filter((r) => r.back === null);
console.log('');
ok(stuck.length === 0,
   'full lock brings the car back onto the road from anywhere on the worst corner',
   stuck.length ? `stuck at: ${stuck.map((r) => `${r.mph}mph/${r.frac}${r.braking ? ' braking' : ''}`).join(', ')}`
                : `worst case took ${Math.max(...rows.map((r) => r.back || 0)).toFixed(1)}s`);

// A NEGATIVE CONTROL. Steer the WRONG way and the car must NOT come back —
// otherwise the test above is passing on something other than the steering.
const wrong = await p.evaluate(async (at) => {
  const R = window.RACER, SEG = R.consts.SEG_LEN, MPH = R.consts.MPH;
  const ROAD_W = R.consts.ROAD_W, STRAY = R.consts.STRAY_MAX;
  const sim = (s) => new Promise((d) => {
    const t = R.st.simT + s; const step = () => R.st.simT >= t ? d() : requestAnimationFrame(step);
    requestAnimationFrame(step);
  });
  R.startRace(); await sim(R.consts.COUNTDOWN + 0.3);
  const sign = Math.sign(R.track.curve[at]) || 1;
  R.st.dist = (at - 12) * SEG; R.st.gear = 2;
  R.st.x = -sign * (ROAD_W + 0.5 * (STRAY - ROAD_W));
  R.st.speed = 110 / MPH;
  let got = null; const t0 = R.st.simT;
  await new Promise((done) => {
    const step = () => {
      R.tilt.on = true; R.tilt.out = -sign;     // the WRONG way, out of the bend
      if (Math.abs(R.st.x) <= ROAD_W && got === null) got = R.st.simT - t0;
      if (got !== null || R.st.simT - t0 > 4) return done();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  R.tilt.on = false; R.tilt.out = 0;
  return got;
}, facts.at);
ok(wrong === null,
   'NEGATIVE CONTROL: steering the wrong way does NOT bring it back, so the test above is reading the steering',
   wrong === null ? 'stayed off, correctly' : `came back in ${wrong.toFixed(1)}s anyway — this test proves nothing`);

await b.close();
console.log('');
if (fails.length) { for (const f of fails) console.log(`  FAILED: ${f}`); process.exit(1); }
console.log('  you can always get back on\n');
