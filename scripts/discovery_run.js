#!/usr/bin/env node
require('dotenv').config();
var h = require('../lib/event_harvester');
var hv = require('../lib/event-harvester');
var d = require('../lib/event_dedup');
var { normalizeThemes } = require('../lib/theme_taxonomy');
var { dbRun, dbGet } = require('../db');

// Focus on major conferences and summits in key regions
var QS = [
  // Theme × Region queries — conferences and summits only
  'FinTech conference 2026 Europe', 'FinTech summit 2026 USA',
  'AI conference 2026 London', 'AI summit 2026 Singapore',
  'Climate Tech conference 2026', 'CleanTech summit 2026 Europe',
  'Cybersecurity conference 2026 Europe', 'Cybersecurity summit 2026 USA',
  'HealthTech conference 2026', 'BioTech summit 2026',
  'SaaS conference 2026 Europe', 'Enterprise SaaS summit 2026',
  'Robotics expo 2026', 'SpaceTech conference 2026',
  'EdTech conference 2026 Europe', 'EdTech summit 2026 USA',
  'Web3 conference 2026', 'Blockchain summit 2026 Asia',
  'IoT conference 2026', 'Privacy conference 2026 Europe',
  'GovTech summit 2026', 'PropTech conference 2026 London',
  'tech conference 2026 Australia', 'tech summit 2026 Singapore',
  'tech conference 2026 Dubai', 'startup conference 2026 Europe'
];

// Block list pages, blog posts, aggregator sites
var BL = [
  'best-', 'top-', 'biggest', 'guide', 'list-of', 'blog', '/blog/',
  'splunk.com', 'panorama', 'bizzabo.com/blog', 'meetup.com',
  'eventbrite.com', 'lu.ma', 'medium.com', 'forbes.com', 'wikipedia',
  'conferences-to-attend', 'events-in-', 'conferences-in-',
  'reddit.com', 'quora.com', 'youtube.com'
];

async function run() {
  var added = 0, dupes = 0, failed = 0, skipped = 0;
  console.log('=== Discovery Run: ' + QS.length + ' queries ===');

  for (var i = 0; i < QS.length; i++) {
    console.log('[' + (i + 1) + '/' + QS.length + '] ' + QS[i]);
    var results = await h.searchEvents(QS[i]);

    for (var j = 0; j < Math.min(results.length, 5); j++) {
      var r = results[j];
      var lo = (r.url + ' ' + r.title).toLowerCase();
      if (BL.some(function(b) { return lo.includes(b); })) { skipped++; continue; }

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
