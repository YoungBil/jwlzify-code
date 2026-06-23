/*
 * generate-collection-images.js
 * ------------------------------------------------------------------
 * ONE-TIME generation of the collections.html gallery images.
 *
 * Catalogue: collections-data.js  (5 categories x 18 items = 90).
 * One front-facing image per item -> images/collections/<id>.jpg
 * (e.g. ring-01.jpg ... necklace-18.jpg)
 *
 * PIPELINE: HuggingFace / SDXL Cloudflare Worker ONLY (direct).
 *   We intentionally do NOT call Gemini here — Gemini's worker rate-limits
 *   the 90-image batch. The LIVE AI Lab (ailab.html) still uses Gemini-first;
 *   this batch script is the only place that goes HF-direct.
 *     SDXL worker -> https://hf-image.sarkd333.workers.dev/
 *   (API keys stay inside the Cloudflare worker — never embedded here.)
 *
 * Prompt structure + orientation rules + negative prompts match the AI Lab:
 *   - single item, front-facing rings, closed single-loop bracelets,
 *     product-only earrings/necklaces (no model), white/studio background,
 *     photorealistic, 8k, guidance_scale 9.0, full HF negative prompts.
 *
 * Every output is resized to max 800px wide and re-encoded JPEG quality 80
 * (via Windows System.Drawing) so the page loads fast.
 *
 * Behaviour:
 *   - skips items whose image already exists (re-runs are cheap)
 *   - retries each HF call up to 3 times before giving up
 *   - ~1.5s delay between requests (gentle on Cloudflare Workers AI)
 *   - end-of-run summary: generated / skipped / failed (+ failed ids)
 *
 * Run:  node generate-collection-images.js
 *       node generate-collection-images.js --only ring          (one category)
 *       node generate-collection-images.js --only ring-04       (one item)
 *       node generate-collection-images.js --force              (regenerate all)
 * ------------------------------------------------------------------
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ITEMS      = require('./collections-data.js');
const HF_WORKER  = 'https://hf-image.sarkd333.workers.dev/';
const OUT_DIR    = path.join(__dirname, 'images', 'collections');
const MAX_WIDTH  = 800;
const JPEG_Q     = 80;
const MAX_RETRIES = 3;
const DELAY_MS   = 1500;

// ─────────────────────────────────────────────────────────────────
// Prompt fragments (mirrored from ailab.html)
// ─────────────────────────────────────────────────────────────────
const BASE_TAIL =
  'isolated fine jewelry product photograph, professional diffuse studio lighting, ' +
  'no harsh shadows, hyper realistic, 8K ultra high definition, macro lens, sharp focus, ' +
  'precious metal gleam, gemstone sparkle and brilliance, luxury brand catalog. ' +
  'No humans. No person. No body parts. No hands. No fingers. No skin. No model. ' +
  'Product-only photography. The jewelry piece is the sole subject of the image.';

const GENERIC_NEG =
  'person, human, model, body, face, hands, fingers, neck, skin, text, watermark, logo, ' +
  'blurry, low quality, distorted, deformed, multiple items, two items, collage, grid, ' +
  'contact sheet, duplicate';

const HF_RING_NEGATIVE     = 'tilted, angled, three-quarter view, 3/4 view, perspective, side view, side angle, top-down, birds eye, isometric, diagonal, rotated, lying flat, flat lay, on its side, leaning, oblique, dutch angle, foreshortening, multiple rings, collage, grid, two rings, group of rings, blurry, deformed, asymmetrical';
const HF_BRACELET_NEGATIVE = 'flat lay, laid flat, spread out, scattered, disconnected pieces, broken chain, straight strip, unclasped, open ends, multiple bracelets, two bracelets, collage, grid, tangled, deformed, asymmetrical, lying on surface, top-down, birds eye, side view, coiled, stacked, double band, two bands, stacked bracelets, pair of bracelets, multiple loops, double loop, twin bands, layered bracelets, second bracelet, duplicate';
const HF_NECKLACE_NEGATIVE = 'flat lay, tabletop, top-down view, coiled chain, chain laid flat, jewelry box, angled perspective, asymmetrical drape, cropped chain, multiple necklaces, hands, neck skin, mannequin face, busy background, blurry, deformed, multiple chains, two necklaces, double chain, several chains, duplicate necklace, tangled chains';
const PRODUCT_ONLY_NEG =
  'model, person, human, woman, man, face, head, ear, ears, neck, shoulder, chest, body, ' +
  'skin, hair, mannequin head, bust, portrait, ' + GENERIC_NEG;

const BRACELET_SINGLE_BAND =
  'ONE single bracelet band only. A single continuous loop. One unbroken band. ' +
  'Exactly one bracelet, not two, not a pair, not stacked, not double-banded.';

function frontClause(type) {
  switch (type) {
    case 'ring':
      return 'Single product photograph, single viewpoint. Strict front elevation view, dead-on, ' +
        'eye-level, zero perspective distortion. The ring stands perfectly upright like the letter O ' +
        'viewed straight on, the circular band a full vertical circle facing the camera, the centre ' +
        'stone and setting at the top pointing straight up. Perfectly symmetrical left-to-right, ' +
        'centred with equal margins. NOT a 3/4 angle, NOT tilted, NOT a side view. ' +
        'White or very light grey seamless background.';
    case 'bracelet':
      return 'A single closed-loop bracelet shaped as one continuous oval band, photographed floating ' +
        'upright and facing the camera like a bangle held up to show its circular form. Front-facing ' +
        'eye-level view, the decorative front face at top-centre fully visible, the band curving away at ' +
        'the bottom, perfectly symmetrical left-to-right, centred. ' + BRACELET_SINGLE_BAND +
        ' Pure white seamless background.';
    case 'pendant':
      return 'Close-up macro product photograph of a single pendant charm with a bail connector at the top, ' +
        'pendant centred filling the frame, front-facing, no chain, no cord, the pendant is the only element, ' +
        'pure white seamless background.';
    default:
      return 'Single front-facing product photograph, centred, pure white seamless background.';
  }
}

// Product-only framing for pieces SDXL likes to put on a model (earrings -> ears,
// necklaces/chokers -> neck). SDXL obeys the positive prompt better than negatives,
// so we describe an explicit flat-lay product shot with NO body and NO mannequin.
function productOnlyClause(type) {
  if (type === 'earrings') {
    return 'A matching pair of earrings arranged side by side, lying flat on a seamless pure white surface, ' +
      'photographed straight from above as a top-down flat-lay product shot. Just the two earrings on white, ' +
      'nothing else. Absolutely no model, no person, no ear, no head, no face, no skin. ' +
      'Luxury jewelry catalogue flat-lay photography.';
  }
  // necklace / collar — flat-lay (no bust, no mannequin, no neck)
  return 'The necklace by itself arranged in an elegant symmetrical loop, laid flat on a seamless pure white ' +
    'surface, photographed straight from above as a top-down flat-lay product shot. Just the necklace on white, ' +
    'nothing else. Absolutely no model, no person, no neck, no bust, no mannequin, no head, no skin. ' +
    'Luxury jewelry catalogue flat-lay photography.';
}

// Hard product-only constraints appended to EVERY item (positive + negative).
const NO_BODY_POS = 'isolated jewelry product only, floating on a plain seamless studio background, ' +
  'absolutely no person, no human, no model, no mannequin, no body parts, no ear, no neck, no chest, ' +
  'no face, no hand, no wrist, no skin, product-only catalog shot, nothing being worn';
const NO_BODY_NEG = 'person, human, model, mannequin, face, portrait, ear, neck, chest, shoulder, hand, ' +
  'fingers, wrist, arm, skin, body part, wearing, worn, hair, lips, eyes';

function buildPrompt(item) {
  const type = item.type;
  let orient, neg;
  if (item.productOnly) {
    orient = productOnlyClause(type);
    neg = PRODUCT_ONLY_NEG;
  } else if (type === 'ring') {
    orient = frontClause('ring');     neg = HF_RING_NEGATIVE;
  } else if (type === 'bracelet') {
    orient = frontClause('bracelet'); neg = HF_BRACELET_NEGATIVE;
  } else if (type === 'necklace') {
    orient = frontClause('necklace'); neg = HF_NECKLACE_NEGATIVE;
  } else {
    orient = frontClause(type);       neg = GENERIC_NEG;
  }

  // Hard product-only constraints on EVERY item (no people / body parts).
  neg = neg + ', ' + NO_BODY_NEG;

  const prompt = `Luxury ${item.desc}. ${orient} ${BASE_TAIL}`;
  // SDXL likes keyword-stacked, front-loaded prompts.
  const hfInput = `${item.desc}, front view, straight-on, centered, symmetrical, single item, ` +
    NO_BODY_POS + ', product photography, white background, studio lighting, sharp focus, ' +
    'photorealistic, 8k, highly detailed';

  return {
    inputs: hfInput + ' Avoid: ' + neg,
    negative_prompt: neg,
    guidance_scale: 9.0,
    num_inference_steps: 30,
  };
}

// ─────────────────────────────────────────────────────────────────
// HF/SDXL call — returns raw image Buffer or throws.
// ─────────────────────────────────────────────────────────────────
async function callHF(hfBody) {
  const res = await fetch(HF_WORKER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(hfBody),
  });
  if (!res.ok) throw new Error('HF HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5000) throw new Error('blob too small (' + buf.length + 'b)');
  return buf;
}

// ─────────────────────────────────────────────────────────────────
// Resize/compress helper (Windows System.Drawing via a temp PowerShell script)
// ─────────────────────────────────────────────────────────────────
const PS_RESIZE = path.join(os.tmpdir(), 'jwlz-resize-' + process.pid + '.ps1');
function writeResizeScript() {
  fs.writeFileSync(PS_RESIZE, [
    'param([string]$In,[string]$Out,[int]$Max=800,[int]$Quality=80)',
    'Add-Type -AssemblyName System.Drawing',
    "$codec=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()|Where-Object{$_.MimeType -eq 'image/jpeg'}",
    '$ep=New-Object System.Drawing.Imaging.EncoderParameters(1)',
    '$ep.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality,[long]$Quality)',
    '$img=[System.Drawing.Image]::FromFile($In)',
    '$w=$img.Width;$h=$img.Height',
    '$scale=[Math]::Min(1.0,$Max/[Math]::Max($w,$h))',
    '$nw=[int][Math]::Round($w*$scale);$nh=[int][Math]::Round($h*$scale)',
    '$bmp=New-Object System.Drawing.Bitmap($nw,$nh)',
    '$g=[System.Drawing.Graphics]::FromImage($bmp)',
    '$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
    '$g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::HighQuality',
    '$g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality',
    '$g.DrawImage($img,0,0,$nw,$nh)',
    '$g.Dispose();$img.Dispose()',
    '$bmp.Save($Out,$codec,$ep);$bmp.Dispose()',
  ].join('\n'), 'utf8');
}
function resizeToJpeg(rawBuf, outPath) {
  const tmpRaw = outPath + '.raw';
  fs.writeFileSync(tmpRaw, rawBuf);
  try {
    execFileSync('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_RESIZE,
      '-In', tmpRaw, '-Out', outPath, '-Max', String(MAX_WIDTH), '-Quality', String(JPEG_Q),
    ], { stdio: 'pipe' });
  } finally {
    try { fs.unlinkSync(tmpRaw); } catch (e) {}
  }
}

// ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args  = process.argv.slice(2);
  const force = args.includes('--force');
  const onlyIx = args.indexOf('--only');
  const only  = onlyIx !== -1 ? args[onlyIx + 1] : null;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeResizeScript();

  let items = ITEMS;
  if (only) {
    items = ITEMS.filter((it) => it.id === only || it.category === only);
    if (!items.length) { console.error('Nothing matches --only ' + only); process.exit(1); }
  }

  const total = items.length;
  let generated = 0, skipped = 0, failed = 0;
  const failedIds = [];

  console.log('SDXL-direct generation of ' + total + ' images -> ' + OUT_DIR + '\n');

  let n = 0;
  for (const item of items) {
    n++;
    const outPath = path.join(OUT_DIR, item.id + '.jpg');
    const head = '[gen] ' + item.id + ' (' + n + '/' + total + ')';

    if (!force && fs.existsSync(outPath)) {
      console.log(head + ' ... skipped (already exists)');
      skipped++;
      continue;
    }

    const hfBody = buildPrompt(item);
    let raw = null, lastErr = '';
    for (let attempt = 1; attempt <= MAX_RETRIES && !raw; attempt++) {
      try {
        raw = await callHF(hfBody);
      } catch (e) {
        lastErr = e.message;
        console.log(head + ' ... attempt ' + attempt + '/' + MAX_RETRIES + ' failed (' + lastErr + ')');
        if (attempt < MAX_RETRIES) await sleep(2500);
      }
    }

    if (!raw) {
      console.log(head + ' ... FAILED after ' + MAX_RETRIES + ' attempts (' + lastErr + ')');
      failed++; failedIds.push(item.id);
      await sleep(DELAY_MS);
      continue;
    }

    try {
      resizeToJpeg(raw, outPath);
      const kb = Math.round(fs.statSync(outPath).size / 1024);
      console.log(head + ' ... done (' + MAX_WIDTH + 'px, ' + kb + 'kb)');
      generated++;
    } catch (e) {
      console.log(head + ' ... FAILED at resize (' + e.message + ')');
      failed++; failedIds.push(item.id);
    }

    await sleep(DELAY_MS);
  }

  try { fs.unlinkSync(PS_RESIZE); } catch (e) {}

  console.log('\n──────── Summary ────────');
  console.log('Generated: ' + generated);
  console.log('Skipped (already existed): ' + skipped);
  console.log('Failed: ' + failed);
  if (failedIds.length) console.log('Failed ids: ' + failedIds.join(', '));
  console.log('Output dir: ' + OUT_DIR);
  process.exit(failed && generated === 0 && skipped === 0 ? 1 : 0);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
