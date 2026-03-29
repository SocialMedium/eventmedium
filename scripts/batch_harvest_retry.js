#!/usr/bin/env node
// Retry batch — URLs that failed on null date, timeout, or transient errors
require('dotenv').config();
var { harvestEvent } = require('../lib/event-harvester');
var { normalizeThemes } = require('../lib/theme_taxonomy');
var { dbGet, dbRun } = require('../db');

var URLS = [
  // Failed: null date (now allowed)
  'https://www.re-work.co/events/deep-learning-summit-2026',
  'https://www.saastrannual.com',
  'https://ignite.microsoft.com',
  'https://www.wef.org',
  'https://www.permissionless.org',
  'https://www.newspace.im',
  'https://www.techweek.co.nz',
  'https://techsauce.co/en',
  'https://bangkokblockchainweek.com',
  'https://www.supercomputingasia.com',
  'https://pausefest.com.au',
  'https://www.all-energy.com.au',
  'https://www.stepconference.com',
  'https://www.privacysymposium.org',
  'https://www.devoxx.com',
  'https://pirate.global',

  // Failed: timeout (now 25s)
  'https://www.medteceurope.org',
  'https://www.southsummit.co',
  'https://rise.web-summit.com',
  'https://www.switch.org.sg',
  'https://www.echelon.asia',
  'https://innovfest.com',

  // Failed: transient errors (retry)
  'https://www.subscribed.com',
  'https://www.hashiconf.com',
  'https://expand.northstar.ae',
  'https://www.hannovermes.de/en/',

  // Failed: 403 (try with different approach — some rotate blocks)
  'https://www.rsaconference.com',
  'https://www.blackhat.com',
  'https://www.automate.org/events/automate',
];

var stats = { total: URLS.length, success: 0, duplicate: 0, failed: 0 };

async function run() {
  console.log('=== Retry Batch ===');
  console.log('URLs:', URLS.length);
  console.log('');

  for (var i = 0; i < URLS.length; i++) {
    var url = URLS[i];
    var prefix = '[' + (i + 1) + '/' + URLS.length + ']';

    try {
      var extracted = await harvestEvent(url);

      // Filter stale
      if (extracted.event_date) {
        var eventYear = new Date(extracted.event_date).getFullYear();
        if (eventYear < 2025) {
          stats.failed++;
          console.log(prefix, ' STALE', extracted.name, '(', extracted.event_date, ')');
          continue;
        }
      }

      // Dedup
      var year = extracted.event_date ? new Date(extracted.event_date).getFullYear() : null;
      var existing = year
        ? await dbGet("SELECT id, name FROM events WHERE name ILIKE $1 AND EXTRACT(YEAR FROM event_date) = $2", [extracted.name, year])
        : await dbGet("SELECT id, name FROM events WHERE name ILIKE $1", [extracted.name]);

      if (existing) {
        stats.duplicate++;
        console.log(prefix, 'DUPE', extracted.name);
        continue;
      }

      var slug = (extracted.name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (extracted.event_date) slug += '-' + String(extracted.event_date).replace(/-/g, '').substring(0, 8);
      slug += '-' + Date.now().toString(36);

      var themes = normalizeThemes(extracted.themes || []);

      var result = await dbRun(
        `INSERT INTO events (name, description, event_date, city, country, event_type, themes, slug, source_url, expected_attendees)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (name, event_date, city, country) DO NOTHING
         RETURNING *`,
        [
          extracted.name, extracted.description || null,
          extracted.event_date || null, extracted.city || null, extracted.country || null,
          'conference', JSON.stringify(themes), slug,
          extracted.website || url,
          extracted.expected_attendees || null
        ]
      );

      if (result && result.rows && result.rows[0]) {
        stats.success++;
        console.log(prefix, '  +', extracted.name, '|', extracted.city || '?', '|', extracted.event_date || 'no date', '|', themes.slice(0, 3).join(', '));
      } else {
        stats.duplicate++;
        console.log(prefix, 'DUPE', extracted.name, '(conflict)');
      }
    } catch(e) {
      stats.failed++;
      console.log(prefix, '  X', url.substring(0, 55), '—', e.message.substring(0, 80));
    }

    if (i < URLS.length - 1) await new Promise(function(r) { setTimeout(r, 1500); });
  }

  console.log('\n=== RESULTS ===');
  console.log('Total:', stats.total);
  console.log('New:', stats.success);
  console.log('Dupes:', stats.duplicate);
  console.log('Failed:', stats.failed);

  var total = await dbGet('SELECT COUNT(*) as count FROM events');
  console.log('Total events in DB:', total.count);
  process.exit(0);
}

run().catch(function(err) { console.error('Fatal:', err); process.exit(1); });
