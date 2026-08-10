// DOES THE READOUT FIT ON THE SCREEN? It exists to be photographed by testers,
// so a line below the fold is a line that does not exist.
//
// This is here because it shipped broken. Anthony's phone reports a 1440x720
// canvas at dpr 2.00 — a 360px-tall CSS viewport — and eighteen lines at 13px
// came to roughly 416px, so `device` clipped mid-word and the WebGL line and
// the user agent were off the bottom entirely. The two most useful fields in a
// stranger's screenshot were the two you could not see.
//
//   node tools/hudfit.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));
const PAGE = 'file://' + __j(ROOT, 'docs', 'index.html');

// CSS pixels, landscape. The first is Anthony's phone, which is the short one
// and therefore the one that matters; the rest bracket what a Discord will send.
const SCREENS = [
  { name: "Anthony's phone", w: 720, h: 360 },
  // The shape a tester actually meets FIRST: the page in a browser tab with
  // the address bar still there, before anything has gone fullscreen. 1344x560
  // at dpr 2. This is where the columns collided and no screen in the list
  // covered it.
  { name: 'his phone, windowed', w: 672, h: 280 },
  { name: 'small phone',     w: 640, h: 320 },
  { name: 'iPhone-ish',      w: 844, h: 390 },
  { name: 'old tablet',      w: 1024, h: 600 },
  { name: 'very short',      w: 800, h: 300 },
];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
let bad = 0;
console.log('\n  READOUT FIT — panel open, measured against the viewport\n');
console.log('  screen                 viewport   text     controls   verdict');
for (const s of SCREENS) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  await page.evaluate(() => {
    window.RACER.renderer.setPixelRatio(0.5);
    document.getElementById('bTog').click();          // open the panel
  });
  await page.waitForTimeout(900);                     // past one HUD refresh
  const m = await page.evaluate(() => {
    const h = document.getElementById('hud');
    const r = h.getBoundingClientRect();
    // THE BUTTONS COUNT AS AN EDGE. The first version of this test measured the
    // panel against the WINDOW only, passed everything, and the second column
    // was running underneath the control grid the whole time — unreadable in
    // precisely the screenshot the panel exists to be. Checking one boundary
    // and calling it "fits" is how a fit test lies to you.
    const c = document.getElementById('ctl').getBoundingClientRect();
    // the widest line of real text, not the block's own width
    let textRight = 0;
    for (const el of h.querySelectorAll('span')) {
      const range = document.createRange();
      range.selectNodeContents(el);
      for (const rect of range.getClientRects()) textRight = Math.max(textRight, rect.right);
    }
    // DO THE TWO COLUMNS COLLIDE WITH EACH OTHER? The previous version asked
    // only whether the panel fitted the screen and cleared the buttons, and
    // passed a layout in which the right-hand column was written straight
    // through the left one — because #stats and #stats2 are SPANS, so setting
    // their parent to display:block on a narrow screen left them flowing
    // inline. It looked like "canvas 1344x560build 2a4371a" on a real phone
    // and the rig called it a fit. Fitting and being readable are not the same
    // claim, and only one of them was being tested.
    const A = document.getElementById('stats').getBoundingClientRect();
    const B = document.getElementById('stats2').getBoundingClientRect();
    const collide = !(B.left >= A.right - 0.5 || A.left >= B.right - 0.5
                   || B.top >= A.bottom - 0.5 || A.top >= B.bottom - 0.5);
    return { bottom: Math.ceil(r.bottom), right: Math.ceil(textRight),
             ctlLeft: Math.floor(c.left), ctlBottom: Math.ceil(c.bottom),
             vh: window.innerHeight, vw: window.innerWidth, collide,
             clipped: h.scrollHeight > h.clientHeight + 1 };
  });
  const overV = m.bottom - m.vh;
  const overH = m.right - Math.min(m.vw, m.ctlLeft);
  const ok = overV <= 0 && overH <= 0 && !m.clipped && !m.collide;
  if (!ok) bad++;
  console.log(`  ${s.name.padEnd(20)} ${String(m.vw).padStart(5)}x${String(m.vh).padEnd(4)}` +
              ` ${String(m.right).padStart(5)}x${String(m.bottom).padEnd(4)}` +
              `  buttons at ${String(m.ctlLeft).padStart(4)}  ` +
              `${ok ? 'fits' : m.collide ? 'COLUMNS COLLIDE'
                : `OVER by ${Math.max(overV, 0)}px down, ${Math.max(overH, 0)}px into the buttons`}`);
  await page.close();
}

// AND PROVE THE TEST CAN FAIL — against the fault that actually reached a
// phone, not a historical one. This used to re-apply an old font size and
// require the overflow to be caught; once the content changed, that layout
// stopped overflowing and the self-check quietly started passing while
// proving nothing. So it now recreates the COLLISION: spans left inline
// inside a block parent, which is what wrote the right-hand column straight
// through the left one on Anthony's windowed phone.
{
  const page = await browser.newPage({ viewport: { width: 720, height: 360 } });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  await page.evaluate(() => {
    window.RACER.renderer.setPixelRatio(0.5);
    document.getElementById('bTog').click();
    const st = document.createElement('style');
    st.textContent = '#hcols{display:block}#stats,#stats2{display:inline}';
    document.head.appendChild(st);
  });
  await page.waitForTimeout(900);
  const m = await page.evaluate(() => {
    const A = document.getElementById('stats').getBoundingClientRect();
    const B = document.getElementById('stats2').getBoundingClientRect();
    return { collide: !(B.left >= A.right - 0.5 || A.left >= B.right - 0.5
                     || B.top >= A.bottom - 0.5 || A.top >= B.bottom - 0.5) };
  });
  console.log(`  the collision that shipped, forced back on the same screen:  ->  ` +
              (m.collide ? 'CAUGHT, correctly' : 'NOT CAUGHT — this test is blind'));
  if (!m.collide) bad++;
  await page.close();
}

console.log('');
await browser.close();
process.exit(bad ? 1 : 0);
