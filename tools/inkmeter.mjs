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
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
// THE HARNESS MUST MEASURE THE BUILD NEXT TO IT, not a fixed path. These tools
// hard-coded /root/racer, so an agent working in a git worktree would have
// photographed master's car and graded its own work by someone else's frame.
const __ROOT = __d(__d(__f(import.meta.url)));
const PAGE = 'file://' + __j(__ROOT, 'docs', 'index.html');
const SHOTS = __j(__ROOT, 'shots');


const VIEW = Number(process.argv[2] || 3);

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

  R.tune[key] = false;
  pose(); await frame(); pose(); await frame(); await frame();
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, B);
  R.tune[key] = true;

  // Pixels that changed are the car. Of those, how many are ink?
  let drawn = 0, ink = 0;
  const colHit = new Int32Array(w), rowHit = new Int32Array(h);
  for (let i = 0, p = 0; i < A.length; i += 4, p++) {
    const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
    if (d < 12) continue;
    drawn++;
    colHit[p % w]++; rowHit[(p / w) | 0]++;
    if (A[i] < 62 && A[i + 1] < 62 && A[i + 2] < 74) ink++;
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
  return { drawn, ink, w, h, seg, span: x1 - x0, tall: y1 - y0 };
}, VIEW);

const pct = 100 * r.ink / Math.max(1, r.drawn);
console.log(`\nINK METER — ${VIEW === 3 ? 'third' : 'first'} person, ${r.w}x${r.h}, gameplay camera\n`);
console.log(`  pixels the car occupies   ${r.drawn}`);
console.log(`  of which black ink        ${r.ink}`);
// The exterior reference measures 37-39% ink. The INTERIOR reference is a
// different animal — 55% of that frame is near-black, because a car interior
// genuinely is mostly dark plastic — so first person is graded against that.
const TARGET = VIEW === 3 ? [34, 44] : [48, 62];
console.log(`  INK                       ${pct.toFixed(1)}%      target ${TARGET[0]}-${TARGET[1]}%`);
console.log(`  car spans                 ${r.span} x ${r.tall} px` +
            `   (${(100 * r.span / r.w).toFixed(0)}% of frame width)`);
const verdict = pct < TARGET[0] ? 'TOO TIMID' : pct > TARGET[1] ? 'TOO HEAVY' : 'ON TARGET';
console.log(`\n  ${verdict}`);

await browser.close();
