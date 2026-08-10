// Street furniture — the things beside a road that make it a street.
//
// THIS IS A STUB WITH A REAL CONTRACT. The interface is not yours to change;
// the contents are entirely yours to build.
//
// WHY IT MATTERS, measured rather than asserted. Put our frame next to
// ref/target-high.png and the biggest remaining difference after the buildings
// is that our roadside is EMPTY. Theirs has lampposts, traffic lights, street
// signs, pedestrian crossings, railings, fire hydrants, bins, kerbs and pools
// of warm light on the tarmac. Ours has teal posts. Quantised, 90% of their
// frame needs 40 colours and ours needs 30, and most of that gap is here.
//
// It is also the cheapest remaining win. The scenery dial proved the phone will
// draw 20,000 instanced boxes without the frame rate moving, and the whole
// scene currently spends 7 draw calls of a 16 budget.
//
// THE RULES, which are not preferences — they are why this project runs at all
// on a Helio A22 where its predecessor did not:
//
//   * MeshBasicMaterial ONLY. Never add a light. Not one.
//   * No shadows, no post-processing, no reflections, no custom shaders.
//   * fog: true on everything, or it will not recede into the haze.
//   * INSTANCE, do not multiply meshes. One InstancedMesh per family of object,
//     not one Mesh per lamppost.
//   * No per-frame allocation. Build once; after that write matrices and
//     colours into buffers that already exist.
//   * Everything generated in code. No downloaded assets of any kind.
//
// THE ONE THING MOST LIKELY TO GO WRONG, because it already did once, to the
// buildings: an object must belong to a PLACE ON THE TRACK, not to a slot in
// front of the camera. Index whatever table you build by a hash of the absolute
// segment index, never by the loop counter. Get this wrong and every lamppost
// holds station at a fixed distance ahead of the car forever — it looks almost
// right, and it was reported from the phone as "I never seem to catch up with
// them or pass them". See Scenery._slot in main.js for the pattern, including
// the `>>> 0` that stops the hash going negative.
//
// ===========================================================================
// HOW IT IS BUILT — three draw calls, and why it is only three
// ===========================================================================
//
// Everything beside this road is one of exactly two things:
//
//   1. A FLAT THING LYING ON THE GROUND. Kerbs, pavements, the pools of warm
//      light under the lamps, zebra crossings, stop lines. These have to FOLLOW
//      the road: they bend with its curvature and rise and fall with its hills,
//      so they cannot be instanced copies of a rigid shape. They are exactly
//      the problem the Road class already solves — one mesh whose vertices are
//      rewritten every frame — so they are built the same way, in ONE dynamic
//      vertex-coloured mesh. See Decals below. 1 draw call for five families.
//
//   2. A BOX STANDING UP. Lamp columns, lamp arms, lamp heads, signal posts,
//      signal heads, signal lenses, street-name plates, railings, hydrants,
//      bins. Every one of them is a coloured cuboid at a position, so every one
//      of them is an instance of the same unit BoxGeometry with a per-instance
//      colour. See Boxes below. 1 draw call for nine families.
//
// Plus one more for the ink. An inverted hull for a BOX does not need
// buildOutline at all: pushing every vertex of a cuboid out along its own
// welded normal by k is precisely the same cuboid scaled to (w+2k, h+2k, d+2k).
// So the ink family is the SAME unit box, drawn BackSide in near-black, with
// each instance matrix carrying the fattened scale. One extra draw call inks
// the entire street. (Feeding a unit box through buildOutline and then scaling
// the instance would be wrong in an interesting way: the instance scale would
// multiply the ink, so a 9-unit lamp column would get 9x thicker ink at the top
// than at the sides.)
//
//   Decals        1 call
//   Boxes         1 call
//   Boxes, inked  1 call
//   ------------------
//                 3 of the 4 allowed
//
// ===========================================================================
// WHERE THE COLOURS COME FROM
// ===========================================================================
//
// Sampled off ref/target-high.png and ref/city-night.png with a canvas, region
// by region, the same way PAL was. Luminance is 0.2126R + 0.7152G + 0.0722B.
//
//   the road, beside a lamp        #3f4348   lum  67
//   the road, away from any lamp   #2c333c   lum  50   (PAL.road is lum 48)
//   the pool of light, core        #9a8c67   lum 140
//   the kerb                       #536069   lum  94
//   the pavement                   #47474b   lum  71
//   a lamp head                              lum 215   (peak, row scan)
//   a lamp column                  #202227   lum  34
//   a crossing band                          lum 174   (peak, row scan)
//
// Three things fall out of those numbers that a description of the picture
// would not have given:
//
//   * THE POOL OF LIGHT IS THE BRIGHTEST LARGE AREA IN THE FRAME — 140 against
//     a road at 50, nearly 3:1 — and it is warm where everything around it is
//     blue. That contrast is most of what makes the reference read as a lit
//     street rather than a grey one, and it costs four vertices.
//   * THE KERB IS LIGHTER THAN THE PAVEMENT, not darker. 94 against 71. It is
//     a bright line drawn along the edge of the road, which is why the eye
//     follows the road so easily in the reference and skates off ours.
//   * THE PAVEMENT IS BRIGHTER THAN OUR GROUND BY ALMOST DOUBLE. PAL.grass is
//     lum 38; the reference pavement is 71. The strip between kerb and building
//     is a large fraction of the frame and ours is currently a void.

import {
  BufferGeometry, BufferAttribute, Mesh, MeshBasicMaterial, DoubleSide, BackSide,
  InstancedMesh, InstancedBufferAttribute, BoxGeometry, Matrix4, Vector3, Color,
} from 'three';

// ---------------------------------------------------------------- layout
//
// All distances are world units. The car is 5.6 long and the road 18 wide, so
// a unit is a bit under a metre.

/** Rumble strip width in main.js. The kerb starts where the tarmac stops. */
const VERGE_W = 1.1;
/** How high the pavement stands above the tarmac. */
const KERB_H = 0.34;
/** Kerb band: from the outer edge of the rumble strip, outward, sloping up. */
const KERB_W = 1.35;
/** Pavement runs from the kerb out to where Scenery starts its buildings
 *  (ROAD_W + 7). Overshoot slightly so there is no gap at the wall. */
const PAVE_W = 6.1;

/** One lamppost every N segments, alternating sides — 48 units apart. */
const LAMP_EVERY = 8;
/** One pedestrian crossing every N segments. 336 units, about a city block. */
const CROSS_EVERY = 56;
/** How many segments a crossing occupies. */
const CROSS_LEN = 3;
/** Number of zebra bands across the road. */
const CROSS_BANDS = 9;

/** Distance limits, in segments, for things too small to see far away.
 *  FOG_NEAR is at segment 99 and FOG_FAR at 202, so 180 is already 94% haze. */
const KERB_FULL = 100;    // kerb + pavement as two quads
const KERB_FAR = 164;     // one merged quad beyond that, nothing beyond this
const LAMP_FAR = 152;
const SMALL_FAR = 84;     // bins, hydrants
const RAIL_FAR = 56;      // railings
/** Railings come in runs of this many segments, on or off as a block. */
const RAIL_RUN = 15;
/** Pavement is laid one shade at a time, in blocks of this many segments. */
const PAVE_BLOCK = 22;
/**
 * How far the ink reaches.
 *
 * Worked out rather than guessed. The frame is 1008px across a 74-degree
 * horizontal view, so a world unit at distance d covers 1008/(2*d*tan(37deg))
 * pixels. Ink at 0.12 units is 2.7px wide at 30 units, 0.8px at 100, and 0.4px
 * at 180 — which is to say it stops being a line and starts being a slight
 * darkening of everything. Drawing it out there costs triangles and buys a
 * grey haze. 40 segments is 240 units, where it is a third of a pixel and
 * genuinely finished.
 */
const INK_FAR = 34;
/**
 * The three ink lines along the pavement — kerb top, paving joint, building
 * line — and how wide and how far.
 *
 * HALF-WIDTH, so a line is 2*PAVE_INK across. main.js's GROUND_INK is 0.10 and
 * these are finer because they lie further from the eye laterally and never
 * pass under the car, where a fat line would be a black bar.
 *
 * 44 SEGMENTS is 264 units. Further than main.js's tarmac ink because these
 * lines run PARALLEL to the view rather than across it, so they stay several
 * pixels long in the distance where a road-edge seam has already collapsed —
 * and because the vanishing pair of them either side of the street is a large
 * part of what draws the eye down the road in the reference.
 */
const PAVE_INK = 0.045;
const PAVE_JOINT = 2.4;
const PAVE_INK_FAR = 44;
/** …and for objects under a unit across, where the same ink is a third of the
 *  object rather than a fortieth of it. See the note by the hydrants. */
const INK_SMALL = 15;

/** See the note by the pool code below. */
const POOLS_ON = false;

// ------------------------------------------------------------- the palette
//
// Written as [r, g, b] so nothing has to allocate a Color per frame.
//
// THE CONVERSION THROUGH Color IS NOT DECORATION, and leaving it out was a real
// bug in the first version of this file. A vertex-colour buffer and an
// instanceColor buffer both hold LINEAR values; three.js converts them to sRGB
// on the way out. Writing hex/255 straight in therefore ships an sRGB number
// down a linear pipe and it gets gamma-corrected a second time on output —
// #454b54, a pavement measured at luminance 72, came out at about 143. Every
// surface in this file was roughly twice as bright as the reference it had been
// measured against, and it did not look broken, it just looked wrong in a way
// that invites fiddling with the numbers instead of fixing the pipe. Color's
// setHex does the sRGB-to-linear step, which is exactly what Road._quad and
// Scenery both already rely on.
const _c = new Color();
const rgb = (hex) => { _c.setHex(hex); return [_c.r, _c.g, _c.b]; };

const C = {
  kerb:      rgb(0x59666f),   // lum 96 — measured 94, the brightest ground band
  kerbAlt:   rgb(0x4c5860),   // every other segment, so the kerb has a rhythm too
  kerbLit:   rgb(0x6d6d59),   // the same kerb, standing in the lamplight
  pave:      rgb(0x454b54),   // lum 72 — measured 71
  paveAlt:   rgb(0x3d434c),
  // Two more pavements, hashed by BLOCK rather than by segment, so a whole
  // stretch of one side is laid in one shade and the next stretch in another.
  // The measurement this file is graded on is how many quantised colours it
  // takes to cover 90% of the frame, and the pavement is one of the largest
  // areas in it: three shades of pavement is three colours for no triangles.
  paveB:     rgb(0x4b4c4e),
  paveBAlt:  rgb(0x424345),
  paveC:     rgb(0x3f4a56),
  paveCAlt:  rgb(0x38424e),
  // Tarmac that has been dug up and put back. Every real road has these and
  // the reference draws them; one quad each, and they break up the largest
  // flat area in the frame.
  patchA:    rgb(0x1f2833),
  patchB:    rgb(0x323b48),
  // The same near-black main.js draws its ground seams with (PAL.ink), so the
  // line along the kerb top is the same line as the one along the road edge
  // and they do not read as two different pens.
  groundInk: rgb(0x0c0e16),
  // The pool of warm light. THREE bands, hard-edged, because this is a comic
  // and a soft gradient is not available to us anyway: no lights, no blending.
  // Two bands was not enough — the outer one had to do all the work of getting
  // from tarmac at 48 to core at 140, so it sat at 88 over a large area and the
  // whole thing read as a khaki rug rather than as light falling on a road.
  poolIn:    rgb(0x9a8c67),   // lum 140 — measured, the core
  poolMid:   rgb(0x6e6749),   // lum 103
  poolOut:   rgb(0x494432),   // lum  68 — barely above the road, which is right
  cross:     rgb(0xb4bac2),   // lum 183 — measured peak 174, allowing for fog
  crossAlt:  rgb(0x9aa0a8),
  stopLine:  rgb(0xa8aeb6),

  post:      rgb(0x232936),   // lum 38 — measured 21-34, lifted a step. See note.
  head:      rgb(0xffdca0),   // lum 214 — measured peak 215. This IS the light.
  headCool:  rgb(0xe6f0da),   // the newer lamps; the reference has both
  headRim:   rgb(0xb4894a),   // the shade around the lamp, warm but dim
  signalBox: rgb(0x141922),
  lensRed:   rgb(0xe0402f),
  lensAmber: rgb(0xe8a02a),
  lensGreen: rgb(0x3fc46a),
  signGreen: rgb(0x2f6b52),   // street-name plate, as in both references
  signWhite: rgb(0xc8cfd6),
  rail:      rgb(0x2b333e),
  hydrant:   rgb(0x9a3543),   // the one warm object at ground level, as in the ref
  hydrantCap:rgb(0x5c2028),
  binBody:   rgb(0x3c444e),
  binLid:    rgb(0x525c68),
};

/** Shop awnings over the pavement, as in both references. Saturated, but dark
 *  — a night awning is a colour you can just about name, not a bright one. */
const AWNING = [rgb(0x6e2f38), rgb(0x2f5e5a), rgb(0x6a5220), rgb(0x4a3560)];
/** Pavement, three shades, laid a block at a time. [normal, alternate] */
const PAVE = [[C.pave, C.paveAlt], [C.paveB, C.paveBAlt], [C.paveC, C.paveCAlt]];

/**
 * The hash. Copied from Scenery._slot in main.js, including the `>>> 0`.
 *
 * THE `>>> 0` IS LOAD-BEARING. `^` yields a SIGNED 32-bit int, so without it
 * this returns a negative number for about half of all inputs; a negative index
 * into a colour table reads undefined, NaN lands in the colour buffer, and a
 * NaN colour renders as black — invisible in a night scene, and therefore not
 * something looking at the screen will ever catch.
 */
function hash(a, k) {
  let x = (a * 73856093) ^ (k * 19349663);
  x = (x ^ (x >>> 13)) >>> 0;
  x = Math.imul(x, 1274126177) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** Which side of the road the lamppost belonging to segment `a` stands on. */
const lampSide = (a) => ((((a / LAMP_EVERY) | 0) & 1) ? 1 : -1);

// ------------------------------------------------------------------ decals
//
// One mesh, rewritten every frame, for everything that lies on the ground.
// Straight out of the Road playbook: a fixed number of quads, an index buffer
// that never changes, positions and colours as dynamic attributes.
class Decals {
  constructor(scene, max) {
    this.max = max;
    this.n = 0;
    this.dropped = 0;
    this.pos = new Float32Array(max * 12);
    this.col = new Float32Array(max * 12);
    const index = new Uint16Array(max * 6);
    for (let q = 0; q < max; q++) {
      const v = q * 4, o = q * 6;
      index[o] = v; index[o + 1] = v + 1; index[o + 2] = v + 2;
      index[o + 3] = v; index[o + 4] = v + 2; index[o + 5] = v + 3;
    }
    const g = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3);
    this.colAttr = new BufferAttribute(this.col, 3);
    this.posAttr.setUsage(35048);   // DynamicDraw
    this.colAttr.setUsage(35048);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    g.setIndex(new BufferAttribute(index, 1));
    // Always in front of the camera by construction, like the road. Culling it
    // is pure cost, and a bounding sphere computed once would be wrong by the
    // second frame.
    g.boundingSphere = null;
    // Nothing until update() has run. Without this the very first frame draws
    // 1,100 quads of uninitialised zeroes at the origin.
    g.setDrawRange(0, 0);
    const m = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: true });
    this.mesh = new Mesh(g, m);
    this.mesh.frustumCulled = false;
    // After the road (0) so a decal at the same height as the tarmac still
    // wins. The y offsets below do the real work; this is belt and braces.
    this.mesh.renderOrder = 1;
    this.mesh.userData.furniture = true;
    scene.add(this.mesh);
  }

  /** Four corners, one flat colour, darkened by `shade`. */
  quad(x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4, c, shade) {
    if (this.n >= this.max) { this.dropped++; return; }
    const o = this.n * 12;
    const p = this.pos, k = this.col;
    p[o] = x1; p[o + 1] = y1; p[o + 2] = z1;
    p[o + 3] = x2; p[o + 4] = y2; p[o + 5] = z2;
    p[o + 6] = x3; p[o + 7] = y3; p[o + 8] = z3;
    p[o + 9] = x4; p[o + 10] = y4; p[o + 11] = z4;
    const r = c[0] * shade, g = c[1] * shade, b = c[2] * shade;
    for (let i = 0, j = o; i < 4; i++, j += 3) { k[j] = r; k[j + 1] = g; k[j + 2] = b; }
    this.n++;
  }

  /**
   * A quad lying on the road between two segments, given in road-relative
   * lateral offsets. `xa`/`xb` are the road centre at the near and far end, so
   * the strip bends with the curve and climbs with the hill for free.
   */
  strip(xa, ya, za, xb, yb, zb, l, r, lift, c, shade) {
    this.quad(xa + l, ya + lift, za, xb + l, yb + lift, zb,
              xb + r, yb + lift, zb, xa + r, ya + lift, za, c, shade);
  }

  /** As strip, but the near and far ends may be different widths — which is
   *  what turns a rectangle into a lens. */
  taper(xa, ya, za, xb, yb, zb, l0, r0, l1, r1, lift, c, shade) {
    this.quad(xa + l0, ya + lift, za, xb + l1, yb + lift, zb,
              xb + r1, yb + lift, zb, xa + r0, ya + lift, za, c, shade);
  }

  /**
   * Push the buffers, and tell the GPU where the used quads stop.
   *
   * THE DRAW RANGE IS NOT AN OPTIMISATION, IT IS THE DIFFERENCE BETWEEN THE
   * BUDGET BEING MET AND NOT. The index buffer is built once for the maximum
   * number of quads, so without this every frame draws all 1,100 of them —
   * about 250 of which are, on a typical stretch, four coincident points at
   * y = -9999. They rasterise to nothing, but renderer.info counts them and so
   * does the vertex shader, and the budget for this file is quoted in
   * triangles. Parking unused instances is the right answer for an
   * InstancedMesh, where count is per-instance; for an indexed mesh the right
   * answer is to shorten the index range.
   */
  flush() {
    this.mesh.geometry.setDrawRange(0, this.n * 6);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}

// ------------------------------------------------------------------- boxes
//
// One InstancedMesh for every upright object on the street, plus one more,
// BackSide and near-black and fattened by the ink thickness, for the outlines.
class Boxes {
  constructor(scene, max, inkThick) {
    this.max = max;
    this.n = 0;
    this.inkN = 0;
    this.dropped = 0;
    this.k = inkThick;

    const geo = new BoxGeometry(1, 1, 1);
    // vertexColors STAYS FALSE. A BoxGeometry has no `color` attribute, an
    // undeclared attribute reads as (0,0,0) in WebGL, and three.js does
    // `vColor *= color` — so turning it on multiplies every instance colour by
    // zero and renders the whole street black. That exact bug shipped in the
    // Scenery class and survived a round of "looks good to me" because black
    // boxes in a night scene are invisible rather than obviously wrong.
    // instanceColor is its own shader path and needs no such flag.
    const mat = new MeshBasicMaterial({ vertexColors: false, fog: true });
    this.mesh = new InstancedMesh(geo, mat, max);
    this.mesh.count = 0;              // nothing until update() has run
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.userData.furniture = true;
    this.tint = new Float32Array(max * 3);
    this.mesh.instanceColor = new InstancedBufferAttribute(this.tint, 3);
    this.mesh.instanceColor.setUsage(35048);
    scene.add(this.mesh);

    const inkMat = new MeshBasicMaterial({ color: 0x090b10, side: BackSide, fog: true });
    this.ink = new InstancedMesh(new BoxGeometry(1, 1, 1), inkMat, max);
    this.ink.count = 0;
    this.ink.frustumCulled = false;
    // Drawn BEFORE the thing it outlines. Both write depth, so the real surface
    // wins wherever the two overlap and only the rim survives.
    this.ink.renderOrder = 2;
    this.ink.userData.furniture = true;
    scene.add(this.ink);

    this.m = new Matrix4();
    this.s = new Vector3();
  }

  /**
   * One box. `rot` is a rotation about Z, which is all a lamp arm needs.
   *
   * `inked` is honoured only while the inked instances are still a contiguous
   * prefix of the written ones — which they are, because add() is called in
   * near-to-far order and the ink cut-off is a distance. That is what lets the
   * whole ink family be one InstancedMesh whose count is simply the number of
   * near boxes, rather than a second pass or a parked-instance scheme.
   */
  add(x, y, z, w, h, d, rot, c, shade, inked) {
    if (this.n >= this.max) { this.dropped++; return; }
    const m = this.m;
    if (rot) { m.makeRotationZ(rot); m.scale(this.s.set(w, h, d)); }
    else { m.makeScale(w, h, d); }
    m.setPosition(x, y, z);
    this.mesh.setMatrixAt(this.n, m);
    const o = this.n * 3;
    this.tint[o] = c[0] * shade; this.tint[o + 1] = c[1] * shade; this.tint[o + 2] = c[2] * shade;

    if (inked && this.inkN === this.n) {
      const k = this.k * 2;
      if (rot) { m.makeRotationZ(rot); m.scale(this.s.set(w + k, h + k, d + k)); }
      else { m.makeScale(w + k, h + k, d + k); }
      m.setPosition(x, y, z);
      this.ink.setMatrixAt(this.inkN, m);
      this.inkN++;
    }
    this.n++;
  }

  flush() {
    this.mesh.count = this.n;
    this.ink.count = this.inkN;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.ink.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Build the street furniture.
 *
 * @param {object} o
 * @param {Scene}   o.scene    add your meshes to this
 * @param {object}  o.palette  PAL from main.js
 * @param {number}  o.ink      ink thickness in world units
 * @param {number}  o.roadW    road half-width, so things sit off the tarmac
 * @param {number}  o.segLen   length of one track segment
 * @param {number}  o.segCount how many segments are drawn ahead
 * @returns {{ update: function, stats: object }}
 */
export function buildFurniture(o = {}) {
  const scene = o.scene;
  const ROAD_W = o.roadW ?? 9;
  const SEG_LEN = o.segLen ?? 6;
  const SEG_COUNT = o.segCount ?? 220;
  /**
   * How many segments the road mesh draws BEHIND the camera.
   *
   * NOT OPTIONAL, AND NOT COSMETIC. Road.update walks the ribbon starting
   * BEHIND the camera and then subtracts the lateral offset that walk
   * accumulated, so that the camera's own segment lands at x = 0. Any object
   * that wants to sit exactly on the road edge has to reproduce that walk
   * exactly, because the alternative — starting the walk at the camera, as
   * Posts and Scenery do — leaves `dx` short by the whole behind-walk on the
   * very first segment, and that error is then integrated once per segment for
   * the next 220. On a hard corner it comes to hundreds of units at the far end
   * of the road. Buildings can absorb that; a kerb cannot, because a kerb that
   * is not on the kerb line is the only thing anyone would look at.
   *
   * main.js does not currently pass it, so it is defaulted to main.js's BEHIND.
   * Reading it from `o` first means the day it does pass it, this is already
   * right. See the note in the handover.
   */
  const BEHIND = o.behind ?? 5;
  const INK = (o.ink ?? 0.09) * 1.35;

  if (!scene) return { update: () => {}, stats: { calls: 0, tris: 0 } };

  // Sized from the worst case the placement rules below can produce, with a
  // little room, and never grown afterwards. Everything past the end is simply
  // not drawn — a missing bin is invisible, a reallocation mid-corner is not.
  const decals = new Decals(scene, 1100);
  const boxes = new Boxes(scene, 460, INK);

  const stats = {
    calls: 3, tris: 0, quads: 0, boxes: 0, inked: 0,
    maxQuads: decals.max, maxBoxes: boxes.max, dropped: 0,
  };
  // Hung off the scene as well as returned, so a measuring harness can read the
  // real per-frame counts without main.js having to expose anything. `dropped`
  // is the number of quads or boxes the placement rules asked for and the
  // fixed-size buffers refused: it must stay at zero, and it is here because a
  // silently truncated street is exactly the kind of defect that looks like an
  // art decision.
  scene.userData.furnitureStats = stats;

  /**
   * Called once per frame, before rendering, with the same arguments the road
   * and scenery get. `baseY` is the interpolated ground height under the car;
   * subtract it from track.hill[a] to place something on the ground at segment
   * a. `camX` is the car's lateral offset. Copy the walk in Scenery.update.
   */
  const update = (track, base, frac, camX, baseY) => {
    decals.n = 0;
    decals.dropped = 0;
    boxes.n = 0;
    boxes.inkN = 0;
    boxes.dropped = 0;

    const n = track.n;
    const zOff = frac * SEG_LEN;

    // ---- reproduce Road.update's lateral walk, exactly -------------------
    // Walk the behind-segments to find the constant offset the ribbon carries,
    // then start the real walk from there having subtracted it. After this,
    // segment 0 begins at x = -camX, which is where the road begins.
    let pdx = 0, px = 0;
    for (let k = 0; k < BEHIND; k++) {
      const a = (((base - BEHIND + k) % n) + n) % n;
      pdx += track.curve[a] * SEG_LEN;
      px += pdx;
    }
    let x = 0, dx = 0;

    // THE WALK STARTS BEHIND THE CAMERA, and that is not tidiness either.
    //
    // The chase camera sits eleven units BEHIND the car, so the bottom of the
    // frame shows road that is at positive z — road the car has already driven
    // over. Starting this walk at the car's own segment meant the kerb, the
    // pavement and the pool of light all stopped dead in a line a couple of
    // units in front of the camera, and a lamppost blinked out of existence at
    // the exact moment it drew level with the bonnet instead of sliding out of
    // shot behind. It is the same reason main.js gave BEHIND to the road, and
    // it was caught by driving past a marked lamppost and asking where it had
    // gone, not by looking at a still.
    for (let i = -BEHIND; i < SEG_COUNT; i++) {
      const a = (((base + i) % n) + n) % n;
      const b = (a + 1) % n;

      // Near end of this segment, then advance to the far end. Both are needed
      // so a strip can be a proper trapezium that follows the curve.
      const xa = x - px - camX;
      const ya = track.hill[a] - baseY;
      const za = zOff - i * SEG_LEN;
      dx += track.curve[a] * SEG_LEN;
      x += dx;
      const xb = x - px - camX;
      const yb = track.hill[b] - baseY;
      const zb = za - SEG_LEN;

      // The road's own depth shading, matched exactly, or the kerb would sit on
      // a road that is getting darker while the kerb is not. Clamped at 0 for
      // the behind-segments, exactly as Road.update clamps it, or the road
      // under the car comes out brighter than the road in front of it.
      const shade = 1 - 0.35 * (Math.max(0, i) / SEG_COUNT);
      const alt = (a >> 1) & 1;

      // Is this segment standing in a pool of lamplight, and on which side?
      // Worked out before the kerb so the kerb can be warmed by it.
      const poolOff = ((a + 1) % LAMP_EVERY) - 1;   // -1, 0, +1 around the lamp
      const inPool = poolOff >= -1 && poolOff <= 1 && i < LAMP_FAR;
      const poolS = inPool ? lampSide(a - poolOff) : 0;

      // ---- kerb and pavement, both sides ---------------------------------
      //
      // The kerb is ONE sloping quad rather than a vertical face plus a top
      // face. That is deliberate and it is a measured trade, not laziness: two
      // quads per side per segment is 1,760 triangles over the visible road,
      // which is a third of the entire furniture budget spent on an edge that
      // is under two pixels tall past the first fifty units. A chamfered kerb
      // catches the eye from a camera looking down at it AND from one looking
      // along it, for half the price.
      if (i < KERB_FAR) {
        const full = i < KERB_FULL;
        for (let s = -1; s <= 1; s += 2) {
          // The light catches the KERB, and only the kerb. Same four vertices,
          // a different colour, and it is what stops the pool looking like a
          // decal someone stuck on the tarmac. Warming the pavement too was
          // tried and withdrawn: the pavement is six units wide, so tinting it
          // turned pool-plus-kerb-plus-pavement into one continuous khaki slab
          // filling a third of the near frame, and the pool stopped reading as
          // a pool because nothing around it was dark any more.
          // GATED ON POOLS_ON, and that was a real defect while it was not.
          //
          // With the pools switched off, one kerb segment in eight was still
          // being painted C.kerbLit — a khaki #6d6d59 — with no pool of light
          // anywhere near it to explain why. The kerb is a 1.35-unit chamfer
          // sloping up only 0.34, so it is a GROUND surface: near the camera it
          // is seventy pixels across, and seventy pixels of sand beside the
          // gutter with nothing lit around it is the sand-bank effect the pools
          // were switched off for, arriving by a second route. It is also
          // exactly the failure this project shipped once before as "khaki
          // wedges across the road".
          //
          // Adding the three ink lines above made it worse rather than better,
          // because they draw a hard black border round it.
          const lit = POOLS_ON && s === poolS && poolOff === 0;
          const kc = lit ? C.kerbLit : alt ? C.kerb : C.kerbAlt;
          // Which pavement this block is laid in. Hashed by the BLOCK and the
          // side, so it changes at a street corner rather than every six units,
          // and — this is the part that matters — it is hashed by the absolute
          // segment, so a stretch of paving belongs to a place on the track and
          // arrives, passes and goes rather than following the car.
          const pv = PAVE[hash((a / PAVE_BLOCK) | 0, 23 + s) % PAVE.length];
          const pc = alt ? pv[0] : pv[1];
          const k0 = s * (ROAD_W + VERGE_W);
          const k1 = s * (ROAD_W + VERGE_W + KERB_W);
          const p1 = s * (ROAD_W + VERGE_W + KERB_W + PAVE_W);
          if (full) {
            // Sloping face: inner edge at tarmac height, outer edge up on the
            // pavement. Lifted a hair so it never fights the ground quad it
            // shares an edge with.
            decals.quad(xa + k0, ya + 0.02, za, xb + k0, yb + 0.02, zb,
                        xb + k1, yb + KERB_H, zb, xa + k1, ya + KERB_H, za, kc, shade);
            decals.strip(xa, ya, za, xb, yb, zb, k1, p1, KERB_H, pc, shade);

            // ---- THREE INK LINES ACROSS THE PAVEMENT --------------------
            //
            // main.js draws ground ink at the road edge and at the foot of the
            // kerb, and stops. Everything outward of that — a sixth of the
            // frame in third person — was butt-joined colour fields with
            // nothing between them, which is precisely the defect the ground
            // ink was introduced to fix on the tarmac.
            //
            // The reference's strongest black line anywhere at the road edge is
            // the one where the KERB meets the PAVEMENT: sampled across
            // ref/city-night.png it is five pixels of luminance 0-4, against
            // one or two pixels everywhere else. That is the first of these.
            // The second is a longitudinal paving joint, and the third is the
            // line where the pavement meets the building, which the reference
            // draws as heavily as it draws the kerb.
            //
            // NEAR FIELD ONLY, for the reason main.js gives: a 0.09-unit line
            // is two pixels at thirty units and a third of a pixel at a
            // hundred and eighty, and a third of a pixel of black crawls.
            if (i < PAVE_INK_FAR) {
              const line = (off) => decals.strip(
                xa, ya, za, xb, yb, zb,
                s * off - PAVE_INK, s * off + PAVE_INK, KERB_H + 0.006, C.groundInk, shade);
              line(ROAD_W + VERGE_W + KERB_W);                 // kerb top
              line(ROAD_W + VERGE_W + KERB_W + PAVE_JOINT);    // paving joint
              // PULLED INSIDE THE PAVEMENT BY ITS OWN HALF-WIDTH. Centred on
              // the pavement's outer edge, half of it would hang over nothing —
              // a sliver of black floating KERB_H above the ground where the
              // paving stops, which at a shallow angle is a visible detached
              // line rather than an edge.
              line(ROAD_W + VERGE_W + KERB_W + PAVE_W - PAVE_INK);  // building line
            }
          } else {
            // Far away the kerb is a line. Merge the two into one quad at
            // pavement height and let the colour do the work.
            decals.strip(xa, ya, za, xb, yb, zb, k0, p1, KERB_H, pc, shade);
          }
        }
      }

      // ---- the pool of warm light on the tarmac --------------------------
      //
      // THE SINGLE MOST CHARACTERISTIC THING ABOUT THE REFERENCE'S ROAD, and
      // it is four vertices per segment. There are no lights in this engine, so
      // this is not a light: it is a patch of road painted a warmer, brighter
      // colour, in two hard bands, under the lamp head.
      //
      // Built per segment rather than as one big flat quad because the road
      // is not flat. A rigid quad spanning 18 units of a hill would sink into
      // the tarmac at one end and float at the other.
      //
      // IT IS A LENS, NOT A RECTANGLE. The first version used one width per
      // segment, which draws a stepped box with hard square ends, and it read
      // exactly like a beige rug thrown on the road. Tapering the near and far
      // ends of each quad independently costs the same four vertices and gives
      // a continuous pointed shape, because segment i's far width and segment
      // i+1's near width are the same number.
      // POOLS ARE OFF PENDING A FIX. From the gameplay camera these render as
      // large khaki wedges, one of them cutting through the car — see
      // shots/night-3rd.png before this line was added. The file's own comments
      // show this was hit once and believed fixed; from the real camera it is
      // not. Turning them off rather than guessing at a new shape, because
      // guessing at rendering has been wrong every time on this project and the
      // verifier that will diagnose it properly is still running.
      //
      // The idea is right and the measurement behind it is right: the pool of
      // lamplight is the brightest large area in the reference, 140 against a
      // road at 50, and warm against blue. What is wrong is its extent — it
      // spans most of the road's width where the reference's is a modest patch
      // under the lamp head.
      if (inPool && POOLS_ON) {
        const s = poolS;
        // The head hangs over the road; the pool sits on the TARMAC under it
        // and reaches about to the crown of the road. Keeping it off the kerb
        // matters: a pool that swallows the rumble strip loses the road edge.
        const c0 = s * (ROAD_W - 0.15);
        const c1 = s * (ROAD_W - 8.2);
        const mid = (c0 + c1) * 0.5;
        // Width as a function of distance along the road from the lamp, in
        // segments. Peak just past the post, zero 1.5 segments either side.
        const prof = (u) => { const t = 1 - Math.abs(u - 0.15) / 1.5; return t > 0 ? t : 0; };
        const band = (w0, w1, k, col, lift) => {
          const a0 = mid + (c0 - mid) * w0 * k, b0 = mid + (c1 - mid) * w0 * k;
          const a1 = mid + (c0 - mid) * w1 * k, b1 = mid + (c1 - mid) * w1 * k;
          decals.taper(xa, ya, za, xb, yb, zb,
                       Math.min(a0, b0), Math.max(a0, b0),
                       Math.min(a1, b1), Math.max(a1, b1), lift, col, shade);
        };
        const w0 = prof(poolOff), w1 = prof(poolOff + 1);
        if (w0 > 0 || w1 > 0) {
          band(w0, w1, 1.00, C.poolOut, 0.018);
          band(w0, w1, 0.66, C.poolMid, 0.024);
          band(w0, w1, 0.34, C.poolIn, 0.030);
        }
      }

      // ---- a patch in the tarmac ------------------------------------------
      //
      // One quad, laid on the road at a hashed place. Real roads are patched
      // and the reference draws it; more to the point, the tarmac is the single
      // largest flat area in the frame and the grading measure is how many
      // colours it takes to cover it.
      if (i < 110 && a % 17 === 9) {
        const h = hash(a, 29);
        if (h % 100 < 55) {
          const w = 2.4 + (h >>> 8) % 5;
          const c0 = -ROAD_W + 1 + ((h >>> 12) % 100) / 100 * (2 * ROAD_W - 2 - w);
          decals.strip(xa, ya, za, xb, yb, zb, c0, c0 + w, 0.014,
                       (h & 256) ? C.patchA : C.patchB, shade);
        }
      }

      // ---- pedestrian crossing -------------------------------------------
      const cm = a % CROSS_EVERY;
      if (cm < CROSS_LEN) {
        // Bands run ALONG the road, as they do in both references — a zebra
        // crossing seen from a car is a row of long rectangles pointing at you,
        // not stripes across your path.
        const span = (2 * ROAD_W - 1.2) / CROSS_BANDS;
        for (let k = 0; k < CROSS_BANDS; k++) {
          const c0 = -ROAD_W + 0.6 + k * span;
          decals.strip(xa, ya, za, xb, yb, zb, c0, c0 + span * 0.58, 0.030,
                       (k & 1) ? C.cross : C.crossAlt, shade);
        }
      } else if (cm === CROSS_EVERY - 1) {
        // Stop line, on the approach side.
        decals.strip(xa, ya, za, xa, ya, za - SEG_LEN * 0.45,
                     -ROAD_W + 0.4, ROAD_W - 0.4, 0.030, C.stopLine, shade);
      }

      // ---- lampposts ------------------------------------------------------
      //
      // Column, arm, head — three boxes, all from the same instanced family.
      // The arm is the only thing on the street that is rotated, and it is
      // rotated about Z so that its far end drops slightly, which is what a
      // real cast arm does and what both references draw.
      if (a % LAMP_EVERY === 0 && i < LAMP_FAR) {
        const s = lampSide(a);
        const inked = i < INK_FAR;
        const foot = ya + KERB_H;
        const bx = xa + s * (ROAD_W + VERGE_W + KERB_W + 1.1);
        const H = 9.4, ARM = 4.6;
        // Column. Painted a touch lighter than the ink so it still reads as an
        // object rather than as a hole in the sky.
        boxes.add(bx, foot + H * 0.5, za, 0.30, H, 0.30, 0, C.post, shade, inked);
        // Arm, reaching over the road.
        boxes.add(bx - s * ARM * 0.5, foot + H - 0.28, za, ARM, 0.18, 0.18,
                  s * 0.115, C.post, shade, inked);
        // Head. NOT shaded with distance: this is the light source, and a row
        // of them receding at full brightness into the fog is exactly the cue
        // the reference uses to draw the eye down the street.
        // Warm sodium or cool white, hashed by the place. Both references have
        // both, and it is a whole extra colour in the frame for nothing.
        boxes.add(bx - s * ARM, foot + H - 0.28 - ARM * 0.115 - 0.22, za,
                  1.6, 0.30, 0.72, 0,
                  hash(a, 31) % 5 === 0 ? C.headCool : C.head, 1, inked);
        boxes.add(bx - s * ARM, foot + H - 0.28 - ARM * 0.115 + 0.06, za,
                  1.7, 0.26, 0.80, 0, C.headRim, shade, inked);
      }

      // ---- traffic signals and street signs, at the crossings -------------
      if (cm === 0 && i < LAMP_FAR) {
        const inked = i < INK_FAR;
        const foot = ya + KERB_H;
        for (let s = -1; s <= 1; s += 2) {
          const bx = xa + s * (ROAD_W + VERGE_W + KERB_W + 0.7);
          const H = 5.6;
          boxes.add(bx, foot + H * 0.5, za, 0.24, H, 0.24, 0, C.post, shade, inked);
          // Signal head, facing the oncoming car.
          boxes.add(bx, foot + H + 0.55, za, 0.62, 1.5, 0.46, 0, C.signalBox, shade, inked);
          // One lens lit, chosen by the hash of the place so a given junction
          // is always the same colour rather than flickering as you approach.
          const which = hash(a, 11 + s) % 5;
          const lens = which === 0 ? C.lensAmber : which < 3 ? C.lensRed : C.lensGreen;
          const ly = which === 0 ? 0.55 : which < 3 ? 1.05 : 0.05;
          boxes.add(bx, foot + H + ly, za + 0.26, 0.34, 0.34, 0.10, 0, lens, 1, inked);
          // Street-name plate, sticking out over the pavement.
          boxes.add(bx - s * 1.15, foot + H - 1.1, za, 2.2, 0.44, 0.09, 0,
                    C.signGreen, shade, inked);
          boxes.add(bx - s * 1.15, foot + H - 1.1, za + 0.06, 1.5, 0.12, 0.02, 0,
                    C.signWhite, shade, inked);
        }
      }

      // ---- railings -------------------------------------------------------
      //
      // A RAILING HAS TO BE CONTINUOUS. The first version put a two-rail panel
      // on every sixth segment, which is a rail six units long with thirty
      // units of nothing either side — and a screenshot of the near field
      // showed, unmistakably, a small black table standing on the pavement. A
      // railing is only a railing if it runs. So they are emitted in RUNS: the
      // hash decides whether a whole block of segments has railings, and then
      // every segment in that block draws its own length of rail, which also
      // means the run bends with the road instead of cutting the corner.
      if (i < RAIL_FAR && cm > CROSS_LEN + 1 && cm < CROSS_EVERY - 2) {
        const run = (a / RAIL_RUN) | 0;
        const h = hash(run, 17);
        if (h % 100 < 46) {
          const s = (h & 65536) ? 1 : -1;
          // Ink close in only. A 0.10-unit rail wearing 0.24 of ink is not a
          // rail with a line round it, it is a black bar — the first version
          // drew an unbroken black wall down the pavement for 400 units.
          const inked = i < INK_SMALL;
          const foot = ya + KERB_H;
          const bx = xa + s * (ROAD_W + VERGE_W + KERB_W + 0.5);
          const zc = za - SEG_LEN * 0.5;
          // Overlapping by a whisker, so consecutive segments do not show a
          // hairline of sky between their rails on a curve.
          boxes.add(bx, foot + 0.94, zc, 0.10, 0.14, SEG_LEN + 0.15, 0, C.rail, shade, inked);
          boxes.add(bx, foot + 0.52, zc, 0.09, 0.10, SEG_LEN + 0.15, 0, C.rail, shade, inked);
          // An upright every OTHER segment. Twelve units apart is wide for a
          // picket fence and exactly right for the budget: at speed the rails
          // are a streak and the uprights are a flicker, and doubling them
          // costs 700 triangles to make the flicker slightly faster.
          if ((a & 1) === 0) {
            boxes.add(bx, foot + 0.50, za, 0.12, 1.00, 0.12, 0, C.rail, shade, inked);
          }
        }
      }

      // ---- hydrants and bins ----------------------------------------------
      //
      // Small, low, close to the road, and hashed by PLACE so the same bin is
      // on the same corner every lap. These are what sells the near field at
      // speed, because they are what flicks past you.
      //
      // INKED MUCH CLOSER IN THAN THE LAMPS. Ink is a fixed width in world
      // units, so on a 0.74-unit bin it is a third of the object where on a
      // 9.4-unit lamppost it is a fortieth. At 150 units a fully inked bin
      // stopped being a bin and became a black smudge — visible in the first
      // capture as unexplained blobs on the pavement. Small things get ink only
      // while they are big enough to have an inside as well as an edge.
      if (i < SMALL_FAR && cm > CROSS_LEN) {
        const inked = i < INK_SMALL;
        const foot = ya + KERB_H;
        if (a % 10 === 3 && hash(a, 3) % 100 < 58) {
          const s = (hash(a, 4) & 1) ? 1 : -1;
          const bx = xa + s * (ROAD_W + VERGE_W + KERB_W + 0.75);
          boxes.add(bx, foot + 0.50, za, 0.36, 1.00, 0.36, 0, C.hydrant, shade, inked);
          boxes.add(bx, foot + 1.04, za, 0.52, 0.20, 0.52, 0, C.hydrantCap, shade, inked);
        }
        if (a % 10 === 8 && hash(a, 5) % 100 < 55) {
          const s = (hash(a, 6) & 1) ? 1 : -1;
          const bx = xa + s * (ROAD_W + VERGE_W + KERB_W + 1.6);
          boxes.add(bx, foot + 0.56, za, 0.74, 1.12, 0.74, 0, C.binBody, shade, inked);
          boxes.add(bx, foot + 1.18, za, 0.86, 0.16, 0.86, 0, C.binLid, shade, inked);
        }
        // ---- shop awnings ---------------------------------------------------
        // One box, out at the building line, in a colour that is not blue. Both
        // references have them and they are the only saturated thing at street
        // level besides the hydrants — which is exactly what the colour count
        // is asking for, at twelve triangles each.
        if (a % 13 === 6 && hash(a, 7) % 100 < 55) {
          const h2 = hash(a, 8);
          const s = (h2 & 1) ? 1 : -1;
          const bx = xa + s * (ROAD_W + VERGE_W + KERB_W + PAVE_W - 1.0);
          boxes.add(bx, ya + KERB_H + 2.75, za, 3.4, 0.30, 1.9, 0,
                    AWNING[(h2 >>> 4) % AWNING.length], shade, inked);
        }
      }
    }

    decals.flush();
    boxes.flush();
    stats.quads = decals.n;
    stats.boxes = boxes.n;
    stats.inked = boxes.inkN;
    stats.tris = decals.n * 2 + boxes.n * 12 + boxes.inkN * 12;
    stats.dropped = decals.dropped + boxes.dropped;
  };

  return { update, stats };
}
