/**
 * THE TRACKS, AS DATA.
 *
 * ===========================================================================
 * WHY A TRACK IS CHOSEN AT BOOT AND NOT SWITCHED AT RUNTIME
 * ===========================================================================
 *
 * The same reason the theme is, and it is not a shortcut. Almost everything in
 * the world is built ONCE and baked: the city's seven thousand instance
 * colours are a Float32Array written at construction, the facade texture is a
 * canvas painted at startup, the barrier and the tunnel take a palette and
 * write vertex buffers, and `CENTRIFUGAL` is derived from the worst corner in
 * the elevation profile before the first frame is drawn.
 *
 * A runtime switch would have to tear all of that down and rebuild it, which
 * is a large amount of new code whose only job is to avoid a page load that
 * takes well under a second from cache. So: the track is read before anything
 * is built, and the TRACKS menu sets it and reloads. That is one line of
 * mechanism instead of a subsystem, and it puts the choice in exactly the
 * place the theme already made it.
 *
 * ===========================================================================
 * WHAT A TRACK OWNS
 * ===========================================================================
 *
 * Everything that used to be a module-scope constant with one possible value.
 * The rule when moving one here was: if the Docks needs a different number,
 * it belongs to the track; if both tracks want the same number forever, it
 * stays a constant in main.js. Guessing which is which is how a config object
 * turns into a second copy of the program.
 *
 * ===========================================================================
 * NIGHT MUST COME OUT BYTE-IDENTICAL
 * ===========================================================================
 *
 * Anthony has driven MIDNIGHT MILE to 57.1s and called it finished. Its
 * profile comes out of a seeded xorshift, so the SEQUENCE of random draws is
 * part of the track: adding a parameter that costs one extra rnd() call, or
 * reordering two, reshapes every corner after it. The generator therefore
 * draws exactly the same numbers in exactly the same order for both tracks,
 * and the parameters only scale what those numbers become.
 *
 * tools/nightsame.mjs is the proof, and it compares state rather than pixels.
 */

/**
 * THE DEFAULTS ARE THE NIGHT CITY'S NUMBERS, lifted verbatim from what
 * buildTrack used to hardcode. A track that names none of these gets the
 * original road.
 */
const PROFILE = {
  straightP: 0.34,    // below this the feature is dead straight
  bendP: 0.72,        // below this it is a gentle bend, above it a hard corner
  bendMax: 0.055,     // curvature of a gentle bend
  hardMin: 0.075,     // and of a hard corner, plus up to hardVar more
  hardVar: 0.05,
  lenMin: 40,         // how long a feature runs, in segments
  lenVar: 90,
  hillP: 0.62,        // how often a feature also changes height
  hillVar: 30,        // by up to this much, either way
  hillClamp: 55,      // and never outside this band
};

export const TRACKS = {
  /**
   * MIDNIGHT MILE. The original, and the shipped one. Nothing here is a
   * choice — every value is what main.js hardcoded before there was a second
   * track, and it is written out in full rather than left to defaults so that
   * changing a default cannot silently move a finished track.
   */
  night: {
    id: 'night',
    name: 'MIDNIGHT MILE',
    blurb: 'A wet city at midnight. Armco, a tunnel, and a bridge with a hole in it.',
    theme: 'night',
    seed: 0x9e3779b9,
    segments: 4000,
    from: 600,
    len: 12000,
    // The version rides in the key, not in the payload, for the reason the old
    // BEST_KEY comment gives: a stored time from a different car or a different
    // road is not a slower lap, it is a different question.
    bestKey: 'svu-racer-best-v2',
    profile: { ...PROFILE },
    bridge: true,
    tunnel: true,
    scenery: 'city',
    barrier: true,
    furniture: true,
    fog: 0.0030,
  },

  /**
   * THE DOCKS. Longer, flatter, faster, and lit by a low sun.
   *
   * THE PROFILE IS THE VARIETY, not just the scenery. A second track that
   * drives like the first with different boxes beside it is a reskin, and
   * Anthony's ask was "a lot of variety would be a good thing to make it
   * interesting". So the two roads are deliberately opposite:
   *
   *   MIDNIGHT MILE is a city — tight, hilly, blind. Elevation swings 110
   *   units, corners reach 0.125 curvature, and a third of it is straight.
   *
   *   THE DOCKS is reclaimed flat land at sea level. It is nearly level, the
   *   corners are long and open, and HALF of it is straight — which is what
   *   makes a five-mile lap survive being five miles long, and what makes the
   *   nitrous decision different here: there is far more ground at the ceiling
   *   and far less spent climbing back to it.
   *
   *   All the vertical drama is ENGINEERED instead of geological: the ferry
   *   ramp, the jumps and the underpass. On a flat road a six-unit dip reads
   *   as an event; on the city's rollercoaster it would vanish.
   *
   * 18,900 units is 5.05 miles, and about 90 seconds at the car's unboosted
   * cap — Anthony's number. It fits the existing 4,000-segment generator with
   * 4,500 units to spare, so nothing about the road system changes to hold it.
   */
  docks: {
    id: 'docks',
    name: 'THE DOCKS',
    blurb: 'Five miles of container yard at golden hour. Water, a ferry, and a long way round.',
    theme: 'golden',
    // A different seed, or the Docks is the city's corners with the sea beside
    // them. Chosen for nothing but being unrelated to 0x9e3779b9.
    seed: 0x4d0c1b77,
    segments: 4000,
    from: 600,
    len: 18900,
    bestKey: 'svu-racer-docks-v1',
    profile: {
      ...PROFILE,
      straightP: 0.50,   // half of it, against the city's third
      bendP: 0.86,       // and most of the rest is a long open bend
      bendMax: 0.040,
      hardMin: 0.058,    // the hardest corner here is milder than the city's mildest hard one
      hardVar: 0.030,
      lenMin: 70,        // longer features: fewer, bigger gestures over five miles
      lenVar: 130,
      hillP: 0.45,
      hillVar: 7,        // sea level, give or take a quayside
      hillClamp: 9,
    },
    bridge: false,
    tunnel: false,
    // The same instancer, the same draw calls, different boxes. See the
    // container branches in main.js's Scenery and containerTexture().
    scenery: 'containers',

    /**
     * NO ARMCO AND NO STREET FURNITURE, and both are deletions with a reason
     * rather than things not built yet.
     *
     * THE ARMCO WAS HIDING THE SEA. It is a continuous steel rail at eye
     * height down both verges, and on the city's rollercoaster you look DOWN
     * on it half the time. The Docks is flat, so the camera sits five units up
     * on a level road and the rail covers the entire horizon on both sides —
     * which is the horizon the water was put there to be. The first build with
     * containers in it had five miles of estuary behind a crash barrier.
     *
     * THE FURNITURE IS A CITY'S. Zebra crossings, traffic signals, street-name
     * plates and fire hydrants, drawn from a night reference of an urban
     * avenue. In a container yard they are not merely unnecessary, they are
     * wrong in a way that reads instantly — a pedestrian crossing between two
     * stacks of forty-foot boxes says nobody looked at this.
     *
     * Both modules already stub themselves out when handed no scene, so this
     * costs nothing and removes two draw calls — which is where the gantry
     * cranes are going to come from.
     */
    barrier: false,
    furniture: false,

    /**
     * HALF THE CITY'S FOG, AND IT IS THE DIFFERENCE BETWEEN HAVING A SEA AND
     * NOT HAVING ONE.
     *
     * 0.0030 was measured against a night city, where the job of fog is to
     * hide distance: 55% at 400 units, 96% at 800. On a flat dock that is
     * catastrophic rather than atmospheric. The ground plane runs 700 units
     * out to either side, so on a level road EVERYTHING you can see of the
     * water beyond the first few metres — and the near few metres are behind
     * the dashboard — arrives at 90% haze. The first build with water in it
     * photographed as an orange sky meeting an orange sea, and the water was
     * working perfectly.
     *
     * A clear evening over an estuary is the case with the LEAST haze in it,
     * not the most. At 0.0013 the far bank is at 40% rather than 96%, so the
     * sea keeps its colour out to the horizon and the warm band belongs to the
     * sky again instead of swallowing the bottom half of the frame.
     *
     * It is a per-track value and not a per-theme one on purpose: fog is about
     * how far you can see, which is a property of the place. A foggy golden
     * hour is a perfectly good thing for some future track to want.
     */
    fog: 0.0013,

    /**
     * PER-TRACK PALETTE OVERRIDES, applied on top of the theme.
     *
     * The theme answers "what time of day is it"; this answers "what is the
     * ground made of", and they are not the same question. GOLDEN.grass is a
     * sunlit lime green, which is right for a verge and absurd for a dock —
     * the first build with containers in it had a strip of lawn between the
     * tarmac and the sea.
     *
     * A dock is concrete apron all the way to the quay: oil-stained, warm-grey,
     * and banded like the tarmac so the periphery still carries motion.
     */
    colours: {
      grass:    0x8a8177,
      grassAlt: 0x807870,
      // The kerb line between apron and road, and the quayside lip. Concrete
      // rather than the city's blue-grey gutter.
      gutterA:  0x9a9086,
      gutterB:  0x8e857c,
    },

    /**
     * WHERE THE SEA IS, in segments, and it is the CHEAP option.
     *
     * The road mesh already emits two ground quads per segment, one either
     * side, every frame. On a water stretch those quads just get a water
     * colour — no new geometry, no new draw call, and it REPLACES the
     * instanced boxes that would otherwise have to fill that half of the view.
     * Water alongside costs less than container stacks alongside, not more.
     *
     * It also gives the horizon somewhere to be that is not another row of
     * boxes, which is the thing that has to stop five miles feeling like one
     * mile driven five times.
     *
     *   side: -1 water on the left, +1 on the right, 0 on BOTH — the causeway.
     *
     * Ranges are in profile segments and are read per segment while the road
     * is built, so they cost one comparison each. Kept few and long for that
     * reason, and because a coastline that flickers side to side every hundred
     * metres reads as a mistake rather than as geography.
     */
    water: [
      { from: 180,  to: 620,  side: 1 },   // out of the yard with the estuary on the right
      { from: 900,  to: 1240, side: 1 },
      { from: 1500, to: 1680, side: 0 },   // THE CAUSEWAY: open water both sides
      { from: 1980, to: 2360, side: -1 },  // back the other way, so the lap has two coasts
      { from: 2620, to: 2980, side: -1 },
    ],
  },
};

/**
 * Which side has water at a given segment, or 0 for none.
 *
 * A plain loop over a handful of ranges rather than a lookup table: the table
 * would be 4,000 entries built at boot to save five comparisons a segment, and
 * this runs 260 times a frame, not 4,000.
 */
export function waterAt(t, seg) {
  const w = t.water;
  if (!w) return 0;
  for (let k = 0; k < w.length; k++) {
    if (seg >= w[k].from && seg < w[k].to) return w[k].side === 0 ? 2 : w[k].side;
  }
  return 0;
}

/** The order the TRACKS menu lists them in. */
export const TRACK_ORDER = ['night', 'docks'];

const STORE = 'svu-racer-track';

/**
 * WHICH TRACK, decided once, before anything is built.
 *
 * `?track=docks` wins, because a URL is how a harness and a bug report both
 * ask for a specific thing. Otherwise whatever the TRACKS menu last stored.
 * Anything unrecognised is the night city, on the same principle as the theme:
 * a typo should give you the game, not a blank screen.
 */
export function trackName() {
  try {
    const q = new URLSearchParams(location.search).get('track');
    if (q && TRACKS[q]) return q;
    const s = localStorage.getItem(STORE);
    if (s && TRACKS[s]) return s;
  } catch (e) { /* no URL, no storage, no problem */ }
  return 'night';
}

/** The chosen track's data. */
export function currentTrack() {
  return TRACKS[trackName()];
}

/**
 * Choose a track for next time. Returns false if it is already the one
 * running, so the menu can avoid a pointless reload.
 */
export function chooseTrack(id) {
  if (!TRACKS[id]) return false;
  if (id === trackName()) return false;
  try { localStorage.setItem(STORE, id); } catch (e) { /* then it is a one-off */ }
  return true;
}
