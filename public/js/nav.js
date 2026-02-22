// ── Shared Nav Component ──────────────────────
// Include on every page after the <nav> element
(function() {
  var token = localStorage.getItem('auth_token');
  var nav = document.querySelector('.nav-inner');
  if (!nav) return;

  // ── Add hamburger button ──
  var burger = document.createElement('button');
  burger.className = 'nav-burger';
  burger.setAttribute('aria-label', 'Menu');
  burger.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
  nav.appendChild(burger);

  // ── Determine current page ──
  var path = window.location.pathname;
  var page = path.split('/').pop().replace('.html', '') || 'index';

  // ── Detect if this is the landing page ──
  var isLanding = (page === 'index' || path === '/');

  // ── Build mobile drawer ──
  var overlay = document.createElement('div');
  overlay.className = 'nav-mobile-overlay';
  document.body.appendChild(overlay);

  var drawer = document.createElement('div');
  drawer.className = 'nav-mobile-drawer';

  // Drawer header
  drawer.innerHTML = '<div class="nav-drawer-header">' +
    '<a href="/" class="nav-drawer-brand">' +
      '<span style="font-weight:800;font-size:1.05rem">Event <span style="color:var(--p)">Medium</span></span>' +
    '</a>' +
    '<button class="nav-drawer-close" aria-label="Close">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
    '</button>' +
  '</div>';

  // Build links
  var linksHTML = '<div class="nav-drawer-links">';

  if (isLanding) {
    // Landing page links
    linksHTML += '<a href="#how"><i data-lucide="zap"></i> How it works</a>';
    linksHTML += '<a href="#types"><i data-lucide="users"></i> Who it\'s for</a>';
    linksHTML += '<a href="#organisers"><i data-lucide="building-2"></i> Organisers</a>';
    linksHTML += '<a href="/events.html"><i data-lucide="calendar"></i> Browse Events</a>';
  } else {
    // App page links
    linksHTML += '<a href="/events.html"' + (page === 'events' ? ' class="active"' : '') + '><i data-lucide="calendar"></i> Events</a>';
  }

  // Auth-dependent links
  if (token) {
    linksHTML += '<div class="nav-drawer-divider"></div>';
    linksHTML += '<a href="/matches.html"' + (page === 'matches' ? ' class="active"' : '') + '><i data-lucide="heart-handshake"></i> Matches</a>';
    linksHTML += '<a href="/inbox.html"' + (page === 'inbox' ? ' class="active"' : '') + '><i data-lucide="inbox"></i> Inbox</a>';
    linksHTML += '<a href="/canister.html"' + (page === 'canister' ? ' class="active"' : '') + '><i data-lucide="user"></i> My Canister</a>';
  }

  linksHTML += '</div>';
  drawer.innerHTML += linksHTML;

  // CTA button
  if (token) {
    drawer.innerHTML += '<a href="/canister.html" class="nav-drawer-cta">My Canister</a>';
  } else {
    drawer.innerHTML += '<a href="/auth.html" class="nav-drawer-cta">Get Started</a>';
  }

  document.body.appendChild(drawer);

  // ── Desktop nav auth state ──
  var navMatches = document.getElementById('nav-matches');
  var navInbox = document.getElementById('nav-inbox');
  var navCanister = document.getElementById('nav-canister');
  var navCta = document.getElementById('nav-cta');
  var navLogin = document.getElementById('nav-login');

  if (token) {
    if (navMatches) navMatches.style.display = '';
    if (navInbox) navInbox.style.display = '';
    if (navCanister) navCanister.style.display = '';
    if (navCta) { navCta.textContent = 'My Canister'; navCta.href = '/canister.html'; }
    if (navLogin) { navLogin.href = '/matches.html'; navLogin.textContent = 'My Matches'; }
  } else {
    if (navMatches) navMatches.style.display = 'none';
    if (navInbox) navInbox.style.display = 'none';
    if (navCanister) navCanister.style.display = 'none';
  }

  // ── Toggle handlers ──
  function openDrawer() {
    overlay.classList.add('open');
    drawer.classList.add('open');
    document.body.style.overflow = 'hidden';
    // Re-render icons in drawer
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function closeDrawer() {
    overlay.classList.remove('open');
    drawer.classList.remove('open');
    document.body.style.overflow = '';
  }

  burger.addEventListener('click', openDrawer);
  overlay.addEventListener('click', closeDrawer);
  drawer.querySelector('.nav-drawer-close').addEventListener('click', closeDrawer);

  // Close on link click (for anchor links on landing page)
  drawer.querySelectorAll('a').forEach(function(a) {
    a.addEventListener('click', closeDrawer);
  });

  // Close on escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeDrawer();
  });
})();
