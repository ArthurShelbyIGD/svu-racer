/**
 * WHICH CAR BODY TO BUILD, chosen at boot from `?body=`.
 *
 * The car is being rebuilt to match the reference drawings, and the honest way
 * to do that is to build more than one and let the score choose — an agent
 * asked "does this resemble the reference?" will say yes, because it has just
 * spent an hour on it. So there are rival candidates behind a registry, each
 * in its own file, each scored the same way against the same drawings.
 *
 * Every candidate must export `buildBody(o)` with the same contract as the
 * shipped one: it takes `{ pencil, palette, ink }` and returns
 *
 *   { group, attach, parts: { paint, wheels, ink }, spec, stats }
 *
 * A missing or unrecognised name gets DEFAULT, on the same principle as the
 * track and theme registries: a typo should give you the game rather than a
 * blank screen.
 *
 * ===========================================================================
 * ROUND TWO — AND WHY THE DEFAULT IS `e`
 * ===========================================================================
 *
 * Anthony drove and looked at `b` and named five faults the silhouette score
 * could not see, four of them inside the outline: the greenhouse ending too
 * early, the front quarter light too big, the rear quarter light missing
 * altogether, the rear screen reaching the roof with no bodywork above it, and
 * taillamps chopped into vertical slats where the drawing's are letterboxes. He
 * finished: "Not certain how the score relates to 95.4% if I am brutally
 * honest." He was right. tools/landmarks.mjs was written to measure exactly
 * those things, and tools/faultmap.mjs to show what a silhouette can and cannot
 * see.
 *
 * Two agents then revised `b` independently, blind to each other, against those
 * landmarks. Both got every landmark inside tolerance. `e` is closer on nearly
 * every row and better everywhere else:
 *
 *                    b        d        e      the drawing
 *   landmarks out    6        0        0
 *   side IoU       95.6%    95.7%    96.5%
 *   rear IoU       95.4%    95.5%    96.4%
 *   panes            3        4        4        4
 *   rear screen    0.167    0.225    0.250    0.250
 *   roof above it  0.033    0.100    0.117    0.116
 *   lamp pieces     14        2        2        3
 *   ink            21.7%    39.5%    33.6%    26-37% band
 *   triangles      9,464    9,796    9,436
 *
 * Both agents also reported instrument bugs they were not allowed to fix — see
 * the commit that repaired them. That rule has now paid for itself four times.
 *
 * A WARNING FOR ANYONE READING body-b.js OR body.js: their headers carry a long
 * argument that the side-on score is capped near 80.9% because the harness
 * photographs the wrong flank. That WAS true and is not any more —
 * tools/silhouette.mjs poses at az -PI/2 and prints a mirror check every run.
 * Do not conclude from those files that a side score above 81% is impossible.
 *
 * ===========================================================================
 * ROUND ONE, KEPT FOR THE RECORD
 * ===========================================================================
 *
 * Three candidates were built in parallel and scored by tools/silhouette.mjs
 * against ref/side-nobg.png and ref/rear-nobg-crop.png — AFTER that harness was
 * caught photographing the car's right flank against a drawing of its left, a
 * bug all three candidates found independently and none of them could fix,
 * because it was not their file. See the long note in the harness. Every score
 * below is the corrected one, and the run now prints a mirror check beside each
 * so it stays corrected.
 *
 *              side      rear    side aspect   rear aspect     tris
 *                                 (ref 3.27)    (ref 1.35)
 *   stock      84.2%    93.3%     3.90 <-- 19%  1.38         10,216
 *   a          94.2%    95.5%     3.28          1.37         10,184
 *   b          95.6%    95.4%     3.25          1.35          9,464
 *   c          95.0%    95.6%     3.37          1.42         10,008
 *
 * b wins the view that settles proportion, ties on the rear to within a tenth
 * of a point, and is the cheapest of the three by five hundred triangles. It is
 * also the only one whose rear aspect lands exactly on the drawing's.
 *
 * A second harness bug turned up while producing the pictures and is folded
 * into those numbers: the studio camera stands off the road at ground level,
 * which puts it inside a building or a container stack, and the silhouette is
 * isolated by DIFFING two renders — so an occluder does not appear in the mask,
 * it deletes the car behind it. Two of the three camera distances were coming
 * back blank. Studio mode now empties the room; see the note in main.js.
 *
 * `a` and `c` have been deleted: they lost round one and were never revised, and
 * every candidate left in this file is fifteen kilobytes of the one downloaded
 * file whether or not it is ever built. What remains is what someone might
 * actually want to compare — ?body=stock for the car before any of this,
 * ?body=b for what shipped last, ?body=d for the other round-two revision.
 * Prune to one once Anthony has picked, because a score is one opinion and his
 * eye on the phone is another.
 */
import { buildBody as stock } from './body.js';
import { buildBody as b } from './body-b.js';
// Round two: two independent revisions of b, each fixing the faults Anthony
// named and tools/landmarks.mjs measures. Same rules as round one — one file
// each, blind to each other, no touching the instruments.
import { buildBody as d } from './body-d.js';
import { buildBody as e } from './body-e.js';

const BODIES = { stock, b, d, e };

/** The winner of the scored run above. One place, so a harness can read it. */
export const DEFAULT_BODY = 'e';

export function bodyName() {
  try {
    const q = new URLSearchParams(location.search).get('body');
    if (q && BODIES[q]) return q;
  } catch (e) { /* no URL, no choice */ }
  return DEFAULT_BODY;
}

export function currentBody() { return BODIES[bodyName()]; }
