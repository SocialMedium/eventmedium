var express = require('express');
var { dbGet, dbRun, dbAll } = require('../db');
var { authenticateToken } = require('../middleware/auth');
var { normalizeThemes, normalizeTheme } = require('../lib/theme_taxonomy');
var { getEmbedding, searchByVector, COLLECTIONS } = require('../lib/vector_search');

var router = express.Router();

// ══════════════════════════════════════════════════════
// THEME NORMALIZATION — 50+ variants → 16 canonical
// ══════════════════════════════════════════════════════

function parseJsonSafe(val, fallback) {
  if (!val) return fallback || [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch(e) { return fallback || []; }
  }
  return fallback || [];
}

// ══════════════════════════════════════════════════════
// ARCHETYPE TAXONOMY
// ══════════════════════════════════════════════════════

var ARCHETYPE_COMPATIBILITY = {
  'founder':    { 'investor': 0.95, 'advisor': 0.8, 'operator': 0.7, 'corporate': 0.6, 'researcher': 0.5, 'founder': 0.4 },
  'investor':   { 'founder': 0.95, 'investor': 0.5, 'corporate': 0.6, 'advisor': 0.5, 'researcher': 0.4, 'operator': 0.4 },
  'researcher': { 'corporate': 0.8, 'founder': 0.7, 'investor': 0.5, 'researcher': 0.6, 'advisor': 0.4, 'operator': 0.3 },
  'corporate':  { 'founder': 0.7, 'researcher': 0.8, 'corporate': 0.4, 'investor': 0.6, 'advisor': 0.5, 'operator': 0.5 },
  'advisor':    { 'founder': 0.8, 'investor': 0.5, 'corporate': 0.5, 'researcher': 0.4, 'advisor': 0.3, 'operator': 0.4 },
  'operator':   { 'founder': 0.7, 'corporate': 0.5, 'investor': 0.4, 'advisor': 0.4, 'researcher': 0.3, 'operator': 0.3 }
};

function scoreStakeholderFit(typeA, typeB) {
  if (!typeA || !typeB) return 0.5;
  var a = typeA.toLowerCase();
  var b = typeB.toLowerCase();
  if (ARCHETYPE_COMPATIBILITY[a] && ARCHETYPE_COMPATIBILITY[a][b] !== undefined) {
    return ARCHETYPE_COMPATIBILITY[a][b];
  }
  return 0.4;
}

// ══════════════════════════════════════════════════════
// THEME SCORING — Jaccard similarity on normalized themes
// ══════════════════════════════════════════════════════

function scoreThemeOverlap(themesA, themesB) {
  var a = normalizeThemes(parseJsonSafe(themesA));
  var b = normalizeThemes(parseJsonSafe(themesB));
  if (!a.length || !b.length) return { score: 0, shared: [] };

  var setA = {};
  a.forEach(function(t) { setA[t] = true; });
  var intersection = b.filter(function(t) { return setA[t]; });
  var union = new Set(a.concat(b));

  return {
    score: intersection.length / union.size,
    shared: intersection
  };
}

// ══════════════════════════════════════════════════════
// INTENT COMPLEMENTARITY — does A's want match B's offer?
// ══════════════════════════════════════════════════════

function scoreIntentComplementarity(profileA, profileB) {
  var intentA = parseJsonSafe(profileA.intent);
  var offeringA = parseJsonSafe(profileA.offering);
  var intentB = parseJsonSafe(profileB.intent);
  var offeringB = parseJsonSafe(profileB.offering);

  if ((!intentA.length && !intentB.length) || (!offeringA.length && !offeringB.length)) {
    return { score: 0, reasons: [] };
  }

  var reasons = [];
  var matchCount = 0;
  var totalChecks = 0;

  // Does A want what B offers?
  intentA.forEach(function(want) {
    var wantLower = want.toLowerCase();
    offeringB.forEach(function(offer) {
      totalChecks++;
      if (offer.toLowerCase().indexOf(wantLower) !== -1 || wantLower.indexOf(offer.toLowerCase()) !== -1) {
        matchCount++;
        reasons.push('A wants "' + want + '" — B offers "' + offer + '"');
      }
    });
  });

  // Does B want what A offers?
  intentB.forEach(function(want) {
    var wantLower = want.toLowerCase();
    offeringA.forEach(function(offer) {
      totalChecks++;
      if (offer.toLowerCase().indexOf(wantLower) !== -1 || wantLower.indexOf(offer.toLowerCase()) !== -1) {
        matchCount++;
        reasons.push('B wants "' + want + '" — A offers "' + offer + '"');
      }
    });
  });

  var score = totalChecks > 0 ? Math.min(1.0, matchCount / Math.max(1, totalChecks / 2)) : 0;
  return { score: score, reasons: reasons };
}

// ══════════════════════════════════════════════════════
// CAPITAL FIT — investor-founder specific scoring
// ══════════════════════════════════════════════════════

function scoreCapitalFit(profileA, profileB) {
  var typeA = (profileA.stakeholder_type || '').toLowerCase();
  var typeB = (profileB.stakeholder_type || '').toLowerCase();

  // Only applies to investor-founder pairs
  var investor, founder;
  if (typeA === 'investor' && typeB === 'founder') {
    investor = profileA; founder = profileB;
  } else if (typeB === 'investor' && typeA === 'founder') {
    investor = profileB; founder = profileA;
  } else {
    return { score: 0, reasons: [], applicable: false };
  }

  var investorDeal = parseJsonSafe(investor.deal_details, {});
  if (typeof investorDeal === 'string') { try { investorDeal = JSON.parse(investorDeal); } catch(e) { investorDeal = {}; } }
  var founderDeal = parseJsonSafe(founder.deal_details, {});
  if (typeof founderDeal === 'string') { try { founderDeal = JSON.parse(founderDeal); } catch(e) { founderDeal = {}; } }

  var score = 0;
  var reasons = [];
  var components = 0;

  // Stage alignment
  if (investorDeal.stages && founderDeal.stage) {
    components++;
    var stages = Array.isArray(investorDeal.stages) ? investorDeal.stages : [investorDeal.stages];
    var stagesLower = stages.map(function(s) { return s.toLowerCase(); });
    if (stagesLower.indexOf(founderDeal.stage.toLowerCase()) !== -1) {
      score += 0.35;
      reasons.push('Stage match: ' + founderDeal.stage);
    }
  }

  // Check size vs raise amount
  if (investorDeal.check_size && founderDeal.raise_amount) {
    components++;
    var check = parseFloat(String(investorDeal.check_size).replace(/[^0-9.]/g, '')) || 0;
    var raise = parseFloat(String(founderDeal.raise_amount).replace(/[^0-9.]/g, '')) || 0;
    if (raise > 0 && check > 0) {
      var ratio = check / raise;
      if (ratio >= 0.05 && ratio <= 0.5) {
        score += 0.25;
        reasons.push('Check-to-raise ratio: ' + (ratio * 100).toFixed(0) + '%');
      }
    }
  }

  // Sector overlap
  if (investorDeal.sectors && founderDeal.sector) {
    components++;
    var sectors = Array.isArray(investorDeal.sectors) ? investorDeal.sectors : [investorDeal.sectors];
    var sectorsLower = sectors.map(function(s) { return s.toLowerCase(); });
    if (sectorsLower.indexOf(founderDeal.sector.toLowerCase()) !== -1) {
      score += 0.25;
      reasons.push('Sector match: ' + founderDeal.sector);
    }
  }

  // Geography alignment
  if (investor.geography && founder.geography) {
    components++;
    if (investor.geography.toLowerCase().indexOf(founder.geography.toLowerCase()) !== -1 ||
        founder.geography.toLowerCase().indexOf(investor.geography.toLowerCase()) !== -1) {
      score += 0.15;
      reasons.push('Geographic alignment');
    }
  }

  return { score: Math.min(1.0, score), reasons: reasons, applicable: true };
}

// ══════════════════════════════════════════════════════
// SIGNAL ENRICHMENT (Tier 2 — plugs in when available)
// ══════════════════════════════════════════════════════

async function scoreSignalAlignment(profileA, profileB) {
  var context = [];
  var convergence = 0;
  var timing = 0;
  var constraint = 0;

  try {
    var themesA = normalizeThemes(parseJsonSafe(profileA.themes));
    var themesB = normalizeThemes(parseJsonSafe(profileB.themes));
    var sharedThemes = themesA.filter(function(t) { return themesB.indexOf(t) !== -1; });

    if (!sharedThemes.length) {
      return { total: 0, convergence: 0, timing: 0, constraint: 0, reasons: [], context: [] };
    }

    // Check if shared themes have converging signals
    var recentSignals = await dbAll(
      `SELECT theme, source_type, entity_name, signal_summary, lifecycle_stage, cost_of_signal, final_weight
       FROM unified_signals
       WHERE theme = ANY($1::text[])
       AND signal_date > NOW() - INTERVAL '90 days'
       ORDER BY final_weight DESC
       LIMIT 20`,
      [sharedThemes]
    );

    if (recentSignals.length >= 3) {
      // Count independent source types
      var sourceTypes = {};
      recentSignals.forEach(function(s) { sourceTypes[s.source_type] = true; });
      var independentSources = Object.keys(sourceTypes).length;

      // Convergence: ≥3 independent source types on shared theme = strong signal
      if (independentSources >= 3) {
        convergence = Math.min(1.0, independentSources * 0.2);
        context.push('Converging signals across ' + independentSources + ' source types on: ' + sharedThemes.join(', '));
      }

      // Check for high-cost signals (SEC filings, funding rounds)
      var highCost = recentSignals.filter(function(s) { return s.cost_of_signal === 'high'; });
      if (highCost.length >= 2) {
        convergence += 0.2;
        context.push(highCost.length + ' high-cost signals (filings/funding) detected');
      }

      // Lifecycle acceleration
      var accelerating = recentSignals.filter(function(s) { return s.lifecycle_stage === 'accelerating'; });
      if (accelerating.length >= 2) {
        timing = 0.5;
        context.push('Theme lifecycle: accelerating');
      }
    }

    // Entity-level signal overlap
    var entityA = (profileA.company || '').toLowerCase();
    var entityB = (profileB.company || '').toLowerCase();
    if (entityA && entityB) {
      var entitySignals = await dbAll(
        `SELECT entity_name, signal_summary FROM unified_signals
         WHERE LOWER(entity_name) IN ($1, $2)
         AND signal_date > NOW() - INTERVAL '60 days'
         ORDER BY final_weight DESC LIMIT 5`,
        [entityA, entityB]
      );
      if (entitySignals.length) {
        constraint = 0.3;
        entitySignals.forEach(function(s) {
          context.push(s.entity_name + ': ' + (s.signal_summary || '').slice(0, 100));
        });
      }
    }
  } catch (err) {
    console.error('Signal alignment scoring error:', err);
  }

  var total = (convergence + timing + constraint) / 3;
  var reasons = context.map(function(c) { return '[Signal] ' + c; });

  return {
    total: Math.min(1.0, total),
    convergence: convergence,
    timing: timing,
    constraint: constraint,
    reasons: reasons,
    context: context
  };
}

// ══════════════════════════════════════════════════════
// MAIN SCORING FUNCTION
// ══════════════════════════════════════════════════════

async function scoreMatch(userA, userB, eventId, options) {
  options = options || {};

  // Load profiles with user info
  var profileA = await dbGet(
    'SELECT sp.*, u.name as name, u.company as company FROM stakeholder_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.user_id = $1',
    [userA]
  );
  var profileB = await dbGet(
    'SELECT sp.*, u.name as name, u.company as company FROM stakeholder_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.user_id = $1',
    [userB]
  );

  if (!profileA || !profileB) return null;

  // 1. Semantic similarity (Qdrant cosine)
  var scoreSemantic = 0;
  try {
    if (profileA.qdrant_vector_id && profileB.qdrant_vector_id) {
      // Get A's vector and search for B's proximity
      var searchResult = await searchByVector(
        COLLECTIONS.profiles,
        null, // we'll use a different approach
        1,
        { must: [{ key: 'user_id', match: { value: userB } }] }
      );
      // Alternative: compute from stored embeddings directly
      // For now, use a text-based embedding comparison
    }
  } catch(e) {}

  // Fallback: embed both profile texts and compute cosine
  var { buildProfileText } = require('../lib/vector_search');
  var textA = buildProfileText(profileA, { name: profileA.name, company: profileA.company });
  var textB = buildProfileText(profileB, { name: profileB.name, company: profileB.company });

  if (textA && textB) {
    var embeddings = await require('../lib/vector_search').getEmbeddings([textA, textB]);
    if (embeddings.length === 2) {
      scoreSemantic = cosineSimilarity(embeddings[0], embeddings[1]);
    }
  }

  // 2. Theme overlap
  var themeResult = scoreThemeOverlap(profileA.themes, profileB.themes);

  // 3. Intent complementarity
  var intentResult = scoreIntentComplementarity(profileA, profileB);

  // 4. Stakeholder fit
  var scoreStakeholder = scoreStakeholderFit(profileA.stakeholder_type, profileB.stakeholder_type);

  // 5. Capital fit
  var capitalResult = scoreCapitalFit(profileA, profileB);

  // 6. Signal enrichment (Tier 2)
  var signalScores = { total: 0, convergence: 0, timing: 0, constraint: 0, reasons: [], context: [] };
  if (options.enrichWithSignals !== false) {
    try {
      signalScores = await scoreSignalAlignment(profileA, profileB);
    } catch(e) {
      console.error('Signal enrichment error:', e);
    }
  }

  // Build reasons array
  var reasons = [];
  if (themeResult.shared.length) {
    reasons.push('Shared themes: ' + themeResult.shared.join(', '));
  }
  reasons = reasons.concat(intentResult.reasons);
  if (capitalResult.applicable && capitalResult.reasons.length) {
    reasons = reasons.concat(capitalResult.reasons);
  }
  reasons = reasons.concat(signalScores.reasons);

  if (scoreStakeholder >= 0.7) {
    reasons.push('Strong archetype fit: ' + profileA.stakeholder_type + ' ↔ ' + profileB.stakeholder_type);
  }

  // Weighted composite
  var hasSignals = signalScores.total > 0;
  var weights;
  if (hasSignals) {
    // Tier 2: signals contribute
    weights = {
      semantic: 0.35,
      theme: 0.10,
      intent: 0.10,
      stakeholder: 0.08,
      capital: capitalResult.applicable ? 0.07 : 0,
      signals: 0.30
    };
  } else {
    // Tier 1: profile only
    weights = {
      semantic: 0.50,
      theme: 0.15,
      intent: 0.15,
      stakeholder: 0.10,
      capital: capitalResult.applicable ? 0.10 : 0,
      signals: 0
    };
  }

  // Redistribute capital weight if not applicable
  if (!capitalResult.applicable) {
    weights.semantic += weights.capital;
    weights.capital = 0;
  }

  var scoreTotal =
    (scoreSemantic * weights.semantic) +
    (themeResult.score * weights.theme) +
    (intentResult.score * weights.intent) +
    (scoreStakeholder * weights.stakeholder) +
    (capitalResult.score * weights.capital) +
    (signalScores.total * weights.signals);

  return {
    user_a_id: userA,
    user_b_id: userB,
    event_id: eventId,
    score_total: Math.round(scoreTotal * 1000) / 1000,
    score_semantic: Math.round(scoreSemantic * 1000) / 1000,
    score_theme: Math.round(themeResult.score * 1000) / 1000,
    score_intent: Math.round(intentResult.score * 1000) / 1000,
    score_stakeholder: Math.round(scoreStakeholder * 1000) / 1000,
    score_capital: capitalResult.applicable ? Math.round(capitalResult.score * 1000) / 1000 : null,
    score_signal_convergence: Math.round(signalScores.convergence * 1000) / 1000,
    score_timing: Math.round(signalScores.timing * 1000) / 1000,
    score_constraint_complementarity: Math.round(signalScores.constraint * 1000) / 1000,
    match_reasons: reasons,
    signal_context: signalScores.context
  };
}

// Cosine similarity helper
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  var dot = 0, normA = 0, normB = 0;
  for (var i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  var denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ══════════════════════════════════════════════════════
// GENERATE MATCHES FOR A USER AT AN EVENT
// ══════════════════════════════════════════════════════

async function generateMatchesForUser(userId, eventId, options) {
  options = options || {};
  var threshold = options.threshold || 0.4;

  // Get all other registrants
  var registrants = await dbAll(
    `SELECT user_id FROM event_registrations
     WHERE event_id = $1 AND user_id != $2 AND status = 'active'`,
    [eventId, userId]
  );

  var matches = [];
  for (var i = 0; i < registrants.length; i++) {
    var otherId = registrants[i].user_id;

    // Skip if match already exists
    var existing = await dbGet(
      `SELECT id FROM event_matches
       WHERE event_id = $1 AND
       ((user_a_id = $2 AND user_b_id = $3) OR (user_a_id = $3 AND user_b_id = $2))`,
      [eventId, userId, otherId]
    );
    if (existing) continue;

    var result = await scoreMatch(userId, otherId, eventId, options);
    if (!result || result.score_total < threshold) continue;

    // Insert match
    await dbRun(
      `INSERT INTO event_matches
        (event_id, user_a_id, user_b_id, score_total, score_semantic, score_theme, score_intent,
         score_stakeholder, score_capital, score_signal_convergence, score_timing,
         score_constraint_complementarity, match_reasons, signal_context, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (event_id, user_a_id, user_b_id) DO NOTHING`,
      [
        eventId, userId, otherId,
        result.score_total, result.score_semantic, result.score_theme, result.score_intent,
        result.score_stakeholder, result.score_capital,
        result.score_signal_convergence, result.score_timing, result.score_constraint_complementarity,
        JSON.stringify(result.match_reasons), JSON.stringify(result.signal_context),
        'pending'
      ]
    );

    matches.push(result);
  }

  return matches;
}

// ══════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════

// ── GET /api/matches/mine ── all matches for current user
router.get('/mine', authenticateToken, async function(req, res) {
  try {
    var matches = await dbAll(
      `SELECT em.*,
        CASE WHEN em.user_a_id = $1 THEN em.user_b_id ELSE em.user_a_id END as other_user_id,
        CASE WHEN em.user_a_id = $1 THEN em.user_a_decision ELSE em.user_b_decision END as my_decision,
        CASE WHEN em.user_a_id = $1 THEN em.user_b_decision ELSE em.user_a_decision END as their_decision,
        e.name as event_name, e.event_date
       FROM event_matches em
       JOIN events e ON e.id = em.event_id
       WHERE (em.user_a_id = $1 OR em.user_b_id = $1)
       ORDER BY em.score_total DESC`,
      [req.user.id]
    );

    // For revealed matches, include other user's info
    for (var i = 0; i < matches.length; i++) {
      if (matches[i].status === 'revealed') {
        var otherUser = await dbGet(
          'SELECT u.name, u.company, u.avatar_url, sp.stakeholder_type, sp.themes, sp.focus_text, sp.geography FROM users u LEFT JOIN stakeholder_profiles sp ON sp.user_id = u.id WHERE u.id = $1',
          [matches[i].other_user_id]
        );
        matches[i].other_user = otherUser;
      }
    }

    res.json({ matches: matches });
  } catch (err) {
    console.error('Get matches error:', err);
    res.status(500).json({ error: 'Failed to load matches' });
  }
});

// ── POST /api/matches/:matchId/decide ── accept or decline
router.post('/:matchId/decide', authenticateToken, async function(req, res) {
  try {
    var matchId = parseInt(req.params.matchId);
    var { decision } = req.body; // 'accepted' or 'declined'

    if (!decision || ['accepted', 'declined'].indexOf(decision) === -1) {
      return res.status(400).json({ error: 'Decision must be accepted or declined' });
    }

    var match = await dbGet('SELECT * FROM event_matches WHERE id = $1', [matchId]);
    if (!match) return res.status(404).json({ error: 'Match not found' });

    // Determine which side the user is
    var isA = match.user_a_id === req.user.id;
    var isB = match.user_b_id === req.user.id;
    if (!isA && !isB) return res.status(403).json({ error: 'Not your match' });

    var column = isA ? 'user_a_decision' : 'user_b_decision';
    await dbRun(
      'UPDATE event_matches SET ' + column + ' = $1 WHERE id = $2',
      [decision, matchId]
    );

    // Reload match to check for mutual accept
    match = await dbGet('SELECT * FROM event_matches WHERE id = $1', [matchId]);

    if (match.user_a_decision === 'accepted' && match.user_b_decision === 'accepted') {
      // Mutual accept → reveal
      await dbRun(
        "UPDATE event_matches SET status = 'revealed', revealed_at = NOW() WHERE id = $1",
        [matchId]
      );

      // Create match outcome tracking record
      await dbRun(
        'INSERT INTO match_outcomes (match_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [matchId]
      );

      // Notify both users
      var otherUserId = isA ? match.user_b_id : match.user_a_id;
      await createNotification(req.user.id, 'match_revealed', 'Match revealed!', 'You have a new connection. Start a conversation!', '/chat.html?match=' + matchId);
      await createNotification(otherUserId, 'match_revealed', 'Match revealed!', 'You have a new connection. Start a conversation!', '/chat.html?match=' + matchId);

      // Send email notifications (async)
      notifyMatchReveal(matchId).catch(function(err) {
        console.error('Match reveal email error:', err);
      });

      match.status = 'revealed';
    } else if (decision === 'declined') {
      await dbRun("UPDATE event_matches SET status = 'declined' WHERE id = $1", [matchId]);
      match.status = 'declined';
    }

    res.json({ match: match });
  } catch (err) {
    console.error('Match decide error:', err);
    res.status(500).json({ error: 'Failed to process decision' });
  }
});

// ── POST /api/admin/generate-matches-bulk ── trigger matching for an event
router.post('/admin/generate-bulk', authenticateToken, async function(req, res) {
  try {
    // TODO: add admin role check
    var { event_id, threshold } = req.body;
    if (!event_id) return res.status(400).json({ error: 'event_id required' });

    var registrants = await dbAll(
      "SELECT user_id FROM event_registrations WHERE event_id = $1 AND status = 'active'",
      [event_id]
    );

    var totalMatches = 0;
    for (var i = 0; i < registrants.length; i++) {
      var matches = await generateMatchesForUser(
        registrants[i].user_id, event_id,
        { threshold: threshold || 0.4, enrichWithSignals: true }
      );
      totalMatches += matches.length;
    }

    res.json({ event_id: event_id, registrants: registrants.length, matches_generated: totalMatches });
  } catch (err) {
    console.error('Bulk match generation error:', err);
    res.status(500).json({ error: 'Match generation failed' });
  }
});

// ══════════════════════════════════════════════════════
// NOTIFICATION HELPERS
// ══════════════════════════════════════════════════════

async function createNotification(userId, type, title, body, link, metadata) {
  await dbRun(
    'INSERT INTO notifications (user_id, type, title, body, link, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
    [userId, type, title, body, link, metadata ? JSON.stringify(metadata) : null]
  );
}

// ══════════════════════════════════════════════════════
// EMAIL NOTIFICATION HELPERS
// ══════════════════════════════════════════════════════

async function notifyMatchReveal(matchId) {
  try {
    var { Resend } = require('resend');
    var resend = new Resend(process.env.RESEND_API_KEY);

    var match = await dbGet('SELECT * FROM event_matches WHERE id = $1', [matchId]);
    if (!match) return;

    var userA = await dbGet('SELECT name, email FROM users WHERE id = $1', [match.user_a_id]);
    var userB = await dbGet('SELECT name, email FROM users WHERE id = $1', [match.user_b_id]);
    if (!userA || !userB) return;

    var reasons = parseJsonSafe(match.match_reasons).slice(0, 3).join(', ');
    var appUrl = process.env.APP_URL || 'https://eventmedium.ai';

    // Email user A
    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'nev@eventmedium.ai',
      to: userA.email,
      subject: 'New connection: ' + userB.name,
      html: '<p>Hi ' + userA.name + ',</p><p>Great news — you and <strong>' + userB.name + '</strong> matched!</p>' +
            (reasons ? '<p><em>' + reasons + '</em></p>' : '') +
            '<p><a href="' + appUrl + '/chat.html?match=' + matchId + '">Start a conversation →</a></p>' +
            '<p>— Nev</p>'
    });

    // Email user B
    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'nev@eventmedium.ai',
      to: userB.email,
      subject: 'New connection: ' + userA.name,
      html: '<p>Hi ' + userB.name + ',</p><p>Great news — you and <strong>' + userA.name + '</strong> matched!</p>' +
            (reasons ? '<p><em>' + reasons + '</em></p>' : '') +
            '<p><a href="' + appUrl + '/chat.html?match=' + matchId + '">Start a conversation →</a></p>' +
            '<p>— Nev</p>'
    });
  } catch (err) {
    console.error('notifyMatchReveal error:', err);
  }
}

module.exports = { router, scoreMatch, generateMatchesForUser, createNotification, notifyMatchReveal };
