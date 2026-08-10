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
await p.evaluate(() => {
  const R = window.RACER;
  R.renderer.setPixelRatio(1); R.tune.freeze = true; R.tune.holdX = 0; R.st.view = 1;
  for (const id of ['hud', 'note', 'ctl']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
});
await p.waitForTimeout(800);

const REVS = [0.30, 0.60, 0.79, 0.85, 0.99];
console.log('\n  SHIFT LAMP, read off the rendered pixels\n');
console.log('  gear      ' + REVS.map((r) => (r * 100).toFixed(0).padStart(5) + '%').join(''));
let bad = 0;
for (let g = 0; g < 5; g++) {
  const row = [];
  for (const rev of REVS) {
    const lit = await p.evaluate(async ({ g, rev }) => {
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
      // SAMPLE THE LAMP ITSELF, at coordinates found by differencing two
      // frames that differ ONLY in gear — same speed, so the field of view and
      // therefore every other pixel is identical. Two earlier versions of this
      // scan guessed a band: one looked at 18-32% down the frame while the
      // lamps sit at 76% and reported "off" everywhere, which reads exactly
      // like a fix that works; the next looked in the right band but locked
      // onto something else red and reported "on" everywhere. A hunt for "the
      // reddest pixel somewhere over there" is not a measurement of a lamp.
      let r = 0, g2 = 0, b2 = 0, n = 0;
      for (let y = Math.round(h * 0.765); y < Math.round(h * 0.80); y++) {
        for (let x = Math.round(w * 0.345); x < Math.round(w * 0.395); x++) {
          const i = ((h - 1 - y) * w + x) * 4;
          r += px[i]; g2 += px[i + 1]; b2 += px[i + 2]; n++;
        }
      }
      return { r: r / n, g: g2 / n, b: b2 / n };
    }, { g, rev });
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
console.log(bad ? `\n  ${bad} cell(s) wrong\n` : '\n  all correct\n');
await b.close();
process.exit(bad ? 1 : 0);
