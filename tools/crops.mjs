// THE SAME PATCH OF CITY, DRAWN AND RENDERED, SIDE BY SIDE AND MAGNIFIED.
//
// strokewidth.mjs says how wide our ink is. It cannot say what the ink is
// DRAWING. A number like "33% of the far field is in 5-8px runs" is either a
// fat outline or a row of merged dark buildings, and those want opposite
// fixes, so the numbers have to be read next to the pixels.
//
// Both inputs are 1024x559, so a crop box means the same thing in each. The
// output is nearest-neighbour magnified: a 1px hairline has to survive to the
// screen or you are grading a blur, not a line.
//
//   node tools/crops.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));

// x, y, w, h — chosen to sit inside strokewidth.mjs's three zones.
const CROPS = [
  { name: 'near facade, left', x: 30, y: 210, w: 250, h: 210, z: 2 },
  { name: 'near facade, right', x: 750, y: 210, w: 250, h: 210, z: 2 },
  { name: 'far city at the vanishing point', x: 430, y: 150, w: 164, h: 110, z: 4 },
];

const load = (p) => PNG.sync.read(readFileSync(p));
const REF = load(__j(ROOT, 'ref', 'target-high.png'));
const OURS = load(__j(ROOT, 'shots', 'night-3rd.png'));

// Lay the pairs out in a column: drawing on the left, ours on the right.
const GAP = 8;
let W = 0, H = 0;
for (const c of CROPS) { W = Math.max(W, c.w * c.z * 2 + GAP); H += c.h * c.z + GAP; }
const out = new PNG({ width: W, height: H });
out.data.fill(255);

let oy = 0;
for (const c of CROPS) {
  for (let s = 0; s < 2; s++) {
    const src = s ? OURS : REF;
    const ox = s * (c.w * c.z + GAP);
    for (let y = 0; y < c.h * c.z; y++) {
      for (let x = 0; x < c.w * c.z; x++) {
        const sx = c.x + (x / c.z | 0), sy = c.y + (y / c.z | 0);
        if (sx >= src.width || sy >= src.height) continue;
        const si = (sy * src.width + sx) * 4, di = ((oy + y) * W + ox + x) * 4;
        out.data[di] = src.data[si];
        out.data[di + 1] = src.data[si + 1];
        out.data[di + 2] = src.data[si + 2];
        out.data[di + 3] = 255;
      }
    }
  }
  oy += c.h * c.z + GAP;
}

const dst = __j(ROOT, 'shots', 'stroke-crops.png');
writeFileSync(dst, PNG.sync.write(out));
console.log(`wrote ${dst}  ${W}x${H}  (left = drawing, right = ours)`);
for (const c of CROPS) console.log(`  ${c.name}  @${c.z}x`);
