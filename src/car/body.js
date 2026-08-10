// The car, exterior. A muscle car, drawn in ink and coloured pencil.
//
// THE INTERFACE IS THE DELIVERABLE, not the shape. Everything that will ever
// bolt onto this car — blowers, side pipes, wings, armour — hangs off the
// `attach` points below, so the parts system does not have to know how the body
// is modelled and the body does not have to know what parts exist. Every anchor
// is DERIVED from the same curves the panels are, because a previous build moved
// the nose 0.20 back and left the bumper, grille and headlamps floating in front
// of the car.
//
// THE RULES, which are not style preferences. They are the reason this project
// runs at all on a Helio A22 where the previous one did not:
//
//   * MeshBasicMaterial only. No lights, ever. Shading is baked into vertex
//     colours.
//   * `fog: true` on every material, or the object will not fade into the haze
//     with everything else and will look pasted on.
//   * The pencil map is passed in, not imported. One texture, shared.
//   * Ink outlines come from ../art/toon.js. Do not hand-roll them.
//   * DRAW CALLS ARE THE SCARCEST THING. Three: paint, wheels, ink. One merged
//     vertex buffer per material; colour is a VERTEX COLOUR, never a material.
//   * No per-frame allocation. Build once, mutate transforms after that.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A LOFT AND NOT A PILE OF BOXES.
//
// The previous body was thirty assembled cuboids. It scored 91% against the
// dead-on rear reference and still did not look like the drawing, and the
// instrument said why: reference aspect 1.35, ours 2.16. THE CAR WAS SIXTY
// PERCENT TOO WIDE FOR ITS HEIGHT. The two three-quarter references never
// caught it because length dominates their bounding box. A box car cannot be
// fixed by nudging boxes, because the thing that is wrong is the section — a
// real car's cross-section tucks under at the sill, bulges at the haunch,
// rounds into the shoulder and falls away over the crown, and every one of
// those is a curve.
//
// So the body is now LOFTED. `section` describes one cross-section as eleven
// named points from the keel to the crown; `STATION_Z` lists twenty-eight
// places along the car to evaluate it; the curves in `SHAPE` say what each
// named point does as it travels from nose to tail. The surface is the grid
// between them. Wheel arches are not cut out afterwards — the bottom edge of
// the section RISES over each axle, so the arch is part of the loft and the
// tyre stands in a real opening.
//
// Measured with renderer.info.render: THREE draw calls and 7,228 triangles —
// 5,040 paint, 592 wheels, 1,596 ink — against a budget of six and 25,000. See
// `stats` at the bottom of buildBody for the live numbers rather than these,
// which are only true on the day they were written.
//
// ---------------------------------------------------------------------------
// THE OTHER HALF OF THE JOB: INTERIOR LINE WORK.
//
// An inverted hull can only ever draw the outside edge of a silhouette.
// Everything that makes the reference read as DRAWN rather than modelled is
// interior — the boot shut line, the crease down the flank, the lip round each
// wheel arch, the panel line under the lamps, the window surround. Those are
// their own geometry here, and they cost nothing extra because THE SEAMS ARE
// THE LOFT: a seam is either a rail (a line along the car) or a station (a line
// across it), so the grid already knows where every one of them is.
//
// They are cut INTO the surface rather than laid on top of it. `Builder.cell`
// splits a grid cell into up to nine sub-quads and paints the border strips
// black; two coplanar quads in the same place is a z-fight, and a z-fight on a
// phone with a 16-bit depth buffer is a flickering line, not a hidden one. The
// same conclusion this project reached about the ground, where butt-joined
// colour fields needed a black strip laid along every join.
//
// Measured off the three references, the fine line is 0.34% of car length in
// all three — median dark run 2px on the 232px-wide cut-out, 3px on both
// 869px three-quarters. That is what HAIR below is sized from, and it is NOT
// the 1.4% REFERENCE.md quotes for the silhouette: that figure is the 90th
// percentile of dark runs, which on these drawings is mostly glass, tyre and
// tail panel rather than line.
//
// ---------------------------------------------------------------------------
// WHAT THE REAR CUT-OUT SAYS, measured from ref/rear-nobg-crop.png and used
// here as literal numbers rather than as an impression:
//
//   aspect (w/h)          1.349
//   width at 5% down       59%      the roof crown rolls off fast
//   width at 25% down      74%      cabin
//   width at 50% down      96%      body
//   width at 75% down     100%      widest — the bumper corners
//   deck, scanned across  green 38 | line | PURPLE 39 | line | green 35 |
//                         line | PURPLE 40 | line | green 40   (of 207px)
//
// so the stripes are 19% of the car's width each, and the gap between them is
// 18%. Expressed in world units and not as a fraction of each panel: the deck
// is wider than the roof, and a fraction would step the stripes sideways where
// they cross the rear window, which is the exact place the chase camera looks.

import {
  Group, Mesh, BufferGeometry, BufferAttribute, MeshBasicMaterial, Color,
} from 'three';

import { buildOutline, inkMaterial } from '../art/toon.js';

/**
 * The attachment points a part can be bolted to.
 *
 * Positions are in car space, in world units, with the car at the origin facing
 * -Z (the direction of travel). Y is up and y=0 is the road surface. A part is
 * added by parenting it to the returned anchor Object3D, so a part never needs
 * to know where on the car it lives.
 */
export const ATTACH = [
  'engineTop',    // through the bonnet — blowers, scoops, turbos
  'exhaustL',     // side pipes, stacks
  'exhaustR',
  'wingRear',     // spoilers, from tasteful to absurd
  'bumperFront',  // rams, plows, bull bars
  'bumperRear',
  'roof',         // lights, sirens, spare wheels, harpoons
  'wheelFL',      // wheels and arches
  'wheelFR',
  'wheelRL',
  'wheelRR',
];

// ------------------------------------------------------------- the dimensions
//
// THREE NUMBERS ARE THE WHOLE PROPORTION and everything else is relative to
// them. The car measures 8.91 long over its bumpers, 3.04 across its widest
// point and 2.20 tall: width over height 1.38 against the cut-out's measured
// 1.349, and length over height 3.89 where a real '67 Camaro is 3.63. It is a
// shade longer and lower than the real car, which is what the drawings are.
//
// THEY ARE NOT TUNED AGAINST THE SCORE, and there is a specific reason to say
// so. A coordinate search over the old section table once found 88.2% by making
// the body a third taller with shrunken wheels, and it looked like a van;
// tools/silhouette.mjs fails on more than 8% aspect drift for exactly that
// reason. The numbers below come from the cut-out's own scan lines — width at
// each height, stripe edges, panel heights — and the score is read afterwards.

/**
 * TWO PROPORTION DIALS, and everything below this line is in DESIGN UNITS — a
 * car 8.65 long and 2.20 tall, drawn to those numbers and then stretched.
 *
 * They exist separately because they do different jobs:
 *
 *   LONGER  stretches z only. It moves both three-quarter views and leaves the
 *           dead-on rear alone, because from dead astern length is depth.
 *   SMALLER shrinks x and y TOGETHER, so width over height — the one number the
 *           cut-out pins, at 1.349 — cannot move while it turns.
 *
 * Having them apart is what stopped the first two attempts at this being
 * guesswork. A stretch of 1.06 with a shrink of 0.84 made a car that matched
 * the rear cut-out exactly and lost ten points on both three-quarters: at
 * twelve units from an eight-unit car the near end is twice the size of the far
 * end, so length bought almost no width in projection and the height it added
 * to the ground footprint cost more than it gained. Length is not the lever
 * these views respond to; elevation is, and that turned out to be a fault in
 * the harness rather than in the car.
 *
 * They now sit at 0.99 and 1.00 — the section table is very nearly the car.
 */
const LONGER = 0.990;
const SMALLER = 1.000;

const zz = (v) => v * LONGER;
const xy = (v) => v * SMALLER;

const NOSE_Z = zz(-4.40);
const TAIL_Z = zz(4.25);
const CAR_LEN = TAIL_Z - NOSE_Z;
const CAR_HIGH = xy(2.20);                    // crown of the roof

/**
 * The wheels.
 *
 * BIG AT THE BACK AND SMALL AT THE FRONT, which is the drag-strip rake
 * REFERENCE.md asks for and is also what the drawings measure: against car
 * height the rear tyre is 0.42 to 0.54 of it across the two three-quarters and
 * the front is 0.28 to 0.35. Here they are 0.55 and 0.40. The old car ran 0.68
 * at both ends, which is why a coordinate search kept wanting to shrink them —
 * they were too big, and the only way a search over the section table could say
 * so was to inflate the body around them.
 *
 * The tyres are FLUSH with the widest bodywork now, where the box car needed
 * them 0.30 proud. That is not a change of mind, it is the arch: the box car
 * had none, so its rear quarter and its tyre subtended the same angle from the
 * chase camera and the arch hid the rubber to within a pixel. The loft's bottom
 * edge rises over each axle, so the tyre sits in a real opening with a drawn
 * lip round it and is visible without being shoved outboard.
 */
const FW = { r: xy(0.44), hw: xy(0.24), x: xy(1.13), y: xy(0.44), z: zz(-2.80) };
const RW = { r: xy(0.60), hw: xy(0.34), x: xy(1.12), y: xy(0.60), z: zz(2.05) };

/** Wheel arch openings: how high the body's bottom edge climbs, and over what
 *  length of car. Ten centimetres of daylight over the top of each tyre. */
const ARCH_F = { z: FW.z, top: FW.r * 2 + xy(0.10), rz: zz(0.92) };
const ARCH_R = { z: RW.z, top: RW.r * 2 + xy(0.10), rz: zz(1.08) };

/**
 * THE STRIPES, in world units, from the scan across the deck quoted above.
 *
 * Each stripe is 0.51 wide and the gap between them is 0.48. They are rails of
 * the section, not a fraction of a panel, so they run from the nose to the tail
 * at a constant width exactly as a roll of masking tape would.
 */
const SX_IN = xy(0.24), SX_OUT = xy(0.75);

/** How deep the beltline stripe is down the flank. Thinner than the deck
 *  stripes, as both references draw it. */
const BELT_H = xy(0.10);

/**
 * How wide a drawn line is, in world units.
 *
 * The median dark run measures 0.34% of car length in all three references —
 * two pixels on the 232-wide cut-out, three on both 869-wide three-quarters.
 * This is 0.50%, half again as heavy, and the reason is resolution: the chase
 * camera gives us 163 pixels of car where the drawings have 232 to 869, so a
 * line drawn to the reference's own width lands at half a pixel and vanishes.
 * At 0.50% it is two pixels at chase distance and three close up, which is what
 * the drawings look like. tools/inkmeter.mjs: 34.4% against a 34-44% target.
 */
const HAIR = CAR_LEN * 0.0050;               // 0.041

/**
 * The silhouette pen, as a fraction of the ink thickness main.js hands over.
 *
 * 1.00% of car length, against 1.17% before. It comes down because it no longer
 * has to carry the drawing on its own: with no fine tier the hull was the only
 * ink on the car, and it had to be fat to register. It does not come down as
 * far as the drawings' own outer line, for the same resolution reason as HAIR
 * above — and because it is the one line that has to survive the car being a
 * forty-pixel smudge when the camera pulls out at speed.
 */
const SILHOUETTE = 0.92;                      // 0.09 * 0.92 = 0.083

// ------------------------------------------------------------------ the curves
//
// One function of z per named point of the section. Interpolated with a
// monotone cubic (Fritsch–Carlson), so the surface curves between knots but
// never overshoots into a bulge nobody asked for — which a plain Catmull-Rom
// does, and which on a car body shows up as a blister in the door.

/**
 * Monotone cubic through [z, value] knots, in DESIGN units, returning a
 * function of WORLD z that answers in WORLD units.
 *
 * Every knot in SHAPE goes through here, so the two proportion dials are
 * applied in exactly one place and cannot be applied to some of the car and not
 * the rest — which is the failure mode of scaling a table of literals by hand.
 */
function curve(knots) {
  const n = knots.length;
  const xs = knots.map((k) => k[0]);
  const ys = knots.map((k) => k[1]);
  const d = new Array(n - 1);
  const m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  const at2 = (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return ys[i] * (2 * t3 - 3 * t2 + 1) + h * m[i] * (t3 - 2 * t2 + t)
         + ys[i + 1] * (-2 * t3 + 3 * t2) + h * m[i + 1] * (t3 - t2);
  };
  return (worldZ) => xy(at2(worldZ / LONGER));
}

/** The `tuck` curve is a ratio, not a length, so it must not be scaled. */
function ratioCurve(knots) {
  const f = curve(knots);
  return (worldZ) => f(worldZ) / SMALLER;
}

/**
 * READ THIS AS A SIDE ELEVATION AND A PLAN VIEW AT THE SAME TIME.
 *
 * Long bonnet from -3.7 to -0.95, glass from -0.95 to 0.35, roof to 1.75, short
 * deck to 3.6. Two thirds of the car ahead of the driver, which is the whole
 * reason a Camaro looks like a Camaro and a hatchback does not, and it survives
 * being forty pixels wide when nothing else does.
 */
const SHAPE = {
  /**
   * Bottom edge of the bodywork away from the wheels: the rocker line.
   *
   * IT DOES NOT GO TO THE FLOOR AT THE TAIL, and the first version of this
   * loft did. The cut-out has the rear valance hanging down to 7% of the car's
   * height, which is true of the drawing and wrong for us: the drawing is a
   * long lens, and the harness stands twelve units off an 8.65-unit car, so the
   * tail is a third nearer the camera than the rear axle. A valance at y=0.06
   * projected BELOW the tyres and put thirty-five pixels of height into the
   * silhouette that the reference has nowhere — measured aspect 1.20 against
   * the drawing's 1.35, and the drawing's own lowest point is its tyres.
   */
  sill: curve([[-4.40, 0.38], [-3.90, 0.34], [-1.60, 0.28], [0.60, 0.28],
    [2.90, 0.32], [3.60, 0.34], [4.25, 0.36]]),
  /** How far the rocker tucks under the crease, as a fraction of the width:
   *  deep between the wheels, almost nothing at either end, which is where the
   *  cut-out keeps the car 95% of its full width to within a hand of the road. */
  tuck: ratioCurve([[-4.40, 0.96], [-3.20, 0.92], [-1.60, 0.89], [0.60, 0.89],
    [2.90, 0.94], [4.25, 0.98]]),
  /** Widest point of the section, and the height it happens at: the crease. */
  wMax: curve([[-4.40, 1.20], [-3.90, 1.27], [-3.20, 1.35], [-2.80, 1.37],
    [-2.00, 1.31], [-0.95, 1.31], [0.60, 1.33], [1.50, 1.38], [2.05, 1.42],
    [2.90, 1.41], [3.60, 1.38], [4.25, 1.33]]),
  yMax: curve([[-4.40, 0.90], [-3.60, 1.02], [-2.80, 1.08], [-1.40, 1.16],
    [0.60, 1.26], [2.05, 1.38], [3.25, 1.24], [4.25, 1.00]]),
  /** The beltline: top of the bodywork, bottom of the glass. */
  wBelt: curve([[-4.40, 1.10], [-3.60, 1.24], [-2.80, 1.28], [-0.95, 1.28],
    [0.35, 1.26], [1.75, 1.28], [2.55, 1.30], [3.60, 1.30], [4.25, 1.20]]),
  yBelt: curve([[-4.40, 1.18], [-3.60, 1.30], [-2.80, 1.34], [-0.95, 1.46],
    [0.35, 1.54], [1.75, 1.54], [2.55, 1.50], [3.60, 1.48], [4.25, 1.42]]),
  /** The rail: outer edge of every top surface — bonnet, roof, boot lid. */
  wRail: curve([[-4.40, 1.02], [-3.60, 1.16], [-2.80, 1.20], [-0.95, 1.20],
    [0.35, 1.02], [1.05, 1.06], [1.75, 1.04], [2.55, 1.20], [3.25, 1.22],
    [4.25, 1.10]]),
  yRail: curve([[-4.40, 1.26], [-3.60, 1.38], [-2.80, 1.42], [-1.40, 1.44],
    [-0.95, 1.48], [0.35, 2.02], [1.05, 2.08], [1.75, 2.03], [2.55, 1.70],
    [3.25, 1.72], [3.90, 1.68], [4.25, 1.48]]),
  /** The crown: the centreline of every top surface. */
  yCrown: curve([[-4.40, 1.34], [-3.60, 1.44], [-2.80, 1.50], [-1.40, 1.52],
    [-0.95, 1.54], [0.35, 2.14], [1.05, 2.20], [1.75, 2.14], [2.55, 1.78],
    [3.25, 1.78], [3.90, 1.74], [4.12, 1.64], [4.25, 1.52]]),
};

/** How much of a wheel arch this station is standing in, 0..1. */
function archAt(z, a) {
  const t = (z - a.z) / a.rz;
  return t > -1 && t < 1 ? Math.sqrt(1 - t * t) : 0;
}

/**
 * ONE CROSS-SECTION, as eleven points from the keel to the crown.
 *
 *   0 keel centre   the underbody, on the centreline
 *   1 keel outer
 *   2 rocker        THE BOTTOM EDGE OF THE BODYWORK — rises over each axle,
 *                   which is what makes the wheel arch an arch
 *   3 lower flank
 *   4 crease        widest point; the character line down the side
 *   5 shoulder
 *   6 belt          top of the bodywork, bottom of the glass
 *   7 rail          outer edge of the top surface: bonnet, roof, boot lid
 *   8 stripe outer  at x = 0.75, always
 *   9 stripe inner  at x = 0.24, always
 *  10 crown         the centreline
 *
 * Eight through ten sit on a parabolic crown between the rail and the centre,
 * so a top surface is domed rather than flat and the band light finds two
 * different greens across it without anything being placed by hand.
 */
function section(z) {
  const aF = archAt(z, ARCH_F), aR = archAt(z, ARCH_R);
  const sill = SHAPE.sill(z);
  const yBot = Math.max(sill, sill + aF * (ARCH_F.top - sill),
    sill + aR * (ARCH_R.top - sill));
  const arch = Math.max(aF, aR);

  const wMax = SHAPE.wMax(z), yMax = SHAPE.yMax(z);
  const wBelt = SHAPE.wBelt(z), yBelt = SHAPE.yBelt(z);
  const wRail = SHAPE.wRail(z), yRail = SHAPE.yRail(z);
  const yTop = SHAPE.yCrown(z);
  const tuck = SHAPE.tuck(z);
  const xRock = wMax * (tuck + (1 - tuck) * arch);
  // The floor drops away from the rocker only where the rocker tucks in, which
  // is between the wheels. At the two ends it stays level with the bottom edge:
  // a keel hanging below a valance is the LOWEST point on the car from the
  // chase camera, and being narrow it reads as a spike on the bottom of the
  // silhouette that the drawing does not have.
  const yUnder = Math.max(xy(0.22), yBot - xy(0.60) * (1 - tuck));
  // FLAT, not a keel. A centreline dipping even three centimetres below the
  // floor is the lowest point on the car from behind, and the ink shell hangs
  // off it: the bottom row of the silhouette came out 73% of the car's width
  // where the drawing has 86%, because the last thing the mask saw was a spike.
  const yKeel = yUnder;

  // The crown, from the rail in to the centreline. SIXTH POWER, NOT PARABOLIC:
  // the cut-out's top scanline is 32% of the car's width, so the roof is flat
  // across most of its span and turns down hard at the rail. A parabola gives
  // 14% there and the car comes to a ridge like a tent.
  const x8 = Math.min(SX_OUT, wRail * 0.90);
  const x9 = Math.min(SX_IN, wRail * 0.55);
  const dome = (x) => {
    const t = (x / wRail) * (x / wRail);
    return yTop - (yTop - yRail) * t * t * t;
  };

  return [
    [0, yKeel],
    [xRock * 0.94, yUnder],
    [xRock, yBot],
    [xRock + (wMax - xRock) * 0.86, yBot + (yMax - yBot) * 0.50],
    [wMax, yMax],
    // THE SHOULDER RAIL IS ALSO THE BOTTOM OF THE BELTLINE STRIPE, which is why
    // it sits a fixed distance below the belt rather than a fraction of the way
    // up from the crease. Both references run a thin purple stripe along the
    // flank the whole length of the car — the only stripe a side-on camera ever
    // sees — and this is the span it lives in.
    //
    // Keeping it close to the belt also narrows the shoulder, which the cut-out
    // asks for independently: it is 74% of full width a quarter of the way down
    // and 87% at 35%, so the body must not reach full width until well below
    // the glass. A shoulder pushed out toward the crease flared the car ten
    // points too early and the profile said so.
    [wBelt + (wMax - wBelt) * 0.30, yBelt - Math.min(BELT_H, (yBelt - yMax) * 0.45)],
    [wBelt, yBelt],
    [wRail, yRail],
    [x8, dome(x8)],
    [x9, dome(x9)],
    [0, yTop],
  ];
}

// ------------------------------------------------------------- where to slice
//
// Twenty-eight stations. They are not evenly spaced: they cluster where the
// surface turns (the nose, the cowl, both ends of the roof, the tail roll) and
// they land EXACTLY on every transverse seam, because a seam is a station and a
// seam half a centimetre away from one would have to be faked.

const STATION_Z = [
  -4.40, -4.18, -3.92, -3.70, -3.40, -3.05, -2.80, -2.50, -2.15, -1.80,
  -1.40, -0.95, -0.55, -0.10, 0.35, 0.75, 1.15, 1.45, 1.75, 2.05,
  2.32, 2.55, 2.90, 3.25, 3.60, 3.90, 4.12, 4.25,
].map(zz);

/** Which panel the surface between station g and g+1 belongs to. */
const ZONE = [
  'nose', 'nose', 'nose',                                     // -4.40 .. -3.70
  'bonnet', 'bonnet', 'bonnet', 'bonnet', 'bonnet', 'bonnet', 'bonnet', 'bonnet',
  'screen', 'screen', 'screen',                               // -0.95 .. 0.35
  'cabin', 'cabin', 'cabin', 'cabin',                         //  0.35 .. 1.75
  'sail', 'sail', 'sail',                                     //  1.75 .. 2.55
  'deck', 'deck', 'deck',                                     //  2.55 .. 3.60
  'tail', 'tail', 'tail',                                     //  3.60 .. 4.25
];

/**
 * THE TRANSVERSE SEAMS: a line across the car at one station, over one range of
 * rails. Rails are given on the right half and mirrored automatically.
 *
 * `ink` is the colour the line is drawn in, which is LINE for all of them but
 * one. The reference has a thin BRIGHT trim along the top of the rear window,
 * and that is the same operation in a different colour.
 */
const CROSS = [
  { z: -3.70, r0: 6, r1: 10 },                  // leading edge of the bonnet
  { z: -1.40, r0: 2, r1: 6 },                   // door shut, front
  { z: -0.95, r0: 6, r1: 10 },                  // cowl: bonnet shut / screen base
  { z: 0.35, r0: 6, r1: 10 },                   // top of the windscreen
  { z: 1.15, r0: 2, r1: 6 },                    // door shut, rear
  { z: 1.75, r0: 6, r1: 10, ink: 'trim' },      // top of the backlight — bright
  { z: 2.55, r0: 6, r1: 10 },                   // backlight base / boot shut
  { z: 3.60, r0: 6, r1: 10 },                   // rear edge of the boot lid
  { z: 4.12, r0: 2, r1: 10 },                   // the tail roll
].map((c) => ({ ...c, z: zz(c.z) }));

/**
 * THE LONGITUDINAL SEAMS: a line along one rail for the whole length.
 *
 *   2  the rocker, and therefore the lip round both wheel arches — the line an
 *      inverted hull physically cannot draw, because the arch is a crease in
 *      the surface and not a silhouette
 *   4  the crease down the flank
 *   6  the beltline, and the bottom of the window surround
 *   7  the bonnet/roof/boot shut line, and the top of the window surround
 *   8  outer edge of each stripe
 *   9  inner edge of each stripe
 */
const ALONG = new Set([2, 4, 6, 7, 8, 9]);

/** Rails 8 and 9 are stripe edges, and there are no stripes on glass. */
const GLASS_ZONE = new Set(['screen', 'sail']);

// ---------------------------------------------------------------- palette
//
// MEASURED, NOT PICKED. The greens are sampled out of ref/camaro-plain.png and
// written down in ref/REFERENCE.md with their luminances; the purples are
// re-sampled off ref/rear-nobg-crop.png, which is a cleaner read of the same
// paint than the three-quarter drawing REFERENCE.md used.

/** The bodywork, five bands, 74 → 182 luminance. A 2.46:1 range in hard steps.
 *
 *  Exported because the cockpit shows the same paint over the top of the bonnet
 *  in first person, and two files guessing at "the car colour" separately is how
 *  a green car ends up with a red dashboard. */
export const GREEN = [
  0x3e5d21,   // 74  — deep shade, sills, valances; olive, per the cut-out
  0x629d2f,   // 99  — shadow side
  0x79bb35,   // 122 — base
  0x92d441,   // 142 — lit upper surfaces
  0xbae18e,   // 182 — hot highlight, top surfaces only
];

/**
 * The stripe. RE-MEASURED off the cut-out, which reads brighter than the old
 * three-quarter sample: the deck stripe there is #7d6595 in the light and
 * #483054 in the shade, against #6d4c79 and #4c3b58 in the old ramp. The purple
 * still sits below the green it crosses — it recedes, which is why it reads as
 * a stripe rather than as a second body colour — but not by as much as before.
 */
export const PURPLE = [0x352840, 0x483054, 0x5d4470, 0x7d6595, 0x9a83ad];

/** Chrome. Not reflective — the reference draws it as flat grey bands with hard
 *  edges, near-white on top and near-black underneath. */
const CHROME = [0x141419, 0x3f434b, 0x8b8f98, 0xc9ccd2, 0xeceef1];

/** Near-black trim: grille surrounds, recessed panels, wheel wells. */
const TRIM = [0x101016, 0x16161e, 0x1d1d26, 0x25252f, 0x2c2c38];

/** Tail lamps: the only warm colour on the car, and in the whole scene. */
const LAMP = [0x5e1a12, 0x8f2415, 0xc4381c, 0xe8552a, 0xff8a3d];

/** Rubber. Its own tiny ramp so the tyre is not one dead flat black. */
const TYRE = [0x0e0e14, 0x121218, 0x16161d, 0x1b1b23, 0x1f1f28];

/** The number plate, and the badge in the middle of the tail panel. */
const PLATE = [0x7c7a70, 0xa5a397, 0xc6c4b8, 0xdedbcd, 0xefecdd];

/** Sky, where it lands on glass. Pale and cool, and nothing between it and the
 *  near-black the rest of the window is. */
const GLASS_LIT = [0x5c6a72, 0x76858d, 0x8e9da5, 0x9fb0b8, 0xb6c6cc];

/**
 * THE INK. One colour for every drawn line on the car, matched to inkMaterial
 * so a seam and a hull edge are the same black and the eye cannot tell which is
 * which.
 */
const LINE = 0x0a0a10;

/** Five bands out of one hex, for the colours that are not measured. */
function rampFrom(hex, ks = [0.58, 0.80, 1.0, 1.22, 1.5]) {
  const c = new Color(hex);
  return ks.map((k) => new Color(
    Math.min(1, c.r * k), Math.min(1, c.g * k), Math.min(1, c.b * k),
  ).getHex());
}

function palette(P = {}) {
  return {
    green: GREEN,
    purple: PURPLE,
    chrome: CHROME,
    trim: TRIM,
    tyre: TYRE,
    plate: PLATE,
    lamp: LAMP,
    // Glass is the one body colour main.js still owns, because it is tuned
    // against the sky and the haze rather than against the car — but it is
    // taken DARK. Sampled off the references the door glass is near-black, not
    // navy, and the rear window is the single largest surface facing the chase
    // camera.
    glass: rampFrom(P.glass ?? 0x2a3550, [0.26, 0.40, 0.55, 0.78, 1.10]),
    head: [0x8a8677, 0xbdb9a6, 0xdcd8c4, 0xf6f2df, 0xfffceb],
  };
}

// ------------------------------------------------------------ the band light
//
// ONE fixed direction, from above, from the car's right and slightly from
// ahead. Every face is snapped against it into one of five slots. This is not a
// light — nothing is evaluated at runtime, it runs once per face at build time
// and the answer is written into the vertex colours.
//
// On the box car band 4 was unreachable and the highlight had to be placed by
// hand. On a loft it is not: the crown of the roof and the top of each haunch
// curve up into it on their own, which is exactly where the reference puts it.
const LX = 0.38, LY = 0.86, LZ = -0.34;

function bandOf(nx, ny, nz) {
  const d = nx * LX + ny * LY + nz * LZ;
  return d > 0.90 ? 4 : d > 0.52 ? 3 : d > 0.05 ? 2 : d > -0.45 ? 1 : 0;
}

/** Pin a ramp to one band, for faces whose orientation must not choose. */
const at = (ramp, b) => ({ r: ramp, b });

/**
 * A colour spec resolved against a face normal.
 *
 * A spec is one of: a five-entry ramp (the normal picks the band), `at(ramp,
 * n)` (the band is pinned), or a plain hex (no banding at all — used for LINE,
 * which is the same black whichever way it faces, because ink does not catch
 * the light). Out here rather than on Builder because the lamp glow has to
 * resolve a colour before it can blend anything into it.
 */
function resolveSpec(spec, nx, ny, nz) {
  if (typeof spec === 'number') return spec;
  if (Array.isArray(spec)) return spec[bandOf(nx, ny, nz)];
  return spec.r[spec.b];
}

// ------------------------------------------------------------- the lamp glow
//
// THE ONE THING ON THIS CAR THAT IS LIT, and it is done with vertex colours at
// build time like everything else: no light, no second pass, no draw call.
//
// The cut-out bleeds orange a long way out of each lamp cluster. Sampled down a
// column just outboard of the left cluster against the same heights at the
// centre of the car, where nothing is lit:
//
//        height        centre        outboard of the lamps
//        y = 94        66,102,54     124,112,54
//        y = 100       56, 78,55     168,138,74
//        y = 106        1,  0, 0     176,113,62
//        y = 112       69, 74,78     124, 45,14
//        y = 130       92,105,124    183,143,135     <- the bumper's end
//
// Green becomes amber, the black tail panel becomes dark red, and the chrome
// bumper picks it up too. The reach is about eleven pixels of a 232-pixel car
// at full strength and gone by twenty-five, which is 0.14 to 0.32 in world
// units — hence GLOW_R below. Squared falloff: linear held on far too long at
// the outer edge, where the drawing is back to plain olive.
const GLOW_HOT = 0xff8a3d;                    // LAMP[4]
const GLOW_R_OUT = xy(0.42);      // across the paint
const GLOW_R_IN = xy(0.15);       // inside the recessed tail panel
/** How much of the lamp lands on the paint right beside it. */
const GLOW_PEAK = 0.55;
/** The bounding box of the two lenses on one side. Mirrored in x. */
const GLOW_BOX = { x0: xy(0.55), x1: xy(1.27), y0: xy(0.78), y1: xy(1.00) };
/** How finely the tail face is cut up so the halo has room to fall off. */
const GLOW_STEP = GLOW_R_OUT / 6;

/**
 * How hot a point on the tail is, 0..1, from its distance to the nearest lens.
 *
 * THE RECESSED PANEL DOES NOT CATCH IT THE WAY THE PAINT DOES, and the drawing
 * is emphatic about that. Scanned inward along the tail panel from the outer
 * edge, past the end of a lamp cluster, the reference goes 97,19,15 then
 * 66,11,16 then 15,5,3 and is dead black by the badge — the glow is gone within
 * a tenth of the car's width. At the same distance the GREEN above the panel is
 * still at full strength, because it is bodywork standing proud of the lamp and
 * facing it, while the panel is sunk behind the bumper line and in its own
 * shadow. One radius for both put a brown wash right across the tail.
 */
function glowAt(x, y) {
  const ax = Math.abs(x);
  const dx = Math.max(GLOW_BOX.x0 - ax, 0, ax - GLOW_BOX.x1);
  const dy = Math.max(GLOW_BOX.y0 - y, 0, y - GLOW_BOX.y1);
  const d = Math.hypot(dx, dy);
  const GLOW_R = y > TAIL_PANEL_LO && y < TAIL_PANEL_HI ? GLOW_R_IN : GLOW_R_OUT;
  if (d >= GLOW_R) return 0;
  // FLAT NEAR THE LAMP, then away quickly. A linear or a squared-off falloff
  // both drop too fast right beside the cluster, where the drawing is still at
  // full strength: green a tenth of the car's width outboard of a lens reads
  // 168,138,74 against 56,78,55, which is as much orange as lands between the
  // two lenses themselves.
  const t = d / GLOW_R;
  return GLOW_PEAK * (1 - t * t);
}

/**
 * A resolved colour with the lamps ADDED to it.
 *
 * Added, not mixed toward. Mixing was the first attempt and it turned the black
 * tail panel into a solid orange slab with the lenses invisible inside it,
 * because a mix takes every colour to the same place at full strength however
 * dark it started. The drawing does not do that: between the two lenses of a
 * cluster it reads 150,59,32 — the black panel with red poured on top of it —
 * while the green just outboard reads 168,138,74 against 56,78,55, which is the
 * SAME amount of the same orange added to a much lighter colour. That is light
 * falling on paint, and adding is what light does.
 */
function glowed(hex, x, y) {
  const s = glowAt(x, y);
  if (s < 0.004) return hex;
  // Added INTO THE HEADROOM the colour has left, not added flat. Flat addition
  // clips: the chrome bezel round each lens starts at 139,143,152 and came out
  // 255,219,186, a cream smear with no bezel in it. Scaling by what is left
  // puts the same light on all three of the surfaces the drawing shows it on —
  // black panel 16,16,22 -> 147,87,53 against a measured 150,59,32, chrome ->
  // 203,176,165 against 183,143,135, green 62,93,33 -> 168,141,62 against a
  // measured 168,138,74.
  const add = (sh, hh) => Math.min(255, Math.round(sh + hh * s * (1 - sh / 255)));
  return (add((hex >> 16) & 255, (GLOW_HOT >> 16) & 255) << 16)
       | (add((hex >> 8) & 255, (GLOW_HOT >> 8) & 255) << 8)
       | add(hex & 255, GLOW_HOT & 255);
}

// ------------------------------------------------------------- the builder

/** How many times the pencil hatch repeats per world unit. */
const UV_SCALE = 0.45;

class Builder {
  constructor() {
    this.pos = [];
    this.col = [];
    this.uv = [];
    this.idx = [];
    this._c = new Color();
  }

  /**
   * Resolve a colour spec against a face normal.
   *
   * A spec is one of: a five-entry ramp (the normal picks the band), `at(ramp,
   * n)` (the band is pinned), or a plain hex (no banding at all — used for
   * LINE, which is the same black whichever way it faces, because ink does not
   * catch the light).
   */
  _hex(spec, nx, ny, nz) { return resolveSpec(spec, nx, ny, nz); }

  /**
   * One quad, four corners, one flat colour.
   *
   * `want` is roughly which way the face should point. The winding is CHECKED
   * against it and reversed if it is wrong, rather than being reasoned about at
   * every call site — mirrored parts flip winding, and a back-facing panel is
   * an invisible hole rather than an obvious mistake, which is exactly the
   * class of bug that has shipped on this project before.
   */
  quad(p0, p1, p2, p3, spec, want) {
    let a = p0, b = p1, c = p2, d = p3;
    let n = cross(sub(b, a), sub(c, a));
    if (Math.hypot(n[0], n[1], n[2]) < 1e-12) n = cross(sub(c, a), sub(d, a));
    if (dot(n, want) < 0) { b = p3; d = p1; n = [-n[0], -n[1], -n[2]]; }
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    const nx = n[0] / len, ny = n[1] / len, nz = n[2] / len;

    this._c.setHex(this._hex(spec, nx, ny, nz));
    const r = this._c.r, g = this._c.g, bl = this._c.b;

    // Planar UVs off the face's dominant axis, so the hatch keeps roughly the
    // same size on every panel instead of stretching across the big ones.
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const uvOf = ax > ay && ax > az ? (p) => [p[2], p[1]]
      : ay > az ? (p) => [p[0], p[2]]
        : (p) => [p[0], p[1]];

    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(r, g, bl);
      const t = uvOf(p);
      this.uv.push(t[0] * UV_SCALE, t[1] * UV_SCALE);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** One triangle. Same rules as quad — the wheel's hub fan needs it. */
  tri(p0, p1, p2, spec, want) {
    let a = p0, b = p1, c = p2;
    let n = cross(sub(b, a), sub(c, a));
    if (dot(n, want) < 0) { const t = b; b = c; c = t; n = [-n[0], -n[1], -n[2]]; }
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    const nx = n[0] / len, ny = n[1] / len, nz = n[2] / len;
    this._c.setHex(this._hex(spec, nx, ny, nz));
    const r = this._c.r, g = this._c.g, bl = this._c.b;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const uvOf = ax > ay && ax > az ? (p) => [p[2], p[1]]
      : ay > az ? (p) => [p[0], p[2]]
        : (p) => [p[0], p[1]];
    const base = this.pos.length / 3;
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(r, g, bl);
      const t = uvOf(p);
      this.uv.push(t[0] * UV_SCALE, t[1] * UV_SCALE);
    }
    this.idx.push(base, base + 1, base + 2);
  }

  /**
   * ONE CELL OF THE LOFT, WITH ITS SEAMS CUT INTO IT.
   *
   * A, B, C, D go round the cell: A and B are the two rails at the near
   * station, D and C the same two rails at the far station. Any of the four
   * borders may carry a drawn line; if it does, a strip HAIR/2 wide is taken
   * off that side of the cell and painted with the line's colour, and the
   * remaining interior is painted with the panel colour.
   *
   * The strip is CUT OUT of the cell rather than laid over it. An overlaid line
   * would need a depth offset, and a depth offset on a phone with a 16-bit
   * buffer is a line that flickers in and out as the car moves rather than one
   * that sits still on the seam.
   *
   * At most nine sub-quads and usually one or two; a cell with no seam on any
   * border emits exactly the quad it would have emitted anyway.
   */
  cell(A, B, C, D, spec, e, want) {
    const lu = 0.5 * (dist(A, B) + dist(D, C));
    const lv = 0.5 * (dist(A, D) + dist(B, C));
    const hu = lu > 1e-6 ? Math.min(0.45, HAIR * 0.5 / lu) : 0;
    const hv = lv > 1e-6 ? Math.min(0.45, HAIR * 0.5 / lv) : 0;
    const us = [0, e.u0 ? hu : 0, e.u1 ? 1 - hu : 1, 1];
    const vs = [0, e.v0 ? hv : 0, e.v1 ? 1 - hv : 1, 1];
    const P = (u, v) => [
      (1 - v) * ((1 - u) * A[0] + u * B[0]) + v * ((1 - u) * D[0] + u * C[0]),
      (1 - v) * ((1 - u) * A[1] + u * B[1]) + v * ((1 - u) * D[1] + u * C[1]),
      (1 - v) * ((1 - u) * A[2] + u * B[2]) + v * ((1 - u) * D[2] + u * C[2]),
    ];
    for (let i = 0; i < 3; i++) {
      if (us[i + 1] - us[i] < 1e-6) continue;
      for (let j = 0; j < 3; j++) {
        if (vs[j + 1] - vs[j] < 1e-6) continue;
        const c = (i === 0 ? e.u0 : i === 2 ? e.u1 : null)
              ?? (j === 0 ? e.v0 : j === 2 ? e.v1 : null) ?? spec;
        this.quad(P(us[i], vs[j]), P(us[i + 1], vs[j]),
          P(us[i + 1], vs[j + 1]), P(us[i], vs[j + 1]), c, want);
      }
    }
  }

  geometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    const Idx = this.pos.length / 3 > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new BufferAttribute(new Idx(this.idx), 1));
    return g;
  }

  get tris() { return this.idx.length / 3; }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ------------------------------------------------------------------ the loft
//
// Twenty points round a closed section: eleven down the right side from the
// keel to the crown, then the mirror of nine of them back down the left. Point
// k above ten is the mirror of point 20-k, so a span between k and k+1 is the
// same kind of panel as the span between 19-k and 20-k, which is what spanKind
// undoes.

const RING_N = 20;

/** The closed twenty-point ring at station z, as 3-vectors. */
function ring(z) {
  const h = section(z);
  const out = new Array(RING_N);
  for (let i = 0; i <= 10; i++) out[i] = [h[i][0], h[i][1], z];
  for (let i = 11; i < RING_N; i++) {
    const s = h[20 - i];
    out[i] = [-s[0], s[1], z];
  }
  return out;
}

/** Which of the eleven right-hand spans a ring span is, mirrored or not. */
const spanKind = (s) => (s <= 9 ? s : 19 - s);
/** Which of the eleven right-hand rails a ring point is, mirrored or not. */
const railKind = (k) => (k <= 10 ? k : 20 - k);

/**
 * WHAT COLOUR A PIECE OF THE LOFT IS.
 *
 * Zone says where along the car it is, span says where round the section. The
 * table is the entire paint scheme of the car and it is eleven lines long,
 * which is the argument for lofting in one sentence.
 */
function skinOf(zone, span, C, arch, skyward) {
  const glass = GLASS_ZONE.has(zone);
  // A REFLECTION, NOT A GRADIENT. Scanned across the rear window of
  // ref/camaro-rear34.png every line alternates between (0,0,0) and a pale cool
  // grey in wide hard-edged bands; in the cut-out the top of the backlight
  // carries a single bright strip of sky and the rest is black with the
  // interior showing through. One pale band across the topmost row of glass is
  // that, and it is the difference between a window and a hole.
  const lit = glass && skyward ? at(GLASS_LIT, 2) : null;
  switch (span) {
    case 0: return at(C.trim, 0);                      // the underbody
    case 1: return arch > 0.2 ? at(C.trim, 1) : at(C.green, 0);   // wheel well
    case 2: case 3: case 4:
      return C.green;                                  // the whole flank
    case 5:
      // The beltline stripe, everywhere except round the nose and the tail
      // panel, where the references do not carry it.
      return zone === 'nose' || zone === 'tail' ? C.green : C.purple;
    case 6:
      // Belt to rail. On the bonnet this is the top edge of the front wing; over
      // the cabin it is the side glass; behind it, the sail panel — a '67 coupe
      // has no rear quarter window, and glass all the way back made the old
      // car's cabin look like a bus shelter.
      return zone === 'cabin' ? at(C.glass, 0) : C.green;
    case 7: return glass ? lit ?? at(C.glass, 0) : C.green;   // outer top edge
    case 8: return glass ? lit ?? at(C.glass, 0) : C.purple;  // THE STRIPE
    case 9: return glass ? lit ?? at(C.glass, 0) : C.green;   // centre of the top
    default: return C.green;
  }
}

/**
 * The whole lofted surface.
 *
 * @param {Builder} B
 * @param {object}  C     the palette
 * @param {boolean} deco  seams and stripes, or the plain shape for the ink hull
 */
function loft(B, C, deco) {
  const rings = STATION_Z.map(ring);
  const seams = new Map();
  for (const c of CROSS) {
    const i = STATION_Z.indexOf(c.z);
    if (i < 0) throw new Error(`seam at z=${c.z} has no station to sit on`);
    seams.set(i, c);
  }
  const centre = STATION_Z.map((z) => [0, (SHAPE.sill(z) + SHAPE.yCrown(z)) * 0.5, z]);

  for (let g = 0; g < STATION_Z.length - 1; g++) {
    const zone = ZONE[g];
    const zMid = (STATION_Z[g] + STATION_Z[g + 1]) * 0.5;
    const arch = Math.max(archAt(zMid, ARCH_F), archAt(zMid, ARCH_R));
    // The strip of glass that touches the roof — the windscreen's top row and
    // the backlight's — is where the sky lands.
    const skyward = (zone === 'screen' && ZONE[g + 1] === 'cabin')
      || (zone === 'sail' && ZONE[g - 1] === 'cabin');
    const cn = seams.get(g), cf = seams.get(g + 1);
    const cm = [
      (centre[g][0] + centre[g + 1][0]) * 0.5,
      (centre[g][1] + centre[g + 1][1]) * 0.5,
      (centre[g][2] + centre[g + 1][2]) * 0.5,
    ];
    for (let s = 0; s < RING_N; s++) {
      const t = (s + 1) % RING_N;
      const A = rings[g][s], Bp = rings[g][t];
      const D = rings[g + 1][s], Cp = rings[g + 1][t];
      const kind = spanKind(s);
      const spec = skinOf(zone, kind, C, arch, skyward);
      const mid = [(A[0] + Bp[0] + Cp[0] + D[0]) / 4, (A[1] + Bp[1] + Cp[1] + D[1]) / 4,
        (A[2] + Bp[2] + Cp[2] + D[2]) / 4];
      const want = norm(sub(mid, cm));
      if (!deco) { B.quad(A, Bp, Cp, D, spec, want); continue; }

      // Which of the four borders of this cell carry a drawn line. A stripe
      // edge is not drawn where there is no stripe, which is anywhere the panel
      // under it is glass.
      const ka = railKind(s), kb = railKind(t);
      const stripeOK = !GLASS_ZONE.has(zone);
      const along = (k) => (ALONG.has(k) && (k < 8 || stripeOK) ? LINE : null);
      // A SHUT LINE CROSSING A PANEL IS A CREASE IN THE PAINT, NOT AN EDGE
      // BETWEEN TWO COLOURS, AND THE REFERENCE DRAWS IT AS ONE.
      //
      // Scanned down the middle of a stripe in ref/rear-nobg-crop.png, the
      // lines that cross the deck read 49,23,70 and 56,30,78 where the stripe
      // itself is 116,83,142 — dark PURPLE, 42% of the stripe's luminance, not
      // ink. Do the same scan down a green band and they read 45,77,38 and
      // 0,35,0 against a body of 126,184,75 — dark GREEN. The stripe's own
      // edges, where purple meets green, are a neutral 49,44,51: those are ink.
      //
      // Drawn in ink instead, as they were, the deck came out as a grid of
      // near-square tiles: the chase camera looks down on it at about 25
      // degrees, which makes each panel roughly as tall on screen as a stripe
      // is wide, and a stack of squares with black lines between them reads as
      // a chequerboard rather than as a stripe crossed by a shut line.
      //
      // So a cross-seam asks what is on both sides of it. Same paint both ways
      // and it is a crease, drawn in band 0 of that paint. Different colours
      // and it is a real edge, drawn in ink.
      const crease = (zoneA, zoneB) => {
        const a = skinOf(zoneA, kind, C, arch, false);
        const b = skinOf(zoneB, kind, C, arch, false);
        return Array.isArray(a) && a === b ? at(a, 0) : LINE;
      };
      const across = (c, other) => {
        if (!c) return null;
        const lo = Math.min(ka, kb), hi = Math.max(ka, kb);
        if (lo < c.r0 || hi > c.r1) return null;
        if (c.ink === 'trim') return at(C.chrome, 4);
        return other === undefined ? LINE : crease(zone, other);
      };
      B.cell(A, Bp, Cp, D, spec, {
        u0: along(ka),
        u1: along(kb),
        v0: across(cn, ZONE[g - 1]),
        v1: across(cf, ZONE[g + 1]),
      }, want);
    }
  }
  return rings;
}

// ------------------------------------------------------------- the end faces
//
// The nose and the tail are the two places where the loft stops and a flat
// panel closes it. They carry most of the car's detail, and all of it is
// rectangles: lamps, a grille, a plate, a badge, reflectors, exhaust cut-outs.
//
// A face is drawn as a stack of horizontal rows. Every row's outer corners lie
// exactly on the closing ring, so the face is a refinement of the ring's
// outline and there is no crack between them — the row boundaries include every
// rail height for precisely that reason.

/** Half-width of a section at height y, taken from the ring itself. */
function halfWidthAt(sec, y) {
  let best = 0;
  for (let i = 0; i < 10; i++) {
    const a = sec[i], b = sec[i + 1];
    const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
    if (y < lo - 1e-9 || y > hi + 1e-9) continue;
    const dy = b[1] - a[1];
    const t = Math.abs(dy) < 1e-9 ? 1 : (y - a[1]) / dy;
    const x = a[0] + (b[0] - a[0]) * t;
    if (x > best) best = x;
  }
  return best;
}

/** How far inside a feature's edge its own drawn line runs. */
const EDGE = xy(0.022);

/** Half the width of a divider inside a segmented feature — a tail lamp lens.
 *  Independent of HAIR: the lens is 0.33 across and five segments of it are
 *  smaller than anything else on the car, so a line sized for a panel gap turns
 *  the lens into a barcode. */
const SEG = xy(0.007);

/**
 * A flat end face.
 *
 * @param {Builder}  B
 * @param {Array}    sec   the closing section, as [x, y] on the right half
 * @param {number}   z     where the face sits
 * @param {number}   dir   +1 for the tail, -1 for the nose
 * @param {Function} base  (y, halfWidth, x0, x1) -> [[x0, x1, spec], ...]
 * @param {Array}    feats rectangles laid over the base, right half, mirrored
 * @param {Array}    band  heights the BASE changes colour at, so a row never
 *                         straddles one and paints half a bumper black
 * @param {boolean}  glow  bleed the tail lamps into everything around them
 */
function endFace(B, sec, z, dir, base, feats, band = [], glow = false) {
  const want = [0, 0, dir];
  const yLo = sec[0][1], yHi = sec[10][1];
  const cuts = new Set([yLo, yHi]);
  for (const p of sec) if (p[1] > yLo && p[1] < yHi) cuts.add(p[1]);
  for (const y of band) if (y > yLo && y < yHi) cuts.add(y);
  // The glow needs somewhere to fall off. Rows and columns on the tail face are
  // cut where features are, which leaves panels far too big to carry a gradient
  // in flat colour, so the lit part of the face gets its own grid. GLOW_STEP is
  // a sixth of the reach: any coarser and the halo comes out as three obvious
  // steps, any finer and it stops being a coloured-pencil drawing.
  if (glow) {
    for (let y = GLOW_BOX.y0 - GLOW_R_OUT; y < GLOW_BOX.y1 + GLOW_R_OUT; y += GLOW_STEP) {
      if (y > yLo && y < yHi) cuts.add(y);
    }
  }
  for (const f of feats) {
    for (const y of [f.y0, f.y0 + EDGE, f.y1 - EDGE, f.y1]) {
      if (y > yLo && y < yHi) cuts.add(y);
    }
  }
  const ys = [...cuts].sort((a, b) => a - b);

  for (let i = 0; i < ys.length - 1; i++) {
    const ya = ys[i], yb = ys[i + 1];
    if (yb - ya < 1e-5) continue;
    const ym = (ya + yb) * 0.5;
    const xa = halfWidthAt(sec, ya), xb = halfWidthAt(sec, yb);
    const w = Math.max(xa, xb);
    if (w < 1e-4) continue;

    // Right-half segments: the features that reach this row, then the base
    // colour poured into every gap they leave.
    const segs = [];
    for (const f of feats) {
      if (ym < f.y0 || ym > f.y1) continue;
      const border = ym < f.y0 + EDGE || ym > f.y1 - EDGE;
      // A feature that reaches the centreline is one object, not two: mirroring
      // it would otherwise draw its inboard edge twice, back to back, and put a
      // black line down the middle of the number plate.
      const inner = f.x0 > 1e-6;
      if (border) segs.push([f.x0, f.x1, f.ink ?? LINE]);
      else {
        if (inner) segs.push([f.x0, f.x0 + EDGE, f.ink ?? LINE]);
        segs.push([inner ? f.x0 + EDGE : f.x0, f.x1 - EDGE, f.spec, f.segs, f.source]);
        segs.push([f.x1 - EDGE, f.x1, f.ink ?? LINE]);
      }
    }
    segs.sort((p, q) => p[0] - q[0]);
    const row = [];
    let x = 0;
    for (const sg of segs) {
      if (sg[0] > x) row.push(...base(ym, w, x, sg[0]));
      row.push(sg);
      x = Math.max(x, sg[1]);
    }
    if (x < w) row.push(...base(ym, w, x, w));

    // Emitted as a trapezoid per segment, mirrored. The two rails are
    // parametrised independently so a feature keeps a constant world width even
    // where the face is narrowing under it.
    // Cut the row across so the halo has somewhere to fall off sideways. Only
    // the plain fills: a lens or a number plate is one object and slicing it
    // would put a gradient down something the reference draws flat.
    const lit = glow ? [] : row;
    if (glow) {
      for (const seg of row) {
        const n = Math.max(1, Math.ceil((seg[1] - seg[0]) / GLOW_STEP));
        if (n === 1 || seg[3] || seg[4]) { lit.push(seg); continue; }
        for (let q = 0; q < n; q++) {
          lit.push([seg[0] + (seg[1] - seg[0]) * (q / n),
            seg[0] + (seg[1] - seg[0]) * ((q + 1) / n), seg[2]]);
        }
      }
    }
    for (const [x0, x1, spec, cut, source] of lit) {
      // A lens is a SEGMENTED lens. The '67 tail light is divided into six by
      // fine bars, and drawn as one flat rectangle it reads as a sheet of red
      // plastic — which is what the first version of the tail looked like.
      const parts = [];
      if (cut > 1) {
        const step = (x1 - x0) / cut;
        for (let k = 0; k < cut; k++) {
          const a = x0 + k * step;
          if (k) parts.push([a - SEG, a + SEG, LINE]);
          parts.push([k ? a + SEG : a, k === cut - 1 ? x1 : a + step - SEG, spec]);
        }
      } else parts.push([x0, x1, spec]);
      for (const [p0, p1, ps] of parts) {
        const c0 = Math.min(p0, w), c1 = Math.min(p1, w);
        if (c1 - c0 < 1e-5) continue;
        const hot = glow && !source
          ? glowed(resolveSpec(ps, 0, 0, dir), (c0 + c1) * 0.5, ym) : ps;
        for (const sgn of [1, -1]) {
          const a0 = Math.min(c0, xa) * sgn, a1 = Math.min(c1, xa) * sgn;
          const b0 = Math.min(c0, xb) * sgn, b1 = Math.min(c1, xb) * sgn;
          B.quad([a0, ya, z], [a1, ya, z], [b1, yb, z], [b0, yb, z], hot, want);
        }
      }
    }
  }
}

/** The closing cap for the ink hull: one band per ring span, left to right. */
function endCap(B, sec, z, dir, spec) {
  const want = [0, 0, dir];
  for (let i = 0; i < 10; i++) {
    const a = sec[i], b = sec[i + 1];
    if (a[0] < 1e-6 && b[0] < 1e-6) continue;
    if (a[0] < 1e-6) B.tri([0, a[1], z], [b[0], b[1], z], [-b[0], b[1], z], spec, want);
    else if (b[0] < 1e-6) B.tri([0, b[1], z], [a[0], a[1], z], [-a[0], a[1], z], spec, want);
    else {
      B.quad([a[0], a[1], z], [b[0], b[1], z], [-b[0], b[1], z], [-a[0], a[1], z],
        spec, want);
    }
  }
}

// ------------------------------------------------------- the graphics scheme

/**
 * Twin stripes across a top surface, as a run of segments in world x.
 *
 * Used only on the end faces; everywhere else the stripes are rails of the
 * section and cost nothing at all.
 */
function stripeRow(C, x0, x1) {
  const cuts = [SX_IN, SX_OUT];
  const out = [];
  let a = x0;
  const push = (p, q) => {
    if (q - p < 1e-5) return;
    const mid = (p + q) * 0.5;
    out.push([p, q, mid > SX_IN && mid < SX_OUT ? C.purple : C.green]);
  };
  for (const c of cuts) {
    if (c > a && c < x1) {
      push(a, c - HAIR * 0.5);
      out.push([c - HAIR * 0.5, c + HAIR * 0.5, LINE]);
      a = c + HAIR * 0.5;
    }
  }
  push(a, x1);
  return out;
}

// ------------------------------------------------------------ the tail detail
//
// EVERY NUMBER BELOW WAS READ OFF ref/rear-nobg-crop.png and converted, not
// invented. The crop is 232 x 172 with the car's outline at the very edge, so a
// pixel is 1/172 of the car's height; the tail panel runs from 57% to 73% of
// the way down, the bumper from 73% to 78%, the plate from 80% to 87%, and the
// four lenses sit between 60% and 70%.
//
// The rear is eighty percent of what the player ever sees. The first version of
// it was a full-width black tail panel with a full-width black valance under it
// — which is what a real car has, and which turned the back of the car into a
// black rectangle with two orange eyes.

const TAIL_PANEL_LO = xy(0.74), TAIL_PANEL_HI = xy(1.06);
const TAIL_DECK_LO = xy(1.09);
const BUMPER_R = { lo: xy(0.58), hi: xy(0.76) };
const BUMPER_F = { lo: xy(0.47), hi: xy(0.66) };
const NOSE_GRILLE = { lo: xy(0.64), hi: xy(1.02) }, NOSE_DECK_LO = xy(1.06);

function tailFeatures(C) {
  const f = [];
  // RED, NOT ORANGE. Band 3 of the lamp ramp is #e8552a and read as an
  // indicator; the cut-out's lens is a deep red with a hot core, so the lens
  // body is band 2 and only the segment gaps are dark.
  const lens = (x0, x1) => f.push({
    x0: xy(x0), x1: xy(x1), y0: xy(0.78), y1: xy(1.00),
    spec: at(C.lamp, 2), ink: at(C.chrome, 2), segs: 5, source: true,
  });
  const box = (x0, x1, y0, y1, spec, ink) => f.push({
    x0: xy(x0), x1: xy(x1), y0: xy(y0), y1: xy(y1), spec, ink,
  });
  // TWO LENSES A SIDE, not one wide one: the '67 lamp is a pair of segmented
  // clusters and a single rectangle a side reads as a light bar off a truck.
  lens(0.55, 0.88);
  lens(0.91, 1.27);
  // The badge in the middle of the black panel.
  box(0.00, 0.13, 0.79, 0.92, at(C.chrome, 1), at(C.chrome, 3));
  // Below the bumper: the plate, two bumper guards, two reflectors and the
  // exhaust cut-outs the pipes come out of.
  box(0.00, 0.25, 0.38, 0.55, at(C.plate, 3));
  box(0.39, 0.48, 0.36, 0.63, at(C.chrome, 2));
  box(0.74, 1.02, 0.46, 0.54, at(C.chrome, 1));
  box(0.78, 1.22, 0.26, 0.48, at(C.trim, 0), at(C.trim, 0));
  return f;
}

/** What the tail face is painted where no feature covers it. */
function tailBase(C) {
  return (y, w, x0, x1) => {
    if (y > TAIL_DECK_LO) return stripeRow(C, x0, Math.min(x1, w));
    if (y > TAIL_PANEL_HI) return [[x0, x1, LINE]];
    if (y > BUMPER_R.lo) return [[x0, x1, at(C.trim, 0)]];   // panel, then bumper
    return [[x0, x1, at(C.green, 0)]];
  };
}

/** The heights the tail's base colour steps at. */
const TAIL_BANDS = [BUMPER_R.lo, TAIL_PANEL_LO, TAIL_PANEL_HI, TAIL_DECK_LO];
const NOSE_BANDS = [BUMPER_F.lo, NOSE_GRILLE.lo, NOSE_GRILLE.hi, NOSE_DECK_LO];

// ------------------------------------------------------------ the nose detail

function noseFeatures(C) {
  const f = [];
  const head = (x0, x1) => f.push({
    x0: xy(x0), x1: xy(x1), y0: xy(0.70), y1: xy(0.96),
    spec: at(C.head, 3), ink: at(C.chrome, 3),
  });
  head(0.40, 0.66);
  head(0.70, 0.96);
  return f;
}

/**
 * The grille: an egg-crate of fine vertical bars behind the headlamps.
 *
 * Barely visible in the game — the player never sees the front of this car —
 * but it is eleven quads and it is the difference between a grille and a hole
 * in the one screenshot anybody ever takes of the front.
 */
function noseBase(C) {
  return (y, w, x0, x1) => {
    if (y > NOSE_DECK_LO) return stripeRow(C, x0, Math.min(x1, w));
    if (y > NOSE_GRILLE.hi) return [[x0, x1, LINE]];
    if (y > NOSE_GRILLE.lo) {
      const out = [];
      const pitch = xy(0.16);
      let a = x0;
      for (let k = Math.ceil(x0 / pitch); k * pitch < x1; k++) {
        const c = k * pitch;
        if (c - HAIR * 0.5 > a) out.push([a, c - HAIR * 0.5, at(C.trim, 2)]);
        out.push([Math.max(a, c - HAIR * 0.5), c + HAIR * 0.5, LINE]);
        a = c + HAIR * 0.5;
      }
      if (x1 > a) out.push([a, x1, at(C.trim, 2)]);
      return out;
    }
    if (y > BUMPER_F.lo) return [[x0, x1, at(C.trim, 0)]];   // behind the bumper
    return [[x0, x1, at(C.green, 0)]];
  };
}

// ---------------------------------------------------------------- the bumpers
//
// A bumper is a bar swept along the body's own outline at the bumper's height,
// turning the corner and running across the face. It is real geometry rather
// than a stripe painted on the end panel because in both three-quarter
// references it visibly stands off the car and wraps round the corner, and
// because a chrome horizontal is the single cheapest way to make a shape look
// planted rather than perched.
//
// The section tapers to nothing at the inboard end, so the bar melts into the
// flank instead of showing a hollow tube end.

function bumperPath(zFace, dir, lo, hi, back, R, n) {
  const pts = [];
  // The NARROWEST the body gets over the bar's own height, not the width at its
  // middle. Taking the middle let the bar stand proud of the flank underneath
  // it wherever the body tucks in below the crease, and a chrome bar poking
  // through green paint reads as a scratch down the side of the car.
  const xAt = (z) => {
    const sec = section(z);
    return Math.min(halfWidthAt(sec, lo), halfWidthAt(sec, (lo + hi) * 0.5),
      halfWidthAt(sec, hi));
  };
  const zc = zFace - dir * R;
  for (let i = 0; i <= n; i++) {
    const z = zFace - dir * (back - (back - R) * (i / n));
    pts.push([xAt(z), z]);
  }
  const xc = xAt(zc) - R;
  for (let i = 1; i <= 4; i++) {
    const a = (i / 4) * Math.PI * 0.5;
    pts.push([xc + R * Math.cos(a), zc + dir * R * Math.sin(a)]);
  }
  pts.push([0, zFace]);
  return pts;
}

function bumper(B, C, zFace, dir, lo, hi, glow = false) {
  const yMid = (lo + hi) * 0.5;
  const path = bumperPath(zFace, dir, lo, hi, zz(1.10), xy(0.34), 5);
  const n = path.length;

  /** The five corners of the bar's section at path point i, on one side. */
  const barAt = (i, side) => {
    const p = path[i];
    const q = path[Math.min(i + 1, n - 1)], r = path[Math.max(i - 1, 0)];
    // Outward normal of the path in plan: the direction the bar stands off the
    // body. Turned to face away from the car by testing it against the point.
    let nx = -(q[1] - r[1]), nz = q[0] - r[0];
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    if (nx * p[0] + nz * (p[1] - zFace + dir * 2) < 0) { nx = -nx; nz = -nz; }
    // The inboard end tapers to nothing AND sinks below the surface. Ending it
    // flush left a zero-width bar lying exactly on the flank, which is two
    // coplanar surfaces and read as a bright scratch down the side of the car.
    const t = Math.min(1, i / 3);
    const o = d => d * t - xy(0.10) * (1 - t);
    const P = (d, y) => [(p[0] + nx * o(d)) * side, y, p[1] + nz * o(d)];
    // IT HAS TO STAND FURTHER OFF THE BODY THAN THE INK IS THICK. At 0.07 the
    // hull shell, inflated 0.083 along +z at the tail, closed over the top of
    // the bumper and left one bright pixel of chrome in a black band — the bar
    // was there, drawn, and buried under its own car's outline.
    return [P(0, lo), P(xy(0.10), lo + xy(0.03)), P(xy(0.17), yMid),
      P(xy(0.10), hi - xy(0.03)), P(0, hi)];
  };

  const faces = [at(C.chrome, 0), at(C.chrome, 2), at(C.chrome, 4), at(C.chrome, 3)];
  for (const side of [1, -1]) {
    for (let i = 0; i < n - 1; i++) {
      const a = barAt(i, side), b = barAt(i + 1, side);
      // The bar's own axis, so every face points away from it rather than being
      // reasoned about one at a time.
      const axis = [(a[2][0] + b[2][0]) * 0.5, yMid, (a[2][2] + b[2][2]) * 0.5];
      for (let k = 0; k < 4; k++) {
        const mid = [(a[k][0] + b[k + 1][0]) * 0.5, (a[k][1] + b[k + 1][1]) * 0.5,
          (a[k][2] + b[k + 1][2]) * 0.5];
        const nrm = norm(sub(mid, axis));
        // Chrome under the lamps catches them: the cut-out's bumper reads
        // 183,143,135 at the end nearest a cluster against 92,105,124 in the
        // middle, which is the same warm wash as the paint around it.
        const spec = glow
          ? glowed(resolveSpec(faces[k], nrm[0], nrm[1], nrm[2]), mid[0], mid[1])
          : faces[k];
        B.quad(a[k], a[k + 1], b[k + 1], b[k], spec, nrm);
      }
    }
  }
}

// ------------------------------------------------------------ exhaust tips
//
// Four of them, two a side, low and outboard, exactly where the cut-out has
// them. Short octagonal tubes rather than painted circles, because they are on
// the corner of the car and a painted circle disappears the moment the camera
// swings off dead astern.

function tips(B, C, z) {
  const N = 8, r = xy(0.075), len = xy(0.16);
  for (const side of [1, -1]) {
    for (const cx of [xy(0.92) * side, xy(1.09) * side]) {
      const cy = xy(0.36);
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
        const p = (a, rr, zz) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a), zz];
        const nrm = [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0];
        B.quad(p(a0, r, z), p(a1, r, z), p(a1, r, z + len), p(a0, r, z + len),
          at(C.chrome, 2), nrm);
        B.quad(p(a0, r, z + len), p(a1, r, z + len),
          p(a1, r * 0.62, z + len), p(a0, r * 0.62, z + len), at(C.chrome, 4), [0, 0, 1]);
        B.tri(p(a0, r * 0.62, z + len), p(a1, r * 0.62, z + len),
          [cx, cy, z + len - xy(0.03)], 0x08080c, [0, 0, 1]);
      }
    }
  }
}

// ---------------------------------------------------------------- wheels

/**
 * Sides on a wheel.
 *
 * Ten was visibly a decagon in a side-on shot. Fifteen is round enough at every
 * distance the game is played at, and it is FIFTEEN rather than twelve or
 * sixteen for one reason: five divides it, and a five-spoke rim wants its
 * sectors to line up with the tyre's.
 */
const WHEEL_SIDES = 15;

/**
 * One wheel, axle along X, built where it stands.
 *
 * Bright five-spoke chrome inside black rubber. A pale disc against black is
 * visible from the chase camera where the old grey disc against dark road was
 * not, and it is the same trick as the tail lamps: a small bright thing carries
 * further than a large dark one. The rim face is INSET inside the tyre wall,
 * which leaves a black ring around the pale disc — that ring is the ink line,
 * drawn in flat colour, at no cost, and it survives the wheel being turned,
 * which a baked outline shell would not.
 */
function wheel(B, C, w, side) {
  const N = WHEEL_SIDES;
  const cx = w.x * side, cy = w.y, cz = w.z;
  const xo = cx + side * w.hw;
  const xi = cx - side * w.hw;
  const rimR = w.r * 0.68;
  const lipR = rimR * 0.86;
  const hubR = rimR * 0.30;
  const dish = side * 0.05;
  const out = [side, 0, 0];

  const P = (a, r) => [cy + r * Math.sin(a), cz + r * Math.cos(a)];
  const A = (i) => (i / N) * Math.PI * 2;

  const shine = (a) => {
    const s = Math.sin(a);
    return s > 0.62 ? at(C.chrome, 4) : s > -0.10 ? at(C.chrome, 3)
      : s > -0.72 ? at(C.chrome, 2) : at(C.chrome, 1);
  };

  for (let i = 0; i < N; i++) {
    const a0 = A(i), a1 = A(i + 1), am = (a0 + a1) / 2;
    const [y0, z0] = P(a0, w.r);
    const [y1, z1] = P(a1, w.r);
    const my = (y0 + y1) / 2 - cy, mz = (z0 + z1) / 2 - cz;
    B.quad([xo, y0, z0], [xo, y1, z1], [xi, y1, z1], [xi, y0, z0], C.tyre, [0, my, mz]);
    const [ry0, rz0] = P(a0, rimR);
    const [ry1, rz1] = P(a1, rimR);
    B.quad([xo, y0, z0], [xo, y1, z1], [xo, ry1, rz1], [xo, ry0, rz0],
      at(C.tyre, 2), out);
    const [ly0, lz0] = P(a0, lipR);
    const [ly1, lz1] = P(a1, lipR);
    B.quad([xo, ry0, rz0], [xo, ry1, rz1], [xo, ly1, lz1], [xo, ly0, lz0],
      shine(am), out);
    // FIVE SPOKES OUT OF FIFTEEN SECTORS: two sectors of metal, one of shadow.
    const [hy0, hz0] = P(a0, hubR);
    const [hy1, hz1] = P(a1, hubR);
    const slot = i % 3 === 2;
    B.quad([xo, ly0, lz0], [xo, ly1, lz1], [xo, hy1, hz1], [xo, hy0, hz0],
      slot ? at(C.trim, 0) : shine(am), out);
    B.tri([xo, hy0, hz0], [xo, hy1, hz1], [xo + dish, cy, cz], shine(am), out);
  }
  // Inner face. Closed, because an open cylinder shows a hole straight through
  // the car whenever the camera gets below the arch.
  const inward = [-side, 0, 0];
  for (let i = 1; i < N - 1; i++) {
    const [y0, z0] = P(A(0), w.r);
    const [y1, z1] = P(A(i), w.r);
    const [y2, z2] = P(A(i + 1), w.r);
    B.tri([xi, y0, z0], [xi, y1, z1], [xi, y2, z2], at(C.tyre, 0), inward);
  }
}

// ------------------------------------------------------------------- assembly

/** Everything except the wheels: the loft, both end faces and the bright parts. */
function bodywork(B, C, deco) {
  loft(B, C, deco);
  const nose = section(NOSE_Z);
  const tail = section(TAIL_Z);
  if (deco) {
    endFace(B, nose, NOSE_Z, -1, noseBase(C), noseFeatures(C), NOSE_BANDS);
    endFace(B, tail, TAIL_Z, 1, tailBase(C), tailFeatures(C), TAIL_BANDS, true);
  } else {
    endCap(B, nose, NOSE_Z, -1, at(C.green, 1));
    endCap(B, tail, TAIL_Z, 1, at(C.green, 1));
  }
}

/** The parts that stand off the bodywork and get the finer of the two pens. */
function fittings(B, C) {
  bumper(B, C, TAIL_Z, 1, BUMPER_R.lo, BUMPER_R.hi, true);
  bumper(B, C, NOSE_Z, -1, BUMPER_F.lo, BUMPER_F.hi);
  tips(B, C, TAIL_Z - xy(0.02));
}

/**
 * Where each anchor sits.
 *
 * DERIVED FROM THE CURVES, every one of them. A previous build moved the nose
 * 0.20 back and left the bumper, grille and headlamps floating in front of the
 * car, because the anchors were a table of literals that nothing recomputed.
 */
function anchors() {
  const domeZ = zz(-2.20), wingZ = zz(3.30), roofZ = zz(1.05);
  const pipeZ = zz(1.05);
  return {
    engineTop: [0, SHAPE.yCrown(domeZ), domeZ],
    exhaustL: [-SHAPE.wMax(pipeZ) - xy(0.04), SHAPE.sill(pipeZ) + xy(0.10), pipeZ],
    exhaustR: [SHAPE.wMax(pipeZ) + xy(0.04), SHAPE.sill(pipeZ) + xy(0.10), pipeZ],
    wingRear: [0, SHAPE.yCrown(wingZ), wingZ],
    bumperFront: [0, (BUMPER_F.lo + BUMPER_F.hi) * 0.5, NOSE_Z - xy(0.07)],
    bumperRear: [0, (BUMPER_R.lo + BUMPER_R.hi) * 0.5, TAIL_Z + xy(0.07)],
    roof: [0, SHAPE.yCrown(roofZ) + xy(0.02), roofZ],
    wheelFL: [-FW.x, FW.y, FW.z],
    wheelFR: [FW.x, FW.y, FW.z],
    wheelRL: [-RW.x, RW.y, RW.z],
    wheelRR: [RW.x, RW.y, RW.z],
  };
}

/**
 * Build the car body.
 *
 * @param {object} o
 * @param {Texture} o.pencil   the shared pencil-hatch map, or null
 * @param {object}  o.palette  colours, see PAL in main.js
 * @param {number}  o.ink      ink thickness in world units
 * @returns {{ group: Group, attach: Object<string, Object3D>, stats: object }}
 */
export function buildBody(o = {}) {
  const group = new Group();
  group.name = 'body';
  const C = palette(o.palette);
  const inkW = (o.ink ?? 0.09) * SILHOUETTE;

  // ---- geometry -----------------------------------------------------------
  const paintB = new Builder();
  bodywork(paintB, C, true);
  fittings(paintB, C);
  const paintGeo = paintB.geometry();

  const wheelB = new Builder();
  wheel(wheelB, C, FW, 1);
  wheel(wheelB, C, FW, -1);
  wheel(wheelB, C, RW, 1);
  wheel(wheelB, C, RW, -1);
  const wheelGeo = wheelB.geometry();

  // ---- materials ----------------------------------------------------------
  // ONE material for the whole car. Every panel colour is a vertex colour, so
  // five bands of green paint, purple stripes, dark glass, black rubber, chrome
  // and hot lamps cost one draw call between them. `fog: true` or the car
  // floats free of the haze.
  const skin = new MeshBasicMaterial({
    vertexColors: true,
    map: o.pencil || null,
    fog: true,
  });

  const paint = new Mesh(paintGeo, skin);
  paint.name = 'paint';
  paint.frustumCulled = false;

  const wheels = new Mesh(wheelGeo, skin);
  wheels.name = 'wheels';
  wheels.frustumCulled = false;

  // ---- ink ----------------------------------------------------------------
  // ONE shell for the whole body, not one per panel, and built from the PLAIN
  // loft rather than the decorated one: a hull only ever needs a shape, and
  // inflating the seam strips would put a thousand extra triangles inside the
  // paint where nothing can see them.
  //
  // Two thicknesses, concatenated into one buffer, and it is still one draw
  // call because the two shells are welded separately and then appended to the
  // same array.
  const chunky = new Builder();
  const fine = new Builder();
  bodywork(chunky, C, false);
  fittings(fine, C);
  const ink = new Mesh(
    concat([
      buildOutline(chunky.geometry(), inkW),
      buildOutline(fine.geometry(), inkW * 0.55),
    ]),
    inkMaterial,
  );
  ink.name = 'ink';
  ink.frustumCulled = false;
  // Drawn before the paint. Both write depth, so the real surface wins wherever
  // they overlap and only the rim of the shell survives.
  ink.renderOrder = -1;

  group.add(ink, paint, wheels);

  // ---- attach points ------------------------------------------------------
  const A = anchors();
  const attach = {};
  for (const name of ATTACH) {
    const a = new Group();
    a.name = name;
    const p = A[name];
    if (p) a.position.set(p[0], p[1], p[2]);
    group.add(a);
    attach[name] = a;
  }

  return {
    group,
    attach,
    parts: { paint, wheels, ink },
    spec: {
      front: { ...FW },
      rear: { ...RW },
      length: CAR_LEN,
      height: CAR_HIGH,
      halfWidth: SHAPE.wMax(RW.z),
    },
    stats: {
      tris: paintB.tris + wheelB.tris + (ink.geometry.getIndex().count / 3),
      calls: 3,
      paintTris: paintB.tris,
      wheelTris: wheelB.tris,
      inkTris: ink.geometry.getIndex().count / 3,
    },
  };
}

/** Append several outline geometries into one buffer — one mesh, one call. */
function concat(geos) {
  let nv = 0, ni = 0;
  for (const g of geos) {
    nv += g.getAttribute('position').count;
    ni += g.getIndex().count;
  }
  const pos = new Float32Array(nv * 3);
  const Idx = nv > 65535 ? Uint32Array : Uint16Array;
  const idx = new Idx(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    pos.set(p.array, vo * 3);
    const src = g.getIndex().array;
    for (let i = 0; i < src.length; i++) idx[io + i] = src[i] + vo;
    vo += p.count;
    io += src.length;
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setIndex(new BufferAttribute(idx, 1));
  return out;
}
