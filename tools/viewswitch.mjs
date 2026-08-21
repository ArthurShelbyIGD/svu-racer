// DOES THE CHASE CAMERA ROW ACTUALLY DO ANYTHING?
//
// This project has already shipped one Settings switch that changed a flag and
// nothing else — TILT STEERING, which set `tilt.enabled` and never called
// `askTilt()`, so the single most important control in the game could not be
// turned on by the one action every player tries. It was found by Anthony's
// daughter's iPhone, not by a harness, and it nearly ended the project:
// "so unless something is wrong with the code there is little point in moving
// forward with the game."
//
// So a new switch gets a harness on the day it goes in, and the harness asserts
// the CONSEQUENCE rather than the flag. A flag is what the switch obviously
// sets; the consequence is what the player came for. Here that is four things:
//
//   1. the game starts in the driver's seat, which is where every lap time on
//      record was set
//   2. tapping the row puts the camera behind the car — proved by the FRAME
//      CHANGING, not by reading st.view back
//   3. the choice survives a reload, because reloading is the most common
//      thing a tester does
//   4. tapping it again comes back, and that persists too — a setting you can
//      only turn on is a trap
//
// THE NEGATIVE CONTROL IS THE POINT OF STEP 2. Rendering a frame, doing
// nothing, and rendering again must produce an identical image; if it does not,
// then "the frame changed" proves nothing about the camera. The scene is not
// still even when the car is frozen — the wake, the pedals and the neon all
// keep moving — so the control is measured rather than assumed, and the switch
// has to beat it by a wide margin.
//
//   node tools/viewswitch.mjs

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';

const __ROOT = __d(__d(__f(import.meta.url)));
const PAGE = 'file://' + __j(__ROOT, 'docs', 'index.html');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

let bad = 0;
const ok = (cond, name, detail) => {
  if (!cond) bad++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}   ${name}${detail ? '   ' + detail : ''}`);
};

/** Load, dismiss the menu layer, and settle on a repeatable pose. */
async function load() {
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  await page.evaluate(async () => {
    const R = window.RACER;
    R.menu.close();
    // #gears STAYS UP: it holds the button under test, and hiding it measured
    // a 0x0 rectangle and called the control too small to press. The frames
    // below come off the WebGL buffer, which no DOM layer appears in, so
    // leaving it visible costs the comparison nothing.
    for (const id of ['hud', 'note', 'ctl']) {
      const e = document.getElementById(id);
      if (e) e.style.display = 'none';
    }
    R.st.dist = 600; R.st.x = 0; R.st.steer = 0; R.st.slope = 0;
    R.tune.maxSpeed = 210; R.st.speed = 170; R.tune.freeze = true;
    const f = () => new Promise((r) => requestAnimationFrame(() => r()));
    for (let i = 0; i < 6; i++) await f();
  });
}

/** A frame off the WebGL buffer, as raw bytes. */
const frame = () => page.evaluate(async () => {
  const R = window.RACER;
  const gl = R.renderer.getContext();
  const w = R.renderer.domElement.width, h = R.renderer.domElement.height;
  const buf = new Uint8Array(w * h * 4);
  const f = () => new Promise((r) => requestAnimationFrame(() => r()));
  await f(); await f();
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let s = 0;
  const out = [];
  for (let i = 0; i < buf.length; i += 4) out.push(buf[i], buf[i + 1], buf[i + 2]);
  return out;
});

const differs = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) n++;
  }
  return 100 * n / (a.length / 3);
};

/**
 * Tap the button the way a player does: on the glass, mid-race.
 *
 * IT MOVED OUT OF SETTINGS. This harness used to reach into the Settings panel
 * for `.sSw[data-k="chase"]`; the control is now #gView, one of the four
 * buttons on the track, because Anthony found that a view you might want for a
 * single corner is not something you pause and go three screens deep for.
 * A harness that keeps testing the old location passes while the thing the
 * player actually touches goes untested.
 */
const tapChase = () => page.evaluate(() => {
  const b = document.getElementById('gView');
  if (!b) return 'no such button';
  b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return b.textContent.trim();
});

console.log('\nCHASE CAMERA — the Settings row, and what it actually does\n');

await load();
const onGlass = await page.evaluate(() => {
  const b = document.getElementById('gView');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), label: b.textContent.trim() };
});
ok(!!onGlass, 'the button is on the track, not in a menu');
// A CONTROL YOU PRESS MID-CORNER HAS TO BE HITTABLE. 44px is the floor every
// platform's guidance settles on and the gear buttons already meet it.
ok(!!onGlass && onGlass.w >= 44 && onGlass.h >= 44, 'and it is big enough to hit',
  onGlass ? `${onGlass.w}x${onGlass.h}px, reads "${onGlass.label}"` : '');
ok(!!onGlass && onGlass.label === 'VIEW', 'and it is labelled VIEW',
  onGlass ? `"${onGlass.label}"` : '');

// THE PANEL'S SHAPE, ASSERTED, because it broke silently the first time.
//
// Anthony asked for "two rows of two buttons. Gear up and down side by side,
// centre and view side by side." Making that happen is one `display: grid` in
// a stylesheet — and the edit that added it landed a paragraph of prose OUTSIDE
// the comment above it, which took the whole rule with it. The buttons then
// laid themselves out as plain inline blocks in a row across the top-left
// corner of the screen, over the road, and the page threw no error and logged
// nothing. A stylesheet cannot fail loudly; only a measurement can.
const panel = await page.evaluate(() => {
  const g = document.getElementById('gears');
  if (!g) return null;
  const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const kids = [...g.children].map((k) => {
    const r = k.getBoundingClientRect();
    return { id: k.id, x: Math.round(r.x), y: Math.round(r.y),
             w: Math.round(r.width), h: Math.round(r.height) };
  });
  const r = g.getBoundingClientRect();
  return { kids, vw, vh, box: { x: r.x, y: r.y, w: r.width, h: r.height } };
});
if (!panel) ok(false, 'the control panel exists');
else {
  const rows = [...new Set(panel.kids.map((k) => k.y))].sort((a, b) => a - b);
  const cols = [...new Set(panel.kids.map((k) => k.x))].sort((a, b) => a - b);
  ok(rows.length === 2 && cols.length === 2, 'the controls are two rows of two',
    `${rows.length} rows, ${cols.length} columns: ` + panel.kids.map((k) => k.id).join(' '));
  const row = (y) => panel.kids.filter((k) => k.y === y).sort((a, b) => a.x - b.x).map((k) => k.id);
  // MINUS LEFT, PLUS RIGHT, and the order is asserted rather than just the
  // pairing. Anthony had them the other way round for an evening and asked for
  // the swap — "+ should be on the right and - on the left" — which is the way
  // every volume slider and dial on the phone already runs. An assertion that
  // only checked "the gears are on the top row" would pass just as happily
  // with them back to front, which is the state he asked to leave.
  ok(rows.length === 2 && row(rows[0]).join(',') === 'gDown,gUp',
    'the gears share the top row, minus on the left',
    rows.length === 2 ? row(rows[0]).join(', ') : '');
  ok(rows.length === 2 && row(rows[1]).join(',') === 'gZero,gView',
    'centre and view share the one below', rows.length === 2 ? row(rows[1]).join(', ') : '');
  // ON THE SCREEN, ALL OF IT. The panel is positioned from the visual viewport,
  // and this is the check that would have caught the layout bug that outlived
  // four attempts at the menu: a control that is off the edge on a device
  // nobody here owns.
  const inside = panel.box.x >= 0 && panel.box.y >= 0
    && panel.box.x + panel.box.w <= panel.vw + 1
    && panel.box.y + panel.box.h <= panel.vh + 1;
  ok(inside, 'the whole panel is inside the viewport',
    `${Math.round(panel.box.x)},${Math.round(panel.box.y)} ` +
    `${Math.round(panel.box.w)}x${Math.round(panel.box.h)} of ${panel.vw}x${panel.vh}`);
  // AND NOT ON TOP OF THE ROAD YOU ARE STEERING INTO. A fifth of the width is
  // the most a control panel may cover; two columns of buttons on a small
  // phone is exactly the change that could cross that line without anyone
  // noticing until a tester says the corner came out of nowhere.
  ok(panel.box.w <= panel.vw * 0.22, 'and it covers no more than a fifth of the width',
    `${(100 * panel.box.w / panel.vw).toFixed(0)}%`);
}

const startView = await page.evaluate(() => window.RACER.st.view);
ok(startView === 1, 'a fresh load starts in the driver\'s seat', `view ${startView}`);

// --- the negative control, first, so the threshold is earned ---------------
const a1 = await frame();
const a2 = await frame();
const still = differs(a1, a2);
ok(still < 2, 'NEGATIVE CONTROL: two frames with nothing touched are the same',
  `${still.toFixed(2)}% of pixels move on their own`);

const label = await tapChase();
const chaseView = await page.evaluate(() => window.RACER.st.view);
const b1 = await frame();
const moved = differs(a2, b1);
ok(chaseView === 3, 'the button switches the view', `view ${chaseView}`);
// AND THE LABEL HOLDS STILL. It used to rewrite itself to CHASE, and a caption
// that changes under the thumb is one the player has to re-read mid-corner —
// for a fact, which camera they are in, that the screen is already shouting.
ok(label === 'VIEW', 'and its label does not change under the thumb', `reads "${label}"`);
ok(moved > still * 10 && moved > 20, 'and the CAMERA moves, not just the flag',
  `${moved.toFixed(1)}% of the frame changed, against ${still.toFixed(2)}% for doing nothing`);

// --- does it survive a reload ----------------------------------------------
await load();
const afterReload = await page.evaluate(() => window.RACER.st.view);
ok(afterReload === 3, 'the choice survives a reload', `view ${afterReload}`);

// --- and back again ---------------------------------------------------------
await tapChase();
const backView = await page.evaluate(() => window.RACER.st.view);
ok(backView === 1, 'tapping again returns to the driver\'s seat', `view ${backView}`);
await load();
const backAfterReload = await page.evaluate(() => window.RACER.st.view);
ok(backAfterReload === 1, 'and THAT survives a reload too', `view ${backAfterReload}`);

// A setting that only sticks in one direction is worse than one that never
// sticks: the player turns it off, reloads, and it is on again.

console.log(`\n  page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
console.log(bad ? `\n  ${bad} failed\n` : '\n  all checks passed\n');
await browser.close();
process.exit(bad ? 1 : 0);
