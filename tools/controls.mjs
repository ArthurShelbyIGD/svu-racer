// CAN YOU BRAKE? Written because you could not.
//
// The pedals used to be gated on tilt.on, so on any device that had never
// reported a tilt — an iPhone that was never asked for permission, a laptop, a
// phone held flat — every touch steered and there was no brake and no boost at
// all. A real player found it before any test did: "braking doesn't work" and
// "boost has issues, the car just steers instead" were the same line of code.
//
// So this drives the page with synthetic touches at real screen positions and
// asks what the game thinks is happening, in BOTH tilt states. The one that
// matters is tilt off, because that is the state that shipped broken.
//
//   node tools/controls.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));
const PAGE = 'file://' + __j(ROOT, 'docs', 'index.html');
const W = 720, H = 360;

// fraction of width, fraction of height, what it must do
const CASES = [
  ['bottom-left corner',   0.08, 0.92, 'brake'],
  ['bottom-left, inboard', 0.35, 0.75, 'brake'],
  ['bottom-right corner',  0.92, 0.92, 'boost'],
  ['bottom-right, inboard',0.65, 0.75, 'boost'],
  ['bottom middle',        0.50, 0.90, 'nothing'],
  ['upper left',           0.20, 0.25, 'steer left'],
  ['upper right',          0.80, 0.25, 'steer right'],
  ['upper left, low down', 0.20, 0.50, 'steer left'],
];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
let bad = 0;
for (const tiltOn of [false, true]) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, hasTouch: true });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  await page.evaluate((on) => { window.RACER.renderer.setPixelRatio(0.5); window.RACER.tilt.on = on; }, tiltOn);
  console.log(`\n  TILT ${tiltOn ? 'ON ' : 'OFF'}${tiltOn ? '' : '   <- the state that shipped with no brake'}`);
  console.log('  where                      x,y        got            want');
  for (const [name, fx, fy, want] of CASES) {
    const x = Math.round(fx * W), y = Math.round(fy * H);
    const got = await page.evaluate(async ({ x, y }) => {
      const R = window.RACER;
      // A real touch, dispatched at a real coordinate, read back from the game's
      // own state — not a call to readTouches() with a made-up list, which would
      // test the function while skipping the wiring that was actually broken.
      const t = new Touch({ identifier: 1, target: document.getElementById('c'),
                            clientX: x, clientY: y });
      const ev = (type) => document.getElementById('c').dispatchEvent(
        new TouchEvent(type, { touches: type === 'touchend' ? [] : [t],
                               changedTouches: [t], bubbles: true, cancelable: true }));
      ev('touchstart');
      await new Promise((r) => requestAnimationFrame(() => r()));
      const out = { brake: R.pedal.brake, boost: R.pedal.boost, steer: R.tilt.on ? 0 : R.st.steer };
      const dir = window.__touchDir;
      ev('touchend');
      await new Promise((r) => requestAnimationFrame(() => r()));
      return out;
    }, { x, y });
    const label = got.brake ? 'brake' : got.boost ? 'boost'
                : 'nothing';
    // steering is read from the smoothed value, so check the raw intent instead
    const steered = await page.evaluate(() => window.RACER.st.steer);
    let seen = label;
    if (label === 'nothing' && !tiltOn) {
      seen = steered < -0.001 ? 'steer left' : steered > 0.001 ? 'steer right' : 'nothing';
    }
    const expect = tiltOn && want.startsWith('steer') ? 'nothing' : want;
    const ok = seen === expect;
    if (!ok) bad++;
    console.log(`  ${name.padEnd(24)} ${String(x).padStart(4)},${String(y).padEnd(4)}` +
                `  ${seen.padEnd(13)}  ${expect}${ok ? '' : '   <-- WRONG'}`);
    await page.evaluate(() => { window.RACER.st.steer = 0; });
  }
  await page.close();
}

// AND: DOES TOUCHING A BUTTON ASK FOR TILT PERMISSION?
//
// iOS only offers the motion dialog from inside a real gesture, and the request
// used to be wired to the canvas alone while the control buttons call
// stopPropagation. So a player whose first touch was a button never got asked,
// and since the car drives itself they could reach 95mph without ever finding
// out. That is what happened on the first iPhone this was handed to.
{
  const page = await browser.newPage({ viewport: { width: W, height: H }, hasTouch: true });
  await page.addInitScript(() => {
    // Stand in for iOS. Chromium has DeviceOrientationEvent but no
    // requestPermission, so the code path under test never runs here otherwise.
    window.__asked = 0;
    if (!window.DeviceOrientationEvent) window.DeviceOrientationEvent = function () {};
    window.DeviceOrientationEvent.requestPermission = () => {
      window.__asked++; return Promise.resolve('granted');
    };
  });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  const before = await page.evaluate(() => window.__asked);
  // Touch a BUTTON and nothing else — the exact thing that used to fail.
  await page.evaluate(() => {
    const b = document.getElementById('bTog');
    const t = new Touch({ identifier: 9, target: b, clientX: 10, clientY: 10 });
    b.dispatchEvent(new TouchEvent('touchstart',
      { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => window.__asked);
  const ok = before === 0 && after === 1;
  if (!ok) bad++;
  console.log(`\n  PERMISSION\n  asked before any touch   ${before}   (must be 0 — iOS ignores it outside a gesture)`);
  console.log(`  asked after touching a button   ${after}   (must be 1)${ok ? '' : '   <-- WRONG'}`);
  await page.close();
}

console.log('');
await browser.close();
process.exit(bad ? 1 : 0);
