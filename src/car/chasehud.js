// THE TWO INSTRUMENTS THIRD PERSON LOSES, PUT BACK.
//
// ===========================================================================
// WHY THIS EXISTS
// ===========================================================================
//
// From the driver's seat the car has a full dashboard: a tacho, a speedo, a
// gear number, a drilled alloy brake pedal in the bottom left and a nitrous
// gauge in the cluster. All of it is drawn into the cockpit's atlas and shown
// in one draw call — and all of it disappears the moment the camera goes
// outside the car, because the cockpit group is hidden wholesale.
//
// Anthony, on the first drive with the chase camera back: "3rd person needs the
// brake pedal and a nitrous dial." Those two and not the others, which is the
// right call: speed and gear are readable from the world going past and from
// the engine note, but "am I braking" and "how much is left in the bottle" have
// no other tell at all. The nitrous one especially — his whole technique on
// this game is built on it: "better to have long runs with gas opposed to
// shorter squirts so let it nearly empty, then nearly full, rinse and repeat."
// That is a plan you cannot execute without a gauge.
//
// ===========================================================================
// WHY IT IS NOT DOM, AND NOT THE COCKPIT'S OWN QUADS
// ===========================================================================
//
// NOT DOM. The pedal hints used to be two divs saying BRAKE and BOOST in grey
// over the corners, and they were replaced precisely because they were "the
// only thing in the frame that looked like a web page". Putting them back as
// HTML for third person would undo that on purpose.
//
// NOT THE COCKPIT'S. Its pedal and gauge are merged into one geometry with the
// dashboard, positioned in the cabin, and sized by where the driver's eye is.
// There is no way to show two of those quads without the windscreen frame they
// are welded to, and no sensible place to put a dashboard in a chase shot.
//
// So: a small group of its own, its own procedural atlas, one material, ONE
// draw call, eight quads. The art follows the same rules as everything else —
// flat fills, black ink, no lights, generated in code.
//
// ===========================================================================
// THE ONE AWKWARD PART: STAYING THE SAME SIZE
// ===========================================================================
//
// The group hangs off the CAMERA, so it moves with the view for free. But this
// game opens the field of view with speed — `74 + v * 20` degrees, a third
// wider on the boost than at rest — and anything parked at a fixed distance in
// front of a widening lens SHRINKS. A gauge that quietly gets smaller the
// faster you go is a gauge that vanishes exactly when you are reading it.
//
// So the group is re-placed every frame from the live camera: at distance d the
// visible half-height is d*tan(fovY/2) and the half-width is that times the
// aspect, so a corner is a known point and a fixed fraction of the screen is a
// known scale. Two multiplies and a tangent, no allocation.

import { CanvasTexture, NearestFilter, ClampToEdgeWrapping, Group, Mesh,
         BufferGeometry, BufferAttribute, MeshBasicMaterial, FrontSide } from 'three';

/** The atlas is a quarter of the smallest thing this game already draws. It
 *  holds four cells: pedal up, pedal down, dial face, needle. */
const CELL = 64;
const SHEET = CELL * 2;

/* Cells, as [col, row]. */
const C_PEDAL_UP = [0, 0];
const C_PEDAL_DN = [1, 0];
const C_DIAL = [0, 1];
const C_NEEDLE = [1, 1];

/**
 * Draw the sheet.
 *
 * @param {object} P  the palette, for the ink colour and the nitrous blue
 */
function sheet(P) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SHEET;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, SHEET, SHEET);
  const INK = '#0a0a10';

  // --- the brake pedal, twice -----------------------------------------------
  // Drilled, like the cockpit's, because it is the same pedal seen from
  // outside the car and a player should not have to wonder whether it is.
  const pedal = (cx, cy, pressed) => {
    const w = 34, h = 44;
    const x = cx + (CELL - w) / 2, y = cy + (CELL - h) / 2 + (pressed ? 3 : 0);
    g.fillStyle = INK;
    g.fillRect(x - 3, y - 3, w + 6, h + 6);
    g.fillStyle = pressed ? '#c8ccd4' : '#8f949c';
    g.fillRect(x, y, w, h);
    // The rubber pad's top face, lighter, so the pedal reads as a solid.
    g.fillStyle = pressed ? '#e6eaf0' : '#a7adb6';
    g.fillRect(x, y, w, 7);
    // Drillings. Three by four, the same grid the cockpit's uses.
    g.fillStyle = INK;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        g.beginPath();
        g.arc(x + 8 + c * 9, y + 15 + r * 7, 2.4, 0, Math.PI * 2);
        g.fill();
      }
    }
    // A hard shadow under a pressed pedal, so the press reads without colour.
    if (pressed) { g.fillStyle = INK; g.fillRect(x - 3, y + h + 1, w + 6, 3); }
  };
  pedal(C_PEDAL_UP[0] * CELL, C_PEDAL_UP[1] * CELL, false);
  pedal(C_PEDAL_DN[0] * CELL, C_PEDAL_DN[1] * CELL, true);

  // --- the nitrous dial -----------------------------------------------------
  // A three-quarter sweep, empty on the left and full on the right, with the
  // last sixth marked out in the same blue the bottle used to be. That mark is
  // not decoration: below about a sixth of a bottle there is not enough left to
  // be worth spending, and the cockpit's gauge says so the same way.
  {
    const cx = C_DIAL[0] * CELL + CELL / 2, cy = C_DIAL[1] * CELL + CELL / 2;
    const R = 27;
    g.fillStyle = INK;
    g.beginPath(); g.arc(cx, cy, R + 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#161a24';
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    // The sweep: 225 degrees, from lower-left round to lower-right.
    const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
    g.strokeStyle = '#5f6774'; g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, R - 6, A0, A1); g.stroke();
    // The usable end, in nitrous blue.
    g.strokeStyle = '#57c8e8'; g.lineWidth = 5;
    g.beginPath(); g.arc(cx, cy, R - 6, A0 + (A1 - A0) * 0.17, A1); g.stroke();
    // Ticks, five of them, so the needle has something to be between.
    g.strokeStyle = '#c9cfd8'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      const a = A0 + (A1 - A0) * (i / 4);
      const c = Math.cos(a), s = Math.sin(a);
      g.beginPath();
      g.moveTo(cx + c * (R - 12), cy + s * (R - 12));
      g.lineTo(cx + c * (R - 3), cy + s * (R - 3));
      g.stroke();
    }
    // No legend. Four letters in twenty device pixels is mush — the same rule
    // the cockpit's bottle label followed.
  }

  // --- the needle -----------------------------------------------------------
  // Drawn pointing UP from the centre of its cell, so the quad can be spun
  // about its own middle and the maths stays readable.
  {
    const cx = C_NEEDLE[0] * CELL + CELL / 2, cy = C_NEEDLE[1] * CELL + CELL / 2;
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(cx - 4, cy + 6); g.lineTo(cx + 4, cy + 6); g.lineTo(cx + 1.5, cy - 24);
    g.lineTo(cx - 1.5, cy - 24); g.closePath(); g.fill();
    g.fillStyle = '#f0503c';
    g.beginPath();
    g.moveTo(cx - 2.5, cy + 4); g.lineTo(cx + 2.5, cy + 4); g.lineTo(cx + 1, cy - 22);
    g.lineTo(cx - 1, cy - 22); g.closePath(); g.fill();
    g.fillStyle = INK;
    g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c9cfd8';
    g.beginPath(); g.arc(cx, cy, 2.5, 0, Math.PI * 2); g.fill();
  }

  const tex = new CanvasTexture(cv);
  // NEAREST, like every other atlas here: this is line art at phone size and
  // bilinear turns a two-pixel ink line into four pixels of grey.
  tex.magFilter = tex.minFilter = NearestFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  return tex;
}

/** UVs for a cell, as [u0, v0, u1, v1]. The canvas is top-down, GL is not. */
function uv(cell) {
  const [c, r] = cell;
  const u0 = c / 2, u1 = (c + 1) / 2;
  const v1 = 1 - r / 2, v0 = 1 - (r + 1) / 2;
  return [u0, v0, u1, v1];
}

/**
 * Build the overlay.
 *
 * @param {object} o
 * @param {object} o.palette
 * @returns {{group: Group, update: Function, stats: object}}
 */
export function buildChaseHud(o = {}) {
  const tex = sheet(o.palette || {});
  const QUADS = 3;                     // pedal, dial, needle
  const pos = new Float32Array(QUADS * 4 * 3);
  const uvs = new Float32Array(QUADS * 4 * 2);
  const idx = new Uint16Array(QUADS * 6);
  for (let q = 0; q < QUADS; q++) {
    const v = q * 4, i = q * 6;
    idx[i] = v; idx[i + 1] = v + 1; idx[i + 2] = v + 2;
    idx[i + 3] = v; idx[i + 4] = v + 2; idx[i + 5] = v + 3;
  }
  const geo = new BufferGeometry();
  const posAttr = new BufferAttribute(pos, 3);
  const uvAttr = new BufferAttribute(uvs, 2);
  posAttr.setUsage(35048 /* DynamicDrawUsage */);
  uvAttr.setUsage(35048);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('uv', uvAttr);
  geo.setIndex(new BufferAttribute(idx, 1));

  const mat = new MeshBasicMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
    // FRONT FACES ONLY, AND IT IS WORTH A LINE. A transparent DoubleSide
    // material is TWO draw calls in three.js — it renders the back faces and
    // then the front — so this overlay cost two of the sixteen the whole game
    // has, for three quads that face the lens and can never be seen from
    // behind. Measured, not assumed: 15 calls with DoubleSide, 14 with this.
    side: FrontSide,
    // FOG OFF, ALONE IN THIS PROJECT. Every other material here sets fog true
    // because everything else is IN the world and has to recede into it. This
    // is glass furniture a few centimetres from the lens; fogged, it would
    // fade with whatever the track's fog density happened to be.
    fog: false,
  });
  const mesh = new Mesh(geo, mat);
  // Drawn after the world, and it never occludes anything because depth is off.
  mesh.renderOrder = 999;
  mesh.frustumCulled = false;
  const group = new Group();
  group.add(mesh);

  const setQuad = (q, cx, cy, hw, hh, cell, rot = 0) => {
    const [u0, v0, u1, v1] = uv(cell);
    const c = Math.cos(rot), s = Math.sin(rot);
    const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    for (let k = 0; k < 4; k++) {
      const [x, y] = pts[k];
      const p = (q * 4 + k) * 3;
      pos[p] = cx + x * c - y * s;
      pos[p + 1] = cy + x * s + y * c;
      pos[p + 2] = 0;
    }
    const t = q * 4 * 2;
    uvs[t] = u0; uvs[t + 1] = v0;
    uvs[t + 2] = u1; uvs[t + 3] = v0;
    uvs[t + 4] = u1; uvs[t + 5] = v1;
    uvs[t + 6] = u0; uvs[t + 7] = v1;
  };

  /** How far in front of the lens the furniture sits. Anything works; this is
   *  clear of the near plane and small enough that the numbers stay legible. */
  const DIST = 2;
  /** Size and inset, as fractions of the SHORTER screen dimension, so the two
   *  read the same on a tall phone and a wide one. */
  const SIZE = 0.30, INSET = 0.045;

  /**
   * @param {object} s
   * @param {number} s.fovY     the camera's vertical field of view, in radians
   * @param {number} s.aspect
   * @param {boolean} s.braking
   * @param {number} s.boostLeft   0..1
   * @param {boolean} s.show
   */
  function update(s) {
    group.visible = !!s.show;
    if (!s.show) return;
    const hh = DIST * Math.tan(s.fovY / 2);
    const hw = hh * s.aspect;
    const unit = Math.min(hh, hw) * 2;          // the shorter side, full height
    const r = unit * SIZE * 0.5;
    const m = unit * INSET;
    const bx = -hw + m + r, by = -hh + m + r;   // bottom left
    const nx = hw - m - r, ny = -hh + m + r;    // bottom right

    setQuad(0, bx, by, r, r, s.braking ? C_PEDAL_DN : C_PEDAL_UP);
    setQuad(1, nx, ny, r, r, C_DIAL);
    // THE NEEDLE SWEEPS THE SAME 225 DEGREES THE FACE IS PAINTED WITH, and it
    // is drawn pointing up, so an empty bottle is rotated a sweep-and-an-eighth
    // anticlockwise and a full one the same the other way.
    const f = Math.max(0, Math.min(1, s.boostLeft));
    const rot = (0.5 - f) * (Math.PI * 1.5);
    setQuad(2, nx, ny, r, r, C_NEEDLE, rot);

    posAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;
    group.position.set(0, 0, -DIST);
  }

  return { group, update, stats: { tris: QUADS * 2, calls: 1 } };
}
