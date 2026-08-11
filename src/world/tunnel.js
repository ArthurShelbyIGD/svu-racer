// The tunnel — where the city and the sky are cut off and the light changes.
//
// ===========================================================================
// THE LINES FOR src/main.js. Paste these; nothing else changes.
// ===========================================================================
//
//   1. with the other world imports at the top of the file:
//
//        import { buildTunnel } from './world/tunnel.js';
//
//   2. next to `const gantry = buildGantry({ ... });` (around line 2201):
//
//        const tunnel = buildTunnel({ scene, palette: PAL, ink: INK, roadW: ROAD_W,
//                                     segLen: SEG_LEN, segCount: SEG_COUNT, behind: BEHIND });
//
//   3. in the frame loop, immediately after `gantry.update(...)` (around 3068):
//
//        tunnel.update(track, base, frac, st.x, baseY);
//
//   4. in the `window.RACER = { ... }` object, so a harness can reach it:
//
//        tunnel,
//
//   5. WHEN THE AUDIO WANTS IT — not now, and not by re-deriving the segment
//      range in main.js, which is how two files come to disagree about where
//      the tunnel is:
//
//        audio.setEnclosed(tunnel.inside(st.dist));
//
//      `tunnel.inside(dist)` is a boolean: true when the CAR at that distance
//      is under the roof. If the echo wants to fade rather than switch, use
//      `tunnel.enclosure(st.dist)` instead — 0 outside, 1 well inside, with a
//      ramp about nine units long at each mouth so the reverb does not appear
//      between one frame and the next. Both take a raw `st.dist`; both wrap
//      with the track.
//
// ===========================================================================
// WHERE IT IS, AND WHY THERE — MEASURED OFF THE TRACK, NOT PICKED
// ===========================================================================
//
// Segments 1520..1600 (world 9,120 to 9,600; about 71% of the way through a
// race). tools/tunnel.mjs prints the survey that chose it, from the real
// track.curve/track.hill of a running build rather than from a copy of
// buildTrack that could drift. The three things a tunnel wants:
//
//   * STRAIGHT, so the far mouth is a hole you can see rather than a wall you
//     cannot. |curve| over the whole run peaks at 0.00156 against the track's
//     worst corner of 0.1118 — 1.4% of it.
//   * FLAT, because the tube is a rigid cross-section swept along the road: a
//     crest inside it breaks the "closed tube" property that cuts off the sky,
//     and a dip hides the exit. hill[] is CONSTANT at 41.66 across every
//     segment from 1484 to 1620. Nowhere else on the lap is exactly flat for
//     that long.
//   * AN APPROACH. 1440..1520 is flat and near-straight too (max |curve|
//     0.00625, gradient exactly zero), so the portal comes into view head-on
//     down a straight instead of appearing round a corner. It still does not
//     come into view as EARLY as I would like — see the fog note below, which
//     has the measured distances.
//
// The other candidates and why they lost: 610..690 is straight and gently
// descending but sits at the exit of the hardest corner on that half of the
// lap (|curve| 0.076), so the portal would jump into frame; 1030..1110 is
// straight and near-flat but is approached over a 0.057 crest that hides it,
// and it is 40 segments from the reserved bridge ground. This site is 70
// segments — 420 units — clear of the far end of the bridge reservation
// (1150..1450), and 500 clear of the finish gantry.
//
// It also ends 20 segments before the track turns hard right and starts down
// (curve 0.107 by segment 1660). Coming out of the dark into a corner is the
// best thing on the lap and it cost nothing: it was already there.
//
// atSeg and lenSeg are parameters, and they are also LIVE DIALS on `stats`,
// read once per frame — so tools/tunnel.mjs can sweep the length in one page
// load instead of one rebuild per value. The buffer is sized for `maxLenSeg`
// (140 by default), not for `lenSeg`, so a sweep cannot silently truncate the
// tunnel and then report the truncation as a result.
//
// ===========================================================================
// WHAT THE FOG DOES TO A TUNNEL, WHICH IS THE WHOLE DESIGN PROBLEM
// ===========================================================================
//
// scene.fog is FogExp2 at density 0.0030 toward PAL.haze (#3a5680, luminance
// 83). The fraction of haze in a surface at distance D is 1 - exp(-(0.003 D)^2):
//
//        50 units   2%        300 units  55%
//       100 units   9%        400 units  76%
//       200 units  30%        600 units  96%
//
// Three consequences, and every one of them shaped this file.
//
//   1. FOG IS A BRIGHTENER HERE, NOT A GREYER. Haze at luminance 83 is well
//      ABOVE the tarmac (48) and far above anything a tunnel interior should
//      be (15-45). So the deep end of a tunnel does not fade to black, it
//      fades to pale blue. A tunnel long enough to be atmospheric is a tunnel
//      whose far half is the same colour as the sky.
//
//   2. YOU CANNOT SEE THE END OF THIS TUNNEL FROM ITS ENTRANCE, AND NO LENGTH
//      FIXES THAT. This paragraph used to say the opposite — that 80 segments
//      was "the longest tube whose far end is still a bright hole" — and the
//      measurement in tools/tunnel.mjs section 3b took it apart. Standing four
//      segments inside, the contrast between the far end and the wall around
//      it goes 23.8 at a 30-segment tunnel, 16.8 at 50, and then 15.4, 15.3,
//      15.3 at 80, 110 and 140. It stops moving because past about 50 segments
//      there is no exit left to see: 300 units is 55% haze and 480 is 87%.
//
//      What the same sweep does show is that the middle of the tunnel is the
//      same darkness at every length — 3.2 luminance of spread from 180 units
//      to 840. So LENGTH BUYS TIME IN THE DARK AND NOTHING ELSE, and 80
//      segments is chosen for the 2.3 seconds it buys at racing speed. Thirty
//      segments would show you its exit from the door and be over in 0.9s,
//      which is a bump, not an event. The site's own straight runs out at
//      about 100 segments in any case: past that the tube bends into the
//      corner at 1630.
//
//   3. THE MOUTH IS A LOCAL EVENT, AND IT IS FREE. Looking out of a dark tube
//      at a world 300+ units away, the world IS the haze — luminance 83
//      against walls at 15-30 in the near field. The bright hole is not
//      painted, it is what the fog does to everything that is not the tunnel.
//      It appears when the exit is inside about 200 units and grows hard from
//      there: measured, 2,900 bright pixels at the entrance against 27,000
//      six segments from the exit. What IS painted is the ring around it — the
//      last ten segments of the interior mixed toward a pale spill colour,
//      which is both the light falling on the inside of the exit and the thing
//      that keeps the hole legible. That mix was 0.92 over thirteen segments
//      to begin with and the photograph came back with the whole end of the
//      tunnel white; 0.60 over ten is a glow rather than a flood.
//
// The other place fog hurts is the APPROACH, and it cannot be fixed from here
// either. The portal first changes a single pixel at about 330 units, is a
// recognisable shape at about 210, and only dominates inside 120 — about half
// a second at racing speed. Two things eat it: 63% haze at 330 units, and the
// street canyon, which hides everything of the facade wider than the road
// behind the buildings lining it. What DOES survive haze is brightness and
// saturation, because fog takes a fixed FRACTION of a difference: repainting
// the facade from PAL.wall to pale concrete, widening the amber band to 2.2
// units and cutting eleven unshaded marker lamps into the arch took the
// strongly-changed pixel count from 41 to 99 at 330 units, 338 to 496 at 210
// and 4,240 to 6,732 at 72 — between 1.5x and 2.4x, for about thirty
// triangles. The rest would need scene.fog, which belongs to main.js and to
// every other object in the frame.
//
// ===========================================================================
// NO LIGHTS. THE LIGHT IS GEOMETRY AND VERTEX COLOUR.
// ===========================================================================
//
// A tunnel is the single most tempting object in this project to put a light
// in, and a light is the thing that made the last project unplayable on the
// target phone. There is not one here and there never will be. What there is
// instead:
//
//   * A BAKED DARKNESS RAMP along the tube, keyed to the ABSOLUTE segment so
//     it is a property of the place and not of where the camera happens to be.
//     Bright at the mouths, darkest in the middle, smooth in between — which
//     is also what stops the entry from being a step change.
//   * LIGHT FITTINGS: one bright quad each side every four segments, at
//     luminance 212, drawn at full brightness with no depth shading, exactly
//     as furniture.js draws its lamp heads and for the same reason — a row of
//     them receding to the vanishing point is the cue, and dimming them with
//     distance throws it away.
//   * A POOL under each fitting: a wider, dimmer quad on the wall. Four
//     vertices of fake bounce light, and the only reason the wall reads as lit
//     from above rather than as painted in two tones.
//
// ===========================================================================
// ONE DRAW CALL, AND USUALLY NONE
// ===========================================================================
//
// One Mesh, one MeshBasicMaterial, vertexColors, fog: true, DoubleSide. The
// ink is GEOMETRY — dark bands tiled exactly into the wall's own plane — not
// an inverted hull, because a hull is a second material and therefore a second
// call. The budget is 16 and the worst frame measured 13; this is allowed to
// spend one and it spends one.
//
// It spends LESS than one for most of the lap. `mesh.visible` is driven from
// whether any part of the tunnel is inside the draw distance, and three.js
// skips an invisible object before it reaches the renderer, so the cost is
// zero calls and zero triangles for the ~93% of the track that is nowhere near
// segment 1520. Note that a draw range of zero would NOT have done this:
// three.js still calls gl.drawElements with a count of 0 and WebGLInfo still
// counts it, so an "empty" mesh costs a draw call every frame of the race.
//
// THE VISIBILITY FLAG IS EDGE-TRIGGERED, and that is for the harness's sake.
// update() only writes mesh.visible when the in-range state CHANGES, so a
// harness that sets `tunnel.mesh.visible = false` to photograph what the
// tunnel was covering keeps it hidden instead of having it switched back on
// the next frame. The crash barrier did not expose its mesh at all, and "is it
// actually on screen" then had to be answered by eye — where it was mistaken
// for the pavement railings. tools/tunnel.mjs measures the mouth by hiding
// this mesh and counting the pixels that did not change.
//
// ===========================================================================
// THE CROSS-SECTION, AND WHAT IT HAS TO CLEAR
// ===========================================================================
//
// The tube is swept along the road exactly the way Road.update lays the
// tarmac — the same lateral walk, `px` pre-walk and all, for the reason
// barrier.js gives: a walk that starts at the camera instead of BEHIND it is
// short by a constant slope which then integrates once per segment, and a
// continuous surface peels visibly away from the road edge by the far end of
// a corner where discrete objects can absorb it.
//
// Every number across the section is set by something that already exists on
// this road, and getting any of them wrong puts somebody else's geometry
// through a wall:
//
//   WALL_X 12.0   THE ONE NUMBER THAT WAS SETTLED BY A MEASUREMENT REVERSING A
//                 DECISION. It was 13.7 first, on the reasoning that the wall
//                 should be outboard of everything already standing on the
//                 pavement — the Armco at 12.6, lamp columns at 12.55,
//                 railings at 11.95, bins out to 13.48 — so that all of it
//                 would be street furniture inside a tunnel, and so that the
//                 car at full STRAY_MAX (11.1, plus 1.95 of bodywork) could
//                 not be driven into the wall.
//
//                 Then the pixel diff in tools/tunnel.mjs section 5 found up
//                 to 4.9% OF THE FRAME was city buildings standing INSIDE the
//                 tube, with pixel deltas up to 581 — lit facades on the
//                 tunnel wall, in every frame, in both views. Scenery's
//                 nearest row sits at ROAD_W + 8 = 17 from the road centre and
//                 its widest kind is 10 units across, so the inboard face of a
//                 building reaches 12.0 exactly. Nothing about draw order
//                 fixes that: the building is genuinely in front of the wall.
//
//                 The sweep: at 13.7 the leak is 4.9% of the frame, at 12.15
//                 it is 1.6%, at 12.0 it is 0.10%, and going further in to
//                 11.6 buys 0.01% more. So 12.0, exactly at the knee, which
//                 costs: the Armco, the lamp columns and the bins all end up
//                 OUTSIDE the wall and are hidden (a barrier that terminates
//                 at a tunnel portal is what a real road does); and the car at
//                 maximum stray now overlaps the wall by about a unit of
//                 bodywork. That was photographed too — the chase camera stays
//                 outside the wall and it reads as scraping along it, which is
//                 a far smaller price than a lit tower block in the roof.
//   CEIL_Y  8.2   UNDER the lampposts. A lamp head's lowest box sits at 8.56
//                 above the road and its ink hull at about 8.47, so a roof at
//                 8.2 hides the head, the arm and the top of the column
//                 completely, and the column simply runs up into the ceiling
//                 like a support. A roof at 8.6 would have sliced the bottom
//                 four centimetres off every lamp head in the tunnel — the
//                 sort of thing that is invisible in a still and strobes at
//                 speed. The alternative was a roof above 9.3 with the street
//                 lighting left inside; it was rejected because a wide, high
//                 box reads as an underpass, and because the fittings
//                 in here should be ours, where the brightness is a number we
//                 chose.
//   SPRING  5.4   Where the wall stops and the chamfer starts. The chamfer is
//   CEIL_X  8.9   what makes a box read as a tunnel, and CEIL_X is WALL_X less
//                 a fixed 3.1 of chamfer run, so moving the wall keeps the
//                 arch. One quad a side.
//   WALK_Y 0.72   A RAISED walkway over the pavement, not a dark quad laid on
//                 top of it. The pavement is the brightest large surface in
//                 the scene (luminance 100-130, measured off the reference in
//                 main.js) and leaving it lit inside a dark tunnel is the
//                 single ugliest thing this feature could do. Raising the
//                 replacement by 0.38 instead of floating it by 0.02 is also
//                 the difference between a surface that is 15 depth units
//                 clear of the pavement at 200 units and one that is under
//                 one — see the note on the depth buffer below.
//
// The one thing this does NOT clear is the pedestrian crossing and its two
// signal posts at segment 1568, which fall inside the tunnel because crossings
// are every 56 segments and no 80-segment span on this track can miss one. The
// posts are 5.6 tall at x = 11.05, so they stand INSIDE the tube against the
// walkway. Photographed, not reasoned about: tools/tunnel.mjs saves a frame
// at that segment.
//
// ===========================================================================
// THE DEPTH BUFFER, WHICH MAY BE 16-BIT ON THE PHONE — AN EXPLICIT RISK
// ===========================================================================
//
// SwiftShader in this container gives 24 bits. A Helio A22 with a GE8320 may
// give 16, and at 16 bits with near 0.5 the resolvable depth difference is
// about D^2 / 32768 — 0.3 units at 100, 1.2 at 200, 2.7 at 300. So every
// surface here is either exactly tiled against its neighbour (the ink lines
// are bands cut out of the wall's own plane, not stripes laid over it — no
// coplanar pair anywhere in the tube or the portal) or separated by a real
// distance rather than a fudge:
//
//   * the walkway top is 0.38 above the pavement, which at 200 units is 15
//     depth units of separation. Safe at 16 bits by a factor of twelve.
//   * the light fittings and their pools stand PROUD of the wall by an offset
//     that GROWS WITH DISTANCE — max(0.10, 0.0016 D) — the same
//     screen-constant reasoning barrier.js uses for its ink thickness. A fixed
//     0.05 would z-fight from about 100 units out on a 16-bit buffer; the
//     growing offset is 0.86 at 540 units, which is 34 depth units of
//     separation there and still an invisible fraction of a pixel sideways.
//   * the ceiling ribs hang 0.35 BELOW the ceiling rather than sitting on it.
//
// THIS IS THE PART I CANNOT TEST HERE. If the phone shows shimmering lines on
// the tunnel walls at middle distance, the first thing to try is raising the
// 0.0016 in PROUD to 0.003; the second is dropping the ribs. Nothing else in
// the tube is close enough to fight.

import {
  BufferGeometry, BufferAttribute, Mesh, MeshBasicMaterial, DoubleSide, Color,
} from 'three';

const _c = new Color();
const rgb = (hex) => { _c.setHex(hex); return [_c.r, _c.g, _c.b]; };

// ------------------------------------------------------------------ colours
//
// Baked "lighting", in the scene's own key. main.js measured its reference at
// luminance 52-58 across the whole frame with 1% of pixels above 170; the
// tunnel is the one place in the game allowed to sit well under that, because
// it is the only place where being darker than everything else IS the feature.
// Luminances quoted are Rec.709 on the 0-255 hex.
const C = {
  dado:    rgb(0x222b38),   // lum 42. Tiled wall to head height: the lightest
                            // large surface in here, and still under the road.
  upper:   rgb(0x1a2130),   // lum 33. Above the tiles, grimier.
  chamfer: rgb(0x141a27),   // lum 26. Turning away from the fittings.
  ceiling: rgb(0x0f1420),   // lum 20. The biggest single area in the frame
                            // once you are inside, and the reason it gets dark.
  rib:     rgb(0x090d16),   // lum 12. Downstand beams across the roof.
  walkTop: rgb(0x1d2430),   // lum 35.
  walkFace:rgb(0x121822),   // lum 23. Vertical, facing the road, unlit.
  // Roughly the area-weighted average of dado/upper/ink, for the far LOD
  // tier — eyeballed rather than integrated, which is a small dishonesty
  // worth naming: it is close enough that no tier boundary has been seen to
  // pulse in the brightness curve tools/tunnel.mjs prints, and that curve
  // would show it. The
  // merged band has to have the SAME TONE as the detail it replaces or the
  // boundary pulses as it sweeps past — barrier.js's rule, and it was right.
  far:     rgb(0x1b2230),
  fitting: rgb(0xffcf86),   // lum 212. Sodium. Never depth-shaded.
  pool:    rgb(0x5a4c3c),   // lum 77. The wash under a fitting.
  // The pale spill at the mouths: what the outside world puts on the inside of
  // the portal. Sampled off PAL.skyGlow/haze so the ring belongs to this sky.
  spill:   rgb(0x8ba0bd),
  // THE PORTAL, AND WHY IT IS PALE CONCRETE RATHER THAN A BUILDING FACE.
  //
  // The first version painted the facade PAL.wall — the same colour main.js
  // measured the city's buildings at — on the reasoning that the road passes
  // under a building. Photographed from the approach it was invisible, and
  // the measurement said why: at 330 units the fog is 63% haze, so a facade
  // the same luminance as the city behind it has no contrast left to survive
  // being 63% replaced. It only appeared at about 120 units, which is half a
  // second at racing speed, and the brief for this feature is that you can
  // SEE IT COMING.
  //
  // Contrast is the only thing fog cannot take away in proportion: 37% of a
  // 60-luminance difference is still 22 luminance at 330 units. So the portal
  // is pale concrete against a city at 56 — a landmark, the way a real tunnel
  // mouth in a city is a great grey lump you can see from streets away.
  // tools/tunnel.mjs prints the distance at which it first covers a pixel.
  rim:     rgb(0x474d59),   // lum 76. The arch surround: DARK against the pale
                            // field, so the opening reads as a hole in a slab
                            // rather than as a bright ring.
  face:    rgb(0x6d7381),   // lum 114, a shade over the pavement's 100-130
  faceLo:  rgb(0x565c69),   // lum 92, the plinth and the shoulders
  band:    rgb(0xd9a441),   // PAL.neonC across the top
};

// ---------------------------------------------------------------- the shape
const SPRING = 5.4;
const CEIL_Y = 8.2;
/** How far the ceiling is drawn in from the wall — the chamfer's run. */
const CHAMF = 3.1;
const WALK_IN = 0.85;       // how wide the walkway ledge is
const WALK_Y = 0.72;
const WALK_LIP = 0.05;      // where the walkway's own face starts, buried in the kerb
const DADO_Y = 2.60;        // top of the tiled band
/** The wall runs BELOW the road, not down to the walkway it stands behind.
 *  Stopping it at the walkway saves two triangles a segment and leaves a
 *  0.28-unit slot between the wall's foot and the pavement once the walkway
 *  LODs out — a grazing-angle light leak straight out into the lit city, about
 *  1.4 px tall at the distance where it appears. */
const WALL_BOT = -0.25;

/** Detail tier, in segments ahead of the camera.
 *
 *  The frame is 1008 px at 90 degrees, so focal length ~504 px and a feature
 *  of size h at D covers h/D*504 px. The wall from its foot to the springline
 *  is 5.65 tall and carries four bands and two ink lines; at 204 units — 34
 *  segments — that is 14 px for six things, which is about where they stop
 *  being six distinguishable things and become one grey band. Past there it
 *  IS one band, at the tone the six average to. */
const DETAIL_SEG = 34;
/** Walkway: 0.42 of visible face, 1 px at 210 units. */
const WALK_FAR = 36;
/** Ribs: 0.35 deep, 1 px at 176 units. */
const RIB_FAR = 30;
/** Pools: big and dim, and the first thing to go. The FITTINGS themselves have
 *  no cut-off — they run to the far end of the tunnel, because a row of bright
 *  points converging on the vanishing point is the strongest single thing in
 *  the picture and each one is two triangles. */
const POOL_FAR = 44;
/** Hoisted, because `for (const s of [-1, 1])` inside the segment loop is an
 *  array allocation per segment per frame in the hot path. barrier.js's note. */
const SIDES = [-1, 1];

/**
 * Build the tunnel.
 *
 * @param {object} o
 * @param {Scene}  o.scene       add the mesh to this
 * @param {object} o.palette     PAL from main.js — only `ink` is read
 * @param {number} o.ink         ink thickness in world units, near field
 * @param {number} o.roadW       road half-width
 * @param {number} o.segLen      length of one segment
 * @param {number} o.segCount    how many segments are drawn ahead
 * @param {number} o.behind      how many are drawn behind (main.js BEHIND)
 * @param {number} o.atSeg       absolute segment index of the entrance
 * @param {number} o.lenSeg      how many segments long
 * @param {number} o.maxLenSeg   what the buffer is sized for
 * @param {number} o.segTotal    track.n, only used by inside() before the
 *                               first update()
 * @param {number} o.lightEvery  a fitting each side every N segments
 * @returns {{update: function, stats: object, mesh: Mesh,
 *            inside: function, enclosure: function}}
 */
export function buildTunnel(o = {}) {
  const scene = o.scene;
  const SEG_LEN = o.segLen ?? 6;
  const SEG_COUNT = o.segCount ?? 220;
  const BEHIND = o.behind ?? 5;
  const INK = rgb(o.palette?.ink ?? 0x0c0e16);
  const INK_MIN = (o.ink ?? 0.09) * 1.1;
  const AT = o.atSeg ?? 1520;
  const LEN = o.lenSeg ?? 80;
  const MAXLEN = Math.max(LEN, o.maxLenSeg ?? 140);
  const LIGHT_EVERY = o.lightEvery ?? 4;
  const RIB_EVERY = o.ribEvery ?? 4;
  const WALL_X = o.wallX ?? 12.0;
  const CEIL_X = WALL_X - CHAMF;
  const WALK_X = WALL_X - WALK_IN;
  let tn = o.segTotal ?? 4000;

  /** How far the spill from each mouth reaches, in segments, and how strong.
   *  ASYMMETRIC ON PURPOSE. You only ever see the entrance from OUTSIDE, where
   *  every unit of brightness on the inside of it works against the hole
   *  reading as a hole; and you only ever see the exit from INSIDE, looking
   *  into the light, where the ring is most of what sells it. There are no
   *  lights, so there is nothing that forces the two to be the same. */
  const IN_SPILL = 5, IN_STRENGTH = 0.40;
  const OUT_SPILL = 10, OUT_STRENGTH = 0.60;

  const stats = { calls: 0, tris: 0, quads: 0, dropped: 0, maxQuads: 0,
                  atSeg: AT, lenSeg: LEN, maxLenSeg: MAXLEN,
                  lightEvery: LIGHT_EVERY, wallX: WALL_X, visible: false,
                  rel: 0, inside: false };

  if (!scene) {
    return { update: () => {}, stats, mesh: null,
             inside: () => false, enclosure: () => 0 };
  }

  // ---- the pool -----------------------------------------------------------
  // Worst case per segment is 21 quads (six a side plus chamfers, ceiling,
  // two fittings, two pools, two rib quads); 24 leaves room to add a band
  // without re-deriving this. Sized on maxLenSeg so the length dial cannot
  // truncate. A quad the pool refuses is counted in stats.dropped and printed
  // by the harness — silent truncation is how a measurement becomes a lie.
  const PER_SEG = 24;
  const MAX = (MAXLEN + BEHIND + 2) * PER_SEG + 64;
  stats.maxQuads = MAX;

  const pos = new Float32Array(MAX * 12);
  const col = new Float32Array(MAX * 12);
  const index = (MAX * 4 > 65535) ? new Uint32Array(MAX * 6) : new Uint16Array(MAX * 6);
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
  // Culled by hand, in update(), against the segment range — which is exact,
  // where a bounding sphere over geometry that is rewritten every frame would
  // be wrong by frame two.
  geo.boundingSphere = null;
  geo.setDrawRange(0, 0);

  // DoubleSide because the tube is seen from inside and the portal is seen
  // from outside, and one mesh cannot have two windings without doubling the
  // geometry.
  const mat = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: true });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;           // with the barrier: after the road and decals
  mesh.visible = false;
  mesh.userData.tunnel = true;
  scene.add(mesh);
  scene.userData.tunnelStats = stats;

  let n = 0;
  let shown = false;

  // Scratch, module-lifetime. Nothing in the hot path allocates.
  const cA = new Float32Array(3);
  const cB = new Float32Array(3);

  /** out = mix(base, spill, g) * shade. */
  function tone(out, base, g, shade) {
    const s = 1 - g;
    out[0] = (base[0] * s + C.spill[0] * g) * shade;
    out[1] = (base[1] * s + C.spill[1] * g) * shade;
    out[2] = (base[2] * s + C.spill[2] * g) * shade;
  }

  /** One quad. Verts 1 and 4 take colour cA, verts 2 and 3 take cB, which is
   *  what makes the mouth ramp a gradient along the tube rather than a
   *  staircase with a step every six units. */
  function quad(x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4) {
    if (n >= MAX) { stats.dropped++; return; }
    const t = n * 12;
    pos[t] = x1; pos[t + 1] = y1; pos[t + 2] = z1;
    pos[t + 3] = x2; pos[t + 4] = y2; pos[t + 5] = z2;
    pos[t + 6] = x3; pos[t + 7] = y3; pos[t + 8] = z3;
    pos[t + 9] = x4; pos[t + 10] = y4; pos[t + 11] = z4;
    col[t] = cA[0]; col[t + 1] = cA[1]; col[t + 2] = cA[2];
    col[t + 3] = cB[0]; col[t + 4] = cB[1]; col[t + 5] = cB[2];
    col[t + 6] = cB[0]; col[t + 7] = cB[1]; col[t + 8] = cB[2];
    col[t + 9] = cA[0]; col[t + 10] = cA[1]; col[t + 11] = cA[2];
    n++;
  }

  /**
   * A panel of the tube, spanning one segment lengthways.
   *
   * (ox1, oy1) and (ox2, oy2) are the two ends of the cross-section line the
   * panel is swept from — so a wall band, the chamfer, the ceiling and the
   * walkway are all the same four lines of code with different offsets.
   */
  function panel(xa, ya, za, xb, yb, zb, ox1, oy1, ox2, oy2, base, gA, gB, shA, shB) {
    tone(cA, base, gA, shA);
    tone(cB, base, gB, shB);
    quad(xa + ox1, ya + oy1, za, xb + ox1, yb + oy1, zb,
         xb + ox2, yb + oy2, zb, xa + ox2, ya + oy2, za);
  }

  /** A flat quad in the portal plane, at one z. Both ends take the same tone,
   *  because a facade has no length to run a gradient along. */
  function flat(bx, by, bz, x1, y1, x2, y2, x3, y3, x4, y4, base, g, sh) {
    tone(cA, base, g, sh);
    cB[0] = cA[0]; cB[1] = cA[1]; cB[2] = cA[2];
    quad(bx + x1, by + y1, bz, bx + x2, by + y2, bz,
         bx + x3, by + y3, bz, bx + x4, by + y4, bz);
  }

  /**
   * The baked darkness ramp, as a spill fraction at tunnel-local position t
   * (in segments, 0 at the entrance, len at the exit).
   *
   * Squared so it falls away from the mouth fast and then flattens, which is
   * roughly what an inverse-square does and, more to the point, is what stops
   * the middle of the tunnel from being a long grey gradient instead of dark.
   */
  function glow(t, len) {
    let g = 0;
    if (t < IN_SPILL) { const u = 1 - t / IN_SPILL; g = u * u * IN_STRENGTH; }
    const d = len - t;
    if (d < OUT_SPILL) {
      const u = 1 - d / OUT_SPILL;
      const e = u * u * OUT_STRENGTH;
      if (e > g) g = e;
    }
    return g;
  }

  // ------------------------------------------------------------ the portal
  //
  // Built ONCE as a list of polygons in portal-local (x, y), then stamped into
  // the buffer each frame at whatever the road walk says the entrance is. It
  // is an EXACT TILING — every region is emitted once and no two overlap — so
  // there is not one coplanar pair in it to z-fight on a 16-bit buffer. That
  // is why the rim is cut into an ink strip and a concrete strip rather than
  // an ink line being laid on top of a rim.
  const FAC_X = 24, FAC_TOP = 15.5, FAC_BOT = -1.2;
  const RIM = 1.05, RIM_INK = 0.20;
  // THE ACCENT BAND IS 2.2 TALL AND NOT 1.1, and that is an approach-visibility
  // decision rather than a graphic one: at 330 units 1.1 units is 1.7 pixels and
  // the measurement below could not see it. Saturated amber at luminance 156 is
  // the only part of the portal that survives 63% haze with contrast to spare.
  const BAND_LO = 10.9, BAND_HI = 13.1;
  const X1 = WALL_X + RIM_INK, X2 = X1 + RIM;      // ink edge, then rim edge
  const Y1 = CEIL_Y + RIM_INK, Y2 = Y1 + RIM;
  const CX1 = CEIL_X + RIM_INK, CX2 = CX1 + RIM;
  const S1 = SPRING + RIM_INK * 0.9;

  /** [x1,y1, x2,y2, x3,y3, x4,y4, colour, lit] — wound so the quad helper's
   *  vertices 1..4 go round the outline. `lit` means "this is a light source,
   *  do not shade it with distance", the same exemption furniture.js gives its
   *  lamp heads and for the same reason: a marker that dims with distance is a
   *  marker that cannot be seen coming. */
  const PORTAL = [];
  const put = (a, b, c, d, e, f, g, h, colour, lit) =>
    PORTAL.push([a, b, c, d, e, f, g, h, colour, lit === true]);
  for (let si = 0; si < 2; si++) {
    const s = SIDES[si];
    // the ink strip down the side of the mouth, then the concrete rim
    put(s * WALL_X, FAC_BOT, s * X1, FAC_BOT, s * X1, S1, s * WALL_X, SPRING, INK);
    put(s * X1, FAC_BOT, s * X2, FAC_BOT, s * X2, S1, s * X1, S1, C.rim);
    // the same two, along the chamfer
    put(s * WALL_X, SPRING, s * X1, S1, s * CX1, Y1, s * CEIL_X, CEIL_Y, INK);
    put(s * X1, S1, s * X2, S1, s * CX2, Y1, s * CX1, Y1, C.rim);
    // the facade field outboard of the rim, full height
    put(s * X2, FAC_BOT, s * FAC_X, FAC_BOT, s * FAC_X, FAC_TOP, s * X2, FAC_TOP, C.face);
    // the triangle left over between the sloping rim and the square field
    put(s * X2, S1, s * CX2, Y1, s * X2, Y1, s * X2, Y1, C.faceLo);
    // the shoulder beside the top rim, from the chamfer rim's inner top corner
    // out to the field. CX1 and not CX2: the rim's own top edge is a line, not
    // an area, and starting at CX2 leaves a 1.05-wide hole above it.
    put(s * CX1, Y1, s * X2, Y1, s * X2, Y2, s * CX1, Y2, C.faceLo);
  }
  // over the mouth: ink, rim, then the field with its accent band
  put(-CEIL_X, CEIL_Y, CEIL_X, CEIL_Y, CX1, Y1, -CX1, Y1, INK);
  // ---- MARKER LAMPS ACROSS THE ARCH, and the reason they exist ------------
  //
  // Measured on the approach: the portal first covers a pixel at about 330
  // units and only becomes a shape at about 120, which is half a second at
  // racing speed. Two things are eating it — 63% haze at 330 units, and the
  // street canyon, which hides everything of the facade wider than the road
  // behind the buildings lining it. Repainting the facade pale bought almost
  // nothing for the second reason: the part of it you can see down the canyon
  // is the mouth, and the mouth is a hole.
  //
  // What fog cannot take away in proportion is BRIGHTNESS. A lamp at luminance
  // 212 seen through 63% haze still comes out at 130 against a background of
  // 83 — half again as bright — where a facade at 114 comes out at 94 against
  // the same 83. That is furniture.js's reason for drawing its lamp heads at
  // full brightness, applied to a thing that has to be seen coming.
  //
  // CUT INTO the rim rather than laid on top of it: eleven lamps and twelve
  // gaps tiling the same trapezoid exactly. Laying them over the rim with a
  // small z offset would have been four lines shorter and would z-fight on a
  // 16-bit depth buffer at exactly the distance they are there to be seen at.
  {
    const NM = 11;
    const steps = NM * 2 + 1;
    // the rim trapezoid runs from (-CX1, Y1)-(CX1, Y1) at the bottom to
    // (-CX2, Y2)-(CX2, Y2) at the top; walk both edges together.
    for (let k = 0; k < steps; k++) {
      const u0 = k / steps, u1 = (k + 1) / steps;
      const b0 = -CX1 + u0 * 2 * CX1, b1 = -CX1 + u1 * 2 * CX1;
      const t0 = -CX2 + u0 * 2 * CX2, t1 = -CX2 + u1 * 2 * CX2;
      const lamp = (k & 1) === 1;
      put(b0, Y1, b1, Y1, t1, Y2, t0, Y2, lamp ? C.fitting : C.rim, lamp);
    }
  }
  put(-X2, Y2, X2, Y2, X2, BAND_LO, -X2, BAND_LO, C.faceLo);
  put(-X2, BAND_LO, X2, BAND_LO, X2, BAND_HI, -X2, BAND_HI, C.band);
  put(-X2, BAND_HI, X2, BAND_HI, X2, FAC_TOP, -X2, FAC_TOP, C.face);
  // THE PEN LINE ROUND THE WHOLE THING. Without it the portal's top edge met
  // the sky with no outline, which is the one thing this art style never does.
  // Laid OUTSIDE the field rather than over it, so the tiling stays exact.
  const PW = 0.35;
  put(-FAC_X - PW, FAC_TOP, FAC_X + PW, FAC_TOP, FAC_X + PW, FAC_TOP + PW, -FAC_X - PW, FAC_TOP + PW, INK);
  for (let si = 0; si < 2; si++) {
    const s = SIDES[si];
    put(s * FAC_X, FAC_BOT, s * (FAC_X + PW), FAC_BOT,
        s * (FAC_X + PW), FAC_TOP, s * FAC_X, FAC_TOP, INK);
  }

  // -------------------------------------------------------------- the walk
  const update = (track, base, frac, camX, baseY) => {
    n = 0;
    stats.dropped = 0;
    tn = track.n;

    const at = stats.atSeg | 0;
    const len = Math.max(2, Math.min(stats.maxLenSeg, stats.lenSeg | 0));
    const lightEvery = Math.max(1, stats.lightEvery | 0);

    // Where the entrance is, in segments from the camera, signed and wrapped.
    let near = at - base;
    near = ((near % tn) + tn) % tn;
    if (near > tn / 2) near -= tn;
    const far = near + len;
    stats.rel = near;

    const show = far >= -BEHIND && near <= SEG_COUNT;
    if (!show) {
      if (shown) { mesh.visible = false; shown = false; }
      geo.setDrawRange(0, 0);
      stats.calls = 0; stats.tris = 0; stats.quads = 0;
      stats.visible = false; stats.inside = false;
      return;
    }
    // EDGE-TRIGGERED, so a harness that hid the mesh keeps it hidden.
    if (!shown) { mesh.visible = true; shown = true; }

    const zOff = frac * SEG_LEN;

    // Road.update's lateral walk, reproduced exactly, `px` pre-walk and all.
    let px = 0, pdx = 0;
    for (let i = 0; i < BEHIND; i++) {
      const a = (((base - BEHIND + i) % tn) + tn) % tn;
      pdx += track.curve[a] * SEG_LEN;
      px += pdx;
    }
    let x = 0, dx = 0;

    const last = Math.min(SEG_COUNT, far);
    for (let i = -BEHIND; i <= last; i++) {
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

      const k = i - near;                    // tunnel-local segment
      if (k < 0 || k >= len) continue;

      // The road's own depth shading, so the tube recedes with the tarmac it
      // stands on rather than at a rate of its own.
      const shA = 1 - 0.35 * (Math.max(0, i) / SEG_COUNT);
      const shB = 1 - 0.35 * (Math.max(0, i + 1) / SEG_COUNT);
      const gA = glow(k, len), gB = glow(k + 1, len);

      if (k === 0) portal(x1, y1, z1, shA);

      const D = Math.max(6, i * SEG_LEN);
      // Screen-constant ink, floored in the near field and capped so the far
      // wall fades to a line rather than to a black band. barrier.js's law.
      const inkT = Math.min(0.34, Math.max(INK_MIN, 0.0033 * D));
      // And a stand-off that grows the same way, for the only two things in
      // here that are NOT tiled into their neighbour's plane.
      const proud = Math.max(0.10, 0.0016 * D);

      const near34 = i < DETAIL_SEG;

      // ---- ceiling ------------------------------------------------------
      panel(x1, y1, z1, x2, y2, z2, -CEIL_X, CEIL_Y, CEIL_X, CEIL_Y,
            C.ceiling, gA, gB, shA, shB);

      for (let si = 0; si < 2; si++) {
        const s = SIDES[si];
        const w = s * WALL_X, cx = s * CEIL_X, wk = s * WALK_X;

        // ---- chamfer ----------------------------------------------------
        panel(x1, y1, z1, x2, y2, z2, w, SPRING, cx, CEIL_Y,
              C.chamfer, gA, gB, shA, shB);

        if (near34) {
          // ---- the wall, tiled into four exact bands ---------------------
          panel(x1, y1, z1, x2, y2, z2, w, WALL_BOT, w, DADO_Y,
                C.dado, gA, gB, shA, shB);
          panel(x1, y1, z1, x2, y2, z2, w, DADO_Y, w, DADO_Y + inkT,
                INK, gA * 0.4, gB * 0.4, shA, shB);
          panel(x1, y1, z1, x2, y2, z2, w, DADO_Y + inkT, w, SPRING - inkT,
                C.upper, gA, gB, shA, shB);
          panel(x1, y1, z1, x2, y2, z2, w, SPRING - inkT, w, SPRING,
                INK, gA * 0.4, gB * 0.4, shA, shB);
        } else {
          // One band, at the tone the four average to.
          panel(x1, y1, z1, x2, y2, z2, w, WALL_BOT, w, SPRING,
                C.far, gA, gB, shA, shB);
        }

        // ---- the walkway --------------------------------------------------
        if (i < WALK_FAR) {
          panel(x1, y1, z1, x2, y2, z2, wk, WALK_LIP, wk, WALK_Y,
                C.walkFace, gA, gB, shA, shB);
          panel(x1, y1, z1, x2, y2, z2, wk, WALK_Y, w, WALK_Y,
                C.walkTop, gA, gB, shA, shB);
        }

        // ---- the fittings -------------------------------------------------
        //
        // Keyed off the ABSOLUTE segment, never off the loop counter: keyed
        // off the loop counter every light would hold station at a fixed
        // distance ahead of the car forever, which has been reported from the
        // phone once already about the old posts — "I never seem to catch up
        // with them or pass them".
        if (a % lightEvery === 0) {
          const fx = w - s * proud;
          // A fitting is 3.4 long inside a 6-unit segment, so the lateral
          // walk has to be interpolated to its two ends or it hangs off the
          // wall on a corner.
          const t1 = 0.18, t2 = 0.74;
          const xf1 = x1 + (x2 - x1) * t1, yf1 = y1 + (y2 - y1) * t1;
          const xf2 = x1 + (x2 - x1) * t2, yf2 = y1 + (y2 - y1) * t2;
          const zf1 = z1 - SEG_LEN * t1, zf2 = z1 - SEG_LEN * t2;
          // Full brightness, no depth shade and no spill mix: this is the
          // light source. furniture.js's lamp heads do the same.
          panel(xf1, yf1, zf1, xf2, yf2, zf2, fx, SPRING - 0.72, fx, SPRING - 0.32,
                C.fitting, 0, 0, 1, 1);
          // THE BEZEL, and it is not decoration. Photographed at maximum
          // stray, three units from the camera, a bare bright rectangle read
          // as an amber poster stuck to the wall. Two dark bands, EXACTLY
          // TILED against the lamp above and below it — no overlap, so
          // nothing to z-fight — turn it into a fitting with a housing.
          panel(xf1, yf1, zf1, xf2, yf2, zf2, fx, SPRING - 0.32, fx, SPRING - 0.14,
                INK, 0, 0, 1, 1);
          panel(xf1, yf1, zf1, xf2, yf2, zf2, fx, SPRING - 0.90, fx, SPRING - 0.72,
                INK, 0, 0, 1, 1);
          if (i < POOL_FAR) {
            // THE POOL SPLAYS. A rectangle of dim brown under the lamp read as
            // a second poster; the same four vertices, spread wider at the
            // bottom than at the top, read as light falling down the wall.
            // Same stand-off as the lamp so the two are coplanar and disjoint.
            const tw = 1.35 / SEG_LEN;
            const t1b = t1 - tw, t2b = t2 + tw;
            const xb1 = x1 + (x2 - x1) * t1b, yb1 = y1 + (y2 - y1) * t1b;
            const xb2 = x1 + (x2 - x1) * t2b, yb2 = y1 + (y2 - y1) * t2b;
            const zb1 = z1 - SEG_LEN * t1b, zb2 = z1 - SEG_LEN * t2b;
            tone(cA, C.pool, gA * 0.4, shA);
            tone(cB, C.pool, gB * 0.4, shB);
            const at = n * 12;
            quad(xf1 + fx, yf1 + SPRING - 0.90, zf1, xf2 + fx, yf2 + SPRING - 0.90, zf2,
                 xb2 + fx, yb2 + SPRING - 2.90, zb2, xb1 + fx, yb1 + SPRING - 2.90, zb1);
            // AND IT FADES DOWNWARD, which the quad helper cannot express —
            // its two colours are the two ENDS of a swept panel, and this
            // gradient runs across the sweep. Vertices 3 and 4 are the bottom
            // corners; dim them in place rather than adding a second quad and
            // a second coplanar pair to worry about.
            // Unrolled: `for (const j of [a, b])` here is two array
            // allocations per fitting per frame, in the hot path.
            if (at + 11 < MAX * 12) {
              col[at + 6] *= 0.35; col[at + 7] *= 0.35; col[at + 8] *= 0.35;
              col[at + 9] *= 0.35; col[at + 10] *= 0.35; col[at + 11] *= 0.35;
            }
          }
        }
      }

      // ---- a downstand rib across the roof --------------------------------
      // Hung BELOW the ceiling, not painted on it. Two quads: the soffit and
      // the face that catches the fittings.
      if (i < RIB_FAR && a % RIB_EVERY === 2) {
        const t1 = 0.30, t2 = 0.62;
        const xr1 = x1 + (x2 - x1) * t1, yr1 = y1 + (y2 - y1) * t1;
        const xr2 = x1 + (x2 - x1) * t2, yr2 = y1 + (y2 - y1) * t2;
        const zr1 = z1 - SEG_LEN * t1, zr2 = z1 - SEG_LEN * t2;
        panel(xr1, yr1, zr1, xr2, yr2, zr2, -CEIL_X, CEIL_Y - 0.35, CEIL_X, CEIL_Y - 0.35,
              C.rib, gA, gB, shA, shB);
        // and the face of the beam, square to the road, which is the edge that
        // actually flicks past you.
        tone(cA, C.rib, gA, shA);
        cB[0] = cA[0]; cB[1] = cA[1]; cB[2] = cA[2];
        quad(xr1 - CEIL_X, yr1 + CEIL_Y - 0.35, zr1, xr1 + CEIL_X, yr1 + CEIL_Y - 0.35, zr1,
             xr1 + CEIL_X, yr1 + CEIL_Y, zr1, xr1 - CEIL_X, yr1 + CEIL_Y, zr1);
      }
    }

    geo.setDrawRange(0, n * 6);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    stats.quads = n;
    stats.tris = n * 2;
    // What the module ASKS the renderer for. What it gets is
    // renderer.info.render.calls, which is what the harness measures — these
    // two disagree by design if something outside has hidden the mesh.
    stats.calls = 1;
    stats.visible = true;
    stats.inside = near <= 0 && far > 0;
  };

  /** Stamp the portal template at the entrance. */
  function portal(bx, by, bz, sh) {
    for (let i = 0; i < PORTAL.length; i++) {
      const p = PORTAL[i];
      flat(bx, by, bz, p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], 0,
           p[9] ? 1 : sh);
    }
  }

  // ------------------------------------------------------- what audio wants
  //
  // Both of these take a raw st.dist and wrap with the track, so main.js never
  // has to know where the tunnel is. They are the same arithmetic update()
  // uses, which is the point: two files deriving the same range separately is
  // how the echo ends up starting three segments after the roof does.

  /** How far past the entrance, in segments, wrapped into [0, tn). */
  function localSeg(dist) {
    const s = dist / SEG_LEN - stats.atSeg;
    return ((s % tn) + tn) % tn;
  }

  /** True when the car at `dist` is under the roof. */
  function inside(dist) {
    return localSeg(dist) < Math.max(2, stats.lenSeg | 0);
  }

  /**
   * 0 outside, 1 well inside, ramped over about nine units at each mouth.
   *
   * A boolean is the right answer for "is it in the tunnel" and the wrong one
   * for a reverb send: switching a tail on between two frames is audible as a
   * click, and the roof does not arrive all at once anyway — the chase camera
   * is eleven units behind the car, so there is a real moment where half the
   * sound is in and half is out.
   */
  function enclosure(dist) {
    const len = Math.max(2, stats.lenSeg | 0);
    const t = localSeg(dist);
    if (t >= len) return 0;
    const FADE = 1.5;                    // segments = 9 units
    const a = t < FADE ? t / FADE : 1;
    const b = (len - t) < FADE ? (len - t) / FADE : 1;
    return a < b ? a : b;
  }

  return { update, stats, mesh, inside, enclosure };
}
