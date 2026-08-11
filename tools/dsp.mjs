// THE MEASURING INSTRUMENTS, injected into the page as window.DSP.
//
// This file is never imported by node. It is dropped into the browser with
// page.addScriptTag({ path }) because that is where the Web Audio
// implementation lives, and a number measured anywhere else is a number about
// something other than the game.
//
// IT IS A SECOND IMPLEMENTATION ON PURPOSE. tools/audio.mjs carries its own
// FFT inside its page.evaluate, written independently, and both tools are
// pointed at the same v8 render: audio.mjs prints the firing harmonic of the
// v8 hold and so does tools/enginenote.mjs. If those two disagree by more than
// a bin, one of the two instruments is broken and the disagreement says so.
// That is worth more than the fifty lines it costs, in a repository whose
// history is a dozen confidently wrong measuring tools.
//
// Everything here is real-signal analysis. Nothing takes a hint about what
// the answer should be except where it says so in the argument list.

(function () {
  const SR = 44100;

  /** Iterative radix-2 FFT, in place. n must be a power of two. */
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

  /** Hann-windowed magnitude spectrum of N samples starting at `at`.
   *
   *  N IS 32768 EVERYWHERE THIS TOOL USES IT, and that is a resolution
   *  decision the lower engine forced. The cycle fundamental at the new idle is
   *  700/120 = 5.8Hz, so consecutive harmonics are 5.8Hz apart; audio.mjs's
   *  16384-sample window has 2.69Hz bins, which puts them 2.2 bins apart —
   *  under the three-bin Rayleigh line, so they are one smear and not forty
   *  peaks. 32768 gives 1.35Hz bins and 4.3 bins of separation. The window is
   *  743ms long, which is why the holds below are two seconds. */
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

  /**
   * THE POWER SPECTRUM AVERAGED OVER SEVERAL WINDOWS, AND EVERY SPECTRAL
   * NUMBER IN THIS FILE IS TAKEN FROM ONE OF THESE RATHER THAN FROM A SINGLE
   * WINDOW. This is not tidiness. A single window gave the WRONG ANSWER and it
   * gave it confidently.
   *
   * The engine is two oscillators detuned 0.55% either side of the true
   * frequency, which is what stops it sounding like an organ. That means every
   * harmonic k is really a PAIR of lines 0.011*k*f_cycle apart — 0.31Hz at
   * k=1, 5Hz at k=16 — and a pair of lines closer together than a bin is one
   * bin whose magnitude rises and falls as the two drift in and out of phase.
   * The beat period is 3.2 seconds at k=1. So the measured strength of the low
   * harmonics depends on WHERE IN THAT BEAT the window happened to land, and
   * the half-order ratio of one single render of one single engine measured
   * 0.339, 0.393, 0.495, 0.409, 0.440 and 0.446 at six window offsets 200ms
   * apart. Any one of those is quotable and five of them are wrong. The first
   * version of this tool reported 0.495 and it agreed beautifully with the
   * arithmetic, which is the most dangerous way for a measurement to be wrong.
   *
   * Averaging POWER over nine windows spread across three seconds — longer
   * than the slowest beat — is the standard cure and it works: the same six
   * offsets then give 0.359 to 0.369. Power, not magnitude, because the mean
   * power of two beating lines is the sum of their powers whatever the phase,
   * which is precisely the quantity that does not depend on when you looked.
   */
  function welch(x, at, N, nw, spanSamples) {
    const P = new Float64Array(N / 2);
    for (let w = 0; w < nw; w++) {
      const m = spectrum(x, at + Math.round(w * spanSamples / (nw - 1)), N);
      for (let i = 0; i < N / 2; i++) P[i] += m[i] * m[i];
    }
    const mag = new Float64Array(N / 2);
    for (let i = 0; i < N / 2; i++) mag[i] = Math.sqrt(P[i] / nw);
    return mag;
  }

  /** The loudest frequency between lo and hi, parabolically interpolated off
   *  the bin grid. The band is wide on purpose: it is a search, not a hint. */
  function peakHz(mag, lo, hi) {
    const df = SR / (mag.length * 2);
    const a = Math.max(1, Math.floor(lo / df)), b = Math.min(mag.length - 2, Math.ceil(hi / df));
    let bi = a, bv = -1;
    for (let i = a; i <= b; i++) if (mag[i] > bv) { bv = mag[i]; bi = i; }
    const y0 = mag[bi - 1], y1 = mag[bi], y2 = mag[bi + 1];
    const d = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1e-9);
    return (bi + Math.max(-1, Math.min(1, d))) * df;
  }

  /** The cycle fundamental, fitted against the stack the synth was built from
   *  and told nothing about which harmonic is loudest. Harmonics below 45Hz are
   *  scored as misses rather than skipped — a candidate that can only explain
   *  the top of the stack must be penalised for the bottom, which is what stops
   *  an absurd sub-harmonic winning on three lucky bins. */
  function fitCycleHz(mag, stackAmps, loHz) {
    const df = SR / (mag.length * 2);
    const floorHz = loHz || 45;
    let best = 0, bestS = -1;
    for (let f = 4; f <= 75; f += 0.02) {
      let s = 0, w = 0;
      for (let k = 1; k < stackAmps.length && k * f < 6000; k++) {
        const a = stackAmps[k];
        if (a < 0.02) continue;
        w += a;
        if (k * f < floorHz) continue;
        const bin = Math.round(k * f / df);
        if (bin < 1 || bin >= mag.length) continue;
        s += a * Math.max(mag[bin - 1], mag[bin], mag[bin + 1]);
      }
      if (w > 0 && s / w > bestS) { bestS = s / w; best = f; }
    }
    return best;
  }

  /**
   * HALF-ORDER AGAINST INTEGER-ORDER ENERGY. The burble, as one number.
   *
   * Odd k repeat once per two crank revolutions; even k once per revolution. A
   * cross-plane V8 has a great deal of the former and a V12 essentially none,
   * and that is the whole difference between a lope and a wail.
   *
   * THE LOCAL FLOOR IS MEASURED IN UNITS OF THE HARMONIC SPACING, not in bins,
   * and that matters precisely because this tool exists to compare two engines
   * at DIFFERENT pitches. audio.mjs takes its floor from the bins 8 to 24 away
   * and refuses any harmonic inside bin 25, which is a fixed number of HERTZ —
   * so when the engine drops 28% the same rule silently stops counting k=2, and
   * a ratio that moved because the bookkeeping moved is exactly the kind of
   * result this project keeps catching. Here the floor window is 0.30 to 0.70
   * of the gap to the next harmonic, so it scales with the engine and both
   * columns of the table count the same harmonic indices. `used` is returned
   * and printed so that any remaining asymmetry is visible rather than assumed
   * away.
   */
  function orderRatio(mag, N, cycleHz, cylinders) {
    const df = SR / N;
    const sp = cycleHz / df;                       // bins between harmonics
    const off0 = Math.max(3, Math.round(sp * 0.30));
    const off1 = Math.max(off0 + 3, Math.round(sp * 0.70));
    let odd = 0, even = 0;
    const used = [], lev = [];
    for (let k = 1; k <= cylinders * 2; k++) {
      const bin = Math.round(k * cycleHz / df);
      if (bin - off1 < 1 || bin + off1 >= mag.length) continue;
      const near = [];
      for (let d = off0; d <= off1; d++) { near.push(mag[bin - d]); near.push(mag[bin + d]); }
      near.sort((a, b) => a - b);
      const floor = near[near.length >> 1];
      const v = Math.max(0, Math.max(mag[bin - 1], mag[bin], mag[bin + 1]) - floor);
      if (k & 1) odd += v; else even += v;
      used.push(k); lev[k] = v;
    }
    return { odd, even, ratio: odd / (even || 1e-9), used, lev, spacingBins: sp };
  }

  /** Spectral centroid over a band — how bright a sound is, in Hz. Takes an
   *  already-computed magnitude spectrum, which in this file is always a
   *  welch() one, for the reason welch() gives. */
  function centroid(mag, N, lo, hi) {
    const df = SR / N;
    let num = 0, den = 0;
    for (let i = Math.max(1, Math.floor(lo / df)); i < Math.min(mag.length, hi / df); i++) {
      num += i * df * mag[i]; den += mag[i];
    }
    return den > 0 ? num / den : 0;
  }

  /**
   * ROUGHNESS, IN THE TIME DOMAIN, because "raunchy" is not only a spectrum.
   *
   * The half-orders around the firing harmonic are sidebands at plus and minus
   * the cycle rate, which is amplitude modulation — the engine's loudness
   * ripples several dozen times a second and the ear hears that as grain rather
   * than as pitch. Measured as the standard deviation of the envelope over its
   * own mean, so it is a ratio and needs no calibration. It is a SECOND AND
   * INDEPENDENT instrument for the same claim the order ratio makes: if the
   * stack got burblier, both must move, and if only one moves the change is in
   * the bookkeeping.
   *
   * THE ENVELOPE IS A HANN-WEIGHTED SLIDING RMS AND THE FIRST VERSION WAS NOT,
   * which its own negative control caught. Plain RMS over abutting 2ms blocks
   * reported 4.8% ripple on a PURE 220Hz SINE — there is no modulation on a
   * sine, that was the carrier's own cycles falling across the block edges in
   * different phases. A meter with a 4.8% floor cannot honestly be quoted to
   * three decimal places about a 46% reading. A 10ms Hann window slides instead
   * of abutting and is 2.3 carrier cycles long, which puts the carrier and its
   * second harmonic deep in the window's stopband while the thing being
   * measured — modulation at the 29Hz cycle rate, 0.29 of a cycle across the
   * window — passes almost untouched. On the same sine it now reads 0.001.
   */
  function modDepth(x, from, to) {
    const hop = Math.round(0.001 * SR);
    const W = Math.round(0.010 * SR);
    const win = new Float64Array(W);
    let wsum = 0;
    for (let i = 0; i < W; i++) { win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / W); wsum += win[i]; }
    const e = [];
    for (let at = from; at + W < to; at += hop) {
      let s = 0;
      for (let j = 0; j < W; j++) { const v = x[at + j] || 0; s += win[j] * v * v; }
      e.push(Math.sqrt(s / wsum));
    }
    let m = 0;
    for (const v of e) m += v;
    m /= e.length;
    let s = 0;
    for (const v of e) s += (v - m) * (v - m);
    return m > 0 ? Math.sqrt(s / e.length) / m : 0;
  }

  function rms(x, from, to) {
    let s = 0, n = 0;
    for (let i = from; i < to; i++) { const v = x[i] || 0; s += v * v; n++; }
    return Math.sqrt(s / n);
  }

  function peakAbs(x) {
    let p = 0;
    for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; }
    return p;
  }

  /** Float samples to a base64 16-bit PCM payload, so node can write a WAV
   *  without moving a megabyte of JSON across the bridge. */
  function pcm16(x) {
    const n = x.length;
    const b = new Uint8Array(n * 2);
    for (let i = 0; i < n; i++) {
      let v = Math.max(-1, Math.min(1, x[i]));
      v = Math.round(v * 32767);
      b[i * 2] = v & 255; b[i * 2 + 1] = (v >> 8) & 255;
    }
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
    return btoa(s);
  }

  window.DSP = { SR, fft, spectrum, welch, peakHz, fitCycleHz, orderRatio,
                 centroid, modDepth, rms, peakAbs, pcm16 };
})();
