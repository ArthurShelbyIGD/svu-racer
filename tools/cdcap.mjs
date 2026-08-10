// The countdown numeral's CAP HEIGHT in device pixels, measured off a frame.
//
// Not the diff box that tools/racedash.mjs prints — that is the glyph plus its
// ink outline plus its cast shadow, and quoting it as "the numeral" would be
// quoting the shadow, which is the mistake the gear readout's first
// measurement made. This counts the amber (or green) FACE only, and it is
// restricted to a window around the middle of the frame so that the city's
// street lamps, which are also small and amber, cannot join in.
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';

for (const file of process.argv.slice(2)) {
  const png = PNG.sync.read(await readFile(file));
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0;
  for (let y = 150; y < 600; y++) {
    for (let x = 450; x < 1000; x++) {
      const i = (y * png.width + x) * 4;
      const R = png.data[i], G = png.data[i + 1], B = png.data[i + 2];
      // #ffae2e tinted white: R high, G about 0.68 R, B low.
      // #7bf05a: G very high, R about half of it, B low.
      //
      // AND THE AMBER TEST HAS TO REJECT THE DASHBOARD, which is wood: its
      // lit lip is (200,160,104) and passed an R-above-190 test happily, so
      // this tool reported a 4-pixel-tall countdown on frames that had none
      // and put the left edge of every box on the edge of its own scan
      // window. The numeral's face is (255,174,46), so the bar is R above 235.
      //
      // THE GREEN TEST HAS TO REJECT THE CAR'S OWN BONNET, which is lime and
      // fills the bottom of the windscreen. Sampled off the frames: the lit
      // band is (150,202,98) and the hot crest (209,246,179), against GO's
      // (123,240,90) — so the bar is G above 225 with R under 0.62 of it, and
      // the first version of this, which asked for G above 190, duly measured
      // the bonnet and reported a 74-pixel countdown on a frame that had none.
      const amber = R > 235 && G > R * 0.55 && G < R * 0.82 && B < 95;
      const green = G > 225 && R < G * 0.62 && B < 120;
      if (!amber && !green) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      n++;
    }
  }
  console.log(n
    ? `${file}: face ${y1 - y0 + 1} px tall, ${x1 - x0 + 1} wide, ` +
      `x ${x0}..${x1}, y ${y0}..${y1}, ${n} px`
    : `${file}: no countdown face found`);
}
