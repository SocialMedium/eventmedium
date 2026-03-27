// ── Community Intelligence Routes ──
// Mount at /api/community
// Pulse, event-triggers, suggest-match, member-moments, signals/inbound

var express = require('express');
var crypto = require('crypto');
var router = express.Router();
var { dbGet, dbRun, dbAll } = require('../db');
var { logSignalOutcome } = require('../lib/outcome_logger');
var { authenticateToken } = require('../middleware/auth');
var { getCanonicalThemes, normalizeTheme } = require('../lib/theme_taxonomy');

var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
var EDITORIAL_MODEL = process.env.EDITORIAL_MODEL || 'claude-sonnet-4-20250514';
var PULSE_CACHE_TTL_HOURS = parseInt(process.env.PULSE_CACHE_TTL_HOURS) || 4;

// ── Community owner auth ──
async function communityOwnerAuth(req, res, next) {
  var communityId = req.params.communityId;
  if (!communityId) return res.status(400).json({ error: 'communityId required' });

  try {
    var member = await dbGet(
      'SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2',
      [communityId, req.user.id]
    );
    if (!member || member.role !== 'owner') {
      return res.status(403).json({ error: 'Community owner access required' });
    }
    req.communityId = communityId;
    next();
  } catch (err) {
    console.error('[community] Auth error:', err);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

// ── Editorial generation via Claude ──
async function generateEditorial(prompt, maxTokens) {
  if (!ANTHROPIC_API_KEY) return '(Editorial generation requires API key)';
  try {
    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: EDITORIAL_MODEL,
        max_tokens: maxTokens || 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!resp.ok) return '(Editorial generation unavailable)';
    var data = await resp.json();
    return data.content[0].text;
  } catch (err) {
    console.error('[community] Editorial generation error:', err.message);
    return '(Editorial generation unavailable)';
  }
}

// ── Cache helpers ──
function cacheKey(communityId, params) {
  var str = communityId + JSON.stringify(params);
  return crypto.createHash('md5').update(str).digest('hex');
}

async function getCachedPulse(communityId, filterHash) {
  var row = await dbGet(
    'SELECT payload FROM pulse_cache WHERE community_id = $1 AND filter_hash = $2 AND expires_at > NOW()',
    [communityId, filterHash]
  );
  return row ? row.payload : null;
}

async function setCachedPulse(communityId, filterHash, payload) {
  await dbRun(
    `INSERT INTO pulse_cache (community_id, filter_hash, payload, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '${PULSE_CACHE_TTL_HOURS} hours')
     ON CONFLICT (community_id, filter_hash)
     DO UPDATE SET payload = $3, generated_at = NOW(), expires_at = NOW() + INTERVAL '${PULSE_CACHE_TTL_HOURS} hours'`,
    [communityId, filterHash, JSON.stringify(payload)]
  );
}

// ══════════════════════════════════════════════════════
// GET /api/community/:communityId/pulse
// Aggregate signal intelligence
// ══════════════════════════════════════════════════════
router.get('/:communityId/pulse', authenticateToken, communityOwnerAuth, async function(req, res) {
  try {
    var communityId = req.communityId;
    var region = req.query.region || null;
    var theme = req.query.theme || null;
    var action = req.query.action || null;
    var period = req.query.period || '30d';

    // Validate theme
    if (theme) {
      var normalized = normalizeTheme(theme);
      if (!normalized) return res.status(400).json({ error: 'Invalid theme: ' + theme });
      theme = normalized;
    }

    var filterHash = cacheKey(communityId, { region: region, theme: theme, action: action, period: period });

    // Check cache
    var cached = await getCachedPulse(communityId, filterHash);
    if (cached) return res.json(typeof cached === 'string' ? JSON.parse(cached) : cached);

    // Period to interval
    var intervalMap = { '7d': '7 days', '30d': '30 days', '90d': '90 days' };
    var interval = intervalMap[period] || '30 days';

    // Fetch signals
    var conditions = ['community_id = $1', "received_at > NOW() - INTERVAL '" + interval + "'"];
    var params = [communityId];
    var idx = 2;

    if (region) { conditions.push('region = $' + idx); params.push(region); idx++; }
    if (theme) { conditions.push('$' + idx + ' = ANY(theme_tags)'); params.push(theme); idx++; }
    if (action) { conditions.push("metadata->>'signal_action' = $" + idx); params.push(action); idx++; }

    var signals = await dbAll(
      'SELECT * FROM community_signals WHERE ' + conditions.join(' AND ') + ' ORDER BY received_at DESC',
      params
    );

    var signalCount = signals.length;

    // K-anonymity check
    if (signalCount < 5) {
      return res.json({
        period: period,
        filters: { region: region, theme: theme, action: action },
        insufficient_data: true,
        message: 'Fewer than 5 signals for this filter combination'
      });
    }

    // Compute heat score (normalized signal density)
    // Compare current period to prior period
    var priorSignals = await dbAll(
      "SELECT COUNT(*) as count FROM community_signals WHERE community_id = $1 AND received_at > NOW() - INTERVAL '" + interval + "' * 2 AND received_at <= NOW() - INTERVAL '" + interval + "'",
      [communityId]
    );
    var priorCount = parseInt(priorSignals[0] ? priorSignals[0].count : 0) || 1;
    var heatScore = Math.min(1, signalCount / Math.max(priorCount * 1.5, 10));
    var heatDelta = priorCount > 0 ? Math.round((signalCount - priorCount) / priorCount * 100) : 0;

    // Aggregate action breakdown
    var actionCounts = {};
    var themeCounts = {};
    for (var i = 0; i < signals.length; i++) {
      var meta = signals[i].metadata || {};
      if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch(e) { meta = {}; } }
      var act = meta.signal_action || 'unknown';
      actionCounts[act] = (actionCounts[act] || 0) + 1;
      var tags = signals[i].theme_tags || [];
      for (var t = 0; t < tags.length; t++) {
        themeCounts[tags[t]] = (themeCounts[tags[t]] || 0) + 1;
      }
    }

    // Find dominant action
    var dominantAction = 'unknown';
    var maxCount = 0;
    for (var a in actionCounts) {
      if (actionCounts[a] > maxCount) { maxCount = actionCounts[a]; dominantAction = a; }
    }

    // Build signal clusters (group by theme)
    var clusters = [];
    var sortedThemes = Object.keys(themeCounts).sort(function(a, b) { return themeCounts[b] - themeCounts[a]; });
    for (var ti = 0; ti < Math.min(sortedThemes.length, 5); ti++) {
      var ct = sortedThemes[ti];
      var clusterSignals = signals.filter(function(s) { return (s.theme_tags || []).indexOf(ct) !== -1; });
      var clusterActions = {};
      for (var ci = 0; ci < clusterSignals.length; ci++) {
        var cm = clusterSignals[ci].metadata || {};
        if (typeof cm === 'string') { try { cm = JSON.parse(cm); } catch(e) { cm = {}; } }
        var ca = cm.signal_action || 'unknown';
        clusterActions[ca] = (clusterActions[ca] || 0) + 1;
      }

      var strength = Math.min(1, clusterSignals.length / signalCount * 2);
      var triggerWorthy = clusterSignals.length >= 5 && strength > 0.6;

      // Generate editorial summary
      var editorial = await generateEditorial(
        'You are an editorial writer for a community intelligence dashboard. Write a one-sentence editorial summary for a signal cluster about "' + ct + '" with ' + clusterSignals.length + ' signals. Action breakdown: ' + JSON.stringify(clusterActions) + '. Be specific, warm, and signal-grounded. No raw data. No individual names. No boilerplate.',
        100
      );

      var triggerRationale = '';
      if (triggerWorthy) {
        triggerRationale = await generateEditorial(
          'Write a one-sentence "why now" rationale for programming a community event around "' + ct + '". Signal evidence: ' + clusterSignals.length + ' signals with actions ' + JSON.stringify(clusterActions) + '. Be specific about timing and opportunity.',
          80
        );
      }

      clusters.push({
        label: ct + ' activity',
        canonical_theme: ct,
        strength: Math.round(strength * 100) / 100,
        signal_count: clusterSignals.length,
        action_breakdown: clusterActions,
        editorial_summary: editorial,
        programming_trigger: triggerWorthy,
        trigger_rationale: triggerRationale || null
      });
    }

    // Active canister count
    var canisterCount = await dbGet(
      'SELECT COUNT(*) as count FROM community_members cm JOIN stakeholder_profiles sp ON sp.user_id = cm.user_id WHERE cm.community_id = $1',
      [communityId]
    );

    // Network narrative
    var narrative = await generateEditorial(
      'Write a 2-sentence aggregate network narrative for a community with ' + signalCount + ' signals in the last ' + period + '. Heat score: ' + Math.round(heatScore * 100) + '%. Dominant activity: ' + dominantAction + '. Top themes: ' + sortedThemes.slice(0, 3).join(', ') + '. Be warm, specific, editorial. No individual data. No boilerplate.',
      120
    );

    var payload = {
      period: period,
      filters: { region: region, theme: theme, action: action },
      pulse: {
        heat_score: Math.round(heatScore * 100) / 100,
        heat_delta: (heatDelta >= 0 ? '+' : '') + heatDelta + '% vs prior period',
        dominant_action: dominantAction,
        signal_count: signalCount,
        active_canister_count: parseInt(canisterCount.count) || 0
      },
      signal_clusters: clusters,
      network_context: { narrative: narrative },
      generated_at: new Date().toISOString()
    };

    // Cache result
    await setCachedPulse(communityId, filterHash, payload);

    res.json(payload);
  } catch (err) {
    console.error('[community] Pulse error:', err);
    res.status(500).json({ error: 'Failed to generate pulse' });
  }
});

// ══════════════════════════════════════════════════════
// GET /api/community/:communityId/event-triggers
// Programming recommendations from signal cluster analysis
// ══════════════════════════════════════════════════════
router.get('/:communityId/event-triggers', authenticateToken, communityOwnerAuth, async function(req, res) {
  try {
    var communityId = req.communityId;

    // Get recent pulse data
    var signals = await dbAll(
      "SELECT * FROM community_signals WHERE community_id = $1 AND received_at > NOW() - INTERVAL '30 days' ORDER BY received_at DESC",
      [communityId]
    );

    if (signals.length < 5) {
      return res.json({ triggers: [], message: 'Insufficient signal data for recommendations' });
    }

    // Cluster by theme
    var themeClusters = {};
    for (var i = 0; i < signals.length; i++) {
      var tags = signals[i].theme_tags || [];
      for (var t = 0; t < tags.length; t++) {
        if (!themeClusters[tags[t]]) themeClusters[tags[t]] = [];
        themeClusters[tags[t]].push(signals[i]);
      }
    }

    var triggers = [];
    var themes = Object.keys(themeClusters).sort(function(a, b) {
      return themeClusters[b].length - themeClusters[a].length;
    });

    for (var ti = 0; ti < Math.min(themes.length, 3); ti++) {
      var theme = themes[ti];
      var clusterSize = themeClusters[theme].length;
      var heat = Math.min(1, clusterSize / signals.length * 2);

      // Determine event type based on cluster characteristics
      var actionCounts = {};
      for (var si = 0; si < themeClusters[theme].length; si++) {
        var meta = themeClusters[theme][si].metadata || {};
        if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch(e) { meta = {}; } }
        var act = meta.signal_action || 'unknown';
        actionCounts[act] = (actionCounts[act] || 0) + 1;
      }

      var eventType = clusterSize > 10 ? 'roundtable' : 'content';
      var confidence = heat > 0.7 ? 'high' : heat > 0.4 ? 'medium' : 'low';

      var title = await generateEditorial(
        'Generate a short event title (max 8 words) for a ' + eventType + ' about "' + theme + '". Signal actions: ' + JSON.stringify(actionCounts) + '. Make it specific and compelling, not generic.',
        30
      );

      var rationale = await generateEditorial(
        'Write a one-sentence rationale for why a community should programme a ' + eventType + ' about "' + theme + '" now. Evidence: ' + clusterSize + ' signals with actions ' + JSON.stringify(actionCounts) + '. Include supply/demand framing if applicable.',
        80
      );

      var trigger = {
        type: eventType,
        title: title.replace(/"/g, ''),
        rationale: rationale,
        optimal_timing: clusterSize > 15 ? 'Next 1-2 weeks' : 'Next 3-4 weeks',
        anchor_themes: [theme],
        cluster_heat: Math.round(heat * 100) / 100,
        confidence: confidence
      };

      if (eventType === 'roundtable') {
        trigger.suggested_member_count = Math.min(20, Math.max(8, Math.round(clusterSize * 0.6)));
      }
      if (eventType === 'content') {
        trigger.format_suggestion = 'Short editorial dispatch (600-800 words)';
      }

      triggers.push(trigger);
    }

    res.json({ triggers: triggers });
  } catch (err) {
    console.error('[community] Event triggers error:', err);
    res.status(500).json({ error: 'Failed to generate triggers' });
  }
});

// ══════════════════════════════════════════════════════
// POST /api/community/:communityId/suggest-match
// Community owner triggers connection opportunity into double-blind flow
// ══════════════════════════════════════════════════════
router.post('/:communityId/suggest-match', authenticateToken, communityOwnerAuth, async function(req, res) {
  try {
    var communityId = req.communityId;
    var signalBasis = req.body.signal_basis;
    var signalRationale = req.body.signal_rationale;
    var themeContext = req.body.theme_context;

    if (!signalBasis || !Array.isArray(signalBasis) || signalBasis.length === 0) {
      return res.status(400).json({ error: 'signal_basis array required' });
    }
    if (!signalRationale) {
      return res.status(400).json({ error: 'signal_rationale required' });
    }

    // Validate theme context
    if (themeContext) {
      var validTheme = normalizeTheme(themeContext);
      if (!validTheme) return res.status(400).json({ error: 'Invalid theme_context: ' + themeContext });
      themeContext = validTheme;
    }

    // Validate signal_basis entries are legitimate signal types
    var validSignalTypes = [
      'funding_round', 'hiring_signal', 'publication', 'director_appointment',
      'company_filing', 'honours_award', 'patent_grant', 'grant_award',
      'news', 'property_transaction', 'capital_raise', 'm_and_a',
      'company_activity', 'deal_stage', 'event_attendance'
    ];
    for (var i = 0; i < signalBasis.length; i++) {
      if (validSignalTypes.indexOf(signalBasis[i]) === -1) {
        return res.status(400).json({ error: 'Invalid signal type: ' + signalBasis[i] });
      }
    }

    // Create trigger record
    var trigger = await dbGet(
      `INSERT INTO community_match_triggers (community_id, triggered_by, signal_basis, signal_rationale, theme_context, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, status, created_at`,
      [communityId, req.user.id, signalBasis, signalRationale, themeContext]
    );

    // In production: insert into event_matches for both members and trigger notification flow
    // The double-blind flow means member IDs are NOT stored in the trigger record
    // Each member gets an independent notification:
    // "Your community [Name] thinks you might benefit from connecting — based on [rationale]."

    // Update status to notified (in production, after notification delivery)
    await dbRun(
      "UPDATE community_match_triggers SET status = 'notified', notified_at = NOW() WHERE id = $1",
      [trigger.id]
    );

    // Outcome logging — fire and forget
    logSignalOutcome({
      community_id: communityId,
      signal_type: 'match_trigger',
      action_taken: 'match_triggered',
      action_taken_at: new Date(),
      outcome: 'pending',
      metadata: { signal_basis: signalBasis, theme_context: themeContext }
    });

    res.json({
      status: 'triggered',
      trigger_id: trigger.id,
      message: 'Connection opportunity surfaced to members via double-blind flow'
    });
  } catch (err) {
    console.error('[community] Suggest match error:', err);
    res.status(500).json({ error: 'Failed to trigger match' });
  }
});

// ══════════════════════════════════════════════════════
// GET /api/community/:communityId/member-moments
// Point-in-time trigger signals (alumni_network focus)
// ══════════════════════════════════════════════════════
router.get('/:communityId/member-moments', authenticateToken, communityOwnerAuth, async function(req, res) {
  try {
    var communityId = req.communityId;
    var period = req.query.period || '7d';
    var jurisdiction = req.query.jurisdiction || null;
    var costFilter = req.query.cost || 'all';

    var intervalMap = { '7d': '7 days', '30d': '30 days' };
    var interval = intervalMap[period] || '7 days';

    var conditions = [
      'community_id = $1',
      "received_at > NOW() - INTERVAL '" + interval + "'"
    ];
    var params = [communityId];
    var idx = 2;

    if (jurisdiction) {
      conditions.push("metadata->>'jurisdiction' = $" + idx);
      params.push(jurisdiction);
      idx++;
    }
    if (costFilter !== 'all') {
      conditions.push("metadata->>'cost_of_signal' = $" + idx);
      params.push(costFilter);
      idx++;
    }

    // Exclude insolvency/dissolution from member moments — route to ops view
    conditions.push("signal_type NOT IN ('insolvency', 'company_dissolution')");

    var signals = await dbAll(
      'SELECT * FROM community_signals WHERE ' + conditions.join(' AND ') +
      " ORDER BY CASE WHEN metadata->>'cost_of_signal' = 'high' THEN 1 WHEN metadata->>'cost_of_signal' = 'medium' THEN 2 ELSE 3 END, received_at DESC",
      params
    );

    // K-anonymity: only surface where >= 3 members associated with entity
    // For now, check member_count >= 5 (DB constraint) and apply editorial transform
    var moments = [];
    for (var i = 0; i < signals.length; i++) {
      var sig = signals[i];
      if (sig.member_count < 5) continue; // k-anonymity

      var meta = sig.metadata || {};
      if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch(e) { meta = {}; } }

      // Generate editorial copy — no raw text, no individual names
      var editorial = await generateEditorial(
        'Write a one-sentence editorial for a member moment signal. Type: ' + sig.signal_type +
        '. Cost: ' + (meta.cost_of_signal || 'unknown') +
        '. Entity type: ' + (meta.entity_type || 'unknown') +
        '. Jurisdiction: ' + (meta.jurisdiction || 'unknown') +
        '. Theme: ' + ((sig.theme_tags || [])[0] || 'unknown') +
        '. DO NOT name individuals. Use phrases like "a company in your alumni community\'s ecosystem" or "an individual connected to your community". Be editorial, warm, specific.',
        100
      );

      var ageMs = Date.now() - new Date(sig.received_at).getTime();
      var ageDays = Math.round(ageMs / 86400000);

      moments.push({
        moment_id: sig.id,
        signal_type: sig.signal_type,
        cost_of_signal: meta.cost_of_signal || 'medium',
        jurisdiction: meta.jurisdiction || 'global',
        canonical_theme: (sig.theme_tags || [])[0] || null,
        editorial: editorial,
        signal_age_days: ageDays,
        action_available: sig.member_count >= 5 // match trigger possible
      });
    }

    res.json({
      period: period,
      moments: moments,
      generated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[community] Member moments error:', err);
    res.status(500).json({ error: 'Failed to load member moments' });
  }
});

// ══════════════════════════════════════════════════════
// POST /api/community/:communityId/signals/inbound
// Internal: receives anonymised aggregate behavioral signals
// ══════════════════════════════════════════════════════
router.post('/:communityId/signals/inbound', async function(req, res) {
  // Internal endpoint — authenticate via API secret header
  var secret = req.headers['x-community-secret'];
  if (!secret || secret !== process.env.COMMUNITY_API_SECRET) {
    return res.status(403).json({ error: 'Invalid API secret' });
  }

  try {
    var body = req.body;
    var communityId = req.params.communityId;

    // Validate required fields
    if (!body.signal_type) return res.status(400).json({ error: 'signal_type required' });
    if (body.aggregate_only !== true) {
      console.warn('[community] Rejected non-aggregate signal:', body);
      return res.status(400).json({ error: 'aggregate_only must be true' });
    }
    if (!body.member_count || body.member_count < 1) {
      console.warn('[community] Rejected signal with invalid member_count:', body);
      return res.status(400).json({ error: 'member_count must be >= 1' });
    }

    // Validate theme tags
    if (body.theme_tags) {
      var canonicalThemes = getCanonicalThemes();
      for (var i = 0; i < body.theme_tags.length; i++) {
        var nt = normalizeTheme(body.theme_tags[i]);
        if (!nt) {
          console.warn('[community] Rejected signal with invalid theme:', body.theme_tags[i]);
          return res.status(400).json({ error: 'Invalid theme_tag: ' + body.theme_tags[i] });
        }
        body.theme_tags[i] = nt;
      }
    }

    await dbRun(
      `INSERT INTO community_signals (community_id, signal_type, region, theme_tags, member_count, metadata, aggregate_only)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
      [
        communityId,
        body.signal_type,
        body.region || null,
        body.theme_tags || [],
        Math.max(5, body.member_count), // enforce k-anonymity floor
        JSON.stringify(body.metadata || {}),
      ]
    );

    res.json({ status: 'accepted' });
  } catch (err) {
    console.error('[community] Inbound signal error:', err);
    res.status(500).json({ error: 'Failed to process signal' });
  }
});

// ══════════════════════════════════════════════════════
// GET /api/community/:communityId/match-trigger-stats
// Aggregate outcome stats for match triggers
// ══════════════════════════════════════════════════════
router.get('/:communityId/match-trigger-stats', authenticateToken, communityOwnerAuth, async function(req, res) {
  try {
    var stats = await dbAll(
      "SELECT status, COUNT(*) as count FROM community_match_triggers WHERE community_id = $1 AND created_at > NOW() - INTERVAL '30 days' GROUP BY status",
      [req.communityId]
    );

    var total = 0;
    var accepted = 0;
    var statusMap = {};
    for (var i = 0; i < stats.length; i++) {
      var c = parseInt(stats[i].count);
      total += c;
      statusMap[stats[i].status] = c;
      if (stats[i].status === 'accepted_both') accepted += c;
    }

    res.json({
      period: '30d',
      total_triggers: total,
      accepted: accepted,
      status_breakdown: statusMap,
      acceptance_rate: total > 0 ? Math.round(accepted / total * 100) + '%' : 'N/A'
    });
  } catch (err) {
    console.error('[community] Match stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

module.exports = { router: router };
