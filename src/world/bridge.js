// THE BROKEN HUMPBACK BRIDGE — the one place on the lap where the car leaves
// the ground, and the only way to fail a lap outright.
//
// ===========================================================================
// WHAT THIS FILE IS AND IS NOT
// ===========================================================================
//
// It builds NO GEOMETRY and owns NO MESH, and that is the whole design. Every
// other world module here — the barrier, the tunnel, the gantry — is a mesh
// with an update(). This one is a SHAPE IMPOSED ON THE TRACK, applied once at
// startup by adding the arch into `track.hill`, after which the road, the
// crash barrier, the street furniture, the scenery and the camera all follow it
// without knowing it exists. It costs zero draw calls and zero triangles.
//
// That is not a trick, it is the cheap and correct place to put it. The road is
// already one mesh rewritten from `track.hill` every frame; a bridge IS a piece
// of road that goes up and comes down again.
//
// ===========================================================================
// THE ARCH IS SHAPED SO IT CANNOT TRIP THE CLIFF CHECKS, BY CONSTRUCTION
// ===========================================================================
//
// tools/check.mjs asserts that no two adjacent segments differ by more than 2
// units of elevation, and reports the worst step on the natural track: 1.21.
// That check exists because elevation used to be written as a position that did
// not carry forward, which put 25 twenty-four-unit cliffs around the lap, and
// Anthony reported it from the phone as "a flash to the flat track, doesn't
// feel like I went up at all, more like I went through the ramp".
//
// So the ramp's rise per segment is 1.2 units — a shade UNDER the worst step
// the track already has — and its slope of 0.20 is a shade under the track's
// own steepest natural gradient of 0.2015. The arch is therefore not a cliff by
// any measure the project already applies, and it did not need those measures
// relaxed to fit. If you make it steeper, expect check.mjs to say so.
//
// ===========================================================================
// THE GAP IS NOT IN track.hill, AND MUST NOT BE
// ===========================================================================
//
// The obvious way to draw a missing span is to drop `track.hill` into a chasm
// for those segments. Do not: a twenty-unit step between adjacent segments is
// exactly the cliff the check above forbids, and every other system that reads
// the hill — the camera's pitch, the barrier, the pavement — would fall down
// the hole with it and snap back out.
//
// The hill therefore runs smoothly over the arch as though the deck were
// intact, and the gap is a separate flag, `track.gap`, that ONLY the road mesh
// and the physics read. The road drops and blackens those quads; the physics
// treats touching down there as a crash. Everything else is untouched, which
// is why the crash barrier still runs across the gap — and that is deliberate,
// not an oversight. The picture is a bridge whose ROAD SURFACE has collapsed
// between its surviving side beams, which is what a broken bridge looks like.
//
// ===========================================================================
// THE NUMBERS, AND WHERE THEY CAME FROM
// ===========================================================================
//
// Anthony asked for "a broken hump back bridge that the car jumps over at the
// right speed", and then chose a real fail state over a forgiving one. So the
// gap has to be a genuine skill gate: comfortably clearable at racing speed,
// unclearable if you arrive slowly, with the boundary somewhere a player can
// feel. Ballistics, with g = GRAVITY and the lip's slope s:
//
//     vy = v * s / sqrt(1 + s*s)      airtime T = 2*vy/g      range R = v*T
//
// which at s = 0.20 and g = 85 gives R = 0.0046 * v^2 — a range that grows with
// the SQUARE of arrival speed, so the gate is sharp without being cruel:
//
//     130 units/s   125 mph    78 units    well short
//     155 units/s   149 mph   111 units    the edge of it
//     210 units/s   202 mph   203 units    unboosted top speed, clears easily
//     284 units/s   274 mph   372 units    boosted, sails it
//
// The gap is 108 units, so the cut is at about 152 units/s — 146 mph. You can
// arrive slower than that; you just cannot arrive slower than that and live.
//
// THE SITE WAS MEASURED, NOT PICKED. Segment 1111 is the straightest run on the
// lap between the start and the tunnel: mean |curvature| 0.00000 across the
// bridge and its whole run-up, against a worst corner of 0.11178. A jump you
// have to take mid-corner is a jump you cannot aim, and this one is dead
// straight for a quarter of a mile before the lip. It also sits 400 segments
// clear of the tunnel at 1520 and well clear of the finish gantry.

/** Where it is and how big, in SEGMENTS. Everything else is derived. */
export const BRIDGE = {
  seg0: 1111,      // first segment of the climb
  ramp: 12,        // segments of climb, 72 units at slope 0.20
  gap: 18,         // segments of missing deck, 108 units
  far: 14,         // segments of descent on the far side
  height: 14.4,    // ramp * SEG_LEN * 0.20, stated rather than recomputed
                   // so a harness can assert the two agree
  /** How far the collapsed deck hangs below the arch. FOR THE EYE ONLY — the
   *  physics never reads it, because touching down anywhere in the gap is a
   *  crash at the deck's own height whatever is underneath. So the depth is
   *  set by what looks like a hole, and 3.2 did not: photographed from the
   *  ramp, the driver's eye is level with the deck and a shallow drop is seen
   *  edge-on, which is to say not seen. 26 is deep enough that the far wall of
   *  it fills the road ahead as you come over the crest. */
  chasm: 26,
  /** Segments of hazard paint before the break. The crest of a humpback bridge
   *  hides everything beyond it — that is what a humpback bridge IS — so from
   *  the approach there is no hole to see, only a brow. Something has to say
   *  "this one is different" before the player is committed, and the cheapest
   *  honest thing is what a real closed road has: paint. It costs no geometry,
   *  because these tarmac quads are drawn every frame regardless. */
  warn: 3,
};

/** The last segment of the whole structure, exclusive. */
export const bridgeEnd = () => BRIDGE.seg0 + BRIDGE.ramp + BRIDGE.gap + BRIDGE.far;

/**
 * THE ARCH, added into track.hill in place, and `track.gap` written alongside.
 *
 * Called once, immediately after buildTrack and before anything reads the
 * track. Adding rather than assigning matters: the natural profile keeps its
 * own gradient underneath, so the bridge sits ON the landscape instead of
 * flattening it.
 *
 * The climb is linear because the LIP'S SLOPE IS THE LAUNCH ANGLE and a linear
 * ramp states it exactly. An eased rise looks nicer standing still and ends
 * with its slope going to zero at the top, which is a bridge you drive off the
 * end of rather than one you are fired from. The first two segments are eased
 * only at the FOOT, where the slope change costs nothing and stops the approach
 * reading as a kerb.
 */
export function shapeBridge(track, segLen) {
  const { seg0, ramp, gap, far, height } = BRIDGE;
  const n = track.n;
  track.gap = new Uint8Array(n);
  // WHAT THE ARCH ADDED, kept separately. A harness that measures the crest off
  // track.hill measures the arch PLUS whatever the landscape was already doing
  // underneath it — here, a natural climb of 1.6 units across the same ground —
  // and then reports a 14.4-unit bridge as 16.0 and calls it wrong. The arch is
  // the difference, so record the difference.
  track.bridgeAdd = new Float32Array(n);

  const at = (i) => ((i % n) + n) % n;

  for (let k = 0; k < ramp; k++) {
    const t = (k + 1) / ramp;
    // Eased over the first fifth, linear after it, and continuous at the join.
    const e = t < 0.2 ? (t * t) / 0.2 * 0.5 + t * 0.5 : t;
    track.hill[at(seg0 + k)] += height * e;
    track.bridgeAdd[at(seg0 + k)] = height * e;
  }
  // The missing span. The hill carries straight on at deck height as though the
  // deck were there — see the note above on why the hole is not in the hill.
  for (let k = 0; k < gap; k++) {
    const i = at(seg0 + ramp + k);
    track.hill[i] += height;
    track.bridgeAdd[i] = height;
    track.gap[i] = 1;
  }
  for (let k = 0; k < far; k++) {
    const t = 1 - (k + 1) / far;
    track.hill[at(seg0 + ramp + gap + k)] += height * t;
    track.bridgeAdd[at(seg0 + ramp + gap + k)] = height * t;
  }
  // And everything beyond the bridge is back on the natural profile, because
  // the arch was ADDED to a copy of it rather than replacing it. Nothing to
  // carry forward, and no seam to close.
  return track;
}

/** Is this distance over the missing deck? The physics' only question. */
export function inGap(track, dist, segLen) {
  if (!track.gap) return false;
  const seg = Math.floor(dist / segLen);
  return track.gap[((seg % track.n) + track.n) % track.n] === 1;
}

/** Where the lip is, in distance, so a harness can drive at it. */
export function lipDist(segLen) {
  return (BRIDGE.seg0 + BRIDGE.ramp) * segLen;
}

/** The gap's width in world units — what the jump has to cover. */
export function gapWidth(segLen) {
  return BRIDGE.gap * segLen;
}
