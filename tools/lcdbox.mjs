// WHERE THE RADIO'S DISPLAY ACTUALLY IS, in device pixels, measured off a
// frame rather than derived from the constants that drew it.
//
// The brief quoted 107 x 16. The arithmetic in cockpit.js says 128 x 16 at
// 1440x720, so one of the two is wrong and a readout laid out against the
// wrong number is a readout that runs off the end of the glass. This finds the
// dark-green rectangle by colour and prints its bounding box.
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';

const png = PNG.sync.read(await readFile(process.argv[2]));
// #2c4b46 with a pencil pass over it: green-dominant, dark, low saturation.
let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0;
for (let y = 500; y < 700; y++) {
  for (let x = 200; x < 700; x++) {
    const i = (y * png.width + x) * 4;
    const R = png.data[i], G = png.data[i + 1], B = png.data[i + 2];
    if (G > R + 12 && G > 45 && G < 130 && B > R && Math.abs(G - B) < 40) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      n++;
    }
  }
}
console.log(`green LCD pixels ${n}: x ${x0}..${x1} (${x1 - x0 + 1} wide), ` +
            `y ${y0}..${y1} (${y1 - y0 + 1} tall)`);
// and a row/column profile, so a stray pixel cannot inflate the box
const cols = [];
for (let x = x0; x <= x1; x++) {
  let c = 0;
  for (let y = y0; y <= y1; y++) {
    const i = (y * png.width + x) * 4;
    const R = png.data[i], G = png.data[i + 1], B = png.data[i + 2];
    if (G > R + 12 && G > 45 && G < 130 && B > R && Math.abs(G - B) < 40) c++;
  }
  cols.push(c);
}
console.log('column heights: ' + cols.join(''.padEnd(0)).replace(/(.{60})/g, '$1\n'));
