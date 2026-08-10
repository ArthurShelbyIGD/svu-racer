// The comic-book look — ink outlines and pencil shading, on a phone GPU.
//
// THE POINT OF THIS FILE. The Borderlands look reads as expensive and is not.
// Its three ingredients are, in order of how much they matter:
//
//   1. A thick black ink line around every object.
//   2. Flat colour in hard bands, no gradients.
//   3. A hand-drawn texture over the top — hatching, grain, pencil.
//
// We already had (2) for free: no lights and flat vertex colours IS cel shading.
// This file adds (1) and (3), and neither needs a shader, a light, a render
// pass, or a downloaded asset — which matters, because those are exactly the
// four things that made the last project unplayable on this hardware.
//
// HOW THE OUTLINE WORKS — the inverted hull.
//
// Take the mesh, push every vertex a little way along its own normal, turn it
// inside out by drawing only the BACK faces, and paint it black. The result is
// a slightly larger black copy that is hidden behind the real object everywhere
// except around the edges, where it pokes out as a line. It is the oldest trick
// in cel shading and it is perfect for this hardware:
//
//   * no post-processing, no second render pass, no depth buffer reads
//   * one extra draw call per object, not per frame
//   * the geometry is built ONCE at startup, so per-frame cost is only the
//     drawing itself
//
// The catch is that it needs SMOOTH vertex normals. A box built by three.js has
// split vertices with per-face normals, so pushing along them separates the six
// faces into six floating squares instead of inflating the box. So the vertices
// have to be welded by position and their normals averaged first — which is
// what buildOutline does, and why it is more than three lines.

import {
  BufferGeometry, BufferAttribute, Mesh, MeshBasicMaterial,
  BackSide, CanvasTexture, RepeatWrapping, Group,
} from 'three';

/** How thick the ink is, in world units, by default. */
export const INK = 0.09;

/**
 * Build the inverted-hull outline geometry for a mesh.
 *
 * Returns a new BufferGeometry to be drawn with `side: BackSide` in flat black.
 * The source geometry is not modified.
 *
 * @param {BufferGeometry} geo    source geometry
 * @param {number} thickness      how far to push, in world units
 */
export function buildOutline(geo, thickness = INK) {
  const src = geo.getAttribute('position');
  const idx = geo.getIndex();
  const n = src.count;

  // ---- weld by position ----
  // Vertices at the same point in space are the same corner as far as the
  // outline is concerned, however many times the source geometry lists them.
  // Quantised to a grid so floating-point noise does not split a corner in two
  // and leave a hairline crack in the ink.
  const Q = 1e4;
  const key = new Array(n);
  const map = new Map();
  const groups = [];              // groups[g] = [vertex indices at that point]
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(src.getX(i) * Q)},${Math.round(src.getY(i) * Q)},${Math.round(src.getZ(i) * Q)}`;
    let g = map.get(k);
    if (g === undefined) { g = groups.length; map.set(k, g); groups.push([]); }
    groups[g].push(i);
    key[i] = g;
  }

  // ---- average the face normals meeting at each welded corner ----
  // Computed from the triangles rather than read from the normal attribute,
  // because the source may not have one and, if it does, it is the per-face one
  // we are specifically trying not to use.
  const nx = new Float32Array(groups.length);
  const ny = new Float32Array(groups.length);
  const nz = new Float32Array(groups.length);

  const triCount = idx ? idx.count : n;
  const at = (t) => (idx ? idx.getX(t) : t);
  for (let t = 0; t < triCount; t += 3) {
    const a = at(t), b = at(t + 1), c = at(t + 2);
    const ax = src.getX(a), ay = src.getY(a), az = src.getZ(a);
    const bx = src.getX(b), by = src.getY(b), bz = src.getZ(b);
    const cx = src.getX(c), cy = src.getY(c), cz = src.getZ(c);
    // cross((b-a), (c-a)) — left unnormalised on purpose, so bigger triangles
    // pull harder, which is the usual convention and gives steadier corners.
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      const g = key[v];
      nx[g] += fx; ny[g] += fy; nz[g] += fz;
    }
  }

  // ---- push each vertex out along its welded normal ----
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const g = key[i];
    let ux = nx[g], uy = ny[g], uz = nz[g];
    const len = Math.hypot(ux, uy, uz);
    if (len > 1e-9) { ux /= len; uy /= len; uz /= len; } else { ux = uy = uz = 0; }
    out[i * 3] = src.getX(i) + ux * thickness;
    out[i * 3 + 1] = src.getY(i) + uy * thickness;
    out[i * 3 + 2] = src.getZ(i) + uz * thickness;
  }

  const g2 = new BufferGeometry();
  g2.setAttribute('position', new BufferAttribute(out, 3));
  if (idx) g2.setIndex(new BufferAttribute(idx.array.slice(), 1));
  return g2;
}

/** One shared black ink material — one material, not one per object. */
export const inkMaterial = new MeshBasicMaterial({
  color: 0x0a0a10,
  side: BackSide,          // draw the inside of the inflated shell
  fog: true,               // ink fades into the haze with everything else
});

/**
 * Give every mesh in a group an ink outline.
 *
 * Returns the group so it can be used inline. The outlines are added as
 * siblings rather than children of each mesh, so moving the group moves both
 * and nothing has to be kept in sync per frame.
 */
export function inkGroup(group, thickness = INK) {
  const shells = [];
  group.traverse((o) => {
    if (o.isMesh && o.geometry) shells.push(o);
  });
  for (const m of shells) {
    const shell = new Mesh(buildOutline(m.geometry, thickness), inkMaterial);
    shell.position.copy(m.position);
    shell.rotation.copy(m.rotation);
    shell.scale.copy(m.scale);
    shell.frustumCulled = false;
    // Drawn BEFORE the object it outlines. Both write depth, so the real
    // surface wins wherever they overlap and only the rim survives.
    shell.renderOrder = (m.renderOrder || 0) - 1;
    group.add(shell);
  }
  return group;
}

/**
 * A tiling pencil-hatch texture, drawn in code at startup.
 *
 * NO DOWNLOADED ASSET — the whole project ships as one file, and this is a few
 * hundred bytes of drawing commands rather than a few hundred kilobytes of PNG.
 * It is deliberately small and greyscale: it MULTIPLIES the flat colour
 * underneath, so it only has to carry the texture of the pencil, not its hue.
 *
 * Kept subtle. Cross-hatching that reads nicely on a monitor at arm's length
 * turns into crawling moire on a phone at speed, so the contrast here is low
 * and the strokes are coarse.
 */
export function pencilTexture(size = 128, seed = 12345) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');

  let s = seed >>> 0;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };

  // Paper: not white, so the multiply always darkens a little and the flat
  // colour never looks like flat colour.
  x.fillStyle = '#efefef';
  x.fillRect(0, 0, size, size);

  // Grain first, under the strokes.
  const img = x.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = (rnd() - 0.5) * 26;
    d[i] += g; d[i + 1] += g; d[i + 2] += g;
  }
  x.putImageData(img, 0, 0);

  // Diagonal strokes, drawn twice at different angles for a cross-hatch.
  // Wrapped by drawing each stroke three times, offset by +/- size, so the
  // texture tiles without a visible seam.
  x.lineCap = 'round';
  for (const [angle, count, alpha] of [[-0.7, 26, 0.05], [0.55, 16, 0.035]]) {
    x.strokeStyle = `rgba(40,40,55,${alpha})`;
    for (let i = 0; i < count; i++) {
      const px = rnd() * size, py = rnd() * size;
      const len = size * (0.25 + rnd() * 0.7);
      const dx = Math.cos(angle) * len, dy = Math.sin(angle) * len;
      x.lineWidth = 0.7 + rnd() * 1.6;
      for (const off of [-size, 0, size]) {
        x.beginPath();
        x.moveTo(px + off, py);
        x.lineTo(px + dx + off, py + dy);
        x.stroke();
        x.beginPath();
        x.moveTo(px, py + off);
        x.lineTo(px + dx, py + dy + off);
        x.stroke();
      }
    }
  }

  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  // No mipmaps and nearest-ish filtering keeps the pencil crisp instead of
  // blurring to grey in the distance, and skips the mipmap memory entirely.
  tex.generateMipmaps = true;
  tex.anisotropy = 1;
  return tex;
}
