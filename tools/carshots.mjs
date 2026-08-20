// Look at the car. Third person, first person, moving and parked.

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
const page = await browser.newPage({ viewport: { width: 1008, height: 420 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForTimeout(2000);
if (errs.length) console.log('ERRORS:', errs.join(' | '));

// Hide the debug furniture so the frames show the game, not the readout.
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

// START THE RACE FIRST. On the grid the loop zeroes the speed before it takes
// the value the camera and the field of view read, so every "cruise" and
// "boost" frame this tool has ever written was photographed at the parked
// camera. Same hole as tools/inkmeter.mjs had; found by tools/chasecam.mjs.
await page.evaluate(async () => {
  const R = window.RACER;
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

async function shot(name, opts) {
  await page.evaluate((o) => {
    const R = window.RACER;
    R.st.view = o.view;
    R.st.dist = o.dist;
    R.st.x = 0;
    R.tune.maxSpeed = o.max;
    R.tune.holdSpeed = o.speed;
    R.st.speed = o.speed;
    R.st.steer = o.steer || 0;
    R.st.slope = 0;
    R.tilt.on = true;
    R.tilt.out = o.steer || 0;
    R.pedal.boost = !!o.boost;
    R.pedal.brake = !!o.brake;
  }, opts);
  await page.waitForTimeout(450);
  // Freeze again — the loop may have advanced dist while we waited.
  await page.evaluate((o) => {
    const R = window.RACER;
    R.st.dist = o.dist; R.tune.holdSpeed = o.speed; R.st.x = 0; R.tune.freeze = true;
  }, opts);
  await page.waitForTimeout(180);
  const i = await page.evaluate(() => ({
    c: window.RACER.renderer.info.render.calls,
    t: window.RACER.renderer.info.render.triangles,
  }));
  await page.screenshot({ path: __j(SHOTS, `car-${name}.png`) });
  console.log(`${name.padEnd(18)} ${String(i.c).padStart(3)} calls  ${String(i.t).padStart(6)} tris`);
}

const D = flat * 6;
// speed 0 with a tiny maxSpeed keeps v at 0 so the field of view stays put.
await shot('3rd-parked',  { view: 3, dist: D, speed: 0,   max: 1e-6 });
await shot('3rd-cruise',  { view: 3, dist: D, speed: 170, max: 210 });
await shot('3rd-steer',   { view: 3, dist: D, speed: 170, max: 210, steer: 0.8 });
await shot('1st-cruise',  { view: 1, dist: D, speed: 170, max: 210 });
await shot('1st-boost',   { view: 1, dist: D, speed: 260, max: 210, boost: true });
await shot('1st-brake',   { view: 1, dist: D, speed: 120, max: 210, brake: true, steer: -0.6 });

await browser.close();
