// ============================================================
// RECOMMENDED EVENTS — Backend + Frontend
// ============================================================
//
// PART 1: Add this route to routes/events.js (before module.exports)
// PART 2: Patch public/events.html (add banner section)
// PART 3: Patch public/canister.html (add sidebar feed)
//
// Run: node apply_recommended.js
// ============================================================

var fs = require('fs');

// ──────────────────────────────────────────────────
// PART 1: Backend route for routes/events.js
// ──────────────────────────────────────────────────

var ROUTE_CODE = `
// ── GET /api/events/recommended — personalized event scoring ──
router.get('/recommended', authenticateToken, async function(req, res) {
  try {
    // Load user profile
    var profile = await dbGet(
      'SELECT stakeholder_type, themes, intent, offering, geography, deal_details FROM stakeholder_profiles WHERE user_id = $1',
      [req.user.id]
    );
    if (!profile || !profile.themes) {
      return res.json({ recommendations: [], reason: 'no_profile' });
    }

    var userThemes = typeof profile.themes === 'string' ? JSON.parse(profile.themes) : (profile.themes || []);
    var userIntent = typeof profile.intent === 'string' ? JSON.parse(profile.intent) : (profile.intent || []);
    var userOffering = typeof profile.offering === 'string' ? JSON.parse(profile.offering) : (profile.offering || []);
    var userGeo = (profile.geography || '').toLowerCase();
    var userType = profile.stakeholder_type || '';

    // Load upcoming events not already registered for
    var events = await dbAll(
      \`SELECT e.*, 
        (SELECT COUNT(*) FROM event_registrations WHERE event_id = e.id AND status = 'active') as reg_count
       FROM events e 
       WHERE e.event_date >= CURRENT_DATE 
       AND e.id NOT IN (SELECT event_id FROM event_registrations WHERE user_id = $1 AND status = 'active')
       ORDER BY e.event_date ASC\`,
      [req.user.id]
    );

    // Score each event
    var scored = [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var evThemes = typeof ev.themes === 'string' ? JSON.parse(ev.themes) : (ev.themes || []);
      var evCity = (ev.city || '').toLowerCase();
      var evCountry = (ev.country || '').toLowerCase();

      // 1. Theme overlap (0-1) — Jaccard
      var themeSet = new Set(userThemes.map(function(t) { return t.toLowerCase(); }));
      var evSet = new Set(evThemes.map(function(t) { return t.toLowerCase(); }));
      var intersection = 0;
      evSet.forEach(function(t) { if (themeSet.has(t)) intersection++; });
      var union = new Set([...themeSet, ...evSet]).size;
      var themeScore = union > 0 ? intersection / union : 0;

      // 2. Geographic relevance (0-1)
      var geoScore = 0;
      if (userGeo) {
        if (userGeo.indexOf(evCity) !== -1 || evCity.indexOf(userGeo) !== -1) geoScore = 1;
        else if (userGeo.indexOf(evCountry) !== -1 || evCountry.indexOf(userGeo) !== -1) geoScore = 0.6;
        else {
          // Region matching
          var euroCountries = ['uk','germany','france','spain','netherlands','sweden','switzerland','italy','portugal','austria','belgium','denmark','finland','norway','ireland','poland','czech','romania','greece'];
          var apacCountries = ['singapore','australia','japan','south korea','china','india','hong kong','taiwan','new zealand','indonesia','thailand','malaysia','vietnam','philippines'];
          var naCountries = ['usa','us','canada','united states'];
          var meaCountries = ['uae','saudi arabia','israel','qatar','south africa','kenya','nigeria','egypt'];
          var userRegion = '';
          var evRegion = '';
          [['europe', euroCountries], ['apac', apacCountries], ['americas', naCountries], ['mea', meaCountries]].forEach(function(r) {
            r[1].forEach(function(c) {
              if (userGeo.indexOf(c) !== -1) userRegion = r[0];
              if (evCountry.indexOf(c) !== -1 || evCity.indexOf(c) !== -1) evRegion = r[0];
            });
          });
          if (userRegion && userRegion === evRegion) geoScore = 0.3;
        }
      }

      // 3. Stakeholder density — are there registered users who'd be good matches?
      var densityScore = 0;
      if (ev.reg_count > 0) {
        // Check for complementary archetypes
        var complementMap = {
          founder: ['investor', 'corporate', 'advisor'],
          investor: ['founder'],
          researcher: ['corporate', 'founder'],
          corporate: ['founder', 'researcher'],
          advisor: ['founder'],
          operator: ['founder', 'corporate']
        };
        var targetTypes = complementMap[userType] || [];
        if (targetTypes.length > 0) {
          var densityResult = await dbGet(
            \`SELECT COUNT(DISTINCT sp.user_id) as match_count 
             FROM event_registrations er 
             JOIN stakeholder_profiles sp ON sp.user_id = er.user_id 
             WHERE er.event_id = $1 AND er.status = 'active' 
             AND sp.stakeholder_type = ANY($2::text[])\`,
            [ev.id, targetTypes]
          );
          var matchCount = parseInt(densityResult.match_count) || 0;
          densityScore = Math.min(matchCount / 10, 1); // caps at 10 complementary users
        }

        // Bonus: check for theme-aligned registered users
        if (userThemes.length > 0) {
          var themeAligned = await dbGet(
            \`SELECT COUNT(DISTINCT sp.user_id) as aligned 
             FROM event_registrations er 
             JOIN stakeholder_profiles sp ON sp.user_id = er.user_id 
             WHERE er.event_id = $1 AND er.status = 'active' 
             AND sp.themes::text ILIKE ANY($2::text[])\`,
            [ev.id, userThemes.map(function(t) { return '%' + t + '%'; })]
          );
          var alignedCount = parseInt(themeAligned.aligned) || 0;
          densityScore = Math.max(densityScore, Math.min(alignedCount / 8, 1));
        }
      }

      // 4. Intent fit — does this event attract people who match user intent?
      var intentScore = 0;
      if (userIntent.length > 0 && ev.reg_count > 0) {
        var intentResult = await dbGet(
          \`SELECT COUNT(DISTINCT sp.user_id) as intent_match 
           FROM event_registrations er 
           JOIN stakeholder_profiles sp ON sp.user_id = er.user_id 
           WHERE er.event_id = $1 AND er.status = 'active' 
           AND sp.offering::text ILIKE ANY($2::text[])\`,
          [ev.id, userIntent.map(function(t) { return '%' + t + '%'; })]
        );
        intentScore = Math.min((parseInt(intentResult.intent_match) || 0) / 5, 1);
      }

      // Weighted total
      var total = (themeScore * 0.40) + (geoScore * 0.15) + (densityScore * 0.30) + (intentScore * 0.15);

      // Build match reasons
      var reasons = [];
      if (themeScore > 0) {
        var overlapping = userThemes.filter(function(t) {
          return evThemes.some(function(et) { return et.toLowerCase() === t.toLowerCase(); });
        });
        if (overlapping.length) reasons.push(overlapping.join(', ') + ' overlap');
      }
      if (densityScore > 0) reasons.push('Relevant attendees registered');
      if (geoScore >= 0.6) reasons.push('Near your geography');
      if (intentScore > 0) reasons.push('People offering what you seek');

      if (total > 0.05) {
        scored.push({
          id: ev.id,
          name: ev.name,
          event_date: ev.event_date,
          city: ev.city,
          country: ev.country,
          themes: evThemes,
          slug: ev.slug,
          score: Math.round(total * 100),
          reasons: reasons,
          reg_count: parseInt(ev.reg_count),
          theme_score: Math.round(themeScore * 100),
          density_score: Math.round(densityScore * 100),
          geo_score: Math.round(geoScore * 100),
          intent_score: Math.round(intentScore * 100)
        });
      }
    }

    // Sort by score descending, limit to top 6
    scored.sort(function(a, b) { return b.score - a.score; });
    res.json({ recommendations: scored.slice(0, 6) });
  } catch (err) {
    console.error('Recommended events error:', err);
    res.status(500).json({ error: 'Failed to generate recommendations' });
  }
});
`;

// Insert route before module.exports
var eventsFile = fs.readFileSync('routes/events.js', 'utf8');
if (eventsFile.indexOf('/recommended') === -1) {
  eventsFile = eventsFile.replace('module.exports', ROUTE_CODE + '\nmodule.exports');
  fs.writeFileSync('routes/events.js', eventsFile);
  console.log('✓ Added /recommended route to routes/events.js');
} else {
  console.log('⊘ /recommended route already exists');
}

// ──────────────────────────────────────────────────
// PART 2: Patch events.html — banner above results
// ──────────────────────────────────────────────────

var eventsHtml = fs.readFileSync('public/events.html', 'utf8');

// Add CSS for recommended section
var recCSS = `
.rec-section{margin-bottom:24px;padding:24px;background:linear-gradient(135deg,#f0f4ff 0%,#f8f0ff 100%);border:1px solid #e0e4f0;border-radius:16px}
.rec-header{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.rec-header h3{font-size:16px;font-weight:700;color:var(--txt)}
.rec-header .rec-badge{font-size:11px;font-weight:700;padding:3px 10px;background:var(--p);color:white;border-radius:12px;letter-spacing:0.5px}
.rec-scroll{display:flex;gap:14px;overflow-x:auto;padding-bottom:8px;-webkit-overflow-scrolling:touch}
.rec-scroll::-webkit-scrollbar{height:4px}
.rec-scroll::-webkit-scrollbar-thumb{background:var(--bdr);border-radius:4px}
.rec-card{flex:0 0 280px;background:var(--card);border:1px solid var(--bdr);border-radius:12px;padding:16px;cursor:pointer;transition:all 0.2s;position:relative}
.rec-card:hover{border-color:var(--p);box-shadow:var(--shadowL)}
.rec-score{position:absolute;top:12px;right:12px;font-size:18px;font-weight:800;color:var(--p);font-family:-apple-system,sans-serif}
.rec-name{font-size:14px;font-weight:700;margin-bottom:4px;padding-right:40px}
.rec-meta{font-size:12px;color:var(--txtL);margin-bottom:8px}
.rec-reasons{display:flex;flex-wrap:wrap;gap:4px}
.rec-reason{font-size:11px;padding:3px 8px;background:var(--pL);color:var(--p);border-radius:6px;font-weight:500}
`;

if (eventsHtml.indexOf('rec-section') === -1) {
  // Add CSS before </style>
  eventsHtml = eventsHtml.replace('</style>', recCSS + '</style>');

  // Add recommended container div after results info
  var recHTML = `
    // Load recommended events
    if (token) loadRecommended();
`;

  // Add the JS function before the closing </script>
  var recJS = `
async function loadRecommended() {
  try {
    var resp = await fetch('/api/events/recommended', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    var data = await resp.json();
    if (!data.recommendations || !data.recommendations.length) return;

    var recs = data.recommendations;
    var container = document.getElementById('recSection');
    if (!container) {
      // Create section above events grid
      container = document.createElement('div');
      container.id = 'recSection';
      var evContainer = document.getElementById('eventsContainer');
      evContainer.parentNode.insertBefore(container, evContainer);
    }

    container.innerHTML = '<div class="rec-section">' +
      '<div class="rec-header"><i data-lucide="sparkles" style="width:18px;height:18px;color:var(--p)"></i><h3>Recommended for You</h3><span class="rec-badge">BASED ON YOUR CANISTER</span></div>' +
      '<div class="rec-scroll">' +
      recs.map(function(r) {
        var date = r.event_date ? new Date(r.event_date).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}) : 'TBD';
        return '<div class="rec-card" onclick="goToEvent(' + r.id + ')">' +
          '<div class="rec-score">' + r.score + '%</div>' +
          '<div class="rec-name">' + esc(r.name) + '</div>' +
          '<div class="rec-meta">' + date + (r.city ? ' · ' + esc(r.city) : '') + '</div>' +
          '<div class="rec-reasons">' + (r.reasons || []).map(function(reason) {
            return '<span class="rec-reason">' + esc(reason) + '</span>';
          }).join('') + '</div>' +
        '</div>';
      }).join('') +
      '</div></div>';
    lucide.createIcons();
  } catch(e) { console.log('Recommendations not available'); }
}
`;

  // Insert loadRecommended call after loadEvents completes
  eventsHtml = eventsHtml.replace(
    'renderEvents();\n  } catch (err)',
    'renderEvents();\n    if (token) loadRecommended();\n  } catch (err)'
  );

  // Add function before closing </script>
  eventsHtml = eventsHtml.replace('</script>\n</body>', recJS + '</script>\n</body>');

  fs.writeFileSync('public/events.html', eventsHtml);
  console.log('✓ Patched events.html with recommended banner');
} else {
  console.log('⊘ events.html already has recommendations');
}

// ──────────────────────────────────────────────────
// PART 3: Patch canister.html — sidebar feed
// ──────────────────────────────────────────────────

var canisterHtml = fs.readFileSync('public/canister.html', 'utf8');

if (canisterHtml.indexOf('rec-feed') === -1) {
  // Add CSS
  var canRecCSS = `
.rec-feed{margin-top:0}
.rec-feed-item{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--bdr);cursor:pointer;transition:background 0.15s}
.rec-feed-item:last-child{border-bottom:none}
.rec-feed-item:hover{background:var(--bg);margin:0 -8px;padding:10px 8px;border-radius:8px}
.rec-feed-score{width:36px;height:36px;border-radius:10px;background:var(--pL);color:var(--p);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0}
.rec-feed-info{flex:1;min-width:0}
.rec-feed-name{font-size:13px;font-weight:600;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rec-feed-meta{font-size:11px;color:var(--txtL)}
.rec-feed-reason{font-size:10px;color:var(--p);font-weight:500;margin-top:1px}
`;

  canisterHtml = canisterHtml.replace('</style>', canRecCSS + '</style>');

  // Insert recommended feed card in sidebar, after the stats card
  // We'll add a placeholder and fill it via JS
  var sidebarInject = `
    // Recommended events feed in sidebar
    html += '<div class="card" id="recFeedCard" style="display:none"><div class="card-header"><h2>Recommended Events</h2></div><div id="recFeed" class="rec-feed"></div></div>';
`;

  // Insert after the theme chart card closes, before activity timeline
  canisterHtml = canisterHtml.replace(
    "// Activity timeline",
    sidebarInject + "\n    // Activity timeline"
  );

  // Add the load function
  var canRecJS = `
async function loadRecommendedFeed() {
  try {
    var resp = await fetch('/api/events/recommended', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    var data = await resp.json();
    if (!data.recommendations || !data.recommendations.length) return;

    var card = document.getElementById('recFeedCard');
    var feed = document.getElementById('recFeed');
    if (!card || !feed) return;

    card.style.display = '';
    feed.innerHTML = data.recommendations.slice(0, 4).map(function(r) {
      var date = r.event_date ? new Date(r.event_date).toLocaleDateString('en-GB', {day:'numeric',month:'short'}) : 'TBD';
      var reason = (r.reasons && r.reasons[0]) || '';
      return '<a href="/event.html?id=' + r.id + '" class="rec-feed-item" style="text-decoration:none;color:inherit">' +
        '<div class="rec-feed-score">' + r.score + '%</div>' +
        '<div class="rec-feed-info">' +
          '<div class="rec-feed-name">' + esc(r.name) + '</div>' +
          '<div class="rec-feed-meta">' + date + (r.city ? ' · ' + r.city : '') + '</div>' +
          (reason ? '<div class="rec-feed-reason">' + esc(reason) + '</div>' : '') +
        '</div>' +
      '</a>';
    }).join('');
  } catch(e) {}
}
`;

  // Add call after loadCanister
  canisterHtml = canisterHtml.replace(
    'lucide.createIcons();\n  } catch(err)',
    'lucide.createIcons();\n    loadRecommendedFeed();\n  } catch(err)'
  );

  // Add function before closing </script>
  canisterHtml = canisterHtml.replace('</script>\n</body>', canRecJS + '</script>\n</body>');

  fs.writeFileSync('public/canister.html', canisterHtml);
  console.log('✓ Patched canister.html with recommended feed');
} else {
  console.log('⊘ canister.html already has recommendations');
}

console.log('\n✅ All done. Test with: node -c routes/events.js');
console.log('Then: git add . && git commit -m "Recommended events: scoring + banner + canister feed" && git push');
