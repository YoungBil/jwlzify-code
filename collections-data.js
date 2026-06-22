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
  function money(n) { return '$' + n.toLocaleString('en-US'); }

  var MATERIALS = ['18k Yellow Gold', '18k White Gold', '18k Rose Gold', 'Platinum'];
  var KARAT = {
    '18k Yellow Gold': '18k', '18k White Gold': '18k', '18k Rose Gold': '18k',
    'Platinum': 'PT950', 'Titanium': '—'
  };
  var STONES = [
    'Round Brilliant Diamond', 'Pavé Diamonds', 'Blue Sapphire', 'Colombian Emerald',
    'Aquamarine', 'Pink Morganite', 'Ruby', 'South Sea Pearl', 'Black Onyx', 'Yellow Diamond'
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
    var material = MATERIALS[idx % MATERIALS.length];
    var stone = noStoneFor(category, style) ? 'None' : STONES[(idx * 3 + CAT_ORDER.indexOf(category)) % STONES.length];

    var karat = KARAT[material] || '18k';
    var weight = (cfg.weightBase + idx * (category === 'bracelet' || category === 'necklace' ? 1.6 : 0.6));
    var weightStr = (Math.round(weight * 10) / 10) + ' g';

    var stoneSize, gemPhrase;
    if (stone === 'None') {
      stoneSize = '—';
      gemPhrase = 'polished plain ' + material.toLowerCase().replace('18k ', '') + ', no stones';
    } else {
      var carats = Math.round((0.4 + (idx % 6) * 0.45) * 100) / 100;
      var isPave = stone.indexOf('Pav') !== -1 || style === 'Pavé Eternity' || style === 'Tennis' || style === 'Station';
      stoneSize = carats.toFixed(2) + ' ct' + (isPave ? ' total' : '');
      gemPhrase = 'featuring ' + (isPave ? stoneSize + ' of ' + stone.toLowerCase() : 'a ' + stoneSize + ' ' + stone.toLowerCase());
    }

    var lowBase = cfg.priceBase + idx * Math.round(cfg.priceBase * 0.22);
    var low = Math.round(lowBase / 50) * 50;
    var high = Math.round((low * 1.12) / 50) * 50;
    var priceRange = money(low) + ' – ' + money(high);

    // SDXL description (front-facing, single item; orientation clause added by generator)
    var desc = 'a ' + style.toLowerCase() + ' ' + cfg.label.toLowerCase() + ', the "' + name + '", crafted in ' +
      material + ', ' + gemPhrase;

    return {
      id: category + '-' + pad2(i),
      category: category,
      type: cfg.type,
      name: name,
      productOnly: !!cfg.productOnly,
      desc: desc,
      specs: {
        type: cfg.label,
        material: material,
        karat: karat,
        stone: stone,
        stoneSize: stoneSize,
        style: style,
        weight: weightStr,
        priceRange: priceRange
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
