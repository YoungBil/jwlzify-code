# Spec: Programmatic stone compositing — guaranteed exact stone counts

## Goal

Guarantee that the image the customer sees carries **exactly** the stone count they
selected (for counts 1–7, where exactness is promised), instead of relying on prompt
engineering that the image model only *usually* honors. Done client-side with canvas
compositing: render the piece, then draw pre-rendered stone sprites onto it at
deterministic positions. Pure JS + `<canvas>`, no build step, no new workers.

## Current state

- **The model cannot count.** CLAUDE.md "Known gotchas": enormous prompt effort
  (`_ringExactCountClause` ~4923, `_ringExactCountReminder` ~4931,
  `_RING_EXTRA_STONES_NEG` ~4936, `_authoritativeStoneClause` ~3849, spec bookends in
  `_buildPromptSafeguards` ~2061) improves adherence but does not guarantee it.
  Pricing is already spec-math-driven, so only the *image* lies today.
- **A vision-verify loop NOW EXISTS** (landed 2026-07-05, after this spec's first
  draft): `_generateVerified()` (search `VISION-VERIFIED GENERATION` in ailab.html)
  counts stones on the generated image via the `vision-verify` worker for ring
  (head-on angle), earrings, and pendant, regenerating up to 3 attempts. It is
  probabilistic (a checker, not a guarantee) — this spec's compositing remains the
  path to a *guarantee*. **Critical interaction, see Integration points.**
- **Authoritative count** comes from `_authoritativeStoneCount()` (~3842):
  `jwlSpecifications.stoneCount || stones.length || 1`. Shape comes from
  `jwlSpecifications.stoneShape || userSelections.gemShape || 'Round'` (see ~2067,
  ~3176). Shape buttons (`.spec-gemshape-btn`, ~740–748) offer: Round, Oval, Cushion,
  Princess, Emerald, Pear.
- **Generation result paths** (all four must be hooked; they duplicate each other —
  CLAUDE.md Issues #6/#8):
  1. `startGeneration()` generic `.then` block ~4650–4698 (`LAB.imageUrl = blobUrl` ~4677)
  2. `confirmAndGenerate()` generic `.then` block ~4852–4875 (`LAB.imageUrl = blobUrl` ~4863)
  3. `_generateRingMultiAngle()` ~4991 (`LAB.ringAngles = urls; LAB.imageUrl = urls[0]` ~5030)
  4. `_generateBraceletMultiAngle()` ~5217 (`LAB.braceletAngles = urls` ~5248)
- **Downstream consumers of the final image:** `showRefineStep()` (~5398) sets
  `#refineImg`/`#quoteImg`/`#orderThumb` and **preloads the try-on cutout** at ~5448
  (`jewelryCutout(LAB.imageUrl)` cached in `bgRemovalCache`); `lastGeneratedImage`
  (base64 for img2img refine) is captured from the same blob (~4671, ~5036, ~5254);
  Save Design snapshots it; try-on masks it via `_buildRingMask` (~7466).
- **Cutout chain** `jewelryCutout()`: fal birefnet worker → local canvas BFS
  flood-fill (`removePendantBackgroundCanvas`, edge-seeded, with "sparkle-stone
  protection") → original at 0.85 alpha. (The remove.bg fallback step was removed
  2026-07-05.)
- **Ring try-on mask**: `_buildRingMask` hard-cuts everything below
  `dy + dh × 0.58` (`_RING_TOP_VISIBLE`, ~7453) — anything composited on the lower
  band is invisible in try-on.
- **Precedents to reuse:** `assets/chains/*.jpg` (existing asset folder convention),
  `generate-collection-images.js` (one-time Node batch script convention),
  `_pendantContentBox()` (~6108: normalized content-bbox detection from alpha +
  near-white rejection — exactly the anchor detection compositing needs).

## Approach

**Chosen: "minimal-stone base render + sprite overlay", head-on view only, behind a
feature flag, with silent fallback to today's behavior.**

1. For types with a hard count promise (**ring, pendant, earrings** — the same set
   `_authoritativeStoneClause` treats as authoritative; necklace/bracelet counts are
   emergent by design and stay out of scope) and count ≤ 7:
   - The prompt is switched from "EXACTLY N stones" to a **settings-only variant**:
     "N empty prong settings evenly spaced along the top of the band, no gemstones
     mounted, bare metal" (ring), "an empty prong setting at the center, no stone"
     (pendant/stud earring). The layout language in the prompt matches the sprite
     layout template, so even when the model drifts, sprites land plausibly.
   - After the blob URL lands, `applyStoneCompositing(blobUrl, type)` draws N sprites
     at template positions anchored to the piece's detected content bbox and returns
     a **new blob URL** that replaces the original everywhere downstream.
2. Only the **head-on image** (ring `ringAngles[0]`, the single pendant/earring
   render) is composited. Ring angles 1–2 (hero/profile) keep today's prompt-based
   counts — perspective makes flat sprites read as stickers there.
3. Count 1 is **excluded in v1** (solitaire renders are already reliable, and the
   center stone is the piece's focal point where sprite realism matters most).
   Effective v1 scope: ring counts 2–7. Pendant/earrings templates are specified
   below but ship behind the same flag as a fast-follow after ring is validated.

**Rejected alternatives:**
- *Detect-and-patch the base render* (find model-drawn stones, add/remove): reliable
  stone detection in arbitrary renders is a research problem; no.
- *Composite over a normal N-stone render*: double stones whenever the model obeyed
  the prompt; unusable.
- *Full 3D relighting / normal-mapped sprites*: no build step, no three.js in the 2D
  pipeline; overkill.
- *Server-side compositing in a worker*: violates "front end owns image logic";
  canvas is already the house tool (masking, BFS cutout, HF crop all use it).
- *Vision-verify loop alone (ask a VLM to count, regen on mismatch)*: now shipped
  (`_generateVerified`), but still probabilistic — a checker, not a guarantee.
  Compositing complements it; it does not replace compositing.

## Step-by-step implementation plan

All ailab.html work goes in the main `<script>` near the other generation helpers
(suggested insertion point: directly after `_authoritativeStoneClause`, ~3855).

### 1. Sprite assets — `assets/stones/`

- Files: `assets/stones/<shape>.png`, shape ∈ `round | oval | cushion | princess |
  emerald | pear` (lowercased from the button labels). 512×512 transparent PNG,
  face-up "table view" colorless stone, neutral studio lighting, faceting visible,
  no shadow baked in. One sprite per shape is enough — moissanite, lab diamond, and
  natural diamond are all colorless in this app.
- Generation: one-time Node script `generate-stone-sprites.js` (clone the structure
  of `generate-collection-images.js`): prompt the flux worker
  (`https://flux-image.sarkd333.workers.dev`) per shape ("single loose <shape>-cut
  diamond photographed face-up, centered, pure white background, macro, no jewelry,
  no metal"), then remove background via `https://fal-bg-remove.sarkd333.workers.dev`
  (POST `{image_url: dataURL}` → JSON `{image:{url}}`), save PNG. **Manually curate**
  the six results before committing — a bad sprite poisons every composite.
- Highlights and shadows are **procedural** (canvas gradients, below) — no extra
  asset files.

### 2. Config + carat→px mapping

```js
const COMPOSITE_STONES_ENABLED = true;           // kill switch
const COMPOSITE_MAX_COUNT = 7;                   // exactness promise ceiling
const STONE_SPRITE_PATH = s => `assets/stones/${(s||'round').toLowerCase()}.png`;
// Round-brilliant diameter ≈ 6.5mm at 1ct, scaling with cube root of carat.
function _stoneDiameterMm(ct){ return 6.5 * Math.cbrt(Math.max(0.05, ct||0.5)); }
```

px-per-mm anchors (per type, from the detected content bbox width `bboxW` px):
- **ring**: assume rendered outer diameter ≈ 21 mm → `pxPerMm = bboxW / 21`
- **pendant**: `pxPerMm = bboxW / jwlSpecifications.pendantWidthMm` (real spec)
- **earrings (stud)**: the stud ≈ the stone: sprite = `bboxW × 0.8`, ignore mm math

Per-stone carat: ring → `jwlSpecifications.stones[i]` (`_ctOf(s)`; rich objects
`{sizeBucket, carat}` — see state model); pendant → `totalCarats`; earrings →
`perStoneCt`.

### 3. Layout templates

```js
// Normalized to the piece content bbox: x,y in [0..1], mirrored pairs for symmetry.
const STONE_LAYOUTS = {
  // Ring head-on: stones sit along the top arc of the band. y values stay < 0.40
  // so every stone survives the try-on hard cut at 58% (_RING_TOP_VISIBLE).
  ring: {
    2: [{x:.42,y:.10},{x:.58,y:.10}],
    3: [{x:.50,y:.04},{x:.36,y:.14},{x:.64,y:.14}],
    4: [{x:.42,y:.06},{x:.58,y:.06},{x:.28,y:.20},{x:.72,y:.20}],
    5: [{x:.50,y:.03},{x:.38,y:.09},{x:.62,y:.09},{x:.27,y:.22},{x:.73,y:.22}],
    6: [{x:.44,y:.04},{x:.56,y:.04},{x:.33,y:.12},{x:.67,y:.12},{x:.24,y:.26},{x:.76,y:.26}],
    7: [{x:.50,y:.02},{x:.40,y:.06},{x:.60,y:.06},{x:.31,y:.14},{x:.69,y:.14},{x:.23,y:.27},{x:.77,y:.27}],
  },
  pendant:  { 1: [{x:.50,y:.45}] /* center; bail is at bbox top */ },
  earrings: { 1: [{x:.50,y:.50}] /* stud center */ },
};
```
Largest carat goes to the position nearest top-center (sort positions by
`|x-0.5| + y`, sort carats descending, zip). Tune the numbers against real renders
during implementation — they are starting values, not gospel.

### 4. `applyStoneCompositing(blobUrl, type)` — the core function

Async; returns a new blob URL, or **the original `blobUrl` on any failure** (never
throws, never returns null). Steps:

1. Guards: flag on; `type` ∈ {ring, pendant, earrings}; `n = _authoritativeStoneCount()`
   in `[2..COMPOSITE_MAX_COUNT]` (ring) / template exists for `(type, n)`; sprite for
   the shape preloads OK (cache sprites in a module-level `Map` on first use).
2. Load the render into an `Image`, draw to an offscreen canvas at natural size.
3. Detect the piece content bbox with the `_pendantContentBox` technique (alpha > 12
   OR luminance ≤ 244 counts as content — the render has a white/grey studio bg, so
   near-white rejection is the active path). If bbox is degenerate (<10% of frame),
   bail to fallback.
4. For each template position: compute center `(bx + x·bw, by + y·bh)`, stone
   diameter px from §2, then draw in order:
   - **shadow**: ellipse radial-gradient (black→transparent), `globalAlpha 0.30`,
     `globalCompositeOperation='multiply'`, offset +6% of diameter downward;
   - **sprite**: `source-over`, `imageSmoothingQuality='high'`;
   - **highlight**: small white radial gradient at the upper-left third of the
     stone, `screen`, `globalAlpha 0.35` — sells shared lighting direction.
5. `canvas.toBlob` (PNG) → `URL.createObjectURL`; revoke nothing here (callers own
   the old URL; the generic paths revoke superseded URLs already).
6. Log in house style: `console.log('[Composite] type:', type, '| count:', n,
   '| shape:', shape, '| bbox:', ...)`; on fallback log `[Composite] skipped: <why>`.

### 5. Prompt-side change (settings-only base render)

In `_ringExactCountClause(n)` (~4923): when `COMPOSITE_STONES_ENABLED && n >= 2 &&
n <= COMPOSITE_MAX_COUNT`, return the settings-only wording instead ("EXACTLY
N empty prong settings evenly spaced along the top arc of the band, no gemstones
mounted…"), and have `_genRingAngle` (~4958) add `gemstone, diamond, crystal` to the
negative prompt **only for the head-on angle** (angles 1–2 keep stone prompts).
Mirror the same condition in `_ringExactCountReminder`. Do **not** touch
`_buildPromptSafeguards` counts for other types in v1.

Compromise to call out: hero/profile angles will show model-drawn (approximate)
stones while head-on shows exact composited stones. Acceptable — head-on is the
try-on/quote/order image and the count promise anchor. If the mismatch bothers QA,
flip `RING_ANGLES` generation to settings-only for all three and composite only
index 0 — worse, because then angles 1–2 show empty settings; keep as specced.

### 6. Hook the four result paths

Immediately before each `LAB.imageUrl = …` assignment listed in Current state:

```js
blobUrl = await applyStoneCompositing(blobUrl, resolvedType);   // paths 1–2
urls[0] = await applyStoneCompositing(urls[0], 'ring');          // path 3 (after retries, before LAB.ringAngles = urls)
```
Path 4 (bracelet) gets **no hook** (out of scope). Paths 1–2 serve pendant/earrings
(and necklace, which the guards skip). The `.then(blobUrl => …)` callbacks become
`async` — they already contain awaits-via-promises; making them `async` is safe.
Hook **before** `lastGeneratedImage` capture and `bgRemovalCache.clear()` so refine
and try-on both operate on the composited image.

## Integration points

- **⚠ Vision-verify loop (`_generateVerified`) — MUST be reconciled first.** With
  compositing enabled, the ring head-on base render is generated with the
  settings-only prompt (zero stones), so the existing count verification would FAIL
  every attempt and burn 3 generations. Required change: in `_genRingAngle`, when
  `COMPOSITE_STONES_ENABLED` applies to this generation, either (a) skip the count
  check (pass `expected.stones = null`, keep the type/form check) and instead verify
  the count AFTER compositing as a cheap sanity assert, or (b) verify
  `expected.stones = 0` on the base render (settings must be empty). Option (a) is
  recommended — simpler and it validates what the user actually sees. Pendant/
  earrings keep normal verification until their compositing fast-follow ships.
- **Try-on / cutout**: nothing changes — `jewelryCutout` receives the composited
  URL because compositing happens before `LAB.imageUrl` is set and before the
  `showRefineStep` preload (~5448). Sprites are opaque pixels inside the piece
  silhouette; birefnet keeps them. Ring layout y ≤ 0.40 keeps all stones above the
  `_RING_TOP_VISIBLE` 0.58 cut in `_buildRingMask`.
- **Refine (img2img)**: `lastGeneratedImage` is captured from the composited blob,
  so a refine pass edits the image the user actually saw. Note: a refine
  regeneration re-runs the pipeline and re-composites (specs unchanged), so counts
  stay exact across refines.
- **Pricing/specs**: untouched. Compositing reads `jwlSpecifications`, never writes
  it; all compatibility mirrors intact.
- **No new workers**; sprite generation script reuses deployed workers as-is.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Sprites read as "pasted on" (lighting/perspective mismatch) | Head-on only; procedural shadow+highlight; face-up sprites match the head-on camera; manual curation of the 6 sprites; kill switch `COMPOSITE_STONES_ENABLED` |
| Settings-only prompt renders poorly (weird empty prongs) | Verify with ~10 test renders per style before enabling; the negative `gemstone, diamond` addition is head-on-only so damage is contained; fallback path leaves current behavior available by flipping the flag |
| Model draws stones anyway despite settings-only prompt → doubled stones | Composited sprites cover top-arc positions where the model puts stones; residual model stones elsewhere are the same failure we have today, no worse. Optional v2: count-verify via a VLM call before compositing |
| bbox detection fooled by shadows/reflections in the render | Same luminance threshold (244) proven in `_pendantContentBox`; degenerate-bbox guard falls back |
| Canvas BFS cutout fallback erodes sprite edges (flood fill from edges with bright-pixel handling) | Sprites are interior pixels, not edge-connected to background; BFS is edge-seeded so it cannot reach them; fal birefnet is the primary anyway |
| `?cb=` cache-buster appended to the new blob URL | Existing guard already prevents cache-busters on `blob:` URLs — keep it |
| Blob-URL leak (original render URL orphaned after replacement) | Revoke the pre-composite URL right after a successful composite in each hook |
| Sprite 404 (asset not deployed) | Preload guard → fallback to original render; log `[Composite] skipped: sprite load failed` |

## Test plan (manual — no test framework)

1. **Ring counts 2–7**: for each count, set total ct + per-stone carats in the ring
   flow (`#ringCaratFlow`), each of the 6 shapes at least once, generate. Verify:
   head-on gallery image shows exactly N stones; console shows `[Composite] type:
   ring | count: N`; hero/profile angles still render.
2. **Solitaire (count 1)** and **count 8+**: verify `[Composite] skipped` and
   unmodified behavior.
3. **Try-on**: ring try-on after compositing — all stones visible above the finger
   cut; cutout method logged as `fal-birefnet`; drag/resize/rotate unaffected.
   Repeat with the fal worker blocked in DevTools (offline the request) to force the
   canvas-BFS path; confirm sprites survive.
4. **Refine**: composite a 3-stone ring, then "Refine This" ("make the band wider");
   verify the refined image is edited from the composited version and re-composites.
5. **Quote/order/save**: `#quoteImg`, `#orderThumb`, Save Design thumbnail all show
   the composited image; price identical to pre-feature (spec math untouched).
6. **Flag off**: set `COMPOSITE_STONES_ENABLED = false`; full regression pass of
   ring/pendant/earrings generation → identical to today.
7. **Fallback injection**: temporarily rename a sprite file locally; generate; verify
   graceful skip with the original render shown and no console errors thrown.
8. Cross-browser: Chrome + Safari (canvas `toBlob`, `filter`, composite ops), mobile
   viewport smoke test.
