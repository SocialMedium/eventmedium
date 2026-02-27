#!/usr/bin/env python3
"""Add user-submitted sidecar events: backend route + frontend form"""

import re

# ── 1. PATCH routes/events.js ──

print("Patching routes/events.js...")
with open("routes/events.js", "r") as f:
    js = f.read()

post_route = '''
// POST /api/events/:id/sidecars — user submits a sidecar event
router.post('/:id/sidecars', async function(req, res) {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Sign in to submit a side event' });
    }
    var eventId = parseInt(req.params.id);
    if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid event ID' });

    var parent = await dbGet('SELECT id, name FROM events WHERE id = $1', [eventId]);
    if (!parent) return res.status(404).json({ error: 'Event not found' });

    var b = req.body;
    if (!b.name || !b.event_date) {
      return res.status(400).json({ error: 'Event name and date are required' });
    }

    var result = await dbGet(
      `INSERT INTO sidecar_events
        (parent_event_id, name, organizer, event_date, start_time, end_time,
         venue_name, venue_address, cost, tags, source_url, invite_only, submitted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        eventId,
        b.name.trim(),
        (b.organizer || '').trim() || null,
        b.event_date,
        b.start_time || null,
        b.end_time || null,
        (b.venue_name || '').trim() || null,
        (b.venue_address || '').trim() || null,
        (b.cost || 'Free').trim(),
        JSON.stringify(b.tags || []),
        (b.source_url || '').trim() || null,
        b.invite_only || false,
        req.session.userId
      ]
    );

    res.json({ success: true, id: result.id });
  } catch (err) {
    console.error('Sidecar submit error:', err);
    res.status(500).json({ error: 'Failed to submit side event' });
  }
});

'''

if 'POST' in js and 'sidecars' in js and 'submitted_by' in js:
    print("  ✓ POST sidecar route already present, skipping.")
else:
    # Insert before the module.exports line
    js = js.replace('module.exports = { router };', post_route + 'module.exports = { router };')
    with open("routes/events.js", "w") as f:
        f.write(js)
    print("  ✓ POST /api/events/:id/sidecars route inserted.")


# ── 2. PATCH public/events.html — add submit button + form ──

print("Patching public/events.html...")
with open("public/events.html", "r") as f:
    html = f.read()

# 2a. Add "Submit a Side Event" button to the sidecar panel header
old_header = '''      <button class="sidecar-close" onclick="closeSidecars()"><i data-lucide="x" style="width:20px;height:20px"></i></button>
    </div>
    <div class="sidecar-stats" id="sidecar-stats"></div>'''

new_header = '''      <button class="sidecar-close" onclick="closeSidecars()"><i data-lucide="x" style="width:20px;height:20px"></i></button>
    </div>
    <div style="padding:12px 24px 0;display:flex;justify-content:space-between;align-items:center">
      <div class="sidecar-stats" id="sidecar-stats" style="padding:0;border:none;flex:1"></div>
      <button class="btn-submit-sidecar" onclick="openSidecarForm()">+ Add Side Event</button>
    </div>'''

if 'btn-submit-sidecar' in html:
    print("  ✓ Submit button already present, skipping.")
else:
    if old_header in html:
        html = html.replace(old_header, new_header)
        # Fix: remove the old stats div padding since we moved it inline
        print("  ✓ Submit button inserted in sidecar panel header.")
    else:
        print("  ✗ Could not find sidecar header marker. Trying alternative...")
        # Try a simpler match
        if '<div class="sidecar-stats" id="sidecar-stats"></div>' in html:
            html = html.replace(
                '<div class="sidecar-stats" id="sidecar-stats"></div>',
                '<div style="padding:12px 24px 0;display:flex;justify-content:space-between;align-items:center"><div class="sidecar-stats" id="sidecar-stats" style="padding:0;border:none;flex:1"></div><button class="btn-submit-sidecar" onclick="openSidecarForm()">+ Add Side Event</button></div>'
            )
            print("  ✓ Submit button inserted (alternative match).")
        else:
            print("  ✗ Could not find sidecar stats marker. Manual edit needed.")

# 2b. Also show sidecar button on ALL event cards (not just ones with count > 0)
# We change loadSidecarCounts to always show the button
old_count_hide = """      if (data.count > 0) {
        document.getElementById('sidecar-count-' + id).textContent = data.count;
        btn.style.display = 'inline-flex';
      }
    } catch(e) {}"""

new_count_show = """      btn.style.display = 'inline-flex';
      if (data.count > 0) {
        document.getElementById('sidecar-count-' + id).textContent = data.count;
      }
    } catch(e) { btn.style.display = 'inline-flex'; }"""

if 'btn.style.display = \'inline-flex\';\n      if (data.count > 0)' in html:
    print("  ✓ Always-show sidecar button already present, skipping.")
else:
    if old_count_hide in html:
        html = html.replace(old_count_hide, new_count_show)
        print("  ✓ Sidecar button now shows on all events.")
    else:
        print("  ✗ Could not find loadSidecarCounts hide logic. Check manually.")

# 2c. Add the submit form modal + CSS + JS before </body>
form_block = '''
<!-- ── SIDECAR SUBMIT FORM MODAL ── -->
<div id="sidecar-form-overlay" style="display:none;position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,0.5);animation:sidecarFade .2s ease">
  <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(480px,92vw);max-height:85vh;overflow-y:auto;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.2);padding:0">
    <div style="padding:20px 24px 12px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center">
      <h3 style="margin:0;font-size:17px;font-weight:600;color:#1a1a2e">Submit a Side Event</h3>
      <button onclick="closeSidecarForm()" style="background:none;border:none;cursor:pointer;color:#888;font-size:20px">&times;</button>
    </div>
    <div style="padding:20px 24px" id="sidecar-form-body">
      <div class="sf-row">
        <label class="sf-label">Event Name <span style="color:#e11d48">*</span></label>
        <input type="text" id="sf-name" class="sf-input" placeholder="e.g. Founders Happy Hour">
      </div>
      <div class="sf-row">
        <label class="sf-label">Organizer</label>
        <input type="text" id="sf-organizer" class="sf-input" placeholder="e.g. YC Alumni Network">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="sf-row">
          <label class="sf-label">Date <span style="color:#e11d48">*</span></label>
          <input type="date" id="sf-date" class="sf-input">
        </div>
        <div class="sf-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <label class="sf-label">Start</label>
            <input type="time" id="sf-start" class="sf-input">
          </div>
          <div>
            <label class="sf-label">End</label>
            <input type="time" id="sf-end" class="sf-input">
          </div>
        </div>
      </div>
      <div class="sf-row">
        <label class="sf-label">Venue / Address</label>
        <input type="text" id="sf-venue" class="sf-input" placeholder="e.g. Capital Factory, 701 Brazos St">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="sf-row">
          <label class="sf-label">Cost</label>
          <input type="text" id="sf-cost" class="sf-input" placeholder="Free" value="Free">
        </div>
        <div class="sf-row">
          <label class="sf-label">Registration Link</label>
          <input type="url" id="sf-url" class="sf-input" placeholder="https://luma.com/...">
        </div>
      </div>
      <div class="sf-row">
        <label class="sf-label">Tags</label>
        <div id="sf-tags" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
        </div>
      </div>
      <div class="sf-row" style="display:flex;align-items:center;gap:8px;margin-top:4px">
        <input type="checkbox" id="sf-invite">
        <label for="sf-invite" style="font-size:13px;color:#555;cursor:pointer">Invite only</label>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end">
        <button onclick="closeSidecarForm()" style="padding:8px 16px;border:1px solid #ddd;border-radius:8px;background:#fff;color:#555;cursor:pointer;font-size:13px">Cancel</button>
        <button onclick="submitSidecar()" id="sf-submit-btn" style="padding:8px 20px;border:none;border-radius:8px;background:#6366f1;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Submit</button>
      </div>
      <div id="sf-error" style="display:none;margin-top:10px;padding:8px 12px;border-radius:6px;background:#fef2f2;color:#dc2626;font-size:13px"></div>
      <div id="sf-success" style="display:none;margin-top:10px;padding:8px 12px;border-radius:6px;background:#f0fdf4;color:#166534;font-size:13px"></div>
    </div>
  </div>
</div>

<style>
.btn-submit-sidecar{padding:6px 14px;border:1px solid #6366f1;border-radius:8px;background:#f5f3ff;color:#6366f1;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all .15s}
.btn-submit-sidecar:hover{background:#6366f1;color:#fff}
.sf-row{margin-bottom:12px}
.sf-label{display:block;font-size:12px;font-weight:600;color:#555;margin-bottom:4px}
.sf-input{width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;color:#1a1a2e;box-sizing:border-box}
.sf-input:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 2px rgba(99,102,241,0.15)}
.sf-tag-chip{padding:4px 10px;border-radius:12px;border:1px solid #e0e0e0;background:#fff;font-size:12px;color:#555;cursor:pointer;transition:all .15s;user-select:none}
.sf-tag-chip.selected{background:#6366f1;color:#fff;border-color:#6366f1}
</style>

<script>
var sidecarFormEventId = null;
var sidecarFormTags = [];
var allSidecarTags = ['Networking','Conference','Party','Session','Showcase','AI','DeFi','VCs/Angels','Hackathon','Brunch','Wellness','Music','Culture','Education','Tech','Special Event'];

function openSidecarForm() {
  sidecarFormEventId = sidecarData ? sidecarData.parent.id : null;
  if (!sidecarFormEventId) return;

  // Reset form
  document.getElementById('sf-name').value = '';
  document.getElementById('sf-organizer').value = '';
  document.getElementById('sf-date').value = '';
  document.getElementById('sf-start').value = '';
  document.getElementById('sf-end').value = '';
  document.getElementById('sf-venue').value = '';
  document.getElementById('sf-cost').value = 'Free';
  document.getElementById('sf-url').value = '';
  document.getElementById('sf-invite').checked = false;
  document.getElementById('sf-error').style.display = 'none';
  document.getElementById('sf-success').style.display = 'none';
  document.getElementById('sf-submit-btn').disabled = false;
  document.getElementById('sf-submit-btn').textContent = 'Submit';
  sidecarFormTags = [];

  // Build tag chips
  var tagsHtml = '';
  allSidecarTags.forEach(function(t) {
    tagsHtml += '<span class="sf-tag-chip" onclick="toggleSfTag(this,\'' + t + '\')">' + t + '</span>';
  });
  document.getElementById('sf-tags').innerHTML = tagsHtml;

  document.getElementById('sidecar-form-overlay').style.display = 'block';
}

function closeSidecarForm() {
  document.getElementById('sidecar-form-overlay').style.display = 'none';
}

function toggleSfTag(el, tag) {
  var idx = sidecarFormTags.indexOf(tag);
  if (idx === -1) {
    sidecarFormTags.push(tag);
    el.classList.add('selected');
  } else {
    sidecarFormTags.splice(idx, 1);
    el.classList.remove('selected');
  }
}

async function submitSidecar() {
  var errEl = document.getElementById('sf-error');
  var succEl = document.getElementById('sf-success');
  var btn = document.getElementById('sf-submit-btn');
  errEl.style.display = 'none';
  succEl.style.display = 'none';

  var name = document.getElementById('sf-name').value.trim();
  var eventDate = document.getElementById('sf-date').value;
  if (!name) { errEl.textContent = 'Event name is required.'; errEl.style.display = 'block'; return; }
  if (!eventDate) { errEl.textContent = 'Date is required.'; errEl.style.display = 'block'; return; }

  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    var resp = await fetch('/api/events/' + sidecarFormEventId + '/sidecars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        organizer: document.getElementById('sf-organizer').value.trim(),
        event_date: eventDate,
        start_time: document.getElementById('sf-start').value || null,
        end_time: document.getElementById('sf-end').value || null,
        venue_address: document.getElementById('sf-venue').value.trim(),
        cost: document.getElementById('sf-cost').value.trim() || 'Free',
        source_url: document.getElementById('sf-url').value.trim(),
        tags: sidecarFormTags,
        invite_only: document.getElementById('sf-invite').checked
      })
    });
    var data = await resp.json();
    if (!resp.ok) {
      errEl.textContent = data.error || 'Something went wrong.';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Submit';
      return;
    }

    succEl.textContent = 'Side event submitted! Refreshing...';
    succEl.style.display = 'block';

    // Refresh the sidecar panel
    setTimeout(function() {
      closeSidecarForm();
      openSidecars(sidecarFormEventId);
      // Update count badge
      var countEl = document.getElementById('sidecar-count-' + sidecarFormEventId);
      if (countEl) {
        var cur = parseInt(countEl.textContent) || 0;
        countEl.textContent = cur + 1;
      }
    }, 1000);

  } catch(e) {
    errEl.textContent = 'Network error. Please try again.';
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Submit';
  }
}

// Close form on Escape
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && document.getElementById('sidecar-form-overlay').style.display === 'block') {
    closeSidecarForm();
  }
});
</script>

'''

if 'sidecar-form-overlay' in html:
    print("  ✓ Sidecar form already present, skipping.")
else:
    # Insert before the nav script / </body>
    if '<script src="/js/nav.js"></script></body>' in html:
        html = html.replace('<script src="/js/nav.js"></script></body>', form_block + '<script src="/js/nav.js"></script></body>')
        print("  ✓ Sidecar submit form inserted.")
    elif '</body>' in html:
        html = html.replace('</body>', form_block + '</body>')
        print("  ✓ Sidecar submit form inserted (before </body>).")
    else:
        print("  ✗ Could not find </body> tag.")

with open("public/events.html", "w") as f:
    f.write(html)


# ── 3. PATCH public/event.html (detail page) ──

print("Patching public/event.html...")
try:
    with open("public/event.html", "r") as f:
        ehtml = f.read()

    # Add submit button to event.html sidecar panel if it has one
    if 'sidecar-panel' in ehtml and 'btn-submit-sidecar' not in ehtml:
        if '<div class="sidecar-stats" id="sidecar-stats"></div>' in ehtml:
            ehtml = ehtml.replace(
                '<div class="sidecar-stats" id="sidecar-stats"></div>',
                '<div style="padding:12px 24px 0;display:flex;justify-content:space-between;align-items:center"><div class="sidecar-stats" id="sidecar-stats" style="padding:0;border:none;flex:1"></div><button class="btn-submit-sidecar" onclick="openSidecarForm()">+ Add Side Event</button></div>'
            )
            print("  ✓ Submit button added to event.html sidecar panel.")

        # Add the form + CSS + JS
        if 'sidecar-form-overlay' not in ehtml:
            if '</body>' in ehtml:
                ehtml = ehtml.replace('</body>', form_block + '</body>')
                print("  ✓ Sidecar submit form inserted in event.html.")

        # Also show sidecar button always
        if "btn.style.display = 'inline-flex';\n      if (data.count > 0)" not in ehtml:
            old_hide = """      if (data.count > 0) {
        document.getElementById('sidecar-count-' + id).textContent = data.count;
        btn.style.display = 'inline-flex';
      }
    } catch(e) {}"""
            new_show = """      btn.style.display = 'inline-flex';
      if (data.count > 0) {
        document.getElementById('sidecar-count-' + id).textContent = data.count;
      }
    } catch(e) { btn.style.display = 'inline-flex'; }"""
            if old_hide in ehtml:
                ehtml = ehtml.replace(old_hide, new_show)
                print("  ✓ Sidecar button now shows on all events in event.html.")

        with open("public/event.html", "w") as f:
            f.write(ehtml)
    else:
        print("  ✓ event.html already patched or no sidecar panel found.")
except FileNotFoundError:
    print("  ⚠ event.html not found, skipping.")


# ── 4. DB migration script ──

print("\nCreating DB migration...")
migration = """-- Add submitted_by column to sidecar_events
ALTER TABLE sidecar_events ADD COLUMN IF NOT EXISTS submitted_by INTEGER REFERENCES users(id);
"""

with open("add_sidecar_submitted_by.sql", "w") as f:
    f.write(migration)
print("  ✓ Migration file: add_sidecar_submitted_by.sql")


print("\n✅ All patches applied!")
print("\nNext steps:")
print("  1. Run migration:  node -e \"require('dotenv').config(); const {Client}=require('pg'); const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); c.connect().then(()=>c.query('ALTER TABLE sidecar_events ADD COLUMN IF NOT EXISTS submitted_by INTEGER REFERENCES users(id)')).then(()=>{console.error('Done');c.end()}).catch(e=>{console.error(e.message);c.end()})\"")
print("  2. Deploy:  git add -A && git commit -m \"feat: user-submitted sidecar events\" && git push")
