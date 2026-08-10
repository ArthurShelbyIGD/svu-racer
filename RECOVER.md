# If the container was reclaimed, or you are a fresh session

This file exists because it has happened twice. The Cowork sandbox is
ephemeral: it gets reclaimed after a period of inactivity, and everything
inside it goes — the repo, the branches, the node_modules, the lot.

**Backing up inside the container is not a backup.** The first time this
happened there were bundles in `/root/backup`, on the same disk, and they went
with everything else. About thirty commits were lost. The second time nothing
was lost, because by then the backups were being written to Anthony's own
machine.

## What survives

Two files, in **Anthony's Downloads folder** on his Windows laptop, rewritten
at the end of every round of work:

| File | What it is |
|---|---|
| `racer-src.tgz` | The whole racer working tree, minus `node_modules`. **This is the master copy.** |
| `svu-catchup.bundle` | An incremental git bundle of the `svu-run` repo, for pushing the built page to GitHub Pages. |

They are reachable from a session via the device bridge
(`mcp__remote-devices__device_stage_files`), which stages them into
`/mnt/user-data/uploads/`.

## Recovering

```
mkdir -p /root/racer
tar xzf /mnt/user-data/uploads/.../racer-src.tgz -C /root/racer
cd /root/racer
npm install
npm run build
node tools/check.mjs
```

If `tools/check.mjs` passes and `docs/index.html` is around 490 KB, you have
everything. The tarball has no `.git`, so the commit history is gone — but the
history was never where the reasoning lived. See below.

## Where the reasoning lives

Deliberately, in the code rather than in a document that would go stale:

- **`src/main.js`** — the header states the rules that keep it cheap and why
  each exists. Every constant that was ever wrong carries a comment explaining
  what it was, what that broke, and how the current value was arrived at.
  `CORNER_AUTHORITY` and `REACH_90` are the two worth reading first; both
  document real bugs that reached the phone.
- **`src/art/toon.js`** — how the comic-book look is done without a shader,
  a light, or a render pass.
- **`src/car/body.js`, `src/car/cockpit.js`** — stubs with contracts. The
  contract is the design; the shapes are replaceable.
- **`tools/check.mjs`** — the checks, each with a comment saying which real
  failure it is there to catch. Several exist because they failed once.

## The rules, in one place

1. **No lights. Ever.** Every material is `MeshBasicMaterial`. Shading is baked
   into vertex colours or flat per-part colours. Per-pixel lighting is what made
   the previous project unplayable on the target phone.
2. No shadows, no post-processing, no reflections, no custom shaders.
3. Draw calls are the scarcest resource. Merge by material. The road is one
   mesh rewritten per frame, not 220 meshes.
4. No per-frame allocation in the hot path.
5. No downloaded assets of any kind. Everything is generated in code, and the
   whole game ships as one HTML file.

## The target device

A Ulefone Armor X12: MediaTek Helio A22, PowerVR GE8320, 3GB RAM, Android 13.
Anthony's own phone, chosen as the floor on the reasoning that almost everyone
has a better one. **It is the arbiter.** SwiftShader frame rates in the test
harness mean nothing; draw call and triangle counts from
`renderer.info.render` are exact and do mean something.

## The one habit that matters

Reasoning about rendering has been wrong on this project every single time it
has been tried. Looking at frames has been right. Measuring pixels has been
better still. Three confident hypotheses died to pixel samples, including one
handed down as fact that an agent overturned by measuring.

And green tests have been confidently wrong three times: eighty-two of them
once shipped a build that would not open, and a smoke test actively asserted an
input bug as correct behaviour. When a test and the phone disagree, the phone
is right.
