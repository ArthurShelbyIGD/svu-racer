// NULL TEST for the silhouette isolation. The harness finds the car by
// rendering twice and taking whatever changed. Its tolerance was lowered from
// 16 to 2 on the grounds that the two renders are deterministic. If that is
// wrong, anything that moves between captures counts as car. So: run the same
// difference with the body left VISIBLE in both passes. A clean instrument
// returns an empty mask.
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as f } from 'node:url';
import { dirname as d, join as j } from 'node:path';
const ROOT = d(d(f(import.meta.url)));
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const p = await b.newPage({ viewport: { width: 900, height: 500 } });
await p.goto('file://' + j(ROOT, 'docs', 'index.html'), { waitUntil: 'load' });
await p.waitForTimeout(2000);
const r = await p.evaluate(async () => {
  const R = window.RACER;
  const gl = R.renderer.getContext();
  const w = R.renderer.domElement.width, h = R.renderer.domElement.height;
  const A = new Uint8Array(w * h * 4), B = new Uint8Array(w * h * 4);
  const fr = () => new Promise((r) => requestAnimationFrame(() => r()));
  R.tune.freeze = true; R.st.speed = 0; R.st.steer = 0; R.st.slope = 0;
  R.tune.studio = { az: 0.58, el: 0.13, dist: 14 };
  await fr(); await fr();
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, A);
  await fr(); await fr();                       // body left VISIBLE
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, B);
  const out = {};
  for (const t of [0, 2, 16]) {
    let n = 0;
    for (let i = 0; i < A.length; i += 4) {
      if (Math.abs(A[i] - B[i]) > t || Math.abs(A[i + 1] - B[i + 1]) > t ||
          Math.abs(A[i + 2] - B[i + 2]) > t) n++;
    }
    out['tol' + t] = n;
  }
  // and the real thing, for scale
  R.tune.showBody = false; await fr(); await fr();
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, B);
  R.tune.showBody = true; R.tune.studio = null;
  let car2 = 0, car16 = 0;
  for (let i = 0; i < A.length; i += 4) {
    const d0 = Math.abs(A[i] - B[i]), d1 = Math.abs(A[i+1] - B[i+1]), d2 = Math.abs(A[i+2] - B[i+2]);
    if (d0 > 2 || d1 > 2 || d2 > 2) car2++;
    if (d0 > 16 || d1 > 16 || d2 > 16) car16++;
  }
  return { ...out, car2, car16, px: w * h };
});
console.log(`\n  identical renders, pixels called "car":`);
console.log(`    tolerance 0   ${r.tol0}`);
console.log(`    tolerance 2   ${r.tol2}     <- the setting in use`);
console.log(`    tolerance 16  ${r.tol16}`);
console.log(`\n  real isolation: ${r.car2} px at tol 2, ${r.car16} at tol 16` +
            `  (${(r.car2 - r.car16)} px of car that tol 16 was discarding)`);
console.log(`  frame is ${r.px} px\n`);
await b.close();
