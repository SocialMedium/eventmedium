var express = require('express');
var { dbGet, dbRun, dbAll } = require('../db');
var { authenticateToken } = require('../middleware/auth');
var { normalizeThemes, normalizeTheme } = require('../lib/theme_taxonomy');
var { getEmbedding, getEmbeddings, getPointVector, getPointVectors, findCandidates, searchByVector, buildProfileText, COLLECTIONS } = require('../lib/vector_search');
var emc2 = require('../lib/emc2.js');
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
  // ── Core ecosystem ──
  'founder': {
    'investor': 0.95, 'advisor': 0.85, 'buyer': 0.85, 'corporate': 0.75,
    'partner': 0.80, 'hirer': 0.50, 'operator': 0.70, 'seller': 0.55,
    'researcher': 0.60, 'talent': 0.65, 'founder': 0.40
  },
  'investor': {
    'founder': 0.95, 'researcher': 0.55, 'corporate': 0.60, 'advisor': 0.55,
    'seller': 0.45, 'partner': 0.50, 'operator': 0.45, 'buyer': 0.40,
    'investor': 0.50, 'talent': 0.25, 'hirer': 0.30
  },
  'corporate': {
    'founder': 0.75, 'researcher': 0.80, 'seller': 0.80, 'partner': 0.75,
    'advisor': 0.55, 'investor': 0.60, 'operator': 0.55, 'buyer': 0.50,
    'talent': 0.55, 'hirer': 0.50, 'corporate': 0.40
  },
  'researcher': {
    'corporate': 0.80, 'founder': 0.70, 'investor': 0.55, 'partner': 0.60,
    'advisor': 0.45, 'buyer': 0.50, 'researcher': 0.60, 'operator': 0.35,
    'seller': 0.30, 'talent': 0.55, 'hirer': 0.50
  },
  'advisor': {
    'founder': 0.85, 'corporate': 0.55, 'investor': 0.55, 'operator': 0.50,
    'hirer': 0.55, 'partner': 0.45, 'researcher': 0.45, 'buyer': 0.40,
    'talent': 0.40, 'seller': 0.35, 'advisor': 0.30
  },
  'operator': {
    'founder': 0.70, 'corporate': 0.55, 'seller': 0.65, 'partner': 0.55,
    'advisor': 0.50, 'investor': 0.45, 'buyer': 0.50, 'hirer': 0.60,
    'talent': 0.60, 'researcher': 0.35, 'operator': 0.35
  },
  // ── Commercial exchange ──
  'buyer': {
    'seller': 0.95, 'founder': 0.85, 'corporate': 0.70, 'partner': 0.60,
    'researcher': 0.50, 'operator': 0.50, 'advisor': 0.40, 'investor': 0.35,
    'buyer': 0.30, 'talent': 0.20, 'hirer': 0.20
  },
  'seller': {
    'buyer': 0.95, 'corporate': 0.80, 'operator': 0.65, 'founder': 0.55,
    'partner': 0.70, 'investor': 0.45, 'advisor': 0.35, 'researcher': 0.30,
    'hirer': 0.25, 'talent': 0.20, 'seller': 0.25
  },
  'partner': {
    'founder': 0.80, 'corporate': 0.75, 'seller': 0.70, 'partner': 0.50,
    'researcher': 0.60, 'operator': 0.55, 'buyer': 0.60, 'investor': 0.50,
    'advisor': 0.45, 'hirer': 0.35, 'talent': 0.30
  },
  // ── Talent market ──
  'talent': {
    'hirer': 0.95, 'founder': 0.65, 'corporate': 0.60, 'operator': 0.60,
    'researcher': 0.55, 'advisor': 0.40, 'investor': 0.25, 'partner': 0.30,
    'buyer': 0.20, 'seller': 0.20, 'talent': 0.20
  },
  'hirer': {
    'talent': 0.95, 'operator': 0.60, 'advisor': 0.55, 'founder': 0.50,
    'corporate': 0.50, 'researcher': 0.50, 'investor': 0.30, 'partner': 0.35,
    'buyer': 0.20, 'seller': 0.25, 'hirer': 0.25
  }
};

function scoreStakeholderFit(typeA, typeB) {
  if (!typeA || !typeB) return 0.5;
  var ALIASES = {
    'angel investor': 'investor', 'angel': 'investor', 'vc': 'investor',
    'venture capitalist': 'investor', 'lp': 'investor', 'family office': 'investor',
    'executive search operator': 'hirer', 'recruiter': 'hirer', 'headhunter': 'hirer',
    'consultant': 'advisor', 'mentor': 'advisor', 'coach': 'advisor',
    'ceo': 'founder', 'co-founder': 'founder', 'cofounder': 'founder',
    'vendor': 'seller', 'supplier': 'seller', 'provider': 'seller',
    'procurement': 'buyer', 'purchasing': 'buyer',
    'vp': 'operator', 'director': 'operator', 'manager': 'operator',
    'scientist': 'researcher', 'academic': 'researcher', 'professor': 'researcher'
  };
  var typesA = typeA.toLowerCase().split(',').map(function(t) { return t.trim(); });
  var typesB = typeB.toLowerCase().split(',').map(function(t) { return t.trim(); });
  var bestScore = 0.4;
  for (var i = 0; i < typesA.length; i++) {
    for (var j = 0; j < typesB.length; j++) {
      var a = ALIASES[typesA[i]] || typesA[i];
      var b = ALIASES[typesB[j]] || typesB[j];
      if (ARCHETYPE_COMPATIBILITY[a] && ARCHETYPE_COMPATIBILITY[a][b] !== undefined) {
        bestScore = Math.max(bestScore, ARCHETYPE_COMPATIBILITY[a][b]);
      }
    }
  }
  return bestScore;
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
  // Signal keywords that indicate the same concept
  var SYNONYMS = {
    'investment': ['capital', 'funding', 'angel', 'seed', 'check', 'ticket', 'raise', 'invest', 'back', 'finance'],
    'distribution': ['go-to-market', 'gtm', 'channel', 'market entry', 'expansion', 'reach', 'scale'],
    'introductions': ['intros', 'connections', 'network', 'warm intro', 'referral', 'access to'],
    'talent': ['hiring', 'recruit', 'search', 'executive search', 'headhunt', 'team', 'staffing'],
    'partnerships': ['partner', 'alliance', 'collaboration', 'co-develop', 'joint', 'strategic'],
    'advisory': ['advice', 'advisor', 'mentor', 'guidance', 'consulting', 'strategy'],
    'technology': ['tech', 'platform', 'product', 'solution', 'infrastructure', 'tool', 'api'],
    'research': ['r&d', 'ip', 'data', 'insights', 'intelligence', 'analysis']
  };
  function extractKeywords(text) {
    var lower = text.toLowerCase();
    var found = [];
    Object.keys(SYNONYMS).forEach(function(key) {
      if (lower.indexOf(key) !== -1) found.push(key);
      SYNONYMS[key].forEach(function(syn) {
        if (lower.indexOf(syn) !== -1) found.push(key);
      });
    });
    return [...new Set(found)];
  }
  var reasons = [];
  var matchCount = 0;
  var totalPairs = 0;
  // Does A want what B offers?
  intentA.forEach(function(want) {
    var wantKeys = extractKeywords(want);
    offeringB.forEach(function(offer) {
      totalPairs++;
      var offerKeys = extractKeywords(offer);
      var overlap = wantKeys.filter(function(k) { return offerKeys.indexOf(k) !== -1; });
      if (overlap.length > 0 || offer.toLowerCase().indexOf(want.toLowerCase()) !== -1 || want.toLowerCase().indexOf(offer.toLowerCase()) !== -1) {
        matchCount++;
        if (reasons.length < 3) reasons.push('A wants "' + want.slice(0,40) + '" — B offers "' + offer.slice(0,40) + '"');
      }
    });
  });
  // Does B want what A offers?
  intentB.forEach(function(want) {
    var wantKeys = extractKeywords(want);
    offeringA.forEach(function(offer) {
      totalPairs++;
      var offerKeys = extractKeywords(offer);
      var overlap = wantKeys.filter(function(k) { return offerKeys.indexOf(k) !== -1; });
      if (overlap.length > 0 || offer.toLowerCase().indexOf(want.toLowerCase()) !== -1 || want.toLowerCase().indexOf(offer.toLowerCase()) !== -1) {
        matchCount++;
        if (reasons.length < 3) reasons.push('B wants "' + want.slice(0,40) + '" — A offers "' + offer.slice(0,40) + '"');
      }
    });
  });
  var score = totalPairs > 0 ? Math.min(1.0, matchCount / Math.max(1, totalPairs / 3)) : 0;
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
  // Use pre-loaded profiles if available, otherwise fetch from DB
  var profileA = (options.profileCache && options.profileCache[userA]) || await dbGet(
    'SELECT sp.*, u.name as name, u.company as company FROM stakeholder_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.user_id = $1',
    [userA]
  );
  var profileB = (options.profileCache && options.profileCache[userB]) || await dbGet(
    'SELECT sp.*, u.name as name, u.company as company FROM stakeholder_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.user_id = $1',
    [userB]
  );
  if (!profileA || !profileB) return null;

  // 1. Semantic similarity — use stored Qdrant vectors (no API calls)
  var scoreSemantic = 0;
  try {
    // Check if pre-computed similarity was passed in (from Stage 1 ANN)
    if (options && options.precomputedSimilarity && options.precomputedSimilarity[userB] !== undefined) {
      scoreSemantic = options.precomputedSimilarity[userB];
    } else {
      // Retrieve stored vectors from Qdrant
      var vectors = await getPointVectors(COLLECTIONS.profiles, [userA, userB]);
      if (vectors[userA] && vectors[userB]) {
        scoreSemantic = cosineSimilarity(vectors[userA], vectors[userB]);
      } else {
        // Last resort: embed on the fly (slow path for users without stored vectors)
        var textA = buildProfileText(profileA, { name: profileA.name, company: profileA.company });
        var textB = buildProfileText(profileB, { name: profileB.name, company: profileB.company });
        if (textA && textB) {
          var embeddings = await getEmbeddings([textA, textB]);
          if (embeddings.length === 2) {
            scoreSemantic = cosineSimilarity(embeddings[0], embeddings[1]);
          }
        }
      }
    }
  } catch(e) {
    console.error('Semantic scoring error:', e.message);
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
  if (options.skipNetworkProximity !== true) {
    try {
      networkResult = await scoreNetworkProximity(userA, userB);
    } catch(e) {
      console.error('Network proximity error:', e);
    }
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

  // 7. Geography score
  var scoreGeo = scoreGeography(profileA, profileB);

  // 8. Urgency score
  var scoreUrg = scoreUrgency(profileA, profileB);

  // 9. Canister richness scalar
  var richnessA = computeRichness(profileA);
  var richnessB = computeRichness(profileB);
  var avgRichness = (richnessA + richnessB) / 2;

  var scoreTotal =
    (scoreSemantic * weights.semantic) +
    (themeResult.score * weights.theme) +
    (intentResult.score * weights.intent) +
    (scoreStakeholder * weights.stakeholder) +
    (capitalResult.score * weights.capital) +
    (signalScores.total * weights.signals) +
    (networkResult.score * weights.network);

  // Apply richness confidence scalar
  scoreTotal = scoreTotal * (0.7 + avgRichness * 0.3);

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
    score_geography: Math.round(scoreGeo * 1000) / 1000,
    score_urgency: Math.round(scoreUrg * 1000) / 1000,
    score_canister_richness: Math.round(avgRichness * 1000) / 1000,
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

async function generateMatchesForUser(userId, context, options) {
  // Backward compat: if context is a number, treat as event id
  if (typeof context === 'number') context = { type: 'event', id: context };
  options = options || {};
  var threshold = options.threshold || 0.45;
  var candidateLimit = options.candidateLimit || 50;

  // ── Resolve candidate pool by scope type ──
  var candidateIds = [];

  if (context.type === 'event') {
    var rows = await dbAll(
      "SELECT user_id FROM event_registrations WHERE event_id = $1 AND user_id != $2 AND status = 'active'",
      [context.id, userId]
    );
    candidateIds = rows.map(function(r) { return r.user_id; });

  } else if (context.type === 'community') {
    var rows = await dbAll(
      "SELECT user_id FROM community_members WHERE community_id = $1 AND user_id != $2",
      [context.id, userId]
    );
    candidateIds = rows.map(function(r) { return r.user_id; });

  } else if (context.type === 'location') {
    var locRows = await dbAll(
      "SELECT user_id FROM stakeholder_profiles WHERE user_id != $1 AND geography ILIKE $2",
      [userId, '%' + context.city + '%']
    );
    var evtRows = await dbAll(
      `SELECT DISTINCT er.user_id FROM event_registrations er
       JOIN events e ON e.id = er.event_id
       WHERE er.user_id != $1 AND er.status = 'active'
       AND e.city ILIKE $2 AND e.event_date > NOW() AND e.event_date < NOW() + INTERVAL '60 days'`,
      [userId, context.city]
    );
    var seen = new Set(locRows.map(function(u) { return u.user_id; }));
    evtRows.forEach(function(u) { if (!seen.has(u.user_id)) { seen.add(u.user_id); locRows.push(u); } });
    candidateIds = locRows.map(function(u) { return u.user_id; });

  } else if (context.type === 'global') {
    var alreadyMatched = await dbAll(
      "SELECT CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END as oid FROM event_matches WHERE user_a_id = $1 OR user_b_id = $1",
      [userId]
    );
    var excluded = new Set(alreadyMatched.map(function(m) { return m.oid; }));
    excluded.add(userId);
    var allProfiled = await dbAll(
      "SELECT user_id FROM stakeholder_profiles WHERE stakeholder_type IS NOT NULL AND themes IS NOT NULL"
    );
    candidateIds = allProfiled.map(function(u) { return u.user_id; }).filter(function(id) { return !excluded.has(id); });
  }

  if (!candidateIds.length) return [];

  // ── Stage 1: ANN candidate selection (fast path) ──
  var candidates = null;
  var precomputedSimilarity = {};
  try {
    candidates = await findCandidates(userId, candidateIds, candidateLimit);
    if (candidates && candidates.length > 0) {
      candidates.forEach(function(c) { precomputedSimilarity[c.user_id] = c.similarity; });
      console.log('[Matcher] ANN: ' + candidates.length + ' candidates from ' + candidateIds.length + ' (' + context.type + ')');
    } else {
      candidates = null;
    }
  } catch(e) {
    console.error('[Matcher] ANN failed, falling back:', e.message);
    candidates = null;
  }

  var pairsToScore = candidates ? candidates.map(function(c) { return c.user_id; }) : candidateIds;
  if (!candidates) console.log('[Matcher] Fallback: scoring all ' + pairsToScore.length + ' (' + context.type + ')');

  // ── Stage 2: Full scoring ──
  var matches = [];
  var scoreOptions = Object.assign({}, options, { precomputedSimilarity: precomputedSimilarity });
  var eventIdForScore = context.type === 'event' ? context.id : null;

  for (var i = 0; i < pairsToScore.length; i++) {
    var otherId = pairsToScore[i];

    // Don't mix test and real users
    var selfUser = await dbGet('SELECT auth_provider FROM users WHERE id = $1', [userId]);
    var otherUser = await dbGet('SELECT auth_provider FROM users WHERE id = $1', [otherId]);
    if (selfUser && otherUser) {
      if ((selfUser.auth_provider === 'test') !== (otherUser.auth_provider === 'test')) continue;
    }

    // Duplicate check per scope
    var existing = null;
    if (context.type === 'event') {
      existing = await dbGet(
        "SELECT id FROM event_matches WHERE event_id = $1 AND ((user_a_id = $2 AND user_b_id = $3) OR (user_a_id = $3 AND user_b_id = $2))",
        [context.id, userId, otherId]
      );
    } else if (context.type === 'community') {
      existing = await dbGet(
        "SELECT id FROM event_matches WHERE community_id = $1 AND ((user_a_id = $2 AND user_b_id = $3) OR (user_a_id = $3 AND user_b_id = $2))",
        [context.id, userId, otherId]
      );
    } else {
      existing = await dbGet(
        "SELECT id FROM event_matches WHERE scope_type = $1 AND ((user_a_id = $2 AND user_b_id = $3) OR (user_a_id = $3 AND user_b_id = $2))",
        [context.type, userId, otherId]
      );
    }
    if (existing) continue;

    var result = await scoreMatch(userId, otherId, eventIdForScore, scoreOptions);
    if (!result || result.score_total < threshold) continue;
    matches.push({ result: result, otherId: otherId });
  }

  matches.sort(function(a, b) { return b.result.score_total - a.result.score_total; });

  // ── Insert matches ──
  var eventId   = context.type === 'event'     ? context.id : null;
  var commId    = context.type === 'community' ? context.id : null;
  var scopeType = context.type;

  for (var m = 0; m < matches.length; m++) {
    var mr = matches[m].result;
    await dbRun(
      `INSERT INTO event_matches
         (event_id, community_id, scope_type, user_a_id, user_b_id,
          score_total, score_semantic, score_theme, score_intent, score_stakeholder,
          score_capital, score_signal_convergence, score_timing, score_constraint_complementarity,
          score_geography, score_urgency, score_canister_richness, match_mode,
          match_reasons, signal_context, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        eventId, commId, scopeType, userId, matches[m].otherId,
        mr.score_total, mr.score_semantic, mr.score_theme, mr.score_intent,
        mr.score_stakeholder, mr.score_capital,
        mr.score_signal_convergence, mr.score_timing, mr.score_constraint_complementarity,
        mr.score_geography, mr.score_urgency, mr.score_canister_richness, scopeType,
        JSON.stringify(mr.match_reasons), JSON.stringify(mr.signal_context),
        'pending'
      ]
    );
  }
  return matches.map(function(m) { return m.result; });
}

// ══════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════

// ── GET /api/matches/mine ── all matches for current user
router.get('/mine', authenticateToken, async function(req, res) {
  try {
    var limit = Math.min(parseInt(req.query.limit) || 50, 100);
    var offset = parseInt(req.query.offset) || 0;
    var eventId     = req.query.event_id     ? parseInt(req.query.event_id)     : null;
    var communityId = req.query.community_id ? parseInt(req.query.community_id) : null;
    var scopeType   = req.query.scope_type   || null;

    var whereClause = '(em.user_a_id = $1 OR em.user_b_id = $1)';
    var params = [req.user.id];
    if (eventId) {
      whereClause += ' AND em.event_id = $' + (params.length + 1);
      params.push(eventId);
    }
    if (communityId) {
      whereClause += ' AND em.community_id = $' + (params.length + 1);
      params.push(communityId);
    }
    if (scopeType) {
      whereClause += ' AND em.scope_type = $' + (params.length + 1);
      params.push(scopeType);
    }

    var countResult = await dbGet(
      'SELECT COUNT(*) as total FROM event_matches em WHERE ' + whereClause, params
    );

    params.push(limit, offset);
    var matches = await dbAll(
      `SELECT em.*,
        CASE WHEN em.user_a_id = $1 THEN em.user_b_id ELSE em.user_a_id END as other_user_id,
        CASE WHEN em.user_a_id = $1 THEN em.user_a_decision ELSE em.user_b_decision END as my_decision,
        CASE WHEN em.user_a_id = $1 THEN em.user_b_decision ELSE em.user_a_decision END as their_decision,
        e.name as event_name, e.event_date,
        c.name as community_name
       FROM event_matches em
       LEFT JOIN events e ON e.id = em.event_id
       LEFT JOIN communities c ON c.id = em.community_id
       WHERE ` + whereClause + `
       ORDER BY em.score_total DESC
       LIMIT $` + (params.length - 1) + ` OFFSET $` + params.length,
      params
    );

    // Attach context and revealed user info to each match
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      // Build context object
      if (m.event_id) {
        m.context = { type: 'event', id: m.event_id, name: m.event_name };
      } else if (m.community_id) {
        m.context = { type: 'community', id: m.community_id, name: m.community_name };
      } else {
        m.context = { type: m.scope_type || 'global' };
      }
      // Revealed user info
      if (m.status === 'revealed') {
        var otherUser = await dbGet(
          'SELECT u.name, u.company, u.avatar_url, sp.stakeholder_type, sp.themes, sp.focus_text, sp.geography FROM users u LEFT JOIN stakeholder_profiles sp ON sp.user_id = u.id WHERE u.id = $1',
          [m.other_user_id]
        );
        m.other_user = otherUser;
      }
    }

    res.json({
      matches: matches,
      total: parseInt(countResult.total),
      limit: limit,
      offset: offset,
      has_more: (offset + limit) < parseInt(countResult.total)
    });
    
  } catch (err) {
    console.error('Get matches error:', err);
    res.status(500).json({ error: 'Failed to load matches' });
  }
});

// ── GET /api/matches/contextual ── progressive scope feed ─────────────────────
router.get('/contextual', authenticateToken, async function(req, res) {
  try {
    var userId = req.user.id;

    var profile = await dbGet(
      'SELECT geography, stakeholder_type FROM stakeholder_profiles WHERE user_id = $1', [userId]
    );
    var userCity = profile && profile.geography ? profile.geography.split(',')[0].trim() : null;

    var myEvents = await dbAll(
      `SELECT e.id, e.name FROM event_registrations er
       JOIN events e ON e.id = er.event_id
       WHERE er.user_id = $1 AND er.status = 'active' AND e.event_date >= NOW() - INTERVAL '90 days'
       ORDER BY e.event_date DESC LIMIT 5`,
      [userId]
    );

    var myCommunities = await dbAll(
      `SELECT c.id, c.name FROM community_members cm
       JOIN communities c ON c.id = cm.community_id
       WHERE cm.user_id = $1 AND c.is_active = true ORDER BY c.name LIMIT 5`,
      [userId]
    );

    // Fetch flat match rows for a given WHERE fragment
    async function fetchMatches(extraWhere, extraParams) {
      var params = [userId].concat(extraParams || []);
      var where = '(em.user_a_id = $1 OR em.user_b_id = $1)' + (extraWhere ? ' AND ' + extraWhere : '');
      return dbAll(
        `SELECT em.id, em.score_total, em.status, em.scope_type, em.event_id, em.community_id,
                em.match_reasons, em.signal_context, em.user_a_decision, em.user_b_decision,
                em.user_a_id, em.user_b_id, em.created_at
         FROM event_matches em WHERE ` + where + ' ORDER BY em.score_total DESC LIMIT 20',
        params
      );
    }

    function quality(rows) {
      var strong = rows.filter(function(m) { return parseFloat(m.score_total) >= 0.65; }).length;
      if (strong >= 3) return 'strong';
      if (strong >= 1 || rows.length >= 3) return 'moderate';
      return 'thin';
    }

    var scopes = [];

    // Event scopes
    for (var i = 0; i < myEvents.length; i++) {
      var ev = myEvents[i];
      var rows = await fetchMatches('em.event_id = $2', [ev.id]);
      var q = quality(rows);
      scopes.push({ type: 'event', id: ev.id, label: ev.name, matches: rows.slice(0, 8), count: rows.length, quality: q, thin: q === 'thin' });
    }

    // Community scopes
    for (var i = 0; i < myCommunities.length; i++) {
      var comm = myCommunities[i];
      var rows = await fetchMatches('em.community_id = $2', [comm.id]);
      var q = quality(rows);
      scopes.push({ type: 'community', id: comm.id, label: comm.name, matches: rows.slice(0, 8), count: rows.length, quality: q, thin: q === 'thin' });
    }

    // Location scope
    if (userCity) {
      var rows = await fetchMatches("em.scope_type = 'location'");
      var q = quality(rows);
      scopes.push({ type: 'location', label: userCity, city: userCity, matches: rows.slice(0, 8), count: rows.length, quality: q, thin: q === 'thin' });
    }

    // Global scope
    var globalRows = await fetchMatches("em.scope_type = 'global'");
    var globalQ = quality(globalRows);
    scopes.push({ type: 'global', label: 'Global Network', matches: globalRows.slice(0, 8), count: globalRows.length, quality: globalQ, thin: globalQ === 'thin' });

    // Determine active scope (deepest non-thin)
    var activeScope = 'global';
    for (var i = 0; i < scopes.length; i++) {
      if (!scopes[i].thin) { activeScope = scopes[i].type; break; }
    }

    // ── Recommended contexts ──────────────────────────────────────────────────
    var recommended = [];
    try {
      var allPairs = await dbAll(
        `SELECT CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END as oid,
                score_total FROM event_matches WHERE user_a_id = $1 OR user_b_id = $1`,
        [userId]
      );
      if (allPairs.length > 0) {
        var matchedIds = allPairs.map(function(p) { return p.oid; });
        var scoreMap = {};
        allPairs.forEach(function(p) {
          var s = parseFloat(p.score_total);
          if (!scoreMap[p.oid] || s > scoreMap[p.oid]) scoreMap[p.oid] = s;
        });

        var myEventIds   = new Set(myEvents.map(function(e) { return e.id; }));
        var myCommIds    = new Set(myCommunities.map(function(c) { return c.id; }));

        var nameRows = await dbAll('SELECT id, name FROM users WHERE id = ANY($1)', [matchedIds]);
        var nameMap  = {};
        nameRows.forEach(function(u) { nameMap[u.id] = u.name; });
        function inits(uid) {
          var n = nameMap[uid];
          return n ? n.trim().split(/\s+/).map(function(p) { return p[0] || ''; }).slice(0,2).join('').toUpperCase() : '?';
        }

        // Recommended events
        var evRows = await dbAll(
          `SELECT e.id, e.name, e.city, e.event_date, er.user_id as uid
           FROM event_registrations er JOIN events e ON e.id = er.event_id
           WHERE er.user_id = ANY($1) AND er.status = 'active'
           AND e.event_date >= CURRENT_DATE AND e.event_date <= CURRENT_DATE + INTERVAL '90 days'`,
          [matchedIds]
        );
        var evGrp = {};
        evRows.forEach(function(r) {
          if (myEventIds.has(r.id)) return;
          if (!evGrp[r.id]) evGrp[r.id] = { id: r.id, name: r.name, city: r.city, date: r.event_date, uids: [] };
          evGrp[r.id].uids.push(r.uid);
        });
        Object.values(evGrp).forEach(function(eg) {
          if (eg.uids.length < 2) return;
          eg.uids.sort(function(a, b) { return (scoreMap[b]||0) - (scoreMap[a]||0); });
          var top = eg.uids.slice(0, 3);
          recommended.push({ type: 'event', id: eg.id, name: eg.name, city: eg.city, date: eg.date,
            match_count: eg.uids.length, top_score: scoreMap[top[0]]||0,
            preview: top.map(inits), _s: eg.uids.length * (scoreMap[top[0]]||0), cta: 'register' });
        });

        // Recommended communities
        var commRows = await dbAll(
          `SELECT c.id, c.name, cm.user_id as uid FROM community_members cm
           JOIN communities c ON c.id = cm.community_id
           WHERE cm.user_id = ANY($1) AND c.is_active = true`, [matchedIds]
        );
        var commGrp = {};
        commRows.forEach(function(r) {
          if (myCommIds.has(r.id)) return;
          if (!commGrp[r.id]) commGrp[r.id] = { id: r.id, name: r.name, uids: [] };
          commGrp[r.id].uids.push(r.uid);
        });
        Object.values(commGrp).forEach(function(cg) {
          if (cg.uids.length < 2) return;
          cg.uids.sort(function(a, b) { return (scoreMap[b]||0) - (scoreMap[a]||0); });
          var top = cg.uids.slice(0, 3);
          recommended.push({ type: 'community', id: cg.id, name: cg.name,
            match_count: cg.uids.length, top_score: scoreMap[top[0]]||0,
            preview: top.map(inits), _s: cg.uids.length * (scoreMap[top[0]]||0), cta: 'join' });
        });

        // Recommended locations
        if (userCity) {
          var geoRows = await dbAll(
            'SELECT user_id, geography FROM stakeholder_profiles WHERE user_id = ANY($1)', [matchedIds]
          );
          var cityGrp = {};
          geoRows.forEach(function(p) {
            if (!p.geography) return;
            var c = p.geography.split(',')[0].trim();
            if (c.toLowerCase() === userCity.toLowerCase()) return;
            if (!cityGrp[c]) cityGrp[c] = [];
            cityGrp[c].push(p.user_id);
          });
          Object.keys(cityGrp).forEach(function(city) {
            var uids = cityGrp[city];
            if (uids.length < 3) return;
            uids.sort(function(a, b) { return (scoreMap[b]||0) - (scoreMap[a]||0); });
            var top = uids.slice(0, 3);
            recommended.push({ type: 'location', city: city,
              match_count: uids.length, top_score: scoreMap[top[0]]||0,
              preview: top.map(inits), _s: uids.length * (scoreMap[top[0]]||0), cta: 'travel' });
          });
        }
      }
    } catch(e) { console.error('[contextual] recommended error:', e); }

    recommended.sort(function(a, b) { return (b._s||0) - (a._s||0); });
    recommended = recommended.slice(0, 3).map(function(r) { delete r._s; return r; });

    // Trigger nev nudge if everything is thin
    if (scopes.every(function(s) { return s.thin; })) {
      try {
        var recent = await dbGet(
          "SELECT id FROM notifications WHERE user_id = $1 AND type = 'nev_nudge' AND created_at > NOW() - INTERVAL '7 days'",
          [userId]
        );
        if (!recent) {
          await dbRun(
            "INSERT INTO notifications (user_id, type, title, body, link) VALUES ($1,$2,$3,$4,$5)",
            [userId, 'nev_nudge', "Let's sharpen your matches",
             "Tell me where you're travelling next and I'll scan for signal there.",
             '/onboard.html?mode=update&focus=geography']
          );
        }
      } catch(e) {}
    }

    res.json({ active_scope: activeScope, scopes: scopes, recommended: recommended });
  } catch(err) {
    console.error('[contextual] error:', err);
    res.status(500).json({ error: 'Failed to load contextual matches' });
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

      // EMC² — award match_accepted to both users
      try {
        await emc2.recordTransaction({
          user_id: match.user_a_id, action_type: 'match_accepted',
          entity_id: matchId, entity_type: 'match'
        });
        await emc2.recordTransaction({
          user_id: match.user_b_id, action_type: 'match_accepted',
          entity_id: matchId, entity_type: 'match'
        });
      } catch(emc2Err) {
        console.error('[EMC²] match_accepted error:', emc2Err.message);
      }

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

// ── POST /api/matches/admin/generate-bulk ── trigger matching for any scope
router.post('/admin/generate-bulk', authenticateToken, async function(req, res) {
  try {
    var { event_id, community_id, scope, city, country, threshold } = req.body;
    var context, users;

    if (event_id) {
      context = { type: 'event', id: parseInt(event_id) };
      users = await dbAll(
        "SELECT user_id FROM event_registrations WHERE event_id = $1 AND status = 'active'",
        [event_id]
      );
    } else if (community_id) {
      context = { type: 'community', id: parseInt(community_id) };
      users = await dbAll("SELECT user_id FROM community_members WHERE community_id = $1", [community_id]);
    } else if (scope === 'location') {
      if (!city) return res.status(400).json({ error: 'city required for location scope' });
      context = { type: 'location', city: city, country: country || null };
      users = await dbAll(
        "SELECT user_id FROM stakeholder_profiles WHERE geography ILIKE $1",
        ['%' + city + '%']
      );
    } else if (scope === 'global') {
      context = { type: 'global' };
      users = await dbAll(
        "SELECT user_id FROM stakeholder_profiles WHERE stakeholder_type IS NOT NULL AND themes IS NOT NULL"
      );
    } else {
      return res.status(400).json({ error: 'Provide event_id, community_id, scope=location (with city), or scope=global' });
    }

    var totalMatches = 0;
    for (var i = 0; i < users.length; i++) {
      try {
        var matches = await generateMatchesForUser(
          users[i].user_id, context,
          { threshold: threshold || 0.4, enrichWithSignals: true }
        );
        totalMatches += matches.length;
      } catch(e) { console.error('[generate-bulk] user ' + users[i].user_id + ':', e.message); }
    }

    res.json({ context: context, users: users.length, matches_generated: totalMatches });
  } catch (err) {
    console.error('[generate-bulk] Error:', err);
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

    // EMC² — award match_confirmed if they met
    if (did_meet === true || did_meet === 'true') {
      try {
        await emc2.recordTransaction({
          user_id: req.user.id, action_type: 'match_confirmed',
          entity_id: matchId, entity_type: 'match'
        });
      } catch(emc2Err) {
        console.error('[EMC²] match_confirmed error:', emc2Err.message);
      }
    }

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

      // EMC² — award match_debrief on completion
      try {
        await emc2.recordTransaction({
          user_id: req.user.id, action_type: 'match_debrief',
          entity_id: matchId, entity_type: 'match'
        });
      } catch(emc2Err) {
        console.error('[EMC²] match_debrief error:', emc2Err.message);
      }
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
// GEOGRAPHY SCORING
// ══════════════════════════════════════════════════════

function scoreGeography(profileA, profileB) {
  var geoA = ((profileA.geography || '')).toLowerCase().trim().split(',')[0].trim();
  var geoB = ((profileB.geography || '')).toLowerCase().trim().split(',')[0].trim();
  if (!geoA || !geoB) return 0.3;
  if (geoA === geoB) return 1.0;
  var regions = {
    europe: ['london','barcelona','madrid','paris','berlin','amsterdam','stockholm','oslo','dublin','lisbon','rome','milan','brussels','zurich','vienna','prague','warsaw','edinburgh','copenhagen','helsinki','budapest'],
    north_america: ['san francisco','new york','boston','seattle','austin','chicago','miami','toronto','vancouver','montreal','los angeles','denver','atlanta','houston','dallas'],
    apac: ['singapore','tokyo','seoul','hong kong','shanghai','beijing','sydney','melbourne','bangkok','kuala lumpur','jakarta','mumbai','delhi','bangalore'],
    mena: ['dubai','abu dhabi','riyadh','tel aviv','istanbul','cairo'],
    latam: ['são paulo','buenos aires','mexico city','bogotá','lima','santiago'],
    africa: ['nairobi','lagos','johannesburg','cape town','accra']
  };
  var getRegion = function(city) {
    for (var r in regions) { if (regions[r].some(function(c){ return city.includes(c)||c.includes(city); })) return r; }
    return null;
  };
  var rA = getRegion(geoA), rB = getRegion(geoB);
  if (rA && rB && rA === rB) return 0.75;
  var ctxA = JSON.stringify(profileA.intent||'') + ' ' + (profileA.focus_text||'');
  var ctxB = JSON.stringify(profileB.intent||'') + ' ' + (profileB.focus_text||'');
  if (ctxA.toLowerCase().includes(geoB) || ctxB.toLowerCase().includes(geoA)) return 0.6;
  return 0.2;
}

// ══════════════════════════════════════════════════════
// URGENCY SCORING
// ══════════════════════════════════════════════════════

function scoreUrgency(profileA, profileB) {
  var URGENCY = ['now','this week','this month','q1','q2','q3','q4','raising','launching','hiring','closing','deadline','attending','next week'];
  var detect = function(p) {
    var text = [JSON.stringify(p.intent||''), JSON.stringify(p.deal_details||''), p.focus_text||''].join(' ').toLowerCase();
    var matches = URGENCY.filter(function(t){ return text.includes(t); });
    return matches.length >= 3 ? 1.0 : matches.length >= 1 ? 0.6 : 0.3;
  };
  var uA = detect(profileA), uB = detect(profileB);
  if (uA >= 0.8 && uB >= 0.8) return 1.0;
  if (uA >= 0.6 || uB >= 0.6) return 0.6;
  return 0.3;
}

// ══════════════════════════════════════════════════════
// CANISTER RICHNESS SCALAR
// ══════════════════════════════════════════════════════

function computeRichness(profile) {
  var pts = 0;
  if (profile.stakeholder_type) pts += 15;
  var themes = [];
  try { themes = Array.isArray(profile.themes) ? profile.themes : JSON.parse(profile.themes||'[]'); } catch(e) {}
  if (themes.length >= 2) pts += 15;
  var intent = {};
  try { intent = typeof profile.intent === 'object' ? profile.intent : JSON.parse(profile.intent||'{}'); } catch(e) {}
  if (intent && Object.keys(intent).length > 0) pts += 15;
  var offering = {};
  try { offering = typeof profile.offering === 'object' ? profile.offering : JSON.parse(profile.offering||'{}'); } catch(e) {}
  if (offering && Object.keys(offering).length > 0) pts += 15;
  if (profile.geography) pts += 10;
  if ((profile.focus_text||'').length >= 100) pts += 15;
  var deal = {};
  try { deal = typeof profile.deal_details === 'object' ? profile.deal_details : JSON.parse(profile.deal_details||'{}'); } catch(e) {}
  var stype = (profile.stakeholder_type||'').toLowerCase();
  if ((stype === 'founder' || stype === 'investor') && deal && Object.keys(deal).length > 0) pts += 10;
  if (profile.embedding_updated_at) pts += 5;
  return Math.min(pts, 100) / 100;
}

// ══════════════════════════════════════════════════════
// NEGATIVE HISTORY CHECK
// ══════════════════════════════════════════════════════

async function hasNegativeHistory(userA, userB) {
  try {
    var negative = await dbGet(
      'SELECT fi.id FROM feedback_insights fi JOIN event_matches em ON em.id = fi.match_id WHERE fi.user_id = $1 AND (em.user_a_id = $2 OR em.user_b_id = $2) AND fi.insight_type IN (\'poor_fit\',\'wrong_archetype\',\'excluded_type\',\'not_useful\') AND fi.confidence > 0.6 LIMIT 1',
      [userA, userB]
    );
    return !!negative;
  } catch(e) { return false; }
}

// ══════════════════════════════════════════════════════
// SCHEDULER FUNCTIONS (exported for server.js)
// ══════════════════════════════════════════════════════

async function runEventMatching() {
  var db = require('../db');
  var events = await db.dbAll("SELECT id FROM events WHERE event_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'");
  for (var i = 0; i < events.length; i++) {
    var regs = await db.dbAll("SELECT user_id FROM event_registrations WHERE event_id = $1 AND status = 'active'", [events[i].id]);
    for (var j = 0; j < regs.length; j++) {
      try { await generateMatchesForUser(regs[j].user_id, { type: 'event', id: events[i].id }); } catch(e) { console.error('[matching] event match error:', e.message); }
    }
    if (regs.length) console.log('[scheduler] event', events[i].id, ':', regs.length, 'users processed');
  }
}

async function runCommunityMatching() {
  var db = require('../db');
  try {
    var communities = await db.dbAll("SELECT id FROM communities WHERE is_active = true");
    for (var i = 0; i < communities.length; i++) {
      var members = await db.dbAll("SELECT user_id FROM community_members WHERE community_id = $1", [communities[i].id]);
      for (var j = 0; j < members.length; j++) {
        try { await generateMatchesForUser(members[j].user_id, { type: 'community', id: communities[i].id }); } catch(e) {}
      }
      if (members.length) console.log('[scheduler] community', communities[i].id, ':', members.length, 'users');
    }
  } catch(e) { console.error('[scheduler] community matching error:', e.message); }
}

async function runGlobalMatching() {
  var db = require('../db');
  var candidates = await db.dbAll(`
    SELECT sp.user_id FROM stakeholder_profiles sp
    WHERE sp.embedding_updated_at IS NOT NULL
      AND sp.stakeholder_type IS NOT NULL
      AND sp.themes IS NOT NULL
      AND (SELECT COUNT(*) FROM event_registrations er JOIN events e ON e.id = er.event_id WHERE er.user_id = sp.user_id AND e.event_date > NOW()) = 0
    LIMIT 50
  `);
  for (var i = 0; i < candidates.length; i++) {
    try { await generateMatchesForUser(candidates[i].user_id, { type: 'global' }); } catch(e) {}
    await new Promise(function(r){ setTimeout(r, 200); });
  }
  console.log('[scheduler] global matching:', candidates.length, 'candidates processed');
}

// ══════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════

module.exports = {
  router, scoreMatch, generateMatchesForUser,
  createNotification, notifyMatchReveal,
  extractDebriefInsights, getNevResponse,
  scoreGeography, scoreUrgency, computeRichness, hasNegativeHistory,
  runEventMatching, runCommunityMatching, runGlobalMatching
};
