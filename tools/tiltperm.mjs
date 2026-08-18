// CAN AN IPHONE PLAYER EVER TURN TILT STEERING ON?
//
// Anthony's daughter's iPhone: no motion prompt, ever. He switched TILT
// STEERING off and back on in Settings and still nothing, and concluded —
// reasonably — that the game does not work on iPhone. His words: "so unless
// something is wrong with the code there is little point in moving forward
// with the game."
//
// Something was wrong with the code. Two things:
//
//   1. THE ATTEMPT WAS LATCHED, NOT THE OUTCOME. main.js set `askedTilt = true`
//      and then asked, on the reasoning that iOS shows the dialog only once.
//      That is true of a REFUSAL. It is false of a call that THROWS — per spec
//      requestPermission raises NotAllowedError when there is no transient
//      activation, which means nothing was asked and nobody saw anything. One
//      such throw disabled asking for the whole session.
//
//   2. THE SETTINGS SWITCH NEVER ASKED. Toggling TILT STEERING flipped a
//      boolean. So the first thing any player tries could not possibly work.
//
// There is no iPhone here and there will not be one, so this fakes the only
// part of an iPhone that matters: `DeviceOrientationEvent.requestPermission`,
// injected before any of the game's code runs. That is enough to drive every
// branch, and — the point — to COUNT THE CALLS, which is what proves the
// switch is wired to anything at all.
//
// WHAT IT CANNOT PROVE: that real Safari accepts our gesture as transient
// activation. Only the phone can answer that, which is why the game now
// records what iOS actually said and shows it in Settings. If the next test
// still fails, the switch will say WHICH of the three it is.
//
//   node tools/tiltperm.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));
// Overridable so the harness can be pointed at an OLD build. A test that has
// only ever passed has not been shown to detect anything; this one was run
// against the pre-fix bundle and failed on 'throw-then-grant' and on 'deny',
// which is the evidence that it tests the bug rather than the fix. It fails all
// five there, and the line that matters in every one is "the switch MUST ask
// iOS and did not" with a call count of zero after two toggles — the exact
// thing Anthony did on his daughter's phone.
//
// Read honestly: because the harness dispatches clicks from script, the old
// build's FIRST-TAP path does not run here either, so the zero overstates that
// half. On a real phone the first touch did ask once. The switch asking zero
// times is not overstated: it is the whole of bug 2.
//   node tools/tiltperm.mjs /tmp/old.html
const PAGE = process.argv[2] ? 'file://' + process.argv[2]
                             : 'file://' + __j(ROOT, 'docs', 'index.html');

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

/**
 * @param mode  'grant' | 'deny' | 'throw' | 'throw-then-grant' | 'none'
 * 'none' is the negative control: a device with no requestPermission at all,
 * i.e. Android and every desktop. It must reach 'n/a' and must never show an
 * iOS instruction to a player who has no iOS.
 */
const run = async (mode) => {
  const p = await b.newPage({ viewport: { width: 720, height: 360 }, hasTouch: true });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  // BEFORE THE BUNDLE RUNS. main.js reads DeviceOrientationEvent at module
  // scope, so patching it after load would be patching a decision already made.
  await p.addInitScript((m) => {
    window.__tiltCalls = 0;
    if (m === 'none') { try { delete window.DeviceOrientationEvent.requestPermission; } catch (e) {} return; }
    if (!window.DeviceOrientationEvent) window.DeviceOrientationEvent = function () {};
    window.DeviceOrientationEvent.requestPermission = function () {
      const n = ++window.__tiltCalls;
      if (m === 'grant') return Promise.resolve('granted');
      if (m === 'deny') return Promise.resolve('denied');
      // Thrown SYNCHRONOUSLY, which is what "no transient activation" does and
      // is precisely the case the old latch mistook for a refusal.
      if (m === 'throw') { throw new DOMException('no activation', 'NotAllowedError'); }
      if (m === 'throw-then-grant') {
        if (n === 1) throw new DOMException('no activation', 'NotAllowedError');
        return Promise.resolve('granted');
      }
    };
  }, mode);
  await p.goto(PAGE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });

  const read = () => p.evaluate(() => ({
    perm: window.RACER.tilt.perm,
    calls: window.__tiltCalls,
    note: (document.querySelector('.sNote[data-n="tilt"]') || {}).textContent || '',
    warn: !!document.querySelector('.sNote[data-n="tilt"].sWarn'),
  }));

  // 1. a first real tap, the way a player arrives: on the menu.
  await p.evaluate(() => document.getElementById('mSettings').click());
  await p.waitForTimeout(300);
  const afterOpen = await read();

  // 2. the thing Anthony did — switch it off, then on again.
  //
  // DISPATCHED IN THE PAGE rather than with a real Playwright click, because a
  // real click has to win a hit test and the old build's full-screen crash
  // panel sits over the menu and eats it — the harness timed out against the
  // very build it was written to indict, which would have been a tool failing
  // to measure the thing it exists for.
  //
  // The trade is worth naming: a script-dispatched click carries NO transient
  // activation, so this proves the switch is WIRED to askTilt and cannot prove
  // real Safari accepts the gesture. That second half is unprovable here at
  // any price, which is why the game reports what iOS said instead.
  const flip = () => p.evaluate(() => {
    const el = document.querySelector('button.sSw[data-k="tilt"]');
    if (!el) throw new Error('no tilt switch in the settings panel');
    el.click();
  });
  await flip();
  await p.waitForTimeout(250);
  await flip();
  await p.waitForTimeout(600);
  const afterToggle = await read();

  await p.close();
  return { afterOpen, afterToggle, errs };
};

const EXPECT = {
  // mode              perm after toggling off/on      must the switch have asked?
  'grant':            { perm: 'granted', asked: true,  warn: false },
  'deny':             { perm: 'denied',  asked: true,  warn: true  },
  'throw':            { perm: 'blocked', asked: true,  warn: true  },
  // THE REGRESSION THAT MATTERS. First attempt fails for want of activation;
  // the player switches it off and on; the second attempt must actually happen
  // and must be allowed to succeed. Under the old code the first throw latched
  // and this could never reach 'granted'.
  'throw-then-grant': { perm: 'granted', asked: true,  warn: false },
  // The negative control.
  'none':             { perm: 'n/a',     asked: false, warn: false },
};

console.log('\n  A FAKE IPHONE, ONE ANSWER PER RUN\n');
console.log('   what iOS says            perm       asks   note shown to the player');
let bad = 0;
for (const mode of Object.keys(EXPECT)) {
  const r = await run(mode);
  const e = EXPECT[mode];
  const asked = r.afterToggle.calls > 0;
  const okPerm = r.afterToggle.perm === e.perm;
  const okAsk = asked === e.asked;
  const okWarn = r.afterToggle.warn === e.warn;
  // AND AN ANDROID PLAYER MUST NEVER BE TOLD ABOUT SAFARI. The note is the
  // part a human reads, so it is checked as text rather than as a flag.
  const leak = mode === 'none' && /iPhone|iOS|Safari/i.test(r.afterToggle.note);
  const ok = okPerm && okAsk && okWarn && !leak && !r.errs.length;
  if (!ok) bad++;
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${mode.padEnd(18)} ${String(r.afterToggle.perm).padEnd(9)} ` +
              `${String(r.afterToggle.calls).padStart(2)}     ${r.afterToggle.note.slice(0, 62)}`);
  if (!okPerm) console.log(`        perm should be '${e.perm}'`);
  if (!okAsk) console.log(`        the switch ${e.asked ? 'MUST ask iOS and did not' : 'must not ask and did'}`);
  if (!okWarn) console.log(`        the note should ${e.warn ? '' : 'not '}be marked as needing attention`);
  if (leak) console.log('        an iOS instruction was shown on a device with no iOS');
  if (r.errs.length) console.log(`        page errors: ${r.errs.join(' | ')}`);
}
await b.close();

console.log(bad ? `\n  ${bad} of ${Object.keys(EXPECT).length} FAILED\n`
                : `\n  every branch behaves, including the retry that used to be impossible.\n` +
                  `  What this cannot prove is that real Safari accepts our tap as\n` +
                  `  transient activation — only the phone can say, and now it does.\n`);
process.exit(bad ? 1 : 0);
