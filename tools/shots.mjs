// Look at the frames. On this project, reasoning about rendering has been wrong
// three times and looking has been right every time.

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FILE = 'file://' + join(ROOT, 'docs', 'index.html');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1008, height: 420 } });
await page.goto(FILE, { waitUntil: 'load' });
await page.waitForTimeout(2500);

const shot = async (name, setup, settle = 2500) => {
  await page.evaluate(setup);
  await page.waitForTimeout(settle);
  const info = await page.evaluate(() => ({
    calls: window.RACER.renderer.info.render.calls,
    tris: window.RACER.renderer.info.render.triangles,
    n: window.RACER.scenery ? window.RACER.scenery.count : -1,
  }));
  await page.screenshot({ path: join(ROOT, 'shots', name + '.png') });
  console.log(`${name.padEnd(22)} ${String(info.calls).padStart(3)} calls  ${String(info.tris).padStart(7)} tris`);
};

await page.evaluate(() => { window.RACER.scenery = window.RACER.scenery || null; });

await shot('1-third-bare', () => { window.RACER.st.view = 3; });
await shot('2-first-bare', () => { window.RACER.st.view = 1; });
await shot('3-third-scenery-2k', () => {
  window.RACER.st.view = 3;
  document.getElementById('bUp').click();     // 100
  for (let i = 0; i < 5; i++) document.getElementById('bUp').click();  // 3200
});
await shot('4-first-scenery-2k', () => { window.RACER.st.view = 1; });
await shot('5-third-scenery-max', () => {
  window.RACER.st.view = 3;
  for (let i = 0; i < 4; i++) document.getElementById('bUp').click();  // -> cap
});

await browser.close();
