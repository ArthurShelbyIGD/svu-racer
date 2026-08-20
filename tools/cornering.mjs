// DOES THE CAR TURN INTO THE CORNER?
//
// ===========================================================================
// WHY
// ===========================================================================
//
// Anthony, on the first drive with the chase camera back on:
//
//   "There is also something wrong with how the car looks when cornering which
//    could be a 3rd person killer. The front doesn't turn into the corner, if
//    anything it looks like it is going the wrong way and the car slides
//    sideways around a corner."
//
// "If anything it looks like it is going the wrong way" is the sentence that
// matters, because it is a claim about a SIGN, and a sign is the cheapest thing
// in the world to measure and the easiest thing in the world to argue about.
//
// ===========================================================================
// WHAT "THE ROAD'S DIRECTION" MEANS IN A GAME WITH NO ROAD
// ===========================================================================
//
// This is a projected racer in the Pole Position line: the car never moves and
// never turns. It sits at the origin pointing down -Z for the whole race, and
// the WORLD bends around it — each segment of road is drawn at an x offset
// accumulated from the curvature ahead, exactly as `Posts.update` does it:
//
//     dx += curve[a] * SEG_LEN;  x += dx;
//
// So at the car's own position the road is, by construction, always dead
// straight. An engine that asks "which way is the road pointing at the car?"
// gets "straight ahead" in the middle of the hardest corner on the lap, which
// is why nothing has ever noticed this.
//
// But the EYE does not read the tangent at a point, it reads the stretch it can
// see. Two or three segments ahead — a car's length and a half — the drawn
// centreline of a hard corner has already moved several units sideways, and a
// car sitting square while the tarmac slides past its nose is a car crabbing.
// That is the thing being measured here: the angle of the drawn road over the
// first few segments, against the angle the car is actually turned to.
//
// Both are computed in WORLD space, from the live scene: the car's heading from
// its own matrix, the road's from the same accumulation the road mesh uses. No
// pixels, no classifier, and nothing that can drift from what is on screen.
//
//   node tools/cornering.mjs [track]

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { mkdirSync } from 'node:fs';

const __ROOT = __d(__d(__f(import.meta.url)));
const TRACK = process.argv[2] || 'night';
const PAGE = 'file://' + __j(__ROOT, 'docs', 'index.html')
           + (TRACK === 'night' ? '' : '?track=' + TRACK);
const SHOTS = __j(__ROOT, 'shots');
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 812, height: 375 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });
await page.evaluate(() => {
  window.RACER.menu.close();
  for (const id of ['hud', 'note', 'ctl', 'gears']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
});

const out = await page.evaluate(async () => {
  const R = window.RACER;
  const f = () => new Promise((r) => requestAnimationFrame(() => r()));
  R.startRace();
  await new Promise((done, fail) => {
    const t = R.st.simT + R.consts.COUNTDOWN + 0.05, g = performance.now() + 60000;
    const step = () => {
      if (R.st.simT >= t) return done();
      if (performance.now() > g) return fail(new Error('the countdown never finished'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  const t = R.track, SEG = R.consts.SEG_LEN, n = t.n;

  // THE THREE HARDEST CORNERS, one of each hand plus the worst overall, so a
  // sign error cannot hide behind a track that only turns one way.
  let worstR = { c: 0, i: 0 }, worstL = { c: 0, i: 0 };
  for (let i = 0; i < n; i++) {
    if (t.curve[i] > worstR.c) worstR = { c: t.curve[i], i };
    if (t.curve[i] < worstL.c) worstL = { c: t.curve[i], i };
  }
  const straight = (() => {
    let best = 0, bs = 1e9;
    for (let i = 100; i < n - 300; i += 5) {
      let s = 0;
      for (let k = 0; k < 60; k++) s += Math.abs(t.curve[(i + k) % n]);
      if (s < bs) { bs = s; best = i; }
    }
    return best;
  })();

  /** The drawn centreline's heading, `look` segments ahead, in degrees.
   *  Positive is to the right of the screen, which is +X and a right-hand
   *  corner — the same sign convention as track.curve. */
  const roadHeading = (base, look) => {
    let dx = 0, x = 0;
    for (let k = 0; k < look; k++) { dx += t.curve[(base + k) % n] * SEG; x += dx; }
    return Math.atan2(x, look * SEG) * 180 / Math.PI;
  };

  const car = R.bodyKit.group.parent;

  const sample = async (seg, label) => {
    // DRIVE INTO IT. The steering, the grip and the centrifugal push all have
    // lag in them, so a car teleported into a corner is a car that has not
    // begun to corner. Start well before and let the loop do its own work.
    R.tune.freeze = false;
    R.tune.holdSpeed = 170;
    R.tune.maxSpeed = 210;
    R.st.dist = ((seg - 60 + n) % n) * SEG;
    const stop = seg * SEG;
    await new Promise((done) => {
      const g = performance.now() + 20000;
      const step = () => {
        if (R.st.dist >= stop || performance.now() > g) return done();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    R.tune.freeze = true;
    for (let i = 0; i < 3; i++) await f();

    const base = Math.floor(R.st.dist / SEG) % n;
    car.updateMatrixWorld(true);
    // The car's own forward, taken from its matrix rather than from the euler
    // angle that set it — so a change anywhere in the chain shows up here.
    // Columns 0,1,2 of the matrix are the car's own axes in world space, so the
    // third column is its local +Z and the forward it actually faces is minus
    // that. THE FIRST VERSION OF THIS LINE NEGATED BOTH COMPONENTS, which is
    // the backward direction and reads every heading with its sign flipped —
    // it called a car turned correctly into a right-hander "POINTING THE WRONG
    // WAY", which is precisely the fault it had been written to detect. One
    // more instrument that would have had the game changed to match it.
    const e = car.matrixWorld.elements;
    const fx = -e[8], fz = -e[10];               // the way the nose points
    const carHeading = Math.atan2(fx, -fz) * 180 / Math.PI;
    return {
      label, base, curve: t.curve[base],
      steer: R.st.steer, x: R.st.x,
      carHeading,
      road2: roadHeading(base, 2),
      road3: roadHeading(base, 3),
      road6: roadHeading(base, 6),
    };
  };

  const rows = [];
  rows.push(await sample(straight, 'the straightest run'));
  rows.push(await sample(worstR.i, 'the hardest right'));
  rows.push(await sample(worstL.i, 'the hardest left'));
  R.tune.freeze = false; R.tune.holdSpeed = null;
  return rows;
});

await browser.close();

console.log(`\nCORNERING — does the car point where the road goes? (${TRACK})\n`);
console.log('  Positive is to the RIGHT of the screen, for both the road and the car.\n');
console.log('   corner                   curve   steer     road ahead, degrees        car    verdict');
console.log('                                            2seg   3seg   6seg');
let bad = 0;
for (const r of out) {
  const road = r.road3;
  const flat = Math.abs(road) < 1.5;
  // THE THREE FAILURES, in the order they matter. Pointing the wrong way is a
  // different kind of wrong from not pointing far enough, and lumping them
  // together as "error" would let a sign fault hide inside a magnitude one.
  let verdict;
  if (flat) verdict = Math.abs(r.carHeading) < 2 ? 'ok' : 'CROOKED ON A STRAIGHT';
  else if (Math.sign(r.carHeading) !== Math.sign(road) && Math.abs(r.carHeading) > 0.3) {
    verdict = 'POINTING THE WRONG WAY';
  } else if (Math.abs(r.carHeading) < Math.abs(road) * 0.25) verdict = 'BARELY TURNS IN';
  else if (Math.abs(r.carHeading) > Math.abs(road) * 1.6) verdict = 'OVER-TURNED';
  else verdict = 'ok';
  if (verdict !== 'ok') bad++;
  console.log(`   ${r.label.padEnd(22)} ${r.curve.toFixed(3).padStart(7)} ` +
    `${r.steer.toFixed(2).padStart(6)}  ${r.road2.toFixed(1).padStart(6)} ` +
    `${r.road3.toFixed(1).padStart(6)} ${r.road6.toFixed(1).padStart(6)}  ` +
    `${r.carHeading.toFixed(1).padStart(6)}    ${verdict}`);
}
console.log(`\n  ${bad ? `${bad} of ${out.length} wrong` : 'all three point the right way'}`);
console.log('  The road figure is the DRAWN centreline, accumulated exactly as the road');
console.log('  mesh accumulates it. At the car itself the road is straight by construction,');
console.log('  which is why "3 segments ahead" is the column to read.');
console.log(`  page errors: ${errs.length ? errs.join(' | ') : 'none'}\n`);
process.exit(bad ? 1 : 0);
