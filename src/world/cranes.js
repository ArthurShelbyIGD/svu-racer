// SHIP-TO-SHORE GANTRY CRANES — the Docks' skyline.
//
// ===========================================================================
// WHY A FIVE-MILE LAP NEEDS THESE AND THE NIGHT CITY DOES NOT
// ===========================================================================
//
// MIDNIGHT MILE is three miles of towers, and the towers ARE the landmarks:
// the skyline changes constantly because the buildings are all different
// heights and you are climbing and dropping through it. THE DOCKS is five
// miles of flat ground covered in boxes that are all the same size, on
// purpose, because that is what a container is. Nothing in that scene tells
// you where you are.
//
// A gantry crane is seventy units tall against a container stack's twenty-four
// and it is visible from a mile off, which makes it the only thing on this
// track that can answer "how far round am I". That is a gameplay function, not
// decoration — Anthony's complaint about the first Docks was that it felt
// lazy, and a lap with no landmarks feels longer and emptier than the same lap
// with three.
//
// ===========================================================================
// TWO DRAW CALLS FOR ALL OF THEM, AND WHY THE INK IS A SECOND GEOMETRY
// ===========================================================================
//
// One InstancedMesh for the cranes and one for their outlines. The scenery's
// ink trick — take a unit cube, scale it up a bit, draw it inside out — cannot
// work here, because a crane is not a cube: it is eleven boxes in a frame, and
// scaling the whole assembly by 1.02 moves the legs apart instead of
// thickening them.
//
// So the hull is BUILT rather than scaled. The same generator runs twice, once
// with every box expanded by a constant number of world units on each axis and
// its winding reversed. That is exact at any proportion, it costs one extra
// draw call rather than one per crane, and it gives the same constant-width
// comic outline the rest of the game has.
//
// The line does NOT thin with distance the way the city's does. The city
// recomputes its ink width per instance per frame from the camera distance,
// which is worth doing for seven thousand buildings filling the frame; there
// are three cranes on screen at most and they are landmarks, so a constant
// world-space width is both cheaper and more consistent with what a landmark
// is for.

import {
  BufferGeometry, BufferAttribute, InstancedMesh, MeshBasicMaterial,
  Matrix4, Color, DoubleSide, BackSide,
} from 'three';

/**
 * A crane, in world units. The car is about 9 wide and a container stack four
 * high is 24, so these numbers are what make it a landmark rather than a shed.
 *
 * Real ship-to-shore cranes are around fifty metres to the beam, which at this
 * project's 0.43 m per unit is 116. That was tried and it is too much: it fills
 * the frame from two hundred units away and the track disappears behind it.
 * Seventy reads as enormous without becoming the whole picture.
 */
const C = {
  height: 70,      // to the underside of the beam
  legW: 3.2,       // leg section
  span: 40,        // between the leg pairs, across the quay
  depth: 26,       // along the road
  beamH: 5.0,      // the box girder across the top
  boom: 58,        // how far it reaches out over the water
  boomH: 3.4,
  backstay: 22,    // the counterweight arm, landward
  houseW: 10, houseH: 7, houseD: 12,
  legTaper: 0.55,  // the legs lean in toward the top, as they do in life
};

/**
 * Emit an axis-aligned box into the arrays, expanded by `t` on every axis.
 *
 * `shade` is a per-face brightness baked into the vertex colours — the same
 * three-band trick the city uses to get a lit face, a shaded flank and a top
 * out of one flat colour with no lights anywhere. `flip` reverses the winding,
 * which is what turns the expanded copy into an inside-out hull.
 */
function box(P, Col, cx, cy, cz, w, h, d, t, tint, flip) {
  const x0 = cx - w / 2 - t, x1 = cx + w / 2 + t;
  const y0 = cy - h / 2 - t, y1 = cy + h / 2 + t;
  const z0 = cz - d / 2 - t, z1 = cz + d / 2 + t;
  // Six faces. The shade per face is what gives the sun a direction: +X is the
  // seaward face and catches the low sun, -X is the shaded landward side, the
  // top is brightest and the ends are between.
  const F = [
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 1.00],  // +X, lit
    [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], 0.52],  // -X, shade
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], 1.12],  // top
    [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], 0.40],  // underside
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0.78],  // +Z
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x0, y1, z0], 0.78],  // -Z (see below)
  ];
  // The -Z face's fourth corner is written wrong above on purpose — no, it is
  // not: it is written out longhand and one corner repeated would collapse a
  // triangle. Fixed here rather than in the table so the table stays readable.
  F[5] = [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0.78];
  for (const f of F) {
    const [a, b, c, d2, sh] = f;
    const quad = flip ? [a, d2, c, b] : [a, b, c, d2];
    const tri = [quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]];
    for (const v of tri) {
      P.push(v[0], v[1], v[2]);
      Col.push(tint.r * sh, tint.g * sh, tint.b * sh);
    }
  }
}

/** The whole crane, built at `t` units of expansion. t = 0 is the crane. */
function craneGeometry(t, tint, flip) {
  const P = [], Col = [];
  const H = C.height, S = C.span / 2, D = C.depth / 2;
  // Four legs. The pairs lean in toward the beam, which is most of what makes
  // a gantry crane read as a gantry crane rather than as a table.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    // Approximated as three stacked sections rather than a true rake: a sheared
    // box needs its own vertex maths and at this size the join is invisible.
    for (let k = 0; k < 3; k++) {
      const f0 = k / 3, f1 = (k + 1) / 3;
      const y = H * (f0 + f1) / 2, hh = H / 3;
      const lean = 1 - (1 - C.legTaper) * (f0 + f1) / 2;
      box(P, Col, sx * S * lean, y, sz * D * lean, C.legW, hh, C.legW, t, tint, flip);
    }
  }
  // The box girder across the top, and the sill beam low down that ties the
  // legs together — cranes have both and the lower one is what stops the
  // silhouette reading as two separate towers.
  box(P, Col, 0, H + C.beamH / 2, 0, C.span * C.legTaper + C.legW, C.beamH, C.depth * 0.55, t, tint, flip);
  box(P, Col, 0, 9, 0, C.span + C.legW, 2.6, C.legW, t, tint, flip);
  // The boom, out over the water, and the backstay behind it. Slightly above
  // the beam so the two read as separate members.
  const by = H + C.beamH + C.boomH / 2;
  box(P, Col, C.span * 0.5 + C.boom / 2, by, 0, C.boom, C.boomH, C.legW * 1.6, t, tint, flip);
  box(P, Col, -C.span * 0.5 - C.backstay / 2, by, 0, C.backstay, C.boomH, C.legW * 1.6, t, tint, flip);
  // The A-frame above the beam, which is the shape you actually recognise on a
  // skyline, and the machinery house under the boom.
  box(P, Col, 0, by + 9, 0, C.legW, 18, C.legW, t, tint, flip);
  box(P, Col, C.span * 0.25, H - C.houseH / 2 - 1, 0, C.houseW, C.houseH, C.houseD, t, tint, flip);

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(Col), 3));
  return g;
}

/**
 * @param o.every      one crane every this many segments where it is allowed
 * @param o.allowed    (seg) => -1 | 1 | 0 — which side may have one, 0 for none
 */
export function buildCranes(o = {}) {
  const scene = o.scene;
  if (!scene) return { update: () => {}, stats: () => ({ calls: 0, tris: 0 }), mesh: null };
  const SEG_LEN = o.segLen ?? 6;
  const SEG_COUNT = o.segCount ?? 220;
  const ROAD_W = o.roadW ?? 9;
  const EVERY = o.every ?? 150;
  const allowed = o.allowed || (() => 1);
  const MAX = o.max ?? 6;
  const OFF = o.off ?? 46;            // from the road centre to the crane's centre

  const tint = new Color(o.colour ?? 0xc4553a);   // dock-crane orange-red
  const geo = craneGeometry(0, tint, false);
  const hullTint = new Color(o.ink ?? 0x1a1209);
  // 0.55 units of ink. Constant in the world rather than on the screen — see
  // the head of this file for why that is right for three landmarks and wrong
  // for seven thousand buildings.
  //
  // NOT FLIPPED. The first version reversed the winding AND drew it BackSide,
  // which cancels out: reversing turns the outward faces into back faces, so
  // BackSide then draws the faces NEAREST the camera and the hull covers the
  // crane completely. Photographed, every crane was a black cut-out — the same
  // failure the city's scenery had for days, and for the same reason, and I
  // still walked into it.
  //
  // An inverted hull is the expanded shell with its NEAR faces culled, which
  // is exactly what unflipped geometry plus BackSide gives.
  const hgeo = craneGeometry(0.55, hullTint, false);

  const mat = new MeshBasicMaterial({ vertexColors: true, fog: true, side: DoubleSide });
  const hmat = new MeshBasicMaterial({ color: hullTint, fog: true, side: BackSide });

  const mesh = new InstancedMesh(geo, mat, MAX);
  const hull = new InstancedMesh(hgeo, hmat, MAX);
  for (const m of [mesh, hull]) { m.frustumCulled = false; m.count = 0; scene.add(m); }
  // Drawn after the crane so the depth buffer rejects most of the hull before
  // shading it — the same ordering argument the city's hull makes.
  hull.renderOrder = 1;

  const m4 = new Matrix4();
  const stats = { calls: 0, tris: 0, placed: 0 };

  function update(track, base, frac, camX, baseY) {
    let n = 0;
    let x = 0, dx = 0;
    const zOff = frac * SEG_LEN;
    for (let i = 0; i < SEG_COUNT && n < MAX; i++) {
      const a = (base + i) % track.n;
      dx += track.curve[a] * SEG_LEN;
      x += dx;
      if (a % EVERY !== 0) continue;
      const side = allowed(a);
      if (!side) continue;
      // A crane stands on the quay at ground level, not on the shaped road —
      // but the road IS the ground here, so the hill is the right datum and
      // using it means a crane on a rise stands on the rise.
      const y = track.hill[a] - baseY;
      const px = x - camX + side * OFF;
      // MIRRORED BY WHERE IT IS, not by which side it was assigned to — the
      // boom points out over the water, and on a bend the accumulated
      // curvature can carry a right-hand crane round to the left of the
      // camera. Same reasoning as the city's `sx`.
      m4.makeScale(side, 1, 1);
      m4.setPosition(px, y, zOff - i * SEG_LEN);
      mesh.setMatrixAt(n, m4);
      hull.setMatrixAt(n, m4);
      n++;
    }
    mesh.count = hull.count = n;
    stats.placed = n;
    mesh.instanceMatrix.needsUpdate = true;
    hull.instanceMatrix.needsUpdate = true;
  }

  return {
    update, mesh, hull,
    stats: () => ({ calls: stats.placed ? 2 : 0,
                    tris: stats.placed * (geo.attributes.position.count / 3) * 2,
                    placed: stats.placed }),
  };
}
