// WHAT DOES LEAVING THE ROAD ACTUALLY COST?
//
// "How bad should the penalty be" is not answerable as a number in a constant.
// It is answerable as "what speed does it leave you doing, and how long does it
// take to get back" — so print those instead of arguing about the constant.
//
//   node tools/offroad.mjs
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
await p.evaluate(() => window.RACER.renderer.setPixelRatio(0.4));
await p.waitForTimeout(600);

const r = await p.evaluate(async () => {
  const R = window.RACER, MPH = 0.9633, ROAD_W = R.consts.ROAD_W, STRAY = R.consts.STRAY_MAX;
  // Hold the car at a fixed lateral offset by rewriting st.x every frame — the
  // physics clamps and the autopilot would both fight a one-off assignment.
  // Pin the offset THROUGH THE GAME, via tune.holdX, which the frame loop
  // applies after its own steering. Writing st.x from out here loses the race
  // with the loop, and the rig silently measured a car that was wandering.
  const settleSim = (secs, x) => new Promise((done, fail) => {
    R.tune.holdX = x;
    const t = R.st.simT + secs, give = performance.now() + secs * 9000 + 12000;
    const step = () => {
      if (R.st.simT >= t) return done();
      if (performance.now() > give) return fail(new Error('stalled'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  const out = { terminal: [], excursion: [] };
  // 1. where does each offset leave you, throttle pinned in top gear
  for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
    const x = ROAD_W + frac * (STRAY - ROAD_W);
    R.pedal.brake = false; R.pedal.boost = false;
    R.st.gear = 4; R.st.speed = R.tune.maxSpeed;
    await settleSim(14, x);
    out.terminal.push({ frac, x, off: R.st.off, mph: R.st.speed * MPH });
  }
  // 2. a realistic excursion: two seconds off, then back on, top gear held
  for (const frac of [0.25, 0.5, 1]) {
    const x = ROAD_W + frac * (STRAY - ROAD_W);
    R.pedal.brake = false; R.pedal.boost = false;
    R.st.gear = 4; R.st.speed = R.tune.maxSpeed;
    await settleSim(0.5, 0);
    const before = R.st.speed * MPH;
    await settleSim(2.0, x);
    const after = R.st.speed * MPH;
    // back on the road, how long to regain 95% of what was lost, left in top gear
    const target = before * 0.95;
    const t0 = R.st.simT;
    let guard = 0;
    while (R.st.speed * MPH < target && guard++ < 300) await settleSim(0.15, 0);
    out.excursion.push({ frac, before, after, lost: before - after,
                         back: R.st.simT - t0 });
  }
  return out;
});
await b.close();

console.log('\n  HELD OFF THE ROAD, throttle pinned in top gear — where it leaves you\n');
console.log('   how far off        offset   settles at');
for (const t of r.terminal) {
  const name = t.frac === 0 ? 'on the white line' : t.frac === 1 ? 'as far as you can go'
             : `${(t.frac * 100).toFixed(0)}% into the verge`;
  console.log(`   ${name.padEnd(20)} ${t.x.toFixed(1).padStart(5)}   ${t.mph.toFixed(0).padStart(3)} mph`);
}
console.log('\n  A TWO-SECOND EXCURSION AT FULL SPEED, then back on the tarmac\n');
console.log('   how far off        speed lost   back up to 95% in');
for (const e of r.excursion) {
  console.log(`   ${(`${(e.frac * 100).toFixed(0)}% into the verge`).padEnd(20)} ` +
              `${e.lost.toFixed(0).padStart(3)} mph      ${e.back.toFixed(1)}s`);
}
console.log('');
