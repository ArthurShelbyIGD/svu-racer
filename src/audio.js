// THE VOICE. Web Audio synthesis — no samples, no files, nothing downloaded.
//
// The engine is the whole job and it is not a pitch. Mapping revs to the
// frequency of one oscillator gives you a mosquito, because an engine is not a
// note: it is a FIRING FREQUENCY with a harmonic stack over it, and the shape
// of that stack is the difference between a V8 that burbles and a V12 that
// wails. So the stack is the thing that is modelled, and it is a PARAMETER —
// see ENGINES below. The garage will sell V6, V8, V12 and W engines, and the
// owner should be able to HEAR which one he has bought.
//
// HOW THE STACK IS INDEXED, because every other choice here follows from it.
// A four-stroke engine completes one cycle every TWO crank revolutions and
// fires each cylinder exactly once in that cycle. So take the cycle as the
// fundamental: f_cycle = rpm / 120 Hz. Then
//
//     harmonic k  =  k * f_cycle  =  crank order k/2
//     the FIRING harmonic is k = (number of cylinders), always
//
// which is why a V8 at 3000rpm thumps at 200Hz (k=8 of 25Hz) and a V12 at the
// same revs sings at 300Hz. Odd k are HALF-ORDERS: content that repeats once
// per two revolutions rather than once per revolution. A cross-plane V8 fires
// its two banks unevenly — 90/180/270/180 degrees apart down one pipe — and
// that unevenness is energy at half-orders. It is, quite literally, the
// burble. A V12 is even-fire and has almost none, so it has nothing to burble
// with and screams instead. `uneven` in a spec is exactly that number.
//
// WHY ONE OSCILLATOR CAN CARRY THE WHOLE STACK. createPeriodicWave takes the
// harmonic amplitudes directly and the browser band-limits it per octave, so
// forty harmonics that track the revs perfectly and never alias cost ONE node
// and one frequency write per frame. Building the stack out of forty
// oscillators is the obvious way and it is forty times the price on a phone
// that has 6ms to spare.
//
// PARAMETERS ARE WRITTEN FROM THE FRAME LOOP, which may be running at 30fps,
// and an AudioParam assigned instantaneously 30 times a second clicks and
// zippers — it is the single most common reason synthesised engines sound
// cheap. Every continuous parameter here goes through `ramp()`, which is
// setTargetAtTime with a time constant chosen per parameter. See TC below.

// ---------------------------------------------------------------- engines

/**
 * THE HARMONIC STACK, GENERATED FROM A SPEC RATHER THAN TYPED OUT.
 *
 * Returns amplitudes indexed by cycle harmonic k (k=1 is once per two crank
 * revolutions; k = cylinders is the firing harmonic). Three terms:
 *
 *   the FIRING STACK the peak, at k = cylinders and its multiples, falling as
 *                    1/n^1.5. This is what gives the sound a pitch a listener
 *                    can name instead of a rumble.
 *   the SPREAD       everything else, shaped so it RISES toward the firing
 *                    harmonic from below and rolls off as 1/n^tilt above it.
 *                    A low tilt is a hard, bright, open-pipe engine; a high
 *                    one is a muffled saloon.
 *   the UNEVENNESS   half-orders (odd k) scaled by `uneven`. 0 is a perfectly
 *                    even-fire engine, 0.55 is a cross-plane V8's lope. Around
 *                    the firing harmonic they are sidebands at kf±1, which is
 *                    amplitude modulation at the cycle rate — 6.5Hz at idle,
 *                    53Hz at the limiter. That modulation IS the burble.
 *
 * THE SPREAD USED TO FALL AS 1/order FROM ORDER 0.5 UPWARD, AND THAT WAS
 * WRONG, measurably. It made k=1 and k=2 — 30 and 60Hz, below anything a phone
 * can reproduce — the loudest things in the spectrum above about half revs:
 * tools/audio.mjs watched the loudest partial climb correctly to 194Hz and
 * then JUMP DOWN to 56Hz as the bass took over, which is a car whose engine
 * note stops going up when you rev it. Real exhaust energy peaks at the firing
 * order and falls away on both sides of it; the orders below only exist
 * because cylinders differ from one another, so they are weak by definition.
 */
function stack(spec) {
  const kf = spec.cylinders;
  const tilt = spec.tilt, uneven = spec.uneven, peak = spec.peak || 1;
  const kmax = Math.min(72, kf * 6);
  const a = new Float32Array(kmax + 1);
  for (let k = 1; k <= kmax; k++) {
    const r = k / kf;
    let v = spec.base * (r <= 1 ? Math.pow(r, 1.1) : Math.pow(r, -tilt));
    if (k & 1) v *= uneven;
    if (k % kf === 0) v += peak / Math.pow(r, 1.5);
    a[k] = v;
  }
  return a;
}

/** A PeriodicWave from a stack. real is zero throughout: sine phase only,
 *  which keeps the waveform's peak factor low and the headroom predictable. */
function wave(ctx, amps) {
  const n = amps.length;
  const re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) im[k] = amps[k];
  return ctx.createPeriodicWave(re, im, { disableNormalization: false });
}

/**
 * THE ENGINES. Everything that distinguishes one from another is here; there
 * is no code anywhere below that knows what a V8 is.
 *
 *   cylinders  sets the firing harmonic. That is the whole of the "pitch"
 *              difference: same revs, twelve cylinders is half an octave and
 *              a bit above eight.
 *   uneven     half-order content. The burble.
 *   tilt/base  the roll-off — how much is going on above the firing harmonic.
 *   idle/red   the rev range the 0..1 rev signal is stretched across. A muscle
 *              V8 that revs to 6,400 and a V12 that revs to 8,600 sound
 *              different at the same *point in the gear*, which is right.
 *   body       three peaking filters, the exhaust's own resonances. A cheap
 *              stand-in for a pipe, and it is most of the "big" in big engine.
 *              KEEP THEM MODEST. The first V8 had +7dB at 105Hz and -5dB at
 *              300, and that 12dB swing swamped the whole rev-dependent gain:
 *              blipping the throttle came out QUIETER than idling, because the
 *              loudest harmonic moved out of the boost and into the notch.
 *   drive      how hard the waveshaper is pushed. Overtones that appear only
 *              under load, which is what makes a car sound like it is trying.
 *
 * SO A V12 IS SPECIFIED, NOT CODED: cylinders 12, uneven 0.04 (nothing to
 * burble with), tilt 1.02 (bright, upper harmonics survive), red 8600, body
 * resonances up at 240/900Hz instead of 120/340 because the pipes are shorter,
 * drive low because a V12 is smooth rather than angry. Nothing else changes.
 */
const ENGINES = {
  // The one in the car. A big lazy cross-plane muscle V8.
  v8: { name: 'V8 cross-plane', cylinders: 8, uneven: 0.55, tilt: 1.30, base: 0.62,
        peak: 1.0, idle: 780, red: 6400, drive: 0.62,
        body: [[120, 1.0, 4], [340, 0.7, -2], [1800, 0.8, -4]] },
  // Flat-plane: same eight cylinders, even-fire, so the burble goes and a
  // hard European rasp arrives in its place. Same block, different crank.
  v8flat: { name: 'V8 flat-plane', cylinders: 8, uneven: 0.10, tilt: 1.05, base: 0.55,
            peak: 1.0, idle: 900, red: 8200, drive: 0.55,
            body: [[180, 1.1, 6], [520, 0.9, -3], [2400, 0.8, -4]] },
  v6: { name: 'V6 60-degree', cylinders: 6, uneven: 0.34, tilt: 1.35, base: 0.58,
        peak: 1.0, idle: 850, red: 6800, drive: 0.5,
        body: [[150, 1.1, 5], [420, 0.9, -4], [2000, 0.9, -6]] },
  v12: { name: 'V12', cylinders: 12, uneven: 0.04, tilt: 1.02, base: 0.5,
         peak: 1.0, idle: 1000, red: 8600, drive: 0.32,
         body: [[240, 1.3, 6], [900, 0.9, -3], [3200, 0.8, -3]] },
  w16: { name: 'W16', cylinders: 16, uneven: 0.22, tilt: 1.18, base: 0.66,
         peak: 1.0, idle: 900, red: 6800, drive: 0.7,
         body: [[80, 1.4, 8], [260, 0.9, -4], [1500, 0.9, -6]] },
};

// ------------------------------------------------------------ time constants
//
// setTargetAtTime(v, t, tc) is a one-pole approach: 63% of the way in tc
// seconds, 95% in 3tc. Chosen against the 33ms frame the target phone gives
// us, so that a parameter is still moving when the next frame's value arrives
// — that is what makes it a slew rather than a staircase — without lagging
// far enough behind the picture to be heard as rubber.
//
//   PITCH 25ms   the tightest thing here. Revs are the instrument the player
//                reads, and pitch that lags the tacho feels like a broken
//                clutch. 25ms is under one frame at 30fps: audible as smooth,
//                not as late.
//   GAIN  55ms   levels can afford to be lazier and want to be: a wind track
//                that tracks speed instantly sounds like it is being faded by
//                hand.
//   FILT  70ms   filter cutoffs are the slowest, because a cutoff sweeping
//                fast is a sound in its own right (it is exactly what the dump
//                valve below uses) and we do not want that on the steady road.
//   FAST  18ms   for things that must arrive: the verge, and the brake.
const TC = { pitch: 0.025, gain: 0.055, filt: 0.070, fast: 0.018 };

// ------------------------------------------------------------------ noise
//
// GENERATED, NOT FETCHED. Two seconds of pink noise, made once, shared by the
// wind, the tyres, the verge, the brakes, the combustion roughness, the shift
// bark and the dump valve — every one of them is this same buffer through a
// different filter, which is why the noise side of the graph costs one source
// node instead of seven.
//
// PINK RATHER THAN WHITE because white noise is 3dB per octave too bright and
// sounds like a hiss from a broken television; pink is what air and rubber
// actually make. Paul Kellet's three-pole approximation, which is six
// multiplies a sample and runs once at startup.
//
// THE LOOP SEAM IS CROSSFADED. Pink noise has real low-frequency content, so
// the join between the end of the buffer and its start is a step, and a step
// is a click — once every two seconds, forever, which is the kind of fault
// that gets described as "there's something wrong with the sound" and never
// found. Generating an extra tail and blending it into the head removes it.
// THE NOISE IS SEEDED, NOT Math.random(). Two renders of the same lap have to
// come out sample-identical, or the only way to measure what a gearchange adds
// is to eyeball an envelope: with a fixed seed the harness can subtract a run
// without the shift from a run with it and be left holding the shift on its
// own. Nobody can hear the difference between one white noise and another.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pinkBuffer(ctx, secs) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * secs);
  const X = 2048;                      // crossfade length in samples
  const tmp = new Float32Array(n + X);
  const rnd = mulberry32(0x5EED1A);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n + X; i++) {
    const w = rnd() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.0990460;
    b1 = 0.96300 * b1 + w * 0.2965164;
    b2 = 0.57000 * b2 + w * 1.0526913;
    tmp[i] = (b0 + b1 + b2 + w * 0.1848) * 0.30;
  }
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  d.set(tmp.subarray(0, n));
  for (let i = 0; i < X; i++) {
    const a = i / X;
    d[i] = tmp[i] * a + tmp[n + i] * (1 - a);
  }
  return buf;
}

/**
 * A SOFT LIMITER AS THE LAST NODE, so nothing can ever clip.
 *
 * Linear below the knee — at normal volumes this curve does nothing at all and
 * is not a "sound" — then a tanh that asymptotes to 1.0 and cannot reach it.
 * A DynamicsCompressor would also work and costs more CPU, adds lookahead
 * latency, and pumps.
 *
 * THE LENGTH IS ODD ON PURPOSE. A WaveShaper maps input -1..+1 across the
 * curve and interpolates; with an even length there is no sample at exactly
 * zero, so silence in comes out as a tiny DC offset, and "silence when muted"
 * quietly stops being true. This project has already shipped one instrument
 * that indexed at a fractional offset and wrote a black PNG. 1025 puts index
 * 512 at exactly 0.
 */
function limiterCurve(n, knee) {
  const c = new Float32Array(n);
  const half = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const x = (i - half) / half;
    const a = Math.abs(x), s = x < 0 ? -1 : 1;
    c[i] = a <= knee ? x : s * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  }
  return c;
}

/** The engine's own drive: harder, and slightly asymmetric so it makes even
 *  harmonics as well as odd. Asymmetry puts a DC offset on the signal, which
 *  eats headroom for a sound nobody can hear, so a 30Hz highpass follows it. */
function driveCurve(n, amount) {
  const c = new Float32Array(n);
  const half = (n - 1) / 2;
  const k = 1 + amount * 6;
  for (let i = 0; i < n; i++) {
    const x = (i - half) / half;
    c[i] = Math.tanh(k * (x + 0.12 * x * x)) / Math.tanh(k * 1.12);
  }
  return c;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// --------------------------------------------------------------- the rig

export function createAudio(opts) {
  const cfg = Object.assign({ engine: 'v8', volume: 0.85 }, opts || {});
  // Object.assign copies an explicit `undefined` over the default, and a
  // master gain of undefined is a NaN that silently poisons the whole graph.
  if (typeof cfg.volume !== 'number') cfg.volume = 0.85;
  if (!ENGINES[cfg.engine]) cfg.engine = 'v8';

  const api = {
    ctx: null, muted: false, nodes: 0, writes: 0, engine: cfg.engine,
    ENGINES,
    resume, attach, update, setMuted, setEngine, spectrumOf,
  };

  // Every AudioParam this thing writes per frame, with the last value written,
  // so an unchanged parameter costs a comparison instead of a timeline event.
  // On a steady cruise most of them are unchanged most frames.
  let last = null;
  let g = null;                 // the graph, built by attach()
  let spec = ENGINES[cfg.engine] || ENGINES.v8;
  let started = false;          // has a context ever been made

  // Running state the frame loop does not give us.
  let load = 0.2, lastGear = 0, lastState = '', beeps = 0, launch = 0;

  // ------------------------------------------------------------ build it
  //
  // THE WHOLE GRAPH IS BUILT ONCE, and its node count is on api.nodes so the
  // claim in the report is a measurement rather than a memory. 27 persistent
  // nodes — 10 biquads, 3 oscillators, 1 buffer source, 11 gains, 2 shapers —
  // and tools/audio.mjs prints the number it actually built. Transients (a
  // shift, a beep, the finish) add at most 6 more for a third of a second and
  // are then collected.
  function attach(ctx, dest) {
    const N = () => { api.nodes++; };
    api.nodes = 0;
    last = Object.create(null);

    const noise = pinkBuffer(ctx, 2);
    const rawSrc = ctx.createBufferSource(); N();
    rawSrc.buffer = noise; rawSrc.loop = true;
    // ONE HIGHPASS FOR EVERY NOISE CHANNEL. Pink noise rises 3dB per octave
    // all the way to DC, and the tyre channel is a lowpass, so before this
    // existed the loudest thing in the whole mix was 30Hz of nothing: energy
    // the target phone's speaker cannot reproduce at all, eating headroom that
    // the parts you can hear then have to be turned down to fit. Measured: it
    // was beating the engine's own firing harmonic in the spectrum.
    const src = ctx.createBiquadFilter(); N();
    src.type = 'highpass'; src.frequency.value = 55; src.Q.value = 0.7;
    rawSrc.connect(src);

    const master = ctx.createGain(); N();
    master.gain.value = api.muted ? 0 : cfg.volume;
    const limiter = ctx.createWaveShaper(); N();
    limiter.curve = limiterCurve(1025, 0.70);
    limiter.oversample = 'none';          // cheapest, and it barely engages
    master.connect(limiter).connect(dest || ctx.destination);

    // ---- engine ----
    const oscA = ctx.createOscillator(); N();     // soft: part throttle
    const oscB = ctx.createOscillator(); N();     // hard: brighter, wide open
    const gA = ctx.createGain(); N();
    const gB = ctx.createGain(); N();
    gA.gain.value = 0.6; gB.gain.value = 0.1;
    const drive = ctx.createWaveShaper(); N();
    drive.curve = driveCurve(513, spec.drive);
    drive.oversample = '2x';
    const hp = ctx.createBiquadFilter(); N();
    hp.type = 'highpass'; hp.frequency.value = 30;
    const body = spec.body.map(([f, q, gain]) => {
      const b = ctx.createBiquadFilter(); N();
      b.type = 'peaking'; b.frequency.value = f; b.Q.value = q; b.gain.value = gain;
      return b;
    });
    const engGain = ctx.createGain(); N();
    engGain.gain.value = 0.0001;
    // A SEPARATE DUCK NODE, written only by the shift. The frame loop owns
    // engGain and an event owns this one; sharing a param between a
    // setTargetAtTime stream and a scheduled ramp means the stream cancels the
    // ramp on the very next frame, which is exactly how a shift lift turns
    // into nothing at all.
    const duck = ctx.createGain(); N();
    duck.gain.value = 1;

    oscA.connect(gA); oscB.connect(gB);
    gA.connect(drive); gB.connect(drive);
    let tail = drive.connect(hp);
    for (const b of body) tail = tail.connect(b);
    tail.connect(engGain);
    engGain.connect(duck).connect(master);

    // Combustion roughness: noise in a band that tracks the firing harmonic,
    // post-drive so it does not get squared up. The chuff between the notes.
    const combBP = ctx.createBiquadFilter(); N();
    combBP.type = 'bandpass'; combBP.frequency.value = 400; combBP.Q.value = 0.9;
    const combG = ctx.createGain(); N();
    combG.gain.value = 0;
    src.connect(combBP).connect(combG).connect(engGain);

    // ---- wind ----
    // Rises as the square of speed, like the pressure actually does, and gets
    // brighter with it. This does most of the work of "fast" that an engine on
    // its own cannot: an engine at 4000rpm sounds the same in second as in
    // fifth, and the road does not.
    const windHP = ctx.createBiquadFilter(); N();
    windHP.type = 'highpass'; windHP.frequency.value = 500; windHP.Q.value = 0.6;
    const windG = ctx.createGain(); N();
    windG.gain.value = 0;
    src.connect(windHP).connect(windG).connect(master);

    // ---- tyres on tarmac ----
    const tyreLP = ctx.createBiquadFilter(); N();
    tyreLP.type = 'lowpass'; tyreLP.frequency.value = 300; tyreLP.Q.value = 1.4;
    const tyreG = ctx.createGain(); N();
    tyreG.gain.value = 0;
    src.connect(tyreLP).connect(tyreG).connect(master);

    // ---- the verge ----
    // Scaled by st.off, so leaving the road sounds like a mistake as well as
    // costing time. A band of grit, amplitude-modulated by an LFO whose rate
    // rises with speed — that modulation is the difference between "noise" and
    // "wheels battering over something".
    const vergeBP = ctx.createBiquadFilter(); N();
    vergeBP.type = 'bandpass'; vergeBP.frequency.value = 700; vergeBP.Q.value = 0.7;
    const vergeG = ctx.createGain(); N();
    vergeG.gain.value = 0;
    const lfo = ctx.createOscillator(); N();
    lfo.type = 'sine'; lfo.frequency.value = 12;
    const lfoG = ctx.createGain(); N();
    lfoG.gain.value = 0;
    lfo.connect(lfoG).connect(vergeG.gain);       // adds to the frame's value
    src.connect(vergeBP).connect(vergeG).connect(master);

    // ---- brakes ----
    const brakeBP = ctx.createBiquadFilter(); N();
    brakeBP.type = 'bandpass'; brakeBP.frequency.value = 1500; brakeBP.Q.value = 3.5;
    const brakeG = ctx.createGain(); N();
    brakeG.gain.value = 0;
    src.connect(brakeBP).connect(brakeG).connect(master);

    rawSrc.start(0);
    lfo.start(0);
    oscA.start(0);
    oscB.start(0);

    g = { ctx, noise, master, limiter, oscA, oscB, gA, gB, drive, hp, body,
          engGain, duck, combBP, combG, windHP, windG, tyreLP, tyreG,
          vergeBP, vergeG, lfo, lfoG, brakeBP, brakeG };
    api.ctx = ctx;
    setEngine(api.engine);
    return api;
  }

  /**
   * NOTHING EXISTS UNTIL A GESTURE. Not a suspended context, not a silent
   * graph — no AudioContext at all, because a page that constructs one before
   * a touch gets a console warning on desktop and a permanently suspended
   * context on iOS. This is called from main.js's firstGesture(), which fires
   * on the first touch ANYWHERE including the buttons, and it is called again
   * on every touch after that, so it has to be idempotent and cheap.
   */
  function resume() {
    if (g) {
      if (g.ctx.state === 'suspended' && g.ctx.resume) g.ctx.resume();
      return api;
    }
    if (started) return api;
    started = true;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return api;                          // no Web Audio: stay silent
    try {
      // 'interactive' is the default and asks for the smallest buffer the
      // device will give. A game wants the latency; nothing here is a long
      // smooth pad that would rather have the safety.
      const ctx = new AC({ latencyHint: 'interactive' });
      attach(ctx, ctx.destination);
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    } catch (e) { g = null; }                     // refused: the game is silent
    return api;
  }

  function setEngine(name) {
    if (!ENGINES[name]) return api;
    api.engine = name;
    spec = ENGINES[name];
    if (!g) return api;
    // Soft and hard are the SAME stack with a different roll-off: part
    // throttle loses the top of the harmonic series, wide open keeps it. Two
    // waves crossfaded is a load-dependent timbre for one extra gain node,
    // where rebuilding the wave per frame would be an allocation per frame.
    g.oscA.setPeriodicWave(wave(g.ctx, stack(Object.assign({}, spec, { tilt: spec.tilt + 0.65 }))));
    g.oscB.setPeriodicWave(wave(g.ctx, stack(spec)));
    g.drive.curve = driveCurve(513, spec.drive);
    for (let i = 0; i < g.body.length; i++) {
      const [f, q, gain] = spec.body[i];
      g.body[i].frequency.value = f; g.body[i].Q.value = q; g.body[i].gain.value = gain;
    }
    return api;
  }

  /** The harmonic stack of an engine, for a harness that wants to assert on
   *  the specification as well as on the samples. */
  function spectrumOf(name) { return Array.from(stack(ENGINES[name] || spec)); }

  /**
   * MUTE IS A REAL ZERO, not a very small number.
   *
   * setTargetAtTime never arrives, so a "muted" master left on an exponential
   * approach is still emitting something forever, and a test asserting silence
   * measures -80dB and calls it silence. A short linear ramp to exactly 0 —
   * short enough to feel instant, long enough not to be a click — followed by
   * a limiter curve whose centre sample is exactly 0, gives samples that are
   * bit-for-bit zero. tools/audio.mjs asserts that.
   */
  function setMuted(m) {
    api.muted = !!m;
    try { localStorage.setItem('svu-racer-mute', api.muted ? '1' : '0'); } catch (e) {}
    if (!g) return api;
    const t = g.ctx.currentTime, p = g.master.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(api.muted ? 0 : cfg.volume, t + 0.04);
    return api;
  }

  // ------------------------------------------------------------- per frame

  /** setTargetAtTime, but only when the value has actually moved. */
  function ramp(key, param, v, tc, t, eps) {
    const p = last[key];
    if (p !== undefined && Math.abs(p - v) <= eps) return;
    last[key] = v;
    api.writes++;
    param.setTargetAtTime(v, t, tc);
  }

  /**
   * Called once per frame from main.js. Positional arguments rather than an
   * object, because an object literal here is one allocation per frame against
   * this project's own rule.
   *
   *   dt        seconds since the last frame
   *   st        window.RACER.st — speed, rev, gear, off
   *   race      window.RACER.race — state, t
   *   braking   the COMPUTED brake, which is the pedal or the key
   *   boosting  likewise
   *   maxSpeed  tune.maxSpeed, so revs can be turned back into road speed
   */
  function update(dt, st, race, braking, boosting, maxSpeed) {
    if (!g) return;
    const ctx = g.ctx, t = ctx.currentTime;
    const state = race ? race.state : 'racing';

    // --- what the engine is being asked to do -------------------------------
    let rev = st.rev, v = maxSpeed > 0 ? st.speed / maxSpeed : 0;

    if (state === 'countdown' || state === 'grid') {
      // ON THE LINE. The throttle is dead and st.rev is 0, so the car would sit
      // there idling through the whole light sequence — which is not what the
      // grid of a drag race sounds like. Blip it, once per light, and hold it
      // on the last one ready for the launch.
      const rt = race ? race.t : 0;
      const blip = (t0) => { const u = (rt - t0) / 0.5; return u > 0 && u < 1 ? Math.sin(Math.PI * u) : 0; };
      const held = rt > 2.85 ? clamp((rt - 2.85) / 0.3, 0, 1) : 0;
      rev = 0.10 + 0.60 * Math.max(blip(0.30), blip(1.30), blip(2.30)) + 0.70 * held;
      rev = clamp(rev, 0, 1);
      launch = rev;
      v = 0;
    }

    // Load: the throttle is always on in this game, so load is really "is the
    // player asking for anything" — braking is a lift, boost is more than
    // wide open. Smoothed here rather than at the AudioParam because two
    // parameters read it.
    const wantLoad = braking ? 0.10 : boosting ? 1.0 : 0.80;
    load += (wantLoad - load) * clamp(dt * 6, 0, 1);

    // --- the engine ---------------------------------------------------------
    const rpm = spec.idle + rev * (spec.red - spec.idle);
    const f = rpm / 120;                       // cycle fundamental, k=1
    // THE TWO OSCILLATORS STRADDLE THE TRUE FREQUENCY, 0.55% either side.
    // Two banks that are not quite in agreement is what a real engine is, and
    // the beating it produces at the firing harmonic (0.7Hz at idle, 5Hz at
    // the limiter) is the difference between an engine and an organ. They are
    // spread SYMMETRICALLY because the load crossfade moves the balance
    // between them: detuning one of the pair upward instead put the whole
    // engine 1.1% sharp at high load and dead on at low, which is a car that
    // goes fractionally out of tune with the throttle.
    ramp('fa', g.oscA.frequency, f * 0.9945, TC.pitch, t, f * 0.002);
    ramp('fb', g.oscB.frequency, f * 1.0055, TC.pitch, t, f * 0.002);

    const hard = clamp(0.12 + 0.88 * load * (0.30 + 0.70 * rev), 0, 1);
    ramp('ga', g.gA.gain, 0.75 * (1 - 0.75 * hard), TC.gain, t, 0.004);
    ramp('gb', g.gB.gain, 0.55 * hard, TC.gain, t, 0.004);
    // OVERALL ENGINE LEVEL, AND IT RISES STEEPLY WITH REVS ON PURPOSE.
    // It used to be (0.62 + 0.38*rev), which is 3.4dB from idle to the
    // limiter, and measurement caught what that meant: blipping the throttle
    // on the grid came out SEVEN DECIBELS QUIETER than idling, because the
    // 3.4dB gain was swamped by the exhaust EQ below moving the loudest
    // harmonic off a +7dB resonance and into a -5dB notch. A real engine gains
    // far more than 3dB between idle and 6,400rpm. 13.7dB here, and the notch
    // has been softened to match.
    ramp('eg', g.engGain.gain,
         0.34 * (0.34 + 0.66 * load) * Math.pow(0.30 + 0.70 * rev, 1.6),
         TC.gain, t, 0.003);
    // Combustion roughness sits an octave above the firing harmonic.
    ramp('cf', g.combBP.frequency, clamp(f * spec.cylinders * 2, 120, 5000), TC.filt, t, 8);
    ramp('cg', g.combG.gain, 0.10 * load * (0.3 + 0.7 * rev), TC.gain, t, 0.003);

    // --- wind and tyres -----------------------------------------------------
    const vv = clamp(v, 0, 1.3);
    ramp('wg', g.windG.gain, 0.34 * vv * vv, TC.gain, t, 0.003);
    ramp('wf', g.windHP.frequency, 420 + 900 * vv, TC.filt, t, 12);
    ramp('tg', g.tyreG.gain, 0.30 * Math.pow(vv, 1.1) * (1 - 0.10 * clamp(st.off, 0, 1)),
         TC.gain, t, 0.003);
    ramp('tf', g.tyreLP.frequency, 190 + 420 * vv, TC.filt, t, 6);

    // --- the verge ----------------------------------------------------------
    // A knee at 0.02 so that hairline contact with the paint does not rumble;
    // past that it climbs fast, because the point is that it should sound like
    // a mistake straight away rather than fading up as an ambience.
    const off = clamp((clamp(st.off, 0, 1) - 0.02) / 0.98, 0, 1);
    const vg = 1.05 * Math.sqrt(off) * (0.25 + 0.75 * vv);
    ramp('vg', g.vergeG.gain, vg, TC.fast, t, 0.003);
    ramp('vd', g.lfoG.gain, vg * 0.85, TC.fast, t, 0.003);
    ramp('vf', g.vergeBP.frequency, 380 + 900 * off, TC.filt, t, 12);
    ramp('vl', g.lfo.frequency, 7 + 34 * vv, TC.fast, t, 0.4);

    // --- brakes -------------------------------------------------------------
    ramp('bg', g.brakeG.gain, braking ? 0.34 * clamp(vv * 1.4, 0, 1) : 0, TC.fast, t, 0.003);
    ramp('bf', g.brakeBP.frequency, 1200 + 700 * vv, TC.filt, t, 12);

    // --- events -------------------------------------------------------------
    if (st.gear > lastGear) upshift(t, clamp(0.35 + 0.65 * vv, 0, 1));
    lastGear = st.gear;

    if (state !== lastState) {
      if (state === 'countdown') beeps = 0;
      // GO. A higher, longer note than the three that led up to it, on the
      // frame the lights actually go out rather than on a timer that might
      // have drifted from them.
      if (state === 'racing' && lastState === 'countdown') beep(t, 1180, 0.55, 0.22);
      if (state === 'done') finish(t);
      lastState = state;
    }
    if (state === 'countdown' && race && beeps < 3 && race.t >= 0.15 + beeps) {
      beep(t, 660, 0.16, 0.16);
      beeps++;
    }
  }

  // -------------------------------------------------------------- one-shots
  //
  // Built when they fire and thrown away. A BufferSourceNode that has stopped
  // is collectable, and these are the only allocations the audio side makes
  // after startup: about six nodes, three or four times a lap.

  /**
   * THE UPSHIFT. Three things at once, and it is the three together that make
   * it read as a gearchange rather than as a noise:
   *
   *   THE LIFT. The engine ducks to a third for 45ms and comes back over
   *   250ms. Our throttle is always on, so this is the only moment in the game
   *   where the driver's foot comes off — and that lift is what the whole
   *   sound hangs on.
   *
   *   THE BARK. Unburnt mixture going off in the pipe. A resonant thump at
   *   500Hz, 100ms, gone.
   *
   *   THE DUMP VALVE — the one that was asked for by name, "the dump sound boy
   *   racers have when they race off and take their foot off the pedal". It is
   *   a bandpass sweeping 3.2kHz down to 900Hz over 300ms with a fast attack:
   *   pressurised air escaping, pitch falling as the pressure does. The sweep
   *   is the whole trick — the same noise burst at a fixed frequency is a hiss.
   *
   * The pitch drop comes free: shifting up raises the gear's ceiling, st.rev
   * falls, and the oscillators follow it down on the pitch time constant.
   */
  function upshift(t, strength) {
    const ctx = g.ctx;
    const d = g.duck.gain;
    d.cancelScheduledValues(t);
    d.setValueAtTime(d.value, t);
    d.linearRampToValueAtTime(0.55, t + 0.045);
    d.linearRampToValueAtTime(1, t + 0.26);

    const bark = ctx.createBufferSource();
    bark.buffer = g.noise; bark.loop = true;
    const bf = ctx.createBiquadFilter();
    bf.type = 'lowpass'; bf.frequency.value = 500; bf.Q.value = 7;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(1.15 * strength, t + 0.008);
    bg.gain.exponentialRampToValueAtTime(0.0008, t + 0.10);
    bg.gain.setValueAtTime(0, t + 0.11);
    bark.connect(bf).connect(bg).connect(g.master);
    bark.start(t); bark.stop(t + 0.12);

    // THE ENVELOPE IS FOUR SEGMENTS, NOT TWO, and that is not decoration.
    // A single exponential from the peak down to silence over 285ms spends
    // almost the whole of that 285ms near the bottom: measured, the valve was
    // at 1.5% of its peak by +200ms, so the 3.2kHz-to-900Hz sweep that is the
    // entire point of the sound was happening in silence. Attack, a slow
    // plateau while the pressure bleeds off, then a tail — which is also what
    // a real valve does, because a plenum does not empty exponentially into a
    // vacuum. The measured brightness now falls 2.9kHz to 1.5kHz across it.
    const air = ctx.createBufferSource();
    air.buffer = g.noise; air.loop = true;
    const af = ctx.createBiquadFilter();
    af.type = 'bandpass'; af.Q.value = 3.5;
    af.frequency.setValueAtTime(3400, t + 0.02);
    af.frequency.exponentialRampToValueAtTime(900, t + 0.40);
    const ag = ctx.createGain(), pk = 2.6 * strength;
    ag.gain.setValueAtTime(0.0001, t + 0.02);
    ag.gain.exponentialRampToValueAtTime(pk, t + 0.05);
    ag.gain.exponentialRampToValueAtTime(pk * 0.5, t + 0.22);
    ag.gain.exponentialRampToValueAtTime(pk * 0.07, t + 0.36);
    ag.gain.exponentialRampToValueAtTime(0.0008, t + 0.44);
    ag.gain.setValueAtTime(0, t + 0.45);
    air.connect(af).connect(ag).connect(g.master);
    air.start(t + 0.02); air.stop(t + 0.46);
  }

  /** A start light. Square, because a start light is not a musical instrument,
   *  through an envelope with 6ms edges so it is a beep and not a click. */
  function beep(t, freq, dur, level) {
    const ctx = g.ctx;
    const o = ctx.createOscillator();
    o.type = 'square'; o.frequency.value = freq;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(level, t + 0.006);
    gn.gain.setValueAtTime(level, t + dur - 0.03);
    gn.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(gn).connect(g.master);
    o.start(t); o.stop(t + dur + 0.01);
  }

  /** The finish: three notes up, quickly, over the car still running. */
  function finish(t) {
    const ctx = g.ctx;
    const notes = [523.25, 659.25, 987.77];
    for (let i = 0; i < notes.length; i++) {
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = notes[i];
      const gn = ctx.createGain();
      const t0 = t + i * 0.13, len = i === 2 ? 0.9 : 0.22;
      gn.gain.setValueAtTime(0, t0);
      gn.gain.linearRampToValueAtTime(0.20, t0 + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0008, t0 + len);
      gn.gain.setValueAtTime(0, t0 + len + 0.005);
      o.connect(gn).connect(g.master);
      o.start(t0); o.stop(t0 + len + 0.02);
    }
  }

  // ------------------------------------------------------------- the switch
  //
  // A TESTER IN A QUIET ROOM MUST BE ABLE TO SILENCE IT, and must be able to
  // do it without finding the developer panel first — so the button is in the
  // player half of the control grid, not behind TOGGLE. It is wired from here
  // rather than from main.js so that the whole feature is one file plus a
  // three-line hook.
  //
  // IT REMEMBERS. Reloading the page is the most common thing a tester does,
  // and being blasted again on every reload is how a mute button gets
  // described as not working.
  function wire() {
    if (typeof document === 'undefined') return;
    try { if (localStorage.getItem('svu-racer-mute') === '1') api.muted = true; } catch (e) {}
    const el = document.getElementById('bMute');
    const label = () => { if (el) el.textContent = api.muted ? 'SOUND OFF' : 'SOUND ON'; };
    const toggle = (e) => {
      if (e) { e.stopPropagation(); e.preventDefault(); }
      setMuted(!api.muted); label();
    };
    if (el) {
      el.addEventListener('click', toggle);
      el.addEventListener('touchstart', toggle, { passive: false });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => { if (e.code === 'KeyM') toggle(null); });
    }
    label();
  }
  wire();

  return api;
}

/**
 * The one the game uses. Constructing it touches no audio hardware and makes
 * no AudioContext — tools/check.mjs runs headless with no audio device at all
 * and must not so much as warn.
 */
export const audio = createAudio();

// Exposed for the harnesses: tools/audio.mjs renders THIS module's graph
// through an OfflineAudioContext and asserts on the samples, so it needs the
// factory rather than the live instance.
if (typeof window !== 'undefined') window.__AUDIO = { createAudio, audio, ENGINES };
