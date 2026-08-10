// Does the gantry actually stand on the road?
//
// THE CHECK IS AGAINST THE ROAD MESH ITSELF, NOT AGAINST A RECOMPUTATION.
// gantry.js positions the structure by reproducing Road.update's lateral walk,
// so a test that reproduced the same walk a third time would agree with a bug
// and prove nothing. Instead this reads the position buffer of the road mesh
// that is actually about to be drawn, pulls out the two corners of the tarmac
// quad for the segment the gantry says it is standing on, and compares their
// midpoint with where the gantry actually is. That is the same geometry the
// player sees, so it cannot agree with a bug in the walk.
//
// WHY IT MATTERS HERE IN PARTICULAR. The start line, segment 100, is on a
// bend: the road wanders 5,700 units sideways over the 220 segments leading up
// to it, and it is climbing seven units at the same time. Road.update's walk
// starts BEHIND the camera and subtracts the offset that pre-walk accumulated;
// omitting the pre-walk is the classic error and it grows by one segment's
// curvature per segment, so on this approach it would be worth hundreds of
// units by the far end. A gantry that missed the road by that much would be in
// the buildings. So the run below steps the car all the way in from 780 units
// out — which puts the gantry at every position in the walk from segment 130
// down to behind the camera — and prints the worst error it found.
//
// The tolerance is 0.001 units. This is not a floating-point comparison of two
// different formulas; both numbers derive from the same curve array, so if the
// walk is right they should agree to the last bit and any real disagreement is
// a bug, not noise.

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FILE = 'file://' + join(ROOT, 'docs', 'index.html');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 300 } });
await page.goto(FILE, { waitUntil: 'load' });
await page.waitForTimeout(2000);

const fails = [];
const ok = (cond, label, detail = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${detail ? '   ' + detail : ''}`);
  if (!cond) fails.push(label);
};

const res = await page.evaluate(async () => {
  const R = window.RACER;
  const K = R.consts;
  const SEG_LEN = K.SEG_LEN, ROAD_W = K.ROAD_W;
  const BEHIND = 5;          // main.js's BEHIND; the road mesh is built with it
  const KERB_H = 0.34;       // furniture.js's pavement height, which gantry.js adds
  // THE CITY GOES OFF FOR THE DURATION. This container has no GPU and the
  // sweep needs two hundred settled frames; the scenery is 7,000 instances of
  // nothing this test looks at. The road mesh — the only thing being compared
  // against — is untouched by the dial.
  R.renderer.setPixelRatio(0.3);
  R.scenery.count = 0;
  R.tune.freeze = true;
  R.tune.holdX = 0;
  R.race.state = 'racing';
  R.st.speed = 205;
  R.st.gear = 4;
  R.st.view = 1;

  // The road mesh is the one with 12 quads per segment over SEG_COUNT + BEHIND
  // segments. Found by size rather than by name, because main.js does not
  // export it and adding an export to main.js is not this file's business.
  const wantVerts = (220 + BEHIND) * 12 * 4;
  let road = null;
  R.scene.traverse((o) => {
    const p = o.isMesh && o.geometry && o.geometry.getAttribute('position');
    if (p && p.count === wantVerts) road = o;
  });
  if (!road) return { error: 'road mesh not found' };
  const rp = road.geometry.getAttribute('position').array;

  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const rows = [];
  let worst = { d: -1, err: -1 }, worstY = { d: -1, err: -1 }, worstZ = { d: -1, err: -1 };
  let seen = 0, hidden = 0;

  // THREE SWEEPS. The first two are the lines as shipped. The third moves them
  // by a fraction of a segment, which is the only way to exercise the
  // interpolation: RACE_FROM is 600 against a 6-unit segment, so as shipped
  // both lines sit exactly on a segment boundary and the fraction is zero on
  // every frame of every lap. A branch that never runs is a branch nobody has
  // ever seen work.
  const RUNS = [
    { label: 'start', from: K.RACE_FROM, len: K.RACE_LEN, target: K.RACE_FROM },
    { label: 'finish', from: K.RACE_FROM, len: K.RACE_LEN, target: K.RACE_FROM + K.RACE_LEN },
    { label: 'start+2.5', from: K.RACE_FROM + 2.5, len: K.RACE_LEN, target: K.RACE_FROM + 2.5 },
  ];
  let sawFrac = 0;
  for (const run of RUNS) {
    R.gantry.setLines(run.from, run.len);
    // Seven, not six, so the car's own sub-segment fraction takes every value
    // rather than sitting at zero for the whole sweep.
    for (let back = 780; back >= -21; back -= 7) {
      R.st.dist = run.target - back;
      await frame();
      await frame();
      const g = R.gantry;
      if (!g.group.visible) { hidden++; continue; }
      seen++;
      const j = g.stats.i0 + BEHIND;
      const f = g.stats.f;
      if (f > 1e-9) sawFrac++;
      if (j < 0 || j >= 224) continue;
      // Quad 12j is the tarmac. Vertices 0 and 3 are its NEAR end, both road
      // edges; vertices 1 and 2 are its FAR end. Interpolating between the two
      // midpoints by the same fraction the gantry used gives the road surface
      // directly under it — still measured off the mesh, not recomputed.
      const v = (12 * j) * 4 * 3;
      const nx = (rp[v] + rp[v + 9]) / 2, ny = (rp[v + 1] + rp[v + 10]) / 2, nz = (rp[v + 2] + rp[v + 11]) / 2;
      const fx = (rp[v + 3] + rp[v + 6]) / 2, fy = (rp[v + 4] + rp[v + 7]) / 2, fz = (rp[v + 5] + rp[v + 8]) / 2;
      const cx = nx + (fx - nx) * f, cy = ny + (fy - ny) * f, cz = nz + (fz - nz) * f;
      const halfW = (rp[v + 9] - rp[v]) / 2;
      const p = g.group.position;
      const ex = Math.abs(p.x - cx), ey = Math.abs(p.y - (cy + KERB_H)), ez = Math.abs(p.z - cz);
      if (ex > worst.err) worst = { d: back, err: ex, line: run.label };
      if (ey > worstY.err) worstY = { d: back, err: ey, line: run.label };
      if (ez > worstZ.err) worstZ = { d: back, err: ez, line: run.label };
      if (Math.abs(halfW - ROAD_W) > 0.001) rows.push(`road half-width wrong at ${back}: ${halfW}`);
    }
  }
  R.gantry.setLines(K.RACE_FROM, K.RACE_LEN);

  // ---- THE HOUSE RULES, ASSERTED RATHER THAN PROMISED --------------------
  // MeshBasicMaterial only, fog on everything, no lights anywhere, no shadows.
  // These are the reasons this game runs on the target phone at all, and every
  // one of them is a single property that a later edit could flip without
  // anything looking obviously wrong until it is measured on the device.
  const mats = [];
  R.gantry.group.traverse((o) => { if (o.isMesh) mats.push(o.material); });
  let lights = 0;
  R.scene.traverse((o) => { if (o.isLight) lights++; });
  const tex = R.gantry.texture;

  return { worst, worstY, worstZ, seen, hidden, rows, sawFrac,
           both: R.gantry.stats.bothInRange, legX: R.gantry.stats.legX,
           kerbTop: R.gantry.stats.kerbTop,
           meshes: mats.length,
           basic: mats.every((m) => m.type === 'MeshBasicMaterial'),
           fogged: mats.every((m) => m.fog === true),
           lights,
           shadows: R.renderer.shadowMap.enabled,
           magFilter: tex.magFilter, minFilter: tex.minFilter,
           mips: tex.generateMipmaps, texW: tex.image.width, texH: tex.image.height,
           tris: R.gantry.stats.tris, calls: R.gantry.stats.calls };
});

if (res.error) { console.log(res.error); await browser.close(); process.exit(1); }

console.log(`sampled ${res.seen} positions where the gantry was drawn ` +
            `(${res.hidden} where it was correctly hidden)\n`);
ok(res.seen > 300, 'the sweep actually saw the gantry', `${res.seen} positions`);
ok(res.sawFrac > 50, 'the fractional-placement branch was actually exercised',
   `${res.sawFrac} positions with a non-zero segment fraction`);
ok(res.worst.err < 0.001, 'the beam is centred on the road, laterally',
   `worst ${res.worst.err.toExponential(2)} units, at the ${res.worst.line} line ` +
   `${res.worst.d} units out`);
ok(res.worstY.err < 0.001, 'the feet are exactly one kerb-height above the tarmac',
   `worst ${res.worstY.err.toExponential(2)} units, ${res.worstY.d} units out`);
ok(res.worstZ.err < 0.001, 'the gantry is at the segment it says it is at',
   `worst ${res.worstZ.err.toExponential(2)} units, ${res.worstZ.d} units out`);
ok(res.both === 0, 'the two gantries are never both in range',
   `${res.both} frames where they were — one mesh would not be enough`);
ok(res.legX > res.kerbTop, 'the legs stand outside the kerb, not in the road',
   `leg centre ${res.legX}, kerb top ${res.kerbTop}`);
console.log('');
ok(res.meshes === 2, 'the gantry is exactly two meshes', `${res.meshes}`);
ok(res.basic, 'MeshBasicMaterial only');
ok(res.fogged, 'fog: true on every gantry material');
ok(res.lights === 0, 'no lights anywhere in the scene', `${res.lights} found`);
ok(res.shadows === false, 'shadows off');
// 1003 is NearestFilter, 1008 is LinearMipmapLinearFilter. Compared as numbers
// because the constants are not on window and importing three into a harness
// that loads a bundled build would be importing a DIFFERENT three.
ok(res.magFilter === 1003, 'banner magnifies with NearestFilter (hard pixel edges up close)',
   `magFilter ${res.magFilter}`);
ok(res.minFilter === 1008, 'banner minifies through mipmaps (no crawl on the approach)',
   `minFilter ${res.minFilter}`);
ok(res.mips === true, 'mipmaps are generated');
ok(res.texW === 1024 && res.texH === 192,
   'the banner canvas is 16:3 and an integer multiple of the 64px art',
   `${res.texW} x ${res.texH}, art tile ${res.texH / 64}x`);
console.log(`\n       (gantry costs ${res.calls} draw calls and ${res.tris} triangles when in shot)`);
for (const r of res.rows) console.log('  note: ' + r);

await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.join(', ')}` : '\nall gantry fit checks passed');
process.exit(fails.length ? 1 : 0);
