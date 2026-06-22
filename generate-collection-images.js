/*
 * generate-collection-images.js
 * ------------------------------------------------------------------
 * ONE-TIME generation of the collections.html gallery images.
 *
 * For every gallery item we generate 3 viewpoints (front / profile / detail)
 * so the existing 3-slide carousel on each card has real content.
 *
 * Prompt structure + orientation rules + negative prompts are mirrored from
 * ailab.html so the look matches the live AI Lab:
 *   - single item, single viewpoint, white/neutral background
 *   - front-facing for rings, closed-loop bangle for bracelets,
 *     U-shape draped chain for necklaces, single earring, macro pendant
 *   - studio lighting, photorealistic, 8K, plus per-type negative prompts
 *
 * Pipeline (same workers as the live site — API keys stay in Cloudflare):
 *   PRIMARY : Gemini  -> https://gemini-image.sarkd333.workers.dev/
 *   FALLBACK: SDXL/HF -> https://hf-image.sarkd333.workers.dev/
 *
 * Output: images/collections/<id>-1.jpg, <id>-2.jpg, <id>-3.jpg
 *
 * Run once:  node generate-collection-images.js
 *            node generate-collection-images.js --only glacial-solitaire   (single item)
 *            node generate-collection-images.js --force                    (overwrite existing)
 * ------------------------------------------------------------------
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const GEMINI_WORKER = 'https://gemini-image.sarkd333.workers.dev/';
const HF_WORKER     = 'https://hf-image.sarkd333.workers.dev/';
const OUT_DIR       = path.join(__dirname, 'images', 'collections');

// ─────────────────────────────────────────────────────────────────
// Shared prompt fragments (mirrored from ailab.html)
// ─────────────────────────────────────────────────────────────────
const BASE_TAIL =
  'isolated fine jewelry product photograph, professional diffuse studio lighting, ' +
  'no harsh shadows, hyper realistic, 8K ultra high definition, macro lens, sharp focus, ' +
  'precious metal gleam, gemstone sparkle and brilliance, luxury brand catalog. ' +
  'No humans. No person. No body parts. No hands. No fingers. No skin. No model. ' +
  'Product-only photography. The jewelry piece is the sole subject of the image.';

// Generic negative used for non-front (profile/detail) angles — does NOT fight the
// requested camera angle the way the strict front-only negatives would.
const GENERIC_NEG =
  'person, human, model, body, face, hands, fingers, neck, skin, text, watermark, logo, ' +
  'blurry, low quality, distorted, deformed, multiple items, two items, collage, grid, ' +
  'contact sheet, duplicate';

// Strict per-type negatives (front view only) — copied from ailab.html.
const HF_RING_NEGATIVE     = 'tilted, angled, three-quarter view, 3/4 view, perspective, side view, side angle, top-down, birds eye, isometric, diagonal, rotated, lying flat, flat lay, on its side, leaning, oblique, dutch angle, foreshortening, multiple rings, collage, grid, two rings, group of rings, blurry, deformed, asymmetrical';
const HF_BRACELET_NEGATIVE = 'flat lay, laid flat, spread out, scattered, disconnected pieces, broken chain, straight strip, unclasped, open ends, multiple bracelets, two bracelets, collage, grid, tangled, deformed, asymmetrical, lying on surface, top-down, birds eye, side view, coiled, stacked, double band, two bands, stacked bracelets, pair of bracelets, multiple loops, double loop, twin bands, layered bracelets, second bracelet, duplicate';
const HF_NECKLACE_NEGATIVE = 'flat lay, tabletop, top-down view, coiled chain, chain laid flat, jewelry box, angled perspective, asymmetrical drape, cropped chain, multiple necklaces, hands, neck skin, mannequin face, busy background, blurry, deformed, multiple chains, two necklaces, double chain, several chains, duplicate necklace, tangled chains';

const BRACELET_SINGLE_BAND =
  'ONE single bracelet band only. A single continuous loop. One unbroken band. ' +
  'Exactly one bracelet, not two, not a pair, not stacked, not double-banded.';

// ─────────────────────────────────────────────────────────────────
// Per-type FRONT-view orientation clauses (mirrored from ailab.html)
// ─────────────────────────────────────────────────────────────────
function frontClause(type, allowPendant) {
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
    case 'necklace':
      return 'Necklace displayed as if worn on an invisible ghost mannequin neck form, front-facing view ' +
        'photographed straight on, the chain forming a clean symmetrical U-shape draped evenly down both ' +
        'sides, isolated single necklace with the full chain visible from end to end, ' +
        (allowPendant
          ? 'with a single decorative pendant centred at the bottom of the chain, '
          : 'a single continuous chain only, no pendant, no charm, ') +
        'vertical portrait orientation, plain seamless light grey background.';
    case 'earrings':
      return 'ONE single earring only, a single individual earring, NOT a pair, only one earring in frame, ' +
        'centred single earring, isolated single piece, front-facing view, pure white seamless background.';
    case 'pendant':
      return 'Close-up macro product photograph of a single pendant charm with a bail connector at the top, ' +
        'pendant centred filling the frame, front-facing, no chain, no cord, the pendant is the only element, ' +
        'pure white seamless background.';
    default:
      return 'Single front-facing product photograph, centred, pure white seamless background.';
  }
}

const PROFILE_CLAUSE =
  'Photographed from a three-quarter 45-degree angle showing the side profile and the depth of the piece, ' +
  'dynamic but elegant perspective, single item centred, neutral seamless studio background.';

const DETAIL_CLAUSE =
  'Extreme macro close-up detail shot filling the frame, focusing on the gemstone setting, prongs, pavé ' +
  'and metal texture, shallow depth of field with creamy bokeh, single item, neutral seamless background.';

// ─────────────────────────────────────────────────────────────────
// Prompt builder — returns { prompt, negative, hf:{inputs,negative_prompt,guidance_scale,num_inference_steps} }
// ─────────────────────────────────────────────────────────────────
// Strong product-only framing for pieces SDXL likes to put on a model
// (earrings -> ears, chokers/collars -> neck). SDXL obeys the positive
// prompt far better than negatives, so we describe a stand/flat-lay shot.
const PRODUCT_ONLY_NEG =
  'model, person, human, woman, man, face, head, ear, ears, neck, shoulder, chest, body, ' +
  'skin, hair, mannequin head, bust, portrait, ' + GENERIC_NEG;
function productOnlyClause(type) {
  if (type === 'earrings') {
    return 'A matching pair of earrings arranged side by side, lying flat on a seamless pure white surface, ' +
      'photographed straight from above as a top-down flat-lay product shot. Just the two earrings on white, ' +
      'nothing else. Absolutely no model, no person, no ear, no head, no face, no skin. ' +
      'Luxury jewelry catalogue flat-lay photography.';
  }
  // necklace / collar
  return 'The necklace shown by itself as an isolated product, draped over a plain white jewelry bust ' +
    'display form with no head and no face, arranged in a clean symmetrical shape on a seamless white ' +
    'surface. No model, no person, no neck, no skin, no head. Catalogue product photography, pure white background.';
}

function buildPrompt(item, viewpoint) {
  const { type, desc, allowPendant } = item;
  const head = `Luxury ${desc}.`;

  let orient, neg, hfNeg;
  if (viewpoint === 'front') {
    orient = item.productOnly ? productOnlyClause(type) : frontClause(type, allowPendant);
    if (item.productOnly)         { neg = PRODUCT_ONLY_NEG;     hfNeg = PRODUCT_ONLY_NEG; }
    else if (type === 'ring')     { neg = HF_RING_NEGATIVE;     hfNeg = HF_RING_NEGATIVE; }
    else if (type === 'bracelet') { neg = HF_BRACELET_NEGATIVE; hfNeg = HF_BRACELET_NEGATIVE; }
    else if (type === 'necklace') { neg = HF_NECKLACE_NEGATIVE; hfNeg = HF_NECKLACE_NEGATIVE; }
    else                          { neg = GENERIC_NEG;          hfNeg = GENERIC_NEG; }
  } else if (viewpoint === 'profile') {
    orient = item.productOnly ? productOnlyClause(type) : PROFILE_CLAUSE;
    neg = hfNeg = item.productOnly ? PRODUCT_ONLY_NEG : GENERIC_NEG;
  } else {
    orient = DETAIL_CLAUSE;
    neg = hfNeg = item.productOnly ? PRODUCT_ONLY_NEG : GENERIC_NEG;
  }

  const prompt = `${head} ${orient} ${BASE_TAIL}`;

  // HF / SDXL likes keyword-stacked, front-loaded prompts.
  const hfInput = `${desc}, ${viewpoint === 'front' ? 'front view, straight-on, centered, symmetrical' :
                    viewpoint === 'profile' ? 'three-quarter 45 degree angle, side profile, depth' :
                    'extreme macro close-up, detail shot, shallow depth of field'}, ` +
    'single item, product photography, white background, studio lighting, sharp focus, photorealistic, 8k, highly detailed';

  return {
    prompt,
    negative: neg,
    hf: {
      inputs: hfInput,
      negative_prompt: hfNeg,
      guidance_scale: 9.0,
      num_inference_steps: 30,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Generation pipeline — Gemini primary, HF fallback (mirrors ailab _generateImage)
// Returns a Buffer of image bytes, or null.
// ─────────────────────────────────────────────────────────────────
async function generateImage(built) {
  // PRIMARY: Gemini worker
  try {
    const res = await fetch(GEMINI_WORKER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: built.prompt + (built.negative ? ' Avoid: ' + built.negative : ''),
        negativePrompt: built.negative || '',
      }),
    });
    if (res.status === 429) throw new Error('rate_limited (HTTP 429)');
    if (!res.ok) throw new Error('Gemini worker HTTP ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error('Gemini: ' + data.error);
    if (!data.imageData) throw new Error('Gemini: no imageData');
    const buf = Buffer.from(data.imageData, 'base64');
    if (buf.length < 2000) throw new Error('Gemini: tiny buffer (' + buf.length + 'b)');
    return { buf, method: 'gemini', mime: data.mimeType || 'image/png' };
  } catch (e) {
    console.log('      Gemini failed -> ' + e.message + '; trying HF fallback...');
  }

  // FALLBACK: HuggingFace / SDXL worker (returns raw image bytes)
  try {
    const res = await fetch(HF_WORKER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(built.hf),
    });
    if (!res.ok) throw new Error('HF worker HTTP ' + res.status);
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.length < 5000) throw new Error('HF: blob too small (' + buf.length + 'b)');
    return { buf, method: 'huggingface', mime: 'image/png' };
  } catch (e) {
    console.log('      HF fallback failed -> ' + e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Gallery items — mirror the 12 cards in collections.html (order preserved).
// `desc` folds in style + material + gemstone so the image matches the name.
// ─────────────────────────────────────────────────────────────────
const ITEMS = [
  { id: 'glacial-solitaire', type: 'ring', name: 'The Glacial Solitaire',
    desc: 'icy modern solitaire engagement ring, a single brilliant-cut round diamond centre stone with crisp crystalline facets, slim platinum band' },
  { id: 'cascade-pendant', type: 'pendant', name: 'Cascade Pendant',
    desc: 'cascading waterfall pendant charm, graduated round diamonds flowing downward, 18k white gold' },
  { id: 'nova-chandelier-earrings', type: 'earrings', name: 'Nova Chandelier Earrings', productOnly: true,
    desc: 'dramatic maximalist chandelier earring, cascading aquamarine drops each within a brilliant diamond halo, 18k white gold' },
  { id: 'brutalist-cuff', type: 'bracelet', name: 'Brutalist Cuff',
    desc: 'bold brutalist sculptural cuff bracelet, angular hand-hammered architectural form, solid 18k yellow gold' },
  { id: 'celestial-stacker', type: 'ring', name: 'Celestial Stacker',
    desc: 'delicate celestial stacking ring, star and crescent-moon motifs scattered with tiny pavé diamonds, 18k yellow gold' },
  { id: 'mirage-halo-ring', type: 'ring', name: 'Mirage Halo Ring',
    desc: 'halo engagement ring, an oval centre diamond encircled by a shimmering halo of pavé diamonds, rose gold band' },
  { id: 'chronos-edition', type: 'ring', name: 'Chronos Edition',
    desc: 'bold architectural mens signet ring, brushed titanium with a polished black onyx inlay, modern minimalist geometry' },
  { id: 'drift-bangle', type: 'bracelet', name: 'Drift Bangle',
    desc: 'organic flowing bangle bracelet, smooth driftwood-inspired sculptural curves, brushed white gold' },
  { id: 'aurora-pendant-set', type: 'necklace', name: 'Aurora Pendant Set', allowPendant: true,
    desc: 'aurora-inspired pendant necklace, a graduated sapphire and diamond pendant on a fine 18k white gold chain' },
  { id: 'lumiere-chain-set', type: 'necklace', name: 'Lumiere Chain Set',
    desc: 'luminous layered chain necklace, delicate interwoven polished link chains, 18k yellow gold' },
  { id: 'solstice-layering-set', type: 'necklace', name: 'Solstice Layering Set',
    desc: 'layered necklace, multiple fine chains at graduated lengths with tiny diamond stations, 18k gold' },
  { id: 'velvet-collar-set', type: 'necklace', name: 'Velvet Collar Set', productOnly: true,
    desc: 'elegant wide collar choker necklace, encrusted with channel-set diamonds, 18k white gold' },
];

const VIEWPOINTS = ['front', 'profile', 'detail'];

// ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args  = process.argv.slice(2);
  const force = args.includes('--force');
  const onlyIx = args.indexOf('--only');
  const only  = onlyIx !== -1 ? args[onlyIx + 1] : null;

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const items = only ? ITEMS.filter((i) => i.id === only) : ITEMS;
  if (only && !items.length) { console.error('No item with id "' + only + '"'); process.exit(1); }

  const total = items.length * VIEWPOINTS.length;
  let done = 0, ok = 0, skipped = 0, failed = 0;
  const failures = [];

  console.log('Generating ' + total + ' images into ' + OUT_DIR + '\n');

  for (const item of items) {
    console.log('── ' + item.name + '  (' + item.type + ', id=' + item.id + ')');
    for (let v = 0; v < VIEWPOINTS.length; v++) {
      const viewpoint = VIEWPOINTS[v];
      const fileName  = item.id + '-' + (v + 1) + '.jpg';
      const filePath  = path.join(OUT_DIR, fileName);
      done++;
      const tag = '   [' + done + '/' + total + '] ' + fileName + ' (' + viewpoint + ')';

      if (!force && fs.existsSync(filePath)) {
        console.log(tag + ' -> already exists, skipping');
        skipped++; ok++;
        continue;
      }

      const built = buildPrompt(item, viewpoint);
      let result = null;
      // up to 2 attempts (handles transient Gemini rate-limits before HF)
      for (let attempt = 1; attempt <= 2 && !result; attempt++) {
        result = await generateImage(built);
        if (!result && attempt < 2) {
          console.log(tag + ' -> retrying in 4s...');
          await sleep(4000);
        }
      }

      if (result && result.buf) {
        fs.writeFileSync(filePath, result.buf);
        console.log(tag + ' -> OK via ' + result.method + ' (' + Math.round(result.buf.length / 1024) + ' KB)');
        ok++;
      } else {
        console.log(tag + ' -> FAILED (both Gemini and HF)');
        failed++; failures.push(fileName);
      }

      await sleep(1200); // be gentle on the workers / rate limits
    }
  }

  console.log('\n──────── Summary ────────');
  console.log('OK: ' + ok + '   (newly generated: ' + (ok - skipped) + ', skipped existing: ' + skipped + ')');
  console.log('Failed: ' + failed);
  if (failures.length) console.log('Failed files: ' + failures.join(', '));
  console.log('Output dir: ' + OUT_DIR);
  process.exit(failed && (ok - skipped) === 0 ? 1 : 0);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
