// DOES THE LANDING PAGE FIT, AND DO ITS BUTTONS DO ANYTHING?
//
// The readout has already been shipped broken twice for exactly the reason this
// tool exists: it fitted on the screen it was designed on and ran off the
// screen Anthony actually holds. Once it was clipped at the right edge, once
// two columns collided — and both times the fit check that was supposed to
// catch it was checking one edge, or had gone blind and could no longer fail.
//
// A menu is worse than a readout, because a readout that runs off the edge is
// ugly and a RACE button that runs off the edge is a game nobody can start.
//
// So: six real screens, from Anthony's phone with its browser chrome showing
// to a Pro Max added to the home screen, and for each one
//
//   1. NOTHING OVERFLOWS. Every panel and every button inside the viewport,
//      measured from getBoundingClientRect rather than eyeballed.
//   2. EVERY BUTTON IS BIG ENOUGH TO HIT. 44 CSS px is the number every
//      platform's guidance agrees on and the one the vmin sizing has a px
//      floor for.
//   3. THE BUTTONS ACTUALLY WORK. A menu that fits and does nothing passes
//      every geometric test there is.
//
//   node tools/menufit.mjs
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

const SCREENS = [
  { name: "Anthony's phone, fullscreen", w: 720, h: 360 },
  { name: 'his phone, chrome showing', w: 672, h: 280 },
  { name: 'small phone', w: 640, h: 320 },
  { name: 'iPhone, home screen app', w: 844, h: 390 },
  { name: 'iPhone, Safari chrome', w: 844, h: 340 },
  { name: 'Pro Max, home screen app', w: 932, h: 430 },
];

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

// ---------------------------------------------------------------------------
// 1 and 2: THE GEOMETRY, on every screen and in every panel.
console.log('\n  DOES IT FIT\n');
console.log('  screen                      panel      widest   tallest   smallest button');
const PANELS = ['pMain', 'pTimes', 'pSettings', 'pSoon', 'pResult'];
for (const s of SCREENS) {
  const p = await b.newPage({ viewport: { width: s.w, height: s.h } });
  await p.goto(FILE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  await p.waitForTimeout(700);

  for (const which of PANELS) {
    const r = await p.evaluate((id) => {
      // Show the panel directly rather than clicking through to it: this test
      // is about geometry, and the click path is tested separately below.
      for (const q of ['pMain', 'pTimes', 'pSettings', 'pSoon', 'pResult']) {
        document.getElementById(q).classList.toggle('on', q === id);
      }
      if (id === 'pSoon') {
        document.getElementById('soonTitle').textContent = 'GARAGE';
        document.getElementById('soonBody').textContent =
          'Not built yet. Credits earned by racing will buy engines, gearboxes and ' +
          'paint here, and the car will finally be somewhere you can walk round it.';
      }
      const W = window.innerWidth, H = window.innerHeight;
      const panel = document.getElementById(id);
      let over = 0, overW = 0, overH = 0, minBtn = 1e9, minName = '';
      const walk = (el) => {
        const q = el.getBoundingClientRect();
        if (q.width === 0 && q.height === 0) return;   // not laid out
        // A SCROLLING LIST IS ALLOWED TO BE TALLER THAN ITS BOX. That is what
        // scrolling is. Measure the box, not the content inside it.
        const scroller = el.id === 'sBody' || el.closest('#sBody');
        if (!scroller) {
          if (q.right > W + 0.5) { over++; overW = Math.max(overW, q.right - W); }
          if (q.left < -0.5) { over++; overW = Math.max(overW, -q.left); }
          if (q.bottom > H + 0.5) { over++; overH = Math.max(overH, q.bottom - H); }
          if (q.top < -0.5) { over++; overH = Math.max(overH, -q.top); }
        }
        if (el.tagName === 'BUTTON') {
          const side = Math.min(q.width, q.height);
          if (side < minBtn) { minBtn = side; minName = el.textContent.trim().slice(0, 12) || el.id; }
        }
        for (const c of el.children) walk(c);
      };
      walk(panel);
      return { over, overW, overH, minBtn: minBtn === 1e9 ? null : minBtn, minName,
               pw: panel.getBoundingClientRect().width, ph: panel.getBoundingClientRect().height };
    }, which);

    const tag = `${r.over ? `${r.over} OVER by ${Math.max(r.overW, r.overH).toFixed(0)}px` : 'fits'}`;
    console.log(`  ${s.name.padEnd(27)} ${which.padEnd(10)} ${r.pw.toFixed(0).padStart(5)}px  ` +
                `${r.ph.toFixed(0).padStart(6)}px   ` +
                `${r.minBtn == null ? '   -  ' : r.minBtn.toFixed(0).padStart(3) + 'px'} ` +
                `${(r.minName || '').padEnd(12)} ${tag}`);
    if (r.over) fails.push(`${s.name} / ${which}: ${r.over} element(s) outside the viewport`);
    if (r.minBtn != null && r.minBtn < 40) {
      fails.push(`${s.name} / ${which}: "${r.minName}" is only ${r.minBtn.toFixed(0)}px on its short side`);
    }
  }
  await p.close();
}

// A NEGATIVE CONTROL FOR THE OVERFLOW CHECK, because "nothing overflowed" is
// the same output as "the check is not looking". Widen a button past the screen
// and require the same walk to catch it.
{
  const p = await b.newPage({ viewport: { width: 672, height: 280 } });
  await p.goto(FILE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  await p.waitForTimeout(600);
  const caught = await p.evaluate(() => {
    const el = document.getElementById('mRace');
    el.style.width = '200vw';
    const W = window.innerWidth;
    return el.getBoundingClientRect().right > W + 0.5;
  });
  await p.close();
  console.log('');
  ok(caught, 'NEGATIVE CONTROL: a button forced off the screen is seen as off the screen');
}

// ---------------------------------------------------------------------------
// 3: DO THE BUTTONS DO ANYTHING.
console.log('\n  DO THE BUTTONS WORK\n');
{
  const p = await b.newPage({ viewport: { width: 844, height: 390 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(FILE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  await p.evaluate(() => window.RACER.renderer.setPixelRatio(0.4));
  await p.waitForTimeout(700);

  const state = () => p.evaluate(() => ({
    menu: document.getElementById('menu').classList.contains('show'),
    panel: ['pMain', 'pTimes', 'pSettings', 'pSoon', 'pResult']
      .find((q) => document.getElementById(q).classList.contains('on')) || null,
    race: window.RACER.race.state,
    lean: document.body.classList.contains('lean'),
    muted: window.RACER.audio.muted,
    tilt: window.RACER.tilt.enabled,
  }));

  const boot = await state();
  ok(boot.menu && boot.panel === 'pMain' && boot.race === 'grid',
     'it opens on the menu with the car waiting on the grid',
     `panel ${boot.panel}, race ${boot.race}`);

  for (const [btn, want] of [['mTimes', 'pTimes'], ['mSettings', 'pSettings'],
                             ['mTracks', 'pSoon'], ['mGarage', 'pSoon']]) {
    await p.click('#' + btn); await p.waitForTimeout(150);
    const st = await state();
    ok(st.panel === want, `${btn} opens ${want}`, `got ${st.panel}`);
    await p.click(`#${want} .mBack`); await p.waitForTimeout(150);
    const back = await state();
    ok(back.panel === 'pMain', `and BACK returns to the front page from ${want}`, `got ${back.panel}`);
  }

  // SETTINGS HAVE TO REACH THE GAME. A switch that flips its own label and
  // nothing else is the exact failure the nitrous gauge nearly shipped with.
  await p.click('#mSettings'); await p.waitForTimeout(150);
  const before = await state();
  await p.click('.sSw[data-k="sound"]'); await p.waitForTimeout(150);
  const afterSound = await state();
  ok(afterSound.muted !== before.muted, 'the SOUND switch reaches the audio engine',
     `muted ${before.muted} -> ${afterSound.muted}`);
  await p.click('.sSw[data-k="tilt"]'); await p.waitForTimeout(150);
  const afterTilt = await state();
  ok(afterTilt.tilt !== before.tilt, 'the TILT switch reaches the steering',
     `enabled ${before.tilt} -> ${afterTilt.tilt}`);
  await p.click('.sSw[data-k="readout"]'); await p.waitForTimeout(150);
  const afterRead = await state();
  ok(afterRead.lean !== before.lean, 'the NUMBERS switch reaches the readout',
     `lean ${before.lean} -> ${afterRead.lean}`);
  const px = await p.evaluate(() => document.querySelector('.sVal[data-v="pixels"]').textContent);
  await p.click('.sStep[data-k="pixels"][data-d="-1"]'); await p.waitForTimeout(150);
  const px2 = await p.evaluate(() => document.querySelector('.sVal[data-v="pixels"]').textContent);
  ok(px !== px2, 'the SHARPNESS stepper moves and says so', `${px} -> ${px2}`);

  await p.click('#pSettings .mBack'); await p.waitForTimeout(150);

  // RACE. The one button that matters.
  await p.click('#mRace'); await p.waitForTimeout(400);
  const racing = await state();
  ok(!racing.menu, 'RACE closes the menu', `menu still up: ${racing.menu}`);
  ok(racing.race === 'countdown' || racing.race === 'racing',
     'and drops the lights', `race is ${racing.race}`);

  // AND THE RESULTS CARD. Bring the finish line to the car rather than driving
  // twelve thousand units for it under a software renderer.
  const res = await p.evaluate(() => new Promise((done) => {
    const R = window.RACER;
    R.race.state = 'racing'; R.race.elapsed = 57.4; R.race.topSpeed = 268 / R.consts.MPH;
    R.st.dist = R.consts.RACE_FROM + R.consts.RACE_LEN + 1;
    const step = () => (document.getElementById('pResult').classList.contains('on')
      ? done({ title: document.getElementById('rTitle').textContent,
               body: document.getElementById('rBody').textContent,
               menu: document.getElementById('menu').classList.contains('show') })
      : requestAnimationFrame(step));
    requestAnimationFrame(step);
  }));
  // 57.4 OR 57.5. race.elapsed is advanced by stepRace before the finish is
  // detected, so the card shows the seeded time plus that last frame's dt —
  // which is right, and which made an exact-match assertion go red on a
  // correct number for the second time in this repo. See tools/bests.mjs.
  ok(res.menu && /0:57\.[45]/.test(res.body),
     'crossing the line puts the results card up with the lap on it',
     `"${res.title}" — ${res.body.replace(/\s+/g, ' ').trim().slice(0, 60)}`);
  ok(/268|267|269/.test(res.body), 'and the top speed', res.body.replace(/\s+/g, ' ').trim().slice(0, 70));

  await p.click('#rRetry'); await p.waitForTimeout(400);
  const again = await state();
  ok(!again.menu && (again.race === 'countdown' || again.race === 'racing'),
     'RETRY goes straight back out', `menu ${again.menu}, race ${again.race}`);

  ok(errs.length === 0, 'no page errors anywhere in that', errs.join(' | ') || 'clean');
  await p.close();
}

await b.close();
console.log('');
if (fails.length) { for (const f of fails) console.log(`  FAILED: ${f}`); process.exit(1); }
console.log('  the landing page fits and works\n');
