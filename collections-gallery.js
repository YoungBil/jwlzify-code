/*
 * collections-gallery.js — renders the Collections gallery from
 * window.COLLECTION_ITEMS (collections-data.js). Handles:
 *   - category filtering (sidebar tabs)
 *   - show 6 first, "Explore More" reveals the remaining 12 (and "Show Less")
 *   - lazy images + shimmer + fade-in + branded fallback
 *   - the spec detail modal
 */
(function () {
  'use strict';

  var ITEMS = window.COLLECTION_ITEMS || [];
  var grid       = document.getElementById('galleryGrid');
  var exploreBtn = document.getElementById('exploreMoreBtn');
  var filterBtns = document.getElementById('filterBtns');
  if (!grid || !filterBtns) return;

  var FILTER_TO_CATEGORY = {
    'rings': 'ring', 'pendants': 'pendant', 'earrings': 'earring',
    'bracelets': 'bracelet', 'necklace-sets': 'necklace'
  };
  var INITIAL = 6;
  var currentCategory = 'ring';
  var expanded = false;

  // ── Pricing (shared AI Lab formula via pricing.js) + locked metal options ──
  var P = window.JWLZ_PRICING;
  var METAL_OPTIONS = [
    { code: '925silver', display: '925 Sterling Silver', karat: '925' },
    { code: '10ctgold',  display: '10k Gold',            karat: '10k' },
    { code: '14ctgold',  display: '14k Gold',            karat: '14k' }
  ];
  console.log('[Collections] metal options locked to: 925 silver, 10k gold, 14k gold');

  function metalOf(code) {
    for (var i = 0; i < METAL_OPTIONS.length; i++) if (METAL_OPTIONS[i].code === code) return METAL_OPTIONS[i];
    return METAL_OPTIONS[0];
  }
  // Pricing happens in the calc-price worker (server-side formula). One BATCH
  // request prices a whole category render; results are cached per item+metal so
  // tab flips and modal re-opens don't refetch.
  var _priceCache = {};   // "itemId|metalCode" → { price: rounded USD, grams: worker-derived }
  function cacheKey(item, metalCode) { return item.id + '|' + metalCode; }
  // Style → chain/structure KEY for the worker's weight model. Names only — the
  // grams-per-cm numbers live in the calc-price worker, never in client code.
  var CHAIN_STYLE_KEY = {
    bracelet: { 'Tennis': 'tennis', 'Line': 'line', 'Link': 'link', 'Wrap': 'wrap', 'Cuff': 'cuff',
                'Bangle': 'bangle', 'Hinge Cuff': 'cuff', 'Rope': 'rope', 'Bolo': 'bolo', 'Mesh': 'mesh' },
    necklace: { 'Pendant': 'cable', 'Chain': 'cable', 'Layered': 'layered', 'Collar': 'collar',
                'Tennis': 'tennis', 'Lariat': 'lariat', 'Station': 'station', 'Rope': 'rope',
                'Rivière': 'riviere', 'Choker': 'choker' }
  };
  function specOf(item, metalCode) {
    var s = item.specs || {};
    var o = { metalCode: metalCode || s.metalCode, stoneCode: s.stoneType,
              jewelryType: s.jewelryType, carats: s.carats, stoneCount: s.stoneCount };
    var map = CHAIN_STYLE_KEY[item.category];
    if (map && map[s.style]) o.chainStyle = map[s.style];
    return o;
  }
  // Price item+metal pairs in ONE worker request; fills _priceCache. Resolves when done.
  function fetchPrices(pairs) {
    if (!P || !P.priceBatch || !pairs.length) return Promise.resolve();
    return P.priceBatch(pairs.map(function (p) { return specOf(p.item, p.metal); }))
      .then(function (results) {
        pairs.forEach(function (p, i) {
          var r = results[i];
          if (!r || r.error || !isFinite(r.finalPrice)) {
            console.warn('[Collections] price unavailable:', p.item.id, '| metal:', p.metal, '|', r && r.error);
            return;
          }
          var price = Math.round(r.finalPrice);
          console.log('[Collections] price | item:', p.item.id, '| metal:', p.metal,
            '| stone:', (p.item.specs || {}).stoneType, '| grams:', r.metalGrams, '| finalPrice:', price);
          if (price < 50 || price > 100000) {
            console.warn('[Collections] price OUT OF SANE RANGE:', p.item.id, '| metal:', p.metal, '| price:', price,
              '| inputs:', JSON.stringify({ grams: r.metalGrams, carats: (p.item.specs || {}).carats }));
          }
          _priceCache[cacheKey(p.item, p.metal)] = { price: price, grams: r.metalGrams };
        });
      })
      .catch(function (e) { console.warn('[Collections] pricing worker unavailable:', e && e.message); });
  }
  function cachedPrice(item, metalCode) {
    var c = _priceCache[cacheKey(item, metalCode)];
    return (c != null) ? c.price : null;
  }
  function cachedGrams(item, metalCode) {
    var c = _priceCache[cacheKey(item, metalCode)];
    return (c != null && c.grams != null) ? c.grams : null;
  }
  function fmtPrice(n) { return (n == null) ? '—' : '$' + n.toLocaleString('en-US') + ' USD'; }

  // ── Sidebar counts -> real number of items per category ──
  Array.prototype.forEach.call(filterBtns.querySelectorAll('.coll-filter-btn'), function (btn) {
    var cat = FILTER_TO_CATEGORY[btn.getAttribute('data-filter')];
    var n = ITEMS.filter(function (it) { return it.category === cat; }).length;
    var span = btn.querySelector('span:last-child');
    if (span) span.textContent = n;
  });

  // ── Image load / error handling ──
  function attachImg(img, wrap) {
    function loaded() {
      img.classList.add('loaded');
      wrap.classList.add('img-ready');
      console.log('[Collections] image loaded:', img.getAttribute('src'));
    }
    if (img.complete && img.naturalWidth > 0) loaded();
    else img.addEventListener('load', loaded);
    img.addEventListener('error', function () {
      wrap.classList.add('img-ready'); // stop shimmer
      wrap.innerHTML =
        '<div class="coll-img-fallback">' +
          '<span class="material-symbols-outlined">diamond</span>' +
          '<span>Jwlzify</span>' +
        '</div>';
    });
  }

  // ── Build one card ──
  function makeCard(item, index) {
    var card = document.createElement('div');
    card.className = 'col-card' + (index >= INITIAL ? ' col-extra' : '');
    card.setAttribute('data-id', item.id);
    card.setAttribute('data-category', item.category);

    var wrap = document.createElement('div');
    wrap.className = 'col-imgwrap';
    var img = document.createElement('img');
    img.className = 'coll-img';
    img.src = 'images/collections/' + item.id + '.jpg';
    img.alt = item.name;
    img.width = 800;
    img.height = 800;
    img.loading = 'lazy';
    wrap.appendChild(img);
    attachImg(img, wrap);

    var body = document.createElement('div');
    body.className = 'col-card-body';
    var title = document.createElement('p');
    title.className = 'col-card-title';
    title.textContent = item.name;
    body.appendChild(title);

    var price = document.createElement('p');
    price.className = 'col-card-price';
    // Cached price shows instantly; otherwise a dash until the batch request lands.
    price.textContent = fmtPrice(cachedPrice(item, item.specs.metalCode));
    body.appendChild(price);

    card.appendChild(wrap);
    card.appendChild(body);
    card.addEventListener('click', function () { openSpecs(item); });
    return card;
  }

  // ── Render a category (resets to first 6 + button) ──
  function render(category) {
    currentCategory = category;
    expanded = false;
    grid.innerHTML = '';
    var items = ITEMS.filter(function (it) { return it.category === category; });
    items.forEach(function (it, i) { grid.appendChild(makeCard(it, i)); });

    // ONE batch request for every not-yet-cached price in this category, then fill
    // the card price lines (skipped entirely when the whole category is cached).
    var uncached = items.filter(function (it) { return cachedPrice(it, it.specs.metalCode) == null; });
    if (uncached.length) {
      fetchPrices(uncached.map(function (it) { return { item: it, metal: it.specs.metalCode }; }))
        .then(function () {
          if (currentCategory !== category) return; // superseded by a tab switch
          items.forEach(function (it) {
            var el = grid.querySelector('.col-card[data-id="' + it.id + '"] .col-card-price');
            if (el) el.textContent = fmtPrice(cachedPrice(it, it.specs.metalCode));
          });
        });
    }

    if (items.length > INITIAL) {
      exploreBtn.style.display = '';
      exploreBtn.textContent = 'EXPLORE MORE MASTERPIECES →';
      exploreBtn.classList.remove('is-expanded');
    } else {
      exploreBtn.style.display = 'none';
    }
    console.log('[Collections] category selected:', category, '| items shown:', Math.min(INITIAL, items.length));
  }

  // ── Explore more / show less ──
  function expand() {
    expanded = true;
    Array.prototype.forEach.call(grid.querySelectorAll('.col-extra'), function (c) { c.classList.add('show'); });
    exploreBtn.textContent = 'SHOW LESS ↑';
    exploreBtn.classList.add('is-expanded');
    console.log('[Collections] explore more:', currentCategory, '| now showing 18');
  }
  function collapse() {
    expanded = false;
    Array.prototype.forEach.call(grid.querySelectorAll('.col-extra'), function (c) { c.classList.remove('show'); });
    exploreBtn.textContent = 'EXPLORE MORE MASTERPIECES →';
    exploreBtn.classList.remove('is-expanded');
  }
  exploreBtn.addEventListener('click', function () { expanded ? collapse() : expand(); });

  // ── Scroll to the top of the collections section (accounts for sticky header) ──
  function scrollToCollectionsTop() {
    var section = grid.closest('section');
    var header = document.getElementById('siteHeader');
    var offset = header ? header.offsetHeight : 0;
    if (section) {
      var top = section.getBoundingClientRect().top + window.pageYOffset - offset - 12;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // ── Tabs ──
  filterBtns.addEventListener('click', function (e) {
    var btn = e.target.closest('.coll-filter-btn');
    if (!btn) return;
    Array.prototype.forEach.call(filterBtns.querySelectorAll('.coll-filter-btn'), function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
    render(FILTER_TO_CATEGORY[btn.getAttribute('data-filter')]); // resets to first 6 + button
    scrollToCollectionsTop();
    console.log('[Collections] category changed, scrolled to top');
  });

  // ── Spec modal ──
  var modal      = document.getElementById('specsModal');
  var mImg       = document.getElementById('specsModalImg');
  var mTitle     = document.getElementById('specsModalTitle');
  var mList      = document.getElementById('specsModalList');
  var mCustomize = document.getElementById('specsCustomizeBtn');
  var mMetalSel  = document.getElementById('specsMetalSelect');
  var mPrice     = document.getElementById('specsPrice');
  // Material/Karat are driven by the selected metal; price is computed (no static range row).
  var SPEC_ROWS = [
    ['Type', 'type'], ['Material', 'material'], ['Karat / Purity', 'karat'],
    ['Stone', 'stone'], ['Stone Size', 'stoneSize'], ['Style', 'style'], ['Weight', 'weight']
  ];

  var _openItem = null;
  var _openMetal = null;

  function renderSpecList(item, metalCode) {
    var s = item.specs || {};
    var m = metalOf(metalCode);
    mList.innerHTML = SPEC_ROWS.map(function (r) {
      var v;
      if (r[1] === 'material')    v = m.display;
      else if (r[1] === 'karat')  v = m.karat;
      else if (r[1] === 'weight') {
        // Weight comes from the worker's derived metalGrams (varies by metal) —
        // shown once the price response lands, a pending dash until then.
        var g = cachedGrams(item, metalCode);
        v = (g != null) ? (g.toFixed(1) + ' g') : '…';
      }
      else v = s[r[1]];
      if (v === undefined || v === null || v === '') return '';
      return '<li><span class="k">' + r[0] + '</span><span class="v">' + v + '</span></li>';
    }).join('');
  }
  function renderMetalSelect(metalCode) {
    if (!mMetalSel) return;
    mMetalSel.innerHTML = METAL_OPTIONS.map(function (m) {
      return '<button class="specs-metal-btn' + (m.code === metalCode ? ' active' : '') +
        '" data-code="' + m.code + '">' + m.display + '</button>';
    }).join('');
  }
  function renderPrice(item, metalCode) {
    if (!mPrice) return;
    var cached = cachedPrice(item, metalCode);
    if (cached != null) { mPrice.textContent = fmtPrice(cached); return; }
    mPrice.textContent = '…';
    fetchPrices([{ item: item, metal: metalCode }]).then(function () {
      // Only paint if the modal still shows this item + metal (guards stale responses).
      if (_openItem === item && _openMetal === metalCode) {
        mPrice.textContent = fmtPrice(cachedPrice(item, metalCode));
        renderSpecList(item, metalCode); // weight row now has the derived grams
      }
    });
  }

  function openSpecs(item) {
    var s = item.specs || {};
    _openItem = item;
    _openMetal = s.metalCode;
    mImg.setAttribute('src', 'images/collections/' + item.id + '.jpg');
    mImg.setAttribute('alt', item.name);
    mTitle.textContent = item.name;
    if (mCustomize) mCustomize.setAttribute('href', 'ailab.html'); // piece is passed via sessionStorage on click
    renderSpecList(item, _openMetal);
    renderMetalSelect(_openMetal);
    renderPrice(item, _openMetal);
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    console.log('[Collections] opened specs for:', item.name);
  }
  function closeSpecs() {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
  if (modal) {
    document.getElementById('specsModalClose').addEventListener('click', closeSpecs);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeSpecs(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('open')) closeSpecs();
    });
  }
  // Switch metal (925 / 10k / 14k) → update material, karat and price live.
  if (mMetalSel) mMetalSel.addEventListener('click', function (e) {
    var b = e.target.closest('.specs-metal-btn');
    if (!b || !_openItem) return;
    _openMetal = b.getAttribute('data-code');
    renderMetalSelect(_openMetal);
    renderSpecList(_openItem, _openMetal);
    renderPrice(_openItem, _openMetal);
  });

  // "Customize This Design" → hand this piece (with the selected metal) to the AI Lab,
  // which loads it straight into the Refine step. Written synchronously before the <a> navigates.
  if (mCustomize) mCustomize.addEventListener('click', function () {
    if (!_openItem) return;
    var s = _openItem.specs || {};
    var payload = {
      id:         _openItem.id,
      type:       s.jewelryType,                 // ring | pendant | earrings | bracelet | necklace
      material:   _openMetal || s.metalCode,     // 925silver | 10ctgold | 14ctgold (AI Lab codes)
      gem:        s.stoneType,                    // lab_diamond | natural_diamond | moissanite_vvsd | none
      style:      s.style,
      imageUrl:   'images/collections/' + _openItem.id + '.jpg',
      grams:      s.grams,
      carats:     s.carats,
      stoneCount: s.stoneCount,
      name:       _openItem.name,
      prompt:     _openItem.desc || _openItem.name
    };
    try { sessionStorage.setItem('jwlz_customize_piece', JSON.stringify(payload)); } catch (e) {}
    console.log('[Collections] customize → AI Lab refine:', _openItem.id, '| metal:', payload.material);
  });

  // ── Init ──
  console.log('[Collections] tab theme updated to site palette');
  // Default view: Rings. Prices arrive from the calc-price worker's batch response —
  // no fallback-then-live double render needed (the worker prices with its own live
  // spot on the very first request).
  render('ring');
})();
