// Racer — performance skeleton.
//
// THIS IS NOT A GAME AND IS NOT TRYING TO BE. It is a road, a car, a camera and
// a speed, built so one question can be answered before anything else is:
//
//     does a flat-shaded 3D racer hold 60fps on a Helio A22 / PowerVR GE8320?
//
// The previous project answered that question at the END, after a fortnight,
// and the answer was no. So this one asks it in the first hour, with nothing in
// the scene worth defending.
//
// THE RULES THAT KEEP IT CHEAP — break these and the measurement is worthless:
//
//  1. NO LIGHTS. Not one. Every material is MeshBasicMaterial with a flat
//     colour, or vertex colours. Per-pixel lighting is exactly what made the
//     last project unplayable on this hardware. Shading is baked into vertex
//     colours at build time, which costs nothing at runtime and is also the
//     look we want.
//  2. NO SHADOWS, NO POST-PROCESSING, NO REFLECTIONS. Same reason.
//  3. FEW DRAW CALLS. The road is ONE mesh whose vertices are rewritten each
//     frame, not N segment meshes. Roadside objects are instanced.
//  4. NO PER-FRAME ALLOCATION in the hot path. Buffers are made once.
//
// Everything is generated in code. No models, no textures, no external files.

import {
  Scene, PerspectiveCamera, WebGLRenderer, Color, FogExp2,
  BufferGeometry, BufferAttribute, Mesh, MeshBasicMaterial,
  InstancedMesh, BoxGeometry, Matrix4, DoubleSide, Group,
  CanvasTexture, SRGBColorSpace, RepeatWrapping,
} from 'three';

import { inkGroup, buildOutline, inkMaterial, pencilTexture, INK } from './art/toon.js';
import { buildBody } from './car/body.js';
import { buildFurniture } from './world/furniture.js';
import { buildGantry } from './world/gantry.js';
import { buildCockpit } from './car/cockpit.js';

// ---------------------------------------------------------------- constants

/** Road half-width in world units. */
const ROAD_W = 9;
/**
 * How far the ground extends either side of the road.
 *
 * Wide enough that it still reaches the edge of the frame at the distance where
 * fog has taken over, so the player never sees where it stops. Costs nothing:
 * it is the same four vertices whether they are 20 units apart or 700.
 */
const GRASS_W = 700;
/** Length of one road segment. Shorter = smoother curves, more vertices. */
const SEG_LEN = 6;
/** How many segments are drawn ahead. This IS the draw distance. */
const SEG_COUNT = 220;
/**
 * How many segments are drawn BEHIND the camera.
 *
 * The chase camera sits 12 units back and the road used to start at the car, so
 * everything between the camera and the car's own position was empty space —
 * visible as a wedge of bare sky along the bottom of the frame whenever the road
 * dropped away over a crest, and in first person almost all the time. Five
 * segments is 30 units, comfortably past the camera at its furthest.
 */
const BEHIND = 5;
/** Width of the line drawn along seams in the ground, in world units. */
const GROUND_INK = 0.10;
/** How far off the centreline the car may stray. See the note at its use. */
const STRAY_MAX = 11.1;
/** How far ahead ground ink is drawn. Beyond this a line is under a pixel wide
 *  and crawls; the strips are still emitted, collapsed to zero width. */
const INK_SEGS = 90;
/**
 * How deep the city goes, and how many buildings share a segment.
 *
 * Derived from what is visible rather than from what fits in memory. Row r sits
 * ROAD_W + 8 + 11r units from the road, so row 8 is 96 units out — already off
 * the edge of the frame at any distance where fog has not eaten it. Budget past
 * that buys nothing and costs a matrix write per object per frame.
 */
const ROWS_MAX = 8;
const PER_SEG_MAX = 4;
/**
 * Where the fog swallows the road. Just short of the last segment, so the road
 * never visibly ends — it fades out instead.
 *
 * IT STARTS AT AN EIGHTH OF THE ROAD, NOT HALF, AND THAT IS AERIAL PERSPECTIVE
 * RATHER THAN WEATHER.
 *
 * Measured on ref/target-high.png, the drawing's mean luminance RISES with
 * distance — 45 in the near facades, 58 in the middle, 63 round the vanishing
 * point — because everything far away is drawn paler and bluer, toward the sky.
 * It is most of why its far city reads as a delicate grey skyline and ours read
 * as a black wall: at 0.45 the fog did not begin until 594 units and the whole
 * visible skyline sits inside that, so nothing in it faded at all.
 *
 * This is also the only lever that thins the far ink further. CITY_INK is a
 * material with fog:true, so the outlines fade toward the haze on exactly the
 * same curve as the buildings — a distant line goes grey rather than staying
 * black, which is what a pencil does and what no amount of geometry can fake.
 */
const FOG_FAR = SEG_LEN * SEG_COUNT * 0.98;
/**
 * IT IS EXPONENTIAL FOG NOW, AND THAT IS NOT A TASTE DECISION.
 *
 * Linear fog has a distance where it reaches 100% and past that the world is a
 * flat wall of haze with nothing in it. To lift our far city from luminance 48
 * to the drawing's 63 with a linear ramp, that wall had to land at about 690
 * units — half the road — and the vanishing point would have gone from a black
 * silhouette to an empty blue one. Exp2 never quite arrives: at this density it
 * is 5% at 100 units, 18% at 200, 55% at 400 and 96% at 800, so the deep
 * skyline keeps a trace of structure at very low contrast, which is exactly
 * what the drawing has round its vanishing point.
 */
const FOG_DENSITY = 0.0030;

/**
 * Top speed, world units/sec. ADJUSTABLE AT RUNTIME by the SPEED buttons,
 * because "how fast should it go" is a thing to measure on the device, not a
 * thing to argue about in a file. `SPEED_REF` is the speed the handling is
 * calibrated against, so winding the dial up genuinely makes corners harder
 * instead of silently rescaling the difficulty away with it.
 */
const SPEED_STEPS = [110, 140, 170, 210, 250, 300];
const SPEED_REF = 210;
// showBody / showCockpit exist for the measuring harnesses. Toggling `.visible`
// from outside does not work: this loop rewrites it every frame, so an external
// change lasts exactly one frame and the measurement silently reads nothing.
const tune = { si: 3, maxSpeed: SPEED_STEPS[3], driverX: 0, pitch: 1,
               showBody: true, showCockpit: true, freeze: false,
               // Chase camera, exposed so it can be SWEPT against the reference
               // rather than guessed at one rebuild per attempt.
               camY: 5.2, camZ: 11.0, aimY: 2.2,
               // STUDIO MODE. When set to {az, el, dist} the chase camera is
               // replaced by one orbiting the car, so a harness can photograph
               // it from the same angle as a reference drawing and compare the
               // two silhouettes. The frame loop owns the camera, so an
               // override has to live here — setting camera.position from
               // outside lasts exactly one frame.
               studio: null,
               // null to drive normally; a number pins the lateral position
               holdX: null };   // swept against ref/target-high.png  // driverX set below; pitch is 0..1 so the fix can be A/B measured

/** Multiplies the displayed number only. The physics is in world units; this
 *  is so the readout says something a driver recognises. Anthony is in the UK
 *  and asked for mph; this used to be KMH = 1.55, and 1.55 / 1.609 is what a
 *  mile is worth against the same world unit. A settings toggle later. */
const MPH = 0.9633;

/**
 * THE GEARBOX.
 *
 * Anthony: "The game would always start in 1st gear, red line and change up
 * using the speed buttons." He also said, days earlier, that the speed steps
 * "can eventually be gears", and this is that — the debug dial becomes the
 * gearstick, so a control that existed to test the engine becomes a control
 * that plays it.
 *
 * WHY IT IS WORTH THE COMPLICATION IN A FIRST-PERSON GAME. From the driver's
 * seat there is no car in frame to judge your speed against, so the dials are
 * the entire instrument panel of the thing. A rev counter that sweeps up and
 * drops on a shift is the strongest speed cue available and it costs
 * arithmetic rather than triangles. It is also what the garage will sell: an
 * engine upgrade changes these ratios and this redline, and you both feel it
 * and watch it happen.
 *
 * Each entry is the fraction of the car's top speed that gear can reach. The
 * limiter is that speed — sit in third at full throttle and you stay at 64%
 * of what the car can do until you pull the lever.
 */
const GEARS = [0.30, 0.47, 0.64, 0.82, 1.00];
/** Where the tacho's red zone starts. Matches `red: 0.80` on the dial face in
 *  cockpit.js, because a redline the dial does not draw is not a redline. */
const REDLINE = 0.80;
/**
 * Torque against revs, as a multiplier on acceleration. Flat to half revs,
 * then falling away to a third at the limiter — which is what makes holding a
 * gear too long slower than shifting, without needing a rule that says so.
 */
// A REAL POWER BAND, WITH A BOTTOM AS WELL AS A TOP. The first curve was flat
// below half revs, so shifting early cost nothing and the measured spread
// between driving well and driving stupidly came out at 14% — a gearbox you
// cannot get wrong is a gearbox not worth having. An engine makes little torque
// when it is labouring, and that is what makes an early shift a mistake.
// THE TOP OF THE CURVE IS FLATTER THAN IT WAS, and that is the fix for a fault
// the recovery measurement found: DOWNSHIFTING WAS THE WRONG MOVE. Recovering
// from 75mph to 190 took 11.3s left in top gear against 12.8s starting in third,
// which is the opposite of how a car behaves.
//
// The cause was this line falling to 33% of peak at the limiter. Every upshift
// lands you at roughly 78% revs, so a car climbing back through the box spent
// its whole time in the weak part of the curve — third gear's near-double
// acceleration at 75mph (28.8 against 16.6) was handed straight back.
//
// Real engines hold far more than a third at the top, and a big lazy muscle
// V8 least of all. Swept, with drag re-derived each time so top speed is held
// at 202mph by construction:
//
//   torque at the limiter   33% (before)   top gear wins by 1.5s
//                           55%            downshift wins by 0.5s
//                           70% (now)      downshift wins by 1.5s
//                           80%            downshift wins by 2.1s
//
// 70% makes a downshift clearly the right answer without making the box a
// formality, and it suits the engine this car is meant to have.
const torque = (rev) => (rev < 0.5
  ? 0.42 + 0.58 * (rev / 0.5) ** 0.8
  : 1 - 0.30 * ((rev - 0.5) / 0.5) ** 1.4);
/**
 * Acceleration at full torque in TOP gear, world units per second squared.
 * Divided by the gear ratio in the loop, so first gear pulls 1/0.30 as hard —
 * which is the whole reason a gearbox exists, and the thing my first attempt
 * got backwards.
 *
 * THE FIRST ATTEMPT WAS EXACTLY WRONG AND THE HARNESS CAUGHT IT. I reused the
 * old approach-a-ceiling law per gear, rate = gearTop / (REACH_90 * g) * K, and
 * the g cancels against gearTop — so every gear pulled identically, and because
 * a low gear's ceiling is near, its (1 - speed/gearTop) term collapsed first.
 * Low gears accelerated WORSE than high ones. tools/gearbox.mjs measured
 * shifting far too early at 15.3s against shifting on the limiter at 48.0s: the
 * fastest way round the track was to skip the gears, which is the opposite of a
 * car. I would not have found that by driving it.
 */
const ENGINE = 20;
/**
 * How hard rough ground pulls you back, per second, at full stray. Applied as
 * OFFROAD_DRAG * off * speed, so it is a fraction of your speed per second
 * rather than a fixed number of units — see the note at the call site.
 *
 * 0.8 was chosen against the terminal speeds it produces rather than by feel,
 * since "how bad should it be" is only answerable as "what does it leave you
 * doing". tools/offroad.mjs prints those.
 */
const OFFROAD_DRAG = 0.17;
/**
 * ...and how sharply it bites as you go further off. NOT linear, which is what
 * I wrote first and what the measurement threw out: a linear coefficient still
 * produces a wildly non-linear result, because terminal speed solves
 * push = drag*v^2 + k*v, and even a small k dominates at 200mph. Clipping the
 * verge by half a unit settled the car at 81mph, down from 202. That is not a
 * warning, it is a crash without the crash.
 *
 * Raising `off` to the power 1.5 puts the gentleness where a driver needs it —
 * at the edge, where mistakes are small and constant — while keeping the far
 * verge genuinely expensive.
 */
const OFFROAD_BITE = 1.5;

/**
 * Seconds from a standstill to 90% of the current top speed.
 *
 * ACCELERATION IS EXPRESSED AS A TIME, NOT A FORCE, and that is the fix for a
 * real bug rather than a stylistic preference. The old model was a constant
 * push of 42 fought by a quadratic drag, which balance out at sqrt(ACCEL*cap/
 * DRAG) — so the car topped out at 145 against a "top speed" of 210, and at 173
 * against 300. The top speed was not a top speed, it was a number the car
 * approached and never reached, and the higher steps of the speed dial were
 * very nearly decorative: 300 and 250 differed by 9%.
 *
 * Expressed as a time, every step of the dial is genuinely reachable and every
 * step takes the same five seconds to get there, so the dial measures the thing
 * it claims to measure.
 */
const REACH_90 = 5.0;
const ACCEL_K = 2.302585;        // ln(10); gets you to 90% in REACH_90 seconds
const BRAKE = 90;
/** Holding the boost lifts the ceiling and the acceleration. A preview of
 *  nitrous: it exists now mainly to give the brake something to argue with. */
const BOOST_TOP = 1.35;
const BOOST_ACCEL = 1.9;
/** Braking tightens the line. THIS is why an arcade racer has a brake — not
 *  "go slower" but "get round", which is a thing you choose to do rather than
 *  a punishment for going fast. */
const BRAKE_GRIP = 1.55;
/**
 * Lateral metres per second at full lock, at full speed.
 *
 * TUNED AGAINST THE ROAD, NOT PICKED. The road is 18 wide. The first value put
 * full lock at 28/sec, which crosses the whole road in 0.64s — that is a
 * cursor, not a car, and it was reported from the phone as "staying on the
 * track is difficult". At 11 a full-lock crossing takes 1.6s, which is enough
 * time to see what you are doing and change your mind.
 */
/**
 * Where the driver sits, in car space. POSITIVE IS RIGHT-HAND DRIVE.
 *
 * Anthony is in the UK and asked for right-hand drive, and it is worth doing
 * properly rather than centring the camera and putting the wheel on the right,
 * because the two are not the same thing: sitting off-centre means the nearside
 * and offside edges of the road are genuinely different distances away, and
 * that asymmetry is most of what makes a first-person view feel like being in a
 * car rather than floating above the bonnet.
 *
 * It does make the view very slightly harder to judge, which is realism working
 * as intended. Set to 0 for a centred arcade camera, or negate for left-hand
 * drive if the car is ever sold abroad.
 */
const DRIVER_X = 0.62;
tune.driverX = DRIVER_X;   // live, so the seating position can be A/B tested on the phone

const STEER_RATE = 11;
/** How fast the steering input itself moves. Lower = heavier, more deliberate. */
const STEER_LAG = 5.5;

/**
 * How much harder you can steer than the worst corner can push you.
 *
 * CENTRIFUGAL IS DERIVED FROM THIS, NOT CHOSEN. It used to be a hand-picked
 * 1.9, and the arithmetic of that was damning: the worst corner in the track
 * pushed at 49.5 units/sec against 11 units/sec of steering — 4.5 to 1 — which
 * made 20% of the track not "difficult" but literally unwinnable, at ANY speed,
 * by any player. It was reported from the phone as "full speed is impossible to
 * stay on the track when cornering", which was an understatement.
 *
 * A hand-picked constant cannot survive a change to STEER_RATE, to the top
 * speed, or to how corners are generated — and it did not. So the number is now
 * computed from the track's own worst curvature, and the thing that is chosen
 * is the RATIO, which is a statement about how the game should feel:
 *
 *   1.0 = you can exactly hold the racing line at full lock and do nothing else
 *   1.3 = the worst corner needs three quarters of your lock to hold
 *   2.6 = the worst corner needs a third of your lock, and the rest of the
 *         track needs about five percent — which is to say, nothing
 *
 * IT WAS 2.6, AND THAT WAS AN OVER-CORRECTION. Fixing a value that was 4.5x too
 * strong by making it 12x weaker landed somewhere just as wrong in the other
 * direction, and it was caught the same way: by measuring. Hands off the
 * controls entirely, at top speed, for 25 seconds, the car drifted to a worst
 * offset of 9.2 against a road edge at 9.0 — it never actually left. Reported
 * from the phone as "place the phone against the laptop so no steering and it
 * stays on the track, steers itself?!?", which is exactly what that number
 * means. A game that plays itself is a worse failure than one that cannot be
 * played, because it looks like it is working.
 *
 * At 1.25 the numbers say something a driver would recognise: the top two speed
 * steps cannot hold the hardest corners on the throttle, so those corners have
 * to be braked for. That is not a defect, it is the reason the brake exists —
 * and the tests below assert BOTH ends of it, that a corner is holdable with
 * the brake and that hands off the wheel puts you in the scenery.
 */
const CORNER_AUTHORITY = 1.25;
let CENTRIFUGAL = 0;   // derived once the track exists, see deriveHandling()

// A tight palette, chosen rather than defaulted. Six colours do the whole
// scene. This is the cheapest thing in graphics that reads as "designed".
/**
 * NEON NIGHT. Chosen by Anthony, and it is the one art direction where this
 * engine's biggest limitation turns into an advantage.
 *
 * We have no lights, so every surface is a flat unshaded colour. In almost any
 * style that is a handicap — it is exactly why the previous project's character
 * looked wrong. But a flat, unshaded, bright colour is PRECISELY what something
 * glowing looks like. A neon sign has no shading. A lit window has no shading.
 * So the effect a normal renderer has to fake with bloom and emissive maps, we
 * get by typing a bright hex value.
 *
 * MEASURED AGAINST ASPHALT 8 ON THE SAME PHONE, the old palette's problem was
 * not taste, it was quantity: 92% of our pixels were darker than luminance 60,
 * against 27-47% in their daylight and 61% in their TUNNEL. Their darkest scene
 * was brighter than our normal one, and we had 2% bright pixels to their 9-14%.
 *
 * So the rule here: the darks stay dark — a night scene needs them — but there
 * must be far MORE bright, and it must be saturated. Neon is not white light.
 */
const PAL = {
  // ---- MEASURED FROM ref/city-night.png, band by band -------------------
  //
  // The reference is a comic-book night city drawn in Anthony's chosen style,
  // and measuring it demolished two assumptions at once.
  //
  // It is NOT "dark with bright neon spots". It is UNIFORMLY mid-tone. Every
  // eighth of the frame, top to bottom, sits at luminance 52-58 — sky #112e5f
  // at 54, building faces #344250 at 56, road surface #263142 at 54. Only 1%
  // of its pixels are brighter than 170. The mood comes from being evenly lit
  // and low-contrast, not from a few glowing points in the dark.
  //
  // Ours was wrong at BOTH ends. The sky measured 27 against its 52 — far too
  // dark — while the road measured 88-93 against its 56, because I had lifted
  // the tarmac to fight an overall darkness that was really coming from the
  // sky. Fixing the wrong surface and then compensating on another is the same
  // trap as the cape albedo on the last project.
  //
  // And the night is BLUE, not purple. The purple was mine, not the reference's.
  skyTop: 0x16294f,
  skyMid: 0x1b3a6b,
  skyLow: 0x27497c,
  skyGlow:0x3a5f94,        // the city's own light, just above the rooftops
  haze:   0x3a5680,        // fog: distance goes toward the sky, not away from it

  road:   0x263142,        // measured straight off the reference
  roadAlt:0x2c384c,
  lane:   0xdfe4ea,
  ink:    0x0c0e16,        // the line the ground is drawn with
  edge:   0xe8ecf2,

  // THE GUTTER, WHICH USED TO BE A RUMBLE STRIP, AND THE RUMBLE STRIP WAS
  // MEASURABLY WRONG.
  //
  // The strip between the tarmac and the kerb was crimson #b3455f alternating
  // with white #e8ecf2 — luminance 99 and 236, saturation 62% and 4%. Sampled
  // across ref/city-night.png, perpendicular to the road edge, on both sides,
  // the reference has nothing remotely like it. From the tarmac outward it
  // reads:
  //
  //     road          #263142 - #28303d   lum 46-49   sat 34-40%
  //     gutter                            lum 60-77   sat 11-20%
  //     a bright nose line, 2px           lum 156-171 sat  5%
  //     kerb top                          lum 73-86   sat  6-14%
  //     a BLACK line, 5px                 lum  0-4
  //     pavement                          lum 100-130 sat  5-20%
  //
  // The most saturated thing at the road edge is the ROAD. Everything laid
  // beside it is grey — the edge is drawn with luminance and with black lines,
  // never with colour. A 236-luminance band was also, on its own, most of why
  // the near-road measured 29 points brighter than the reference.
  //
  // So the strip becomes a gutter: the same two quads, the same alternating
  // rhythm for the sense of speed, at luminance 59 and 65 with the saturation
  // pulled down to 20% — one step up from the tarmac rather than four. The
  // BRIGHT thing at the road edge is now the kerb behind it (furniture.js
  // C.kerb, luminance 96), which is what the reference does and what makes the
  // eye follow the road instead of skating off it.
  gutterA:0x363c44,
  gutterB:0x3c424b,
  // NOT A KERB ANY MORE. Kept because src/car/cockpit.js reads `pal.rumbleA`
  // for the rev counter's redline, which is a good use for a hot crimson and
  // the only remaining one. It paints nothing on the road.
  rumbleA:0xb3455f,

  grass:  0x1e2839,
  grassAlt:0x243047,

  car:    0x79bb35,        // lime green, measured from the Camaro reference
  carDark:0x46702e,
  glass:  0x2a3550,

  post:   0x4fb9a8,
  // The signs stay saturated but they are ACCENTS now, not the light source.
  // At 1% of the reference's pixels above luminance 170, brightness is
  // something this scene spends sparingly.
  neonA:  0xd94f7a,
  neonB:  0x3fbfae,
  neonC:  0xd9a441,
  neonD:  0x7a5cc4,
  window: 0xffe0a0,
  wall:   0x344250,        // measured: the building faces in the reference
};

// ------------------------------------------------------------------ helpers

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Flag a buffer attribute as changed, and say HOW MUCH of it changed.
 *
 * three.js re-uploads an entire attribute when needsUpdate is set. For an
 * InstancedMesh allocated for tens of thousands of instances that is megabytes
 * a frame to move a few hundred boxes. An update range sends only the prefix
 * that was actually written.
 *
 * The API was renamed: r158 and later have addUpdateRange/clearUpdateRanges,
 * earlier versions have a single updateRange object. Support both, because
 * getting it wrong silently uploads everything and looks like it worked.
 */
function mark(attr, count) {
  if (!attr) return;
  if (attr.clearUpdateRanges) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, count);
  } else if (attr.updateRange) {
    attr.updateRange.offset = 0;
    attr.updateRange.count = count;
  }
  attr.needsUpdate = true;
}


/**
 * The track, as a list of curvature and elevation per segment.
 *
 * Generated once, deterministically, from a seed. Curvature is in lateral
 * units per segment; elevation is world units. Both are smoothed, because a
 * step change in either reads as a kink rather than a corner.
 */
function buildTrack(n, seed) {
  let s = seed >>> 0;
  const rnd = () => {
    // xorshift32 — small, fast, good enough, and deterministic across machines
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };

  const curve = new Float32Array(n);
  const hill = new Float32Array(n);

  // Lay down features, then smooth. Building the smooth version directly is
  // possible but this way the FEATURES are readable in the code: a corner is a
  // corner, not an emergent property of a noise function.
  // ELEVATION HAS TO ACCUMULATE, and the first version did not.
  //
  // It wrote `hill[i] = h * e`, easing from 0 up to h across the feature — and
  // then the NEXT feature started from 0 again. So the road climbed 25 units
  // over a couple of hundred metres and then, between one segment and the next,
  // the ground was flat again. A 24.8-unit cliff, 25 times in 4000 segments.
  //
  // Reported from the phone as "when I go over bumps or ramps there is a flash
  // to the flat track, doesn't feel like I went up at all, more like I went
  // through the ramp". That is a precise description of driving off the top of
  // a ramp into a discontinuity: you climb, and then the climb is retracted.
  //
  // Curvature never had this problem because it uses sin(pi*t), which starts
  // and ends at zero. Elevation is not like curvature: it is a POSITION, not a
  // rate, so it has to carry forward. Each feature now eases from wherever the
  // road already is to a new target, and the next one starts from there.
  let elev = 0;
  let i = 0;
  while (i < n) {
    const kind = rnd();
    const len = 40 + Math.floor(rnd() * 90);
    let c = 0;
    if (kind < 0.34) { c = 0; }                                  // straight
    else if (kind < 0.72) { c = (rnd() * 2 - 1) * 0.055; }        // bend
    else { c = (rnd() < 0.5 ? -1 : 1) * (0.075 + rnd() * 0.05); } // hard corner

    // Where the road is heading. Bounded, or a random walk wanders off into
    // the sky and the fog has nothing left to hide.
    let target = elev;
    if (rnd() < 0.62) target = clamp(elev + (rnd() * 2 - 1) * 30, -55, 55);

    for (let k = 0; k < len && i < n; k++, i++) {
      // ease in and out of the feature so corners have entry and exit
      const t = k / len;
      const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      const ramp = Math.sin(Math.PI * t);
      curve[i] = c * ramp;
      hill[i] = elev + (target - elev) * e;
    }
    elev = target;
  }

  // The track loops, so the last segment sits next to the first. If the two are
  // at different heights that seam is one more cliff — the same bug, once per
  // lap. Ease the tail back down to where the start is.
  const TAIL = 260;
  const drop = hill[n - 1] - hill[0];
  if (Math.abs(drop) > 0.01) {
    for (let k = 0; k < TAIL; k++) {
      const j = n - TAIL + k;
      const t = k / TAIL;
      const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      hill[j] -= drop * e;
    }
  }

  return { curve, hill, n };
}

/**
 * Turn the track's worst corner into a centrifugal constant.
 *
 * Kept as a function next to the track so the two can never drift apart: change
 * how corners are generated and the handling recalibrates itself. Returns the
 * numbers as well, because they belong on the readout — a handling constant you
 * cannot see is a handling constant nobody checks.
 */
function deriveHandling(track) {
  let worst = 0;
  for (let i = 0; i < track.n; i++) {
    const c = track.curve[i] < 0 ? -track.curve[i] : track.curve[i];
    if (c > worst) worst = c;
  }
  // steer >= authority * push, at the reference speed, in the worst corner
  const cent = worst > 0 ? STEER_RATE / (CORNER_AUTHORITY * worst * SPEED_REF) : 0;
  return { worst, cent };
}

// ------------------------------------------------------------------- road

/**
 * The road, drawn as ONE mesh that is rewritten every frame.
 *
 * WHY ONE MESH. The obvious build is a pool of segment meshes moved into
 * place, which is 220 draw calls a frame. This is 1. On a GE8320 draw calls
 * are the scarcest thing there is, so the whole scene is built to keep them in
 * single figures.
 *
 * Each segment contributes four quads: road, left verge, right verge, and the
 * rumble strips are drawn as part of the verge colour rather than as extra
 * geometry. Colour lives in vertex colours, which is how we get "shading" with
 * no lights at all.
 */
class Road {
  constructor(scene) {
    // road, left verge, right verge, left apron, right apron, centre dashes
    // road, verge L, verge R, dash, apron L, apron R, then SIX INK STRIPS:
    // both road edges, both verge edges, and both sides of the centre dash.
    const quads = (SEG_COUNT + BEHIND) * 12;
    const verts = quads * 4;
    const idx = quads * 6;

    this.pos = new Float32Array(verts * 3);
    this.col = new Float32Array(verts * 3);
    const index = new Uint16Array(idx);

    // Index buffer never changes: quad q uses verts 4q..4q+3.
    for (let q = 0; q < quads; q++) {
      const v = q * 4, o = q * 6;
      index[o] = v; index[o + 1] = v + 1; index[o + 2] = v + 2;
      index[o + 3] = v; index[o + 4] = v + 2; index[o + 5] = v + 3;
    }

    // Every quad starts life collapsed and out of sight, so any quad the
    // per-frame loop chooses to skip stays invisible rather than holding
    // whatever it happened to contain last.
    for (let v = 0; v < verts; v++) { this.pos[v * 3 + 1] = -9999; }

    const g = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3);
    this.colAttr = new BufferAttribute(this.col, 3);
    this.posAttr.setUsage(35048);   // DynamicDraw — rewritten every frame
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    g.setIndex(new BufferAttribute(index, 1));
    // No bounding sphere maths every frame: the road is always in front of the
    // camera by construction, so frustum culling it is pure cost.
    g.boundingSphere = null;

    const m = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: true });
    this.mesh = new Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    scene.add(this.mesh);

    this._c = new Color();
  }

  /** Write one quad's four corners and its flat colour. */
  _quad(q, x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4, hex, shade) {
    const p = this.pos, c = this.col;
    let o = q * 12;
    p[o] = x1; p[o + 1] = y1; p[o + 2] = z1;
    p[o + 3] = x2; p[o + 4] = y2; p[o + 5] = z2;
    p[o + 6] = x3; p[o + 7] = y3; p[o + 8] = z3;
    p[o + 9] = x4; p[o + 10] = y4; p[o + 11] = z4;
    this._c.setHex(hex);
    const r = this._c.r * shade, g = this._c.g * shade, b = this._c.b * shade;
    o = q * 12;
    for (let k = 0; k < 4; k++) { c[o] = r; c[o + 1] = g; c[o + 2] = b; o += 3; }
  }

  /**
   * Rebuild the visible road.
   * `base` is the segment index under the camera, `frac` the fraction through
   * it — together they make the road slide smoothly rather than jump a whole
   * segment at a time.
   */
  update(track, base, frac, camX, baseY) {
    let x = 0, dx = 0;          // accumulated lateral offset from curvature
    let q = 0;
    // THE ROAD RUNS INTO NEGATIVE Z. A three.js camera looks down its own -Z,
    // so segments laid out at +Z are BEHIND it — the first build of this drew
    // the whole road out of shot and rendered a car in an empty room. `frac`
    // slides the whole ribbon toward the camera as the car advances through a
    // segment, which is what makes the motion continuous instead of stepping a
    // segment at a time.
    const zOff = frac * SEG_LEN;

    // The ribbon starts BEHIND the camera. Because lateral offset is a running
    // double-integral of curvature, starting the walk earlier shifts every x by
    // a constant — so walk the behind-segments once first to find what that
    // constant is, and subtract it. Without this the whole road slides sideways
    // by however much the last few segments curved.
    let px = 0, pdx = 0;
    for (let i = 0; i < BEHIND; i++) {
      const a = (((base - BEHIND + i) % track.n) + track.n) % track.n;
      pdx += track.curve[a] * SEG_LEN;
      px += pdx;
    }

    for (let j = 0; j < SEG_COUNT + BEHIND; j++) {
      const i = j - BEHIND;
      const a = (((base + i) % track.n) + track.n) % track.n;
      const b = (((base + i + 1) % track.n) + track.n) % track.n;

      const z1 = zOff - i * SEG_LEN;
      const z2 = z1 - SEG_LEN;
      const y1 = track.hill[a] - baseY;
      const y2 = track.hill[b] - baseY;

      // `px` re-anchors the walk so the camera's own segment sits at x = 0,
      // exactly as it did when the ribbon started there.
      const x1 = x - px - camX;
      dx += track.curve[a] * SEG_LEN;
      x += dx;
      const x2 = x - px - camX;

      // Alternating tarmac, which is most of the sense of speed. A road of one
      // flat colour has nothing to move past you. Keyed off the wrapped segment
      // index so it does not flip phase when the walk starts before segment 0.
      const alt = (a >> 1) & 1;
      const road = alt ? PAL.road : PAL.roadAlt;
      const verge = alt ? PAL.gutterA : PAL.gutterB;

      // Fake distance shading: darken with depth. This is what a fog colour
      // does for free, but doing it in vertex colour too keeps the near road
      // from looking flat. Clamped at 0 so segments behind the camera do not
      // come out brighter than the road in front of it.
      const shade = 1 - 0.35 * (Math.max(0, i) / SEG_COUNT);

      this._quad(q++,
        x1 - ROAD_W, y1, z1, x2 - ROAD_W, y2, z2,
        x2 + ROAD_W, y2, z2, x1 + ROAD_W, y1, z1, road, shade);

      // THE GUTTER. Two quads, one each side, between the tarmac and the kerb.
      //
      // They were 2.4 wide each side against a 9 half-width — 21% of the road
      // painted bright — and measurement put the near-road band 29 luminance
      // points above the reference. Narrowing them to 1.1 fixed the area; see
      // PAL.gutterA for what fixed the colour. 1.1 is kept because it is the
      // width the kerb in furniture.js starts at, and the two must butt.
      const vw = 1.1;
      this._quad(q++,
        x1 - ROAD_W - vw, y1, z1, x2 - ROAD_W - vw, y2, z2,
        x2 - ROAD_W, y2, z2, x1 - ROAD_W, y1, z1, verge, shade);
      this._quad(q++,
        x1 + ROAD_W, y1, z1, x2 + ROAD_W, y2, z2,
        x2 + ROAD_W + vw, y2, z2, x1 + ROAD_W + vw, y1, z1, verge, shade);

      // THE DASHED CENTRE LINE.
      //
      // One more quad per segment, and it is the cheapest speed cue in the
      // whole game: something passing UNDER you at a fixed rate, which is what
      // the eye actually measures ground speed against. The verges do some of
      // this already but they are at the edge of vision; the dashes are dead
      // centre where you are looking.
      //
      // The dash is drawn every segment either way and simply painted road
      // colour on the gaps. Skipping the geometry instead would mean a variable
      // number of quads per frame, and the whole point of this mesh is that its
      // size never changes.
      const onDash = (a % 4) < 2;
      const LANE_W = 0.30;
      this._quad(q++,
        x1 - LANE_W, y1 + 0.012, z1, x2 - LANE_W, y2 + 0.012, z2,
        x2 + LANE_W, y2 + 0.012, z2, x1 + LANE_W, y1 + 0.012, z1,
        onDash ? PAL.lane : road, shade);

      // ---- INK ON THE GROUND ----------------------------------------------
      //
      // Two verifier agents, working on different files, independently called
      // this the biggest remaining gap. Measured: the bottom quarter of our
      // frame is 18% near-black against 56-57% in both target images, and the
      // ground mesh contained ZERO near-black vertices across every one of the
      // 3,380 it draws. Kerb, road edge, crossing bands, lane lines — all butt-
      // joined colour fields with nothing between them, where the reference
      // draws a black line along every one.
      //
      // An inverted hull cannot help here: these are coplanar surfaces, not
      // silhouettes. The line has to be its own thin strip laid on the seam.
      //
      // NEAR FIELD ONLY. A 0.10-unit strip is about five pixels wide at the
      // bonnet and a third of a pixel at the horizon, and a third of a pixel of
      // black crawls and shimmers as the road moves under it. Past INK_SEGS the
      // strips are emitted collapsed — the buffer is a fixed size, so they have
      // to be emitted either way, and zero-width costs nothing to rasterise.
      // SKIP, DO NOT COLLAPSE. The first version emitted every ink strip every
      // frame and set its width to zero past INK_SEGS, which draws nothing but
      // still writes 24 floats per quad. Profiling put the road at 37% of all
      // our per-frame JavaScript with 810 of its 2,700 quads being these
      // invisible ones — a cost I added an hour ago and did not measure.
      //
      // A zero-area quad is invisible wherever it happens to be, so the far
      // ones are written ONCE at construction, parked, and never touched again.
      // `q` still has to advance past them to keep every quad at a fixed index.
      const inking = i >= 0 && i < INK_SEGS;
      if (!inking) { q += 6; }
      const iw = GROUND_INK;
      const seam = (cx0, cx1) => inking && this._quad(q++,
        x1 + cx0 - iw, y1 + 0.006, z1, x2 + cx1 - iw, y2 + 0.006, z2,
        x2 + cx1 + iw, y2 + 0.006, z2, x1 + cx0 + iw, y1 + 0.006, z1,
        PAL.ink, shade);
      seam(-ROAD_W, -ROAD_W);                 // left road edge
      seam(ROAD_W, ROAD_W);                   // right road edge
      seam(-ROAD_W - vw, -ROAD_W - vw);       // left verge edge
      seam(ROAD_W + vw, ROAD_W + vw);         // right verge edge
      // The dash gets a line down each side, which is what stops it reading as
      // a glowing bar and starts it reading as painted marking.
      const dw = onDash ? LANE_W : 0;
      seam(-dw, -dw);
      seam(dw, dw);

      // THE GROUND IS PART OF THE ROAD MESH, and it has to be.
      //
      // There used to be one big flat plane at y=0 for the ground, and it was
      // wrong in both directions at once. Over a crest the road climbs above it
      // and you see sky underneath the tarmac — a road visibly floating in mid
      // air. In a dip the road drops BELOW it and the plane draws over the road,
      // hiding where you are about to drive.
      //
      // A separate ground mesh can only track a road that undulates by being
      // rebuilt to match it — at which point it is this. So it is this: two more
      // quads per segment, at exactly the road's own height, extending past the
      // horizon. Same single draw call, and the two can never come apart.
      // Banded like the tarmac. The ground fills the outer half of the frame,
      // which is where peripheral vision reads speed from — a single flat colour
      // out there has nothing moving in it. Kept deliberately subtle: strong
      // bands in the periphery strobe rather than flow.
      const ground = alt ? PAL.grass : PAL.grassAlt;
      this._quad(q++,
        x1 - ROAD_W - GRASS_W, y1, z1, x2 - ROAD_W - GRASS_W, y2, z2,
        x2 - ROAD_W - vw, y2, z2, x1 - ROAD_W - vw, y1, z1, ground, shade);
      this._quad(q++,
        x1 + ROAD_W + vw, y1, z1, x2 + ROAD_W + vw, y2, z2,
        x2 + ROAD_W + GRASS_W, y2, z2, x1 + ROAD_W + GRASS_W, y1, z1, ground, shade);
    }

    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}

// ------------------------------------------------------------------- car

// ------------------------------------------------------- roadside markers

/**
 * Posts down both verges. They exist for ONE reason: sense of speed.
 *
 * The road itself is a smooth ribbon, and a smooth ribbon moving under you
 * reads as almost stationary. Something with hard edges whipping past at the
 * side of vision is most of what makes a racer feel fast — which is why every
 * arcade racer ever made has trees, poles or bollards at the roadside.
 *
 * One InstancedMesh, so all of them together are a single draw call.
 */
class Posts {
  constructor(scene, count) {
    const geo = new BoxGeometry(0.35, 2.2, 0.35);
    const mat = new MeshBasicMaterial({ color: PAL.post, fog: true });
    this.mesh = new InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.count = count;
    this.m = new Matrix4();
    scene.add(this.mesh);
  }

  update(track, base, frac, camX, baseY) {
    const every = 5;   // one post every N segments, both sides
    let n = 0;
    let x = 0, dx = 0;
    const zOff = frac * SEG_LEN;                 // into -Z, as the road does
    for (let i = 0; i < SEG_COUNT && n < this.count - 1; i++) {
      const a = (base + i) % track.n;
      dx += track.curve[a] * SEG_LEN;
      x += dx;
      if ((base + i) % every !== 0) continue;
      const z = zOff - i * SEG_LEN;
      const y = track.hill[a] - baseY + 1.1;
      for (const s of [-1, 1]) {
        this.m.makeTranslation(x - camX + s * (ROAD_W + 3.6), y, z);
        this.mesh.setMatrixAt(n++, this.m);
      }
    }
    // Park the unused instances far below the world rather than resizing.
    for (; n < this.count; n++) {
      this.m.makeTranslation(0, -9999, 0);
      this.mesh.setMatrixAt(n, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- scenery

/**
 * NEAR-BLACK, not black. The ink carries a trace of the night sky in it so it
 * belongs to the same palette as everything else — the same reasoning as
 * toon.js's 0x0a0a10, one step bluer because the city is further away and sits
 * in more haze.
 */
const CITY_INK = 0x0d1119;

/**
 * A PEN NIB DOES NOT KNOW HOW FAR AWAY THE BUILDING IS.
 *
 * Measured against ref/target-high.png, the drawing's ink runs at a median
 * width of 2px on the near facades, 1px in the middle distance and 1px at the
 * vanishing point. It barely varies, because it was drawn with one pen. Ours
 * ran 3, 2, 3 — and the 3 at the vanishing point is the interesting one,
 * because it means our far city was not being outlined, it was being filled in.
 *
 * AN INVERTED HULL CAN BE MADE SCREEN-CONSTANT WITHOUT A SHADER, and this is
 * the number that does it. The hull is not a scaled copy of the building; its
 * matrix is built separately as (w + 2t, h + 2t, d + 2t), so `t` is a free
 * variable we can set per instance per frame. A world-space length t at eye
 * distance D covers
 *
 *     pixels = t / (D * tan(hFov / 2)) * (viewportWidth / 2)
 *
 * so setting t = k * D makes the pixel width independent of D. With the game's
 * horizontal field of view around 90 degrees at speed, tan(hFov/2) is about 1
 * and a 1024-wide frame gives pixels = 512 * k. k = 0.0033 is therefore a line
 * about 1.7px wide at every depth in the city.
 *
 * WHAT IT CANNOT DO, honestly. `t` is chosen once per instance, so the width is
 * constant over one building rather than over one line: the top of a near
 * tower is further from the eye than its base and gets the width of its
 * centre. That error is at most about 15% on the tallest thing next to you and
 * zero everywhere else. Genuinely per-pixel constant width needs the vertex
 * shader, which this project does not have. Per instance is close enough that
 * the measurement cannot see the difference; per object was not.
 *
 * The field of view opens from 74 to 94 degrees with speed, so the line is
 * about 15% finer when you are flat out. A pen nib does not know how fast you
 * are going either, but neither does anything else in the frame, and correcting
 * it would mean reading the camera in here every frame for a fifth of a pixel.
 */
const INK_PX_PER_UNIT = 0.0033;

/**
 * Where the eye is, in the car-relative space the scenery is placed in.
 *
 * The chase camera sits at (0, 5.2 + a bit of speed lift, 11 + a bit more) and
 * the first-person eye at (+/-0.9, 1.6, 1.2). Only the ink width reads this,
 * and the difference between the two views is a fifth of a pixel on the
 * nearest building, so it is a constant rather than a parameter — which keeps
 * Scenery.update's signature, and main.js's call to it, exactly as it was.
 */
const EYE_Y = 5.4, EYE_Z = 11.5;

/**
 * The distance at which a building is half-way to being the average building.
 *
 * See Scenery.update: the instance tint is lerped toward the city's mean with
 * distance, which is aerial perspective applied to CONTRAST where the fog
 * applies it to TONE. 220 units is about six segments short of where the fog
 * itself becomes obvious, so the two overlap rather than switching over.
 */
const FLATTEN_D = 220;

/**
 * EVERY BUILDING BLOCK IS THE SAME HEIGHT, AND THAT IS THE FIX FOR THE WINDOWS
 * STRETCHING.
 *
 * One texture is mapped 0..1 across each face of a box, and the boxes used to
 * be 2 to 16 units tall — so the same ten rows of windows had to cover two
 * units on one building and sixteen on the next, and a floor was eight times
 * the height on one than the other. There is no per-instance UV in WebGL
 * without a custom shader, and custom shaders are the thing this project does
 * not do.
 *
 * So the fix is the other way round: make the geometry match the texture. A
 * TALL building is not a taller box, it is a STACK of blocks each showing the
 * texture's four floors once, which is also, for free, where the setbacks and
 * ledges come from.
 *
 * BLOCK_H IS NOW A BASE RATHER THAN A CONSTANT, and that is the ONE lever this
 * project has for making two neighbouring buildings look different.
 *
 * Fixing every block at 7.2 fixed the stretching, but it also meant every
 * building in the city showed windows of exactly the same height, and since
 * they share one texture and one instanced draw call there is no other channel
 * left to vary — per-instance UVs need a vertex shader and a second facade
 * needs a second draw call. What is left is the transform, so a block's height
 * is tied to its building's WIDTH: a wide building gets tall storeys and a
 * narrow one gets short ones. The window ASPECT stays constant, which is what
 * the fix was for, while the window SIZE differs from building to building,
 * which is what makes a row of them read as a street. A floor lands between
 * 1.15 and 2.4 units against a car 1.3 tall.
 *
 * IT ALSO FIXED THE SCALE. The old boxes topped out at 16 units — under three
 * car lengths, a city of bungalows, and the reason so much of our frame was
 * empty sky where the reference's is full of building. Five blocks is 36 units
 * and twenty storeys, and it fills the top of the frame the way theirs does.
 */
const BLOCK_H_MIN = 4.6, BLOCK_H_MAX = 9.6;

/** Rows of windows in one block's texture. A floor is that block / FLOORS. */
const FLOORS = 4;

/**
 * The face of a building: window channels, floor slabs, and many fine lines.
 *
 * WHY THIS IS THE BEST VALUE IN THE SCENE. Measured against Asphalt 8 on the
 * same phone, our frame needed 23 colours to cover 90% of it where theirs
 * needed 36-41. We were spending a proven twenty-thousand-object budget on
 * twenty thousand copies of the same dark box.
 *
 * THE SECOND VERSION OF THIS TILE, AND WHAT WAS WRONG WITH THE FIRST.
 *
 * The first drew big black window rectangles on pale piers with a solid black
 * spandrel across every floor, on the argument that the reference's facades are
 * where its missing ink is. The ink QUANTITY was right and the SHAPE was wrong,
 * which the headline percentage cannot tell you apart. Measured on 120x90 crops
 * of near facades, at the same scale, with tools/inkbands.mjs's ink test:
 *
 *                            ink      median run   mean run   strokes/row
 *     ref/city-night, left    40%          3          3.7         13.8
 *     ref/city-night, right   43%          3          3.8         12.7
 *     ref/target-high, left   50%          2          3.0         20.1
 *     OURS, first version     61%          8         10.7          6.8
 *
 * The same black arriving as a third as many strokes three times too fat. Put
 * the two crops side by side and the difference is obvious in a way no single
 * number was: the reference draws a wall as MANY FINE LINES on mid-grey, and we
 * were drawing it as a few fat black bars on pale grey.
 *
 * So the second version inverted the structure into a recessed vertical WINDOW
 * CHANNEL per bay: the dark ran vertically and continuously, one channel per
 * bay, and the floor was marked by a PALE slab crossing the channels.
 *
 * THE THIRD VERSION, AND WHY THE SECOND WAS ALSO WRONG.
 *
 * It hit its numbers and it looked like a barcode. Nine unbroken vertical
 * channels running a building's whole height is not a facade, it is a comb, and
 * because the same comb was stamped on every box in the city the eye read the
 * street as one texture rather than as buildings. Open shots/stroke-crops.png:
 * on the left the drawing has discrete rectangular windows in ROWS with a floor
 * between them, and on the right we have channels.
 *
 * The mistake in version two was treating "median run length" as the thing to
 * optimise instead of as a symptom. Version one was fat bars, version two was
 * fine combs, and the drawing is NEITHER — it is bimodal. In the near facades
 * 11% of its ink is in 1-2px strokes AND 52% is in runs over 21px, with very
 * little in between; ours was 27% in 3-4px, which is the one bucket the drawing
 * mostly avoids. A drawn facade is fine LINES over solid MASSES, and version
 * two supplied only the lines.
 *
 * So this version keeps the fine lines and puts the mass back, as architecture
 * rather than as a black bar:
 *
 *   * WINDOWS ARE RECTANGLES IN ROWS, each divided by a mullion and a transom.
 *     Four small dark panes per window is the same ink as one channel segment
 *     but arrives as four short strokes with three fine light ones between,
 *     which is how a window is actually drawn.
 *   * EVERY BLOCK IS CAPPED AND BASED. A near-black coping, a light cornice
 *     lip, the shadow it throws, and a plinth at the foot. Those are four
 *     full-width bands per block — the long runs the drawing has and we did
 *     not — and because a tall building is a STACK of blocks they land at
 *     every setback, which is where a real cornice is.
 *   * THE CONCRETE IS DARKER. Measured, the drawing's near zone means
 *     luminance 45 and ours meant 54, and 23% of its near pixels are pure
 *     black against our 11%. We were drawing a night city in daylight grey.
 *   * THE SPANDREL UNDER EACH WINDOW ROW IS DARK, not pale. It ties the row of
 *     windows into one horizontal band the width of the building, which is
 *     where most of the recovered 21+ ink comes from, and it is what a lit
 *     floor slab looks like from outside at night: the glass and the shadow
 *     under it read as one dark ribbon.
 *
 * THE TILE IS 256, NOT 128. A near building face is 200-400 screen pixels
 * across, so at 128 one texel was two to three pixels and a "fine" line was not
 * available at any setting — the thinnest stroke the tile could draw was
 * already too fat. 256 costs 256KB of VRAM once, no draw call and no triangle.
 *
 * The frame around the edge of the tile is the second line weight. An inverted
 * hull can only ever draw a silhouette; it cannot draw the corner where two
 * walls of the same building meet. Because the tile maps 0..1 onto EVERY face,
 * a border in the texture is an ink line along every edge of every box, and two
 * adjacent faces each contribute one, so box corners come out at double weight.
 * That is REFERENCE.md's "detail tier", which it says a hull cannot supply,
 * supplied for nothing. It is now 1.6% of the tile rather than 4.5%.
 *
 * The texture MULTIPLIES the per-instance colour, so a dark instance tint over
 * a bright window pixel still comes out bright — that is what makes a building
 * read as dark mass with lights in it rather than as a light grey block.
 *
 * WHAT THIS TILE CANNOT DO, and it is the honest limit of the whole approach.
 * One InstancedMesh has one map and one set of UVs, so EVERY building in the
 * city shows this exact facade, and a five-block tower shows it five times
 * stacked — including the pattern of lit windows. Per-instance UVs need a
 * vertex shader and a second facade needs a second draw call, and this project
 * has neither to spend. Two things are done about it instead: the lit windows
 * are few and scattered rather than a busy pattern, so there is less for the
 * eye to latch onto and repeat; and the variety is moved to where it CAN live,
 * which is the instance transform — see the spec table, where block height and
 * bay count now differ per building, so two neighbours show different-sized
 * windows out of the same tile.
 */
function windowTexture(size = 256, seed = 0xbeef) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  let sd = seed >>> 0;
  const rnd = () => { sd ^= sd << 13; sd >>>= 0; sd ^= sd >> 17; sd ^= sd << 5; sd >>>= 0; return sd / 4294967296; };

  const INKC = '#0b0f16';
  // THE CONCRETE IS A STOP AND A HALF DARKER THAN IT WAS. It was #93aec9, and
  // multiplied by a mid instance tint that landed a near facade at luminance
  // 79 against the drawing's measured #344250 at 56. Every other fault in the
  // near field was being read through a wall that was too pale to be night.
  const PIER = '#8ea6bf';
  // The spandrel under a window row: DARKER than the concrete, where it used to
  // be lighter. See the header — this is the band that turns a row of separate
  // windows into one horizontal mass the width of the building.
  const SLAB = '#66768c';
  // What catches the light: the cornice lip and the sills. The one pale tone on
  // the facade, and it is a LINE, never an area.
  const LIP  = '#a9bccd';
  // UNLIT GLASS IS NOT BLACK, AND GETTING THAT WRONG COST THE NEAR FIELD ITS
  // FINE STROKES.
  //
  // A solid black window is one 10px blob; a mid-grey pane in an ink frame is
  // four small panes and five 1px strokes, for a THIRD of the ink. The drawing
  // spends 11% of its near ink in 1-2px runs and 8% in 3-4px, and a facade of
  // black rectangles cannot produce either at any coverage — it was giving us
  // 2% and 3%. Where the drawing wants real black mass it uses a whole black
  // BUILDING, which is the instance tint's job, not the tile's.
  //
  // The tone has to be this high because the map is MULTIPLIED by an instance
  // tint of about 0.25 linear, so a texel has to sit near 0.12 linear to come
  // out of the far end at the luminance-50 glass the reference draws.
  const GLASS = '#5a6b80';

  x.fillStyle = PIER;
  x.fillRect(0, 0, size, size);

  // The frame: one fine ink line along every edge of every face.
  const B = Math.max(2, Math.round(size * 0.016));
  const inner = size - 2 * B;
  const hair = Math.max(1, Math.round(size * 0.008));   // 2 at 256

  // ---- the cap and the base ----------------------------------------------
  // CanvasTexture flips Y, so canvas row 0 is the TOP of the wall. A block is
  // therefore capped by a near-black coping, a light cornice lip and the
  // shadow that lip throws, and stands on a dark plinth. Four full-width bands
  // per block, which at a setback is a real cornice and in the middle of a
  // stack is the floor slab between storey groups.
  const capH = Math.max(2, Math.round(inner * 0.020));
  const lipH = Math.max(1, Math.round(inner * 0.018));
  const shdH = Math.max(2, Math.round(inner * 0.016));
  const plinthH = Math.max(2, Math.round(inner * 0.024));
  const band = (y0, h, fill) => { x.fillStyle = fill; x.fillRect(B, y0, inner, h); };
  let y = B;
  band(y, capH, INKC); y += capH;
  band(y, lipH, LIP);  y += lipH;
  band(y, shdH, '#242c37'); y += shdH;
  const floorTop = y;
  const floorBot = size - B - plinthH;
  band(floorBot, plinthH, INKC);

  // ---- the bays -----------------------------------------------------------
  // SEVEN, not nine. A near facade is 120-270 screen pixels across, so nine
  // bays put a window at 8px and the mullion inside it below one; seven leaves
  // room for the window to be a window.
  const COLS = 7;
  const cw = inner / COLS;
  const ch = (floorBot - floorTop) / FLOORS;
  const ww = Math.round(cw * 0.66);           // the window opening
  const spanH = Math.round(ch * 0.22);        // the dark spandrel above it
  const wh = Math.round(ch - spanH - hair);   // the opening, frame included
  const trY = Math.round(wh * 0.42);          // where the transom crosses

  for (let ry = 0; ry < FLOORS; ry++) {
    const fy = Math.round(floorTop + ry * ch);
    // The spandrel: full width, dark, with an ink hairline along its top. This
    // is the horizontal mass; the hairline is the floor line drawn on it.
    x.fillStyle = SLAB; x.fillRect(B, fy, inner, spanH);
    x.fillStyle = INKC; x.fillRect(B, fy, inner, hair);
    const wy = fy + spanH;
    for (let cx = 0; cx < COLS; cx++) {
      const wx = Math.round(B + cx * cw + (cw - ww) * 0.5);
      // A WINDOW IS A FRAME WITH GLASS IN IT, not a black rectangle. Ink the
      // whole opening, then lay the glass back inside it and cut it into four
      // panes with a mullion and a transom — so the ink arrives as five
      // one-pixel strokes round and across a pane instead of as one ten-pixel
      // blob, which is the difference the near-field measurement is about.
      x.fillStyle = INKC; x.fillRect(wx, wy, ww, wh);
      x.fillStyle = GLASS;
      const gw = (ww - 3 * hair) >> 1;         // one pane
      x.fillRect(wx + hair, wy + hair, gw, trY - hair);
      x.fillRect(wx + 2 * hair + gw, wy + hair, gw, trY - hair);
      x.fillRect(wx + hair, wy + trY + hair, gw, wh - trY - 2 * hair);
      x.fillRect(wx + 2 * hair + gw, wy + trY + hair, gw, wh - trY - 2 * hair);
      // The sill: a light line under the glass, which is what stops the window
      // and the spandrel below it merging into one grey smear at distance.
      x.fillStyle = LIP;
      x.fillRect(wx - hair, wy + wh, ww + 2 * hair, hair);
    }
  }

  // ---- a reveal down the middle of every pier -----------------------------
  // The cheapest ink on the tile and the one version two got right: the joint
  // between two structural piers, one hairline each, seven more strokes at the
  // finest weight available. Stops short of the cap and the plinth so it reads
  // as a joint rather than as a wire down the front of the building.
  x.fillStyle = INKC;
  for (let cx = 0; cx <= COLS; cx++) {
    x.fillRect(Math.round(B + cx * cw - hair * 0.5), floorTop, hair, floorBot - floorTop);
  }

  // The frame goes on LAST so the bands and the reveals cannot overwrite it.
  x.fillStyle = INKC;
  x.fillRect(0, 0, size, B);
  x.fillRect(0, size - B, size, B);
  x.fillRect(0, 0, B, size);
  x.fillRect(size - B, 0, B, size);

  // ---- the lit rooms ------------------------------------------------------
  // MOSTLY DARK. The reference has only 1% of its pixels above luminance 170 —
  // a night city is overwhelmingly unlit glass with a scatter of rooms still
  // on. Kept SPARSE for a second reason as well: this pattern is stamped on
  // every building in the city and repeats up every tower, so the fewer lit
  // windows there are the less pattern there is to recognise.
  //
  // A lit room fills one COLUMN of panes, not the whole window — the mullion
  // and the frame stay dark across it — and a third of them light only the
  // upper pane, which reads as a blind half drawn and is the sort of thing the
  // reference is full of.
  const gw = (ww - 3 * hair) >> 1;
  for (let ry = 0; ry < FLOORS; ry++) {
    const wy = Math.round(floorTop + ry * ch) + spanH;
    for (let cx = 0; cx < COLS; cx++) {
      const wx = Math.round(B + cx * cw + (cw - ww) * 0.5);
      for (let pane = 0; pane < 2; pane++) {
        const lit = rnd();
        if (lit < 0.89) continue;
        x.fillStyle = lit < 0.96 ? '#ffe0a0' : lit < 0.985 ? '#cfe0f2' : '#ffbf7a';
        const px0 = wx + hair + pane * (gw + hair);
        x.fillRect(px0, wy + hair, gw, trY - hair);
        if (rnd() >= 0.34) x.fillRect(px0, wy + trY + hair, gw, wh - trY - 2 * hair);
      }
    }
  }

  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * THE CITY, AND THE INK AROUND IT.
 *
 * THE LOAD DIAL. This exists so the breaking point is FOUND rather than
 * guessed: the owner turns it up on the actual phone until the frame rate
 * falls over, and that number becomes the scenery budget for the real game.
 *
 * TWO DRAW CALLS AND THE SAME TRIANGLES AS BEFORE. Every building is drawn
 * twice — once as itself and once as a slightly larger black shell behind it,
 * which is the inverted hull from toon.js. Naively that doubles 240,000
 * triangles to 480,000, and the budget for the whole frame is 250,000. It does
 * not, because a building is not a box:
 *
 *   * The camera is ALWAYS in front of a building (they are laid out at
 *     z <= +6 and the chase camera sits at z = +11), and ALWAYS on the road
 *     side of it (they start 16 units off the centre line and the car is
 *     clamped to 15). So of a box's six faces, exactly two can ever be seen
 *     from outside: the one facing the camera and the one facing the road.
 *     The BUILDING is those two. The roof was a third until it was measured —
 *     see the note in the constructor.
 *   * The back, the outward flank, the underside and the top are precisely the
 *     faces an inverted hull wants, because a hull draws the BACK of the
 *     inflated shell. Three of them are enough to close what the building
 *     leaves open, so the HULL is nz, px and py.
 *
 * Two plus three is five faces per instance, which is ten triangles, against
 * the twelve one BoxGeometry cost before — so the building AND its ink together
 * are cheaper in triangles than the plain box was, and the ink costs one draw
 * call. The two shells together still close the box, so there is no angle from
 * which you can see inside one.
 *
 * THE INK WIDTH IS ADDITIVE, NOT A SCALE FACTOR. This is the thing that makes
 * an instanced hull hard. The instances are scaled non-uniformly — a 3x18 tower
 * and a 7x5 block share one geometry — so multiplying the transform by 1.02
 * gives a hairline on one and a fat band on the other. Instead the hull gets
 * its OWN matrix each frame, scaled to (w + 2t, h + 2t, d + 2t) against the
 * building's (w, h, d). Because the source geometry is a UNIT cube, its scale
 * IS its size in world units, so adding a constant to each axis puts exactly
 * `t` units of ink on every face of every building whatever its proportions.
 *
 * AND `t` GROWS WITH DISTANCE. A constant world-space width is a constant
 * SCREEN width only at one distance; everywhere else it is too fat or gone.
 * A comic-book line does not get thinner with distance, so `t` is set to a
 * fixed fraction of the distance from the camera, which is a constant number of
 * pixels — capped as a fraction of the building's own smallest dimension, so a
 * far-off neon sign is outlined rather than swallowed.
 */
class Scenery {
  /**
   * A unit cube with only the named faces, centred on the origin.
   *
   * `faces` is a list of [name, shade] where name is one of pz/nz/px/nx/py/ny
   * and shade is a linear RGB triple baked into the vertex colours. The shade
   * is how the camera-facing wall, the flank and the roof get three different
   * brightnesses out of ONE texture and ONE instance colour: three.js
   * multiplies the vertex colour, the instance colour and the map together, so
   * a per-face constant in the geometry is a free third band.
   *
   * Winding is counter-clockwise seen from OUTSIDE, and UVs run 0..1 across
   * each face so the window tile lands once per wall.
   */
  static _shell(faces) {
    const F = {
      pz: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]],
      nz: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]],
      px: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]],
      nx: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]],
      py: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]],
      ny: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]],
    };
    const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const n = faces.length;
    const pos = new Float32Array(n * 12);
    const uv = new Float32Array(n * 8);
    const col = new Float32Array(n * 12);
    const idx = new Uint16Array(n * 6);
    for (let f = 0; f < n; f++) {
      const q = F[faces[f][0]], sh = faces[f][1];
      for (let v = 0; v < 4; v++) {
        const o = f * 4 + v;
        pos[o * 3] = q[v][0]; pos[o * 3 + 1] = q[v][1]; pos[o * 3 + 2] = q[v][2];
        uv[o * 2] = UV[v][0]; uv[o * 2 + 1] = UV[v][1];
        col[o * 3] = sh[0]; col[o * 3 + 1] = sh[1]; col[o * 3 + 2] = sh[2];
      }
      const b = f * 4, o = f * 6;
      idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2;
      idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.setIndex(new BufferAttribute(idx, 1));
    return g;
  }

  constructor(scene, max) {
    // TWO BANDS OUT OF ONE TEXTURE. The face pointing at the camera is lit and
    // the flank along the street is in shadow. In the reference every building
    // is two-tone like this and it is most of what makes a row of boxes read as
    // a street rather than as a bar chart. The numbers are LINEAR, not sRGB:
    // 0.33 linear is about 62% as bright on screen, not 33%.
    // THE FLANK IS DARKER THAN IT WAS — 0.33 linear is 62% of full brightness
    // on screen, which is a wall in overcast daylight, not a wall at night with
    // the light coming from the other side. Measured, our near zone meant
    // luminance 54 against the drawing's 45, and 23% of the drawing's near
    // pixels are pure black against our 11%. The side of a building is one of
    // the biggest single areas in the near field and it is where the drawing
    // puts its solid mass.
    //
    // IT IS A COMPROMISE BETWEEN TWO ZONES AND IT WAS SWEPT, NOT PICKED. The
    // flank is the near field's biggest single mass, so darkening it improves
    // the near numbers — 0.28 lands the near mean and p90 exactly on the
    // drawing's 5.7 and 14. It is ALSO the canyon wall running away down the
    // middle distance, where the same darkness reads as a blob: at 0.28 the mid
    // p90 is 18 against the drawing's 7, at 0.34 it is 13 and the near p90 has
    // fallen to 11. 0.30 splits it.
    //
    // It cannot go much below this in any case. The tint, the vertex shade and
    // the map are MULTIPLIED, so darkening the face darkens its lit windows
    // with it; there is no additive channel in a MeshBasicMaterial. At 0.20 a
    // lit pane still comes out around sRGB 124 and reads as lit. At 0.10 it
    // does not.
    const LIT = [1, 1, 1];
    const FLANK = [0.30, 0.32, 0.39];

    // The faces that can be seen. Canonical space puts the road at -X, so `nx`
    // is the flank facing the street; instances on the other side of the road
    // are MIRRORED (see update) rather than given their own geometry.
    //
    // THERE IS NO ROOF FACE, AND THAT WAS MEASURED BEFORE IT WAS DELETED.
    //
    // There used to be a third, `py`, shaded [0.24, 0.25, 0.31]. The stated
    // justification for it was that the camera rises above the shorter scenery,
    // and that is TRUE — the track's elevation runs -55 to +55 and one instance
    // in twelve is a neon sign well under the chase camera's 5.2. So it did not
    // go on the argument that it can never be seen. It went on a measurement of
    // how much of it is.
    //
    // tools/roofprobe.mjs flips it off with setDrawRange and diffs the frame,
    // over 68 poses spread round the whole track in both views at scenery
    // 7,040. Result: 34 poses show at least one roof pixel, the WORST pose
    // shows 241 of 423,360 — 0.057% of the frame — and the mean change on those
    // pixels is 22 luminance points, because what shows through is not a hole
    // but the ink hull's own top face one ink-width above. The two worst poses
    // were photographed with the face and without and are indistinguishable.
    //
    // 0.057% of the frame is not worth two triangles on every instance in the
    // city, which at 7,040 instances is 14,080 triangles a frame.
    //
    // THE HULL KEEPS ITS py, and that is what stops this being a hole: the hull
    // is an inflated shell drawn DoubleSide, so its top sits an ink-width above
    // where the building's roof was and closes the opening from any angle. Take
    // that one out as well and a high camera looks straight down inside.
    const geo = Scenery._shell([['pz', LIT], ['nx', FLANK]]);
    // The faces the building no longer has, inflated: the inverted hull.
    const hgeo = Scenery._shell([['nz', LIT], ['px', LIT], ['py', LIT]]);

    // vertexColors IS TRUE NOW, AND IT WAS FALSE FOR A GOOD REASON.
    //
    // It used to be true against a BoxGeometry, which has no `color` attribute.
    // In WebGL an undeclared attribute reads as (0,0,0), and three.js does
    // `vColor *= color` — so every instance colour was multiplied by zero and
    // every building in the city rendered pure black for days. What makes that
    // worth remembering is that I LOOKED at it, saw a wall of black
    // silhouettes, and wrote that they "read as a city skyline, which actually
    // looks quite good". A plausible aesthetic story on top of a defect is much
    // harder to catch than an obviously broken frame.
    //
    // So it is only safe to turn back on because _shell WRITES that attribute.
    // If you change the geometry, check it still does.
    const mat = new MeshBasicMaterial({
      vertexColors: true, fog: true, map: windowTexture(),
      // DOUBLE SIDED because half the instances are MIRRORED. A negative X
      // scale reverses the winding of every triangle, so back-face culling
      // would throw away exactly the faces we built. There is no extra
      // geometry in this: six faces are submitted either way.
      side: DoubleSide,
    });
    this.mesh = new InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.want = 0;
    this.max = max;
    this.m = new Matrix4();
    this.mh = new Matrix4();
    this.c = new Color();

    const hmat = new MeshBasicMaterial({ color: CITY_INK, fog: true, side: DoubleSide });
    this.hull = new InstancedMesh(hgeo, hmat, max);
    this.hull.frustumCulled = false;
    this.hull.count = 0;
    // Drawn AFTER the buildings, which is the opposite of toon.js's shells and
    // is deliberate. Order cannot change the RESULT here — both write depth,
    // nothing blends, and the hull's faces are the far side of a shell that
    // encloses the building, so the building wins every pixel it covers either
    // way. It changes the COST: going second means the depth buffer already
    // holds the near buildings, so a hull pixel that is going to lose is
    // rejected before it is shaded and only the rim is ever really drawn.
    // toon.js puts its shells first because a per-object shell is a few hundred
    // pixels; this one spans the silhouette of every building in the city.
    this.hull.renderOrder = 1;
    scene.add(this.hull);
    scene.add(this.mesh);

    // THE BOTTOM-RIGHT OF EVERY INSTANCE MATRIX IS 1, FOREVER. three.js hands
    // out a zero-filled buffer, not identities, and update() only writes the
    // six cells that change per frame — so the one cell that is always 1 has to
    // be set here, once. Leave it out and every instance collapses to a point
    // and the city is invisible. The other nine stay at the zero they start at.
    for (const im of [this.mesh.instanceMatrix, this.hull.instanceMatrix]) {
      const a = im.array;
      for (let i = 15; i < a.length; i += 16) a[i] = 1;
      im.setUsage(35048);   // DYNAMIC_DRAW — rewritten every frame
    }
    // So a measuring harness can drive the dial without going through the
    // buttons, which can only double and halve.
    scene.userData.scenery = this;

    // A colour per instance, fixed at build time. Free at runtime, and it is
    // what stops a field of identical boxes reading as a bug.
    const col = new Float32Array(max * 3);
    const NEON = [PAL.neonA, PAL.neonB, PAL.neonC, PAL.neonD];
    for (let i = 0; i < max; i++) {
      // ONE IN TWELVE IS A SIGN, not a building — a small, flat, saturated
      // slab of neon. These are the bright pixels the measurement said we were
      // missing, and in a scene with no lights a bright flat colour IS a
      // glowing one, so they cost exactly what a dark box costs.
      if (i % 12 === 5) {
        this.c.setHex(NEON[(i / 12 | 0) % 4]);
      } else if (i % 5 === 4) {
        // ONE IN FIVE IS A BLACK TOWER, and that is measured off the reference
        // rather than invented. Isolate the near-black pixels of
        // ref/city-night.png and a handful of whole buildings come out SOLID —
        // not outlined, filled. It is what stops a street of evenly-lit
        // facades reading as a bar chart: a few masses with nothing in them at
        // all, and the lit ones read as lit by comparison.
        //
        // IT WAS ONE IN NINE AND THAT WAS TOO FEW. 18.3% of the drawing's near
        // facade zone is literally #000000 and another 4.4% is one step off it;
        // ours was 5.7% and most of that was outline rather than mass. One in
        // five puts a black building in the near field most of the time instead
        // of on a lucky hash, and it is the single biggest contributor to the
        // long runs the near field was missing.
        const h = (i * 0.113) % 1;
        this.c.setHSL(0.60 + h * 0.10, 0.30, 0.085 + ((i * 11) % 3) * 0.022);
      } else {
        // Buildings: cool, dark, and varied enough that the eye does not
        // notice the same box repeating. The window texture supplies the
        // brightness; this only tints the concrete between the windows.
        //
        // A WIDER SPREAD OF VALUE THAN BEFORE, 0.26 to 0.60 where it was 0.42
        // to 0.59. Neighbouring buildings sharing one texture and one shape
        // vocabulary have only tone left to tell them apart, and a range that
        // narrow reads as one wall of concrete with lines on it. The reference
        // runs from near-black to nearly the sky's own luminance within a
        // single block. The mean comes DOWN as well as spreading: the target
        // frame's building faces measure #344250, luminance 56, and ours
        // measured 79.
        const h = (i * 0.113) % 1;
        this.c.setHSL(0.56 + h * 0.18, 0.16 + ((i * 5) % 4) * 0.05,
                      0.34 + ((i * 7) % 8) * 0.040);
      }
      col[i * 3] = this.c.r; col[i * 3 + 1] = this.c.g; col[i * 3 + 2] = this.c.b;
    }
    // `tint` is the table, keyed by slot; `tintOut` is what the GPU reads,
    // keyed by draw order and rewritten each frame as buildings move down the
    // road toward the camera.
    this.tint = col;
    // WHAT THE CITY AVERAGES TO. update() lerps every instance toward this with
    // distance — see the note there. Measured off the table rather than picked,
    // so it stays correct if the mix of neon, black masses and concrete
    // changes, and a distant building is by construction the colour of the
    // crowd it is standing in.
    let mr = 0, mg = 0, mb = 0;
    for (let i = 0; i < max; i++) { mr += col[i * 3]; mg += col[i * 3 + 1]; mb += col[i * 3 + 2]; }
    this.meanR = mr / max; this.meanG = mg / max; this.meanB = mb / max;
    this.tintOut = new Float32Array(max * 3);
    this.tintOut.set(col);
    this.mesh.instanceColor = new (Object.getPrototypeOf(this.mesh.instanceMatrix).constructor)(this.tintOut, 3);
    this.mesh.instanceColor.setUsage(35048);   // DYNAMIC_DRAW

    // Shape and offset per instance, decided once. Rebuilding these every
    // frame would measure the maths, not the drawing.
    //
    // Six numbers per slot: side, width, block height, depth, how many blocks
    // are stacked, and how much each one steps in from the one below.
    this.spec = new Float32Array(max * 6);
    let sd = 0x1234567;
    const r = () => { sd ^= sd << 13; sd >>>= 0; sd ^= sd >> 17; sd ^= sd << 5; sd >>>= 0; return sd / 4294967296; };
    for (let i = 0; i < max; i++) {
      const sign = i % 12 === 5;
      const o = i * 6;
      this.spec[o] = r() < 0.5 ? -1 : 1;
      // Signs are small and thin; buildings are big blocks. Rolling the random
      // numbers either way keeps the sequence identical so the city does not
      // reshuffle itself when this changes.
      const a1 = r(), a2 = r(), a3 = r(), a4 = r(), a5 = r();
      if (sign) {
        this.spec[o + 1] = 0.5 + a1 * 1.2;
        this.spec[o + 2] = 1.0 + a2 * 3.5;
        this.spec[o + 3] = 0.3 + a3 * 0.5;
        this.spec[o + 4] = 1;
        this.spec[o + 5] = 0;
        continue;
      }
      // FOUR KINDS OF BUILDING, NOT ONE SHAPE WITH FIVE RANDOM NUMBERS.
      //
      // Width, depth, height and stack were each drawn independently and
      // uniformly, which sounds like variety and is the opposite of it: every
      // draw lands near the middle, so the city came out as one average
      // building repeated with a wobble. What the reference has is buildings of
      // different KINDS next to each other — a two-storey shopfront beside a
      // twenty-storey slab beside a stepped tower — and that is a choice from a
      // short list, with the random numbers deciding the variation WITHIN a
      // kind rather than the kind itself.
      //
      // The setback is per kind too. A tower steps in hard and often; a slab
      // barely steps at all, which is what makes it read as a slab.
      let w, dep, blocks, taper;
      if (a4 < 0.20) {
        // Low commercial. Wide, shallow stack, generous storeys — the
        // two-and-three-storey frontage the reference lines its street with.
        w = 6.6 + a1 * 3.4; dep = 4.6 + a3 * 3.0;
        blocks = a5 < 0.55 ? 1 : 2; taper = 0.03 + a5 * 0.05;
      } else if (a4 < 0.56) {
        w = 4.4 + a1 * 3.0; dep = 3.4 + a3 * 3.2;
        blocks = a5 < 0.5 ? 2 : 3; taper = 0.06 + a5 * 0.09;
      } else if (a4 < 0.86) {
        // Tower. Narrow, tall, and it steps.
        w = 3.6 + a1 * 2.2; dep = 3.0 + a3 * 2.2;
        blocks = a5 < 0.4 ? 4 : 5; taper = 0.06 + a5 * 0.11;
      } else {
        // Slab. Wide, tall, almost no setback.
        w = 7.0 + a1 * 3.0; dep = 4.0 + a3 * 3.4;
        blocks = a5 < 0.5 ? 3 : 4; taper = 0.015 + a5 * 0.03;
      }
      this.spec[o + 1] = w;
      // The storey height, tied to the width so the windows keep their shape
      // while changing their size. See the BLOCK_H comment.
      this.spec[o + 2] = clamp(w * (0.95 + a2 * 0.45), BLOCK_H_MIN, BLOCK_H_MAX);
      this.spec[o + 3] = dep;
      this.spec[o + 4] = blocks;
      this.spec[o + 5] = taper;
    }

    // The road walk, kept so the rows can be laid down one at a time without
    // re-integrating the curvature for each of them. Allocated once.
    this.segX = new Float32Array(SEG_COUNT);
    this.segY = new Float32Array(SEG_COUNT);
    this.segZ = new Float32Array(SEG_COUNT);
    this.segA = new Int32Array(SEG_COUNT);
  }

  // `want` is what the dial asked for; `count` is what update() decided was
  // worth placing. Showing both stops the dial quietly lying about what a press
  // actually bought.
  set count(n) { this.want = clamp(n | 0, 0, this.max); this.mesh.count = this.want; }
  get count() { return this.mesh.count; }

  /**
   * A stable index for the building that belongs at (segment, row).
   *
   * THIS IS THE FIX FOR THE CITY BEING GLUED TO THE CAR. The old code indexed
   * the size table by `k`, the slot counter — so slot 0 was always the nearest
   * building and always the same size, whatever stretch of road you were on.
   * Every building therefore held station exactly where it was: you never
   * caught one up and never passed one. Reported from the phone as "I never
   * seem to catch up with them or pass them... they seem to kind of jerk a bit
   * in the distance", and the jerk was the one-segment slide of `frac`
   * resetting each time `base` ticked over, which was the ONLY motion the
   * scenery had.
   *
   * Keying off the absolute segment instead means a building belongs to a
   * PLACE. As `base` advances it moves down the slots toward you, keeps its
   * size and colour, arrives, and goes past.
   */
  _slot(a, rrow) {
    // Cheap integer hash. It must be stable for a given (segment, row) and
    // well mixed, or the city comes out in visible stripes.
    let x = (a * 73856093) ^ (rrow * 19349663);
    x = (x ^ (x >>> 13)) >>> 0;
    x = Math.imul(x, 1274126177) >>> 0;
    // THE >>> 0 IS load-BEARING. `^` yields a SIGNED 32-bit int, so without it
    // this returns a negative index for about half of all inputs, the colour
    // lookup reads undefined, and NaN goes into the instance colour buffer.
    // Caught by a test that read the buffer back rather than by looking at the
    // screen — NaN colours render as black, which in a night city is invisible.
    return ((x ^ (x >>> 16)) >>> 0) % this.max;
  }

  update(track, base, frac, camX, baseY) {
    // READ `want`, NOT `mesh.count`. This is a ratchet if you get it wrong,
    // and I got it wrong: update() sets mesh.count to what it decided to place,
    // so reading mesh.count back next frame feeds the clamped number into the
    // calculation again. 880 asked placed 660, which next frame asked for 660
    // and placed 550, and it converged on 440 and stuck there. Anthony found it
    // immediately: "I can't get it higher than 440 now, it simply does nothing
    // pushing the button."
    const n = this.want;
    if (!n) return;

    // The two instance-matrix buffers, written directly. See the inner loop.
    const BM = this.mesh.instanceMatrix.array, HM = this.hull.instanceMatrix.array;

    // Walk the road once and keep it, rather than once per row.
    let x = 0, dx = 0;
    const zOff = frac * SEG_LEN;
    const SA = this.segA, SX = this.segX, SY = this.segY, SZ = this.segZ;
    for (let i = 0; i < SEG_COUNT; i++) {
      const a = (base + i) % track.n;
      dx += track.curve[a] * SEG_LEN;
      x += dx;
      SA[i] = a;
      SX[i] = x - camX;
      SY[i] = track.hill[a] - baseY;
      SZ[i] = zOff - i * SEG_LEN;
    }

    // ROW BY ROW, NOT SEGMENT BY SEGMENT, and that ordering is load-bearing.
    //
    // The old loop went along the road filling every row at each segment before
    // moving to the next, so running out of instances truncated the road: the
    // far half of the city simply stopped, which is the half you are looking
    // at. Filling the nearest row along the WHOLE road first, then the row
    // behind it, means running out costs the outermost rows instead — depth you
    // cannot see behind buildings you can.
    //
    // It also stopped a third of the dial being wasted. At 20,000 the old loop
    // placed 12,540 and parked 7,460 at y = -9999, drawing them as invisible
    // specks; the stacking below uses them.
    let k = 0;
    // HOW DEEP THE CITY GOES — NOW CAPPED, and the cap is the whole point.
    //
    // This was `1 + n/(SEG_COUNT*1.6)`, so the count dial bought DEPTH and
    // nothing else. At 25,600 that is 73 rows reaching 664 units sideways. You
    // can see about eight. Everything past that is behind another building or
    // outside the frustum, and we were composing a matrix and three colour
    // floats for each one, every frame, seen or not.
    //
    // MEASURED ON THE PHONE, which is what settled it: at 12,800 objects our
    // own JavaScript took 14.6ms of a 33.1ms frame; at 25,600 it took 26.3ms of
    // 49.5ms. Linear in the object COUNT — while the GPU drew 317,700 triangles
    // in 11 calls and barely noticed. 71% of the frame time added by doubling
    // the scenery was matrix writing, nearly all of it for invisible buildings.
    //
    // So depth stops at what can be seen, extra budget goes into frontage along
    // the road instead, and `count` is trimmed to what is actually placed — the
    // parking loop below was itself writing a matrix per unplaced instance.
    const rows = Math.min(ROWS_MAX, 1 + Math.floor(n / (SEG_COUNT * 1.6)));
    // THE DIAL HAD A DEAD ZONE BETWEEN 1,760 AND 3,520, WHICH IS EXACTLY WHERE
    // THE BUDGET NOW LIVES.
    //
    // `perSeg` was floor(n / (SEG_COUNT * rows)) and then `placeable` was
    // capped at SEG_COUNT * rows * perSeg. Once `rows` saturated at 8, perSeg
    // was floor(n / 1760) — so at n = 3,500 it was still 1 and the city was
    // still 1,760 instances. Half the budget asked for, written into the HUD as
    // asked, and silently not placed. The same class of fault as the ratchet
    // above it: an integer division deciding how much of the dial to honour.
    //
    // The loops already stop at `placeable`, so the floor is not needed at all.
    // `sub` is now allowed to run to PER_SEG_MAX and the count is what stops
    // it, which means a partial pass — some segments getting a second building
    // and some not — instead of a whole pass or none.
    const placeable = Math.min(n, SEG_COUNT * rows * PER_SEG_MAX);
    const perSeg = PER_SEG_MAX;
    this.mesh.count = placeable;
    // The hull is trimmed with the body it outlines. Left at `n` it kept
    // drawing an outline for every instance the cap had just decided not to
    // place: 120,000 asked, 7,040 placed, and 112,960 ghost outlines around
    // buildings parked at y = -9999. Invisible, and 772,602 triangles.
    this.hull.count = placeable;
    for (let sub = 0; sub < perSeg && k < placeable; sub++)
    for (let rrow = 0; rrow < rows && k < placeable; rrow++) {
      for (let i = 0; i < SEG_COUNT && k < placeable; i++) {
        const a = SA[i];
        const sl = this._slot(a, rrow + sub * 97);
        const o = sl * 6;
        const side = this.spec[o];
        const w0 = this.spec[o + 1], bh = this.spec[o + 2], d0 = this.spec[o + 3];
        // THE CITY GETS TALLER AWAY FROM THE ROAD, and that is the fix for the
        // vanishing point being mostly sky.
        //
        // Measured at the vanishing point, the drawing lays down 20.9 dark
        // strokes per row and we laid down 6.6, with 44% of that patch of our
        // frame being bare sky. The cause is that every row was drawn from the
        // same height distribution, so the street wall was as tall as anything
        // behind it and there WAS no skyline — just one rank of buildings with
        // sky above. A real avenue is a low frontage with the towers of the
        // block behind rising over it, and that is what fills the top of the
        // reference's frame.
        //
        // A block per two rows out, which at row 7 is three extra storey groups
        // on a building you can only ever see the top of.
        //
        // NOT THE SIGNS. A sign is a single flat slab of neon with no setback,
        // and stacking four of them makes a four-storey column of one saturated
        // colour, which is not a building and is not anything. They are the
        // only spec with taper 0, so that is what identifies them here rather
        // than a fifth field in the table.
        const taper = this.spec[o + 5];
        const blocks = this.spec[o + 4] + (taper > 0 ? rrow >> 1 : 0);
        const off = ROAD_W + 8 + rrow * 11 + (sl % 3) * 2.5;
        const px = SX[i] + side * off;
        // MIRROR BY WHERE IT ACTUALLY IS, not by which side of the road it was
        // assigned to. The geometry only has the flank facing -X, so it has to
        // be flipped for anything the camera sees from the right. On a bend the
        // accumulated curvature can carry a "left" building round to the right
        // of the camera, and keying off `side` would show its missing face.
        const sx = px < 0 ? -1 : 1;
        // A little jitter along the road, stable per place, so 220 segments of
        // buildings do not read as a comb.
        const z = SZ[i] + ((sl % 5) - 2) * 0.9;
        // HOW FAR THE EYE IS FROM THIS BUILDING — IN THREE DIMENSIONS, AND
        // THAT IS THE WHOLE CORRECTION.
        //
        // This was `8 - z`: distance ALONG the road only. For the buildings you
        // are driving past it is not distance at all. One at z = 0 and x = 40
        // is 41 units away and this called it 8, so the line it asked for was
        // five times too thick — and those are exactly the near facades the
        // measurement found over-inked. The two terms that were missing are the
        // two that dominate near the camera.
        //
        // Squared here and finished per block, because the height of the block
        // is the third term and a five-block tower's crown is 30 units above
        // its base — a quarter again of the distance to a near one.
        const ex = px, ez = z - EYE_Z;
        const dxz2 = ex * ex + ez * ez;
        let by = SY[i];
        for (let bi = 0; bi < blocks && k < n; bi++) {
          // FLOORED AT A THIRD. The back rows add up to three blocks to a
          // building that may already taper 0.17 a block, and 1 - 7 * 0.17 is
          // NEGATIVE — a block turned inside out, with its one remaining face
          // pointing away from the camera and its hull inverted. It would have
          // shown as a hole in the skyline, which is the sort of thing that
          // hides for weeks at the vanishing point.
          const s = Math.max(0.33, 1 - bi * taper);
          const w = w0 * s, d = d0 * s;
          const cy = by + bh * 0.5;
          // SIX NUMBERS, NOT SIXTEEN. makeScale + setPosition + setMatrixAt is
          // three calls and thirty-two float stores per instance, and adding
          // the ink shell would have doubled that — on a dial that now reaches
          // 120,000 and whose author's own prediction is that OUR JAVASCRIPT
          // breaks before the GPU does. Every one of these matrices is a scale
          // and a translation with no rotation, so ten of the sixteen slots are
          // always zero and one is always one. Those are written once, in the
          // constructor, and never touched again; the loop writes only the six
          // that change. The ink shell therefore costs less per frame than the
          // buildings alone used to.
          const mo = k * 16;
          BM[mo] = sx * w; BM[mo + 5] = bh; BM[mo + 10] = d;
          BM[mo + 12] = px; BM[mo + 13] = cy; BM[mo + 14] = z;

          // The ink, in world units, additive on every axis. See the class
          // comment: this is what keeps a tower and a bungalow on the same
          // line weight, and INK_PX_PER_UNIT is what keeps a building four
          // hundred units away on the same line weight as one beside you.
          const ey = cy - EYE_Y;
          const dist = Math.sqrt(dxz2 + ey * ey);
          let t = dist * INK_PX_PER_UNIT;
          if (t < 0.02) t = 0.02;
          const small = (w < d ? w : d) < bh ? (w < d ? w : d) : bh;
          // THE CAP IS THE ONE PLACE THE LINE IS ALLOWED TO STOP BEING
          // SCREEN-CONSTANT, and it has to be, because past the horizon a
          // screen-constant line is wider than the thing it is drawing. At 18%
          // it only binds once the object is under about nine pixels across,
          // and from there the ink shrinks with the building instead of eating
          // it. It was 30%, which bound on every building past ~110 units and
          // is most of why the far city measured as black mass rather than as
          // line: a 3-unit tower was being drawn with 0.9 units of ink a side.
          const cap = small * 0.18;
          if (t > cap) t = cap;
          const t2 = t + t;
          HM[mo] = sx * (w + t2); HM[mo + 5] = bh + t2; HM[mo + 10] = d + t2;
          HM[mo + 12] = px; HM[mo + 13] = cy; HM[mo + 14] = z;

          // THE COLOUR HAS TO TRAVEL WITH THE BUILDING TOO. Leaving it fixed
          // per instance would mean a tower changing colour as it approached,
          // and the one-in-twelve neon signs blinking in and out of existence.
          //
          // AND IT FLATTENS TOWARD THE MEAN WITH DISTANCE, which is the half of
          // aerial perspective that fog cannot do.
          //
          // Fog raises the LUMINANCE of everything far away. What a drawing
          // also does — and what our far city was missing — is drop the
          // CONTRAST between neighbours: a black building a mile off is not
          // black, it is the same grey as the one beside it. Ours kept its full
          // range at every depth, so at the vanishing point the one-in-five
          // black masses and the dark flanks arrived as 10-20px blobs. Measured
          // there, 40% of our ink was in 9-20px runs against the drawing's 16%.
          //
          // The lerp is toward the city's own mean tint rather than toward the
          // haze, so it removes the contrast WITHOUT lifting the tone a second
          // time on top of the fog — turn the fog off and this alone leaves the
          // far city dark and flat, which is the correct half of the job.
          //
          // Six flops an instance next to a square root we were doing anyway.
          const cc = sl * 3, ci = k * 3;
          const g = dist * (1 / FLATTEN_D);
          const f = g / (1 + g), inv = 1 - f;
          this.tintOut[ci] = this.tint[cc] * inv + this.meanR * f;
          this.tintOut[ci + 1] = this.tint[cc + 1] * inv + this.meanG * f;
          this.tintOut[ci + 2] = this.tint[cc + 2] * inv + this.meanB * f;
          by += bh;
          k++;
        }
      }
    }
    // Park the remainder far below the world rather than resizing. Bounded by
    // `placeable`, not by `n`: parking an instance still costs a matrix write,
    // and at 25,600 asked against 7,040 placeable that was 18,560 wasted writes
    // a frame — the very cost this cap exists to remove.
    for (; k < placeable; k++) {
      const mo = k * 16;
      BM[mo] = BM[mo + 5] = BM[mo + 10] = 0.001;
      BM[mo + 12] = 0; BM[mo + 13] = -9999; BM[mo + 14] = 0;
      HM[mo] = HM[mo + 5] = HM[mo + 10] = 0.001;
      HM[mo + 12] = 0; HM[mo + 13] = -9999; HM[mo + 14] = 0;
    }
    // UPLOAD ONLY WHAT WAS WRITTEN. needsUpdate on its own re-sends the entire
    // buffer; an update range sends the used prefix. Belt and braces with the
    // allocation fix above, and it is what keeps the dial cheap at low settings.
    mark(this.mesh.instanceMatrix, placeable * 16);
    mark(this.mesh.instanceColor, placeable * 3);
    mark(this.hull.instanceMatrix, placeable * 16);
    if (this.hull.instanceColor) mark(this.hull.instanceColor, placeable * 3);
    this.hull.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------- game

const canvas = document.getElementById('c');
/**
 * What the page worked out about this device before the bundle even loaded.
 * Defaulted rather than assumed present, so the game still runs if the file is
 * ever served through a shell that does not carry the probe.
 */
const DEV = window.__DEVICE || { build: '?', renderer: '?', vendor: '?', webgl: '?',
                                 screen: '?', dpr: 1, maxTex: 0, ua: navigator.userAgent };

const fpsEl = document.getElementById('fps');
/**
 * Wrap a long value to a fixed column count with a hanging indent, so the
 * readout's right-hand column has a WIDTH WE CHOSE rather than one the flex
 * layout negotiates. A GPU string is 68 characters and the panel is not; left
 * to the browser it either pushed the column wide enough to run under the
 * buttons or got squeezed into a tower, depending on the screen.
 */
const FIELD_COLS = 30;
function wrapField(label, value) {
  const pad = ' '.repeat(12);
  const words = String(value).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > FIELD_COLS) { lines.push(line); line = w; }
    else line = line ? line + ' ' + w : w;
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i === 0 ? label.padEnd(12) : pad) + l).join('\n') + '\n';
}

/** "Chrome 141 on Android 11" out of 110 characters of user-agent boilerplate. */
function shortAgent(ua) {
  const b = ua.match(/(Edg|OPR|SamsungBrowser|CriOS|FxiOS|Chrome|Firefox|Version)\/(\d+)/);
  const names = { Edg: 'Edge', OPR: 'Opera', CriOS: 'Chrome', FxiOS: 'Firefox',
                  Version: 'Safari', SamsungBrowser: 'Samsung' };
  const browser = b ? `${names[b[1]] || b[1]} ${b[2]}` : 'unknown browser';
  const os = /Android (\d+)/.exec(ua) ? `Android ${RegExp.$1}`
    : /(?:iPhone|iPad).*?OS (\d+)[._]/.exec(ua) ? `iOS ${RegExp.$1}`
    : /Windows NT/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux' : 'unknown OS';
  return `${browser} on ${os}`;
}

const statsEl = document.getElementById('stats');
const stats2El = document.getElementById('stats2');

const renderer = new WebGLRenderer({
  canvas,
  antialias: false,          // never on this hardware
  powerPreference: 'high-performance',
  stencil: false,
  depth: true,
});
// CAP THE PIXEL RATIO. This is the single biggest performance lever on a
// phone: a DPR-3 screen is NINE TIMES the pixels of DPR-1. The last project
// discovered the opposite problem — it ignored DPR entirely and looked soft —
// so this starts at a middle setting we can tune with real numbers.
const DPR_STEPS = [0.6, 0.75, 1.0, 1.25, 1.5, 2.0];
// 2.00. Measured on his phone at the 30fps cap: pixel ratio 1.50 at 1080x540
// cost 9.7ms and 2.00 at 1440x720 cost 9.8ms — 78% more pixels for a tenth of
// a millisecond. Fill rate is not this game's wall and on this evidence never
// was. The 1.25 that looked so much better two days ago only looked better
// because the frame was balanced on the 16.7ms vsync edge, where a
// sub-millisecond difference gets multiplied into a whole missed frame.
let dprI = 5;
function applyDpr() {
  const want = Math.min(window.devicePixelRatio || 1, DPR_STEPS[dprI]);
  renderer.setPixelRatio(want);
  resize();
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_STEPS[dprI]));

const scene = new Scene();
/**
 * The sky, as a vertical gradient rather than one flat colour.
 *
 * Two pixels wide and 64 tall, drawn on a canvas at startup and stretched
 * across the background. It costs one tiny texture and no draw call of its own,
 * because the background is drawn anyway — and a flat backdrop was a measurable
 * part of why the scene read as empty next to Asphalt 8.
 *
 * The glow at the bottom is the point: a city at night throws light up into the
 * sky, and putting that band just above the horizon is what makes the horizon
 * feel like it has something beyond it.
 */
function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 64;
  const x = c.getContext('2d');
  const grd = x.createLinearGradient(0, 0, 0, 64);
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  grd.addColorStop(0.00, hex(PAL.skyTop));
  grd.addColorStop(0.40, hex(PAL.skyMid));
  grd.addColorStop(0.72, hex(PAL.skyLow));
  grd.addColorStop(0.92, hex(PAL.skyGlow));
  grd.addColorStop(1.00, hex(PAL.haze));
  x.fillStyle = grd;
  x.fillRect(0, 0, 2, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
scene.background = skyTexture();
scene.fog = new FogExp2(PAL.haze, FOG_DENSITY);

const camera = new PerspectiveCamera(72, 1, 0.5, FOG_FAR + SEG_LEN * 8);

const track = buildTrack(4000, 0x9e3779b9);
const handling = deriveHandling(track);
CENTRIFUGAL = handling.cent;

// SELF-CHECK, AT STARTUP, FOR EVERY SPEED THE DIAL CAN REACH.
//
// The bug this replaces was a number that quietly stopped being big enough, and
// nothing anywhere would have told us. A derived constant is only half the fix;
// the other half is the game checking its own arithmetic and saying so. If a
// margin here is below 1.0 then full lock cannot beat the worst corner and the
// track contains a section no player can drive, which is not a tuning opinion,
// it is a defect.
handling.margins = SPEED_STEPS.map((s) => ({
  speed: s,
  margin: handling.worst > 0 ? STEER_RATE / (handling.worst * s * CENTRIFUGAL) : 99,
}));
{
  // Winnable means winnable WITH THE BRAKE. A top speed you cannot hold a
  // hairpin at on the throttle is the intended design; a corner you cannot hold
  // even braking is a defect.
  const bad = handling.margins.filter((m) => m.margin * BRAKE_GRIP < 1);
  if (bad.length) {
    console.error('HANDLING: corners unwinnable even braking, at', bad.map((b) => b.speed).join(', '));
  }
}

const road = new Road(scene);
const posts = new Posts(scene, 120);
// 120,000. The dial has now been raised twice for the same reason: it kept
// running out before the phone did. 4,000 had no effect; 20,000 had no effect
// either, at 245,000 triangles. Anthony: "it would be an idea to up the amount
// I can test with so you have a better idea of what breaks the phone".
//
// A PREDICTION WORTH RECORDING BEFORE HE TESTS, so it can be wrong in public:
// I expect CPU, not GPU, to break first. Every instance's matrix and colour is
// written from JavaScript every frame, so 120,000 objects is 120,000 matrix
// composes and 2.6 million floats per frame. The GPU is drawing them in one
// call and does not care. If the frame rate falls while `cpu` in the readout
// climbs to meet it, that is the ceiling, and the fix is to stop rewriting
// instances that have not moved rather than to draw fewer of them.
//
// The old note, still true: the 4000 dial was reported as having no effect on
// frame rate however many times it was pressed — which is a result, not a failure: it says
// the ceiling is above the dial, so the dial has to move. Instanced boxes in one
// draw call are simply very cheap, and the real limit on this hardware is
// expected to be fill rate rather than instance count.
// ALLOCATED AT WHAT CAN BE PLACED, NOT AT WHAT THE DIAL WILL ASK FOR.
//
// This said 120000 for an hour and it was the single worst line in the file.
// An InstancedMesh allocates instanceMatrix at max*16 floats and instanceColor
// at max*3, and `needsUpdate = true` re-uploads the WHOLE buffer every frame
// regardless of how many instances are actually in use. With a second mesh for
// the ink hull that was 18.24 MB per frame — 547 MB/sec at 30fps — to draw at
// most 7,040 boxes.
//
// It pinned the phone at exactly 30fps no matter what: pixel ratio 0.60,
// canvas 403x168, 10,258 triangles, cpu 2.7ms, frame 33.0ms. Not fill rate,
// not geometry, not our JavaScript. Just a bus full of empty matrices.
//
// The tell was in the first report and I missed it: 0 scenery ran at 60 and
// 100 scenery ran at 30. update() early-returns at zero, so needsUpdate is
// never set and nothing uploads at all. A step change that size from a hundred
// boxes was never a drawing cost.
const SCENERY_MAX = SEG_COUNT * ROWS_MAX * PER_SEG_MAX;   // 7,040
/**
 * THE DIAL STARTS AT 3,500 AND NOT AT THE CEILING. Anthony: "could even be
 * dropped to ~3.5k max, but way more detail... hedges or a low wall instead of
 * the blue posts, tunnels, a broken hump back bridge". Seven thousand identical
 * crates read as wallpaper; half as many, each worth looking at, reads as a
 * city. The buffer ceiling stays where it is so the dial can still be wound up
 * for a measurement — this is where it BEGINS, not where it stops.
 */
const SCENERY_START = 3500;

/**
 * ---- THE RACE ------------------------------------------------------------
 *
 * A DISTANCE, NOT A LAP. The track loops and one full circuit is 24,000 units,
 * which is 1:54 flat out and nearer three minutes driven properly — a long
 * first race for someone who has just scanned a QR code. Anthony's call: a
 * tunable distance defaulting to about a minute, settled from what testers
 * report rather than from what either of us guesses.
 *
 * 12,000 units is half the circuit. From a standstill that is roughly a minute:
 * about twelve seconds and 1,500 units getting up to speed, then the rest at
 * around 205. tools/racetime.mjs measures it rather than trusting that sum.
 *
 * The start line sits at RACE_FROM. Everything else — the finish gantry, the
 * timing, the banner placement — is derived, so moving the race is one number.
 */
const RACE_FROM = 600;          // where the start gantry stands, in world units
const RACE_LEN = 12000;         // and how far it is to the finish
const COUNTDOWN = 3.2;          // seconds of lights before the throttle is live
/**
 * HOW FAR BEHIND THE ARCH THE CAR SITS ON THE GRID.
 *
 * Zero was the obvious value and it hid the branding completely: startRace()
 * put the car exactly at RACE_FROM, which is where the arch stands, so the sign
 * was directly overhead and the legs were behind the A-pillars. The countdown,
 * the launch and the first second of every race had an empty street in shot —
 * found by the agent who built the gantry photographing its own work on the
 * grid rather than only on the approach.
 *
 * Forty-five units puts the arch a second ahead at the lights: you can read it
 * while you wait, and you go under it as the car comes on song. The finish line
 * stays where it was, so a race is this much longer than RACE_LEN and the two
 * arches still sit exactly where the gantry places them.
 */
const GRID_BACK = 45;

/**
 * WHAT STATE THE RACE IS IN. Four, and the cockpit draws from these rather than
 * inferring anything from the speed:
 *
 *   'grid'      on the line, held, engine running, countdown not started
 *   'countdown' lights running, throttle dead, car cannot move
 *   'racing'    timing
 *   'done'      crossed the line; the result is up until the next start
 */
const race = {
  state: 'grid',
  t: 0,              // seconds elapsed in the current state
  elapsed: 0,        // seconds of racing so far, or the final time when done
  topSpeed: 0,       // best speed reached this run, world units
  best: null,        // best elapsed ever, seconds, or null
  bestTop: null,     // best top speed ever, world units, or null
  fresh: false,      // did the run just set a personal best
  from: RACE_FROM, len: RACE_LEN, countdown: COUNTDOWN,
};

/**
 * PERSONAL BESTS SURVIVE THE TAB CLOSING. localStorage, wrapped in try/catch
 * because a browser in private mode throws on access rather than returning
 * null, and a thrown storage error during boot would take the whole game down
 * for the sake of a lap time.
 */
const BEST_KEY = 'svu-racer-best-v1';
function loadBests() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return;
    const v = JSON.parse(raw);
    if (typeof v.best === 'number') race.best = v.best;
    if (typeof v.bestTop === 'number') race.bestTop = v.bestTop;
  } catch (e) { /* no storage, no bests, no crash */ }
}
function saveBests() {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify({ best: race.best, bestTop: race.bestTop,
                                                    len: RACE_LEN, build: (window.__DEVICE || {}).build }));
  } catch (e) { /* nothing to do about it and nothing to say */ }
}
loadBests();

/** Put the car on the line, stopped, in first, and start the lights. */
function startRace() {
  race.state = 'countdown';
  race.t = 0; race.elapsed = 0; race.topSpeed = 0; race.fresh = false;
  st.dist = RACE_FROM - GRID_BACK; st.speed = 0; st.gear = 0; st.x = 0; st.steer = 0;
  pedal.brake = false; pedal.boost = false;
}

/**
 * Advance the race. Called once per frame BEFORE the throttle, because during
 * the countdown the throttle must not run at all — holding the car with a brake
 * would still let the engine pull against it and would make the launch depend
 * on how the two happened to balance.
 */
function stepRace(dt) {
  race.t += dt;
  if (race.state === 'countdown') {
    if (race.t >= COUNTDOWN) { race.state = 'racing'; race.t = 0; }
    return;
  }
  if (race.state === 'racing') {
    race.elapsed += dt;
    if (st.speed > race.topSpeed) race.topSpeed = st.speed;
    if (st.dist >= RACE_FROM + RACE_LEN) {
      race.state = 'done'; race.t = 0;
      // A personal best is either of them. Beating your time is the point;
      // beating your top speed is the thing the boost is for.
      let got = false;
      if (race.best === null || race.elapsed < race.best) { race.best = race.elapsed; got = true; }
      if (race.bestTop === null || race.topSpeed > race.bestTop) { race.bestTop = race.topSpeed; got = true; }
      race.fresh = got;
      if (got) saveBests();
    }
    return;
  }
  if (race.state === 'done' && race.t > 6) startRace();
}

const scenery = new Scenery(scene, SCENERY_MAX);
scenery.count = SCENERY_START;
// Street furniture: lampposts, signals, crossings, railings. A stub until it
// is built, so the game runs identically until it draws its first triangle.
const furniture = buildFurniture({
  scene, palette: PAL, ink: INK, roadW: ROAD_W, segLen: SEG_LEN, segCount: SEG_COUNT,
});
// The start and finish gantries, with the SVU branding. ONE set of geometry
// serving both lines — they are RACE_LEN apart and the road is 1,350 units
// deep, so they can never both be on screen; gantry.js checks that claim every
// frame rather than trusting this comment. `behind` is passed because anything
// sitting ON the road has to reproduce Road.update's walk exactly, and
// furniture.js's note explains what it costs not to.
const gantry = buildGantry({
  scene, roadW: ROAD_W, segLen: SEG_LEN, segCount: SEG_COUNT, behind: BEHIND,
  from: RACE_FROM, len: RACE_LEN,
});
// One texture for the whole game. Generated at startup from a few hundred
// bytes of canvas drawing, never downloaded.
const PENCIL = pencilTexture(128);

// ---- the car ---------------------------------------------------------------
//
// THE PLACEHOLDER IS GONE. There used to be a buildCar() here that made five
// boxes and inked them, and when the real body arrived it was left in place
// "until the real one is ready" — so for a while the game drew BOTH, occupying
// the same space, the placeholder's wing sticking out through the real bonnet.
// It cost ten draw calls of the twelve the frame had. Deleting it took the
// worst case from sixteen to six.
//
// The lesson is not "remember to delete the placeholder". It is that a
// placeholder which still renders is indistinguishable from a bug, so the
// moment the real thing draws a triangle the old one has to go in the same
// commit.
const bodyKit = buildBody({ pencil: PENCIL, palette: PAL, ink: INK });
const cockpit = buildCockpit({ pencil: PENCIL, palette: PAL, ink: INK, driverX: DRIVER_X });

/** Filled in and handed to the cockpit each frame; never reallocated. */
const COCKPIT_STATE = { speed: 0, maxSpeed: 0, steer: 0, boosting: false, braking: false,
                        rev: 0, gear: 0, gears: GEARS.length, race: null };

const car = new Group();
car.add(bodyKit.group);
car.add(cockpit.group);
scene.add(car);

// NO GROUND PLANE. It used to be here — one big quad at y=0 — and it was the
// cause of two bugs at once: the road floated above it over crests, and it drew
// over the road in dips. The ground is now part of the road mesh so it follows
// every hill exactly. See Road.update.

// ---- state ---------------------------------------------------------------
const st = {
  dist: 0,        // metres travelled
  speed: 0,
  x: 0,           // lateral position, road units
  steer: 0,       // -1..1, smoothed
  slope: 0,       // smoothed gradient under the car, for camera pitch
  view: 1,        // FIRST PERSON ONLY for now — see the note on bView below
  gear: 0,        // index into GEARS; the player always starts in first
  rev: 0,         // 0..1 against the current gear's ceiling, drives the tacho
  // Simulated seconds elapsed: the sum of the CLAMPED dt the physics actually
  // saw, which is not wall-clock time. Harnesses must wait on this rather than
  // on setTimeout. On a slow renderer the 0.1s clamp below makes the sim run
  // behind the clock, and a test that waits nine real seconds and then asserts
  // the car reached its top speed is measuring the renderer, not the physics —
  // which is exactly how two speed assertions went red on a working build.
  simT: 0,
  off: 0,         // 0 on the tarmac, 1 at the far edge of what you can stray to
};

// ---- input ---------------------------------------------------------------
//
// THE TOUCH HALVES CHANGE JOB ONCE TILT IS LIVE, which sounds like a trap and
// is actually the layout every phone racer converged on:
//
//   tilt steering off — left half steers left, right half steers right
//   tilt steering on  — the phone is doing the steering, so the thumbs are
//                       free: left half BRAKES, right half BOOSTS
//
// Throttle is never a control. It is always on. Lifting off is not an
// interesting decision to give a player forty times a minute; choosing to brake
// into a corner is.
let touchDir = 0;
const pedal = { brake: false, boost: false };
const keys = Object.create(null);

// ---------------------------------------------------------- keep awake ----
//
// A driving game that puts itself to sleep after thirty seconds is not a
// driving game. The page can override the phone's screen timeout with a Screen
// Wake Lock, and it SHOULD, because the usual signal a phone uses to decide you
// have gone away — nobody has touched the glass — is exactly what playing this
// looks like. You steer by tilting; you may not touch the screen for minutes.
//
// Three things about it that are easy to get wrong:
//   * it needs a secure context (https). A file:// or http:// copy silently
//     gets nothing, which is worth knowing before blaming the phone.
//   * the lock is RELEASED automatically whenever the page is hidden, so it has
//     to be re-taken on visibilitychange or it only works until the first time
//     you switch apps.
//   * asking outside a user gesture is allowed but likelier to be refused, so
//     the first touch asks too.
const wake = { state: 'idle', lock: null };

function keepAwake() {
  if (!('wakeLock' in navigator)) { wake.state = 'unsupported'; return; }
  if (wake.lock || wake.state === 'asking') return;
  wake.state = 'asking';
  navigator.wakeLock.request('screen').then((l) => {
    wake.lock = l; wake.state = 'held';
    // Released by the system, by tab switching, or by the screen going off.
    l.addEventListener('release', () => { wake.lock = null; wake.state = 'released'; });
  }).catch((err) => {
    wake.state = 'refused: ' + (err && err.name ? err.name : 'error');
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepAwake();
});
// Ask immediately as well as on first touch: on Android this usually just works
// and the screen never dims at all, gesture or no gesture.
keepAwake();

// --------------------------------------------------------- full screen ----
//
// Get rid of the address bar. On a 420px-tall landscape phone the browser
// chrome is a fifth of the screen, and it is a fifth taken off the top — which
// is exactly where the horizon and the road ahead are.
//
// MUST BE CALLED FROM A REAL USER GESTURE. Browsers refuse it otherwise, and
// they refuse it silently enough that it looks like the API is broken. So the
// first touch asks, and there is a button for asking again, because the browser
// drops out of fullscreen on things the player did not intend — rotating the
// phone, an incoming notification.
//
// Landscape is locked at the same time. Orientation lock is only permitted
// while fullscreen, which is the real reason the two are done together.
const fs = { state: 'windowed' };

function lockLandscape() {
  fs.state = 'fullscreen';
  const so = screen.orientation;
  if (so && so.lock) { try { so.lock('landscape').catch(() => {}); } catch (e) {} }
}

const why2 = (e) => 'refused: ' + ((e && (e.message || e.name)) || 'error');
function goFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) { fs.state = 'unsupported'; return; }
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  try {
    const p = req.call(el, { navigationUI: 'hide' });
    // REPORT THE MESSAGE, NOT JUST THE NAME. "refused: TypeError" is what came
    // back from a real phone and it narrows the cause to nothing at all — every
    // interesting fullscreen rejection in Chrome is a TypeError. The message
    // says which one, and a screenshot is the only way I get to see it.
    const why = (e) => 'refused: ' + ((e && (e.message || e.name)) || 'error');
    if (p && p.then) p.then(lockLandscape).catch((e) => { fs.state = why(e); });
    else lockLandscape();
  } catch (e) { fs.state = why2(e); }
}

const onFsChange = () => {
  const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
  fs.state = on ? 'fullscreen' : 'windowed';
  // The viewport changes size on the way in and on the way out, and the change
  // does not always fire a resize event on Android. Do it twice: once now, once
  // after the animation, because the first reading is often the old size.
  resize();
  setTimeout(resize, 250);
};
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);

// ---------------------------------------------------------------- tilt ----
//
// STEER BY TURNING THE PHONE. On a phone this is simply better than a thumb:
// it is analogue rather than on/off, it leaves the whole screen visible
// instead of covering half of it with a hand, and it is what the hardware is
// already telling us for free.
//
// THE AXIS DEPENDS ON HOW THE PHONE IS HELD. In landscape — which is how you
// hold a racer — the roll we want is `gamma` when the phone is rotated one
// way and `beta` when it is rotated the other, and the sign flips with it. So
// the axis is chosen from screen.orientation rather than assumed, because
// assuming it gives a game that steers backwards for half its players.
//
// ZEROED WHERE YOU ARE HOLDING IT, not at flat. Nobody holds a phone at
// exactly 0 degrees, and a game that demands it feels broken from the first
// frame. The first reading becomes the neutral point, and a two-finger tap
// re-zeros it if you shift position.
const tilt = {
  ok: false,          // has the device ever sent a reading
  on: false,          // is tilt the active input
  raw: 0,             // current angle, degrees
  zero: null,         // neutral point, degrees
  out: 0,             // -1..1
  invert: false,      // set by the INVERT button; conventions differ
  axis: '-',          // which axis is being read, for the readout
  angle: 0,           // screen orientation, for the readout
};

/** Degrees of roll from neutral that equals full lock. */
const TILT_RANGE = 22;
/** Degrees of slop around neutral, so a hand that is not perfectly still
 *  does not weave the car down the road. */
const TILT_DEAD = 1.6;

function onTilt(e) {
  if (e.beta === null && e.gamma === null) return;
  // THE STANDARD MAPPING, and the sign matters more than the axis.
  //
  //   portrait  (0)    roll is  gamma
  //   landscape (90)   roll is  beta
  //   upside(180)      roll is -gamma
  //   landscape(270)   roll is -beta
  //
  // The first version had the two landscape signs the wrong way round, which
  // does not feel like a wrong axis — it feels like the car fighting you, and
  // was reported as "impossible to stay anywhere near the track". Inverted
  // steering is much worse than no steering, because every correction makes it
  // worse. The INVERT button exists because these conventions differ between
  // browsers and I would rather be told than guess a third time.
  const a = ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0);
  let v;
  if (a === 90) v = e.beta;
  else if (a === 270 || a === -90) v = -e.beta;
  else if (a === 180) v = -e.gamma;
  else v = e.gamma;            // portrait
  if (typeof v !== 'number' || Number.isNaN(v)) return;
  tilt.axis = (a === 90 || a === 270 || a === -90) ? 'beta' : 'gamma';
  tilt.angle = a;
  if (tilt.invert) v = -v;

  tilt.ok = true;
  tilt.raw = v;
  if (tilt.zero === null) tilt.zero = v;

  let d = v - tilt.zero;
  const s = d < 0 ? -1 : 1;
  d = Math.abs(d) - TILT_DEAD;
  if (d < 0) d = 0;
  tilt.out = clamp((d / (TILT_RANGE - TILT_DEAD)) * s, -1, 1);
  // Any real movement takes over from touch, so the two never fight.
  if (Math.abs(tilt.out) > 0.02) tilt.on = true;
}

/** Re-zero to however the phone is being held right now. */
function recentreTilt() { tilt.zero = tilt.raw; tilt.out = 0; }

window.addEventListener('deviceorientation', onTilt, true);

// iOS will not send readings at all until asked, and will only ask from
// inside a real user gesture. Android just works. Asking on the first tap
// costs nothing on a device that does not need it.
function askTilt() {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') {
    D.requestPermission().then((r) => {
      if (r === 'granted') window.addEventListener('deviceorientation', onTilt, true);
    }).catch(() => {});
  }
}

/**
 * Read the WHOLE touch list every time, rather than tracking one finger.
 *
 * The last project shipped a gesture bug that took a round trip to the phone to
 * find, because it tried to be clever about individual pointers. This cannot
 * drift out of sync with reality: whatever is currently touching the glass is
 * the input, recomputed from scratch, every event. Braking with one thumb while
 * boosting with the other therefore works without a line of code about it.
 */
/**
 * THE PEDALS ARE NOT CONDITIONAL ANY MORE, and that was a serious bug.
 *
 * This used to read:
 *
 *     if (tilt.on) { if (f < 0.5) br = true; else bo = true; }
 *     else dir = f < 0.5 ? -1 : 1;
 *
 * so the two halves of the screen changed job depending on whether the device
 * had ever reported a tilt. On a phone that had not — an iPhone that was never
 * asked for permission, a laptop, or simply a phone being held flat — every
 * touch steered and THERE WAS NO BRAKE AND NO BOOST AT ALL. Reported from a
 * real player as "braking doesn't work" and "boost has issues, the car just
 * steers instead": two symptoms, one line.
 *
 * It is also the reason a mode like this is a bad idea in the first place. The
 * game was unplayable and nothing on screen said so — the pedal hints sat there
 * in the corners the whole time, labelling controls that did not exist.
 *
 * So: the bottom corners are the brake and the boost, always. Steering, which
 * only matters when there is no tilt, lives in the area above them and cannot
 * collide. The middle of the bottom strip is deliberately dead, so a thumb can
 * rest there without doing anything.
 *
 * GENEROUS ON PURPOSE. Anthony: "generous amount of space around them so just
 * touching the screen anywhere close enough will work." Forty percent of the
 * width and forty-five percent of the height, per corner, and the on-screen
 * hints are sized from these same two numbers at boot so the label cannot drift
 * away from the region it is labelling.
 */
const PEDAL_TOP = 0.55;    // touches below this fraction of the height are pedals
const PEDAL_W = 0.40;      // ...and within this fraction of the width, per side

function readTouches(list) {
  let dir = 0, br = false, bo = false;
  const w = window.innerWidth, h = window.innerHeight;
  for (let i = 0; list && i < list.length; i++) {
    const fx = list[i].clientX / w, fy = list[i].clientY / h;
    if (fy > PEDAL_TOP) {
      if (fx < PEDAL_W) br = true;
      else if (fx > 1 - PEDAL_W) bo = true;
    } else {
      dir = fx < 0.5 ? -1 : 1;
    }
  }
  touchDir = dir; pedal.brake = br; pedal.boost = bo;
}

/** Make the hints describe the hit test exactly, rather than approximately. */
function sizePedalHints() {
  for (const id of ['pL', 'pR']) {
    const e = document.getElementById(id);
    if (!e) continue;
    e.style.width = (PEDAL_W * 100) + '%';
    e.style.height = ((1 - PEDAL_TOP) * 100) + '%';
    e.style.maxHeight = 'none';
  }
}
sizePedalHints();

/**
 * THE FIRST TOUCH ANYWHERE ASKS, not the first touch on the canvas.
 *
 * iOS only offers the motion-permission dialog from inside a real gesture, and
 * this used to be wired to the canvas alone — while the control buttons
 * deliberately call stopPropagation so steering does not fire underneath them.
 * Since the throttle is always on and the car drives itself, it was entirely
 * possible to open the page, press TOGGLE, take a screenshot and reach 95mph
 * having never once touched the middle of the screen. No canvas touch, no
 * prompt, no tilt — which is exactly what happened on the first iPhone this
 * was given to, and it looked like the phone refusing rather than us not asking.
 *
 * Listening on the document in the CAPTURE phase is what makes it reliable: the
 * capture phase runs top-down before the target's own handlers, so a button
 * swallowing the event afterwards cannot stop the request going out.
 */
let askedTilt = false;
function firstGesture() {
  // ASK ONCE, but KEEP TRYING for the other two. iOS offers the motion dialog
  // exactly once, so asking twice is pointless; fullscreen and the wake lock
  // can be refused for reasons that go away — and if the only thing a player
  // ever touches is a button, a single attempt was the only attempt they got.
  // Anthony's phone came back "refused: TypeError" and stayed windowed for the
  // rest of the session with no way to retry short of reloading.
  if (!askedTilt) { askedTilt = true; askTilt(); }
  keepAwake();
  goFullscreen();
  // The first touch also drops the lights. Before that the car sits on the
  // grid with the engine running, which is a better first frame than a car
  // already doing 60 down a road the player has not looked at yet.
  if (race.state === 'grid') startRace();
  else if (race.state === 'done') startRace();
}
document.addEventListener('touchstart', firstGesture, { capture: true, passive: true });
document.addEventListener('mousedown', firstGesture, { capture: true, passive: true });

const onTouch = (e) => {
  firstGesture();
  keepAwake();
  if (e.type === 'touchstart') goFullscreen();
  readTouches(e.touches);
  if (e.cancelable) e.preventDefault();
};

canvas.addEventListener('touchstart', onTouch, { passive: false });
canvas.addEventListener('touchmove', onTouch, { passive: false });
canvas.addEventListener('touchend', onTouch, { passive: false });
canvas.addEventListener('touchcancel', onTouch, { passive: false });

// Mouse, for the laptop. Steering only — a laptop has a keyboard for the rest.
const onMouse = (down) => (e) => {
  firstGesture();
  touchDir = down ? (e.clientX / window.innerWidth < 0.5 ? -1 : 1) : 0;
};
window.addEventListener('keydown', (e) => { if (e.code === 'KeyF') goFullscreen(); });
canvas.addEventListener('mousedown', onMouse(true));
canvas.addEventListener('mousemove', (e) => { if (touchDir !== 0) onMouse(true)(e); });
window.addEventListener('mouseup', onMouse(false));

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  // KeyV kept for the harnesses, which still photograph the car from outside.
  if (e.code === 'KeyV') st.view = st.view === 3 ? 1 : 3;
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

// THE FIELD OF VIEW IS HORIZONTAL, NOT VERTICAL.
//
// three.js's `fov` is the VERTICAL angle, and a phone held in portrait has an
// aspect around 0.46 — so a 72-degree vertical view is only about 38 degrees
// across. The first build looked like driving down a drainpipe with the car
// filling half the screen, and the road barely visible either side.
//
// So the horizontal angle is the thing that is chosen, and the vertical is
// derived from it. That keeps the framing identical whether the phone is
// upright or on its side, which also makes any judgement about "does it look
// fast" portable between the two.
let baseFov = 72;
function applyFov(hFovDeg) {
  const hh = (hFovDeg * Math.PI) / 360;
  const v = 2 * Math.atan(Math.tan(hh) / camera.aspect);
  camera.fov = (v * 180) / Math.PI;
  camera.updateProjectionMatrix();
}

// ---- test controls -------------------------------------------------------
// Wired here rather than in the shell so they can reach game state directly.
// The steps are coarse on purpose: the question is "roughly how many", and
// creeping up in ones would take all afternoon on a phone.
{
  const step = (d) => {
    // Same trap, other end: doubling the PLACED count instead of the ASKED
    // count means the button can never get past the first clamp.
    const n = scenery.want;
    const next = d > 0 ? (n === 0 ? 100 : n * 2) : Math.floor(n / 2);
    scenery.count = next < 25 ? 0 : next;
  };
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    // Stop the press reaching the canvas, or steering fires under the button.
    const go = (e) => { e.stopPropagation(); e.preventDefault(); fn(); };
    el.addEventListener('click', go);
    el.addEventListener('touchstart', go, { passive: false });
  };
  // THE VIEW BUTTON IS GONE. Anthony, after a matched-viewpoint comparison put
  // our chase car next to his drawing: "it really doesn't resemble the subject
  // image at all... The way it is now it's not worth keeping." Third person is
  // shelved rather than deleted — the body, its loft and its anchors are all
  // still built, st.view still works, and the exterior's next home is a garage
  // where it is static and can be lavish. There is just no way to select it
  // while driving, because a view that does not meet the standard should not be
  // offered to a player.

  bind('bInv', () => { tilt.invert = !tilt.invert; recentreTilt(); });
  // THE READOUT AND THE INSTRUMENTS GO TOGETHER. Hiding the numbers while
  // leaving the buttons that change them would be the worst of both: a tester
  // could halve the pixel ratio and have nothing on screen to say they had.
  // `worst` is reset on the way in, so the first frame time a tester
  // photographs is not a spike from before the panel appeared.
  bind('bTog', () => { document.body.classList.toggle('lean'); worst = 0; });
  // Keyboard equivalent, so the harnesses and a desktop can reach it without
  // hunting for a button that may itself be hidden.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyH') { document.body.classList.toggle('lean'); worst = 0; }
  });
  bind('bZero', () => recentreTilt());
  bind('bFull', () => goFullscreen());
  // THE PIXEL DIAL — added because a phone reading said the frame cost was
  // neither triangles nor our JavaScript. 440 buildings, 15,412 triangles, cpu
  // 5.0ms of a 33.0ms frame: 28ms unaccounted for by anything we were
  // measuring, which points at fill rate, and fill rate is settled by how many
  // pixels we ask for. Dropping from 1.5x to 1.0x is 2.25 times fewer of them.
  //
  // It is a dial rather than a decision because Anthony's screen and Anthony's
  // eyes are the only place the sharpness-versus-smoothness trade can be
  // judged, and he has already said once that he would rather have responsive
  // than crisp.
  bind('bPixDown', () => { dprI = clamp(dprI - 1, 0, DPR_STEPS.length - 1); applyDpr(); });
  bind('bPixUp', () => { dprI = clamp(dprI + 1, 0, DPR_STEPS.length - 1); applyDpr(); });
  // CAP + walks DOWN the list towards "none", so the buttons read the way the
  // frame rate moves rather than the way the array is indexed.
  bind('bCapUp', () => { divI = clamp(divI - 1, 0, DIVISORS.length - 1); vsyncN = 0; worst = 0; });
  bind('bCapDown', () => { divI = clamp(divI + 1, 0, DIVISORS.length - 1); vsyncN = 0; worst = 0; });
  bind('bUp', () => step(1));
  bind('bDown', () => step(-1));
  // THE SPEED DIAL IS NOW THE GEARSTICK, which Anthony called long before it
  // was possible: "Speed buttons can eventually be gears". It was only ever a
  // debug control for finding out how fast the car should go, and that question
  // is answered — 210 world units, a shade over 200mph. What the car can reach
  // is the garage's business from here, not a button's.
  bind('bFast', () => { st.gear = clamp(st.gear + 1, 0, GEARS.length - 1); });
  bind('bSlow', () => { st.gear = clamp(st.gear - 1, 0, GEARS.length - 1); });
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  applyFov(baseFov);
}
window.addEventListener('resize', resize);
resize();

// ---- frame timing --------------------------------------------------------
// A rolling median, not a mean. One 400ms stall from a garbage collection
// drags a mean for seconds and makes the reading useless; a median ignores it
// and reports what the frame rate actually feels like.
const SAMPLES = 90;
const frames = new Float32Array(SAMPLES);
const sorted = new Float32Array(SAMPLES);
let fi = 0, filled = 0;
let worst = 0, hudT = 0, cpuMs = 0;
/**
 * Per-system timings, so "our JavaScript costs 9.5ms" can be turned into a
 * list of who is spending it. Accumulated, not smoothed; divide by PROF.n.
 * Exposed on window.RACER, printed by no one — a harness reads it.
 */
const PROF = { road: 0, posts: 0, scenery: 0, furniture: 0, render: 0, n: 0 };

function median() {
  const n = filled;
  if (!n) return 0;
  sorted.set(frames.subarray(0, n));
  const a = sorted.subarray(0, n);
  Array.prototype.sort.call(a, (p, q) => p - q);
  return a[n >> 1];
}

// ---- FRAME PACING ---------------------------------------------------------
//
// A 60Hz panel can only show a new picture every 16.7ms. There is no 45fps:
// overrun the slot and you wait for the next one, which is 33.3ms. So "cap at
// 30" cannot mean a timer — done with setTimeout you get 35ms, then 30, then
// 35, and that judder is worse than not capping at all. It has to mean DRAWING
// ON EVERY SECOND VSYNC, which gives an exactly even 33.3ms every time.
//
// THE SIMULATION IS NOT CAPPED WITH IT, and that is the point. Physics costs
// about a tenth of a millisecond a frame; drawing costs ten. Running the car
// at 60 and the picture at 30 gives the renderer a 33ms budget while the tilt
// steering still responds within 16ms — Anthony's own observation that a
// locked 30 plays fine, without the input lag that usually comes with it.
//
// THE SETTING IS A VSYNC DIVISOR, NOT A FRAMES-PER-SECOND NUMBER, and that is
// a correction rather than a preference. My first version offered 40 and 24 as
// caps and an accumulator to hit them. Running that accumulator's arithmetic
// over a simulated 60Hz panel — tools/pacing.mjs, because a 24fps container
// cannot show you what a 60Hz phone does — printed the pattern it produces:
//
//   cap 30 on 60Hz -> 30.0Hz  .D.D.D.D.D.D      even
//   cap 40 on 60Hz -> 40.0Hz  .DD.DD.DD.DD      16.7, 16.7, 33.3, repeating
//   cap 24 on 60Hz -> 22.5Hz  .D..D.D..D.D..    not even 24, and irregular
//
// 40 averages exactly 40 and judders every third frame; 24 cannot be reached
// at all. A 60Hz panel can only pace 60, 30, 20 and 15 evenly, because those
// are the only whole divisions of its vsync. Offering the others would ship
// precisely the stutter this whole mechanism exists to avoid — and the average
// frame rate, the number a player would check, looks fine in both cases.
//
// So the choice is "draw 1 vsync in N", the panel rate is measured, and the
// readout shows the fps that combination actually produces on this device.
const DIVISORS = [1, 2, 3, 4];
let divI = 0;
let panelHz = 60;     // measured at boot, see calibratePanel()
let vsyncN = 0;       // vsyncs since the last drawn frame
let drawn = 0;        // frames actually rendered, for the readout
let simmed = 0;       // vsyncs simulated, ditto

// The panel rate, taken as the MEDIAN of the first sixty intervals rather than
// the mean: one long frame while the page is still settling drags a mean by
// several Hz and cannot move a median at all. Snapped to the nearest common
// refresh rate, and left at 60 if the reading is nowhere near one of them.
function calibratePanel() {
  const gaps = [];
  let prev = performance.now();
  const tick = (t) => {
    gaps.push(t - prev); prev = t;
    if (gaps.length < 60) { requestAnimationFrame(tick); return; }
    gaps.sort((a, b) => a - b);
    const hz = 1000 / gaps[30];
    let best = 60, bestD = 1e9;
    for (const c of [60, 72, 90, 120, 144, 165, 240]) {
      const d = Math.abs(hz - c);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (bestD < best * 0.12) panelHz = best;
  };
  requestAnimationFrame(tick);
}
calibratePanel();

// ---- loop ----------------------------------------------------------------
let last = performance.now();
let lastDraw = last;

function frame(now) {
  requestAnimationFrame(frame);

  let dt = (now - last) / 1000;
  last = now;
  // Clamp: a tab returning from the background must not teleport the car a
  // kilometre down the road.
  if (dt > 0.1) dt = 0.1;
  st.simT += dt;
  simmed++;

  // --- the race, before anything can move ---
  stepRace(dt);
  const held = race.state === 'countdown' || race.state === 'grid';

  // --- drive ---
  const kL = keys.ArrowLeft || keys.KeyA ? -1 : 0;
  const kR = keys.ArrowRight || keys.KeyD ? 1 : 0;
  // Tilt wins once the phone has actually been turned; touch and keys remain
  // as a fallback for anything that cannot or will not report an angle.
  const want = tilt.on ? tilt.out : (touchDir || (kL + kR));
  st.steer += (want - st.steer) * Math.min(1, dt * STEER_LAG);

  const braking = pedal.brake || keys.Space || keys.ArrowDown;
  const boosting = !braking && (pedal.boost || keys.ShiftLeft || keys.ShiftRight);
  // THE CEILING IS NOW THE GEAR'S, NOT THE CAR'S. `top` stays the car's, since
  // the camera, the field of view and the cornering margin all read from it and
  // none of them care what gear you are in.
  const top = tune.maxSpeed * (boosting ? BOOST_TOP : 1);
  const gearTop = top * GEARS[st.gear];
  // Revs are speed against what THIS gear can pull, which is what makes the
  // needle drop when you shift: the speed does not change, the divisor does.
  st.rev = gearTop > 0 ? clamp(st.speed / gearTop, 0, 1) : 0;
  if (held) {
    // ON THE LINE THE THROTTLE IS DEAD, not fought. Holding the car with a
    // brake instead would let the engine pull against it, and the launch would
    // then depend on however those two happened to balance on the frame the
    // lights went out.
    st.speed = 0;
  } else if (tune.freeze) {
    // Speed held exactly where the harness put it. Without this the car keeps
    // accelerating between two "identical" captures, the field of view opens
    // with it, and every pixel in the frame moves — which is what the noise
    // floor was: not renderer dither, the game quietly still running.
  } else if (braking) {
    st.speed -= BRAKE * dt;
  } else {
    // Approach the ceiling rather than fight a drag term to a standstill short
    // of it. Rate falls to zero AT the ceiling, so the ceiling is reachable and
    // the last few mph take a satisfying while to find.
    //
    // FORCE MINUS DRAG, not an approach to a ceiling. The two are the same only
    // when there is one ceiling; with a gearbox there are two limits doing two
    // different jobs, and collapsing them into one is what broke the first go:
    //
    //   the REV LIMITER stops a low gear. It is the hard clamp below, and it
    //   arrives while the engine is still pulling hard — which is exactly why
    //   you have to shift, and why sitting on it wastes time.
    //
    //   DRAG stops top gear. It rises with the square of speed and meets the
    //   engine at the car's real top speed, so the last few mph take a while to
    //   find and no clamp is involved at all.
    //
    // Drag is derived from the car's top speed rather than chosen, so top
    // gear's terminal velocity IS tune.maxSpeed by construction and cannot
    // drift away from the number the rest of the game is calibrated against.
    const g = GEARS[st.gear];
    const drag = (ENGINE * torque(1)) / (tune.maxSpeed * tune.maxSpeed);
    const push = ENGINE * (boosting ? BOOST_ACCEL : 1) * torque(st.rev) / g;
    st.speed += (push - drag * st.speed * st.speed) * dt;
  }
  // The limiter. Hold a gear past its top and you simply stay there — no
  // penalty, no noise, just a car that has stopped accelerating and a needle
  // sitting in the red telling you why.
  st.speed = clamp(st.speed, 0, Math.min(top, gearTop));
  // AUTOMATIC DOWNSHIFT ONLY, and only to stop the box getting stuck. Brake to
  // a standstill in fifth and every subsequent throttle input would be
  // multiplied by a torque curve at zero revs; you would sit still, in gear,
  // wondering what was broken. Shifting UP stays entirely manual, because that
  // is the decision Anthony asked to be given.
  while (st.gear > 0 && st.speed < top * GEARS[st.gear - 1] * 0.45) st.gear--;

  // Can exceed 1 while boosting, deliberately: the field of view and the camera
  // both read from it, so the boost widens and pulls back without extra code.
  const v = st.speed / tune.maxSpeed;
  // `freeze` holds the car in place WITHOUT setting the speed to zero, so a
  // measuring harness can photograph the same frame twice at a realistic speed.
  // Zeroing the speed instead changes the field of view and drops the dashboard
  // off the bottom of the screen, so it measures a pose the player never sees.
  if (!tune.freeze) st.dist += st.speed * dt;

  const seg = Math.floor(st.dist / SEG_LEN);
  const base = ((seg % track.n) + track.n) % track.n;
  const frac = (st.dist / SEG_LEN) - seg;

  // THE GROUND HEIGHT UNDER THE CAR, INTERPOLATED BETWEEN SEGMENTS.
  //
  // Everything is drawn relative to the height of the segment the car is on. If
  // that reference is taken as track.hill[base] — a whole-segment step — then
  // every time `base` ticks over, the entire world jumps vertically by the
  // height difference between two segments. On a steep hill that is over a unit,
  // and at top speed `base` ticks fifty times a second.
  //
  // Reported from the phone as "over bumps or ramps there is a flash to the flat
  // track, doesn't feel like I went up at all, more like I went through the
  // ramp" — which is exactly right: the hill was being drawn, then repeatedly
  // yanked back to level. The Z axis was already interpolated by `frac`. The Y
  // axis was not, and that asymmetry was the bug.
  const baseY = track.hill[base]
    + (track.hill[(base + 1) % track.n] - track.hill[base]) * frac;

  // The slope under the car, smoothed. Used to pitch the camera, which is what
  // turns "the road ahead is drawn higher" into "I am going up a hill".
  const slopeNow = (track.hill[(base + 1) % track.n] - track.hill[base]) / SEG_LEN;
  // Frozen along with distance. Leaving this running was enough on its own to
  // make a "frozen" frame non-reproducible: the smoothed slope kept creeping,
  // which moves the camera height and its aim point, which shifts EVERY pixel
  // in the frame a little. A diff-based measurement then reads the whole screen
  // as changed. Measured noise floor before this line was guarded: 2,700 pixels
  // differing across 724 columns between two supposedly identical captures.
  if (!tune.freeze) st.slope += (slopeNow - st.slope) * Math.min(1, dt * 7);

  // Steering authority rises with speed, because a stationary car should not
  // slide sideways — but far from linearly, so the top end stays controllable.
  // Braking adds grip on top: brake INTO the corner and the car tucks in.
  const grip = (0.45 + 0.55 * Math.min(v, 1)) * (braking ? BRAKE_GRIP : 1);
  st.x += st.steer * STEER_RATE * dt * grip;
  // Centrifugal push: a corner throws you to the outside. This is the
  // difference between steering and driving. CENTRIFUGAL is derived from the
  // track's worst corner (see deriveHandling) so this can never again quietly
  // exceed the amount of steering the player actually has.
  st.x -= track.curve[base] * st.speed * dt * CENTRIFUGAL;
  // HOW FAR OFF THE ROAD YOU CAN GET, and it is bounded by the buildings now
  // rather than by a round number.
  //
  // This was ROAD_W + 6 = 15, and the nearest building FACE stands at x = 12.60
  // (measured across every slot: offset ROAD_W + 8 + row*11 + (slot%3)*2.5,
  // less half the building's own width). Add the right-hand driving position at
  // +0.62 and the first-person eye reached 15.62 — three units INSIDE a wall,
  // which blacks out the whole windscreen. Found by the city-ink verifier, not
  // by playing, because you have to be pinned against the far kerb to see it.
  //
  // STRAY_MAX leaves a unit and a half of clearance from that measured 12.60,
  // and still lets you get well off the tarmac — the road plus its rumble strip
  // ends at 10.1, so there are two units of pavement to slither along.
  st.x = clamp(st.x, -STRAY_MAX, STRAY_MAX);

  // ---- OFF THE TARMAC ------------------------------------------------------
  //
  // Until now the edges of the road were decoration: you could sit on the
  // pavement at 200mph and nothing happened, so there was no reason to stay
  // between the lines and no cost to getting a corner wrong. A racing game in
  // which leaving the track is free is a game with no track.
  //
  // A RETARDING FORCE PROPORTIONAL TO SPEED, not a flat deceleration, because
  // that is what rough ground does — it costs you most when you are going
  // fastest, and it never quite stops you, so you can always crawl back on.
  //
  // AND IT SCALES WITH HOW FAR OFF YOU ARE. Clipping the kerb should be a
  // warning; putting all four wheels on the pavement should be an event.
  // Between ROAD_W and STRAY_MAX there are 2.1 units to grade it across, so a
  // small mistake costs a small amount. A flat penalty at the white line would
  // make every twitch a disaster, which is the sort of thing that reads as the
  // game being unfair rather than as the player being wrong.
  // HOLD THE CAR AT A LATERAL OFFSET, for harnesses only. Assigning st.x from
  // outside does not work: this loop rewrites it every frame from the steering
  // and the corner, so an external write survives a fraction of a frame. The
  // off-road harness tried exactly that and its control row — the car parked on
  // the white line, where the penalty is zero by definition — came back at
  // 161mph instead of 202. A measurement whose known-good case is wrong is not
  // reporting on the game, and every other row it printed was worthless too.
  if (tune.holdX !== null) st.x = tune.holdX;

  st.off = Math.max(0, (Math.abs(st.x) - ROAD_W) / (STRAY_MAX - ROAD_W));
  if (st.off > 0 && !tune.freeze) {
    st.speed -= OFFROAD_DRAG * (st.off ** OFFROAD_BITE) * st.speed * dt;
    if (st.speed < 0) st.speed = 0;
  }

  // ---- THE GATE. Everything above this line is the car; everything below is
  // the picture. On a capped frame we stop here, having advanced the physics
  // for a tenth of a millisecond, and skip the road rewrite, the seven
  // thousand instance matrices, the furniture and the draw.
  //
  // Snapping to the NEAREST vsync rather than the next one past the period is
  // what makes the pacing exact: at 60Hz and a cap of 30, acc reaches 16.7ms
  // (below the 25ms threshold, skip) then 33.3ms (draw, subtract a full
  // period, remainder zero). No drift, no 35/30/35 stutter.
  const every = DIVISORS[divI];
  if (every > 1 && ++vsyncN < every) return;
  vsyncN = 0;
  drawn++;

  // FRAME TIME IS MEASURED BETWEEN DRAWN FRAMES, not between vsyncs. Sampling
  // every vsync would report a serene 16.7ms and 60fps while the picture was
  // actually updating at 30 — a readout that says the cap is not working when
  // it is, which is the sort of thing that gets a good change reverted.
  const dtDraw = (now - lastDraw) / 1000;
  lastDraw = now;
  const msDraw = Math.min(dtDraw, 0.1) * 1000;
  frames[fi] = msDraw;
  fi = (fi + 1) % SAMPLES;
  if (filled < SAMPLES) filled++;
  if (msDraw > worst) worst = msDraw;

  // CPU TIME, MEASURED SEPARATELY FROM THE FRAME TIME.
  //
  // "The frame rate dropped" does not say why, and the two answers need
  // opposite fixes: if the GPU is the wall, draw less; if our own JavaScript is
  // the wall, draw the same amount with less bookkeeping. At 120,000 scenery
  // instances we compose 120,000 matrices a frame in JS while the GPU issues
  // one call, so the readout needs to distinguish them or the next round of
  // work goes to the wrong place.
  const cpu0 = performance.now();
  road.update(track, base, frac, st.x, baseY);
  PROF.road += performance.now() - cpu0;
  const t1 = performance.now();
  posts.update(track, base, frac, st.x, baseY);
  PROF.posts += performance.now() - t1;
  const t2 = performance.now();
  scenery.update(track, base, frac, st.x, baseY);
  PROF.scenery += performance.now() - t2;
  const t3 = performance.now();
  furniture.update(track, base, frac, st.x, baseY);
  PROF.furniture += performance.now() - t3;
  gantry.update(track, base, frac, st.x, baseY);
  PROF.n++;   // smoothed, not spiky

  // --- car pose ---
  //
  // THE CAR PITCHES WITH THE ROAD, and it did not until now. It sat dead level
  // while the ground under it rose and fell by up to a hundred units, which
  // looked survivable in third person and was ruinous in first: on a descent the
  // road drops away while a level bonnet stays exactly where it was, so the
  // bonnet occludes the road you are about to drive on. Measured across the
  // track, the share of tarmac still visible past the bonnet was 27% on climbs
  // and 7% on descents, with a worst case of 0.2% — driving blind over every
  // crest.
  //
  // The fix is not to shrink the bonnet or lift the camera, both of which treat
  // the symptom. It is that a car sitting on a slope points along the slope.
  // Pitching it means the bonnet falls away with the road instead of standing
  // up in front of it, and third person gets the same thing for free: the car
  // visibly noses down over a crest.
  //
  // The CAMERA deliberately does not pitch with it. It keeps its own aim, so
  // the horizon stays steady while the car moves underneath — which is what a
  // stabilised chase camera does and what stops a hill feeling like a lurch.
  car.position.set(0, 0, 0);
  car.rotation.x = Math.atan(st.slope) * tune.pitch;
  car.rotation.z = -st.steer * 0.07;
  car.rotation.y = st.steer * 0.05;

  // --- camera ---
  // THE CAMERA AIMS AT THE ROAD, NOT AT A FIXED POINT IN SPACE.
  //
  // A camera with a fixed lookAt height watches hills happen to somebody else:
  // the road rises in the frame and the view does not move, so a crest reads as
  // the road bending rather than as you climbing. Aiming at the road's ACTUAL
  // height some distance ahead makes the camera pitch up on a ramp and drop over
  // a crest, which is where nearly all of the sensation of elevation comes from.
  //
  // The look-ahead distance is matched to the aim point, so the two agree: 8
  // segments is 48 units, and third person aims 46 ahead.
  const aimY = (segs) => track.hill[(base + segs) % track.n] - baseY;

  if (tune.studio) {
    const { az, el, dist } = tune.studio;
    const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
    camera.position.set(sa * ce * dist, 1.0 + se * dist, ca * ce * dist);
    camera.lookAt(0, 1.0, 0);
    // RESPECT showBody HERE TOO. Forcing it true made the silhouette harness
    // measure an empty mask: it isolates the car by rendering the same pose
    // twice with the body hidden on the second pass, and studio mode was
    // quietly overriding the hide. Two long software-renderer runs reported
    // "0.0% match, POOR" - which looks exactly like a bad car rather than a
    // broken instrument.
    bodyKit.group.visible = tune.showBody;
    cockpit.group.visible = false;
    renderer.render(scene, camera);
    return;
  }

  cockpit.group.visible = st.view === 1 && tune.showCockpit;
  if (st.view === 1) {
    // Reused, not rebuilt. A fresh object literal here is one allocation per
    // frame, sixty times a second, against this project's own rule.
    COCKPIT_STATE.speed = st.speed;
    COCKPIT_STATE.maxSpeed = tune.maxSpeed;
    COCKPIT_STATE.steer = st.steer;
    COCKPIT_STATE.boosting = boosting;
    COCKPIT_STATE.braking = braking;
    COCKPIT_STATE.rev = st.rev;
    COCKPIT_STATE.gear = st.gear;
    // Passed rather than assumed, because the garage will sell engines with
    // different boxes and a cockpit that hardcodes five would quietly stop
    // telling the truth the day the first six-speed is bought.
    COCKPIT_STATE.gears = GEARS.length;
    COCKPIT_STATE.race = race;
    cockpit.update(COCKPIT_STATE);
  } else {
    cockpit.update(null);
  }

  if (st.view === 3) {
    // Two flags, not a walk over every child. The old version wrote
    // `visible` to every mesh in the car group on every frame to implement a
    // toggle that changes twice a minute.
    bodyKit.group.visible = tune.showBody;
    // Low and close. A high camera looking down makes the road a narrow ribbon
    // in the middle of the frame with dead ground underneath, and reads slow;
    // dropping the eye and aiming further down the road raises the horizon,
    // fills the frame with tarmac and makes the same speed feel quicker.
    // The suspension term pushes the eye down as you crest and up as you dip,
    // which is the compression a real car would feel.
    // The aim is BLENDED toward level rather than following the road exactly.
    // Following it 1:1 is technically right and plays badly: on the steepest
    // climb the view pitches up far enough that the road leaves the bottom of
    // the frame, so the hardest part of the track is the part you cannot see.
    // Two thirds keeps the sensation and keeps the road.
    // CLOSER THAN IT WAS. Measured: at 12 + v*2.5 the car spanned 181px of a
    // 1008px frame — 18%. A car you cannot see is a car not worth detailing,
    // and every hour spent on the bodywork was being thrown away by the camera
    // rather than by the model. The lever is here, not in body.js: the car is
    // already 3.9 units wide against an 18-unit road, so scaling the model
    // would make the road look narrow instead.
    // HIGHER, AND PITCHED DOWN. Anthony: "the POV would be slightly higher as
    // the road ahead wouldn't be visible" — a functional point, not a stylistic
    // one. You cannot drive what you cannot see.
    //
    // Measured against his high-camera reference: its vanishing point sits 33%
    // down the frame and ours sat at 46%, so a third of the road he can see was
    // missing from ours. Raising the eye and aiming BELOW it pitches the camera
    // down, which pushes the horizon up the frame and opens out the tarmac in
    // between. Roughly four degrees of pitch buys the thirteen percent.
    camera.position.set(-st.steer * 1.1, tune.camY + v * 0.5 - st.slope * 3, tune.camZ + v * 1.6);
    camera.lookAt(st.steer * 3.0, tune.aimY + aimY(8) * 0.7, -46);
  } else {
    // First person: the bodywork goes, the cockpit stays.
    bodyKit.group.visible = false;
    camera.position.set(tune.driverX, 1.6 - st.slope * 1.5, 1.2);
    // The aim carries the same offset. Moving the eye without moving the aim
    // point would yaw the whole view a few degrees to the left, permanently.
    camera.lookAt(tune.driverX + st.steer * 3.5, 1.5 + aimY(6) * 0.6, -20);
  }
  // Field of view opens up with speed. The cheapest, strongest speed cue there
  // is — nothing on screen changes, but the world rushes. Horizontal, so it
  // reads the same in portrait and landscape.
  const wantFov = 74 + v * 20;
  if (Math.abs(baseFov - wantFov) > 0.05) { baseFov = wantFov; applyFov(baseFov); }

  const tRender = performance.now();
  renderer.render(scene, camera);
  PROF.render += performance.now() - tRender;
  // THE TIMER NOW INCLUDES THE RENDER CALL, and it did not before.
  //
  // `cpu in update` wrapped only the four update() calls, so it read 2.7ms
  // while the frame took 33.0ms — and the missing 30ms was three.js uploading
  // 18MB of unused instance matrices inside renderer.render(). The one number
  // that should have caught the biggest bug of the day was measuring around it.
  //
  // A profiler that excludes the most expensive thing your code causes does not
  // merely fail to help; it actively points somewhere else.
  cpuMs += (performance.now() - cpu0 - cpuMs) * 0.1;

  // --- readout ---
  if (now - hudT > 250) {
    hudT = now;
    const ms = median();
    const fps = ms > 0 ? Math.round(1000 / ms) : 0;
    fpsEl.textContent = String(fps);
    // GREEN MEANS "HITTING THE TARGET", NOT "ABOVE FIFTY-FIVE". With the cap at
    // 30 the readout printed a perfect, deliberate, never-missed 30 in alarm
    // red — a readout arguing with the setting on the line below it.
    const target = panelHz / DIVISORS[divI];
    fpsEl.className = fps >= target * 0.92 ? 'ok' : fps >= target * 0.6 ? 'mid' : 'lo';
    const info = renderer.info.render;
    // Cornering margin, live: how much steering you have versus how hard the
    // corner you are IN is pushing. Below 1.0 the corner is winning and no
    // input can save it. This number existing at all is the point — the bug it
    // replaces was invisible precisely because nothing displayed it.
    const push = Math.abs(track.curve[base]) * st.speed * CENTRIFUGAL;
    const margin = push > 0.001 ? (STEER_RATE * grip) / push : 99;
    statsEl.textContent =
      `  ${Math.round(st.speed * MPH)} mph  of ${Math.round(top * MPH)}` +
        `${boosting ? '  BOOST' : braking ? '  BRAKE' : ''}\n` +
      `race        ${race.state}  ${race.state === 'countdown'
          ? (COUNTDOWN - race.t).toFixed(1) : race.elapsed.toFixed(2)}s` +
        `  ${Math.max(0, RACE_FROM + RACE_LEN - st.dist).toFixed(0)} to go` +
        `${race.best !== null ? `   best ${race.best.toFixed(2)}s` : ''}` +
        `${race.bestTop !== null ? ` / ${Math.round(race.bestTop * MPH)}mph` : ''}\n` +
      `gear        ${st.gear + 1}/${GEARS.length}  revs ${(100 * st.rev).toFixed(0)}%` +
        `${st.rev >= REDLINE ? ' RED' : ''}  tops at ` +
        `${Math.round(top * GEARS[st.gear] * MPH)}\n` +
      `draw calls  ${info.calls}\n` +
      `triangles   ${info.triangles}\n` +
      `worst frame ${worst.toFixed(0)} ms\n` +
      `fps cap     ${DIVISORS[divI] === 1 ? 'none' : Math.round(panelHz / DIVISORS[divI])}` +
        `  1 in ${DIVISORS[divI]} of ${panelHz}Hz  drew ${drawn}/${simmed}\n` +
      `cpu total   ${cpuMs.toFixed(1)} of ${ms.toFixed(1)} ms  ` +
        `(render ${(PROF.render / Math.max(1, PROF.n)).toFixed(1)})\n` +
      `scenery     ${scenery.count} of ${scenery.want} (max ${scenery.max})\n` +
      `corner grip ${margin > 20 ? '--' : margin.toFixed(1)}  (under 1 = losing)\n` +
      `steering    ${tilt.on ? 'TILT' : tilt.ok ? 'touch/ready' : 'touch/none'}` +
        `  out ${tilt.out.toFixed(2)}${tilt.invert ? ' INV' : ''}\n` +
      `tilt        ${tilt.axis} ${tilt.raw.toFixed(0)}d  zero ${tilt.zero === null ? '-' : tilt.zero.toFixed(0)}  scr ${tilt.angle}\n` +
      `screen lock ${wake.state}   ${fs.state}\n` +
      `pixel ratio ${renderer.getPixelRatio().toFixed(2)} of ${(window.devicePixelRatio || 1).toFixed(2)}\n` +
      `canvas      ${renderer.domElement.width}x${renderer.domElement.height}`;

    // THE RIGHT-HAND COLUMN: what identifies the run rather than what changes
    // during it. Both halves have to survive being photographed, and on a
    // 360px-tall viewport one column of eighteen lines does not.
    //
    // Rebuilt every 250ms with the rest, which is wasteful for six static
    // fields — but a second timer to save six string concatenations a second is
    // the kind of saving that costs more in bugs than it returns in
    // microseconds, and PROF says the whole readout is inside the noise.
    stats2El.textContent =
      `build       ${DEV.build}\n` +
      `WebGL       ${DEV.webgl}   maxtex ${DEV.maxTex}\n` +
      `screen      ${DEV.screen} at dpr ${DEV.dpr}\n` +
      wrapField('GPU', DEV.renderer) +
      wrapField('vendor', DEV.vendor) +
      // A SHORT BROWSER AND OS RATHER THAN THE RAW AGENT. The full string is 110
      // characters of boilerplate that wraps to five lines in a narrow column,
      // and now that the GPU is named outright it is the least informative
      // thing on the panel. It is still on window.__DEVICE in full, and the
      // failure screen still prints it whole — that is the moment it earns its
      // space, because a page that would not start has no other clues.
      wrapField('browser', shortAgent(DEV.ua)).replace(/\n$/, '');
    worst = 0;
    drawn = 0; simmed = 0;
  }
}

requestAnimationFrame(frame);

// Exposed so a harness can read the same numbers the player sees.
window.RACER = {
  st, renderer, scene, camera, median, handling, tune, tilt, pedal, wake, fs, track,
  bodyKit, cockpit, scenery, furniture, gantry, PROF,
  // The pacing, so a harness can prove the cap draws what it claims rather
  // than trusting the readout that the cap itself writes.
  pace: {
    divisors: DIVISORS,
    get panelHz() { return panelHz; },
    get i() { return divI; }, set i(v) { divI = clamp(v, 0, DIVISORS.length - 1); vsyncN = 0; },
    get drawn() { return drawn; }, get simmed() { return simmed; },
  },
  // Exposed so the checks assert against the real constants rather than
  // against numbers copied into a test file, which then drift apart.
  race, startRace,
  consts: { ROAD_W, STEER_RATE, BRAKE_GRIP, CORNER_AUTHORITY, SPEED_STEPS, SEG_LEN, STRAY_MAX,
            GEARS, REDLINE, MPH, RACE_FROM, RACE_LEN, COUNTDOWN },
};
