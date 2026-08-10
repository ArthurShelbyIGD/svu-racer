// DOES THE BUILDING ROOF FACE EVER REACH A PIXEL?
//
// Scenery._shell builds the visible shell as three faces in this order —
// pz (the wall facing the camera), nx (the flank on the street), py (the roof)
// — and the index buffer is therefore 18 entries, of which the LAST SIX are the
// roof. So the roof can be switched off from outside with setDrawRange(0, 12),
// which touches nothing the frame loop rewrites. No rebuild, no second build to
// compare against, and the two captures are the same binary.
//
// THREE CAPTURES, NOT TWO, AND THAT IS THE WHOLE INSTRUMENT.
//
// The obvious harness renders the frame once with the roof and once without and
// calls the difference "roof". It is wrong, because the frame is not still even
// when the car is frozen: tune.freeze holds distance but the wake, the pedals,
// the tilt and the neon all keep moving, and every pixel they touch shows up in
// a two-capture diff as roof. So this takes THREE captures with the roof ON,
// builds a mask of every pixel that moved on its own across those three, and
// only then takes the fourth with the roof off. A pixel counts as roof only if
// it changed when the roof went away AND did not change when nothing did.
//
// The mask is a real effect and not a theoretical worry. Measured on this
// build: settle a pose for three frames and 226,000 pixels — over half the
// frame — are still moving of their own accord, because a jump to a new
// segment takes several frames to work through the camera. Settle it for
// SETTLE frames and the number is zero. The mask is what proved the settle was
// too short; a two-capture harness would have reported those 226,000 pixels as
// roof and been believed.
//
//   node tools/roofprobe.mjs

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';

const __ROOT = __d(__d(__f(import.meta.url)));
const PAGE = 'file://' + __j(__ROOT, 'docs', 'index.html');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1008, height: 420 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForTimeout(2200);
if (errs.length) { console.log('PAGE ERRORS:', errs.slice(0, 3).join(' | ')); }
await page.evaluate(() => {
  for (const id of ['hud', 'note', 'ctl']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
});

const out = await page.evaluate(async () => {
  const R = window.RACER;
  const gl = R.renderer.getContext();
  const w = R.renderer.domElement.width, h = R.renderer.domElement.height;
  const A = new Uint8Array(w * h * 4);
  const A2 = new Uint8Array(w * h * 4);
  const A3 = new Uint8Array(w * h * 4);
  const B = new Uint8Array(w * h * 4);
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const geo = R.scenery.mesh.geometry;
  const IDX = geo.index.count;              // 6 indices per face
  const FACES = IDX / 6;
  // THE ROOF HAS SINCE BEEN DELETED, so on the current build this tool has
  // nothing to switch off and says so rather than quietly hiding the flank —
  // which is what a hard-coded `IDX - 6` would have done, and it would have
  // reported an enormous roof.
  if (FACES !== 3) return { faces: FACES, gone: true };
  const ROOF_START = IDX - 6;               // py is built last

  R.scenery.count = 7040;
  const SEG = R.consts.SEG_LEN, n = R.track.n;

  // POSES CHOSEN FOR ELEVATION, not for looking nice. The track runs -55 to
  // +55, so the camera does rise above the shorter scenery; a sweep that only
  // sampled the flat straight would be measuring the easy case.
  const segs = [];
  for (let i = 0; i < 34; i++) segs.push(Math.floor(n * i / 34));

  const rows = [];
  let worst = 0, worstAt = '', anyPose = 0, total = 0;
  let noiseWorst = 0;

  for (const view of [3, 1]) {
    for (const seg of segs) {
      const pose = () => {
        R.st.view = view; R.st.dist = seg * SEG; R.st.x = 0;
        R.tune.maxSpeed = 210; R.st.speed = 170; R.tune.freeze = true;
        R.tilt.on = true; R.tilt.out = 0; R.st.steer = 0;
      };
      // Settle ONCE per pose. Moving to a new segment is what takes frames to
      // work through; flipping the draw range changes nothing that is smoothed,
      // so two frames after it is already stable — and the A/A2/A3 mask below
      // is what proves that claim rather than assuming it.
      const SETTLE = 16;
      geo.setDrawRange(0, IDX);
      for (let s = 0; s < SETTLE; s++) { pose(); await frame(); }
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, A);
      pose(); await frame();
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, A2);
      pose(); await frame();
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, A3);

      geo.setDrawRange(0, ROOF_START);
      pose(); await frame(); pose(); await frame();
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, B);
      geo.setDrawRange(0, IDX);

      let hits = 0, noise = 0, sumLum = 0, maxLum = 0;
      for (let i = 0; i < A.length; i += 4) {
        const self = Math.abs(A[i] - A2[i]) + Math.abs(A[i + 1] - A2[i + 1]) + Math.abs(A[i + 2] - A2[i + 2])
                   + Math.abs(A[i] - A3[i]) + Math.abs(A[i + 1] - A3[i + 1]) + Math.abs(A[i + 2] - A3[i + 2]);
        if (self > 0) { noise++; continue; }
        const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
        if (d === 0) continue;
        hits++;
        const la = 0.2126 * A[i] + 0.7152 * A[i + 1] + 0.0722 * A[i + 2];
        const lb = 0.2126 * B[i] + 0.7152 * B[i + 1] + 0.0722 * B[i + 2];
        const dl = Math.abs(la - lb);
        sumLum += dl; if (dl > maxLum) maxLum = dl;
      }
      if (noise > noiseWorst) noiseWorst = noise;
      total += hits;
      if (hits) anyPose++;
      if (hits > worst) { worst = hits; worstAt = `view ${view} seg ${seg}`; }
      rows.push({ view, seg, hits, meanLum: hits ? sumLum / hits : 0, maxLum });
    }
  }
  return { w, h, rows, worst, worstAt, anyPose, poses: rows.length, total, noiseWorst };
});

if (out.gone) {
  console.log(`\nROOF PROBE — the scenery shell has ${out.faces} faces, not 3.`);
  console.log(`  There is no roof face to switch off. It was deleted on the`);
  console.log(`  measurement recorded in the Scenery constructor; put it back`);
  console.log(`  and this tool will grade it again.\n`);
  await browser.close();
  process.exit(0);
}

const px = out.w * out.h;
console.log(`\nROOF PROBE — ${out.w}x${out.h} = ${px} px, scenery 7040, ${out.poses} poses\n`);
console.log(`  poses with at least one roof pixel   ${out.anyPose} of ${out.poses}`);
console.log(`  worst single pose                    ${out.worst} px  (${(100 * out.worst / px).toFixed(4)}%)  at ${out.worstAt}`);
console.log(`  self-animating pixels masked, worst  ${out.noiseWorst} px  <- what two captures would have miscounted`);
const hot = out.rows.filter((r) => r.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, 10);
console.log(`\n  the ten worst poses:`);
for (const r of hot) {
  console.log(`    view ${r.view}  seg ${String(r.seg).padStart(4)}   ${String(r.hits).padStart(5)} px` +
              `   mean dLum ${r.meanLum.toFixed(1)}   max dLum ${r.maxLum.toFixed(0)}`);
}
const bright = out.rows.reduce((s, r) => Math.max(s, r.maxLum), 0);
console.log(`\n  brightest single-pixel change anywhere   ${bright.toFixed(0)} luminance points`);

await browser.close();
