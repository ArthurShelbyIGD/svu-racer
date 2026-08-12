// Three frames of the night city: third person, first person, and the city
// wound up. Rebuilt as a tracked tool because the throwaway version in /tmp
// kept being clobbered by agents writing scripts of their own there.

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
const page = await browser.newPage({ viewport: { width: 1024, height: 559 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForTimeout(2400);
if (errs.length) console.log('ERRORS:', errs.slice(0, 2).join(' | '));
await page.evaluate(() => {
    // GET THE LANDING PAGE OUT OF THE WAY. It is a DOM layer over the canvas,
    // so a page screenshot photographs the menu rather than the game — which
    // is exactly how it blinded two of these tools the day it shipped. Tools
    // that read the WebGL buffer with gl.readPixels never saw the problem,
    // because the menu is not in that buffer.
    if (window.RACER.menu) window.RACER.menu.close();
  for (const id of ['hud', 'note', 'ctl']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
});

const flat = await page.evaluate(() => {
  const t = window.RACER.track;
  let best = 0, bs = 1e9;
  for (let i = 100; i < t.n - 300; i += 5) {
    let s = 0;
    for (let k = 0; k < 160; k++) {
      const j = (i + k) % t.n;
      s += Math.abs(t.curve[j]) + Math.abs(t.hill[j] - t.hill[i]) * 0.002;
    }
    if (s < bs) { bs = s; best = i; }
  }
  return best;
});

async function shot(name, view, clicks) {
  await page.evaluate(({ d, v, c }) => {
    const R = window.RACER;
    R.st.view = v; R.st.dist = d; R.st.x = 0;
    R.tune.maxSpeed = 210; R.st.speed = 170; R.tune.freeze = true;
    R.tilt.on = true; R.tilt.out = 0; R.st.steer = 0; R.st.slope = 0;
    const dn = document.getElementById('bDown');
    for (let i = 0; i < 30; i++) dn.click();          // back to zero
    const up = document.getElementById('bUp');
    for (let i = 0; i < c; i++) up.click();
  }, { d: flat * 6, v: view, c: clicks });
  await page.waitForTimeout(900);
  const i = await page.evaluate(() => ({
    c: window.RACER.renderer.info.render.calls,
    t: window.RACER.renderer.info.render.triangles,
    n: window.RACER.scenery ? window.RACER.scenery.count : -1,
  }));
  await page.screenshot({ path: __j(SHOTS, `${name}.png`) });
  console.log(`${name.padEnd(12)} ${String(i.c).padStart(3)} calls  ${String(i.t).padStart(7)} tris  scenery ${i.n}`);
}

await shot('night-3rd', 3, 6);
await shot('night-1st', 1, 6);
await shot('night-city', 3, 9);   // 25,600 — the software renderer cannot sit at 120,000

await browser.close();
