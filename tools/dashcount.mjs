// DRAW CALLS AND TRIANGLES, at the owner's resolution, in the states that
// matter for the dashboard work: idle, boosting, and mid-countdown.
//
// Printed rather than asserted, because the number this exists to protect —
// "the cockpit is ONE draw call" — is asserted in check.mjs against the whole
// scene's budget. What this gives is the before/after pair, measured at
// 1440x720 with the cockpit visible, so a change to the dashboard can be shown
// to have cost nothing.
//
//   node tools/dashcount.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));
const PAGE = 'file://' + __j(ROOT, 'docs', 'index.html');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 360 }, deviceScaleFactor: 2 });
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });
await page.evaluate(() => { window.RACER.st.view = 1; window.RACER.st.speed = 0; });
await page.waitForTimeout(1200);

const at = async (label, setup) => {
  await page.evaluate(setup);
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    calls: window.RACER.renderer.info.render.calls,
    tris: window.RACER.renderer.info.render.triangles,
    ck: window.RACER.cockpit.stats,
  }));
  console.log(`  ${label.padEnd(22)} ${String(r.calls).padStart(3)} calls, ` +
              `${String(r.tris).padStart(6)} tris    cockpit ${r.ck.calls} call, ` +
              `${r.ck.tris} tris, ${r.ck.verts} verts`);
  return r;
};

console.log('\n  1440x720, first person\n');
await at('on the grid', () => { window.RACER.race.state = 'grid'; });
await at('countdown', () => { window.RACER.race.state = 'countdown'; window.RACER.race.t = 0.2; });
await at('racing, idle', () => { window.RACER.race.state = 'racing'; window.RACER.race.t = 9;
                                 window.RACER.pedal.brake = false; window.RACER.pedal.boost = false; });
await at('racing, braking', () => { window.RACER.pedal.brake = true; window.RACER.pedal.boost = false; });
await at('racing, boosting', () => { window.RACER.pedal.brake = false; window.RACER.pedal.boost = true; });
console.log('');
await browser.close();
