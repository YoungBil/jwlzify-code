// calc-price Cloudflare Worker — the jewelry pricing formula, moved server-side so
// the stone rates and labour/profit margins are no longer readable in the front-end
// source (ailab.html quote/estimate + collections via pricing.js call this instead
// of computing locally).
//
// Deploy (Cloudflare dashboard ONLY — never Wrangler CLI):
//   1. Create a Worker named "calc-price" → URL https://calc-price.sarkd333.workers.dev
//   2. Paste this file. No secrets needed (spot prices come from the public
//      gold-price / silver-price workers).
//
// Request  (POST JSON): { items: [ {
//     jewelryType:  'ring' | 'necklace' | 'pendant' | 'earrings' | 'bracelet',
//     metalType:    '925silver' | '10ctgold' | '14ctgold',
//     stoneType:    'moissanite_vvsd' | 'lab_diamond' | 'lab_diamond_vvs'
//                 | 'real_diamond_vsvvs' | 'natural_diamond' | 'none',
//     metalGrams?:  number,   // grams from the spec flow (0/absent → per-type default)
//     totalCarats?: number,   // total carats from the spec flow
//     userCarats?:  number,   // explicit carat override (quote path)
//     exact?:       boolean,  // true = use metalGrams/totalCarats AS-IS, zero stays
//                             // zero (the live spec-estimate semantics); default
//                             // false = quote resolution with per-type defaults
//   }, ... ] }   (max 25 items per request — the collections page batches a category)
//
// Response (JSON): { results: [ {
//     finalPrice, metalCost, stoneCost, labourAndCraftsmanship,   // display numbers
//     metalGrams, stoneCarats                                     // resolved inputs
//   } | { error: string } ] }
//   ONLY the display numbers are returned — never rates, percentages, or tiers.
//   An unrecognized metal or stone key yields a per-item { error }, never a silent
//   default price (same principle as the client-side STONE_RATES strictness fix).

const GOLD_PRICE_URL   = 'https://gold-price.sarkd333.workers.dev';
const SILVER_PRICE_URL = 'https://silver-price.sarkd333.workers.dev';

/* ── The formula (moved verbatim from ailab.html calculatePrice / pricing.js) ── */
const STONE_RATES = {
  moissanite_vvsd: 2.00,
  lab_diamond:     80.00,  // lab grown diamond — flat $80/ct
  lab_diamond_vvs: 80.00,  // lab grown diamond (VVS) — flat $80/ct
  // PLACEHOLDER RATE: real diamond does not have its sourcing rate yet — update the
  // NUMBER here when the real per-carat rate is decided.
  real_diamond_vsvvs: 2.00, // AI Lab gem code for real diamond (gold options)
  natural_diamond:    2.00, // SAME stone, collections-catalogue code
  none:               0.00, // stoneless collections pieces
};
const MATERIAL_WEIGHTS = {
  ring:     { metalGrams: 4,  stoneCarats: 0.80 },
  necklace: { metalGrams: 8,  stoneCarats: 1.20 },
  pendant:  { metalGrams: 5,  stoneCarats: 0.60 },
  earrings: { metalGrams: 3,  stoneCarats: 0.50 },
  bracelet: { metalGrams: 12, stoneCarats: 1.50 },
};
const LABOUR_RATE = 0.20;
function profitRateFor(metalType, stoneType) {
  if (metalType === '925silver' && stoneType === 'moissanite_vvsd') return 1.50;
  if ((metalType === '10ctgold' || metalType === '14ctgold') &&
      (stoneType === 'real_diamond_vsvvs' || stoneType === 'natural_diamond')) return 0.70;
  return 1.00;
}

/* ── Live spot prices (USD/g incl. purity), fetched server-side with a short cache.
   Parsing + purity factors + fallbacks replicate the front end's fetchSpotPrices
   exactly so prices match what the client formula produced. Spot is public data —
   only the formula below is sensitive. ── */
const TROY = 31.1034768;
const KARAT_PURITY = { '10ct': 0.417, '14ct': 0.583 };
const SPOT_TTL_MS = 5 * 60 * 1000;
let _spotCache = null; // { at, silverPerGram, gold10ctPerGram, gold14ctPerGram }

async function getSpotPrices() {
  const now = Date.now();
  if (_spotCache && now - _spotCache.at < SPOT_TTL_MS) return _spotCache;
  const spot = { at: now, silverPerGram: 0.97, gold10ctPerGram: 44.24, gold14ctPerGram: 61.86 }; // USD/g fallbacks
  const [silverResult, goldResult] = await Promise.allSettled([
    fetch(SILVER_PRICE_URL, { cf: { cacheTtl: 0 } }).then((r) => r.json()),
    fetch(GOLD_PRICE_URL,   { cf: { cacheTtl: 0 } }).then((r) => r.json()),
  ]);
  if (silverResult.status === 'fulfilled') {
    const d = silverResult.value || {};
    const rawField = d.pricePerGram ?? d.price_per_gram ?? d.pricePerOz ?? d.price_per_oz
                  ?? d.price ?? d.silver ?? d.silverPrice;
    const isOz = d.pricePerOz !== undefined || d.price_per_oz !== undefined || d.unit === 'oz' || d.per === 'oz';
    const silverPerGram = rawField > 0 ? (isOz ? rawField / TROY : rawField) : null;
    if (silverPerGram > 0) spot.silverPerGram = silverPerGram * 0.925; // 925 purity
  }
  if (goldResult.status === 'fulfilled') {
    const goldPerGram = goldResult.value && goldResult.value.price; // pure 24ct USD/g
    if (goldPerGram > 0) {
      spot.gold10ctPerGram = goldPerGram * KARAT_PURITY['10ct'];
      spot.gold14ctPerGram = goldPerGram * KARAT_PURITY['14ct'];
    }
  }
  _spotCache = spot;
  return spot;
}

// Price ONE item. Returns display numbers only, or { error } for unknown keys.
function priceItem(item, spot) {
  const jewelryType = String(item.jewelryType || 'pendant');
  const metalType   = String(item.metalType || '');
  const stoneType   = String(item.stoneType || '');

  let metalPerGram = null;
  if (metalType === '925silver')      metalPerGram = spot.silverPerGram;
  else if (metalType === '10ctgold')  metalPerGram = spot.gold10ctPerGram;
  else if (metalType === '14ctgold')  metalPerGram = spot.gold14ctPerGram;
  if (metalPerGram == null) return { error: 'unknown metal type "' + metalType + '"' };

  const stoneRate = STONE_RATES[stoneType];
  if (stoneRate == null) return { error: 'unknown stone type "' + stoneType + '"' };

  const weights = MATERIAL_WEIGHTS[jewelryType] || MATERIAL_WEIGHTS.pendant;
  const grams  = Number(item.metalGrams)  || 0;
  const total  = (typeof item.totalCarats === 'number' && isFinite(item.totalCarats)) ? item.totalCarats : null;
  const userCt = Number(item.userCarats) || 0;

  let metalGrams, stoneCarats;
  if (item.exact) {
    // Live spec-estimate semantics: values as-is, an explicit zero stays zero.
    metalGrams  = grams;
    stoneCarats = total != null ? total : 0;
  } else {
    // Quote semantics — replicates the original calculatePrice resolution.
    metalGrams = grams > 0 ? grams : weights.metalGrams;
    if (jewelryType === 'necklace') {
      stoneCarats = (total != null && total >= 0) ? total : 0; // honour explicit 0 (None placement)
    } else {
      stoneCarats = userCt > 0 ? userCt : (total != null && total > 0) ? total : weights.stoneCarats;
    }
  }

  const metalCost  = metalGrams * metalPerGram;
  const stoneCost  = stoneCarats * stoneRate;
  const baseCost   = metalCost + stoneCost;
  const labourCost = baseCost * LABOUR_RATE;
  const profitCost = baseCost * profitRateFor(metalType, stoneType);

  return {
    finalPrice: baseCost + labourCost + profitCost,
    metalCost:  metalCost,
    stoneCost:  stoneCost,
    labourAndCraftsmanship: labourCost + profitCost, // ONE combined line — never split
    metalGrams:  metalGrams,
    stoneCarats: stoneCarats,
  };
}

/* ── Shared security: origin allowlist + best-effort per-IP rate limit ───────── */
const ALLOWED_ORIGINS = ['https://jwlzify.com', 'https://www.jwlzify.com'];
function _originAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
const RATE = { windowMs: 60000, max: 30 };   // estimates are debounced client-side; collections batch is 1 req
const _hits = new Map();
function _rateLimited(ip) {
  const now = Date.now();
  if (_hits.size > 5000) _hits.clear();
  const h = _hits.get(ip);
  if (!h || now - h.t0 > RATE.windowMs) { _hits.set(ip, { t0: now, n: 1 }); return false; }
  h.n++;
  return h.n > RATE.max;
}
function _cors(origin) {
  return {
    'Access-Control-Allow-Origin': _originAllowed(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const CORS = _cors(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST')    return new Response('Method not allowed', { status: 405, headers: CORS });
    if (!_originAllowed(origin)) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (_rateLimited(ip)) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    let body;
    try { body = await request.json(); }
    catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items || !items.length || items.length > 25) {
      return new Response(JSON.stringify({ error: 'items must be an array of 1–25 entries' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const spot = await getSpotPrices();
    const results = items.map((item) => {
      const r = priceItem(item || {}, spot);
      if (r.error) console.log('[calc-price] rejected:', r.error);
      return r;
    });
    return new Response(JSON.stringify({ results: results }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  },
};
