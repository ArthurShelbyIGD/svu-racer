# What's next

Anthony's list, in his order, written down on 11 August 2026 — the day the
track was declared finished. Kept in the repo rather than in a chat window
because this container has been reclaimed twice and everything in it went both
times. The tarball in his Downloads is the backup; this file rides in it.

**The track is done.** Armco, the tunnel, the broken bridge, finite nitrous and
the V8 note all landed and were driven. 0:58.8 on the new layout. Nothing on
this list is a fix; it is all new ground.

---

## 1. A proper start page — DONE, 12 August

Built as a DOM layer inside the same single HTML file, so the game boots and
idles on the grid behind the menu and RACE is a class change rather than a
load. SETTINGS and LAP TIMES work; TRACKS and GARAGE say what they will be. The
old on-track control panel is gone from the screen — everything it did is in
Settings, with the numeric readout off by default but still reachable, because
testers are the only source of frame-rate data this project has.

The bundle went 598K -> 928K, almost all of it the two images. Anthony's call:
*"browsers cache heavily so it's a one time thing"*.

Checked by `tools/menufit.mjs` on six screens: nothing overflows, no button is
under 40px on its short side, and every button is proved to reach the game
rather than just to change its own label.

### What it replaced A front page you land on before driving, with buttons through to:

- settings
- pick a track
- lap times
- the garage

Some of those lead nowhere yet and that is fine — the point is the shape of the
thing, so the features have somewhere to arrive. A button that says GARAGE and
opens a "coming soon" is worth more than no button, because it tells you what
the game is going to be.

**The art has arrived.** Anthony made three images on 11 August and put them in
`Downloads/svu-racer-images/`: the car with a supercharger through the bonnet,
the same car with a cowl scoop instead, and a night cityscape. Working copies
are in `ref/` and what each would cost in the bundle is measured at the foot of
`ref/REFERENCE.md`.

The headline from that measurement: the car quantises to 32 colours almost for
free and the cityscape does not, because its cost is thousands of lit windows
rather than colour count — so if the city needs to be cheaper the lever is
resolution, not palette. A 704px city plus a 512px car is about 133K on a 598K
game. Worth it, probably, for the first thing anyone ever sees, but it is a
22% heavier download and that is Anthony's call rather than a detail.

Everything else in the game is generated in code and this would be the second
and third downloaded assets after Victor's portrait, so the same treatment
applies: get it small, base64 it into the bundle, and measure. Victor's 64x64
came to 4.3K. See `src/art/svu.js`.

**Still to decide:** blower or scoop. They are the same render with the bonnet
swapped and crop to the same box, so it is a straight swap either way.

## 2. A second track — daytime

Blue sky, sunny. The whole palette so far is a night city, so this is a bigger
job than "change the sky colour": the ink weights, the fog, the building
brightness and the headlight-lit tarmac were all tuned against a night
reference, and half of them will read wrong at noon.

Worth doing before the garage, on Anthony's call, because a second track is what
turns "a track" into "a game" — and it is the thing that forces the per-track
lap times below.

## 3. Points and credits

Earned by playing, in readiness for the garage. Bonuses for:

- a lap under 1:00
- a new fastest lap

Deliberately built BEFORE the garage so that by the time there is something to
spend credits on there is already a balance to spend, rather than a shop that
opens with an empty wallet and no way to fill it.

## 4. The garage

The big one, and the reason for points. Also the eventual home of the exterior
car: third person was shelved in July because the car did not resemble the
reference from behind — *"the way it is now it's not worth keeping"* — and the
agreed plan was that the exterior's next home is a garage where it is STATIC and
can be lavish. No frame budget, no draw-call ceiling worth speaking of, no
motion to hide behind. It gets to be the best-looking thing in the game.

---

## Carried forward, smaller

- **Per-track best times.** `BEST_KEY` in main.js is `svu-racer-best-v2` and the
  comment there says what it becomes when there is more than one track: a key
  per track with the version alongside it. Deliberately not built yet — a
  per-track store with one entry is a guess about a shape that has not turned
  up. Track 2 is what makes it real.
- **Collision.** Nothing in the game stops you except the bridge. The tunnel
  walls are faked with a narrowed stray limit rather than anything solid.
- **Upgrades**, once the garage exists and credits accumulate.

## Open questions

- **Armco shimmer on real hardware.** The barrier's z-offsets are sized for a
  24-bit depth buffer, which is what SwiftShader gives here. The Helio A22 may
  give 16, in which case the splice lines and reflectors could fight the rail
  down its length. Nobody has been able to test this. If it shimmers, raise the
  0.0016 factor in `barrier.js` to 0.003, then drop the ribs.
- **iPhone.** Being tested 12 August. See the four things worth checking in the
  chat of 11 August: fullscreen (iPhone Safari has no Fullscreen API at all, so
  `fs.state` should read `unsupported` and the layout has to survive Safari's
  chrome), the tilt permission dialog appearing on the FIRST tap, audio starting
  at all, and what `panelHz` reads on a 120Hz ProMotion screen — the frame pacer
  only divides evenly into whole divisions of the panel rate.
