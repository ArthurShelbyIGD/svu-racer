// LOOK AT THE CAR ON ITS OWN, from the angles the reference drawings use.
//
// tools/carshots.mjs photographs the car from the DRIVER'S seat and from the
// chase camera — what the game shows. That is the right tool for "does it look
// good while playing" and the wrong one for "is this the same shape as the
// drawing", because in both of those views most of the car is off the bottom of
// the frame or behind the dashboard.
//
// This one drives the studio camera the silhouette harness uses — the same
// az/el/dist rig, so a picture here is the picture that produced a score there
// — and saves a PNG per angle. It exists because a number is not a look: the
// harness can tell you 95.6% and it cannot tell you the bonnet reads as flat,
// and Anthony judges on a phone screen, not on an IoU.
//
// THE ANGLES MATCH THE REFERENCES, AND THE SIDE ONE IS THE FIXED SIGN. az -PI/2
// stands on the car's LEFT flank, nose to screen left, which is how
// ref/side-nobg.png is drawn. Photographing +PI/2 here would produce a picture
// that looks right and disagrees with every score in the project.
//
//   node tools/carmodel.mjs [body-letter]

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { mkdirSync } from 'node:fs';

const __ROOT = __d(__d(__f(import.meta.url)));
const BODY = process.argv[2] || '';
const PAGE = 'file://' + __j(__ROOT, 'docs', 'index.html') + (BODY ? '?body=' + BODY : '');
const SHOTS = __j(__ROOT, 'shots');
mkdirSync(SHOTS, { recursive: true });

const TAG = BODY || 'default';

/** az, el, dist — the same rig the silhouette harness poses. */
const ANGLES = [
  ['side',   -Math.PI / 2,      0.02, 14],
  ['rear',    0,                0.10, 13],
  ['front',   Math.PI,          0.10, 13],
  ['3q-rear', -Math.PI * 0.28,  0.22, 15],
  ['3q-front', Math.PI * 0.74,  0.20, 15],
  ['high',   -Math.PI * 0.35,   0.55, 16],
];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 420 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });
await page.evaluate(() => {
  // The menu is a DOM layer over the canvas, so a page screenshot photographs
  // it rather than the car. Two tools have been blinded by this already.
  if (window.RACER.menu) window.RACER.menu.close();
  for (const id of ['hud', 'note', 'ctl', 'gears']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
});

// ASK THE GAME WHICH BODY IT BUILT rather than believing the query string this
// tool wrote itself — if the registry ignored it, the pictures would be
// labelled with a comparison that never happened.
const info = await page.evaluate(() => ({
  body: window.RACER.bodyName ? window.RACER.bodyName() : '?',
  stats: window.RACER.bodyKit ? window.RACER.bodyKit.stats : null,
}));
if (BODY && info.body !== BODY) {
  console.log(`\n  ASKED FOR ?body=${BODY} AND GOT ${info.body} — the pictures are not what you think.`);
}

for (const [name, az, el, dist] of ANGLES) {
  await page.evaluate(async ({ az, el, dist }) => {
    const R = window.RACER;
    R.tune.freeze = true; R.st.speed = 0; R.st.steer = 0; R.st.slope = 0;
    R.tune.studio = { az, el, dist, clean: true };
    const f = () => new Promise((r) => requestAnimationFrame(() => r()));
    await f(); await f(); await f();
  }, { az, el, dist });
  await page.screenshot({ path: __j(SHOTS, `model-${TAG}-${name}.png`) });
  console.log(`  wrote shots/model-${TAG}-${name}.png`);
}

// LEAVE THE PAGE AS THE GAME, not as a studio. A tool that exits mid-pose has
// no consequences here, but the next thing to reuse this page would inherit it.
await page.evaluate(() => { window.RACER.tune.studio = null; window.RACER.tune.freeze = false; });
await browser.close();

console.log(`\n  body ${info.body}${info.stats ? `  ${info.stats.tris} tris, ${info.stats.calls} calls` : ''}`);
console.log(`  page errors: ${errs.length ? errs.join(' | ') : 'none'}\n`);
