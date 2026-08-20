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

## 2. THE DOCKS — the second track (next up)

Decided 20 August, replacing the wasteland idea and merging with the daytime
one, which was always going to be the same job. Anthony: shipping containers,
cranes, "part of the track could enter a large car ferry at one end and exit at
the other with a jump over water to land", a longer lap, and a low sunny sky.

**Lap: about 90 seconds.** At the car's 202mph cap that is 5.05 miles, 18,900
world units — which fits inside the existing 4,000-segment profile generator
without changing it (a night-city lap uses 12,000 of 24,000). Length costs
NOTHING per frame: the road only ever builds the 220 segments ahead of you, so
a longer track is more variety to fill and no more work to draw.

### Most of this already exists

The two headline features are re-skins rather than new systems, and that is the
main reason this track is a good next job rather than a huge one:

- **The ferry's car deck is the tunnel.** `src/world/tunnel.js` already takes
  `atSeg`/`lenSeg`, costs one draw call while on screen and none when it is
  not, and exposes `.inside()` and `.enclosure()` for the audio. A steel vehicle
  deck is that module with different colours and different props.
- **The exit jump is the bridge.** main.js launches the car whenever the road
  falls away faster than gravity can hold it — general physics, substepped
  below the size of a segment. Any ramp shaped into `track.hill` is a jump. A
  bow ramp is a ramp.
- **Falling in the water is the hole.** `track.gap` plus the crash state and
  the results card already do exactly this, and Anthony already chose
  crash-and-restart for the bridge, so the water should behave the same way for
  consistency rather than inventing a second kind of failure.
- **Container stacks are the city.** The scenery system draws thousands of
  boxes placed and coloured from a hash, in one draw call. A container IS a
  box, and a cheaper one than a building because it needs no windows.

### Water down one side, and it is the CHEAP option

Anthony left this to me. Water alongside for a good part of the lap, plus one
causeway stretch with water on both sides on the run to the ferry.

The reasoning is not aesthetic. **A water surface is cheaper than land.** The
road mesh already emits ground quads either side of the tarmac every frame;
on the water side those quads simply get a water colour, which costs nothing
and REPLACES the thousands of instanced boxes that would otherwise fill that
half of the view. Water alongside is fewer draw calls and fewer triangles than
container stacks alongside, not more. It also gives the horizon somewhere to
be that is not another row of boxes, which is the thing that will stop a
five-mile lap feeling like one mile driven five times.

### More jumps, and an underpass — added 18 August

Anthony, on the shape of the lap: *"We should have more than one jump in the
new finished docks track. We could also have an obstacle where we race down and
under something and then back to ground level, that would be cool. A lot of
variety would be a good thing to make it interesting."*

Both are elevation, and elevation is the one thing this engine gives away free:
the road, the pavement, the barrier and the camera all read `track.hill`, so
anything shaped into that profile exists for every system at once and costs
nothing to draw. The bridge proved it — it has no mesh of its own.

- **Jumps.** The bow ramp off the ferry is one. A second wants to be a
  different KIND rather than a second copy: the bridge is a hump you clear at
  speed, so the other could be a short steep launch off a quay ramp where the
  landing is visible before you leave the ground, which reads as a decision
  rather than as a surprise.
- **The underpass.** Dip the hill, put a slab across the top. The slab is the
  tunnel module with a length of a few segments and no side walls — a bridge
  over the road rather than a tube around it — so the sky closes for a second
  and reopens. Cheaper than the tunnel, because it is shorter and open-sided,
  and it gives the low sun something to strobe behind, which is exactly the
  moment a fixed golden-hour sun pays for itself.

Both need the same care the bridge needed: the launch integration is substepped
below half a segment because it was wrong three times, and any new ramp is a
new test of it, not a re-use of a solved one. `tools/bridge.mjs` is the shape
of that test.

### The daylight is the real work, and it should be done FIRST

Golden hour, low sun — Anthony's choice, and the right one for a renderer with
no lights in it, because a low sun is the case where baked per-face colour does
the most work. Warm on the lit side, cool in shade, long shading down the flank
of every container stack.

**But it is also the biggest unknown on this list**, and it has nothing to do
with docks. Every ink weight, the fog, the building brightness and the tarmac
tone were tuned against a NIGHT reference and measured against it. Whether the
comic-book look survives daylight at all is unproven.

So the order should be: **prove the daylight palette on the track that already
exists**, before building five miles of new track for it. Same road, same
scenery, blue sky and a baked sun — an afternoon's work that answers the
question that everything else depends on. If it reads badly there it will read
badly at the docks, and finding that out after building the docks is the
expensive way round.

One consequence of a fixed sun worth deciding early: the track has a west. You
will drive towards the sun on some stretches and away from it on others, and
driving into a low sun is either a lovely piece of atmosphere or an annoyance.
Worth choosing deliberately rather than discovering.

Anthony chose: *"The sun being atmosphere that is actually annoyance is the
realistic approach if we think about it. Golden hour sun that gets in your eyes,
that's all a part of driving in rl."* So it is an annoyance, on purpose, and it
comes and goes with the heading. See the note in `src/art/theme.js` about why
the SHADING has to say the sun is behind you even so — a backlit city in a
renderer with no lights is a city of black masses, which is the exact failure
the spike was looking for.

### DONE, 18 August: the daylight spike

`?theme=golden` on the URL, `src/art/theme.js`, `tools/daylight.mjs` and
`tools/nightsame.mjs`. **The answer is yes** — the comic-book look survives
golden hour, and by the only measure that matters it gets stronger: ink strokes
12.0% -> 17.3% of the frame, local contrast 4.5 -> 6.3, at identical draw calls
and triangles. It is a spike, NOT a second track: the night city is untouched
and `nightsame.mjs` proves it exactly rather than by eye.

What it cost was worth more than the answer. **Colour lived in five places and
the palette was only one of them**, which no amount of reading the code had
revealed:

1. `PAL` — the sky, the road, the fog. The only one anybody knew about.
2. **The city's instance tint.** `Scenery` generates a colour per building from
   a hardcoded HSL and never reads `PAL.wall` — despite `wall:` being commented
   "measured: the building faces in the reference". Overriding the palette gave
   a blue sky over a night city.
3. **The facade tile.** `windowTexture()` paints concrete, spandrels, sills and
   glass from its own literals, and a building's final colour is the instance
   tint TIMES the face shade TIMES that texel. Fixing (2) turned the DISTANT
   city sandy and left the near buildings slate blue, because up close the tile
   is most of what you are looking at.
4. **The per-face shade.** `FLANK = [0.30, 0.32, 0.39]` — an unlit side of a
   building. In a renderer with no lights this is the only place a sun
   direction can exist at all.
5. **`CITY_INK`.** The outline around every building, a separate constant from
   `PAL.ink`. A sunlit city outlined in cold night blue-black.

Number five was not found by looking at it — it is a two-pixel line. It came
out of `nightsame.mjs`'s positive control, which loads the golden theme and
asserts that everything the tool measures CHANGES. The ink was the one value
that did not, and both possible explanations turned out to be true at once: the
theme missed it AND the tool was blind to it.

**And the sky's stop POSITIONS mattered more than its colours.** The gradient is
stretched across the SCREEN, and sampling a sky column shows the visible sky
ends at v=0.35 — the road and the cockpit have the rest. The night stops put
skyLow at 0.72, skyGlow at 0.92 and haze at 1.00, so all three warm bands were
being drawn underneath the tarmac. The first golden build was a flat midday
blue for that reason alone and no choice of warm colour would have fixed it.

*A free win for the night track whenever it is wanted:* `PAL.skyGlow` is
commented "the city's own light, just above the rooftops" and by the same
arithmetic it has never once been on screen. Not touched here, because Anthony
has called that track finished and a spike is not the place.

**Still night-coloured in a golden frame, and none of it blocks the Docks:**

- the street lamps still throw warm pools (`furniture.js`) — a lamp in daylight
  is off, and this is the most visible remaining tell
- the Armco, the gantries and the tunnel interior bake their own colours; the
  tunnel barely matters, since a tunnel is dark at any hour, and its far mouth
  already reads correctly as daylight
- the glare itself, which is deliberately out of scope — see above

### The scenery list, cheapest first

Everything here is boxes and prisms unless noted, which is what this engine
wants:

- **container stacks** — the hash-placed box field, recoloured. Effectively free.
- **warehouses** — big boxes with roller doors; the existing buildings, reskinned.
- **the water** — ground quads recoloured. Free, and saves what it replaces.
- **quayside edge** — bollards, tyre fenders, a concrete lip. Tiny.
- **chain-link fence** — a strip mesh like the Armco, one draw call.
- **light masts and floodlight towers** — thin verticals, instanced. Good for
  breaking up a flat skyline and they suit a working dock at any hour.
- **gantry cranes** — box legs and a boom. Tall landmarks you can see from a
  mile off, which is what a five-mile lap needs to stop it feeling repetitive.
  Probably worth their own instanced mesh: +1 draw call.
- **straddle carriers, reach stackers, forklifts** — box assemblies, parked.
- **oil drums, pallet stacks, cable reels** — cylinders cost more triangles
  than boxes; use sparingly and near the road where they are seen.
- **a ship alongside** — one big merged mesh, drawn once, as a landmark. The
  ferry itself is this plus the tunnel.
- **a container ship on the horizon** — the skyline element that replaces the
  city towers.
- **sun glitter on the water** — a bright band on the water quads pointing at
  the sun. One colour ramp, no geometry, and it is most of what will sell
  golden hour.
- **gulls** — small moving quads, if there is budget left. Motion in the sky is
  cheap and nothing else up there moves.

### Draw calls

16 is the budget and 13 is the worst moment today. The docks reuses the scenery,
furniture and barrier slots rather than adding to them; water is free; cranes
are the one likely addition. It should come in at or under where the city sits.

### Driven, 18 August: 1:28.3, and two things came back

**The flicker was the yard standing too close.** Anthony: "The containers
flicker a bit at the start of the race." `tools/flicker.mjs` ruled out three
hypotheses before finding it — z-fighting (0% of the changed pixels were
isolated, so no), the instance table shuffling under the water suppression (a
STILL camera changes 0.00% of the frame, so the renderer is deterministic), and
the rib texture (taking it off entirely moved 12.4% to 11.5%). What it was:
containers are 6 high and run 14-28 units ALONG the road, so a row is an
unbroken wall where a city block is separate buildings with gaps — and eight
units off the kerb that wall sweeps through the frame twice as fast as the
city's does. Standing it back to twenty units took the change rate to 4.2%,
below MIDNIGHT MILE's own 5.2%. It is also just correct: a terminal has an
apron between the road and the first stack.

**"The track feels a bit lazy tbh" was right, and here is the number.** The
first profile made features long and hard corners rare, which over 3,150
segments is about twenty-three features and THREE HARD CORNERS IN FIVE MILES,
every one a long constant-radius sweeper. `tools/launch.mjs` grew a corner
census to say so: it now counts corners, how long you are inside each, and the
longest flat-out run.

| | MIDNIGHT MILE | THE DOCKS, before | after |
|---|---|---|---|
| corners per mile | 2.2 | 0.6 | 3.0 |
| average corner | 1.0s | ~6s | 0.6s |
| longest flat-out run | 13.8s | — | 16.5s |
| worst curvature | 0.107 | 0.083 | 0.140 |

The mistake was reading "long straights" as "long everything". A dock road is
long runs between right-angle junctions. Straights doubled, corners dropped to
two thirds, and there are twice as many of them.

One check had to change with it, and the reasoning matters because the suite's
own header forbids what it looks like. `hands off, the average position is
outside the middle lane` was a proxy for corner DENSITY, and a track that is
44% dead straight by design fails it at 4.2 against a 4.5 bar while being
demonstrably fine — 25% of hands-off frames are off the road entirely. It is
now a RATIO against the driven line, which is the invariant the proxy stood in
for, is stricter than the 2x bar beside it, and cannot rot on a future track
that is straighter or twistier still. MIDNIGHT MILE scores 9.2x, THE DOCKS
11.3x, and a self-steering car scores 1x whatever the road does.

### The flicker again, 18 August — and the first fix was the wrong bug

Anthony had to report it twice: *"the containers still flicker badly at the
start when stationary, like colours are fighting each other."* That description
is precise and it is z-fighting, which the first investigation had ruled out.

**THE INSTRUMENT WAS WRONG AND THAT IS THE LESSON.** `tools/flicker.mjs` only
ever moved the camera FORWARD, then classified the changed pixels as speckle or
patches, and dismissed z-fighting because there was no speckle. Speckle is what
z-fighting looks like on a curved or angled surface. Two EXACTLY COPLANAR quads
have equal depth across their whole overlap, so the winner flips wholesale — a
container-sized patch of one colour replaced by a container-sized patch of
another. The heuristic filed the signature of the bug under "not the bug".

The honest discriminator is not the shape of the change but how it SCALES with
camera movement. Real rendering is smooth; z-fighting is a coin flip on a float
comparison. So hold still and twitch the camera 0.005 units — far too little to
move anything visibly, and about what a hand does to a tilt-steered car on the
grid:

| | before | after |
|---|---|---|
| THE DOCKS, stationary, 0.005 twitch | 3.3% and 4.1% | 0.10% and 0.40% |
| MIDNIGHT MILE, same twitch (control) | 0.93% | 0.93% |

**The cause was that every container is the same width, which is the point of a
container.** A city building draws its width from a range, so two at the same
lateral offset still have their faces in different places. Every container is
5.7 wide, and the offset came from `(sl % 3) * 2.5` — three values — so a third
of all pairs had their long faces at identical x. Worse, two boxes placed at the
same segment in the same row could land on the same offset and be exactly
coincident.

Three changes: ninety-seven offsets instead of three plus a term in `sub` so
same-segment duplicates are impossible; one container every third segment, so a
14.2-deep box in an 18-unit slot cannot overlap the one behind it; and no 40ft
containers, because 28.3 does not fit in 18 and length variety is not worth a
coin-flipped depth buffer. It looks better too — distinct blocks with aisles
between them rather than one unbroken wall.

### Built 19 August: the ferry, two jumps, an underpass and the cranes

All three set pieces are `track.hill` and `track.gap` and nothing else — the
bridge's trick, three times, at zero draw calls. `src/world/docks.js`,
`tools/docks.mjs`.

**The sites are FOUND, not picked.** The bridge sits at segment 1111 because
someone measured the lap offline, and that rots the moment the profile is
regenerated — which the Docks profile already has been once. Each set piece
names a zone and the module returns the straightest run inside it. All three
came out on ground with a mean curvature of exactly zero, and the ferry's hull
and the underpass slab are built from the returned answer rather than from a
number written down twice.

| | gate | at the cap |
|---|---|---|
| the ferry's bow ramp | ~185 mph | 38 segments of air |
| the quay jump | ~145 mph | 40 segments |
| the underpass | never launches, even boosted | — |

**And it found a real physics bug that has been in the game since the bridge.**
The launch test compared a ballistic step against the road at the end of the
sub-step. At the unboosted cap this container clamps dt at 0.1, so travelled is
exactly 21 units, nsub is 7 and hstep is exactly 3.000 — which divides the
6-unit segment exactly. The last sub-step before a lip therefore starts exactly
0.600 below the crest on a 0.20 ramp, the ballistic term gains exactly 0.600,
and the gravity term takes 0.0087 away. **The test lost by nine thousandths of
a unit and the car drove into the sea at 202mph while clearing the same jump at
159.** No amount of substepping fixes it: the window and the sampling
granularity are both `s*hstep`, so they shrink together.

It asks the physical question now — the road can hold the car while it demands
no more than `GRAVITY`, so `v*(s0-s1)/hdt > GRAVITY` is the launch — and
nothing is compared against a position, so alignment cannot enter into it. The
old comparison was removed rather than kept as a fallback: an OR of a correct
test and a flaky one is exactly as flaky as the flaky one, and keeping it put
the bug straight back in from the other side. `tools/bridge.mjs` confirms the
night city's gate is unmoved at 140-150mph against its predicted 146.

**The cranes** are two draw calls for all of them, and their ink is a second
BUILT geometry rather than a scaled one — a crane is eleven boxes in a frame,
so scaling the assembly moves the legs apart instead of thickening them. They
are placed by asking `waterAt` which side the sea is on, because a ship-to-shore
crane whose boom reaches over more containers is a crane that has never seen a
ship. Nine draw calls at the worst moment, against a budget of sixteen.

### 19 August: the ferry is a ship, not a tunnel in a hat

Anthony drove the first one: *"The ferry really just looks like a tunnel, it
needs to actually look and feel like a ship to be convincing. Way more
attention to what it is meant to represent rather than re use a shape from the
original track."*

He was right, and the shortcut came from THIS FILE — "the ferry's car deck is
the tunnel" was written here as a plan, and as an estimate of effort it was
correct, which is the trap. `src/world/ferry.js` is a ship: a lofted hull with
a square transom and a fine entry, a hull band and boot topping, an
accommodation block, a bridge, a funnel and a mast. One merged geometry plus
one ink shell, so two draw calls when it is on screen and none when it is not.
Nine of sixteen at the worst moment, unchanged.

What actually makes it read, in the order you meet it:

- **A silhouette from the linkspan** — a large object with a shape, standing
  well above the road, with a funnel. A tunnel mouth has none of that.
- **A transom, not an arch.** You drive through a hole in a flat wall with
  ship either side and above it, hazard header over the opening, hull band and
  name boards carried round the stern, ink frame round the door.
- **Open sides on the car deck.** A low steel deckhead on transverse beams,
  pillars down both sides, and fresh air above the bulwark with the sea and
  the sunset going past. This is the one cue a tunnel can never have, because
  a tunnel's defining property is that you cannot see out of it.
- **And a bow door,** so the sky opens before the lip and you can see where you
  are going to land.

**The car deck went from five units above the water to nine,** because the
freeboard IS the ship: at two metres the hull was a raft with a shed on it. The
bow ramp came down from twelve segments to nine to pay for it, so the lip is at
19.8 against the old 19.4 and the jump Anthony has already learned does not
move under him.

**And the sea got its own level.** Ground quads sit at the road's height, which
is right for ground and catastrophic for water: the sea climbed the linkspan
with the road and buried the hull to its deck edge. Sea level is now the
natural profile — the landscape before the set pieces were added, which is what
`track.docksAdd` records — less a small drop, with a quay wall quad closing the
step. That is also why the road now reads as standing above the water
everywhere rather than lying on it.

Three bugs found by looking rather than reasoning: the ship vanished the moment
its stern went behind the camera; walking the road eighty segments back to find
it accumulated so much heading error that the ship sat a hundred units to the
left (fixed by not walking at all — the berth is dead straight by construction,
which is the same fact that lets the hull be rigid); and the bow was plated
straight across, so the exit was a black wall.

### 19 August: the menu fell off the bottom of the phone

Anthony, after switching tracks: *"I get this weird thing going on with the
screen... Looks a bit amateur the way it is and not really obvious how to get
out of the situation, which is click the screen and hope it works."* RACE and
FULL SCREEN were below the fold, so the only way out was to tap the canvas and
hope the fullscreen request landed.

**`height: 100%` and `position: fixed; inset: 0` both resolve against the
LAYOUT viewport, and on Android Chrome that is the height with the address bar
HIDDEN.** With the bar showing, every fixed layer on the page is taller than
the screen. It never showed up because the game lives in fullscreen — and it
appeared the moment the game was not, which is exactly what switching tracks
does: a page load always drops fullscreen and no browser can be talked out of
that.

`vmin` lies for the same reason. On a landscape phone vmin IS the height, so
every element sized in it was sized for a screen taller than the one it was on
— fixing the container alone would only have moved the overflow inside it.

So there are two measured properties now and everything is expressed in them:

- `--vph` — the real visible height, from `visualViewport.height`, updated on
  resize, on the visual viewport's own resize and scroll events, on rotate and
  on fullscreen change. CSS `100svh` is the fallback.
- `--vmn` — `min(100vw, var(--vph))`, i.e. vmin against a height that exists.

**And it is testable, which was the actual difficulty.** No headless browser
has an address bar, so every screen `tools/menufit.mjs` had ever been pointed
at passed. It fakes one now by overriding `--vph`, the same trick it already
used for the Android safe-area insets, and it measures the fit box against
`--vph` rather than `innerHeight` — measuring against `innerHeight` would have
let the bug straight through while printing a pass. Two rows added: his phone
and the Samsung, each with a bar and a gesture strip. The Samsung with a bar is
**166 usable pixels**, which took four more rounds of sizing to fit.

The car and the "coming soon" prose are `flex: 0 1 auto; min-height: 0` now, so
they give way when a screen is too short for everything — the correct order of
sacrifice, and what the comment above `#mCar` had claimed the policy was for
months without it ever being wired up. The 14px gap under the car did NOT give
way: Anthony asked for that one by name.

The front page also says what happened after a switch — *"changing track
reloaded the page, so full screen came off — RACE puts it back"* — because RACE
takes fullscreen on its way into the countdown, so there was never anything to
fix, only something nobody had said.

### 19 August, later: the menu was off-centre, and the fit rig could not see it

Anthony: *"That made things even worse. Before it was only when I swapped
tracks it pushed everything hard right but when a fresh load happened it was
central. Now a fresh load and everything is pushed hard right."*

**The panel's padding took the LEFT inset on the left and the RIGHT inset on
the right.** That is what safe-area insets are for and it is the wrong way to
apply them to a centred block: unequal padding moves the contents by half the
difference. Measured, on a 480px screen: no insets puts the block dead centre
at 240; a left inset of 80 puts it at 280. Both sides take the LARGER of the
two now, so the block is centred whatever the phone reports and still clears
the furniture on whichever edge it is on.

**And `tools/menufit.mjs` never asked whether anything was CENTRED — only
whether it FIT.** Those are different questions, and a block shoved a third of
the way across the screen fits perfectly well. The rig passed every screen in
its list, including a row called "the Samsung, gesture bar left" that has been
there since the insets went in and was reproducing the bug on every run without
anyone asking it the right question. There is an assertion for it now, on every
screen, with two pixels of slack for sub-pixel rounding.

**HONESTY ABOUT WHAT IS AND IS NOT PROVEN.** The asymmetry is real, measured,
and fixed. It is probably not the whole of what Anthony photographed — the
offset in his picture is several times larger than any plausible safe-area
inset can produce, and nothing else in the stylesheet accounts for it. Rather
than guess a fourth time there is now a **THIS SCREEN** row at the top of
Settings that prints what the phone says about itself: both viewports, the
visual viewport's offset and scale, the device pixel ratio, all four insets and
the measured `--vph`. One photograph of that line settles it.

Also fixed on the way past: the loop that fills the settings value cells from
`read()` by key blanked the new row, because `read()` has no `screen` key and
`undefined` stringifies to nothing. It skips keys the state object does not own
now, which any future computed row would have needed.

### 19 August, and the diagnostic row earned its keep on the first try

Anthony's THIS SCREEN line, straight off his phone:

```
win 980x408   vis 672x280   off 0,0   x1.00   dpr 2.00   inset L0 R0
```

**980 is Chrome's fallback layout width for a page it is treating as a desktop
site, and the insets are ZERO.** So the asymmetric-padding theory — real,
measured, and fixed — was not this at all. The page was laid out 980 CSS px
wide while he could see 672 of them at 1:1, so a menu block centred at 490 sat
at 490 in a window whose middle is 336. It was *perfectly centred*, in a
viewport a third wider than the phone. That is the whole of "pushed hard right",
and it is why three rounds of centring work did not touch it.

**Nothing trusts the layout viewport now.** There are four properties — `--vpw`,
`--vph`, `--vpx`, `--vpy` — all read from `visualViewport`, which is the
rectangle actually on the glass, and every fixed layer including the canvas is
positioned AND sized from them. One mechanism covers desktop mode, the address
bar and pinch-zoom panning, which is three bugs' worth of cause with one shape.

**And the rig can now fail on purpose.** `tools/menufit.mjs` takes a path, so it
can be pointed at an old build; against the pre-fix bundle the two new rows read

```
FAIL  desktop-mode: 980 laid out, 672 visible   middle at 490px, screen middle 336px
FAIL  panned: 980 laid out, 672 visible at x=140   middle at 490px, screen middle 476px
```

which is Anthony's photograph, in numbers. Every row that existed before passes
on both builds — none of them could see it, because none of them faked a visual
viewport smaller than the layout one.

*The lesson worth keeping:* three fixes went in on guesses and one of them made
things worse. The fourth attempt started by asking the phone what it thought it
was, and the answer took ten seconds to interpret. When a device-specific bug
resists two attempts, stop fixing and start instrumenting.

### Getting ready to share it — 20 August

Anthony: *"I'll most likely share a link to the game soon and get some feedback
on how it drives and so on. Other players will turn up things I can't find
that's for sure so I'm keen to move to this stage before we invest time in a
points system, garage etc."*

Right call, and the ordering is the point: a points system built before anyone
outside the family has driven the thing is a system built on one person's
guesses about what is fun.

Two things went in for it.

**SCREEN INFO moved to the bottom of Settings** and is worded for a stranger.
It solved the off-centre menu in one round trip after three guesses had failed,
so it stays — but a new player should not open Settings and meet a wall of
viewport arithmetic.

**And the build stamp is a hash of the BUNDLE now, not of the commit.** The
commit hash was exact and free and pointed at nothing: this game is built in a
throwaway cloud container that gets reclaimed every few hours, each recovery
starts a fresh `git init`, so the hash in a shipped build referred to a commit
that exists in no repository anywhere — while looking authoritative enough that
someone would try to match it against GitHub and conclude the download was
corrupt. A content hash cannot lie: two testers on the same file report the same
eight characters, and it needs no repository to mean something. It is on the
SCREEN INFO line as well as the numbers panel, because the first thing any bug
report needs is which build produced it.

**What is worth asking testers**, given what this project has learned about
where its bugs actually live:

- What phone, and does the layout look right — anything cut off or off to one
  side. Three of the last four bugs were layout on a device nobody here owns.
- Does tilt steering work, and did a permission prompt appear. iOS has its own
  answer and it is the one that nearly killed the project.
- Is it smooth, and if not, does turning CITY down in Settings fix it. That
  dial exists to find the breaking point on hardware we cannot buy.
- Which track, and what lap time. A time is a compact summary of whether the
  car, the corners and the nitrous are all behaving.

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

## An engine recording, to score the synthesis against

Not a fix — the V8 measures well and Anthony has said it reads right. This is
the missing HALF of how everything else here gets judged.

`tools/audio.mjs` measures the engine's internal consistency: the firing
harmonic lands where `cylinders x rpm/120` says, the V8 carries half-order
energy where the V12 does not, the limiter holds, the upshift is an event
rather than a hole. What it cannot measure is RESEMBLANCE, because there is
nothing to resemble. Every number in the v8 spec was reasoned to and then tuned
by ear, and the ear has been the only judge — which is exactly the position the
car was in before the reference image, when nobody could tell whether the
missing 16% of the silhouette score was the model or the measurement.

With a real recording an agent can FFT it at known rev points, read the actual
harmonic amplitudes, the real half-order ratio and the real roll-off, and then
score our spectrum against it per harmonic. "Sounds better" becomes a number
and the ear becomes the tie-breaker rather than the whole court.

**IT NEVER SHIPS.** No downloaded assets — the clip is a development reference
exactly like the car pictures, used to derive the spec and then left in `ref/`.
The game goes on synthesising every sound it makes.

### What makes a clip useful, in order

1. **One gear, idle to the limiter, in one clean sweep.** This is the whole
   prize. In a single gear the revs rise smoothly and rpm is recoverable from
   the firing frequency itself, so every frame is a labelled data point. Gear
   shifts break the sweep into fragments that have to be stitched.
2. **The right engine, and labelled as such.** A big lazy pushrod V8 with a
   4,500-5,000 redline — the car is a '67 Camaro. Not a turbo, not a flat-plane
   exotic, not a modern V8 with an active exhaust. The cylinder count has to be
   known, because it is what converts firing frequency back into rpm.
3. **Exhaust side, not the cabin.** The model is of what comes out of the pipe.
4. **Raw, not produced.** Sample libraries often bake in reverb, EQ and
   compression, and all three move exactly the numbers being measured. A rough
   phone recording of a real car beats a polished library asset here.
5. **High bitrate.** WAV or FLAC ideally; a low-bitrate MP3 mangles the upper
   harmonics that set `tilt`. 320k is acceptable.
6. **Short is fine.** Ten to twenty seconds of pull is plenty. A steady idle and
   a steady cruise are useful extras, not requirements.
7. **Clean.** No music, no commentary, minimal wind and road noise.

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
- **Tilt on iPhone — FIXED 18 August, UNVERIFIED ON A REAL PHONE.** Anthony's
  daughter's iPhone never showed the motion prompt, and switching TILT STEERING
  off and on in Settings did nothing. Two bugs, neither of them iOS's fault:
  the attempt was latched instead of the outcome, so a single
  `NotAllowedError` (which means *nothing was asked*) disabled asking for the
  whole session; and the Settings switch never called `askTilt()` at all, so
  the first thing any player tries could not work. Both fixed, plus `click` as
  an activation source alongside `touchstart`.

  The game now RECORDS what iOS said — `tilt.perm` is one of
  `n/a / unasked / blocked / denied / granted` — and the TILT row in Settings
  says which, because the three failures have three different fixes and one of
  them is only the player's to make: once Safari has a refusal on file it never
  shows the dialog again, and the way back is deleting the site's data in iOS
  Settings. Same reasoning as the fullscreen refusal text.

  `tools/tiltperm.mjs` fakes `DeviceOrientationEvent.requestPermission` and
  drives all five branches including a negative control. It fails all five
  against the pre-fix bundle. **What no harness here can prove is that real
  Safari accepts our tap as transient activation** — that needs the phone, and
  the Settings row is what will say so next time.
- **iPhone.** Being tested 12 August. See the four things worth checking in the
  chat of 11 August: fullscreen (iPhone Safari has no Fullscreen API at all, so
  `fs.state` should read `unsupported` and the layout has to survive Safari's
  chrome), the tilt permission dialog appearing on the FIRST tap, audio starting
  at all, and what `panelHz` reads on a 120Hz ProMotion screen — the frame pacer
  only divides evenly into whole divisions of the panel rate.
