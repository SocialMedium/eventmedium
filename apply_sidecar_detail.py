#!/usr/bin/env python3
"""Patch public/event.html with sidecar events button + panel + ticket links"""

print("Patching public/event.html...")
with open("public/event.html", "r") as f:
    html = f.read()

# ── 1. Add sidecar button next to "Add to calendar" in the actions bar ──

old_calendar = """(isRegistered ? '<button class="btn-secondary" onclick="openCalendarModal()"><i data-lucide="calendar-plus"></i> Add to calendar</button>' : '') +"""

new_calendar = """(isRegistered ? '<button class="btn-secondary" onclick="openCalendarModal()"><i data-lucide="calendar-plus"></i> Add to calendar</button>' : '') +
        '<button class="btn-secondary btn-sidecar-detail" id="sidecar-detail-btn" style="display:none" onclick="openSidecars(' + e.id + ')"><i data-lucide="layers"></i> <span id="sidecar-detail-label">Sidecar Events</span></button>' +"""

if 'btn-sidecar-detail' in html:
    print("  ✓ Sidecar button already present, skipping.")
else:
    if old_calendar in html:
        html = html.replace(old_calendar, new_calendar)
        print("  ✓ Sidecar button inserted into event actions.")
    else:
        print("  ✗ Could not find calendar button marker.")

# ── 2. Load sidecar count after event renders ──

old_load = """    lucide.createIcons();

    // Live countdown tick"""

new_load = """    lucide.createIcons();
    loadSidecarCount(e.id);

    // Live countdown tick"""

if 'loadSidecarCount' in html:
    print("  ✓ loadSidecarCount call already present, skipping.")
else:
    if old_load in html:
        html = html.replace(old_load, new_load)
        print("  ✓ loadSidecarCount() call inserted.")
    else:
        print("  ✗ Could not find lucide.createIcons marker.")

# ── 3. Add panel + CSS + JS before nav.js ──

sidecar_block = '''
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
.btn-sidecar-detail{position:relative}
.sidecar-count-badge{min-width:20px;height:20px;border-radius:10px;background:#6366f1;color:#fff;font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;padding:0 6px;margin-left:4px}
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
.sidecar-event-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:11px;align-items:center}
.sidecar-badge{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:10px;background:#f0f0f0;color:#666}
.sidecar-badge.free{background:#dcfce7;color:#166534}
.sidecar-badge.paid{background:#fef3c7;color:#92400e}
.sidecar-badge.invite{background:#fce7f3;color:#9d174d}
.sidecar-ticket{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:10px;background:#6366f1;color:#fff;font-size:11px;font-weight:600;text-decoration:none;transition:all .15s;margin-left:auto}
.sidecar-ticket:hover{background:#4f46e5}
@media(max-width:600px){.sidecar-panel-content{width:100vw}}
</style>

<script>
var sidecarData = null;
var sidecarFilter = null;

async function loadSidecarCount(evId) {
  try {
    var resp = await fetch('/api/events/' + evId + '/sidecar-count');
    var data = await resp.json();
    if (data.count > 0) {
      var btn = document.getElementById('sidecar-detail-btn');
      var label = document.getElementById('sidecar-detail-label');
      if (btn) {
        btn.style.display = 'inline-flex';
        label.innerHTML = 'Sidecar Events <span class="sidecar-count-badge">' + data.count + '</span>';
        lucide.createIcons();
      }
    }
  } catch(e) {}
}

async function openSidecars(evId) {
  var panel = document.getElementById('sidecar-panel');
  document.getElementById('sidecar-body').innerHTML = '<div class="sidecar-loading">Loading sidecar events...</div>';
  panel.classList.add('open');
  document.body.style.overflow = 'hidden';
  try {
    var resp = await fetch('/api/events/' + evId + '/sidecars');
    sidecarData = await resp.json();
    sidecarFilter = null;
    document.getElementById('sidecar-parent-name').textContent = sidecarData.parent.name;
    var s = sidecarData.stats;
    document.getElementById('sidecar-stats').innerHTML =
      '<span class="sidecar-stat"><strong>' + s.total + '</strong> events</span>' +
      '<span class="sidecar-stat"><strong>' + s.days + '</strong> days</span>' +
      '<span class="sidecar-stat"><strong>' + s.free + '</strong> free</span>' +
      (s.invite_only > 0 ? '<span class="sidecar-stat"><strong>' + s.invite_only + '</strong> invite-only</span>' : '');
    buildSidecarChips(sidecarData.sidecars);
    renderSidecarList(sidecarData.sidecars);
    lucide.createIcons();
  } catch(e) {
    document.getElementById('sidecar-body').innerHTML = '<div class="sidecar-loading">Failed to load sidecar events.</div>';
  }
}

function closeSidecars() {
  document.getElementById('sidecar-panel').classList.remove('open');
  document.body.style.overflow = '';
}

function buildSidecarChips(sidecars) {
  var counts = {};
  var filterTags = ['Conference','Networking','Party','Hackathon','Brunch','Wellness','VCs/Angels','Devs/Builders','DeFi','AI','RWA'];
  sidecars.forEach(function(s) {
    var tags = Array.isArray(s.tags) ? s.tags : JSON.parse(s.tags || '[]');
    tags.forEach(function(t) { if (filterTags.indexOf(t) !== -1) counts[t] = (counts[t] || 0) + 1; });
  });
  var sorted = Object.keys(counts).sort(function(a,b) { return counts[b] - counts[a]; }).slice(0, 8);
  var h = '<span class="sidecar-chip active" onclick="filterSidecarList(null)">All</span>';
  sorted.forEach(function(t) { h += '<span class="sidecar-chip" onclick="filterSidecarList(\\'' + t + '\\')">' + t + '</span>'; });
  document.getElementById('sidecar-filters').innerHTML = h;
}

function filterSidecarList(tag) {
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
  renderSidecarList(filtered);
}

function renderSidecarList(sidecars) {
  var body = document.getElementById('sidecar-body');
  if (!sidecars.length) { body.innerHTML = '<div class="sidecar-loading">No events match this filter.</div>'; return; }
  var days = {};
  sidecars.forEach(function(s) { var d = (s.event_date || '').split('T')[0]; if (!days[d]) days[d] = []; days[d].push(s); });
  var dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var h = '';
  Object.keys(days).sort().forEach(function(dateStr) {
    var evts = days[dateStr];
    var d = new Date(dateStr + 'T12:00:00');
    var label = dayNames[d.getDay()] + ', ' + monthNames[d.getMonth()] + ' ' + d.getDate();
    h += '<div class="sidecar-day-header">' + label + '<span class="sidecar-day-count">' + evts.length + ' event' + (evts.length !== 1 ? 's' : '') + '</span></div>';
    evts.forEach(function(ev) {
      var st = ev.start_time ? fmtSidecarTime(ev.start_time) : '';
      var et = ev.end_time ? fmtSidecarTime(ev.end_time) : '';
      var time = st + (et ? ' \\u2013 ' + et : '');
      var cost = ev.cost === 'Free' ? '<span class="sidecar-badge free">Free</span>' : (ev.cost && ev.cost !== 'TBA' ? '<span class="sidecar-badge paid">' + ev.cost + '</span>' : '');
      var inv = ev.invite_only ? '<span class="sidecar-badge invite">Invite Only</span>' : '';
      var ven = ev.venue_name ? '<span class="sidecar-badge">' + ev.venue_name + '</span>' : '';
      var ticket = ev.source_url ? '<a href="' + ev.source_url + '" target="_blank" class="sidecar-ticket" onclick="event.stopPropagation()"><i data-lucide="ticket" style="width:12px;height:12px"></i> Get Tickets</a>' : '';
      h += '<div class="sidecar-event">' +
        (time ? '<div class="sidecar-event-time">' + time + '</div>' : '') +
        '<div class="sidecar-event-name">' + (ev.source_url ? '<a href="' + ev.source_url + '" target="_blank">' + ev.name + '</a>' : ev.name) + '</div>' +
        (ev.organizer ? '<div class="sidecar-event-org">by ' + ev.organizer + '</div>' : '') +
        '<div class="sidecar-event-meta">' + cost + inv + ven + ticket + '</div></div>';
    });
  });
  body.innerHTML = h;
  lucide.createIcons();
}

function fmtSidecarTime(t) { if (!t) return ''; var p = t.split(':'); var h = parseInt(p[0]); var m = p[1] || '00'; var s = h >= 12 ? 'p' : 'a'; if (h > 12) h -= 12; if (h === 0) h = 12; return h + (m !== '00' ? ':' + m : '') + s; }

document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeSidecars(); });
</script>

'''

if 'sidecar-panel' in html:
    print("  ✓ Sidecar panel already present, skipping.")
else:
    html = html.replace('<script src="/js/nav.js"></script></body>', sidecar_block + '<script src="/js/nav.js"></script></body>')
    print("  ✓ Sidecar panel + CSS + JS + ticket links inserted.")


# ── 4. Also update events.html sidecar panel to include ticket links ──

print("\nPatching public/events.html ticket links...")
with open("public/events.html", "r") as f:
    events_html = f.read()

old_meta_line = """'<div class="sidecar-event-meta">' + cost + inv + ven + '</div></div>';"""
new_meta_line = """var ticket = ev.source_url ? '<a href="' + ev.source_url + '" target="_blank" class="sidecar-ticket" onclick="event.stopPropagation()"><i data-lucide="ticket" style="width:12px;height:12px"></i> Get Tickets</a>' : '';
      html += '<div class="sidecar-event">' +
        (time ? '<div class="sidecar-event-time">' + time + '</div>' : '') +
        '<div class="sidecar-event-name">' + (ev.source_url ? '<a href="' + ev.source_url + '" target="_blank">' + ev.name + '</a>' : ev.name) + '</div>' +
        (ev.organizer ? '<div class="sidecar-event-org">by ' + ev.organizer + '</div>' : '') +
        '<div class="sidecar-event-meta">' + cost + inv + ven + ticket + '</div></div>';"""

old_render_block = """      html += '<div class="sidecar-event">' +
        (time ? '<div class="sidecar-event-time">' + time + '</div>' : '') +
        '<div class="sidecar-event-name">' + (ev.source_url ? '<a href="' + ev.source_url + '" target="_blank">' + ev.name + '</a>' : ev.name) + '</div>' +
        (ev.organizer ? '<div class="sidecar-event-org">by ' + ev.organizer + '</div>' : '') +
        '<div class="sidecar-event-meta">' + cost + inv + ven + '</div></div>';"""

new_render_block = """      var ticket = ev.source_url ? '<a href="' + ev.source_url + '" target="_blank" class="sidecar-ticket" onclick="event.stopPropagation()"><i data-lucide="ticket" style="width:12px;height:12px"></i> Get Tickets</a>' : '';
      html += '<div class="sidecar-event">' +
        (time ? '<div class="sidecar-event-time">' + time + '</div>' : '') +
        '<div class="sidecar-event-name">' + (ev.source_url ? '<a href="' + ev.source_url + '" target="_blank">' + ev.name + '</a>' : ev.name) + '</div>' +
        (ev.organizer ? '<div class="sidecar-event-org">by ' + ev.organizer + '</div>' : '') +
        '<div class="sidecar-event-meta">' + cost + inv + ven + ticket + '</div></div>';"""

if 'sidecar-ticket' in events_html:
    print("  ✓ Ticket links already present, skipping.")
else:
    if old_render_block in events_html:
        events_html = events_html.replace(old_render_block, new_render_block)
        # Also add the ticket CSS
        events_html = events_html.replace(
            '@media(max-width:600px){.sidecar-panel-content{width:100vw}}\n</style>',
            '.sidecar-ticket{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:10px;background:#6366f1;color:#fff;font-size:11px;font-weight:600;text-decoration:none;transition:all .15s;margin-left:auto}\n.sidecar-ticket:hover{background:#4f46e5}\n@media(max-width:600px){.sidecar-panel-content{width:100vw}}\n</style>'
        )
        print("  ✓ Ticket links + CSS added to events.html.")
    else:
        print("  ✗ Could not find render block in events.html.")

with open("public/events.html", "w") as f:
    f.write(events_html)

with open("public/event.html", "w") as f:
    f.write(html)

print("\n✅ All patches applied. Deploy with:")
print("  git add public/event.html public/events.html")
print('  git commit -m "feat: sidecar button on event detail + Get Tickets links"')
print("  git push")
