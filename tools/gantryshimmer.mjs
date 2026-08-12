// Does the banner's minification filter actually stop it crawling?
//
// THE CLAIM UNDER TEST. gantry.js sets magFilter to NearestFilter — so the
// pixel art stays hard-edged when you are underneath it — and minFilter to
// LinearMipmapLinear, on the argument that everywhere further out than about
// fifteen units the texture is being MINIFIED, and point-sampling one of
// several texels that all want the same pixel picks a different one every
// frame as the car moves. That is what shimmering is. The claim is easy to
// state, easy to believe, and easy to get backwards, so it is measured.
//
// HOW. Park the car at a distance where the banner is well into minification —
// 60 units, where the 1024-texel panel is about 230 screen pixels, four texels
// to a pixel — and creep it forward in quarter-unit steps. Quarter of a unit
// at 60 units moves the banner's edges by about half a pixel, so the picture
// SHOULD change almost imperceptibly. Capture the same fixed rectangle every
// step and take the mean absolute difference between consecutive captures.
//
// Then do it again with minFilter set to NearestFilter and nothing else
// changed. Same geometry, same motion, same everything: the only difference in
// the two numbers is the filter. If the mipmapped run is not markedly quieter
// then the argument in gantry.js is wrong and the comment should come out.
//
// WHAT WOULD MAKE THIS INSTRUMENT A LIAR, since several on this project have
// been: measuring a rectangle that does not contain the banner. The clip is
// therefore computed by PROJECTING the banner mesh's own corners through the
// camera rather than guessed, and the run prints the rectangle and the fraction
// of it that is not sky so a wrong one is visible in the output.

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { PNG } from '/root/racer/node_modules/pngjs/lib/png.js';
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

const K = await page.evaluate(() => {
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
  R.race.state = 'racing';
  R.st.gear = 4;
  R.st.speed = 205;
  return R.consts;
});

const AT = K.RACE_FROM + K.RACE_LEN - 60;   // 60 units short of the finish
const STEP = 0.25;
const N = 24;

const place = (d) => page.evaluate((dist) => {
  window.RACER.st.dist = dist;
  window.RACER.st.x = 0;
  window.RACER.st.speed = 205;
}, d);

await place(AT);
await page.waitForTimeout(1200);

// The clip, from the banner's own corners. Projected, not guessed.
const clip = await page.evaluate(() => {
  const R = window.RACER;
  const b = R.gantry.group.children.find((c) => c.material && c.material.map);
  b.updateWorldMatrix(true, false);
  const g = b.geometry.getAttribute('position');
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const v = new (Object.getPrototypeOf(R.camera.position).constructor)();
  for (let i = 0; i < g.count; i++) {
    v.set(g.getX(i), g.getY(i), g.getZ(i)).applyMatrix4(b.matrixWorld).project(R.camera);
    const px = (v.x * 0.5 + 0.5) * 1008, py = (0.5 - v.y * 0.5) * 420;
    x0 = Math.min(x0, px); x1 = Math.max(x1, px);
    y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  return { x: Math.max(0, Math.floor(x0) - 4), y: Math.max(0, Math.floor(y0) - 4),
           width: Math.ceil(x1 - x0) + 8, height: Math.ceil(y1 - y0) + 8 };
});
console.log(`banner on screen: ${clip.width} x ${clip.height} px at (${clip.x}, ${clip.y})`);
if (clip.width < 60 || clip.height < 10) {
  console.log('FAIL: the banner is not big enough on screen to measure. Wrong distance?');
  await browser.close();
  process.exit(1);
}

const setFilter = (mode) => page.evaluate((m) => {
  const T = window.RACER.gantry.texture;
  const three = { mip: 1008, nearest: 1003 };   // LinearMipmapLinearFilter, NearestFilter
  T.minFilter = three[m];
  // Without this three keeps the parameters it already set on the GL texture
  // and the "change" would be a change to a JS field and nothing else — which
  // would make both runs identical and the test a rubber stamp.
  T.needsUpdate = true;
  return T.minFilter;
}, mode);

const run = async (mode) => {
  const got = await setFilter(mode);
  const shots = [];
  for (let i = 0; i < N; i++) {
    await place(AT + i * STEP);
    await page.waitForTimeout(220);
    const buf = await page.screenshot({ clip });
    shots.push(PNG.sync.read(buf));
  }
  let sum = 0, n = 0, worst = 0;
  for (let i = 1; i < shots.length; i++) {
    const a = shots[i - 1].data, b = shots[i].data;
    let s = 0, c = 0;
    for (let p = 0; p < a.length; p += 4) {
      s += Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]);
      c += 3;
    }
    const mean = s / c;
    sum += mean; n++;
    if (mean > worst) worst = mean;
  }
  // How much of the clip is actually the banner rather than sky: if this is
  // tiny the rectangle is in the wrong place and the numbers are noise.
  const first = shots[0].data;
  let bright = 0, tot = 0;
  for (let p = 0; p < first.length; p += 4) { if (first[p] > 120) bright++; tot++; }
  return { filter: got, mean: sum / n, worst, coverage: bright / tot };
};

const mip = await run('mip');
const nearest = await run('nearest');
await setFilter('mip');

console.log(`\n  clip coverage (pixels brighter than 120, i.e. the cream panel): ` +
            `${(mip.coverage * 100).toFixed(0)}%`);
console.log(`\n  minFilter LinearMipmapLinear (${mip.filter})   ` +
            `mean frame-to-frame change ${mip.mean.toFixed(2)} / 255, worst ${mip.worst.toFixed(2)}`);
console.log(`  minFilter Nearest            (${nearest.filter})   ` +
            `mean frame-to-frame change ${nearest.mean.toFixed(2)} / 255, worst ${nearest.worst.toFixed(2)}`);

const ratio = nearest.mean / mip.mean;
console.log(`\n  point sampling is ${ratio.toFixed(2)}x noisier under the same motion`);
const pass = mip.coverage > 0.15 && ratio > 1.25;
console.log(pass
  ? '\n  ok   mipmapped minification is measurably quieter — the filter choice is earned'
  : '\n FAIL  no measurable difference; the claim in gantry.js is not supported');

await browser.close();
process.exit(pass ? 0 : 1);
