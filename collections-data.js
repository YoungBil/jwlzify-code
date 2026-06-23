/*
 * collections-data.js  —  single source of truth for the Collections gallery.
 * Loaded by BOTH:
 *   - the browser (collections.html) -> window.COLLECTION_ITEMS
 *   - the Node generator (generate-collection-images.js) -> module.exports
 *
 * 5 categories x 18 items = 90 items. Each item:
 *   { id, category, type, name, productOnly, desc, specs:{...} }
 *   id is "<category>-NN"  (ring-01 ... necklace-18) -> image is images/collections/<id>.jpg
 *
 * Items are built deterministically (no randomness) so the browser and the
 * generator always produce the identical catalogue.
 */
(function (root) {
  'use strict';

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // ── Metals are LOCKED to exactly these three (matches the AI Lab pricing codes). ──
  var METALS = {
    '925silver': { display: '925 Sterling Silver', karat: '925' },
    '10ctgold':  { display: '10k Gold',            karat: '10k' },
    '14ctgold':  { display: '14k Gold',            karat: '14k' }
  };
  // Tone of the original render → a sensible default locked metal (image is representative;
  // the metal is switchable in the modal between all three).
  var TONE_PREV = ['Yellow', 'White', 'Rose', 'Platinum']; // old idx%4 tone order
  // Stone types are LOCKED to the AI Lab's three options so each piece maps to a
  // correct profit tier (925+moissanite=150%, gold+natural=70%, otherwise 100%).
  var STONE_TYPES = [
    { code: 'lab_diamond',     label: 'Lab Diamond' },
    { code: 'natural_diamond', label: 'Natural Diamond VS/VVS' },
    { code: 'moissanite_vvsd', label: 'Moissanite VVSD' }
  ];

  // Per-category configuration: generator type, product-only framing, label, style pool,
  // name list (18), base weight (g) and base price.
  var CATS = {
    ring: {
      type: 'ring', label: 'Ring', weightBase: 3.0, priceBase: 1800,
      styles: ['Solitaire', 'Halo', 'Three-Stone', 'Pavé Eternity', 'Signet', 'Cathedral', 'Bezel', 'Tension', 'Cluster', 'Twist'],
      names: ['Glacial Solitaire', 'Mirage Halo', 'Celestial Stacker', 'Chronos Signet', 'Aurelia Trilogy',
        'Eternity Pavé Band', 'Onyx Monolith', 'Rosewater Cushion', 'Verdant Cocktail', 'Midnight Solitaire',
        'Cathedral Marquise', 'Sahara Bezel', 'Lumen Tension', 'Pétale Cluster', 'Nordic Twist',
        'Imperial Three-Stone', 'Aria Knife-Edge', 'Solstice Eternity']
    },
    pendant: {
      type: 'pendant', label: 'Pendant', weightBase: 4.0, priceBase: 1400,
      styles: ['Drop', 'Teardrop', 'Solitaire', 'Locket', 'Charm', 'Crescent', 'Disc', 'Bar', 'Halo', 'Heart'],
      names: ['Cascade Drop', 'Lumière Teardrop', 'North Star', 'Halo Locket', 'Serpentine Charm',
        'Dewdrop Solitaire', 'Crescent Moon', 'Heirloom Cameo', 'Sapphire Comet', 'Gilded Feather',
        'Eclipse Disc', 'Wildflower Charm', 'Aurora Drop', 'Monarch Wing', 'Tidal Pearl',
        'Obsidian Shard', 'Constellation Bar', 'Velvet Heart']
    },
    earring: {
      type: 'earrings', productOnly: true, label: 'Earrings', weightBase: 5.0, priceBase: 1600,
      styles: ['Chandelier', 'Drops', 'Studs', 'Hoops', 'Threaders', 'Huggies', 'Climbers', 'Dangles', 'Jackets', 'Crawlers'],
      names: ['Nova Chandelier', 'Aurora Drops', 'Pétite Studs', 'Cascade Hoops', 'Comet Threaders',
        'Crescent Huggies', 'Marquise Climbers', 'Teardrop Dangles', 'Halo Studs', 'Lumière Hoops',
        'Starlight Jackets', 'Emerald Pendulums', 'Pearl Ear Crawlers', 'Sapphire Clusters', 'Geometric Tassels',
        'Vintage Girandole', 'Lariat Drops', 'Gilded Leaf Studs']
    },
    bracelet: {
      type: 'bracelet', label: 'Bracelet', weightBase: 14.0, priceBase: 2600,
      styles: ['Cuff', 'Bangle', 'Tennis', 'Line', 'Link', 'Wrap', 'Mesh', 'Hinge Cuff', 'Rope', 'Bolo'],
      names: ['Brutalist Cuff', 'Drift Bangle', 'Eternity Tennis', 'Riviera Line', 'Helix Bangle',
        'Charmed Link', 'Pavé Cuff', 'Serpent Wrap', 'Mesh Ribbon', 'Sahara Bangle',
        'Onyx Hinge Cuff', 'Lumen Chain', 'Twisted Rope', 'Solstice Cuff', 'Aurelia Tennis',
        'Geometric Link', 'Pearl Strand', 'Midnight Bolo']
    },
    necklace: {
      type: 'necklace', productOnly: true, label: 'Necklace', weightBase: 12.0, priceBase: 3200,
      styles: ['Pendant', 'Chain', 'Layered', 'Collar', 'Tennis', 'Lariat', 'Station', 'Rope', 'Rivière', 'Choker'],
      names: ['Aurora Pendant Set', 'Lumière Chain', 'Solstice Layering Set', 'Velvet Collar', 'Riviera Tennis',
        'Cascade Lariat', 'Celestial Station', 'Byzantine Rope', 'Sapphire Rivière', 'Herringbone Drape',
        'Pearl Strand', 'Snake Chain Choker', 'Diamond Y-Necklace', 'Gilded Bib', 'Twilight Pendant',
        'Emerald Collar', 'Infinity Link', 'Imperial Festoon']
    }
  };

  var CAT_ORDER = ['ring', 'pendant', 'earring', 'bracelet', 'necklace'];

  // Categories whose plainer styles (chains / metal cuffs) sometimes carry no stone.
  function noStoneFor(category, style) {
    if (category === 'bracelet') return ['Cuff', 'Bangle', 'Hinge Cuff', 'Rope', 'Bolo', 'Mesh'].indexOf(style) !== -1;
    if (category === 'necklace') return ['Chain', 'Rope', 'Collar'].indexOf(style) !== -1;
    if (category === 'ring') return style === 'Signet';
    return false;
  }

  function buildItem(category, i) {
    var cfg = CATS[category];
    var idx = i - 1;
    var name = cfg.names[idx];
    var style = cfg.styles[idx % cfg.styles.length];

    // Default locked metal (switchable in modal): white/platinum tones → 925 silver,
    // yellow → 14k gold, rose → 10k gold. All three options are represented.
    var tone = TONE_PREV[idx % 4];
    var metalCode;
    if (tone === 'White' || tone === 'Platinum') metalCode = '925silver';
    else if (tone === 'Yellow') metalCode = '14ctgold';
    else metalCode = '10ctgold';
    var metal = METALS[metalCode];

    var grams = Math.round((cfg.weightBase + idx * (category === 'bracelet' || category === 'necklace' ? 1.6 : 0.6)) * 10) / 10;
    var weightStr = grams + ' g';

    // Locked stone type → correct profit tier. Plain styles carry no stone.
    var hasStone = !noStoneFor(category, style);
    var stoneType, stoneLabel, stoneSize, gemPhrase, carats, stoneCount;
    if (!hasStone) {
      stoneType = 'none'; stoneLabel = 'None'; carats = 0; stoneCount = 0; stoneSize = '—';
      gemPhrase = 'polished plain ' + metal.display.toLowerCase() + ', no stones';
    } else {
      var st = STONE_TYPES[(idx + CAT_ORDER.indexOf(category)) % STONE_TYPES.length];
      stoneType = st.code; stoneLabel = st.label;
      carats = Math.round((0.4 + (idx % 6) * 0.45) * 100) / 100;
      var isPave = style === 'Pavé Eternity' || style === 'Tennis' || style === 'Station';
      stoneCount = isPave ? Math.max(2, Math.round(carats / 0.15)) : 1;
      stoneSize = carats.toFixed(2) + ' ct' + (isPave ? ' total' : '');
      gemPhrase = 'featuring ' + (isPave ? stoneSize + ' of ' + stoneLabel.toLowerCase() : 'a ' + stoneSize + ' ' + stoneLabel.toLowerCase());
    }

    // SDXL description (front-facing, single item; orientation clause added by generator)
    var desc = 'a ' + style.toLowerCase() + ' ' + cfg.label.toLowerCase() + ', the "' + name + '", crafted in ' +
      metal.display + ', ' + gemPhrase;

    return {
      id: category + '-' + pad2(i),
      category: category,
      type: cfg.type,
      name: name,
      productOnly: !!cfg.productOnly,
      desc: desc,
      specs: {
        type: cfg.label,
        jewelryType: cfg.type,   // ring|pendant|earrings|bracelet|necklace (for pricing)
        material: metal.display, // '925 Sterling Silver' | '10k Gold' | '14k Gold'
        metalCode: metalCode,    // '925silver' | '10ctgold' | '14ctgold'
        karat: metal.karat,      // '925' | '10k' | '14k'
        stone: stoneLabel,       // 'Lab Diamond' | 'Natural Diamond VS/VVS' | 'Moissanite VVSD' | 'None'
        stoneType: stoneType,    // 'lab_diamond' | 'natural_diamond' | 'moissanite_vvsd' | 'none'
        stoneSize: stoneSize,
        carats: carats,          // numeric total carats
        stoneCount: stoneCount,
        style: style,
        weight: weightStr,
        grams: grams             // numeric grams (price input)
        // price is computed at runtime via pricing.js (shared AI Lab formula)
      }
    };
  }

  var ITEMS = [];
  CAT_ORDER.forEach(function (category) {
    for (var i = 1; i <= 18; i++) ITEMS.push(buildItem(category, i));
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = ITEMS;
  if (root) root.COLLECTION_ITEMS = ITEMS;
})(typeof window !== 'undefined' ? window : this);
