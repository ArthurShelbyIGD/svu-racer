// IS IT THE CAR OR IS IT THE CAMERA?
//
// Anthony, on the chase view: "the car doesn't resemble the no background image
// at all... The bonnet/hood is visible in game, it's not in the image. The car
// looks long and thin instead of wide and muscle bound."
//
// The reference is shot from low and level, dead astern. Our chase camera sits
// at y=5.2 eleven units back, which looks DOWN at the car by about 22 degrees —
// and looking down at a car foreshortens its height while showing you its whole
// length, which is exactly "long and thin instead of wide". Worse, the
// silhouette harness scores at about 6 degrees, so the number that said 93%
// was grading a pose nobody plays from.
//
// This renders the REAL GAME CAMERA at a ladder of heights, crops each to the
// car, scales every crop so the car is the same width as the car in the
// drawing, and stacks the drawing underneath. Same car, same size, one image:
// whatever is left is shape rather than framing.
//
//   node tools/camtest.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));
const PAGE = 'file://' + __j(ROOT, 'docs', 'index.html');

const HEIGHTS = [
  { camY: 1.9, camZ: 9.5,  aimY: 1.5 },
  { camY: 2.5, camZ: 10.0, aimY: 1.7 },
  { camY: 3.2, camZ: 10.5, aimY: 1.9 },
  { camY: 4.2, camZ: 11.0, aimY: 2.1 },
  { camY: 5.2, camZ: 11.0, aimY: 2.2 },   // what ships today
];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  for (const id of ['hud', 'note', 'ctl']) {
    const e = document.getElementById(id); if (e) e.style.display = 'none';
  }
  const R = window.RACER;
  R.tune.freeze = true; R.st.speed = 0; R.st.steer = 0; R.st.slope = 0;
  R.st.view = 3; R.st.dist = 300;         // a flat, straight stretch
});

/** Render at one camera and return the frame plus the car's bounding box. */
async function shot(cam) {
  return await page.evaluate(async (cam) => {
    const R = window.RACER;
    const gl = R.renderer.getContext();
    const w = R.renderer.domElement.width, h = R.renderer.domElement.height;
    const A = new Uint8Array(w * h * 4), B = new Uint8Array(w * h * 4);
    const f = () => new Promise((r) => requestAnimationFrame(() => r()));
    Object.assign(R.tune, cam);
    await f(); await f(); await f();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, A);
    // The car is whatever disappears when the body is hidden — the same
    // isolation the silhouette harness uses, and it has a null test.
    R.tune.showBody = false;
    await f(); await f();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, B);
    R.tune.showBody = true;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = ((h - 1 - y) * w + x) * 4;      // readPixels is bottom-up
      if (Math.abs(A[i] - B[i]) > 2 || Math.abs(A[i+1] - B[i+1]) > 2 ||
          Math.abs(A[i+2] - B[i+2]) > 2) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return { px: Array.from(A), w, h, x0, y0, x1, y1 };
  }, cam);
}

/** Reference, cropped to its own car. */
const ref = PNG.sync.read(readFileSync(__j(ROOT, 'ref', 'rear-nobg-crop.png')));
const REF_W = ref.width, REF_H = ref.height;

const panels = [];
for (const cam of HEIGHTS) {
  const s = await shot(cam);
  const cw = s.x1 - s.x0 + 1, ch = s.y1 - s.y0 + 1;
  const scale = REF_W / cw;                    // same car width as the drawing
  const ow = REF_W, oh = Math.round(ch * scale);
  const out = new PNG({ width: ow, height: oh });
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const sx = s.x0 + Math.min(cw - 1, Math.floor(x / scale));
    const sy = s.y0 + Math.min(ch - 1, Math.floor(y / scale));
    const i = ((s.h - 1 - sy) * s.w + sx) * 4, d = (y * ow + x) * 4;
    out.data[d] = s.px[i]; out.data[d+1] = s.px[i+1]; out.data[d+2] = s.px[i+2]; out.data[d+3] = 255;
  }
  const deg = (180 / Math.PI) * Math.atan((cam.camY - 0.95) / cam.camZ);
  panels.push({ png: out, label: `camY ${cam.camY}  ${deg.toFixed(0)}deg`, deg, cam,
                aspect: cw / ch });
  console.log(`  camY ${String(cam.camY).padStart(4)}  looks down ${deg.toFixed(0).padStart(2)}deg` +
              `   car ${cw}x${ch} px, aspect ${(cw / ch).toFixed(2)}`);
}
console.log(`  the drawing                    car ${REF_W}x${REF_H} px, aspect ${(REF_W / REF_H).toFixed(2)}`);

// Stack: every camera across the top row, the drawing directly underneath each.
const GAP = 8;
const rowH = Math.max(...panels.map((p) => p.png.height));
const W = panels.length * REF_W + (panels.length + 1) * GAP;
const H = GAP + rowH + GAP + REF_H + GAP;
const sheet = new PNG({ width: W, height: H });
sheet.data.fill(255);
const blit = (src, dx, dy) => {
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const s = (y * src.width + x) * 4, d = ((y + dy) * W + (x + dx)) * 4;
    const a = src.data[s + 3] / 255;
    sheet.data[d]   = Math.round(src.data[s]   * a + 255 * (1 - a));
    sheet.data[d+1] = Math.round(src.data[s+1] * a + 255 * (1 - a));
    sheet.data[d+2] = Math.round(src.data[s+2] * a + 255 * (1 - a));
    sheet.data[d+3] = 255;
  }
};
panels.forEach((p, i) => {
  const dx = GAP + i * (REF_W + GAP);
  blit(p.png, dx, GAP + (rowH - p.png.height));
  blit(ref, dx, GAP + rowH + GAP);
});
writeFileSync(__j(ROOT, 'shots', 'camtest.png'), PNG.sync.write(sheet));
console.log('\n  wrote shots/camtest.png — game on top, the drawing underneath each\n');
await browser.close();
