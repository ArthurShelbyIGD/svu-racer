// HOW SHOULD THE BOTTLE BE SPENT?
//
// Anthony, at 1:27.7 on the Docks: "I feel I can do a bit better once I have
// the nitrous usage dialed in to suit the track." He worked out the answer for
// MIDNIGHT MILE by driving it — "better to have long runs with gas opposed to
// shorter squirts so let it nearly empty, then nearly full, rinse and repeat"
// — and tools/launch.mjs has been ending with the line "which of the two buys
// more per second of bottle is still unmeasured" for a fortnight.
//
// ===========================================================================
// WHY IT IS NOT OBVIOUS, AND WHY ARITHMETIC CANNOT SETTLE IT
// ===========================================================================
//
// Boost does TWO unrelated things. It multiplies acceleration by BOOST_ACCEL,
// which only helps while you are below the ceiling, and it raises the ceiling
// itself by BOOST_TOP, which only helps once you are at it. A squirt taken at
// top speed spends most of itself ACCELERATING toward a new ceiling it may
// never reach; a long run reaches that ceiling and then holds it, so the
// second half of a long run is worth more per second than the first.
//
// Against that, the bottle is a rate problem. A full one is BOOST_DRAIN
// seconds of boost and an empty one needs BOOST_REFILL seconds of clean road
// to come back, and refill ONLY runs while the button is up — so total boost
// available over a lap of T seconds settles at
//
//     used = (BOOST_DRAIN + T * BOOST_DRAIN / BOOST_REFILL)
//            / (1 + BOOST_DRAIN / BOOST_REFILL)
//
// which on an 88-second Docks lap is about 32 seconds, whatever pattern you
// use. So the question is not how MUCH but WHERE, and the two effects above
// pull in different directions.
//
// None of that is settleable on paper, because it depends on the shape of one
// particular road. So: drive the same lap with the same car under different
// spending policies and read the clock.
//
// ===========================================================================
// WHAT THIS CANNOT TELL YOU
// ===========================================================================
//
// It drives pinned to the centre line, because a harness that wandered would
// be measuring its own steering. A perfect line means corners cost NO speed —
// the car's grip is calibrated so full lock beats the worst corner at the cap
// — so any advice here is advice for a driver who never runs wide. A real
// player who loses speed in a corner has a reason to spend on the exit that
// this rig cannot see, and that gap is worth saying out loud rather than
// burying.
//
//   node tools/nitrous.mjs [track]
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));
const TRACK = process.argv[2] || 'docks';

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const p = await b.newPage({ viewport: { width: 400, height: 240 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('file://' + __j(ROOT, 'docs', 'index.html') + '?track=' + TRACK, { waitUntil: 'load' });
await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
await p.evaluate(() => { window.RACER.menu.close(); window.RACER.renderer.setPixelRatio(0.25); });

/**
 * Drive one lap under a named policy and return what happened.
 *
 * The policy is a function of the car's state, evaluated every frame, that
 * returns whether the button is down. It is passed as a STRING because it has
 * to be compiled inside the page.
 */
const lap = (name, body) => p.evaluate(async (a) => {
  const [name, body] = a;
  // eslint-disable-next-line no-new-func
  const want = new Function('s', body);
  const R = window.RACER;
  R.startRace();
  await new Promise((done, fail) => {
    const t = R.st.simT + R.consts.COUNTDOWN + 0.05, g = performance.now() + 60000;
    const st = () => { if (R.st.simT >= t) return done();
      if (performance.now() > g) return fail(new Error('countdown never finished'));
      requestAnimationFrame(st); };
    requestAnimationFrame(st);
  });
  R.tune.holdX = 0;
  R.pedal.brake = false;

  const CAP = R.tune.maxSpeed;
  let boostT = 0, last = R.st.simT, atTop = 0, frames = 0, presses = 0, was = false;
  await new Promise((done, fail) => {
    const g = performance.now() + 400000;
    const step = () => {
      if (R.race.state === 'racing') {
        // Shift on the limiter, the way a good player does.
        if (R.st.rev > 0.985 && R.st.gear < R.consts.GEARS.length - 1) R.st.gear++;
        const dt = R.st.simT - last; last = R.st.simT;
        const s = { speed: R.st.speed, cap: CAP, frac: R.st.speed / CAP,
                    bottle: R.st.boostLeft, dist: R.st.dist,
                    seg: Math.floor(R.st.dist / R.consts.SEG_LEN),
                    curve: Math.abs(R.track.curve[Math.floor(R.st.dist / R.consts.SEG_LEN)
                                                  % R.track.n]),
                    t: R.st.simT };
        const on = !!want(s);
        // ARMED OR NOT, THE BUTTON IS WHAT WE ASKED FOR. The game decides
        // whether anything comes out; holding it down on an empty bottle is a
        // real thing a player does and it blocks the refill, which is exactly
        // the kind of self-inflicted wound this is meant to price.
        R.pedal.boost = on;
        if (on && !was) presses++;
        was = on;
        if (on && R.st.boostLeft > 0) boostT += dt;
        if (R.st.speed > CAP * 0.99) atTop += dt;
        frames++;
      }
      if (R.race.state !== 'racing' && frames > 10) return done();
      if (performance.now() > g) return fail(new Error('the lap never finished'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  R.pedal.boost = false; R.tune.holdX = null;
  return { name, lap: R.race.elapsed, boostT, presses, atTop };
}, [name, body]);

// ---- THE POLICIES ---------------------------------------------------------
// Each one is the body of a function of `s`, returning whether to hold the
// button this frame. They are written the way a player would describe them.
const POLICIES = [
  ['never touch it',
   'return false;'],

  ['mash it — on whenever there is anything in the bottle',
   'return s.bottle > 0.02;'],

  // ANTHONY'S OWN RULE, from driving MIDNIGHT MILE: run it nearly out, let it
  // come nearly back, repeat. Written as a latch so it does not chatter.
  ['long runs: empty it, refill it, repeat',
   'if (!this.on && s.bottle > 0.92) this.on = true;' +
   'if (this.on && s.bottle < 0.06) this.on = false;' +
   'return !!this.on;'],

  ['short squirts: two seconds on, five off',
   'return (s.t % 7) < 2 && s.bottle > 0.1;'],

  // The two that test the actual question: is a second of bottle worth more
  // spent at the ceiling or spent climbing back to it?
  ['only at the ceiling — straights, already flat out',
   'return s.frac > 0.985 && s.bottle > 0.05;'],

  ['only below the ceiling — accelerating, never on a straight',
   'return s.frac < 0.97 && s.bottle > 0.05;'],

  // And the one that sounds cleverest and is worth pricing.
  ['long runs, but only started on straight road',
   'if (!this.on && s.bottle > 0.92 && s.curve < 0.02) this.on = true;' +
   'if (this.on && s.bottle < 0.06) this.on = false;' +
   'return !!this.on;'],
];

// PRINT AS THEY LAND. Seven laps at eighty-eight seconds each is a quarter of
// an hour of silence otherwise, and a rig that shows nothing until it is
// finished is a rig you cannot tell from a hung one.
const out = [];
console.log(`\n  SPENDING THE BOTTLE ON ${TRACK.toUpperCase()} — ${POLICIES.length} laps to drive\n`);
for (const [name, body] of POLICIES) {
  const r = await lap(name, body);
  out.push(r);
  console.log(`   ...${r.lap.toFixed(1)}s   ${name}`);
}
await b.close();

const base = out[0].lap;
const best = Math.min(...out.map((r) => r.lap));
console.log('');
console.log('   policy                                            lap     vs no boost   boost used   presses');
for (const r of out) {
  const mark = r.lap === best ? ' <-- fastest' : '';
  console.log(`   ${r.name.padEnd(48)} ${r.lap.toFixed(1).padStart(5)}s   ` +
              `${(base - r.lap >= 0 ? '-' : '+')}${Math.abs(base - r.lap).toFixed(1).padStart(4)}s      ` +
              `${r.boostT.toFixed(1).padStart(5)}s     ${String(r.presses).padStart(4)}${mark}`);
}
console.log(`\n  page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
console.log('\n  Driven pinned to the centre line, so corners cost no speed here.');
console.log('  A player who runs wide has a reason to spend on the exit that this');
console.log('  cannot see — read the ceiling-vs-below rows with that in mind.\n');
