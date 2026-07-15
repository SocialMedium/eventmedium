/* ── EventMedium Embeddable Events Widget ─────────────────────────────────────
 * Drop-in snippet for any site:
 *
 *   <script src="https://www.eventmedium.ai/widget.js"
 *           data-theme="AI" data-city="London" data-limit="5"></script>
 *
 * Attributes (all optional):
 *   data-theme   filter by theme (AI, FinTech, Climate, ...)
 *   data-city    filter by city
 *   data-region  filter by country
 *   data-limit   number of events (default 5, max 20)
 *   data-title   widget heading (default "Upcoming Events")
 *
 * Renders inside a Shadow DOM so host page CSS is unaffected.
 * Every card links back to eventmedium.ai; footer CTA routes to Nev.
 */
(function() {
  var script = document.currentScript;
  if (!script) return;

  var ORIGIN = (function() {
    try { return new URL(script.src).origin; } catch (e) { return 'https://www.eventmedium.ai'; }
  })();

  var theme = script.getAttribute('data-theme') || '';
  var city = script.getAttribute('data-city') || '';
  var region = script.getAttribute('data-region') || '';
  var limit = Math.min(parseInt(script.getAttribute('data-limit') || '5', 10) || 5, 20);
  var title = script.getAttribute('data-title') || 'Upcoming Events';

  var utm = 'utm_source=widget&utm_medium=embed&utm_campaign=canister';

  var host = document.createElement('div');
  host.setAttribute('data-eventmedium-widget', '');
  script.parentNode.insertBefore(host, script.nextSibling);
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var css =
    '.emw{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;max-width:420px;background:#fff;color:#111827}' +
    '.emw-head{padding:14px 16px;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;justify-content:space-between}' +
    '.emw-head h3{margin:0;font-size:15px;font-weight:700}' +
    '.emw-brand{font-size:11px;font-weight:700;color:#6366f1;text-decoration:none}' +
    '.emw-list{margin:0;padding:0;list-style:none}' +
    '.emw-item{display:flex;gap:12px;padding:12px 16px;border-bottom:1px solid #f3f4f6;text-decoration:none;color:inherit;align-items:flex-start}' +
    '.emw-item:hover{background:#f9fafb}' +
    '.emw-img{width:36px;height:36px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#eef2ff;border:1px solid #e5e7eb}' +
    '.emw-name{font-size:13px;font-weight:600;line-height:1.3;margin:0 0 3px}' +
    '.emw-meta{font-size:11.5px;color:#6b7280;margin:0}' +
    '.emw-cta{display:block;text-align:center;padding:12px 16px;background:#6366f1;color:#fff;font-size:13px;font-weight:600;text-decoration:none}' +
    '.emw-cta:hover{background:#4f46e5}' +
    '.emw-empty,.emw-loading{padding:20px 16px;font-size:13px;color:#6b7280;text-align:center}';

  var wrap = document.createElement('div');
  wrap.className = 'emw';
  wrap.innerHTML = '<style>' + css + '</style>' +
    '<div class="emw-head"><h3></h3>' +
    '<a class="emw-brand" target="_blank" rel="noopener" href="' + ORIGIN + '/events.html?' + utm + '">EventMedium</a></div>' +
    '<div class="emw-loading">Loading events…</div>';
  wrap.querySelector('h3').textContent = title;
  root.appendChild(wrap);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(d) {
    if (!d) return 'TBD';
    try {
      return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return d; }
  }

  var qs = '?limit=' + limit +
    (theme ? '&theme=' + encodeURIComponent(theme) : '') +
    (city ? '&city=' + encodeURIComponent(city) : '') +
    (region ? '&region=' + encodeURIComponent(region) : '');

  fetch(ORIGIN + '/api/events/feed.json' + qs)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var loading = wrap.querySelector('.emw-loading');
      if (loading) loading.remove();

      var events = (data.events || []).slice(0, limit);
      if (!events.length) {
        wrap.insertAdjacentHTML('beforeend', '<div class="emw-empty">No upcoming events found.</div>');
        return;
      }

      var list = document.createElement('ul');
      list.className = 'emw-list';
      list.innerHTML = events.map(function(e) {
        var loc = [e.city, e.country].filter(Boolean).join(', ');
        var img = e.image
          ? '<img class="emw-img" src="' + esc(e.image) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">'
          : '<span class="emw-img"></span>';
        return '<li><a class="emw-item" target="_blank" rel="noopener" href="' + esc(e.url) + (e.url.indexOf('?') > -1 ? '&' : '?') + utm + '">' +
          img +
          '<span><span class="emw-name">' + esc(e.name) + '</span><br>' +
          '<span class="emw-meta">' + esc(fmtDate(e.date)) + (loc ? ' · ' + esc(loc) : '') + '</span></span>' +
          '</a></li>';
      }).join('');
      wrap.appendChild(list);

      var ctaUrl = (data.canister_cta && data.canister_cta.url) || (ORIGIN + '/auth.html?' + utm);
      wrap.insertAdjacentHTML('beforeend',
        '<a class="emw-cta" target="_blank" rel="noopener" href="' + esc(ctaUrl) + '">Going? Get matched by Nev →</a>');
    })
    .catch(function() {
      var loading = wrap.querySelector('.emw-loading');
      if (loading) loading.textContent = 'Could not load events.';
    });
})();
