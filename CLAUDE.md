# CLAUDE.md — JWLZIFY reference for AI sessions

Last full read-through: 2026-07-04 (commit lineage around `f35eac3`). Line numbers below
are from that snapshot of `ailab.html` (~8,900 lines) — they drift as the file is edited,
so treat them as "search near here", not gospel. Function and element-id names are stable.

## What this is

JWLZIFY (jwlzify.com) is a custom-jewelry web app: the user describes a piece, an AI
image model renders it, they try it on over their webcam, get a live-priced quote, and
place an order (no payment collection — payment happens on a follow-up call). The brand
is pre-launch: **no orders have shipped**. Marketing copy must never claim otherwise
(the homepage was truth-tightened 2026-07-04; other pages still carry old claims — see
Issues).

**Stack: plain HTML/CSS/JS. No build step, no bundler, no framework, no package.json.**
Hosted on GitHub Pages (CNAME → jwlzify.com). Pushing to `master` IS deploying to
production. Tailwind is loaded from CDN at runtime (`cdn.tailwindcss.com`), fonts from
Google Fonts, Firebase from gstatic CDN, Three.js via CDN importmap.

## Hard constraints — never violate

1. **No build step.** Everything must run as static files opened by a browser. Do not
   introduce npm, bundlers, TypeScript, or module resolution beyond native ESM + CDN.
2. **Cloudflare Workers deploy ONLY via the Cloudflare dashboard** (paste code, set
   encrypted secrets there). **Never run Wrangler CLI.** As of 2026-07-05 the repo has
   a source file for EVERY worker, all with origin allowlisting + per-IP rate
   limiting, written to match the contracts the front end actually consumes. Until
   they are paste-deployed, the LIVE workers remain the old, unsecured versions —
   and for `gemini-image` / `groq-enhance` (whose deployed code was never in the
   repo) diff against the dashboard version before pasting (model names / prompts
   may differ).
3. **Git flow:** `git add ...` → `git commit -m "update"` → `git push origin master`.
   Commit message is always `update`. No branches, no PRs.
4. **Metal options are locked to exactly three:** internal codes `925silver`,
   `10ctgold`, `14ctgold`. These codes are load-bearing across pricing, prompts,
   collections-data.js, and Firestore records — never rename the codes. Display text
   uses **karat "k", not "ct"**: "925 Silver", "10k Gold", "14k Gold". (Homepage
   already converted; ailab.html display labels still say "10ct Gold" — a known issue,
   display-only.)
5. **The pricing formula is fixed** (see Pricing below). Do not change rates, tiers, or
   structure without explicit instruction.
6. **GIA certification claims stay** — they are backed. Other unbacked marketing claims
   (Antwerp/Toronto ateliers, blockchain, 3D viewer, fabricated reviews) must not be
   (re)introduced.
7. Generation, specs, pricing, and try-on logic are tightly interlocked through
   `window.jwlSpecifications` "compatibility mirrors" — when touching one type's flow,
   do not regress the others. Scope changes narrowly.

## Repo map

| File | Role |
|---|---|
| `ailab.html` | **The app.** ~8,900 lines: all six steps, generation, try-on, pricing, ordering. Everything below is about this file unless stated. |
| `index.html` | Homepage/marketing. Truth-tightened 2026-07-04 (no fake reviews, no Antwerp/Toronto, no 3D/blockchain claims, gold in "k", © 2026). |
| `collections.html` + `collections-data.js` + `collections-gallery.js` | Static 90-item gallery (5 categories × 18), deterministic catalogue, prices via `pricing.js`, "Customize This Design" hands off to the AI Lab via sessionStorage. |
| `pricing.js` | Shared pricing formula for collections. **Manually mirrors** `calculatePrice()` in ailab.html — must be kept in sync by hand (stated in its header). |
| `firebase-auth.js` | Firebase init (project `jwlzify-193c2`), Google sign-in modal, header auth UI. Exposes `window._jwlApp`, `window._jwlAuth`, `signInWithGoogle()`, `signOut()`. |
| `firestore-service.js` | `window.JWL.saveDesign/saveOrder/getDesigns/getOrders` → `users/{uid}/designs` and `users/{uid}/orders`. |
| `mobile-nav.js` | Self-contained hamburger nav injected on every page. |
| `about/support/shipping/returns/warranty/legal/orders/account/authenticity.html` | Static content pages sharing header/footer markup (copy-pasted per page, no shared component). |
| `*-worker.js` + `*-wrangler.toml` | Cloudflare Worker sources (all 8, refreshed 2026-07-05 with origin+rate-limit security; see constraint #2). Deploy = dashboard paste only. |
| `generate-collection-images.js` | One-time Node batch script that generated the 90 gallery images via the hf-image worker (skips existing; not part of the site). |
| `test-img2img.js` | Ad-hoc Node smoke test for the hf-image worker (txt2img → img2img). Not part of the site. |
| `.env` | Local only, gitignored. Never commit. |

## Core user flow (6 steps, one page)

Step panels are `#s1`…`#s6` + `#sSuccess` (`.sp` divs; `goStep(n)` toggles `.active`,
updates the progress dots, and runs per-step hooks). State lives in module-level
globals — nothing persists across reload except Firebase saves and sessionStorage
handoffs.

1. **DESIGN (`#s1`)** — pick jewelry type (ring / chain / pendant / earrings /
   bracelet; internal key for "Chain" is **`necklace`** everywhere — only `typeLabel()`
   renders the word "Chain"), type a description. Typing ≥8 chars debounce-fires the
   **Groq prompt enhancer** (via worker) into an editable panel with an
   enhanced-vs-original toggle. Selecting `necklace` opens the chain-style modal
   (Cuban/Rope/Box/Cable/Choker presets, or the user's own description wins).
2. **SPECS (`#s2`)** — metal → gem (options depend on metal: silver → moissanite/lab
   diamond; gold → lab/natural diamond), stone shape, aesthetic, then a **per-type spec
   flow** (see below). `confirmAndGenerate()` validates the type's flow, writes
   `window.jwlSpecifications`, and fires generation.
3. **REFINE (`#s3`)** — generated image (ring + bracelet get a 3-angle swipe gallery),
   static "AI Design Analyst" suggestions (canned `SDATA` text, not AI), spec card
   (Anthropic call is disabled — always shows the fallback DESIGN DETAILS card),
   Refine (img2img) / Start Fresh (new txt2img) input, Save Design.
4. **TRY ON (`#s4`)** — webcam try-on (see Try-on pipeline).
5. **QUOTE (`#s5`)** — fetches live metal prices, computes the price, renders the
   breakdown; auto-saves the design for signed-in users (`JWL.saveDesign`).
6. **ORDER (`#s6`)** — shipping form → `submitOrder()` writes to Firestore (if signed
   in), generates `JWLZ-XXXXXX` id from `Date.now()`, shows success. **No payment.**

Cross-page entries: `account.html` → sessionStorage `jwlzify_load_design` (jumps to
step 3 with a saved design); `collections.html` → sessionStorage `jwlz_customize_piece`
(jumps to step 3 with a catalogue piece). Both handlers are `DOMContentLoaded` listeners
near the top of the main script (~line 1765 and ~2556).

### Per-type spec flows (step 2)

The shared weight/stone grid (`#specGrid`) is only used by **no type fully** anymore —
each type overrides parts of it. Visibility is coordinated by `setType()` →
`updatePendantSpecVisibility()` → `updateBraceletSpecVisibility()` (which runs **last**
and is the authoritative writer for the shared sections).

- **Ring** (`#ringCaratFlow`, ~770): total ct → stone count (1–20) → per-stone size
  bucket (Small 0.25–2 / Medium 2.5–3.5 / Large 4–5) + exact carat per stone; the
  Generate button is **gated** until per-stone carats sum exactly to the total
  (`_validateRingAllocation`). Single-stone shortcut skips per-stone UI. Metal grams
  fixed at 4 (`MATERIAL_WEIGHTS.ring`).
- **Earrings** (`#earringFlow`, ~811): Form (stud/hoop/drop, default stud) + Style
  (minimal/classic/statement) + total ct per pair → bucket → mm (4/6/8/10/12). Stone
  count is derived: `EARRING_MM_BASE[mm] × 2`, and the gate requires the resulting
  per-stone ct to land inside the chosen bucket (mm is firm; conflicts show a message,
  never silently adjust). One earring is rendered; try-on mirrors it into a pair.
- **Pendant** (`#pendantSpecWrap`, ~653): stone tier (0.5–3 / 4–7 / 8–11 ct) + exact
  carat, plus mm×mm size (5–80). Metal grams **derived** from volume: density ×
  1.6mm thickness × 0.62 fill (`derivePendantMetalGrams`).
- **Bracelet** (`#braceletSpecWrap`, ~694): link width (2–5mm), length (6.5–8.5"),
  per-stone tier (0.10/0.25/0.50 ct), layout (full / every-other / every-fourth).
  Stone **count is deterministic math** (`calcBraceletStoneCount`: stone diameter
  interpolated from carat, spacing ×1.15, layout divisor) — the image is never counted.
  Metal grams derived from width × length × density.
- **Necklace/Chain**: chain style (modal), length (16–24" or custom 12–36), stone
  placement (stations/full/none), single per-stone ct 0.25–5 applied to every stone.
  Weight and count are **auto-derived** from length + placement
  (`_applyNecklaceAutoSpecs`), never user-picked.

### State management

Three overlapping stores, all module-level in the main `<script>`:

- **`LAB`** (~1951): `{ step, type, material, gem, style, prompt, imageUrl, quote,
  spec, cameraStream }` + `ringAngles` / `braceletAngles` arrays. The working state.
- **`userSelections`** (~1965): only what the user explicitly clicked (never defaulted);
  used to distinguish user intent from page defaults.
- **`window.jwlSpecifications`** (~5573): the numbers every downstream consumer reads
  (prompt building, cost estimate, pricing). Type flows write both their rich fields
  (e.g. `stones: [{sizeBucket, carat}]` for rings) **and "compatibility mirrors"**
  (`totalCarats`, `stoneCount`, numeric `stones`, `metalGrams`, `weightLabel`) that the
  untouched shared code reads. Removing a mirror breaks pricing or prompts silently.

`_readSpecsFromDOM()` (~4370) re-reads specs at generate-click time; necklace, ring,
and earrings have guards that return the stored authoritative specs instead of reading
the (hidden) shared grid. Bracelet does **not** have such a guard (Issues #10).

## External integrations

All AI/API keys live inside Cloudflare Workers (`*.sarkd333.workers.dev`); the front
end POSTs JSON with no auth. All repo worker sources (2026-07-05) enforce an origin
allowlist (`jwlzify.com`, `www.`, `localhost`/`127.0.0.1` any port — local dev must be
served over http, not `file://`) and best-effort per-IP in-memory rate limits
(15/min image gen + verify, 10/min matting, 20/min enhance, 30/min prices). The Node
batch script `generate-collection-images.js` must send an `Origin:
https://jwlzify.com` header if ever re-run. Endpoints as they appear in the code:

| Endpoint | Role | Contract (front-end view) |
|---|---|---|
| `https://gemini-image.sarkd333.workers.dev/` | **Primary** image generation (Gemini) | POST `{prompt, negativePrompt}` → JSON `{imageData: base64, mimeType}` or `{error}` / `rate_limited`. Source: `gemini-image-worker.js` (written 2026-07-05 from the observed contract — **diff against dashboard before pasting**; `GEMINI_API_KEY` secret, `GEMINI_MODEL` var). |
| `https://flux-image.sarkd333.workers.dev` (`FLUX_WORKER_URL`) | **Secondary** txt2img + img2img refine via fal.ai `flux-2-pro` / `flux-2-pro/edit` | POST `{prompt, image_size, initImage?}` → raw image bytes. Source: `flux-image-worker.js` (`FAL_KEY` secret). |
| `https://hf-image.sarkd333.workers.dev/` | **Tertiary** fallback. Despite the "hf" name it runs **Cloudflare Workers AI** SDXL (`@cf/stabilityai/stable-diffusion-xl-lightning`; img2img variant at strength 0.45) | POST `{inputs, negative_prompt, guidance_scale, num_inference_steps, initImage?}` → raw PNG. Front end crops the bottom 40px off HF results (watermark strip). Needs an `AI` Workers-AI binding. |
| `https://fal-bg-remove.sarkd333.workers.dev` (`FAL_BG_REMOVE_URL`) | Background removal via fal `birefnet` (fallback `rembg`) | POST `{image_url: dataURL}` → **JSON `{image:{url}, model}`** (front end fetches that PNG from the fal CDN). Source: `bg-remove-worker.js` (aligned to this contract 2026-07-05; `FAL_KEY` secret). |
| `https://vision-verify.sarkd333.workers.dev` (`VERIFY_WORKER_URL`) | Generation verification (Groq Llama-4-Scout vision) | POST `{image: dataURL, expected?}` → `{jewelryType, form, stoneCount}`. Source: `vision-verify-worker.js` (`GROQ_API_KEY` secret). Front end fails open if undeployed/down. |
| `https://groq-enhance.sarkd333.workers.dev` (`ENHANCE_WORKER_URL`) | Prompt enhancement (Groq) | POST `{idea, jewelryType, earringStyle?, earringStyleDescriptor?}` → `{enhanced}`. Source: `groq-enhance-worker.js` (written 2026-07-05 — **diff against dashboard before pasting**; `GROQ_API_KEY` secret). Failure falls back silently to the raw idea. |
| `https://gold-price.sarkd333.workers.dev`, `https://silver-price.sarkd333.workers.dev` | Live metal spot prices (metals.dev proxies) | GET → `{price}` = pure metal **USD/gram** (front end applies purity factors). Sources updated 2026-07-05: `METALS_API_KEY` secret, `currency=USD&unit=g` (old copies requested CAD with a placeholder key). |
| `https://api.anthropic.com/v1/messages` | AI spec card (`fetchSpecCard`, model `claude-sonnet-4-20250514`) | **Effectively disabled**: `CLAUDE_API_KEY = ''` → always renders the static fallback card. Browser-direct; if ever enabled it must move behind a worker. |
| Firebase (`jwlzify-193c2`) | Google auth + Firestore | Designs/orders under `users/{uid}/...` (three different save paths — Issues #11). Web config in `firebase-auth.js` is public by design. |

## Generation pipeline

Two entry points that largely duplicate each other (Issues #6):
`confirmAndGenerate()` (step-2 button, ~4714) and `startGeneration(isTweak)`
(refine/regenerate, ~4468). Both funnel into the same machinery:

1. **Prompt assembly** — `buildPrompt(type, material, gem, style, desc)` (~3903)
   dispatches to fully type-specific prompt builders (pendant / necklace / earrings /
   bracelet / ring each have bespoke, heavily-negotiated prompt text). Rules:
   - **Spec selectors are the single source of truth.** Typed/Groq text is style
     flavor only: `stripStoneQuantities()` removes typed stone counts,
     `_stripShapeWords()` (ring) removes typed cuts, `_stripEarringConflicts()`
     (earrings) removes count/form/size words.
   - `_authoritativeStoneClause()` appends "EXACTLY N stones" for ring/pendant/earrings
     (necklace and bracelet counts are emergent by design).
   - Carat → visual-size language via `_caratSizeDescriptor` (small / medium / large
     prominent / very large statement) so carat changes actually change rendered size.
2. **Single choke point** — `_generateImage(prompt, negativePrompt, initImage,
   hfOverrides)` (~2106) wraps every prompt with `_buildPromptSafeguards()` (spec
   bookends restated at start AND end, natural-placement clause, quality string,
   placement negatives; `guidance_scale` pinned 9.0), then tries **Gemini → Flux →
   HF/SDXL** in order, returning a blob URL or null.
3. **Multi-angle for ring and bracelet** — `_generateRingMultiAngle` /
   `_generateBraceletMultiAngle` generate 3 angles concurrently (queue caps at
   `GEN_MAX_CONCURRENT = 2`). **Index 0 is always the head-on view and is what try-on
   uses**; it is retried specifically (ring: up to 3 attempts) before falling back to
   another angle. Ring prompts additionally carry aggressive exact-stone-count clauses
   (`_ringExactCountClause`/`Reminder` + `_RING_EXTRA_STONES_NEG`) and head-on framing
   bracketing (`_RING_HEADON_PROMPT` at both ends). Bracelet prompts lead and trail
   with layout language (`_braceletLayoutPositive/Reminder/Negative`).
4. **Refine (img2img)** — post-gen UI sets `window._postGenMode`; "Refine This" passes
   `lastGeneratedImage` (base64 of the last render) as `initImage` → Flux edit
   endpoint (or SDXL img2img at the HF fallback). "Start Fresh" is a new txt2img.
5. **Vision verification** (2026-07-05, search `VISION-VERIFIED GENERATION` ~after
   `_generateImage`): `_generateVerified()` wraps generation for exact-count types —
   ring (head-on angle only; hero/profile skip count checks since stones occlude at
   angle), earrings (per-earring count — one earring is rendered), pendant (1 stone).
   Each attempt is downscaled to a 512px JPEG and POSTed to the **vision-verify
   worker** (`https://vision-verify.sarkd333.workers.dev`, source
   `vision-verify-worker.js`, Groq Llama-4-Scout vision, `GROQ_API_KEY` secret) which
   returns `{jewelryType, form, stoneCount}` — the expectation is never shown to the
   model. Mismatch → regenerate (≤3 attempts total) → serve the lowest-score closest
   match, no user-facing error. **Fails open**: any worker failure accepts the image
   unverified, so verification can never block generation. Kill switch:
   `VERIFY_GEN_ENABLED`. Necklace/bracelet are never count-verified (coverage-priced).
6. **Exact counts are only promised for 1–7 stones** (ring flow max is 7; earrings max
   4/ear by mm). Bracelet and necklace-full layouts are SOLD by total carat coverage —
   UI copy and the quote present coverage ct, not counts (internal count math still
   feeds pricing, unchanged); necklace stations display as approximate (`≈N`).
7. Generation results set `LAB.imageUrl`, clear `bgRemovalCache`, update refine/quote/
   order images, then `showRefineStep()` + `showPostGenUI()`. `generationId` is a
   token that discards superseded results.

## Try-on pipeline (step 4)

`setupTryOn()` (~6389) starts the mirrored webcam (`getUserMedia`, `#tryon-video` with
CSS `scaleX(-1)`) and dispatches per type. **This is 2D compositing** — but as of
2026-07-05 earrings, rings, and bracelets get **MediaPipe landmark tracking** layered
on top (see below); pendant/necklace remain fully manual. A shared disclaimer element
(`.tryon-disclaimer`) states the preview is visualization-only.

**MediaPipe landmark tracking** (module after `_ringTeardownEvents`, search
`MEDIAPIPE LANDMARK TRACKING`): `@mediapipe/tasks-vision@0.10.35` is loaded lazily
via native dynamic `import()` from jsDelivr (verified ESM — note 0.10.22 has no bundle
on jsDelivr, don't downgrade), wasm from the same CDN path, `.task` models from
Google's storage bucket. `initTryOn(cfg)` starts a tracking loop when `cfg.mpMode` is
set (`'face'` for earrings, `'hand'` for ring/bracelet); the loop (`_mpStartTracking`)
runs `detectForVideo` on a setTimeout pace with adaptive throttle (~15 Hz target,
backs off to 4 Hz on slow devices) and only writes smoothed anchors (`_mpAnchors`) —
the existing render loop remains the single painter and consumes anchors when fresh
(`_mpEarAnchors()`/`_mpHandAnchors()`, stale after 1.2 s without detection).
- Earrings: earlobe anchors derived from face landmarks 234/454 (tragus) biased 55%
  toward 132/361 (jaw); size auto-scales to face width (`MP_EAR_SIZE` per form); the
  shared Size slider/± becomes a multiplier (slider at its default = 1.0×) so there is
  still ONE size state. Drag while tracking writes per-ear offsets (`_mpOffL/R`)
  instead of absolute positions. Occlusion is unchanged (baked into
  `_ringMaskedCanvas`).
- Ring: anchors to the ring finger's base–middle segment (hand landmarks 13→14),
  sized to estimated finger width (palm width × 0.24 × `MP_RING_SIZE_FACTOR`),
  rotated with the finger; the Rotate slider becomes a fine-tune offset.
- Bracelet: anchors to the wrist crease (landmark 0, nudged toward the forearm),
  sized to palm width × `MP_BRACELET_SIZE_FACTOR`, rotated with the hand direction
  (0° = hand pointing up, matching the horizontal-oval renders); hide-top occlusion
  rotates with the piece. The wrist-guide overlay remains the manual-mode aid and is
  hidden on first hand detection or first drag.
- Degradation: any CDN/wasm/model failure sets `_mpFailed` and the try-on stays in
  the manual mode, byte-for-byte the old behaviour; tracking loss degrades in place
  (manual mirrors `ringX/ringY/_earL/_earR` are synced each tracked frame).
  Hit-testing always uses the actually-drawn positions (`_earDrawL/R`, `_pieceDraw`).

**Canvas engine** (ring, bracelet, necklace, earrings) — `initTryOn(cfg)` (~7822):
- One `#ring-tryon-canvas` backed at devicePixelRatio. `_ringRenderLoop` draws each
  frame: (1) mirrored video, (2) the jewelry from `_ringMaskedCanvas`, (3) optional
  `latestCutoutImage` layer, (4) a drag-handle dot (suppressed for earrings).
- **Occlusion masking** — `_buildRingMask()` (~7459) normalizes the jewelry into a
  square offscreen canvas and erases a region with
  `globalCompositeOperation = 'destination-out'` so the webcam shows through:
  - `hide-bottom` (ring): hard cut below `dy + dh × 0.58` (`_RING_TOP_VISIBLE`) — the
    finger appears to hide the lower band. Automatic, no slider.
  - `hide-top` (bracelet): feathered gradient erase of the top arc; the Row-3 "Fit on
    wrist" slider adjusts `ringFadeStart` (0.20–0.50) and rebuilds the mask.
  - `earlobe` (earrings): feathered erase of the top arc so the lobe reads as threaded
    through; hoops use a deeper tuck (12%→32%) than stud/drop (6%→26%).
  - `none` (necklace): no mask.
- **Cutout chain** — `jewelryCutout()` (~7301): fal birefnet worker → direct remove.bg
  → local canvas BFS flood-fill remover (`removePendantBackgroundCanvas`, edge-seeded,
  gradient-cluster-aware, with sharp-edge and sparkle-stone protection) → original at
  0.85 alpha. Results cached in `bgRemovalCache` (session Map) and **preloaded at the
  refine step** for ring/bracelet/necklace so try-on opens instantly. The original
  image is always drawn first (phase 1) and swapped when the transparent version lands.
- **Controls** (`#ring-tryon-controls`): Rotate slider (hidden for hoops), Size +/−
  buttons, Row-3 slider (occlusion "Fit" for bracelet; **repurposed as the SIZE slider
  for earrings**, sharing one `ringSize` state with the +/− via `_tryOnStepSize`/
  `_syncSizeSlider`), Save Photo (`saveRingTryOnPhoto` = canvas snapshot).
- **Earrings**: one masked image drawn twice (right mirrored). Stud/drop: a shared
  center ± `W×0.20` — dragging moves the pair. **Hoop** (2026-07-03): independent
  per-earring positions `_earL`/`_earR`, per-hoop hit-testing/drag, no Rotate row,
  min size 16 css px (others 30), `cfg.isHoop`/`cfg.hideRotate` from
  `loadEarringsForTryOn` which reads the earring Form.
- Per-type configs: ring 120px default (60–300), bracelet 200 (100–360) + wrist-guide
  overlay, necklace 300 (180–460), earrings 52 (16-or-30–90).

**Pendant** (separate DOM path): chain-choice overlay first ("I'm wearing a chain" vs
"Add a chain for me"), then `drawNecklace()` renders pendant (+ optional neutral
U-curve chain whose lowest point lands exactly on the auto-detected bail — top-center
of the content bounding box from `_pendantContentBox`) into the `#tryon-necklace`
canvas, draggable with a grey dot resize handle. Default size maps mm spec × 8 px/mm.
Save via `saveTryOnPhotoGeneric()` (composites video + visible overlays).

`teardownTryOn()` stops the camera, cancels the RAF loop, hides/resets everything;
called on step change and `pagehide`.

## Pricing

`calculatePrice(metalType, stoneType, jewelryType, userCarats)` (~5802) — the formula
(mirrored in `pricing.js` for collections):

```
metalCost  = grams × spot USD/g          (silver ×0.925; gold ×0.417 (10k) / ×0.583 (14k))
stoneCost  = totalCarats × rate           (moissanite $2/ct, lab diamond $80/ct, natural $2/ct)
base       = metalCost + stoneCost
labour     = 20% of base
profit     = 100% of base   — except 150% (925silver+moissanite), 70% (gold+natural)
final      = base + labour + profit       (USD)
```

Spot prices come from the gold/silver workers at quote time (`fetchSpotPrices`), with
hardcoded USD/g fallbacks (silver 0.97, 10k 44.24, 14k 61.86); refreshed hourly and on
tab-refocus after 15 min. Metal grams and carats come from `jwlSpecifications`
(derived per type — see spec flows). `MATERIAL_WEIGHTS` provides per-type default
grams/carats only when specs are absent.

The quote step renders an **itemized spec sheet** (`displayPricing` → `#priceRows` +
`_quoteStoneLine`): Metal (type · grams, $metalCost), Stones (count × ct × type for
exact types; coverage ct for bracelet/necklace-full; ≈stations for necklace stations,
$stoneCost), and "Labour & craftsmanship" (= labourCost + profitCost, so the three
lines sum exactly to the total — the margin is folded into that line by design, a
deliberate judgment call). A contract line states the piece is crafted to these
specifications and the image is an artist's visualization — the spec sheet, not the
image, defines the order.

## Known gotchas & model limits (not bugs)

- **The image model cannot reliably count stones or honor exact sizes.** Enormous
  prompt effort (exact-count clauses, bookends, negatives) improves adherence but does
  not guarantee it. Pricing is therefore driven by spec math, never by the image
  (bracelet count is deterministic math; pendant shows a size-mismatch note when the
  rendered aspect ratio deviates >20% from the selected mm×mm).
- **Try-on placement is a 2D approximation** — landmark tracking (earrings/ring/
  bracelet) anchors the overlay but occlusion is still a baked mask, not scene
  understanding. Earlobe/finger anchor constants (`MP_EAR_SIZE`, `MP_EAR_DROP`,
  `MP_RING_SIZE_FACTOR`, `MP_BRACELET_SIZE_FACTOR`) are heuristics — tune, don't
  derive.
- Gemini worker rate-limits (HTTP 429 / `rate_limited` JSON) are expected under load —
  that's what the Flux → SDXL chain is for. The 90-image collections batch script
  deliberately skips Gemini entirely.
- The step-1 "Next: Specifications" flow means generation actually starts from step 2;
  `resolveJewelryType()` lets an unambiguous typed description override the selected
  type chip at generation time.
- HF/SDXL results get their bottom 40px cropped (Workers-AI watermark strip).
- Blob URLs are used everywhere; `?cb=` cache-busters must never be appended to
  `blob:`/`data:` URLs (existing code guards this — keep the guard).
- `console.log` diagnostics are pervasive and load-bearing for debugging in the field —
  match the existing `[Tag]` style when adding code.

## Issues / tech debt observed (flag-only map for a future cleanup pass)

Nothing below has been fixed; locations are approximate (post-2026-07-04 snapshot).

**Truth/brand inconsistencies**
1. `ailab.html` footer still carries claims removed from the homepage: "Blockchain
   Trust" (~1712), "© 2025" (~1743), "Crafted with Precision in Toronto & Antwerp"
   (~1744), and the order-success timeline says "Master jeweler crafts your piece in
   Antwerp" (~1663). The other 10 static pages (about, support, shipping, etc.) share
   the same old footer and likely the same claims — only `index.html` was cleaned.
2. Karat notation: ailab UI labels still read "10ct Gold"/"14ct Gold" (spec buttons
   ~629–630; `MATERIAL_LABEL` ~1878). Internal codes `10ctgold`/`14ctgold` are
   load-bearing and must NOT change; only display strings should ever be converted.

**Secrets — client code cleaned 2026-07-05, KEY ROTATION STILL REQUIRED**
3. The hardcoded remove.bg key paths (`removeBgWithApi`, `REMOVE_BG_API_KEY`,
   `USE_REMOVEBG_FALLBACK`) were removed from `ailab.html` (cutout chain is now fal
   worker → canvas remover → original), and `ar-tryon.js` (dead file with a hardcoded
   **fal.ai key**) was deleted. BOTH keys remain in the **git history** of a public
   repo — rotate them manually on the remove.bg and fal.ai dashboards. If the
   deployed price workers hardcode a real metals.dev key, rotate that too when
   deploying the new secret-based versions.

**Dead code (large, safe-to-delete candidates — verify before removing)**
4. Ring 3D try-on: modal `#ringTryOnModal` + entire Three.js script (near end of
   ailab.html) — `startRing3DTryOn()` immediately throws `'3D pipeline disabled'`,
   and nothing calls it. `RING_3D_CONFIG` exists only for this. `fal-ring-3d-worker.js`
   is its proxy. (`ar-tryon.js` and the `teardownARPipeline` call were deleted
   2026-07-05.)
5. Old DOM-overlay try-on remnants in ailab.html:
   - `makeEarringDraggable`, `cropToSingleEarring`, `updateEarringHandles`
     (~8161–8276) — never called; `#tryon-earring-left/right` elements are always
     hidden (still touched by `saveTryOnPhotoGeneric`, harmlessly).
   - Ring DOM drag block (~8097–8157) and bracelet DOM drag block (~8385–8455)
     reference `#tryon-ring-img` / `#tryon-bracelet-img` — **elements that don't exist
     anywhere in the HTML**; the handlers permanently no-op.
   - Orphaned CSS for `#jewelryUnit`, `#chainCanvas`, `#jewelryImg`,
     `#necklaceOverlay`, `#ringOverlay`, `#earringLeft/Right`, `#braceletOverlay`
     (~174–206) and `#arLoading` (~249) — no matching elements.
   - Alpha post-processing helpers `sweepAlphaThreshold`, `cleanupComponents`,
     `decontaminateWhiteEdges`, `featherAlpha`, `computeBailNormX`,
     `padToStandardCanvas`, `validateCutout` (~4136–4332) — never called (old pendant
     pipeline).
   - `_fetchImageUrl`/`_fetchWithRetry` (~1991–2013) — never called (Pollinations era).
   - `_birefnetCache` (~1970) declared, never used. `captureAndRemoveBg` (~7548) is a
     documented no-op. `updateGemOptions()` (~1905) reads `#materialSelect`/
     `#gemSelect` which don't exist. `_RING_FADE_END` (~7447) marked legacy, unused.
6. Referenced-but-missing elements that make error paths silent: `#s1GenError`,
   `#genBusyHint`, `#previewPlaceholder` are `getElementById`'d with null guards but
   exist nowhere in the HTML — several step-1 failure messages can never display.

**Worker repo copies vs. deployed reality — repo side fixed 2026-07-05**
7. All 8 workers now have repo sources matching the front-end contracts, with origin
   allowlisting + per-IP rate limiting. REMAINING GAP: the **deployed** workers stay
   the old, unsecured versions until each is paste-deployed from the repo copy;
   `gemini-image`/`groq-enhance` sources were reconstructed from the observed
   contract — diff against the dashboard code (model name, prompt) before replacing.
   Price workers need the `METALS_API_KEY` secret set on deploy; `vision-verify` is a
   NEW worker that must be created (front end fails open until it exists).

**Duplication / drift risks**
8. `confirmAndGenerate()` and `startGeneration()` duplicate ~80 lines of negative-
   prompt and `hfOverrides` construction nearly verbatim (incl. two `_TYPE_SYNONYMS`
   maps, ~4526 and ~4784). Any prompt fix must be applied in both.
9. `pricing.js` intentionally mirrors `calculatePrice()`/`fetchSpotPrices()` — manual
   sync required (its header says so). Same for the three footer copies across pages.
10. `_readSpecsFromDOM()` has authoritative-spec guards for necklace/ring/earrings but
    **not bracelet** — a bracelet regenerate can transiently clobber
    `jwlSpecifications` with the hidden grid's defaults (self-heals at quote time via
    `_applyBraceletSpecs`, and bracelet prompt counts are emergent, so impact is low).
11. Three separate design-save paths writing **two different Firestore collections**:
    the quote-step auto-save (`JWL.saveDesign` → `users/{uid}/designs`) vs. the Save
    Design modal and the step-3 inline panel (both → `users/{uid}/savedDesigns`).
    `account.html` loads from the sessionStorage handoff; whether anything ever reads
    `users/{uid}/designs` is unverified — possible orphan data.

**Misleading bits**
12. `_HF_BRACELET_NEGATIVE` (~2036) is what gets **logged** as the bracelet negative,
    but the negative actually sent is `_HF_BRACELET_WRAP_NEG` — logs lie here.
13. `STONE_RATES` has no `real_diamond_vsvvs` key (the gem code the gold options
    actually use) — it silently falls to the default $2.00/ct, which happens to equal
    `natural_diamond`, so behavior is currently correct but fragile. Also note natural
    diamond at $2/ct vs lab at $80/ct reads commercially inverted — presumably an
    intentional placeholder, but worth confirming before touching pricing.
14. `[Ring TryOn] using head-on index 0` logs even when index 0 fell back to another
    angle. The `hf-image` worker name suggests HuggingFace but runs Cloudflare
    Workers AI. The "AI Design Analyst" suggestions are canned strings, not AI.
15. `fetchSpecCard()` targets model `claude-sonnet-4-20250514` browser-direct with
    `anthropic-dangerous-direct-browser-access` — dormant (empty key), but if revived
    it must go through a worker, and the model id is outdated.
