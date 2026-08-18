// PHOTOGRAPH A TRACK AT GIVEN SEGMENTS.
//
// Deliberately in tools/ rather than in /tmp, which is where the first version
// of it lived until the container was reclaimed and took it with it. Anything
// worth running twice belongs in the repo, because the repo is what rides out
// to Anthony's machine in the tarball and is the only thing here that survives.
//
//   node tools/trackshot.mjs docks 300 1000 2100
//   node tools/trackshot.mjs night 1450
//
// Writes shots/<track>-<seg>.png and shots/<track>-sheet.png, and prints the
// draw calls and triangles — which are the numbers that decide whether any of
// this can run on the phone, and are free to collect while the camera is here.
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));
mkdirSync(__j(ROOT, 'shots'), { recursive: true });

const TRACK = process.argv[2] || 'night';
const SEGS = process.argv.slice(3).map(Number).filter((n) => Number.isFinite(n));
if (!SEGS.length) SEGS.push(1000);

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const p = await b.newPage({ viewport: { width: 720, height: 360 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('file://' + __j(ROOT, 'docs', 'index.html') + '?track=' + TRACK, { waitUntil: 'load' });
await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
await p.evaluate(() => { window.RACER.menu.close();
  for (const id of ['hud', 'note', 'ctl', 'gears']) {
    const e = document.getElementById(id); if (e) e.style.display = 'none';
  }
  window.RACER.startRace(); });
await p.evaluate((s) => new Promise((d, f) => {
  const R = window.RACER, t = R.st.simT + s, g = performance.now() + 90000;
  const st = () => { if (R.st.simT >= t) return d();
    if (performance.now() > g) return f(new Error('stalled')); requestAnimationFrame(st); };
  requestAnimationFrame(st);
}), 4.4);

const shots = [];
for (const seg of SEGS) {
  // Freeze FIRST and teleport second — see tools/nightsame.mjs for the three
  // ways of getting this wrong. Frozen, the loop advances neither speed nor
  // distance but the renderer still reads st.dist, so the world moves and
  // nothing else does.
  await p.evaluate((s) => { const R = window.RACER;
    R.tune.freeze = true; R.tune.holdX = 0;
    R.st.dist = s * R.consts.SEG_LEN; R.st.air = 0; R.st.vy = 0; }, seg);
  await p.waitForTimeout(700);
  const png = PNG.sync.read(await p.screenshot());
  writeFileSync(__j(ROOT, 'shots', `${TRACK}-${seg}.png`), PNG.sync.write(png));
  shots.push(png);
}
const info = await p.evaluate(() => ({ calls: window.RACER.renderer.info.render.calls,
                                       tris: window.RACER.renderer.info.render.triangles }));
await b.close();

const W = shots[0].width, H = shots[0].height, GAP = 8;
const sheet = new PNG({ width: W, height: (H + GAP) * shots.length });
sheet.data.fill(18);
shots.forEach((s, k) => {
  for (let y = 0; y < H; y++) {
    s.data.copy(sheet.data, ((k * (H + GAP) + y) * W) * 4, y * W * 4, (y * W + W) * 4);
  }
});
writeFileSync(__j(ROOT, 'shots', `${TRACK}-sheet.png`), PNG.sync.write(sheet));
console.log(`\n  ${TRACK}: ${SEGS.join(', ')}`);
console.log(`  ${info.calls} draw calls, ${info.tris} triangles`);
console.log(`  page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
console.log(`  wrote shots/${TRACK}-sheet.png\n`);
