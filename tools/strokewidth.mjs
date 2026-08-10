// HOW WIDE IS AN INK LINE, IN PIXELS, AT NEAR AND FAR DEPTH?
//
// Anthony, on the car: the outline is "maybe three times thicker or more".
// Measured, it was 7.5x. He then asked whether the scenery has the same fault.
//
// The comparison is fair because ref/target-high.png is 1024x559 and
// tools/nightshots.mjs writes at exactly 1024x559, so a pixel is a pixel.
//
// THE SECOND QUESTION MATTERS MORE THAN THE FIRST. A drawn line has a constant
// width whatever it is drawing — a pen nib does not know how far away the
// building is. Our outlines are an inverted hull extruded in WORLD units, so
// they shrink with distance like everything else. If the drawing holds its line
// weight into the distance and ours falls away, the fault is not "too thick",
// it is "wrong kind of line", and thinning it would make the far field vanish.
//
//   node tools/strokewidth.mjs
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const ROOT = __d(__d(__f(import.meta.url)));

// Bands chosen off the reference: the near facades are the outer thirds, the
// far city is the middle where the avenue runs to its vanishing point.
const ZONES = [
  { name: 'near facades (outer thirds)', x: [[0, 300], [724, 1023]], y: [200, 430] },
  { name: 'mid distance',                x: [[330, 693]],            y: [200, 300] },
  { name: 'far city (round the vanish)', x: [[430, 593]],            y: [150, 250] },
];

function runs(path, zone) {
  const p = PNG.sync.read(readFileSync(path));
  const { width: w, data } = p;
  const dark = (x, y) => {
    const i = (y * w + x) * 4;
    return data[i] < 62 && data[i + 1] < 62 && data[i + 2] < 74;
  };
  const all = [];
  let rows = 0;
  for (let y = zone.y[0]; y <= zone.y[1]; y++) {
    rows++;
    for (const [xa, xb] of zone.x) {
      let n = 0;
      for (let x = xa; x <= xb; x++) {
        if (dark(x, y)) n++;
        else { if (n > 0 && n < 60) all.push(n); n = 0; }
      }
      if (n > 0 && n < 60) all.push(n);
    }
  }
  all.sort((a, b) => a - b);
  const px = zone.x.reduce((s, [a, b]) => s + (b - a + 1), 0) * rows;
  const inked = all.reduce((s, v) => s + v, 0);
  return {
    median: all.length ? all[all.length >> 1] : 0,
    mean: all.length ? all.reduce((s, v) => s + v, 0) / all.length : 0,
    p90: all.length ? all[Math.floor(all.length * 0.9)] : 0,
    perRow: all.length / rows,
    cover: 100 * inked / px,
    n: all.length,
  };
}

const REF = __j(ROOT, 'ref', 'target-high.png');
const OURS = __j(ROOT, 'shots', 'night-3rd.png');
console.log('\n  INK STROKE WIDTH IN PIXELS — both images 1024x559, so pixels compare directly\n');
console.log('  zone                            median  mean  p90  strokes/row  ink cover');
for (const z of ZONES) {
  for (const [label, path] of [['drawing', REF], ['ours   ', OURS]]) {
    const r = runs(path, z);
    console.log(`  ${(label === 'drawing' ? z.name : '').padEnd(31)} ${label}` +
                `  ${String(r.median).padStart(3)}  ${r.mean.toFixed(1).padStart(5)}` +
                ` ${String(r.p90).padStart(4)}  ${r.perRow.toFixed(1).padStart(10)}` +
                `  ${r.cover.toFixed(1).padStart(7)}%`);
  }
}
console.log('');

// IS A "STROKE" A LINE OR A DARK BUILDING? At distance our towers become dark
// masses against a paler sky, and a mass is a long run, not a line. Splitting
// the runs by length says which of the two the numbers above are describing —
// without it, "we have fewer strokes" could just mean "our far city is one
// solid blob" and the conclusion would be backwards.
function histogram(path, zone) {
  const p = PNG.sync.read(readFileSync(path));
  const { width: w, data } = p;
  const dark = (x, y) => {
    const i = (y * w + x) * 4;
    return data[i] < 62 && data[i + 1] < 62 && data[i + 2] < 74;
  };
  const buckets = { '1-2': 0, '3-4': 0, '5-8': 0, '9-20': 0, '21+': 0 };
  const ink = { '1-2': 0, '3-4': 0, '5-8': 0, '9-20': 0, '21+': 0 };
  const put = (n) => {
    const k = n <= 2 ? '1-2' : n <= 4 ? '3-4' : n <= 8 ? '5-8' : n <= 20 ? '9-20' : '21+';
    buckets[k]++; ink[k] += n;
  };
  for (let y = zone.y[0]; y <= zone.y[1]; y++) for (const [xa, xb] of zone.x) {
    let n = 0;
    for (let x = xa; x <= xb; x++) { if (dark(x, y)) n++; else { if (n) put(n); n = 0; } }
    if (n) put(n);
  }
  const tot = Object.values(ink).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(ink).map(([k, v]) => [k, 100 * v / tot]));
}
console.log('  WHERE THE BLACK ACTUALLY IS — % of inked pixels, by run length\n');
console.log('  zone                            run  1-2   3-4   5-8  9-20   21+');
for (const z of ZONES) {
  for (const [label, path] of [['drawing', REF], ['ours   ', OURS]]) {
    const h = histogram(path, z);
    console.log(`  ${(label === 'drawing' ? z.name : '').padEnd(31)} ${label}` +
                ['1-2', '3-4', '5-8', '9-20', '21+'].map((k) => h[k].toFixed(0).padStart(5)).join(' '));
  }
}
console.log('');
