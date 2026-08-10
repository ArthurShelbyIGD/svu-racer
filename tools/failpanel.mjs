// DOES THE FAILURE PANEL ACTUALLY FIRE? Three ways a tester's device can give
// them a black screen, each forced deliberately, because a safety net nobody
// has jumped into is not a safety net.
//
//   node tools/failpanel.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));
const PAGE = 'file://' + __j(ROOT, 'docs', 'index.html');
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const shown = async (page) => page.evaluate(() => {
  const el = document.getElementById('fail');
  return { visible: getComputedStyle(el).display !== 'none',
           text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 150) };
});

// 1. no WebGL 2 — the old-tablet case
{
  const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, ...a) {
      return t === 'webgl2' ? null : real.call(this, t, ...a);
    };
  });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const r = await shown(page);
  console.log(`\n  no WebGL2      panel ${r.visible ? 'SHOWN' : 'MISSING'}`);
  console.log(`                 "${r.text}"`);
  await page.close();
}
// 2. a thrown error during boot
{
  const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
  // Fired rather than caused. Breaking something the bundle needs at module
  // scope also breaks Playwright's own injected script, so the harness dies
  // before it can read the result — the first version of this test did exactly
  // that. What is under test here is that the window 'error' listener is wired
  // and reaches the panel, and a real ErrorEvent exercises precisely that.
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.dispatchEvent(
    new ErrorEvent('error', { message: 'deliberate boot failure' })));
  await page.waitForTimeout(300);
  const r = await shown(page);
  console.log(`\n  boot throws    panel ${r.visible ? 'SHOWN' : 'MISSING'}`);
  console.log(`                 "${r.text}"`);
  await page.close();
}
// 3. the silent case — nothing throws, the game just never appears
{
  const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
  await page.route('**/*', (route) => route.continue());
  await page.addInitScript(() => {
    // Simulate a truncated bundle: the page loads, nothing errors, RACER never
    // arrives. Hide it from the game rather than breaking anything.
    Object.defineProperty(window, 'RACER', { get: () => undefined, set: () => {} });
  });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(9500);
  const r = await shown(page);
  console.log(`\n  silent stall   panel ${r.visible ? 'SHOWN' : 'MISSING'}`);
  console.log(`                 "${r.text}"`);
  await page.close();
}
// 4. and the healthy case must NOT show it
{
  const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(9500);
  const r = await shown(page);
  const dev = await page.evaluate(() => window.__DEVICE);
  console.log(`\n  healthy boot   panel ${r.visible ? 'SHOWN — FALSE ALARM' : 'hidden, correct'}`);
  console.log(`                 build ${dev.build}`);
  console.log(`                 GPU ${dev.vendor} / ${dev.renderer}`);
  console.log(`                 WebGL ${dev.webgl}  ${dev.screen} dpr ${dev.dpr}  maxtex ${dev.maxTex}\n`);
  await page.close();
}
await browser.close();
