// The car, from inside — DRAWN, not modelled.
//
// INTERFACE NOTE FOR main.js: unchanged. buildCockpit({ pencil, palette, ink,
// driverX }) still returns { group, update, stats }, update() still takes the
// same {speed,maxSpeed,steer,boosting,braking} object or null, and the group is
// still parented to the car and hidden by `group.visible`. Nothing in main.js
// needs to move. The only addition is `atlas` on the returned object, which is
// the canvas the cockpit is drawn into, exposed so a harness can photograph it.
//
// ----------------------------------------------------------------------------
// WHY THIS IS A SPRITE AND NOT GEOMETRY.
//
// In first person the cockpit is RIGID RELATIVE TO THE CAMERA. It never changes
// perspective, it is never seen from another angle, nothing ever passes in
// front of it. That is exactly the case a shooter draws its weapon as a sprite
// for, and the same reasoning applies here: a model of a dashboard buys nothing
// that a picture of a dashboard does not, and costs 1,248 triangles, two draw
// calls, an inverted-hull ink shell and a per-frame vertex rewrite to buy it.
//
// The previous version of this file spent all of that and still could not draw
// a tick mark, a numeral, a wiper arm or a finger grip, because every one of
// those is a dozen quads it did not have. Drawn into a canvas at boot they are
// free: the whole cockpit is ONE 1024x960 canvas painted once, shown as SEVEN
// screen-space quads in a single draw call, fourteen triangles.
//
// WHAT MOVES. The wheel turns and two needles sweep. They are separate quads
// cut from the same canvas, and turning one means rotating FOUR CORNERS about a
// pivot — sixteen floats — not rotating UVs (which would need a shader) and not
// re-stroking the canvas (which would cost a texture upload every frame). The
// tell-tale lamps change colour, which is twelve floats each when the state
// changes and nothing at all when it does not.
//
// AND THE GEAR NUMERAL CHANGES PICTURE. It is the one thing in here that is
// neither a position nor a tint: every gear is a different glyph. All six are
// drawn into the atlas at boot and the quad's four UVs are pointed at one of
// them — eight floats on a shift, nothing between shifts, and still no canvas
// touched after boot. Its colour is a tint like the lamps', because "you are
// labouring" is a state and not a shape.
//
// HOW IT IS PINNED TO THE SCREEN. The mesh's vertices are stored in normalised
// device coordinates and its matrixWorld is composed in onBeforeRender from the
// camera's, so modelViewMatrix comes out as a plain projection-cancelling
// matrix and the quad lands exactly where the numbers below say it lands, at
// any viewport size and at any field of view. That matters here: main.js opens
// the fov from 74 to 101 degrees with speed, and a cockpit that zoomed with it
// would be a cockpit that moved when the player accelerated.
//
// ----------------------------------------------------------------------------
// THE PICTURE, AND WHERE IT COMES FROM.
//
// ref/target-cockpit.png, measured rather than admired. The dash is wood-toned
// (#ad8756 lit, #8b6447 mid, #4c3b34 shade), not the near-black the modelled
// cockpit used; 47% of that frame is solid black ink; the green of the car's own
// bonnet shows beyond the scuttle in a band from y 0.58 to 0.66 of the frame,
// with a hot #d1f6b3 highlight along its crest. Twin large dials with a smaller
// one either side, a slotted three-spoke wheel with finger grips, a slatted
// centre vent, a rear-view mirror on the header rail, and two wiper arms lying
// across the base of the screen.
//
// RIGHT-HAND DRIVE, so the reference is MIRRORED. Anthony is in the UK,
// DRIVER_X is +0.62, and the eye sits over the driver's seat — so the wheel is
// right of centre, the centre console and its vents run away to the LEFT, the
// mirror hangs left of the wheel where the car's centreline is from this seat,
// and the near A-pillar on the right is visibly fatter than the far one on the
// left. `o.driverX` still drives it: its sign decides which way the whole
// interior is laid out, so negating DRIVER_X gives a left-hand-drive cockpit
// with no other change.
//
// ----------------------------------------------------------------------------
// WHAT THIS COSTS, MEASURED.
//
//   before   2 draw calls, 1,248 triangles, an inverted-hull shell whose
//            vertices were rewritten and re-uploaded on any frame the wheel,
//            the lever or either needle moved
//   after    1 draw call, 12 triangles, at most 32 floats written per frame.
//            Measured in the browser: update() costs 0.195 microseconds with
//            everything moving and 0.033 once the needles settle.
//   and now  1 draw call, 14 triangles. The gear readout added one quad and
//            two triangles and no draw call, and it writes nothing on a frame
//            where the gear, the power band and the redline all stay put —
//            which is every frame except the shift itself. Measured with the
//            scene wound up at 1440x720: 9 calls and 46,124 triangles for the
//            whole game, against 9 and 46,122 before.
//
// Both measured with the scene frozen and the cockpit toggled, so the numbers
// are the cockpit's own and not the road's.
//
// The price is texture memory: 1024x960 RGBA with mipmaps is about 5.2MB. That
// is the whole cost of this change, and it buys back 1,236 triangles and a draw
// call on a PowerVR GE8320 that has neither to spare.

import {
  BufferGeometry, BufferAttribute, Mesh, MeshBasicMaterial, Group,
  CanvasTexture, LinearFilter, ClampToEdgeWrapping, SRGBColorSpace, Matrix4, Color,
} from 'three';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------- the atlas
//
// ONE canvas, so ONE texture, so ONE draw call. Regions are laid out with a
// gutter between them and nothing is mipmapped, so no region can bleed into its
// neighbour — the usual way an atlas goes wrong.
//
// ART is the whole frame at 2.4:1, the shape of a phone held sideways, and it
// is the only region whose aspect matters: the quad it is drawn on is scaled to
// COVER the viewport, so on a squarer screen the sides are cropped rather than
// the picture being squashed.
const ATLAS_W = 1024, ATLAS_H = 960;
const ART_X = 0, ART_Y = 0, ART_W = 1024, ART_H = 427;
const WHL_X = 0, WHL_Y = 448, WHL_S = 512;      // the wheel, hub at its centre
const NDL_X = 536, NDL_Y = 448, NDL_W = 32, NDL_H = 128;
const NDL_PIVOT = 100;                          // pivot this far down the sprite
const LMP_X = 600, LMP_Y = 448, LMP_W = 128, LMP_H = 64;
// THE GEAR NUMERALS, one cell per gear, all six drawn at boot.
//
// This is the one thing in here that cannot be a corner move or a tint: which
// numeral is on show is a different PICTURE, not a different position, and the
// dash canvas is painted once and must not be repainted per frame. So the
// numerals live side by side in the atlas and the gear quad's four UVs are
// pointed at one of them — eight floats, written when the gear changes and on
// no other frame. It is cheaper than the lamp's twenty-four and it happens
// less often; nothing is redrawn, uploaded or allocated.
//
// SIX CELLS FOR FIVE GEARS. main.js's GEARS has five entries today and the
// garage is meant to sell ratios later; a sixth cell costs 3.5KB of a texture
// that is already 5.2MB and means a six-speed box needs no atlas change.
//
// Placed at x 592 — 80px clear of the wheel, 24 of the needle — and y 616, 40
// below the needle's cell and 104 below the lamp's, so the mip chain has the
// same clear gutter every other region here has. The strip ends at x 1000 and
// y 680, both inside the atlas.
const DIG_X = 592, DIG_Y = 616, DIG_W = 48, DIG_H = 64;
const DIG_STRIDE = 72, DIG_N = 6;

// ------------------------------------------------------------ the framing
//
// Every number here is a fraction of the frame — 0 at the left/top, 1 at the
// right/bottom — and every one of them is quoted against ref/target-cockpit.png
// or against the sight-line arithmetic the modelled cockpit worked out and this
// one inherits.
//
// THE TWO THAT DECIDE HOW MUCH ROAD YOU CAN SEE:
//
//   BONNET_TOP   the crest of the car's own bonnet, silhouetted against the
//                world, and THE ONLY LINE IN HERE THAT COSTS ROAD. Everything
//                below it is hidden by the bonnet anyway, so where the dash
//                sits is free. The modelled bonnet's front edge sat at h/d =
//                0.137, which is 0.665 down the frame at speed and hides the
//                road nearer than twelve units; the reference draws its crest
//                at 0.58. 0.612 splits them: at the fov the ink meter freezes
//                at, that is h/d = 0.101, so the road is hidden nearer than
//                sixteen units — a tenth of a second at top speed.
//   DASH_TOP     the scuttle. Lower on the right than the left because the
//                driver sits on the right, so the right-hand end of the dash is
//                the NEAR end, and near things sit lower in a frame. That slope
//                is the cheapest cue there is that you are sitting on one side
//                of a car rather than floating down the middle.
//
// THE GAP BETWEEN THEM IS THE GREEN. First pass at these numbers left 0.05 of
// frame between the crest and the scuttle, and the wiper arms ate two thirds of
// it — the car's own bonnet was a fifteen-pixel sliver. The dash costs nothing,
// so the dash moved down.
//
// Unlike the modelled cockpit these do not move with speed or with the camera's
// pitch, which is the whole point of a sprite: the bonnet cannot swallow the
// road on a descent because the bonnet is painted on the screen.
const BONNET_TOP = (fx) => 0.612 + 0.038 * (2 * fx - 1) ** 2;
const DASH_TOP = (fx) => 0.700 + 0.052 * fx;
const HDR_BOT = (fx) => 0.058 + 0.055 * (2 * fx - 1) ** 2;

// The wheel. Hub below the bottom edge, the way a real one is cropped, and the
// top of the rim at 1.030 - 0.355 = 0.675 — just under the bonnet's crest, so
// the wheel silhouettes against bodywork and takes no road at all.
const WHEEL_X = 0.575;          // right of centre: RIGHT-HAND DRIVE
const WHEEL_Y = 1.005;          // in FRAME HEIGHTS from the top
const WHEEL_R = 0.345;          // in frame heights

// The instrument cluster: two large dials directly ahead of the driver, seen
// through the top of the wheel, and a smaller one either side.
//
// THE SMALL PAIR ARE OUTSIDE THE WHEEL'S ARC, NOT INSIDE IT, and that is a fix
// rather than a preference. Sitting them beside the big pair in the pod put
// their centres exactly on the inner edge of the rim, so the wheel covered half
// of each and from the driver's seat there were two dials, not four. Outside
// the rim they land on the bare dash either side of the binnacle, which is
// where the reference's right-hand sub-dial is too. Everything below is checked
// against the wheel: a point is clear of it when its distance from the hub
// exceeds WHEEL_R plus its own radius.
const DIAL_Y = 0.845;
const DIAL_R = 0.095;           // frame heights
const DIAL_DX = 0.0405;         // frame WIDTHS from the cluster centre
const SUB_Y = 0.805;
const SUB_R = 0.048;
const SUB_DX = 0.152;
const POD_HW = 0.130;           // half-width of the binnacle, frame widths

// The tell-tales, out on the dash beyond the sub-dials where neither the rim
// nor anything else can reach them. The modelled cockpit painted its warning
// lamp on a lip that faced away from the driver and was never drawn at any
// speed; these are flat on the dash top, dead in front of the eye.
//
// THE SPEEDO READS IN KM/H AND MEANS IT.
//
// The modelled cockpit drove its needle from speed/maxSpeed, so the needle
// always swept the whole dial whatever gear ratio the player had bought. That
// was defensible while the dial had no numbers on it. It stops being defensible
// the moment numerals are printed round the rim: at speed step 3 the HUD reads
// 326 km/h and a ratio-driven needle would have been sitting on "243". A dial
// that disagrees with the readout beside it sends the player looking for a bug.
//
// So the needle is driven by ABSOLUTE speed against a fixed full scale. 1.55 is
// main.js's KMH, copied rather than imported because main.js imports this file
// and the cockpit is not going to reach back through that. 480 is a round
// number just above the 465 km/h the top speed step reaches, so the last
// graduation is somewhere the car can actually get to and the red zone at 88%
// is somewhere it has to earn.
// mph, because Anthony is in the UK. 1.55 was main.js's world-units-to-km/h;
// a mile is 1.609 km, so 0.9633 is the same world unit in mph. Copied rather
// than imported because main.js imports this file and the cockpit is not going
// to reach back through that.
//
// FULL SCALE 320 rather than a round 300, so the graduations divide cleanly:
// eight majors gives 40mph a major and numerals at 0, 80, 160, 240, 320. The
// car's 210 world units is 202mph, which sits at 63% — two thirds round the
// dial, with the last third earned on the boost, which reaches 273mph at 85%.
// The red zone at 88% is therefore somewhere only a boosted top gear goes.
const MPH = 0.9633;
const DIAL_FULL = 320;

// ------------------------------------------------- the gear, in the tacho
//
// WHERE A GEAR NUMBER GOES, and it is not the radio panel. That panel's LCD is
// 107 x 16 device pixels on the owner's phone — two characters at best — and
// nothing about a stereo says "third". The tacho face is 137 device pixels
// across, nine times the area, and the lower half of a rev counter is where
// every performance car with a gear readout puts one, for the same reason it
// is free here: the needle never goes there.
//
// THE LOWER HALF IS THE ONLY PLACE ON THIS FACE IT FITS. Measured against the
// dial the file already draws, in units of the dial radius r (40.6 art px, 68
// device px):
//
//   the needle sweeps +/-125 degrees, so the 110-degree wedge at the BOTTOM of
//   the face is the one place it cannot reach. At full deflection it passes
//   x = +/-0.63r at the numeral's own height, and the widest numeral reaches
//   0.24r either side of centre. Nothing is ever drawn over the readout, and
//   the redline frame in shots/gd-g5-red-dial.png is the proof.
//   the graduation numerals "0" and "8" sit at (+/-0.41r, +0.28r), inner edge
//   0.35r out. The numeral stops at 0.24r: seven device pixels of clear air.
//   the red zone's lower end is at (+0.56r, +0.39r), further out again.
//   the needle's chrome cap covers 0.085r around the spindle. The numeral's
//   top edge is at 0.44r - 0.30r = 0.14r, so it clears the cap as well.
//
// MEASURED ON THE PANEL, not asserted: 37 device pixels of white numeral, 41
// with its ink outline, 31 to 33 wide, in every gear. tools/geardash.mjs.
//
// GEAR_CY_R is where the numeral's WHITE is centred, not where its quad is:
// the quad is sized and offset at boot from the ink actually drawn into the
// atlas cell, so a font whose digits sit high or low in the em box cannot
// quietly shift the readout off the axis of the dial.
const GEAR_CAP_R = 0.55;        // numeral cap height, in dial radii
const GEAR_CY_R = 0.44;         // its centre, below the dial centre, same units
// The two states the numeral has. WHITE IS THE SAME WHITE THE GRADUATIONS ARE
// PAINTED IN, so the readout looks like the rest of the instrument rather than
// like something sitting on top of it, and the amber is the amber of a warning
// lamp. Both are tints on one white drawing, which is how the lamps work too.
const GEAR_LIT = new Color(0xe8ecf0);       // C.mark
const GEAR_LOW = new Color(0xffae2e);
/**
 * WHERE THE AMBER STARTS, AND WHY IT IS 0.3947 AND NOT "A THIRD".
 *
 * main.js's torque curve is `0.42 + 0.58*(rev/0.5)**0.8` below the peak at
 * rev 0.5 — an engine that makes 42% of its torque at a standstill and all of
 * it at half revs. The bottom of a power band is conventionally where the
 * engine has lost a tenth of its peak, and solving that curve for 0.90 gives
 * rev = 0.5 * ((0.90-0.42)/0.58)**(1/0.8) = 0.3947. It is written as the
 * arithmetic rather than as the answer so that a change to the curve in
 * main.js shows up here as a wrong-looking constant rather than as nothing.
 *
 * IT HAS TO BE ABOVE THE AUTOMATIC DOWNSHIFT OR IT IS A DEAD LAMP, and this is
 * the check that nearly went missing. main.js drops a gear whenever the speed
 * falls below 0.45 of the gear below's ceiling, which in revs is 0.45 *
 * GEARS[i-1]/GEARS[i]: 0.287 in second, 0.331 in third, 0.351 in fourth, 0.369
 * in fifth. Anything below 0.369 could never be seen in top gear and anything
 * below 0.331 could never be seen in third — an 80%-of-peak threshold, which
 * is the other convention, lands at 0.295 and would have been an instrument
 * that never once lit. 0.3947 leaves a live band in every gear.
 *
 * The threshold is against the RAW rev main.js sends, because that is the
 * number the torque curve is a function of — not against the needle's
 * position, which carries a 0.10 idle floor on top of it.
 */
const POWER_BAND_LO = 0.5 * ((0.90 - 0.42) / 0.58) ** (1 / 0.8);
/**
 * AND IT CLEARS AT THE TORQUE PEAK, NOT AT THE SAME EDGE IT LIT.
 *
 * Measured on a live twenty-second run rather than reasoned about: shifting at
 * the limiter the amber never appears, which is right; shifting at half revs
 * it appeared for 0.08 of a second in the whole run — ONE FRAME. The engine
 * accelerates out of the bottom of its own power band in about a fifth of a
 * second, so a warning that turns off at the exact rev it turns on at is a
 * warning nobody will ever see, and this project has shipped enough of those.
 *
 * So the numeral latches: amber below 0.3947, and white again only once the
 * engine is back at the peak of its torque curve at 0.5. That is the same
 * hysteresis a real tell-tale has, it cannot flicker, and it says something
 * true for the whole time it is lit — you dropped out of the band and you are
 * not back on the peak yet. The same twenty seconds now measures 0.35s of
 * amber for the half-revs shifter and 3.2s for one shifting at 42%, against
 * 0.08s and 1.1s without the latch, and still exactly none for the driver who
 * uses the limiter. That last figure is the one that matters: the colour has
 * to stay off for someone driving well or it is decoration.
 */
const POWER_BAND_PEAK = 0.5;

const LAMP_Y = 0.762;
const LAMP_DX = 0.205;
const LAMP_W_F = 0.049;         // frame widths
const LAMP_H_F = 0.048;         // frame heights

// ------------------------------------------------------------------ colour
//
// Measured off ref/target-cockpit.png, sampled rather than chosen. The wood
// dash is the big change from the modelled cockpit, which was near-black
// throughout and read as a hole in the bottom of the frame.
const INKC = '#07080b';
const C = {
  // wood/tan dash — #ad8756 lit, #8b6447 mid, #4c3b34 shade, all sampled
  dashHi: '#c8a068', dashTop: '#ad8756', dashMid: '#8b6447',
  dashLo: '#66492f', dashDeep: '#42322a',
  // interior plastics and trim
  trimDark: '#23262b', trim: '#33373d', trimLit: '#565c61', trimHi: '#7a8186',
  // chrome, the brightest thing in here and nothing else is allowed near it
  chromeHi: '#ccd2d4', chrome: '#9aa1a4', chromeMid: '#767d82', chromeLo: '#484e53',
  // the wheel: dark wood rim, chrome spokes
  // The rim measures darker in the reference than it looks — near-black wood
  // with a warm highlight doing all the work. At #3b2d24 ours read as orange.
  rim: '#33261e', rimHi: '#6a4e33', rimLo: '#1d1510',
  // instruments
  face: '#16181c', faceLit: '#22262b', mark: '#e8ecf0', red: '#c8384b',
  needle: '#ff6a3c', needleLo: '#b83c1c',
  glass: '#46525f', glassLit: '#7d8b98',
};

// ------------------------------------------------------------- drawing kit
//
// Everything below is plain Canvas 2D: paths, fills, strokes. No roundRect, no
// ctx.filter, no conic gradients — this has to run in whatever WebView ships on
// a Helio A22 phone, and the newest thing on that list is a decade younger than
// the oldest thing this might land on.

const rndFrom = (seed) => {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
};

const cssHex = (n) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');

const _mc = new Color(), _mc2 = new Color();
const cssMix = (a, b, t) => {
  _mc.setHex(a); _mc2.setHex(b);
  return '#' + _mc.lerp(_mc2, t).getHexString();
};

/** A polygon from a flat [x,y,x,y,...] list. */
function poly(x, pts) {
  x.beginPath();
  x.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]);
  x.closePath();
}

/**
 * Fill, then ink.
 *
 * THE INK IS THE DRAWING. ref/REFERENCE.md measures 39% of the reference car as
 * solid black line and warns that the failure mode is timidity. Two weights,
 * roughly 4:1: 7px for a silhouette and 2px for a panel break, on a 1024-wide
 * canvas that lands at about 1:1 on the phone.
 */
function ink(x, fill, w) {
  if (fill) { x.fillStyle = fill; x.fill(); }
  if (w > 0) {
    x.strokeStyle = INKC; x.lineWidth = w;
    x.lineJoin = 'round'; x.lineCap = 'round';
    x.stroke();
  }
}

/** A rounded rectangle, by hand, because roundRect is too new to rely on. */
function rrect(x, x0, y0, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  x.beginPath();
  x.moveTo(x0 + rr, y0);
  x.lineTo(x0 + w - rr, y0);
  x.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + rr);
  x.lineTo(x0 + w, y0 + h - rr);
  x.quadraticCurveTo(x0 + w, y0 + h, x0 + w - rr, y0 + h);
  x.lineTo(x0 + rr, y0 + h);
  x.quadraticCurveTo(x0, y0 + h, x0, y0 + h - rr);
  x.lineTo(x0, y0 + rr);
  x.quadraticCurveTo(x0, y0, x0 + rr, y0);
  x.closePath();
}

/** A band between two curves y = f(fx) and y = g(fx), across the whole width. */
function band(x, W, H, f, g, fill, inkW) {
  const N = 28;
  x.beginPath();
  for (let i = 0; i <= N; i++) { const fx = i / N; x.lineTo(fx * W, f(fx) * H); }
  for (let i = N; i >= 0; i--) { const fx = i / N; x.lineTo(fx * W, g(fx) * H); }
  x.closePath();
  ink(x, fill, inkW);
}

/** A curve y = f(fx), stroked. Used for the edges that are lines, not shapes. */
function curve(x, W, H, f, from, to, col, w) {
  const N = 24;
  x.beginPath();
  for (let i = 0; i <= N; i++) {
    const fx = from + (to - from) * (i / N);
    x.lineTo(fx * W, f(fx) * H);
  }
  x.strokeStyle = col; x.lineWidth = w;
  x.lineJoin = 'round'; x.lineCap = 'round';
  x.stroke();
}

/**
 * The coloured-pencil pass.
 *
 * Short low-alpha strokes, drawn with source-atop so they land ONLY on pixels
 * that are already painted — which means the windscreen stays perfectly clear
 * and the hatching stops dead at the edge of every shape, the way a pencil
 * stops at an inked line. Baked once, so it costs nothing per frame.
 *
 * KEPT LIGHT ON PURPOSE. A previous pass at this made the bottom third of the
 * screen one unbroken black; hatching is a texture, not a shadow.
 */
function pencilPass(x, w, h, rnd, count, alpha) {
  x.save();
  x.globalCompositeOperation = 'source-atop';
  x.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const px = rnd() * w, py = rnd() * h;
    const a = -0.62 + (rnd() - 0.5) * 0.28;
    const len = h * (0.03 + rnd() * 0.16);
    x.strokeStyle = rnd() < 0.72
      ? `rgba(20,16,14,${(alpha * (0.5 + rnd())).toFixed(3)})`
      : `rgba(255,248,235,${(alpha * 0.5 * (0.5 + rnd())).toFixed(3)})`;
    x.lineWidth = 1 + rnd() * 2.2;
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
    x.stroke();
  }
  x.restore();
}

// ----------------------------------------------------------------- a dial
//
// Chrome bezel, near-black face, pale graduations, a red zone on the tacho.
// The reference's dial faces measure #2b2f35 and #30343a — near-black with
// white numerals — and the bezel is the brightest ring in the frame. Getting
// that round the wrong way, which the modelled cockpit did for three builds,
// turns a pair of instruments into a pair of poker chips.
//
// ANGLES ARE CANVAS ANGLES, measured clockwise from twelve o'clock, because
// canvas y points DOWN and the previous attempt at this file put a spoke at
// "270 degrees" and got one pointing straight up through both dials.
const SWEEP = 2.18;             // +/- 125 degrees: a 250-degree dial

function dial(x, cx, cy, r, o) {
  // the ink ring first, so everything else sits inside it
  x.beginPath(); x.arc(cx, cy, r, 0, TAU);
  ink(x, C.chromeMid, r * 0.13);

  // bezel: a flat chrome annulus with a hot arc top-left and a dark one below,
  // which is what chrome reduces to in three flat bands at this size
  x.beginPath(); x.arc(cx, cy, r * 0.925, Math.PI * 1.02, Math.PI * 1.85);
  x.strokeStyle = C.chromeHi; x.lineWidth = r * 0.12; x.stroke();
  x.beginPath(); x.arc(cx, cy, r * 0.925, Math.PI * 0.05, Math.PI * 0.72);
  x.strokeStyle = C.chromeLo; x.lineWidth = r * 0.12; x.stroke();

  // face
  const rf = r * 0.855;
  x.beginPath(); x.arc(cx, cy, rf, 0, TAU);
  ink(x, C.face, 3);
  // a sheen across the lower half — the reference faces are not flat black
  x.beginPath(); x.arc(cx, cy, rf * 0.98, Math.PI * 0.12, Math.PI * 0.88);
  x.fillStyle = C.faceLit; x.fill();

  // the red zone
  if (o.red < 1) {
    const a0 = -SWEEP + o.red * 2 * SWEEP, a1 = SWEEP;
    x.beginPath();
    x.arc(cx, cy, rf * 0.80, a0 - Math.PI / 2, a1 - Math.PI / 2);
    x.strokeStyle = C.red; x.lineWidth = rf * 0.13; x.stroke();
  }

  // Graduations. MAJOR ticks are longer, and only every `labelEvery`-th major
  // gets a numeral: SEVEN NUMERALS ROUND A FORTY-PIXEL DIAL OVERLAP EACH OTHER,
  // which the first pass at this duly did — "150" and "200" ran together at the
  // top of the speedo into an unreadable smear. Four numerals read; seven do
  // not, and a dial you cannot read is worse than a dial with fewer numbers.
  const majors = o.majors;
  const minors = o.minors || 1;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `bold ${Math.max(8, Math.round(r * 0.23))}px sans-serif`;
  for (let i = 0; i <= majors * minors; i++) {
    const t = i / (majors * minors);
    const a = -SWEEP + t * 2 * SWEEP;
    const s = Math.sin(a), c = -Math.cos(a);
    const maj = i % minors === 0;
    const r0 = rf * (maj ? 0.70 : 0.80), r1 = rf * 0.93;
    x.beginPath();
    x.moveTo(cx + s * r0, cy + c * r0);
    x.lineTo(cx + s * r1, cy + c * r1);
    x.strokeStyle = C.mark; x.lineWidth = maj ? r * 0.06 : r * 0.03;
    x.lineCap = 'butt'; x.stroke();
    if (maj && o.step && (i / minors) % (o.labelEvery || 1) === 0) {
      const rn = rf * 0.58;
      x.fillStyle = C.mark;
      x.fillText(String((i / minors) * o.step), cx + s * rn, cy + c * rn);
    }
  }
  x.lineCap = 'round';

  // The legend, so the two big dials are not interchangeable at a glance. Only
  // on the big pair — at the sub-dials' radius it came out as four grey pixels
  // of mush, which is worse than nothing because the eye still stops on it.
  //
  // THE TACHO'S LEGEND MOVES ABOVE THE SPINDLE, because the gear numeral wants
  // the lower half and both cannot have it. "RPM" sat at rf*0.50, dead centre
  // of where the numeral goes, and the space left either side of it was 11 art
  // pixels above and 13 below — 19 and 22 on the phone, a footnote rather than
  // a readout. Above the spindle the legend has the same clear air the "2" and
  // "6" graduations have beside it, and the needle crosses it at half revs
  // exactly as it crosses the "4" it now sits under. This is the only mark on
  // the existing dial that moved.
  if (o.label) {
    x.font = `${Math.max(7, Math.round(r * 0.19))}px sans-serif`;
    x.fillStyle = C.trimHi;
    x.fillText(o.label, cx, cy + rf * (o.labelUp ? -0.34 : 0.50));
  }
}

/**
 * The four dials, in one place so they can be drawn TWICE.
 *
 * A left-hand-drive cockpit is this one mirrored, and mirroring a canvas
 * mirrors the writing on it: "KM/H" came out as "H/MX" and 480 as 084. So the
 * instruments are drawn again, the right way round, over the mirrored copy of
 * themselves — same centres, same radii, so the redraw covers the old one
 * exactly. Speedo on the right, tacho on the left, the same way round as a car.
 */
function drawDials(x, W, H, mirrored) {
  const at = (fx) => (mirrored ? 1 - fx : fx) * W;
  dial(x, at(WHEEL_X - DIAL_DX), DIAL_Y * H, DIAL_R * H,
       { majors: 8, minors: 2, step: 1, labelEvery: 2, red: 0.80, label: 'RPM',
         labelUp: true });
  dial(x, at(WHEEL_X + DIAL_DX), DIAL_Y * H, DIAL_R * H,
       { majors: 8, minors: 2, step: DIAL_FULL / 8, labelEvery: 2, red: 0.88,
         label: 'MPH' });
  // Temperature and fuel, out on the dash where the rim clears them.
  dial(x, at(WHEEL_X - SUB_DX), SUB_Y * H, SUB_R * H,
       { majors: 4, minors: 1, red: 0.82 });
  dial(x, at(WHEEL_X + SUB_DX), SUB_Y * H, SUB_R * H,
       { majors: 4, minors: 1, red: 1 });
}

// -------------------------------------------------------------- the dash
//
// Drawn into the ART region, in region pixels, with W x H = 1024 x 427.

function drawDash(x, W, H, o) {
  const rnd = rndFrom(0x51a3);
  const car = o.palette.car ?? 0x79bb35;
  const carDark = o.palette.carDark ?? 0x46702e;
  const GRN = {
    hot: cssMix(car, 0xffffff, 0.52),
    lit: cssMix(car, 0xffffff, 0.22),
    base: cssHex(car),
    mid: cssMix(car, carDark, 0.55),
    deep: cssHex(carDark),
  };

  // ---- the car's own bonnet, beyond the scuttle ---------------------------
  //
  // FIVE FLAT BANDS, hard-edged, spanning the 2.3:1 luminance ratio the art
  // reference measures on the bodywork — and the hot highlight along the crest
  // is 1% of the area and does most of the work, exactly as it does out there.
  const bt = BONNET_TOP;
  const off = (d) => (fx) => bt(fx) + d;
  band(x, W, H, bt, off(0.007), GRN.hot, 0);
  band(x, W, H, off(0.007), off(0.021), GRN.lit, 0);
  band(x, W, H, off(0.021), off(0.042), GRN.base, 0);
  band(x, W, H, off(0.042), off(0.062), GRN.mid, 0);
  band(x, W, H, off(0.062), (fx) => DASH_TOP(fx) + 0.02, GRN.deep, 0);
  // THE WING TOPS ARE DARKER THAN THE CENTRE, and this is the difference
  // between reading as a bonnet and reading as a hedge. A flat green band
  // across the bottom of a windscreen is a field; a band with a lit crown in
  // the middle, two shaded wings either side and a hard panel line between them
  // is the front of a car. It is the same lateral division the modelled bonnet
  // used, for the same reason: paint that runs fore-and-aft is three pixels
  // wide by the time it reaches a visible edge, and paint that runs across is
  // the only paint that survives.
  for (const [a, b] of [[0, 0.30], [0.70, 1]]) {
    x.beginPath();
    for (let i = 0; i <= 8; i++) {
      const fx = a + (b - a) * (i / 8);
      x.lineTo(fx * W, bt(fx) * H);
    }
    for (let i = 8; i >= 0; i--) {
      const fx = a + (b - a) * (i / 8);
      x.lineTo(fx * W, (DASH_TOP(fx) + 0.02) * H);
    }
    x.closePath();
    x.fillStyle = 'rgba(14,32,10,0.42)'; x.fill();
  }
  // the panel line between wing and centre, on each side
  for (const fx of [0.30, 0.70]) {
    x.beginPath();
    x.moveTo(fx * W, bt(fx) * H + 3);
    x.lineTo((fx + (fx < 0.5 ? -0.028 : 0.028)) * W, DASH_TOP(fx) * H);
    x.strokeStyle = 'rgba(8,20,6,0.8)'; x.lineWidth = 4; x.stroke();
  }
  // the crest, inked. This is the line the whole view is judged against.
  curve(x, W, H, bt, 0, 1, INKC, 7);

  // ---- wiper arms ---------------------------------------------------------
  //
  // Lying across the base of the screen, over the bonnet, under nothing. Two
  // arms and two blades, four strokes, and they are the detail that says there
  // is a pane of glass between you and the world.
  //
  // THEY HAVE TO CLEAR THE DASH BY MORE THAN THE DASH'S OWN INK LINE. First
  // pass lifted them 0.028 of the frame and drew them under an eight-pixel ink
  // stroke centred on the scuttle: what survived was a faint kink in that line
  // and nothing else. They are lifted twice as far now, so the arc stands in
  // the green where it can be seen.
  for (const [x0, x1, xc, lift] of [[0.045, 0.520, 0.29, 0.052],
                                    [0.480, 0.945, 0.71, 0.046]]) {
    x.beginPath();
    x.moveTo(x0 * W, (DASH_TOP(x0) - 0.002) * H);
    x.quadraticCurveTo(xc * W, (DASH_TOP(xc) - lift) * H,
                       x1 * W, (DASH_TOP(x1) - 0.002) * H);
    x.strokeStyle = INKC; x.lineWidth = 11; x.lineCap = 'round'; x.stroke();
    x.strokeStyle = C.trimLit; x.lineWidth = 3; x.stroke();
    // the blade, a touch above and thicker
    x.beginPath();
    x.moveTo((x0 + 0.035) * W, (DASH_TOP(x0) - 0.020) * H);
    x.quadraticCurveTo(xc * W, (DASH_TOP(xc) - lift - 0.018) * H,
                       (x1 - 0.035) * W, (DASH_TOP(x1) - 0.020) * H);
    x.strokeStyle = INKC; x.lineWidth = 7; x.stroke();
  }

  // ---- the dashboard itself ----------------------------------------------
  const dt = DASH_TOP;
  const dOff = (d) => (fx) => dt(fx) + d;
  // body, all the way to the bottom of the frame
  band(x, W, H, dt, () => 1.02, C.dashTop, 0);
  // the lit lip along the leading edge: seven pixels of light, and it is what
  // turns the top of a dash from an edge into an edge with a thickness
  band(x, W, H, dt, dOff(0.013), C.dashHi, 0);
  // The knee, where the top surface turns down into the fascia, and then the
  // fascia's own shadow. FOUR FLAT BANDS AND ALL FOUR HAVE TO BE ON SCREEN:
  // the first version put the knee 0.12 below the scuttle and the shadow 0.145
  // below that, which landed at 0.99 of the frame — the darkest tone in the
  // dashboard was one row of pixels along the bottom edge, so the whole dash
  // read as a single flat tan slab. The reference's dash is a lit top over a
  // distinctly darker face and that contrast is most of what makes it look
  // like a surface turning away from you.
  const knee = (fx) => dt(fx) + 0.055 + 0.030 * Math.sin(fx * Math.PI);
  band(x, W, H, knee, () => 1.02, C.dashMid, 0);
  band(x, W, H, (fx) => knee(fx) + 0.105, () => 1.02, C.dashLo, 0);
  band(x, W, H, (fx) => knee(fx) + 0.215, () => 1.02, C.dashDeep, 0);
  curve(x, W, H, knee, 0, 1, 'rgba(20,12,8,0.5)', 4);
  // and the heaviest line in the frame, where the dash cuts across the bonnet
  curve(x, W, H, dt, 0, 1, INKC, 8);

  // ---- passenger side: glovebox lid and a sparkle -------------------------
  //
  // The far end of the dash from this seat, and the only large plain surface in
  // here. A seam and a highlight, because a bare tan plane reads as a mistake.
  x.beginPath();
  x.moveTo(0.022 * W, (dt(0.022) + 0.10) * H);
  x.lineTo(0.185 * W, (dt(0.185) + 0.115) * H);
  x.strokeStyle = 'rgba(12,8,6,0.75)'; x.lineWidth = 3; x.stroke();
  x.beginPath();
  x.moveTo(0.022 * W, (dt(0.022) + 0.26) * H);
  x.lineTo(0.185 * W, (dt(0.185) + 0.275) * H);
  x.stroke();
  // a four-point sparkle, straight out of the reference. Comic shorthand for
  // a polished surface and it costs eight lineTos.
  {
    const sx = 0.072 * W, sy = 0.862 * H, a = 0.030 * H, b = 0.007 * H;
    poly(x, [sx, sy - a, sx + b, sy - b, sx + a * 0.55, sy,
             sx + b, sy + b, sx, sy + a, sx - b, sy + b,
             sx - a * 0.55, sy, sx - b, sy - b]);
    x.fillStyle = 'rgba(255,250,236,0.85)'; x.fill();
  }

  // ---- centre stack, to the driver's LEFT (right-hand drive) --------------
  //
  // A slotted defroster vent on the dash top and a slatted face vent below it.
  // The reference has both; the modelled cockpit had three colour bands on a
  // box because that is all a triangle budget could buy.
  {
    // defroster slots, sunk into the dash top
    // 0.190 to 0.330, and no wider: past that it runs into the boost lamp.
    const vx = 0.190 * W, vw = 0.140 * W;
    const vy = (dt(0.26) + 0.030) * H, vh = 0.050 * H;
    rrect(x, vx, vy, vw, vh, vh * 0.35);
    ink(x, C.dashDeep, 4);
    for (let i = 0; i < 6; i++) {
      const sy = vy + vh * (0.18 + i * 0.135);
      x.beginPath();
      x.moveTo(vx + vw * 0.06, sy);
      x.lineTo(vx + vw * 0.94, sy + vh * 0.05);
      x.strokeStyle = i & 1 ? C.trimDark : C.trim;
      x.lineWidth = 3; x.stroke();
    }
  }
  {
    // the face vent: a chrome-edged box of horizontal slats, the strongest
    // detail on the passenger half and the one that reads at a glance
    const vx = 0.185 * W, vw = 0.245 * W;
    const vy = (dt(0.30) + 0.170) * H, vh = 0.16 * H;
    rrect(x, vx, vy, vw, vh, 10);
    ink(x, C.trimDark, 7);
    rrect(x, vx + 5, vy + 5, vw - 10, vh - 10, 7);
    ink(x, '#15181c', 0);
    for (let i = 0; i < 5; i++) {
      const sy = vy + 12 + i * (vh - 18) / 5;
      x.fillStyle = i & 1 ? C.trim : C.trimLit;
      x.fillRect(vx + 12, sy, vw - 24, Math.max(3, (vh - 18) / 5 - 7));
      x.fillStyle = 'rgba(0,0,0,0.55)';
      x.fillRect(vx + 12, sy + Math.max(3, (vh - 18) / 5 - 7), vw - 24, 3);
    }
    // the divider down the middle, and a chrome surround along the top
    x.fillStyle = C.trimDark;
    x.fillRect(vx + vw * 0.5 - 4, vy + 6, 8, vh - 12);
    x.fillStyle = C.chromeMid;
    x.fillRect(vx + 8, vy + 6, vw - 16, 4);
  }
  {
    // a small radio panel above the vent, with two knobs
    const px = 0.215 * W, pw = 0.185 * W;
    const py = (dt(0.30) + 0.098) * H, ph = 0.052 * H;
    rrect(x, px, py, pw, ph, 6);
    ink(x, C.trimDark, 5);
    x.fillStyle = '#2c4b46';
    x.fillRect(px + pw * 0.30, py + ph * 0.28, pw * 0.40, ph * 0.42);
    for (const kx of [px + pw * 0.14, px + pw * 0.86]) {
      x.beginPath(); x.arc(kx, py + ph * 0.5, ph * 0.26, 0, TAU);
      ink(x, C.chrome, 3);
    }
  }

  // ---- driver's side: door card and a corner vent -------------------------
  {
    // the near end of the dash, wrapping toward the driver's door
    poly(x, [0.905 * W, dt(0.905) * H, W, dt(1) * H, W, 1.02 * H, 0.94 * W, 1.02 * H]);
    ink(x, C.trimDark, 6);
    x.beginPath();
    x.moveTo(0.925 * W, (dt(0.925) + 0.10) * H);
    x.lineTo(W, (dt(1) + 0.09) * H);
    x.strokeStyle = C.trimLit; x.lineWidth = 4; x.stroke();
    // a round eyeball vent on the driver's end
    const ey = 0.848 * H;
    x.beginPath(); x.arc(0.862 * W, ey, 0.055 * H, 0, TAU);
    ink(x, C.trimDark, 6);
    x.beginPath(); x.arc(0.862 * W, ey, 0.036 * H, 0, TAU);
    ink(x, '#15181c', 3);
    for (let i = -1; i <= 1; i++) {
      x.beginPath();
      x.moveTo(0.862 * W - 0.032 * H, ey + i * 0.018 * H);
      x.lineTo(0.862 * W + 0.032 * H, ey + i * 0.018 * H);
      x.strokeStyle = C.trim; x.lineWidth = 3; x.stroke();
    }
    // an ignition barrel, low and near — the sort of thing that is only ever on
    // the driver's side and so says which side that is
    x.beginPath(); x.arc(0.792 * W, 0.965 * H, 0.030 * H, 0, TAU);
    ink(x, C.chromeMid, 4);
  }

  // ---- the binnacle -------------------------------------------------------
  //
  // A hood over the cluster, rising above the scuttle. Two large dials with a
  // smaller one either side, as the reference has them.
  const podL = WHEEL_X - POD_HW, podR = WHEEL_X + POD_HW;
  {
    const hoodTop = 0.655;
    x.beginPath();
    x.moveTo(podL * W, (dt(podL) + 0.06) * H);
    x.bezierCurveTo(podL * W, hoodTop * H, (WHEEL_X - 0.09) * W, hoodTop * H,
                    WHEEL_X * W, hoodTop * H);
    x.bezierCurveTo((WHEEL_X + 0.09) * W, hoodTop * H, podR * W, hoodTop * H,
                    podR * W, (dt(podR) + 0.06) * H);
    x.lineTo(podR * W, 1.02 * H);
    x.lineTo(podL * W, 1.02 * H);
    x.closePath();
    ink(x, '#1b1e23', 8);
    // the hood's own lit lip
    x.beginPath();
    x.moveTo(podL * W + 6, (dt(podL) + 0.055) * H);
    x.bezierCurveTo(podL * W + 6, (hoodTop + 0.012) * H,
                    (WHEEL_X - 0.09) * W, (hoodTop + 0.012) * H,
                    WHEEL_X * W, (hoodTop + 0.012) * H);
    x.bezierCurveTo((WHEEL_X + 0.09) * W, (hoodTop + 0.012) * H,
                    podR * W - 6, (hoodTop + 0.012) * H,
                    podR * W - 6, (dt(podR) + 0.055) * H);
    x.strokeStyle = C.trimLit; x.lineWidth = 4; x.stroke();
  }

  drawDials(x, W, H, false);

  // ---- windscreen header and A-pillars ------------------------------------
  //
  // The eye is level, so the horizon is the middle of the frame and everything
  // above it is sky: cutting the top tenth costs no road at any speed and is
  // most of what makes the shot read as being INSIDE something.
  //
  // THE PILLARS ARE NOT THE SAME WIDTH. The driver is on the right, so the
  // right-hand pillar is the near one and is nearly twice the width of the far
  // one on the left. That asymmetry is free and it is the strongest single cue
  // in the frame that the seat is on one side.
  {
    x.beginPath();
    x.moveTo(-8, -8); x.lineTo(W + 8, -8);
    for (let i = 24; i >= 0; i--) { const fx = i / 24; x.lineTo(fx * W, HDR_BOT(fx) * H); }
    x.closePath();
    ink(x, C.trimDark, 0);
    // THE SEAL ALONG THE LEADING EDGE IS THE MEASURED MID-GREY, #5d6466, which
    // ref/REFERENCE.md puts at 16% of the interior reference and which this
    // cockpit had almost none of. Without it the header is one flat near-black
    // bar, and the ink meter says so: near-black is what it counts.
    band(x, W, H, (fx) => HDR_BOT(fx) - 0.021, HDR_BOT, C.trimLit, 0);
    curve(x, W, H, HDR_BOT, 0, 1, INKC, 8);
    // roof lining stitching, two faint lines
    for (const d of [0.020, 0.036]) {
      curve(x, W, H, (fx) => HDR_BOT(fx) - d, 0.05, 0.95, 'rgba(90,96,102,0.5)', 2);
    }
  }
  //
  // A pillar is WIDER AT ITS BASE than at the header — it leans away from you
  // and thickens into the scuttle — and the first pass had them the other way
  // round, which turned both of them into slivers that read as a bad crop
  // rather than as the sides of a windscreen.
  //
  // AND THEY ARE NOT SOLID BLACK SLABS. Measured: at #33373d the two pillars
  // alone were a quarter of every near-black pixel in the frame and pushed the
  // ink meter to 65.5% against a 48-62% target — while ref/REFERENCE.md's
  // interior spends 16% of its frame on a mid-grey trim tone this cockpit had
  // almost none of. So each pillar is two flat bands: the outboard half in the
  // dark plastic, the inboard half in that measured #5d6466 where it faces the
  // light coming through the screen. That is one fix for two problems.
  for (const [ox, ix0, ix1] of [[0, 0.040, 0.070], [1, 0.940, 0.902]]) {
    const mid0 = ox + (ix0 - ox) * 0.45, mid1 = ox + (ix1 - ox) * 0.45;
    poly(x, [ox * W, HDR_BOT(ox) * H - 20,
             ix0 * W, HDR_BOT(ix0) * H,
             ix1 * W, dt(ix1) * H,
             ox * W, dt(ox) * H]);
    ink(x, C.trimDark, 8);
    poly(x, [mid0 * W, HDR_BOT(mid0) * H,
             ix0 * W, HDR_BOT(ix0) * H,
             ix1 * W, dt(ix1) * H,
             mid1 * W, dt(mid1) * H]);
    ink(x, C.trimLit, 0);
    // and the inboard edge inked, so it is a solid and not a hole
    x.beginPath();
    x.moveTo(ix0 * W, HDR_BOT(ix0) * H);
    x.lineTo(ix1 * W, dt(ix1) * H);
    x.strokeStyle = INKC; x.lineWidth = 8; x.stroke();
  }

  // ---- the rear-view mirror ----------------------------------------------
  //
  // Left of the wheel, because that is where the car's centreline is from this
  // seat. It has the road in it, which is two triangles of paler grey and a
  // dashed line, and it is the second brightest thing in here after the chrome.
  {
    const mx = 0.322 * W, my = HDR_BOT(0.322) * H;
    const mw = 0.150 * W, mh = 0.088 * H;
    // stalk
    poly(x, [mx - 10, my - 6, mx + 10, my - 6, mx + 5, my + 16, mx - 5, my + 16]);
    ink(x, C.trimDark, 5);
    // casing
    rrect(x, mx - mw * 0.5, my + 12, mw, mh, mh * 0.42);
    ink(x, C.trimDark, 7);
    // glass
    rrect(x, mx - mw * 0.5 + 7, my + 18, mw - 14, mh - 12, mh * 0.3);
    ink(x, C.glass, 3);
    x.save();
    rrect(x, mx - mw * 0.5 + 7, my + 18, mw - 14, mh - 12, mh * 0.3);
    x.clip();
    // the road behind, a wedge and a dashed line
    poly(x, [mx - mw * 0.34, my + mh + 8, mx + mw * 0.34, my + mh + 8,
             mx + mw * 0.06, my + 22, mx - mw * 0.06, my + 22]);
    x.fillStyle = '#2b3644'; x.fill();
    x.strokeStyle = C.glassLit; x.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      x.beginPath();
      x.moveTo(mx, my + 24 + i * 9);
      x.lineTo(mx, my + 28 + i * 9);
      x.stroke();
    }
    // sky above the road line
    x.fillStyle = 'rgba(125,139,152,0.45)';
    x.fillRect(mx - mw * 0.5, my + 16, mw, 7);
    x.restore();
    // a hot streak across the glass — a mirror without one is a grey hole
    x.beginPath();
    x.moveTo(mx - mw * 0.42, my + mh * 0.62);
    x.lineTo(mx - mw * 0.10, my + 20);
    x.strokeStyle = 'rgba(220,232,240,0.55)'; x.lineWidth = 5; x.stroke();
  }

  // ---- the pencil, over everything that is painted ------------------------
  pencilPass(x, W, H, rnd, 420, 0.10);
}

// -------------------------------------------------------------- the wheel
//
// Drawn into a square region with the HUB AT ITS CENTRE, so rotating the quad
// about that point rotates the wheel about its axis and nothing else.
//
// THE ANGLES ARE CANVAS ANGLES: y points down, so +90 degrees points DOWN the
// screen. Three spokes at 210, 330 and 90 puts two up at the shoulders and one
// straight down, which is the classic slotted three-spoke and is what the
// reference has. The last attempt at this file wrote 270 for the bottom spoke
// and got one standing straight up through both dials.
function drawWheel(x, S, o) {
  const rnd = rndFrom(0x2f19);
  const cx = S * 0.5, cy = S * 0.5;
  const rOut = S * 0.468;            // outer edge of the rim
  const rIn = S * 0.398;             // inner edge of the rim
  const rBoss = S * 0.105;

  // ---- the rim ------------------------------------------------------------
  // Dark wood, ink either side, and a warm highlight band along the inner edge
  // where the section turns over. That band is what makes a circle read as a
  // tube instead of a hoop.
  x.lineCap = 'butt';           // NOT round: a round-capped arc ends in a blob,
                                // and a blob in the middle of a rim reads as a
                                // chip out of it
  x.beginPath(); x.arc(cx, cy, (rOut + rIn) * 0.5, 0, TAU);
  x.strokeStyle = INKC; x.lineWidth = (rOut - rIn) + 14; x.stroke();
  x.strokeStyle = C.rim; x.lineWidth = (rOut - rIn); x.stroke();
  // the highlight, upper-left, where a comic puts its light
  x.beginPath();
  x.arc(cx, cy, (rOut + rIn) * 0.5 - (rOut - rIn) * 0.24, Math.PI * 1.06, Math.PI * 1.88);
  x.strokeStyle = C.rimHi; x.lineWidth = (rOut - rIn) * 0.34; x.stroke();
  // and the shade, lower-right
  x.beginPath();
  x.arc(cx, cy, (rOut + rIn) * 0.5 + (rOut - rIn) * 0.26, Math.PI * 0.08, Math.PI * 0.76);
  x.strokeStyle = C.rimLo; x.lineWidth = (rOut - rIn) * 0.30; x.stroke();
  x.lineCap = 'round';

  // ---- finger grips -------------------------------------------------------
  //
  // SEVEN LOBES, not seventy beads. Two things went wrong the first time and
  // both are worth writing down, because they are the same mistake at two
  // scales. A previous pass at this file put 120 stitch marks round the rim and
  // turned it into a rope. My own first pass put seventeen dark circles round
  // the bottom and turned it into a string of beads — dark, because they were
  // filled with the rim's SHADOW colour, so they read as holes drilled through
  // the wheel rather than as bulges you could hook a finger behind.
  //
  // A grip is finger-sized against the rim's own thickness, it is the SAME
  // colour as the rim with an ink line round it, and there are as many of them
  // as a hand has fingers. They live on the lower half, which is where hands
  // go; when the wheel is turned they come round the top, which is also what
  // happens to a real one.
  // AND THEY ONLY JUST SHOW. Round the third time: lobes big enough to see
  // clearly were a bicycle chain draped round the bottom of the wheel. What a
  // grip actually is, from the front, is a shallow scallop on the inner edge
  // with a groove between each pair — so that is what is drawn, and the groove
  // does most of the reading.
  for (let i = 0; i < 7; i++) {
    // canvas angles, y down: 25 to 155 degrees is the BOTTOM of the wheel
    const ang = Math.PI * (0.14 + (i / 6) * 0.72);
    const gr = (rOut - rIn) * 0.44;
    const gx = cx + Math.cos(ang) * (rIn + gr * 0.62);
    const gy = cy + Math.sin(ang) * (rIn + gr * 0.62);
    x.beginPath();
    x.arc(gx, gy, gr, 0, TAU);
    ink(x, C.rim, 4);
    x.beginPath();
    x.arc(gx, gy, gr * 0.58, Math.PI * 1.05, Math.PI * 1.85);
    x.strokeStyle = C.rimHi; x.lineWidth = gr * 0.40; x.stroke();
  }
  // the grooves between them
  for (let i = 0; i < 6; i++) {
    const ang = Math.PI * (0.14 + ((i + 0.5) / 6) * 0.72);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    x.beginPath();
    x.moveTo(cx + ca * (rIn - (rOut - rIn) * 0.12), cy + sa * (rIn - (rOut - rIn) * 0.12));
    x.lineTo(cx + ca * (rIn + (rOut - rIn) * 0.55), cy + sa * (rIn + (rOut - rIn) * 0.55));
    x.strokeStyle = 'rgba(10,7,5,0.85)'; x.lineWidth = 5; x.stroke();
  }

  // ---- three spokes -------------------------------------------------------
  //
  // NEARLY HORIZONTAL, NOT AT TEN-AND-TWO, and this is measured rather than
  // chosen. The dials sit inside the arc of this wheel, and a spoke 30 degrees
  // above horizontal passes 0.072 frame-heights from the centre of a dial whose
  // radius is 0.095 — so it cuts both instruments in half, which is exactly
  // what the first pass did. At 16 degrees it passes 0.127 away and grazes the
  // bottom edge of each. The reference's wheel does the same thing for the same
  // reason.
  for (const deg of [196, 344, 90]) {
    const a = (deg * Math.PI) / 180;
    const ca = Math.cos(a), sa = Math.sin(a);
    const nx = -sa, ny = ca;                  // across the spoke
    const w0 = S * 0.066, w1 = S * 0.040;     // wide at the boss, narrow at rim
    const r0 = rBoss * 0.7, r1 = rIn + (rOut - rIn) * 0.45;
    poly(x, [
      cx + ca * r0 + nx * w0, cy + sa * r0 + ny * w0,
      cx + ca * r1 + nx * w1, cy + sa * r1 + ny * w1,
      cx + ca * r1 - nx * w1, cy + sa * r1 - ny * w1,
      cx + ca * r0 - nx * w0, cy + sa * r0 - ny * w0,
    ]);
    ink(x, C.chrome, 8);
    // chrome in flat bands: a hot edge along one side, a dark one along the
    // other. Chrome in this style is three greys with hard edges, not a shine.
    x.beginPath();
    x.moveTo(cx + ca * r0 + nx * w0 * 0.72, cy + sa * r0 + ny * w0 * 0.72);
    x.lineTo(cx + ca * r1 + nx * w1 * 0.66, cy + sa * r1 + ny * w1 * 0.66);
    x.strokeStyle = C.chromeHi; x.lineWidth = S * 0.016; x.stroke();
    x.beginPath();
    x.moveTo(cx + ca * r0 - nx * w0 * 0.74, cy + sa * r0 - ny * w0 * 0.74);
    x.lineTo(cx + ca * r1 - nx * w1 * 0.68, cy + sa * r1 - ny * w1 * 0.68);
    x.strokeStyle = C.chromeLo; x.lineWidth = S * 0.018; x.stroke();
    // THE SLOTS. Three drilled holes down each spoke — the thing that makes a
    // three-spoke wheel look like a three-spoke wheel and not like a Y.
    for (let k = 0; k < 3; k++) {
      const t = 0.30 + k * 0.235;
      const r = r0 + (r1 - r0) * t;
      const hr = (w0 + (w1 - w0) * t) * 0.44;
      x.beginPath(); x.arc(cx + ca * r, cy + sa * r, hr, 0, TAU);
      ink(x, '#101318', 5);
      x.beginPath();
      x.arc(cx + ca * r, cy + sa * r, hr * 0.72, Math.PI * 1.1, Math.PI * 1.8);
      x.strokeStyle = 'rgba(190,198,202,0.55)'; x.lineWidth = 3; x.stroke();
    }
  }

  // ---- the boss -----------------------------------------------------------
  x.beginPath(); x.arc(cx, cy, rBoss, 0, TAU);
  ink(x, C.chrome, 9);
  x.beginPath(); x.arc(cx, cy, rBoss * 0.72, 0, TAU);
  ink(x, '#1a1d22', 5);
  // an emblem: two chevrons, which is a badge at this size and is not a font
  x.strokeStyle = C.chromeHi; x.lineWidth = S * 0.012; x.lineCap = 'round';
  for (const d of [-1, 1]) {
    x.beginPath();
    x.moveTo(cx - rBoss * 0.34, cy + d * rBoss * 0.06 - rBoss * 0.16);
    x.lineTo(cx, cy + d * rBoss * 0.06 + rBoss * 0.14);
    x.lineTo(cx + rBoss * 0.34, cy + d * rBoss * 0.06 - rBoss * 0.16);
    x.stroke();
  }

  pencilPass(x, S, S, rnd, 260, 0.09);
}

// ------------------------------------------------------------- the needle
//
// Drawn pointing UP with its pivot NDL_PIVOT down from the top, so the quad can
// be rotated about that point. The chrome cap is part of the sprite and sits at
// the pivot, so it covers the needle's root at every angle.
function drawNeedle(x, W, H) {
  const cx = W * 0.5, py = NDL_PIVOT;
  poly(x, [cx - W * 0.22, py + 18, cx - W * 0.12, py - NDL_PIVOT + 6,
           cx + W * 0.12, py - NDL_PIVOT + 6, cx + W * 0.22, py + 18]);
  ink(x, C.needle, 3);
  // a lit edge down one side, the same three-band treatment as everything else
  x.beginPath();
  x.moveTo(cx - W * 0.10, py + 14);
  x.lineTo(cx - W * 0.045, py - NDL_PIVOT + 12);
  x.strokeStyle = 'rgba(255,214,170,0.8)'; x.lineWidth = 2; x.stroke();
  // the counterweight and the cap
  x.beginPath(); x.arc(cx, py, W * 0.33, 0, TAU);
  ink(x, C.needleLo, 3);
  x.beginPath(); x.arc(cx, py, W * 0.22, 0, TAU);
  ink(x, C.chrome, 2.5);
  x.beginPath(); x.arc(cx, py, W * 0.10, 0, TAU);
  ink(x, '#1a1d22', 0);
}

// --------------------------------------------------------------- the lamp
//
// A blank white lens with a black bezel, TINTED BY VERTEX COLOUR — so one
// drawing serves the boost amber, the brake red and the dead grey, and changing
// state writes twenty-four floats instead of re-drawing a canvas.
function drawLamp(x, W, H) {
  rrect(x, 6, 6, W - 12, H - 12, H * 0.42);
  ink(x, '#ffffff', 9);
  // a bar across it so an unlit lamp reads as a lamp rather than as a blob
  x.fillStyle = 'rgba(0,0,0,0.45)';
  x.fillRect(W * 0.22, H * 0.44, W * 0.56, H * 0.12);
  x.fillStyle = 'rgba(255,255,255,0.55)';
  x.fillRect(W * 0.22, H * 0.30, W * 0.34, H * 0.10);
}

// -------------------------------------------------------- the gear numerals
//
// SIX CELLS, DRAWN WHITE, so the tint that says "you are labouring" is twelve
// floats of vertex colour rather than a second set of six drawings.
//
// INKED LIKE EVERYTHING ELSE IN HERE. A bare white glyph on a near-black face
// is a web page's idea of a readout; the same glyph with a heavy black line
// round it is the same drawing the dash, the wheel and the vents are made of,
// and it is also what keeps the numeral readable when it goes amber against
// the face's #22262b sheen. Five atlas pixels of ink is 4.6 on the phone,
// which is the file's own silhouette weight of 7 scaled by the 0.91 this
// sprite is minified to.
//
// The font size is deliberately not tuned to hit a cap height: the cell is
// drawn generously and the QUAD is sized at boot from the ink that actually
// landed, which is the only way to be right about a numeral's height without
// trusting a font metric that varies by device.
function drawGearDigits(x) {
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = 'bold 62px sans-serif';
  x.lineJoin = 'round';
  x.lineCap = 'round';
  for (let k = 0; k < DIG_N; k++) {
    const cx = k * DIG_STRIDE + DIG_W * 0.5, cy = DIG_H * 0.5;
    const s = String(k + 1);
    x.strokeStyle = INKC; x.lineWidth = 5;
    x.strokeText(s, cx, cy);
    x.fillStyle = '#ffffff';
    x.fillText(s, cx, cy);
  }
}

// =========================================================================
/**
 * Build the cockpit.
 *
 * @param {object} o
 * @param {Texture} o.pencil   accepted and unused: the pencil is baked in here
 * @param {object}  o.palette  colours, see PAL in main.js
 * @param {number}  o.ink      accepted and unused: the ink is drawn, not hulled
 * @param {number}  o.driverX  driver's seat x in car space; positive = RHD
 * @returns {{ group: Group, update: function, stats: object, atlas: Canvas }}
 */
export function buildCockpit(o = {}) {
  const pal = o.palette || {};
  const DX = o.driverX ?? 0;
  // LEFT-HAND DRIVE FOR FREE. The whole picture is laid out about WHEEL_X,
  // which is right of centre; a negative driverX flips the finished canvas
  // horizontally, which is exactly what a left-hand-drive cockpit is.
  const flip = DX < 0;

  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W; canvas.height = ATLAS_H;
  const g = canvas.getContext('2d');

  const inRegion = (x0, y0, w, h, fn) => {
    g.save();
    g.beginPath(); g.rect(x0, y0, w, h); g.clip();
    g.translate(x0, y0);
    fn(g, w, h);
    g.restore();
  };

  inRegion(ART_X, ART_Y, ART_W, ART_H, (x, w, h) => drawDash(x, w, h, { palette: pal }));
  inRegion(WHL_X, WHL_Y, WHL_S, WHL_S, (x, s) => drawWheel(x, s, {}));
  inRegion(NDL_X, NDL_Y, NDL_W, NDL_H, (x, w, h) => drawNeedle(x, w, h));
  inRegion(LMP_X, LMP_Y, LMP_W, LMP_H, (x, w, h) => drawLamp(x, w, h));
  inRegion(DIG_X, DIG_Y, DIG_N * DIG_STRIDE, DIG_H, (x) => drawGearDigits(x));

  // HOW BIG THE NUMERAL ACTUALLY CAME OUT, read back off the canvas rather
  // than derived from the font size. Cap height is not a fraction of the em box
  // that can be relied on — it is 0.70 in one grotesque and 0.73 in the next,
  // and "sans-serif" resolves to whatever the WebView has — so the one honest
  // way to put a 41-device-pixel numeral on the dial is to measure the drawing
  // and size the quad from it. One 432x64 readback at boot, once.
  //
  // The WHITE is measured, not the ink around it: the ink is a 5px outline that
  // grows the glyph by the same amount whatever the font does, and the height a
  // driver reads is the height of the numeral, not of its shadow.
  let digTop = 0, digBot = DIG_H - 1;
  {
    const d = g.getImageData(DIG_X, DIG_Y, DIG_N * DIG_STRIDE, DIG_H).data;
    const wide = DIG_N * DIG_STRIDE;
    let top = -1, bot = -1;
    for (let y = 0; y < DIG_H; y++) {
      for (let px = 0; px < wide; px++) {
        const i = (y * wide + px) * 4;
        if (d[i + 3] > 128 && d[i] > 160 && d[i + 1] > 160) {
          if (top < 0) top = y;
          bot = y;
          break;
        }
      }
    }
    if (top >= 0) { digTop = top; digBot = bot; }
  }
  const digCap = digBot - digTop + 1;                  // white cap height, atlas px
  const digMid = (digTop + digBot + 1) * 0.5;          // its centre in the cell

  if (flip) {
    // LEFT-HAND DRIVE, and it is three separate jobs rather than one. Mirroring
    // just the painted dash — which is all the first version of this did — left
    // the numerals backwards and left the wheel, the needles and both lamps
    // still sitting over on the right, because those are quads placed in art
    // space and the canvas flip cannot see them. So: mirror the ART region,
    // draw the instruments again the right way round on top, and mirror the
    // quad pivots below. The wheel, needle and lamp SPRITES are unchanged —
    // they are symmetric about their own pivots — and so is the direction the
    // wheel turns, because steering right turns a wheel clockwise in Calais
    // exactly as it does in Coventry.
    const tmp = document.createElement('canvas');
    tmp.width = ART_W; tmp.height = ART_H;
    tmp.getContext('2d').drawImage(canvas, ART_X, ART_Y, ART_W, ART_H, 0, 0, ART_W, ART_H);
    g.save();
    g.beginPath(); g.rect(ART_X, ART_Y, ART_W, ART_H); g.clip();
    g.clearRect(ART_X, ART_Y, ART_W, ART_H);
    g.translate(ART_X + ART_W, ART_Y);
    g.scale(-1, 1);
    g.drawImage(tmp, 0, 0);
    g.restore();
    inRegion(ART_X, ART_Y, ART_W, ART_H, (x, w, h) => drawDials(x, w, h, true));
  }

  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  // SRGB, AND THIS IS NOT A DETAIL. A canvas texture defaults to NoColorSpace,
  // which tells three the pixels are already linear — so the output pass
  // converts them to sRGB a second time and every tone comes out pale. The
  // wood dash rendered as cream and the lime bonnet as a pastel; side by side
  // with the car's own bodywork, which goes through the managed path and comes
  // out right, the two greens did not match. Sampled #ad8756 has to arrive on
  // the screen as #ad8756.
  tex.colorSpace = SRGBColorSpace;
  // MIPMAPS, WITH GUTTERS TO MATCH. The dash is drawn at about 1:1 and would be
  // happier without them, but the needle sprite is minified 1.3x and the lamp
  // 2.6x, and a thin orange line minified without a mip chain crawls while it
  // sweeps. The regions are laid out with at least 21 pixels of clear space
  // between them, which is enough for the third mip level — deeper than
  // anything here ever samples — so no region can bleed into its neighbour.
  tex.generateMipmaps = true;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 1;

  // ------------------------------------------------------- the six quads
  //
  // Index order IS draw order inside a single call, so this list is also the
  // back-to-front order: the dash, then the tell-tales and needles on top of
  // it, then the wheel in front of everything.
  // Each entry is the atlas rectangle the quad is cut from. The two lamps share
  // one drawing and so do the two needles — a needle is a needle, and the tint
  // that tells a boost from a brake is in the vertex colour, not the pixels.
  // THE GEAR NUMERAL GOES IN AT INDEX 1, UNDER EVERYTHING THAT MOVES, and that
  // position is a bug fix rather than tidiness. Appended at the end it would
  // have drawn over the steering wheel: the wheel turns 140 degrees each way,
  // and at 43 degrees of lock a spoke passes straight across the tacho — a
  // numeral floating on top of a spoke is precisely the "web overlay" this is
  // meant not to be. Under the needle for the same reason, so the needle
  // sweeps over the printed face the way it does on a real dial.
  const Q_DASH = 0, Q_GEAR = 1, Q_LAMP_L = 2, Q_LAMP_R = 3;
  const Q_NDL_R = 4, Q_NDL_S = 5, Q_WHEEL = 6;
  const QUADS = [
    [ART_X, ART_Y, ART_W, ART_H],                 // 0 dash, everything static
    [DIG_X, DIG_Y, DIG_W, DIG_H],                 // 1 gear numeral, UVs moved
    [LMP_X, LMP_Y, LMP_W, LMP_H],                 // 2 tell-tale, driver's left
    [LMP_X, LMP_Y, LMP_W, LMP_H],                 // 3 tell-tale, driver's right
    [NDL_X, NDL_Y, NDL_W, NDL_H],                 // 4 tacho needle
    [NDL_X, NDL_Y, NDL_W, NDL_H],                 // 5 speedo needle
    [WHL_X, WHL_Y, WHL_S, WHL_S],                 // 6 the wheel, in front
  ];
  const NQ = QUADS.length;

  // ART-SPACE GEOMETRY, in the same pixels the canvas was drawn in. Rotation
  // happens here, where the axes are square; the conversion to NDC afterwards
  // is the same scale on both axes, so a circle stays a circle.
  //
  // fx2a is where the left-hand-drive flip reaches the quads: every moving
  // part is positioned through it, so mirroring one function mirrors the wheel,
  // both needles and both lamps together.
  // fw2a converts a WIDTH and fx2a a POSITION, and they are not the same
  // function once the flip is in: mirroring a width gives 1 - w, which for a
  // lamp 0.049 of the frame across is most of the dashboard.
  const AW = ART_W, AH = ART_H;
  const fx2a = (f) => (flip ? 1 - f : f) * AW;
  const fw2a = (f) => f * AW, fy2a = (f) => f * AH;

  // Each quad is a pivot plus four corner offsets in art pixels.
  const piv = new Float32Array(NQ * 2);
  const corn = new Float32Array(NQ * 8);
  const setQuad = (i, px, py, ox0, oy0, ox1, oy1) => {
    piv[i * 2] = px; piv[i * 2 + 1] = py;
    const c = i * 8;
    corn[c] = ox0; corn[c + 1] = oy0;         // top-left
    corn[c + 2] = ox1; corn[c + 3] = oy0;     // top-right
    corn[c + 4] = ox1; corn[c + 5] = oy1;     // bottom-right
    corn[c + 6] = ox0; corn[c + 7] = oy1;     // bottom-left
  };

  setQuad(Q_DASH, 0, 0, 0, 0, AW, AH);
  // The gear numeral, in the face of the tacho. Sized from the ink measured
  // above so the white of the numeral is GEAR_CAP_R dial radii tall, and
  // offset so that ink — not the cell it happens to sit in — is centred on
  // GEAR_CY_R below the spindle.
  {
    const dr = DIAL_R * AH;                              // dial radius, art px
    const dScale = (GEAR_CAP_R * dr) / digCap;           // art px per atlas px
    const hw = DIG_W * 0.5 * dScale, hh = DIG_H * 0.5 * dScale;
    const inkOff = (digMid - DIG_H * 0.5) * dScale;      // ink centre off cell centre
    setQuad(Q_GEAR, fx2a(WHEEL_X - DIAL_DX),
            fy2a(DIAL_Y) + GEAR_CY_R * dr - inkOff, -hw, -hh, hw, hh);
  }
  for (const [i, sgn] of [[Q_LAMP_L, -1], [Q_LAMP_R, 1]]) {
    setQuad(i, fx2a(WHEEL_X + sgn * LAMP_DX), fy2a(LAMP_Y),
            -fw2a(LAMP_W_F) * 0.5, -fy2a(LAMP_H_F) * 0.5,
            fw2a(LAMP_W_F) * 0.5, fy2a(LAMP_H_F) * 0.5);
  }
  // The needles. Sprite height NDL_H maps to a needle whose tip reaches 0.80 of
  // the dial radius, which is where the reference's needles stop.
  const ndlLen = DIAL_R * 0.80 * AH;                       // pivot to tip
  const ndlScale = ndlLen / NDL_PIVOT;
  for (const [i, sgn] of [[Q_NDL_R, -1], [Q_NDL_S, 1]]) {
    setQuad(i, fx2a(WHEEL_X + sgn * DIAL_DX), fy2a(DIAL_Y),
            -NDL_W * 0.5 * ndlScale, -NDL_PIVOT * ndlScale,
            NDL_W * 0.5 * ndlScale, (NDL_H - NDL_PIVOT) * ndlScale);
  }
  // The wheel. The sprite's rim sits at 0.468 of its half-width from the
  // centre, so the quad has to be that much bigger than the rim it draws.
  const whlHalf = (WHEEL_R * AH) * (0.5 / 0.468);
  setQuad(Q_WHEEL, fx2a(WHEEL_X), fy2a(WHEEL_Y), -whlHalf, -whlHalf, whlHalf, whlHalf);

  // -------------------------------------------------------------- buffers
  const pos = new Float32Array(NQ * 4 * 3);
  const uv = new Float32Array(NQ * 4 * 2);
  const col = new Float32Array(NQ * 4 * 3).fill(1);
  const idx = new Uint16Array(NQ * 6);
  for (let q = 0; q < NQ; q++) {
    const [ux, uy, uw, uh] = QUADS[q];
    const u0 = ux / ATLAS_W, u1 = (ux + uw) / ATLAS_W;
    const v0 = 1 - uy / ATLAS_H, v1 = 1 - (uy + uh) / ATLAS_H;
    const b = q * 8;
    uv[b] = u0; uv[b + 1] = v0;
    uv[b + 2] = u1; uv[b + 3] = v0;
    uv[b + 4] = u1; uv[b + 5] = v1;
    uv[b + 6] = u0; uv[b + 7] = v1;
    // WOUND BACKWARDS ON PURPOSE, and it took a magenta test material to find
    // out why. The corners are listed top-left, top-right, bottom-right,
    // bottom-left in ART space, where y points DOWN; normalised device
    // coordinates have y pointing UP, so that same order comes out CLOCKWISE on
    // screen, which is a back face, which MeshBasicMaterial culls. The whole
    // cockpit rendered as nothing at all — one draw call, twelve triangles, no
    // pixels — which is indistinguishable from geometry that was never built.
    const i0 = q * 4, i = q * 6;
    idx[i] = i0; idx[i + 1] = i0 + 2; idx[i + 2] = i0 + 1;
    idx[i + 3] = i0; idx[i + 4] = i0 + 3; idx[i + 5] = i0 + 2;
  }

  // ------------------------------------------------------------- the fit
  //
  // Art space to normalised device coordinates. The art is 2.4:1 and a phone is
  // not always, so the picture is scaled to COVER the frame and anchored to the
  // BOTTOM — a squarer screen loses the outer edges of the dash rather than
  // squashing the wheel into an egg, and the dash never floats off the bottom.
  //
  // MAX, NOT MIN, and this was wrong until a 16:9 frame was actually looked at.
  // With min the picture SHRANK to fit inside the frame instead of growing to
  // cover it: on a 1.8:1 viewport the whole cockpit sat in the bottom 75% with
  // a band of bare sky above the roof lining, which reads as the dashboard
  // having come loose. At 2.4:1 both branches give 1, so the only frame the
  // harness photographs was the one frame that could not show the bug.
  const ART_A = ART_W / ART_H;
  let sx = 1, sy = 1, fitFor = -1;
  const setFit = (aspect) => {
    sx = Math.max(1, ART_A / aspect);
    sy = Math.max(1, aspect / ART_A);
    fitFor = aspect;
  };
  setFit(ART_A);

  /** Write one quad's four corners, rotated by `ang`, into the position array. */
  const placeQuad = (q, ang) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    const px = piv[q * 2], py = piv[q * 2 + 1];
    for (let k = 0; k < 4; k++) {
      const ox = corn[q * 8 + k * 2], oy = corn[q * 8 + k * 2 + 1];
      // y points DOWN in art space, so this is a CLOCKWISE rotation on screen,
      // which is what a positive steering input does to a steering wheel.
      const ax = px + ox * c - oy * s;
      const ay = py + ox * s + oy * c;
      const j = (q * 4 + k) * 3;
      pos[j] = 2 * sx * (ax / AW) - sx;
      pos[j + 1] = (2 * sy - 1) - 2 * sy * (ay / AH);
      pos[j + 2] = 0;
    }
  };

  const angles = new Float32Array(NQ);
  const placeAll = () => { for (let q = 0; q < NQ; q++) placeQuad(q, angles[q]); };
  placeAll();

  const posAttr = new BufferAttribute(pos, 3);
  posAttr.setUsage(35048);              // DynamicDraw: the wheel lives here
  const colAttr = new BufferAttribute(col, 3);
  colAttr.setUsage(35048);
  // THE UVs ARE DYNAMIC NOW, for one quad and one reason: the gear numeral is
  // a different cell of the atlas in each gear. Eight floats on a shift and
  // nothing on any other frame — cheaper than the tell-tales, which rewrite
  // twenty-four whenever the brake goes on.
  const uvAttr = new BufferAttribute(uv, 2);
  uvAttr.setUsage(35048);
  const geo = new BufferGeometry();
  geo.setAttribute('position', posAttr);
  geo.setAttribute('uv', uvAttr);
  geo.setAttribute('color', colAttr);
  geo.setIndex(new BufferAttribute(idx, 1));
  geo.boundingSphere = null;

  const mat = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    vertexColors: true,
    depthTest: false,
    depthWrite: false,
    // NO FOG. The overlay is a picture on the glass of the screen, and fogging
    // it would tint the dashboard with the weather.
    fog: false,
  });

  const mesh = new Mesh(geo, mat);
  mesh.name = 'cockpit';
  mesh.frustumCulled = false;
  mesh.renderOrder = 9999;              // last, over everything
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldAutoUpdate = false;   // we own matrixWorld; the parent does not

  // ---------------------------------------------------- pinned to the screen
  //
  // modelViewMatrix is computed as camera.matrixWorldInverse * matrixWorld
  // immediately AFTER onBeforeRender runs, so setting matrixWorld here to
  // camera.matrixWorld * L makes modelViewMatrix come out as exactly L. Choose
  // L to undo the projection at depth D and a vertex written in NDC lands on
  // that NDC, whatever the field of view is doing.
  const D = 1.0;                        // between the near plane (0.5) and the world
  const L = new Matrix4();
  mesh.onBeforeRender = (renderer, scene, camera) => {
    const e = camera.projectionMatrix.elements;
    const m00 = e[0], m11 = e[5];
    if (m00 !== 0 && m11 !== 0) {
      L.set(D / m00, 0, 0, 0,
            0, D / m11, 0, 0,
            0, 0, 1, -D,
            0, 0, 0, 1);
      mesh.matrixWorld.multiplyMatrices(camera.matrixWorld, L);
      // The viewport's aspect ratio, read off the projection rather than off
      // the canvas: it is the number the picture actually has to fit.
      const aspect = m11 / m00;
      if (Math.abs(aspect - fitFor) > 1e-4) {
        setFit(aspect);
        placeAll();
        posAttr.needsUpdate = true;
      }
    }
  };

  const group = new Group();
  group.add(mesh);

  // ------------------------------------------------------------- update
  //
  // Nothing is written unless something actually turned. A car sitting on the
  // start line is exactly the moment a phone has nothing else to do, and a
  // buffer upload for an unchanged buffer still costs the upload.
  const LOCK = 2.45;                    // full lock: 140 degrees of wheel
  const STILL = 2e-4;
  const NEEDLE_SWEEP = SWEEP;           // the dial's own half-sweep, shared

  const LAMP_OFF = new Color(0x3a3f45);
  const LAMP_BOOST = new Color(0xffb648);
  const LAMP_BRAKE = new Color(0xff4a3a);
  const LAMP_SHIFT = new Color(0xff3b2a);

  let needleA = -NEEDLE_SWEEP, needleB = -NEEDLE_SWEEP;
  let lastW = 9, lastA = 9, lastB = 9;
  let lampL = -1, lampR = -1, gearShown = -1, gearLow = -1;

  /** Tint one quad's four corners. The lamps and the gear numeral all work
   *  this way: one white drawing, a colour per state, twelve floats. */
  const paintQuad = (q, c) => {
    for (let k = 0; k < 4; k++) {
      const j = (q * 4 + k) * 3;
      col[j] = c.r; col[j + 1] = c.g; col[j + 2] = c.b;
    }
    colAttr.needsUpdate = true;
  };

  /**
   * Point the gear quad at one of the numerals in the atlas.
   *
   * Clamped to the cells that exist rather than trusting the caller: a garage
   * that sells a seventh ratio one day should show a 6 and not sample the
   * gutter, which at this mip level would be a smear of the lamp lens.
   */
  const setGear = (n) => {
    const k = n < 0 ? 0 : n > DIG_N - 1 ? DIG_N - 1 : n;
    const x0 = DIG_X + k * DIG_STRIDE;
    const u0 = x0 / ATLAS_W, u1 = (x0 + DIG_W) / ATLAS_W;
    const b = Q_GEAR * 8;
    uv[b] = u0; uv[b + 2] = u1; uv[b + 4] = u1; uv[b + 6] = u0;
    uvAttr.needsUpdate = true;
  };

  paintQuad(Q_LAMP_L, LAMP_OFF);
  paintQuad(Q_LAMP_R, LAMP_OFF);
  paintQuad(Q_GEAR, GEAR_LIT);

  /**
   * Called once per frame, before rendering.
   * @param {object} s  or null in third person, where nothing is drawn
   */
  const update = (s) => {
    if (!s) return;

    // Positive steer is to the right, which turns the wheel clockwise.
    const wheel = s.steer * LOCK;

    // THE TACHO IS NO LONGER INVENTED. It used to fake five sweeps out of the
    // fraction of top speed, with a comment saying "there is no gearbox in the
    // physics and there does not need to be one". There is one now, so the
    // needle reads it: main.js hands over the real rev fraction, the needle
    // drops when the player shifts because the divisor changed and the speed
    // did not, and the red zone on the dial face is the redline the limiter
    // actually enforces. A dial that reports the machine beats a dial that
    // performs for you.
    //
    // The idle floor stays. A rev counter reading zero at a standstill is
    // correct for an engine that has stopped and wrong for one that is running.
    const rev = s.rev != null ? 0.10 + s.rev * 0.90
                              : 0.10 + (s.maxSpeed > 0 ? clamp(s.speed / s.maxSpeed, 0, 1) : 0) * 0.90;
    const kmh = clamp((s.speed * MPH) / DIAL_FULL, 0, 1.02);

    const wantA = -NEEDLE_SWEEP + clamp(rev, 0, 1) * 2 * NEEDLE_SWEEP;
    const wantB = -NEEDLE_SWEEP + kmh * 2 * NEEDLE_SWEEP;
    // A needle has mass. A fraction per frame rather than per second, because a
    // needle is cosmetic and tying it to dt would mean passing dt in for it.
    needleA += (wantA - needleA) * 0.28;
    needleB += (wantB - needleB) * 0.22;

    let moved = false;
    if (wheel > lastW + STILL || wheel < lastW - STILL) {
      angles[Q_WHEEL] = wheel; placeQuad(Q_WHEEL, wheel); lastW = wheel; moved = true;
    }
    if (needleA > lastA + STILL || needleA < lastA - STILL) {
      angles[Q_NDL_R] = needleA; placeQuad(Q_NDL_R, needleA); lastA = needleA; moved = true;
    }
    if (needleB > lastB + STILL || needleB < lastB - STILL) {
      angles[Q_NDL_S] = needleB; placeQuad(Q_NDL_S, needleB); lastB = needleB; moved = true;
    }
    if (moved) posAttr.needsUpdate = true;

    // ---- the gear, and whether the engine is happy in it --------------------
    //
    // WHICH NUMERAL, and only when it changes. `gear` is a 0-based index into
    // main.js's GEARS, so the driver's first gear is index 0 and the numeral
    // that has to appear is 1.
    const gear = s.gear != null ? s.gear : 0;
    if (gear !== gearShown) { gearShown = gear; setGear(gear); }
    // AMBER MEANS THE GEAR IS TOO TALL FOR THE REVS. Below POWER_BAND_LO the
    // engine has lost a tenth of its peak torque and the gear below would pull
    // harder; in first there is no gear below, so the numeral stays white
    // however slowly the car is rolling. No word appears anywhere — a number
    // that changes colour is an instrument, and "DOWNSHIFT" in a typeface is a
    // web page that has landed on the windscreen.
    //
    // Latched: once amber, the bar to clear it is the torque peak rather than
    // the edge it crossed, so the state cannot flicker and cannot flash past
    // in a single frame. See POWER_BAND_PEAK.
    const low = (s.rev != null && gear > 0
      && s.rev < (gearLow === 1 ? POWER_BAND_PEAK : POWER_BAND_LO)) ? 1 : 0;
    if (low !== gearLow) { gearLow = low; paintQuad(Q_GEAR, low ? GEAR_LOW : GEAR_LIT); }

    // ---- the tell-tales -----------------------------------------------------
    //
    // TWO LAMPS, TWO JOBS, which is what a pair of lamps is for. They used to
    // be painted as one: boost lit both amber and the brake lit both red, so
    // the second lamp carried no information the first did not. The one on the
    // tacho's side is now the SHIFT LIGHT and the one on the driver's side
    // keeps the brake and the boost — no third lamp, no new drawing, and the
    // pair still mirrors correctly for a left-hand-drive cockpit because both
    // are placed through fx2a.
    //
    // IT LIGHTS WHEN THE NEEDLE ENTERS THE RED THE DIAL ALREADY DRAWS, at 0.80
    // of the sweep, and it is tested against the same displayed rev the needle
    // is driven by — including the 0.10 idle floor — so lamp and needle can
    // never disagree about where the red zone is. In raw engine revs that is
    // 0.778, a shade before main.js's limiter at 0.80: a shift light that
    // warns is worth more than one that reports.
    const shift = rev >= 0.80 ? 1 : 0;
    if (shift !== lampL) { lampL = shift; paintQuad(Q_LAMP_L, shift ? LAMP_SHIFT : LAMP_OFF); }

    const st = s.braking ? 2 : s.boosting ? 1 : 0;
    if (st !== lampR) {
      lampR = st;
      paintQuad(Q_LAMP_R, st === 2 ? LAMP_BRAKE : st === 1 ? LAMP_BOOST : LAMP_OFF);
    }
  };

  return {
    group,
    update,
    atlas: canvas,
    stats: { tris: NQ * 2, calls: 1, verts: NQ * 4 },
  };
}
