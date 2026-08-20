// How much of the car is ink?
//
// The reference Anthony supplied measures 37-39% of the drawn car as solid
// black line (39.3% front three-quarter, 36.6% rear). That is the target, and
// it is a number rather than an opinion — which matters, because "bold enough"
// is exactly the sort of judgement that has been wrong on this project every
// time it has been made by looking.
//
// HOW THE CAR IS ISOLATED. Not by rendering it against a flat backdrop with a
// special camera — the frame loop owns the camera and would fight us for it.
// Instead the same frame is rendered twice, once with the car visible and once
// without, and the pixels that CHANGED are the car. That works from the real
// gameplay camera, at the real size the player sees, which is the only size
// worth grading.
//
//   node tools/inkmeter.mjs          third person
//   node tools/inkmeter.mjs 1        first person

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
// THE HARNESS MUST MEASURE THE BUILD NEXT TO IT, not a fixed path. These tools
// hard-coded /root/racer, so an agent working in a git worktree would have
// photographed master's car and graded its own work by someone else's frame.
const __ROOT = __d(__d(__f(import.meta.url)));
// WHICH CANDIDATE. `node tools/inkmeter.mjs 3 d` measures the car body-d.js
// builds; with no letter it measures whatever the registry ships. Rival cars
// are only comparable if every instrument can be pointed at each of them.
const VIEW = Number(process.argv[2] || 3);
const BODY = process.argv[3] || '';
const PAGE = 'file://' + __j(__ROOT, 'docs', 'index.html') + (BODY ? '?body=' + BODY : '');
const SHOTS = __j(__ROOT, 'shots');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1008, height: 420 } });
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForTimeout(1800);
await page.evaluate(() => {
  for (const id of ['hud', 'note', 'ctl']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
});

const r = await page.evaluate(async (view) => {
  const R = window.RACER;
  const gl = R.renderer.getContext();
  const w = R.renderer.domElement.width, h = R.renderer.domElement.height;
  const A = new Uint8Array(w * h * 4);
  const B = new Uint8Array(w * h * 4);
  const frame = () => new Promise((res) => requestAnimationFrame(() => res()));

  // Find the flattest straight so the measurement is repeatable.
  const t = R.track, SEG = R.consts.SEG_LEN;
  let seg = 0, bs = 1e9;
  for (let i = 100; i < t.n - 300; i += 5) {
    let s = 0;
    for (let k = 0; k < 160; k++) {
      const j = (i + k) % t.n;
      s += Math.abs(t.curve[j]) + Math.abs(t.hill[j] - t.hill[i]) * 0.002;
    }
    if (s < bs) { bs = s; seg = i; }
  }

  // FROZEN AT A REALISTIC SPEED. Two earlier versions of this were wrong.
  // Leaving the car driving meant the road moved between the two captures, so
  // the diff was the whole frame rather than the car. Setting the speed to zero
  // froze it but changed the field of view and dropped the dashboard off the
  // bottom of the screen — measuring a pose the player never sees. tune.freeze
  // holds distance still while leaving speed, and therefore framing, alone.
  const pose = () => {
    R.st.view = view; R.st.dist = seg * SEG; R.st.x = 0;
    R.tune.maxSpeed = 210; R.st.speed = 170; R.tune.freeze = true;
    R.tilt.on = true; R.tilt.out = 0; R.st.steer = 0; R.st.slope = 0;
  };

  // The flag to toggle. NOT `.visible` — the frame loop rewrites that every
  // frame, so an external change lasts one frame and the diff comes out empty.
  const key = view === 3 ? 'showBody' : 'showCockpit';

  pose(); await frame(); pose(); await frame(); await frame();
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, A);

  // WHICH PIXELS ARE CAR — NOT BY ASKING WHAT CHANGED.
  //
  // This used to render the frame again with the body hidden and call every
  // changed pixel car. It is the obvious method and it has a hole in it: a car
  // pixel the same colour as whatever is behind it does not change, so it is
  // not counted. The rear screen of the car this was written against is
  // (48,61,92) and the twilight sky behind it is within a dozen of that —
  // three thousand pixels of car, missing from the denominator of a fraction.
  // A car could improve its ink score by being the colour of the sky.
  //
  // Instead: render the car ALONE, from this same camera and pose, against two
  // deliberately absurd backgrounds, and take the union. A pixel that matches
  // magenta and also matches dark green is not a pixel. The colours are only
  // used to find the mask; the ink is still counted off the real frame A, so
  // what is graded is what the player sees.
  const solo = async (colour) => {
    R.tune.solo = colour;
    pose(); await frame(); pose(); await frame(); await frame();
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    R.tune.solo = null;
    return buf;
  };
  const S1 = await solo(0xff00ff), S2 = await solo(0x003300);
  const near = (buf, i, r, g, b) => Math.abs(buf[i] - r) + Math.abs(buf[i + 1] - g)
                                  + Math.abs(buf[i + 2] - b) < 12;
  // The old method, kept only so the report can say how much it was losing.
  R.tune[key] = false;
  pose(); await frame(); pose(); await frame(); await frame();
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, B);
  R.tune[key] = true;

  // A PICTURE OF THE DISAGREEMENT, because a denominator that jumps by half
  // is a claim that has to be looked at and not just printed.
  const map = new Array(w * h).fill(0);
  let drawn = 0, ink = 0, missedByDiff = 0;
  const colHit = new Int32Array(w), rowHit = new Int32Array(h);
  for (let i = 0, p = 0; i < A.length; i += 4, p++) {
    // Car if it is not the backdrop in EITHER solo pass.
    const isCar = !near(S1, i, 255, 0, 255) || !near(S2, i, 0, 51, 0);
    if (!isCar) continue;
    drawn++;
    colHit[p % w]++; rowHit[(p / w) | 0]++;
    if (A[i] < 62 && A[i + 1] < 62 && A[i + 2] < 74) ink++;
    // AND HOW MANY THE OLD METHOD WOULD HAVE LOST. Reported, not assumed —
    // the fix is only worth its comment if the hole was really there.
    const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
    if (d < 12) { missedByDiff++; map[p] = 2; } else map[p] = 1;
  }
  // The extent, ignoring stray pixels. A single differing pixel at each edge —
  // and a software renderer produces a few — made the first version report the
  // car as spanning the whole screen.
  const extent = (hist, len, floor) => {
    let lo = 0, hi = len - 1;
    while (lo < len && hist[lo] < floor) lo++;
    while (hi > lo && hist[hi] < floor) hi--;
    return [lo, hi];
  };
  const [x0, x1] = extent(colHit, w, 3);
  const [y0, y1] = extent(rowHit, h, 3);
  return { drawn, ink, missedByDiff, map, w, h, seg, span: x1 - x0, tall: y1 - y0 };
}, VIEW);

const pct = 100 * r.ink / Math.max(1, r.drawn);
console.log(`\nINK METER — ${VIEW === 3 ? 'third' : 'first'} person, ${r.w}x${r.h}, gameplay camera\n`);
console.log(`  pixels the car occupies   ${r.drawn}`);
console.log(`  of those, the old "what changed" method would have missed ` +
            `${r.missedByDiff} (${(100 * r.missedByDiff / Math.max(1, r.drawn)).toFixed(1)}%)`);
console.log(`  of which black ink        ${r.ink}`);
// The exterior reference measures 37-39% ink. The INTERIOR reference is a
// different animal — 55% of that frame is near-black, because a car interior
// genuinely is mostly dark plastic — so first person is graded against that.
// THE TARGET IS MEASURED, NOW, OFF THE DRAWINGS THAT STILL EXIST.
//
// It used to be the constant 34-44, taken from two reference files that have
// since been deleted — 39.3% on a front three-quarter and 36.6% on a rear. A
// band with no way back to its evidence is a band nobody can check, and this
// one was also being compared against a percentage whose denominator was
// wrong, so two errors were sitting on top of each other.
//
// So the exterior band is computed at run time from ref/side-nobg.png and
// ref/rear-nobg-crop.png, with THIS FILE'S OWN threshold applied to the
// drawing's own alpha cut-out. Same rule on both sides of the comparison, and
// the band moves if the references do. The interior band stays a constant
// because there is no interior reference to measure: a car interior genuinely
// is mostly dark plastic, and 48-62 came from the one interior image.
function refInk(path) {
  const png = PNG.sync.read(readFileSync(path));
  let car = 0, ink = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] < 128) continue;
    car++;
    if (png.data[i] < 62 && png.data[i + 1] < 62 && png.data[i + 2] < 74) ink++;
  }
  return 100 * ink / Math.max(1, car);
}
const REFS = [['side', 'ref/side-nobg.png'], ['rear', 'ref/rear-nobg-crop.png']]
  .map(([n, f]) => [n, refInk(__j(__ROOT, f))]);
const TARGET = VIEW === 3
  ? [Math.floor(Math.min(...REFS.map((r) => r[1]))), Math.ceil(Math.max(...REFS.map((r) => r[1])))]
  : [48, 62];
if (VIEW === 3) {
  console.log('  the band, measured off the drawings just now with this file\'s own rule:');
  for (const [n, v] of REFS) console.log(`      ${n.padEnd(6)} ${v.toFixed(1)}%`);
}
console.log(`  INK                       ${pct.toFixed(1)}%      target ${TARGET[0]}-${TARGET[1]}%`);
console.log(`  car spans                 ${r.span} x ${r.tall} px` +
            `   (${(100 * r.span / r.w).toFixed(0)}% of frame width)`);
const verdict = pct < TARGET[0] ? 'TOO TIMID' : pct > TARGET[1] ? 'TOO HEAVY' : 'ON TARGET';
console.log(`\n  ${verdict}`);

// Green: both methods agree it is car. Red: only the solo mask sees it — car
// the colour of what is behind it. Look at this before believing the number.
{
  mkdirSync(SHOTS, { recursive: true });
  const png = new PNG({ width: r.w, height: r.h });
  for (let p = 0; p < r.w * r.h; p++) {
    const x = p % r.w, y = (p / r.w) | 0, q = ((r.h - 1 - y) * r.w + x) * 4;
    const v = r.map[p];
    const c = v === 2 ? [220, 40, 40] : v === 1 ? [70, 150, 70] : [250, 250, 248];
    png.data[q] = c[0]; png.data[q + 1] = c[1]; png.data[q + 2] = c[2]; png.data[q + 3] = 255;
  }
  writeFileSync(__j(SHOTS, `inkmask-${BODY || 'default'}-${VIEW}.png`), PNG.sync.write(png));
  console.log(`  mask picture: shots/inkmask-${BODY || 'default'}-${VIEW}.png`);
}

await browser.close();
