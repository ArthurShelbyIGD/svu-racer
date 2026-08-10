# tools/visibility.mjs was deleted, and why

It measured how much road the cockpit hides on descents, and it was WRONG in a
way that reported success:

* its "is this tarmac" test was `dark, slightly blue, desaturated`, which
  matches the dashboard colour `#26282e` exactly. So a dashboard covering the
  road was counted AS road. With a bigger interior it reported the tarmac
  roughly doubling — it said the view improved because more of it was dash.
* its hide path looked for meshes under a parent named `__cockpit` and set
  `R.__hideCockpit`. Neither has ever existed in main.js, so the tool never
  took a difference at all.

Found by a verifier agent, not by me — I wrote it, ran it, and read its output
as evidence.

The replacement is the occlusion-difference approach already used by
`tools/inkmeter.mjs`: render the same frozen frame twice, toggling
`tune.showCockpit`, and compare. That flag exists and main.js honours it.
Measured that way, the interior work did not regress descents — worst case road
survival went from 10.1% to 20.1%.

The lesson is the one this project keeps relearning: a measuring instrument is
code, and code you have not tested is not evidence. Test the instrument on a
case where you already know the answer before trusting it on one where you do
not.
