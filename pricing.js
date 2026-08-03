/*
 * pricing.js — client for the server-side pricing formula.
 *
 * The formula itself (stone rates, default weights, labour/profit tiers) lives
 * ONLY in the calc-price Cloudflare Worker (calc-price-worker.js) — nothing in
 * this file computes a price, so nothing sensitive is readable here. This file:
 *   - fetches live metal spot prices (public data) from the gold-price /
 *     silver-price workers, for display purposes
 *   - sends spec inputs to calc-price and returns its display numbers
 *     ({ finalPrice, metalCost, stoneCost, labourAndCraftsmanship, metalGrams,
 *     stoneCarats }); unknown metal/stone keys come back as per-item { error }
 *
 * Exposes window.JWLZ_PRICING = { spotPrices, fetchSpotPrices, priceBatch,
 * priceForSpec, priceDetail, KARAT_PURITY }. All pricing functions are ASYNC.
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

  // Live metal prices (USD/g) — same workers + parsing as the AI Lab.
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
      var goldPerGram = goldResult.value && goldResult.value.price; // pure 24ct USD/g
      if (goldPerGram > 0) {
        spotPrices.gold10ctPerGram = goldPerGram * KARAT_PURITY['10ct'];
        spotPrices.gold14ctPerGram = goldPerGram * KARAT_PURITY['14ct'];
        goldOk = true;
      }
    } else {
      console.warn('[Pricing] gold-price worker failed:', goldResult.reason && goldResult.reason.message);
    }

    if (silverOk || goldOk) { spotPrices.source = 'cloudflare-worker-usd'; spotPrices.fetchedAt = new Date().toISOString(); }
    if (!silverOk) spotPrices.silverPerGram = 0.97;                                  // USD/g fallback
    if (!goldOk) { spotPrices.gold10ctPerGram = 44.24; spotPrices.gold14ctPerGram = 61.86; } // USD/g fallbacks
    if (!spotPrices.fetchedAt) { spotPrices.source = 'fallback-usd'; spotPrices.fetchedAt = new Date().toISOString(); }
    return spotPrices;
  }

  /* ── Server-side pricing (calc-price worker) ──
     The formula (stone rates, labour/profit tiers) lives in the calc-price
     Cloudflare Worker; this file just sends spec inputs and returns the display
     numbers. All pricing functions are ASYNC (they resolve a network call). */
  var CALC_PRICE_URL = 'https://calc-price.sarkd333.workers.dev';
  function _toWorkerItem(o) {
    return {
      jewelryType: o.jewelryType, metalType: o.metalCode, stoneType: o.stoneCode,
      metalGrams: o.grams || 0, totalCarats: o.carats || 0, userCarats: o.carats || 0
    };
  }
  // Price many specs in ONE request (the collections page batches a whole category).
  // Resolves to an array aligned with `specs`; each entry is either
  // { finalPrice, metalCost, stoneCost, labourAndCraftsmanship, metalGrams,
  // stoneCarats } or { error } (unknown metal/stone keys are rejected loudly).
  function priceBatch(specs) {
    return fetch(CALC_PRICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: specs.map(_toWorkerItem) })
    }).then(function (res) {
      if (!res.ok) throw new Error('calc-price HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      if (!data || Object.prototype.toString.call(data.results) !== '[object Array]') {
        throw new Error('calc-price: malformed response');
      }
      return data.results;
    });
  }
  // ASYNC: full display breakdown for one spec (throws on unknown metal/stone key).
  function priceDetail(o) {
    return priceBatch([o]).then(function (results) {
      var r = results[0];
      if (!r || r.error) throw new Error((r && r.error) || 'empty pricing result');
      return r;
    });
  }
  // ASYNC back-compat: just the final price.
  function priceForSpec(o) { return priceDetail(o).then(function (r) { return r.finalPrice; }); }

  root.JWLZ_PRICING = {
    spotPrices: spotPrices,
    fetchSpotPrices: fetchSpotPrices,
    priceBatch: priceBatch,
    priceForSpec: priceForSpec,
    priceDetail: priceDetail,
    KARAT_PURITY: KARAT_PURITY
  };
})(typeof window !== 'undefined' ? window : this);
