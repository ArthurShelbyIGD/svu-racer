// WHAT DOES THE STANDING START COST?
//
// Anthony has the lap down to 57.1s and asked the right question about where
// the floor is: "being as it takes a certain distance to reach full non nitrous
// speed from the start I'm not certain how much quicker I can get the lap."
//
// 57.1s is also, exactly, the time a lap would take pinned at the car's
// unboosted top speed for its entire length — corners, jump, tunnel and all.
// Which means his boost is already paying for every corner AND for the launch.
// So the question "how much is left" is really "how much of the lap is still
// being spent below the cap, and how much of that can the bottle buy back".
//
// This measures the two halves of that:
//
//   1. THE LAUNCH. Drive from the grid and log the distance and time to reach
//      each fraction of top speed. The cost is the difference between doing
//      that and having crossed the same ground at the cap.
//
//   2. THE REST OF THE LAP. Drive it flat out with no boost at all and log
//      where the car is actually below the cap. Anything below the cap is
//      either a corner, a hill or the launch — and only those places are worth
//      spending nitrous on.
//
//   node tools/launch.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const p = await b.newPage({ viewport: { width: 400, height: 240 } });
await p.goto('file://' + __j(ROOT, 'docs', 'index.html'), { waitUntil: 'load' });
await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
await p.evaluate(() => { window.RACER.menu.close(); window.RACER.renderer.setPixelRatio(0.3); });
await p.waitForTimeout(500);

const r = await p.evaluate(async () => {
  const R = window.RACER, MPH = R.consts.MPH;
  const CAP = R.tune.maxSpeed;                 // world units/s, the unboosted ceiling
  const sim = (secs, tick) => new Promise((done, fail) => {
    const t = R.st.simT + secs, give = performance.now() + secs * 14000 + 20000;
    const step = () => {
      if (tick) tick();
      if (R.st.simT >= t) return done();
      if (performance.now() > give) return fail(new Error('stalled'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  // ---- 1. THE LAUNCH, driven the way a player drives it ------------------
  // Shift at the limiter, hold the line, no boost. `holdX` keeps it straight so
  // the off-road penalty cannot contaminate a straight-line measurement, which
  // is a mistake this repo has made three times.
  R.startRace();
  await sim(R.consts.COUNTDOWN + 0.05);
  R.tune.holdX = 0; R.pedal.brake = false; R.pedal.boost = false;
  const d0 = R.st.dist, t0 = R.st.simT;
  const marks = [];
  let want = 0;
  const FRACS = [0.5, 0.8, 0.9, 0.95, 0.98, 0.995];
  await sim(30, () => {
    // The autopilot a good player is: upshift on the limiter, never coast.
    if (R.st.rev > 0.985 && R.st.gear < R.consts.GEARS.length - 1) R.st.gear++;
    while (want < FRACS.length && R.st.speed >= CAP * FRACS[want]) {
      marks.push({ frac: FRACS[want], t: R.st.simT - t0, d: R.st.dist - d0 });
      want++;
    }
  });

  // ---- 2. WHERE THE LAP IS ALREADY AT THE CAP ----------------------------
  // A whole lap, flat out, no nitrous, sampled every frame. Anything at the cap
  // is ground the bottle cannot improve; anything below it is a corner or a
  // hill, and that is the entire remaining prize.
  R.startRace();
  await sim(R.consts.COUNTDOWN + 0.05);
  R.tune.holdX = 0; R.pedal.boost = false;
  const bins = new Array(10).fill(0);          // time spent in each 10% band
  let frames = 0, lapT = 0, atCap = 0;
  const start = R.st.simT;
  let last = R.st.simT;
  await new Promise((done, fail) => {
    const give = performance.now() + 400000;
    const step = () => {
      if (R.race.state === 'racing') {
        if (R.st.rev > 0.985 && R.st.gear < R.consts.GEARS.length - 1) R.st.gear++;
        const dt = R.st.simT - last; last = R.st.simT;
        const f = Math.min(0.999, R.st.speed / CAP);
        bins[Math.max(0, Math.floor(f * 10))] += dt;
        if (f > 0.99) atCap += dt;
        frames++;
      }
      if (R.race.state !== 'racing' && frames > 10) { lapT = R.race.elapsed; return done(); }
      if (performance.now() > give) return fail(new Error('the lap never finished'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  R.tune.holdX = null;
  return { marks, bins, lapT, atCap, cap: CAP * MPH, MPH,
           len: R.consts.RACE_LEN, seg: R.consts.SEG_LEN };
});
await b.close();

const MI = (r.len * (1.55 / 3.6)) / 1609.344;
const capLap = MI / r.cap * 3600;

console.log('\n  THE LAUNCH, from the lights, no nitrous\n');
console.log('   reaching        after      having covered');
for (const m of r.marks) {
  console.log(`   ${(m.frac * 100).toFixed(1).padStart(5)}% of top   ` +
              `${m.t.toFixed(1).padStart(5)}s     ${m.d.toFixed(0).padStart(5)} units  ` +
              `(${(m.d * (1.55 / 3.6)).toFixed(0)} m, ${(100 * m.d / r.len).toFixed(1)}% of the lap)`);
}
const near = r.marks.find((m) => m.frac === 0.98);
if (near) {
  // The cost is the time actually taken minus the time the same ground would
  // have taken at the cap. That difference is the launch, in seconds.
  const atCapTime = near.d / (r.cap / 0.9633);
  console.log(`\n   so getting up to 98% took ${near.t.toFixed(1)}s over ${near.d.toFixed(0)} units.`);
  console.log(`   crossing that same ground at the cap would take ${atCapTime.toFixed(1)}s.`);
  console.log(`   THE STANDING START COSTS ${(near.t - atCapTime).toFixed(1)}s.`);
}

console.log('\n  A WHOLE LAP FLAT OUT WITH NO NITROUS AT ALL\n');
console.log(`   lap time ${r.lapT.toFixed(1)}s   (a lap pinned at the cap would be ${capLap.toFixed(1)}s)`);
console.log(`   so with no boost the car loses ${(r.lapT - capLap).toFixed(1)}s to the launch, the corners and the hills\n`);
console.log('   where the time goes, as a fraction of the unboosted top speed:');
const total = r.bins.reduce((a, v) => a + v, 0);
for (let i = r.bins.length - 1; i >= 0; i--) {
  if (r.bins[i] < 0.05) continue;
  const bar = '#'.repeat(Math.round(40 * r.bins[i] / total));
  console.log(`   ${(i * 10).toString().padStart(3)}-${((i + 1) * 10).toString().padStart(3)}%  ` +
              `${r.bins[i].toFixed(1).padStart(5)}s  ${bar}`);
}
// AND THE FIRST VERSION OF THIS LINE WAS WRONG, which matters because it is
// the line a player would act on. It said nitrous "cannot improve" the ground
// already at the ceiling. It can: boost does TWO separate things — it
// multiplies acceleration by BOOST_ACCEL, which only helps below the cap, and
// it raises the cap itself by BOOST_TOP, which only helps at it. So both bands
// are worth spending on, for different reasons, and telling Anthony to ignore
// two thirds of the lap would have cost him time rather than saved it.
console.log(`\n   ${(100 * r.atCap / total).toFixed(0)}% of the lap is already at the unboosted ceiling.`);
console.log(`   There, boost pays by RAISING the ceiling (x${1.35} = ${(r.cap * 1.35).toFixed(0)} mph).`);
console.log(`   The other ${(100 * (1 - r.atCap / total)).toFixed(0)}% is below it, and there boost pays by`);
console.log(`   ACCELERATING harder (x1.9) to get back to speed sooner.`);
console.log(`   Which of the two buys more per second of bottle is still unmeasured.\n`);
console.log(`   Anthony's 57.1 against a no-boost ${r.lapT.toFixed(1)}: ` +
            `the bottle is already worth ${(r.lapT - 57.1).toFixed(1)}s a lap.\n`);
