// The gantries — one over the start line, one over the finish, both carrying
// the SVU branding.
//
// SVU is Super Victor Universe. It began as an NFT project raising money for
// one child's treatment and is now a not-for-profit funding help for other
// seriously ill children; the portrait in src/art/svu.js is from its pixel-art
// collection and is used with the collection owner's permission. It is the only
// downloaded byte in this game, and it is the one thing on the banner that must
// not come out smudged — so the filtering is set explicitly where the texture
// is made, and the reason the two filters differ is written there rather than
// left to be rediscovered.
//
// ===========================================================================
// TWO DRAW CALLS, AND WHY IT IS EXACTLY TWO
// ===========================================================================
//
// The frame budget is 16 and eleven are already spent, so this file may have
// two. It gets them like this:
//
//   1. THE STRUCTURE. Legs, plinths, board, chequer band, the banner's frame,
//      and the INK round all of it — one static merged vertex-coloured
//      BufferGeometry in one MeshBasicMaterial.
//
//      Including the ink, which normally costs a second call, because an
//      inverted hull wants `side: BackSide` while the object it outlines wants
//      FrontSide. It does not have to. An inverted hull is nothing more than
//      "draw the FAR faces of a fattened black copy", and reversing the WINDING
//      of those triangles asks a FrontSide material for exactly the same
//      faces. So the ink shells sit in the same buffer as the boxes they
//      outline, wound backwards, and the whole structure is one call. Depth
//      sorts them without any renderOrder: the shell is strictly behind the
//      box everywhere the two overlap, so the box wins and only the rim
//      survives, which is the entire trick.
//
//   2. THE BANNER. A textured quad, so it needs its own material and there is
//      no way round the second call. The portrait AND the lettering therefore
//      share ONE canvas — two textures would have been a third call and there
//      is no third call. That constraint turned out to be the right design
//      anyway: art and words on one panel is what a sign is.
//
// ONE MESH, MOVED, RATHER THAN TWO BUILT. The claim is that the two gantries
// can never both be on screen, so one set of geometry serves both. That is not
// assumed here, it is checked. The road draws SEG_COUNT segments ahead and
// BEHIND behind — 225 segments, 1,350 units — and the lines are RACE_LEN apart,
// which is 12,000 units one way round the 24,000-unit loop and 12,000 the
// other. `stats.bothInRange` counts the frames where that arithmetic came out
// wrong and must stay at zero; tools/gantryshots.mjs prints it.
//
// ===========================================================================
// HOW IT STAYS ON THE ROAD THROUGH CORNERS AND OVER CRESTS
// ===========================================================================
//
// The gantry is RIGID — one object, one position, no per-frame vertex writes —
// and that is only correct because of how this road is built. Road.update
// draws segment i as a quad from (xa + l, ya, za) to (xb + l, yb, zb): the
// lateral offset `l` is added in PURE X at both ends, so the ribbon is SHEARED
// sideways rather than rotated. A corner does not turn the road's
// cross-section; the cross-section stays parallel to the X axis the whole way
// round the track. A beam laid along X is therefore square to the road on the
// tightest corner on it, and needs no Y rotation to get there. Rotating the
// gantry to face the direction of travel would be the bug, not the fix — it
// would swing the legs off the pavement the road is sheared onto.
//
// Height is the same story: `hill` varies ALONG the road and not ACROSS it, so
// both legs stand on one segment at one height and a crest tilts nothing. What
// a crest does do is put the front and the back of a leg — 0.9 units apart in
// z — on ground that differs by up to 0.3 units, so the feet are sunk well
// below the pavement rather than resting on it. A buried foot is invisible; a
// floating one is the first thing anybody sees.
//
// WHERE the object goes is the part that is easy to get wrong, and
// furniture.js already had the answer. Road.update starts its lateral walk
// BEHIND the camera and subtracts the offset that walk accumulated, so anything
// that wants to sit on the road has to reproduce that walk exactly. Starting at
// the car instead leaves the walk short by the whole behind-portion on the
// first segment and then integrates that error once per segment for the next
// 220; on a hard corner it is hundreds of units by the far end of the road. The
// walk below is furniture.js's, line for line, including the `px` pre-walk —
// only stopped early, at the one segment the gantry stands on, instead of run
// to the horizon.

import {
  BufferGeometry, BufferAttribute, Mesh, MeshBasicMaterial, PlaneGeometry, Group,
  Color, CanvasTexture, NearestFilter, LinearMipmapLinearFilter,
  ClampToEdgeWrapping, SRGBColorSpace,
} from 'three';

import { SVU_ART_64 } from '../art/svu.js';

// ---------------------------------------------------------------- the layout
//
// COPIED FROM furniture.js, AND THAT IS A LIABILITY WORTH NAMING. These three
// numbers describe the same kerb that file builds. If they drift apart the
// gantry legs end up in the gutter or out in the road, and nothing would fail —
// it would just look wrong. They are not imported because furniture.js does not
// export them and its interface is not mine to change; instead the feet get
// photographed by tools/gantryshots.mjs, which is the check that would actually
// catch a drift.
const VERGE_W = 1.1;    // rumble strip, outboard of the tarmac
const KERB_W = 1.35;    // the sloping kerb band
const KERB_H = 0.34;    // how high the pavement stands above the tarmac

/**
 * Where the legs stand, measured from the road centre.
 *
 * OUTSIDE THE KERB, AND IN THE GAP IN THE STREET FURNITURE. The kerb top is at
 * ROAD_W + VERGE_W + KERB_W = 11.45 and the pavement runs out to 17.55. Lamp
 * columns sit at 12.55, railings at 11.95 and bins at 13.05, so a 0.8-wide leg
 * centred on 12.2 spans 11.8 to 12.6 and lands between them. Neither line
 * carries a lamppost or a crossing in any case: they are segments 100 and 2100
 * against a LAMP_EVERY of 8 and a CROSS_EVERY of 56, and neither divides.
 */
const LEG_X = 12.2;
const LEG_W = 0.8;
const LEG_D = 0.9;
/**
 * The legs stand BEHIND the board, and that is a bug fix rather than a detail.
 *
 * With the legs centred on z = 0 they are 0.9 deep against the board's 0.7, so
 * their front faces stood 0.1 proud of the sign — and since the legs run the
 * full height, they cut the last three squares off each end of the chequer
 * band. It read as a band that had been printed too short. Setting them back
 * 0.3 puts the leg front at -0.15 and the board front at +0.35, so the board
 * covers them, which is also how a real sign is hung: frame behind, panel in
 * front.
 */
const LEG_Z = -0.3;
/** How far the feet are buried. See the note on crests in the header. */
const FOOT_SINK = 0.8;

/**
 * Clearance under the board, above the pavement.
 *
 * THIS IS A READABILITY BUDGET, NOT AN ENGINEERING ONE. A unit is a shade under
 * a metre, so 5.1 is about four and a half — a race gantry, not a motorway
 * bridge. It is as low as it is because this game is first person and the view
 * is out of a WINDSCREEN, whose header cuts the frame off about sixteen degrees
 * above the eye when the car is stopped. Something h units above the 1.6-unit
 * eyeline goes behind that header at h / 0.29 units away, so every unit the
 * board is raised costs three and a half units of the approach where the banner
 * can still be read.
 *
 * AT SPEED IT IS A DIFFERENT NUMBER, and that is the one that matters. The
 * field of view opens from 74 to 94 degrees with speed, which takes the header
 * out to about 22 degrees and the cut-off to h / 0.40 — the banner centre at
 * 6.9 above the eye stays in shot to 17 units instead of 24. The approach to a
 * finish line happens at 200 units a second, so the wide number is the one the
 * player lives in; the narrow one is what they get on the grid, where they are
 * standing under the start gantry anyway. tools/gantryshots.mjs photographs
 * both, because photographing only the stationary one measures a pose nobody
 * plays from — which is a mistake this project has already made twice.
 */
const CLEAR = 5.1;
const BOARD_H = 4.6;
const BOARD_D = 0.7;
/** The board overhangs the legs, so the ends read as a cap and not a butt. */
const BOARD_OVER = 0.7;
const BOARD_W = 2 * LEG_X + LEG_W + 2 * BOARD_OVER;

/** The banner: the size every measurement in the brief was taken at. */
const BANNER_W = 16;
const BANNER_H = 3;
/** Clear space above the banner and below the band, inside the board. */
const BANNER_PAD = 0.25;
const BANNER_Y = CLEAR + BANNER_PAD + BANNER_H / 2;

/**
 * The band across the top of the board.
 *
 * TWO ROWS, because one row of squares is a dashed line and not a chequer —
 * the alternation has to happen in both directions or the eye reads a row of
 * dashes. Thirty-three columns across 26.6 units puts a square at 0.81 by 0.45,
 * which is 26 by 14 phone pixels at 50 units out: coarse enough to survive the
 * fog and fine enough to read as a flag rather than as stripes.
 */
const BAND_ROWS = 2;
const BAND_COLS = 33;
const BAND_H = 0.45 * BAND_ROWS;
const BAND_TOP = CLEAR + BOARD_H - 0.25;

/**
 * Ink thickness for the gantry, in world units.
 *
 * FATTER THAN THE STREET'S, and for the same reason furniture.js makes it
 * THINNER for bins: ink is a fixed width in world units, so what matters is its
 * width AGAINST THE OBJECT. On a 0.74-unit bin, 0.12 is a third of the object
 * and becomes a smudge; on a 26-unit board it is a two-hundredth and vanishes.
 * At 0.17 the line is about 5 phone pixels at 30 units and 2 at 80 — a drawn
 * line at both, which is the whole point of the style.
 */
const INK_W = 0.17;

/**
 * How far away the gantry is still worth drawing, in segments.
 *
 * WORKED OUT FROM THE FOG, not picked. The fog is exp2 at density 0.0030, so
 * the surviving fraction of an object at depth d is exp(-(0.003 d)^2): 45% at
 * 300 units, 11% at 500, 2% at 660 and 0.07% at 900. At 130 segments — 780
 * units — the board is three tenths of one percent of itself and the rest is
 * haze, so past that the two draw calls buy literally nothing. Inside it the
 * banner fades UP out of the murk as you approach, which is what a landmark
 * should do.
 */
const GANTRY_FAR = 130;

/**
 * ---- A FINDING, RECORDED WHERE IT WOULD BE FIXED ---------------------------
 *
 * ON THE GRID YOU CANNOT SEE THE START GANTRY AT ALL, and that is not a bug in
 * this file — it is what "a gantry spanning the road AT the start line" means
 * when the car starts ON that line. startRace() puts st.dist at RACE_FROM,
 * which is exactly where this structure stands, so the board is directly
 * overhead and the legs are behind the A-pillars. shots/on-the-line.png is the
 * frame: an empty street. The countdown, the launch and the first second of
 * every race therefore happen with no SVU branding in shot, and the player's
 * first sight of a gantry is the finish one, twelve thousand units later.
 *
 * It is left where it was specified rather than quietly moved, because where
 * the start line goes is the owner's call. If he wants it visible from the
 * grid the change is one number in main.js — `from: RACE_FROM + 42` — which
 * puts it seven segments up the road, in shot from the moment the lights go
 * out, and you launch through it. The cost is that the timing line and the
 * arch stop being the same place.
 */

// -------------------------------------------------------------- the palette
//
// Linear, via Color.setHex, for the reason furniture.js sets out at length: a
// vertex-colour buffer holds LINEAR values and three.js converts them to sRGB
// on the way out, so writing hex/255 straight in ships an sRGB number down a
// linear pipe and it gets gamma-corrected a second time. Everything comes out
// about twice as bright as the colour it was chosen as, and it does not look
// broken — it just looks wrong in a way that invites fiddling with numbers.
const _c = new Color();
const rgb = (hex) => { _c.setHex(hex); return [_c.r, _c.g, _c.b]; };

const C = {
  // Steel, and LIGHTER THAN THE LAMPPOSTS ON PURPOSE. furniture.js paints its
  // columns 0x232936, and a leg at that value disappeared into the buildings
  // behind it — sampled off the finish-30 frame, the facades there run 0x2c3547
  // to 0x39435a, so the leg was darker than its own background and the only
  // thing separating them was the ink. A gantry leg is a foot thick and nine
  // units tall; it should read as the nearest solid object in that part of the
  // frame, not as a gap between two buildings.
  leg:     rgb(0x414d63),
  plinth:  rgb(0x2a3140),
  board:   rgb(0x0f2751),   // SVU blue, taken well down: PAL.skyMid is 0x1b3a6b
                            // and a board at the sky's own value has no silhouette
  ink:     rgb(0x090b10),   // the same near-black the street is inked with
  frame:   rgb(0x090b10),
  chequeA: rgb(0x101219),   // FINISH: the flag, near-black and off-white
  chequeB: rgb(0xd8dee6),
  startA:  rgb(0x0f5fb0),   // START: the same blue and cream the banner is
  startB:  rgb(0xe4d5a8),   // drawn in, so the two gantries are a family
};

// ------------------------------------------------------------ the banner art
//
// One canvas carries the portrait AND the words, because two textures would be
// two draw calls and there are not two to spend.
//
// THE SIZE IS DERIVED FROM THE PHONE, not chosen for tidiness. The banner is 16
// world units across and spans 849 device pixels at 18 units out on the owner's
// 1440-wide screen, so 1024 texels across it is a shade over one texel per
// pixel at the closest distance it is still readable from. Wider costs nothing
// to download — nothing here is downloaded — but it is still a runtime
// allocation and a mipmap chain on a Helio A22.
//
// 1024 x 192 IS THE BANNER'S 16:3 EXACTLY, so nothing is stretched, and 192 is
// 3 x 64 EXACTLY, so the 64-pixel portrait upscales into its tile by an integer
// factor and every art pixel lands the same size as every other one. A
// non-integer upscale is the classic way to turn pixel art into a mixture of
// two-pixel and three-pixel blocks, and on a face it is visible instantly.
const CAN_W = 1024;
const CAN_H = 192;
const ART_PX = 192;      // 64 * 3, exactly
const ART_X = 14;
const PANEL_INK = 9;     // the comic panel border, in canvas pixels

const CREAM = '#efe3c2';
const INKC = '#12141c';
const SVU_BLUE = '#0f5fb0';

/**
 * Paint the banner.
 *
 * Called once at boot with no art and again the moment the embedded PNG has
 * decoded. A data URL still decodes ASYNCHRONOUSLY — `new Image()` with a
 * data:src does not have pixels on the next line — and a banner that waited for
 * it would be a blank board for the first frames, or worse, a texture uploaded
 * from an empty canvas and never uploaded again.
 */
function paintBanner(x, img) {
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.fillStyle = CREAM;
  x.fillRect(0, 0, CAN_W, CAN_H);

  // Comic speed slashes behind the lettering. Deliberately low contrast: they
  // exist so that eight hundred pixels of flat cream does not read as a blank
  // sheet, and anything stronger fights the words that have to survive at 80
  // units, where the whole banner is 191 pixels wide.
  x.fillStyle = 'rgba(15,95,176,0.10)';
  for (let i = 0; i < 9; i++) {
    const x0 = 250 + i * 92;
    x.beginPath();
    x.moveTo(x0, 0); x.lineTo(x0 + 34, 0);
    x.lineTo(x0 - 24, CAN_H); x.lineTo(x0 - 58, CAN_H);
    x.closePath();
    x.fill();
  }

  // ---- the portrait, on the LEFT, as agreed ----
  //
  // NEAREST HERE TOO, EXPLICITLY. imageSmoothingEnabled defaults to TRUE on a
  // 2d context, so the default behaviour for an upscale is a bilinear blur —
  // and a blur applied HERE is permanent. It is baked into the texture, and no
  // amount of correct filtering on the GPU afterwards gets the hard pixel edges
  // back. This is the first of the two places the art can be ruined.
  if (img) {
    x.imageSmoothingEnabled = false;
    x.drawImage(img, 0, 0, 64, 64, ART_X, 0, ART_PX, ART_PX);
    x.imageSmoothingEnabled = true;
  }
  // The tile's own frame, drawn ON the boundary so it eats about two art pixels
  // a side. The top two rows of the source are empty and the hoodie runs off
  // the bottom edge anyway, so there is nothing there to lose.
  x.strokeStyle = INKC;
  x.lineWidth = 12;
  x.strokeRect(ART_X, -8, ART_PX, CAN_H + 16);

  // The box the words live in: from the right edge of the portrait tile's ink
  // to just inside the panel border, which is PANEL_INK wide on each side.
  drawWords(x, ART_X + ART_PX + 20, CAN_W - PANEL_INK - 5);

  // The panel border last, over everything, so the lettering cannot poke out of
  // its own sign.
  x.strokeStyle = INKC;
  x.lineWidth = PANEL_INK * 2;
  x.strokeRect(0, 0, CAN_W, CAN_H);
}

/**
 * "SVU Racer", to the right of the portrait.
 *
 * THE LAYOUT IS MEASURED, NOT ASSUMED, and that is the whole reason this is
 * more than one fillText. There is no downloaded font in this game and there is
 * not going to be one, so the glyphs come from whatever the device calls
 * `sans-serif` — Roboto on the target phone, something else on a desktop, and
 * the two are not the same width. A hardcoded size fits on the machine it was
 * tuned on and either overflows the panel or leaves a third of it empty
 * everywhere else. So: measure the string, scale it horizontally into the box
 * it has to live in, and centre it vertically on the ink it actually laid down
 * rather than on a font metric that may not exist.
 *
 * The horizontal scale is CLAMPED. Stretching to fill is right when the font is
 * close to the one this was drawn against and grotesque when it is not, and an
 * off-centre word is a much smaller failure than a smeared one.
 *
 * COMIC LETTERING IS FOUR PASSES, in this order and no other:
 *
 *   a hard offset shadow in the accent blue  — depth, with no soft edge
 *                                              anywhere, because there is not a
 *                                              soft edge anywhere else in this
 *                                              game
 *   a heavy stroke in the ink colour         — this is what "heavy ink" means:
 *                                              stroking in the SAME colour as
 *                                              the fill FATTENS the letterform,
 *                                              which is what a brush does and
 *                                              what a font weight cannot
 *   the fill                                 — over the stroke, never under it,
 *                                              or the stroke eats half the
 *                                              letter from the inside
 *   a thin light keyline along the top       — stops heavy black lettering
 *                                              going dead against a light panel
 */
function drawWords(x, x0, x1) {
  const WORDS = 'SVU Racer';
  const boxW = x1 - x0;
  const FS = 150;

  x.save();
  x.font = `bold ${FS}px sans-serif`;
  x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
  const m = x.measureText(WORDS);
  // actualBoundingBox is exact where it exists; the fallback is the classic
  // 0.72 cap-height rule, which is close enough to centre a word by.
  const asc = m.actualBoundingBoxAscent || FS * 0.72;
  const desc = m.actualBoundingBoxDescent || FS * 0.02;
  const wordW = m.width;
  const lean = 0.12;
  const clamp = (v) => Math.max(0.62, Math.min(1.45, v));

  // ---- THE THREE THINGS THAT MAKE THE WORD WIDER THAN measureText SAYS ----
  //
  // The first version of this scaled the advance width into the box and the
  // final "r" came out sitting on the panel border — visible immediately in
  // shots/banner-canvas.png, and invisible in a game frame, where it just
  // looks like the sign is a bit tight. measureText returns the ADVANCE, which
  // is where the next glyph would start. What actually lands on the canvas is
  // wider than that by:
  //
  //   the shear   the transform is x' = sx*x - lean*y, and the shear term is
  //               NOT scaled by sx, so the TOP of the glyphs sits lean*asc to
  //               the right of the baseline — 13 pixels at this size
  //   the stroke  half of the 13-pixel ink line hangs outside the letterform,
  //               and that half IS scaled by sx
  //   the shadow  offset 10 to the right, also scaled by sx
  //
  // So the box is shrunk by all three before the scale is fitted to it. The
  // scale is computed twice because two of the three allowances depend on it;
  // one pass is enough, they move by a few percent.
  const STROKE = 13, SHADOW = 10;
  let sx = clamp(boxW / wordW);
  const padR = lean * asc + (STROKE / 2 + SHADOW) * sx;
  const padL = (STROKE / 2) * sx;
  sx = clamp((boxW - padL - padR) / wordW);
  const left = x0 + padL + (boxW - padL - padR - wordW * sx) * 0.5;
  const baseY = (CAN_H + (asc - desc)) * 0.5;

  // A slight lean. Comic lettering is almost never upright, and a shear costs
  // nothing; 0.12 is about seven degrees — enough to read as drawn rather than
  // typed, not enough to read as a mistake.
  x.setTransform(sx, 0, -lean, 1, left + baseY * lean, 0);
  x.lineJoin = 'round';
  x.lineCap = 'round';

  x.fillStyle = SVU_BLUE;
  x.fillText(WORDS, SHADOW, baseY + SHADOW);
  x.strokeStyle = INKC;
  x.lineWidth = STROKE;
  x.strokeText(WORDS, 0, baseY);
  x.fillStyle = INKC;
  x.fillText(WORDS, 0, baseY);
  x.strokeStyle = 'rgba(255,255,255,0.32)';
  x.lineWidth = 3;
  x.strokeText(WORDS, -1.5, baseY - 3);

  x.restore();
  x.setTransform(1, 0, 0, 1, 0, 0);
}

// ----------------------------------------------------------- mesh building
//
// A tiny append-only builder. It runs ONCE, at boot, so plain arrays are the
// right thing; nothing in this file allocates after that.
class Build {
  constructor() { this.p = []; this.c = []; }
  /** Vertices written so far — the index a caller records to recolour later. */
  get n() { return this.p.length / 3; }

  /**
   * Four corners, counter-clockwise seen from the front, one flat colour.
   * `flip` reverses the winding, which is how the ink shells get into the same
   * buffer as the boxes they outline. Reversing quad (a,b,c,d) is quad
   * (a,d,c,b): the triangles come out (a,d,c) and (a,c,b), which are the two
   * originals with two vertices swapped each.
   */
  quad(a, b, c, d, col, shade, flip) {
    const p = this.p, k = this.c;
    const v = flip ? [a, d, c, a, c, b] : [a, b, c, a, c, d];
    const r = col[0] * shade, g = col[1] * shade, bl = col[2] * shade;
    for (let i = 0; i < 6; i++) {
      p.push(v[i][0], v[i][1], v[i][2]);
      k.push(r, g, bl);
    }
  }

  /**
   * A cuboid, six faces, each with its own shade.
   *
   * THE SHADES ARE CEL SHADING, NOT LIGHTING. There are no lights in this
   * engine and there never will be; these are the hard bands the whole art
   * style is made of, and without them a 26-unit board is one flat rectangle
   * with a line round it. The ink shells pass `flat`, so they stay uniformly
   * black whatever the shading table says — a shaded outline is not an outline,
   * it is a grey halo on one side.
   */
  box(cx, cy, cz, w, h, d, col, flip, flat) {
    const X0 = cx - w / 2, X1 = cx + w / 2;
    const Y0 = cy - h / 2, Y1 = cy + h / 2;
    const Z0 = cz - d / 2, Z1 = cz + d / 2;
    const P = (x, y, z) => [x, y, z];
    const faces = [
      [[P(X0, Y0, Z1), P(X1, Y0, Z1), P(X1, Y1, Z1), P(X0, Y1, Z1)], 1.00],  // front
      [[P(X1, Y0, Z0), P(X0, Y0, Z0), P(X0, Y1, Z0), P(X1, Y1, Z0)], 0.70],  // back
      [[P(X1, Y0, Z1), P(X1, Y0, Z0), P(X1, Y1, Z0), P(X1, Y1, Z1)], 0.80],  // +x
      [[P(X0, Y0, Z0), P(X0, Y0, Z1), P(X0, Y1, Z1), P(X0, Y1, Z0)], 0.80],  // -x
      [[P(X0, Y1, Z1), P(X1, Y1, Z1), P(X1, Y1, Z0), P(X0, Y1, Z0)], 1.20],  // top
      [[P(X0, Y0, Z0), P(X1, Y0, Z0), P(X1, Y0, Z1), P(X0, Y0, Z1)], 0.56],  // bottom
    ];
    for (const [q, s] of faces) this.quad(q[0], q[1], q[2], q[3], col, flat ? 1 : s, flip);
  }

  /** A flat rectangle on the front face of the board, at depth z. */
  panel(cx, cy, z, w, h, col, shade) {
    this.quad([cx - w / 2, cy - h / 2, z], [cx + w / 2, cy - h / 2, z],
              [cx + w / 2, cy + h / 2, z], [cx - w / 2, cy + h / 2, z], col, shade, false);
  }
}

/**
 * Signed distance from the car's segment `base` to the continuous segment
 * coordinate `u`, wrapped the SHORT way round a track of `n` segments.
 *
 * The short way matters and is not decoration. The track loops every 24,000
 * units, so a finish line 200 segments behind you is also 3,800 segments ahead
 * of you; taking the raw modulus would put the gantry at the far end of the
 * draw distance instead of just behind the camera, and it would pop into
 * existence at the seam. The result is the same coordinate Road.update's walk
 * indexes by: segment i of the walk is absolute segment base + i.
 */
function wrapSeg(u, base, n) {
  const half = n / 2;
  let d = (u - base) % n;
  if (d < -half) d += n;
  if (d >= half) d -= n;
  return d;
}

/**
 * Build the gantries.
 *
 * @param {object} o
 * @param {Scene}  o.scene     add the meshes to this
 * @param {number} o.roadW     road half-width, so the legs sit off the tarmac
 * @param {number} o.segLen    length of one track segment
 * @param {number} o.segCount  how many segments are drawn ahead
 * @param {number} o.behind    how many are drawn behind — see the header
 * @param {number} o.from      world distance of the start line (RACE_FROM)
 * @param {number} o.len       distance from start to finish (RACE_LEN)
 * @returns {{ update: function, setLines: function, stats: object,
 *            group: Group, banner: HTMLCanvasElement, texture: Texture }}
 */
export function buildGantry(o = {}) {
  const scene = o.scene;
  const ROAD_W = o.roadW ?? 9;
  const SEG_LEN = o.segLen ?? 6;
  const SEG_COUNT = o.segCount ?? 220;
  const BEHIND = o.behind ?? 5;
  const FROM = o.from ?? 600;
  const LEN = o.len ?? 12000;

  const stats = {
    calls: 0, tris: 0, at: 'none', seg: -1, ahead: 0,
    // The walk coordinates the structure was actually placed at: `i0` is the
    // segment index in Road.update's own walk and `f` the fraction into it.
    // Reported rather than inferred, so tools/gantryfit.mjs can ask "you say
    // you are here — are you on the road here?" instead of reconstructing the
    // answer from the distance and getting to agree with its own rounding.
    i0: 0, f: 0,
    bothInRange: 0, swaps: 0, legX: LEG_X, kerbTop: ROAD_W + VERGE_W + KERB_W,
  };
  if (!scene) return { update: () => {}, setLines: () => {}, stats,
                       group: null, banner: null, texture: null };

  // ---- the structure ------------------------------------------------------
  //
  // y = 0 is the TOP OF THE PAVEMENT, which is KERB_H above the tarmac. The
  // update below adds that, so every number in here reads as "above the
  // pavement the legs stand on" rather than as an offset from an offset.
  const b = new Build();
  const legY0 = -FOOT_SINK;
  const legY1 = CLEAR + BOARD_H;
  const legH = legY1 - legY0;
  const legCY = (legY0 + legY1) / 2;
  const boardCY = CLEAR + BOARD_H / 2;

  // INK FIRST, so the buffer reads the way the drawing does: the black copy
  // underneath, the object on top. Depth makes the order irrelevant — the shell
  // is behind the box wherever they overlap — but a reader should not have to
  // work that out to follow the file.
  const k2 = INK_W * 2;
  for (const s of [-1, 1]) {
    b.box(s * LEG_X, legCY, LEG_Z, LEG_W + k2, legH + k2, LEG_D + k2, C.ink, true, true);
    // The plinth needs its own shell. It is 1.5 wide against the leg's 0.8, so
    // it stands well outside the leg's shell and would otherwise be the one
    // object on the gantry with no line round it — which in this art style
    // does not read as a plinth, it reads as a smudge on the pavement.
    b.box(s * LEG_X, 0.05, LEG_Z, LEG_W + 0.7 + k2, 0.9 + k2, LEG_D + 0.7 + k2,
          C.ink, true, true);
  }
  b.box(0, boardCY, 0, BOARD_W + k2, BOARD_H + k2, BOARD_D + k2, C.ink, true, true);

  // Legs and their plinths.
  for (const s of [-1, 1]) {
    b.box(s * LEG_X, legCY, LEG_Z, LEG_W, legH, LEG_D, C.leg, false, false);
    // A plinth at the foot. It is also the thing that hides the join where the
    // buried leg passes through the pavement on a crest.
    b.box(s * LEG_X, 0.05, LEG_Z, LEG_W + 0.7, 0.9, LEG_D + 0.7, C.plinth, false, false);
  }
  // The board.
  b.box(0, boardCY, 0, BOARD_W, BOARD_H, BOARD_D, C.board, false, false);

  // The frame round the banner, four thin panels just proud of the board face,
  // so the printed panel reads as mounted rather than painted on.
  const FZ = BOARD_D / 2 + 0.02;
  const FW = 0.16;
  b.panel(0, BANNER_Y + BANNER_H / 2 + FW / 2, FZ, BANNER_W + 2 * FW, FW, C.frame, 1);
  b.panel(0, BANNER_Y - BANNER_H / 2 - FW / 2, FZ, BANNER_W + 2 * FW, FW, C.frame, 1);
  b.panel(-BANNER_W / 2 - FW / 2, BANNER_Y, FZ, FW, BANNER_H, C.frame, 1);
  b.panel(BANNER_W / 2 + FW / 2, BANNER_Y, FZ, FW, BANNER_H, C.frame, 1);

  // ---- the band ----
  //
  // Its vertices are recorded so the two gantries can differ without a second
  // mesh: switching from start to finish rewrites THIS RANGE of the colour
  // buffer and nothing else. See swapBand.
  const bandStart = b.n;
  const colW = BOARD_W / BAND_COLS;
  const rowH = BAND_H / BAND_ROWS;
  for (let r = 0; r < BAND_ROWS; r++) {
    for (let cIdx = 0; cIdx < BAND_COLS; cIdx++) {
      const cx = -BOARD_W / 2 + (cIdx + 0.5) * colW;
      const cy = BAND_TOP - (r + 0.5) * rowH;
      b.panel(cx, cy, FZ, colW, rowH, ((cIdx + r) & 1) ? C.chequeA : C.chequeB, 1);
    }
  }
  const bandVerts = b.n - bandStart;

  const geo = new BufferGeometry();
  const posArr = new Float32Array(b.p);
  const colArr = new Float32Array(b.c);
  const colAttr = new BufferAttribute(colArr, 3);
  // DynamicDraw only because the band is recoloured when the gantry swaps ends
  // of the race — twice a lap at most, not once a frame.
  colAttr.setUsage(35048);
  geo.setAttribute('position', new BufferAttribute(posArr, 3));
  geo.setAttribute('color', colAttr);
  geo.computeBoundingSphere();

  const structMat = new MeshBasicMaterial({ vertexColors: true, fog: true });
  const struct = new Mesh(geo, structMat);
  struct.userData.gantry = true;

  /**
   * Recolour the band in place.
   *
   * `needsUpdate` ALONE WOULD RE-UPLOAD THE WHOLE ATTRIBUTE — every vertex of
   * the legs, the board, the ink and the frame, to change 396 vertices of
   * chequer. Re-uploading buffer nobody asked for is the exact mistake that put
   * this project on a 30fps wall once already, at 18MB a frame. addUpdateRange
   * turns it into one bufferSubData over the band's own slice. It is a trivial
   * amount of data either way at this size; it is here because the pattern is
   * the rule of the project and the next person to add a moving part to this
   * file should copy the right thing.
   */
  const swapBand = (finish) => {
    const A = finish ? C.chequeA : C.startA;
    const B = finish ? C.chequeB : C.startB;
    let w = bandStart * 3;
    for (let r = 0; r < BAND_ROWS; r++) {
      for (let cIdx = 0; cIdx < BAND_COLS; cIdx++) {
        const col = ((cIdx + r) & 1) ? A : B;
        for (let v = 0; v < 6; v++) {
          colArr[w++] = col[0]; colArr[w++] = col[1]; colArr[w++] = col[2];
        }
      }
    }
    colAttr.clearUpdateRanges();
    colAttr.addUpdateRange(bandStart * 3, bandVerts * 3);
    colAttr.needsUpdate = true;
    stats.swaps++;
  };

  // ---- the banner ---------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.width = CAN_W;
  canvas.height = CAN_H;
  const ctx = canvas.getContext('2d');
  paintBanner(ctx, null);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  // =====================================================================
  // THE TWO FILTERS ARE DIFFERENT ON PURPOSE, AND THIS IS THE REASON.
  //
  // MAGNIFICATION IS NEAREST. The banner is 16 units wide and 1024 texels
  // across, so it magnifies at anything closer than about 15 units — which is
  // the last second and a half before you go under it, and the moment the
  // portrait is largest and most looked at. Linear magnification would soften
  // exactly the thing that makes it pixel art: the hard square edge of every
  // pixel of Victor's cap band and his hair. Nearest keeps the squares square.
  //
  // MINIFICATION IS MIPMAPPED, and it must not be nearest. Everywhere further
  // out than 15 units this texture is being MINIFIED, and that is where the
  // player spends nearly all of the approach: at 30 units a 3-unit art panel is
  // 96 phone pixels tall against 192 texels, so two texels are competing for
  // every pixel, and at 80 units it is nearer six. Point-sampling one of six
  // texels and picking a different one each frame as you rush at it is what
  // shimmering IS — and the cap band and the hair highlights, one and two art
  // pixels wide, are precisely the detail that would crawl. LinearMipmapLinear
  // averages the ones that no longer fit and the panel goes quietly soft
  // instead of boiling.
  //
  // Setting one and leaving the other at its default is the easy mistake, and
  // it fails in a way that only shows up in motion — a still frame of a
  // shimmering texture looks perfect.
  // =====================================================================
  tex.magFilter = NearestFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;

  // The PNG is a data URL and still decodes off the main thread; repaint and
  // re-upload once it lands. One extra texture upload, at boot, ever.
  const img = new Image();
  img.onload = () => { paintBanner(ctx, img); tex.needsUpdate = true; };
  img.src = SVU_ART_64;

  const bannerMat = new MeshBasicMaterial({ map: tex, fog: true });
  const banner = new Mesh(new PlaneGeometry(BANNER_W, BANNER_H), bannerMat);
  banner.position.set(0, BANNER_Y, BOARD_D / 2 + 0.05);
  banner.userData.gantry = true;

  const group = new Group();
  group.add(struct);
  group.add(banner);
  group.visible = false;
  scene.add(group);

  stats.calls = 2;
  stats.tris = (posArr.length / 9) + 2;

  // ---- where it stands ----------------------------------------------------
  //
  // Continuous segment coordinates, so a race distance that is not a whole
  // number of segments still lands in the right place. RACE_FROM is 600 and
  // SEG_LEN is 6, so today both of these are exact integers and the fraction is
  // zero — but "today it divides" is not a reason to write code that breaks the
  // day somebody moves the finish line by four units.
  let uStart = FROM / SEG_LEN;
  let uFinish = (FROM + LEN) / SEG_LEN;
  let showingFinish = null;

  /**
   * Move the lines.
   *
   * main.js's own note on RACE_FROM says the finish, the timing and the banner
   * placement are all DERIVED so that moving the race is one number — this is
   * how that promise is kept on this side. It is also the only way to exercise
   * the fractional branch below: RACE_FROM is 600 and SEG_LEN is 6, so today
   * both lines land exactly on a segment boundary and `f` is zero on every
   * frame of every lap. An untested branch that only wakes up the day somebody
   * moves the finish by four units is worth being able to test today.
   */
  const setLines = (from, len) => {
    uStart = from / SEG_LEN;
    uFinish = (from + len) / SEG_LEN;
    showingFinish = null;
  };

  /** How far into the walk the gantry may be and still be worth drawing. */
  const FAR = Math.min(SEG_COUNT - 1, GANTRY_FAR);

  /**
   * Called once per frame with the same arguments the road and the furniture
   * get.
   *
   * IT ALLOCATES NOTHING, and the first version of it allocated twice: `wrap`
   * and `inRange` were arrow functions declared inside the body, which closes
   * over `base` and `n` and therefore builds a fresh closure object sixty times
   * a second, for ever. Two small objects a frame is not what put this project
   * on a 30fps wall — that was 18MB of buffer — but the rule exists because
   * garbage that arrives every frame arrives during the frame, and the pause it
   * eventually causes lands in the middle of a corner. wrapSeg is now a
   * module-level function taking what it needs.
   */
  const update = (track, base, frac, camX, baseY) => {
    const n = track.n;
    const iStart = wrapSeg(uStart, base, n);
    const iFin = wrapSeg(uFinish, base, n);

    const okStart = iStart >= -BEHIND && iStart < FAR;
    const okFin = iFin >= -BEHIND && iFin < FAR;
    // THE CLAIM, CHECKED EVERY FRAME rather than believed. If this ever fires,
    // one mesh is not enough and the file needs two.
    if (okStart && okFin) stats.bothInRange++;

    let iC, finish;
    if (okStart && okFin) {
      finish = Math.abs(iFin) <= Math.abs(iStart);
    } else if (okStart) {
      finish = false;
    } else if (okFin) {
      finish = true;
    } else {
      group.visible = false;
      stats.at = 'none';
      stats.seg = -1;
      stats.ahead = 0;
      return;
    }
    iC = finish ? iFin : iStart;
    if (finish !== showingFinish) { swapBand(finish); showingFinish = finish; }

    const i0 = Math.floor(iC);
    const f = iC - i0;

    // ---- reproduce Road.update's lateral walk, exactly --------------------
    // The pre-walk first: the constant offset the ribbon carries because it
    // starts BEHIND the camera. Subtracting it is what puts the camera's own
    // segment at x = 0. See the header; getting this wrong is worth hundreds of
    // units at the far end of a corner.
    let pdx = 0, px = 0;
    for (let k = 0; k < BEHIND; k++) {
      const a = (((base - BEHIND + k) % n) + n) % n;
      pdx += track.curve[a] * SEG_LEN;
      px += pdx;
    }
    let x = 0, dx = 0;
    for (let i = -BEHIND; i < i0; i++) {
      const a = (((base + i) % n) + n) % n;
      dx += track.curve[a] * SEG_LEN;
      x += dx;
    }
    const a0 = (((base + i0) % n) + n) % n;
    const a1 = (a0 + 1) % n;
    const xa = x - px - camX;
    dx += track.curve[a0] * SEG_LEN;
    x += dx;
    const xb = x - px - camX;

    const ya = track.hill[a0] - baseY;
    const yb = track.hill[a1] - baseY;
    const za = frac * SEG_LEN - i0 * SEG_LEN;

    group.position.set(
      xa + (xb - xa) * f,
      ya + (yb - ya) * f + KERB_H,
      za - SEG_LEN * f,
    );
    group.visible = true;
    stats.at = finish ? 'finish' : 'start';
    stats.seg = a0;
    stats.i0 = i0;
    stats.f = f;
    stats.ahead = (iC - frac) * SEG_LEN;
  };

  return { update, setLines, stats, group, banner: canvas, texture: tex };
}
