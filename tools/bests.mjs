// DOES BUMPING THE STORAGE KEY ACTUALLY THROW THE OLD LAP TIME AWAY?
//
// It is one character of change and it is the kind of one-character change that
// is trivially right and occasionally silently wrong — a key read in one place
// and written in another, say, or a migration someone helpfully added. The cost
// of being wrong is not a crash: it is Anthony's false 0:52.2 sitting on the
// dashboard for another week, unbeatable, while he wonders why the new layout
// feels so slow.
//
// So: write a v1 record the way the OLD build wrote it, load the game, and
// require the dash to come up empty. Then write a v2 record and require it to
// come back, because a key nobody can read is not a fix either — it is the same
// bug with the sign flipped, and it would quietly stop saving anyone's times
// forever.
//
//   node tools/bests.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));
const FILE = 'file://' + __j(ROOT, 'docs', 'index.html');

const fails = [];
const ok = (cond, label, detail = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${detail ? '   ' + detail : ''}`);
  if (!cond) fails.push(label);
};

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

/** Load the page with `seed` already in localStorage, and report what it read. */
const withStored = async (seed) => {
  const page = await b.newPage({ viewport: { width: 400, height: 240 } });
  // THE SEED HAS TO BE IN PLACE BEFORE THE GAME'S FIRST LINE RUNS, because
  // loadBests() is called at module scope during boot. Writing it after
  // page.goto and reloading would work too and would also test one more thing
  // than intended; addInitScript is the honest equivalent of the storage
  // already being there when the player opens the link.
  if (seed) await page.addInitScript((s) => { localStorage.setItem(s.k, s.v); }, seed);
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  const out = await page.evaluate(() => ({
    best: window.RACER.race.best, bestTop: window.RACER.race.bestTop,
    keys: Object.keys(localStorage).filter((k) => k.indexOf('svu-racer') === 0),
  }));
  await page.close();
  return out;
};

const OLD = JSON.stringify({ best: 52.2, bestTop: 260, len: 12000, build: 'old' });
const NEW = JSON.stringify({ best: 59.2, bestTop: 271, len: 12000, build: 'new' });

console.log('\n  THE STORED PERSONAL BEST\n');

const fresh = await withStored(null);
console.log(`   nothing stored          best ${fresh.best}, top ${fresh.bestTop}`);
ok(fresh.best === null, 'a device that has never played has no best', `best ${fresh.best}`);

const stale = await withStored({ k: 'svu-racer-best-v1', v: OLD });
console.log(`   an old v1 record        best ${stale.best}, top ${stale.bestTop}   ` +
            `(the record says 52.2 / 260)`);
ok(stale.best === null && stale.bestTop === null,
   'THE OLD RECORD IS IGNORED: a v1 time set on the track without the bridge does not come back',
   `best ${stale.best}, top ${stale.bestTop}`);

// THE OTHER HALF, and the one that would be missed. A key nobody can read
// passes the test above perfectly while never saving anyone's lap again.
const current = await withStored({ k: 'svu-racer-best-v2', v: NEW });
console.log(`   a current v2 record     best ${current.best}, top ${current.bestTop}   ` +
            `(the record says 59.2 / 271)`);
ok(current.best === 59.2 && current.bestTop === 271,
   'NEGATIVE CONTROL: a record at the CURRENT key is still read, so the key is not simply broken',
   `best ${current.best}, top ${current.bestTop}`);

// And that setting a best actually writes to the new key, not just reads it.
const page = await b.newPage({ viewport: { width: 400, height: 240 } });
await page.goto(FILE, { waitUntil: 'load' });
await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });
const written = await page.evaluate(() => {
  const R = window.RACER;
  R.race.best = 58.0; R.race.bestTop = 250;
  // saveBests is not exported; the race finishing is what calls it, so finish a
  // race. Driving 12,000 units under SwiftShader would take minutes — moving
  // the finish line to the car is the same code path in a fraction of a second.
  R.startRace();
  R.race.state = 'racing';
  R.st.dist = R.consts.RACE_FROM + R.consts.RACE_LEN + 1;
  R.race.elapsed = 57.5; R.race.topSpeed = 265;
  return new Promise((done) => {
    const step = () => (R.race.state === 'done'
      ? done(Object.fromEntries(Object.keys(localStorage)
          .filter((k) => k.indexOf('svu-racer') === 0)
          .map((k) => [k, localStorage.getItem(k)])))
      : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
});
await page.close();
const keys = Object.keys(written);
console.log(`   after setting a record  wrote ${keys.length ? keys.join(', ') : 'nothing'}`);
ok(keys.length === 1 && keys[0] === 'svu-racer-best-v2',
   'a new record is written to v2 and to nothing else',
   keys.join(', ') || 'no key written');
const stored = keys.length ? JSON.parse(written[keys[0]]) : {};
// WITHIN ONE FRAME, not exactly. race.elapsed is advanced by stepRace before
// the finish is detected, so the stored time is the seeded 57.5 plus whatever
// dt that last frame happened to be — up to the 0.1s clamp. Demanding equality
// made this go red on a number that was right.
ok(stored.best >= 57.5 && stored.best <= 57.5 + 0.11,
   'and it is the lap that was actually driven, to within the frame it finished on',
   `stored ${stored.best}`);

await b.close();
console.log('');
if (fails.length) { for (const f of fails) console.log(`  FAILED: ${f}`); process.exit(1); }
console.log('  old times are dropped and new ones are kept\n');
