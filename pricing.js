/*
 * pricing.js — shared jewelry pricing formula.
 *
 * This is the SAME formula the AI Lab quote step (ailab.html) uses, kept in one
 * place so the Collections page prices match the AI Lab exactly:
 *   - live metal price (CAD/g) from the metals.dev Cloudflare workers
 *     (gold-price / silver-price), with fallbacks
 *   - karat purity multipliers: 10k = 0.417, 14k = 0.583, 925 silver = 0.925
 *   - metal cost  = grams × (spot CAD/g × purity)
 *   - stone cost  = carats × $2.00/ct
 *   - base        = metal + stone
 *   - + 20% labour, + profit margin (default 100%)
 *   - final price in CAD
 *
 * Exposes window.JWLZ_PRICING = { spotPrices, fetchSpotPrices, calculatePrice, priceForSpec }.
 * NOTE: this mirrors ailab.html's calculatePrice()/fetchSpotPrices()/spotPrices verbatim;
 *       if the AI Lab formula ever changes, update it here too.
 */
(function (root) {
  'use strict';

  var TROY = 31.1034768;
  var FALLBACK_PRICES = { silverPerOz: 32.50, goldPerOz: 3300.00 };
  var KARAT_PURITY = { '14ct': 0.583, '10ct': 0.417 }; // 925 silver = 0.925 (applied inline)

  var spotPrices = {
    silverPerGram:   (FALLBACK_PRICES.silverPerOz / TROY) * 0.925,
    gold10ctPerGram: (FALLBACK_PRICES.goldPerOz / TROY) * KARAT_PURITY['10ct'],
    gold14ctPerGram: (FALLBACK_PRICES.goldPerOz / TROY) * KARAT_PURITY['14ct'],
    source: 'fallback', fetchedAt: null
  };

  // Live metal prices (CAD/g) — same workers + parsing as the AI Lab.
  async function fetchSpotPrices() {
    var silverOk = false, goldOk = false;
    var results = await Promise.allSettled([
      fetch('https://silver-price.sarkd333.workers.dev', { cache: 'no-store' }).then(function (r) { return r.json(); }),
      fetch('https://gold-price.sarkd333.workers.dev',   { cache: 'no-store' }).then(function (r) { return r.json(); })
    ]);
    var silverResult = results[0], goldResult = results[1];

    if (silverResult.status === 'fulfilled') {
      var d = silverResult.value || {};
      var rawField = (d.pricePerGram != null) ? d.pricePerGram
                   : (d.price_per_gram != null) ? d.price_per_gram
                   : (d.pricePerOz != null) ? d.pricePerOz
                   : (d.price_per_oz != null) ? d.price_per_oz
                   : (d.price != null) ? d.price
                   : (d.silver != null) ? d.silver : d.silverPrice;
      var isOz = (d.pricePerOz !== undefined || d.price_per_oz !== undefined || d.unit === 'oz' || d.per === 'oz');
      var silverPerGram = (rawField > 0) ? (isOz ? rawField / TROY : rawField) : null;
      if (silverPerGram > 0) { spotPrices.silverPerGram = silverPerGram * 0.925; silverOk = true; }
    } else {
      console.warn('[Pricing] silver-price worker failed:', silverResult.reason && silverResult.reason.message);
    }

    if (goldResult.status === 'fulfilled') {
      var goldPerGram = goldResult.value && goldResult.value.price; // pure 24ct CAD/g
      if (goldPerGram > 0) {
        spotPrices.gold10ctPerGram = goldPerGram * KARAT_PURITY['10ct'];
        spotPrices.gold14ctPerGram = goldPerGram * KARAT_PURITY['14ct'];
        goldOk = true;
      }
    } else {
      console.warn('[Pricing] gold-price worker failed:', goldResult.reason && goldResult.reason.message);
    }

    if (silverOk || goldOk) { spotPrices.source = 'cloudflare-worker-cad'; spotPrices.fetchedAt = new Date().toISOString(); }
    if (!silverOk) spotPrices.silverPerGram = 3.33;
    if (!goldOk) { spotPrices.gold10ctPerGram = 75.40; spotPrices.gold14ctPerGram = 105.56; }
    if (!spotPrices.fetchedAt) { spotPrices.source = 'fallback-cad'; spotPrices.fetchedAt = new Date().toISOString(); }
    return spotPrices;
  }

  var STONE_RATES = { moissanite_vvsd: 2.00, lab_diamond: 2.00, natural_diamond: 2.00 };
  var MATERIAL_WEIGHTS = {
    ring:     { metalGrams: 4,  stoneCarats: 0.80 },
    necklace: { metalGrams: 8,  stoneCarats: 1.20 },
    pendant:  { metalGrams: 5,  stoneCarats: 0.60 },
    earrings: { metalGrams: 3,  stoneCarats: 0.50 },
    bracelet: { metalGrams: 12, stoneCarats: 1.50 }
  };

  // Verbatim AI Lab pricing. Reads window.jwlSpecifications for grams/carats overrides.
  function calculatePrice(metalType, stoneType, jewelryType, userCarats) {
    var weights = Object.assign({}, MATERIAL_WEIGHTS[jewelryType] || MATERIAL_WEIGHTS['pendant']);
    var specs = root.jwlSpecifications;
    if (specs && specs.metalGrams > 0) weights.metalGrams = specs.metalGrams;

    var stoneCarats = (userCarats && userCarats > 0) ? userCarats
      : (specs && specs.totalCarats > 0) ? specs.totalCarats
      : weights.stoneCarats;

    var metalPerGram = 0;
    if (metalType === '925silver')     metalPerGram = spotPrices.silverPerGram;
    else if (metalType === '10ctgold') metalPerGram = spotPrices.gold10ctPerGram;
    else if (metalType === '14ctgold') metalPerGram = spotPrices.gold14ctPerGram;

    var stoneRateUsed = STONE_RATES[stoneType] || 2.00;
    var metalCost = weights.metalGrams * metalPerGram;
    var stoneCost = stoneCarats * stoneRateUsed;
    var baseCost  = metalCost + stoneCost;

    var labourRate = 0.20, profitRate = 1.00;
    if (metalType === '925silver' && stoneType === 'moissanite_vvsd') profitRate = 1.50;
    else if ((metalType === '10ctgold' || metalType === '14ctgold') && (stoneType === 'real_diamond_vsvvs' || stoneType === 'natural_diamond')) profitRate = 0.70;

    var labourCost = baseCost * labourRate;
    var profitCost = baseCost * profitRate;
    var finalPrice = baseCost + labourCost + profitCost;

    return {
      metalGrams: weights.metalGrams, stoneCarats: stoneCarats, metalPerGram: metalPerGram,
      metalCost: metalCost, stoneCost: stoneCost, baseCost: baseCost,
      labourCost: labourCost, profitCost: profitCost, finalPrice: finalPrice
    };
  }

  // Clean-parameter wrapper for collection items (does not clobber AI Lab's global).
  function priceForSpec(o) {
    var prev = root.jwlSpecifications;
    root.jwlSpecifications = {
      metalGrams: o.grams || 0, totalCarats: o.carats || 0,
      stoneCount: o.stoneCount || 0, stones: []
    };
    var r = calculatePrice(o.metalCode, o.stoneCode, o.jewelryType, o.carats || 0);
    root.jwlSpecifications = prev; // restore
    return r.finalPrice;
  }

  root.JWLZ_PRICING = {
    spotPrices: spotPrices,
    fetchSpotPrices: fetchSpotPrices,
    calculatePrice: calculatePrice,
    priceForSpec: priceForSpec,
    KARAT_PURITY: KARAT_PURITY
  };
})(typeof window !== 'undefined' ? window : this);
