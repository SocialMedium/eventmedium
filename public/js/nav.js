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
  var isLanding = (page === 'index' || path === '/');

  // ── Logout handler ──
  function doLogout(e) {
    if (e) e.preventDefault();
    var t = localStorage.getItem('auth_token');
    localStorage.removeItem('auth_token');
    if (t) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + t }
      }).catch(function() {});
    }
    window.location.href = '/auth.html';
  }

  // ── Fix any existing logout links in the page ──
  document.querySelectorAll('a[href*="logout"], a[href*="eventmedium.html"]').forEach(function(a) {
    a.href = '#';
    a.addEventListener('click', doLogout);
  });

  // ── Add logout to desktop nav if logged in ──
  if (token) {
    var navLogout = document.getElementById('nav-logout');
    if (navLogout) {
      navLogout.href = '#';
      navLogout.addEventListener('click', doLogout);
    } else {
      // No logout link exists — inject one at end of nav
      var existingLinks = nav.querySelectorAll('.nav-link, .nav-cta');
      if (existingLinks.length > 0) {
        var logoutLink = document.createElement('a');
        logoutLink.href = '#';
        logoutLink.className = 'nav-link';
        logoutLink.textContent = 'Log out';
        logoutLink.style.cssText = 'color:#999;font-size:13px';
        logoutLink.addEventListener('click', doLogout);
        // Insert before burger (which is last child)
        nav.insertBefore(logoutLink, burger);
      }
    }
  }

  // ── Build mobile drawer ──
  var overlay = document.createElement('div');
  overlay.className = 'nav-mobile-overlay';
  document.body.appendChild(overlay);

  var drawer = document.createElement('div');
  drawer.className = 'nav-mobile-drawer';

  // Drawer header
  drawer.innerHTML = '<div class="nav-drawer-header">' +
    '<a href="/" class="nav-drawer-brand">' +
      '<span style="font-weight:800;font-size:1.05rem">Event <span style="color:var(--p,#6366f1)">Medium</span></span>' +
    '</a>' +
    '<button class="nav-drawer-close" aria-label="Close">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
    '</button>' +
  '</div>';

  // Build links
  var linksHTML = '<div class="nav-drawer-links">';

  if (isLanding) {
    linksHTML += '<a href="#how"><i data-lucide="zap"></i> How it works</a>';
    linksHTML += '<a href="#types"><i data-lucide="users"></i> Who it\'s for</a>';
    linksHTML += '<a href="#organisers"><i data-lucide="building-2"></i> Organisers</a>';
    linksHTML += '<a href="/events.html"><i data-lucide="calendar"></i> Browse Events</a>';
  } else {
    linksHTML += '<a href="/events.html"' + (page === 'events' ? ' class="active"' : '') + '><i data-lucide="calendar"></i> Events</a>';
  }

  if (token) {
    linksHTML += '<div class="nav-drawer-divider"></div>';
    linksHTML += '<a href="/matches.html"' + (page === 'matches' ? ' class="active"' : '') + '><i data-lucide="heart-handshake"></i> Matches</a>';
    linksHTML += '<a href="/inbox.html"' + (page === 'inbox' ? ' class="active"' : '') + '><i data-lucide="inbox"></i> Inbox</a>';
    linksHTML += '<a href="/canister.html"' + (page === 'canister' ? ' class="active"' : '') + '><i data-lucide="user"></i> My Canister</a>';
    linksHTML += '<div class="nav-drawer-divider"></div>';
    linksHTML += '<a href="#" class="nav-logout-mobile"><i data-lucide="log-out"></i> Log out</a>';
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

  // ── Attach logout to mobile drawer link ──
  var mobileLogout = drawer.querySelector('.nav-logout-mobile');
  if (mobileLogout) {
    mobileLogout.addEventListener('click', doLogout);
  }

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

  drawer.querySelectorAll('a:not(.nav-logout-mobile)').forEach(function(a) {
    a.addEventListener('click', closeDrawer);
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeDrawer();
  });
})();
