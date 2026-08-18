// WHAT IS FLICKERING IN THE CONTAINER YARD?
//
// Anthony, on the first drivable Docks: "The containers flicker a bit at the
// start of the race."
//
// There are three candidates and they need very different fixes, so the first
// job is telling them apart rather than picking the likeliest:
//
//   1. Z-FIGHTING. Containers are placed one per segment with a depth of 14.2
//      or 28.3 units against a 6-unit spacing, so every box overlaps the two
//      or three behind it — and they are all EXACTLY the same width and
//      height, so their long side faces are coplanar over the overlap. Two
//      coplanar faces at the same depth is the textbook case: which one wins a
//      pixel depends on floating-point noise, and it changes as the camera
//      moves. SIGNATURE: fine speckle scattered over a face, unstable under a
//      sub-unit camera move, stable when the camera is still.
//
//   2. INSTANCE SLOT SHUFFLE. Scenery writes matrix and colour to a running
//      cursor `k`, and the water suppression added a `continue` that skips
//      slots. If a skip changes the cursor between frames, a box could take
//      the previous frame's neighbour's colour for a frame. SIGNATURE: a WHOLE
//      container changing colour at once, not speckle.
//
//   3. THE LOAD DIAL RE-PLACING. The city's row stacking drops the outermost
//      rows when it runs out of instances, and a yard suppressed over water
//      frees slots unevenly. SIGNATURE: whole containers appearing and
//      vanishing at the far edge of the yard rather than changing.
//
// So this walks the camera forward in SUB-UNIT steps, which is the one thing
// all three respond to differently, and reports both how much changed and WHAT
// KIND of change it was:
//
//   speckle   isolated changed pixels with unchanged neighbours — z-fighting
//   patches   changed pixels in solid runs — a whole box changing or moving
//
// A frame-to-frame diff on its own cannot distinguish any of this from the
// world simply moving, which it is: at 0.05 units a step the world moves too,
// just very little. That is what the CONTROL is for — the same walk with the
// yard replaced by the night city, which has never flickered. Whatever the
// city scores at the same step size is what "normal motion" looks like here.
//
//   node tools/flicker.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));
mkdirSync(__j(ROOT, 'shots'), { recursive: true });

const STEP = 0.05;        // world units between frames — far less than a pixel of motion
const FRAMES = 12;

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

const walk = async (query, seg, step, prep) => {
  const p = await b.newPage({ viewport: { width: 640, height: 320 }, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + __j(ROOT, 'docs', 'index.html') + query, { waitUntil: 'load' });
  await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  await p.evaluate(() => { window.RACER.menu.close();
    for (const id of ['hud', 'note', 'ctl', 'gears']) {
      const e = document.getElementById(id); if (e) e.style.display = 'none';
    }
    window.RACER.startRace(); });
  await p.evaluate((s) => new Promise((d, f) => {
    const R = window.RACER, t = R.st.simT + s, g = performance.now() + 90000;
    const st = () => { if (R.st.simT >= t) return d();
      if (performance.now() > g) return f(new Error('stalled')); requestAnimationFrame(st); };
    requestAnimationFrame(st);
  }), 4.4);
  await p.evaluate(() => { const R = window.RACER; R.tune.freeze = true; R.tune.holdX = 0; });
  // An in-page tweak applied after boot, so a case can remove one suspect and
  // leave everything else alone. This is the only way to ask "is it the
  // texture" without shipping a build without the texture in it.
  if (prep) { await p.evaluate(prep); await p.waitForTimeout(300); }

  const out = [];
  for (let k = 0; k < FRAMES; k++) {
    await p.evaluate((d) => { window.RACER.st.dist = d; }, seg * 6 + k * step);
    await p.waitForTimeout(200);
    out.push(PNG.sync.read(await p.screenshot()));
  }
  await p.close();
  return { out, errs };
};

/**
 * HOW MUCH CHANGED, AND WHETHER IT CHANGED IN SPECKLE OR IN PATCHES.
 *
 * Only the world above the cockpit is looked at — the dash is a third of the
 * frame, never moves, and would dilute every number here toward zero.
 */
const compare = (a, c) => {
  const { width: w, height: h } = a;
  const top = Math.floor(h * 0.52);
  const changed = new Uint8Array(w * top);
  let n = 0;
  for (let y = 0; y < top; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const d = Math.max(Math.abs(a.data[i] - c.data[i]), Math.abs(a.data[i + 1] - c.data[i + 1]),
                       Math.abs(a.data[i + 2] - c.data[i + 2]));
    if (d > 12) { changed[y * w + x] = 1; n++; }
  }
  // A changed pixel with no changed neighbour is speckle; one in a run is part
  // of a patch. Z-fighting is overwhelmingly the former, a moving edge the
  // latter, and a whole box changing colour is entirely the latter.
  let lone = 0;
  for (let y = 1; y < top - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (!changed[y * w + x]) continue;
    const near = changed[y * w + x - 1] + changed[y * w + x + 1] +
                 changed[(y - 1) * w + x] + changed[(y + 1) * w + x];
    if (near === 0) lone++;
  }
  return { pct: 100 * n / (w * top), speckle: n ? 100 * lone / n : 0 };
};

// THE FIRST ROW IS THE NEGATIVE CONTROL AND IT IS THE ONE THAT MATTERS.
//
// Step ZERO: the same distance, the same frozen car, twelve screenshots. If
// anything changes there then nothing is moving and the scenery is rebuilding
// itself differently frame to frame — which is a completely different bug from
// "0.05 units of parallax on a container six metres away", and the first run
// of this tool could not tell them apart because it had no still frame to
// compare against. Everything below it is only interpretable relative to this.
const CASES = [
  { q: '?track=docks', seg: 200,  step: 0,    what: 'the Docks, STILL — nothing should change at all' },
  { q: '?track=docks', seg: 200,  step: 0.05, what: 'the Docks at the start line, over water' },
  { q: '?track=docks', seg: 1400, step: 0.05, what: 'the Docks where there is NO water' },
  { q: '',             seg: 200,  step: 0.05, what: 'MIDNIGHT MILE — never flickered' },
  // THE DECISIVE ONE. Same yard, same boxes, same everything — with the
  // corrugated tile taken off and the instance colour left to paint them flat.
  // If the change rate falls to the city's, the ribs are the flicker: eighteen
  // of them across a container that is 90-200 screen pixels wide is a stripe
  // every 5-11px, scrolling past a metre from the camera at 200mph, which is
  // textbook temporal aliasing and exactly what the road banding comment in
  // main.js warns about for the periphery.
  { q: '?track=docks', seg: 200,  step: 0.05, what: 'the Docks with the rib texture REMOVED',
    prep: () => { const m = window.RACER.scenery.mesh.material; m.map = null; m.needsUpdate = true; } },
  // And the same idea from the other end: keep the ribs, halve how far the
  // camera is from them. If distance is what matters rather than the texture,
  // this gets worse and the one above does not get better.
  { q: '?track=docks', seg: 200,  step: 0.05, what: 'the Docks with the tile at quarter frequency',
    prep: () => { const t = window.RACER.scenery.mesh.material.map;
                  t.repeat.set(0.25, 1); t.needsUpdate = true; } },
];

console.log(`\n  ${FRAMES} FRAMES AT EACH POSE\n`);
console.log('   where                                             step   changed   of which speckle');
const shots = [];
for (const c of CASES) {
  const r = await walk(c.q, c.seg, c.step, c.prep);
  let pct = 0, sp = 0;
  for (let k = 1; k < r.out.length; k++) {
    const m = compare(r.out[k - 1], r.out[k]);
    pct += m.pct; sp += m.speckle;
  }
  pct /= r.out.length - 1; sp /= r.out.length - 1;
  console.log(`   ${c.what.padEnd(48)} ${String(c.step).padStart(4)} ${pct.toFixed(2).padStart(7)}%   ${sp.toFixed(0).padStart(3)}%`);
  if (r.errs.length) console.log(`      page errors: ${r.errs.join(' | ')}`);
  shots.push({ c, r });
}

// The two worst-differing frames of the first case, side by side with the
// difference in red. Looking at it is not optional: "3% of pixels changed and
// 70% of them were lone" is a hypothesis, and the picture is the test of it.
const first = shots[0].r.out;
const W = first[0].width, H = Math.floor(first[0].height * 0.52);
const sheet = new PNG({ width: W, height: H * 3 + 8 });
sheet.data.fill(20);
for (let y = 0; y < H; y++) {
  first[0].data.copy(sheet.data, y * W * 4, y * W * 4, (y * W + W) * 4);
  first[FRAMES - 1].data.copy(sheet.data, (y + H + 4) * W * 4, y * W * 4, (y * W + W) * 4);
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, o = ((y + 2 * H + 8) * W + x) * 4;
    const d = Math.max(Math.abs(first[0].data[i] - first[FRAMES - 1].data[i]),
                       Math.abs(first[0].data[i + 1] - first[FRAMES - 1].data[i + 1]),
                       Math.abs(first[0].data[i + 2] - first[FRAMES - 1].data[i + 2]));
    sheet.data[o] = d > 12 ? 255 : 0; sheet.data[o + 1] = 0;
    sheet.data[o + 2] = 0; sheet.data[o + 3] = 255;
  }
}
writeFileSync(__j(ROOT, 'shots', 'flicker.png'), PNG.sync.write(sheet));
console.log('\n  wrote shots/flicker.png — first frame, last frame, and what moved in red\n');
await b.close();
