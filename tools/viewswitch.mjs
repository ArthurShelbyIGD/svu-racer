// DOES THE CHASE CAMERA ROW ACTUALLY DO ANYTHING?
//
// This project has already shipped one Settings switch that changed a flag and
// nothing else — TILT STEERING, which set `tilt.enabled` and never called
// `askTilt()`, so the single most important control in the game could not be
// turned on by the one action every player tries. It was found by Anthony's
// daughter's iPhone, not by a harness, and it nearly ended the project:
// "so unless something is wrong with the code there is little point in moving
// forward with the game."
//
// So a new switch gets a harness on the day it goes in, and the harness asserts
// the CONSEQUENCE rather than the flag. A flag is what the switch obviously
// sets; the consequence is what the player came for. Here that is four things:
//
//   1. the game starts in the driver's seat, which is where every lap time on
//      record was set
//   2. tapping the row puts the camera behind the car — proved by the FRAME
//      CHANGING, not by reading st.view back
//   3. the choice survives a reload, because reloading is the most common
//      thing a tester does
//   4. tapping it again comes back, and that persists too — a setting you can
//      only turn on is a trap
//
// THE NEGATIVE CONTROL IS THE POINT OF STEP 2. Rendering a frame, doing
// nothing, and rendering again must produce an identical image; if it does not,
// then "the frame changed" proves nothing about the camera. The scene is not
// still even when the car is frozen — the wake, the pedals and the neon all
// keep moving — so the control is measured rather than assumed, and the switch
// has to beat it by a wide margin.
//
//   node tools/viewswitch.mjs

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';

const __ROOT = __d(__d(__f(import.meta.url)));
const PAGE = 'file://' + __j(__ROOT, 'docs', 'index.html');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

let bad = 0;
const ok = (cond, name, detail) => {
  if (!cond) bad++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}   ${name}${detail ? '   ' + detail : ''}`);
};

/** Load, dismiss the menu layer, and settle on a repeatable pose. */
async function load() {
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  await page.evaluate(async () => {
    const R = window.RACER;
    R.menu.close();
    for (const id of ['hud', 'note', 'ctl', 'gears']) {
      const e = document.getElementById(id);
      if (e) e.style.display = 'none';
    }
    R.st.dist = 600; R.st.x = 0; R.st.steer = 0; R.st.slope = 0;
    R.tune.maxSpeed = 210; R.st.speed = 170; R.tune.freeze = true;
    const f = () => new Promise((r) => requestAnimationFrame(() => r()));
    for (let i = 0; i < 6; i++) await f();
  });
}

/** A frame off the WebGL buffer, as raw bytes. */
const frame = () => page.evaluate(async () => {
  const R = window.RACER;
  const gl = R.renderer.getContext();
  const w = R.renderer.domElement.width, h = R.renderer.domElement.height;
  const buf = new Uint8Array(w * h * 4);
  const f = () => new Promise((r) => requestAnimationFrame(() => r()));
  await f(); await f();
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let s = 0;
  const out = [];
  for (let i = 0; i < buf.length; i += 4) out.push(buf[i], buf[i + 1], buf[i + 2]);
  return out;
});

const differs = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) n++;
  }
  return 100 * n / (a.length / 3);
};

/** Tap the row the way a player does: on the button, in the DOM. */
const tapChase = () => page.evaluate(() => {
  const b = document.querySelector('#sBody .sSw[data-k="chase"]');
  if (!b) return 'no such row';
  b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return b.textContent.trim();
});

console.log('\nCHASE CAMERA — the Settings row, and what it actually does\n');

await load();
const rowExists = await page.evaluate(() => !!document.querySelector('#sBody .sSw[data-k="chase"]'));
ok(rowExists, 'the row is in Settings');

const startView = await page.evaluate(() => window.RACER.st.view);
ok(startView === 1, 'a fresh load starts in the driver\'s seat', `view ${startView}`);

// --- the negative control, first, so the threshold is earned ---------------
const a1 = await frame();
const a2 = await frame();
const still = differs(a1, a2);
ok(still < 2, 'NEGATIVE CONTROL: two frames with nothing touched are the same',
  `${still.toFixed(2)}% of pixels move on their own`);

const label = await tapChase();
const chaseView = await page.evaluate(() => window.RACER.st.view);
const b1 = await frame();
const moved = differs(a2, b1);
ok(chaseView === 3, 'the row switches the view', `view ${chaseView}, button reads "${label}"`);
ok(moved > still * 10 && moved > 20, 'and the CAMERA moves, not just the flag',
  `${moved.toFixed(1)}% of the frame changed, against ${still.toFixed(2)}% for doing nothing`);

// --- does it survive a reload ----------------------------------------------
await load();
const afterReload = await page.evaluate(() => window.RACER.st.view);
ok(afterReload === 3, 'the choice survives a reload', `view ${afterReload}`);

// --- and back again ---------------------------------------------------------
await tapChase();
const backView = await page.evaluate(() => window.RACER.st.view);
ok(backView === 1, 'tapping again returns to the driver\'s seat', `view ${backView}`);
await load();
const backAfterReload = await page.evaluate(() => window.RACER.st.view);
ok(backAfterReload === 1, 'and THAT survives a reload too', `view ${backAfterReload}`);

// A setting that only sticks in one direction is worse than one that never
// sticks: the player turns it off, reloads, and it is on again.

console.log(`\n  page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
console.log(bad ? `\n  ${bad} failed\n` : '\n  all checks passed\n');
await browser.close();
process.exit(bad ? 1 : 0);
