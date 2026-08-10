// Does studio mode actually render the car, and does hiding the body change
// anything? A one-shot sanity check for the silhouette harness, which reported
// an empty mask twice and cost two long software-renderer runs to diagnose.

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
// THE HARNESS MUST MEASURE THE BUILD NEXT TO IT, not a fixed path. These tools
// hard-coded /root/racer, so an agent working in a git worktree would have
// photographed master's car and graded its own work by someone else's frame.
const __ROOT = __d(__d(__f(import.meta.url)));
const PAGE = 'file://' + __j(__ROOT, 'docs', 'index.html');
const SHOTS = __j(__ROOT, 'shots');


const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 600, height: 340 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForTimeout(2000);
if (errs.length) console.log('ERRORS:', errs.slice(0, 2).join(' | '));
await page.evaluate(() => {
  for (const id of ['hud', 'note', 'ctl']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
});

const r = await page.evaluate(async () => {
  const R = window.RACER;
  const f = () => new Promise((res) => requestAnimationFrame(() => res()));
  const gl = R.renderer.getContext();
  const w = R.renderer.domElement.width, h = R.renderer.domElement.height;
  const A = new Uint8Array(w * h * 4), B = new Uint8Array(w * h * 4);
  R.tune.freeze = true; R.st.speed = 0;
  R.tune.studio = { az: 0.62, el: 0.30, dist: 11 };
  await f(); await f();
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, A);
  const callsOn = R.renderer.info.render.calls;
  R.tune.showBody = false;
  await f(); await f();
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, B);
  const callsOff = R.renderer.info.render.calls;
  let diff = 0;
  for (let i = 0; i < A.length; i += 4) {
    if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 16) diff++;
  }
  R.tune.showBody = true;
  await f();
  return { hasStudio: 'studio' in R.tune, callsOn, callsOff, diff, px: w * h };
});

console.log(`studio flag present   ${r.hasStudio}`);
console.log(`draw calls, body on   ${r.callsOn}`);
console.log(`draw calls, body off  ${r.callsOff}`);
console.log(`pixels differing      ${r.diff} of ${r.px}  ` +
            `(${(100 * r.diff / r.px).toFixed(1)}%)  <- this is the car`);

await page.evaluate(() => { window.RACER.tune.studio = { az: 0.62, el: 0.30, dist: 11 }; });
await page.waitForTimeout(400);
await page.screenshot({ path: __j(SHOTS, 'studio.png') });
await browser.close();
