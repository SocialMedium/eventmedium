#!/usr/bin/env node
require('dotenv').config();
var h = require('../lib/event_harvester');
var hv = require('../lib/event-harvester');
var d = require('../lib/event_dedup');
var { normalizeThemes } = require('../lib/theme_taxonomy');
var { dbRun, dbGet } = require('../db');

// ── Target cities ──
var CITIES = [
  'London', 'Singapore', 'Sydney', 'Melbourne', 'New York', 'Las Vegas',
  'Barcelona', 'Madrid', 'Berlin', 'Stockholm', 'Copenhagen', 'Paris',
  'Amsterdam', 'Dubai', 'San Francisco', 'Austin', 'Toronto', 'Lisbon',
  'Tel Aviv', 'Seoul', 'Hong Kong', 'Zurich', 'Vienna', 'Dublin',
  'Helsinki', 'Brussels', 'Milan', 'Munich', 'Boston', 'Miami'
];

// ── Themes ──
var THEMES = [
  'AI', 'FinTech', 'Cybersecurity', 'SaaS', 'Climate Tech', 'HealthTech',
  'Web3', 'Blockchain', 'IoT', 'Robotics', 'SpaceTech', 'EdTech',
  'GovTech', 'PropTech', 'DeepTech', 'BioTech', 'Defence Tech',
  'Data', 'Privacy', 'Sustainability', 'Venture Capital', 'Startup'
];

// ── Build queries: theme × city for conferences and summits ──
var QS = [];
THEMES.forEach(function(theme) {
  CITIES.forEach(function(city) {
    QS.push(theme + ' conference 2026 ' + city);
    QS.push(theme + ' summit 2026 ' + city);
  });
});
// Add 2027 sweep for major cities
['London', 'Singapore', 'New York', 'San Francisco', 'Berlin', 'Paris', 'Sydney'].forEach(function(city) {
  QS.push('tech conference 2027 ' + city);
  QS.push('tech summit 2027 ' + city);
});

// Block list pages, blog posts, aggregator sites
var BL = [
  'best-', 'top-', 'biggest', 'guide', 'list-of', 'blog', '/blog/',
  'splunk.com', 'panorama', 'bizzabo.com/blog', 'meetup.com',
  'eventbrite.com', 'lu.ma', 'medium.com', 'forbes.com', 'wikipedia',
  'conferences-to-attend', 'events-in-', 'conferences-in-',
  'reddit.com', 'quora.com', 'youtube.com'
];

// ── Batching: run N queries per invocation (default 50, pass --limit=N) ──
var limitArg = process.argv.find(function(a) { return a.startsWith('--limit='); });
var BATCH_LIMIT = limitArg ? parseInt(limitArg.split('=')[1]) : 50;

// Shuffle queries so each run covers different theme/city combos
function shuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

async function run() {
  var batch = shuffle(QS).slice(0, BATCH_LIMIT);
  var added = 0, dupes = 0, failed = 0, skipped = 0;
  console.log('=== Discovery Run: ' + batch.length + ' of ' + QS.length + ' queries (limit ' + BATCH_LIMIT + ') ===');

  for (var i = 0; i < batch.length; i++) {
    console.log('[' + (i + 1) + '/' + batch.length + '] ' + batch[i]);
    var results = await h.searchEvents(batch[i]);

    for (var j = 0; j < Math.min(results.length, 8); j++) {
      var r = results[j];
      var lo = (r.url + ' ' + r.title).toLowerCase();
      if (BL.some(function(b) { return lo.includes(b); })) { skipped++; continue; }

      // Only harvest pages that look like a conference or summit
      if (!/conference|summit|congress|forum|expo/i.test(r.title + ' ' + r.snippet)) { skipped++; continue; }

      try {
        var ex = await hv.harvestEvent(r.url);
        if (!ex.name || ex.name.length < 5) { skipped++; continue; }
        if (ex.event_date && new Date(ex.event_date).getFullYear() < 2026) { skipped++; continue; }

        var dp = await d.findDuplicate(ex.name, ex.event_date, ex.city);
        if (dp) { dupes++; continue; }

        var slug = (ex.name || 'e').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (ex.event_date) slug += '-' + String(ex.event_date).replace(/-/g, '').substring(0, 8);
        slug += '-' + Date.now().toString(36);

        var themes = normalizeThemes(ex.themes || []);
        var res = await dbRun(
          'INSERT INTO events (name,description,event_date,city,country,event_type,themes,slug,source_url,expected_attendees) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (name,event_date,city,country) DO NOTHING RETURNING *',
          [ex.name, ex.description || null, ex.event_date || null, ex.city || null, ex.country || null,
           ex.event_format || 'conference', JSON.stringify(themes), slug, ex.website || r.url, ex.expected_attendees || null]
        );

        if (res && res.rows && res.rows[0]) {
          added++;
          console.log('  + ' + ex.name + ' | ' + (ex.city || '?') + ' | ' + (ex.event_date || 'tbd'));
        } else { dupes++; }
      } catch (e) { failed++; }

      await new Promise(function(r) { setTimeout(r, 1500); });
    }
    await new Promise(function(r) { setTimeout(r, 500); });
  }

  var total = await dbGet('SELECT COUNT(*) as c FROM events');
  console.log('\n=== RESULTS ===');
  console.log('Added: ' + added + ' | Dupes: ' + dupes + ' | Skipped: ' + skipped + ' | Failed: ' + failed);
  console.log('Total events in DB: ' + total.c);
  process.exit(0);
}

run().catch(function(e) { console.error(e); process.exit(1); });
