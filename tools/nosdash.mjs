// THE BOOST SWITCH AND THE NITROUS CONTENTS GAUGE, PHOTOGRAPHED AND MEASURED.
//
// Two pieces of dashboard replaced the nitrous bottle: a toggle switch screwed
// to the fascia under the boost lamp, and a contents gauge in the sub-dial to
// the right of the wheel. Both are drawn in ART space rather than pinned to the
// screen — that is the whole point of them, they are part of the car — which
// also means nothing about where they land can be read off PEDAL_TOP or
// PEDAL_W. So they get measured off the frame.
//
// WHAT IS MEASURED, AND HOW.
//
//   the switch    the BAT's footprint on the glass, by COLLAPSING ITS QUAD and
//                 diffing against an untouched frame — the same trick
//                 tools/pedalshots.mjs uses. The escutcheon plate has no quad
//                 (it is painted into the dash, because it never moves), so
//                 what the plate covers is measured off the atlas arithmetic's
//                 result instead: the up frame diffed against the down one is
//                 the travel, and the crops are there to be looked at.
//   under the lamp  the lamp is isolated by TURNING IT ON and diffing, which
//                 lights that lens and nothing else, and the switch's centre is
//                 compared against the lamp's. "Directly underneath and center
//                 to this light" is a claim with two halves and both are
//                 checked.
//   the gauge     the NEEDLE's TIP, at three levels. The pivot comes from the
//                 quad's own four vertices — the sprite's pivot is NDS_PIVOT of
//                 NDS_H down it, so the pivot lies that fraction along the line
//                 from the top edge's midpoint to the bottom edge's — and the
//                 tip is then the FURTHEST DIFFERENT PIXEL from that pivot, off
//                 the frame. The radius from pivot to tip must come out the
//                 same at every level, because a needle is rigid; if the pivot
//                 were wrong or the pixels were something else, it would not.
//
// NOTHING IS FOUND BY COLOUR. The needle is orange and so are the amber lamp,
// the countdown and half the city's street lighting; the switch is chrome and
// so are the wheel's spokes, the brake pedal and four other things. Collapsing
// a quad asks the renderer which pixels a part was responsible for, and cannot
// match the wrong object — which is the failure this project keeps hitting,
// most recently a working fuel meter called broken by a check that matched the
// bottle's own body.
//
// TWO THINGS THAT WOULD OTHERWISE HAVE MADE EVERY NUMBER HERE NOISE.
//
//   THE NEEDLES HAVE MASS and this container renders at two to three frames a
//   second, so a wait measured in milliseconds settles nothing: the first run
//   of this reported a 489-pixel-wide switch, because the tacho needle was
//   still drifting between the two shots of the diff pair and joined the box.
//   Needles are settled by calling update() three hundred times in a tight
//   loop instead — it is pure arithmetic on a buffer, it costs microseconds,
//   and it converges every needle to its target exactly.
//
//   MAIN.JS ALREADY CALLS update() EVERY FRAME with its own state object, so a
//   harness that called update() with a second object of its own would have the
//   two fighting — the gauge would read this tool's level on one call and
//   default back to full on the next. The level is therefore INJECTED into
//   main.js's own object by wrapping update(), which is exactly what main.js's
//   boost budget will do when it lands.
//
// AND IT PROVES IT CAN FAIL, twice: feeding the same level twice must move
// NOTHING, or every box here is measuring noise; feeding two different levels
// must move something, or the gauge is dead and this tool would not know.
//
//   node tools/nosdash.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { PNG } from 'pngjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const ROOT = __d(__d(__f(import.meta.url)));
const PAGE = 'file://' + __j(ROOT, 'docs', 'index.html');
const OUT = __j(ROOT, 'shots');
mkdirSync(OUT, { recursive: true });

// The owner's phone: a 1440x720 canvas at dpr 2.00.
const CSS_W = 720, CSS_H = 360, DPR = 2;
const DW = CSS_W * DPR, DH = CSS_H * DPR;
// The sprite's pivot, as a fraction of its own height. The one number below
// that is read out of cockpit.js rather than off the frame, and it is a
// property of the DRAWING — where the needle's spindle is painted in its cell —
// which no photograph can recover. Everything it is used for is cross-checked:
// see the equal-radius test.
const NDS_PIVOT_F = 58 / 76;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({
  viewport: { width: CSS_W, height: CSS_H }, deviceScaleFactor: DPR,
});
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });

await page.evaluate(() => {
    // GET THE LANDING PAGE OUT OF THE WAY. It is a DOM layer over the canvas,
    // so a page screenshot photographs the menu rather than the game — which
    // is exactly how it blinded two of these tools the day it shipped. Tools
    // that read the WebGL buffer with gl.readPixels never saw the problem,
    // because the menu is not in that buffer.
    if (window.RACER.menu) window.RACER.menu.close();
  const R = window.RACER;
  R.st.view = 1; R.st.speed = 0; R.st.steer = 0;
  R.tilt.on = false; R.tilt.out = 0;
  R.tune.freeze = true; R.tune.holdX = 0;
  // THE CITY GOES. Nothing measured here is outside the dashboard, and a
  // software rasteriser drawing seven thousand buildings at 1440x720 turns a
  // four-second screenshot into six. It also cannot change what the switch or
  // the gauge look like: both are opaque dash, drawn last, over everything.
  for (let i = 0; i < 40; i++) document.getElementById('bDown').click();
  window.__nos = 1;
  window.__boost = false;
  window.__realUpdate = R.cockpit.update;
  // BOTH FIELDS ARE PINNED HERE, not just the bottle. Pinning `boosting` inside
  // set() alone was not enough: the frame loop rewrites the state object every
  // frame and put its own value back before the screenshot was taken. And now
  // that the boost is refused while the car sits on the grid — which is exactly
  // where this rig holds it, so nothing moves between the two photographs — the
  // loop's value is always false. The rig duly measured a switch with a 0 px
  // throw and reported the game broken. The interception has to be the last
  // write before update() runs, which is here.
  R.cockpit.update = (s) => {
    if (s) { s.boostLeft = window.__nos; s.boosting = window.__boost; window.__state = s; }
    return window.__realUpdate(s);
  };
  const step = () => {
    R.race.state = 'grid'; R.race.t = 0; R.race.elapsed = 0;
    R.st.speed = 0; R.st.rev = 0; R.st.gear = 0; R.st.steer = 0;
    R.pedal.brake = false;
    R.pedal.boost = window.__boost;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});
await page.waitForTimeout(2500);

/** Set the state, then run the needles all the way home before rendering. */
const set = async (o) => {
  await page.evaluate((v) => {
    const R = window.RACER;
    if (v.nos != null) window.__nos = v.nos;
    if (v.boost != null) { window.__boost = v.boost; R.pedal.boost = v.boost; }
    // THREE HUNDRED UPDATES, NO FRAMES. Each needle closes a fifth to a quarter
    // of its remaining error per call, so three hundred is convergence to the
    // last bit of a float. Nothing is rendered and nothing is allocated; this
    // is the same call main.js makes, made faster than a clock can.
    const s = window.__state;
    if (s) {
      s.boostLeft = window.__nos;
      s.boosting = window.__boost;
      s.braking = false;
      for (let i = 0; i < 300; i++) window.__realUpdate(s);
    }
  }, o);
  await page.waitForTimeout(500);
};

const shoot = async () => {
  await page.waitForTimeout(200);
  return PNG.sync.read(await page.screenshot());
};

/** Every pixel that differs between two frames, and its bounding box. */
const diffPixels = (a, b, thr = 10) => {
  const px = [];
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1])
              + Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (d > thr) {
        px.push(x, y);
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null
    : { px, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, n: px.length / 2 };
};

/** Collapse one cockpit quad to zero area, take a frame, put it back. */
const withoutQuad = async (which) => {
  await page.evaluate((w) => {
    const R = window.RACER;
    const q = R.cockpit.stats.q[w];
    const p = R.cockpit.group.children[0].geometry.getAttribute('position');
    window.__saved = new Float32Array(p.array);
    for (let k = 0; k < 4; k++) {
      p.array[(q * 4 + k) * 3] = 0;
      p.array[(q * 4 + k) * 3 + 1] = 0;
    }
    p.needsUpdate = true;
  }, which);
  const png = await shoot();
  await page.evaluate(() => {
    const R = window.RACER;
    const p = R.cockpit.group.children[0].geometry.getAttribute('position');
    p.array.set(window.__saved);
    p.needsUpdate = true;
  });
  await page.waitForTimeout(200);
  return png;
};

const crop = (png, x0, y0, w, h, name, zoom = 3) => {
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

let bad = 0;
const fail = (why) => { bad++; return `   <-- ${why}`; };
console.log(`\n  MEASURED AT ${DW}x${DH} DEVICE PIXELS, by collapsing quads\n`);

// ---- the cells straight off the atlas, before the renderer touches them -----
{
  const url = await page.evaluate(() => {
    const src = window.RACER.cockpit.atlas;
    const c = document.createElement('canvas');
    c.width = 400; c.height = 220;
    const g = c.getContext('2d');
    g.fillStyle = '#202020'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, 330, 982, 150, 104, 0, 0, 300, 208);      // the two bats, 2x
    g.drawImage(src, 454, 982, 24, 80, 320, 0, 48, 160);       // the small needle, 2x
    return c.toDataURL();
  });
  writeFileSync(__j(OUT, 'nos-cells.png'), Buffer.from(url.split(',')[1], 'base64'));
}

// ---- THE SWITCH -------------------------------------------------------------
await set({ boost: false, nos: 1 });
const idle = await shoot();
writeFileSync(__j(OUT, 'nos-idle.png'), PNG.sync.write(idle));
const noBat = await withoutQuad('switch');
const batUp = diffPixels(idle, noBat, 6);

await set({ boost: true });
const boosting = await shoot();
writeFileSync(__j(OUT, 'nos-boosting.png'), PNG.sync.write(boosting));
const noBat2 = await withoutQuad('switch');
const batDown = diffPixels(boosting, noBat2, 6);
await set({ boost: false });

console.log('  THE BOOST SWITCH');
for (const [name, b] of [['bat, up', batUp], ['bat, down', batDown]]) {
  if (!b) { console.log(`  ${name.padEnd(11)} NOT DRAWN${fail('the switch is not on screen')}`); continue; }
  console.log(`  ${name.padEnd(11)} ${String(b.w).padStart(3)} x ${String(b.h).padStart(3)} px   ` +
              `box ${b.x0},${b.y0} .. ${b.x1},${b.y1}   ${b.n} px of ink`);
}
if (batUp && batDown) {
  const throwPx = ((batDown.y0 + batDown.y1) - (batUp.y0 + batUp.y1)) / 2;
  console.log(`  throw       the bat's centre drops ${throwPx.toFixed(0)} px between up and down` +
              (throwPx < 10 ? fail('the bat barely moves') : ''));
}

// ---- THE LAMP IT HANGS UNDER ------------------------------------------------
//
// The lamp is the only other thing that changes when boost comes on, so the
// two are separated by height: everything above the top of the bat's travel is
// the lamp, everything at or below it is the bat. That split is drawn from the
// measured bat box, not from a constant.
// A null here means the two frames were IDENTICAL, i.e. turning the boost on
// changed nothing on screen at all. That is a result, and the loudest one this
// tool can produce — so say it, rather than throwing a TypeError six lines
// later and taking the rest of the measurements down with it.
const bothFrames = diffPixels(idle, boosting, 6);
if (!bothFrames) {
  console.log(`\n  NOTHING ON THE DASH CHANGED when the boost came on${fail('boost is invisible')}`);
}
if (batUp && bothFrames) {
  const both = bothFrames;
  let lx0 = 1e9, lx1 = -1, ly0 = 1e9, ly1 = -1;
  for (let i = 0; i < both.px.length; i += 2) {
    const x = both.px[i], y = both.px[i + 1];
    if (y >= batUp.y0) continue;
    if (x < lx0) lx0 = x; if (x > lx1) lx1 = x;
    if (y < ly0) ly0 = y; if (y > ly1) ly1 = y;
  }
  if (lx1 < 0) console.log(`\n  THE LAMP was not found${fail('nothing above the bat changed')}`);
  else {
    const lampMid = (lx0 + lx1 + 1) / 2, batMid = (batUp.x0 + batUp.x1 + 1) / 2;
    const off = batMid - lampMid;
    const below = batUp.y0 - ly1 - 1;
    console.log(`\n  THE LAMP ABOVE IT   ${lx1 - lx0 + 1} x ${ly1 - ly0 + 1} px, ` +
                `box ${lx0},${ly0} .. ${lx1},${ly1}`);
    console.log(`  centred on it       switch centre x ${batMid.toFixed(1)}, ` +
                `lamp centre x ${lampMid.toFixed(1)}, off by ${off.toFixed(1)} px` +
                `${Math.abs(off) <= 3 ? '' : fail('NOT CENTRED ON THE LAMP')}`);
    console.log(`  directly under it   ${below} px of clear dash between them` +
                `${below > 0 && below < 90 ? '' : fail('NOT DIRECTLY UNDERNEATH')}`);
  }
  // the lamp, the plate and the bat together, up and down, at 3x
  const cx0 = batUp.x0 - 66, cw = batUp.w + 132;
  crop(idle, cx0, batUp.y0 - 96, cw, batUp.h + 150, 'nos-switch-up');
  crop(boosting, cx0, batUp.y0 - 96, cw, batUp.h + 150, 'nos-switch-down');
}

// ---- THE GAUGE --------------------------------------------------------------
console.log('\n  THE NITROUS CONTENTS GAUGE');
const reads = [];
for (const f of [1, 0.5, 0]) {
  await set({ nos: f });
  const withN = await shoot();
  const tag = String(f).replace('.', '');
  const noN = await withoutQuad('nos');
  const d = diffPixels(withN, noN, 6);
  if (!d) { console.log(`  ${(f * 100).toFixed(0).padStart(3)}%  NEEDLE NOT DRAWN${fail('WRONG')}`); continue; }
  // the pivot, from the quad's own four vertices
  const piv = await page.evaluate(({ pf, dw, dh }) => {
    const R = window.RACER;
    const q = R.cockpit.stats.q.nos;
    const a = R.cockpit.group.children[0].geometry.getAttribute('position').array;
    const P = (k) => ({ x: (a[(q * 4 + k) * 3] + 1) / 2 * dw,
                        y: (1 - a[(q * 4 + k) * 3 + 1]) / 2 * dh });
    const v = [P(0), P(1), P(2), P(3)];
    const topMid = { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2 };
    const botMid = { x: (v[2].x + v[3].x) / 2, y: (v[2].y + v[3].y) / 2 };
    return { x: topMid.x + pf * (botMid.x - topMid.x),
             y: topMid.y + pf * (botMid.y - topMid.y) };
  }, { pf: NDS_PIVOT_F, dw: DW, dh: DH });
  // the tip: the furthest CHANGED PIXEL from the pivot, off the frame
  let tip = null, best = -1;
  for (let i = 0; i < d.px.length; i += 2) {
    const x = d.px[i], y = d.px[i + 1];
    const r = (x - piv.x) ** 2 + (y - piv.y) ** 2;
    if (r > best) { best = r; tip = { x, y }; }
  }
  const rad = Math.sqrt(best);
  const ang = Math.atan2(tip.x - piv.x, -(tip.y - piv.y)) * 180 / Math.PI;
  crop(withN, d.x0 - 40, d.y0 - 40, d.w + 80, d.h + 80, `nos-gauge-${tag}`);
  reads.push({ f, d, piv, tip, rad, ang });
  console.log(`  ${(f * 100).toFixed(0).padStart(3)}%  needle ${String(d.w).padStart(3)} x ` +
              `${String(d.h).padStart(3)} px   pivot ${piv.x.toFixed(0)},${piv.y.toFixed(0)}   ` +
              `tip ${tip.x},${tip.y}   ${rad.toFixed(1)} px out at ` +
              `${ang.toFixed(0).padStart(5)} degrees`);
}
await set({ nos: 1 });

if (reads.length === 3) {
  // THE RADII MUST AGREE. A needle is rigid, so its tip is the same distance
  // from the spindle at every reading. If the pivot were wrong, or the pixels
  // being measured were something other than the needle, three readings would
  // give three radii. This is what makes the angles below trustworthy.
  const rs = reads.map((r) => r.rad);
  const spread = Math.max(...rs) - Math.min(...rs);
  console.log(`  the tip is ${spread.toFixed(1)} px from being the same distance out at all ` +
              `three readings${spread <= 4 ? '' : fail('THE PIVOT OR THE PIXELS ARE WRONG')}`);
  const aF = reads[0].ang, aH = reads[1].ang, aE = reads[2].ang;
  const sweep = aF - aE;
  console.log(`  SWEEP  empty to full   ${sweep.toFixed(0)} degrees, ` +
              `${(reads[0].rad * 2 * Math.PI * Math.abs(sweep) / 360).toFixed(0)} px of arc at the tip`);
  // The dial face is drawn with SWEEP = 2.18 radians either side: 250 degrees
  // end to end. The needle is driven by the same constant, so they must agree.
  console.log(`  against the 250 degrees the face is drawn with: ` +
              `${Math.abs(sweep - 250) < 12 ? 'agrees' : fail('DISAGREES')}`);
  console.log(`  half reads between empty and full: ` +
              `${aE < aH && aH < aF ? 'yes' : fail('NO — the gauge is wired backwards or stuck')}`);
}

// ---- PROVE IT CAN FAIL ------------------------------------------------------
{
  await set({ nos: 0.5 });
  const a = await shoot();
  await set({ nos: 0.5 });
  const b = await shoot();
  const same = diffPixels(a, b, 6);
  await set({ nos: 0.9 });
  const c = await shoot();
  const moved = diffPixels(a, c, 6);
  console.log('\n  SELF-CHECK');
  console.log(`  the same level twice   ${same ? `${same.w}x${same.h} px moved` +
    fail('THIS TOOL IS MEASURING NOISE') : 'nothing moved, correctly'}`);
  console.log(`  0.5 against 0.9        ${moved ? `${moved.w}x${moved.h} px moved, correctly`
    : 'NOTHING MOVED' + fail('THE GAUGE IS DEAD AND THIS TOOL WOULD NOT KNOW')}`);
}

if (errors.length) { console.log('\n  CONSOLE ERRORS: ' + errors.join(' | ')); bad++; }
console.log('');
await browser.close();
process.exit(bad ? 1 : 0);
