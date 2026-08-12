// Look at the gantries. Park the car at measured distances before the start
// line and before the finish line, photograph the approach, and report the
// draw calls and triangles the frame actually cost.
//
// WHY THE DISTANCES ARE THESE FOUR. At the game's 74-degree horizontal field
// of view a 16-unit banner spans 13% of the screen at 80 units, 21% at 50,
// 35% at 30 and 59% at 18. Those are the four sizes the art and the lettering
// have to survive, so those are the four frames. Anything else is a picture of
// nothing in particular.
//
// THE CAR IS FROZEN AND HELD ON THE CENTRELINE. tune.freeze stops st.dist
// advancing, and holdX pins the lateral position — without it the physics
// rewrites st.x every frame and a "shot from 30 units out" is really a shot
// from wherever the car had drifted to by the time the shutter went.
//
// BUT THE SPEED IS NOT ZERO, AND THE FIRST VERSION OF THIS FILE GOT THAT WRONG.
// The field of view opens from 74 to 94 degrees with speed, and the windscreen
// header therefore sits at 16 degrees above the eye when stopped and 22 degrees
// at racing pace. A gantry is a tall object, so that difference decides whether
// the banner is on screen at all in the last thirty units — and photographing
// it stopped reported "nothing visible at 18 units" for a frame the player
// never sees. main.js says so in as many words at the definition of
// tune.freeze. So every shot is taken TWICE: once at 205 units a second, which
// is how a finish line is actually approached, and once stopped, which is the
// grid and the worst case. The `-slow` frames are the pessimistic set.

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FILE = 'file://' + join(ROOT, 'docs', 'index.html');
const OUT = join(ROOT, 'shots');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1008, height: 420 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(FILE, { waitUntil: 'load' });
await page.waitForTimeout(2500);

// The suite's own reason: no GPU in this container, and nothing here measures
// fill rate. Full pixel ratio would make every settle four times slower.
await page.evaluate(() => {
    // GET THE LANDING PAGE OUT OF THE WAY. It is a DOM layer over the canvas,
    // so a page screenshot photographs the menu rather than the game — which
    // is exactly how it blinded two of these tools the day it shipped. Tools
    // that read the WebGL buffer with gl.readPixels never saw the problem,
    // because the menu is not in that buffer.
    if (window.RACER.menu) window.RACER.menu.close();
  const R = window.RACER;
  R.renderer.setPixelRatio(1);
  R.tune.freeze = true;
  R.tune.holdX = 0;
  R.st.view = 1;
  R.tilt.on = false;
});

const K = await page.evaluate(() => window.RACER.consts);
console.log(`RACE_FROM ${K.RACE_FROM}  RACE_LEN ${K.RACE_LEN}  SEG_LEN ${K.SEG_LEN}`);

const at = async (name, dist, speed) => {
  await page.evaluate(({ d, v }) => {
    const R = window.RACER;
    // THE RACE STATE HAS TO BE 'racing' OR THE SPEED IS NOT REAL. On the grid
    // and through the countdown main.js kills the throttle and pins st.speed at
    // zero — deliberately, so the launch does not depend on a brake fighting an
    // engine — so a harness that writes st.speed and does not clear the hold
    // gets it wiped on the next frame and photographs a stationary car at a
    // 74-degree field of view while believing it shot one doing 205. The first
    // version of this file did exactly that; `vfov` in the printout is here so
    // it cannot happen again silently.
    R.race.state = 'racing';
    R.st.dist = d;
    R.st.x = 0;
    R.st.speed = v;
    R.st.gear = 4;
  }, { d: dist, v: speed });
  // The field of view eases toward its target, so give it time to arrive
  // rather than photographing it on the way.
  await page.waitForTimeout(900);
  const info = await page.evaluate(() => {
    const i = window.RACER.renderer.info.render;
    const g = window.RACER.gantry;
    return { calls: i.calls, tris: i.triangles, fov: window.RACER.camera.fov,
             gantry: g && g.stats ? JSON.stringify(g.stats) : 'none' };
  });
  await page.screenshot({ path: join(OUT, name + '.png') });
  console.log(`${name.padEnd(24)} ${String(info.calls).padStart(3)} calls  ` +
              `${String(info.tris).padStart(7)} tris  vfov ${info.fov.toFixed(1)}  ${info.gantry}`);
};

const FIN = K.RACE_FROM + K.RACE_LEN;
const RACING = 205;
for (const d of [80, 50, 30, 18, 6]) await at(`start-${d}`, K.RACE_FROM - d, RACING);
for (const d of [80, 50, 30, 18, 6]) await at(`finish-${d}`, FIN - d, RACING);
console.log('');
for (const d of [50, 30, 18]) await at(`start-${d}-slow`, K.RACE_FROM - d, 0);
console.log('');
// Nothing in sight: the frame the gantry must not cost anything in.
await at('open-road', K.RACE_FROM + 3000, RACING);
// The grid, which is where the player actually meets the start gantry first —
// directly underneath it.
await at('on-the-line', K.RACE_FROM, 0);

// THE BANNER CANVAS ITSELF, at 1:1. A frame shows what the lettering looks
// like after perspective, minification and fog have all had a go at it; this
// shows what was drawn. When the two disagree the difference is the filtering,
// which is the thing most likely to be wrong here.
const png = await page.evaluate(() => window.RACER.gantry.banner.toDataURL('image/png'));
await writeFile(join(OUT, 'banner-canvas.png'),
                Buffer.from(png.split(',')[1], 'base64'));
console.log('\nwrote shots/banner-canvas.png (1024 x 192, as drawn)');

console.log(errors.length ? '\nERRORS: ' + errors.join(' | ') : '\nno console errors');
await browser.close();
