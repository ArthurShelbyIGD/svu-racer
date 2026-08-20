// THE FIVE THINGS ANTHONY NAMED, AS NUMBERS.
//
// ===========================================================================
// WHY A SECOND CAR HARNESS
// ===========================================================================
//
// tools/silhouette.mjs graded the car 95.6% side and 95.4% rear. Anthony looked
// at the same car and wrote:
//
//   1. "the roof extends to quite close to the center of the rear wheel before
//      it drops off to the boot, whereas the model's roof starts dropping off
//      in front of the rear wheel"
//   2. "the front quarter light is too large and the rear quarter light is
//      missing"
//   3. "from the rear the rear screen looks wrong, it extends up too far"
//   4. "the rear bodywork is kind of two pieces and the top part is way too
//      tall and the roof isn't visible above the rear screen"
//   5. "rear lights are also the wrong proportions, quite square with a slight
//      vertical rectangular shape. In the original art they are rectangular
//      horizontal in shape"
//
// and then: "Not certain how the score relates to 95.4% if I am brutally
// honest."
//
// He is right, and tools/faultmap.mjs shows why in a picture. Items 2, 3, 4 and
// 5 are INSIDE the outline. The silhouette mask is solid — measured, three
// stray holes in the drawing and one in ours out of sixteen thousand cells —
// so a window, a screen and a lamp are all just car to it. Their size, their
// shape and their absence are worth exactly zero points. Only item 1 is outline
// at all, and a single IoU spreads it over the whole car: the roofline fault is
// in there, as a red band along the rear of the roof in the fault map, and no
// number in that tool's output says so.
//
// So this file measures the five things directly, in the same way on the
// drawing and on the model, and prints them side by side. It replaces nothing —
// the silhouette still catches gross proportion, which is what caught the old
// car at nineteen percent out — it covers what a silhouette cannot.
//
// ===========================================================================
// THE ONE CLASSIFIER RULE, AND WHY IT IS THE SAME FOR BOTH
// ===========================================================================
//
// A landmark measured with one rule on the drawing and another on the render is
// two measurements with one name. So there is a single rule, and it had to be
// one that survives both a comic-book drawing and a flat-shaded render:
//
//     glass:  blue beats red by 6, and red does not beat green
//     lamp:   red beats both green and blue by half again
//
// The second clause of the glass rule is doing real work: the purple stripe is
// (116,83,142) and its blue DOES beat its red, so without "red does not beat
// green" every stripe on the car would be scored as a window. Neutral greys —
// the drawing's wheels at (160,160,160), our chrome at (192,192,192) — fail the
// first clause and drop out, which they must, because a rule that finds glass
// on a wheel finds four windows on a car with two.
//
// Both are then filtered by WHERE: greenhouse glass sits in the top half of the
// car, and a component smaller than a quarter of a percent of the CAR'S AREA is
// a highlight, not a pane. Both thresholds are stated here rather than buried,
// because both change the pane COUNT, which is the headline number for item 2 —
// and the second one used to be a fraction of the blue on the car, which let a
// candidate move its own pass mark by tidying its chrome. See the note at the
// threshold itself.
//
//   node tools/landmarks.mjs [body-letter]

import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';

const __ROOT = __d(__d(__f(import.meta.url)));
const BODY = process.argv[2] || '';
const PAGE = 'file://' + __j(__ROOT, 'docs', 'index.html') + (BODY ? '?body=' + BODY : '');
const SHOTS = __j(__ROOT, 'shots');
mkdirSync(SHOTS, { recursive: true });

// The poses that produced the scores in tools/silhouette.mjs, so the car being
// measured here is the car that was graded there.
const POSE = {
  side: { az: -Math.PI / 2, el: 0.02, dist: 14 },
  rear: { az: 0.00, el: 0.10, dist: 14 },
};

// ---------------------------------------------------------------------------
// PIXELS IN, CLASSES OUT
// ---------------------------------------------------------------------------

/** One rule, both sources. See the header. */
const isGlass = (r, g, b) => b > r + 6 && g >= r - 2;
const isLamp = (r, g, b) => r > 90 && r > g * 1.5 && r > b * 1.5;

/** A drawing: rgb plus the alpha cut-out as the car mask. */
function loadRef(path) {
  const png = PNG.sync.read(readFileSync(path));
  const { width: w, height: h, data } = png;
  const m = new Uint8Array(w * h);
  const rgb = new Uint8Array(w * h * 3);
  for (let p = 0; p < w * h; p++) {
    m[p] = data[p * 4 + 3] > 128 ? 1 : 0;
    rgb[p * 3] = data[p * 4]; rgb[p * 3 + 1] = data[p * 4 + 1]; rgb[p * 3 + 2] = data[p * 4 + 2];
  }
  return { rgb, m, w, h };
}

/** Connected components of a boolean mask, four-connected. */
function components(sel, w, h, minArea) {
  const lab = new Int32Array(w * h).fill(-1);
  const out = [];
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!sel[s] || lab[s] >= 0) continue;
    const id = out.length;
    let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, sx = 0, sy = 0;
    stack.push(s); lab[s] = id;
    while (stack.length) {
      const p = stack.pop();
      const x = p % w, y = (p / w) | 0;
      n++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && sel[q] && lab[q] < 0) { lab[q] = id; stack.push(q); }
    }
    out.push({ n, x0, x1, y0, y1, cx: sx / n, cy: sy / n });
  }
  return out.filter((c) => c.n >= minArea).sort((a, b) => a.cx - b.cx);
}

/** The car's bounding box, with a floor so a stray pixel cannot define it. */
function bbox(m, w, h, floor = 3) {
  const col = new Int32Array(w), row = new Int32Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { col[x]++; row[y]++; }
  const span = (hist, n) => {
    let a = 0, b = n - 1;
    while (a < n && hist[a] < floor) a++;
    while (b > a && hist[b] < floor) b--;
    return [a, b];
  };
  const [x0, x1] = span(col, w), [y0, y1] = span(row, h);
  return { x0, x1, y0, y1, W: x1 - x0 + 1, H: y1 - y0 + 1 };
}

/** Topmost and bottommost set pixel per column, inside the box. */
function profiles(m, w, box) {
  const top = new Int32Array(box.W).fill(-1), bot = new Int32Array(box.W).fill(-1);
  for (let i = 0; i < box.W; i++) {
    const x = box.x0 + i;
    for (let y = box.y0; y <= box.y1; y++) if (m[y * w + x]) { top[i] = y; break; }
    for (let y = box.y1; y >= box.y0; y--) if (m[y * w + x]) { bot[i] = y; break; }
  }
  return { top, bot };
}

/**
 * WHERE THE WHEELS ARE, from the shape alone.
 *
 * No colour, because the drawing's tyres are black and so is every ink line on
 * the car, and no assumption about how many dark blobs there are. A car seen
 * side on rests on two tyres and its sill is clear of the ground, so the BOTTOM
 * profile has two low plateaus with a raised span between them. Take every
 * column whose bottom edge is within a tenth of the car's height of the lowest
 * point, split those columns into runs, and each run's centre is a wheel.
 *
 * It reports what it found rather than assuming two, because "this measurement
 * found three wheels" is the kind of thing that must not be silently averaged
 * into an answer.
 */
function wheels(bot, H) {
  let lowest = -1;
  for (let i = 0; i < bot.length; i++) if (bot[i] > lowest) lowest = bot[i];
  const cut = lowest - 0.10 * H;
  const runs = [];
  let start = -1;
  for (let i = 0; i <= bot.length; i++) {
    const on = i < bot.length && bot[i] >= cut;
    if (on && start < 0) start = i;
    if (!on && start >= 0) { runs.push([start, i - 1]); start = -1; }
  }
  // A run under a twentieth of the car's length is a bumper corner, not a tyre.
  return runs.filter(([a, b]) => b - a >= bot.length / 20).map(([a, b]) => ({ a, b, c: (a + b) / 2 }));
}

/**
 * WHERE THE ROOF STOPS BEING A ROOF.
 *
 * The rearmost column whose top edge is still within 6% of the car's height of
 * the highest point on the car. A '67 coupe's roof is close to flat and then
 * falls away to the deck, so this is the corner Anthony is pointing at when he
 * says the drawing holds it "quite close to the center of the rear wheel".
 *
 * Six percent and not zero because both the drawing and the render have a
 * slight crown across the roof; at zero this measures where the crown peaks,
 * which is a different landmark and moves around.
 */
function roofDrop(top, H) {
  let peak = 1e9;
  for (let i = 0; i < top.length; i++) if (top[i] >= 0 && top[i] < peak) peak = top[i];
  const cut = peak + 0.06 * H;
  let last = -1, first = -1;
  for (let i = 0; i < top.length; i++) {
    if (top[i] >= 0 && top[i] <= cut) { last = i; if (first < 0) first = i; }
  }
  return { first, last, peak };
}

// ---------------------------------------------------------------------------
// THE LANDMARKS
// ---------------------------------------------------------------------------

function sideLandmarks(src) {
  const { rgb, m, w, h } = src;
  const box = bbox(m, w, h);
  const { top, bot } = profiles(m, w, box);
  const wh = wheels(bot, box.H);
  const drop = roofDrop(top, box.H);

  const glassSel = new Uint8Array(w * h);
  let glassN = 0, carN = 0;
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const p = y * w + x;
      if (!m[p]) continue;
      carN++;
      if (isGlass(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2])) { glassSel[p] = 1; glassN++; }
    }
  }
  // Greenhouse only: the top half of the car. Wheel shading and chrome trim are
  // blue-ish too and they live low down.
  // THE THRESHOLD IS A FRACTION OF THE CAR, NOT OF THE BLUE ON IT.
  //
  // It was glassN/40 — a fortieth of every pixel that passed the glass rule
  // anywhere on the car — and that is a bar the car itself gets to set. Body b
  // has blue-tinted wheels and chrome, which put 6,874 pixels through the rule
  // against 1,453 of actual window, so the bar stood at 172 pixels; a candidate
  // that neutralised its chrome dropped the bar to 52. An agent that built all
  // four panes correctly was told it had built two, because its own tidier
  // palette had lowered the threshold's own denominator out from under it.
  // Found by that agent, in a report it could not act on because the
  // instruments are not the candidates' to edit.
  //
  // A quarter of a percent of the car's area is scale-free — the 60% control
  // at the foot of this file proves it — and it cannot be moved by anything
  // except the pane actually being small.
  const panes = components(glassSel, w, h, Math.max(16, carN / 400))
    .filter((c) => (c.cy - box.y0) / box.H < 0.5);
  const paneTotal = panes.reduce((s, c) => s + c.n, 0) || 1;

  const L = box.W;
  // THE ROOFLINE AS A CURVE, NOT AS A CORNER.
  //
  // "Where the roof drops off" needs a threshold, and a threshold is a choice
  // that moves the answer: both cars have a crown, so a tight band finds where
  // the crown peaks and a loose one finds somewhere down the backlight. Item 1
  // deserves better than that, so the top profile is also reported straight —
  // how tall is the car, at these stations along its length, as a fraction of
  // its tallest point. No threshold, nothing to tune, and the shape of the
  // disagreement is visible in the row rather than compressed into one number.
  const hAt = (fx) => {
    const i = Math.max(0, Math.min(L - 1, Math.round(fx * (L - 1))));
    return top[i] < 0 ? null : (box.y1 - top[i]) / box.H;
  };
  const stations = [0.45, 0.55, 0.65, 0.75, 0.82, 0.90];
  const rw = wh.length ? wh[wh.length - 1].c / L : null;

  return {
    box, panes, stations,
    roofProfile: stations.map(hAt),
    // The single number for item 1, and it needs no threshold: how much of the
    // car's full height is left directly above the centre of the rear wheel.
    heightAtRearWheel: rw === null ? null : hAt(rw),
    wheelCount: wh.length,
    frontWheel: wh.length ? (wh[0].c) / L : null,
    rearWheel: wh.length ? (wh[wh.length - 1].c) / L : null,
    wheelbase: wh.length > 1 ? (wh[wh.length - 1].c - wh[0].c) / L : null,
    // The headline for item 1: positive means the roof holds on PAST the centre
    // of the rear wheel, negative means it has already given up in front of it.
    dropVsRearWheel: wh.length ? (drop.last - wh[wh.length - 1].c) / L : null,
    dropX: drop.last / L,
    roofStartX: drop.first / L,
    roofLen: (drop.last - drop.first) / L,
    // GLASS MEANS THE PANES, not every blue pixel on the car. Our wheels are a
    // cool grey — (120,120,144) — so they pass "blue beats red" and were being
    // counted as thirteen points of extra glass. The panes are already filtered
    // to the greenhouse; measure those, and the number means what it says.
    glassPct: 100 * panes.reduce((s, c) => s + c.n, 0) / (carN || 1),
    paneCount: panes.length,
    paneShare: panes.map((c) => 100 * c.n / paneTotal),
    paneCentre: panes.map((c) => (c.cx - box.x0) / L),
    // A PANE'S HEIGHT SEPARATES A WINDOW FROM A GLINT. Our sail panel is
    // painted in the glass ramp along its top rails, so it comes back as a
    // third "pane" — a sliver a fifth the height of a real one, sitting where
    // the rear quarter light ought to be. Counting panes alone would call that
    // a rear quarter window and score the fault as fixed.
    paneHeight: panes.map((c) => (c.y1 - c.y0 + 1) / box.H),
    // HOW FAR BACK THE CABIN GOES, which is what the eye actually reads as
    // "where the roof drops". Measured on the outline the two cars are within
    // three percent of each other — but the drawing's glass runs back past the
    // rear wheel and ours stops well in front of it, and that is the difference
    // Anthony is describing. Relative to the rear wheel centre: negative means
    // the glass has finished before the wheel.
    glassRearEdge: panes.length && rw !== null
      ? (Math.max(...panes.map((c) => c.x1)) - box.x0) / L - rw : null,
    glassFrontEdge: panes.length ? (Math.min(...panes.map((c) => c.x0)) - box.x0) / L : null,
  };
}

function rearLandmarks(src) {
  const { rgb, m, w, h } = src;
  const box = bbox(m, w, h);
  const glassSel = new Uint8Array(w * h), lampSel = new Uint8Array(w * h);
  let glassN = 0, lampN = 0, carN = 0;
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const p = y * w + x;
      if (!m[p]) continue;
      carN++;
      const r = rgb[p * 3], g = rgb[p * 3 + 1], b = rgb[p * 3 + 2];
      if (isLamp(r, g, b)) { lampSel[p] = 1; lampN++; }
      else if (isGlass(r, g, b)) { glassSel[p] = 1; glassN++; }
    }
  }
  // The rear screen is the biggest piece of glass in the top half.
  const gl = components(glassSel, w, h, Math.max(24, glassN / 40))
    .filter((c) => (c.cy - box.y0) / box.H < 0.5)
    .sort((a, b) => b.n - a.n);
  const screen = gl[0] || null;

  // ===========================================================================
  // AND ITS SHAPE, BECAUSE A BOUNDING BOX CANNOT SEE ONE.
  // ===========================================================================
  //
  // The screen passed every row above at its second attempt — height 0.250
  // against the drawing's 0.250, width 0.641 against 0.642, roof above it 0.117
  // against 0.116 — and Anthony looked at it and said: "the rear screen is the
  // wrong shape completely, it looks like an upside down T shape". He is right,
  // and every number in this file was blind to it, because height and width are
  // properties of a BOX and the fault is what happens between the top of the box
  // and the bottom of it.
  //
  // Measured, the fault is emphatic: our screen is 0.38 of the car's width at
  // the top and 0.83 at the bottom. The drawing's goes 0.57 to 0.68. A gentle
  // taper against a funnel, and both fit a box of the same size.
  //
  // HOW THE WIDTH IS TAKEN, and why not with the glass rule. The drawing's
  // backlight is nearly black in the middle with a pale reflection across the
  // top, so a glass rule tuned to pale blue finds a fragment of it; a rule loose
  // enough to catch the black catches every ink line on the car too, and a
  // connected-component search then runs down the pillars and joins the screen
  // to the whole outline. Both were tried. What works on both pictures is the
  // NEGATIVE: at each row, how much of the car is neither green paint nor purple
  // stripe. Across the roof that is nearly nothing; across the backlight it is
  // the backlight. It needs no threshold on darkness and no components at all.
  // THE LONGEST UNBROKEN RUN, NOT THE TOTAL. A row's total of non-paint pixels
  // also counts the car's own outline, which is ink and sits at both ends of
  // every row — so the window came out five to ten points wider than it is, by
  // an amount that depends on how thick each picture draws its outline. Ours is
  // heavier than the drawing's, so the bias was not even the same on both
  // sides of the comparison. The window is one continuous hole across the car;
  // measure the hole.
  const rowGap = new Float64Array(box.H);
  for (let i = 0; i < box.H; i++) {
    const y = box.y0 + i;
    let run = 0, best = 0;
    for (let x = box.x0; x <= box.x1; x++) {
      const p = y * w + x;
      const r = rgb[p * 3], g = rgb[p * 3 + 1], b = rgb[p * 3 + 2];
      const green = g > r + 18 && g > b + 18;
      const purple = r > g + 8 && b > g + 8 && (Math.max(r, g, b) - Math.min(r, g, b)) > 18;
      if (m[p] && !green && !purple) { if (++run > best) best = run; } else run = 0;
    }
    rowGap[i] = best / box.W;
  }
  // WHERE THE BAND STARTS AND STOPS, without a fixed threshold.
  //
  // A fixed one was tried first and it overran: below the backlight our deck
  // carries enough ink to hold the gap at 0.29, so a cut at 0.25 swallowed the
  // deck, sampled the bottom of the "screen" down there and reported the screen
  // NARROWING by 0.25 when it is in fact widening by 0.27. Exactly the kind of
  // instrument that agrees with nothing anybody can see.
  //
  // So the cut is relative to the band's own peak — 45% of it — and the band is
  // the run of rows CONTAINING that peak, not the first run to cross a line.
  // The search stops at 40% of the car's height, which is below every backlight
  // and above every tail panel on both pictures; without that the black tail
  // panel is a wider gap than the screen and wins the peak.
  const wLo = Math.floor(box.H * 0.04), wHi = Math.floor(box.H * 0.40);
  let peak = wLo;
  for (let i = wLo; i < wHi; i++) if (rowGap[i] > rowGap[peak]) peak = i;
  const cut = 0.45 * rowGap[peak];
  let bTop = peak, bBot = peak;
  while (bTop > wLo && rowGap[bTop - 1] > cut) bTop--;
  while (bBot < wHi - 1 && rowGap[bBot + 1] > cut) bBot++;
  if (rowGap[peak] < 0.15) { bTop = -1; bBot = -1; }   // no backlight found at all
  const at = (f) => (bTop < 0 ? null : rowGap[Math.round(bTop + f * (bBot - bTop))]);
  const wTop = at(0.12), wBot = at(0.88);

  // THE LAMP CLUSTERS, NOT THE LAMP SEGMENTS. Our taillamps are ribbed, so the
  // red comes back as a dozen slats; the drawing's are ribbed too but its ribs
  // are thinner than a pixel at this size. Counting components would therefore
  // compare our ribs against its lack of them. So the red is grouped into left
  // and right by which half of the car it is in, and the ASPECT reported is of
  // the whole cluster — which is the thing Anthony is describing when he says
  // the drawing's are "rectangular horizontal in shape".
  const mid = (box.x0 + box.x1) / 2;
  const side = [[1e9, -1, 1e9, -1, 0], [1e9, -1, 1e9, -1, 0]];
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      if (!lampSel[y * w + x]) continue;
      const s = side[x < mid ? 0 : 1];
      if (x < s[0]) s[0] = x; if (x > s[1]) s[1] = x;
      if (y < s[2]) s[2] = y; if (y > s[3]) s[3] = y;
      s[4]++;
    }
  }
  const clusters = side.filter((s) => s[4] > carN / 400).map((s) => ({
    w: s[1] - s[0] + 1, h: s[3] - s[2] + 1, n: s[4],
    aspect: (s[1] - s[0] + 1) / (s[3] - s[2] + 1),
    top: (s[2] - box.y0) / box.H, bot: (s[3] - box.y0) / box.H,
  }));

  // AND THE SEGMENTS INSIDE THE CLUSTER, because that is what the eye reads.
  //
  // Anthony: "quite square with a slight vertical rectangular shape. In the
  // original art they are rectangular horizontal in shape." The CLUSTER aspect
  // does not catch that — ours comes out at 1.50 against the drawing's 1.57,
  // both landscape — because the fault is not the lamp's outline, it is that
  // ours is chopped into a dozen tall slats by ink ribs thick enough to break
  // the red into separate pieces. The drawing has ribs too, and at this size
  // they are finer than a pixel, so its red stays whole.
  //
  // So: how many pieces is the red in, and what shape is a piece. A lamp that
  // reads horizontal is one or two wide pieces; ours is ten narrow ones.
  // AREA-WEIGHTED, because an unweighted mean lets a splinter set the target.
  // The drawing's red is three pieces: two lamps of 1,524 and 1,584 pixels at
  // aspect 1.91 and 1.89, and a hundred-pixel glint on the bumper at 8.60. The
  // plain mean of those is 4.13 — a target no lamp on that car actually has,
  // one third of it contributed by a piece a fifteenth the size of the others.
  // Weighted by area it is 2.11, which is what the drawing's lamps look like.
  // Also reported by the agent that fell foul of it.
  const segs = components(lampSel, w, h, Math.max(12, lampN / 60));
  const segArea = segs.reduce((s, c) => s + c.n, 0);
  const segAspect = segs.length
    ? segs.reduce((s, c) => s + c.n * (c.x1 - c.x0 + 1) / (c.y1 - c.y0 + 1), 0) / segArea : null;

  const H = box.H;
  return {
    box, screen, clusters,
    segCount: segs.length,
    segAspect,
    // Item 3 and 4. Measured from the TOP of the car downward, so a bigger
    // number means more bodywork visible above the glass.
    roofAboveScreen: screen ? (screen.y0 - box.y0) / H : null,
    screenHeight: screen ? (screen.y1 - screen.y0 + 1) / H : null,
    screenTopW: wTop,
    screenBotW: wBot,
    // POSITIVE MEANS IT WIDENS GOING DOWN, which every rear screen does a
    // little. The drawing does it by 0.11 of the car's width. Ours did it by
    // 0.45, and that is the upside-down T.
    screenFlare: wTop === null || wBot === null ? null : wBot - wTop,
    screenBand: bTop < 0 ? null : [bTop / H, bBot / H],
    // The whole profile, printed, because a two-number summary of a shape is
    // how the last one got away.
    screenProfile: bTop < 0 ? null
      : [0.05, 0.25, 0.45, 0.65, 0.85, 0.98].map((f) => rowGap[Math.round(bTop + f * (bBot - bTop))]),
    screenWidth: screen ? (screen.x1 - screen.x0 + 1) / box.W : null,
    // The upper of the two panels Anthony describes: screen bottom to lamp top.
    upperPanel: screen && clusters.length
      ? (Math.min(...clusters.map((c) => c.top)) - (screen.y1 - box.y0) / H) : null,
    lampAspect: clusters.length ? clusters.reduce((s, c) => s + c.aspect, 0) / clusters.length : null,
    lampCount: clusters.length,
    lampPct: 100 * lampN / (carN || 1),
    glassPct: 100 * glassN / (carN || 1),
  };
}

// ---------------------------------------------------------------------------
// PHOTOGRAPH OURS
// ---------------------------------------------------------------------------

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(PAGE, { waitUntil: 'load' });
await page.waitForFunction(() => window.RACER, null, { timeout: 30000 });
await page.evaluate(() => {
  if (window.RACER.menu) window.RACER.menu.close();
  for (const id of ['hud', 'note', 'ctl', 'gears']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
});
const built = await page.evaluate(() => window.RACER.bodyName());
if (BODY && built !== BODY) console.log(`  ASKED FOR ${BODY}, GOT ${built} — stop and fix that first.`);

/**
 * The colour frame AND the car mask from the same pose.
 *
 * The mask is the same two-pass difference the silhouette harness uses, and it
 * matters here for a different reason: it says which pixels are car. Classifying
 * the whole frame would put the sky in the glass column — the sky is blue, and
 * "blue beats red" is the glass rule.
 */
async function ourFrame(pose) {
  return await page.evaluate(async ({ az, el, dist }) => {
    const R = window.RACER;
    const gl = R.renderer.getContext();
    const w = R.renderer.domElement.width, h = R.renderer.domElement.height;
    const A = new Uint8Array(w * h * 4), B = new Uint8Array(w * h * 4);
    const f = () => new Promise((r) => requestAnimationFrame(() => r()));
    R.tune.freeze = true; R.st.speed = 0; R.st.steer = 0; R.st.slope = 0;
    R.tune.studio = { az, el, dist, clean: true };
    await f(); await f();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, A);
    R.tune.showBody = false;
    await f(); await f();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, B);
    R.tune.showBody = true; R.tune.studio = null;
    await f();
    const m = new Array(w * h).fill(0), rgb = new Array(w * h * 3).fill(0);
    for (let i = 0, p = 0; i < A.length; i += 4, p++) {
      const x = p % w, y = (p / w) | 0, q = (h - 1 - y) * w + x;
      const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
      if (d > 2) m[q] = 1;
      rgb[q * 3] = A[i]; rgb[q * 3 + 1] = A[i + 1]; rgb[q * 3 + 2] = A[i + 2];
    }
    return { m, rgb, w, h };
  }, pose);
}

const packed = (f) => ({ rgb: Uint8Array.from(f.rgb), m: Uint8Array.from(f.m), w: f.w, h: f.h });

/** A picture of what the classifier thinks it is looking at. */
function classMap(src, name) {
  const { rgb, m, w, h } = src;
  const png = new PNG({ width: w, height: h });
  for (let p = 0; p < w * h; p++) {
    const r = rgb[p * 3], g = rgb[p * 3 + 1], b = rgb[p * 3 + 2];
    let c = [250, 250, 248];
    if (m[p]) {
      if (isLamp(r, g, b)) c = [230, 40, 40];
      else if (isGlass(r, g, b)) c = [40, 110, 235];
      else c = [170, 170, 165];
    }
    png.data[p * 4] = c[0]; png.data[p * 4 + 1] = c[1];
    png.data[p * 4 + 2] = c[2]; png.data[p * 4 + 3] = 255;
  }
  const out = __j(SHOTS, `landmarks-${name}.png`);
  writeFileSync(out, PNG.sync.write(png));
  return out;
}

const refSide = loadRef(__j(__ROOT, 'ref/side-nobg.png'));
const refRear = loadRef(__j(__ROOT, 'ref/rear-nobg-crop.png'));
const ourSide = packed(await ourFrame(POSE.side));
const ourRear = packed(await ourFrame(POSE.rear));
await browser.close();

const rs = sideLandmarks(refSide), os = sideLandmarks(ourSide);
const rr = rearLandmarks(refRear), or_ = rearLandmarks(ourRear);
classMap(refSide, 'ref-side'); classMap(ourSide, `${built}-side`);
classMap(refRear, 'ref-rear'); classMap(ourRear, `${built}-rear`);

// ---------------------------------------------------------------------------
// THE REPORT
// ---------------------------------------------------------------------------

/**
 * THE POSITIVE CONTROL: every number here claims to be scale-free.
 *
 * Each landmark is divided by the car's own length, width or height, so a
 * bigger photograph of the same car must produce the same table. That is a
 * claim, and claims in this project get measured — so the drawing is resampled
 * to 60% and put through the identical code. Any landmark that moves is one
 * that is secretly counting pixels, and the whole comparison against a render
 * of a completely different size rests on none of them doing that.
 */
function rescale(src, f) {
  const w = Math.max(8, Math.round(src.w * f)), h = Math.max(8, Math.round(src.h * f));
  const rgb = new Uint8Array(w * h * 3), m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.h - 1, Math.floor(y / f));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.w - 1, Math.floor(x / f));
      const p = y * w + x, q = sy * src.w + sx;
      m[p] = src.m[q];
      rgb[p * 3] = src.rgb[q * 3]; rgb[p * 3 + 1] = src.rgb[q * 3 + 1]; rgb[p * 3 + 2] = src.rgb[q * 3 + 2];
    }
  }
  return { rgb, m, w, h };
}

let bad = 0;
const line = (label, ref, ours, tol, fmt = (v) => v.toFixed(3)) => {
  if (ref === null || ours === null) {
    console.log(`  ${label.padEnd(42)} ${'--'.padStart(9)} ${'--'.padStart(9)}   not measurable`);
    return;
  }
  const d = ours - ref;
  const off = Math.abs(d) > tol;
  if (off) bad++;
  console.log(`  ${label.padEnd(42)} ${fmt(ref).padStart(9)} ${fmt(ours).padStart(9)} ` +
              `${(d >= 0 ? '+' : '') + fmt(d).padStart(8)}   ${off ? '<-- OFF' : 'ok'}`);
};

console.log(`\nLANDMARKS — body ${built} against the drawings.`);
console.log('Everything is a fraction of the car\'s own length, width or height, so');
console.log('nothing here can be fixed by making the car bigger.\n');
console.log(`  ${''.padEnd(42)} ${'drawing'.padStart(9)} ${'ours'.padStart(9)} ${'diff'.padStart(9)}`);
console.log(`\n  --- SIDE ------------------------------------------------------------`);
console.log(`  wheels found: drawing ${rs.wheelCount}, ours ${os.wheelCount}` +
            `${rs.wheelCount === 2 && os.wheelCount === 2 ? '' : '   <-- the wheel finder is confused; treat the rest with suspicion'}`);
line('front wheel centre, from the nose', rs.frontWheel, os.frontWheel, 0.03);
line('rear wheel centre, from the nose', rs.rearWheel, os.rearWheel, 0.03);
line('wheelbase', rs.wheelbase, os.wheelbase, 0.03);
line('[1] height above the rear wheel centre', rs.heightAtRearWheel, os.heightAtRearWheel, 0.04);
line('    roof drop vs rear wheel centre', rs.dropVsRearWheel, os.dropVsRearWheel, 0.03);
line('    roof: where it starts', rs.roofStartX, os.roofStartX, 0.04);
line('    roof: how long it runs', rs.roofLen, os.roofLen, 0.04);
console.log('      the top profile, as a fraction of the car\'s full height:');
console.log('      station        ' + rs.stations.map((s) => s.toFixed(2).padStart(7)).join(''));
console.log('      drawing        ' + rs.roofProfile.map((v) => (v === null ? '--' : v.toFixed(3)).padStart(7)).join(''));
console.log('      ours           ' + os.roofProfile.map((v) => (v === null ? '--' : v.toFixed(3)).padStart(7)).join(''));
console.log('      diff           ' + rs.roofProfile.map((v, i) => {
  const o = os.roofProfile[i];
  return (v === null || o === null ? '--' : ((o - v >= 0 ? '+' : '') + (o - v).toFixed(3))).padStart(7);
}).join(''));
console.log(`  [2] panes of glass in the greenhouse: drawing ${rs.paneCount}, ours ${os.paneCount}` +
            `${rs.paneCount === os.paneCount ? '' : '   <-- OFF'}`);
if (rs.paneCount !== os.paneCount) bad++;
const pane = (l, s) => console.log(`      ${l.padEnd(18)} ` +
  s.paneShare.map((v, i) => `${v.toFixed(0)}% at x${s.paneCentre[i].toFixed(2)} h${s.paneHeight[i].toFixed(2)}`).join('   '));
pane('drawing', rs);
pane('ours', os);
console.log('      (share of the greenhouse glass, centre along the car, height of the pane)');
line('    glass: front edge', rs.glassFrontEdge, os.glassFrontEdge, 0.03);
line('    glass: rear edge vs rear wheel', rs.glassRearEdge, os.glassRearEdge, 0.03);
line('    glass, as % of the car', rs.glassPct, os.glassPct, 2.0, (v) => v.toFixed(1));

console.log(`\n  --- REAR ------------------------------------------------------------`);
line('[3] rear screen height', rr.screenHeight, or_.screenHeight, 0.04);
line('    rear screen width', rr.screenWidth, or_.screenWidth, 0.05);
line('    screen width at its top', rr.screenTopW, or_.screenTopW, 0.06);
line('    screen width at its bottom', rr.screenBotW, or_.screenBotW, 0.06);
line('[6] screen flare, top to bottom', rr.screenFlare, or_.screenFlare, 0.08);
if (rr.screenProfile && or_.screenProfile) {
  console.log('      its width down the glass, as a fraction of the car\'s width:');
  console.log('      down            0.05   0.25   0.45   0.65   0.85   0.98');
  console.log('      drawing       ' + rr.screenProfile.map((v) => v.toFixed(3).padStart(7)).join(''));
  console.log('      ours          ' + or_.screenProfile.map((v) => v.toFixed(3).padStart(7)).join(''));
}
line('[4] bodywork above the screen', rr.roofAboveScreen, or_.roofAboveScreen, 0.04);
line('    panel between screen and lamps', rr.upperPanel, or_.upperPanel, 0.05);
console.log(`  [5] taillamp clusters: drawing ${rr.lampCount}, ours ${or_.lampCount}`);
line('    taillamp shape, width over height', rr.lampAspect, or_.lampAspect, 0.25, (v) => v.toFixed(2));
console.log(`      pieces the red breaks into: drawing ${rr.segCount}, ours ${or_.segCount}` +
            `${or_.segCount > rr.segCount + 2 ? '   <-- OFF, the ribs are cutting the lamp up' : ''}`);
if (or_.segCount > rr.segCount + 2) bad++;
line('    shape of one piece', rr.segAspect, or_.segAspect, 0.5, (v) => v.toFixed(2));
line('    taillamp area, as % of the car', rr.lampPct, or_.lampPct, 2.5, (v) => v.toFixed(1));

// --- and the control -------------------------------------------------------
const small = sideLandmarks(rescale(refSide, 0.6));
const smallR = rearLandmarks(rescale(refRear, 0.6));
const drifts = [
  ['rear wheel', rs.rearWheel, small.rearWheel],
  ['height at rear wheel', rs.heightAtRearWheel, small.heightAtRearWheel],
  ['glass %', rs.glassPct / 100, small.glassPct / 100],
  ['screen height', rr.screenHeight, smallR.screenHeight],
  ['roof above screen', rr.roofAboveScreen, smallR.roofAboveScreen],
  ['screen flare', rr.screenFlare, smallR.screenFlare],
  ['screen width at top', rr.screenTopW, smallR.screenTopW],
  ['lamp aspect', rr.lampAspect / 4, smallR.lampAspect / 4],
];
let worstDrift = 0, worstName = '';
for (const [n, a, b] of drifts) {
  if (a === null || b === null) { worstDrift = 1; worstName = n + ' (vanished)'; continue; }
  if (Math.abs(a - b) > worstDrift) { worstDrift = Math.abs(a - b); worstName = n; }
}
console.log(`\n  scale control — the same drawing at 60%: worst landmark moves ` +
            `${worstDrift.toFixed(3)} (${worstName})` +
            `${worstDrift > 0.03 ? '   <-- SOMETHING HERE IS COUNTING PIXELS' : ''}`);
if (small.paneCount !== rs.paneCount) {
  console.log(`  scale control — pane count changed with size: ${rs.paneCount} -> ${small.paneCount}.` +
              ` The pane threshold is not scale-free.`);
}

console.log(`\n  ${bad} landmark${bad === 1 ? '' : 's'} outside tolerance.`);
console.log(`  classifier maps in shots/landmarks-*.png — look at them before believing any of this.`);
console.log(`  page errors: ${errs.length ? errs.join(' | ') : 'none'}\n`);
