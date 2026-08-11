// AFTER YOU LOSE SPEED, DOES DOWNSHIFTING GET IT BACK FASTER?
//
// Anthony's question about running off the track, and the reason the torque
// curve changed. With the old curve the answer was NO — 11.3s left in top gear
// against 12.8s starting in third — because torque collapsed to a third of peak
// at the limiter, so every upshift landed in the weak part of the curve and
// handed straight back what the low gear had won.
//
//   node tools/recovery.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
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
// PIN THE CAR ON THE TARMAC. Since the off-road penalty landed, a car left to
// its own devices drifts onto the verge during a long run and is slowed by
// scenery rather than by its gearbox — which showed up as recovery times that
// were not even monotonic in gear, with second and fourth identical to a tenth
// of a second. A straight-line acceleration rig has to be on a straight line.
await p.evaluate(() => { window.RACER.renderer.setPixelRatio(0.4); window.RACER.tune.holdX = 0; });
await p.waitForTimeout(600);

const FROM = 75, TO = 190;
const r = await p.evaluate(async ({ FROM, TO }) => {
  const R = window.RACER, MPH = 0.9633;
  // START THE RACE FIRST. On the grid and through the countdown main.js zeroes
  // st.speed every frame — the throttle is dead on the line by design — so a
  // rig that loads the page and starts assigning speeds is timing a parked car.
  // This one waited for a speed the car could never reach and hung.
  R.startRace();
  await new Promise((done, fail) => {
    const t0 = R.st.simT + R.consts.COUNTDOWN + 1, give = performance.now() + 60000;
    const step = () => {
      if (R.st.simT >= t0) return done();
      if (performance.now() > give) return fail(new Error('the countdown never finished'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  if (R.race.state !== 'racing') throw new Error(`the race is '${R.race.state}', not racing`);
  const settle = (s) => new Promise((done) => {
    const t = R.st.simT + s;
    const poll = () => R.st.simT >= t ? done() : requestAnimationFrame(poll);
    poll();
  });
  const out = [];
  for (let g = 0; g < 5; g++) {
    R.pedal.brake = false; R.pedal.boost = false;
    R.st.speed = FROM / MPH; R.st.gear = g;
    await settle(0.1);
    const started = R.st.gear, t0 = R.st.simT;
    let shifts = 0;
    // Shift inside the page's own frame loop. Driving it from the harness on a
    // 0.2s poll cost about 0.4s per upshift in limiter-sitting, which is enough
    // to invert the answer entirely.
    await new Promise((done, fail) => {
      const give = performance.now() + 60000;
      const step = () => {
        if (R.st.rev >= 0.97 && R.st.gear < 4) { R.st.gear++; shifts++; }
        if (R.st.speed * MPH >= TO) return done();
        if (performance.now() > give) return fail(new Error('stalled'));
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    out.push({ asked: g + 1, used: started + 1, secs: R.st.simT - t0, shifts });
  }
  return out;
}, { FROM, TO });
await b.close();
console.log(`\n  RECOVERY FROM ${FROM} mph BACK TO ${TO} mph, throttle pinned\n`);
console.log('  drop into   settled in   upshifts   time');
const best = Math.min(...r.map((x) => x.secs));
for (const x of r) {
  const tag = x.secs === best ? '  <- fastest' : `  +${(x.secs - best).toFixed(1)}s`;
  console.log(`  gear ${x.asked}      gear ${x.used}        ${String(x.shifts).padStart(2)}      ` +
              `${x.secs.toFixed(1)}s${tag}`);
}
console.log('');
