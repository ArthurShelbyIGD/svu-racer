// WHAT DOES IT LOOK LIKE ON A BIGGER SCREEN, AND WHAT DOES THE ADDRESS BAR COST?
//
// Anthony asked two questions that sound like one: does a bigger phone show
// more of the world, and does Safari's chrome eat into the view. They have
// different answers and both are in the code rather than in an opinion.
//
// The camera holds a fixed HORIZONTAL field of view and derives the vertical
// one from the aspect ratio — main.js's applyFov, `v = 2*atan(tan(hh)/aspect)`.
// Two consequences follow, and this tool measures both rather than asserting
// them:
//
//   1. A WIDER SCREEN SHOWS NO MORE ROAD. The horizontal extent is nailed down,
//      so a bigger phone renders the same view LARGER, not WIDER. Everything
//      scales; nothing new comes into shot at the sides.
//
//   2. A SHORTER SCREEN IS A CROP, NOT A SQUEEZE. Losing height to an address
//      bar shrinks the vertical field of view in the same proportion, so the
//      picture does not distort — you simply lose sky off the top and dashboard
//      off the bottom, at the same magnification.
//
// The second is the one that can actually break something: the cockpit is
// geometry in the scene, not an overlay, so a short enough viewport crops the
// bottom off the dials.
//
//   node tools/iphone.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));
const OUT = __j(ROOT, 'shots');
mkdirSync(OUT, { recursive: true });

// CSS pixel sizes, landscape, measured from the devices rather than rounded.
// The Safari rows subtract the chrome iOS actually leaves in landscape: the
// compact bottom toolbar. iPhone Safari has NO Fullscreen API at all, so unlike
// Android there is no way to make it go away from inside the page — which is
// why "add to home screen" is not a nicety here, it is the fullscreen button.
const SCREENS = [
  { name: "Anthony's Ulefone, fullscreen", w: 720, h: 360 },
  { name: "Ulefone, browser chrome showing", w: 672, h: 280 },
  { name: 'iPhone 14/15, home screen app', w: 844, h: 390 },
  { name: 'iPhone 14/15, Safari chrome', w: 844, h: 340 },
  { name: 'iPhone Pro Max, home screen app', w: 932, h: 430 },
  { name: 'iPhone Pro Max, Safari chrome', w: 932, h: 380 },
];

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

const rows = [];
for (const s of SCREENS) {
  const p = await b.newPage({ viewport: { width: s.w, height: s.h } });
  await p.goto('file://' + __j(ROOT, 'docs', 'index.html'), { waitUntil: 'load' });
  await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  await p.evaluate(() => {
    // GET THE LANDING PAGE OUT OF THE WAY. It is a DOM layer over the canvas,
    // so a page screenshot photographs the menu rather than the game — which
    // is exactly how it blinded two of these tools the day it shipped. Tools
    // that read the WebGL buffer with gl.readPixels never saw the problem,
    // because the menu is not in that buffer.
    if (window.RACER.menu) window.RACER.menu.close();
    const R = window.RACER;
    R.renderer.setPixelRatio(1); R.tune.holdX = 0; R.st.view = 1;
    for (const id of ['hud', 'note', 'ctl']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    R.startRace();
  });
  await p.evaluate((secs) => new Promise((done, fail) => {
    const R = window.RACER;
    const t = R.st.simT + secs, give = performance.now() + 90000;
    const step = () => {
      if (R.st.simT >= t) return done();
      if (performance.now() > give) return fail(new Error('stalled'));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }), 4.6);
  // Same speed and same gear everywhere, or the field of view opens with speed
  // and the comparison is of the throttle rather than of the screen.
  await p.evaluate(() => {
    const R = window.RACER;
    R.st.gear = 3; R.st.speed = 0.72 * R.tune.maxSpeed; R.st.air = 0;
  });
  await p.waitForTimeout(500);
  await p.evaluate(() => { window.RACER.tune.freeze = true; });
  await p.waitForTimeout(400);

  const shot = PNG.sync.read(await p.screenshot());
  const geom = await p.evaluate(() => {
    const R = window.RACER;
    return { vfov: R.camera.fov, aspect: R.camera.aspect,
             hfov: 2 * Math.atan(Math.tan(R.camera.fov * Math.PI / 360) * R.camera.aspect) * 180 / Math.PI,
             dpr: R.renderer.getPixelRatio() };
  });

  // WHERE THE DASHBOARD IS, BY HIDING IT. The first version of this walked up
  // the centre column looking for a colour step and reported the dash filling
  // 2% of the screen on every one of the six — it had locked onto the first
  // edge it met coming up from the bottom, which is a shadow on the steering
  // wheel. Hiding the mesh and differencing cannot be fooled that way: every
  // pixel that changes IS the cockpit, by construction.
  // THROUGH tune.showCockpit, NOT cockpit.group.visible. The frame loop writes
  // that visibility flag every single frame — `cockpit.group.visible = st.view
  // === 1 && tune.showCockpit` — so setting it from out here lasts until the
  // next frame and no longer. The "bare" screenshot still had the whole
  // dashboard in it, and the diff was measuring renderer noise while reporting
  // tidy-looking percentages. Every affordance a harness needs has to be read
  // BY the loop, which is what tune is for.
  await p.evaluate(() => { window.RACER.tune.showCockpit = false; });
  await p.waitForTimeout(350);
  const bare = PNG.sync.read(await p.screenshot());
  await p.evaluate(() => { window.RACER.tune.showCockpit = true; });
  await p.waitForTimeout(250);

  // AND WHERE THE INSTRUMENTS LAND, projected rather than eyeballed. Coverage
  // says how much glass the cockpit fills; it does not say whether the dials
  // are still ON the glass. These four are the extremities — the nitrous dial
  // and its switch sit lowest and furthest right, the brake pedal lowest left,
  // the countdown highest — so if all four are inside the frame nothing between
  // them can be outside it.
  const parts = await p.evaluate(() => {
    const R = window.RACER;
    const mesh = R.cockpit.group.children[0];
    const pos = mesh.geometry.getAttribute('position');
    // THE MATRICES BY HAND, because three.js's classes are inside the bundle's
    // closure and window.RACER does not hand out Vector3. Column-major, the way
    // three.js stores them, and the same three matrices .project() would use.
    mesh.updateWorldMatrix(true, false);
    R.camera.updateMatrixWorld();
    const mul = (m, v) => {
      const e = m.elements, [x, y, z, w] = v;
      return [e[0] * x + e[4] * y + e[8] * z + e[12] * w,
              e[1] * x + e[5] * y + e[9] * z + e[13] * w,
              e[2] * x + e[6] * y + e[10] * z + e[14] * w,
              e[3] * x + e[7] * y + e[11] * z + e[15] * w];
    };
    const out = {};
    for (const name of Object.keys(R.cockpit.stats.q)) {
      const q = R.cockpit.stats.q[name];
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (let k = 0; k < 4; k++) {
        const j = q * 4 + k;
        let v = [pos.array[j * 3], pos.array[j * 3 + 1], pos.array[j * 3 + 2], 1];
        v = mul(mesh.matrixWorld, v);
        v = mul(R.camera.matrixWorldInverse, v);
        v = mul(R.camera.projectionMatrix, v);
        const iw = 1 / (v[3] || 1e-6);
        const nx = v[0] * iw, ny = v[1] * iw;
        if (nx < x0) x0 = nx; if (nx > x1) x1 = nx;
        if (ny < y0) y0 = ny; if (ny > y1) y1 = ny;
      }
      out[name] = { x0, x1, y0, y1, inside: x0 > -1 && x1 < 1 && y0 > -1 && y1 < 1 };
    }
    return out;
  });

  await p.close();

  let n = 0, top = shot.height, bottom = -1;
  for (let y = 0; y < shot.height; y++) {
    for (let x = 0; x < shot.width; x++) {
      const i = (y * shot.width + x) * 4;
      const d = Math.abs(shot.data[i] - bare.data[i]) + Math.abs(shot.data[i + 1] - bare.data[i + 1])
              + Math.abs(shot.data[i + 2] - bare.data[i + 2]);
      if (d > 12) { n++; if (y < top) top = y; if (y > bottom) bottom = y; }
    }
  }
  // Does it run off the bottom of the glass? A cockpit that stops short of the
  // last row has been shrunk to fit; one that reaches it is simply cropped,
  // which is what should happen and is what the driver's own eye does.
  const reachesBottom = bottom >= shot.height - 2;
  rows.push({ ...s, ...geom, parts,
              dashTop: top, dashPct: 100 * (shot.height - top) / shot.height,
              coverPct: 100 * n / (shot.width * shot.height), reachesBottom });
  writeFileSync(__j(OUT, `screen-${s.w}x${s.h}.png`), PNG.sync.write(shot));
}
await b.close();

console.log('\n  THE SAME MOMENT ON SIX SCREENS\n');
console.log('  screen                              size    h-fov   v-fov   cockpit fills');
for (const r of rows) {
  console.log(`  ${r.name.padEnd(34)} ${(r.w + 'x' + r.h).padStart(8)}  ` +
              `${r.hfov.toFixed(1).padStart(5)}   ${r.vfov.toFixed(1).padStart(5)}   ` +
              `${r.coverPct.toFixed(0).padStart(9)}% of the glass`);
}

const fails = [];
// 1. THE HORIZONTAL VIEW IS THE SAME EVERYWHERE. This is the claim that answers
//    "does a bigger screen show more of the world" — it does not; it shows the
//    same world bigger.
const hs = rows.map((r) => r.hfov);
const spread = Math.max(...hs) - Math.min(...hs);
console.log(`\n  horizontal field of view varies by ${spread.toFixed(2)} degrees across all six`);
console.log('  -> a bigger phone shows the SAME view, LARGER. Nothing new arrives at the sides.');
if (spread > 0.5) fails.push(`the horizontal field of view is not constant: ${spread.toFixed(2)} degrees of spread`);

// 2. THE ADDRESS BAR IS A CROP. Compare each phone with and without its chrome:
//    if the vertical fov falls in the same proportion as the height, the
//    picture is being cropped rather than squashed, and the scale is unchanged.
console.log('\n  WHAT THE ADDRESS BAR COSTS\n');
for (const [full, cut] of [[rows[2], rows[3]], [rows[4], rows[5]]]) {
  const hRatio = cut.h / full.h;
  const tanRatio = Math.tan(cut.vfov * Math.PI / 360) / Math.tan(full.vfov * Math.PI / 360);
  console.log(`  ${full.name.replace(', home screen app', '')}`);
  console.log(`    height  ${full.h} -> ${cut.h}   (${(100 * (1 - hRatio)).toFixed(0)}% less screen)`);
  console.log(`    v-fov   ${full.vfov.toFixed(1)} -> ${cut.vfov.toFixed(1)} degrees`);
  console.log(`    the view shrinks by ${(100 * (1 - tanRatio)).toFixed(0)}% against ` +
              `${(100 * (1 - hRatio)).toFixed(0)}% less screen — ` +
              `${Math.abs(tanRatio - hRatio) < 0.02 ? 'a CROP, at the same magnification'
                                                    : 'NOT a clean crop; the scale is changing too'}`);
  if (Math.abs(tanRatio - hRatio) > 0.02) {
    fails.push(`${full.name}: losing height rescales the picture rather than cropping it`);
  }
}

// 3. AND THE THING THAT COULD ACTUALLY BREAK: the cockpit is geometry, so a
//    short viewport crops the dials rather than shrinking them.
console.log('\n  ARE THE INSTRUMENTS STILL ON THE GLASS\n');
console.log('  screen                             nitrous dial   boost switch   brake pedal   countdown');
for (const r of rows) {
  const cell = (k) => {
    const q = r.parts[k];
    if (!q) return '     -      ';
    // How close to the edge, as a fraction of the half-frame. 0 is dead centre,
    // 1 is exactly on the edge, over 1 is off the screen.
    const worst = Math.max(Math.abs(q.y0), Math.abs(q.y1), Math.abs(q.x0), Math.abs(q.x1));
    return `${q.inside ? ' ' : '!'}${worst.toFixed(2)} of 1.0`;
  };
  console.log(`  ${r.name.padEnd(34)} ${cell('nos')}  ${cell('switch')}  ${cell('pedal')}  ${cell('count')}`);
  // THE COUNTDOWN IS NOT JUDGED HERE, and it reads over 1.00 on every screen
  // without anything being wrong. Its quad is an atlas cell with transparent
  // padding around the glyph, so the corners of the QUAD sit outside the frame
  // while the "3" inside it does not. Judging it by its quad would be judging
  // the padding. tools/cdclear.mjs measures the countdown properly — the
  // lowest lit PIXEL of the glyph including its shadow, against the top of the
  // steering wheel — and that is the number that means anything.
  for (const k of ['nos', 'switch', 'pedal']) {
    if (r.parts[k] && !r.parts[k].inside) fails.push(`${r.name}: the ${k} is off the screen`);
  }
}
console.log('\n  (distance from the middle of the screen to the furthest corner of each,');
console.log('   where 1.00 is the very edge of the glass. The countdown is its atlas cell');
console.log('   rather than its glyph, so it reads over 1.00 on padding — see cdclear.mjs.)');
const tight = Math.max(...rows.map((r) => Math.max(r.parts.nos.x1, Math.abs(r.parts.pedal.x0),
                                                   Math.abs(r.parts.pedal.y0))));
console.log(`\n  the closest anything real gets to the edge, on any of the six: ${tight.toFixed(2)}`);

console.log(`\n  wrote ${rows.length} screenshots to shots/`);
console.log('');
if (fails.length) { for (const f of fails) console.log(`  FAILED: ${f}`); process.exit(1); }
console.log('  the framing holds on every screen\n');
