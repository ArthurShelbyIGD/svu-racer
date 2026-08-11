// LOOK AT THE BRAKE PEDAL, IN BOTH STATES, AND MEASURE IT ON THE GLASS.
//
// The brake pedal is drawn into the cockpit atlas and pinned to the screen from
// PEDAL_TOP and PEDAL_W — the same two numbers the touch test uses. This
// photographs it at the owner's phone resolution (1440x720 device pixels: a
// 720x360 CSS viewport at dpr 2) and then MEASURES what landed, rather than
// trusting the arithmetic that placed it.
//
// THERE WAS A NITROUS BOTTLE IN THE OTHER CORNER AND THIS MEASURED THAT TOO.
// It has gone: a bottle is cargo and can only ever sit on top of a dashboard,
// so the boost hint is now a toggle switch built into the fascia and the level
// it used to show is a proper gauge in the sub-dial. Neither is screen-pinned,
// so neither belongs in a tool about the touch corners — both are measured by
// tools/nosdash.mjs instead. BOOST IS STILL A TOUCH ANYWHERE IN THE
// BOTTOM-RIGHT REGION, unchanged; tools/controls.mjs is what proves that, and
// it always was.
//
// HOW THE MEASUREMENT WORKS. The frame is rendered twice: once as it ships, and
// once with the pedal's quad collapsed to zero area. Every pixel that differs
// between the two IS the pedal, so the bounding box of the difference is its
// true on-screen footprint in device pixels. Nothing is derived from the
// constants that placed it — if the placement is wrong, the box is wrong, and
// the box is what gets printed.
//
//   node tools/pedalshots.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { PNG } from 'pngjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ROOT = __d(__d(__f(import.meta.url)));
const PAGE = 'file://' + __j(ROOT, 'docs', 'index.html');
const OUT = __j(ROOT, 'shots');
mkdirSync(OUT, { recursive: true });

// The owner's phone: a 1440x720 canvas at dpr 2.00.
const CSS_W = 720, CSS_H = 360, DPR = 2;
const DW = CSS_W * DPR, DH = CSS_H * DPR;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({
  viewport: { width: CSS_W, height: CSS_H }, deviceScaleFactor: DPR,
});
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });

// First person, car sitting still on the grid so the picture is the same in
// every shot and only the control changes.
await page.evaluate(() => {
  const R = window.RACER;
  R.st.view = 1;
  R.st.speed = 0;
  R.tilt.on = false;
});
await page.waitForTimeout(1200);

const info = await page.evaluate(() => ({
  calls: window.RACER.renderer.info.render.calls,
  tris: window.RACER.renderer.info.render.triangles,
  cockpit: window.RACER.cockpit.stats,
}));
console.log(`\n  whole scene   ${info.calls} draw calls, ${info.tris} triangles`);
console.log(`  cockpit       ${info.cockpit.calls} draw call, ${info.cockpit.tris} triangles, ` +
            `${info.cockpit.verts} vertices`);

// ---- the cells themselves, straight off the atlas --------------------------
// The drawing, before the renderer has had anything to do with it. If a control
// looks wrong on the glass this says whether it was drawn wrong or placed wrong.
{
  const url = await page.evaluate(() => {
    const src = window.RACER.cockpit.atlas;
    const c = document.createElement('canvas');
    c.width = 700; c.height = 208;
    const g = c.getContext('2d');
    g.fillStyle = '#202020'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 980, 700, 208, 0, 0, 700, 208);
    return c.toDataURL();
  });
  writeFileSync(__j(OUT, 'pedal-cells.png'), Buffer.from(url.split(',')[1], 'base64'));
}

const shot = async (name, state) => {
  await page.evaluate((s) => {
    const R = window.RACER;
    R.pedal.brake = !!s.brake;
    R.pedal.boost = !!s.boost;
  }, state);
  await page.waitForTimeout(450);
  const buf = await page.screenshot();
  writeFileSync(__j(OUT, name + '.png'), buf);
  return PNG.sync.read(buf);
};

/**
 * A crop, written out at 2x so the ink weights can be read by eye.
 *
 * EVERY ARGUMENT IS ROUNDED HERE AND NOT AT THE CALL SITE. The first version
 * trusted the caller, was handed 0.34 of 1440 for the right-hand crop, indexed
 * the pixel array at a fractional offset and wrote a PERFECTLY BLACK PNG — a
 * measuring instrument that reported nothing and looked like a bug in the
 * renderer. That is the tenth broken instrument on this project; this is where
 * it gets rounded.
 */
const crop = (png, x0, y0, w, h, name, zoom = 2) => {
  x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
  w = Math.min(Math.round(w), png.width - x0);
  h = Math.min(Math.round(h), png.height - y0);
  const out = new PNG({ width: w * zoom, height: h * zoom });
  for (let y = 0; y < h * zoom; y++) {
    for (let x = 0; x < w * zoom; x++) {
      const sx = x0 + ((x / zoom) | 0), sy = y0 + ((y / zoom) | 0);
      const si = (sy * png.width + sx) * 4, di = (y * out.width + x) * 4;
      out.data[di] = png.data[si]; out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2]; out.data[di + 3] = 255;
    }
  }
  writeFileSync(__j(OUT, name + '.png'), PNG.sync.write(out));
};

/** Bounding box of the pixels that differ between two frames. */
const diffBox = (a, b, thr = 10) => {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1])
              + Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (d > thr) {
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, n };
};

// ---- the four pictures -----------------------------------------------------
const idle = await shot('pedal-idle', {});
const onBrake = await shot('pedal-brake', { brake: true });
const onBoost = await shot('pedal-boost', { boost: true });

// bottom-left and bottom-right quarters, at 2x
crop(idle, 0, DH * 0.5, DW * 0.34, DH * 0.5, 'pedal-brake-off-crop');
crop(onBrake, 0, DH * 0.5, DW * 0.34, DH * 0.5, 'pedal-brake-on-crop');
crop(idle, DW - DW * 0.34, DH * 0.5, DW * 0.34, DH * 0.5, 'pedal-boost-off-crop');
crop(onBoost, DW - DW * 0.34, DH * 0.5, DW * 0.34, DH * 0.5, 'pedal-boost-on-crop');

// ---- what moved when each control was pressed ------------------------------
const bBrake = diffBox(idle, onBrake);
const bBoost = diffBox(idle, onBoost);
console.log('\n  WHAT CHANGES WHEN IT IS PRESSED (device pixels)');
for (const [name, b] of [['brake', bBrake], ['boost', bBoost]]) {
  console.log(`  ${name.padEnd(6)} ${b ? `${b.w}x${b.h} at ${b.x0},${b.y0}   ${b.n} pixels changed`
                                      : 'NOTHING CHANGED  <-- the press does not show'}`);
}

// ---- how big each control is, measured against a frame without it ----------
await page.evaluate(() => { window.RACER.pedal.brake = false; window.RACER.pedal.boost = false; });
await page.waitForTimeout(300);
const before = PNG.sync.read(await page.screenshot());

const boxes = {};
for (const which of ['pedal']) {
  await page.evaluate((w) => {
    // Collapse ONE control quad to zero area, leaving everything else alone.
    const R = window.RACER;
    const q = R.cockpit.stats.q[w];
    const g = R.cockpit.group.children[0].geometry;
    const p = g.getAttribute('position');
    if (!window.__saved) window.__saved = new Float32Array(p.array);
    for (let k = 0; k < 4; k++) {
      p.array[(q * 4 + k) * 3] = 0;
      p.array[(q * 4 + k) * 3 + 1] = 0;
    }
    p.needsUpdate = true;
  }, which);
  await page.waitForTimeout(300);
  const after = PNG.sync.read(await page.screenshot());
  boxes[which] = diffBox(before, after, 6);
  await page.evaluate(() => {
    const R = window.RACER;
    const g = R.cockpit.group.children[0].geometry;
    const p = g.getAttribute('position');
    p.array.set(window.__saved);
    p.needsUpdate = true;
  });
  await page.waitForTimeout(200);
}

console.log(`\n  ON-SCREEN SIZE at ${DW}x${DH} device pixels, measured by collapsing each quad`);
for (const k of Object.keys(boxes)) {
  const b = boxes[k];
  console.log(`  ${k.padEnd(7)} ${b ? `${String(b.w).padStart(4)} x ${String(b.h).padStart(3)} px` +
    `   box ${b.x0},${b.y0} .. ${b.x1},${b.y1}` +
    `   ${(b.x0 / DW * 100).toFixed(1)}%..${((b.x1 + 1) / DW * 100).toFixed(1)}% across,` +
    ` ${(b.y0 / DH * 100).toFixed(1)}%..${((b.y1 + 1) / DH * 100).toFixed(1)}% down`
    : 'NOT DRAWN'}`);
}

// ---- does the standing note run across either control? ---------------------
//
// It used to. The line along the bottom of the screen is 96 characters in the
// build this replaces, which is 1382 of 1440 device pixels centred, and it went
// straight through both corners. Measured off the real text node rather than
// counted off the source, because what matters is what the font did.
{
  const n = await page.evaluate((dpr) => {
    const el = document.getElementById('note');
    const r = document.createRange();
    r.selectNodeContents(el);
    const b = r.getBoundingClientRect();
    return { x0: b.left * dpr, x1: b.right * dpr, y0: b.top * dpr, text: el.textContent.length };
  }, DPR);
  const clearL = boxes.pedal ? n.x0 - boxes.pedal.x1 : 0;
  const clearR = 1;      // nothing of this file's is in the right-hand corner now
  console.log(`\n  THE STANDING NOTE: ${n.text} characters, ` +
              `x ${n.x0.toFixed(0)}..${n.x1.toFixed(0)}, top ${n.y0.toFixed(0)}`);
  console.log(`  clear of the pedal by ${clearL.toFixed(0)} px` +
              (clearL > 0 ? '' : '   <-- IT CROSSES THE PEDAL'));
}

// ---- and does the art stay inside the touch region it is hinting at? -------
const reg = await page.evaluate(() => ({ top: window.RACER.consts.PEDAL_TOP,
                                         w: window.RACER.consts.PEDAL_W }));
console.log(`\n  THE REGION IT HINTS AT: x 0..${(reg.w * 100).toFixed(0)}% and ` +
            `${((1 - reg.w) * 100).toFixed(0)}%..100%, y ${(reg.top * 100).toFixed(0)}%..100%`);
let bad = 0;
const inside = (b, left) => {
  if (!b) return false;
  const x0 = b.x0 / DW, x1 = (b.x1 + 1) / DW, y0 = b.y0 / DH;
  return y0 >= reg.top && (left ? x1 <= reg.w : x0 >= 1 - reg.w);
};
for (const [k, left] of [['pedal', true]]) {
  const ok = inside(boxes[k], left);
  if (!ok) bad++;
  console.log(`  ${k.padEnd(7)} ${ok ? 'inside the region' : 'OUTSIDE THE REGION  <-- WRONG'}`);
}

await page.close();

// ---- A DIFFERENT SHAPED SCREEN, because the art is screen-pinned and the
// dashboard behind it is not. At 16:9 the cockpit art is cropped 13% each side
// while the touch region is unchanged, so this is the shape that would catch a
// control that had been positioned in art space by mistake.
for (const s of [{ w: 800, h: 450, name: '16:9' }, { w: 512, h: 300, name: '1.7:1, small' }]) {
  const p2 = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
  await p2.goto(PAGE, { waitUntil: 'load' });
  await p2.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  await p2.evaluate(() => { window.RACER.st.view = 1; window.RACER.renderer.setPixelRatio(1); });
  await p2.waitForTimeout(900);
  const r = await p2.evaluate(() => {
    // the control rectangles as the mesh actually holds them, converted back
    // from normalised device coordinates to fractions of the viewport
    const R = window.RACER;
    const g = R.cockpit.group.children[0].geometry.getAttribute('position');
    const out = {};
    for (const k of ['pedal']) {
      const q = R.cockpit.stats.q[k];
      const x0 = g.array[q * 12], y0 = g.array[q * 12 + 1];
      const x1 = g.array[q * 12 + 3], y1 = g.array[q * 12 + 7];
      out[k] = { fx0: (x0 + 1) / 2, fx1: (x1 + 1) / 2, fy0: (1 - y0) / 2, fy1: (1 - y1) / 2 };
    }
    out.reg = { top: R.consts.PEDAL_TOP, w: R.consts.PEDAL_W };
    out.vp = [window.innerWidth, window.innerHeight];
    return out;
  });
  await p2.screenshot({ path: __j(OUT, `pedal-aspect-${s.w}x${s.h}.png`) });
  const pxa = (b) => `${((b.fx1 - b.fx0) * s.w).toFixed(0)}x${((b.fy1 - b.fy0) * s.h).toFixed(0)}`;
  const ok = r.pedal.fx1 <= r.reg.w && r.pedal.fy0 >= r.reg.top;
  if (!ok) bad++;
  console.log(`\n  ${s.name.padEnd(13)} ${s.w}x${s.h}   pedal ${pxa(r.pedal)} px` +
              `   ${ok ? 'inside the region' : 'OUT OF THE REGION  <-- WRONG'}`);
  console.log(`                 pedal x ${(r.pedal.fx0 * 100).toFixed(1)}..${(r.pedal.fx1 * 100).toFixed(1)}%,` +
              ` y ${(r.pedal.fy0 * 100).toFixed(1)}..${(r.pedal.fy1 * 100).toFixed(1)}%`);
  await p2.close();
}

await browser.close();
console.log('');
process.exit(bad ? 1 : 0);
