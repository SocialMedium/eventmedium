#!/usr/bin/env node
// ── Weekly Event Harvest ──
// Runs on a schedule (Railway cron or external scheduler).
// Re-checks curated URLs + discovers new events via search.
//
// Usage:
//   node scripts/weekly_harvest.js                  # full run
//   node scripts/weekly_harvest.js --curated-only   # skip search, just re-check URLs
//   node scripts/weekly_harvest.js --dry-run        # log but don't insert

require('dotenv').config();
var { harvestEvent } = require('../lib/event-harvester');
var { findDuplicate } = require('../lib/event_dedup');
var { normalizeThemes } = require('../lib/theme_taxonomy');
var { dbGet, dbRun, dbAll } = require('../db');

// ── Curated event sources — add URLs here as you discover them ──
var CURATED_URLS = require('./batch_harvest_2026').URLS || [];

// If batch_harvest_2026 doesn't export URLS, fallback to inline
if (!CURATED_URLS || !CURATED_URLS.length) {
  CURATED_URLS = [
    'https://websummit.com',
    'https://collisionconf.com',
    'https://sxsw.com',
    'https://www.ces.tech',
    'https://vivatech.com',
    'https://londontechweek.com',
    'https://www.gitex.com',
    'https://www.slush.org',
  ];
}

var args = process.argv.slice(2);
var CURATED_ONLY = args.includes('--curated-only');
var DRY_RUN = args.includes('--dry-run');

var stats = { checked: 0, added: 0, duplicates: 0, failed: 0, stale: 0 };

async function harvestAndStore(url) {
  stats.checked++;
  try {
    var extracted = await harvestEvent(url);

    // Filter stale events
    if (extracted.event_date) {
      var eventYear = new Date(extracted.event_date).getFullYear();
      if (eventYear < 2025) {
        stats.stale++;
        return;
      }
    }

    // Fuzzy dedup
    var dupe = await findDuplicate(
      extracted.name,
      extracted.event_date,
      extracted.city
    );
    if (dupe) {
      stats.duplicates++;
      return;
    }

    if (DRY_RUN) {
      console.log('[DRY]', extracted.name, '|', extracted.city, '|', extracted.event_date);
      stats.added++;
      return;
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
        extracted.event_format || 'conference', JSON.stringify(themes), slug,
        extracted.website || url,
        extracted.expected_attendees || null
      ]
    );

    if (result && result.rows && result.rows[0]) {
      stats.added++;
      console.log('  +', extracted.name, '|', extracted.city || '?', '|', extracted.event_date || 'no date');
    } else {
      stats.duplicates++;
    }
  } catch(e) {
    stats.failed++;
    if (!e.message.includes('Could not reach') && !e.message.includes('HTTP 4')) {
      console.error('  X', url.substring(0, 60), '—', e.message.substring(0, 80));
    }
  }
}

async function run() {
  var startTime = Date.now();
  console.log('=== Weekly Event Harvest ===');
  console.log('Date:', new Date().toISOString());
  console.log('Curated URLs:', CURATED_URLS.length);
  console.log('Mode:', DRY_RUN ? 'DRY RUN' : 'LIVE');
  console.log('');

  // Phase 1: Re-check curated URLs
  console.log('── Phase 1: Curated sources ──');
  for (var i = 0; i < CURATED_URLS.length; i++) {
    await harvestAndStore(CURATED_URLS[i]);
    if (i < CURATED_URLS.length - 1) {
      await new Promise(function(r) { setTimeout(r, 1500); });
    }
  }

  // Phase 2: Search-based discovery (if not curated-only and Serper key exists)
  if (!CURATED_ONLY && process.env.SERPER_API_KEY) {
    console.log('\n── Phase 2: Search discovery ──');
    var { harvest } = require('../lib/event_harvester');
    var searchStats = await harvest({ maxQueries: 1, dryRun: DRY_RUN });
    stats.added += searchStats.stored || 0;
    stats.duplicates += searchStats.duplicates || 0;
    stats.failed += searchStats.errors || 0;
  } else if (!CURATED_ONLY) {
    console.log('\n── Phase 2: Skipped (no SERPER_API_KEY) ──');
  }

  var elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log('\n=== RESULTS ===');
  console.log('Checked:', stats.checked);
  console.log('New events added:', stats.added);
  console.log('Duplicates skipped:', stats.duplicates);
  console.log('Stale skipped:', stats.stale);
  console.log('Failed:', stats.failed);
  console.log('Duration:', elapsed, 'seconds');

  var total = await dbGet('SELECT COUNT(*) as count FROM events');
  console.log('Total events in DB:', total.count);

  process.exit(0);
}

run().catch(function(err) {
  console.error('Fatal:', err);
  process.exit(1);
});
