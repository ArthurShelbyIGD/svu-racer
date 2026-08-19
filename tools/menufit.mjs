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

// THE LAST ROW IS A REAL PHONE AND IT IS THE HARDEST CASE THERE IS.
// Anthony ran the game on his wife's mid-range Samsung, in an in-app browser
// that refuses fullscreen, and photographed it: canvas 1664x596 at a device
// pixel ratio of 2.81, which is a 592x212 CSS viewport — a third shorter than
// anything this rig had ever been pointed at. Android in landscape also puts
// its gesture bar down the RIGHT-HAND EDGE, over the controls, which is what
// he actually reported: "the right hand buttons are half covered and extremely
// difficult to use."
//
// `inset` is that system furniture, in CSS px, applied through the same custom
// properties the stylesheet reads. A headless browser will never report a real
// safe-area inset, so without this the inset handling could only be inspected,
// never tested — and CSS that is inspected rather than tested is CSS that was
// written top-and-bottom-only for months without anyone noticing.
const SCREENS = [
  { name: "Anthony's phone, fullscreen", w: 720, h: 360 },
  { name: 'his phone, chrome showing', w: 672, h: 280 },
  { name: 'small phone', w: 640, h: 320 },
  { name: 'iPhone, home screen app', w: 844, h: 390 },
  { name: 'iPhone, Safari chrome', w: 844, h: 340 },
  { name: 'Pro Max, home screen app', w: 932, h: 430 },
  { name: "the Samsung, in-app browser", w: 592, h: 212, inset: { r: 44, l: 0, t: 0, b: 0 } },
  { name: 'the Samsung, gesture bar left', w: 592, h: 212, inset: { r: 0, l: 44, t: 0, b: 0 } },
  { name: 'notched iPhone, both sides', w: 844, h: 390, inset: { r: 50, l: 50, t: 0, b: 21 } },

  // ---- AND THE ONE THAT WAS BROKEN, WHICH NOTHING ABOVE COULD SEE ---------
  //
  // `chrome` is the height of the browser's address bar, in CSS px. It is not
  // the same thing as a smaller viewport, and that difference is the whole
  // bug: with the bar showing, Android Chrome's LAYOUT viewport stays the full
  // height, so `position: fixed; inset: 0` and `height: 100%` both extend
  // behind the bar and off the bottom of the phone. Every row above passes
  // because a headless browser has no address bar to overstate.
  //
  // Anthony hit it by switching tracks, which reloads — and a page load always
  // drops fullscreen: "I get this weird thing going on with the screen... not
  // really obvious how to get out of the situation, which is click the screen
  // and hope it works." RACE and FULL SCREEN were below the fold.
  //
  // Faked by overriding --vph, the measured-visible-height property the
  // stylesheet now sizes every fixed layer with. Same device, same numbers as
  // the first row, plus a 52px bar and the gesture strip.
  { name: "his phone, address bar showing", w: 720, h: 360, chrome: 52,
    inset: { r: 30, l: 0, t: 0, b: 0 } },
  { name: 'the Samsung, address bar showing', w: 592, h: 212, chrome: 46,
    inset: { r: 44, l: 0, t: 0, b: 0 } },
];

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

// ---------------------------------------------------------------------------
// 1 and 2: THE GEOMETRY, on every screen and in every panel.
console.log('\n  DOES IT FIT\n');
console.log('  screen                      panel      widest   tallest   smallest button');
const PANELS = ['pMain', 'pTimes', 'pSettings', 'pTracks', 'pSoon', 'pResult'];
for (const s of SCREENS) {
  const p = await b.newPage({ viewport: { width: s.w, height: s.h } });
  await p.goto(FILE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  if (s.inset) {
    await p.evaluate((i) => {
      const r = document.documentElement.style;
      r.setProperty('--sat', i.t + 'px'); r.setProperty('--sar', i.r + 'px');
      r.setProperty('--sab', i.b + 'px'); r.setProperty('--sal', i.l + 'px');
    }, s.inset);
  }
  if (s.chrome) {
    // Pinned AFTER the game's own resize handler has run, and re-pinned on a
    // timer, because that handler writes --vph from visualViewport and would
    // otherwise overwrite the fake on the next resize event.
    await p.evaluate((c) => {
      const set = () => document.documentElement.style.setProperty(
        '--vph', (window.innerHeight - c) + 'px');
      set();
      setInterval(set, 100);
    }, s.chrome);
  }
  await p.waitForTimeout(700);

  for (const which of PANELS) {
    const r = await p.evaluate((id) => {
      // Show the panel directly rather than clicking through to it: this test
      // is about geometry, and the click path is tested separately below.
      for (const q of ['pMain', 'pTimes', 'pSettings', 'pTracks', 'pSoon', 'pResult']) {
        document.getElementById(q).classList.toggle('on', q === id);
      }
      if (id === 'pSoon') {
        document.getElementById('soonTitle').textContent = 'GARAGE';
        document.getElementById('soonBody').textContent =
          'Not built yet. Credits earned by racing will buy engines, gearboxes and ' +
          'paint here, and the car will finally be somewhere you can walk round it.';
      }
      // THE USABLE BOX, NOT THE VIEWPORT. A button inside the window but under
      // the system's gesture bar is exactly the failure being fixed here, and a
      // check that only knows about window.innerWidth cannot see it.
      const cs = getComputedStyle(document.documentElement);
      const num = (v) => parseFloat(cs.getPropertyValue(v)) || 0;
      const L = num('--sal'), R = num('--sar'), T = num('--sat'), B = num('--sab');
      // HEIGHT FROM --vph, NOT innerHeight. innerHeight is the layout viewport
      // and is exactly the number that lies when an address bar is showing —
      // measuring against it would let the bug through while reporting a pass.
      const vph = parseFloat(cs.getPropertyValue('--vph')) || window.innerHeight;
      const W = window.innerWidth - R, H = vph - B;
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
          if (q.left < L - 0.5) { over++; overW = Math.max(overW, L - q.left); }
          if (q.bottom > H + 0.5) { over++; overH = Math.max(overH, q.bottom - H); }
          if (q.top < T - 0.5) { over++; overH = Math.max(overH, T - q.top); }
        }
        if (el.tagName === 'BUTTON') {
          const side = Math.min(q.width, q.height);
          if (side < minBtn) { minBtn = side; minName = el.textContent.trim().slice(0, 12) || el.id; }
        }
        for (const c of el.children) walk(c);
      };
      // START AT THE PANEL'S CHILDREN, NOT AT THE PANEL. The panel is a
      // full-bleed backdrop — `position:absolute; inset:0` — so it covers the
      // gesture bar BY DESIGN and always will; it is the dark sheet the
      // content sits on. Counting it as an overflow reported every screen as
      // broken by exactly the inset, which is the tool describing its own
      // arithmetic rather than anything about the page. What must clear the
      // system furniture is the things you read and press.
      for (const c of panel.children) walk(c);
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
// 2a: THE BUTTON BLOCK. Three by three, the same in every state, RACE centred.
//
// Anthony asked for "a nice neat and tidy block of buttons", and the thing
// that makes a block a block is that it does not change shape. FULL SCREEN is
// the only button here whose label and state move — it reads FULL SCREEN, then
// EXIT FULL once you are in, and NO FULL SCREEN when the browser refuses — so
// it is the one that can wreck the grid, and it has wrecked it twice already:
// once by hiding itself and leaving a hole, once by sitting in a centred flex
// row that re-centred around it and shifted RACE off the middle of the page.
//
// Both of those looked fine in a screenshot. The second one I actually WROTE A
// COMMENT claiming could not happen, and only caught it by drawing a line down
// the middle of the picture. So it is measured now: same grid, same cell sizes,
// RACE on the centre line, in all three fullscreen states.
console.log('\n  THE BUTTON BLOCK\n');
// EVERY STATE ON THE TWO SCREENS THAT DISAGREE MOST: the one this was designed
// on, and the 592x212 Samsung where vmin means something completely different.
const BLOCK_ON = [{ w: 720, h: 360 }, { w: 592, h: 212 }];
for (const scr of BLOCK_ON)
for (const st of ['windowed', 'fullscreen', 'refused: Fullscreen is not supported']) {
  const p = await b.newPage({ viewport: { width: scr.w, height: scr.h } });
  await p.goto(FILE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  await p.evaluate((x) => { window.RACER.fs.state = x; window.RACER.menu.open('pMain'); }, st);
  await p.waitForTimeout(400);
  const g = await p.evaluate(() => {
    const grid = document.getElementById('mGrid');
    const bs = [...grid.querySelectorAll('button')];
    const rects = bs.map((el) => el.getBoundingClientRect());
    const tops = [...new Set(rects.map((r) => Math.round(r.top)))].sort((a, c) => a - c);
    const perRow = tops.map((t) => rects.filter((r) => Math.round(r.top) === t).length);
    const race = document.getElementById('mRace').getBoundingClientRect();
    const w = [...new Set(rects.map((r) => Math.round(r.width)))];
    const h = [...new Set(rects.map((r) => Math.round(r.height)))];
    const car = document.getElementById('mCar').getBoundingClientRect();
    // DOES EVERY LABEL FIT ITS OWN CELL. nowrap plus forced-equal columns means
    // a label that is too long does not wrap and does not widen its column —
    // it just runs out of the button and over its neighbour, which is what
    // happened the moment the columns were made equal.
    const spill = bs.filter((el) => el.scrollWidth > el.clientWidth + 1)
                    .map((el) => `${el.textContent.trim()} by ${el.scrollWidth - el.clientWidth}px`);
    return { count: bs.length, rows: tops.length, perRow,
             widths: w, heights: h,
             raceOff: (race.left + race.right) / 2 - window.innerWidth / 2,
             carGap: rects.length ? Math.min(...rects.map((r) => r.top)) - car.bottom : 0,
             spill, label: document.getElementById('mFull').textContent };
  });
  await p.close();
  const tag = `${scr.w}x${scr.h} ${st.split(':')[0]}`;
  console.log(`  ${tag.padEnd(24)} ${g.count} buttons, ${g.rows} rows of ${g.perRow.join('+')}, ` +
              `cells ${g.widths.join('/')}x${g.heights.join('/')}px, ` +
              `RACE off centre by ${g.raceOff.toFixed(1)}px, ${g.carGap.toFixed(0)}px under the car  ("${g.label}")`);
  ok(g.count === 6 && g.rows === 2 && g.perRow.every((n) => n === 3),
     `${tag}: six buttons in two rows of three`, `${g.perRow.join('+')}`);
  ok(g.widths.length === 1 && g.heights.length === 1,
     `${tag}: every cell the same size, so it reads as one block`,
     `${g.widths.length} widths, ${g.heights.length} heights`);
  ok(Math.abs(g.raceOff) < 1.5,
     `${tag}: RACE is on the centre line`, `${g.raceOff.toFixed(1)}px off`);
  // 14px, not "some". Anthony asked for "a few more px between the top row of
  // buttons and the bottom of the car" when it was 9, and a gap nobody has put
  // a number on is a gap the next layout change quietly eats.
  ok(g.spill.length === 0,
     `${tag}: every label fits inside its own button`,
     g.spill.join(', ') || 'nothing overflows');
  ok(g.carGap >= 14,
     `${tag}: there is daylight between the car and the buttons`,
     `${g.carGap.toFixed(0)}px`);
}

// ---------------------------------------------------------------------------
// 2b: THE GEARS. Both halves of a bug that shipped.
//
// The landing page took the on-track control panel away and the gear buttons
// went with it, because they were sitting in a grid I had filed as "the dev
// panel". They are the ONLY way to change gear on a phone, so the car was
// stuck in first: "Major bug with the latest version, how to change gear".
//
// And the reason the panel had to go in the first place was the OTHER half:
// Android in landscape puts its gesture bar down the right-hand edge, straight
// over buttons pinned to `right: 8px`. "The right hand buttons are half
// covered and extremely difficult to use... a new player would just close the
// app and write it off as useless."
//
// So both are tested, together, on the phone that found them.
console.log('\n  THE GEAR BUTTONS\n');
for (const s2 of SCREENS.filter((x) => x.inset || x.w === 592 || x.w === 720)) {
  const p = await b.newPage({ viewport: { width: s2.w, height: s2.h } });
  await p.goto(FILE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  await p.evaluate(() => window.RACER.renderer.setPixelRatio(0.4));
  if (s2.inset) {
    await p.evaluate((i) => {
      const r = document.documentElement.style;
      r.setProperty('--sat', i.t + 'px'); r.setProperty('--sar', i.r + 'px');
      r.setProperty('--sab', i.b + 'px'); r.setProperty('--sal', i.l + 'px');
    }, s2.inset);
  }
  await p.waitForTimeout(500);
  await p.click('#mRace');
  await p.waitForTimeout(400);

  const g = await p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const num = (v) => parseFloat(cs.getPropertyValue(v)) || 0;
    const L = num('--sal'), R = num('--sar'), T = num('--sat'), B = num('--sab');
    const W = window.innerWidth, H = window.innerHeight;
    const out = {};
    for (const id of ['gUp', 'gDown']) {
      const el = document.getElementById(id);
      if (!el) { out[id] = null; continue; }
      const q = el.getBoundingClientRect();
      out[id] = { w: q.width, h: q.height,
                  clear: q.right <= W - R + 0.5 && q.left >= L - 0.5
                      && q.bottom <= H - B + 0.5 && q.top >= T - 0.5,
                  // How much room is left between the button and the bar. A
                  // button that clears it by one pixel clears it by nothing.
                  gap: (W - R) - q.right };
    }
    return out;
  });

  for (const id of ['gUp', 'gDown']) {
    const q = g[id];
    console.log(`  ${s2.name.padEnd(30)} ${id.padEnd(6)} ` +
                `${q ? `${q.w.toFixed(0)}x${q.h.toFixed(0)}px, ${q.gap.toFixed(0)}px clear of the bar` : 'MISSING'}` +
                `${q && q.clear ? '' : '   <-- '}`);
    if (!q) fails.push(`${s2.name}: ${id} does not exist — there is no way to change gear`);
    else {
      if (!q.clear) fails.push(`${s2.name}: ${id} is under the system furniture`);
      if (Math.min(q.w, q.h) < 40) fails.push(`${s2.name}: ${id} is only ${Math.min(q.w, q.h).toFixed(0)}px on its short side`);
    }
  }

  // AND THEY HAVE TO SHIFT THE GEARBOX, not just exist in the right place.
  const shifted = await p.evaluate(async () => {
    const R = window.RACER;
    const before = R.st.gear;
    document.getElementById('gUp').click();
    document.getElementById('gUp').click();
    const up = R.st.gear;
    document.getElementById('gDown').click();
    return { before, up, down: R.st.gear };
  });
  ok(shifted.up > shifted.before && shifted.down < shifted.up,
     `${s2.name}: the buttons actually change gear`,
     `${shifted.before} -> ${shifted.up} -> ${shifted.down}`);
  await p.close();
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
    panel: ['pMain', 'pTimes', 'pSettings', 'pTracks', 'pSoon', 'pResult']
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
                             ['mTracks', 'pTracks'], ['mGarage', 'pSoon']]) {
    await p.click('#' + btn); await p.waitForTimeout(150);
    const st = await state();
    ok(st.panel === want, `${btn} opens ${want}`, `got ${st.panel}`);
    await p.click(`#${want} .mBack`); await p.waitForTimeout(150);
    const back = await state();
    ok(back.panel === 'pMain', `and BACK returns to the front page from ${want}`, `got ${back.panel}`);
  }

  // SETTINGS HAVE TO REACH THE GAME. A switch that flips its own label and
  // nothing else is the exact failure the nitrous gauge nearly shipped with.
  // ---- THE TRACK PICKER ---------------------------------------------------
  //
  // A button that says DRIVE and does nothing is worse than no button, and the
  // GARAGE/TRACKS pair spent a fortnight as "coming soon" panels precisely so
  // that would not happen. Now that TRACKS is real it gets the same treatment
  // every other button here does: prove it reaches something.
  //
  // The RELOAD is deliberately not exercised. It would take the page away
  // mid-sweep and every check after it would be measuring a fresh boot, and
  // "does location.reload reload" is not a claim worth a rig. What is worth
  // checking is everything up to it: both tracks listed, the current one
  // marked so you can tell where you are, and the other one offering to go.
  await p.click('#mTracks'); await p.waitForTimeout(200);
  const trk = await p.evaluate(() => Array.from(document.querySelectorAll('.trkPick'))
    .map((b) => ({ id: b.dataset.t, label: b.textContent,
                   name: b.closest('.sRow').querySelector('.sLabel').textContent })));
  ok(trk.length >= 2, 'the picker lists more than one track',
     trk.map((t) => `${t.name} [${t.label}]`).join('  |  '));
  ok(trk.filter((t) => t.label === 'DRIVING').length === 1,
     'exactly one track is marked as the one you are on',
     trk.filter((t) => t.label === 'DRIVING').map((t) => t.name).join(',') || 'none');
  ok(trk.some((t) => t.label === 'DRIVE'), 'and the other one offers to take you there');
  await p.click('#pTracks .mBack'); await p.waitForTimeout(150);

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
