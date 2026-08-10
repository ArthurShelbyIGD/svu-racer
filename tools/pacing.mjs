// DOES THE CAP ACTUALLY DRAW WHAT IT SAYS? The readout is written by the same
// code as the cap, so it cannot be the evidence. This counts renderer.render()
// calls from OUTSIDE, via renderer.info.render.frame, and separately counts
// simulated steps via st.simT — the two numbers the cap is supposed to
// decouple.
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as f } from 'node:url';
import { dirname as d, join as j } from 'node:path';
const ROOT = d(d(f(import.meta.url)));
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const p = await b.newPage({ viewport: { width: 1008, height: 420 } });
await p.goto('file://' + j(ROOT, 'docs', 'index.html'), { waitUntil: 'load' });
await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
await p.waitForTimeout(1500);

console.log('\n  MEASURED IN A BROWSER (this container renders ~24Hz, so only the deeper');
console.log('  divisors show a change here — the shallow ones have nothing to skip):');
for (let i = 0; i < 4; i++) {
  const r = await p.evaluate(async (idx) => {
    const R = window.RACER;
    R.pace.i = idx;
    await new Promise((r) => setTimeout(r, 1000));      // settle
    const f0 = R.renderer.info.render.frame, s0 = R.st.simT, t0 = performance.now();
    await new Promise((r) => setTimeout(r, 4000));
    const wall = (performance.now() - t0) / 1000;
    return {
      cap: R.pace.divisors[idx], panelHz: R.pace.panelHz,
      drawHz: (R.renderer.info.render.frame - f0) / wall,
      simHz: null,
      simT: (R.st.simT - s0) / wall,
      drawn: R.pace.drawn, simmed: R.pace.simmed,
    };
  }, i);
  // The container's software renderer runs at ~15fps uncapped, so a cap ABOVE
  // that cannot be tested here — only the ratio below it means anything.
  console.log(`  1 in ${r.cap}   panel says ${r.panelHz}Hz   sim ${(r.simT * 100).toFixed(0)}%   drew ${r.drawHz.toFixed(1)}Hz`);
}
console.log('\n  simT% is simulated seconds per real second: it must stay near 100');
console.log('  at every cap, or the cap is slowing the CAR and not just the picture.\n');
await b.close();

// THE PHONE'S CASE CANNOT BE MEASURED HERE. This container renders at ~24Hz,
// so a cap of 30 has nothing to skip and the interesting behaviour — an even
// 1-in-2 alternation on a 60Hz panel — never happens. That part is proven
// arithmetically instead, by running the same accumulator the frame loop runs.
function pace(every, hz, n) {
  let v = 0, pattern = '';
  for (let i = 0; i < n; i++) {
    if (every > 1 && ++v < every) { pattern += '.'; continue; }
    v = 0; pattern += 'D';
  }
  const drew = [...pattern].filter((c) => c === 'D').length;
  return { pattern, hz: (drew / n) * hz };
}
console.log('  the accumulator on panels this container cannot produce:');
for (const [every, hz] of [[1, 60], [2, 60], [3, 60], [4, 60], [2, 120], [2, 90]]) {
  const r = pace(every, hz, 24);
  console.log(`   1 in ${every} on ${String(hz).padStart(3)}Hz -> ${r.hz.toFixed(1)}Hz  ${r.pattern}`);
}
console.log('');
