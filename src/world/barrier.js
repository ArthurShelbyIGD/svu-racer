// Steel Armco crash barriers down both verges — what replaces the teal posts.
//
// ===========================================================================
// THE THREE LINES FOR src/main.js. Paste these; nothing else changes.
// ===========================================================================
//
//   1. with the other imports at the top of the file:
//
//        import { buildBarrier } from './world/barrier.js';
//
//   2. replacing `const posts = new Posts(scene, 120);`:
//
//        const posts = buildBarrier({ scene, palette: PAL, ink: INK, roadW: ROAD_W,
//                                     segLen: SEG_LEN, segCount: SEG_COUNT, behind: BEHIND });
//
//   3. the update call in the frame loop needs NO CHANGE. It already reads
//
//        posts.update(track, base, frac, st.x, baseY);
//
//      and the returned object takes the same five arguments in the same
//      order. If you would rather it were called `barrier`, rename it in both
//      places; keeping the name `posts` also keeps `PROF.posts` pointing at the
//      thing it is timing, and the readout label stays honest.
//
//   The `class Posts` declaration itself is then dead and can be deleted. It is
//   the only other reference to PAL.post.
//
// ===========================================================================
// WHY A BARRIER AND NOT POSTS — and what it must not lose
// ===========================================================================
//
// Anthony, choosing between the options: "Either a low wall or crash barriers
// would suit the cityscape but not hedges for this track."
//
// The posts existed for ONE reason, stated in their own comment: sense of
// speed. A smooth ribbon moving under you reads as almost stationary; hard
// edges whipping past at the side of vision is most of what makes a racer feel
// fast. So the DANGER in this swap is specific and it is not a look: a
// continuous rail is a smooth ribbon. Replace a picket fence with a smooth
// horizontal band and you have taken away the one thing the picket fence was
// for, while the frame still looks better in a still screenshot. A still
// screenshot cannot see this failure. That is why tools/armco.mjs measures the
// crossing rate and the frame-to-frame motion energy at the screen edge rather
// than asserting that a barrier "obviously" reads faster.
//
// What carries the speed here is therefore NOT the rail. It is:
//
//   * the SUPPORT POSTS, every 2 segments = 12 units, against the old posts'
//     every 5 segments = 30 units. Two and a half times the rate, per side.
//   * a SPLICE LINE on the rail midway between posts, so the vertical rhythm is
//     every 6 units near the camera where it matters most.
//   * a REFLECTOR at the top of each near post — small and bright, which is the
//     strongest flicker per triangle in the whole scene.
//   * the rail's own top and bottom INK LINES, which give the near field two
//     hard converging edges to shear against the ground bands.
//
// Those numbers are not asserted here. tools/armco.mjs sweeps the post spacing
// and prints the measured motion energy for each, including spacings that are
// WORSE than the posts, so the choice is visible rather than claimed.
//
// ===========================================================================
// ONE DRAW CALL, WHICH IS THE HARD CONSTRAINT
// ===========================================================================
//
// The budget is 16 and the worst measured frame uses 13. Posts cost exactly
// one. So this costs exactly one, and everything below follows from that:
//
//   * ONE Mesh, not two, so the ink CANNOT be an inverted hull — a BackSide
//     shell is a second material and therefore a second call. The ink here is
//     GEOMETRY: dark quads drawn in the same buffer as the steel, along the top
//     and bottom of the rail and down each splice. Cheaper than a hull, and for
//     a flat ribbon seen from one side it is indistinguishable from one.
//   * NOT an InstancedMesh. An Armco rail is a continuous ribbon that has to
//     bend with the curve and roll over the hills — a rigid instanced box
//     cannot, and a chain of straight instanced boxes shows a visible kink at
//     every joint on a corner. So this is built the way Road and
//     furniture.Decals are built: a fixed pool of quads, an index buffer
//     written once, positions and colours rewritten each frame, and a draw
//     range that stops at the last quad actually used.
//   * MeshBasicMaterial, vertexColors, fog: true. No lights, ever.
//
// ===========================================================================
// THE LATERAL WALK MUST BE THE ROAD'S WALK, NOT THE POSTS' WALK
// ===========================================================================
//
// Posts start their walk at the camera's segment with dx = 0. Road.update
// starts BEHIND the camera and subtracts the offset that pre-walk accumulated.
// The two differ by a constant SLOPE — the pre-walk's `pdx` — which is then
// integrated once per segment, so by the far end of a corner the two walks are
// tens of units apart. Discrete posts can absorb that; they are dots and
// nobody can see which line they are on. A continuous rail cannot: it would
// visibly peel away from the road edge into the distance and swing back on
// every corner exit. So this reproduces Road.update's walk exactly, `px` and
// all — the same reasoning as the kerb in furniture.js, and the same code.
//
// It also draws the BEHIND segments. In third person the camera sits behind
// the car, so those segments are on screen, and they are the closest and
// fastest-moving barrier in the frame — exactly the part that carries the
// speed. Stopping the ribbon at the camera throws away the best of it and
// leaves a visible cut edge beside the car.
//
// ===========================================================================
// THE COLOURS
// ===========================================================================
//
// Galvanised steel at night, in a scene measured off ref/city-night.png where
// the whole frame sits at luminance 52-58 and only 1% of pixels are above 170.
// So the barrier is NOT bright metal. It is a cool grey a little above the
// pavement (lum 72) and a little under the kerb (lum 96), with ONE bright edge
// where the top flange turns up to the sky, and one dark trough under it. That
// pairing — a light line directly above a dark line — is what makes a flat band
// read as a pressed steel section rather than as a painted stripe, and it is
// the whole of the "shading" here, baked into vertex colours because there are
// no lights and there never will be.
//
// The W-beam's cross-section, top to bottom, is: a flange curling back, a
// convex ridge, a concave valley, a second convex ridge, a bottom flange. Seen
// from the road that is five horizontal bands, and it is drawn as four plus
// two ink lines. Its widths are fractions of the rail height so the profile
// survives being retuned.

import {
  BufferGeometry, BufferAttribute, Mesh, MeshBasicMaterial, DoubleSide, Color,
} from 'three';

const _c = new Color();
const rgb = (hex) => { _c.setHex(hex); return [_c.r, _c.g, _c.b]; };

const C = {
  // lum 156. The top flange, turned up at the sky. The brightest thing at the
  // roadside apart from a lamp head, and thin — a line, not an area.
  flange:  rgb(0x9aa8b4),
  // lum 98. The upper ridge: the widest lit band. Deliberately UNDER the kerb
  // (lum 96 in furniture.js) and only just over the pavement (72): the first
  // version of this file put the whole rail at kerb brightness and the
  // photograph came back reading as a low white wall, not as steel.
  ridge:   rgb(0x5d6773),
  // lum 52. The valley between the ridges, in its own shade — DARKER than the
  // pavement behind it, which is what makes the section read as pressed metal
  // rather than as a painted stripe.
  valley:  rgb(0x2f3742),
  // lum 78. The lower ridge, dimmer than the upper one because it faces down.
  lower:   rgb(0x49525d),
  // The single tone the far rail collapses to. The area-weighted average of the
  // four above, so the LOD step changes the DETAIL and not the TONE — a merged
  // band of a different brightness would pulse as the tier boundary swept past.
  far:     rgb(0x58626d),
  // The post: near-black but not black, one step darker than furniture's
  // C.post, because it is in the rail's shadow all day.
  post:    rgb(0x1c212b),
  // The reflector. Amber, the same accent as PAL.neonC, kept small: it is the
  // one saturated thing on the barrier and it is four vertices.
  stud:    rgb(0xd9a441),
};

/**
 * Rail height, and the height of its top edge above the local ground.
 *
 * ARCADE PROPORTIONS, NOT HIGHWAY ONES, and that is a decision taken off a
 * photograph rather than off a drawing. A real W-beam is 312mm tall with its
 * top 700mm off the ground; a world unit here is a bit under a metre, so
 * "correct" would be a 0.35 rail topping out at 0.78. Built that way and
 * photographed at the camera's own height of 5.2, it came back as a pale
 * hairline at the side of the frame — indistinguishable from the kerb, and
 * with far less presence than the 2.2-tall posts it replaces. The whole reason
 * this object exists is to be seen at the edge of vision.
 *
 * So it is scaled up by about two: a 0.86 rail topping out at 1.62, still well
 * under the posts' 2.2 so it reads as a barrier and not as a fence, and with
 * the gap under it kept open because the ground moving THROUGH that gap is
 * itself a speed cue.
 */
const RAIL_H = 0.86;
const RAIL_TOP = 1.62;
/** The four steel bands, as fractions of what is left after the ink lines.
 *  Bottom to top: lower flange+ridge, valley, upper ridge, top flange. */
const BANDS = [
  [0.00, 0.30, C.lower],
  [0.30, 0.50, C.valley],
  [0.50, 0.84, C.ridge],
  [0.84, 1.00, C.flange],
];

/**
 * LOD, in segments ahead of the camera, and why the numbers are these numbers.
 *
 * The frame is about 1008 px wide at a 90-degree horizontal field of view, so
 * the focal length is about 504 px and a feature of world size `h` at distance
 * `D` covers `h / D * 504` pixels. The rail is 0.78 tall, so it covers
 *
 *     12.6 px at   30 units      3.3 px at  120 units
 *      6.3 px at   60 units      1.6 px at  240 units
 *
 * Four bands and two ink lines need about 8 px to be six distinguishable
 * things, which runs out at about 24 segments. Two bands need about 3, which
 * runs out at about 72. Past that the rail is a sub-pixel line and one quad is
 * not a compromise, it is all the information there is.
 */
const NEAR_SEG = 24;
const MID_SEG = 72;
/** Hoisted, because `for (const s of [-1, 1])` inside the segment loop is 225
 *  array allocations a frame in the hot path. Posts got away with it; a loop
 *  this size should not. */
const SIDES = [-1, 1];
/** A post is 0.32 wide: 0.7 px at 240 units. Past 40 segments it is not there. */
const POST_FAR = 40;
const SEAM_FAR = 26;
const STUD_FAR = 16;

/**
 * Build the barrier.
 *
 * @param {object} o
 * @param {Scene}  o.scene      add the mesh to this
 * @param {object} o.palette    PAL from main.js — only `ink` is read
 * @param {number} o.ink        ink thickness in world units, the near-field one
 * @param {number} o.roadW      road half-width
 * @param {number} o.segLen     length of one segment
 * @param {number} o.segCount   how many segments are drawn ahead
 * @param {number} o.behind     how many are drawn behind (main.js BEHIND)
 * @param {number} o.offset     how far outside the tarmac the rail stands
 * @param {number} o.postEvery  support posts every N segments
 * @param {number} o.seamEvery  a splice line every N segments, 0 for none
 * @returns {{ update: function, stats: object, mesh: Mesh }}
 */
export function buildBarrier(o = {}) {
  const scene = o.scene;
  const ROAD_W = o.roadW ?? 9;
  const SEG_LEN = o.segLen ?? 6;
  const SEG_COUNT = o.segCount ?? 220;
  const BEHIND = o.behind ?? 5;
  const INK = rgb(o.palette?.ink ?? 0x0c0e16);
  /** The near-field ink width: the floor of the screen-constant law below. */
  const INK_MIN = (o.ink ?? 0.09) * 0.85;
  /**
   * WHERE THE RAIL STANDS. The posts stood at ROAD_W + 3.6 and this is the same
   * line, deliberately: it is the slot Anthony has already looked at, the kerb
   * (furniture.js) ends at ROAD_W + 2.45, and moving the swap and the position
   * at the same time would make a before/after picture unreadable. Nearer is
   * bigger on screen and therefore a stronger speed cue — tools/armco.mjs
   * measures how much stronger, so the move can be made on a number later.
   */
  const OFF = o.offset ?? (ROAD_W + 3.6);
  const POST_EVERY = o.postEvery ?? 2;
  const SEAM_EVERY = o.seamEvery ?? 2;

  if (!scene) return { update: () => {}, stats: { calls: 0, tris: 0 }, mesh: null };

  // ---- the pool -----------------------------------------------------------
  // Sized at the worst case the rules above can ask for, and never grown. A
  // quad the pool refuses is a missing splice line, which is invisible; a
  // reallocation mid-corner is not.
  const SEGS = SEG_COUNT + BEHIND;
  // Sized for postEvery = 1 and seamEvery = 1, the densest the options allow,
  // so a harness sweeping the spacing cannot silently truncate the barrier and
  // then report the truncation as a result.
  const MAX = 2 * ((NEAR_SEG + BEHIND) * 6 + (MID_SEG - NEAR_SEG) * 3 + (SEGS - MID_SEG)
                   + (POST_FAR + BEHIND) + (SEAM_FAR + BEHIND) + (STUD_FAR + BEHIND)) + 32;

  const pos = new Float32Array(MAX * 12);
  const col = new Float32Array(MAX * 12);
  const index = new Uint16Array(MAX * 6);
  for (let q = 0; q < MAX; q++) {
    const v = q * 4, k = q * 6;
    index[k] = v; index[k + 1] = v + 1; index[k + 2] = v + 2;
    index[k + 3] = v; index[k + 4] = v + 2; index[k + 5] = v + 3;
  }
  const geo = new BufferGeometry();
  const posAttr = new BufferAttribute(pos, 3);
  const colAttr = new BufferAttribute(col, 3);
  posAttr.setUsage(35048);        // DynamicDraw
  colAttr.setUsage(35048);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);
  geo.setIndex(new BufferAttribute(index, 1));
  // Always in front of the camera by construction, like the road: culling it is
  // pure cost, and a bounding sphere computed once would be wrong by frame two.
  geo.boundingSphere = null;
  // Nothing at all until update() has run, or the first frame draws the whole
  // pool as uninitialised zeroes at the origin.
  geo.setDrawRange(0, 0);

  const mat = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: true });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  // After the road and the ground decals, before the instanced street boxes.
  mesh.renderOrder = 2;
  mesh.userData.armco = true;
  scene.add(mesh);

  /**
   * `stats` IS ALSO THE DIAL, and that is deliberate rather than sloppy.
   *
   * `postEvery`, `seamEvery` and `offset` are READ OUT OF HERE once per frame,
   * not captured in a closure constant, so a harness can sweep the spacing in
   * one page load instead of one rebuild per value. The spacing is the single
   * number this whole module is graded on — it IS the sense of speed — and a
   * dial that costs a 1.5-second rebuild and a browser launch to turn is a dial
   * that gets turned twice and then guessed at. One property read per frame.
   */
  const stats = { calls: 1, tris: 0, quads: 0, dropped: 0, maxQuads: MAX,
                  postEvery: POST_EVERY, seamEvery: SEAM_EVERY, offset: OFF };
  // Hung off the scene as well as returned, so a harness can read the real
  // per-frame cost without main.js having to expose anything new.
  scene.userData.armcoStats = stats;

  let n = 0;

  /** One quad, four corners, one flat colour darkened by `shade`. */
  function quad(x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4, c, shade) {
    if (n >= MAX) { stats.dropped++; return; }
    const t = n * 12;
    pos[t] = x1; pos[t + 1] = y1; pos[t + 2] = z1;
    pos[t + 3] = x2; pos[t + 4] = y2; pos[t + 5] = z2;
    pos[t + 6] = x3; pos[t + 7] = y3; pos[t + 8] = z3;
    pos[t + 9] = x4; pos[t + 10] = y4; pos[t + 11] = z4;
    const r = c[0] * shade, g = c[1] * shade, b = c[2] * shade;
    for (let k = 0, j = t; k < 4; k++, j += 3) { col[j] = r; col[j + 1] = g; col[j + 2] = b; }
    n++;
  }

  /**
   * A band of the rail, spanning one segment: a vertical quad in the plane of
   * the barrier, from height `lo` to height `hi` above the local ground.
   */
  function band(xa, ya, za, xb, yb, zb, lo, hi, c, shade) {
    quad(xa, ya + lo, za, xb, yb + lo, zb, xb, yb + hi, zb, xa, ya + hi, za, c, shade);
  }

  /**
   * A vertical member — post, splice line or reflector — standing in the plane
   * of the barrier, `w` long in z at z-position `z`, from `lo` to `hi`.
   */
  function upright(x, y, z, w, lo, hi, c, shade) {
    quad(x, y + lo, z, x, y + lo, z - w, x, y + hi, z - w, x, y + hi, z, c, shade);
  }

  const update = (track, base, frac, camX, baseY) => {
    n = 0;
    stats.dropped = 0;

    const tn = track.n;
    const zOff = frac * SEG_LEN;
    // Read the dials once, here, and not once per segment.
    const postEvery = Math.max(1, stats.postEvery | 0);
    const seamEvery = Math.max(0, stats.seamEvery | 0);
    const off = stats.offset;

    // ---- Road.update's lateral walk, reproduced exactly --------------------
    let px = 0, pdx = 0;
    for (let i = 0; i < BEHIND; i++) {
      const a = (((base - BEHIND + i) % tn) + tn) % tn;
      pdx += track.curve[a] * SEG_LEN;
      px += pdx;
    }
    let x = 0, dx = 0;

    for (let j = 0; j < SEGS; j++) {
      const i = j - BEHIND;
      const a = (((base + i) % tn) + tn) % tn;
      const b = (((base + i + 1) % tn) + tn) % tn;

      const z1 = zOff - i * SEG_LEN;
      const z2 = z1 - SEG_LEN;
      const y1 = track.hill[a] - baseY;
      const y2 = track.hill[b] - baseY;
      const x1 = x - px - camX;
      dx += track.curve[a] * SEG_LEN;
      x += dx;
      const x2 = x - px - camX;

      // The same depth shading the road uses, so the barrier recedes with the
      // tarmac rather than at its own rate.
      const shade = 1 - 0.35 * (Math.max(0, i) / SEG_COUNT);

      // Panels are laid a post-spacing at a time and alternate by a few percent,
      // the way the tarmac does. It costs nothing, and it means the rail still
      // has a rhythm in the distance after the splice lines have dropped out.
      const alt = 1 + (((((a / postEvery) | 0) & 1) ? 0.055 : -0.055));
      const sh = shade * alt;

      // THE INK GROWS WITH DISTANCE, because a pen nib does not know how far
      // away the barrier is. A world-constant line 0.09 thick is 1.5 px at 30
      // units and a fifth of a pixel at 240 — i.e. the far rail would not be
      // drawn with a pen at all. t = 0.0033 * D is the screen-constant law from
      // the city ink note in main.js, about 1.7 px at any depth on a 1008-wide
      // frame. It is CAPPED at 18% of the rail height, because screen-constant
      // taken literally would eat the whole section by the middle distance —
      // the far rail should fade to a line, not to a black one.
      const D = Math.max(6, i * SEG_LEN);
      const inkT = Math.min(RAIL_H * 0.18, Math.max(INK_MIN, 0.0033 * D));

      const lo = RAIL_TOP - RAIL_H;
      const bodyLo = lo + inkT;
      const bodyH = RAIL_H - inkT * 2;

      for (let si = 0; si < 2; si++) {
        const s = SIDES[si];
        const xa = x1 + s * off;
        const xb = x2 + s * off;

        if (i >= MID_SEG) {
          // FAR: one quad. Sub-pixel; there is no detail to carry.
          band(xa, y1, z1, xb, y2, z2, lo, RAIL_TOP, C.far, sh);
        } else if (i >= NEAR_SEG) {
          // MID: the ink line along the top, which is the silhouette against
          // the buildings, and one body band under it.
          band(xa, y1, z1, xb, y2, z2, lo, RAIL_TOP - inkT, C.far, sh);
          band(xa, y1, z1, xb, y2, z2, RAIL_TOP - inkT, RAIL_TOP, INK, shade);
          // A dark line along the bottom edge too: without it the rail floats.
          band(xa, y1, z1, xb, y2, z2, lo, lo + inkT * 0.7, INK, shade);
        } else {
          // NEAR: the full pressed section.
          band(xa, y1, z1, xb, y2, z2, lo, bodyLo, INK, shade);
          for (let k = 0; k < 4; k++) {
            const f = BANDS[k];
            band(xa, y1, z1, xb, y2, z2, bodyLo + f[0] * bodyH, bodyLo + f[1] * bodyH, f[2], sh);
          }
          band(xa, y1, z1, xb, y2, z2, RAIL_TOP - inkT, RAIL_TOP, INK, shade);
        }

        // ---- the vertical rhythm, which is the whole point -----------------
        //
        // Keyed off the ABSOLUTE segment index `a`, never off the loop counter.
        // Keyed off the loop counter, every post would hold station at a fixed
        // distance ahead of the car forever — reported from the phone once
        // already, as "I never seem to catch up with them or pass them".
        //
        // HOW FAR OUT OF THE RAIL'S PLANE THESE SIT, and why it is more than
        // looks necessary. Two vertical planes both running away from the
        // camera are nearly parallel to the view ray, so the depth difference
        // at a given pixel is Z * delta / X, not delta: at 156 units, 12.6 out,
        // a 0.03 offset is only 0.37 units of depth. A 24-bit buffer resolves
        // 0.003 there and does not care, but a 16-bit one resolves 0.74 and
        // would z-fight all the way down the barrier. This container's
        // SwiftShader gives 24 bits, so THAT CASE IS NOT MEASURED HERE — the
        // offsets are simply set an order of magnitude clear of it instead.
        if (i < POST_FAR && a % postEvery === 0) {
          // Set OUTBOARD of the rail, so the rail draws in front of it, which
          // is where a real post is.
          upright(xa + s * 0.10, y1, z1, 0.32, 0, lo + 0.16, C.post, shade);
          if (i < STUD_FAR) {
            // The reflector, inboard so it sits proud of the rail.
            upright(xa - s * 0.12, y1, z1 - 0.05, 0.22, RAIL_TOP - 0.34, RAIL_TOP - 0.12,
                    C.stud, shade);
          }
        }
        // The splice, offset from the posts so the two interleave and the
        // near-field rhythm is twice the post rate.
        if (seamEvery && i < SEAM_FAR && a % seamEvery === (seamEvery >> 1)) {
          upright(xa - s * 0.08, y1, z1, Math.max(0.09, inkT), lo + 0.02, RAIL_TOP - 0.02,
                  INK, shade);
        }
      }
    }

    // THE DRAW RANGE IS NOT AN OPTIMISATION. The index buffer is built once for
    // the whole pool, so without this every frame draws all of it, including
    // the quads this frame never wrote. They would rasterise to whatever was
    // left in the buffer, and renderer.info would count every triangle — and
    // the budget for this file is quoted in triangles.
    geo.setDrawRange(0, n * 6);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    stats.quads = n;
    stats.tris = n * 2;
  };

  return { update, stats, mesh };
}
