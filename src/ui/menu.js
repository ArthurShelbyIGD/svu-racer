/**
 * THE LANDING PAGE — the first thing anyone sees, and the shape of the game.
 *
 * ===========================================================================
 * WHY IT IS A DOM LAYER AND NOT A SEPARATE PAGE
 * ===========================================================================
 *
 * The whole game ships as one HTML file. A second page would mean a second
 * load, a white flash between the menu and the track, and a second copy of
 * everything that both need. Instead this is a stack of <div>s over the canvas,
 * shown at boot and hidden when you press RACE — so the game is already built,
 * already warm and already sitting on the grid behind the menu while the player
 * reads it. Pressing RACE costs a class change, not a page load.
 *
 * It also fixes something on iOS for free. Everything a browser only grants
 * inside a real gesture — the motion-sensor dialog, audio, the wake lock,
 * fullscreen — used to hang off "the first touch anywhere", which worked but
 * asked for four permissions from a tap the player did not know they were
 * making. Now they come off a button that says RACE. Same code, better moment.
 *
 * ===========================================================================
 * WHAT IS REAL AND WHAT IS A PROMISE
 * ===========================================================================
 *
 * SETTINGS and LAP TIMES do their jobs. TRACKS and GARAGE open a card that says
 * what they will be. That is deliberate rather than lazy: a button that says
 * GARAGE and admits it is not built yet tells the player what the game is going
 * to be, and a track picker with one track in it is a guess about a shape that
 * has not turned up. The same reasoning is in main.js's BEST_KEY comment about
 * per-track lap times — build it when track two makes it real.
 *
 * ===========================================================================
 * THE TEST PANEL LIVES HERE NOW
 * ===========================================================================
 *
 * The on-track buttons — CENTRE, INVERT, SOUND, PIXELS, CAP, SCENERY — were a
 * developer's panel bolted to a player's screen, and Anthony had already
 * trimmed them once: "from a player's POV it's just not needed". They are now
 * Settings, and the numeric readout is off by default. It has not been deleted,
 * because testers on hardware nobody here has seen are the only source of
 * frame-rate data this project has, and a tester who cannot find the numbers
 * cannot send them. Settings has a switch for it.
 */
import { CAR_PNG, CITY_PNG } from '../art/menu.js';

const $ = (id) => document.getElementById(id);

/**
 * Build the menu's markup once, at boot.
 *
 * IN CODE RATHER THAN IN THE TEMPLATE, unlike the HUD and the control panel.
 * Those are a handful of static elements; this is five panels, a dozen rows of
 * settings and two images that have to be wired to state. Written as HTML in
 * shell/template.html it would be four hundred lines of markup with no way to
 * see which parts are driven by what — and the template is also the crash
 * handler's home, which has to stay small enough to read at a glance when
 * everything else has failed.
 */
function markup() {
  return `
<div id="menu" class="show">
  <div id="mBg"></div>
  <div id="mScrim"></div>

  <div class="mPanel" id="pMain">
    <div id="mTitle"><span class="mSvu">SVU</span> RACER</div>
    <img id="mCar" alt="">
    <!-- RACE OWNS ITS OWN ROW. With all five in one wrapping flex row the
         line broke after GARAGE and left SETTINGS stranded underneath on its
         own, which reads as five equal choices badly arranged rather than as
         one obvious thing to press and four ways to poke about. -->
    <div id="mBtns"><button class="mB mBig" id="mRace">RACE</button></div>
    <div id="mBtns2">
      <button class="mB" id="mTracks">TRACKS</button>
      <button class="mB" id="mTimes">LAP TIMES</button>
      <button class="mB" id="mGarage">GARAGE</button>
      <button class="mB" id="mSettings">SETTINGS</button>
    </div>
    <div id="mBest"></div>
  </div>

  <div class="mPanel mCard" id="pTimes">
    <h2>LAP TIMES</h2>
    <div id="tBody"></div>
    <button class="mB mBack">BACK</button>
  </div>

  <div class="mPanel mCard" id="pSettings">
    <h2>SETTINGS</h2>
    <div id="sWrap"><div id="sBody"></div></div>
    <button class="mB mBack">BACK</button>
  </div>

  <div class="mPanel mCard" id="pSoon">
    <h2 id="soonTitle"></h2>
    <p id="soonBody"></p>
    <button class="mB mBack">BACK</button>
  </div>

  <div class="mPanel mCard" id="pResult">
    <h2 id="rTitle">FINISHED</h2>
    <div id="rBody"></div>
    <div class="mRow2">
      <button class="mB mBig" id="rRetry">RETRY</button>
      <button class="mB" id="rMenu">MENU</button>
    </div>
  </div>
</div>`;
}

/** mm:ss.t — the same shape the cockpit's LCD shows, so the two agree. */
function lap(t) {
  if (t == null) return '--:--.-';
  const cs = Math.max(0, Math.round(t * 10));
  const m = Math.floor(cs / 600), s = Math.floor((cs % 600) / 10), d = cs % 10;
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}

/**
 * Wire it up.
 *
 * `api` is everything the menu is allowed to touch, passed in rather than
 * imported, because a menu that reaches into main.js's state directly is a menu
 * that breaks silently the day a field is renamed. Everything it can do to the
 * game arrives through this object and is listed in one place.
 */
export function buildMenu(api) {
  document.body.insertAdjacentHTML('beforeend', markup());
  const menu = $('menu');
  $('mCar').src = CAR_PNG;
  $('mBg').style.backgroundImage = `url(${CITY_PNG})`;

  let panel = 'pMain';
  const PANELS = ['pMain', 'pTimes', 'pSettings', 'pSoon', 'pResult'];
  const show = (id) => {
    panel = id;
    for (const p of PANELS) $(p).classList.toggle('on', p === id);
  };

  /** Open the menu over the game. The game keeps running behind it. */
  const open = (id) => {
    menu.classList.add('show');
    document.body.classList.add('inMenu');
    show(id || 'pMain');
    refresh();
  };
  /** Close it and hand the screen back to the car. */
  const close = () => {
    menu.classList.remove('show');
    document.body.classList.remove('inMenu');
  };

  // ---- the buttons -------------------------------------------------------
  //
  // TOUCH AND CLICK BOTH, AND stopPropagation ON BOTH. The canvas listens for
  // touches to steer and the document listens in the capture phase to unlock
  // audio; a menu button that lets its touch through would steer the car and
  // start the race underneath the menu. main.js's own `bind` does the same
  // thing for the same reason.
  const on = (id, fn) => {
    const el = $(id);
    if (!el) return;
    const go = (e) => { e.stopPropagation(); e.preventDefault(); fn(); };
    el.addEventListener('click', go);
    el.addEventListener('touchstart', go, { passive: false });
  };
  for (const b of menu.querySelectorAll('.mBack')) {
    const go = (e) => { e.stopPropagation(); e.preventDefault(); show('pMain'); refresh(); };
    b.addEventListener('click', go);
    b.addEventListener('touchstart', go, { passive: false });
  }

  const soon = (title, body) => { $('soonTitle').textContent = title; $('soonBody').textContent = body; show('pSoon'); };

  on('mRace', () => { close(); api.race(); });
  on('mTimes', () => { show('pTimes'); refresh(); });
  on('mSettings', () => { show('pSettings'); refresh(); });
  on('mTracks', () => soon('TRACKS',
    'One track for now — the night city. A daytime circuit with a blue sky is ' +
    'next, and this is where you will pick between them.'));
  on('mGarage', () => soon('GARAGE',
    'Not built yet. Credits earned by racing will buy engines, gearboxes and ' +
    'paint here, and the car will finally be somewhere you can walk round it.'));
  on('rRetry', () => { close(); api.race(); });
  on('rMenu', () => open('pMain'));

  // ---- settings ----------------------------------------------------------
  //
  // BUILT FROM A LIST, not written out five times. Every row is either a switch
  // or a stepper, and describing them as data means a new setting is one line
  // rather than a block of markup plus a block of wiring that can disagree.
  const ROWS = [
    { k: 'sound', kind: 'sw', label: 'SOUND',
      note: 'The engine, the tyres and the countdown.' },
    { k: 'tilt', kind: 'sw', label: 'TILT STEERING',
      note: 'Turn the phone to steer. Off means the screen halves steer instead.' },
    { k: 'invert', kind: 'sw', label: 'INVERT TILT',
      note: 'For holding the phone the other way up.' },
    { k: 'pixels', kind: 'step', label: 'SHARPNESS',
      note: 'Fewer pixels is smoother; more is crisper. Drop it if the car stutters.' },
    { k: 'cap', kind: 'step', label: 'FRAME CAP',
      note: 'Only whole divisions of the screen pace evenly, so these are the only useful values.' },
    { k: 'scenery', kind: 'step', label: 'CITY',
      note: 'How many buildings. The single biggest thing you can turn down.' },
    { k: 'readout', kind: 'sw', label: 'SHOW THE NUMBERS',
      note: 'Frame rate, draw calls and triangles, over the track. For sending back test data.' },
  ];

  const sBody = $('sBody');
  sBody.innerHTML = ROWS.map((r) => `
    <div class="sRow">
      <div class="sText"><div class="sLabel">${r.label}</div><div class="sNote">${r.note}</div></div>
      <div class="sCtl">${r.kind === 'sw'
        ? `<button class="mB sSw" data-k="${r.k}"></button>`
        : `<button class="mB sStep" data-k="${r.k}" data-d="-1">&minus;</button>` +
          `<span class="sVal" data-v="${r.k}"></span>` +
          `<button class="mB sStep" data-k="${r.k}" data-d="1">+</button>`}</div>
    </div>`).join('');

  for (const b of sBody.querySelectorAll('.sSw, .sStep')) {
    const go = (e) => {
      e.stopPropagation(); e.preventDefault();
      const k = b.dataset.k;
      if (b.classList.contains('sSw')) api.toggle(k);
      else api.step(k, Number(b.dataset.d));
      refresh();
    };
    b.addEventListener('click', go);
    b.addEventListener('touchstart', go, { passive: false });
  }

  // ---- what the panels say -----------------------------------------------
  function refresh() {
    const s = api.read();

    // The best lap on the front page, because it is the thing the player is
    // actually chasing and it belongs where they can see it before they decide
    // to press RACE.
    $('mBest').textContent = s.best == null
      ? 'no time set'
      : `best lap ${lap(s.best)}   ·   top speed ${Math.round(s.bestTop)} mph`;

    $('tBody').innerHTML = `
      <div class="tRow"><span>FASTEST LAP</span><b>${lap(s.best)}</b></div>
      <div class="tRow"><span>TOP SPEED</span><b>${s.bestTop == null ? '---' : Math.round(s.bestTop) + ' mph'}</b></div>
      <div class="tRow"><span>THIS TRACK</span><b>NIGHT CITY</b></div>
      <p class="tNote">${s.best == null
        ? 'Nothing set yet. The clock starts when the lights go out.'
        : 'Beaten by driving it faster. There is no other way in and no way to clear it from here.'}</p>`;

    for (const b of sBody.querySelectorAll('.sSw')) {
      const v = s[b.dataset.k];
      b.textContent = v ? 'ON' : 'OFF';
      b.classList.toggle('on', !!v);
    }
    for (const v of sBody.querySelectorAll('.sVal')) v.textContent = s[v.dataset.v];
  }

  /** Called by main.js the moment a lap ends. */
  function result(r) {
    $('rTitle').textContent = r.crashed ? 'INTO THE HOLE' : r.fresh ? 'NEW BEST' : 'FINISHED';
    $('rBody').innerHTML = r.crashed
      ? `<p class="rBig">You missed the bridge.</p>
         <p class="rNote">The gap wants about 150mph on the lip. Boost early on the
         approach — it is the longest straight on the lap and there is nothing to
         steer round.</p>`
      : `<div class="tRow"><span>LAP</span><b class="${r.fresh ? 'good' : ''}">${lap(r.elapsed)}</b></div>
         <div class="tRow"><span>TOP SPEED</span><b>${Math.round(r.topSpeed)} mph</b></div>
         <div class="tRow"><span>BEST</span><b>${lap(r.best)}</b></div>`;
    menu.classList.add('show');
    document.body.classList.add('inMenu');
    show('pResult');
  }

  // THE MENU IS UP AT BOOT, so the body class that hides the track's own
  // furniture has to be on at boot too. Leaving it to the first open() meant
  // the control panel and the note showed through the landing page for exactly
  // as long as it took someone to press a button, which is the whole time.
  document.body.classList.add('inMenu');
  // AND A PANEL HAS TO BE SELECTED. The markup ships with none of them carrying
  // the `.on` class, on the principle that the panel currently showing is
  // state and state belongs in one place — show(). Which is right, and meant
  // that at boot the menu was a full-screen layer containing five hidden
  // panels: a cityscape with nothing on it and no way to start the game.
  show('pMain');
  refresh();
  return { open, close, result, isOpen: () => menu.classList.contains('show') };
}
