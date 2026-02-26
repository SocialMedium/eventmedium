#!/usr/bin/env python3
"""Insert sidecar events code into routes/events.js and public/events.html"""

import sys

# ── 1. PATCH routes/events.js ──

print("Patching routes/events.js...")
with open("routes/events.js", "r") as f:
    js = f.read()

sidecar_routes = '''
// ── SIDECAR EVENTS ───────────────────────────────────────

// GET /api/events/:id/sidecars
router.get('/:id/sidecars', async function(req, res) {
  try {
    var eventId = parseInt(req.params.id);
    if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid event ID' });

    var parent = await dbGet('SELECT id, name, slug FROM events WHERE id = $1', [eventId]);
    if (!parent) return res.status(404).json({ error: 'Event not found' });

    var sidecars = await dbAll(
      `SELECT id, name, organizer, description, event_date, start_time, end_time,
              venue_name, venue_address, cost, tags, themes, source_url,
              food, bar, notes, invite_only
       FROM sidecar_events WHERE parent_event_id = $1
       ORDER BY event_date ASC, start_time ASC`, [eventId]);

    var stats = await dbGet(
      `SELECT COUNT(*) as total, COUNT(DISTINCT event_date) as days,
              COUNT(*) FILTER (WHERE cost = 'Free') as free_count,
              COUNT(*) FILTER (WHERE invite_only = TRUE) as invite_only_count
       FROM sidecar_events WHERE parent_event_id = $1`, [eventId]);

    res.json({
      parent: parent,
      stats: { total: parseInt(stats.total), days: parseInt(stats.days), free: parseInt(stats.free_count), invite_only: parseInt(stats.invite_only_count) },
      sidecars: sidecars
    });
  } catch (err) {
    console.error('Sidecar fetch error:', err);
    res.status(500).json({ error: 'Failed to load sidecar events' });
  }
});

// GET /api/events/:id/sidecar-count
router.get('/:id/sidecar-count', async function(req, res) {
  try {
    var result = await dbGet('SELECT COUNT(*) as count FROM sidecar_events WHERE parent_event_id = $1', [parseInt(req.params.id)]);
    res.json({ count: parseInt(result.count) });
  } catch (err) {
    res.json({ count: 0 });
  }
});

'''

if '/:id/sidecar-count' in js:
    print("  ✓ Sidecar routes already present, skipping.")
else:
    js = js.replace('module.exports = { router };', sidecar_routes + 'module.exports = { router };')
    with open("routes/events.js", "w") as f:
        f.write(js)
    print("  ✓ Sidecar routes inserted.")


# ── 2. PATCH public/events.html ──

print("Patching public/events.html...")
with open("public/events.html", "r") as f:
    html = f.read()

# Edit 1: Add sidecar button to event card
old_calendar_btn = "(isRegistered ? '<button class=\"share-icon-btn\" style=\"background:var(--pL);color:var(--p)\" onclick=\"event.stopPropagation();openShareForEvent(' + e.id + ')\" title=\"Add to Calendar\"><i data-lucide=\"calendar-plus\"></i></button>' : '') +"
sidecar_btn = """'<button class=\"share-icon-btn btn-sidecar-card\" onclick=\"event.stopPropagation();openSidecars(' + e.id + ')\" title=\"Sidecar Events\" style=\"display:none\" id=\"sidecar-btn-' + e.id + '\"><i data-lucide=\"layers\"></i><span class=\"sidecar-badge-count\" id=\"sidecar-count-' + e.id + '\"></span></button>' +
          """

if 'btn-sidecar-card' in html:
    print("  ✓ Sidecar button already present, skipping.")
else:
    if old_calendar_btn in html:
        html = html.replace(old_calendar_btn, sidecar_btn + old_calendar_btn)
        print("  ✓ Sidecar button inserted into event cards.")
    else:
        print("  ✗ Could not find calendar button marker. Manual edit needed for button.")

# Edit 2: Add loadSidecarCounts() call at end of renderEvents
old_create_icons = """  lucide.createIcons();
}

function goPage"""

new_create_icons = """  lucide.createIcons();
  loadSidecarCounts();
}

function goPage"""

if 'loadSidecarCounts' in html:
    print("  ✓ loadSidecarCounts call already present, skipping.")
else:
    if old_create_icons in html:
        html = html.replace(old_create_icons, new_create_icons)
        print("  ✓ loadSidecarCounts() call inserted.")
    else:
        print("  ✗ Could not find renderEvents closing marker. Manual edit needed.")

# Edit 3: Add panel HTML + CSS + JS before </body>
sidecar_panel = '''
<!-- ── SIDECAR EVENTS PANEL ── -->
<div id="sidecar-panel" class="sidecar-panel">
  <div class="sidecar-panel-backdrop" onclick="closeSidecars()"></div>
  <div class="sidecar-panel-content">
    <div class="sidecar-header">
      <div>
        <div class="sidecar-label">SIDECAR EVENTS</div>
        <h2 id="sidecar-parent-name"></h2>
      </div>
      <button class="sidecar-close" onclick="closeSidecars()"><i data-lucide="x" style="width:20px;height:20px"></i></button>
    </div>
    <div class="sidecar-stats" id="sidecar-stats"></div>
    <div class="sidecar-filters" id="sidecar-filters"></div>
    <div class="sidecar-body" id="sidecar-body">
      <div class="sidecar-loading">Loading sidecar events...</div>
    </div>
  </div>
</div>

<style>
.btn-sidecar-card{position:relative}
.sidecar-badge-count{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;border-radius:9px;background:#6366f1;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 4px}
.sidecar-badge-count:empty{display:none}
.sidecar-panel{display:none;position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000}
.sidecar-panel.open{display:flex}
.sidecar-panel-backdrop{position:absolute;inset:0;background:rgba(0,0,0,0.4);animation:sidecarFade .2s ease}
.sidecar-panel-content{position:absolute;right:0;top:0;bottom:0;width:min(520px,90vw);background:#fff;box-shadow:-4px 0 24px rgba(0,0,0,0.15);display:flex;flex-direction:column;animation:sidecarSlide .25s ease;overflow:hidden}
@keyframes sidecarFade{from{opacity:0}to{opacity:1}}
@keyframes sidecarSlide{from{transform:translateX(100%)}to{transform:translateX(0)}}
.sidecar-header{display:flex;justify-content:space-between;align-items:flex-start;padding:20px 24px 16px;border-bottom:1px solid #eee}
.sidecar-label{font-size:11px;font-weight:600;letter-spacing:1.5px;color:#6366f1;margin-bottom:4px}
.sidecar-header h2{margin:0;font-size:18px;font-weight:600;color:#1a1a2e}
.sidecar-close{background:none;border:none;cursor:pointer;padding:4px;color:#888;border-radius:6px}
.sidecar-close:hover{background:#f0f0f0;color:#333}
.sidecar-stats{display:flex;gap:16px;padding:12px 24px;background:#fafafa;border-bottom:1px solid #eee;font-size:13px;color:#666}
.sidecar-stat strong{color:#1a1a2e;font-weight:600}
.sidecar-filters{display:flex;flex-wrap:wrap;gap:6px;padding:12px 24px;border-bottom:1px solid #eee}
.sidecar-chip{padding:4px 12px;border-radius:14px;border:1px solid #e0e0e0;background:#fff;font-size:12px;color:#555;cursor:pointer;transition:all .15s}
.sidecar-chip:hover,.sidecar-chip.active{background:#6366f1;color:#fff;border-color:#6366f1}
.sidecar-body{flex:1;overflow-y:auto}
.sidecar-loading{text-align:center;padding:40px;color:#999;font-size:14px}
.sidecar-day-header{position:sticky;top:0;background:#f7f7f8;padding:10px 24px;font-size:13px;font-weight:600;color:#1a1a2e;border-bottom:1px solid #eee;z-index:1}
.sidecar-day-count{float:right;color:#999;font-weight:400}
.sidecar-event{padding:14px 24px;border-bottom:1px solid #f0f0f0;transition:background .15s}
.sidecar-event:hover{background:#fafafa}
.sidecar-event-time{font-size:12px;color:#6366f1;font-weight:600;margin-bottom:2px}
.sidecar-event-name{font-size:14px;font-weight:600;color:#1a1a2e;margin-bottom:2px}
.sidecar-event-name a{color:inherit;text-decoration:none}
.sidecar-event-name a:hover{text-decoration:underline}
.sidecar-event-org{font-size:12px;color:#888;margin-bottom:6px}
.sidecar-event-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:11px}
.sidecar-badge{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:10px;background:#f0f0f0;color:#666}
.sidecar-badge.free{background:#dcfce7;color:#166534}
.sidecar-badge.paid{background:#fef3c7;color:#92400e}
.sidecar-badge.invite{background:#fce7f3;color:#9d174d}
@media(max-width:600px){.sidecar-panel-content{width:100vw}}
</style>

<script>
var sidecarData = null;
var sidecarFilter = null;

async function loadSidecarCounts() {
  var btns = document.querySelectorAll('.btn-sidecar-card');
  for (var i = 0; i < btns.length; i++) {
    var btn = btns[i];
    var id = btn.id.replace('sidecar-btn-', '');
    try {
      var resp = await fetch('/api/events/' + id + '/sidecar-count');
      var data = await resp.json();
      if (data.count > 0) {
        document.getElementById('sidecar-count-' + id).textContent = data.count;
        btn.style.display = 'inline-flex';
      }
    } catch(e) {}
  }
}

async function openSidecars(eventId) {
  var panel = document.getElementById('sidecar-panel');
  document.getElementById('sidecar-body').innerHTML = '<div class="sidecar-loading">Loading sidecar events...</div>';
  panel.classList.add('open');
  document.body.style.overflow = 'hidden';
  try {
    var resp = await fetch('/api/events/' + eventId + '/sidecars');
    sidecarData = await resp.json();
    sidecarFilter = null;
    document.getElementById('sidecar-parent-name').textContent = sidecarData.parent.name;
    var s = sidecarData.stats;
    document.getElementById('sidecar-stats').innerHTML =
      '<span class="sidecar-stat"><strong>' + s.total + '</strong> events</span>' +
      '<span class="sidecar-stat"><strong>' + s.days + '</strong> days</span>' +
      '<span class="sidecar-stat"><strong>' + s.free + '</strong> free</span>' +
      (s.invite_only > 0 ? '<span class="sidecar-stat"><strong>' + s.invite_only + '</strong> invite-only</span>' : '');
    buildFilterChips(sidecarData.sidecars);
    renderSidecars(sidecarData.sidecars);
  } catch(e) {
    document.getElementById('sidecar-body').innerHTML = '<div class="sidecar-loading">Failed to load sidecar events.</div>';
  }
}

function closeSidecars() {
  document.getElementById('sidecar-panel').classList.remove('open');
  document.body.style.overflow = '';
}

function buildFilterChips(sidecars) {
  var counts = {};
  var filterTags = ['Conference','Networking','Party','Hackathon','Brunch','Wellness','VCs/Angels','Devs/Builders','DeFi','AI','RWA'];
  sidecars.forEach(function(s) {
    var tags = Array.isArray(s.tags) ? s.tags : JSON.parse(s.tags || '[]');
    tags.forEach(function(t) { if (filterTags.indexOf(t) !== -1) counts[t] = (counts[t] || 0) + 1; });
  });
  var sorted = Object.keys(counts).sort(function(a,b) { return counts[b] - counts[a]; }).slice(0, 8);
  var html = '<span class="sidecar-chip active" onclick="filterSidecars(null)">All</span>';
  sorted.forEach(function(t) { html += '<span class="sidecar-chip" onclick="filterSidecars(\\'' + t + '\\')">' + t + '</span>'; });
  document.getElementById('sidecar-filters').innerHTML = html;
}

function filterSidecars(tag) {
  sidecarFilter = tag;
  document.querySelectorAll('.sidecar-chip').forEach(function(c) {
    c.classList.remove('active');
    if ((!tag && c.textContent === 'All') || c.textContent === tag) c.classList.add('active');
  });
  var filtered = sidecarData.sidecars;
  if (tag) filtered = filtered.filter(function(s) {
    var tags = Array.isArray(s.tags) ? s.tags : JSON.parse(s.tags || '[]');
    return tags.indexOf(tag) !== -1;
  });
  renderSidecars(filtered);
}

function renderSidecars(sidecars) {
  var body = document.getElementById('sidecar-body');
  if (!sidecars.length) { body.innerHTML = '<div class="sidecar-loading">No events match this filter.</div>'; return; }
  var days = {};
  sidecars.forEach(function(s) { var d = (s.event_date || '').split('T')[0]; if (!days[d]) days[d] = []; days[d].push(s); });
  var dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var html = '';
  Object.keys(days).sort().forEach(function(dateStr) {
    var evts = days[dateStr];
    var d = new Date(dateStr + 'T12:00:00');
    var label = dayNames[d.getDay()] + ', ' + monthNames[d.getMonth()] + ' ' + d.getDate();
    html += '<div class="sidecar-day-header">' + label + '<span class="sidecar-day-count">' + evts.length + ' event' + (evts.length !== 1 ? 's' : '') + '</span></div>';
    evts.forEach(function(ev) {
      var st = ev.start_time ? fmtTime(ev.start_time) : '';
      var et = ev.end_time ? fmtTime(ev.end_time) : '';
      var time = st + (et ? ' \\u2013 ' + et : '');
      var cost = ev.cost === 'Free' ? '<span class="sidecar-badge free">Free</span>' : (ev.cost && ev.cost !== 'TBA' ? '<span class="sidecar-badge paid">' + ev.cost + '</span>' : '');
      var inv = ev.invite_only ? '<span class="sidecar-badge invite">Invite Only</span>' : '';
      var ven = ev.venue_name ? '<span class="sidecar-badge">' + ev.venue_name + '</span>' : '';
      html += '<div class="sidecar-event">' +
        (time ? '<div class="sidecar-event-time">' + time + '</div>' : '') +
        '<div class="sidecar-event-name">' + (ev.source_url ? '<a href="' + ev.source_url + '" target="_blank">' + ev.name + '</a>' : ev.name) + '</div>' +
        (ev.organizer ? '<div class="sidecar-event-org">by ' + ev.organizer + '</div>' : '') +
        '<div class="sidecar-event-meta">' + cost + inv + ven + '</div></div>';
    });
  });
  body.innerHTML = html;
}

function fmtTime(t) { if (!t) return ''; var p = t.split(':'); var h = parseInt(p[0]); var m = p[1] || '00'; var s = h >= 12 ? 'p' : 'a'; if (h > 12) h -= 12; if (h === 0) h = 12; return h + (m !== '00' ? ':' + m : '') + s; }

document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeSidecars(); });
</script>

'''

if 'sidecar-panel' in html:
    print("  ✓ Sidecar panel already present, skipping.")
else:
    html = html.replace('<script src="/js/nav.js"></script></body>', sidecar_panel + '<script src="/js/nav.js"></script></body>')
    print("  ✓ Sidecar panel + CSS + JS inserted.")

with open("public/events.html", "w") as f:
    f.write(html)

print("\n✅ All patches applied. Deploy with:")
print("  git add routes/events.js public/events.html")
print('  git commit -m "feat: sidecar events button + panel"')
print("  git push")
