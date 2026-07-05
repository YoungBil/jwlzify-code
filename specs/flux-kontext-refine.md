# Spec: Instruction-based design refinement (Flux Kontext-style img2img)

## Goal

Make "Refine This" behave like an instruction edit — *"keep this design, change X"* —
by routing refines to a Kontext-style instruction-editing endpoint that receives the
**current image + only the change instruction**, instead of today's re-prompt that
usually regenerates the design from scratch.

## Current state

- **UI**: post-gen row in `#s3` — `#post-gen-ui` container, "Refine This" button →
  `selectPostGenMode('refine')` (~5287) reveals `#post-gen-input-row` with
  `#postGenInput` + `#regenerateBtn` (`doPostGenRegenerate()`, HTML ~1092–1104).
  A hidden `#tweakPrompt` textarea (~1107) is read by `startGeneration(true)`.
- **Flow**: `doPostGenRegenerate()` (~5297), refine branch:
  `LAB.prompt = 'Based on this existing design: ' + window._lastFullPrompt + ', make
  the following change: ' + input` → `startGeneration(true)`.
- `startGeneration(isTweak)` (~4468) sets
  `initImage = (isTweak && window._postGenMode === 'refine') ? lastGeneratedImage : null`
  (~4602). `lastGeneratedImage` is base64 of the last render, captured at ~4671
  (generic), ~5036 (ring head-on), ~5254 (bracelet head-on).
- **Two critical gaps in today's "refine":**
  1. `_generateImage()` (~2106) tries **Gemini first and never sends `initImage` to
     Gemini** (body is `{prompt, negativePrompt}` only, ~2137). So when Gemini is up
     — the normal case — "Refine This" is actually a full **txt2img re-roll** of the
     accumulated prompt. True img2img only happens on the Flux fallback (~2183,
     `initImage` → `fal-ai/flux-2-pro/edit`) or the SDXL fallback (strength 0.45).
  2. **Ring and bracelet refines ignore `initImage` entirely**: `startGeneration`
     branches to `_generateRingMultiAngle` (~4639→4991) / `_generateBraceletMultiAngle`
     (~4645→5217), whose per-angle calls pass `null` as initImage
     (`_genRingAngle` ~4988, `_genBraceletAngle` ~5214). Ring/bracelet "refine" is
     three fresh txt2img renders.
- **Prompt wrapping**: `_generateImage` wraps *every* prompt (refines included) with
  `_buildPromptSafeguards()` (~2061) — spec bookends at start AND end, placement
  clause, quality string, `guidance_scale` pinned 9.0.
- **Worker** (`flux-image-worker.js`, deployed at `FLUX_WORKER_URL =
  'https://flux-image.sarkd333.workers.dev'`, ~2045): POST
  `{prompt|inputs, image_size, initImage?, output_format?}`; `initImage` (raw base64)
  triggers `FAL_MODEL_EDIT = 'fal-ai/flux-2-pro/edit'`, else
  `FAL_MODEL_GEN = 'fal-ai/flux-2-pro'`; responds **raw image bytes** with CORS.
  Secret: `FAL_KEY`. Deployed via dashboard paste only (repo file is the reference
  copy — front-end fetch code is the contract source of truth).

## Approach

**Chosen:** a dedicated refine path that (a) skips Gemini, (b) calls the flux worker
in a new explicit `kontext` mode with the instruction only, (c) does **not** wrap the
instruction with `_buildPromptSafeguards`, and (d) collapses ring/bracelet to a
single-image gallery after a refine.

Why instruction-only, no spec bookends: Kontext-class editors treat the prompt as an
edit command against the supplied image; the image already embodies the specs. Adding
"A fine jewelry piece crafted in 925 Silver, set with exactly three stones…" bookends
turns the edit into a re-description and reintroduces drift — the exact failure this
feature removes. The safeguards stay untouched for txt2img ("Start Fresh",
step-2 generation).

**Rejected alternatives:**
- *Keep routing through `startGeneration(true)`/`_generateImage` and special-case
  everywhere*: `_generateImage` is the shared choke point for five generation flows;
  threading "skip Gemini, skip safeguards, different worker body" flags through it
  risks regressing txt2img. A separate small function is safer (accepting some
  duplication, consistent with the existing duplicated-entry-points reality,
  CLAUDE.md Issues #8).
- *Regenerate all 3 ring/bracelet angles after an instruction edit*: the edited
  design exists only as an image; independent txt2img angles would show a
  *different* design next to the edited one. Incoherent — rejected.
- *Edit all 3 angles via kontext with the same instruction*: 3× cost/latency, and
  per-angle edits still diverge (each edit is independent). Rejected for v1.
- *Client → fal directly*: keys live in workers only. Never.

## Step-by-step implementation plan

### 1. Worker: add a Kontext mode (`flux-image-worker.js`, dashboard paste)

```js
// RISK ITEM — verify current fal model id at implementation time. Candidates:
// 'fal-ai/flux-pro/kontext' (instruction editing), 'fal-ai/flux-pro/kontext/max'.
// fal renames models; confirm in the fal.ai model gallery before deploying.
const FAL_MODEL_KONTEXT = 'fal-ai/flux-pro/kontext';
```

In `fetch()`: read `const mode = body.mode || (initImage ? 'edit' : 'gen')`. When
`mode === 'kontext'` (requires `initImage`, else 400):

```js
falModel = FAL_MODEL_KONTEXT;
falBody  = {
  prompt,                                      // the INSTRUCTION only
  image_url: `data:image/png;base64,${initImage}`,
  guidance_scale: 3.5,                         // kontext default-range; NOT 9.0
  output_format: outputFormat,
  enable_safety_checker: true,                 // drop if the model rejects the param
};
```

Everything else is untouched: same fal.run request shape, same
`falJson.images[0].url` extraction, same **raw-bytes response contract** (the front
end must keep working with `res.blob()`). Existing `edit`/`gen` behavior must be
byte-for-byte unchanged when `mode` is absent — old clients/collections scripts still
hit this worker.

Response-shape risk: if the Kontext endpoint returns `{ images: [...] }` like the
current models, no change; if it returns a single `image` object, add
`falJson?.images?.[0]?.url || falJson?.image?.url` to the extraction line.

### 2. ailab.html: new `startInstructionRefine(instruction)`

Insert next to `doPostGenRegenerate` (~5297). Responsibilities (mirror the generic
result path ~4650–4698, minus prompt assembly):

```js
async function startInstructionRefine(instruction) {
  if (isGenerating) return;                       // same queue guard as startGeneration
  if (!lastGeneratedImage) { startGeneration(true); return; }  // no base image → old path
  isGenerating = true; generationId++; const thisGen = generationId;
  setGenLoading(true);
  const ri = document.getElementById('refineImg');
  if (ri) { ri.style.transition = 'filter 0.4s ease'; ri.style.filter = 'blur(14px) brightness(0.8)'; }
  const prompt = instruction +
    '. Keep everything else about this jewelry piece exactly the same — same design, ' +
    'same metal, same number of stones, same background and framing.';
  console.log('[Refine] kontext instruction:', prompt);
  let blobUrl = null;
  try {
    const res = await fetch(FLUX_WORKER_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'kontext', prompt, initImage: lastGeneratedImage }),
    });
    if (res.ok) { const b = await res.blob(); if (b.size >= 5000) blobUrl = URL.createObjectURL(b); }
  } catch (e) { console.warn('[Refine] kontext failed:', e.message); }
  if (!blobUrl) { console.warn('[Refine] falling back to legacy refine path');
    isGenerating = false; startGeneration(true); return; }   // legacy re-prompt chain
  if (thisGen !== generationId) { URL.revokeObjectURL(blobUrl); return; }
  // — adopt result (same bookkeeping as the generic path) —
  fetch(blobUrl).then(r => r.blob()).then(blob => { const fr = new FileReader();
    fr.onload = () => { lastGeneratedImage = fr.result.split(',')[1]; }; fr.readAsDataURL(blob); });
  LAB.imageUrl = blobUrl;
  bgRemovalCache.clear();
  if (ri) { ri.src = blobUrl; ri.style.filter = 'none'; }
  document.getElementById('quoteImg').src = blobUrl;
  const ot = document.getElementById('orderThumb'); if (ot) ot.src = blobUrl;
  // Ring/bracelet: edited design exists only as this one image — collapse gallery.
  if (LAB.type === 'ring'     && LAB.ringAngles)     { LAB.ringAngles     = [blobUrl]; setupRingGallery([blobUrl]); }
  if (LAB.type === 'bracelet' && LAB.braceletAngles) { LAB.braceletAngles = [blobUrl]; setupBraceletGallery([blobUrl]); }
  setGenLoading(false);
  showPostGenUI();
}
```

Notes for the implementer:
- `LAB.prompt` and `window._lastFullPrompt` are **not** modified — "Start Fresh" and
  the legacy tweak path keep working from the last full txt2img prompt. Keep a
  `window._refineHistory = []` push of each instruction for field debugging.
- The legacy fallback (`startGeneration(true)`) needs `LAB.prompt` set the old way —
  do that inside the fallback branch before calling it:
  `LAB.prompt = 'Based on this existing design: ' + (window._lastFullPrompt || '') + ', make the following change: ' + instruction;`
- Gallery collapse relies on `_setupAngleGallery` (~5057) hiding prev/next/dots when
  only one slide exists (`showNav = avail.length > 1`) — no gallery code changes.
  For rings pass `defaultOrig` handling as-is; `setupRingGallery([url])` works
  because index 0 exists. Bracelet ditto.
- Do NOT call `_enqueueGen` — this is a single direct call; the `isGenerating` guard
  already serializes it against other generations.

### 3. Wire `doPostGenRegenerate` (~5297)

Replace the refine branch body with:

```js
if (window._postGenMode === 'refine') {
  startInstructionRefine(input);
} else { /* fresh branch unchanged */ }
```

### 4. Spec-drift guard (client-side hint, not a rewrite)

Specs remain the source of truth for **pricing** — an instruction edit never touches
`jwlSpecifications`, so instructions that change count/metal/carat would desync image
from quote. In `startInstructionRefine`, before sending: run the instruction against
the existing stone-quantity regex used by `stripStoneQuantities()` plus a metal-word
check (`/\b(gold|silver|platinum)\b/i`). On match, still send the edit, but show an
inline note under `#post-gen-input-row` (create `<p id="refineSpecNote">`, hidden by
default, styled like `#ringAllocMessage`): *"Stone count, metal, and carat come from
your Specifications — change them in Step 2 (Start Fresh) so your quote stays
accurate."* Rationale: silently rewriting the user's instruction is surprising;
blocking is hostile; a visible nudge preserves trust and keeps this spec's contract
("specs are source of truth") honest about being a pricing contract, not an image
contract.

### 5. UI copy (post-gen input row)

- `selectPostGenMode('refine')` placeholder → `"One change, e.g. 'make the band
  thinner' or 'switch to a bezel setting'"` (edit the string at ~5292).
- In `showPostGenUI`/`selectPostGenMode`, when mode is refine add a one-line caption
  above the input (reuse `#refineSpecNote` element or a sibling): *"Edits your
  current image directly — the design stays, only your change is applied."*
- Ring/bracelet only: after a refine collapses the gallery, set
  `#ringGalleryCaption` text to `"Refined"` (via the existing caption element) so the
  missing angles read as intentional. Optional; skip if noisy.

## Integration points

- **Try-on**: `bgRemovalCache.clear()` + new `LAB.imageUrl` means the refine-step
  preload (~5448) re-runs `jewelryCutout` on the refined image; ring/bracelet try-on
  uses `ringAngles[0]`/`braceletAngles[0]` = the refined image. Coherent.
- **Multi-angle**: refine edits the head-on/base image only; gallery collapses to
  one slide; a subsequent "Start Fresh" restores the 3-angle flow. Note
  `[Ring TryOn] using head-on index 0` logging stays truthful.
- **Quote/order**: unchanged — pricing reads specs, and the refine never writes
  `jwlSpecifications` or its mirrors.
- **Vision-verify loop** (landed 2026-07-05, after this spec's first draft:
  `_generateVerified` in ailab.html): the new `startInstructionRefine()` path
  deliberately bypasses `_generateImage`, so it also bypasses verification. For v1
  run ONE `_verifyImage()` check on the kontext result for exact-count types
  (ring/earrings/pendant) — log-only, no auto-retry (instruction edits are cheap to
  redo manually and retrying an edit can compound drift). Revisit auto-retry in v2.
- **Stone-compositing spec** (specs/stone-compositing.md): if compositing ships,
  `lastGeneratedImage` is the composited image, so Kontext edits operate on the
  exact-count image. Composite is NOT re-applied after a kontext edit (the edit
  preserves the stones); do not chain `applyStoneCompositing` here.
- **Workers**: only `flux-image-worker.js` changes; gemini/hf workers untouched;
  deploy via dashboard paste, update the repo reference copy in the same commit.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| fal model id `fal-ai/flux-pro/kontext` wrong/renamed | Explicit verification step before deploy (fal model gallery); worker returns JSON error with `detail` on 404 → front end falls back to legacy refine path automatically |
| Kontext ignores "keep everything the same" and drifts | Fixed guard suffix in the prompt; guidance 3.5 (editing models over-change at high guidance); user can re-refine or Start Fresh |
| Kontext response shape differs from `images[0].url` | Dual extraction (`images[0].url || image.url`); worker logs raw JSON on miss |
| Gallery collapse surprises ring/bracelet users | Caption/copy in §5; Start Fresh restores angles; cheap to revert |
| Legacy fallback double-charges UX (blur → unblur → blur) | Fallback resets `isGenerating` before delegating, and `startGeneration` re-runs `setGenLoading(true)` idempotently |
| Instruction contains count/metal changes → image/quote desync | §4 visible nudge; residual risk accepted and identical in kind to today's refine |
| `enable_safety_checker` unsupported on kontext endpoint | Try with it; if fal 422s, remove the field for kontext mode only (worker-side) |
| Repo worker copy drifts from deployed (existing Issues #5 pattern) | Update `flux-image-worker.js` in the repo in the same change; front-end fetch remains the contract source of truth |

## Test plan (manual, Stripe-free page — no framework)

1. **Happy path (pendant)**: generate → Refine This → "make the bail longer" →
   verify the result is visibly the *same design* with the change; console shows
   `[Refine] kontext instruction:` and worker log `mode=kontext`; quote image and
   order thumb update; refine again ("now in rose-tone lighting") → edits chain off
   the previous refined image.
2. **Ring**: generate (3 angles) → refine "thinner band" → gallery collapses to one
   slide, nav arrows/dots hidden; try-on uses the refined image; Start Fresh →
   3-angle gallery returns.
3. **Bracelet**: same as ring via `braceletAngles`.
4. **Fallback**: block `flux-image.sarkd333.workers.dev` in DevTools → refine →
   console `[Refine] falling back to legacy refine path` → legacy re-prompt result
   lands, no stuck spinner (`setGenLoading` released).
5. **Spec-drift nudge**: refine with "make it 5 stones" → note appears, edit still
   sent; refine with "add engraving" → no note.
6. **Worker regression**: with the new worker deployed, run a plain step-2
   generation (txt2img) and a collections image fetch — both must behave exactly as
   before (no `mode` field sent → `gen` path).
7. **Superseded-generation guard**: start a refine, immediately Start Fresh; verify
   the refine result is discarded (`thisGen !== generationId`) and no image flicker.
8. Mobile Safari + Chrome smoke test of the post-gen row layout after copy changes.
