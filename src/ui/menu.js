import { TRACKS, TRACK_ORDER, trackName, chooseTrack } from '../world/tracks.js';
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
 * WHAT THIS TRACK IS CALLED, and it is not Night City.
 *
 * That was the working name and it had to go: Night City is the setting of
 * Cyberpunk 2077 and has been since 1988's Cyberpunk 2013. Anthony caught it —
 * "we can't call it Night City as that is the Cyberpunk 2077 city name" — and
 * he is right on both counts, the obvious one and the one that matters more:
 * a game that borrows another game's place name reads as a game that borrowed
 * other things too, whatever the legal position turns out to be.
 *
 * MIDNIGHT MILE is its own name, says what the track is — a long dark run
 * through a city — and leaves the daytime circuit free to be something else
 * entirely rather than "Day City". One constant, so renaming it is one edit
 * and the lap-times panel and the track picker cannot drift apart.
 */
export const TRACK_NAME = TRACKS[trackName()].name;

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
    <!-- TWO ROWS, NEVER THREE, AND FULL SCREEN RIDES WITH RACE.
         With five buttons in the lower row it wrapped to three lines, and the
         third pushed RACE up into the car. Anthony: "we are wasting space
         slightly by having three rows when we only need two. That way the play
         button doesn't ruin the shot of the car."
         Putting FULL SCREEN on RACE's line rather than the other one is what
         makes the count stable: it is the only button here that comes and goes
         — it hides itself once you are fullscreen — and a row that changes
         length is a row that reflows the whole page under you. On RACE's line
         it can appear and vanish without ever moving anything else. -->
    <!-- SIX BUTTONS, THREE BY THREE, AND THE BLOCK NEVER CHANGES SHAPE.
         Anthony: "We have six buttons at this stage, two rows, so there should
         be three buttons in each row... A nice neat and tidy block of buttons
         beats those screenshots by a mile."
         The thing that makes it hold is that FULL SCREEN no longer disappears
         once it has been used — it toggles, so the sixth cell is never empty
         and nothing below it ever reflows. When the browser refuses fullscreen
         outright it stays in place too, dimmed and relabelled, because a hole
         in the grid would be worse than a button that cannot do anything.
         RACE is the middle of the top row, so it is the centre of the block as
         well as the centre of the page, and it is marked out by COLOUR rather
         than by size — a bigger cell would break the rectangle. -->
    <div id="mGrid">
      <button class="mB" id="mFull">FULL SCREEN</button>
      <button class="mB mBig" id="mRace">RACE</button>
      <button class="mB" id="mSettings">SETTINGS</button>
      <button class="mB" id="mTracks">TRACKS</button>
      <button class="mB" id="mTimes">LAP TIMES</button>
      <button class="mB" id="mGarage">GARAGE</button>
    </div>
    <!-- ONE LINE, NOT TWO. The best lap and the fullscreen hint are both a
         single row of small grey text, and stacking them put the front page
         four pixels over the edge of a 592x212 Samsung — the shortest screen
         this has ever been run on. Joined with a dot, which is also how the
         note over the road separates its clauses. -->
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

  <div class="mPanel mCard" id="pTracks">
    <h2>TRACKS</h2>
    <div id="trkBody"></div>
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
  const PANELS = ['pMain', 'pTimes', 'pSettings', 'pTracks', 'pSoon', 'pResult'];
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

  /**
   * THE TRACK PICKER, WHICH RELOADS THE PAGE AND SAYS SO.
   *
   * Choosing a track cannot take effect in place: the city's colours, the
   * facade texture, the barrier's buffers and the car's grip are all baked
   * before the first frame, from the track. So the button stores the choice
   * and reloads — under a second from cache, and one line of mechanism instead
   * of a teardown-and-rebuild subsystem nobody would trust.
   *
   * The player is told, because a screen that goes blank for a moment with no
   * warning reads as a crash. "LOADING…" on the button is the whole of it.
   */
  // Read ONCE and cleared immediately, so the note appears on the page the
  // switch produced and not on every page after it.
  const SWITCHED = 'svu-racer-switched';
  let justSwitched = false;
  try {
    justSwitched = sessionStorage.getItem(SWITCHED) === '1';
    if (justSwitched) sessionStorage.removeItem(SWITCHED);
  } catch (e) { /* no storage, no note */ }

  const trkBody = $('trkBody');
  trkBody.innerHTML = TRACK_ORDER.map((id) => {
    const t = TRACKS[id];
    return `<div class="sRow">
      <div class="sText"><div class="sLabel">${t.name}</div><div class="sNote">${t.blurb}</div></div>
      <div class="sCtl"><button class="mB trkPick" data-t="${id}"></button></div>
    </div>`;
  }).join('');
  for (const b of trkBody.querySelectorAll('.trkPick')) {
    const go = (e) => {
      e.stopPropagation(); e.preventDefault();
      if (b.dataset.t === trackName()) return;      // already on it; the label says DRIVING
      if (!chooseTrack(b.dataset.t)) return;
      b.textContent = 'LOADING…';
      // A note to the next page load, which is about to happen. sessionStorage
      // rather than a variable, for the obvious reason.
      try { sessionStorage.setItem(SWITCHED, '1'); } catch (e) { /* then no note */ }
      // A BEAT BEFORE RELOADING, so the label is actually painted. Reloading
      // synchronously off the tap gives a frozen button and then a white
      // flash, which is the same thing a broken page looks like.
      setTimeout(() => location.reload(), 60);
    };
    b.addEventListener('click', go);
    b.addEventListener('touchstart', go, { passive: false });
  }

  const soon = (title, body) => { $('soonTitle').textContent = title; $('soonBody').textContent = body; show('pSoon'); };

  on('mRace', () => { close(); api.race(); });
  on('mTimes', () => { show('pTimes'); refresh(); });
  on('mSettings', () => { show('pSettings'); refresh(); });
  on('mTracks', () => { show('pTracks'); refresh(); });
  on('mGarage', () => soon('GARAGE',
    'Not built yet. Credits earned by racing will buy engines, gearboxes and ' +
    'paint here, and the car will finally be somewhere you can walk round it.'));
  on('mFull', () => { api.act('fullscreen'); refresh(); setTimeout(refresh, 500); });
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
      // REWRITTEN AT RUNTIME ON AN IPHONE. See TILT_NOTE below — iOS is the one
      // platform where turning this on can silently fail, and the player is the
      // only person who can fix it.
      note: 'Turn the phone to steer. Off means the screen halves steer instead.' },
    { k: 'invert', kind: 'sw', label: 'INVERT TILT',
      note: 'For holding the phone the other way up.' },
    { k: 'pixels', kind: 'step', label: 'SHARPNESS',
      note: 'Fewer pixels is smoother; more is crisper. Drop it if the car stutters.' },
    { k: 'cap', kind: 'step', label: 'FRAME CAP',
      note: 'Only whole divisions of the screen pace evenly, so these are the only useful values.' },
    { k: 'scenery', kind: 'step', label: 'CITY',
      note: 'How many buildings. The single biggest thing you can turn down.' },
    { k: 'fullscreen', kind: 'act', label: 'FULLSCREEN', act: 'GO',
      note: 'Fills the screen and locks landscape. Some in-app browsers refuse it — ' +
            'if yours does, open the link in Chrome or Safari instead.' },
    // THE VIEW SWITCH IS NOT HERE ANY MORE. It went in here first and Anthony
    // drove an evening with it: "I think I made a mistake putting 3rd/1st
    // person in settings as I feel it would be cool to switch between the two
    // when driving, certainly for a mainly 1st person driver." He is right —
    // a camera you might flick to for one corner is a control, not a
    // preference, and one that costs a pause and four taps is one nobody uses.
    // It is a button on the glass now, next to CENTRE. main.js: setView().
    { k: 'readout', kind: 'sw', label: 'SHOW THE NUMBERS',
      note: 'Frame rate, draw calls and triangles, over the track. For sending back test data.' },
    // ---- LAST, AND IT BELONGS LAST -------------------------------------
    //
    // This is the row that solved the off-centre menu in one round trip after
    // three guesses had failed and one had made it worse, so it stays. But it
    // went in at the TOP while I was chasing that, and the first thing a new
    // player met in Settings was a wall of viewport arithmetic. Anthony, about
    // to share the link: "so a player isn't immediately confronted by it."
    //
    // Bottom of the list is the right place for a thing that is useless until
    // something is wrong and invaluable the moment it is — and the wording is
    // for a stranger now, because a stranger is who will be reading it.
    { k: 'screen', kind: 'info', label: 'SCREEN INFO',
      note: 'Only useful if something looks wrong. If the layout is off or the game ' +
            'will not fit, send this line along with what you saw.' },
  ];

  const sBody = $('sBody');
  sBody.innerHTML = ROWS.map((r) => `
    <div class="sRow">
      <div class="sText"><div class="sLabel">${r.label}</div><div class="sNote" data-n="${r.k}">${r.note}</div></div>
      <div class="sCtl">${
        r.kind === 'info' ? `<span class="sVal sWide sMono" data-v="${r.k}"></span>`
        : r.kind === 'sw' ? `<button class="mB sSw" data-k="${r.k}"></button>`
        : r.kind === 'act' ? `<span class="sVal sWide" data-v="${r.k}"></span>` +
                             `<button class="mB sAct" data-k="${r.k}">${r.act}</button>`
        : `<button class="mB sStep" data-k="${r.k}" data-d="-1">&minus;</button>` +
          `<span class="sVal" data-v="${r.k}"></span>` +
          `<button class="mB sStep" data-k="${r.k}" data-d="1">+</button>`}</div>
    </div>`).join('');

  for (const b of sBody.querySelectorAll('.sSw, .sStep, .sAct')) {
    const go = (e) => {
      e.stopPropagation(); e.preventDefault();
      const k = b.dataset.k;
      if (b.classList.contains('sSw')) api.toggle(k);
      else if (b.classList.contains('sAct')) api.act(k);
      else api.step(k, Number(b.dataset.d));
      // A BEAT BEFORE READING IT BACK. Fullscreen resolves a promise, so the
      // state a synchronous refresh sees is the state before the request.
      refresh();
      setTimeout(refresh, 400);
    };
    b.addEventListener('click', go);
    b.addEventListener('touchstart', go, { passive: false });
  }

  /**
   * WHAT THE TILT SWITCH SAYS, WHICH ON AN IPHONE IS NOT ALWAYS "ON".
   *
   * iOS is the only platform where switching this on can do nothing and give
   * no sign of it, and there are three quite different reasons — one of which
   * the game cannot fix and the player can. Anthony's daughter's iPhone showed
   * no prompt at all and the reasonable conclusion was that the game does not
   * work on iPhone; it took reading the code to find that two of the three
   * were our bugs and the third was never explained to anybody.
   *
   * So the switch explains itself, in the same spirit as the fullscreen
   * refusal text: the browser's own answer, and whose move it is next.
   */
  const TILT_NOTE = {
    granted: 'Turn the phone to steer. Off means the screen halves steer instead.',
    // Retryable, and switching the row off and on again is the retry — which
    // is the first thing anybody tries anyway, and now actually does something.
    blocked: 'iPhone did not offer the motion prompt. Switch this off and on ' +
             'again to ask, and tap ALLOW.',
    // The dead end. Safari keeps a refusal on file per site and will never show
    // the dialog again, so nothing in the game can recover this.
    denied:  'iPhone has motion access blocked for this site. iOS Settings > ' +
             'Apps > Safari > Advanced > Website Data, delete this site, then ' +
             'reload and tap ALLOW.',
    unasked: 'Turn the phone to steer. Tap ALLOW when iPhone asks for motion access.',
  };

  // ---- what the panels say -----------------------------------------------
  function refresh() {
    const s = api.read();
    // Only on a device that has to ask. Everywhere else s.tiltPerm is 'n/a' and
    // the row keeps its plain description — an Android player should never read
    // a word about iOS permissions.
    // ALWAYS ASSIGNED, NEVER LEFT ALONE. The first version only wrote the note
    // when there was an iOS message to write, which left whatever was there
    // last time — and the boot state is 'unasked', whose text says "Tap ALLOW
    // when iPhone asks". So an Android player who opened Settings before the
    // first tap kept that line forever, on a phone with no such prompt. Caught
    // by the negative control in tools/tiltperm.mjs, which is the only case in
    // that harness with no iPhone in it.
    // DRIVING vs DRIVE, so the picker says which one you are on rather than
    // offering four identical buttons and leaving you to remember.
    for (const b of trkBody.querySelectorAll('.trkPick')) {
      if (b.textContent === 'LOADING…') continue;
      const here = b.dataset.t === trackName();
      b.textContent = here ? 'DRIVING' : 'DRIVE';
      b.classList.toggle('trkHere', here);
    }

    // The numbers, straight from the browser, formatted to be readable in a
    // photograph rather than to be pretty.
    const sc = sBody.querySelector('.sVal[data-v="screen"]');
    if (sc) {
      const cs = getComputedStyle(document.documentElement);
      const n = (v) => Math.round(parseFloat(cs.getPropertyValue(v)) || 0);
      const vv = window.visualViewport;
      // THE BUILD GOES ON THIS LINE TOO. It is otherwise only on the numbers
      // panel, which a tester has to know to switch on — and the first thing
      // any bug report needs is which build produced it.
      const dev = window.__DEVICE || {};
      sc.textContent =
        `build ${dev.build || '?'}\n` +
        `win ${window.innerWidth}x${window.innerHeight}` +
        (vv ? `  vis ${Math.round(vv.width)}x${Math.round(vv.height)}` +
              `  off ${Math.round(vv.offsetLeft)},${Math.round(vv.offsetTop)}` +
              `  x${(vv.scale || 1).toFixed(2)}` : '  no visualViewport') +
        `  dpr ${(window.devicePixelRatio || 1).toFixed(2)}` +
        `  inset L${n('--sal')} R${n('--sar')} T${n('--sat')} B${n('--sab')}` +
        `  vph ${n('--vph')}`;
    }

    const tn = sBody.querySelector('.sNote[data-n="tilt"]');
    if (tn) {
      tn.textContent = TILT_NOTE[s.tiltPerm] || TILT_NOTE.granted;
      // Marked so it reads as a thing needing attention rather than as part of
      // the furniture. Only when there is something for the player to do.
      tn.classList.toggle('sWarn', s.tiltPerm === 'denied' || s.tiltPerm === 'blocked');
    }

    // The best lap on the front page, because it is the thing the player is
    // actually chasing and it belongs where they can see it before they decide
    // to press RACE.
    // SAID ON THE FRONT PAGE, not buried in grey text over the road. Anthony:
    // "full screen happened when I clicked the screen but it needs to be more
    // obvious." It happens on RACE, which is the right moment — nobody knew it
    // was going to. And when the browser refuses outright, which is what an
    // in-app browser does, say THAT instead, because the fix belongs to the
    // player: open the link somewhere else.
    // THE BUTTON GOES WHEN THERE IS NOTHING FOR IT TO DO, and says why when it
    // cannot work. An in-app browser refuses outright — Anthony's Samsung came
    // back "Fullscreen is not supported" — and the fix then belongs to the
    // player rather than to the button.
    const full = $('mFull');
    const dead = s.fsState === 'unsupported';
    // IT STAYS PUT IN ALL THREE STATES. Hiding it left a hole in the grid and
    // shuffled everything under it; the only version of this that holds the
    // block together is one where the cell is always occupied.
    full.textContent = dead ? 'NO FULL SCREEN'
      : s.fsState === 'fullscreen' ? 'EXIT FULL' : 'FULL SCREEN';
    full.classList.toggle('mDead', dead);
    // AND SAY SO AFTER A TRACK SWITCH, because that is the one moment the
    // player is dropped out of full screen by something WE did rather than by
    // anything they chose. A browser always exits full screen on a page load
    // and cannot be talked out of it; the reload is how a track is chosen.
    //
    // Anthony, after swapping tracks: "not really obvious how to get out of
    // the situation, which is click the screen and hope it works." Most of
    // that was the buttons being below the fold, which is fixed in the
    // stylesheet — but "hope it works" deserves an answer too. RACE already
    // takes full screen on its way into the countdown, so the honest line is
    // that there is nothing to fix: just press it.
    const fsBit = s.fsState === 'fullscreen' ? ''
      : dead ? 'this browser blocks full screen — open the link in Chrome, or add it to your home screen'
      : justSwitched ? 'changing track reloaded the page, so full screen came off — RACE puts it back'
      : '';
    const bestBit = s.best == null
      ? 'no time set'
      : `best lap ${lap(s.best)} · top speed ${Math.round(s.bestTop)} mph`;
    $('mBest').textContent = fsBit ? `${fsBit}  ·  ${bestBit}` : bestBit;

    $('tBody').innerHTML = `
      <div class="tRow"><span>FASTEST LAP</span><b>${lap(s.best)}</b></div>
      <div class="tRow"><span>TOP SPEED</span><b>${s.bestTop == null ? '---' : Math.round(s.bestTop) + ' mph'}</b></div>
      <div class="tRow"><span>THIS TRACK</span><b>${TRACK_NAME}</b></div>
      <p class="tNote">${s.best == null
        ? 'Nothing set yet. The clock starts when the lights go out.'
        : 'Beaten by driving it faster. There is no other way in and no way to clear it from here.'}</p>`;

    for (const b of sBody.querySelectorAll('.sSw')) {
      const v = s[b.dataset.k];
      b.textContent = v ? 'ON' : 'OFF';
      b.classList.toggle('on', !!v);
    }
    // SKIP THE ONES THE STATE OBJECT DOES NOT OWN. This loop fills every value
    // cell from `read()` by key, which is right for the steppers — and it runs
    // after the diagnostic row above and blanked it, because `read()` has no
    // `screen` key and `undefined` stringifies to nothing. Any future row that
    // computes its own text would have hit the same wall.
    for (const v of sBody.querySelectorAll('.sVal')) {
      const val = s[v.dataset.v];
      if (val !== undefined) v.textContent = val;
    }
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
