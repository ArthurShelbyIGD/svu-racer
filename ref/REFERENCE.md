# The art reference, as numbers

Anthony supplied two comic-book renders of a '67 Camaro and said: *"Comic book
style, Borderlands 2 type art would be fantastic... it looked like it was drawn
with coloured pencils"*, and *"I want this to be a mad game not a realistic
one."*

`camaro-plain.png` is the useful one — plain white background, so the car can be
isolated and measured. `camaro-garage.png` is the same car in a workshop with a
blower through the bonnet.

**These are measurements, not impressions.** On the previous project, three
confident visual judgements were overturned by sampling pixels, including one
handed down as fact. So the reference has been measured and what follows are the
numbers an implementation can be graded against. Do not re-litigate them by
looking at the picture and disagreeing — re-measure.

## The single most important number

**39% of the drawn car is solid black ink.**

Not the outline *around* the car — 39% of every pixel that is not background.
Line work is not a finishing touch in this style, it is most of the drawing.

The consistent failure mode when matching this look is timidity: ink that feels
bold while you are placing it, and reads as a thin grey edge at arm's length on
a phone. **If it feels too heavy, it is probably close to right.**

## Ink weight — two tiers, roughly 4:1

Measured as horizontal run lengths of near-black pixels across an 868px-long car:

| | pixels | as % of car length | what it is |
|---|---|---|---|
| median | 3 | 0.35% | panel breaks, shut lines, interior detail |
| 90th pct | 12 | 1.4% | the outer silhouette |
| 98th pct | 21 | 2.4% | heaviest silhouette, wheel arches |

So there are **two** distinct line weights, not one:

- **Silhouette ink ≈ 1.4% of car length.** Our car is 5.6 world units long, so
  that is **≈ 0.08 units**. The current `INK` constant in `src/art/toon.js` is
  0.09, which measurement says is right — slightly heavy, within range.
- **Detail ink ≈ 0.35% of car length**, so **≈ 0.02 units**. An inverted hull
  cannot draw these: it only ever outlines a silhouette. Panel lines have to
  come from somewhere else — either from parts genuinely being separate meshes
  with ink between them, or baked into vertex colours as dark bands.

That second tier is the thing most likely to be missing from a first attempt,
and it is a large part of why the reference reads as *drawn*.

## Body colour — 4 flat bands, not a gradient

The green bodywork resolves into discrete steps:

| hex | luminance | share of body |
|---|---|---|
| `#48722f` | 78 | 9% — deep shade, lower panels |
| `#66a330` | 105 | 9% — shadow side |
| `#84c93b` | 132 | 6% — base |
| `#98d848` | 147 | 6% — lit upper surfaces |
| `#b6e777` | 178 | 1% — hot highlight, small and sharp |

Four working bands plus a small bright highlight. **Darkest to lightest is a
2.3:1 luminance ratio** — a wide range, applied in hard steps.

This is the part we get almost free: no lights plus flat per-face colour *is*
cel shading. It only needs the bands chosen deliberately — four tones of one
hue at that ratio — rather than the two the placeholder car uses.

The highlight matters out of proportion to its 1%: it is what stops flat colour
reading as flat. Small, sharp-edged, on the top surfaces only.

## Styling cues, all of them buildable

- **Stance is raked**: nose down, tail up, fat rear tyres and narrower fronts.
  Pure drag-strip attitude and it costs nothing to model.
- **Blower through the bonnet** in the garage image — which lands exactly on the
  `engineTop` attach point. The reference validates the parts plan.
- **Twin stripes over the bonnet and roof**, plus a beltline stripe down the
  flank, in a contrasting colour (purple against green). Stripes are a colour
  band on existing geometry, so they cost nothing and add a lot.
- **Chrome**: front bumper, five-spoke wheels, side exhaust exiting ahead of the
  rear wheel. Chrome in this style is not reflective — it is 3 or 4 flat grey
  bands with hard edges, near-white at the top and near-black underneath.
- **Cabin sits about 39% back from the nose and occupies roughly half the
  length.** Long bonnet, short rear deck — the muscle car proportion.

## The rear three-quarter — `camaro-rear34.png`

**This is the view that matters.** The chase camera sits behind and slightly
above, so this is the shape the player looks at for the entire game. Judge the
model from here first and from anywhere else second.

The style numbers hold across both views, which is the useful thing about
having measured two:

| | front 3/4 | rear 3/4 |
|---|---|---|
| ink as % of drawn pixels | 39.3% | 36.6% |
| body colour bands | 5 | 5 |
| body luminance range | 78–178 | 76–139 |

So **37–39% ink** is the target, not an artefact of one drawing.

### The silhouette from behind, measured

Width at each height, as a percentage of the car's widest point:

```
   5% down from the roof   41%   ################
  12%                      51%   ####################
  20%                      73%   #############################
  27%                      88%   ###################################
  35%                     100%   ########################################  <- widest
  42%                      98%   #######################################
  50%                      97%   ######################################
  58%                      97%   ######################################
  65%                      84%   #################################
  72%                      67%   ##########################
  80%                      58%   #######################
```

Three things fall out of this, and all three are easy to get wrong:

1. **The cabin is about half the width of the body** — 41–51% at the top
   against 100% at the beltline. A low-poly car built as a box with a smaller
   box on top usually makes the cabin far too wide, and it immediately reads as
   a toy rather than a muscle car.
2. **The widest point is 35% of the way down** — the rear haunches, not the
   sills. The body bulges outward over the rear wheels and tucks back in below
   them. That bulge is the single most characteristic shape from this angle.
3. **The shoulders are abrupt.** 51% to 88% happens in 15% of the height —
   the roof does not taper gently into the body, it drops onto it.

### Details visible from behind, in rough order of value

- **Four tail lights** — two rectangular clusters each side, sitting in a
  recessed black panel spanning the tail. Cheap: one dark quad with four small
  red quads on it, and they are the only warm colour on the car.
- **Twin stripes running over the roof and down the rear deck**, in the
  contrasting colour. From behind these are the most visible graphic on the car,
  so they matter more here than on the bonnet.
- **Quad exhaust tips**, two pairs, low and central under the rear valance.
- **Chrome rear bumper** wrapping the tail, with the number plate recessed in
  the centre.
- **A subtle lip on the rear deck** — not a wing. Wings are for the `wingRear`
  attach point, where the player bolts on something ridiculous.
- **Rear tyres visibly wider than the fronts** and standing slightly proud of
  the body.

## How to use this

Grade against the numbers, not against the impression:

1. Render the car, isolate it from the background, and measure ink as a
   percentage of drawn pixels. **Target 39%.** Under 25% and it will read as a
   3D model with a thin edge rather than a drawing.
2. Count distinct luminance bands on the bodywork. **Target 4 plus a highlight**,
   spanning a 2.3:1 luminance ratio.
3. Check both line weights are present — a silhouette tier and a detail tier
   about four times finer.

## The colour, measured — lime green and purple

Anthony: *"we should also get the colour, move away from the red, use the lime
green with purple stripes the same as the image."*

Sampled from `camaro-plain.png`. Five body bands spanning a **2.46:1 luminance
ratio**, and three for the stripe:

| lime green | luminance | | purple stripe | luminance |
|---|---|---|---|---|
| `#46702e` | 74 — deep shade, sills and under-panels | | `#4c3b58` | 74 |
| `#629d2f` | 99 — shadow side | | `#715a7e` | 110 |
| `#79bb35` | 122 — base | | `#80658f` | 127 |
| `#92d441` | 142 — lit upper surfaces | | | |
| `#baeb7d` | 182 — hot highlight, small and sharp | | | |

The purple is duller and darker than it looks — it sits at the same luminance
as the green's *shadow*, which is why it reads as a stripe rather than as a
second body colour. A bright purple would fight the green; this one recedes.

Stripe placement, from the references: twin stripes over the bonnet, across
the roof and down the rear deck, plus a thinner one along the beltline.

## The interior — `camaro-interior.png`

Anthony thought this one failed. It did not: it is imperfect as a *view* but it
is a good measurement of the *interior style*, which is what was missing.

**55% of that frame is near-black.** A car interior is mostly dark plastic, and
the reference is far darker than any exterior shot — so first person is graded
against that figure, not against the 37-39% used for the bodywork. Trying to
hit 39% inside the car would mean lightening the dash until it stopped looking
like a dash.

Quantised palette, and the story is in how few light pixels there are:

| hex | share | what |
|---|---|---|
| `#26282e` | 22% | dash, door card, seats — the bulk |
| `#000001` | 17% | ink and shadow |
| `#5d6466` | 16% | mid-grey — the wheel rim, trim |
| `#4c4c4d` | 12% | |
| `#34383d` | 10% | |
| `#838c8d` | 10% | **the brightest thing in the frame** — chrome spokes, dial bezels |

So: a near-black cockpit with a handful of pale metal accents, and nothing in
between. The chrome three-spoke wheel is the single brightest object and it is
what makes the shot read; our wheel is currently dark on dark.

Useful details visible: a binnacle with two large dials directly ahead of the
driver, the pale three-spoke wheel with a centre boss, a gear lever on the
console — worth noting given the plan to turn the speed steps into gears — and
the windscreen frame with a rear-view mirror across the top of the view.

## Asphalt 8, measured on the actual phone

Anthony installed Asphalt 8 on the target Ulefone to see whether the hardware
could take it. It ran perfectly — "nothing phases the phone, drifting, barrel
rolls, spin jumps and crashes" — and he screenshotted it before uninstalling.

**The performance conclusion is weaker than it looks and the ART conclusion is
much stronger than expected.** Asphalt 8 is native compiled code talking
straight to the GPU; we are JavaScript and WebGL, with a validation layer and a
compositor in between. On low-end Android that gap is typically 2-5x, so their
frame rate does not convert into our budget. Their 3GB of hand-authored textures
does not convert into anything at all: we ship 500KB generated in code.

What the screenshots ARE good for is a quality bar measured on the same screen
Anthony judges our game on. Put side by side, the gap is not where I expected:

| | car width, % of frame | colours to cover 90% of frame | pixels darker than 60 | pixels brighter than 170 | median luminance |
|---|---|---|---|---|---|
| Asphalt — street | 29% | 39 | 27% | 13% | 87 |
| Asphalt — tunnel | 28% | 36 | 61% | 14% | 41 |
| Asphalt — open road | 22% | 41 | 47% | 9% | 63 |
| **ours, third person** | **~30%** | **23** | **92%** | **2%** | **31** |
| **ours, first person** | **~30%** | **23** | **77%** | **4%** | **31** |

### Car size is already right

22-29% for them, about 30% for us after the camera was pulled in. No further
change needed, and going closer would be wrong.

### The scene is far too dark, and that is the biggest single gap

92% of our pixels are below luminance 60, against 27-47% in their daylight shots
and 61% in a TUNNEL. Their darkest scene is brighter than our normal one. We
have 2% bright pixels; they have 9-14% even underground.

This costs nothing to fix. It is entirely colour choice — no lights exist in
either engine's output here as far as the GPU is concerned, only flat colour.
The current palette is a deliberate night-time purple, which looks composed in
isolation and measures as an empty void beside theirs.

### The scene has half their colour variety

23 quantised colours cover 90% of our frame; they need 36-41. That is the
difference between a road with posts beside it and a road with lampposts, signs,
railings, hedges, kerbs, barriers, lane markings, buildings with windows, hills
behind the city and a sky with clouds in it.

Almost every item on that list is free at our budget: lane markings are a colour
band in a road mesh we already rewrite every frame, and window rows are per-
instance colour on scenery boxes we are already drawing. The scenery dial has
proven we can afford 20,000 objects. We are currently spending that budget on
20,000 copies of the same dark box.

### Other cheap things visible in their frames

- **A sky that is not one flat colour.** A vertical gradient plus a few cloud
  bands is two triangles and reads as weather.
- **A distant backdrop layer** — hills behind the city, well beyond the fog,
  which gives depth no amount of roadside detail can.
- **Dashed lane markings** down the middle of the road. Strong speed cue, free.
- **Vertical structures over the road** — the tunnel shot has arches overhead.
  Ours is relentlessly flat and open; something passing over you at speed is one
  of the strongest speed cues there is.
- **Nitro as a visual event**, not just a number: their boost fires a bright
  streak under the car and washes the screen edges.
