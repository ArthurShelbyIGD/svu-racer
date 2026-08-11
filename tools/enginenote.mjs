// WHAT THE ENGINE NOTE ACTUALLY IS, IN HERTZ, BEFORE AND AFTER.
//
// Anthony drove the game and said: "The audio sounds better without the dump
// valve hiss but would be even better if slightly lower in pitch. This pitch
// would be better for a tuned V6, V8's tend to be a bit lower and raunchy
// sounding."
//
// Two claims come out of that and they are separable, so they are measured
// separately here:
//
//   LOWER    the firing harmonic — 8 * rpm/120 for a V8 — at idle, in the
//            mid-range and at the limiter. It moved because the REV MAPPING
//            moved (spec.idle and spec.red), not because anything was detuned,
//            so the tacho, the gears and the sound still all read the same rev
//            fraction. A detune would have shown up here as the same drop and
//            would have been a lie about the machine.
//   RAUNCHY  three numbers, because "raunchy" is not one thing. Half-order
//            against integer-order energy is the burble. The second crank
//            order against the firing order is the cross-plane thump an octave
//            under the note. Envelope ripple is the same burble measured in the
//            time domain by a completely different method, so that a change in
//            the bookkeeping cannot move both.
//
// AND THE SPECTRAL CENTROID, which is here to catch the two ways this change
// could go wrong. Drop the revs and add bass and you get a drone or a fart:
// the centroid falls through the floor. Compensate too hard and you get a
// buzzsaw that happens to be low: it climbs. What is wanted is a centroid that
// falls WITH the engine and no faster, which is a low engine that is still as
// bright as itself, and that is what the assertion below says.
//
// HOW BEFORE IS MEASURED. Not from a git checkout and not from remembered
// numbers: the old specification is DATA, it is written out below, and it is
// injected into the live ENGINES table under another name so that both columns
// of the table are rendered by the SAME graph, the same stack(), the same
// oscillators and the same analysis on the same afternoon. The only difference
// between the two columns is the eight numbers in the spec.
//
// SIX NEGATIVE CONTROLS, because every measurement in this file has to be able
// to fail. They are labelled NEGATIVE CONTROL below and each one names the
// instrument it is trying to break.
//
//   node tools/enginenote.mjs
//
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FILE = 'file://' + join(ROOT, 'docs', 'index.html');
const OUT = join(ROOT, 'tools', 'out');
mkdirSync(OUT, { recursive: true });

const fails = [];
const ok = (cond, label, detail = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${detail ? '   ' + detail : ''}`);
  if (!cond) fails.push(label);
};

/** 16-bit mono PCM in a RIFF wrapper. Nothing here needs stereo or 24 bits;
 *  this is something to put in Anthony's ear, not a master. */
function wav(pcm, sr) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);            // PCM
  h.writeUInt16LE(1, 22);            // mono
  h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage',
         '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(FILE, { waitUntil: 'load' });
await page.waitForFunction(() => window.RACER && window.__AUDIO, null, { timeout: 30000 });
// The game's own rAF loop holds this container's single thread for 100ms at a
// time and an offline render driven by suspend/resume needs a task per frame
// boundary. Taking rAF away stops it dead; nothing here needs a picture.
await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
await page.addScriptTag({ path: join(ROOT, 'tools', 'dsp.mjs') });

// ---------------------------------------------------------------------------
// THE OLD SPECIFICATION, verbatim from src/audio.js at a6f4792 — the build
// Anthony drove and described as a tuned V6. It is the BEFORE column.
const OLD_V8 = {
  name: 'V8 cross-plane (as driven)', cylinders: 8, uneven: 0.55, tilt: 1.30,
  base: 0.62, peak: 1.0, idle: 780, red: 6400, drive: 0.62,
  body: [[120, 1.0, 4], [340, 0.7, -2], [1800, 0.8, -4]],
};

const R = await page.evaluate(async (OLD_V8) => {
  const A = window.__AUDIO, D = window.DSP, SR = D.SR;

  // ---- the two columns, and a control that proves the injection is faithful.
  A.ENGINES.v8old = OLD_V8;
  // A BYTE COPY OF THE CURRENT ENGINE UNDER A DIFFERENT NAME. If 'v8copy' and
  // 'v8' do not measure the same, then something about being injected — rather
  // than something about the numbers — is moving the answer, and the whole
  // before/after table is worthless. This is the first thing checked.
  A.ENGINES.v8copy = JSON.parse(JSON.stringify(A.ENGINES.v8));

  // ---- render the real graph, a frame at a time ----------------------------
  async function render(trace, engine) {
    const total = trace.reduce((a, f) => a + f.dt, 0) + 1.0;
    const A2 = A.createAudio({ engine });
    A2.setMuted(false);                 // never inherit the page's live mute
    const ctx = new OfflineAudioContext(1, Math.ceil(total * SR), SR);
    A2.attach(ctx, ctx.destination);
    const st = { speed: 0, rev: 0, gear: 0, off: 0 };
    const race = { state: 'racing', t: 0 };
    const apply = (f) => {
      st.speed = f.speed; st.rev = f.rev; st.gear = f.gear; st.off = f.off;
      race.state = f.state; race.t = f.rt;
      A2.update(f.dt, st, race, f.br, f.bo, f.max);
    };
    apply(trace[0]);
    let t = 0, lastQ = 0;
    for (let i = 1; i < trace.length; i++) {
      t += trace[i].dt;
      const q = Math.round(t * SR / 128) * 128 / SR;
      if (q <= lastQ || q >= total - 0.05) continue;
      lastQ = q;
      const f = trace[i];
      ctx.suspend(q).then(() => { apply(f); ctx.resume(); });
    }
    const buf = await ctx.startRendering();
    return buf.getChannelData(0);
  }

  const frame = (o) => Object.assign(
    { dt: 1 / 30, speed: 0, rev: 0, gear: 0, off: 0, br: false, bo: false,
      state: 'racing', rt: 0, max: 210 }, o);

  /** A steady hold ON A BENCH: the car is stationary, so windG, tyreG, vergeG
   *  and brakeG are all exactly zero and what is rendered is THE ENGINE ALONE.
   *  Every spectral number below is taken from one of these, which is why the
   *  centroid is the engine's brightness and not the road's. */
  const hold = (secs, rev) => {
    const out = [];
    for (let i = 0; i < Math.round(secs * 30); i++) out.push(frame({ rev, speed: 0 }));
    return out;
  };

  /** Four gears, wound out and changed at the top of each. This one is the
   *  whole mix — wind, tyres and the upshift bark — because it is for the ear.*/
  function pull() {
    const out = [];
    for (let i = 0; i < 20; i++) out.push(frame({ rev: 0.10, speed: 0 }));
    let speed = 24;
    for (let gr = 0; gr < 4; gr++) {
      const from = gr === 0 ? 0.14 : 0.60;
      const n = 36;
      for (let i = 0; i < n; i++) {
        speed += 1.5;
        out.push(frame({ rev: from + (1 - from) * (i / (n - 1)), gear: gr,
                         speed: Math.min(speed, 205) }));
      }
    }
    for (let i = 0; i < 12; i++) out.push(frame({ rev: 1, gear: 3, speed: 205 }));
    return out;
  }

  // ---- one engine, at one rev, measured every way this tool knows ----------
  //
  // THE HOLD IS 4.6 SECONDS AND NOT THE 2.2 IT STARTED AS. Nine analysis
  // windows spread over three seconds is what it takes to average out the
  // 3.2-second beat between the two detuned oscillators; see welch() in
  // tools/dsp.mjs for the six readings 200ms apart that proved a shorter hold
  // could not be trusted.
  const N = 32768;
  const AT = Math.round(0.9 * SR);      // settled: 16 gain time constants in
  const NW = 9, SPAN = Math.round(3.0 * SR);
  async function probe(engine, rev) {
    const spec = A.ENGINES[engine];
    const x = await render(hold(4.6, rev), engine);
    const mag = D.welch(x, AT, N, NW, SPAN);
    const stack = A.audio.spectrumOf(engine);
    const rpm = spec.idle + rev * (spec.red - spec.idle);
    const cycle = rpm / 120;
    const ord = D.orderRatio(mag, N, cycle, spec.cylinders);
    const kf = spec.cylinders, kb = kf / 2;
    return {
      rev, rpm, cycle,
      wantFire: cycle * kf,
      // A SEARCH ACROSS FIVE OCTAVES, given no hint of where the answer is. If
      // the loudest thing in the engine is not the firing harmonic then the
      // spec has gone wrong in the way this file's header warns about, and this
      // number is what says so.
      peak: D.peakHz(mag, 30, 3000),
      // And a template fit that is told the SHAPE of the stack but not its
      // frequency, so it cannot be fooled by one loud neighbour.
      fitFire: D.fitCycleHz(mag, stack) * kf,
      ratio: ord.ratio, used: ord.used.length, spacing: ord.spacingBins,
      // The cross-plane thump: crank order 2 against the firing order.
      beatDb: ord.lev[kb] > 0 && ord.lev[kf] > 0
        ? 20 * Math.log10(ord.lev[kb] / ord.lev[kf]) : NaN,
      centroid: D.centroid(mag, N, 60, 8000),
      mod: D.modDepth(x, AT, AT + Math.round(3.0 * SR)),
      rms: D.rms(x, AT, AT + Math.round(3.0 * SR)),
      peakAbs: D.peakAbs(x),
    };
  }

  /**
   * A THIRD INSTRUMENT FOR THE BURBLE, WITH NO FFT IN IT AT ALL.
   *
   * The odd and even amplitudes summed straight off the harmonic stack the
   * synth was built from — arithmetic on the spec, nothing rendered, nothing
   * analysed. It cannot be fooled by window length, bin spacing or a local
   * noise floor, and it therefore cannot fail in any of the ways an FFT-based
   * reading fails. What it CANNOT see is the graph: if the drive, the body
   * filters or the two-oscillator crossfade were mangling the stack, this
   * number would be right about the specification and wrong about the sound.
   *
   * So it is not a substitute for the rendered measurement, it is a check on
   * it — and when the two disagree the disagreement is the finding.
   *
   * AND THEY DO DISAGREE, BY A CONSISTENT FACTOR, WHICH IS ITSELF THE MOST
   * USEFUL THING THIS FILE MEASURED. Every engine renders with LESS half-order
   * energy than its stack asks for — v12 0.73 of it, flat-plane 0.72, the old
   * V8 0.91, the new V8 0.78 — and the engine with the hardest waveshaper
   * loses the most. That is the drive doing what a strong nonlinearity does:
   * it redistributes energy toward the components that are already strong,
   * which here means the firing order, at the expense of everything between.
   * It is why `uneven` had to be written at 0.95 to land a rendered 0.46, and
   * why anyone reading the spec and expecting 0.59 out of it would be wrong.
   * The assertion below therefore checks that the two agree on the ORDER of
   * the four engines, not on the value, and prints both.
   */
  function stackRatio(engine) {
    const a = A.audio.spectrumOf(engine);
    const cyl = A.ENGINES[engine].cylinders;
    let odd = 0, even = 0;
    for (let k = 1; k <= cyl * 2; k++) { if (k & 1) odd += a[k]; else even += a[k]; }
    return odd / even;
  }

  const out = { rows: {}, ctl: {}, stackRatio: {} };
  for (const e of ['v8old', 'v8', 'v12', 'v8flat']) out.stackRatio[e] = stackRatio(e);
  const REVS = [0, 0.7, 1];
  for (const eng of ['v8old', 'v8', 'v8copy', 'v12', 'v8flat']) {
    out.rows[eng] = [];
    // v8copy only needs the one point it is a control for; the rest are cheap
    // enough to take everywhere.
    const revs = eng === 'v8copy' || eng === 'v8flat' ? [0.7] : REVS;
    for (const rev of revs) out.rows[eng].push(await probe(eng, rev));
  }

  // ---- NEGATIVE CONTROLS on the instruments themselves ---------------------
  //
  // Synthetic signals whose answers are known by construction, fed to exactly
  // the functions above. A measurement that cannot be made to give the wrong
  // answer is not measuring anything.
  const n = Math.round(2.5 * SR);
  const tone = new Float32Array(n), off = new Float32Array(n), noise = new Float32Array(n);
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < n; i++) {
    tone[i] = 0.4 * Math.sin(2 * Math.PI * 220 * i / SR);
    off[i] = 0.4 * Math.sin(2 * Math.PI * 700 * i / SR);
    noise[i] = 0.25 * (rnd() * 2 - 1);
  }
  const v8 = A.ENGINES.v8;
  const cyc = (v8.idle + 0.7 * (v8.red - v8.idle)) / 120;
  const tmag = D.welch(tone, AT, N, NW, Math.round(1.0 * SR));
  out.ctl.tone = {
    peak: D.peakHz(tmag, 30, 3000),
    // WHAT THE TEMPLATE FIT CANNOT DO, stated here rather than discovered
    // later. Handed a bare 220Hz sine and the V8's stack shape, it answers
    // 27.3Hz — it has correctly found the cycle fundamental whose eighth
    // harmonic is the only peak in the signal, and 218Hz is within 5% of the
    // V8's own 229Hz. THE FIT CANNOT TELL AN ENGINE FROM A WHISTLE AT THE SAME
    // PITCH. That is not a bug in the fit, it is the reason the burble, the
    // beat and the ripple are measured separately: pitch alone is not the
    // claim being made about this sound. The fit's negative control is
    // therefore a tone at the WRONG pitch, below.
    fitFire: D.fitCycleHz(tmag, A.audio.spectrumOf('v8')) * v8.cylinders,
    centroid: D.centroid(tmag, N, 60, 8000),
    mod: D.modDepth(tone, AT, AT + Math.round(1.0 * SR)),
    ratio: D.orderRatio(tmag, N, cyc, v8.cylinders).ratio,
  };
  const omag = D.welch(off, AT, N, NW, Math.round(1.0 * SR));
  out.ctl.off = { peak: D.peakHz(omag, 30, 3000),
                  fitFire: D.fitCycleHz(omag, A.audio.spectrumOf('v8')) * v8.cylinders };
  const nmag = D.welch(noise, AT, N, NW, Math.round(1.0 * SR));
  out.ctl.noise = { centroid: D.centroid(nmag, N, 60, 8000), peak: D.peakHz(nmag, 30, 3000) };

  // ---- the files, for the ear ---------------------------------------------
  // 30ms of fade at each end, because a steady tone cut off at a file boundary
  // is a click and a click is all anyone hears.
  function fade(x, from, to) {
    const y = new Float32Array(to - from);
    y.set(x.subarray(from, to));
    const F = Math.round(0.03 * SR);
    for (let i = 0; i < F; i++) {
      const a = i / F;
      y[i] *= a; y[y.length - 1 - i] *= a;
    }
    return y;
  }
  out.files = {};
  for (const [tag, eng] of [['before', 'v8old'], ['after', 'v8']]) {
    const idle = await render(hold(2.6, 0), eng);
    const red = await render(hold(2.6, 1), eng);
    const run = await render(pull(), eng);
    out.files[`engine-idle-${tag}`] = D.pcm16(fade(idle, Math.round(0.5 * SR), Math.round(2.9 * SR)));
    out.files[`engine-redline-${tag}`] = D.pcm16(fade(red, Math.round(0.5 * SR), Math.round(2.9 * SR)));
    out.files[`engine-pull-${tag}`] = D.pcm16(fade(run, Math.round(0.2 * SR), run.length - Math.round(0.3 * SR)));
  }
  return out;
}, OLD_V8);

// ---------------------------------------------------------------------------
// 3. THE JUDGEMENT, in node, on numbers measured in the page.

const B = Object.fromEntries(R.rows.v8old.map((r) => [r.rev, r]));
const Aft = Object.fromEntries(R.rows.v8.map((r) => [r.rev, r]));
const pct = (a, b) => `${(100 * (a / b - 1)).toFixed(1)}%`;

console.log('\n=== THE ENGINE NOTE, BEFORE AND AFTER, IN HERTZ =====================');
console.log(`  BEFORE  ${OLD_V8.idle}-${OLD_V8.red}rpm  uneven ${OLD_V8.uneven}  tilt ${OLD_V8.tilt}  ` +
            `base ${OLD_V8.base}  beat 0  drive ${OLD_V8.drive}`);
const NEW = R.rows.v8[0];
console.log(`  AFTER   as built now — see the row values below\n`);
console.log('                              BEFORE        AFTER      change');
const line = (label, b, a, unit, fmt = 1) =>
  console.log(`  ${label.padEnd(26)}${(b.toFixed(fmt) + unit).padStart(10)}   ` +
              `${(a.toFixed(fmt) + unit).padStart(10)}   ${pct(a, b).padStart(8)}`);
line('firing at idle', B[0].wantFire, Aft[0].wantFire, 'Hz');
line('  as measured', B[0].peak, Aft[0].peak, 'Hz');
line('firing at 0.70 rev', B[0.7].wantFire, Aft[0.7].wantFire, 'Hz');
line('  as measured', B[0.7].peak, Aft[0.7].peak, 'Hz');
line('  template fit', B[0.7].fitFire, Aft[0.7].fitFire, 'Hz');
line('firing at the redline', B[1].wantFire, Aft[1].wantFire, 'Hz');
line('  as measured', B[1].peak, Aft[1].peak, 'Hz');
console.log('');
line('half-order / integer', B[0.7].ratio, Aft[0.7].ratio, '', 3);
line('  same, off the stack', R.stackRatio.v8old, R.stackRatio.v8, '', 3);
// A PERCENTAGE OF A DECIBEL IS NOT A QUANTITY. -10.8dB to -6.7dB is not "38%
// less", it is 4.1dB more, and printing the percentage here once made a real
// 2.6x change in energy read as a shrug.
console.log(`  ${'2nd order vs firing'.padEnd(26)}${(B[0.7].beatDb.toFixed(1) + 'dB').padStart(10)}   ` +
            `${(Aft[0.7].beatDb.toFixed(1) + 'dB').padStart(10)}   ` +
            `${((Aft[0.7].beatDb - B[0.7].beatDb >= 0 ? '+' : '') +
                (Aft[0.7].beatDb - B[0.7].beatDb).toFixed(1) + 'dB').padStart(8)}`);
line('envelope ripple', B[0.7].mod, Aft[0.7].mod, '', 3);
line('centroid, engine alone', B[0.7].centroid, Aft[0.7].centroid, 'Hz', 0);
line('  at the redline', B[1].centroid, Aft[1].centroid, 'Hz', 0);
line('engine RMS at 0.70', B[0.7].rms, Aft[0.7].rms, '', 4);
console.log(`\n  harmonics counted in the ratio: ${B[0.7].used} before, ${Aft[0.7].used} after ` +
            `(${B[0.7].spacing.toFixed(1)} / ${Aft[0.7].spacing.toFixed(1)} bins apart)`);

// -- LOWER -------------------------------------------------------------------
console.log('\n--- 1. LOWER --------------------------------------------------------');
const dropMid = 1 - Aft[0.7].wantFire / B[0.7].wantFire;
ok(dropMid > 0.24 && dropMid < 0.36,
   'the firing frequency fell by about a musical fourth',
   `${(100 * dropMid).toFixed(1)}% at 0.70 rev, ${B[0.7].wantFire.toFixed(0)}Hz -> ${Aft[0.7].wantFire.toFixed(0)}Hz`);
ok(Aft[0.7].wantFire > 205 && Aft[0.7].wantFire < 240,
   'and it lands in big-V8 territory rather than tuned-V6 territory',
   `${Aft[0.7].wantFire.toFixed(0)}Hz at 0.70 rev`);
for (const rev of [0, 0.7, 1]) {
  const r = Aft[rev];
  const e = 100 * (r.peak - r.wantFire) / r.wantFire;
  ok(Math.abs(e) < 3,
     `at rev ${rev.toFixed(2)} the LOUDEST partial in 30-3000Hz is still the firing harmonic`,
     `wanted ${r.wantFire.toFixed(1)}Hz, measured ${r.peak.toFixed(1)}Hz, ${e.toFixed(1)}%`);
}
const fe = 100 * (Aft[0.7].fitFire - Aft[0.7].wantFire) / Aft[0.7].wantFire;
ok(Math.abs(fe) < 4,
   'and a template fit that is told nothing about which harmonic is loudest agrees',
   `${Aft[0.7].fitFire.toFixed(1)}Hz vs ${Aft[0.7].wantFire.toFixed(1)}Hz, ${fe.toFixed(1)}%`);
// THE PITCH DROP IS IN THE MAPPING, NOT IN A DETUNE. rpm/120*cylinders is the
// only way the oscillator frequency is ever computed, so the same rev fraction
// that drives the tacho drives the note. Proved rather than asserted: the
// measured firing frequency equals cylinders * (idle + rev*(red-idle))/120 to
// within 3% at all three revs above, for BOTH specs. If a playback rate had
// been scaled anywhere, the measured value would not track the spec's own
// arithmetic.
const oldTracks = [0, 0.7, 1].every((r) => Math.abs(B[r].peak / B[r].wantFire - 1) < 0.03);
ok(oldTracks, 'the same identity held for the old spec, so the drop is the mapping and not a detune',
   `old: ${[0, 0.7, 1].map((r) => B[r].peak.toFixed(0) + '/' + B[r].wantFire.toFixed(0)).join('Hz  ')}Hz`);

// -- RAUNCHY -----------------------------------------------------------------
console.log('\n--- 2. RAUNCHY ------------------------------------------------------');
ok(Aft[0.7].ratio > 0.44 && Aft[0.7].ratio < 0.58,
   'half-order / integer-order energy is up in cross-plane V8 territory',
   `${Aft[0.7].ratio.toFixed(3)}, was ${B[0.7].ratio.toFixed(3)}`);
ok(Aft[0.7].ratio > B[0.7].ratio * 1.15, 'and it really moved, not just wobbled',
   `${(100 * (Aft[0.7].ratio / B[0.7].ratio - 1)).toFixed(0)}% more half-order energy`);
ok(Aft[0.7].beatDb > B[0.7].beatDb + 3,
   'the second crank order — the cross-plane thump under the note — is stronger',
   `${Aft[0.7].beatDb.toFixed(1)}dB below the firing order, was ${B[0.7].beatDb.toFixed(1)}dB`);
ok(Aft[0.7].mod > B[0.7].mod,
   'and an independent time-domain instrument agrees the engine is rougher',
   `envelope ripple ${Aft[0.7].mod.toFixed(3)} vs ${B[0.7].mod.toFixed(3)}`);
// THE THIRD INSTRUMENT, WITH NO FFT IN IT, RANKING THE SAME FOUR ENGINES.
// It cannot agree on the value — the drive eats some of the burble on the way
// out, which is measured and printed rather than assumed — but if it disagreed
// on the ORDER then either the graph is not making what the spec says or the
// analysis is broken, and there would be nothing here worth quoting.
const rank = (f) => ['v12', 'v8flat', 'v8old', 'v8'].map(f);
const rendered = rank((e) => (e === 'v8' ? Aft[0.7].ratio : e === 'v8old' ? B[0.7].ratio
  : e === 'v12' ? Object.fromEntries(R.rows.v12.map((r) => [r.rev, r]))[0.7].ratio
  : R.rows.v8flat[0].ratio));
const fromSpec = rank((e) => R.stackRatio[e]);
const sorted = (a) => a.every((v, i) => i === 0 || v > a[i - 1]);
console.log(`  burble, rendered vs straight off the spec: ` +
            rank((e) => e).map((e, i) => `${e} ${rendered[i].toFixed(3)}/${fromSpec[i].toFixed(3)}` +
              ` (x${(rendered[i] / fromSpec[i]).toFixed(2)})`).join(', '));
ok(sorted(rendered) && sorted(fromSpec),
   'the rendered burble and the stack arithmetic rank all four engines the same way',
   `rendered ${rendered.map((v) => v.toFixed(3)).join(' < ')}`);
ok(rendered.every((v, i) => v / fromSpec[i] > 0.6 && v / fromSpec[i] <= 1.0),
   'and the graph consistently DELIVERS LESS burble than the spec asks for, ' +
   'which is the waveshaper and is why uneven is written high',
   rank((e) => e).map((e, i) => `${e} x${(rendered[i] / fromSpec[i]).toFixed(2)}`).join(', '));

// -- NOT A DRONE, NOT A BUZZSAW ---------------------------------------------
console.log('\n--- 3. still an engine ----------------------------------------------');
const cRat = Aft[0.7].centroid / B[0.7].centroid, fRat = Aft[0.7].wantFire / B[0.7].wantFire;
console.log(`  centroid moved ${(100 * (cRat - 1)).toFixed(1)}% where the pitch moved ` +
            `${(100 * (fRat - 1)).toFixed(1)}%`);
ok(cRat > fRat,
   'brightness did NOT fall faster than pitch, so it is a low engine and not a drone',
   `centroid x${cRat.toFixed(2)} against pitch x${fRat.toFixed(2)}`);
ok(cRat < 1.30, 'and it did not turn into a buzzsaw to pay for it',
   `centroid ${B[0.7].centroid.toFixed(0)}Hz -> ${Aft[0.7].centroid.toFixed(0)}Hz`);
ok(Aft[0.7].rms > B[0.7].rms * 0.7 && Aft[0.7].peakAbs < 1.0,
   'the engine did not get quieter or start clipping on its own',
   `RMS ${B[0.7].rms.toFixed(4)} -> ${Aft[0.7].rms.toFixed(4)}, peak ${Aft[0.7].peakAbs.toFixed(3)}`);

// -- THE CONTROLS ------------------------------------------------------------
console.log('\n--- negative controls: every number above can fail -------------------');
const cp = R.rows.v8copy[0], live = Aft[0.7];
ok(Math.abs(cp.peak - live.peak) < 2 && Math.abs(cp.ratio - live.ratio) < 0.02,
   'CONTROL: the same spec injected under another name measures the same, so the ' +
   'table compares specs and not mechanisms',
   `${cp.peak.toFixed(1)}Hz / ${cp.ratio.toFixed(3)} vs ${live.peak.toFixed(1)}Hz / ${live.ratio.toFixed(3)}`);
ok(!(B[0.7].wantFire > 205 && B[0.7].wantFire < 240) && !(B[0.7].ratio > 0.44),
   'NEGATIVE CONTROL: the OLD spec, through this same instrument, FAILS both targets',
   `${B[0.7].wantFire.toFixed(0)}Hz and ratio ${B[0.7].ratio.toFixed(3)}`);
const T = R.ctl.tone, OFFT = R.ctl.off, NZ = R.ctl.noise;
ok(Math.abs(T.peak - 220) < 2,
   'NEGATIVE CONTROL: fed a 220Hz tone the peak finder says 220Hz, not what it was told to expect',
   `${T.peak.toFixed(1)}Hz`);
ok(Math.abs(100 * (OFFT.fitFire - live.wantFire) / live.wantFire) > 10,
   'NEGATIVE CONTROL: the template fit, handed a tone at the WRONG pitch, does not report the V8',
   `700Hz tone fits ${OFFT.fitFire.toFixed(0)}Hz against a wanted ${live.wantFire.toFixed(0)}Hz`);
// AND THE LIMIT OF THAT INSTRUMENT, ASSERTED SO IT CANNOT BE FORGOTTEN. At the
// RIGHT pitch a bare sine passes the fit inside 5%, because the fit is a pitch
// detector and a whistle has a pitch. This line exists to keep that written
// down next to the number, and to stop anyone promoting the fit into evidence
// that the sound is an engine. The burble, the beat and the ripple are that.
ok(Math.abs(100 * (T.fitFire - live.wantFire) / live.wantFire) < 10 && T.ratio < live.ratio * 0.5,
   'KNOWN LIMIT: a bare sine at the right pitch DOES pass the fit — and fails the burble',
   `fit ${T.fitFire.toFixed(0)}Hz vs ${live.wantFire.toFixed(0)}Hz wanted, but ratio ` +
   `${T.ratio.toFixed(3)} vs the engine's ${live.ratio.toFixed(3)}`);
ok(Math.abs(T.centroid - 220) < 30 && NZ.centroid > 2000,
   'NEGATIVE CONTROL: the centroid reads 220Hz for a 220Hz tone and thousands for noise, ' +
   'so it is measuring brightness',
   `tone ${T.centroid.toFixed(0)}Hz, white noise ${NZ.centroid.toFixed(0)}Hz`);
ok(T.mod < 0.02 && live.mod > T.mod * 5,
   'NEGATIVE CONTROL: the ripple meter reads ~0 on a steady tone, so the engine ripple is real',
   `tone ${T.mod.toFixed(4)} vs engine ${live.mod.toFixed(3)}`);
const v12 = Object.fromEntries(R.rows.v12.map((r) => [r.rev, r]));
const flat = R.rows.v8flat[0];
ok(v12[0.7].ratio < live.ratio * 0.25 && flat.ratio < live.ratio * 0.6,
   'NEGATIVE CONTROL: the same ratio code gives the even-fire engines almost no burble',
   `v8 ${live.ratio.toFixed(3)}, flat-plane ${flat.ratio.toFixed(3)}, v12 ${v12[0.7].ratio.toFixed(3)}`);
ok(v12[0.7].wantFire > live.wantFire * 2,
   'CONTROL: and the V12 still fires far higher at the same point in the gear, ' +
   'so the pitch instrument is not stuck on the V8',
   `${v12[0.7].wantFire.toFixed(0)}Hz vs ${live.wantFire.toFixed(0)}Hz`);

// -- THE FILES ---------------------------------------------------------------
//
// AND THEN THE FILES ARE READ BACK OFF THE DISK AND MEASURED AGAIN, in node,
// with no browser and no Web Audio anywhere in the path. Everything above this
// line is a measurement of something that existed inside a page for a few
// milliseconds; what Anthony actually listens to is six files, and this
// project has already shipped one tool that wrote a perfectly black PNG while
// printing five tidy rows of numbers about it. A Goertzel filter is four lines
// and needs no FFT: it gives the energy at one chosen frequency, so asking each
// file whether it has more energy at the NEW firing harmonic than at the OLD
// one is a direct question with a yes or no answer, and the two files have to
// answer it opposite ways round.
function goertzel(x, hz, sr) {
  const w = 2 * Math.PI * hz / sr, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) { const s = x[i] + c * s1 - s2; s2 = s1; s1 = s; }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / x.length;
}
function readPcm(buf) {
  const n = (buf.length - 44) >> 1, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(44 + i * 2) / 32768;
  return x;
}
console.log('\n--- for the ear ------------------------------------------------------');
const written = {};
for (const [name, b64] of Object.entries(R.files)) {
  const pcm = Buffer.from(b64, 'base64');
  const p = join(OUT, name + '.wav');
  writeFileSync(p, wav(pcm, 44100));
  const x = readPcm(readFileSync(p));
  let pk = 0, sum = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; sum += x[i] * x[i]; }
  written[name] = { x, peak: pk, rms: Math.sqrt(sum / x.length) };
  console.log(`  tools/out/${name}.wav  ${(x.length / 44100).toFixed(1)}s  ` +
              `peak ${pk.toFixed(3)}  RMS ${Math.sqrt(sum / x.length).toFixed(4)}`);
}
ok(Object.keys(R.files).length === 6, 'six files: idle, a pull through the gears and the redline, both ways',
   Object.keys(R.files).join(', '));
ok(Object.values(written).every((f) => f.rms > 0.01 && f.peak < 0.999),
   'every file has sound in it and none of them clips',
   Object.entries(written).map(([k, f]) => `${k.replace('engine-', '')} ${f.rms.toFixed(3)}`).join(', '));
// The redline hold is the clean test: one steady rev, so both candidate
// frequencies are stationary through the whole file.
const oldFire = OLD_V8.red / 15;
const redNew = R.rows.v8.find((r) => r.rev === 1).wantFire;
for (const [tag, want, other] of [['before', oldFire, redNew], ['after', redNew, oldFire]]) {
  const x = written[`engine-redline-${tag}`].x;
  const a = goertzel(x, want, 44100), b = goertzel(x, other, 44100);
  ok(a > b * 2,
     `the ${tag} WAV on disk really is the ${tag} engine: more energy at ${want.toFixed(0)}Hz ` +
     `than at ${other.toFixed(0)}Hz`,
     `${(20 * Math.log10(a / b)).toFixed(1)}dB, measured in node with no Web Audio in the path`);
}

ok(errors.length === 0, 'no console errors from the page', errors.join(' | '));

await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.join(', ')}` : '\nall engine-note checks passed');
process.exit(fails.length ? 1 : 0);
