/**
 * THE TIME OF DAY, AS A SET OF COLOURS.
 *
 * ===========================================================================
 * WHY THIS EXISTS AT ALL, AND WHY IT IS A SPIKE BEFORE IT IS A FEATURE
 * ===========================================================================
 *
 * The Docks track is going to be a golden-hour scene. Every colour in this
 * game, though, was measured against a NIGHT reference and tuned to it: the
 * palette's own comment records that the reference is uniformly mid-tone at
 * luminance 52-58 and that only 1% of its pixels are brighter than 170, and
 * the ink weights, the fog and the tarmac tone were all set against that.
 *
 * Whether the comic-book look survives daylight is therefore UNPROVEN, and it
 * is the single largest unknown in the whole track. Finding out after building
 * five miles of docks is the expensive way round — so this exists to answer it
 * on the track that already exists, by swapping the colours and nothing else.
 *
 * ===========================================================================
 * IT IS PICKED ONCE, AT BOOT, AND CANNOT BE SWITCHED LATER
 * ===========================================================================
 *
 * Deliberately. Almost every world module here takes `palette` at construction
 * and BAKES the colours into a vertex buffer — the scenery's seven thousand
 * buildings, the barrier, the tunnel, the cockpit atlas. Mutating the palette
 * afterwards would recolour nothing and would look like a bug in the theme
 * rather than a misunderstanding of when colour is decided.
 *
 * So: `?theme=golden` on the URL, read before anything is built. That is
 * enough for an A/B — two tabs, same track, same corner, one variable — and an
 * A/B is the entire point of a spike. When the Docks needs this properly it
 * becomes a per-track choice made at the same moment, which is the same
 * mechanism with a different source.
 *
 * ===========================================================================
 * WHAT GOLDEN HOUR HAS TO DO THAT NIGHT DID NOT
 * ===========================================================================
 *
 * A low sun is the case where a renderer with NO LIGHTS has the most to gain
 * and the most to lose. There is no lighting pass to do the work, so every
 * suggestion of a sun direction has to be in the flat colours themselves.
 * Three things follow, and they are why this is not just "make it brighter":
 *
 *   THE SKY INVERTS. At night the sky is darkest at the top and lifts toward
 *   the horizon, because the city glows. At golden hour it is BLUE at the top
 *   and hot at the horizon, and the gradient is much stronger.
 *
 *   THE FOG CHANGES JOB. Night fog is a blue haze that hides distance. Golden
 *   hour fog is warm and LIGHT, and things far away get washed out toward the
 *   sun rather than dissolved into the dark. Fog colour must match the horizon
 *   band of the sky exactly or the join shows as a seam — which is easy to
 *   check and easy to miss.
 *
 *   WINDOWS STOP GLOWING. `window: 0xffe0a0` is a lit room seen at night. In
 *   daylight a window is DARKER than the wall around it, because it is a hole
 *   reflecting the sky. Getting this backwards is the single most obvious
 *   "night scene with a blue sky" tell there is.
 *
 * ===========================================================================
 * WHERE THE SUN IS, AND WHY IT IS BEHIND YOU IN THE COLOURS AND IN FRONT OF
 * YOU ON THE SCREEN
 * ===========================================================================
 *
 * Anthony wants the sun as an ANNOYANCE — "golden hour sun that gets in your
 * eyes, that's all a part of driving in rl". That means the sun ahead. But a
 * sun ahead means every building is BACKLIT, and a backlit city rendered with
 * no lights is a city of dark masses against a bright sky, which photographs
 * as night with a blue backdrop. The exact failure this spike exists to catch.
 *
 * So the two are separated, because they are separate things:
 *
 *   THE SHADING says the sun is BEHIND AND OVER YOUR SHOULDER. `pz`, the face
 *   pointing back down the road at the camera, is the lit one; `nx`, the flank
 *   facing the road, is the shaded one. That geometry is already what Scenery
 *   builds, so it costs nothing, and it is what makes the city read as lit.
 *
 *   THE GLARE is a screen-space thing — a sun disc and a wash — and it belongs
 *   to the HEADING, not to the world colours. It appears when the track points
 *   at the sun and it is gone round the next corner. That is variety rather
 *   than contradiction, and it is the honest version of what he described.
 *
 * The glare is NOT in this spike. This spike is only asking whether the flat
 * comic palette survives daylight at all. Adding a glare to a scene that reads
 * wrong would only make it harder to see that it reads wrong.
 */

/**
 * GOLDEN HOUR. Overrides only — anything not named here keeps its night value,
 * which is a deliberate way of making the diff readable rather than a saving.
 *
 * The values are a FIRST PASS and are expected to be wrong. They exist to be
 * photographed next to the night version and argued with; the project's rule
 * is that reasoning about rendering has been wrong every time it has been
 * tried here and looking at frames has been right.
 */
export const GOLDEN = {
  // A real evening sky: deep blue overhead falling through pale blue into a
  // hot band at the horizon. Much more contrast top-to-bottom than the night
  // sky, which is nearly flat.
  skyTop:  0x1f5c9e,
  skyMid:  0x6ba6d6,
  skyLow:  0xf2c98d,
  skyGlow: 0xf0a259,
  // The horizon band and the fog are THE SAME FAMILY on purpose. If they drift
  // apart the world ends in a visible line across the screen.
  haze:    0xe9b482,

  // WHERE THOSE STOPS SIT, WHICH TURNED OUT TO MATTER MORE THAN WHAT THEY ARE.
  //
  // The sky is a 64px gradient stretched across the SCREEN, not across the
  // world — so a stop's position is a position on the display, and the road
  // and the cockpit cover everything below about 0.36 of it. Sampling a sky
  // column of the first golden render: the visible sky runs from v=0.08 to
  // v=0.35 and NOTHING ELSE IS EVER SEEN. The night stops put skyLow at 0.72,
  // skyGlow at 0.92 and haze at 1.00, so all three of the warm bands this
  // theme is built around were being drawn underneath the tarmac.
  //
  // That is why the first pass came out as a flat midday blue: the visible sky
  // was a straight skyTop-to-skyMid ramp and the golden hour was off-screen.
  // No amount of picking better warm colours would have fixed it, which is a
  // decent argument for sampling a frame before retuning a palette.
  //
  // AND THE SAME IS TRUE AT NIGHT. PAL.skyGlow is commented "the city's own
  // light, just above the rooftops" and it has never once been on screen.
  // Deliberately NOT fixed here — Anthony has called that track finished and
  // this is a spike — but it is a free improvement to the night sky whenever
  // he wants it. See ROADMAP.
  stops:   [0.00, 0.24, 0.31, 0.355, 0.42],

  // Sunlit tarmac is warm and mid — not the blue-grey of a road under
  // streetlights. Kept a long way below the sky so the road still reads as a
  // surface rather than as a light source.
  road:    0x6a6560,
  roadAlt: 0x726c66,
  lane:    0xf4efe4,
  edge:    0xf6f1e6,
  // Ink goes warm rather than staying blue-black. A cold outline over warm
  // colour is what makes cheap daylight art look pasted together.
  ink:     0x241a12,

  gutterA: 0x8a7f70,
  gutterB: 0x7d7367,
  grass:   0x6f8a3c,
  grassAlt:0x637d34,

  // Buildings and containers catch the sun. This is the value most likely to
  // be wrong: it wants to be bright enough to read as lit, without climbing so
  // far that the road looks like a shadow by comparison.
  wall:    0xb99b74,
  // AND THE WINDOWS INVERT. Darker than the wall, cool against the warm
  // facade, because a window in daylight is a hole reflecting sky.
  window:  0x53606b,
  glass:   0x4a5560,

  // The signs stop being neon and become paint. Nothing glows in daylight.
  neonA:   0xc0563f,
  neonB:   0x3f8c86,
  neonC:   0xc9963a,
  neonD:   0x6a5a8c,

  // ---- THE CITY'S OWN COLOURS, WHICH ARE NOT IN THE PALETTE AT ALL -------
  //
  // This is the thing the first run of the spike found, and it is the reason
  // the spike was worth doing. Overriding the palette changed the sky, the
  // fog and the road, and the buildings did not move a single luminance
  // point — because Scenery does not read PAL.wall. It generates a tint per
  // instance from a hardcoded HSL: hue 0.56 (blue), a narrow saturation, and
  // a lightness band tuned to put the mean at the night reference's 56.
  //
  // Photographed, that gave a blue sky over a night city, which is exactly
  // the "night scene with a daylight backdrop" failure this was looking for —
  // and it would have been invisible in reasoning, because the palette LOOKED
  // like it contained the building colour. `wall: 0x344250` is even commented
  // "measured: the building faces in the reference". It is not used by them.
  //
  // So the generator's three numbers become theme values. They are also
  // exactly what the Docks will need: a container yard wants a WIDE hue
  // spread and high saturation where a city wants a narrow cool one.
  cityHue:   0.075,        // warm sandy concrete rather than blue
  cityHueSpread: 0.11,     // wider than the first pass: see below
  citySat:   0.20,
  cityLight: 0.52,         // lit by a low sun, well above the night's 0.34
  cityLightSpread: 0.055,
  // THE BLACK TOWERS BECOME BUILDINGS IN SHADOW, AND THEY STAY DARK.
  //
  // One instance in five is a solid mass rather than a facade, and it is the
  // single biggest thing stopping a street of lit fronts reading as a bar
  // chart — see the note where it is used. The first golden pass made those
  // masses the same warm hue as everything else at lightness 0.30, and they
  // came out as "a slightly darker brown building", which is not a mass.
  //
  // The daylight equivalent of a black silhouette is not a dark version of the
  // sunlit colour. It is a wall in SHADOW, and a shadow outdoors is lit by the
  // sky, so it is COOL, dark and desaturated. Making it blue against the warm
  // street is what gives back both the value contrast the night version had
  // and, for free, the strongest statement of a sun direction in the frame.
  cityDarkHue:   0.60,
  cityDarkLight: 0.20,

  // ---- THE FACADE TILE, WHICH IS THE THIRD PLACE COLOUR LIVES ------------
  //
  // And the second one the spike found. A building's final colour is
  //
  //     instance tint  x  per-face shade  x  the window tile's texel
  //
  // all three multiplied. Fixing the instance tint above turned the DISTANT
  // city sandy and left the near buildings slate blue, because at close range
  // the tile's own #8ea6bf concrete is most of what you are looking at and it
  // is a cold blue-grey measured off a night reference.
  //
  // Multiplication only ever darkens and pulls toward the texel's hue, so the
  // daylight tile has to be BRIGHT and close to NEUTRAL: bright so the product
  // lands on a lit facade, neutral so the instance tint is what decides
  // whether this city is sandy concrete or a painted container yard. That
  // second property is what makes this reusable for the Docks.
  tilePier:  '#c9c1b5',
  tileSlab:  '#a49b90',   // the spandrel band, still darker than the pier
  tileLip:   '#f3ead8',   // the cornice and the sills: the sunlit line
  tileShadow:'#6d6255',   // what the cornice throws, warm rather than blue-black
  tileGlass: '#4c5a68',   // DARKER AND COOLER THAN THE PIER. See the header.
  tileInk:   '#161009',
  // Windows do still catch the eye at golden hour, but as REFLECTIONS of a low
  // sun rather than as lit rooms — hotter, whiter, and rarer, because a flare
  // only happens on the panes at the right angle.
  litChance: 0.045,
  litHot:    '#fff4d8',
  litWarm:   '#ffd9a2',
  litCool:   '#e8f0ff',

  // ---- THE PER-FACE SHADE -----------------------------------------------
  //
  // Night's flank is 0.30 — nearly black, because at night an unlit side of a
  // building IS nearly black. In daylight the shaded side is still lit, by the
  // sky, so it is much brighter AND relatively cooler than the sunlit face.
  // That cool/warm split across an edge is most of what sells a sun direction
  // when there is no light to cast one.
  flank: [0.56, 0.58, 0.66],

  // ---- THE INK ITSELF, WHICH THE POSITIVE CONTROL FOUND ------------------
  //
  // Every building is drawn twice: once as itself and once as a slightly
  // larger shell behind it in CITY_INK, and that shell is the outline the
  // whole comic-book style rests on. It is a separate constant from PAL.ink
  // and it reads neither the palette nor anything else, so the first golden
  // build drew a sunlit sandy city outlined in cold night blue-black.
  //
  // Nobody spotted that by looking — it is a two-pixel line. It came out of
  // tools/nightsame.mjs's positive control, which loads the golden theme and
  // asserts that everything the tool measures CHANGES; the ink was the one
  // value that did not, and the only two explanations were "the theme misses
  // it" and "the tool is blind to it". The first was true.
  //
  // Warm and near-black rather than cool and near-black. A cold outline over
  // warm colour is exactly what makes cheap daylight art look pasted together,
  // which is written at the top of this file and was still got wrong.
  cityInk: 0x16100a,
};

/**
 * THE CITY GENERATOR'S NUMBERS, with the night values as defaults.
 *
 * Kept next to the palette rather than inside it because they are not colours
 * — they are the parameters of a colour generator, and putting them in PAL
 * would mean anything reading PAL for a colour could pick one of these up by
 * mistake.
 */
export function cityTint() {
  const g = themeName() === 'golden';
  return {
    hue:        g ? GOLDEN.cityHue : 0.56,
    hueSpread:  g ? GOLDEN.cityHueSpread : 0.18,
    sat:        g ? GOLDEN.citySat : 0.16,
    light:      g ? GOLDEN.cityLight : 0.34,
    lightSpread:g ? GOLDEN.cityLightSpread : 0.040,
    darkLight:  g ? GOLDEN.cityDarkLight : 0.085,
    darkHue:    g ? GOLDEN.cityDarkHue : 0.60,
  };
}

/**
 * Where the sky gradient's five stops sit, 0 at the top of the SCREEN.
 *
 * Positions rather than colours, because the gradient is stretched across the
 * display and the bottom two thirds of it are behind the road. See the note on
 * GOLDEN.stops — this is the single change that made the daylight sky read.
 */
export function skyStops() {
  return themeName() === 'golden' ? GOLDEN.stops : [0.00, 0.40, 0.72, 0.92, 1.00];
}

/**
 * THE FACADE TILE'S COLOURS, night values as defaults.
 *
 * Same argument as cityTint: these were literals inside windowTexture() and
 * the palette had no say over them, so a theme that only touched PAL could not
 * reach the largest single area of pixels in the frame.
 */
export function tileTint() {
  const g = themeName() === 'golden';
  return {
    pier:   g ? GOLDEN.tilePier   : '#8ea6bf',
    slab:   g ? GOLDEN.tileSlab   : '#66768c',
    lip:    g ? GOLDEN.tileLip    : '#a9bccd',
    shadow: g ? GOLDEN.tileShadow : '#242c37',
    glass:  g ? GOLDEN.tileGlass  : '#5a6b80',
    ink:    g ? GOLDEN.tileInk    : '#0b0f16',
    // Night: 11% of panes have a room on, measured against a reference where
    // only 1% of pixels clear luminance 170.
    litChance: g ? GOLDEN.litChance : 0.11,
    hot:    g ? GOLDEN.litHot  : '#ffe0a0',
    cool:   g ? GOLDEN.litCool : '#cfe0f2',
    warm:   g ? GOLDEN.litWarm : '#ffbf7a',
  };
}

/**
 * The shade baked into the flank face's vertex colours. The camera-facing face
 * is always [1,1,1] — it is the reference the flank is a fraction of — so only
 * the flank is themed.
 */
export function flankShade() {
  return themeName() === 'golden' ? GOLDEN.flank : [0.30, 0.32, 0.39];
}

/** The outline colour for the city's ink hulls. See GOLDEN.cityInk. */
export function cityInk() {
  return themeName() === 'golden' ? GOLDEN.cityInk : 0x0d1119;
}

/**
 * Which theme the page was opened with. `?theme=golden` and nothing else so
 * far; anything unrecognised is night, because a typo in a query string should
 * give you the game rather than a blank screen.
 */
export function themeName() {
  try {
    return new URLSearchParams(location.search).get('theme') === 'golden' ? 'golden' : 'night';
  } catch (e) { return 'night'; }
}

/** The overrides for that theme, or an empty object for night. */
export function themeColours() {
  return themeName() === 'golden' ? GOLDEN : {};
}
