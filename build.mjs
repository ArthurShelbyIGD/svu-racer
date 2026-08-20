// Build: bundle src/ with esbuild, inline it into shell/template.html, write
// one self-contained file to docs/.
//
// ONE FILE IS THE WHOLE POINT. It has to be openable from a link, from a
// download, from a phone, with no server and no assets beside it. So there are
// no external requests of any kind: no CDN, no textures, no models, no fonts.
// Everything is either code or generated at runtime.
//
// SIZE IS A FEATURE, not a nice-to-have. The target device is a Helio A22 with
// a PowerVR GE8320 on a possibly-poor connection: every kilobyte is download
// time AND parse time before the first frame. The previous project shipped
// 2.7MB and took seconds to start on that phone. Watch the number this prints.

import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MARKER = '/*__BUNDLE__*/';

const out = await build({
  entryPoints: [join(ROOT, 'src/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['es2020'],
  write: false,
  legalComments: 'none',
});

const js = out.outputFiles[0].text;
const template = await readFile(join(ROOT, 'shell/template.html'), 'utf8');

if (!template.includes(MARKER)) throw new Error(`template is missing ${MARKER}`);

// FUNCTION REPLACEMENT, NOT A STRING. A bundle contains `$&` and friends, and
// String.replace treats those as backreferences in the REPLACEMENT — which
// silently corrupts the output. This bit us on the last project; the build
// succeeded and the page was broken.
// THE BUILD STAMP. Anthony names his deliveries r19, r20 and so on, but a
// tester in a Discord has whatever file they downloaded whenever they
// downloaded it — and the fourth screenshot in a thread is worthless if nobody
// can say which build produced it. The commit hash is exact and free.
// A HASH OF THE BUNDLE, NOT OF THE COMMIT, and the difference matters now that
// the link is going out to strangers.
//
// The commit hash was exact and free and pointed at nothing. This game is built
// in a throwaway cloud container that gets reclaimed every few hours; each
// recovery starts a fresh `git init`, so the hash in a shipped build refers to
// a commit that exists in no repository on earth — and it looks authoritative
// enough that someone would try to match it against GitHub and conclude the
// build was corrupt.
//
// The bundle's own content hash cannot lie. Two testers on the same file report
// the same eight characters, a changed file always reports different ones, and
// it needs no repository to be meaningful.
const { createHash } = await import('node:crypto');
const stamp = createHash('sha256').update(js).digest('hex').slice(0, 8) +
              ' ' + new Date().toISOString().slice(0, 16).replace('T', ' ');

const html = template.replace(MARKER, () => js).split('__BUILD__').join(stamp);

await mkdir(join(ROOT, 'docs'), { recursive: true });
await writeFile(join(ROOT, 'docs', 'index.html'), html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`build: docs/index.html  ${kb} KB`);
