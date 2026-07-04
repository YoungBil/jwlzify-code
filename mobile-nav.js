/* ════════════════════════════════════════════════
   Shared mobile navigation (hamburger) for JWLZIFY
   - Wires the existing .lg:hidden "menu" button on every page
   - Injects a slide-in panel with the same links as desktop nav
   - Self-contained: builds its own CSS + DOM, no per-page markup
   ════════════════════════════════════════════════ */
(function () {
  var NAVY = '#0B0F1A';
  var GOLD = '#C9A84C';

  var LINKS = [
    { label: 'Home',        href: 'index.html' },
    { label: 'Collections', href: 'collections.html' },
    { label: 'AI Lab',      href: 'ailab.html' },
    { label: 'About Us',    href: 'about.html' },
    { label: 'Support',     href: 'support.html' },
    { label: 'My Account',  href: 'account.html' }
  ];

  function currentFile() {
    var p = location.pathname.split('/').pop();
    return (!p || p === '') ? 'index.html' : p;
  }

  function injectStyles() {
    if (document.getElementById('mnav-styles')) return;
    var css = '' +
      '.mnav-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.55);opacity:0;pointer-events:none;transition:opacity .3s ease;z-index:1998;}' +
      '.mnav-backdrop.open{opacity:1;pointer-events:auto;}' +
      '.mnav-panel{position:fixed;top:0;right:0;height:100%;width:min(84vw,340px);background:' + NAVY + ';transform:translateX(100%);transition:transform .32s cubic-bezier(.4,0,.2,1);z-index:1999;display:flex;flex-direction:column;box-shadow:-8px 0 44px rgba(0,0,0,.45);}' +
      '.mnav-panel.open{transform:translateX(0);}' +
      '.mnav-head{display:flex;align-items:center;justify-content:space-between;padding:22px 24px;border-bottom:1px solid rgba(201,168,76,0.18);}' +
      '.mnav-brand{font-family:"Playfair Display",serif;font-size:20px;font-weight:600;letter-spacing:0.28em;color:#fff;text-transform:uppercase;text-decoration:none;}' +
      '.mnav-close{background:none;border:none;color:' + GOLD + ';cursor:pointer;display:flex;padding:4px;line-height:0;}' +
      '.mnav-links{display:flex;flex-direction:column;padding:14px 0;flex:1;overflow-y:auto;}' +
      '.mnav-links a{font-family:"Inter",sans-serif;font-size:15px;font-weight:500;letter-spacing:0.03em;color:rgba(255,255,255,0.86);padding:16px 28px;text-decoration:none;border-left:3px solid transparent;transition:background .2s,color .2s,border-color .2s;}' +
      '.mnav-links a:hover{background:rgba(201,168,76,0.08);color:' + GOLD + ';}' +
      '.mnav-links a.mnav-active{color:' + GOLD + ';border-left-color:' + GOLD + ';font-weight:600;}' +
      '.mnav-actions{padding:20px 24px 34px;border-top:1px solid rgba(201,168,76,0.18);display:flex;flex-direction:column;gap:12px;}' +
      '.mnav-generate{background:' + GOLD + ';color:' + NAVY + ';font-family:"Inter",sans-serif;font-weight:700;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;text-align:center;padding:14px;border-radius:8px;text-decoration:none;}' +
      '.mnav-signin{background:transparent;border:1px solid rgba(201,168,76,0.5);color:' + GOLD + ';font-family:"Inter",sans-serif;font-weight:600;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;padding:13px;border-radius:8px;cursor:pointer;text-align:center;}' +
      'body.mnav-open{overflow:hidden;}' +
      '.mnav-injected-toggle{background:none;border:none;color:#1b1c1c;cursor:pointer;display:flex;line-height:0;}' +
      '@media(min-width:1024px){.mnav-panel,.mnav-backdrop{display:none !important;}.mnav-injected-toggle{display:none !important;}}';
    var style = document.createElement('style');
    style.id = 'mnav-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildMenu() {
    var here = currentFile();

    var backdrop = document.createElement('div');
    backdrop.className = 'mnav-backdrop';

    var panel = document.createElement('aside');
    panel.className = 'mnav-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Mobile navigation');

    var head = document.createElement('div');
    head.className = 'mnav-head';
    var brand = document.createElement('a');
    brand.className = 'mnav-brand';
    brand.href = 'index.html';
    brand.textContent = 'JWLZIFY';
    var close = document.createElement('button');
    close.className = 'mnav-close';
    close.setAttribute('aria-label', 'Close menu');
    close.innerHTML = '<span class="material-symbols-outlined">close</span>';
    head.appendChild(brand);
    head.appendChild(close);

    var links = document.createElement('nav');
    links.className = 'mnav-links';
    LINKS.forEach(function (l) {
      var a = document.createElement('a');
      a.href = l.href;
      a.textContent = l.label;
      if (l.href === here) a.className = 'mnav-active';
      links.appendChild(a);
    });

    var actions = document.createElement('div');
    actions.className = 'mnav-actions';
    var gen = document.createElement('a');
    gen.className = 'mnav-generate';
    gen.href = 'ailab.html';
    gen.textContent = 'Generate';
    var signin = document.createElement('button');
    signin.className = 'mnav-signin';
    signin.textContent = 'Sign In';
    signin.addEventListener('click', function () {
      if (typeof signInWithGoogle === 'function') signInWithGoogle();
      else window.location.href = 'account.html';
    });
    actions.appendChild(gen);
    actions.appendChild(signin);

    panel.appendChild(head);
    panel.appendChild(links);
    panel.appendChild(actions);

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    return { panel: panel, backdrop: backdrop, close: close, links: links };
  }

  function init() {
    var header = document.getElementById('siteHeader');
    if (!header) return;

    injectStyles();
    var menu = buildMenu();

    var isOpen = false;
    function setOpen(open) {
      isOpen = open;
      menu.panel.classList.toggle('open', open);
      menu.backdrop.classList.toggle('open', open);
      document.body.classList.toggle('mnav-open', open);
      console.log('[Nav] mobile menu toggled:', isOpen);
    }

    // Find the existing hamburger; if the page has none, inject one.
    var toggles = header.querySelectorAll('button[aria-label="Menu"]');
    if (!toggles.length) {
      var btn = document.createElement('button');
      btn.setAttribute('aria-label', 'Menu');
      btn.className = 'lg:hidden mnav-injected-toggle';
      btn.innerHTML = '<span class="material-symbols-outlined">menu</span>';
      var actionsBar = header.querySelector('nav > div:last-child') || header.querySelector('nav');
      actionsBar.appendChild(btn);
      toggles = [btn];
    }

    toggles.forEach(function (t) {
      t.addEventListener('click', function (e) {
        e.preventDefault();
        setOpen(!isOpen);
      });
    });

    menu.close.addEventListener('click', function () { setOpen(false); });
    menu.backdrop.addEventListener('click', function () { setOpen(false); });
    menu.links.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) setOpen(false);
    });
    window.addEventListener('resize', function () {
      if (isOpen && window.innerWidth >= 1024) setOpen(false);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
