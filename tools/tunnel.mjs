// DOES THE TUNNEL ACTUALLY DO ANYTHING? — the instrument for src/world/tunnel.js
//
//   node tools/tunnel.mjs
//
// The claims this file exists to test, in the order it tests them:
//
//   0. the SITE was measured, not picked. Prints the survey off the running
//      build's own track.curve/track.hill, so a future change to buildTrack
//      shows up here as a different answer instead of as a stale comment.
//   1. ONE DRAW CALL, with the mesh hidden as the control, and a deliberately
//      duplicated mesh to prove the counter can go red.
//   2. IT GETS DARK — a number, not an opinion. Mean frame luminance
//      approaching, inside and emerging, with the same sweep run again with
//      the tunnel HIDDEN as the negative control: if the dip survives the
//      tunnel being switched off, the instrument is measuring the track.
//   3. THE MOUTH — how much of the frame is the bright far end, and that it
//      grows as you approach. Measured two independent ways (sky pixels
//      through the hole, and bright pixels in the middle of a dark frame) so
//      that one of them being wrong is visible rather than convincing.
//   4. NOTHING POPS — luminance every three units through the entrance, as a
//      printed curve, against the same sampling on open road.
//   5. THE CITY IS CUT OFF — how many pixels of scenery survive inside, with
//      the tunnel lengthened so its exit is 100% fog and the mouth cannot be
//      mistaken for a leak. This is the measurement that found buildings
//      standing INSIDE the first version of the tube.
//   6. A DRIVEN LAP. Everything above holds the car still and moves st.dist by
//      hand. This one starts the race, waits out the countdown and drives
//      through under power, because four harnesses on this project were
//      silently measuring a parked car.
//   7. pictures, at approach / mouth / inside / exit, to be looked at.
//
// WHY THE PIXELS ARE READ WITH gl.readPixels AND NOT FROM A SCREENSHOT: a
// screenshot is the composited page, so the HUD, the buttons and the tip line
// are in it, and they are bright. tools/armco.mjs settled this already; the
// analysis here happens inside the page on the raw drawing buffer, and the
// PNGs are written separately, for looking at, with the overlay hidden.

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

// Derived from this file's own location. Hardcoding /root/racer here would
// photograph main's build instead of this worktree's, which has happened.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FILE = 'file://' + join(ROOT, 'docs', 'index.html');
const SHOTS = join(ROOT, 'docs', 'shots');
mkdirSync(SHOTS, { recursive: true });

const fails = [];
const ok = (cond, label, detail = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${detail ? '   ' + detail : ''}`);
  if (!cond) fails.push(label);
};
const n2 = (v, w = 6, d = 1) => v.toFixed(d).padStart(w);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1008, height: 420 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(FILE, { waitUntil: 'load' });
await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });

const hasTunnel = await page.evaluate(() => !!(window.RACER && window.RACER.tunnel));
if (!hasTunnel) {
  console.log('\n  window.RACER.tunnel is not there.\n' +
    '  src/world/tunnel.js is written but main.js has not been wired to it yet —\n' +
    '  the four lines to paste are at the top of that file. Nothing below can run.\n');
  await browser.close();
  process.exit(2);
}

// The suite drives st directly and never touches a control, so the race state
// machine would pin the speed to zero and, worse, restart itself in the middle
// of a sweep. Hold it.
await page.evaluate(() => {
    // GET THE LANDING PAGE OUT OF THE WAY. It is a DOM layer over the canvas,
    // so a page screenshot photographs the menu rather than the game — which
    // is exactly how it blinded two of these tools the day it shipped. Tools
    // that read the WebGL buffer with gl.readPixels never saw the problem,
    // because the menu is not in that buffer.
    if (window.RACER.menu) window.RACER.menu.close();
  const R = window.RACER;
  R.renderer.setPixelRatio(0.6);
  const hold = () => {
    if (R.race.state !== 'racing') { R.race.state = 'racing'; R.race.t = 0; }
    requestAnimationFrame(hold);
  };
  requestAnimationFrame(hold);
});

const K = await page.evaluate(() => {
  const R = window.RACER;
  return { SEG_LEN: R.consts.SEG_LEN, at: R.tunnel.stats.atSeg, len: R.tunnel.stats.lenSeg,
           wallX: R.tunnel.stats.wallX, maxLen: R.tunnel.stats.maxLenSeg, n: R.track.n };
});
const AT = K.at, LEN = K.len, SL = K.SEG_LEN;
console.log(`\n  the tunnel under test: segments ${AT}..${AT + LEN}  ` +
  `(${AT * SL} to ${(AT + LEN) * SL} units, ${LEN * SL} long, walls at +/-${K.wallX})`);

// ===========================================================================
// 0. THE SITE, measured off the running build's own track
// ===========================================================================
console.log('\n  ---- 0. THE SITE, off the track the game actually generated ----\n');
const site = await page.evaluate(([at, len, SEG]) => {
  const t = window.RACER.track;
  const win = (s, l) => {
    let maxc = 0, sum = 0, head = 0, lo = 1e9, hi = -1e9, slope = 0;
    for (let i = s; i < s + l; i++) {
      const a = ((i % t.n) + t.n) % t.n, b = (((i + 1) % t.n) + t.n) % t.n;
      const c = Math.abs(t.curve[a]);
      if (c > maxc) maxc = c;
      sum += c; head += t.curve[a];
      if (t.hill[a] < lo) lo = t.hill[a];
      if (t.hill[a] > hi) hi = t.hill[a];
      const sl = Math.abs(t.hill[b] - t.hill[a]) / SEG;
      if (sl > slope) slope = sl;
    }
    return { maxc, meanc: sum / l, head: Math.abs(head), range: hi - lo, slope };
  };
  let worst = 0;
  for (let i = 0; i < t.n; i++) worst = Math.max(worst, Math.abs(t.curve[i]));
  // every legal window of this length, ranked. Legal = inside the race, clear
  // of the reserved bridge ground and of both gantry lines.
  const cands = [];
  for (let s = 250; s + len <= 2050; s++) {
    // Legal = inside the race, and 40 segments (240 units) clear of the ground
    // reserved for the broken bridge at 1150..1450.
    if (!(s + len <= 1110 || s >= 1490)) continue;
    const w = win(s, len), u = win(s - 45, 45);
    const cost = w.meanc * 400 + w.maxc * 200 + w.head * 60 + w.range * 0.25
               + w.slope * 40 + u.meanc * 300 + u.maxc * 100 + u.slope * 60;
    cands.push({ s, cost, w, u });
  }
  cands.sort((a, b) => a.cost - b.cost);
  const mine = cands.find((c) => c.s === at);
  // A RANK IS ONLY AS GOOD AS THE WEIGHTS IN THE COST, and those weights are
  // made up. So count how many windows BEAT this one on every axis at once —
  // no weights involved. That is the claim worth making.
  //
  // WITH TOLERANCES, because without them the answer is "eighteen windows beat
  // it" and all eighteen are its own neighbours, better in the fourth decimal
  // place of a curvature that is already 1.4% of the worst corner on the
  // track. A dominance test on raw floats measures noise. The bands below are
  // what a driver could possibly tell apart: 0.002 of curvature is a tenth of
  // the gentlest real bend, half a unit of elevation is half a kerb height.
  const DC = 0.002, DR = 0.5, DS = 0.005;
  let dominated = 0, ties = 0;
  if (mine) {
    for (const c of cands) {
      if (c === mine) continue;
      const noWorse = c.w.maxc <= mine.w.maxc + DC && c.w.range <= mine.w.range + DR
                   && c.w.slope <= mine.w.slope + DS && c.u.maxc <= mine.u.maxc + DC
                   && c.u.slope <= mine.u.slope + DS;
      if (!noWorse) continue;
      const better = c.w.maxc < mine.w.maxc - DC || c.w.range < mine.w.range - DR
                  || c.w.slope < mine.w.slope - DS || c.u.maxc < mine.u.maxc - DC
                  || c.u.slope < mine.u.slope - DS;
      if (better) dominated++; else ties++;
    }
  }
  // AND THE ONE NUMBER THAT SETTLES IT WITHOUT ANY WEIGHTS AT ALL: among the
  // legal windows that are FLAT (which is the hard requirement — a crest
  // inside the tube breaks the roof's job of cutting off the sky), what is the
  // straightest run-and-approach available, and how far off it is this one?
  let bestFlat = 1e9, bestFlatAt = -1;
  for (const c of cands) {
    if (c.w.range > 1.0 || c.w.slope > 0.02) continue;
    const comb = Math.max(c.w.maxc, c.u.maxc);
    if (comb < bestFlat) { bestFlat = comb; bestFlatAt = c.s; }
  }
  return { worst, best: cands.slice(0, 5), mine, rank: cands.indexOf(mine) + 1,
           total: cands.length, dominated, ties, bestFlat, bestFlatAt,
           flatCount: cands.filter((c) => c.w.range <= 1.0 && c.w.slope <= 0.02).length };
}, [AT, LEN, SL]);

console.log(`   the worst corner anywhere on the track is |curve| ${site.worst.toFixed(4)}\n`);
console.log('   rank  segments      max|curve|  mean|curve|   hill range  max slope   approach mean|curve|');
for (let i = 0; i < site.best.length; i++) {
  const c = site.best[i];
  console.log(`   ${String(i + 1).padStart(4)}  ${String(c.s).padStart(4)}..${String(c.s + LEN).padStart(4)}   ` +
    `${c.w.maxc.toFixed(5).padStart(9)}   ${c.w.meanc.toFixed(5).padStart(9)}   ` +
    `${c.w.range.toFixed(2).padStart(9)}   ${c.w.slope.toFixed(4).padStart(8)}   ${c.u.meanc.toFixed(5).padStart(12)}`);
}
if (site.mine) {
  const m = site.mine;
  console.log(`\n   the site in tunnel.js, ${AT}..${AT + LEN}:`);
  console.log(`     max|curve| ${m.w.maxc.toFixed(5)}  = ${(100 * m.w.maxc / site.worst).toFixed(1)}% of the track's worst corner`);
  console.log(`     hill range ${m.w.range.toFixed(2)} units, max gradient ${m.w.slope.toFixed(4)}`);
  console.log(`     the 45 segments of approach: max|curve| ${m.u.maxc.toFixed(5)}, max gradient ${m.u.slope.toFixed(4)}`);
  console.log(`     cost rank ${site.rank} of ${site.total} legal windows — but the weights in that`);
  console.log(`     cost are made up, so the number that matters is the next one:`);
  console.log(`     windows that beat it on curvature AND flatness AND approach, all at once,`);
  console.log(`     by margins a driver could tell apart: ${site.dominated}   (indistinguishable ties: ${site.ties})`);
  console.log(`     of the ${site.flatCount} legal windows that are FLAT, the straightest run-plus-approach`);
  console.log(`     available is |curve| ${site.bestFlat.toFixed(5)} at segment ${site.bestFlatAt}; this one is ` +
    `${Math.max(m.w.maxc, m.u.maxc).toFixed(5)}`);
  // Absolute thresholds, not a rank: a rank can be beaten by a window that is
  // better on a term nobody cares about.
  ok(m.w.maxc < site.worst * 0.05, 'the tunnel run is straight in absolute terms',
     `max|curve| ${m.w.maxc.toFixed(5)}, ${(100 * m.w.maxc / site.worst).toFixed(1)}% of the worst corner`);
  ok(m.w.range < 1.0, 'and flat', `hill range ${m.w.range.toFixed(2)} units over ${LEN * SL}`);
  ok(m.u.maxc < site.worst * 0.25 && m.u.slope < 0.02,
     'and the portal is approached down straight, level road',
     `approach max|curve| ${m.u.maxc.toFixed(5)}, max gradient ${m.u.slope.toFixed(4)}`);
  // 0.006 of curvature is 5% of the worst corner on the track and about a
  // tenth of the gentlest bend the generator makes. Anything inside that band
  // is the same piece of road as far as a driver is concerned.
  ok(Math.max(m.w.maxc, m.u.maxc) - site.bestFlat < 0.006,
     'no flat legal window is meaningfully straighter than this one',
     `this ${Math.max(m.w.maxc, m.u.maxc).toFixed(5)} vs the best available ${site.bestFlat.toFixed(5)}` +
     `  (${site.dominated} windows are marginally better, ${site.ties} tie)`);
} else {
  ok(false, 'the tunnel sits inside the legal window list', `segment ${AT} is not a legal start`);
}
ok(AT > 1500 || AT + LEN < 1150, 'clear of the reserved bridge ground (1150..1450)',
   `${AT}..${AT + LEN}`);

// ===========================================================================
// 1. THE DRAW CALL
// ===========================================================================
console.log('\n  ---- 1. ONE DRAW CALL, and a control that can go red ----\n');
const cost = await page.evaluate(async ([at, len, SEG]) => {
  const R = window.RACER, T = R.tunnel;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const sample = async (dist, hide, view) => {
    R.st.view = view; R.tune.freeze = true;
    R.st.dist = dist; R.st.x = 0; R.st.speed = 250; R.st.gear = 4;
    await frame();
    // hide = false means LEAVE IT ALONE and measure what the module decided.
    // Forcing it visible here is what the first version of this test did, and
    // it turned "costs nothing when it is 2,400 units away" into "costs one
    // call, always" — the harness paying the bill it was there to detect.
    if (hide) T.mesh.visible = false;
    let calls = 0, tris = 0;
    for (let i = 0; i < 3; i++) {
      await frame();
      calls = Math.max(calls, R.renderer.info.render.calls);
      tris = Math.max(tris, R.renderer.info.render.triangles);
    }
    return { calls, tris, q: T.stats.quads, drop: T.stats.dropped };
  };
  // scenery to the ceiling and the speed dial to the top: the worst frame,
  // not the cheapest, which is the mistake check.mjs's budget test was making.
  for (let i = 0; i < 24; i++) document.getElementById('bUp').click();
  R.tune.si = 5; R.tune.maxSpeed = 300;
  const out = { rows: [], scenery: R.scenery.count };
  for (const [name, off] of [['well before it', -400], ['on the approach', -30],
                             ['at the mouth', -2], ['deep inside', 40],
                             ['at the exit', len - 6]]) {
    const d = (at + off) * SEG;
    for (const view of [3, 1]) {
      const shown = await sample(d, false, view);
      const natural = T.mesh.visible;
      const hidden = await sample(d, true, view);
      // PUT IT BACK THE WAY THE MODULE LEFT IT. update() drives mesh.visible
      // on the EDGE of going in and out of range, so a harness that hides it
      // has hidden it until the car leaves the area — which is exactly the
      // behaviour asked for, and it means the next 'shown' sample measures
      // nothing unless the harness restores it. This test reported a delta of
      // zero and 'the tunnel costs no draw call' before this line existed.
      T.mesh.visible = natural;
      out.rows.push({ name, view, off, shown, hidden, natural });
    }
  }
  // CAN THE COUNTER GO RED? Add a second mesh with its own material — the
  // exact mistake this budget is guarding against — and check it is seen.
  R.st.dist = (at + 40) * SEG;
  await frame();
  const before = R.renderer.info.render.calls;
  const twin = new (Object.getPrototypeOf(T.mesh).constructor)(T.mesh.geometry, T.mesh.material.clone());
  twin.frustumCulled = false;
  R.scene.add(twin);
  await frame(); await frame();
  const after = R.renderer.info.render.calls;
  R.scene.remove(twin);
  twin.material.dispose();
  await frame();
  return { ...out, twinBefore: before, twinAfter: after, max: T.stats.maxQuads };
}, [AT, LEN, SL]);

console.log(`   scenery wound up to ${cost.scenery}, speed dial at the top\n`);
console.log('   where                view    calls  (hidden)   +calls     tris   (hidden)      +tris   quads');
for (const r of cost.rows) {
  console.log(`   ${r.name.padEnd(18)} ${r.view === 3 ? 'third' : 'first'}   ` +
    `${String(r.shown.calls).padStart(5)}  ${String(r.hidden.calls).padStart(8)}   ` +
    `${String(r.shown.calls - r.hidden.calls).padStart(6)}   ` +
    `${String(r.shown.tris).padStart(6)}  ${String(r.hidden.tris).padStart(9)}  ` +
    `${String(r.shown.tris - r.hidden.tris).padStart(9)}   ${String(r.shown.q).padStart(5)}`);
}
const near = cost.rows.filter((r) => r.off !== -400);
const away = cost.rows.filter((r) => r.off === -400);
ok(near.every((r) => r.shown.calls - r.hidden.calls === 1),
   'the tunnel costs exactly ONE draw call while it is on screen',
   near.map((r) => r.shown.calls - r.hidden.calls).join(','));
ok(away.every((r) => r.shown.calls - r.hidden.calls === 0 && !r.natural),
   'and ZERO when it is nowhere near — mesh.visible, not an empty draw range',
   `${away[0].shown.calls} calls either way, mesh.visible ${away[0].natural}`);
ok(Math.max(...cost.rows.map((r) => r.shown.calls)) <= 16,
   'the worst frame with the tunnel in it is inside the budget of 16',
   `worst ${Math.max(...cost.rows.map((r) => r.shown.calls))} of 16`);
ok(cost.rows.every((r) => r.shown.drop === 0), 'no quad was dropped for want of buffer',
   `pool ${cost.max}, worst used ${Math.max(...cost.rows.map((r) => r.shown.q))}`);
ok(cost.twinAfter - cost.twinBefore === 1,
   'CONTROL: the draw-call counter notices a second mesh being added',
   `${cost.twinBefore} -> ${cost.twinAfter}`);

// ===========================================================================
// the pixel rig — shared by everything below
// ===========================================================================
await page.evaluate(() => {
  const R = window.RACER;
  window.__RIG = (() => {
    const gl = R.renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const buf = new Uint8Array(W * H * 4);
    const ref = new Uint8Array(W * H * 4);
    const real = R.renderer.render.bind(R.renderer);
    // The game's own render is turned off for the duration and put back after:
    // every sample needs its own render of a frame the analysis chooses, and
    // under a software rasteriser the game's extra one is a third of the run.
    return {
      gl, W, H, buf, real,
      off() { R.renderer.render = () => {}; },
      on() { R.renderer.render = real; },
      shoot() { real(R.scene, R.camera); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf); },
      keep() { ref.set(buf); },
      /**
       * THE HOLE, measured as a DIFFERENCE and not as a threshold.
       *
       * "Count the near-black pixels in the middle of the frame" was the first
       * version of this and it was worthless: it came back at 2,400 pixels
       * whether the tunnel was there or not, because a comic-book city at
       * night is full of ink lines and dark facades. What identifies the mouth
       * is not that it is dark, it is that the tunnel MADE it dark — so shoot
       * the same frame twice, with and without the mesh, and count the pixels
       * the mesh took light away from.
       */
      darkened(thr) {
        let c = 0;
        for (let i = 0; i < buf.length; i += 4) {
          const a = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
          const b = 0.2126 * ref[i] + 0.7152 * ref[i + 1] + 0.0722 * ref[i + 2];
          if (b - a > thr) c++;
        }
        return c;
      },
      /** and everything the mesh touched at all, dark or light */
      covered(thr) {
        let c = 0;
        for (let i = 0; i < buf.length; i += 4) {
          if (Math.abs(buf[i] - ref[i]) + Math.abs(buf[i + 1] - ref[i + 1])
            + Math.abs(buf[i + 2] - ref[i + 2]) > thr) c++;
        }
        return c;
      },
      /** mean Rec.709 luminance of the whole frame */
      mean() {
        let s = 0;
        for (let i = 0; i < buf.length; i += 4) {
          s += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
        }
        return s / (W * H);
      },
      /** pixels of an exact colour — used for the sky marker */
      exact(r, g, b) {
        let c = 0;
        for (let i = 0; i < buf.length; i += 4) {
          if (buf[i] === r && buf[i + 1] === g && buf[i + 2] === b) c++;
        }
        return c;
      },
      /**
       * THE HOLE ITSELF, as a count of pixels the tunnel does NOT cover in a
       * box on the vanishing point ABOVE the road. Needs keep() to have
       * stashed the same frame with the mesh hidden.
       *
       * Above the road, because below it the road surface is not the tunnel
       * either and would be counted as hole. Deliberately a SMALL box, because
       * the wide one picks up the top corners of the tube where 87% haze makes
       * the wall and the fog behind it the same colour to within the
       * threshold — which is honest (you cannot see the tunnel there either)
       * but is not the mouth.
       *
       * This replaced a "bright and cool pixels" count, which went 2933, 3386,
       * 3031, 6511, 3593, 7835, 23136 along the tunnel — the 6511 was the
       * zebra crossing at segment 1568 sneaking over the blue threshold. A
       * metric that a road marking can move is a metric measuring road
       * markings.
       */
      holePx() {
        const x0 = (W * 0.38) | 0, x1 = (W * 0.62) | 0;
        const y0 = (H * 0.58) | 0, y1 = (H * 0.82) | 0;
        let c = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * W + x) * 4;
            // THRESHOLD 2, NOT 9. At nine, a stretch of tunnel wall 450 units
            // away under 87% haze counts as "not covered" because it is within
            // nine of the fog behind it, and the count came back at 412, 392,
            // 209 — falling while the hole was growing. Two is above
            // SwiftShader's (zero) sampling noise and below the faintest real
            // difference the tunnel makes.
            if (Math.abs(buf[i] - ref[i]) + Math.abs(buf[i + 1] - ref[i + 1])
              + Math.abs(buf[i + 2] - ref[i + 2]) <= 2) c++;
          }
        }
        return c;
      },
      /**
       * THE HOLE AGAINST WHAT SURROUNDS IT — the contrast that decides how
       * long the tunnel may be. Mean luminance of a small box on the
       * vanishing point, minus the mean of the ring around it. A bright hole
       * in a dark wall is a big positive number; a grey hole in a grey wall,
       * which is what fog turns a long tunnel into, is near zero.
       */
      holeContrast() {
        const bx0 = (W * 0.455) | 0, bx1 = (W * 0.545) | 0;
        const by0 = (H * 0.38) | 0, by1 = (H * 0.60) | 0;
        const rx0 = (W * 0.30) | 0, rx1 = (W * 0.70) | 0;
        const ry0 = (H * 0.22) | 0, ry1 = (H * 0.72) | 0;
        let bs = 0, bn = 0, rs = 0, rn = 0;
        for (let y = ry0; y < ry1; y++) {
          for (let x = rx0; x < rx1; x++) {
            const i = (y * W + x) * 4;
            const l = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
            if (x >= bx0 && x < bx1 && y >= by0 && y < by1) { bs += l; bn++; }
            else { rs += l; rn++; }
          }
        }
        return bs / bn - rs / rn;
      },
      /** The PORTAL from outside: near-black pixels in the middle of the
       *  frame. Nothing else in this city is that dark in the centre of the
       *  road — the control below is the same count with the tunnel hidden,
       *  and it comes back at almost nothing. */
      centreDark(thr) {
        const x0 = (W * 0.30) | 0, x1 = (W * 0.70) | 0;
        const y0 = (H * 0.20) | 0, y1 = (H * 0.75) | 0;
        let c = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * W + x) * 4;
            const l = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
            if (l < thr) c++;
          }
        }
        return c;
      },
      /**
       * THE MOUTH, counted by colour rather than by geometry.
       *
       * The far end of the tunnel is the only thing in the middle of the frame
       * that is both BRIGHT and COOL: the fog takes everything beyond the exit
       * toward PAL.haze (#3a5680), which has 42 more blue than red. The only
       * other bright things inside the tube are the light fittings, and they
       * are sodium — 121 more RED than blue. So "bright and blue" separates
       * them cleanly, where a luminance threshold alone counts the lamps and
       * calls them the mouth.
       *
       * A judgement, not a measurement of geometry — which is why the sky
       * count below is measured a second, independent way.
       */
      coolBright(lum, cool) {
        const x0 = (W * 0.28) | 0, x1 = (W * 0.72) | 0;
        const y0 = (H * 0.20) | 0, y1 = (H * 0.85) | 0;
        let c = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * W + x) * 4;
            const l = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
            if (l > lum && buf[i + 2] - buf[i] > cool) c++;
          }
        }
        return c;
      },
    };
  })();
  window.__park = (dist, view, speed) => {
    R.tune.freeze = true; R.st.dist = dist; R.st.x = 0;
    R.st.view = view === undefined ? 3 : view;
    R.st.speed = speed === undefined ? 205 : speed; R.st.gear = 4;
  };
});

// ===========================================================================
// 2. IT GETS DARK
// ===========================================================================
console.log('\n  ---- 2. THE CONTRAST, measured. "it gets dark" is a number ----\n');
const dark = await page.evaluate(async ([at, len, SEG]) => {
  const R = window.RACER, T = R.tunnel, G = window.__RIG;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  G.off();
  const run = async (hide, atSeg) => {
    T.stats.atSeg = atSeg;
    const rows = [];
    for (const off of [-70, -40, -20, -6, 4, 16, 30, 45, 60, 74, 84, 96, 120]) {
      window.__park((atSeg + off) * SEG, 3);
      await frame(); await frame();
      T.mesh.visible = !hide;
      G.shoot();
      rows.push({ off, mean: G.mean() });
      T.mesh.visible = true;
    }
    return rows;
  };
  const real = await run(false, at);
  const control = await run(true, at);              // negative control
  // positive control: the same sweep on open road, tunnel moved out of the way
  const elsewhere = await run(true, 700);
  T.stats.atSeg = at;
  G.on();
  return { real, control, elsewhere };
}, [AT, LEN, SL]);

console.log('   segments from the entrance      frame luminance');
console.log('                                tunnel   HIDDEN   open road (control)');
for (let i = 0; i < dark.real.length; i++) {
  const o = dark.real[i].off;
  const where = o < 0 ? `${-o} before` : o < LEN ? `${o} inside` : `${o - LEN} past the exit`;
  console.log(`   ${String(o).padStart(5)}  ${where.padEnd(18)} ${n2(dark.real[i].mean)}   ` +
    `${n2(dark.control[i].mean)}   ${n2(dark.elsewhere[i].mean)}`);
}
const outside = dark.real.filter((r) => r.off < -10).map((r) => r.mean);
const insideM = dark.real.filter((r) => r.off > 8 && r.off < LEN - 10).map((r) => r.mean);
const afterM = dark.real.filter((r) => r.off > LEN + 4).map((r) => r.mean);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const cOut = mean(dark.control.filter((r) => r.off < -10).map((r) => r.mean));
const cIn = mean(dark.control.filter((r) => r.off > 8 && r.off < LEN - 10).map((r) => r.mean));
console.log(`\n   approaching ${mean(outside).toFixed(1)}   inside ${mean(insideM).toFixed(1)}   ` +
  `emerged ${mean(afterM).toFixed(1)}      that is a drop of ` +
  `${(100 * (1 - mean(insideM) / mean(outside))).toFixed(0)}% and a recovery to ` +
  `${(100 * mean(afterM) / mean(outside)).toFixed(0)}% of the approach`);
ok(mean(insideM) < mean(outside) * 0.8, 'it gets measurably darker inside',
   `${mean(outside).toFixed(1)} -> ${mean(insideM).toFixed(1)}`);
ok(mean(afterM) > mean(insideM) * 1.25, 'and measurably brighter coming out again',
   `${mean(insideM).toFixed(1)} -> ${mean(afterM).toFixed(1)}`);
ok(Math.abs(cIn - cOut) < cOut * 0.12,
   'CONTROL: with the mesh hidden the same sweep does NOT go dark',
   `${cOut.toFixed(1)} -> ${cIn.toFixed(1)} (${(100 * (cIn / cOut - 1)).toFixed(0)}%)`);

// ===========================================================================
// 3. THE MOUTH
// ===========================================================================
console.log('\n  ---- 3. THE BRIGHT FAR END, and whether it grows ----\n');
const mouth = await page.evaluate(async ([at, len, SEG]) => {
  const R = window.RACER, T = R.tunnel, G = window.__RIG;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  G.off();
  // A MARKER SKY. Fog never touches scene.background, so a pixel of the marker
  // colour is a pixel where the sky is directly visible and nothing else —
  // which inside a tunnel means "through the hole at the far end". Exact,
  // where a brightness threshold is a judgement.
  const sky = R.scene.background;
  const Col = Object.getPrototypeOf(R.scene.fog.color).constructor;
  R.scene.background = new Col(1, 0, 1);
  const rows = [];
  for (const off of [-40, -10, 4, 16, 30, 45, 58, 68, 74, 78]) {
    window.__park((at + off) * SEG, 3);
    await frame(); await frame();
    T.mesh.visible = false;
    G.shoot(); G.keep();
    const skyNo = G.exact(255, 0, 255);
    const brightNo = G.coolBright(58, 12);
    T.mesh.visible = true;
    G.shoot();
    const skyPx = G.exact(255, 0, 255);
    const bright = G.coolBright(58, 12);
    const hole = G.holePx();
    rows.push({ off, skyPx, skyNo, bright, brightNo, hole,
                toExit: (len - off) * SEG });
  }
  // AND THE HOLE FROM OUTSIDE, on the way in: the portal is the only piece of
  // near-black in the middle of a city at luminance 55.
  R.scene.background = sky;
  const app = [];
  for (const off of [-110, -80, -55, -35, -20, -12, -6, -2]) {
    window.__park((at + off) * SEG, 3);
    await frame(); await frame();
    T.mesh.visible = false;
    G.shoot(); G.keep();               // the same frame with no tunnel in it
    T.mesh.visible = true;
    G.shoot();
    // TWO THRESHOLDS. `cover` at 9 is the portal's silhouette — every pixel it
    // touches at all — and it answers "how big is it on screen". `strong` at
    // 60 (about 20 luminance) is the part of that silhouette a player could
    // actually pick out of a hazy city, and it is the only one of the two that
    // moves when the portal is repainted. Reporting only the first is how you
    // repaint a facade three times and measure no difference.
    app.push({ off, dist: -off * SEG, dark: G.darkened(14),
               cover: G.covered(9), strong: G.covered(60) });
  }
  // CONTROL: 400 segments away there is no tunnel to find, and the same
  // difference must come back at nothing. If it does not, the two renders
  // differ for some reason of their own and every number above is noise.
  window.__park((at - 400) * SEG, 3);
  await frame(); await frame();
  T.mesh.visible = false;
  G.shoot(); G.keep();
  G.shoot();
  const nullDark = G.darkened(14), nullCover = G.covered(9);
  G.on();
  return { rows, app, nullDark, nullCover, W: G.W, H: G.H };
}, [AT, LEN, SL]);

console.log(`   frame is ${mouth.W}x${mouth.H} = ${mouth.W * mouth.H} pixels\n`);
console.log('   position         exit is     the hole    bright+cool px       raw sky (marker bg)');
console.log('                    away        px          tunnel  HIDDEN(ctrl)  tunnel  HIDDEN(ctrl)');
for (const r of mouth.rows) {
  const where = r.off < 0 ? `${-r.off} before` : `${r.off} inside`;
  console.log(`   ${where.padEnd(15)} ${String(r.toExit).padStart(5)}u    ` +
    `${String(r.hole).padStart(7)}   ${String(r.bright).padStart(7)}  ${String(r.brightNo).padStart(11)}  ` +
    `${String(r.skyPx).padStart(7)}  ${String(r.skyNo).padStart(11)}`);
}
const ins = mouth.rows.filter((r) => r.off >= 4);
const first3 = ins.slice(0, 3).reduce((a, r) => a + r.hole, 0) / 3;
const last3 = ins.slice(-3).reduce((a, r) => a + r.hole, 0) / 3;
let back = 0, worstBack = 0;
for (let i = 1; i < ins.length; i++) {
  if (ins[i].hole < ins[i - 1].hole) { back++; worstBack = Math.max(worstBack, 1 - ins[i].hole / ins[i - 1].hole); }
}
console.log(`\n   the hole goes from ${first3.toFixed(0)} px averaged over the first three samples to ` +
  `${last3.toFixed(0)} over the last three`);
ok(last3 > first3 * 5, 'the bright far end grows as you approach it',
   `${first3.toFixed(0)} px -> ${last3.toFixed(0)} px, ${(last3 / first3).toFixed(1)}x`);
// One backward step is allowed and only while the hole is still under 150
// pixels — at that size it is a dozen pixels of jitter on a shape three pixels
// tall, and demanding monotonicity there would be demanding precision the
// measurement does not have.
const bigBack = ins.some((r, i) => i > 0 && r.hole < ins[i - 1].hole && ins[i - 1].hole > 150);
ok(back <= 1 && !bigBack, 'and it grows without going backwards',
   `${back} backward step(s), worst ${(100 * worstBack).toFixed(0)}%, none above 150 px`);

// THE SKY, WHICH IS THE OTHER HALF OF THE CLAIM. Fog never touches
// scene.background, so a marker-coloured pixel is sky seen directly. Outside
// there are thousands; inside there should be none, because the roof is over
// you — and that is "the sky is cut off" measured rather than asserted.
const skyIn = mouth.rows.filter((r) => r.off >= 4 && r.off < LEN - 8);
const skyOut = mouth.rows.filter((r) => r.off < 0);
console.log(`\n   sky visible outside ${skyOut.map((r) => r.skyPx).join(', ')} px;  ` +
  `inside ${skyIn.map((r) => r.skyPx).join(', ')} px`);
ok(skyIn.every((r) => r.skyPx < 40), 'the sky is cut off completely inside the tunnel',
   `worst ${Math.max(...skyIn.map((r) => r.skyPx))} px of ${mouth.W * mouth.H}`);
ok(skyIn.every((r) => r.skyNo > 4000),
   'CONTROL: hide the tunnel at those same places and the sky comes straight back',
   skyIn.map((r) => r.skyNo).join(', '));

console.log('\n   and the mouth on the way IN, measured as what the tunnel takes away:\n');
console.log('   distance to the portal    px DARKENED    px touched at all    px changed strongly');
for (const r of mouth.app) {
  console.log(`   ${String(r.dist).padStart(19)}u    ${String(r.dark).padStart(11)}    ` +
    `${String(r.cover).padStart(17)}    ${String(r.strong).padStart(19)}`);
}
console.log(`   CONTROL, 2400u away, the same two renders:  ${mouth.nullDark} darkened, ${mouth.nullCover} covered`);
let up = 0;
for (let i = 1; i < mouth.app.length; i++) if (mouth.app[i].dark >= mouth.app[i - 1].dark) up++;
ok(up >= mouth.app.length - 2, 'the mouth grows steadily on the approach',
   `${up} of ${mouth.app.length - 1} steps went up: ${mouth.app.map((r) => r.dark).join(' -> ')}`);
ok(mouth.nullDark === 0 && mouth.nullCover === 0,
   'CONTROL: with no tunnel in range the same difference finds nothing at all',
   `${mouth.nullDark} / ${mouth.nullCover}`);

// ---- 3b. WHY EIGHTY SEGMENTS ---------------------------------------------
console.log('\n  ---- 3b. HOW LONG SHOULD IT BE — the fog decides, so measure it ----\n');
const sweep = await page.evaluate(async ([at, len, SEG, maxLen]) => {
  const R = window.RACER, T = R.tunnel, G = window.__RIG;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  G.off();
  const rows = [];
  for (const L of [30, 50, 80, 110, 140]) {
    if (L > maxLen) continue;
    T.stats.lenSeg = L;
    // stand four segments in, looking down the whole length of it
    window.__park((at + 4) * SEG, 3);
    await frame(); await frame();
    G.shoot();
    const entry = { contrast: G.holeContrast(), bright: G.coolBright(58, 12) };
    // and at the midpoint, for how dark it gets in the middle
    window.__park((at + (L >> 1)) * SEG, 3);
    await frame(); await frame();
    G.shoot();
    const mid = G.mean();
    rows.push({ L, ...entry, mid, secs: L * SEG / 205 });
  }
  T.stats.lenSeg = len;
  G.on();
  return rows;
}, [AT, LEN, SL, K.maxLen]);
console.log('   length           seconds   hole contrast seen   bright px   luminance');
console.log('   segments units    at 205    from 4 segs inside   there       at the midpoint');
for (const r of sweep) {
  console.log(`   ${String(r.L).padStart(8)} ${String(r.L * SL).padStart(5)}    ${r.secs.toFixed(2).padStart(6)}   ` +
    `${r.contrast.toFixed(1).padStart(18)}   ${String(r.bright).padStart(9)}   ${n2(r.mid).padStart(13)}`);
}
const chosen = sweep.find((r) => r.L === LEN);
const longest = sweep[sweep.length - 1], shortest = sweep[0];
if (chosen) {
  // WHAT THIS TABLE ACTUALLY SAYS, and it is not what the first draft of
  // tunnel.js's header claimed. The header said 80 segments was "the longest
  // tube whose far end is still a bright hole from the entrance". It is not:
  // by 80 segments the exit is already gone from the entrance view, and the
  // contrast column stops moving entirely between 80 and 140 because there is
  // nothing left of the exit to see. The claim was wrong and the measurement
  // is what caught it.
  //
  // What is true is the third column: the middle of the tunnel is the same
  // darkness whatever its length. So making it longer does not make it darker
  // and does not make the mouth better — it buys TIME IN THE DARK, and that
  // is the only thing the length dial is for. The mouth is a local, fog-bound
  // event that happens over the last 200 units at any length, which is what
  // section 3's growth series shows directly.
  const midSpread = Math.max(...sweep.map((r) => r.mid)) - Math.min(...sweep.map((r) => r.mid));
  console.log(`\n   the midpoint is the same darkness at every length: ${midSpread.toFixed(1)} luminance of spread`);
  console.log(`   across ${shortest.L * SL} to ${longest.L * SL} units. Length buys seconds in the dark, nothing else.`);
  console.log(`   NOTE the site's own limit: the flat straight runs 1484..1620, so lengths past about`);
  console.log(`   100 segments bend the tube into the corner at 1630 and are not usable here.`);
  ok(midSpread < 5, 'a longer tunnel is not a darker tunnel — length only buys time',
     `${midSpread.toFixed(1)} luminance of spread across ${shortest.L}..${longest.L} segments`);
  ok(shortest.contrast > longest.contrast * 1.25,
     'CONTROL: the contrast probe does respond to length — a short tunnel really does show its exit from the door',
     `${shortest.contrast.toFixed(1)} at ${shortest.L} vs ${longest.contrast.toFixed(1)} at ${longest.L}`);
  ok(chosen.secs > 1.5, 'and the chosen length lasts long enough to be an event',
     `${chosen.secs.toFixed(2)} seconds at racing speed`);
}

// ===========================================================================
// 4. NOTHING POPS
// ===========================================================================
console.log('\n  ---- 4. THE TRANSITION, every three units through the mouth ----\n');
const trans = await page.evaluate(async ([at, SEG]) => {
  const R = window.RACER, T = R.tunnel, G = window.__RIG;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  G.off();
  const sweep = async (centreDist) => {
    const rows = [];
    for (let d = -60; d <= 72; d += 4) {
      window.__park(centreDist + d, 3);
      await frame(); await frame();
      G.shoot();
      rows.push({ d, mean: G.mean() });
    }
    return rows;
  };
  const through = await sweep(at * SEG);
  T.mesh.visible = false;
  const flat = await sweep(at * SEG);            // same ground, no tunnel
  T.mesh.visible = true;
  G.on();
  return { through, flat };
}, [AT, SL]);

const step = (rows) => {
  let worst = 0, at2 = 0; const all = [];
  for (let i = 1; i < rows.length; i++) {
    const dv = Math.abs(rows[i].mean - rows[i - 1].mean);
    all.push(dv);
    if (dv > worst) { worst = dv; at2 = rows[i].d; }
  }
  all.sort((a, b) => a - b);
  return { worst, at: at2, median: all[all.length >> 1] };
};
const sT = step(trans.through), sF = step(trans.flat);
console.log('   units from the portal   luminance   bar');
for (const r of trans.through) {
  const bar = '#'.repeat(Math.max(0, Math.round(r.mean * 0.9)));
  console.log(`   ${String(r.d).padStart(8)}           ${n2(r.mean)}   ${bar}`);
}
console.log(`\n   biggest single 4-unit step through the portal   ${sT.worst.toFixed(2)} at ${sT.at}u`);
console.log(`   median step through the portal                  ${sT.median.toFixed(2)}`);
console.log(`   biggest step over the same ground, no tunnel    ${sF.worst.toFixed(2)} (control)`);
// FOUR UNITS is one frame at 60Hz and 240 units/sec, so this is very close to
// the biggest luminance change a player can be shown between two frames. 12
// out of 255 is under 5%: the light comes down as a ramp, not as a switch.
// The threshold is absolute rather than relative to the control, because the
// control has its own jitter from lampposts and buildings sweeping past.
ok(sT.worst < 12.0, 'no step change at the entrance — the light comes down as a ramp',
   `worst 4-unit step ${sT.worst.toFixed(2)} of 255 at ${sT.at}u`);
ok(sT.worst > sF.worst, 'CONTROL: the sweep can see a change at all — it sees more with the tunnel than without',
   `${sT.worst.toFixed(2)} with, ${sF.worst.toFixed(2)} without`);

// ===========================================================================
// 5. THE CITY IS CUT OFF
// ===========================================================================
console.log('\n  ---- 5. IS THE CITY ACTUALLY CUT OFF ----\n');
const cut = await page.evaluate(async ([at, len, SEG, maxLen]) => {
  const R = window.RACER, T = R.tunnel, G = window.__RIG;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  G.off();
  const W = G.W, H = G.H;
  const A = new Uint8Array(W * H * 4);
  const rows = [];
  // LENGTHEN THE TUNNEL FIRST. With the exit 100% fogged, anything of the city
  // that disappears when the scenery is hidden came through a WALL and not
  // through the mouth — which is the distinction the first version of this
  // measurement could not make, and it hid buildings standing inside the tube.
  T.stats.lenSeg = maxLen;
  for (const view of [3, 1]) {
    for (const off of [4, 16, 30, 45, 60]) {
      window.__park((at + off) * SEG, view);
      await frame(); await frame();
      G.shoot();
      A.set(G.buf);
      R.scenery.mesh.visible = false; R.scenery.hull.visible = false;
      G.shoot();
      R.scenery.mesh.visible = true; R.scenery.hull.visible = true;
      let leak = 0, worst = 0;
      for (let i = 0; i < A.length; i += 4) {
        const d = Math.abs(A[i] - G.buf[i]) + Math.abs(A[i + 1] - G.buf[i + 1])
                + Math.abs(A[i + 2] - G.buf[i + 2]);
        if (d > 9) leak++;
        if (d > worst) worst = d;
      }
      rows.push({ view, off, leak, worst, pct: 100 * leak / (W * H) });
    }
  }
  // CONTROL: the same measurement OUTSIDE the tunnel, where the city is
  // supposed to be visible. If that does not come back large, the diff is
  // broken and every zero above is a zero for the wrong reason.
  window.__park((at - 60) * SEG, 3);
  await frame(); await frame();
  G.shoot(); A.set(G.buf);
  R.scenery.mesh.visible = false; R.scenery.hull.visible = false;
  G.shoot();
  R.scenery.mesh.visible = true; R.scenery.hull.visible = true;
  let openLeak = 0;
  for (let i = 0; i < A.length; i += 4) {
    const d = Math.abs(A[i] - G.buf[i]) + Math.abs(A[i + 1] - G.buf[i + 1])
            + Math.abs(A[i + 2] - G.buf[i + 2]);
    if (d > 9) openLeak++;
  }
  T.stats.lenSeg = len;
  G.on();
  return { rows, openLeak, total: W * H };
}, [AT, LEN, SL, K.maxLen]);

console.log('   view    segments in    city pixels getting past the walls');
for (const r of cut.rows) {
  console.log(`   ${r.view === 3 ? 'third' : 'first'}   ${String(r.off).padStart(11)}    ` +
    `${String(r.leak).padStart(7)} px  ${r.pct.toFixed(2).padStart(6)}%   worst pixel delta ${r.worst}`);
}
console.log(`\n   CONTROL, 60 segments before the portal, out in the open: ` +
  `${cut.openLeak} px  ${(100 * cut.openLeak / cut.total).toFixed(1)}%`);
ok(Math.max(...cut.rows.map((r) => r.pct)) < 0.5,
   'the city is cut off inside — under half a percent of the frame gets through',
   `worst ${Math.max(...cut.rows.map((r) => r.pct)).toFixed(2)}%`);
ok(cut.openLeak > cut.total * 0.1,
   'CONTROL: the same diff finds plenty of city out in the open',
   `${(100 * cut.openLeak / cut.total).toFixed(1)}%`);

// ===========================================================================
// 6. DRIVEN, NOT PARKED
// ===========================================================================
console.log('\n  ---- 6. DRIVEN THROUGH UNDER POWER, from a standing start ----\n');
const driven = await page.evaluate(async ([at, len, SEG]) => {
  const R = window.RACER, T = R.tunnel, G = window.__RIG;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  R.tune.freeze = false;
  R.startRace();
  // WAIT ON simT, NEVER ON THE WALL CLOCK: under SwiftShader the sim runs at a
  // fraction of real time, and a wall-clock wait measures the rasteriser.
  await new Promise((done, fail) => {
    const t = R.st.simT + R.consts.COUNTDOWN + 0.6, give = performance.now() + 90000;
    const s = () => {
      if (R.st.simT >= t) return done();
      if (performance.now() > give) return fail(new Error('the countdown never finished'));
      requestAnimationFrame(s);
    };
    requestAnimationFrame(s);
  });
  if (R.race.state !== 'racing') throw new Error(`race is '${R.race.state}'`);
  const startDist = R.st.dist;
  // Put it on the run-in under power rather than teleporting it into the
  // tunnel: st.dist is assigned once, then the game drives.
  R.st.dist = (at - 55) * SEG;
  // BACK TO A REPRESENTATIVE SPEED. Section 1 wound the dial to 300 to find
  // the worst frame; driving the tunnel at 289 mph is not what a player does.
  R.tune.si = 3; R.tune.maxSpeed = 210;
  R.st.speed = R.tune.maxSpeed; R.st.gear = 4;
  R.pedal.brake = false; R.pedal.boost = false;
  R.tune.holdX = 0;
  const rows = [];
  let moved = 0, last = R.st.dist, guard = 0;
  G.off();
  while (R.st.dist < (at + len + 40) * SEG && guard++ < 4000) {
    await frame();
    if (R.st.dist - last >= 12) {
      last = R.st.dist;
      G.shoot();
      rows.push({ seg: R.st.dist / SEG - at, mean: G.mean(),
                  inside: T.inside(R.st.dist), enc: T.enclosure(R.st.dist) });
    }
    moved = R.st.dist - (at - 55) * SEG;
  }
  G.on();
  R.tune.holdX = null;
  return { rows, moved, startDist, speed: R.st.speed, mph: R.st.speed * R.consts.MPH };
}, [AT, LEN, SL]);

console.log(`   the car moved ${driven.moved.toFixed(0)} units under power at ${driven.mph.toFixed(0)} mph\n`);
console.log('   segments from entrance   luminance   inside()   enclosure()');
for (const r of driven.rows) {
  console.log(`   ${r.seg.toFixed(1).padStart(22)}   ${n2(r.mean)}   ${(r.inside ? 'true ' : 'false').padStart(8)}   ${r.enc.toFixed(2).padStart(11)}`);
}
ok(driven.moved > 500, 'CONTROL: the car actually moved — this is not a parked measurement',
   `${driven.moved.toFixed(0)} units`);
const insideRows = driven.rows.filter((r) => r.inside);
const outRows = driven.rows.filter((r) => !r.inside && r.seg < 0);
ok(insideRows.length > 5, 'and it spent real time inside', `${insideRows.length} samples`);
if (insideRows.length && outRows.length) {
  const mi = insideRows.reduce((a, r) => a + r.mean, 0) / insideRows.length;
  const mo = outRows.reduce((a, r) => a + r.mean, 0) / outRows.length;
  console.log(`\n   driven: ${mo.toFixed(1)} outside -> ${mi.toFixed(1)} inside (${(100 * (1 - mi / mo)).toFixed(0)}% down)`);
  ok(mi < mo * 0.85, 'the darkening is there when the car drives it, not only when parked',
     `${mo.toFixed(1)} -> ${mi.toFixed(1)}`);
}
const bad = driven.rows.filter((r) => r.inside !== (r.seg >= 0 && r.seg < LEN));
ok(bad.length === 0, 'inside() agrees with where the car actually is',
   bad.length ? `${bad.length} disagreements, first at segment ${bad[0].seg.toFixed(1)}` : '');

// ===========================================================================
// 7. PICTURES
// ===========================================================================
console.log('\n  ---- 7. pictures ----\n');
await page.evaluate(() => {
  document.getElementById('hud').style.display = 'none';
  document.getElementById('note').style.display = 'none';
  document.getElementById('ctl').style.display = 'none';
  window.RACER.renderer.setPixelRatio(1);
});
const pics = [
  ['approach', -55, 3], ['mouth', -9, 3], ['inside', 34, 3],
  ['crossing', 48, 3], ['exit', 74, 3], ['inside-first-person', 34, 1],
  ['emerged', 96, 3],
];
for (const [name, off, view] of pics) {
  await page.evaluate(([d, v]) => { window.__park(d, v); }, [(AT + off) * SL, view]);
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(SHOTS, `tunnel-${name}.png`) });
  console.log(`   docs/shots/tunnel-${name}.png`);
}

ok(errors.length === 0, 'no console errors or page errors', errors.join(' | '));
await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.join(', ')}\n` : '\nall tunnel checks passed\n');
process.exit(fails.length ? 1 : 0);
