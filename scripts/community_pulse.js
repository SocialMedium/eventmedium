#!/usr/bin/env node
// ── Community Pulse Pre-computation ──
// Schedule: Every 4 hours (staggered from other jobs)
// Purpose: Pre-compute and cache pulse payloads for all active communities

var { dbAll, dbGet, dbRun } = require('../db');
var crypto = require('crypto');

var PULSE_CACHE_TTL_HOURS = parseInt(process.env.PULSE_CACHE_TTL_HOURS) || 4;

async function run() {
  console.log('[community_pulse] Starting pulse pre-computation...');

  try {
    var communities = await dbAll(
      'SELECT ct.community_id, ct.name, ct.community_type, ct.region, ct.primary_themes FROM community_tenants ct WHERE ct.active_canister_count > 0'
    );

    console.log('[community_pulse] Processing', communities.length, 'communities');

    for (var i = 0; i < communities.length; i++) {
      var comm = communities[i];
      var periods = ['7d', '30d', '90d'];

      for (var p = 0; p < periods.length; p++) {
        var period = periods[p];
        var intervalMap = { '7d': '7 days', '30d': '30 days', '90d': '90 days' };
        var interval = intervalMap[period];

        try {
          var signals = await dbAll(
            "SELECT * FROM community_signals WHERE community_id = $1 AND received_at > NOW() - INTERVAL '" + interval + "'",
            [comm.community_id]
          );

          if (signals.length < 5) continue;

          // Compute heat score
          var priorResult = await dbGet(
            "SELECT COUNT(*) as count FROM community_signals WHERE community_id = $1 AND received_at > NOW() - INTERVAL '" + interval + "' * 2 AND received_at <= NOW() - INTERVAL '" + interval + "'",
            [comm.community_id]
          );
          var priorCount = parseInt(priorResult.count) || 1;
          var heatScore = Math.min(1, signals.length / Math.max(priorCount * 1.5, 10));
          var heatDelta = priorCount > 0 ? Math.round((signals.length - priorCount) / priorCount * 100) : 0;

          // Action/theme breakdown
          var actionCounts = {};
          var themeCounts = {};
          for (var s = 0; s < signals.length; s++) {
            var meta = signals[s].metadata || {};
            if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch(e) { meta = {}; } }
            var act = meta.signal_action || 'unknown';
            actionCounts[act] = (actionCounts[act] || 0) + 1;
            var tags = signals[s].theme_tags || [];
            for (var t = 0; t < tags.length; t++) {
              themeCounts[tags[t]] = (themeCounts[tags[t]] || 0) + 1;
            }
          }

          var dominantAction = Object.keys(actionCounts).sort(function(a, b) { return actionCounts[b] - actionCounts[a]; })[0] || 'unknown';

          var payload = {
            period: period,
            filters: {},
            pulse: {
              heat_score: Math.round(heatScore * 100) / 100,
              heat_delta: (heatDelta >= 0 ? '+' : '') + heatDelta + '% vs prior period',
              dominant_action: dominantAction,
              signal_count: signals.length,
              active_canister_count: 0 // Will be populated by API
            },
            signal_clusters: Object.keys(themeCounts).slice(0, 5).map(function(theme) {
              return {
                label: theme + ' activity',
                canonical_theme: theme,
                strength: Math.min(1, (themeCounts[theme] || 0) / signals.length * 2),
                signal_count: themeCounts[theme] || 0,
                action_breakdown: {},
                editorial_summary: '(Pre-computed — editorial generated on demand)',
                programming_trigger: (themeCounts[theme] || 0) >= 5
              };
            }),
            generated_at: new Date().toISOString()
          };

          var filterHash = crypto.createHash('md5').update(comm.community_id + JSON.stringify({ period: period })).digest('hex');

          await dbRun(
            `INSERT INTO pulse_cache (community_id, filter_hash, payload, expires_at)
             VALUES ($1, $2, $3, NOW() + INTERVAL '${PULSE_CACHE_TTL_HOURS} hours')
             ON CONFLICT (community_id, filter_hash)
             DO UPDATE SET payload = $3, generated_at = NOW(), expires_at = NOW() + INTERVAL '${PULSE_CACHE_TTL_HOURS} hours'`,
            [comm.community_id, filterHash, JSON.stringify(payload)]
          );

          console.log('[community_pulse]', comm.name, period, '- cached', signals.length, 'signals');
        } catch (err) {
          console.error('[community_pulse] Error for', comm.community_id, period, ':', err.message);
        }
      }
    }

    console.log('[community_pulse] Complete');
  } catch (err) {
    console.error('[community_pulse] Fatal error:', err);
  }

  process.exit(0);
}

run();
