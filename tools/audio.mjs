// DOES IT ACTUALLY MAKE THE SOUND IT CLAIMS TO MAKE?
//
// Audio cannot be screenshotted, and this project's history says that is
// exactly when an instrument goes wrong: about ten measuring tools here have
// been found broken — one graded the car from a camera angle nobody plays
// from, one scanned the wrong third of the frame and printed five tidy rows of
// nothing, one wrote a perfectly black PNG because it indexed at a fractional
// offset. A wrong audio test is worse than all of them, because it prints
// plausible numbers while the game is silent and nobody can tell by looking.
//
// So this renders the REAL graph — src/audio.js as it is bundled into
// docs/index.html, reached through window.__AUDIO — through an
// OfflineAudioContext, and asserts on the actual samples that come out. And
// FOUR OF THE CHECKS ARE NEGATIVE CONTROLS: the same analysis is fed something
// known to be wrong, and has to complain. A rise detector that cannot report a
// fall is not a rise detector.
//
// The lap trace is RECORDED FROM THE RUNNING GAME rather than written by hand
// here: the real physics, the real gearchanges, the real frame times of this
// container (which is slower than the target phone, so the parameter smoothing
// is being tested at a worse frame rate than it will ever see). It is then
// replayed frame by frame into the offline render by suspending the render at
// each frame boundary — which is the only way to drive a frame loop's worth of
// AudioParam writes into an offline context.
//
//   node tools/audio.mjs
//
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FILE = 'file://' + join(ROOT, 'docs', 'index.html');

const fails = [];
const ok = (cond, label, detail = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${detail ? '   ' + detail : ''}`);
  if (!cond) fails.push(label);
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage',
         // A headless container has no audio device. Chromium renders to a
         // null sink, which is all an OfflineAudioContext needs anyway.
         '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1008, height: 420 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(FILE, { waitUntil: 'load' });
await page.waitForFunction(() => window.RACER && window.__AUDIO, null, { timeout: 30000 });
await page.waitForTimeout(800);

// ---------------------------------------------------------------------------
// 0. SILENCE BEFORE THE FIRST GESTURE — measured on the live page, not offline.
//
// The claim is not "the volume is zero", it is that NO AudioContext exists at
// all: a page that constructs one before a touch gets a warning on desktop and
// a permanently suspended context on iOS, and "permanently suspended" is a
// game with no sound that no amount of tapping fixes.
const before = await page.evaluate(() => ({
  ctx: !!window.RACER.audio.ctx, nodes: window.RACER.audio.nodes,
}));
ok(before.ctx === false && before.nodes === 0,
   'no AudioContext exists before the first gesture',
   `ctx ${before.ctx}, nodes ${before.nodes}`);

// A REAL CLICK, on the body, in the capture phase — the same route a thumb
// takes. If firstGesture() were not wired to audio.resume() this stays null.
await page.mouse.click(504, 210);
await page.waitForTimeout(400);
const after = await page.evaluate(() => ({
  ctx: !!window.RACER.audio.ctx,
  state: window.RACER.audio.ctx ? window.RACER.audio.ctx.state : '-',
  nodes: window.RACER.audio.nodes,
  rate: window.RACER.audio.ctx ? window.RACER.audio.ctx.sampleRate : 0,
}));
ok(after.ctx && after.nodes > 0, 'the first gesture builds the graph and resumes it',
   `state ${after.state}, ${after.nodes} nodes, ${after.rate}Hz`);

// ---------------------------------------------------------------------------
// 1. RECORD A LAP FROM THE RUNNING GAME.
console.log('\n  recording a lap from the live game...');
const trace = await page.evaluate(async () => {
  const R = window.RACER;
  R.audio.setMuted(true);            // do not also drive the live context
  R.tune.holdX = 0;
  R.tune.si = 3; R.tune.maxSpeed = 210;
  // This container has no GPU. At the shipped pixel ratio it renders at 10fps,
  // which would make the recorded trace a string of clamped 100ms frames —
  // a worse frame rate than the target phone has ever produced, and not the
  // one the parameter smoothing is tuned for. Nothing here measures fill rate,
  // so nothing here should pay for it.
  R.renderer.setPixelRatio(0.4);
  R.scenery.count = 0;
  R.startRace();
  const rec = [];
  let prev = performance.now();
  await new Promise((done) => {
    let forced = false;
    const step = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      const el = R.race.elapsed;
      if (R.race.state === 'racing') {
        // An autopilot that drives like a player: shift at the limiter, run
        // wide onto the verge once, brake once, use the boost once.
        if (R.st.rev > 0.96 && R.st.gear < R.consts.GEARS.length - 1) R.st.gear++;
        R.pedal.brake = el > 8.0 && el < 9.0;
        R.pedal.boost = el > 10.5 && el < 12.5;
        R.tune.holdX = el > 5.5 && el < 7.0 ? 10.4 : 0;
        // Bring the finish line to us rather than driving 12,000 units for it.
        if (!forced && el > 13.5) {
          forced = true;
          R.st.dist = R.consts.RACE_FROM + R.consts.RACE_LEN - R.st.speed * 0.5;
        }
      }
      rec.push({
        dt, speed: R.st.speed, rev: R.st.rev, gear: R.st.gear, off: R.st.off,
        br: !!R.pedal.brake, bo: !!R.pedal.boost,
        state: R.race.state, rt: R.race.t, max: R.tune.maxSpeed,
      });
      if (R.race.state === 'done' && R.race.t > 1.6) { done(); return; }
      if (rec.length > 1600) { done(); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  R.pedal.brake = false; R.pedal.boost = false; R.tune.holdX = null;
  return rec;
});
const lapSecs = trace.reduce((a, f) => a + f.dt, 0);
const shifts = trace.filter((f, i) => i > 0 && f.gear > trace[i - 1].gear).length;
const maxOff = Math.max(...trace.map((f) => f.off));
console.log(`  ${trace.length} frames, ${lapSecs.toFixed(1)}s, ` +
            `${(trace.length / lapSecs).toFixed(1)} fps, ${shifts} upshifts, ` +
            `peak off-road ${maxOff.toFixed(2)}, top ${Math.max(...trace.map((f) => f.speed)).toFixed(0)}`);
ok(shifts >= 3 && maxOff > 0.3 && lapSecs > 8,
   'the recorded lap contains the things being measured',
   `${shifts} upshifts, off-road ${maxOff.toFixed(2)}, ${lapSecs.toFixed(1)}s`);

// ---------------------------------------------------------------------------
// STOP THE GAME BEFORE RENDERING ANY AUDIO. This cost an hour: an
// OfflineAudioContext driven by suspend/resume needs a main-thread task per
// frame boundary to write that frame's parameters, and the game's own
// requestAnimationFrame loop was holding the main thread for 100ms at a time
// on this GPU-less container. The renders were not wrong, they were 400x
// slower than they should have been, and the whole tool looked like a hang.
// Taking rAF away stops the loop dead — it re-arms itself every frame — and
// nothing below needs a picture.
await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

// ---------------------------------------------------------------------------
// 2. EVERYTHING ELSE HAPPENS IN THE PAGE, because that is where the Web Audio
// implementation is. The page returns numbers; the judgement is made here.
const M = await page.evaluate(async (trace) => {
  const A = window.__AUDIO;
  const SR = 44100;

  // ---- an FFT, because there is no other way to say what frequency a thing is
  // Iterative radix-2, in place. n must be a power of two.
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }

  /** Magnitude spectrum of N samples starting at `at`, Hann windowed. */
  function spectrum(x, at, N) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
      re[i] = (x[at + i] || 0) * w;
    }
    fft(re, im);
    const m = new Float64Array(N / 2);
    for (let i = 0; i < N / 2; i++) m[i] = Math.hypot(re[i], im[i]);
    return m;
  }

  /** The loudest frequency between lo and hi, parabolically interpolated so
   *  the answer is not quantised to the 5.4Hz bin width. */
  function peakHz(mag, lo, hi) {
    const df = SR / (mag.length * 2);
    const a = Math.max(1, Math.floor(lo / df)), b = Math.min(mag.length - 2, Math.ceil(hi / df));
    let bi = a, bv = -1;
    for (let i = a; i <= b; i++) if (mag[i] > bv) { bv = mag[i]; bi = i; }
    const y0 = mag[bi - 1], y1 = mag[bi], y2 = mag[bi + 1];
    const d = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1e-9);
    return (bi + Math.max(-1, Math.min(1, d))) * df;
  }

  /**
   * THE ENGINE'S FUNDAMENTAL, MEASURED WITHOUT ASSUMING WHICH HARMONIC IS
   * LOUDEST. The loudest partial is not always the firing one — a body
   * resonance can lift a neighbour past it — so scoring the loudest peak
   * against a predicted firing frequency would be a test that fails for the
   * right sound. This instead sweeps candidate cycle fundamentals across the
   * whole plausible range and scores each by the energy sitting on ITS
   * harmonics, weighted by the stack the synth was built from. The best fit is
   * the fundamental. No knowledge of the answer goes in.
   */
  function fitCycleHz(mag, stackAmps) {
    const df = SR / (mag.length * 2);
    let best = 0, bestS = -1;
    // Candidates span idle to the limiter of every engine in the file and no
    // more. Harmonics below 60Hz are IGNORED: pink noise rises toward DC, and
    // scoring that region let an absurd 5Hz candidate — whose harmonics all
    // land in the mud — beat the true fundamental at high revs. That was the
    // instrument reading the noise floor, and it printed a confident number
    // while doing it.
    for (let f = 5; f <= 75; f += 0.05) {
      let s = 0, w = 0;
      for (let k = 1; k < stackAmps.length && k * f < 6000; k++) {
        const a = stackAmps[k];
        if (a < 0.02) continue;
        // THE WEIGHT COUNTS EVEN WHEN THE BIN DOES NOT. Skipping the weight as
        // well as the score for sub-60Hz harmonics is what let a 5.2Hz
        // candidate win at low revs: it was scored on the two or three
        // harmonics of it that happened to land on real peaks and forgiven all
        // the rest. A candidate that can only explain a fifth of the stack
        // must be penalised for the other four fifths.
        w += a;
        if (k * f < 60) continue;
        const bin = Math.round(k * f / df);
        if (bin < 1 || bin >= mag.length) continue;
        s += a * Math.max(mag[bin - 1], mag[bin], mag[bin + 1]);
      }
      if (w > 0 && s / w > bestS) { bestS = s / w; best = f; }
    }
    return best;
  }

  /** Short-time RMS in 5ms hops. */
  function envelope(x, hop) {
    const n = Math.floor(x.length / hop);
    const e = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < hop; j++) { const v = x[i * hop + j]; s += v * v; }
      e[i] = Math.sqrt(s / hop);
    }
    return e;
  }

  /** RMS inside a frequency band, by Parseval on the same windowed spectrum.
   *  Only ever used as a RATIO of one moment to another, so the window's
   *  scaling cancels and no calibration is needed. */
  function bandRms(x, at, N, lo, hi) {
    const mag = spectrum(x, at, N);
    const df = SR / N;
    let s = 0;
    for (let i = Math.max(1, Math.floor(lo / df)); i < Math.min(mag.length, hi / df); i++) {
      s += mag[i] * mag[i];
    }
    return Math.sqrt(s) / N;
  }

  /** Spectral centroid over a band — how bright a moment is. */
  function centroid(x, at, N, lo, hi) {
    const mag = spectrum(x, at, N);
    const df = SR / N;
    let num = 0, den = 0;
    for (let i = Math.floor(lo / df); i < Math.min(mag.length, hi / df); i++) {
      num += i * df * mag[i]; den += mag[i];
    }
    return den > 0 ? num / den : 0;
  }

  function stats(x) {
    let peak = 0, sum = 0, over99 = 0, overKnee = 0, nonzero = 0;
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      if (a > peak) peak = a;
      if (a > 0.99) over99++;
      if (a > 0.70) overKnee++;
      if (x[i] !== 0) nonzero++;
      sum += x[i] * x[i];
    }
    return { peak, rms: Math.sqrt(sum / x.length), over99, overKnee, nonzero, n: x.length };
  }

  /** Largest sample-to-sample step in a window. A click is a step; a sound is
   *  not. Reported next to the same figure from a steady stretch, because the
   *  number only means something as a ratio. */
  function maxStep(x, a, b) {
    let m = 0;
    for (let i = Math.max(1, a); i < Math.min(x.length, b); i++) {
      const d = Math.abs(x[i] - x[i - 1]);
      if (d > m) m = d;
    }
    return m;
  }

  // ---- render a trace through the real graph -------------------------------
  //
  // ctx.suspend(t) is the only way to get a frame loop's worth of parameter
  // writes into an offline render: it stops the render at t, we write the
  // frame's parameters, and resume. The times have to land on 128-sample
  // render quantum boundaries or Chromium refuses, and two frames must never
  // quantise onto the same boundary.
  async function render(trace, opts) {
    opts = opts || {};
    const total = trace.reduce((a, f) => a + f.dt, 0) + 1.2;
    const A2 = A.createAudio({ engine: opts.engine || 'v8', volume: opts.volume });
    A2.setMuted(!!opts.muted);           // ALWAYS explicit: the live mute is
                                         // remembered in localStorage, and an
                                         // inherited mute would make every
                                         // measurement below a tidy zero.
    const ctx = new OfflineAudioContext(1, Math.ceil(total * SR), SR);
    A2.attach(ctx, ctx.destination);

    const st = { speed: 0, rev: 0, gear: 0, off: 0 };
    const race = { state: 'racing', t: 0 };
    const apply = (f) => {
      st.speed = f.speed; st.rev = f.rev; st.gear = f.gear; st.off = f.off;
      race.state = f.state; race.t = f.rt;
      A2.update(f.dt, st, race, f.br, f.bo, f.max);
    };
    apply(trace[0]);                     // frame 0 cannot be a suspend point

    let t = 0, lastQ = 0;
    const marks = [];
    for (let i = 1; i < trace.length; i++) {
      t += trace[i].dt;
      const q = Math.round(t * SR / 128) * 128 / SR;
      if (q <= lastQ || q >= total - 0.05) continue;
      lastQ = q;
      const f = trace[i];
      marks.push(q);
      ctx.suspend(q).then(() => { apply(f); ctx.resume(); });
    }
    const buf = await ctx.startRendering();
    return { x: buf.getChannelData(0), writes: A2.writes, nodes: A2.nodes,
             frames: marks.length + 1, secs: total };
  }

  // ---- synthetic traces ----------------------------------------------------
  const frame = (o) => Object.assign(
    { dt: 1 / 30, speed: 0, rev: 0, gear: 0, off: 0, br: false, bo: false,
      state: 'racing', rt: 0, max: 210 }, o);

  /**
   * A STEPPED SWEEP, NOT A CONTINUOUS ONE, and that is a measurement decision
   * rather than a convenience.
   *
   * Swept continuously, an 8192-sample analysis window is 186ms wide and the
   * revs move through it, so every peak is smeared across several bins and the
   * answer is a blur — worst at the bottom of the range where the fundamental
   * is 9Hz and the bins are 5.4Hz apart. Worse, a continuous sweep confounds
   * the two things being asked: does the pitch track the revs, and how far
   * does the smoothing make it lag. STEPS separate them. Each step holds for
   * 0.5s, which is twenty of the 25ms pitch time constant, and the window is
   * taken from the last 190ms of it — fully settled, no smear, and the
   * commanded rev is exactly known.
   */
  const STEPS = 12, STEP_S = 0.7;
  function sweepTrace(up) {
    const out = [];
    for (let s = 0; s < STEPS; s++) {
      const rev = (up ? s : STEPS - 1 - s) / (STEPS - 1);
      for (let i = 0; i < Math.round(STEP_S * 30); i++) {
        out.push(frame({ rev, speed: rev * 210 * 0.30, gear: 0 }));
      }
    }
    return out;
  }

  /** A steady hold on a bench: revs up, car stationary, so the comparison
   *  between two engines is of the engines and not of the wind over the car. */
  function holdTrace(secs, rev, gear) {
    const n = Math.round(secs * 30), out = [];
    for (let i = 0; i < n; i++) out.push(frame({ rev, gear, speed: 0 }));
    return out;
  }

  /** Three seconds at the limiter in third, with a change into fourth at 1.5s
   *  — or without it, which is the negative control. */
  function shiftTrace(withShift) {
    const out = [];
    for (let i = 0; i < 90; i++) {
      const t = i / 30;
      const shifted = withShift && t >= 1.5;
      out.push(frame({
        gear: shifted ? 3 : 2,
        speed: 134,
        rev: shifted ? 134 / (210 * 0.82) : 134 / (210 * 0.64),
      }));
    }
    return out;
  }

  const R = {};

  // ---- A. the fundamental tracks the revs ---------------------------------
  const stackV8 = A.audio.spectrumOf('v8');
  const specV8 = A.ENGINES.v8;
  const measureSweep = (x, up) => {
    const rows = [];
    // 16384 SAMPLES, NOT 8192, AND THAT IS NOT CAUTION. At idle the cycle
    // fundamental is 6.5Hz, so the harmonics are 6.5Hz apart — closer together
    // than a 186ms window's 5.4Hz bins. They merged into a continuum, every
    // candidate fundamental fitted it about equally well, and the fitter
    // returned a confident 18% error. 372ms gives 2.7Hz bins, which resolves
    // them. It is the same failure as photographing a stripe pattern finer
    // than the sensor and reporting the moire.
    const N = 16384;
    for (let s = 0; s < STEPS; s++) {
      const rev = (up ? s : STEPS - 1 - s) / (STEPS - 1);
      // The last 372ms of the step: settled, and entirely inside it.
      const at = Math.round(((s + 1) * STEP_S - 0.38) * SR);
      const mag = spectrum(x, at, N);
      const rpm = specV8.idle + rev * (specV8.red - specV8.idle);
      rows.push({
        rev,
        wantCycle: rpm / 120,
        wantFire: rpm / 120 * specV8.cylinders,
        peak: peakHz(mag, 40, 1400),
        fit: fitCycleHz(mag, stackV8),
      });
    }
    return rows;
  };
  const up = await render(sweepTrace(true));
  R.sweep = measureSweep(up.x, true);

  // NEGATIVE CONTROL 1: the same engine, revs falling. If the rise detector
  // cannot see this fall, it cannot see anything.
  const down = await render(sweepTrace(false));
  R.sweepDown = measureSweep(down.x, false);

  // NEGATIVE CONTROL 2: a signal we know is wrong — a fixed 220Hz tone with
  // noise on it, nothing to do with the game. Fed to the same two measurements.
  const fake = new Float32Array(Math.round(STEPS * STEP_S * SR) + SR);
  for (let i = 0; i < fake.length; i++) {
    fake[i] = 0.4 * Math.sin(2 * Math.PI * 220 * i / SR) + 0.02 * (Math.random() * 2 - 1);
  }
  R.sweepFake = measureSweep(fake, true);

  // ---- B. the upshift is a transient, not a click and not a silence -------
  const withShift = await render(shiftTrace(true));
  const without = await render(shiftTrace(false));
  const shiftAt = 1.5;
  /**
   * ENERGY IN THE EVENT WINDOW AGAINST ENERGY IN THE ROAD BEFORE IT, both as
   * MEANS over 20ms frames.
   *
   * The first version of this compared the single loudest 5ms frame against
   * the mean, and reported a 2.1x "transient" in a render with no gearchange
   * in it at all — because the peak of a short-window RMS of noise is
   * naturally twice its mean, and a detector that fires on that fires on
   * everything. The negative control is what caught it. Means against means.
   */
  const hop = Math.round(0.020 * SR);
  const measureEvent = (x) => {
    const env = envelope(x, hop);
    const idx = (t) => Math.round(t * SR / hop);
    const mean = (a, b) => { let s = 0, n = 0; for (let i = idx(a); i < idx(b); i++) { s += env[i]; n++; } return s / n; };
    const base = mean(0.6, 1.4);
    const evt = mean(shiftAt, shiftAt + 0.30);
    let above = 0, peak = 0, peakAt = 0;
    for (let i = idx(shiftAt); i < idx(shiftAt + 1.0); i++) {
      if (env[i] > base * 1.25) above++;
      if (env[i] > peak) { peak = env[i]; peakAt = i * hop / SR; }
    }
    return { base, evt, peak, peakAt, ratio: evt / base, durMs: above * 20 };
  };
  R.shift = measureEvent(withShift.x);
  R.noShift = measureEvent(without.x);   // NEGATIVE CONTROL 3

  // THE EVENT ON ITS OWN. The noise buffer is seeded, so these two renders are
  // sample-identical apart from the gearchange — subtract one from the other
  // and what is left IS the bark, the lift and the dump valve, with the road
  // and the wind exactly cancelled. Nothing else here can isolate them.
  const d = new Float32Array(withShift.x.length);
  for (let i = 0; i < d.length; i++) d[i] = withShift.x[i] - without.x[i];
  const denv = envelope(d, hop);
  const di = (t) => Math.round(t * SR / hop);
  let dpk = 0, dpkAt = 0;
  for (let i = di(1.4); i < di(2.2); i++) if (denv[i] > dpk) { dpk = denv[i]; dpkAt = i * hop / SR; }
  let dq = 0, dn = 0;
  for (let i = di(0.6); i < di(1.45); i++) { dq += denv[i]; dn++; }
  R.diff = {
    quietBefore: dq / dn,                     // must be ~0: proof the two renders really are identical
    peak: dpk, peakAt: dpkAt,
    // WHERE THE EVENT LIVES, AND IT IS A DIFFERENT QUESTION NOW. It used to be
    // worth asking whether the sound swept DOWNWARDS, because the dump valve's
    // falling 3.2kHz-to-900Hz band was the trick that made it read as escaping
    // air. The valve has been deleted — Anthony did not like it, and a
    // naturally-aspirated V8 has no compressor to vent — so the question is the
    // opposite one: is what is left a LOW thump rather than a hiss. Measured
    // across the whole audible range, not just above 700Hz, because a window
    // that starts above the bark would report a confident centroid for a sound
    // with no energy in the window at all.
    centEarly: centroid(d, Math.round((shiftAt + 0.03) * SR), 2048, 100, 9000),
    stepEvent: maxStep(d, Math.round(shiftAt * SR), Math.round((shiftAt + 0.45) * SR)),
    stepSteady: maxStep(withShift.x, Math.round(0.6 * SR), Math.round(1.4 * SR)),
    // THE BARK'S OWN BAND AGAINST THE VALVE'S OLD ONE. 300-800Hz is where the
    // 500Hz resonant thump sits. 1.4-2.2kHz at +200ms is exactly where the
    // deleted valve used to be at that instant, and it is measured for the
    // opposite reason it once was: it now has to stay DOWN. A pair of numbers
    // rather than one, because "the bark is loud" and "the valve is gone" are
    // two claims and a single band cannot carry both.
    barkBand: bandRms(d, Math.round((shiftAt + 0.03) * SR), 2048, 300, 800),
    barkRoad: bandRms(withShift.x, Math.round(1.0 * SR), 2048, 300, 800),
    valveBand: bandRms(d, Math.round((shiftAt + 0.20) * SR), 4096, 1400, 2200),
    roadBand: bandRms(withShift.x, Math.round(1.0 * SR), 4096, 1400, 2200),
    mixBefore: bandRms(withShift.x, Math.round(1.0 * SR), 4096, 1400, 2200),
    mixDuring: bandRms(withShift.x, Math.round((shiftAt + 0.20) * SR), 4096, 1400, 2200),
  };

  // ---- C. a whole lap: does anything clip -----------------------------------
  const lap = await render(trace);
  R.lap = stats(lap.x);
  R.lapWrites = lap.writes;
  R.lapFrames = lap.frames;
  R.lapSecs = lap.secs;
  R.nodes = lap.nodes;

  // THE LIMITER IS A SAFETY NET AND A SAFETY NET THAT HAS NEVER BEEN TESTED IS
  // A DECORATION. On the real mix it never engages (see the count above), so
  // drive the whole thing five times too loud and check it still cannot get
  // out past 1.0. If this ever went above 1.0, every phone that ever plays a
  // louder mix than the one measured today would crackle.
  const hot = await render(trace.slice(0, 200), { volume: 5 });
  R.hot = stats(hot.x);

  // ---- D. muted, and the control that stops that being a free pass ---------
  const lapMuted = await render(trace, { muted: true });
  R.muted = stats(lapMuted.x);

  // ---- E. the harmonic stack is really a parameter -------------------------
  // Half-order content (odd k) against integer-order content (even k) at the
  // same revs. The burble, as a number. A cross-plane V8 has a great deal of
  // it; a V12 has almost none, which is why one lopes and the other wails.
  // EACH HARMONIC IS MEASURED ABOVE ITS OWN LOCAL NOISE FLOOR. A bin that
  // contains nothing but the combustion hiss still has a magnitude in it, and
  // summing raw magnitudes counted that hiss as burble: the V12, which has
  // essentially no half-order content by construction, came out at 0.21
  // against the V8's 0.37 and the two were not distinguishable. The floor is
  // the median of the bins 8 to 24 away, which is far enough not to include
  // the harmonic's own skirt and near enough to be the same noise.
  const above = (mag, bin) => {
    const near = [];
    for (let d = 8; d <= 24; d++) { near.push(mag[bin - d] || 0); near.push(mag[bin + d] || 0); }
    near.sort((a, b) => a - b);
    const floor = near[near.length >> 1];
    return Math.max(0, Math.max(mag[bin - 1], mag[bin], mag[bin + 1]) - floor);
  };
  const oddEven = (x, spec) => {
    const mag = spectrum(x, Math.round(0.8 * SR), 16384);
    const df = SR / 16384;
    const f = (spec.idle + 0.7 * (spec.red - spec.idle)) / 120;
    let odd = 0, even = 0;
    for (let k = 1; k <= spec.cylinders * 2; k++) {
      const bin = Math.round(k * f / df);
      if (bin < 25 || bin >= mag.length - 25) continue;
      const v = above(mag, bin);
      if (k & 1) odd += v; else even += v;
    }
    return { odd, even, ratio: odd / (even || 1e-9), fire: f * spec.cylinders };
  };
  // ---- F. the countdown, the verge and the brake ---------------------------
  //
  // Otherwise these are three claims in a comment. Each is an A/B against a
  // render that is identical apart from the one thing being asserted, which
  // the seeded noise makes exact.

  /** The level in a band, every 20ms. */
  function bandTrack(x, lo, hi, N) {
    const hop = Math.round(0.02 * SR), out = [];
    for (let at = 0; at + N < x.length; at += hop) out.push({ t: at / SR, v: bandRms(x, at, N, lo, hi) });
    return out;
  }
  /** Where a band goes loud, as start times. Thresholded against its own
   *  median and peak, so it needs no absolute calibration. */
  function bursts(track) {
    const sorted = track.map((p) => p.v).sort((a, b) => a - b);
    const floor = sorted[sorted.length >> 1], top = sorted[sorted.length - 1];
    const res = [];
    let live = false;
    for (const p of track) {
      if (!live && p.v > floor + (top - floor) * 0.4) { live = true; res.push(+p.t.toFixed(2)); }
      else if (live && p.v < floor + (top - floor) * 0.15) live = false;
    }
    return res;
  }

  const cd = [];
  for (let i = 0; i < Math.round(3.2 * 30); i++) {
    cd.push(frame({ state: 'countdown', rt: i / 30, rev: 0, speed: 0 }));
  }
  for (let i = 0; i < 30; i++) cd.push(frame({ state: 'racing', rt: i / 30, rev: 0.9, speed: 30 }));
  const cdr = await render(cd);
  R.countdown = {
    three: bursts(bandTrack(cdr.x, 600, 730, 2048)),
    go: bursts(bandTrack(cdr.x, 1100, 1270, 2048)),
    // The engine has to be doing something on the line as well as the lights.
    // Broadband RMS mid-blip against RMS in a gap — and the gap window is
    // chosen to CLEAR the beeps: the first version sampled 1.05-1.20s, which
    // straddles the second light, so it compared the engine against a square
    // wave and reported the blip as 7dB QUIETER than idling.
    blip: stats(cdr.x.subarray(Math.round(0.50 * SR), Math.round(0.65 * SR))).rms,
    gap: stats(cdr.x.subarray(Math.round(0.95 * SR), Math.round(1.10 * SR))).rms,
  };

  // The finish. Three notes over the car still running; the top one is the
  // longest and the easiest to find.
  const fin = [];
  for (let i = 0; i < 15; i++) fin.push(frame({ state: 'racing', rt: i / 30, rev: 0.9, speed: 190 }));
  for (let i = 0; i < 60; i++) fin.push(frame({ state: 'done', rt: i / 30, rev: 0.8, speed: 170 }));
  const finr = await render(fin);
  R.finish = { notes: bursts(bandTrack(finr.x, 940, 1040, 2048)) };

  const road = (o) => {
    const out = [];
    for (let i = 0; i < 45; i++) out.push(frame(Object.assign({ speed: 150, rev: 0.9, gear: 3 }, o)));
    return out;
  };
  const flat = await render(road({}));
  const vergeR = await render(road({ off: 0.7 }));
  const brakeR = await render(road({ br: true }));
  const sub = (a, b) => {
    const o = new Float32Array(a.length);
    for (let i = 0; i < o.length; i++) o[i] = a[i] - b[i];
    return o;
  };
  const vd = sub(vergeR.x, flat.x);
  // The verge is not merely louder, it CHATTERS: an LFO whose rate rises with
  // speed modulates it, and that modulation is the difference between wheels
  // battering over something and a hiss. Measured as the ripple on its own
  // envelope, relative to its mean.
  const venv = envelope(vd, Math.round(0.005 * SR));
  let vm = 0, vs = 0;
  const vn = venv.length - 40;
  for (let i = 20; i < venv.length - 20; i++) vm += venv[i];
  vm /= vn;
  for (let i = 20; i < venv.length - 20; i++) vs += (venv[i] - vm) * (venv[i] - vm);
  R.verge = { flat: stats(flat.x).rms, on: stats(vergeR.x).rms, only: stats(vd).rms,
              modDepth: Math.sqrt(vs / vn) / vm };
  R.brake = {
    off: bandRms(flat.x, Math.round(0.8 * SR), 4096, 1000, 2500),
    on: bandRms(brakeR.x, Math.round(0.8 * SR), 4096, 1000, 2500),
  };

  const eng = {};
  for (const name of ['v8', 'v12']) {
    const r = await render(holdTrace(1.6, 0.7, 2), { engine: name });
    eng[name] = oddEven(r.x, A.ENGINES[name]);
    eng[name].measuredPeak = peakHz(spectrum(r.x, Math.round(0.8 * SR), 16384), 40, 2000);
    eng[name].rms = stats(r.x).rms;
  }
  R.engines = eng;

  return R;
}, trace);

// ---------------------------------------------------------------------------
// 3. THE JUDGEMENT, in node, on numbers measured in the page.

/**
 * DOES THE LOUDEST PARTIAL ACTUALLY GO UP.
 *
 * Two conditions, and the second one exists because of a negative control that
 * embarrassed the first: monotonic-non-decreasing ALONE says yes to a signal
 * that never changes at all, and a flat 220Hz tone sailed through it. A sweep
 * from idle to the limiter is a factor of six, so demanding a factor of three
 * end to end is generous and still impossible to pass by standing still.
 */
function risesThrough(rows) {
  let mono = true;
  for (let i = 1; i < rows.length; i++) if (rows[i].peak < rows[i - 1].peak * 0.99) mono = false;
  const grew = rows[rows.length - 1].peak / rows[0].peak;
  return { mono, grew, rises: mono && grew > 3 };
}
function worstPeak(rows) {
  let w = 0;
  for (const r of rows) {
    const e = 100 * (r.peak - r.wantFire) / r.wantFire;
    if (Math.abs(e) > Math.abs(w)) w = e;
  }
  return w;
}
/**
 * THE TEMPLATE FITTER IS ONLY ASKED WHERE IT CAN ANSWER, and the rule for that
 * is stated here rather than picked from whichever rows happened to pass.
 *
 * The analysis window is 372ms, so the bins are 2.69Hz apart. At idle the cycle
 * fundamental is 6.5Hz, which puts consecutive harmonics 2.4 bins apart — under
 * the Rayleigh criterion they are not two peaks, they are one smear, and a
 * template fitter handed a smear returns the octave. It did exactly that: 12.9
 * for 6.5, a confident 98% error. Three bins of separation is the classical
 * line and it is the line used, so the fitter is asked from 8.1Hz upward.
 * The check that covers the whole range INCLUDING idle is the peak one, which
 * needs no such resolution because it looks at one strong partial rather than
 * at the spacing between forty.
 */
const FIT_MIN_HZ = 3 * (44100 / 16384);
function worstFit(rows) {
  let w = 0, n = 0;
  for (const r of rows) {
    if (r.wantCycle < FIT_MIN_HZ) continue;
    n++;
    const e = 100 * (r.fit - r.wantCycle) / r.wantCycle;
    if (Math.abs(e) > Math.abs(w)) w = e;
  }
  return { w, n };
}

console.log('\n--- the fundamental against the revs -------------------------------');
console.log('   rev   want firing   loudest peak     err    want cycle     fitted      err');
for (const r of M.sweep) {
  const pe = 100 * (r.peak - r.wantFire) / r.wantFire;
  const fe = 100 * (r.fit - r.wantCycle) / r.wantCycle;
  const skip = r.wantCycle < FIT_MIN_HZ;
  console.log(`  ${r.rev.toFixed(2)}   ${r.wantFire.toFixed(1).padStart(9)}Hz ` +
              `${r.peak.toFixed(1).padStart(12)}Hz ${(pe.toFixed(1) + '%').padStart(7)}   ` +
              `${r.wantCycle.toFixed(2).padStart(8)}Hz ${r.fit.toFixed(2).padStart(9)}Hz ` +
              `${skip ? ' unresolved' : (fe.toFixed(1) + '%').padStart(8)}`);
}
const RU = risesThrough(M.sweep), pkWorst = worstPeak(M.sweep), fit = worstFit(M.sweep);
ok(RU.rises, 'the loudest partial rises all the way up the sweep',
   `${M.sweep[0].peak.toFixed(0)}Hz to ${M.sweep[M.sweep.length - 1].peak.toFixed(0)}Hz, ` +
   `${RU.grew.toFixed(1)}x, monotonic ${RU.mono}`);
// THIS IS THE CENTRAL CLAIM AND NOTHING TELLS IT WHERE TO LOOK. It takes the
// loudest thing between 40 and 1400Hz and asks whether that is where the
// firing harmonic was commanded to be. When the bass end of the harmonic stack
// was too strong the loudest partial was k=2 rather than k=8, and this went
// red by 70% — which is precisely the fault it exists to catch.
ok(Math.abs(pkWorst) < 2,
   'and the loudest partial IS the firing harmonic, at the commanded frequency',
   `worst error ${pkWorst.toFixed(1)}% over ${M.sweep.length} steps`);
ok(Math.abs(fit.w) < 6,
   'a template fit told nothing about which harmonic is loudest agrees',
   `worst error ${fit.w.toFixed(1)}% over the ${fit.n} resolvable steps`);

// -- negative controls for exactly those two checks --------------------------
const RD = risesThrough(M.sweepDown);
ok(!RD.rises, 'NEGATIVE CONTROL: the same check reports a DESCENDING sweep as not rising',
   `${M.sweepDown[0].peak.toFixed(0)}Hz down to ${M.sweepDown[M.sweepDown.length - 1].peak.toFixed(0)}Hz, ` +
   `monotonic ${RD.mono}, grew ${RD.grew.toFixed(2)}x`);

const RF = risesThrough(M.sweepFake), fakePk = worstPeak(M.sweepFake), fakeFit = worstFit(M.sweepFake);
ok(!RF.rises && Math.abs(fakePk) >= 2 && Math.abs(fakeFit.w) >= 6,
   'NEGATIVE CONTROL: a fixed 220Hz tone fails all three checks',
   `rises ${RF.rises} (grew ${RF.grew.toFixed(2)}x), peak error ${fakePk.toFixed(0)}%, ` +
   `fit error ${fakeFit.w.toFixed(0)}%`);

console.log('\n--- the upshift ----------------------------------------------------');
const S = M.shift, NS = M.noShift, D = M.diff;
console.log(`  steady road RMS  ${S.base.toFixed(4)}`);
console.log(`  event window RMS ${S.evt.toFixed(4)}  (${S.ratio.toFixed(2)}x)`);
console.log(`  above baseline   ${S.durMs}ms, loudest at +${((S.peakAt - 1.5) * 1000).toFixed(0)}ms`);
console.log(`  isolated event   peak RMS ${D.peak.toFixed(4)} at ` +
            `+${((D.peakAt - 1.5) * 1000).toFixed(0)}ms, ` +
            `${D.quietBefore.toExponential(1)} before it`);
console.log(`  its brightness   centroid ${D.centEarly.toFixed(0)}Hz at +30ms, 100Hz-9kHz`);
console.log(`  largest step     ${D.stepEvent.toFixed(4)} in the event, ` +
            `${D.stepSteady.toFixed(4)} on the steady road`);
console.log(`  bark vs road     ${(20 * Math.log10(D.barkBand / D.barkRoad)).toFixed(1)}dB ` +
            `in the 300-800Hz band the thump lives in`);
console.log(`  the old valve    ${(20 * Math.log10(D.mixDuring / D.mixBefore)).toFixed(1)}dB ` +
            `in 1.4-2.2kHz at +200ms — it used to lift this band, and must not now`);
// NOT A DROPOUT. The threshold is deliberately modest because the event
// CONTAINS a deliberate lift — the engine ducks to 55% for a moment, which is
// the driver's foot coming off — so demanding a big rise here would be
// demanding the wrong shape. The strong claims about this event are the
// isolated-transient and valve-band ones below; this one only has to rule out
// the failure where a gearchange is a hole in the sound.
ok(S.ratio > 1.15, 'the upshift is a lift and a bark, not a hole in the sound',
   `${S.ratio.toFixed(2)}x baseline over the 300ms window`);
ok(D.barkBand > D.barkRoad * 1.41,
   'the bark clears the road by more than 3dB in its own band, so it is audible',
   `${(20 * Math.log10(D.barkBand / D.barkRoad)).toFixed(1)}dB in 300-800Hz`);
// THE DELETION HAS ITS OWN TEST, because "we removed it" is a claim about the
// build that ships, not about the edit that was made. Put the air block back in
// upshift() and this goes red.
ok(D.mixDuring < D.mixBefore * 1.20,
   'THE DUMP VALVE IS GONE: its old band no longer lifts when the gear changes',
   `${(20 * Math.log10(D.mixDuring / D.mixBefore)).toFixed(1)}dB in 1.4-2.2kHz at +200ms`);
ok(S.durMs >= 60 && S.durMs <= 900, 'it lasts like an event, not a click and not a drone',
   `${S.durMs}ms above baseline`);
ok(D.quietBefore < 1e-6,
   'the two renders really are identical before the shift, so the difference IS the event',
   `${D.quietBefore.toExponential(1)} RMS before, ${D.peak.toFixed(4)} in it`);
ok(D.stepEvent < D.stepSteady * 3.5, 'it is a sound, not a discontinuity',
   `largest step ${D.stepEvent.toFixed(4)} vs ${D.stepSteady.toFixed(4)} steady`);
ok(D.centEarly < 1200, 'what is left is a low thump, not a hiss',
   `centroid ${D.centEarly.toFixed(0)}Hz across 100Hz-9kHz`);
ok(NS.ratio < 1.15,
   'NEGATIVE CONTROL: with no gearchange the same detector finds no transient',
   `${NS.ratio.toFixed(2)}x baseline, ${NS.durMs}ms`);

console.log('\n--- a whole lap ----------------------------------------------------');
const L = M.lap;
const db = (v) => (20 * Math.log10(v)).toFixed(1);
console.log(`  ${M.lapFrames} frames replayed over ${M.lapSecs.toFixed(1)}s`);
console.log(`  peak             ${L.peak.toFixed(4)}  (${db(L.peak)} dBFS)`);
console.log(`  RMS              ${L.rms.toFixed(4)}  (${db(L.rms)} dBFS)`);
console.log(`  crest factor     ${(L.peak / L.rms).toFixed(1)}x`);
console.log(`  samples over 0.99  ${L.over99} of ${L.n}`);
console.log(`  samples over the limiter knee (0.70)  ${L.overKnee} ` +
            `(${(100 * L.overKnee / L.n).toFixed(3)}%)`);
console.log(`  AudioParam writes  ${M.lapWrites} over ${M.lapFrames} frames ` +
            `= ${(M.lapWrites / M.lapFrames).toFixed(1)} per frame`);
console.log(`  persistent nodes   ${M.nodes}`);
ok(L.over99 === 0 && L.peak < 1.0, 'nothing clips across the lap',
   `peak ${L.peak.toFixed(4)}`);
ok(L.rms > 0.02, 'and it is not quietly doing nothing', `RMS ${db(L.rms)} dBFS`);
ok(L.peak / L.rms < 12, 'the crest factor is sane — no lone spike carrying the peak',
   `${(L.peak / L.rms).toFixed(1)}x`);
console.log(`  driven 5x too loud: peak ${M.hot.peak.toFixed(4)}, ` +
            `${M.hot.over99} samples over 0.99, ` +
            `${(100 * M.hot.overKnee / M.hot.n).toFixed(1)}% past the knee`);
ok(M.hot.peak < 1.0 && M.hot.over99 === 0 && M.hot.overKnee > 0,
   'the limiter holds a mix driven five times too loud below full scale',
   `peak ${M.hot.peak.toFixed(4)}`);

console.log('\n--- mute -----------------------------------------------------------');
console.log(`  muted peak ${M.muted.peak}, non-zero samples ${M.muted.nonzero} of ${M.muted.n}`);
ok(M.muted.nonzero === 0 && M.muted.peak === 0,
   'muted is bit-for-bit silence, not a very small number',
   `${M.muted.nonzero} non-zero samples`);
ok(L.nonzero > L.n * 0.9,
   'NEGATIVE CONTROL: unmuted is NOT silent, so the line above means something',
   `${(100 * L.nonzero / L.n).toFixed(1)}% of samples non-zero`);

console.log('\n--- the countdown, the verge and the brake --------------------------');
const C = M.countdown;
console.log(`  660Hz beeps at   ${C.three.join('s, ')}s`);
console.log(`  1180Hz GO at     ${C.go.join('s, ')}s`);
console.log(`  engine on the line: blip ${C.blip.toExponential(2)} vs gap ${C.gap.toExponential(2)} ` +
            `(${(20 * Math.log10(C.blip / C.gap)).toFixed(1)}dB)`);
ok(C.three.length === 3, 'three lights before the flag, one second apart',
   `${C.three.length} bursts at ${C.three.join(', ')}`);
ok(C.go.length === 1 && C.go[0] > 3.0 && C.go[0] < 3.4,
   'and a different, higher note on GO, at the moment the lights go out',
   `${C.go.length} burst at ${C.go.join(', ')}s of a 3.2s countdown`);
ok(C.blip > C.gap * 1.4, 'the engine is blipped on the line, not left idling',
   `${(20 * Math.log10(C.blip / C.gap)).toFixed(1)}dB louder mid-blip`);

const V = M.verge;
console.log(`  verge: road RMS ${V.flat.toFixed(4)} -> ${V.on.toFixed(4)} at off=0.7, ` +
            `the verge alone ${V.only.toFixed(4)}, ripple depth ${V.modDepth.toFixed(2)}`);
ok(V.on > V.flat * 1.41, 'leaving the road is audibly a mistake',
   `${(20 * Math.log10(V.on / V.flat)).toFixed(1)}dB louder at off=0.7`);
ok(V.modDepth > 0.25, 'and it chatters rather than hisses',
   `envelope ripple ${(100 * V.modDepth).toFixed(0)}% of its mean`);

console.log(`  finish chord at  ${M.finish.notes.join('s, ')}s (the race ends at 0.5s)`);
ok(M.finish.notes.length >= 1 && M.finish.notes[0] > 0.45 && M.finish.notes[0] < 1.1,
   'crossing the line plays something, on the frame it is crossed',
   `top note at ${M.finish.notes.join(', ')}s`);

const B = M.brake;
console.log(`  brake: 1-2.5kHz ${B.off.toExponential(2)} -> ${B.on.toExponential(2)}`);
ok(B.on > B.off * 1.41, 'the brake puts something in the band a brake lives in',
   `${(20 * Math.log10(B.on / B.off)).toFixed(1)}dB`);

console.log('\n--- the harmonic stack is a parameter --------------------------------');
for (const [name, e] of Object.entries(M.engines)) {
  console.log(`  ${name.padEnd(4)} firing harmonic wanted ${e.fire.toFixed(0)}Hz, ` +
              `loudest peak ${e.measuredPeak.toFixed(0)}Hz, ` +
              `half-order / integer-order energy ${e.ratio.toFixed(3)}`);
}
ok(M.engines.v8.ratio > M.engines.v12.ratio * 3,
   'the V8 burbles (half-orders) where the V12 does not',
   `${M.engines.v8.ratio.toFixed(3)} vs ${M.engines.v12.ratio.toFixed(3)}`);
ok(M.engines.v12.fire > M.engines.v8.fire * 1.4,
   'and the V12 fires far higher at the same point in the gear',
   `${M.engines.v12.fire.toFixed(0)}Hz vs ${M.engines.v8.fire.toFixed(0)}Hz`);

// ---------------------------------------------------------------------------
// WHAT IT COSTS US, on the thread that has 6ms spare. Web Audio's own DSP runs
// on its own thread and does not appear here; what appears here is the
// per-frame parameter writing, which is ours. Measured against the LIVE
// context — a real AudioContext, the one a player would have — by calling the
// hook exactly the way main.js does.
const cost = await page.evaluate(() => {
  const A = window.RACER.audio;
  const st = { speed: 0, rev: 0, gear: 0, off: 0 };
  const race = { state: 'racing', t: 0 };
  // Every input MOVES on every iteration, so the change-guards cannot skip the
  // work and report a cost nobody will ever see.
  const run = (n) => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      st.rev = 0.5 + 0.4 * Math.sin(i * 0.11);
      st.speed = 120 + 60 * Math.sin(i * 0.07);
      st.off = 0.3 + 0.3 * Math.sin(i * 0.05);
      A.update(1 / 30, st, race, false, false, 210);
    }
    return performance.now() - t0;
  };
  run(500);                                   // warm the JIT
  const ms = run(4000);
  return { per: ms / 4000 };
});
console.log('\n--- what the frame loop pays ---------------------------------------');
console.log(`  audio.update()   ${(cost.per * 1000).toFixed(1)}us per frame, every input moving`);
ok(cost.per < 0.25, 'the per-frame hook is a rounding error against a 33ms frame',
   `${(cost.per * 1000).toFixed(1)}us, ${(100 * cost.per / 33.3).toFixed(2)}% of a 30fps frame`);

ok(errors.length === 0, 'no console errors from the page', errors.join(' | '));

await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.join(', ')}` : '\nall audio checks passed');
process.exit(fails.length ? 1 : 0);
