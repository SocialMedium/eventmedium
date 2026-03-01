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
// NETWORK PROXIMITY SCORING
// ══════════════════════════════════════════════════════

async function scoreNetworkProximity(userA, userB) {
  var score = 0;
  var reasons = [];

  try {
    // 1. Shared event registrations (both registered for same events)
    var sharedEvents = await dbGet(
      `SELECT COUNT(*)::int as count FROM event_registrations a
       JOIN event_registrations b ON a.event_id = b.event_id
       WHERE a.user_id = $1 AND b.user_id = $2 AND a.status = 'active' AND b.status = 'active'`,
      [userA, userB]
    );
    var eventOverlap = sharedEvents ? sharedEvents.count : 0;
    if (eventOverlap >= 3) {
      score += 0.4;
      reasons.push('Co-registered at ' + eventOverlap + ' events');
    } else if (eventOverlap >= 2) {
      score += 0.25;
      reasons.push('Co-registered at ' + eventOverlap + ' events');
    } else if (eventOverlap >= 1) {
      score += 0.1;
    }

    // 2. Shared revealed matches (both independently matched with same third person)
    var mutualReveals = await dbGet(
      `SELECT COUNT(DISTINCT a_matches.su)::int as count FROM (
         SELECT CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END as su
         FROM event_matches WHERE (user_a_id = $1 OR user_b_id = $1) AND status = 'revealed'
       ) a_matches
       JOIN (
         SELECT CASE WHEN user_a_id = $2 THEN user_b_id ELSE user_a_id END as su
         FROM event_matches WHERE (user_a_id = $2 OR user_b_id = $2) AND status = 'revealed'
       ) b_matches ON a_matches.su = b_matches.su`,
      [userA, userB]
    );

    var mutualCount = mutualReveals ? mutualReveals.count : 0;
    if (mutualCount >= 2) {
      score += 0.35;
      reasons.push(mutualCount + ' mutual revealed connections');
    } else if (mutualCount >= 1) {
      score += 0.2;
      reasons.push('1 mutual revealed connection');
    }

    // 3. Theme cluster density — do they share niche theme combos (not just "AI")
    var profileA = await dbGet('SELECT themes FROM stakeholder_profiles WHERE user_id = $1', [userA]);
    var profileB = await dbGet('SELECT themes FROM stakeholder_profiles WHERE user_id = $1', [userB]);

    if (profileA && profileB) {
      var themesA = [];
      var themesB = [];
      try { themesA = typeof profileA.themes === 'string' ? JSON.parse(profileA.themes) : (profileA.themes || []); } catch(e) {}
      try { themesB = typeof profileB.themes === 'string' ? JSON.parse(profileB.themes) : (profileB.themes || []); } catch(e) {}

      // Only count non-generic themes as cluster signal
      var genericThemes = ['AI', 'Enterprise SaaS', 'FinTech'];
      var nicheA = themesA.filter(function(t) { return genericThemes.indexOf(t) === -1; });
      var nicheB = themesB.filter(function(t) { return genericThemes.indexOf(t) === -1; });
      var nicheOverlap = nicheA.filter(function(t) { return nicheB.indexOf(t) !== -1; });

      if (nicheOverlap.length >= 2) {
        score += 0.25;
        reasons.push('Niche theme cluster: ' + nicheOverlap.join(', '));
      } else if (nicheOverlap.length === 1) {
        score += 0.1;
      }
    }

    // 4. Positive feedback pattern — has either user had high-quality matches with similar archetypes?
    var otherProfile = await dbGet('SELECT stakeholder_type FROM stakeholder_profiles WHERE user_id = $1', [userB]);
    if (otherProfile && otherProfile.stakeholder_type) {
      var positivePattern = await dbGet(
        `SELECT COUNT(*)::int as count FROM match_feedback mf
         JOIN event_matches em ON em.id = mf.match_id
         JOIN stakeholder_profiles sp ON sp.user_id = CASE WHEN em.user_a_id = $1 THEN em.user_b_id ELSE em.user_a_id END
         WHERE mf.user_id = $1 AND mf.rating = 'valuable' AND sp.stakeholder_type = $2`,
        [userA, otherProfile.stakeholder_type]
      );
      if (positivePattern && positivePattern.count >= 2) {
        score += 0.15;
        reasons.push('User has valued ' + otherProfile.stakeholder_type + ' matches before');
      }
    }

  } catch (err) {
    console.error('Network proximity scoring error:', err);
  }

  return {
    score: Math.min(1.0, score),
    reasons: reasons.map(function(r) { return '[Network] ' + r; })
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

  // 6. Network proximity (Tier 2)
  var networkResult = { score: 0, reasons: [] };
  try {
    networkResult = await scoreNetworkProximity(userA, userB);
  } catch(e) {
    console.error('Network proximity error:', e);
  }

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
  var hasNetwork = networkResult.score > 0;
  var weights;
  if (hasSignals) {
    // Tier 2: signals + network contribute
    weights = {
      semantic: 0.30,
      theme: 0.08,
      intent: 0.10,
      stakeholder: 0.07,
      capital: capitalResult.applicable ? 0.05 : 0,
      signals: 0.25,
      network: 0.15
    };
  } else if (hasNetwork) {
    // Tier 1.5: no signals but network data exists
    weights = {
      semantic: 0.40,
      theme: 0.12,
      intent: 0.13,
      stakeholder: 0.08,
      capital: capitalResult.applicable ? 0.07 : 0,
      signals: 0,
      network: 0.20
    };
  } else {
    // Tier 1: profile only
    weights = {
      semantic: 0.50,
      theme: 0.15,
      intent: 0.15,
      stakeholder: 0.10,
      capital: capitalResult.applicable ? 0.10 : 0,
      signals: 0,
      network: 0
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
    (signalScores.total * weights.signals) +
    (networkResult.score * weights.network);

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
  reasons = reasons.concat(networkResult.reasons);

  if (scoreStakeholder >= 0.7) {
    reasons.push('Strong archetype fit: ' + profileA.stakeholder_type + ' ↔ ' + profileB.stakeholder_type);
  }

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
    score_network_proximity: Math.round(networkResult.score * 1000) / 1000,
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


// ══════════════════════════════════════════════════════
// INBOX & FEEDBACK ROUTES (Sprint 4 — Nev Debrief)
// ══════════════════════════════════════════════════════

// ── GET /api/matches/mutual ── inbox: revealed matches with full profiles
router.get('/mutual', authenticateToken, async function(req, res) {
  try {
    var matches = await dbAll(
      `SELECT
        em.id as match_id,
        em.event_id,
        em.score_total,
        em.match_reasons,
        em.signal_context,
        em.revealed_at as mutual_at,
        em.status,
        em.user_a_id, em.user_b_id,
        em.user_a_context, em.user_b_context,
        CASE WHEN em.user_a_id = $1 THEN em.user_b_id ELSE em.user_a_id END as other_user_id,
        e.name as event_name, e.event_date
       FROM event_matches em
       JOIN events e ON e.id = em.event_id
       WHERE (em.user_a_id = $1 OR em.user_b_id = $1)
         AND em.status = 'revealed'
       ORDER BY em.revealed_at DESC`,
      [req.user.id]
    );

    // Enrich with other user's profile
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      var isA = m.user_a_id === req.user.id;

      // Other user info
      var otherUser = await dbGet(
        'SELECT id, name, email, company, avatar_url FROM users WHERE id = $1',
        [m.other_user_id]
      );

      // Other user profile
      var otherProfile = await dbGet(
        `SELECT stakeholder_type, themes, focus_text, geography, intent, offering
         FROM stakeholder_profiles WHERE user_id = $1`,
        [m.other_user_id]
      );

      // Existing feedback
      var existingFeedback = await dbGet(
        'SELECT rating, did_meet, nev_chat_completed FROM match_feedback WHERE match_id = $1 AND user_id = $2',
        [m.match_id, req.user.id]
      );

      // Build flat match reason from array
      var reasons = [];
      try { reasons = JSON.parse(m.match_reasons || '[]'); } catch(e) {}

      matches[i] = {
        match_id: m.match_id,
        event_id: m.event_id,
        event_name: m.event_name,
        event_date: m.event_date,
        score_total: m.score_total,
        match_reason: reasons.slice(0, 2).join('. '),
        signal_context: m.signal_context,
        mutual_at: m.mutual_at,
        status: m.status,
        their_context: isA ? m.user_b_context : m.user_a_context,
        my_context: isA ? m.user_a_context : m.user_b_context,
        other_user: otherUser || {},
        other_profile: otherProfile || {},
        feedback: existingFeedback || null
      };
    }

    res.json({ matches: matches });
  } catch (err) {
    console.error('Get mutual matches error:', err);
    res.status(500).json({ error: 'Failed to load mutual matches' });
  }
});


// ── POST /api/matches/:id/context ── send a note to your match
router.post('/:matchId/context', authenticateToken, async function(req, res) {
  try {
    var matchId = parseInt(req.params.matchId);
    var { context } = req.body;
    if (!context || !context.trim()) return res.status(400).json({ error: 'Context message required' });

    var match = await dbGet('SELECT * FROM event_matches WHERE id = $1', [matchId]);
    if (!match) return res.status(404).json({ error: 'Match not found' });

    var isA = match.user_a_id === req.user.id;
    var isB = match.user_b_id === req.user.id;
    if (!isA && !isB) return res.status(403).json({ error: 'Not your match' });

    var column = isA ? 'user_a_context' : 'user_b_context';
    await dbRun(
      'UPDATE event_matches SET ' + column + ' = $1 WHERE id = $2',
      [context.trim().slice(0, 500), matchId]
    );

    // Notify the other user
    var otherUserId = isA ? match.user_b_id : match.user_a_id;
    await createNotification(
      otherUserId, 'match_message',
      'New message from a match',
      'Someone sent you a note. Check your inbox.',
      '/inbox.html'
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Context save error:', err);
    res.status(500).json({ error: 'Failed to save message' });
  }
});


// ── POST /api/matches/:id/feedback ── quick rating (inbox buttons)
router.post('/:matchId/feedback', authenticateToken, async function(req, res) {
  try {
    var matchId = parseInt(req.params.matchId);
    var { feedback } = req.body;
    var validRatings = ['valuable', 'not_relevant', 'didnt_connect'];
    if (!feedback || validRatings.indexOf(feedback) === -1) {
      return res.status(400).json({ error: 'Invalid feedback type' });
    }

    var match = await dbGet('SELECT * FROM event_matches WHERE id = $1', [matchId]);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.user_a_id !== req.user.id && match.user_b_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your match' });
    }

    await dbRun(
      `INSERT INTO match_feedback (match_id, user_id, rating)
       VALUES ($1, $2, $3)
       ON CONFLICT (match_id, user_id) DO UPDATE SET rating = $3, updated_at = NOW()`,
      [matchId, req.user.id, feedback]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Feedback error:', err);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});


// ══════════════════════════════════════════════════════
// POST-MEETING DEBRIEF — structured feedback + Nev chat
// ══════════════════════════════════════════════════════

// ── POST /api/matches/:id/debrief ── structured post-meeting feedback
router.post('/:matchId/debrief', authenticateToken, async function(req, res) {
  try {
    var matchId = parseInt(req.params.matchId);
    var {
      did_meet, meeting_quality, would_meet_again,
      outcome_type, outcome_notes,
      relevance_score, theme_accuracy, intent_accuracy, stakeholder_fit_accuracy,
      what_worked, what_didnt
    } = req.body;

    var match = await dbGet('SELECT * FROM event_matches WHERE id = $1', [matchId]);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.user_a_id !== req.user.id && match.user_b_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your match' });
    }

    await dbRun(
      `INSERT INTO match_feedback
        (match_id, user_id, did_meet, meeting_quality, would_meet_again,
         outcome_type, outcome_notes, relevance_score,
         theme_accuracy, intent_accuracy, stakeholder_fit_accuracy,
         what_worked, what_didnt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (match_id, user_id) DO UPDATE SET
         did_meet = COALESCE($3, match_feedback.did_meet),
         meeting_quality = COALESCE($4, match_feedback.meeting_quality),
         would_meet_again = COALESCE($5, match_feedback.would_meet_again),
         outcome_type = COALESCE($6, match_feedback.outcome_type),
         outcome_notes = COALESCE($7, match_feedback.outcome_notes),
         relevance_score = COALESCE($8, match_feedback.relevance_score),
         theme_accuracy = COALESCE($9, match_feedback.theme_accuracy),
         intent_accuracy = COALESCE($10, match_feedback.intent_accuracy),
         stakeholder_fit_accuracy = COALESCE($11, match_feedback.stakeholder_fit_accuracy),
         what_worked = COALESCE($12, match_feedback.what_worked),
         what_didnt = COALESCE($13, match_feedback.what_didnt),
         updated_at = NOW()`,
      [matchId, req.user.id, did_meet, meeting_quality, would_meet_again,
       outcome_type, outcome_notes, relevance_score,
       theme_accuracy, intent_accuracy, stakeholder_fit_accuracy,
       what_worked, what_didnt]
    );

    // Extract tuning insights from structured feedback
    await extractDebriefInsights(matchId, req.user.id, req.body, match);

    res.json({ success: true });
  } catch (err) {
    console.error('Debrief error:', err);
    res.status(500).json({ error: 'Failed to save debrief' });
  }
});


// ── GET /api/matches/:id/debrief ── get debrief state + chat history
router.get('/:matchId/debrief', authenticateToken, async function(req, res) {
  try {
    var matchId = parseInt(req.params.matchId);

    var feedback = await dbGet(
      'SELECT * FROM match_feedback WHERE match_id = $1 AND user_id = $2',
      [matchId, req.user.id]
    );

    var chatMessages = [];
    if (feedback) {
      chatMessages = await dbAll(
        'SELECT role, content, created_at FROM nev_debrief_messages WHERE match_feedback_id = $1 ORDER BY created_at ASC',
        [feedback.id]
      );
    }

    var match = await dbGet(
      `SELECT em.*, e.name as event_name,
        CASE WHEN em.user_a_id = $1 THEN em.user_b_id ELSE em.user_a_id END as other_user_id
       FROM event_matches em JOIN events e ON e.id = em.event_id
       WHERE em.id = $2`,
      [req.user.id, matchId]
    );

    var otherUser = null;
    if (match) {
      otherUser = await dbGet('SELECT name, company FROM users WHERE id = $1', [match.other_user_id]);
    }

    res.json({
      feedback: feedback || null,
      chat: chatMessages,
      match_context: match ? {
        event_name: match.event_name,
        other_name: otherUser ? otherUser.name : null,
        other_company: otherUser ? otherUser.company : null,
        score_total: match.score_total,
        match_reasons: match.match_reasons
      } : null
    });
  } catch (err) {
    console.error('Get debrief error:', err);
    res.status(500).json({ error: 'Failed to load debrief' });
  }
});


// ── POST /api/matches/:id/debrief/chat ── Nev debrief conversation
router.post('/:matchId/debrief/chat', authenticateToken, async function(req, res) {
  try {
    var matchId = parseInt(req.params.matchId);
    var { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });

    // Ensure feedback record exists
    var feedback = await dbGet(
      'SELECT * FROM match_feedback WHERE match_id = $1 AND user_id = $2',
      [matchId, req.user.id]
    );

    if (!feedback) {
      // Create skeleton record to hang chat on
      await dbRun(
        'INSERT INTO match_feedback (match_id, user_id, nev_chat_started) VALUES ($1, $2, true) ON CONFLICT (match_id, user_id) DO UPDATE SET nev_chat_started = true',
        [matchId, req.user.id]
      );
      feedback = await dbGet(
        'SELECT * FROM match_feedback WHERE match_id = $1 AND user_id = $2',
        [matchId, req.user.id]
      );
    }

    if (!feedback.nev_chat_started) {
      await dbRun('UPDATE match_feedback SET nev_chat_started = true WHERE id = $1', [feedback.id]);
    }

    // Save user message
    await dbRun(
      'INSERT INTO nev_debrief_messages (match_feedback_id, role, content) VALUES ($1, $2, $3)',
      [feedback.id, 'user', message.trim()]
    );

    // Load match context for Nev
    var match = await dbGet(
      `SELECT em.*, e.name as event_name,
        CASE WHEN em.user_a_id = $1 THEN em.user_b_id ELSE em.user_a_id END as other_user_id
       FROM event_matches em JOIN events e ON e.id = em.event_id WHERE em.id = $2`,
      [req.user.id, matchId]
    );

    var otherUser = match ? await dbGet('SELECT name, company FROM users WHERE id = $1', [match.other_user_id]) : null;
    var currentUser = await dbGet('SELECT name, company FROM users WHERE id = $1', [req.user.id]);
    var userProfile = await dbGet('SELECT * FROM stakeholder_profiles WHERE user_id = $1', [req.user.id]);

    // Load chat history
    var history = await dbAll(
      'SELECT role, content FROM nev_debrief_messages WHERE match_feedback_id = $1 ORDER BY created_at ASC',
      [feedback.id]
    );

    // Build Nev's system prompt
    var reasons = [];
    try { reasons = JSON.parse(match.match_reasons || '[]'); } catch(e) {}

    var systemPrompt = buildNevDebriefPrompt({
      userName: currentUser ? currentUser.name : 'there',
      userCompany: currentUser ? currentUser.company : null,
      userType: userProfile ? userProfile.stakeholder_type : null,
      otherName: otherUser ? otherUser.name : 'your match',
      otherCompany: otherUser ? otherUser.company : null,
      eventName: match ? match.event_name : 'the event',
      matchScore: match ? match.score_total : null,
      matchReasons: reasons,
      feedbackSoFar: feedback
    });

    // Call LLM for Nev's response
    var nevReply = await getNevResponse(systemPrompt, history);

    // Save Nev's response
    await dbRun(
      'INSERT INTO nev_debrief_messages (match_feedback_id, role, content, metadata) VALUES ($1, $2, $3, $4)',
      [feedback.id, 'nev', nevReply.message, JSON.stringify(nevReply.extracted || {})]
    );

    // If Nev extracted insights, store them
    if (nevReply.extracted && nevReply.extracted.insights) {
      for (var ins of nevReply.extracted.insights) {
        await dbRun(
          'INSERT INTO feedback_insights (match_feedback_id, user_id, insight_type, insight_key, insight_value, confidence) VALUES ($1,$2,$3,$4,$5,$6)',
          [feedback.id, req.user.id, ins.type, ins.key, ins.value, ins.confidence || 0.6]
        );
      }
    }

    // Check if debrief feels complete
    if (nevReply.extracted && nevReply.extracted.debrief_complete) {
      await dbRun('UPDATE match_feedback SET nev_chat_completed = true, updated_at = NOW() WHERE id = $1', [feedback.id]);
    }

    res.json({
      reply: nevReply.message,
      extracted: nevReply.extracted || {},
      chat_complete: nevReply.extracted ? nevReply.extracted.debrief_complete : false
    });
  } catch (err) {
    console.error('Nev debrief chat error:', err);
    res.status(500).json({ error: 'Failed to process message' });
  }
});


// ══════════════════════════════════════════════════════
// NEV DEBRIEF — PROMPT BUILDER & LLM CALL
// ══════════════════════════════════════════════════════

function buildNevDebriefPrompt(ctx) {
  return `You are Nev, the AI concierge for Event Medium. You're having a casual post-meeting debrief with ${ctx.userName}${ctx.userCompany ? ' from ' + ctx.userCompany : ''}.

They were matched with ${ctx.otherName}${ctx.otherCompany ? ' (' + ctx.otherCompany + ')' : ''} at ${ctx.eventName}.
${ctx.matchScore ? 'Match score was ' + (ctx.matchScore * 100).toFixed(0) + '%.' : ''}
${ctx.matchReasons.length ? 'Match reasons: ' + ctx.matchReasons.slice(0, 3).join('; ') : ''}

YOUR GOALS (in order):
1. Find out if they actually met and how it went — keep it conversational, not a survey
2. Understand what made the match useful or not useful
3. Gently extract signals that improve future matching:
   - Were the shared themes actually what they talked about?
   - Did the intent/offering alignment play out?
   - Any new interests, focus shifts, or connections they're now looking for?
   - Would they want more matches like this one, or different?
4. If they mention specific outcomes (deal progress, collaboration, referral), capture those
5. When you have enough signal, wrap up warmly

STYLE:
- Brief, warm, curious — like a friend asking "how'd it go?"
- One question at a time, max two sentences per turn
- Never robotic or survey-like
- Use their name naturally
- If they're brief, respect that. If they open up, follow the thread.
- It's ok to be done in 3-4 turns if there's not much to discuss

EXTRACTION:
After each response, also output a JSON block with any extracted insights.
Format your response EXACTLY as:
MESSAGE: <your conversational response>
EXTRACTED: <json object>

The JSON should include:
{
  "insights": [
    { "type": "theme_correction|intent_update|archetype_signal|meeting_preference|anti_pattern|enrichment",
      "key": "<specific attribute>",
      "value": "<what you learned>",
      "confidence": 0.0-1.0 }
  ],
  "debrief_complete": false
}

Set debrief_complete to true when the conversation has naturally concluded.
${ctx.feedbackSoFar && ctx.feedbackSoFar.rating ? 'They already rated this match as: ' + ctx.feedbackSoFar.rating : ''}
${ctx.feedbackSoFar && ctx.feedbackSoFar.did_meet === true ? 'They confirmed they did meet.' : ''}
${ctx.feedbackSoFar && ctx.feedbackSoFar.did_meet === false ? 'They said they did not meet.' : ''}`;
}


async function getNevResponse(systemPrompt, history) {
  try {
    var Anthropic = require('@anthropic-ai/sdk');
    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    var messages = history.map(function(m) {
      return { role: m.role === 'nev' ? 'assistant' : 'user', content: m.content };
    });

    var response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      system: systemPrompt,
      messages: messages
    });

    var raw = response.content[0].text;

    // Parse MESSAGE: and EXTRACTED: blocks
    var messagePart = raw;
    var extracted = {};

    var msgMatch = raw.match(/MESSAGE:\s*([\s\S]*?)(?=EXTRACTED:|$)/i);
    if (msgMatch) messagePart = msgMatch[1].trim();

    var extMatch = raw.match(/EXTRACTED:\s*(\{[\s\S]*\})/i);
    if (extMatch) {
      try { extracted = JSON.parse(extMatch[1]); } catch(e) {
        console.error('Failed to parse Nev extraction:', e);
      }
    }

    return { message: messagePart, extracted: extracted };
  } catch (err) {
    console.error('Nev LLM error:', err);
    return {
      message: "Sorry, I'm having a moment. Can you try that again?",
      extracted: {}
    };
  }
}


// ══════════════════════════════════════════════════════
// INSIGHT EXTRACTION — from structured feedback
// ══════════════════════════════════════════════════════

async function extractDebriefInsights(matchId, userId, feedback, match) {
  try {
    var feedbackRecord = await dbGet(
      'SELECT id FROM match_feedback WHERE match_id = $1 AND user_id = $2',
      [matchId, userId]
    );
    if (!feedbackRecord) return;

    var insights = [];

    // Theme accuracy signal
    if (feedback.theme_accuracy === false) {
      var reasons = [];
      try { reasons = JSON.parse(match.match_reasons || '[]'); } catch(e) {}
      var themeReasons = reasons.filter(function(r) { return r.toLowerCase().indexOf('theme') !== -1; });
      if (themeReasons.length) {
        insights.push({
          type: 'theme_correction',
          key: 'theme_mismatch',
          value: 'Shared themes did not match actual conversation. Reasons were: ' + themeReasons.join('; '),
          confidence: 0.8
        });
      }
    }

    // Intent accuracy signal
    if (feedback.intent_accuracy === false) {
      insights.push({
        type: 'intent_update',
        key: 'intent_mismatch',
        value: 'Intent/offering alignment did not play out in practice',
        confidence: 0.7
      });
    }

    // Stakeholder fit signal
    if (feedback.stakeholder_fit_accuracy === false) {
      insights.push({
        type: 'archetype_signal',
        key: 'archetype_mismatch',
        value: 'Archetype pairing was not useful for this user',
        confidence: 0.7
      });
    }

    // Meeting preference signals
    if (feedback.meeting_quality && feedback.meeting_quality >= 4 && feedback.would_meet_again) {
      insights.push({
        type: 'meeting_preference',
        key: 'positive_pattern',
        value: 'High quality meeting, would meet again. Outcome: ' + (feedback.outcome_type || 'unspecified'),
        confidence: 0.9
      });
    }

    // Anti-patterns
    if (feedback.meeting_quality && feedback.meeting_quality <= 2) {
      insights.push({
        type: 'anti_pattern',
        key: 'low_quality_meeting',
        value: (feedback.what_didnt || 'No specifics provided'),
        confidence: 0.7
      });
    }

    // Store all insights
    for (var ins of insights) {
      await dbRun(
        'INSERT INTO feedback_insights (match_feedback_id, user_id, insight_type, insight_key, insight_value, confidence) VALUES ($1,$2,$3,$4,$5,$6)',
        [feedbackRecord.id, userId, ins.type, ins.key, ins.value, ins.confidence]
      );
    }
  } catch (err) {
    console.error('Insight extraction error:', err);
  }
}

// ══════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════

module.exports = {
  router, scoreMatch, generateMatchesForUser,
  createNotification, notifyMatchReveal,
  extractDebriefInsights, getNevResponse
};
