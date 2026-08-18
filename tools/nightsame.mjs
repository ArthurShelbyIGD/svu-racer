// IS THE NIGHT TRACK STILL EXACTLY THE NIGHT TRACK?
//
// The daylight spike pulled four separate colour sources out into a theme
// module: the palette, the city's instance tint, the facade tile and the
// per-face shade. Every one of those is read by the NIGHT path too, and "the
// night defaults are the same numbers" is a claim about code, not a
// measurement. Anthony has called the night track finished, so the bar is
// IDENTICAL, not "looks the same".
//
// ===========================================================================
// WHY THIS COMPARES STATE AND NOT SCREENSHOTS, WHICH TOOK THREE GOES
// ===========================================================================
//
// The obvious tool photographs both builds at the same place and diffs the
// pixels. Three versions of that were built and all three were wrong, in ways
// worth writing down because they are the same three every screenshot rig in
// this project has got wrong at least once:
//
//   1. NO NEGATIVE CONTROL. It reported "4 of 5 poses CHANGED" and I nearly
//      went looking for the colour bug. Photographing the SAME build twice
//      then showed a 52% difference between two runs of identical code. The
//      number had no floor to be measured against and therefore meant nothing.
//
//   2. THE POSE WAS NOT A POSE. It set 80% of top speed, teleported the car
//      and waited before freezing — so the car drove an unknown distance in
//      between and the photograph was taken wherever it got to. Fixed by
//      freezing FIRST and teleporting second. (`tune.holdSpeed` was added
//      while chasing this and is no use here: the OLD build does not have it,
//      so using it poses the two builds differently, which is a rig measuring
//      itself.)
//
//   3. AND EVEN POSED PERFECTLY IT STILL CANNOT PROVE THE CLAIM. Two builds
//      loaded in two tabs do not run the same number of frames before the
//      capture, and the city is placed in a rolling window of instance slots
//      that advances per frame — so which building stands where depends on the
//      frame count, and about 1% of the facades land differently no matter how
//      correct the colours are. The lap clock on the dash differs for the same
//      reason. A test with a 1% floor cannot detect a change to one building
//      in a hundred.
//
// So it compares the things that ARE exact and ARE the thing in question: a
// hash of every pixel of the generated facade texture, the whole per-instance
// tint table, the per-face vertex colours where the sun direction lives, the
// sky gradient read back off the built texture, and the fog.
//
// That is STRONGER than a screenshot, not weaker. It is exact, it covers
// buildings that happen not to be on screen, and it cannot be satisfied by a
// frame that looks right for the wrong reason.
//
//   node tools/nightsame.mjs [ref]        (default: HEAD)
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));
const REF = process.argv[2] || 'HEAD';

// ---- the two builds -------------------------------------------------------
// The reference build is a git worktree, not a `git stash`. Stashing mutates
// the tree this process is running from, so an exception between the stash and
// the pop leaves the working copy in a state nobody asked for.
const work = mkdtempSync(__j(tmpdir(), 'nightsame-'));
execFileSync('git', ['worktree', 'add', '--detach', work, REF], { cwd: ROOT, stdio: 'pipe' });
let refHtml;
try {
  cpSync(__j(ROOT, 'node_modules'), __j(work, 'node_modules'), { recursive: true });
  execFileSync('node', ['build.mjs'], { cwd: work, stdio: 'pipe' });
  refHtml = __j(tmpdir(), 'nightsame-ref.html');
  copyFileSync(__j(work, 'docs', 'index.html'), refHtml);
} finally {
  execFileSync('git', ['worktree', 'remove', '--force', work], { cwd: ROOT, stdio: 'pipe' });
  rmSync(work, { recursive: true, force: true });
}
execFileSync('node', ['build.mjs'], { cwd: ROOT, stdio: 'pipe' });

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const probe = async (html) => {
  const p = await b.newPage({ viewport: { width: 400, height: 240 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + html, { waitUntil: 'load' });
  await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  const r = await p.evaluate(() => {
    const R = window.RACER, S = R.scene.userData.scenery;
    // Every pixel of the facade tile, FNV-1a. It is generated on a canvas at
    // boot from about thirty literals, so a hash of it covers all of them.
    const c = S.mesh.material.map.image;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); }
    const round = (a) => Array.from(a).map((v) => +v.toFixed(6));
    const cattr = (m) => m.geometry.attributes.color;
    return {
      tex: (h >>> 0) + ' @' + c.width + 'x' + c.height,
      // The WHOLE table, not a sample: every building's colour.
      tint: round(S.tint).join(','),
      // Per-face shade — twenty-four floats is both faces of the shell.
      face: round(cattr(S.mesh).array.slice(0, 24)).join(','),
      // BOTH THE GEOMETRY AND THE MATERIAL. This read the vertex colours only,
      // which on the hull are all 1 by construction — so it reported the ink as
      // unchanged under ?theme=golden and I took that as "the theme misses it".
      // Half right: the theme DID miss it, and the tool could not have seen it
      // either. The positive control flagged the pair; both had to be fixed.
      hull: (cattr(S.hull) ? round(cattr(S.hull).array.slice(0, 12)).join(',') : 'no-vcolor')
            + ' | mat ' + S.hull.material.color.getHexString(),
      mean: [S.meanR, S.meanG, S.meanB].map((v) => +v.toFixed(6)).join(','),
      // The sky, read back off the texture the game actually built rather than
      // off the constants that were supposed to make it.
      sky: (() => {
        const t = R.scene.background.image;
        return Array.from(t.getContext('2d').getImageData(0, 0, 1, t.height).data).join(',');
      })(),
      fog: R.scene.fog.color.getHexString() + ' / ' + R.scene.fog.density,
    };
  });
  await p.close();
  return { r, errs };
};
const a = await probe(refHtml);
const c = await probe(__j(ROOT, 'docs', 'index.html'));
// THE POSITIVE CONTROL. A test that has only ever passed has not been shown to
// work; it has been shown to be capable of printing "same". So the current
// build is also probed with ?theme=golden, where every one of these values is
// supposed to be different, and if the tool reports THAT as identical then the
// tool is broken and its pass above means nothing.
const g = await probe(__j(ROOT, 'docs', 'index.html') + '?theme=golden');
await b.close();

const WHAT = {
  tex:  'the facade tile, every pixel hashed',
  tint: 'the per-instance colour table, every building',
  face: 'the per-face shade — where the sun direction lives',
  hull: 'the ink hull',
  mean: 'what the city averages to, which the distance fade lerps toward',
  sky:  'the sky gradient, read back off the built texture',
  fog:  'fog colour and density',
};
console.log(`\n  THE NIGHT TRACK, CURRENT TREE vs ${REF}\n`);
let bad = 0;
for (const k of Object.keys(WHAT)) {
  const same = a.r[k] === c.r[k];
  if (!same) bad++;
  console.log(`   ${same ? '  same  ' : ' CHANGED'}  ${WHAT[k]}`);
  if (same) continue;
  if (a.r[k].length < 160) {
    console.log(`             was ${a.r[k]}`);
    console.log(`             now ${c.r[k]}`);
  } else {
    const x = a.r[k].split(','), y = c.r[k].split(',');
    if (x.length !== y.length) console.log(`             length ${x.length} -> ${y.length}`);
    let n = 0;
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) {
      if (n < 4) console.log(`             [${i}]  ${x[i]} -> ${y[i]}`);
      n++;
    }
    console.log(`             ${n} of ${x.length} entries differ`);
  }
}
const keys = Object.keys(WHAT);
const moved = keys.filter((k) => c.r[k] !== g.r[k]);
console.log(`\n  positive control: the same build with ?theme=golden differs on ` +
            `${moved.length} of ${keys.length}`);
if (moved.length < keys.length) {
  console.log(`  BUT NOT ON: ${keys.filter((k) => !moved.includes(k)).join(', ')}`);
  console.log('  — either the theme does not reach those, or this tool cannot see them.');
}

console.log(`\n  page errors: before ${a.errs.length || 'none'}, after ${c.errs.length || 'none'}`);
const blind = moved.length === 0;
console.log(blind ? `\n  THE TOOL IS BLIND. It cannot tell night from golden, so its verdict\n` +
                    `  on the night track above is worth nothing.\n`
          : bad   ? `\n  ${bad} of ${keys.length} checks CHANGED. A shipped track has moved.\n`
                  : `\n  every one identical. The night track is exactly what it was.\n`);
process.exit(bad || blind ? 1 : 0);
