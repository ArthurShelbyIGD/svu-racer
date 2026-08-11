// WHEN IS THE SHIFT LIGHT ON, AND SHOULD IT BE?
//
// It shipped lit on every straight, because in top gear at full throttle the
// car sits near its limiter by definition and nothing checked whether there was
// a gear to shift into. Reported from a real drive: "flat out, fully boosted,
// way over 240mph, centre of the road and the light is red."
//
// So walk every gear across the rev range and read the lamp's actual colour off
// the rendered frame, rather than asking the code what it thinks it drew.
//
//   node tools/shiftlamp.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const p = await b.newPage({ viewport: { width: 720, height: 360 } });
await p.goto('file://' + __j(ROOT, 'docs', 'index.html'), { waitUntil: 'load' });
await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
// THE RACE HAS TO BE RUNNING OR THERE IS NOTHING TO MEASURE. On the grid and
// through the countdown main.js sets st.speed to zero every frame — the
// throttle is dead on the line, deliberately — and that branch runs BEFORE
// tune.freeze, so freezing does not help. This rig used to load the page and
// start writing speeds into a car that was still sitting on the start line: the
// cockpit was handed speed 0, rev 0, gear 0 for every single cell, the lamp was
// correctly dark in all of them, and the tool reported twelve failures against
// a lamp that works. It read exactly like a regression.
await p.evaluate(() => {
  const R = window.RACER;
  R.renderer.setPixelRatio(1); R.tune.holdX = 0; R.st.view = 1;
  for (const id of ['hud', 'note', 'ctl']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
  R.startRace();
});
await p.evaluate((secs) => new Promise((done, fail) => {
  const R = window.RACER;
  const t = R.st.simT + secs, give = performance.now() + secs * 12000 + 15000;
  const step = () => {
    if (R.st.simT >= t) return done();
    if (performance.now() > give) return fail(new Error('stalled'));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}), 4.2);
await p.evaluate(() => { window.RACER.tune.freeze = true; });
await p.waitForTimeout(400);
// AND THE RACE MUST STILL BE RUNNING WHEN THE LAST CELL IS READ. If it is not,
// everything below measured a car on the line again and the failure would look
// like a broken lamp rather than a broken rig.
const raceGuard = async (where) => {
  const st = await p.evaluate(() => window.RACER.race.state);
  if (st !== 'racing') {
    console.log(`\n  THE RACE WAS '${st}', NOT 'racing', ${where}. Nothing below is a ` +
                `measurement of the lamp.`);
    await b.close();
    process.exit(1);
  }
};
await raceGuard('before the sweep');

// ---- FIND THE LAMP, DO NOT ASSUME WHERE IT IS ------------------------------
//
// This used to sample a hardcoded band — 76.5-80% down, 34.5-39.5% across —
// found once by differencing and then written in as numbers. The dash was
// rebuilt around the nitrous switch and the lamps moved, and the band came to
// point at bare dashboard: it read rgb 112,94,70 for every gear at every rev
// and reported twelve wrong cells on a lamp that was working perfectly. A
// hardcoded coordinate is a measurement with an expiry date on it.
//
// So locate it the same way the coordinates were originally derived, but do it
// every run: photograph the same speed in a gear that should light the lamp and
// in top gear, which must not, and keep the pixels that both CHANGED and are
// red. Changing gear also redraws the gear numeral in the tacho, which is why
// the redness filter is needed as well as the difference.
const lampBox = await p.evaluate(async () => {
  const R = window.RACER;
  const grab = async () => {
    const f = () => new Promise((r) => requestAnimationFrame(() => r()));
    await f(); await f(); await f();
    const gl = R.renderer.getContext();
    const w = R.renderer.domElement.width, h = R.renderer.domElement.height;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { px, w, h };
  };
  // The same road speed in both, so the field of view, the camera and every
  // pixel outside the dash are identical and cannot enter the difference.
  const speed = 0.95 * R.tune.maxSpeed * R.consts.GEARS[3];
  R.st.gear = 3; R.st.speed = speed;
  const on = await grab();
  R.st.gear = 4; R.st.speed = speed;
  const off = await grab();

  // THE FILTER IS "BECAME RED", NOT "IS RED". The dial faces have a red arc
  // painted on them and the needle is red too, so plenty of pixels are both red
  // and different between the two frames — the needle has moved. Those made the
  // found box four times the size of the lamp, and averaging over it buried a
  // lit lamp in dark dashboard: rgb 74,56,52, reported as off. What identifies
  // a lamp is that it was NOT red a moment ago and is now.
  const redness = (a, i) => a.px[i] - Math.max(a.px[i + 1], a.px[i + 2]);
  const mask = [];
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < on.h; y++) {
    for (let x = 0; x < on.w; x++) {
      const i = (y * on.w + x) * 4;
      if (redness(on, i) < 40) continue;
      if (redness(on, i) - redness(off, i) < 40) continue;
      mask.push(x, y);
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return mask.length === 0 ? { n: 0, w: on.w, h: on.h }
    : { n: mask.length / 2, mask, x0, y0, x1, y1, w: on.w, h: on.h };
});
if (!lampBox.n) {
  console.log('\n  THE LAMP WAS NEVER FOUND: no red pixel changed between a gear that should\n' +
              '  light it and top gear, which should not. Either the lamp never lights, or\n' +
              '  it is not red. Nothing below would mean anything, so stopping here.');
  await b.close();
  process.exit(1);
}
console.log(`\n  the lamp found by differencing: ${lampBox.x1 - lampBox.x0 + 1}x` +
            `${lampBox.y1 - lampBox.y0 + 1} px at ${lampBox.x0},${lampBox.y0} ` +
            `of ${lampBox.w}x${lampBox.h}  (${lampBox.n} red pixels)`);

const REVS = [0.30, 0.60, 0.79, 0.85, 0.99];
console.log('\n  SHIFT LAMP, read off the rendered pixels\n');
console.log('  gear      ' + REVS.map((r) => (r * 100).toFixed(0).padStart(5) + '%').join(''));
let bad = 0;
for (let g = 0; g < 5; g++) {
  const row = [];
  for (const rev of REVS) {
    const lit = await p.evaluate(async ({ g, rev, box }) => {
      const R = window.RACER;
      R.st.gear = g;
      // DRIVE IT THROUGH THE SPEED, not by assigning st.rev. The frame loop
      // recomputes rev from speed and the gear's ceiling every frame, so an
      // assignment from out here survives a fraction of a frame and the first
      // version of this test measured a lamp that was never being asked to
      // light — five rows of "off", which reads exactly like a fix that works.
      R.st.speed = rev * R.tune.maxSpeed * R.consts.GEARS[g];
      const f = () => new Promise((r) => requestAnimationFrame(() => r()));
      await f(); await f(); await f();
      const gl = R.renderer.getContext();
      const w = R.renderer.domElement.width, h = R.renderer.domElement.height;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      // SAMPLE THE BOX THE LAMP WAS FOUND IN THIS RUN. Two earlier versions of
      // this scan guessed a band: one looked at 18-32% down the frame while the
      // lamps sit at 76% and reported "off" everywhere, which reads exactly
      // like a fix that works; the next looked in the right band but locked
      // onto something else red and reported "on" everywhere. The third wrote
      // down the right coordinates and then the dash moved underneath them.
      // The box now comes from a difference taken moments ago, in this build.
      // THE MASK, NOT ITS BOUNDING BOX. The lamp is a lens with a bezel and the
      // box around it is mostly bezel; averaging the box mixed a lit lamp with
      // enough dark trim to read as unlit. These are the pixels that actually
      // changed colour when the lamp came on.
      let r = 0, g2 = 0, b2 = 0, n = 0;
      for (let k = 0; k < box.mask.length; k += 2) {
        const i = (box.mask[k + 1] * w + box.mask[k]) * 4;
        r += px[i]; g2 += px[i + 1]; b2 += px[i + 2]; n++;
      }
      return { r: r / n, g: g2 / n, b: b2 / n };
    }, { g, rev, box: lampBox });
    // Lit is red-dominant. Off is the dark grey the lamp is painted at rest.
    const on = lit.r - Math.max(lit.g, lit.b) > 40;
    if (g === 0) console.log(`    (gear 1 @ ${(rev*100).toFixed(0)}%: lamp rgb ` +
      `${lit.r.toFixed(0)},${lit.g.toFixed(0)},${lit.b.toFixed(0)})`);
    // THE LAMP IS TIED TO THE ARC THE DIAL DRAWS, not to main.js's REDLINE.
    // The needle carries a 0.10 idle floor — a rev counter reading zero at a
    // standstill is wrong for a running engine — so displayed = 0.10 + rev*0.90
    // and the drawn red starts at 0.80 of the sweep, which is raw 0.7778. That
    // is deliberate: lamp and needle can then never disagree about where the
    // red begins. My first expectation here used the raw 0.80 and flagged the
    // 79% column as wrong when the code was right.
    const want = (0.10 + rev * 0.90) >= 0.80 && g < 4;
    if (on !== want) bad++;
    row.push((on ? '  RED' : '   - ') + (on === want ? ' ' : '!'));
  }
  console.log(`  ${g + 1} of 5   ` + row.join(''));
}
console.log('\n  want: lit once the needle is in the drawn red (raw 0.778), and');
console.log('  NEVER in top gear — there is nowhere to shift to, and the car');
console.log('  sits there at full throttle by definition.');
await raceGuard('by the end of the sweep');
console.log(bad ? `\n  ${bad} cell(s) wrong\n` : '\n  all correct\n');
await b.close();
process.exit(bad ? 1 : 0);
