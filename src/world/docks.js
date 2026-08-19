// THE DOCKS' THREE SET PIECES: a ferry, a quay jump, and an underpass.
//
// ===========================================================================
// SAME TRICK AS THE BRIDGE, THREE TIMES
// ===========================================================================
//
// This builds NO GEOMETRY and owns NO MESH. Everything here is a shape added
// into `track.hill`, plus flags in `track.gap` where the road is not there.
// The road, the ground, the camera and the physics all follow it without
// knowing it exists, at zero draw calls and zero triangles — see the head of
// bridge.js, which explains why that is the cheap and correct place for it.
//
// It matters MORE here than on the night city. THE DOCKS is flat by design:
// nine units of elevation over five miles against the city's hundred and ten.
// Every bit of vertical drama on this track is engineered, so all of it is in
// this file, and on flat ground a six-unit dip reads as an event.
//
// ===========================================================================
// THE SITES ARE FOUND, NOT PICKED
// ===========================================================================
//
// The bridge sits at segment 1111 because someone measured the lap offline and
// found the straightest run. That was right, and it rots the moment the
// profile is regenerated — which the Docks profile already has been once,
// after Anthony drove it and reported it felt lazy.
//
// So each set piece names a ZONE and this module finds the straightest run
// inside it. A jump you have to take mid-corner is a jump you cannot aim, and
// "straightest run in this third of the lap" survives a retune where "segment
// 1111" does not. Deterministic, because the profile is a seeded xorshift: the
// same track always yields the same sites.
//
// ===========================================================================
// EVERY CREST IS A LAUNCH WHETHER YOU MEANT IT OR NOT
// ===========================================================================
//
// The physics launches the car whenever the road falls away faster than
// gravity can hold it down. That is general and it is not opt-in, which means
// a ramp ONTO something is as dangerous as a ramp off it: going from a 0.10
// climb to a flat deck at racing speed throws the car about a hundred units
// through the air, and nobody asked for a jump there.
//
// The rule this file works to: a crest you do NOT want to launch from has to
// shed its vertical speed slower than gravity would.
//
//     vy = v * s / sqrt(1 + s*s)        the vertical speed the ramp gave you
//     stay on the ground if  vy / T  <  GRAVITY,  T = the crest's duration
//
// At the boosted top speed of 284 units/s, a 0.08 slope is vy = 22.7, so the
// crest needs longer than 22.7/85 = 0.27s, which is 76 units, thirteen
// segments. Everything shallow here is eased over eighteen or more. The two
// places that ARE jumps use a linear ramp and a hard lip, for the reason
// bridge.js gives: an eased lip ends with its slope at zero, which is a ramp
// you drive off the end of rather than one you are fired from.
//
// tools/docks.mjs drives all of it and reports what actually happened, because
// this arithmetic has been wrong three times on this project already.

/**
 * The three of them. Distances are in SEGMENTS; heights in world units.
 *
 * `zone` is where to look for a site, and the search returns the straightest
 * run of `span` segments inside it.
 */
export const DOCKS = {
  /**
   * THE UNDERPASS. Anthony: "an obstacle where we race down and under
   * something and then back to ground level, that would be cool."
   *
   * Down, along, and back up — with a slab over the flat part. Both the entry
   * and the exit are eased hard, because neither is meant to be a jump: this
   * is the one set piece on the track where the car should stay glued down,
   * and the drama is the sky closing and reopening rather than air.
   *
   * It also does something the jumps cannot: on a road this flat, dropping
   * eight units puts the container stacks ABOVE your eyeline for a second and
   * a half, which is the only time on the lap the horizon disappears.
   */
  underpass: {
    zone: [320, 900],
    // THE CLIMB OUT IS TWICE AS LONG AS THE DIP IN, and the asymmetry is the
    // whole reason this works. Driving into a dip is safe at any speed —
    // gravity is pulling you the way the road goes. Driving OUT of one is a
    // crest, and a crest throws the car whenever the road falls away faster
    // than gravity can hold it.
    //
    // For a smootherstep of height h over length L the worst vertical
    // acceleration the road demands is about 5.77*h/L^2 per unit travelled, so
    // at speed v it needs 5.77*h*v^2/L^2 < GRAVITY. At the boosted 284 with
    // h = 7 that wants L over 190 units, which is 32 segments. The first
    // version used 18 and the harness threw the car 58 segments through the
    // air on the way out — a jump nobody designed, in the one set piece that
    // is explicitly not a jump.
    // AND THE WAY IN IS A CREST TOO, which the first fix missed. I lengthened
    // the climb out and left the dip in at 22, on the reasoning that gravity
    // pulls you the way the road goes. True at the BOTTOM of the dip and false
    // at the TOP: level ground turning into a descent is convex, exactly like
    // the brow of a hill, and 5.77*7/132^2 at 210 demands 102 units/s^2 of
    // downward acceleration against a gravity of 85. The car hopped six
    // segments on the way IN. Both ends are 34 now, which is the length the
    // arithmetic asked for in the first place.
    // FORTY, not thirty-four. Thirty-four is what the arithmetic asks for
    // against a bare crest — 284^2 * 5.77 * 7 / 204^2 comes to 78 against a
    // gravity of 85 — and the harness still threw the car six segments at the
    // boosted cap. The arithmetic was not wrong; it was incomplete. These
    // shapes are ADDED to the natural profile, and the natural profile has its
    // own gentle curvature underneath, which is on the same side of the ledger
    // at the worst moment. A margin of 7% is not a margin.
    down: 40,
    flat: 16,       // under the slab
    up: 40,         // and back to ground level, gently
    depth: 7,
  },

  /**
   * THE FERRY. Anthony: "part of the track could enter a large car ferry at
   * one end and exit at the other with a jump over water to land."
   *
   * A shore ramp up onto the vehicle deck, three hundred units of ship, then
   * the bow ramp — which IS a jump ramp, at the same 0.20 the bridge uses —
   * and open water to the far quay.
   *
   * THE LANDING IS LOWER THAN THE TAKE-OFF, and that is what makes this the
   * showpiece rather than a second bridge. You leave the bow at nineteen units
   * up and land at quay level, so the drop buys range on top of the ramp and
   * the jump is long, floaty and very obviously survivable if you arrive fast.
   * Arrive slow and the sea is right there.
   */
  ferry: {
    zone: [1380, 1900],
    // THIRTY-FOUR SEGMENTS OF LINKSPAN, not sixteen. Same arithmetic as the
    // underpass: sixteen threw the car four segments through the air on the
    // way ON to the ship, and a car launched onto a vehicle deck lands inside
    // a vehicle deck. A real linkspan is a long shallow thing for the same
    // reason — lorries ground out.
    // FORTY-FOUR NOW, because the deck went up. A shallow crest is only
    // shallow relative to its length: 5.77*9*284^2/85 wants 222 units, which
    // is 37 segments, and the natural profile underneath eats the margin.
    on: 44,         // shore ramp up onto the deck, eased both ends: NOT a jump
    deck: 54,       // 324 units of vehicle deck, enclosed
    bow: 9,         // the bow ramp, linear, slope 0.20: this one IS a jump
    // 168 UNITS, down from 192. At 192 the gate sat at about 185mph — you had
    // to arrive within a whisker of the unboosted cap or swim, which is a
    // coin-toss dressed as a skill gate. 168 puts it near 175 and leaves the
    // showpiece feeling earnable rather than punitive.
    gap: 28,        // 168 units of open water, LEVEL with the lip
    down: 22,       // and the far quay ramps down after the water, not across it
    // NINE, NOT FIVE, AND IT IS WHY THE SHIP LOOKS LIKE A SHIP.
    //
    // The car deck's height above the water IS the freeboard, and at five
    // units - two metres - the hull was a raft with a shed on it. Nine is
    // 3.9m, which is what a ro-ro actually has, and it gives the topsides, the
    // hull band and the boot topping room to be three separate things instead
    // of one stripe.
    //
    // The bow ramp came DOWN to pay for it, twelve segments to nine, so the
    // lip stays at 19.8 against the old 19.4 and the jump Anthony has already
    // learned does not move under him.
    deckY: 9,       // the vehicle deck above the quay
    bowRise: 10.8,  // bow * SEG_LEN * 0.20, stated so a harness can check it
  },

  /**
   * THE SECOND JUMP. Anthony: "we should have more than one jump."
   *
   * A DIFFERENT KIND, deliberately. The ferry is a long floaty arc off a big
   * structure you have driven into; this is a short steep quay ramp with the
   * landing in plain sight before you leave the ground, so it reads as a
   * decision rather than as a surprise. Steeper than the ferry's bow and much
   * shorter, and the gate is lower — the ferry is the one you have to earn.
   */
  quayJump: {
    zone: [2280, 2900],
    ramp: 10,       // slope 0.22
    // DELIBERATELY THE EASIER OF THE TWO. It measured the same gate as the
    // ferry at 26, which wastes the contrast: this one is meant to be the jump
    // you take in your stride and the ferry the one you have to earn.
    gap: 20,        // 120 units, LEVEL with the lip
    down: 14,       // the far side drops away after the water
    rise: 13.2,     // ramp * SEG_LEN * 0.22
  },
};

/**
 * THE STRAIGHTEST RUN OF `span` SEGMENTS INSIDE `zone`.
 *
 * Straightness is the mean absolute curvature over the run — the same measure
 * bridge.js used by hand. Flatness is deliberately NOT part of the score: this
 * road is flat everywhere, and adding a term that cannot discriminate only
 * dilutes the one that can.
 */
function straightestRun(track, zone, span) {
  const [a, b] = zone;
  let best = Infinity, bestAt = a;
  for (let s = a; s + span < b; s += 2) {
    let sum = 0;
    for (let k = 0; k < span; k++) sum += Math.abs(track.curve[(s + k) % track.n]);
    const mean = sum / span;
    if (mean < best) { best = mean; bestAt = s; }
  }
  return { at: bestAt, curvature: best };
}

/** Smootherstep: zero slope at BOTH ends, which is what "do not launch" means. */
const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * Shape all three into the track, and return where they ended up.
 *
 * Called once, immediately after buildTrack and before anything reads the
 * track. ADDS to the hill rather than assigning, so the natural profile keeps
 * its own gradient underneath and there is no seam at either end.
 *
 * The returned sites are what main.js hands to the ferry's hull and the
 * underpass slab, so the meshes cannot land anywhere other than where the
 * ground was shaped for them — which is a class of bug this avoids rather than
 * tests for.
 */
export function shapeDocks(track, segLen) {
  const n = track.n;
  const at = (i) => ((i % n) + n) % n;
  if (!track.gap) track.gap = new Uint8Array(n);
  // What these added, kept apart from the landscape underneath — same reason
  // bridge.js keeps `bridgeAdd`: a harness measuring a 14.4-unit bow ramp off
  // track.hill measures the ramp plus whatever the ground was already doing.
  track.docksAdd = new Float32Array(n);
  const add = (i, y) => { const j = at(i); track.hill[j] += y; track.docksAdd[j] += y; };

  // ---- THE UNDERPASS ------------------------------------------------------
  const U = DOCKS.underpass;
  const uSite = straightestRun(track, U.zone, U.down + U.flat + U.up);
  {
    const s = uSite.at;
    for (let k = 0; k < U.down; k++) add(s + k, -U.depth * ease((k + 1) / U.down));
    for (let k = 0; k < U.flat; k++) add(s + U.down + k, -U.depth);
    for (let k = 0; k < U.up; k++) {
      add(s + U.down + U.flat + k, -U.depth * (1 - ease((k + 1) / U.up)));
    }
  }

  // ---- THE FERRY ----------------------------------------------------------
  const F = DOCKS.ferry;
  const fSite = straightestRun(track, F.zone, F.on + F.deck + F.bow + F.gap);
  {
    const s = fSite.at;
    // Onto the deck. Eased at BOTH ends — the foot so it does not read as a
    // kerb, and the top because a 0.10 crest onto a flat deck at racing speed
    // is a hundred-unit jump nobody asked for.
    for (let k = 0; k < F.on; k++) add(s + k, F.deckY * ease((k + 1) / F.on));
    for (let k = 0; k < F.deck; k++) add(s + F.on + k, F.deckY);
    // The bow ramp. LINEAR, and it stops dead at the lip: the lip's slope is
    // the launch angle and an eased ramp ends at zero slope, which is a bow
    // you roll off rather than one you are fired from.
    //
    // DIVIDED BY bow + 1, NOT bow, AND THAT IS THE DIFFERENCE BETWEEN A JUMP
    // AND A SWIM.
    //
    // Dividing by `bow` puts the peak on the LAST ramp segment, so the forward
    // slope there — which is what the physics samples to decide whether to
    // launch — is already zero, because the next segment is the level gap. The
    // car reaches the lip perfectly flat and drives into the water. Whether it
    // launched at all then depended on which sub-step happened to fall on the
    // second-to-last segment, which is why the quay jump cleared at 159mph and
    // failed at 202: not a physics bug, a fencepost.
    //
    // Dividing by bow + 1 puts the peak on the FIRST GAP SEGMENT instead, so
    // every ramp segment including the last one is still climbing at the full
    // 0.20 and the lip's slope is unambiguous at any frame rate.
    for (let k = 0; k < F.bow; k++) {
      add(s + F.on + F.deck + k, F.deckY + F.bowRise * ((k + 1) / (F.bow + 1)));
    }
    // THE WATER, AND THE HILL RUNS LEVEL ACROSS IT.
    //
    // The first version descended across the gap, so that the far quay was
    // lower than the bow. It read well and it broke the jump: the peak of the
    // ramp became the LAST segment before a descent, so the slope the physics
    // sampled at the lip depended on which sub-step the car happened to land
    // on. At 165mph it caught the +0.20 and flew; at 202 it caught the descent
    // and drove straight into the sea. A jump that fails at high speed and
    // works at low speed is a frame-timing bug wearing a costume, and it is
    // the same class of fault the airborne integration was fixed for twice.
    //
    // bridge.js already had this right and I did not copy it: its gap is FLAT
    // at deck height. The lip's slope is then unambiguous, and the drop to the
    // far side happens AFTER the water, where the car lands on a downslope —
    // which extends the flight anyway, so the ferry keeps the long floaty arc
    // that was the point of dropping it in the first place.
    const top = F.deckY + F.bowRise;
    const g0 = s + F.on + F.deck + F.bow;
    for (let k = 0; k < F.gap; k++) {
      const i = at(g0 + k);
      track.hill[i] += top;
      track.docksAdd[i] += top;
      track.gap[i] = 1;
    }
    // The far quay, ramping down from the water's edge to ground level.
    for (let k = 0; k < F.down; k++) add(g0 + F.gap + k, top * (1 - ease((k + 1) / F.down)));
  }

  // ---- THE QUAY JUMP ------------------------------------------------------
  const Q = DOCKS.quayJump;
  const qSite = straightestRun(track, Q.zone, Q.ramp + Q.gap);
  {
    const s = qSite.at;
    // ramp + 1, for the fencepost reason spelled out at the ferry's bow.
    for (let k = 0; k < Q.ramp; k++) add(s + k, Q.rise * ((k + 1) / (Q.ramp + 1)));
    // Level across the water, for the reason spelled out at the ferry.
    for (let k = 0; k < Q.gap; k++) {
      const i = at(s + Q.ramp + k);
      track.hill[i] += Q.rise;
      track.docksAdd[i] += Q.rise;
      track.gap[i] = 1;
    }
    for (let k = 0; k < Q.down; k++) {
      add(s + Q.ramp + Q.gap + k, Q.rise * (1 - ease((k + 1) / Q.down)));
    }
  }

  return {
    underpass: { at: uSite.at, len: U.down + U.flat + U.up,
                 slabAt: uSite.at + U.down, slabLen: U.flat, curvature: uSite.curvature },
    ferry: { at: fSite.at, deckAt: fSite.at + F.on, deckLen: F.deck,
             lip: fSite.at + F.on + F.deck + F.bow,
             gapFrom: fSite.at + F.on + F.deck + F.bow, gapLen: F.gap,
             curvature: fSite.curvature },
    quayJump: { at: qSite.at, lip: qSite.at + Q.ramp,
                gapFrom: qSite.at + Q.ramp, gapLen: Q.gap, curvature: qSite.curvature },
  };
}
