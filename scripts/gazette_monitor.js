#!/usr/bin/env node
// ── Gazette Monitor ──
// Schedule: Run on known announcement dates:
//   UK Gazette: 1 Jan (New Year Honours) + June (Birthday Honours)
//   AU Gazette: 26 Jan (Australia Day) + June (King's Birthday)
//   SG Gazette: 9 Aug (National Day)
// Also runs daily check for any ad-hoc gazette publications

var { dbAll, dbGet } = require('../db');
var { storeSignals } = require('../lib/integrations/base');

// ── UK: London Gazette Honours API ──
async function fetchUKHonours() {
  console.log('[gazette] Fetching UK London Gazette honours...');
  var signals = [];

  try {
    // London Gazette has a free REST API
    var resp = await fetch('https://www.thegazette.co.uk/honours/search?results-page=1&results-page-size=50&categorycode=E', {
      headers: { 'Accept': 'application/json' }
    });

    if (resp.ok) {
      var data = await resp.json();
      var items = data.results || data.items || [];

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        signals.push({
          community_id: null, // Will be assigned per-community
          source_type: 'honours_award',
          provider: 'london_gazette',
          canonical_theme: 'Impact & Social',
          signal_action: 'recognising',
          cost_of_signal: 'high',
          constraint_level: 'high',
          region: 'uk',
          jurisdiction: 'uk',
          entity_type: 'institution',
          entity_name: item.honour_type || item.category || 'UK Honours',
          summary_raw: 'National honour awarded: ' + (item.honour_type || 'unknown') + ' — ' + (item.description || ''),
          timestamp: new Date(item.publication_date || Date.now()),
          metadata: {
            gazette_issue: item.issue_number,
            honour_type: item.honour_type,
            gazette_url: item.url
          }
        });
      }
    }
  } catch (err) {
    console.error('[gazette] UK honours fetch error:', err.message);
  }

  console.log('[gazette] UK: found', signals.length, 'honour signals');
  return signals;
}

// ── AU: Commonwealth Gazette PDF fetch ──
async function fetchAUHonours() {
  console.log('[gazette] Fetching AU Commonwealth Gazette honours...');
  var signals = [];

  try {
    // AU Gazette publishes as PDF — check the awards database
    var resp = await fetch('https://honours.pmc.gov.au/api/search?limit=50&order=date_desc');

    if (resp.ok) {
      var data = await resp.json();
      var items = data.results || data.data || [];

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        signals.push({
          community_id: null,
          source_type: 'honours_award',
          provider: 'au_gazette',
          canonical_theme: 'Impact & Social',
          signal_action: 'recognising',
          cost_of_signal: 'high',
          constraint_level: 'high',
          region: 'au',
          jurisdiction: 'au',
          entity_type: 'institution',
          entity_name: item.award_name || item.honour || 'Australian Honours',
          summary_raw: 'Australian honour awarded: ' + (item.award_name || 'unknown') + ' for ' + (item.citation || 'services'),
          timestamp: new Date(item.date || Date.now()),
          metadata: {
            award_level: item.award_level || item.honour,
            citation: item.citation,
            category: item.category
          }
        });
      }
    }
  } catch (err) {
    console.error('[gazette] AU honours fetch error:', err.message);
    // Fallback: PDF parsing would go here in production
  }

  console.log('[gazette] AU: found', signals.length, 'honour signals');
  return signals;
}

// ── SG: Singapore Government Gazette ──
async function fetchSGHonours() {
  console.log('[gazette] Fetching SG Government Gazette honours...');
  var signals = [];

  try {
    // SG Gazette is PDF-based; check PMO National Awards page
    var resp = await fetch('https://www.pmo.gov.sg/national-honours');
    // In production: parse HTML or PDF for National Day Awards
    // For now: structured monitoring placeholder
    if (resp.ok) {
      console.log('[gazette] SG PMO page accessible — parse for awards');
      // PDF extraction would go here
    }
  } catch (err) {
    console.error('[gazette] SG honours fetch error:', err.message);
  }

  console.log('[gazette] SG: found', signals.length, 'honour signals');
  return signals;
}

// ── Main: fetch all gazettes and distribute to communities ──
async function run() {
  console.log('[gazette_monitor] Starting gazette enrichment...');

  try {
    // Fetch signals from all jurisdictions
    var allSignals = [];
    var ukSignals = await fetchUKHonours();
    var auSignals = await fetchAUHonours();
    var sgSignals = await fetchSGHonours();

    allSignals = allSignals.concat(ukSignals, auSignals, sgSignals);
    console.log('[gazette_monitor] Total gazette signals:', allSignals.length);

    if (allSignals.length === 0) {
      console.log('[gazette_monitor] No new gazette signals. Done.');
      process.exit(0);
      return;
    }

    // Get all communities with gazette integrations enabled
    var gazetteProviders = ['london_gazette', 'au_gazette', 'sg_gazette'];
    var integrations = await dbAll(
      "SELECT community_id, provider FROM community_integrations WHERE provider = ANY($1) AND enabled = true",
      [gazetteProviders]
    );

    console.log('[gazette_monitor] Distributing to', integrations.length, 'community integrations');

    for (var i = 0; i < integrations.length; i++) {
      var integration = integrations[i];
      var communitySignals = allSignals
        .filter(function(s) { return s.provider === integration.provider; })
        .map(function(s) {
          return Object.assign({}, s, { community_id: integration.community_id });
        });

      if (communitySignals.length > 0) {
        var stored = await storeSignals(communitySignals);
        console.log('[gazette_monitor]', integration.community_id, '/', integration.provider, '- stored', stored);
      }
    }

    console.log('[gazette_monitor] Complete');
  } catch (err) {
    console.error('[gazette_monitor] Fatal error:', err);
  }

  process.exit(0);
}

run();
