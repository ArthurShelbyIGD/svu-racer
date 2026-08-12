// CAN THIS BE ADDED TO A HOME SCREEN, AND WILL IT LAUNCH LIKE AN APP?
//
// It matters more than it sounds. Anthony scanned a QR code from WhatsApp on
// his wife's Samsung; the QR scanner has its own browser, it refused fullscreen
// outright, and Android's landscape gesture bar sat on the controls. His
// conclusion — "these sort of things are what brakes a game" — is right, and
// you cannot fix it by choosing a nicer way to share the link, because QR
// scanners, Instagram, Facebook and most messaging apps all have their own
// webview and none of them will go fullscreen.
//
// The one reliable escape is Add to Home Screen. On iOS that has worked since
// the start via apple-mobile-web-app-capable. On ANDROID it only produces a
// real standalone window if the page has a web app manifest saying so —
// otherwise you get a bookmark that reopens the browser you were trying to
// leave.
//
// THE PAGE HAD A MANIFEST AND IT HAD NEVER WORKED. A static data: URL one,
// carrying `start_url: "."`, which cannot resolve against a data: URL — so
// Chrome dropped start_url, and a manifest without one is not installable.
// Nothing said so, because nobody had ever asked Chrome what it made of it.
// This asks, every run.
//
// IT HAS TO BE SERVED OVER HTTP. A manifest on a file:// page is rejected on
// origin grounds no matter what it says, so a test using the file:// path every
// other tool here uses would be measuring the protocol, not the page.
//
//   node tools/manifest.mjs
import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));

const fails = [];
const ok = (cond, label, detail = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${detail ? '   ' + detail : ''}`);
  if (!cond) fails.push(label);
};

const html = await readFile(__j(ROOT, 'docs', 'index.html'), 'utf8');
/** Serve the built page, optionally mangled, on an ephemeral port. */
const serve = (transform) => new Promise((done) => {
  const s = createServer((req, res) => {
    if (req.url === '/' || req.url.startsWith('/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(transform ? transform(html) : html);
    } else { res.writeHead(404); res.end(); }
  });
  s.listen(0, '127.0.0.1', () => done({ s, port: s.address().port }));
});

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

/** Ask Chrome — not the source — what manifest it ended up with. */
async function ask(transform) {
  const { s, port } = await serve(transform);
  const p = await b.newPage({ viewport: { width: 844, height: 390 } });
  await p.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.RACER, null, { timeout: 30000 });
  await p.waitForTimeout(900);
  const links = await p.evaluate(() =>
    [...document.querySelectorAll('link[rel=manifest]')].length);
  const cdp = await p.context().newCDPSession(p);
  const got = await cdp.send('Page.getAppManifest');
  let parsed = null;
  const b64 = (got.url || '').split('base64,')[1];
  if (b64) { try { parsed = JSON.parse(Buffer.from(b64, 'base64').toString()); } catch (e) {} }
  await p.close();
  s.close();
  return { origin: `http://127.0.0.1:${port}`, links, errors: got.errors || [], parsed };
}

console.log('\n  THE WEB APP MANIFEST, as Chrome sees it\n');
const r = await ask(null);
console.log(`   manifest links on the page   ${r.links}`);
console.log(`   Chrome's complaints          ${r.errors.length ? r.errors.map((e) => e.message).join('; ') : 'none'}`);
if (r.parsed) {
  console.log(`   name                         ${r.parsed.name}`);
  console.log(`   display                      ${r.parsed.display}  (override ${JSON.stringify(r.parsed.display_override)})`);
  console.log(`   orientation                  ${r.parsed.orientation}`);
  console.log(`   start_url                    ${r.parsed.start_url}`);
}

// EXACTLY ONE. Chrome takes the FIRST manifest link and ignores the rest, so a
// stale one left in the page silently wins over a good one added later — which
// is precisely what was happening.
ok(r.links === 1, 'there is exactly one manifest link, so there is no doubt which one wins',
   `${r.links} found`);
ok(r.errors.length === 0, 'Chrome parses it without complaint',
   r.errors.map((e) => e.message).join('; ') || 'clean');
ok(!!r.parsed, 'and it decodes to real JSON');
ok(r.parsed && r.parsed.start_url === r.origin + '/',
   'start_url points at the page it was built on — the thing the old one got wrong',
   r.parsed ? r.parsed.start_url : '-');
ok(r.parsed && (r.parsed.display === 'fullscreen' || r.parsed.display === 'standalone'),
   'installed, it launches without the browser around it', r.parsed ? r.parsed.display : '-');
ok(r.parsed && r.parsed.orientation === 'landscape',
   'and in landscape, which is the only way this game is playable',
   r.parsed ? r.parsed.orientation : '-');

// ---------------------------------------------------------------------------
// NEGATIVE CONTROLS. Two, because the two ways this can silently fail are
// different and the first version of this page had one of each.
console.log('\n  CONTROLS — both of these MUST come back broken\n');

// 1. The failure that was actually shipped: a start_url that cannot resolve.
const bad = await ask((h) => h.replace(
  "start_url: base, scope: base,", "start_url: '.', scope: '.',"));
console.log(`   start_url: "."               ${bad.errors.map((e) => e.message).join('; ') || 'no complaint'}`);
ok(bad.errors.length > 0,
   'CONTROL: a manifest with an unresolvable start_url is caught, not waved through',
   bad.errors.map((e) => e.message).join('; ') || 'NOTHING — this tool is blind');

// 2. The failure that hid it: a second, older link earlier in the document.
const two = await ask((h) => h.replace('<head>',
  `<head><link rel="manifest" href='data:application/manifest+json,{"name":"stale","start_url":"."}'>`));
console.log(`   a stale link added first     ${two.links} links, Chrome used "${two.parsed ? two.parsed.name : '(not base64)'}"`);
ok(two.links > 1 && !(two.parsed && two.parsed.name === 'SVU Racer'),
   'CONTROL: an older link earlier in the page wins, which is how the broken one survived',
   `${two.links} links present`);

await b.close();
console.log('');
if (fails.length) { for (const f of fails) console.log(`  FAILED: ${f}`); process.exit(1); }
console.log('  it can be installed, and it will launch like a game\n');
