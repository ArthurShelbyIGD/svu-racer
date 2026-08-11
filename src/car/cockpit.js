// The car, from inside — DRAWN, not modelled.
//
// INTERFACE NOTE FOR main.js: buildCockpit({ pencil, palette, ink, driverX })
// still returns { group, update, stats }, update() still takes the same
// {speed,maxSpeed,steer,boosting,braking} object or null, and the group is
// still parented to the car and hidden by `group.visible`. Additions only:
// `atlas`, the canvas the cockpit is drawn into, exposed so a harness can
// photograph it, and `stats.q`, the quad indices of every part that moves, for
// the same reason.
//
// AND update() NOW READS `s.boostLeft`, a 0..1 fraction of nitrous remaining.
// It drives the needle of the right-hand sub-dial, which is the nitrous
// contents gauge. UNDEFINED MEANS FULL: the cockpit runs standalone against a
// main.js that has no boost budget yet, and a gauge that read empty because
// nobody had wired it up would be a gauge reporting a bug that is not there.
//
// `setBoostFill` IS GONE, and so is the nitrous bottle it filled. A bottle is
// cargo — it can only ever sit on top of the dash — so the boost control's
// hint is now a TOGGLE SWITCH built into the fascia under the boost lamp, and
// the contents it used to show are a proper gauge in the sub-dial. See THE
// BOOST SWITCH and drawSwitchBat.
//
// AND THIS FILE NOW EXPORTS PEDAL_TOP AND PEDAL_W, which main.js imports. They
// are the live touch regions in the bottom corners and they are also what the
// brake pedal drawn in the left-hand one is placed from — one definition, so
// the picture cannot come adrift from the region it is hinting at. That has
// gone wrong here once already; see the note on them.
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
// free: the whole cockpit is ONE 1024x1216 canvas painted once, shown as
// SIXTEEN screen-space quads in a single draw call, thirty-two triangles.
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
// THE RACE CLOCK AND THE COUNTDOWN ARE THE SAME TRICK, four places and one
// glyph. The radio's green display shows the lap time as four seven-segment
// quads reading a strip of ten cells, and the countdown across the dash top is
// one quad reading a strip of four — 3, 2, 1 and GO. A clock that ran a
// fillText would repaint and re-upload a 1024x1216 canvas ten times a second,
// which is the one thing this file exists not to do. See THE RACE READOUT.
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
//   and now  1 draw call, 26 triangles. The race readout — a four-place clock
//            on the radio, the BEST tag beside it and the countdown across the
//            dash top — added six quads and TWELVE triangles and, again, no
//            draw call, because every one of them is cut from the atlas that
//            was already bound. Measured on the grid at 1440x720 with
//            tools/racedash.mjs: 9 calls and 46,076 triangles for the whole
//            game against 9 and 46,064 before, in every race state there is.
//
//   and now  1 draw call, 32 triangles. The brake pedal, the nitrous bottle
//            and the liquid in it are three more quads and SIX more triangles,
//            and again no draw call, because they are cut from the atlas that
//            was already bound. Measured at 1440x720 with tools/pedalshots.mjs
//            on the grid: 11 calls and 46,344 triangles for the whole game
//            against 11 and 46,338 before, in both states of both controls.
//            They replaced two HTML divs, so the page also composites one
//            fewer layer than it did.
//
//            Per frame: a press or a release is EIGHT floats, a UV move to the
//            cell next door, and the bottle's liquid takes twelve more when it
//            lights. Nothing on any frame where neither changes, which is
//            almost all of them, and nothing is drawn, uploaded or allocated
//            at any point — both pressed pictures were painted at boot.
//
//   and now  1 draw call, 32 triangles — THE SAME 32. The bottle and its
//            liquid went out (two quads, four triangles) and the boost
//            switch's bat handle and the nitrous gauge's needle came in (two
//            quads, four triangles), so the dashboard gained a piece of
//            hardware and an instrument for nothing at all. The switch's
//            escutcheon plate is painted into the dash region and costs no
//            quad whatever, because it never moves; the gauge's face, scale
//            and red zone are painted into the dash for the same reason. What
//            moves is one bat and one needle. Measured at 1440x720 with
//            tools/dashcount.mjs on the grid: 11 calls and 46,344 triangles
//            for the whole game, against 11 and 46,344 before.
//
//            Per frame: flipping the switch is EIGHT floats, a UV move to the
//            cell next door, exactly as the pedal's press is. The gauge needle
//            is sixteen floats on any frame the level changes and nothing at
//            all when it is settled, exactly as the other two needles are.
//            Nothing is drawn, uploaded or allocated on any frame.
//
//            Per frame it is cheaper than the gear numeral was: eight floats
//            when the tenths digit rolls over, ten times a second, and nothing
//            whatever on the other fifty frames. No string is built, no canvas
//            is touched and nothing is allocated — the time is split into
//            places with integer arithmetic and each place is a UV move.
//
// Both measured with the scene frozen and the cockpit toggled, so the numbers
// are the cockpit's own and not the road's.
//
// The price is texture memory: 1024x1216 RGBA with mipmaps is about 6.6MB —
// 5.2MB of it the dashboard's, and 1.4MB the band of control cells added along
// the bottom. That is the whole cost of all of this, and it buys back 1,236
// triangles and a draw call on a PowerVR GE8320 that has neither to spare.

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
const ATLAS_W = 1024, ATLAS_H = 1216;
const ART_X = 0, ART_Y = 0, ART_W = 1024, ART_H = 427;
const WHL_X = 0, WHL_Y = 448, WHL_S = 512;      // the wheel, hub at its centre
const NDL_X = 536, NDL_Y = 448, NDL_W = 32, NDL_H = 128;
const NDL_PIVOT = 100;                          // pivot this far down the sprite
// A SECOND, SMALLER NEEDLE, for the sub-dial the nitrous gauge lives in.
//
// It is the same drawing — drawNeedle takes its pivot as an argument now — in
// a smaller cell, and that is a sharpness fix rather than a style choice. The
// sub-dial's radius is half the big pair's, so a needle cut from the 32x128
// cell would arrive on the glass minified 6.1x: two mip levels down, which is
// a pale orange smear with no ink line left on it. At 20x76 it is minified
// 3.4x, which is what the big dials' needles already survive.
const NDS_X = 456, NDS_Y = 984, NDS_W = 20, NDS_H = 76;
const NDS_PIVOT = 58;
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
// that is already megabytes and means a six-speed box needs no atlas change.
//
// Placed at x 592 — 80px clear of the wheel, 24 of the needle — and y 616, 40
// below the needle's cell and 104 below the lamp's, so the mip chain has the
// same clear gutter every other region here has. The strip ends at x 1000 and
// y 680, both inside the atlas.
const DIG_X = 592, DIG_Y = 616, DIG_W = 48, DIG_H = 64;
const DIG_STRIDE = 72, DIG_N = 6;

// THE CLOCK'S SEVEN-SEGMENT DIGITS, ten cells, drawn at boot.
//
// Same trick as the gear numeral and for the same reason — the dash canvas is
// painted once — but four quads share the strip instead of one, because a
// clock has four places that change and a gearbox has one. See the arithmetic
// under THE RACE READOUT below for what that costs.
//
// DRAWN AS SEGMENTS, NOT SET IN A TYPEFACE. The readout is 129 x 16 device
// pixels of green glass on a car radio; a sans-serif digit shrunk into 13 of
// those pixels is a web page's idea of a clock, and it is also mush. Seven
// bars with mitred ends are what that panel actually contains, they are drawn
// from rectangles so nothing depends on what "sans-serif" resolves to on the
// device, and each cell carries the six UNLIT bars as well — the ghost of the
// figure eight that a real LCD shows behind whatever it is displaying.
//
// THE CELL IS 16 ATLAS PIXELS TALL FOR A 13.5-PIXEL DIGIT — very nearly 1:1 on
// the owner's phone, so the segments land on pixels rather than being
// resampled. Everything else in this atlas is drawn in ART pixels and arrives
// magnified 1.686x at 1440x720; that is fine for a dashboard and hopeless for
// a 2-pixel bar, which is why this one region is sized in device pixels.
const SEG_X = 540, SEG_Y = 704, SEG_W = 10, SEG_H = 16;
const SEG_STRIDE = 24, SEG_N = 10;
// The BEST tag, the one word in the display. Lit when the number on the glass
// is a personal best rather than the clock, unlit — the dark green a dead LCD
// segment is — when it is the clock. One drawing, two tints, twelve floats.
const TAG_X = 540, TAG_Y = 748, TAG_W = 40, TAG_H = 12;
// THE COUNTDOWN, four cells: 3, 2, 1 and GO.
//
// ONE QUAD SHOWS ALL FOUR. They are different pictures and different shapes —
// GO is twice as wide as a numeral — so the quad's UVs AND its corners are
// rewritten on each change: sixteen floats, four times, in the three seconds
// before a race, and nothing at all for the rest of the run.
//
// DRAWN IN ART PIXELS, NOT DEVICE PIXELS, unlike the clock digits above. At
// the size these appear a cell drawn 1:1 with the panel would be 240 pixels
// square and the four of them would not fit in the atlas without growing it by
// a megabyte, for a picture that is on screen for three seconds. Magnified
// 1.686x they are exactly as sharp as the dashboard they stand on, which is
// the only standard that matters here — the softness is shared with every
// other line in the frame rather than being a property of this one.
const CD_X = 540, CD_Y = 786, CD_W = 130, CD_H = 150, CD_STRIDE = 146, CD_N = 3;
const GO_X = 750, GO_Y = 450, GO_W = 260, GO_H = 144;

// ----------------------------------------------- THE BRAKE PEDAL, IN THE CORNER
//
// A DRILLED ALLOY PEDAL, replacing an HTML div that said BRAKE in 12px grey at
// 19% opacity. It is drawn here, in the atlas, for the reason everything else
// in this file is: a word in a typeface floating over a windscreen is a web
// page, and one more quad cut from a texture that is already bound costs no
// draw call at all.
//
// TWO CELLS: up and pressed. The press is a UV MOVE — the same trick the gear
// numeral uses — so a thumb going down writes eight floats and touches no
// canvas. Both cells come out of ONE function with a `press` argument, so the
// pressed pedal cannot drift away from the raised one the way two hand-drawn
// pictures would.
//
// THERE WAS A NITROUS BOTTLE IN THE OTHER CORNER AND IT HAS GONE. The reason
// is the owner's and it is a better one than the reason it was drawn: a bottle
// is CARGO. Wherever you put it, it is a thing that has been set down on top
// of the dashboard, and no amount of ink makes it part of the car. Its two
// jobs are now done by two pieces of the car itself — a toggle switch built
// into the fascia says whether boost is on, and the sub-dial that was
// decorative says how much is left. Its cells, at x 332..546 in this band,
// are what the switch's bat handle and the gauge's needle are drawn in.
//
// THE PEDAL IS DRAWN AT ROUGHLY 1:1 WITH THE OWNER'S SCREEN, unlike the dash,
// and that is measured rather than chosen. The wheel's 512px sprite lands on a
// 531-device-pixel quad at 1440x720 — 1.04 device pixels per atlas pixel — so
// the wheel is already drawn at 1:1 and its spokes' ink weights (8 for the
// silhouette, 5 round a drilling) are ALSO their weights on the glass. These
// cells are sized to land at 141x201 device pixels on the same screen, so the
// same numbers give the same line, and the pedal reads as a part off the same
// car rather than as a sticker with its own ink.
//
// PLACED IN THE ATLAS below the wheel, whose region ends at y 960: 24 pixels of
// gutter, and 22 between cells, against the 21 the deepest mip level this
// texture ever samples needs. The band ends at y 1184 inside a 1216-tall atlas.
const PED_X = 8, PED_Y = 984, PED_W = 140, PED_H = 200, PED_STRIDE = 162;
// THE BOOST SWITCH'S BAT HANDLE, two cells: up (idle) and down (boosting).
//
// ONLY THE BAT IS A SPRITE. The escutcheon plate it is screwed to and the
// chrome bezel it comes through are painted into the dash region with the
// vents and the ignition barrel, because they are as fixed as those are. What
// a switch DOES is move one small part, so one small part is what has a quad,
// and flipping it is the same eight floats the pedal's press is.
//
// 40x100 FOR A QUAD THAT LANDS AT 20x49 ART PIXELS, so the bat arrives minified
// 2.04x — the same treatment the lamp lens gets at 2.56x. Drawn at art scale it
// would be eleven pixels wide, and an ink line heavy enough to match the dash
// would be most of those eleven. The ink weights in the cell are therefore
// roughly twice the file's usual ones, which is what lands the file's usual
// weight on the glass.
const SWH_X = 332, SWH_Y = 984, SWH_W = 40, SWH_H = 100, SWH_STRIDE = 62;

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
/**
 * THE TOPMOST INK ON THE WHEEL, in frame heights — derived from the three
 * numbers that place and size it, not read off a picture.
 *
 * The rim's outer edge is at WHEEL_Y - WHEEL_R. The ink round it is stroked
 * (rOut - rIn) + 14 wide on a centreline halfway between them, so it reaches 7
 * SPRITE pixels beyond that edge; the sprite stands 2 * WHEEL_R / 0.936 frame
 * heights tall, because drawWheel puts rOut at 0.468 of the sprite's WIDTH,
 * which is 0.936 of its half-width. So seven sprite pixels are
 * (7 / WHL_S) * that height of frame.
 *
 * THIS IS WHAT THE COUNTDOWN HAS TO CLEAR, and it is the rim's INK rather than
 * the rim. Clearing the painted circle and not the black line round it is a
 * seven-pixel error in the one measurement the owner asked for.
 */
const WHEEL_INK_TOP = WHEEL_Y - WHEEL_R - (7 / WHL_S) * (2 * WHEEL_R / 0.936);

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

/**
 * THE TACHO'S FULL SCALE, in rpm, set once by buildCockpit from the engine.
 *
 * Module-level and mutable, which is not how anything else here works and is
 * deliberate: the dial face is DRAWN ONCE into the atlas at build time, by a
 * chain of drawing functions that are called for their side effects on a canvas
 * and take no state object. Threading one number down through drawDash and
 * drawCockpitArt to reach drawDials would touch four signatures to deliver a
 * constant that never changes after boot. Written exactly once, before any
 * drawing happens; read twice, by the two drawDials calls.
 */
let TACHO_FULL = 8000;

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

// ------------------------------------------------------ THE RACE READOUT
//
// TWO PLACES, AND NEITHER OF THEM IS A CORNER OF THE SCREEN.
//
// 1. THE LAP TIME GOES IN THE RADIO. The car already has a display in it: the
//    green glass on the panel above the centre vent, which this file has drawn
//    since the dash was first painted and which said nothing. It is 129 x 16
//    DEVICE PIXELS at 1440x720 — measured off a frame with tools/lcdbox.mjs,
//    not derived, and the brief's 107 was 22 pixels short. Too small for a
//    word and exactly the size of `0:00.0`, which is what a radio-shaped
//    readout is for. Nothing new is added to the dashboard: a panel that was
//    already there is switched on.
//
// 2. THE COUNTDOWN GOES ACROSS THE DASH TOP, standing on the scuttle. It is
//    the biggest thing in the frame for three seconds and it is never seen
//    again, so it costs nothing on any frame that matters. See CD_CAP.
//
// WHAT THE WHOLE READOUT COSTS. Six new quads — four clock digits, the BEST
// tag and the countdown — so twelve triangles on top of the fourteen this file
// had, and NOT ONE NEW DRAW CALL: every cell of it is cut from the same atlas
// and drawn by the same material as the wheel and the dials.
//
// Per frame, while racing: the tenths digit changes ten times a second and
// writes eight floats when it does; the seconds change once a second; the
// minutes and the tag change essentially never. Nothing is drawn, uploaded or
// allocated — there is no string, no toFixed and no fillText anywhere below,
// because a clock formatted with a template literal allocates sixty strings a
// second and this runs on a phone with a shared 2GB.
const RADIO_FX = 0.215, RADIO_FW = 0.185;         // the panel, frame widths
const RADIO_DY = 0.098, RADIO_FH = 0.052;         // below DASH_TOP(0.30)
// The glass, hoisted out of drawDash so the digits that stand on it are placed
// from the same four numbers that paint it. Changing the panel moves both.
const LCD_FX = RADIO_FX + RADIO_FW * 0.30;
const LCD_FW = RADIO_FW * 0.40;                   // 0.074 frame widths, 129 device px
const LCD_FY = DASH_TOP(0.30) + RADIO_DY + RADIO_FH * 0.28;
const LCD_FH = RADIO_FH * 0.42;                   // 0.0218 frame heights, 16 device px
/**
 * THE READOUT'S LAYOUT, ALL OF IT IN FRACTIONS OF THE GLASS IT SITS ON, so the
 * one measurement the whole thing depends on is the size of that glass.
 *
 * MEASURED BEFORE IT WAS COMMITTED TO, because the brief said to and because
 * this project has shipped a fit test that checked one screen edge and not the
 * other. At 1440x720 the glass is 129 x 16 device pixels and the readout works
 * out at:
 *
 *   digit    13.5 px tall, 8.4 wide, on 2.0-pixel segments
 *   number   `0:00.0`, six glyphs, 61 px wide — right-aligned, ending 4 px
 *            short of the right-hand edge
 *   BEST     30 x 9 px, hard against the left-hand edge
 *   between  27 px of bare green, which is what a radio display looks like
 *
 * 61 + 30 = 91 of 129, so the two ends of the readout cannot collide however
 * the panel is resized; tools/racedash.mjs re-measures both ends on the real
 * frame rather than trusting this comment.
 */
const LCD_DIG_H = 0.845;        // digit height, fraction of the glass's height
const LCD_DIG_AR = 0.62;        // and its width, fraction of its own height
const LCD_SEG_T = 0.15;         // segment thickness, same units
const LCD_GAP = 0.52;           // between glyphs, fraction of a digit's width
const LCD_COLON_W = 0.40, LCD_POINT_W = 0.34;
const LCD_PAD = 0.035;          // clear at each end, fraction of the glass
const LCD_TAG_H = 0.58;         // the BEST tag, fraction of the glass's height
// The lit green and the dead green. Both are tints on one white drawing, the
// way the lamps and the gear numeral work, so a digit that is off costs twelve
// floats rather than a second set of ten cells.
const LCD_LIT = new Color(0x8af2b4);
const LCD_DIM = new Color(0x39605a);

/**
 * THE COUNTDOWN, AND WHY IT IS A NUMERAL AND NOT A ROW OF LIGHTS.
 *
 * BOTH WERE BUILT AND BOTH WERE PHOTOGRAPHED, and the lights lost on geometry
 * rather than on taste. shots/rd-lights-3.png and rd-lights-1.png are a
 * five-lamp start tree laid across the dash top at 1440x720, evenly spaced at
 * 0.17 to 0.83 of the frame; the wheel's rim covers x 601..1097 at the height
 * that row has to sit at, so lamps three and four land on the rim and the
 * binnacle. Drawn in front they are two stickers on a steering wheel; drawn
 * behind, the row is three lamps and a hole. And with only one lamp lit at the
 * top of the count — shots/rd-lights-3.png — the whole countdown is one red
 * pill 70 pixels wide at the far left of the dash, which is a tell-tale and
 * not a start signal.
 *
 * The numeral has ONE thing to place rather than five, so it can stand in the
 * one clear space the dash top has.
 *
 * WHERE IT STANDS, AND WHY IT MOVED.
 *
 * It used to stand with its FEET ON THE SCUTTLE, sunk 0.006 of the frame into
 * the dashboard at DASH_TOP(0.5) — deliberately, so that the wheel's rim
 * crossed the foot of the glyph and the numeral read as a thing IN the car
 * rather than a picture on the screen. Both draw orders were photographed
 * before that was chosen and the reasoning was not silly.
 *
 * THE OWNER OVERRULED IT AND HE IS RIGHT. "The graphic countdown is in the
 * wrong position as the steering wheel sits on top of the lower portion of
 * it." A countdown exists to be read in the second it is on screen, by someone
 * who is about to be busy; a rim across the base of a 3 costs six device pixels
 * of its face — tools/cdcap.mjs measured exactly that, 190 against 196 — and
 * costs rather more of the reading. Belonging to the car is worth something.
 * Being legible is what the thing is FOR, and when the two disagree the job
 * wins.
 *
 * SO IT IS LIFTED CLEAR, AND CLEAR IS DEFINED AGAINST THE WHEEL RATHER THAN
 * AGAINST A NUMBER SOMEBODY LIKED. The foot of the glyph — the lowest pixel it
 * puts on the glass, including the ink outline and the cast shadow, not just
 * the coloured face — sits CD_CLEAR of the frame's height above WHEEL_INK_TOP,
 * which is the topmost ink on the steering wheel. Retune the wheel and the
 * countdown follows it; there is no second copy of the geometry.
 *
 * MEASURED AGAINST THE WHEEL'S APEX, NOT AGAINST THE RIM BESIDE THE GLYPH. At
 * the glyph's own x the rim has already fallen away to 0.676 of the frame, so
 * clearing the apex at 0.650 is stricter than it needs to be by about 19 device
 * pixels. That is the right way round: "fully clear of the wheel" should mean
 * no part of the wheel reaches the glyph's foot, and a clearance defined
 * against the nearest bit of rim would go wrong the day the glyph gets wider.
 *
 * It now stands in the band of the car's own bonnet, above the wiper arms and
 * below the crest, with the road behind it. Not standing on the dashboard any
 * more — but during a countdown the picture behind it is a road the car is not
 * yet allowed to drive down, so there is nothing there for it to obscure.
 *
 * CAP HEIGHT 0.275 OF THE FRAME is 198 device pixels on the owner's phone,
 * against 137 for a dial and 37 for the gear numeral. The largest thing in the
 * frame, as the brief asks, and gone after three seconds. It did not shrink to
 * make room: there is 232 device pixels of windscreen above it.
 *
 * MEASURED, by tools/cdclear.mjs, off the frames rather than off this constant.
 */
const CD_FX = 0.5;              // frame widths: the centre of the picture
const CD_CAP = 0.275;           // cap height, frame heights
const CD_CLEAR = 0.030;         // clear air under the glyph's ink, frame heights
const CD_HOLD = 0.7;            // how long GO stays up once the lights go out
// Amber for the count and green for GO, which is the only pair of colours a
// driver does not have to be taught. Both are tints on the white drawing.
const CD_WAIT = new Color(0xffae2e);
const CD_GO = new Color(0x7bf05a);

// ------------------------------------------------------- THE BOOST SWITCH
/**
 * A TOGGLE SWITCH IN THE FASCIA, WHICH IS THE OWNER'S DESIGN AND HIS WORDS:
 *
 *   "We already have a light that switches on and off so we could have a black
 *    or silver toggle type switch directly underneath and center to this light.
 *    Part of the dash of the cockpit, switch in the up position when not in use
 *    and in the down position when boosted."
 *
 * WHY IT BEATS THE BOTTLE IT REPLACES, in one line: a switch is DASH HARDWARE
 * and belongs by construction, where a bottle is cargo and can only ever be
 * sitting on top of the dashboard. Everything the bottle needed — a cold colour
 * nothing else in the car had, a halo, a place in a screen-pinned corner — was
 * work spent making a foreign object look less foreign. A switch needs none of
 * it: it is screwed to the fascia in art space, it is painted in the chrome the
 * wheel's spokes and the brake pedal are painted in, and it moves the way the
 * thing it is a picture of moves.
 *
 * DIRECTLY UNDERNEATH AND CENTRED ON THE LAMP, and that is by CONSTRUCTION and
 * not by a number that happens to line up: SW_DX is LAMP_DX, so the plate and
 * the lamp share the one constant and cannot come apart. Move the lamp and the
 * switch follows it, on either side of the car, because both go through fx2a.
 *
 * AND IT IS BELOW THE KNEE, ON THE VERTICAL FASCIA. The lamp is flat on the
 * dash TOP, where a tell-tale goes; the dash turns down into its face at
 * knee(0.78) = 0.815 of the frame, and a switch goes on the face, where a hand
 * reaches it. The plate's top edge is 0.014 of the frame below that line, so it
 * is plainly on the face and not straddling the fold.
 *
 * THERE IS NO LEGEND ENGRAVED ON IT, and that is the same rule the nitrous
 * bottle's label followed: four letters in twenty device pixels is mush. What
 * says what this switch does is the lamp immediately above it, which is now
 * boost and nothing else — see the tell-tales in update().
 */
const SW_DX = LAMP_DX;           // THE lamp's offset, not a copy of its value
const SW_Y = 0.862;              // frame heights: on the fascia, below the knee
const SW_W_F = 0.033;            // the escutcheon plate, frame widths
const SW_H_F = 0.066;            // ...and frame heights
// The bat handle's quad, which spans BOTH positions: the cell is the union of
// up and down, so one placement shows either and flipping is a UV move.
const SW_BAT_W_F = 0.0192;       // frame widths
const SW_BAT_H_F = 0.1150;       // frame heights

// --------------------------------------------- WHERE THE BRAKE PEDAL SITS
/**
 * THE LIVE REGION. These two numbers ARE the brake and the boost: main.js's
 * touch handler calls a touch a brake when it lands below PEDAL_TOP of the
 * height and inside PEDAL_W of the width on the left, and a boost when it does
 * the same on the right. Forty percent of the width and forty-five percent of
 * the height, per corner, deliberately generous — Anthony: "generous amount of
 * space around them so just touching the screen anywhere close enough will
 * work." A thumb on a phone on a bumpy train does not hit a target.
 *
 * THEY LIVE IN THIS FILE SO THAT THERE IS ONE OF THEM. There is history: the
 * hint used to be a CSS box of 33% by 40% while the hit test used the whole
 * left or right HALF of the screen — a label describing a different shape from
 * the thing it labelled. That was fixed by sizing the div from these constants
 * at boot; drawing the hint in here would have reopened it, because the art
 * would have been positioned by numbers in one file and the touch tested by
 * numbers in another. main.js imports them from here instead, so the pedal is
 * placed by the SAME two constants that decide what a touch does, and the art
 * cannot drift from the region however either is changed.
 *
 * THE ARTWORK IS A HINT INSIDE THE REGION AND IS NEVER THE TARGET. Nothing
 * below shrinks anything: the mesh takes no input at all — it is a picture on
 * a screen-space quad in a scene, with no hit test of any kind — and the region
 * stays exactly as wide as these two numbers say. tools/controls.mjs drives the
 * real page with real touches at real coordinates and is the proof.
 */
export const PEDAL_TOP = 0.55;   // touches below this fraction of the height are pedals
export const PEDAL_W = 0.40;     // ...and within this fraction of the width, per side
/**
 * AND WHERE IN THAT REGION THE PICTURE GOES — all three in fractions OF THE
 * REGION, never of the screen, so the hint moves and scales with the touch area
 * if the touch area is ever retuned.
 *
 * OUTBOARD AND LOW, at a fifth of the way in from the screen's edge rather than
 * in the middle of the region, and that is measured against the dashboard this
 * has to sit on. The middle of the left region at 1440x720 is x 288, which is
 * on top of the radio panel and its lap clock. A fifth of the way in is bare
 * dash, and it is also where a thumb actually rests on a phone held in two
 * hands.
 *
 * ONLY THE BRAKE USES THIS NOW. The nitrous bottle used the mirror of it in the
 * right-hand corner and has been replaced by a switch in the fascia, which is
 * placed in art space with the rest of the dashboard. `put` is still written to
 * take a corner rather than hard-coding the left one, because the region it is
 * derived from is still symmetric and a second screen-pinned hint would go
 * here; nothing else about the touch handling changed.
 *
 * 0.60 OF THE REGION'S HEIGHT is 194 device pixels on the owner's phone, a
 * little over half the height of the dashboard and about the size of the
 * countdown numeral. Big enough to be a picture of something, and nowhere near
 * big enough to be mistaken for the region it is standing in.
 */
const CTL_HF = 0.60;             // the control's height, fraction of the region's
const CTL_CXF = 0.19;            // its centre, fraction of the region's width from the edge
const CTL_CYF = 0.63;            // its centre, fraction of the region's height below the top
/**
 * WHERE THE NITROUS CONTENTS GAUGE GOES, in the owner's words again:
 *
 *   "This just leaves a gauge for nitrous 'contents' and we have a dial already
 *    there just to the right of the steering wheel."
 *
 * There are two small auxiliary dials flanking the big pair and both were
 * decoration — four graduations and a red zone and nothing pointing at them.
 * The RIGHT-HAND one, at WHEEL_X + SUB_DX, is now the contents gauge: same
 * chrome bezel, same near-black face, same white graduations and the same
 * orange needle as the speedo and the tacho, because a fourth instrument that
 * is drawn in a fourth language is a sticker.
 *
 * THE RED ZONE IS AT THE EMPTY END, which is the one thing that differs from
 * the big pair and the whole reason dial() grew a `redLo`. A red zone at the
 * top of a rev counter means "past here you break it"; on a contents gauge the
 * end you must not reach is the bottom, exactly as it is on a fuel gauge.
 *
 * NOS_RED IS 0.15 OF THE SWEEP because that is roughly where a boost that is
 * worth using stops being available: below a sixth of a bottle there is not
 * enough left to pull a car past anything.
 */
const NOS_RED = 0.15;            // red from empty to here, fraction of the sweep
const NOS_SMOOTH = 0.20;         // the needle has mass, same as the other two

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

/**
 * A DRILLED HOLE THROUGH A CHROME PART, and there is exactly one of these in
 * the file so that the wheel's spokes and the brake pedal cannot disagree
 * about what a drilling looks like.
 *
 * Near-black inside with the file's panel-break ink round it, and a bright arc
 * across the TOP INSIDE EDGE — which is the whole trick: light coming through
 * the windscreen catches the far wall of the hole, and without that arc a
 * drilled plate is a plate with black spots on it. The angles are canvas
 * angles, so 1.1PI to 1.8PI is the upper edge.
 */
function drillHole(x, cx, cy, r) {
  x.beginPath(); x.arc(cx, cy, r, 0, TAU);
  ink(x, '#101318', 5);
  x.beginPath(); x.arc(cx, cy, r * 0.72, Math.PI * 1.1, Math.PI * 1.8);
  x.strokeStyle = 'rgba(190,198,202,0.55)'; x.lineWidth = 3; x.stroke();
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

  // the red zone at the TOP of the scale — a redline, or a boiling engine
  if (o.red < 1) {
    const a0 = -SWEEP + o.red * 2 * SWEEP, a1 = SWEEP;
    x.beginPath();
    x.arc(cx, cy, rf * 0.80, a0 - Math.PI / 2, a1 - Math.PI / 2);
    x.strokeStyle = C.red; x.lineWidth = rf * 0.13; x.stroke();
  }
  // AND THE RED ZONE AT THE BOTTOM OF THE SCALE, which is what a CONTENTS gauge
  // needs and no other instrument in this cockpit does. Drawn on the same arc,
  // in the same red, at the same weight — the gauge is not a new kind of dial,
  // it is this dial with the danger at the other end.
  if (o.redLo > 0) {
    const a0 = -SWEEP, a1 = -SWEEP + o.redLo * 2 * SWEEP;
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

  /**
   * AND A BOLT, WHERE A SUB-DIAL CANNOT HAVE A WORD.
   *
   * The legend above is a typeface and the comment on it says why it is only on
   * the big pair: at the sub-dials' radius three letters came out as four grey
   * pixels of mush, which is worse than nothing because the eye still stops on
   * it. But an unlabelled contents gauge is a needle pointing at nothing in
   * particular, and the one gauge on this dashboard that the driver has never
   * seen before is the one that most needs saying.
   *
   * So it gets a MARK rather than a word — the same lightning bolt the deleted
   * nitrous bottle wore on its label, for the same reason it wore it: "a bolt
   * is the one mark nobody has to be taught". Drawn as a polygon, so nothing
   * about it depends on what "sans-serif" resolves to.
   *
   * PAINTED IN THE GRADUATIONS' OWN WHITE AND NOT INKED, which is the opposite
   * of the rule the rest of this file follows and is a fix rather than an
   * oversight. The first pass gave it the file's usual black outline at the
   * usual weight: on a mark this small the outline was most of the mark, and
   * against a near-black dial face what landed was a dark smudge above the
   * spindle — exactly the mush the legend comment above warns about, arrived at
   * by a different route. Ink separates a light shape from a light background;
   * there is no light background here. The graduations on this same face are
   * bare white for the same reason.
   *
   * AT THE BOTTOM OF THE FACE, which is the one place on a dial nothing ever
   * covers. The needle sweeps 125 degrees either side of twelve o'clock, so it
   * reaches the bottom 110-degree wedge at no reading at all — the same fact
   * the tacho's gear numeral is placed on. Above the spindle is where this
   * started and it was wrong: a contents gauge reads twelve o'clock at exactly
   * half full, so the needle would have lain across the mark every time the
   * bottle was half empty.
   */
  if (o.bolt) {
    const s = rf * 0.26, by = cy + rf * 0.56;
    poly(x, [cx - s * 0.30, by - s, cx + s * 0.62, by - s, cx + s * 0.06, by - s * 0.12,
             cx + s * 0.70, by - s * 0.12, cx - s * 0.42, by + s,
             cx + s * 0.06, by + s * 0.02, cx - s * 0.52, by + s * 0.02]);
    ink(x, C.mark, 0);
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
function drawDials(x, W, H, mirrored, tachoFull) {
  const at = (fx) => (mirrored ? 1 - fx : fx) * W;
  // THE TACHO'S SCALE IS THE ENGINE'S, NOT A LITERAL. This read 0-8 thousand
  // for as long as the V8's limiter was 6,400 — already loose by a quarter, and
  // nobody looked. Then the limiter went to 4,600 to fix a note Anthony
  // correctly heard as a tuned V6 rather than a V8, and the face was suddenly
  // claiming eight thousand revs on an engine that stops at four and a half.
  // main.js now derives this from the engine's own redline, rounded up to the
  // next thousand, so the garage cannot sell an engine that makes the dial lie.
  // Eight majors on a five-thousand face would be 625rpm apart and unreadable,
  // so one major per thousand with a label every other one: 0, 2, 4 on a
  // big-block face, exactly what a car with this little rev range wears.
  const majors = Math.max(4, Math.round((tachoFull || 8000) / 1000));
  dial(x, at(WHEEL_X - DIAL_DX), DIAL_Y * H, DIAL_R * H,
       { majors, minors: 2, step: 1, labelEvery: 2, red: 0.80, label: 'RPM',
         labelUp: true });
  dial(x, at(WHEEL_X + DIAL_DX), DIAL_Y * H, DIAL_R * H,
       { majors: 8, minors: 2, step: DIAL_FULL / 8, labelEvery: 2, red: 0.88,
         label: 'MPH' });
  // Temperature, out on the dash where the rim clears it. Still decoration.
  dial(x, at(WHEEL_X - SUB_DX), SUB_Y * H, SUB_R * H,
       { majors: 4, minors: 1, red: 0.82 });
  // AND THE NITROUS CONTENTS GAUGE, which is the same dial with the red at the
  // other end and a bolt on its face. Finer graduations than its twin — four
  // majors split in two — because this one is read for a fraction rather than
  // glanced at for "is it in the red", and eight divisions at this radius is
  // the same tick spacing the big pair have at twice the radius.
  dial(x, at(WHEEL_X + SUB_DX), SUB_Y * H, SUB_R * H,
       { majors: 4, minors: 2, red: 1, redLo: NOS_RED, bolt: true });
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
    // a small radio panel above the vent, with two knobs — and the display in
    // it is the lap timer, so the glass is drawn by drawLcdStatic below
    const px = RADIO_FX * W, pw = RADIO_FW * W;
    const py = (dt(0.30) + RADIO_DY) * H, ph = RADIO_FH * H;
    rrect(x, px, py, pw, ph, 6);
    ink(x, C.trimDark, 5);
    for (const kx of [px + pw * 0.14, px + pw * 0.86]) {
      x.beginPath(); x.arc(kx, py + ph * 0.5, ph * 0.26, 0, TAU);
      ink(x, C.chrome, 3);
    }
  }
  drawLcdStatic(x, W, H, false);

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

  // ---- the boost switch's escutcheon, under the right-hand lamp -----------
  drawSwitchPlate(x, W, H);

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

  drawDials(x, W, H, false, TACHO_FULL);

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
    // three-spoke wheel look like a three-spoke wheel and not like a Y. Drawn
    // by drillHole, which the brake pedal also calls: the pedal is meant to
    // look like a part off this same car, and the surest way to get that is
    // for the two of them to be the same code and not the same intention.
    for (let k = 0; k < 3; k++) {
      const t = 0.30 + k * 0.235;
      const r = r0 + (r1 - r0) * t;
      drillHole(x, cx + ca * r, cy + sa * r, (w0 + (w1 - w0) * t) * 0.44);
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
// Drawn pointing UP with its pivot `pivot` down from the top, so the quad can
// be rotated about that point. The chrome cap is part of the sprite and sits at
// the pivot, so it covers the needle's root at every angle.
//
// THE PIVOT IS AN ARGUMENT NOW, and the tail and the lit edge are fractions of
// the cell rather than the two fixed numbers they used to be, because there is
// a SECOND, smaller cell for the nitrous gauge's sub-dial. At 76 pixels tall a
// tail hard-coded at 18 below the pivot lands exactly on the bottom edge of the
// cell and its ink is clipped by the region. Written as 0.14 of the cell it
// gives 17.9 in the big cell — the number that was there — and 10.6 in the
// small one. Two needles, one drawing, no chance of them drifting apart.
function drawNeedle(x, W, H, pivot) {
  const cx = W * 0.5, py = pivot;
  poly(x, [cx - W * 0.22, py + H * 0.14, cx - W * 0.12, 6,
           cx + W * 0.12, 6, cx + W * 0.22, py + H * 0.14]);
  ink(x, C.needle, 3);
  // a lit edge down one side, the same three-band treatment as everything else
  x.beginPath();
  x.moveTo(cx - W * 0.10, py + H * 0.109);
  x.lineTo(cx - W * 0.045, 12);
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

// --------------------------------------------------- THE BOOST SWITCH, part 1
/**
 * THE ESCUTCHEON PLATE AND ITS BEZEL — the part that does not move.
 *
 * Painted into the ART region with the vents, the eyeball and the ignition
 * barrel, because it is exactly the same kind of thing they are: hardware
 * screwed to a dashboard. It costs no quad, it is drawn once at boot, and
 * nothing about it is touched again for the rest of the run.
 *
 * PERIOD-CORRECT MUSCLE CAR, which means specific things and not "chunky": a
 * dark anodised plate standing a little off the fascia, two slotted screws
 * holding it on, and a KNURLED CHROME BEZEL NUT clamping the switch body
 * through a drilled hole in the middle of it. The bat comes up through that
 * hole, which is drawn by drillHole — the SAME function the wheel's spokes and
 * the brake pedal's drillings call. That is the whole of what makes this look
 * like a part off this car rather than a switch from a different game: it is
 * literally the same hole, in the same three greys, with the same bright arc
 * along its top inside edge where the light through the windscreen catches the
 * far wall.
 *
 * THE SCREWS GO LEFT AND RIGHT OF THE BEZEL, not above and below it. Above and
 * below is where a switch plate's screws usually are and it is the one place
 * they cannot go here, because that is the strip of plate the bat sweeps
 * across: a screw at the top would be under the handle for half the race and
 * visible for the other half, which reads as a screw that comes and goes.
 */
function drawSwitchPlate(x, W, H) {
  const cx = (WHEEL_X + SW_DX) * W, cy = SW_Y * H;
  const pw = SW_W_F * W, ph = SW_H_F * H;
  const x0 = cx - pw * 0.5, y0 = cy - ph * 0.5;

  // the shadow it throws on the fascia, which is what stands it off the surface
  rrect(x, x0 + 3, y0 + 4, pw, ph, ph * 0.22);
  x.fillStyle = 'rgba(8,6,4,0.45)'; x.fill();

  // the plate
  rrect(x, x0, y0, pw, ph, ph * 0.22);
  ink(x, C.trimDark, 7);
  // a lit top edge and a dark bottom one: the same two lines every raised panel
  // in this cockpit gets, and the only reason a dark plate on a dark fascia
  // reads as being in front of it at all
  x.beginPath();
  x.moveTo(x0 + pw * 0.14, y0 + 3); x.lineTo(x0 + pw * 0.86, y0 + 3);
  x.strokeStyle = C.trimLit; x.lineWidth = 3; x.lineCap = 'round'; x.stroke();
  x.beginPath();
  x.moveTo(x0 + pw * 0.14, y0 + ph - 3); x.lineTo(x0 + pw * 0.86, y0 + ph - 3);
  x.strokeStyle = 'rgba(6,7,10,0.65)'; x.lineWidth = 3; x.stroke();

  // the two screws, one either side
  for (const sgn of [-1, 1]) {
    const sx = cx + sgn * pw * 0.37, sr = ph * 0.10;
    x.beginPath(); x.arc(sx, cy, sr, 0, TAU);
    ink(x, C.chromeMid, 2.5);
    x.beginPath();
    x.moveTo(sx - sr * 0.7, cy - sr * 0.35); x.lineTo(sx + sr * 0.7, cy + sr * 0.35);
    x.strokeStyle = 'rgba(8,9,12,0.8)'; x.lineWidth = 2; x.stroke();
  }

  // THE BEZEL NUT, in the wheel's own chrome and with the wheel's own three
  // flat bands: a hot arc across the top-left, a dark one across the
  // bottom-right, and nothing in between. Chrome in this style is three greys
  // with hard edges, never a gradient.
  const rb = ph * 0.34;
  x.beginPath(); x.arc(cx, cy, rb, 0, TAU);
  ink(x, C.chrome, 6);
  x.beginPath(); x.arc(cx, cy, rb * 0.80, Math.PI * 1.04, Math.PI * 1.86);
  x.strokeStyle = C.chromeHi; x.lineWidth = rb * 0.28; x.stroke();
  x.beginPath(); x.arc(cx, cy, rb * 0.80, Math.PI * 0.06, Math.PI * 0.74);
  x.strokeStyle = C.chromeLo; x.lineWidth = rb * 0.28; x.stroke();
  // the knurling: six short nicks round the rim, which is what says "nut you
  // tighten by hand" rather than "washer"
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + 0.26;
    x.beginPath();
    x.moveTo(cx + Math.cos(a) * rb * 0.86, cy + Math.sin(a) * rb * 0.86);
    x.lineTo(cx + Math.cos(a) * rb * 1.02, cy + Math.sin(a) * rb * 1.02);
    x.strokeStyle = 'rgba(8,9,12,0.75)'; x.lineWidth = 2; x.stroke();
  }
  // and the hole the bat comes through — drillHole, the wheel's and the pedal's
  drillHole(x, cx, cy, rb * 0.46);
}

// --------------------------------------------------- THE BOOST SWITCH, part 2
/**
 * THE BAT HANDLE — the part that does move, and the only part with a quad.
 *
 * TWO CELLS OUT OF ONE FUNCTION, up and down, exactly as the brake pedal's two
 * cells come out of drawPedal with a `press` argument: a hand-drawn "down"
 * would drift away from the "up" the first time either was touched, and the one
 * thing a toggle switch must not do is look like two different switches.
 *
 * THE PIVOT IS THE CENTRE OF THE CELL, so both positions are the same quad in
 * the same place and flipping the switch is EIGHT FLOATS — a UV move to the
 * cell next door and nothing else. No corners are rewritten, no rotation is
 * computed and no canvas is touched. That is the file's rule for anything that
 * changes picture rather than position, and a bat that swings between two fixed
 * stops changes picture.
 *
 * UP IS IDLE AND DOWN IS BOOSTING, which is the owner's specification and is
 * also how a real one is wired: you flick it down and away, and the thing it
 * arms is live for as long as it stays there.
 *
 * DRAWN AT ROUGHLY TWICE ART SCALE and minified 2.04x on the way to the glass,
 * so the ink weights here are roughly twice the file's usual ones. 9 for the
 * silhouette lands at 7.5 device pixels, against the wheel's 8.3 — the same
 * line, which is the point.
 */
function drawSwitchBat(x, w, h, down) {
  const cx = w * 0.5, cy = h * 0.5;
  const d = down ? 1 : -1;                    // canvas y points DOWN
  const L = h * 0.34;                         // pivot to the centre of the ball
  const rBall = w * 0.26;
  const wRoot = w * 0.21, wTip = w * 0.155;   // the shaft tapers away from you

  // ---- the shadow the handle throws on the plate, offset the way every other
  // shadow in this cockpit is: down and to the driver's side. Without it the
  // bat is a shape lying ON the plate rather than standing out of it.
  poly(x, [cx - wRoot + 3, cy + 3, cx + wRoot + 3, cy + 3,
           cx + wTip + 3, cy + d * L + 3, cx - wTip + 3, cy + d * L + 3]);
  x.fillStyle = 'rgba(6,7,10,0.45)'; x.fill();
  x.beginPath(); x.arc(cx + 3, cy + d * L + 3, rBall, 0, TAU);
  x.fillStyle = 'rgba(6,7,10,0.45)'; x.fill();

  // ---- the shaft
  poly(x, [cx - wRoot, cy, cx + wRoot, cy, cx + wTip, cy + d * L, cx - wTip, cy + d * L]);
  ink(x, C.chrome, 9);
  // hot down one side, dark down the other — the spokes' treatment exactly
  x.beginPath();
  x.moveTo(cx - wRoot * 0.62, cy); x.lineTo(cx - wTip * 0.60, cy + d * L);
  x.strokeStyle = C.chromeHi; x.lineWidth = w * 0.075; x.lineCap = 'round'; x.stroke();
  x.beginPath();
  x.moveTo(cx + wRoot * 0.64, cy); x.lineTo(cx + wTip * 0.62, cy + d * L);
  x.strokeStyle = C.chromeLo; x.lineWidth = w * 0.085; x.stroke();

  // ---- the ball on the end, which is what makes it a BAT handle and not a peg
  x.beginPath(); x.arc(cx, cy + d * L, rBall, 0, TAU);
  ink(x, C.chrome, 9);
  x.beginPath();
  x.arc(cx, cy + d * L, rBall * 0.60, Math.PI * 1.05, Math.PI * 1.85);
  x.strokeStyle = C.chromeHi; x.lineWidth = rBall * 0.42; x.stroke();
  x.beginPath();
  x.arc(cx, cy + d * L, rBall * 0.64, Math.PI * 0.08, Math.PI * 0.72);
  x.strokeStyle = C.chromeLo; x.lineWidth = rBall * 0.32; x.stroke();

  // ---- the collar at the root, in shade, so the shaft reads as coming OUT of
  // the bezel's hole rather than as being stuck on top of it
  x.beginPath();
  x.moveTo(cx - wRoot * 1.02, cy + d * rBall * 0.20);
  x.lineTo(cx + wRoot * 1.02, cy + d * rBall * 0.20);
  x.strokeStyle = 'rgba(8,9,12,0.72)'; x.lineWidth = 5; x.lineCap = 'round'; x.stroke();
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

// ------------------------------------------------------- the radio's glass
//
// The display itself: the sunk green rectangle, and the two marks on it that
// never change — the colon between the minutes and the seconds, and the point
// before the tenths. Those two are PAINTED INTO THE DASH rather than given
// quads of their own, because they are four dots that never move and a quad
// each would be four triangles to draw something the dash can draw for free.
//
// IT IS A SEPARATE FUNCTION FOR THE SAME REASON drawDials IS. Mirroring the
// canvas for a left-hand-drive cockpit mirrors everything painted on it, and a
// mirrored `0:00.0` reads `0.00:0` — the colon and the point swap ends. So the
// glass is drawn again, the right way round, over the mirrored copy of itself.
function drawLcdStatic(x, W, H, mirrored) {
  const at = (fx) => (mirrored ? 1 - fx : fx) * W;
  const lx = at(LCD_FX) - (mirrored ? LCD_FW * W : 0);
  const lw = LCD_FW * W, ly = LCD_FY * H, lh = LCD_FH * H;
  // the glass. Darker at the top, the way a recessed panel catches the light
  // from the windscreen on its lower lip and not its upper one.
  x.fillStyle = '#24403c'; x.fillRect(lx, ly, lw, lh);
  x.fillStyle = '#2c4b46'; x.fillRect(lx, ly + lh * 0.22, lw, lh * 0.78);
  // and the shadow the recess casts along its top and left edges
  x.fillStyle = 'rgba(0,0,0,0.45)';
  x.fillRect(lx, ly, lw, lh * 0.10);
  x.fillRect(lx, ly, lw * 0.012, lh);

  // ONE FUNCTION DECIDES WHERE EVERY GLYPH GOES, and it is called here to
  // paint the colon and again in buildCockpit to place the digit quads. Two
  // copies of this arithmetic is how a colon ends up drawn through a digit.
  const s = lcdSlots(lw, lh);
  const t = Math.max(1, LCD_SEG_T * s.dh);
  x.fillStyle = '#8af2b4';
  x.fillRect(lx + s.colon, ly + s.dy + s.dh * 0.26, t, t);
  x.fillRect(lx + s.colon, ly + s.dy + s.dh * 0.64, t, t);
  x.fillRect(lx + s.point, ly + s.dy + s.dh - t, t, t);
}

/**
 * WHERE EACH GLYPH SITS ON THE GLASS, in pixels from its top-left corner,
 * whatever pixels the caller is working in.
 *
 * Right-aligned and walked leftward: tenths, point, seconds, seconds, colon,
 * minutes. Right-aligned rather than centred because the number is the thing
 * that changes width if this ever shows something else, and a readout whose
 * digits move sideways as the time passes is unreadable at 200mph.
 */
function lcdSlots(lw, lh) {
  const dh = LCD_DIG_H * lh, dw = LCD_DIG_AR * dh, gap = LCD_GAP * dw;
  const cw = LCD_COLON_W * dw, pw = LCD_POINT_W * dw;
  const d3 = lw * (1 - LCD_PAD) - dw;
  const point = d3 - gap - pw;
  const d2 = point - gap - dw;
  const d1 = d2 - gap - dw;
  const colon = d1 - gap - cw;
  const d0 = colon - gap - dw;
  return { dh, dw, dy: (lh - dh) * 0.5, digit: [d0, d1, d2, d3], colon, point,
           tagH: LCD_TAG_H * lh, tagW: (LCD_TAG_H * lh) * (TAG_W / TAG_H),
           tagX: lw * LCD_PAD, numW: dw * 4 + cw + pw + gap * 5 };
}

// ------------------------------------------------- the seven-segment digits
//
// Ten cells, drawn WHITE so the green is a tint, with the six segments a digit
// does NOT use drawn behind it in near-black — the ghost of the eight, which
// is the single thing that makes a green rectangle read as a liquid-crystal
// display rather than as a sticker. The ghost is black at 30%, so the vertex
// colour that greens the lit bars leaves it dark whatever tint is applied.
//
// Bars are mitred hexagons rather than rectangles. It is six more lineTos per
// segment, drawn once, and at two device pixels wide it is the difference
// between a digit and a barcode.
const SEG_MASK = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

function segBar(x, horiz, a, b, c, t) {
  const h = t * 0.5;
  if (horiz) poly(x, [a + h, c - h, b - h, c - h, b, c, b - h, c + h, a + h, c + h, a, c]);
  else poly(x, [c - h, a + h, c - h, b - h, c, b, c + h, b - h, c + h, a + h, c, a]);
}

function drawSegDigits(x) {
  const w = SEG_W, h = SEG_H, t = Math.max(2, Math.round(SEG_H * 0.15));
  const hh = h * 0.5;
  for (let k = 0; k < SEG_N; k++) {
    const ox = k * SEG_STRIDE, m = SEG_MASK[k];
    // a  b  c  d  e  f  g, in the order the mask numbers them
    const segs = [
      [1, t * 0.5, w - t * 0.5, t * 0.5],          // a  top
      [0, t * 0.5, hh, w - t * 0.5],               // b  upper right
      [0, hh, h - t * 0.5, w - t * 0.5],           // c  lower right
      [1, t * 0.5, w - t * 0.5, h - t * 0.5],      // d  bottom
      [0, hh, h - t * 0.5, t * 0.5],               // e  lower left
      [0, t * 0.5, hh, t * 0.5],                   // f  upper left
      [1, t * 0.5, w - t * 0.5, hh],               // g  middle
    ];
    for (let s = 0; s < 7; s++) {
      const [horiz, a, b, c] = segs[s];
      x.save();
      x.translate(ox, 0);
      segBar(x, horiz === 1, a, b, c, t);
      x.fillStyle = (m >> s) & 1 ? '#ffffff' : 'rgba(0,0,0,0.30)';
      x.fill();
      x.restore();
    }
  }
}

/**
 * The BEST tag. Four letters in 40 x 12 atlas pixels, which is 30 x 9 on the
 * panel, and it is the ONE place in this file where a typeface is unavoidable:
 * a word is a word. So it is drawn once, at boot, into a cell, and it is
 * SQUEEZED TO FIT THE CELL BY MEASUREMENT — measureText, then a horizontal
 * scale — rather than by choosing a font size and hoping. "sans-serif"
 * resolves to something different on every WebView this might land on, and a
 * tag that fits on Chrome and overruns the glass on a Samsung browser is the
 * fit bug this project has already shipped once.
 */
function drawTag(x, W, H) {
  x.textAlign = 'left';
  x.textBaseline = 'middle';
  x.font = `bold ${Math.round(H * 0.86)}px sans-serif`;
  const w = x.measureText('BEST').width;
  x.save();
  x.translate(1, H * 0.5);
  x.scale((W - 2) / Math.max(1, w), 1);
  x.fillStyle = '#ffffff';
  x.fillText('BEST', 0, 0);
  x.restore();
}

/**
 * The countdown's glyphs: 3, 2, 1 and GO.
 *
 * WHITE ON A HEAVY INK OUTLINE, the same treatment as the gear numeral and as
 * every other shape in this cockpit, because that outline is what stops a
 * numeral from looking printed on the glass by a web page. At this size the
 * outline is 13 atlas pixels, which is the file's silhouette weight of 7
 * scaled up in proportion to the glyph.
 *
 * AND A CAST SHADOW, thrown down and to the driver's side. That is the cue
 * that says the numeral is a solid thing standing on the dashboard rather than
 * a picture composited over it, and it costs a second fillText.
 *
 * THERE IS NO CONTACT SHADOW POOLED UNDER ITS FEET, and there was one for an
 * afternoon. It is the stronger cue of the two and here it is worth nothing:
 * the numeral stands at the middle of the frame, and what is directly under
 * its feet there is the binnacle hood, which is #1b1e23. A soft black pool on
 * near-black is a soft black pool nobody can see — shots/rd-cd3-foot.png at 3x
 * is where that was established, and the cells went back to being as deep as
 * the glyph in them.
 */
function drawCountGlyph(x, w, h, s) {
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = `bold ${Math.round(h * 0.95)}px sans-serif`;
  x.lineJoin = 'round';
  x.lineCap = 'round';
  const cx = w * 0.5, cy = h * 0.5;
  x.save();
  x.globalAlpha = 0.38;
  x.fillStyle = '#000000';
  x.fillText(s, cx + h * 0.045, cy + h * 0.055);
  x.restore();
  x.strokeStyle = INKC; x.lineWidth = Math.max(6, h * 0.088);
  x.strokeText(s, cx, cy);
  x.fillStyle = '#ffffff';
  x.fillText(s, cx, cy);
}

/**
 * THE BRAKE PEDAL. A drilled alloy race pedal, in the wheel's own chrome.
 *
 * "The same silver theme as the steering wheel spokes rather than black
 * rubber", and that is taken literally rather than approximately: the fill is
 * C.chrome, the hot edge C.chromeHi and the shaded one C.chromeLo — the three
 * greys the spokes are painted in — the silhouette is inked at 8 and the
 * drillings come out of drillHole, which is the function the spokes call. The
 * only rubber in a race car is on the wheels.
 *
 * FLOOR-HINGED, NOT PENDANT, and that decides the whole animation. The pad is a
 * trapezoid standing up off a hinge at its base; pressing swings the TOP of it
 * away from you, so the top edge drops, the face foreshortens, the top edge
 * narrows a little with the perspective and the shadow behind it collapses. The
 * hinge line does not move. One function draws both cells from `press`, so the
 * pressed pedal is the same pedal — a second hand-drawn picture would have
 * drifted the first time either was touched.
 *
 * AND THE GHOST OF WHERE IT WAS, drawn only in the pressed cell: the raised
 * outline in thin translucent ink, with three motion ticks off each shoulder.
 * That is the comic's way of saying a thing moved, it costs six strokes drawn
 * once, and without it a 20-pixel change on a 200-pixel pedal is a change
 * nobody notices on a phone at arm's length.
 */
function drawPedal(x, w, h, press) {
  const rnd = rndFrom(0x7c41);
  const cx = w * 0.5;
  const yHinge = h * 0.93;                        // the hinge line: it never moves
  const top = (p) => h * (0.20 + 0.115 * p);      // the top edge, which does
  const topHW = (p) => w * (0.320 - 0.018 * p);   // and narrows as it goes away
  const botHW = w * 0.38;
  const y0 = top(press), tHW = topHW(press);
  // the face, as a path: a trapezoid, wider at the hinge because that end is
  // nearer the eye
  const face = (yTop, hw) => poly(x, [cx - hw, yTop, cx + hw, yTop,
                                      cx + botHW, yHinge, cx - botHW, yHinge]);
  // A point on the face in pad coordinates: u across (-1 to 1), v down (0 to 1).
  const px = (u, v) => cx + u * (tHW + v * (botHW - tHW));
  const py = (v) => y0 + v * (yHinge - y0);

  // ---- the shadow it throws on the floor pan, which is how you can see it is
  // standing off the floor at all. It collapses as the pedal goes down.
  {
    const o = h * (0.010 + 0.040 * (1 - press));
    poly(x, [cx - tHW + o, y0 + o, cx + tHW + o, y0 + o,
             cx + botHW + o * 0.35, yHinge + o * 0.35,
             cx - botHW + o * 0.35, yHinge + o * 0.35]);
    x.fillStyle = 'rgba(6,7,10,0.50)'; x.fill();
  }

  // ---- where it was, and the ticks that say it moved
  //
  // THE GHOST IS THE TOP EDGE AND TWO STUBS, not the whole outline. Drawn all
  // the way round it read as an empty box the pedal had dropped out of — a
  // slot, not a memory. Three strokes say "it was up there" and nothing says
  // "there is a hole in your dashboard".
  if (press > 0) {
    const gy = top(0), ghw = topHW(0);
    x.beginPath();
    x.moveTo(cx - ghw, gy + h * 0.045);
    x.lineTo(cx - ghw, gy); x.lineTo(cx + ghw, gy);
    x.lineTo(cx + ghw, gy + h * 0.045);
    x.strokeStyle = 'rgba(8,9,12,0.32)'; x.lineWidth = 3;
    x.lineJoin = 'round'; x.lineCap = 'round'; x.stroke();
    for (const sgn of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const bx = cx + sgn * (topHW(0) + w * 0.045 + k * w * 0.055);
        const by = top(0) + h * (0.02 + k * 0.035);
        x.beginPath();
        x.moveTo(bx, by);
        x.lineTo(bx + sgn * w * 0.03, by - h * 0.045);
        x.strokeStyle = INKC; x.lineWidth = 4; x.lineCap = 'round'; x.stroke();
      }
    }
  }

  // ---- the pad
  face(y0, tHW);
  ink(x, C.chrome, 8);
  // chrome in flat bands, exactly as the spokes do it: a hot edge down one side
  // and a dark one down the other, hard-edged, no shine
  x.beginPath();
  x.moveTo(px(-0.90, 0.04), py(0.04)); x.lineTo(px(-0.90, 0.96), py(0.96));
  x.strokeStyle = C.chromeHi; x.lineWidth = 7; x.lineCap = 'round'; x.stroke();
  x.beginPath();
  x.moveTo(px(0.90, 0.04), py(0.04)); x.lineTo(px(0.90, 0.96), py(0.96));
  x.strokeStyle = C.chromeLo; x.lineWidth = 8; x.stroke();
  // the folded lips, top and bottom — a plate with a turned edge reads as a
  // pedal, a flat plate reads as a card. Inset from the silhouette rather than
  // run out to it: a bright bar poking past the ink line at each end is a bar
  // lying on the pedal, which is what the first pass looked like.
  x.beginPath();
  x.moveTo(px(-0.88, 0.055), py(0.055)); x.lineTo(px(0.88, 0.055), py(0.055));
  x.strokeStyle = C.chromeHi; x.lineWidth = 6; x.stroke();
  x.beginPath();
  x.moveTo(px(-0.90, 0.105), py(0.105)); x.lineTo(px(0.90, 0.105), py(0.105));
  x.strokeStyle = 'rgba(10,12,16,0.6)'; x.lineWidth = 3; x.stroke();
  x.beginPath();
  x.moveTo(px(-0.90, 0.945), py(0.945)); x.lineTo(px(0.90, 0.945), py(0.945));
  x.strokeStyle = C.chromeLo; x.lineWidth = 6; x.stroke();

  // ---- the drillings: three columns of four, the same hole the spokes have
  for (let r = 0; r < 4; r++) {
    const v = 0.28 + r * 0.165;
    for (const u of [-0.60, 0, 0.60]) {
      drillHole(x, px(u, v), py(v), w * (0.052 - 0.004 * press));
    }
  }

  // ---- the hinge at the base: two knuckles and a pin, in the darker chrome so
  // the pad is plainly the brighter thing standing on it
  rrect(x, cx - botHW * 1.02, yHinge - h * 0.012, botHW * 2.04, h * 0.055, 6);
  ink(x, C.chromeMid, 7);
  for (const u of [-0.62, 0.62]) {
    x.beginPath();
    x.arc(cx + u * botHW, yHinge + h * 0.015, w * 0.038, 0, TAU);
    ink(x, C.chromeHi, 4);
  }

  pencilPass(x, w, h, rnd, 90, 0.09);
}

/**
 * The bounding box of the WHITE in a cell, read back off the canvas — AND the
 * bounding box of every pixel in it that is not near-transparent.
 *
 * THE WHITE BOX IS THE GLYPH, and it is what a quad is SIZED from: the quad
 * that shows a glyph is sized from what was actually drawn, never from the font
 * size that was asked for — cap height is 0.70 of the em box in one grotesque
 * and 0.73 in the next, and "sans-serif" is whatever the device has. This is
 * the same readback the gear numeral does, generalised so the countdown's four
 * cells can each be measured on their own.
 *
 * THE ALPHA BOX IS THE FOOTPRINT, and it is what the countdown is now PLACED
 * from. That is a new job and the reason this grew a second box. Under a
 * countdown glyph's white face there is a heavy ink outline, and under that a
 * cast shadow thrown down and to the driver's side: sixteen device pixels of
 * drawing the white box knows nothing about. Clearing the steering wheel by a
 * gap measured from the white would have left the ink and the shadow lying on
 * the rim, and the owner looking at the overlap he asked to have removed. The
 * clearance he gets is measured from the LOWEST PIXEL THE GLYPH PUTS ANYWHERE.
 *
 * THRESHOLD 24 OF 255, NOT 0, because the canvas antialiases and a fringe two
 * percent above transparent is not a pixel anybody can see. The cast shadow is
 * black at 38% — alpha 97 — so it is caught with a factor of four in hand.
 */
function measureInk(g, x0, y0, w, h) {
  const d = g.getImageData(x0, y0, w, h).data;
  let top = -1, bot = -1, left = w, right = -1;
  let aTop = -1, aBot = -1, aLeft = w, aRight = -1;
  for (let y = 0; y < h; y++) {
    for (let px = 0; px < w; px++) {
      const i = (y * w + px) * 4;
      if (d[i + 3] > 24) {
        if (aTop < 0) aTop = y;
        aBot = y;
        if (px < aLeft) aLeft = px;
        if (px > aRight) aRight = px;
      }
      if (d[i + 3] > 128 && d[i] > 160 && d[i + 1] > 160) {
        if (top < 0) top = y;
        bot = y;
        if (px < left) left = px;
        if (px > right) right = px;
      }
    }
  }
  if (top < 0) return null;
  return {
    top, bot, left, right, h: bot - top + 1, w: right - left + 1,
    all: { top: aTop, bot: aBot, left: aLeft, right: aRight,
           h: aBot - aTop + 1, w: aRight - aLeft + 1 },
  };
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
  // BEFORE ANY DRAWING. Everything below this line that puts ink on the atlas
  // may read it, and nothing after boot may write it.
  TACHO_FULL = o.tachoFull || 8000;
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
  inRegion(NDL_X, NDL_Y, NDL_W, NDL_H, (x, w, h) => drawNeedle(x, w, h, NDL_PIVOT));
  inRegion(NDS_X, NDS_Y, NDS_W, NDS_H, (x, w, h) => drawNeedle(x, w, h, NDS_PIVOT));
  inRegion(LMP_X, LMP_Y, LMP_W, LMP_H, (x, w, h) => drawLamp(x, w, h));
  inRegion(DIG_X, DIG_Y, DIG_N * DIG_STRIDE, DIG_H, (x) => drawGearDigits(x));
  inRegion(SEG_X, SEG_Y, SEG_N * SEG_STRIDE, SEG_H, (x) => drawSegDigits(x));
  inRegion(TAG_X, TAG_Y, TAG_W, TAG_H, (x, w, h) => drawTag(x, w, h));
  // The countdown's four cells. 3, 2 and 1 share a strip of equal cells; GO is
  // twice as wide and lives in its own, so each is measured separately below
  // and the quad takes the shape of whichever is on show.
  for (let k = 0; k < CD_N; k++) {
    inRegion(CD_X + k * CD_STRIDE, CD_Y, CD_W, CD_H,
             (x, w, h) => drawCountGlyph(x, w, h, String(CD_N - k)));
  }
  inRegion(GO_X, GO_Y, GO_W, GO_H, (x, w, h) => drawCountGlyph(x, w, h, 'GO'));
  // THE TWO THINGS THAT CHANGE PICTURE WHEN A THUMB LANDS. Two cells each —
  // the pedal raised and pressed, the switch up and down — and both pairs come
  // out of ONE function with a state argument, so a state cannot be drawn by a
  // different hand from the one that drew the other.
  for (let k = 0; k < 2; k++) {
    inRegion(PED_X + k * PED_STRIDE, PED_Y, PED_W, PED_H,
             (x, w, h) => drawPedal(x, w, h, k));
    inRegion(SWH_X + k * SWH_STRIDE, SWH_Y, SWH_W, SWH_H,
             (x, w, h) => drawSwitchBat(x, w, h, k));
  }

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
    inRegion(ART_X, ART_Y, ART_W, ART_H, (x, w, h) => drawDials(x, w, h, true, TACHO_FULL));
    // and the radio's glass, for the same reason the dials are redrawn: a
    // mirrored `0:00.0` puts the point where the colon belongs.
    inRegion(ART_X, ART_Y, ART_W, ART_H, (x, w, h) => drawLcdStatic(x, w, h, true));
  }

  // WHAT THE COUNTDOWN'S GLYPHS ACTUALLY CAME OUT AS, read back off the canvas
  // one cell at a time. Sized from the drawing rather than from the font size
  // for the reason the gear numeral is, and measured per cell because GO and
  // the numerals are different shapes in differently shaped cells: the quad
  // has to take the shape of whichever one is showing, so each needs its own.
  const CD_CELL = [];
  for (let k = 0; k <= CD_N; k++) {
    const cx = k < CD_N ? CD_X + k * CD_STRIDE : GO_X;
    const cy = k < CD_N ? CD_Y : GO_Y;
    const cw = k < CD_N ? CD_W : GO_W, ch = k < CD_N ? CD_H : GO_H;
    const m = measureInk(g, cx, cy, cw, ch)
              || { top: 0, bot: ch - 1, left: 0, right: cw - 1, h: ch, w: cw,
                   all: { top: 0, bot: ch - 1, left: 0, right: cw - 1, h: ch, w: cw } };
    CD_CELL.push({ x: cx, y: cy, w: cw, h: ch, ink: m });
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

  // ------------------------------------------------------- the sixteen quads
  //
  // Index order IS draw order inside a single call, so this list is also the
  // back-to-front order: the dash, then the tell-tales and needles on top of
  // it, then the wheel in front of everything.
  // Each entry is the atlas rectangle the quad is cut from. The two lamps share
  // one drawing and so do the two BIG needles — a needle is a needle, and the
  // tint that tells a boost from a brake is in the vertex colour, not the
  // pixels. The nitrous gauge's needle is the one exception and it is a
  // sharpness fix, not a style: see NDS_* on the atlas.
  // THE GEAR NUMERAL GOES IN AT INDEX 1, UNDER EVERYTHING THAT MOVES, and that
  // position is a bug fix rather than tidiness. Appended at the end it would
  // have drawn over the steering wheel: the wheel turns 140 degrees each way,
  // and at 43 degrees of lock a spoke passes straight across the tacho — a
  // numeral floating on top of a spoke is precisely the "web overlay" this is
  // meant not to be. Under the needle for the same reason, so the needle
  // sweeps over the printed face the way it does on a real dial.
  //
  // THE CLOCK GOES IN AT INDEX 2, WITH THE GEAR NUMERAL, for the same reason
  // the gear numeral is there: everything that moves has to be able to pass in
  // FRONT of a printed readout, or the readout stops being part of the dash
  // and becomes an overlay. Nothing reaches the radio panel today — it is far
  // over on the passenger side — but the rule is cheap to keep and expensive
  // to rediscover.
  //
  // THE BOOST SWITCH'S BAT GOES IN WITH THE LAMPS, under the needles and under
  // the wheel. It is a piece of the dashboard and it obeys the dashboard's
  // rule: everything that moves has to be able to pass in FRONT of it. Nothing
  // reaches down to the fascia at 0.78 of the frame today — the wheel's rim is
  // 0.2 of the frame away at its nearest — but the rule is cheap to keep and
  // expensive to rediscover, and it is the rule that decided where the gear
  // numeral went.
  //
  // AND THE COUNTDOWN STILL GOES UNDER THE WHEEL, though the reason it was put
  // there has gone. It used to be behind the wheel ON PURPOSE, so the rim would
  // cross the foot of the glyph and the numeral would read as a thing in the
  // car; the owner has ruled against that and the glyph is now lifted clear of
  // the rim entirely, so the order no longer decides anything about how it
  // looks. It stays here because "printed things go under moving things" is the
  // rule the whole list follows, and because if the clearance ever were lost
  // again, being behind the wheel is the way it degrades gracefully. Measured
  // at three viewport shapes by tools/cdclear.mjs rather than reasoned about:
  // the cover-fit only ever crops the SIDES on a screen squarer than 2.4:1, so
  // the vertical relationship between the glyph and the rim is the same
  // fraction of the height on every phone there is.
  //
  // THE PEDAL GOES LAST, IN FRONT OF THE WHEEL, which is the opposite of the
  // rule the countdown follows and for the opposite reason. It is the control
  // under your thumb, in the near corner of the frame, and a steering wheel
  // drawn over the brake would be a control the car is hiding.
  const Q_DASH = 0, Q_GEAR = 1;
  const Q_LCD0 = 2, Q_TAG = 6, Q_LAMP_L = 7, Q_LAMP_R = 8, Q_SWITCH = 9;
  const Q_NDL_R = 10, Q_NDL_S = 11, Q_NDL_N = 12, Q_COUNT = 13, Q_WHEEL = 14;
  const Q_PEDAL = 15;
  const QUADS = [
    [ART_X, ART_Y, ART_W, ART_H],                 // 0 dash, everything static
    [DIG_X, DIG_Y, DIG_W, DIG_H],                 // 1 gear numeral, UVs moved
    [SEG_X, SEG_Y, SEG_W, SEG_H],                 // 2 clock, minutes
    [SEG_X, SEG_Y, SEG_W, SEG_H],                 // 3 clock, tens of seconds
    [SEG_X, SEG_Y, SEG_W, SEG_H],                 // 4 clock, seconds
    [SEG_X, SEG_Y, SEG_W, SEG_H],                 // 5 clock, tenths
    [TAG_X, TAG_Y, TAG_W, TAG_H],                 // 6 the BEST tag, tinted
    [LMP_X, LMP_Y, LMP_W, LMP_H],                 // 7 tell-tale, driver's left
    [LMP_X, LMP_Y, LMP_W, LMP_H],                 // 8 tell-tale, driver's right
    [SWH_X, SWH_Y, SWH_W, SWH_H],                 // 9 the boost switch's bat
    [NDL_X, NDL_Y, NDL_W, NDL_H],                 // 10 tacho needle
    [NDL_X, NDL_Y, NDL_W, NDL_H],                 // 11 speedo needle
    [NDS_X, NDS_Y, NDS_W, NDS_H],                 // 12 nitrous contents needle
    [CD_X, CD_Y, CD_W, CD_H],                     // 13 the countdown, UVs moved
    [WHL_X, WHL_Y, WHL_S, WHL_S],                 // 14 the wheel, in front
    [PED_X, PED_Y, PED_W, PED_H],                 // 15 the brake pedal, UVs moved
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
  // THE CLOCK, ON THE RADIO'S GLASS. Everything here is in art pixels, cut
  // from the same lcdSlots the colon was painted with, so a digit cannot land
  // on the mark that separates it from its neighbour.
  //
  // fx2a takes the CENTRE of each slot, not its left edge: mirroring a left
  // edge for a left-hand-drive cockpit moves the digit by its own width, which
  // is the bug the fw2a comment above is about, one scale down.
  const lcdW = LCD_FW * AW, lcdH = LCD_FH * AH;
  const slot = lcdSlots(lcdW, lcdH);
  {
    const lx = LCD_FX * AW, ly = LCD_FY * AH;
    for (let k = 0; k < 4; k++) {
      const cx = (lx + slot.digit[k] + slot.dw * 0.5) / AW;
      setQuad(Q_LCD0 + k, fx2a(cx), ly + slot.dy + slot.dh * 0.5,
              -slot.dw * 0.5, -slot.dh * 0.5, slot.dw * 0.5, slot.dh * 0.5);
    }
    const tcx = (lx + slot.tagX + slot.tagW * 0.5) / AW;
    setQuad(Q_TAG, fx2a(tcx), ly + lcdH * 0.5,
            -slot.tagW * 0.5, -slot.tagH * 0.5, slot.tagW * 0.5, slot.tagH * 0.5);
  }
  for (const [i, sgn] of [[Q_LAMP_L, -1], [Q_LAMP_R, 1]]) {
    setQuad(i, fx2a(WHEEL_X + sgn * LAMP_DX), fy2a(LAMP_Y),
            -fw2a(LAMP_W_F) * 0.5, -fy2a(LAMP_H_F) * 0.5,
            fw2a(LAMP_W_F) * 0.5, fy2a(LAMP_H_F) * 0.5);
  }
  // THE BOOST SWITCH'S BAT, centred on the bezel that is painted into the dash
  // — one x, WHEEL_X + SW_DX, shared with the plate and with the lamp above it,
  // so the three of them cannot come apart, and mirrored for left-hand drive
  // through fx2a exactly as the lamp is.
  //
  // THE CELL SPANS BOTH POSITIONS, up and down, with the pivot at its centre.
  // That is the whole reason a flip is a UV move and not a rotation: the quad
  // never moves, only the picture inside it changes.
  setQuad(Q_SWITCH, fx2a(WHEEL_X + SW_DX), fy2a(SW_Y),
          -fw2a(SW_BAT_W_F) * 0.5, -fy2a(SW_BAT_H_F) * 0.5,
          fw2a(SW_BAT_W_F) * 0.5, fy2a(SW_BAT_H_F) * 0.5);
  // The needles. Sprite height NDL_H maps to a needle whose tip reaches 0.80 of
  // the dial radius, which is where the reference's needles stop.
  const ndlLen = DIAL_R * 0.80 * AH;                       // pivot to tip
  const ndlScale = ndlLen / NDL_PIVOT;
  for (const [i, sgn] of [[Q_NDL_R, -1], [Q_NDL_S, 1]]) {
    setQuad(i, fx2a(WHEEL_X + sgn * DIAL_DX), fy2a(DIAL_Y),
            -NDL_W * 0.5 * ndlScale, -NDL_PIVOT * ndlScale,
            NDL_W * 0.5 * ndlScale, (NDL_H - NDL_PIVOT) * ndlScale);
  }
  // AND THE NITROUS GAUGE'S NEEDLE, in the right-hand sub-dial. Same
  // arithmetic, same 0.80 of the radius, its own smaller sprite — so a change
  // to where a needle stops on a dial face changes all three of them.
  {
    const s = (SUB_R * 0.80 * AH) / NDS_PIVOT;
    setQuad(Q_NDL_N, fx2a(WHEEL_X + SUB_DX), fy2a(SUB_Y),
            -NDS_W * 0.5 * s, -NDS_PIVOT * s,
            NDS_W * 0.5 * s, (NDS_H - NDS_PIVOT) * s);
  }
  // The wheel. The sprite's rim sits at 0.468 of its half-width from the
  // centre, so the quad has to be that much bigger than the rim it draws.
  const whlHalf = (WHEEL_R * AH) * (0.5 / 0.468);
  setQuad(Q_WHEEL, fx2a(WHEEL_X), fy2a(WHEEL_Y), -whlHalf, -whlHalf, whlHalf, whlHalf);

  // THE COUNTDOWN, one worked-out quad per cell, all four settled at boot so
  // that showing one is four UVs, four corners and a place — sixteen floats and
  // twelve, four times in three seconds — and no arithmetic on a live frame.
  //
  // EACH IS PINNED BY THE FOOT OF ITS DRAWING, not by its cell: a 3 and a GO
  // have different amounts of blank canvas under them, and a countdown that
  // shuffles up and down as it counts is a countdown that draws attention to
  // its own machinery.
  //
  // AND THE FOOT IS THE ALPHA BOX, NOT THE WHITE BOX — the lowest pixel the
  // glyph puts on the glass, which is the bottom of its cast shadow and not the
  // bottom of its face. The clearance the owner asked for is a clearance from
  // the wheel to the DRAWING, and measuring it from the face would have hidden
  // sixteen device pixels of ink and shadow inside the gap. See measureInk.
  //
  // The SIZE still comes from the white box, because the cap height a driver
  // reads is the height of the numeral and not of its shadow. Two boxes, two
  // jobs, and mixing them up is the mistake the gear readout's first
  // measurement made.
  {
    const feet = fy2a(WHEEL_INK_TOP - CD_CLEAR);
    const cap = CD_CAP * AH;
    const mir = flip ? -1 : 1;
    for (const c of CD_CELL) {
      const s = cap / c.ink.h;                       // art px per atlas px
      c.hw = c.w * 0.5 * s; c.hh = c.h * 0.5 * s;
      c.px = fx2a(CD_FX) - mir * ((c.ink.left + c.ink.right + 1) * 0.5 - c.w * 0.5) * s;
      c.py = feet - ((c.ink.all.bot + 1) - c.h * 0.5) * s;
      c.u0 = c.x / ATLAS_W; c.u1 = (c.x + c.w) / ATLAS_W;
      c.v0 = 1 - c.y / ATLAS_H; c.v1 = 1 - (c.y + c.h) / ATLAS_H;
    }
  }

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
  //
  // AND THE BRAKE PEDAL IS NOT FITTED WITH IT. It is pinned to the SCREEN, in
  // fractions of the viewport, because the region it hints at is: a touch is a
  // brake because of where it lands on the glass, and PEDAL_TOP and PEDAL_W are
  // fractions of the glass. Put the pedal in art space and the cover-fit would
  // slide it out from under its own touch area on any screen that is not 2.4:1
  // — at 16:9 the art is cropped 13% each side, which is 190 device pixels of
  // drift on the owner's phone. See layoutControls.
  //
  // THE BOOST SWITCH IS THE OTHER WAY ROUND AND THAT IS THE POINT OF IT. It is
  // in ART space, fitted with the dashboard, because it IS the dashboard — it
  // is screwed to the fascia under the boost lamp and it has to travel with the
  // lamp on every screen shape there is. It is not the boost target and never
  // was: boost is a touch anywhere in the bottom-right region, unchanged, and
  // tools/controls.mjs drives the real page with real touches to prove it. The
  // nitrous bottle that used to stand in that corner was screen-pinned because
  // a bottle has nowhere on a dashboard it can honestly be; a switch does.
  const ART_A = ART_W / ART_H;
  let sx = 1, sy = 1, fitFor = -1;
  const setFit = (aspect) => {
    sx = Math.max(1, ART_A / aspect);
    sy = Math.max(1, aspect / ART_A);
    fitFor = aspect;
    layoutControls(aspect);
  };

  /**
   * WHERE THE BRAKE PEDAL GOES, IN SCREEN FRACTIONS, ALL OF IT DERIVED FROM
   * PEDAL_TOP AND PEDAL_W.
   *
   * THIS IS THE ONE THING IN HERE THAT MUST NOT BE ALLOWED TO DRIFT. The live
   * region is 40% of the width and 45% of the height in each bottom corner and
   * it is generous on purpose; the picture is a hint standing inside it and is
   * never the target. So every number below is a fraction OF THE REGION —
   * CTL_HF of its height, CTL_CXF of its width in from the screen edge, CTL_CYF
   * of its height down from PEDAL_TOP — and the region comes from the same two
   * exported constants main.js tests a touch against. Retune either and the art
   * follows; there is no second copy of the geometry to forget.
   *
   * THE WIDTH COMES OUT OF THE HEIGHT AND THE VIEWPORT'S SHAPE, not out of a
   * second fraction: a box given a width and a height in screen fractions is a
   * box whose aspect changes with the phone, and a pedal that is a pedal on one
   * device and a letterbox on the next is not a drawing, it is a stretch. So
   * the height is fixed against the region and the width is whatever keeps the
   * cell square-on — which is why this is recomputed in setFit, where the
   * viewport's true aspect is known, and only there.
   *
   * IT DOES NOT MIRROR FOR LEFT-HAND DRIVE. Everything else in this file swaps
   * sides with the driver; the brake stays bottom-left in Calais exactly as it
   * does in Coventry, because readTouches does not swap either. The art has to
   * agree with the hit test, not with the steering wheel.
   */
  const ctlRect = new Float32Array(4);        // x0,y0,x1,y1 of the pedal, screen fx
  const layoutControls = (aspect) => {
    const regW = PEDAL_W, regH = 1 - PEDAL_TOP;
    const hy = CTL_HF * regH;                       // height, fraction of the screen
    const cy = PEDAL_TOP + CTL_CYF * regH;
    const put = (i, cx, cellW, cellH) => {
      const wx = (hy * (cellW / cellH)) / aspect;   // ...and the width that keeps it square-on
      ctlRect[i] = cx - wx * 0.5; ctlRect[i + 1] = cy - hy * 0.5;
      ctlRect[i + 2] = cx + wx * 0.5; ctlRect[i + 3] = cy + hy * 0.5;
    };
    put(0, CTL_CXF * regW, PED_W, PED_H);           // the pedal, bottom left
  };

  /**
   * Write one screen-pinned quad's corners. No sx, no sy and no rotation: a
   * fraction of the viewport is already a normalised device coordinate once it
   * has been doubled and shifted, whatever shape the viewport is.
   */
  const placeCtl = (q) => {
    const b = (q - Q_PEDAL) * 4;
    const x0 = 2 * ctlRect[b] - 1, y0 = 1 - 2 * ctlRect[b + 1];
    const x1 = 2 * ctlRect[b + 2] - 1, y1 = 1 - 2 * ctlRect[b + 3];
    const j = q * 12;
    pos[j] = x0; pos[j + 1] = y0; pos[j + 2] = 0;                 // top-left
    pos[j + 3] = x1; pos[j + 4] = y0; pos[j + 5] = 0;             // top-right
    pos[j + 6] = x1; pos[j + 7] = y1; pos[j + 8] = 0;             // bottom-right
    pos[j + 9] = x0; pos[j + 10] = y1; pos[j + 11] = 0;           // bottom-left
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
  const placeAll = () => {
    for (let q = 0; q < NQ; q++) {
      if (q >= Q_PEDAL) placeCtl(q); else placeQuad(q, angles[q]);
    }
  };
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
  // There was a LAMP_BRAKE here, 0xff4a3a, and it has gone with the brake's
  // half of the right-hand tell-tale. See the note in update().
  const LAMP_SHIFT = new Color(0xff3b2a);

  // Three needles now: the tacho, the speedo and the nitrous contents gauge.
  // All three start at the bottom of their sweep and all three are compared
  // against a `last` before anything is written.
  let needleA = -NEEDLE_SWEEP, needleB = -NEEDLE_SWEEP, needleN = NEEDLE_SWEEP;
  let lastW = 9, lastA = 9, lastB = 9, lastN = 9;
  let lampL = -1, lampR = -1, gearShown = -1, gearLow = -1;
  // The clock's last shown state, so a frame where nothing ticked writes
  // nothing. Four digits and a tag; -1 means "not yet drawn".
  const lcdShown = new Int8Array(4).fill(-1);
  let tagShown = -1, cdShown = -2, pedalShown = -1, switchShown = -1;

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
   * SLIDE ONE QUAD ALONG A STRIP OF EQUAL CELLS. Four of the things in this
   * cockpit change picture rather than position — the gear numeral, each clock
   * digit, the brake pedal and the boost switch's bat — and all four are the
   * same eight floats written into the u coordinates. One function, because
   * four copies of this arithmetic is four places for an off-by-one to hide.
   */
  const pointU = (q, x0, cellW) => {
    const u0 = x0 / ATLAS_W, u1 = (x0 + cellW) / ATLAS_W;
    const b = q * 8;
    uv[b] = u0; uv[b + 2] = u1; uv[b + 4] = u1; uv[b + 6] = u0;
    uvAttr.needsUpdate = true;
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
    pointU(Q_GEAR, DIG_X + k * DIG_STRIDE, DIG_W);
  };

  /**
   * Point one clock digit at one of the ten seven-segment cells.
   *
   * The four digit quads all read the same strip, so a clock is four of these
   * and no more atlas than one digit needed. -1 blanks the place by pointing
   * it at nothing on screen — see setLcdLit, which does it with a tint instead,
   * because a tint is twelve floats and a blank cell would be eleven cells.
   */
  const setDigit = (place, n) => {
    const k = n < 0 ? 0 : n > SEG_N - 1 ? SEG_N - 1 : n;
    pointU(Q_LCD0 + place, SEG_X + k * SEG_STRIDE, SEG_W);
  };

  /**
   * Show one of the countdown's cells, or nothing at all.
   *
   * NOTHING AT ALL IS A COLLAPSED QUAD, not a blank cell and not a transparent
   * tint: the corners go to zero, the two triangles have no area, and the
   * rasteriser walks straight past them. It is twelve floats written twice a
   * race — once when the lights go out and once when the next race is armed.
   */
  const setCount = (k) => {
    if (k < 0) {
      setQuad(Q_COUNT, 0, 0, 0, 0, 0, 0);
      placeQuad(Q_COUNT, 0);
      posAttr.needsUpdate = true;
      return;
    }
    const c = CD_CELL[k];
    const b = Q_COUNT * 8;
    uv[b] = c.u0; uv[b + 1] = c.v0;
    uv[b + 2] = c.u1; uv[b + 3] = c.v0;
    uv[b + 4] = c.u1; uv[b + 5] = c.v1;
    uv[b + 6] = c.u0; uv[b + 7] = c.v1;
    uvAttr.needsUpdate = true;
    setQuad(Q_COUNT, c.px, c.py, -c.hw, -c.hh, c.hw, c.hh);
    placeQuad(Q_COUNT, 0);
    posAttr.needsUpdate = true;
  };

  paintQuad(Q_LAMP_L, LAMP_OFF);
  paintQuad(Q_LAMP_R, LAMP_OFF);
  paintQuad(Q_GEAR, GEAR_LIT);
  for (let k = 0; k < 4; k++) paintQuad(Q_LCD0 + k, LCD_LIT);
  paintQuad(Q_TAG, LCD_DIM);
  setCount(-1);
  // The switch starts UP, which is the idle position, and the gauge starts
  // FULL. Both are what a car that has not been driven yet looks like, and
  // both are what a state object with no boostLeft on it will keep showing.
  pointU(Q_SWITCH, SWH_X, SWH_W);
  placeQuad(Q_NDL_N, needleN);

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

    /**
     * HOW MUCH NITROUS IS LEFT, 0 to 1, and UNDEFINED MEANS FULL.
     *
     * main.js is growing a boost budget and will put `boostLeft` on the state
     * object; until it lands there is no budget and the bottle is notionally
     * untouched, so the gauge reads full. The alternative — defaulting to zero,
     * or leaving the needle wherever it was — would be an instrument reporting
     * a bug that is not there, and this project has already shipped a fuel
     * meter that was called broken by a test matching the wrong thing.
     *
     * Clamped rather than trusted. A budget that overshoots by a rounding error
     * must not push the needle off the end of its own dial.
     */
    const nos = clamp(s.boostLeft != null ? s.boostLeft : 1, 0, 1);

    const wantA = -NEEDLE_SWEEP + clamp(rev, 0, 1) * 2 * NEEDLE_SWEEP;
    const wantB = -NEEDLE_SWEEP + kmh * 2 * NEEDLE_SWEEP;
    const wantN = -NEEDLE_SWEEP + nos * 2 * NEEDLE_SWEEP;
    // A needle has mass. A fraction per frame rather than per second, because a
    // needle is cosmetic and tying it to dt would mean passing dt in for it.
    needleA += (wantA - needleA) * 0.28;
    needleB += (wantB - needleB) * 0.22;
    needleN += (wantN - needleN) * NOS_SMOOTH;

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
    // AND THE CONTENTS GAUGE, on exactly the same terms as the other two: it is
    // compared against what it last drew and writes nothing at all on a frame
    // where the level has not moved, which — for a gauge whose number changes
    // only while the thumb is on the boost — is almost every frame there is.
    if (needleN > lastN + STILL || needleN < lastN - STILL) {
      angles[Q_NDL_N] = needleN; placeQuad(Q_NDL_N, needleN); lastN = needleN; moved = true;
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
    // tacho's side is the SHIFT LIGHT and the one on the driver's side is BOOST
    // — no third lamp, no new drawing, and the pair still mirrors correctly for
    // a left-hand-drive cockpit because both are placed through fx2a.
    //
    // IT LIGHTS WHEN THE NEEDLE ENTERS THE RED THE DIAL ALREADY DRAWS, at 0.80
    // of the sweep, and it is tested against the same displayed rev the needle
    // is driven by — including the 0.10 idle floor — so lamp and needle can
    // never disagree about where the red zone is. In raw engine revs that is
    // 0.778, a shade before main.js's limiter at 0.80: a shift light that
    // warns is worth more than one that reports.
    //
    // AND ONLY WHEN THERE IS SOMEWHERE TO SHIFT TO. In top gear at full
    // throttle the car sits near its limiter by definition — that is where the
    // engine and the drag balance — so this lit on every straight and stayed
    // lit, which Anthony reported as "flat out, fully boosted, way over 240mph,
    // centre of the road and the light is red". A tell-tale that is on whenever
    // you are going quickly is not telling you anything. The brief I wrote for
    // this said "light it when the revs enter the red" and never said the rest;
    // the code did exactly what it was asked.
    const gears = s.gears || 5;
    const shift = (rev >= 0.80 && gear < gears - 1) ? 1 : 0;
    if (shift !== lampL) { lampL = shift; paintQuad(Q_LAMP_L, shift ? LAMP_SHIFT : LAMP_OFF); }

    /**
     * THE RIGHT-HAND LAMP IS BOOST AND NOTHING ELSE, AND IT USED TO BE BOTH.
     *
     * It showed the brake in red OR the boost in amber, on one lens, which was
     * defensible while it was the only tell-tale the driver's side had. It
     * stopped being defensible the moment a BOOST SWITCH was screwed to the
     * fascia directly underneath it: a lamp that goes red for braking, sitting
     * an inch above a switch labelled by that lamp, is a switch that appears to
     * have three states and a lamp that lies about what the hardware under it
     * does.
     *
     * NOTHING IS LOST BY DROPPING THE BRAKE FROM IT. Braking is already told,
     * larger and nearer the thumb that is doing it, by the pedal in the corner
     * going down — which is a picture of the actual control moving, and is a
     * better tell-tale than a lamp on the far side of the dashboard. Two
     * signals for the brake and none for the switch was the wrong way round.
     */
    const bst = s.boosting ? 1 : 0;
    if (bst !== lampR) { lampR = bst; paintQuad(Q_LAMP_R, bst ? LAMP_BOOST : LAMP_OFF); }

    // ---- the brake pedal, and the boost switch ------------------------------
    //
    // A CONTROL THAT DOES NOT MOVE WHEN YOU PRESS IT IS A PICTURE OF A CONTROL,
    // and on a phone, where the thumb covers the thing it is pressing, the
    // movement is most of how you know the touch registered at all.
    //
    // Both are a cell away in the atlas, so a press is EIGHT FLOATS and a
    // release is eight more, written on the frame the state changes and on no
    // other frame. Nothing is drawn, uploaded or allocated: the pressed pedal
    // and the flicked-down bat were painted at boot and have been sitting in
    // the texture ever since.
    //
    // UP WHEN IDLE, DOWN WHEN BOOSTED, which is the owner's specification. Cell
    // 0 is up and cell 1 is down, so `bst` indexes the strip directly and the
    // same boolean drives the lamp above it — one state, two pictures of it,
    // and no way for the lamp and the switch to disagree.
    const brk = s.braking ? 1 : 0;
    if (brk !== pedalShown) { pedalShown = brk; pointU(Q_PEDAL, PED_X + brk * PED_STRIDE, PED_W); }
    if (bst !== switchShown) {
      switchShown = bst;
      pointU(Q_SWITCH, SWH_X + bst * SWH_STRIDE, SWH_W);
    }

    // ---- the race: the clock on the radio and the lights on the dash --------
    //
    // WHAT THE GLASS SHOWS, AND WHEN. A lap timer that only ever shows the
    // clock wastes the two moments the driver has time to read anything.
    //
    //   on the grid, and through the countdown   the personal best, BEST lit.
    //       This is the one time in a race when there is nothing to look at
    //       and everything to decide, and it is the only moment the number
    //       you are chasing is any use to you.
    //   racing                                   the clock, BEST dark
    //   the first three seconds after the line   what you just did
    //   the last three                           the best again, BEST lit,
    //       so the six seconds before the next countdown say both numbers
    //       without either of them flickering.
    //
    // AND A NEW BEST BLINKS. The two numbers are the same number on the run
    // that sets one, so alternating them would show no change at all at the
    // one moment something happened. A readout that flashes is what every
    // machine with a seven-segment display on it does when it wants you to
    // look, it needs no word and no colour the panel does not already have,
    // and it costs a tint on one quad twice a second.
    const r = s.race;
    let showT = 0, tagOn = 0;
    if (r) {
      if (r.state === 'racing') {
        showT = r.elapsed;
      } else if (r.state === 'done') {
        // WHETHER THIS RUN IS THE BEST IS ASKED OF THE TIME, NOT OF race.fresh.
        // main.js sets `fresh` when EITHER the time or the top speed is a
        // record, so a run that was slower than your best but faster through
        // one corner comes back fresh — and the readout would then have
        // blinked BEST at a time that is not the best, which is a readout
        // telling a lie in the one state it exists for. Comparing the two
        // numbers cannot be wrong about it.
        if (r.best != null && r.elapsed <= r.best + 1e-6) {
          showT = r.elapsed;
          // Once a second, lit for six tenths of it. Faster than that on a
          // display this size is a fault light rather than a celebration, and
          // it is also too fast to photograph honestly: a harness that has to
          // hit a 0.26-second window to catch the dark half of a blink will
          // sooner or later report a blink that has stopped working.
          tagOn = (r.t % 1) < 0.6 ? 1 : 0;
        } else if (r.t >= 3 && r.best != null) {
          showT = r.best; tagOn = 1;
        } else {
          showT = r.elapsed;
        }
      } else if (r.best != null) {
        showT = r.best; tagOn = 1;
      }
    }
    // Split into places arithmetically. No string, no toFixed, no allocation:
    // this runs sixty times a second for the whole race.
    let cs = showT > 0 ? (showT * 10 + 0.0001) | 0 : 0;
    if (cs > 5999 * 10 + 9) cs = 5999 * 10 + 9;      // the glass holds 9:59.9
    const tenths = cs % 10;
    const secs = ((cs / 10) | 0) % 60;
    const mins = (cs / 600) | 0;
    if (mins !== lcdShown[0]) { lcdShown[0] = mins; setDigit(0, mins); }
    const s10 = (secs / 10) | 0;
    if (s10 !== lcdShown[1]) { lcdShown[1] = s10; setDigit(1, s10); }
    const s01 = secs % 10;
    if (s01 !== lcdShown[2]) { lcdShown[2] = s01; setDigit(2, s01); }
    if (tenths !== lcdShown[3]) { lcdShown[3] = tenths; setDigit(3, tenths); }
    if (tagOn !== tagShown) { tagShown = tagOn; paintQuad(Q_TAG, tagOn ? LCD_LIT : LCD_DIM); }

    // THE LIGHTS. Cell 0 is the 3, cell 2 the 1, cell 3 the GO, and each
    // numeral holds for a third of whatever main.js says the countdown is —
    // read off race.countdown rather than assumed, because a countdown that
    // is retuned to four seconds must not leave the 1 on screen for two of
    // them. GO holds for CD_HOLD into the race and then the quad collapses.
    let cell = -1;
    if (r) {
      if (r.state === 'countdown') {
        const per = (r.countdown > 0 ? r.countdown : 3.2) / CD_N;
        const n = Math.ceil((r.countdown - r.t) / per);
        cell = CD_N - (n < 1 ? 1 : n > CD_N ? CD_N : n);
      } else if (r.state === 'racing' && r.t < CD_HOLD) {
        cell = CD_N;
      }
    }
    if (cell !== cdShown) {
      cdShown = cell;
      setCount(cell);
      if (cell >= 0) paintQuad(Q_COUNT, cell === CD_N ? CD_GO : CD_WAIT);
    }
  };

  return {
    group,
    update,
    atlas: canvas,
    // THE QUAD INDICES OF EVERYTHING THAT MOVES, exposed for the same reason
    // the atlas is: a harness collapses one of them to zero area and diffs the
    // frame against an untouched one, and the difference IS that part's true
    // footprint on the glass in device pixels. It is the only way to measure
    // what something covers rather than what the arithmetic above intended,
    // and it is how tools/pedalshots.mjs, tools/cdclear.mjs and
    // tools/nosdash.mjs all take their numbers.
    stats: { tris: NQ * 2, calls: 1, verts: NQ * 4,
             q: { pedal: Q_PEDAL, switch: Q_SWITCH, nos: Q_NDL_N,
                  count: Q_COUNT, wheel: Q_WHEEL } },
  };
}
