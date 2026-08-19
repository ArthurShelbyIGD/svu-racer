// A ROLL-ON ROLL-OFF FERRY, BUILT AS A SHIP.
//
// ===========================================================================
// WHY THIS FILE EXISTS INSTEAD OF ANOTHER CALL TO buildTunnel
// ===========================================================================
//
// The first version of the ferry was the tunnel module with different colours
// and a striped header over the mouth. That came out of the roadmap, where I
// wrote "the ferry's car deck is the tunnel" — and as an estimate of effort it
// was correct, which is the trap. It is a hole in a wall with a door painted
// on it. Anthony drove it: "The ferry really just looks like a tunnel, it
// needs to actually look and feel like a ship to be convincing. Way more
// attention to what it is meant to represent rather than re use a shape from
// the original track."
//
// So this is a ship. What makes a ship read as a ship, in the order you meet
// them driving at one:
//
//   FROM THE QUAY, it is a large object with a shape — a hull that tapers to a
//   stem at one end and is cut square at the other, sitting IN water with a
//   waterline, with a superstructure and a funnel standing well above the road
//   and set back from the bow. That silhouette is doing most of the work, and
//   a tunnel mouth has none of it.
//
//   AT THE STERN, you drive in through a hole in a TRANSOM — a flat wall with
//   a ship either side of it and above it — not through an arch.
//
//   INSIDE, the giveaway is that a car deck is not a tube. It is a low steel
//   ceiling on transverse beams, a row of pillars down each side, and OPEN
//   SIDES above the bulwark with the sea going past. That last one is the
//   single strongest cue and it is the one a tunnel can never have: a tunnel's
//   defining property is that you cannot see out of it.
//
//   AND AHEAD, the bow opening frames daylight and the horizon, so the jump is
//   something you can see coming from inside the ship.
//
// ===========================================================================
// ONE DRAW CALL, AND IT IS AFFORDABLE BECAUSE IT IS ONE OBJECT
// ===========================================================================
//
// Every other structure in this game is instanced because there are thousands
// of them. There is one ferry, on one straight, for about eight hundred units
// of a five-mile lap. So it is a single merged BufferGeometry with vertex
// colours, built once at boot and positioned with one matrix per frame — one
// draw call while it is on screen and none when it is not, exactly like the
// tunnel it replaces, but with a few thousand triangles of actual ship in it
// against a budget where the city alone spends forty thousand.
//
// IT IS RIGID, AND THAT IS ONLY SAFE BECAUSE THE SITE IS STRAIGHT. A rigid
// mesh cannot follow a bending road. src/world/docks.js sites the ferry by
// searching for the straightest run in its zone and reports what it found;
// that came back at exactly zero mean curvature, and tools/docks.mjs prints it
// on every run. If that ever stops being zero, this stops being valid — which
// is why the number is printed rather than assumed.
//
// ===========================================================================
// NO LIGHTS, SO THE SHADING IS IN THE FACES
// ===========================================================================
//
// Same rule as everything else here. Every quad carries a shade multiplier
// baked into its vertex colours, and they are consistent with the sun
// direction the rest of the golden-hour theme uses: the face toward the camera
// is lit, the face toward the road is shaded, tops are brightest and
// undersides are darkest. Inside the car deck everything is dropped hard,
// because a car deck is a dark steel box with the sea glaring in at the sides.

import {
  BufferGeometry, BufferAttribute, Mesh, MeshBasicMaterial, Matrix4, Color,
  DoubleSide, BackSide,
} from 'three';

/**
 * THE SHIP, in world units. 1 unit is 0.43 m, so these are real ferry numbers:
 * 178 m long, 27 m in the beam, car deck 3.9 m above the water.
 */
const S = {
  beam: 62,          // full width of the hull amidships
  deckY: 0,          // the car deck IS the local origin — the road runs on it
  waterY: -9,        // where the sea cuts the hull, below the deck
  keelY: -21,
  bulwark: 3.6,      // solid side above the deck before the openings start
  headroom: 8.4,     // to the underside of the deckhead
  superH: 22,        // accommodation above the car deck
  superInset: 6,     // narrower than the hull, so the deck edge shows
  funnelH: 15,
  sternOver: 26,     // hull aft of where the road enters
  bowOver: 74,       // hull forward of where the road leaves, tapering to the stem
  doorW: 13,         // half-width of the stern opening
  doorH: 7.4,
};

/** Two triangles, with a shade baked into the vertex colours. */
function quad(P, C, a, b, c, d, sh, t) {
  for (const v of [a, b, c, a, c, d]) {
    P.push(v[0], v[1], v[2]);
    C.push(t.r * sh, t.g * sh, t.b * sh);
  }
}

/** A box, six shaded faces. For the boxy parts: funnel, pillars, beams. */
function box(P, C, cx, cy, cz, w, h, d, t, lit) {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - h / 2, y1 = cy + h / 2;
  const z0 = cz - d / 2, z1 = cz + d / 2;
  const k = lit ?? 1;
  quad(P, C, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 1.00 * k, t);
  quad(P, C, [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], 0.55 * k, t);
  quad(P, C, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], 1.15 * k, t);
  quad(P, C, [x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], 0.38 * k, t);
  quad(P, C, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0.80 * k, t);
  quad(P, C, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0.70 * k, t);
}

/**
 * How wide the hull is at a given distance forward of the stern.
 *
 * Square aft, full beam for most of the length, and a fine entry that closes
 * to a stem. Two straight tapers rather than a curve: the whole game is drawn
 * in flat facets and a faceted bow is consistent with the containers, the
 * cranes and the city.
 */
function halfBeam(f, L) {
  const bow = L - S.bowOver;
  if (f <= bow) return S.beam / 2;
  const t = (f - bow) / S.bowOver;                 // 0 at the shoulder, 1 at the stem
  return (S.beam / 2) * (1 - t * t * 0.97);        // fine entry, not a wedge
}

/**
 * @param o.deckLen  segments of car deck — the length the road runs inside
 * @param o.segLen   world units per segment
 */
export function buildFerry(o = {}) {
  const scene = o.scene;
  if (!scene) return { update: () => {}, mesh: null, inside: () => false,
                       enclosure: () => 0, stats: () => ({ calls: 0, tris: 0 }) };
  const SEG_LEN = o.segLen ?? 6;
  const DECK_SEGS = o.deckLen ?? 54;
  const RUN = DECK_SEGS * SEG_LEN;                 // road length inside the ship
  const L = RUN + S.sternOver + S.bowOver;         // total hull length

  const P = [], C = [];
  const hull = new Color(o.hull ?? 0xd8d2c6);      // topsides: off-white, as most ferries are
  const boot = new Color(o.boot ?? 0x8f3f34);      // boot topping at the waterline
  const under = new Color(o.under ?? 0x5c1f1a);    // anti-fouling below it
  const deck = new Color(o.deck ?? 0x6a6660);      // steel deck plating
  const dark = new Color(o.dark ?? 0x232026);      // the car deck's interior
  const trim = new Color(o.trim ?? 0x1b2a44);      // the company's hull band
  const glass = new Color(o.glass ?? 0x33506b);
  const fun = new Color(o.funnel ?? 0xc4553a);
  const ink = new Color(o.ink ?? 0x16100a);

  // Local Z runs AFT-to-FORWARD as -Z, matching the road: the car enters at
  // z = 0 and drives toward -Z. `f` below is distance forward of the transom,
  // which is the natural way to describe a hull, so world z = -f.
  const Z = (f) => -f;

  // ---- THE HULL SIDES, LOFTED BETWEEN STATIONS ----------------------------
  // Sixteen stations is enough that the bow reads as a taper rather than as a
  // chamfer, and few enough that the whole ship stays under four thousand
  // triangles.
  const N = 16;
  for (let i = 0; i < N; i++) {
    const f0 = (i / N) * L, f1 = ((i + 1) / N) * L;
    const b0 = halfBeam(f0, L), b1 = halfBeam(f1, L);
    for (const sx of [-1, 1]) {
      // The lit side is the one facing the camera as you approach, which is
      // the side away from the road's centre; the shaded side faces in.
      const sh = sx > 0 ? 1.0 : 0.62;
      // Topsides: waterline up to the deck edge.
      quad(P, C, [sx * b0, S.waterY, Z(f0)], [sx * b1, S.waterY, Z(f1)],
                 [sx * b1, S.deckY, Z(f1)], [sx * b0, S.deckY, Z(f0)], sh, hull);
      // A single dark band along the topsides — every ferry has one and it is
      // the cheapest thing that stops a white slab reading as a wall.
      quad(P, C, [sx * (b0 + 0.05), -3.4, Z(f0)], [sx * (b1 + 0.05), -3.4, Z(f1)],
                 [sx * (b1 + 0.05), -1.9, Z(f1)], [sx * (b0 + 0.05), -1.9, Z(f0)], sh, trim);
      // Boot topping: the band the waterline sits in.
      quad(P, C, [sx * b0, S.waterY - 2.2, Z(f0)], [sx * b1, S.waterY - 2.2, Z(f1)],
                 [sx * b1, S.waterY, Z(f1)], [sx * b0, S.waterY, Z(f0)], sh, boot);
      // And the underwater body. Mostly hidden by the sea quads, which is the
      // point — it is here so the hull does not end in a hard edge when the
      // camera drops on the approach ramp.
      quad(P, C, [sx * b0 * 0.82, S.keelY, Z(f0)], [sx * b1 * 0.82, S.keelY, Z(f1)],
                 [sx * b1, S.waterY - 2.2, Z(f1)], [sx * b0, S.waterY - 2.2, Z(f0)], sh * 0.8, under);
      // The weather deck: the flat top of the hull outboard of the car deck's
      // side plating, which is what you see from the quay.
      quad(P, C, [sx * b0, S.deckY, Z(f0)], [sx * b1, S.deckY, Z(f1)],
                 [sx * Math.min(b1, S.beam / 2 - 1.5), S.deckY, Z(f1)],
                 [sx * Math.min(b0, S.beam / 2 - 1.5), S.deckY, Z(f0)], 1.12, deck);
    }
    // The bottom, so there is no hole when the camera is low on the far side.
    quad(P, C, [-b0 * 0.82, S.keelY, Z(f0)], [b0 * 0.82, S.keelY, Z(f0)],
               [b1 * 0.82, S.keelY, Z(f1)], [-b1 * 0.82, S.keelY, Z(f1)], 0.35, under);
  }

  // ---- THE TRANSOM, WITH THE DOOR IN IT -----------------------------------
  // You drive through a hole in a flat wall. Four quads around the opening
  // rather than a hole cut in a mesh: same picture, no tessellation.
  {
    const b = S.beam / 2, f = 0;
    const dw = S.doorW, dh = S.doorH;
    // either side of the opening
    quad(P, C, [-b, S.waterY, Z(f)], [-dw, S.waterY, Z(f)], [-dw, S.deckY + S.superH, Z(f)],
               [-b, S.deckY + S.superH, Z(f)], 0.92, hull);
    quad(P, C, [dw, S.waterY, Z(f)], [b, S.waterY, Z(f)], [b, S.deckY + S.superH, Z(f)],
               [dw, S.deckY + S.superH, Z(f)], 0.92, hull);
    // over it
    quad(P, C, [-dw, S.deckY + dh, Z(f)], [dw, S.deckY + dh, Z(f)],
               [dw, S.deckY + S.superH, Z(f)], [-dw, S.deckY + S.superH, Z(f)], 0.92, hull);
    // under it — the stern ramp's housing, below the deck
    quad(P, C, [-dw, S.waterY, Z(f)], [dw, S.waterY, Z(f)],
               [dw, S.deckY, Z(f)], [-dw, S.deckY, Z(f)], 0.78, deck);
    // A hazard-striped header across the top of the opening: the one piece of
    // the old tunnel-mouth treatment worth keeping, because a ro-ro stern
    // opening really does have one and it tells you where to aim.
    quad(P, C, [-dw, S.deckY + dh - 1.1, Z(f) + 0.3], [dw, S.deckY + dh - 1.1, Z(f) + 0.3],
               [dw, S.deckY + dh, Z(f) + 0.3], [-dw, S.deckY + dh, Z(f) + 0.3], 1.0,
         new Color(0xe0a92b));
    // THE BANDS CARRY ROUND THE TRANSOM, which is what stops the stern being
    // one flat beige wall. Photographed from the linkspan the first version
    // filled the whole windscreen with a single tone and no information in it,
    // and a ship you are about to drive into deserves more than a wall. Every
    // real ferry's hull band and boot topping run right round the stern.
    // PROUD OF THE TRANSOM, TOWARD THE CAMERA. Z(f) is -f, so aft is PLUS —
    // the first version put every band a quarter-unit forward, which is inside
    // the ship, and the stern went back to being a blank wall with the paint
    // hidden behind it. The hazard header two lines above had it right and I
    // copied the sign from the wrong place.
    for (const [x0, x1] of [[-b, -dw], [dw, b]]) {
      quad(P, C, [x0, -3.4, Z(f) + 0.25], [x1, -3.4, Z(f) + 0.25],
                 [x1, -1.9, Z(f) + 0.25], [x0, -1.9, Z(f) + 0.25], 0.95, trim);
      quad(P, C, [x0, S.waterY, Z(f) + 0.25], [x1, S.waterY, Z(f) + 0.25],
                 [x1, S.waterY + 2.0, Z(f) + 0.25], [x0, S.waterY + 2.0, Z(f) + 0.25], 0.95, boot);
      // A name board. Not lettering — at this range a letter is under a pixel
      // — but the dark plate one is painted on, which is a real feature of a
      // stern and breaks up the remaining flat.
      quad(P, C, [x0 * 0.72, 2.2, Z(f) + 0.3], [x1 * 0.72, 2.2, Z(f) + 0.3],
                 [x1 * 0.72, 4.0, Z(f) + 0.3], [x0 * 0.72, 4.0, Z(f) + 0.3], 0.9, trim);
    }
    // AND AN INK FRAME AROUND THE OPENING. Everything else in this game is
    // drawn with a heavy black line round it; a ship without one reads as
    // belonging to a different game. This is the edge you look straight at.
    const fw = 1.1;
    for (const [ax, ay, bx, by] of [
      [-dw - fw, S.deckY, -dw, S.deckY + dh + fw],
      [dw, S.deckY, dw + fw, S.deckY + dh + fw],
      [-dw - fw, S.deckY + dh, dw + fw, S.deckY + dh + fw],
    ]) {
      quad(P, C, [ax, ay, Z(f) + 0.5], [bx, ay, Z(f) + 0.5],
                 [bx, by, Z(f) + 0.5], [ax, by, Z(f) + 0.5], 1.0, ink);
    }
  }

  // ---- INSIDE THE CAR DECK ------------------------------------------------
  // The three things that make it a ship rather than a tube.
  // THE CEILING STOPS SHORT OF THE BOW RAMP. It used to run ten units past the
  // end of the car deck, which is exactly where the road starts climbing to
  // jump out of the ship — so the last thing before the lip was a black lid
  // over your head instead of the sky opening up. You should see where you are
  // going to land before you leave.
  const inF0 = S.sternOver * 0.2, inF1 = S.sternOver + RUN - 4;
  const sideX = S.beam / 2 - 2.0;
  {
    // 1. A FLAT STEEL CEILING ON TRANSVERSE BEAMS. A tunnel has an arch; a car
    //    deck has a deckhead you could touch, and the beams crossing it are
    //    what make the length of it readable as you drive.
    quad(P, C, [-sideX, S.headroom, Z(inF0)], [sideX, S.headroom, Z(inF0)],
               [sideX, S.headroom, Z(inF1)], [-sideX, S.headroom, Z(inF1)], 0.30, dark);
    for (let f = inF0 + 14; f < inF1; f += 22) {
      box(P, C, 0, S.headroom - 0.9, Z(f), sideX * 2, 1.8, 2.2, dark, 1.25);
    }
    // 2. PILLARS. Outboard of the road, so they are never in the way, and
    //    close enough together to strobe past like the stanchions they are.
    for (let f = inF0 + 20; f < inF1 - 8; f += 34) {
      for (const sx of [-1, 1]) {
        box(P, C, sx * 16.5, S.headroom / 2, Z(f), 1.5, S.headroom, 1.5, deck, 0.85);
      }
    }
    // 3. AND THE SIDES ARE OPEN ABOVE THE BULWARK.
    //
    //    This is the one a tunnel can never do. A ro-ro deck is a solid
    //    bulwark to about waist height and then fresh air between the frames,
    //    so from inside you see the sea and the sky sliding past at eye level.
    //    Every other cue in this file is a shape; this one is the only thing
    //    that makes it feel like a ship while you are moving.
    for (const sx of [-1, 1]) {
      const sh = sx > 0 ? 0.62 : 0.45;
      // the solid bulwark
      quad(P, C, [sx * sideX, S.deckY, Z(inF0)], [sx * sideX, S.deckY, Z(inF1)],
                 [sx * sideX, S.bulwark, Z(inF1)], [sx * sideX, S.bulwark, Z(inF0)], sh, deck);
      // the deck plating outboard of the road, so there is no void beside you
      quad(P, C, [sx * 9.5, S.deckY, Z(inF0)], [sx * sideX, S.deckY, Z(inF0)],
                 [sx * sideX, S.deckY, Z(inF1)], [sx * 9.5, S.deckY, Z(inF1)], 0.95, deck);
      // frames between the openings, and the header they carry
      for (let f = inF0 + 8; f < inF1; f += 26) {
        box(P, C, sx * sideX, (S.bulwark + S.headroom) / 2, Z(f),
            0.9, S.headroom - S.bulwark, 3.0, deck, 0.7);
      }
      quad(P, C, [sx * sideX, S.headroom - 1.0, Z(inF0)], [sx * sideX, S.headroom - 1.0, Z(inF1)],
                 [sx * sideX, S.headroom, Z(inF1)], [sx * sideX, S.headroom, Z(inF0)], sh * 0.8, dark);
    }
  }

  // ---- THE SUPERSTRUCTURE -------------------------------------------------
  // Set back from the bow and standing well above the car deck, because that
  // is the profile you recognise from half a mile away — and half a mile away
  // is where a landmark has to work.
  {
    const f0 = S.sternOver + 18, f1 = S.sternOver + RUN * 0.78;
    const w = S.beam - S.superInset * 2;
    const cy = S.headroom + 1.4 + S.superH / 2;
    box(P, C, 0, cy, Z((f0 + f1) / 2), w, S.superH, f1 - f0, hull, 1.0);
    // Two window bands. Bands rather than windows: at the distance this is
    // seen, individual windows are under a pixel and a continuous strip is
    // what the eye actually resolves on a real ship anyway.
    for (const yy of [cy - S.superH * 0.22, cy + S.superH * 0.16]) {
      for (const sx of [-1, 1]) {
        quad(P, C, [sx * (w / 2 + 0.05), yy - 1.6, Z(f0 + 3)], [sx * (w / 2 + 0.05), yy - 1.6, Z(f1 - 3)],
                   [sx * (w / 2 + 0.05), yy + 1.6, Z(f1 - 3)], [sx * (w / 2 + 0.05), yy + 1.6, Z(f0 + 3)],
             sx > 0 ? 1.0 : 0.6, glass);
      }
    }
    // The bridge, one deck higher and narrower, right forward of the block.
    const by = cy + S.superH / 2 + 4;
    box(P, C, 0, by, Z(f1 - 16), w * 0.72, 8, 22, hull, 1.05);
    for (const sx of [-1, 1]) {
      quad(P, C, [sx * (w * 0.36 + 0.05), by - 1, Z(f1 - 26)], [sx * (w * 0.36 + 0.05), by - 1, Z(f1 - 6)],
                 [sx * (w * 0.36 + 0.05), by + 2.6, Z(f1 - 6)], [sx * (w * 0.36 + 0.05), by + 2.6, Z(f1 - 26)],
           sx > 0 ? 1.0 : 0.6, glass);
    }
    // The funnel, and the black cap on it. The one saturated thing on a mostly
    // white ship, which is what makes it legible at range.
    const fy = cy + S.superH / 2 + S.funnelH / 2;
    box(P, C, 0, fy, Z(f0 + 40), 15, S.funnelH, 13, fun, 1.0);
    box(P, C, 0, fy + S.funnelH / 2 + 1, Z(f0 + 40), 16, 2, 14, dark, 1.1);
    // A mast, because a bare superstructure reads as a building.
    box(P, C, 0, by + 12, Z(f1 - 18), 1.1, 16, 1.1, deck, 0.9);
  }

  // ---- THE BOW ------------------------------------------------------------
  // Forward of the car deck the hull closes to a stem, and the road leaves
  // through an opening in it. The bulwark carries on round so the opening
  // reads as a door in a ship rather than as the end of a corridor.
  {
    const f0 = S.sternOver + RUN, f1 = L;
    // THE ROAD HAS TO GET OUT. The first version plated the foredeck straight
    // across and ran the bulwark round the stem, so the car deck ended in a
    // closed box: photographed on the bow ramp, the entire windscreen was
    // black. A ro-ro has a bow door for the same reason it has a stern one.
    //
    // So the foredeck is two side strips with a corridor between them, and the
    // corridor has its own walls — which is what a raised bow ramp sits in.
    const cor = S.doorW + 1.5;
    for (let i = 0; i < 6; i++) {
      const a0 = f0 + ((f1 - f0) * i) / 6, a1 = f0 + ((f1 - f0) * (i + 1)) / 6;
      const b0 = Math.max(cor + 1, halfBeam(a0, L)), b1 = Math.max(cor + 1, halfBeam(a1, L));
      for (const sx of [-1, 1]) {
        // the outer bulwark, round the sheer
        quad(P, C, [sx * b0, S.deckY, Z(a0)], [sx * b1, S.deckY, Z(a1)],
                   [sx * b1, S.bulwark + 1.2, Z(a1)], [sx * b0, S.bulwark + 1.2, Z(a0)],
             sx > 0 ? 1.05 : 0.6, hull);
        // the foredeck, outboard of the corridor only
        quad(P, C, [sx * cor, S.deckY, Z(a0)], [sx * b0, S.deckY, Z(a0)],
                   [sx * b1, S.deckY, Z(a1)], [sx * cor, S.deckY, Z(a1)], 1.12, deck);
        // and the corridor's own wall, which is the side of the bow ramp
        quad(P, C, [sx * cor, S.deckY, Z(a0)], [sx * cor, S.deckY, Z(a1)],
                   [sx * cor, S.bulwark + 2.4, Z(a1)], [sx * cor, S.bulwark + 2.4, Z(a0)],
             sx > 0 ? 0.72 : 0.5, deck);
      }
    }
    // A dark header over the bow opening, seen from inside as you come up the
    // ramp: the frame the sky is in. Without it the ceiling simply stops and
    // the ship has no front.
    quad(P, C, [-cor, S.headroom, Z(f0 - 4)], [cor, S.headroom, Z(f0 - 4)],
               [cor, S.headroom + 3.0, Z(f0 - 4)], [-cor, S.headroom + 3.0, Z(f0 - 4)], 1.0, ink);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(C), 3));
  const mat = new MeshBasicMaterial({ vertexColors: true, fog: true, side: DoubleSide });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = -1;   // before the road, so the road's quads win their pixels
  scene.add(mesh);

  // ---- THE INK, AS A SHELL AROUND THE MASSES ------------------------------
  //
  // Not around every quad. A per-quad inverted hull needs each surface offset
  // along its own normal, and adjacent quads then separate at their shared
  // edges and leak daylight through the seams — fine for a closed box, wrong
  // for a lofted hull.
  //
  // What a comic drawing of a ship actually outlines is its MASSES: the hull,
  // the accommodation block, the bridge, the funnel. Four expanded boxes drawn
  // inside out gives exactly those silhouettes and nothing else, which is both
  // what the style wants and a fraction of the geometry. The stern opening
  // gets its own frame above, because that is an interior edge no silhouette
  // can produce.
  const IP = [], IC = [];
  const inkBox = (cx, cy, cz, w, h, d, t) =>
    box(IP, IC, cx, cy, cz, w + t * 2, h + t * 2, d + t * 2, ink, 1);
  {
    const T = 1.0;
    const bowShoulder = L - S.bowOver;
    // the hull, aft of the shoulder where it is still full beam
    inkBox(0, (S.waterY + S.deckY) / 2, Z(bowShoulder / 2),
           S.beam, S.deckY - S.waterY, bowShoulder, T);
    // and a smaller box for the bow, so the stem is outlined without the ink
    // standing proud of a taper it cannot follow
    inkBox(0, (S.waterY + S.deckY) / 2, Z(bowShoulder + S.bowOver * 0.42),
           S.beam * 0.52, S.deckY - S.waterY, S.bowOver * 0.84, T);
    const f0 = S.sternOver + 18, f1 = S.sternOver + RUN * 0.78;
    const w = S.beam - S.superInset * 2;
    const cy = S.headroom + 1.4 + S.superH / 2;
    inkBox(0, cy, Z((f0 + f1) / 2), w, S.superH, f1 - f0, T);
    const by = cy + S.superH / 2 + 4;
    inkBox(0, by, Z(f1 - 16), w * 0.72, 8, 22, T);
    inkBox(0, cy + S.superH / 2 + S.funnelH / 2, Z(f0 + 40), 15, S.funnelH, 13, T);
  }
  const igeo = new BufferGeometry();
  igeo.setAttribute('position', new BufferAttribute(new Float32Array(IP), 3));
  igeo.setAttribute('color', new BufferAttribute(new Float32Array(IC), 3));
  const ihull = new Mesh(igeo, new MeshBasicMaterial({ color: ink, fog: true, side: BackSide }));
  ihull.frustumCulled = false;
  ihull.visible = false;
  ihull.renderOrder = -2;
  scene.add(ihull);

  const m4 = new Matrix4();
  const atSeg = o.atSeg ?? 0;
  const tris = P.length / 9;

  /**
   * Place the ship, by walking the road exactly as everything else does.
   *
   * The walk is the only way to know where a given segment is in camera space:
   * the road is a double integration of curvature and there is no closed form.
   * It runs from BEHIND the camera so the ship can still be positioned when
   * the car is inside it, which is most of the time it matters.
   */
  function update(track, base, frac, camX, baseY) {
    // ---- NO ROAD WALK, AND THAT IS THE CORRECT ANSWER RATHER THAN A CHEAP --
    //
    // The first version walked the road to find the ship's segment in camera
    // space, the way the cranes and the scenery do. That walk accumulates
    // curvature from wherever it STARTS, so its heading is only right near its
    // own beginning — the road mesh gets away with it because it starts five
    // segments behind the camera and anchors there. The ferry has to be
    // positioned from its stern, which is eighty segments behind you while you
    // are aboard, and over eighty segments the accumulated heading error is
    // enormous: photographed from the vehicle deck, the ship was a hundred
    // units off to the left and the road ran past it into open sea.
    //
    // Anchoring the POSITION does not fix that, because the error is in the
    // HEADING. But the ship's berth was chosen by searching for the
    // straightest run in the zone and came back at exactly zero curvature —
    // which is the same fact that lets the hull be a rigid mesh at all. On
    // straight road the lateral offset between the camera's segment and the
    // ship's is zero by definition, so there is nothing to walk: the ship sits
    // on the centre line, and the only question is how far ahead it is.
    const n = track.n;
    let i = atSeg - base;
    if (i > n / 2) i -= n;
    if (i < -n / 2) i += n;
    if (i > (o.segCount ?? 220) || i < -(DECK_SEGS + 40)) {
      mesh.visible = ihull.visible = false; return;
    }
    mesh.visible = ihull.visible = true;
    m4.makeTranslation(-camX, track.hill[((atSeg % n) + n) % n] - baseY,
                       frac * SEG_LEN - i * SEG_LEN);
    mesh.matrix.copy(m4);
    ihull.matrix.copy(m4);
    mesh.matrixAutoUpdate = ihull.matrixAutoUpdate = false;
  }

  return {
    update, mesh,
    /** Inside the car deck? The stray limit narrows here — it is a ship. */
    inside: (dist) => {
      const f = dist / SEG_LEN - atSeg;
      return f > 0.5 && f < DECK_SEGS - 0.5;
    },
    enclosure: (dist) => {
      const f = dist / SEG_LEN - atSeg;
      if (f < -2 || f > DECK_SEGS + 2) return 0;
      return Math.max(0, Math.min(1, Math.min(f, DECK_SEGS - f) / 4));
    },
    stats: () => ({ calls: mesh.visible ? 2 : 0, tris: mesh.visible ? tris : 0 }),
  };
}
