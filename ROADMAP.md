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

### Fixed the same day, from two phones

- **The gears vanished.** GEAR -/+ were folded into "the dev panel" and taken
  off the screen with it; they are the only way to shift on a phone, so the car
  was stuck in first. They are their own layer now, right-hand edge at thumb
  height, and the up-shift button lights with the tacho's shift lamp off the
  same condition so the two cannot disagree.
- **Android's gesture bar sat on the controls.** In landscape it runs down the
  RIGHT-HAND EDGE, and every layer of UI had safe-area insets on the top and
  bottom only — invisible in portrait, fatal in landscape. All four edges now
  go through `--sat/--sar/--sab/--sal`, which exist as custom properties rather
  than raw `env()` SO THEY CAN BE TESTED: no headless browser reports a real
  inset, so tools/menufit.mjs overrides them with Android values and re-runs
  the whole sweep.
- **592x212.** His wife's Samsung, in an in-app browser that refuses fullscreen
  outright. A third shorter than anything previously tested, and the front page
  was four pixels too tall for it. It is in the sweep now.
- **Fullscreen said out loud.** It happens on RACE, which is the right moment,
  but nothing said so. The front page says it — and when the browser refuses,
  which is what an in-app browser does, it says THAT instead, because the fix
  belongs to the player: open the link in Chrome or Safari.

## 2. A second track — WASTELAND (next up)

Anthony's call after the landing page landed, and his reasoning: a second track
"is what will make it the most interesting". A number of jumps, scrap and junk
lying about — and BEATEN-UP CONCRETE rather than dirt, which was his own
revision and a good one: "we can do a dirt track another time."

That change is worth more than it sounds. A dirt surface would have meant
re-tuning grip, the off-road penalty and the tyre noise from scratch, because
all three are built around tarmac being the good surface and the verge being
the punishment — and on a dirt track there is no road to leave. Cracked
concrete is still a hard surface with a hard edge, so the whole handling model
carries over and the work becomes what it should be: geometry, colour and junk.

**The jumps are nearly free and that is worth knowing before scoping it.** The
broken bridge did not add a special case — main.js launches the car whenever
the road falls away faster than gravity can hold it, which is general physics,
substepped below the size of a segment so a slow phone cannot step over a crest.
Any ramp shaped into `track.hill` becomes a jump automatically. See the note by
GRAVITY and the three wrong versions of that test recorded above it.

What is genuinely new:

- **Scrap and junk.** The scenery system draws a city from a hash; junk wants
  the same treatment rather than placed objects, or it costs draw calls.
- **The daytime question is still open.** A wasteland reads naturally as
  daylight, which merges this with the "blue sky" job below — but every ink
  weight, the fog and the building brightness were tuned against a night
  reference. Worth deciding deliberately rather than by accident.

## 3. A daytime track — blue sky

Blue sky, sunny. The night one is called **MIDNIGHT MILE** — `TRACK_NAME` in
src/ui/menu.js. It was "Night City" for about four hours until Anthony pointed
out that is Cyberpunk 2077's, and has been since 1988.

 The whole palette so far is a night city, so this is a bigger
job than "change the sky colour": the ink weights, the fog, the building
brightness and the headlight-lit tarmac were all tuned against a night
reference, and half of them will read wrong at noon.

Worth doing before the garage, on Anthony's call, because a second track is what
turns "a track" into "a game" — and it is the thing that forces the per-track
lap times below.

## 4. Points and credits

Earned by playing, in readiness for the garage. Bonuses for:

- a lap under 1:00
- a new fastest lap

Deliberately built BEFORE the garage so that by the time there is something to
spend credits on there is already a balance to spend, rather than a shop that
opens with an empty wallet and no way to fill it.

## 5. The garage

The big one, and the reason for points. Anthony's sequencing, which is the
right way round: **get the car model right first, as close to the hero image as
possible, and third person comes back on the strength of it.** Not before.

THE REFERENCE SET IS COMPLETE as of 13 August: rear, angled three-quarter, and
now a straight side view (`ref/side-nobg.png`) that is everything it needed to
be — dead side-on, no drop shadow, clean alpha, car filling 88% of the frame.
It gives the target the three-quarter view never could: **overall length to
height, 3.243.** See the foot of `ref/REFERENCE.md`, including why the blower
being absent from the references is a feature rather than a gap.

For the record, what made that image usable, since more will be needed:

- **Dead side-on, no perspective.** A three-quarter view cannot settle a
  wheelbase or an overhang, because both are foreshortened by an unknown
  amount. The side view is the one that fixes proportion, which is the thing
  the shelved third-person car got wrong.
- **The car filling the frame.** `ref/rear-nobg.png` is 1408x768 with the car
  occupying 234x176 of it — the rest is empty. Matching a model against 234
  pixels of reference is matching it against not very much.
- **No drop shadow, transparent background.** This is the one that has actually
  cost time. Cast shadows are black and indistinguishable from ink, and they
  put a hard ceiling of 82-84% on the silhouette score — unreachable, and it
  took Anthony hand-cutting a version to discover the ceiling was the
  measurement rather than the model. A clean alpha channel gives a real 100%.
- **Wheels straight, same car.** Lime green, purple stripes, blower through the
  bonnet, so the garage car and the hero on the front page are the same object. Also the eventual home of the exterior
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
