// DOES THE GEARBOX WORK, AND IS IT WORTH SHIFTING?
//
// Three claims, none of which should be taken on trust:
//   1. every gear has a ceiling, and holding a gear parks you on it
//   2. shifting at the right moment is FASTER than shifting late — otherwise
//      the box is decoration and the buttons may as well not be there
//   3. the car still reaches its top speed when driven properly, which is the
//      claim tools/check.mjs makes and which gears could easily have broken
//
// Waits on st.simT, not wall clock: below 10fps the frame loop's dt clamp makes
// the sim run behind the clock, and this container renders at ~24fps.
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const p = await b.newPage({ viewport: { width: 1008, height: 420 } });
await p.goto('file://' + __j(ROOT, 'docs', 'index.html'), { waitUntil: 'load' });
await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
await p.waitForTimeout(1500);

const r = await p.evaluate(async () => {
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
  const settle = (secs) => new Promise((done, fail) => {
    const t = R.st.simT + secs, give = performance.now() + secs * 8000 + 10000;
    const poll = () => R.st.simT >= t ? done()
      : performance.now() > give ? fail(new Error('sim stalled')) : requestAnimationFrame(poll);
    poll();
  });
  R.tune.holdX = 0;
  const reset = () => { R.st.speed = 0; R.st.gear = 0; R.pedal.brake = false; R.pedal.boost = false; };
  // A FRESH RACE BEFORE EACH STANDING START. The distance trials below measure
  // st.dist across twelve seconds, and by the time they run the ceiling sweep
  // above has already driven the car most of a race length down the road — so
  // one of them straddled the finish, the race went back to the grid underneath
  // it, and the trial reported having travelled MINUS eleven thousand units. A
  // negative distance is a tool telling you it does not know what it measured.
  // Putting all three trials on the same fresh grid also makes them comparable,
  // which up to now was assumed rather than arranged.
  const arm = async () => {
    R.startRace();
    const t = R.st.simT + R.consts.COUNTDOWN + 0.5, give = performance.now() + 60000;
    await new Promise((done, fail) => {
      const step = () => {
        if (R.st.simT >= t) return done();
        if (performance.now() > give) return fail(new Error('the countdown never finished'));
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    reset();
  };

  // 1. each gear's ceiling, held wide open
  // START THE CAR NEAR THE GEAR'S OWN CEILING, not at a standstill. The
  // automatic downshift exists so you cannot get stranded in fifth at walking
  // pace, and it fired the instant this test set a high gear at zero speed —
  // so the first version of it measured first gear five times and reported
  // every ceiling as 61mph. The instrument was wrong, not the gearbox.
  const GEARS = [0.30, 0.47, 0.64, 0.82, 1.00];
  const ceilings = [];
  for (let g = 0; g < 5; g++) {
    reset();
    R.st.speed = R.tune.maxSpeed * GEARS[g] * 0.6;
    R.st.gear = g;
    await settle(16);
    ceilings.push({ gear: g + 1, mph: R.st.speed * MPH, rev: R.st.rev,
                    want: R.tune.maxSpeed * GEARS[g] * MPH });
  }

  // 2. three ways of driving the same car up through the box
  // DISTANCE COVERED IN TWELVE SECONDS FROM A STANDSTILL, not time to 98% of top
  // speed. The first version measured the latter and reported a 14% spread
  // between driving well and driving stupidly — but nearly all of that time was
  // the drag-limited crawl in top gear, which is identical however you got
  // there, so the measurement drowned the thing it was measuring. A standing
  // start against a fixed clock is what a race actually rewards.
  const drive = async (shiftAt) => {
    await arm();
    const d0 = R.st.dist, t0 = R.st.simT;
    let guard = 0;
    while (R.st.simT - t0 < 12 && guard++ < 300) {
      await settle(0.2);
      if (R.st.rev >= shiftAt && R.st.gear < 4) R.st.gear++;
    }
    const covered = R.st.dist - d0;
    // A standing start cannot go backwards. If it did, the race reset under the
    // trial and the number is meaningless — say so rather than print it.
    if (covered < 0) throw new Error(`a twelve-second standing start covered ${covered.toFixed(0)} units`);
    return covered;
  };
  const atRedline = await drive(0.995);
  const atPeak = await drive(0.88);
  const tooEarly = await drive(0.55);

  // 3. never shifting at all
  await arm();
  await settle(20);
  const never = { mph: R.st.speed * MPH, gear: R.st.gear + 1 };

  return { ceilings, atRedline, atPeak, tooEarly, never,
           topMph: R.tune.maxSpeed * MPH };
});
await b.close();

console.log('\n  GEAR CEILINGS, throttle held open in each gear\n');
for (const c of r.ceilings) {
  console.log(`    gear ${c.gear}   ${c.mph.toFixed(0).padStart(3)} mph   revs ${(100 * c.rev).toFixed(0)}%` +
              `   (limiter at ${c.want.toFixed(0)} mph)`);
}
console.log(`    car top ${r.topMph.toFixed(0)} mph\n`);
console.log('  NEVER SHIFTING, twenty seconds flat out:');
console.log(`    ${r.never.mph.toFixed(0)} mph, still in gear ${r.never.gear} — ` +
            `${(100 * r.never.mph / r.topMph).toFixed(0)}% of the car\n`);
console.log('  DISTANCE COVERED IN TWELVE SECONDS FROM A STANDSTILL, world units:');
console.log(`    shifting on the limiter   ${r.atRedline.toFixed(0)}`);
console.log(`    shifting at peak power    ${r.atPeak.toFixed(0)}`);
console.log(`    shifting far too early    ${r.tooEarly.toFixed(0)}`);
const bestD = Math.max(r.atRedline, r.atPeak, r.tooEarly);
const worstD = Math.min(r.atRedline, r.atPeak, r.tooEarly);
console.log(`\n  best is ${(100 * (bestD / worstD - 1)).toFixed(0)}% further than worst` +
            `  (${(bestD - worstD).toFixed(0)} units, ${((bestD - worstD) / 6).toFixed(0)} track segments)`);
console.log('  If that spread is small the box is decoration and the buttons are pointless.\n');
