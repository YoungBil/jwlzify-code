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
  var SPEC_ROWS = [
    ['Type', 'type'], ['Material', 'material'], ['Karat / Purity', 'karat'],
    ['Stone', 'stone'], ['Stone Size', 'stoneSize'], ['Style', 'style'],
    ['Weight', 'weight'], ['Price Range', 'priceRange']
  ];

  function openSpecs(item) {
    var s = item.specs || {};
    mImg.setAttribute('src', 'images/collections/' + item.id + '.jpg');
    mImg.setAttribute('alt', item.name);
    mTitle.textContent = item.name;
    if (mCustomize) mCustomize.setAttribute('href', 'ailab.html?type=' + encodeURIComponent((s.type || '').toLowerCase()));
    mList.innerHTML = SPEC_ROWS.map(function (r) {
      var v = s[r[1]];
      if (v === undefined || v === null || v === '') return '';
      var cls = r[1] === 'priceRange' ? 'v price' : 'v';
      return '<li><span class="k">' + r[0] + '</span><span class="' + cls + '">' + v + '</span></li>';
    }).join('');
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

  // ── Init ──
  console.log('[Collections] tab theme updated to site palette');
  render('ring'); // default view: Rings
})();
