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
  // LAUNCH GATE (keep in sync with ailab.html REAL_DIAMOND_ENABLED): real diamond
  // has no confirmed per-carat rate yet. While false, pieces whose rotation slot is
  // natural_diamond substitute lab diamond instead — the items still generate, so
  // the 90-item grid, ids, names, images and sidebar counts stay identical. Flip to
  // true to restore natural diamond in the rotation.
  var REAL_DIAMOND_ENABLED = false;

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

  /* ══════════════════════════════════════════════════════════════════════════
     STONE STRUCTURE BY STYLE — industry-average PLACEHOLDERS pending real
     supplier figures. Every number a piece's stones derive from lives HERE:
       centreCt      — centre stone carat (0 = no dominant centre)
       accents       — accent/melee stone count
       accentTotalCt — TOTAL carat weight of all accents combined
     Totals: carats = centreCt + accentTotalCt; stoneCount = accents + (centre?1:0).
     Reference points used: halo ≈ 12–16 accents totalling 0.25–0.35ct; three-stone
     sides ≈ 40% of centre each; cluster ≈ 7–9 similar stones, no dominant centre.
     Earring entries are PER PAIR. Styles absent from a category's table fall back
     to DEFAULT_STRUCTURE (1ct solitaire).
  ══════════════════════════════════════════════════════════════════════════ */
  var DEFAULT_STRUCTURE = { centreCt: 1.00, accents: 0, accentTotalCt: 0 };
  var STONE_STRUCTURE = {
    ring: {
      'Solitaire':     { centreCt: 1.00, accents: 0,  accentTotalCt: 0 },
      'Halo':          { centreCt: 1.00, accents: 14, accentTotalCt: 0.30 },
      'Three-Stone':   { centreCt: 1.00, accents: 2,  accentTotalCt: 0.80 },
      'Pavé Eternity': { centreCt: 0,    accents: 24, accentTotalCt: 1.20 },
      'Cathedral':     { centreCt: 1.20, accents: 0,  accentTotalCt: 0 },
      'Bezel':         { centreCt: 1.00, accents: 0,  accentTotalCt: 0 },
      'Tension':       { centreCt: 0.90, accents: 0,  accentTotalCt: 0 },
      'Cluster':       { centreCt: 0,    accents: 8,  accentTotalCt: 1.00 },
      'Twist':         { centreCt: 0.75, accents: 0,  accentTotalCt: 0 }
    },
    pendant: {
      'Drop':      { centreCt: 1.00, accents: 0,  accentTotalCt: 0 },
      'Teardrop':  { centreCt: 1.25, accents: 0,  accentTotalCt: 0 },
      'Solitaire': { centreCt: 1.00, accents: 0,  accentTotalCt: 0 },
      'Locket':    { centreCt: 0.15, accents: 0,  accentTotalCt: 0 },
      'Charm':     { centreCt: 0.25, accents: 0,  accentTotalCt: 0 },
      'Crescent':  { centreCt: 0,    accents: 12, accentTotalCt: 0.60 },
      'Disc':      { centreCt: 0.10, accents: 0,  accentTotalCt: 0 },
      'Bar':       { centreCt: 0,    accents: 5,  accentTotalCt: 0.25 },
      'Halo':      { centreCt: 1.00, accents: 12, accentTotalCt: 0.25 },
      'Heart':     { centreCt: 0.75, accents: 0,  accentTotalCt: 0 }
    },
    earring: { // PER PAIR
      'Chandelier': { centreCt: 0,    accents: 14, accentTotalCt: 1.40 },
      'Drops':      { centreCt: 1.00, accents: 2,  accentTotalCt: 0.20 },
      'Studs':      { centreCt: 1.00, accents: 0,  accentTotalCt: 0 },    // 0.50ct per ear
      'Hoops':      { centreCt: 0,    accents: 24, accentTotalCt: 0.72 },
      'Threaders':  { centreCt: 0.20, accents: 0,  accentTotalCt: 0 },
      'Huggies':    { centreCt: 0,    accents: 12, accentTotalCt: 0.36 },
      'Climbers':   { centreCt: 0,    accents: 10, accentTotalCt: 0.50 },
      'Dangles':    { centreCt: 0.80, accents: 4,  accentTotalCt: 0.24 },
      'Jackets':    { centreCt: 1.00, accents: 8,  accentTotalCt: 0.32 },
      'Crawlers':   { centreCt: 0,    accents: 10, accentTotalCt: 0.40 }
    },
    bracelet: { // no-stone styles (Cuff, Bangle, …) never reach this table
      'Tennis': { centreCt: 0,    accents: 40, accentTotalCt: 3.20 },
      'Line':   { centreCt: 0,    accents: 30, accentTotalCt: 2.10 },
      'Link':   { centreCt: 0,    accents: 5,  accentTotalCt: 0.50 },
      'Wrap':   { centreCt: 0.50, accents: 0,  accentTotalCt: 0 }
    },
    necklace: {
      'Pendant': { centreCt: 1.00, accents: 0,  accentTotalCt: 0 },
      'Layered': { centreCt: 0,    accents: 3,  accentTotalCt: 0.60 },
      'Tennis':  { centreCt: 0,    accents: 54, accentTotalCt: 4.32 },
      'Lariat':  { centreCt: 0.50, accents: 1,  accentTotalCt: 0.25 },
      'Station': { centreCt: 0,    accents: 7,  accentTotalCt: 1.40 },
      'Rivière': { centreCt: 0,    accents: 36, accentTotalCt: 5.40 },
      'Choker':  { centreCt: 0,    accents: 16, accentTotalCt: 1.60 }
    }
  };
  function stoneStructureFor(category, style) {
    return (STONE_STRUCTURE[category] && STONE_STRUCTURE[category][style]) || DEFAULT_STRUCTURE;
  }

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
      // Gate: natural-diamond slots become lab diamond while real diamond is disabled
      // (same rotation position, so every other item is untouched).
      if (!REAL_DIAMOND_ENABLED && st.code === 'natural_diamond') st = STONE_TYPES[0];
      stoneType = st.code; stoneLabel = st.label;
      // Style-driven structure (see STONE_STRUCTURE): totals = centre + accents.
      var struct = stoneStructureFor(category, style);
      carats     = Math.round((struct.centreCt + struct.accentTotalCt) * 100) / 100;
      stoneCount = struct.accents + (struct.centreCt > 0 ? 1 : 0);
      var isMulti = stoneCount > 1;
      stoneSize = carats.toFixed(2) + ' ct' + (isMulti ? ' total' : '');
      gemPhrase = 'featuring ' + (isMulti ? stoneSize + ' of ' + stoneLabel.toLowerCase() : 'a ' + stoneSize + ' ' + stoneLabel.toLowerCase());
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
