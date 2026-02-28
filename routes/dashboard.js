var express = require('express');
var router = express.Router();
var { dbGet, dbAll } = require('../db');
var { authenticateToken } = require('../middleware/auth');

// Admin check middleware
function adminOnly(req, res, next) {
  if (req.user.id != 2) return res.status(403).json({ error: 'Admin only' });
  next();
}

// Safe query helpers — return fallback on error instead of crashing
async function safeGet(sql, params, fallback) {
  try { return await dbGet(sql, params || []); }
  catch(e) { console.error('Dashboard query error:', e.message); return fallback; }
}
async function safeAll(sql, params, fallback) {
  try { return await dbAll(sql, params || []); }
  catch(e) { console.error('Dashboard query error:', e.message); return fallback; }
}

// ── GET /api/admin/dashboard — full network intelligence ──
router.get('/dashboard', authenticateToken, adminOnly, async function(req, res) {
  try {
    // ─── NETWORK TOTALS ───
    var totalUsers = await safeGet('SELECT COUNT(*) as c FROM users', [], {c:0});
    var completeCanisters = await safeGet("SELECT COUNT(*) as c FROM stakeholder_profiles WHERE stakeholder_type IS NOT NULL", [], {c:0});
    var totalRegs = await safeGet("SELECT COUNT(*) as c FROM event_registrations WHERE status = 'active'", [], {c:0});
    var activeEvents = await safeGet("SELECT COUNT(*) as c FROM events WHERE event_date >= CURRENT_DATE", [], {c:0});
    var totalMatches = await safeGet('SELECT COUNT(*) as c FROM event_matches', [], {c:0});
    var acceptedOneWay = await safeGet("SELECT COUNT(*) as c FROM event_matches WHERE user_a_decision = 'accept' OR user_b_decision = 'accept'", [], {c:0});
    var revealed = await safeGet("SELECT COUNT(*) as c FROM event_matches WHERE status = 'revealed'", [], {c:0});
    var meetingsHeld = await safeGet("SELECT COUNT(*) as c FROM match_feedback WHERE did_meet = true", [], {c:0});
    var debriefsDone = await safeGet("SELECT COUNT(DISTINCT match_id) as c FROM nev_debrief_messages WHERE role = 'user'", [], {c:0});
    var avgScore = await safeGet('SELECT AVG(score_total) as avg FROM event_matches WHERE score_total > 0', [], {avg:0});

    var network = {
      totalUsers: parseInt(totalUsers.c) || 0,
      completeCanisters: parseInt(completeCanisters.c) || 0,
      totalRegistrations: parseInt(totalRegs.c) || 0,
      activeEvents: parseInt(activeEvents.c) || 0,
      totalMatches: parseInt(totalMatches.c) || 0,
      acceptedMatches: parseInt(acceptedOneWay.c) || 0,
      revealedMatches: parseInt(revealed.c) || 0,
      meetingsConfirmed: parseInt(meetingsHeld.c) || 0,
      debriefsDone: parseInt(debriefsDone.c) || 0,
      avgMatchScore: parseFloat(avgScore.avg) || 0
    };

    // ─── FUNNEL ───
    var firstReg = await safeGet("SELECT COUNT(DISTINCT user_id) as c FROM event_registrations WHERE status = 'active'", [], {c:0});
    var matchGenerated = await safeGet("SELECT COUNT(DISTINCT user_a_id) + COUNT(DISTINCT user_b_id) as c FROM event_matches", [], {c:0});
    var matchAccepted = await safeGet("SELECT COUNT(DISTINCT CASE WHEN user_a_decision='accept' THEN user_a_id END) + COUNT(DISTINCT CASE WHEN user_b_decision='accept' THEN user_b_id END) as c FROM event_matches", [], {c:0});
    var mutualReveal = await safeGet("SELECT COUNT(DISTINCT user_a_id) + COUNT(DISTINCT user_b_id) as c FROM event_matches WHERE status = 'revealed'", [], {c:0});
    var meetingHeld = await safeGet("SELECT COUNT(DISTINCT user_id) as c FROM match_feedback WHERE did_meet = true", [], {c:0});
    var debriefComplete = await safeGet("SELECT COUNT(DISTINCT user_id) as c FROM nev_debrief_messages WHERE role = 'user'", [], {c:0});

    var funnel = [
      { stage: 'Signups', count: network.totalUsers },
      { stage: 'Canister complete', count: network.completeCanisters },
      { stage: 'First registration', count: parseInt(firstReg.c) || 0 },
      { stage: 'Match generated', count: Math.min(parseInt(matchGenerated.c) || 0, network.totalUsers) },
      { stage: 'Match accepted', count: Math.min(parseInt(matchAccepted.c) || 0, network.totalUsers) },
      { stage: 'Mutual reveal', count: Math.min(parseInt(mutualReveal.c) || 0, network.totalUsers) },
      { stage: 'Meeting held', count: parseInt(meetingHeld.c) || 0 },
      { stage: 'Debrief done', count: parseInt(debriefComplete.c) || 0 }
    ];

    // ─── SCORE BAND → ACCEPTANCE ───
    var scoreAcceptance = await safeAll(`
      SELECT 
        CASE 
          WHEN score_total >= 0.9 THEN '90-100%'
          WHEN score_total >= 0.8 THEN '80-89%'
          WHEN score_total >= 0.7 THEN '70-79%'
          WHEN score_total >= 0.6 THEN '60-69%'
          WHEN score_total >= 0.5 THEN '50-59%'
          WHEN score_total >= 0.4 THEN '40-49%'
          ELSE 'below40'
        END as band,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE user_a_decision='accept' OR user_b_decision='accept') as any_accept
      FROM event_matches 
      WHERE score_total > 0
      GROUP BY 1
      ORDER BY 1 DESC
    `, [], []);

    scoreAcceptance = scoreAcceptance.map(function(b) {
      var total = parseInt(b.total) || 1;
      var accepted = parseInt(b.any_accept) || 0;
      return { band: b.band, rate: accepted / total, total: total };
    });

    // ─── ARCHETYPE PAIRS ───
    var archetypePairs = await safeAll(`
      SELECT 
        LEAST(sp_a.stakeholder_type, sp_b.stakeholder_type) || ' / ' || GREATEST(sp_a.stakeholder_type, sp_b.stakeholder_type) as pair,
        COUNT(*) as matches,
        AVG(m.score_total) as avg_score,
        COUNT(*) FILTER (WHERE m.user_a_decision='accept' OR m.user_b_decision='accept') as accepted,
        COUNT(*) FILTER (WHERE m.status='revealed') as revealed
      FROM event_matches m
      JOIN stakeholder_profiles sp_a ON sp_a.user_id = m.user_a_id
      JOIN stakeholder_profiles sp_b ON sp_b.user_id = m.user_b_id
      WHERE sp_a.stakeholder_type IS NOT NULL AND sp_b.stakeholder_type IS NOT NULL
      GROUP BY 1
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `, [], []);

    archetypePairs = archetypePairs.map(function(a) {
      var total = parseInt(a.matches) || 1;
      return {
        pair: a.pair,
        matches: parseInt(a.matches) || 0,
        acceptRate: (parseInt(a.accepted) || 0) / total,
        revealRate: (parseInt(a.revealed) || 0) / total,
        avgScore: parseFloat(a.avg_score) || 0
      };
    });

    // ─── ACCEPTANCE BY TYPE ───
    var acceptanceByType = await safeAll(`
      SELECT type, total, accepted, CASE WHEN total > 0 THEN accepted::float / total ELSE 0 END as rate FROM (
        SELECT sp.stakeholder_type as type,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE 
            (m.user_a_id = sp.user_id AND m.user_a_decision='accept') OR 
            (m.user_b_id = sp.user_id AND m.user_b_decision='accept')
          ) as accepted
        FROM stakeholder_profiles sp
        JOIN event_matches m ON m.user_a_id = sp.user_id OR m.user_b_id = sp.user_id
        WHERE sp.stakeholder_type IS NOT NULL
        GROUP BY sp.stakeholder_type
      ) sub
      ORDER BY rate DESC
    `, [], []);

    acceptanceByType = acceptanceByType.map(function(a) {
      return { type: a.type, rate: parseFloat(a.rate) || 0, total: parseInt(a.total) || 0 };
    });

    // ─── CANISTER DEPTH ───
    var canisterDepth = [];
    var fields = ['stakeholder_type','themes','focus_text','geography','intent','offering'];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var filled = await safeGet(
        "SELECT COUNT(*) as c FROM stakeholder_profiles WHERE " + f + " IS NOT NULL AND " + f + "::text != 'null' AND " + f + "::text != '[]' AND " + f + "::text != ''",
        [], {c:0}
      );
      var totalProfiles = await safeGet("SELECT COUNT(*) as c FROM stakeholder_profiles", [], {c:1});
      var tp = parseInt(totalProfiles.c) || 1;
      canisterDepth.push({ field: f.replace(/_/g, ' '), pct: Math.round((parseInt(filled.c) || 0) / tp * 100) });
    }

    // ─── SUPPLY-DEMAND ───
    var supplyDemand = await safeAll(`
      SELECT theme,
        COUNT(*) FILTER (WHERE stakeholder_type = 'founder') as founders,
        COUNT(*) FILTER (WHERE stakeholder_type = 'investor') as investors,
        COUNT(*) FILTER (WHERE stakeholder_type = 'corporate') as corporates,
        COUNT(*) FILTER (WHERE stakeholder_type = 'researcher') as researchers
      FROM stakeholder_profiles, 
        LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(themes) = 'array' THEN themes ELSE '[]'::jsonb END) as theme
      WHERE stakeholder_type IS NOT NULL
      GROUP BY theme
      ORDER BY COUNT(*) DESC
      LIMIT 12
    `, [], []);

    supplyDemand = supplyDemand.map(function(s) {
      var inv = parseInt(s.investors) || 0;
      var fou = parseInt(s.founders) || 0;
      return {
        theme: s.theme, founders: fou, investors: inv,
        corporates: parseInt(s.corporates) || 0, researchers: parseInt(s.researchers) || 0,
        ratio: inv > 0 ? (fou / inv).toFixed(1) : (fou > 0 ? '∞' : '0')
      };
    });

    // ─── INTENT GAPS ───
    var intentGaps = await safeAll(`
      WITH seeking AS (
        SELECT intent_item as item, COUNT(*) as c
        FROM stakeholder_profiles,
          LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(intent) = 'array' THEN intent ELSE '[]'::jsonb END) as intent_item
        GROUP BY intent_item
      ),
      giving AS (
        SELECT offer_item as item, COUNT(*) as c
        FROM stakeholder_profiles,
          LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(offering) = 'array' THEN offering ELSE '[]'::jsonb END) as offer_item
        GROUP BY offer_item
      )
      SELECT COALESCE(s.item, g.item) as intent,
        COALESCE(s.c, 0) as seeking,
        COALESCE(g.c, 0) as offering
      FROM seeking s
      FULL OUTER JOIN giving g ON LOWER(s.item) = LOWER(g.item)
      ORDER BY ABS(COALESCE(s.c,0) - COALESCE(g.c,0)) DESC
      LIMIT 10
    `, [], []);

    intentGaps = intentGaps.map(function(g) {
      return { intent: g.intent, seeking: parseInt(g.seeking) || 0, offering: parseInt(g.offering) || 0 };
    });

    // ─── WEEKLY GROWTH ───
    var growth = await safeAll(`
      SELECT TO_CHAR(DATE_TRUNC('week', created_at), 'MM/DD') as week, COUNT(*) as users
      FROM users WHERE created_at > NOW() - INTERVAL '12 weeks'
      GROUP BY DATE_TRUNC('week', created_at) ORDER BY DATE_TRUNC('week', created_at)
    `, [], []);

    var regGrowth = await safeAll(`
      SELECT TO_CHAR(DATE_TRUNC('week', created_at), 'MM/DD') as week, COUNT(*) as regs
      FROM event_registrations WHERE created_at > NOW() - INTERVAL '12 weeks'
      GROUP BY DATE_TRUNC('week', created_at) ORDER BY DATE_TRUNC('week', created_at)
    `, [], []);

    var regMap = {};
    regGrowth.forEach(function(r) { regMap[r.week] = parseInt(r.regs) || 0; });
    growth = growth.map(function(g) {
      return { week: g.week, users: parseInt(g.users) || 0, regs: regMap[g.week] || 0 };
    });

    // ─── DAILY SIGNUPS (last 30 days) ───
    var dailySignups = await safeAll(`
      SELECT TO_CHAR(DATE(created_at), 'MM/DD') as day, COUNT(*) as signups
      FROM users WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at) ORDER BY DATE(created_at)
    `, [], []);

    dailySignups = dailySignups.map(function(d) {
      return { day: d.day, signups: parseInt(d.signups) || 0 };
    });

    // ─── EVENT SCORECARDS ───
    var eventScorecard = await safeAll(`
      SELECT e.id, e.name, TO_CHAR(e.event_date, 'MM/DD') as date,
        COUNT(DISTINCT er.user_id) as regs,
        COUNT(DISTINCT m.id) as matches,
        CASE WHEN COUNT(DISTINCT m.id) > 0 THEN
          COUNT(DISTINCT m.id) FILTER (WHERE m.user_a_decision='accept' OR m.user_b_decision='accept')::float / COUNT(DISTINCT m.id)
        ELSE 0 END as accept_rate,
        CASE WHEN COUNT(DISTINCT m.id) > 0 THEN
          COUNT(DISTINCT m.id) FILTER (WHERE m.status='revealed')::float / COUNT(DISTINCT m.id)
        ELSE 0 END as reveal_rate,
        AVG(m.score_total) FILTER (WHERE m.score_total > 0) as avg_score
      FROM events e
      LEFT JOIN event_registrations er ON er.event_id = e.id AND er.status = 'active'
      LEFT JOIN event_matches m ON m.event_id = e.id
      GROUP BY e.id, e.name, e.event_date
      HAVING COUNT(DISTINCT er.user_id) > 0
      ORDER BY e.event_date DESC LIMIT 20
    `, [], []);

    eventScorecard = eventScorecard.map(function(e) {
      return {
        id: e.id, name: e.name, date: e.date,
        regs: parseInt(e.regs) || 0, matches: parseInt(e.matches) || 0,
        acceptRate: parseFloat(e.accept_rate) || 0, revealRate: parseFloat(e.reveal_rate) || 0,
        avgScore: parseFloat(e.avg_score) || 0
      };
    });

    // ─── CANISTER INTELLIGENCE (anonymized snapshots) ───
    var canisterSnapshots = await safeAll(`
      SELECT 
        sp.stakeholder_type as type,
        sp.themes::text as themes,
        sp.intent::text as intent,
        sp.offering::text as offering,
        sp.focus_text,
        sp.geography,
        sp.deal_details::text as deal_details
      FROM stakeholder_profiles sp
      WHERE sp.stakeholder_type IS NOT NULL
      ORDER BY sp.created_at DESC
      LIMIT 10
    `, [], []);

    canisterSnapshots = canisterSnapshots.map(function(c) {
      var themes = [], intent = [], offering = [];
      try { themes = JSON.parse(c.themes || '[]'); } catch(e) {}
      try { intent = JSON.parse(c.intent || '[]'); } catch(e) {}
      try { offering = JSON.parse(c.offering || '[]'); } catch(e) {}
      var deal = {};
      try { deal = JSON.parse(c.deal_details || '{}'); } catch(e) {}
      return {
        type: c.type,
        themes: Array.isArray(themes) ? themes : [],
        seeking: Array.isArray(intent) ? intent : [],
        offering: Array.isArray(offering) ? offering : [],
        focus: c.focus_text || '',
        geography: c.geography || '',
        dealStage: deal.stage || '',
        dealSize: deal.check_size || deal.raise_size || ''
      };
    });

    // ─── AGGREGATE NETWORK SIGNALS ───
    var topThemes = await safeAll(`
      SELECT theme, COUNT(*) as c
      FROM stakeholder_profiles,
        LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(themes) = 'array' THEN themes ELSE '[]'::jsonb END) as theme
      GROUP BY theme ORDER BY COUNT(*) DESC LIMIT 8
    `, [], []);

    var topIntents = await safeAll(`
      SELECT intent_item as item, COUNT(*) as c
      FROM stakeholder_profiles,
        LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(intent) = 'array' THEN intent ELSE '[]'::jsonb END) as intent_item
      GROUP BY intent_item ORDER BY COUNT(*) DESC LIMIT 8
    `, [], []);

    var topOfferings = await safeAll(`
      SELECT offer_item as item, COUNT(*) as c
      FROM stakeholder_profiles,
        LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(offering) = 'array' THEN offering ELSE '[]'::jsonb END) as offer_item
      GROUP BY offer_item ORDER BY COUNT(*) DESC LIMIT 8
    `, [], []);

    res.json({
      network: network, funnel: funnel, scoreAcceptance: scoreAcceptance,
      archetypePairs: archetypePairs, acceptanceByType: acceptanceByType,
      canisterDepth: canisterDepth, supplyDemand: supplyDemand,
      intentGaps: intentGaps, growth: growth, eventScorecard: eventScorecard,
      dailySignups: dailySignups,
      canisterSnapshots: canisterSnapshots,
      topThemes: topThemes.map(function(t){ return {theme:t.theme, count:parseInt(t.c)||0}; }),
      topIntents: topIntents.map(function(t){ return {item:t.item, count:parseInt(t.c)||0}; }),
      topOfferings: topOfferings.map(function(t){ return {item:t.item, count:parseInt(t.c)||0}; })
    });

  } catch(e) {
    console.error('Dashboard top-level error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/dashboard/event/:id — single event drill-down ──
router.get('/dashboard/event/:id', authenticateToken, adminOnly, async function(req, res) {
  try {
    var eid = req.params.id;
    var event = await safeGet('SELECT id, name, event_date, city, country FROM events WHERE id = $1', [eid], null);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    var regs = await safeGet("SELECT COUNT(*) as c FROM event_registrations WHERE event_id = $1 AND status = 'active'", [eid], {c:0});
    var matches = await safeGet('SELECT COUNT(*) as c FROM event_matches WHERE event_id = $1', [eid], {c:0});
    var accepted = await safeGet("SELECT COUNT(*) as c FROM event_matches WHERE event_id = $1 AND (user_a_decision='accept' OR user_b_decision='accept')", [eid], {c:0});
    var revealed = await safeGet("SELECT COUNT(*) as c FROM event_matches WHERE event_id = $1 AND status = 'revealed'", [eid], {c:0});
    var avgScore = await safeGet('SELECT AVG(score_total) as avg FROM event_matches WHERE event_id = $1 AND score_total > 0', [eid], {avg:0});

    var stakeholders = await safeAll(`
      SELECT sp.stakeholder_type as type, COUNT(*) as count
      FROM event_registrations er JOIN stakeholder_profiles sp ON sp.user_id = er.user_id
      WHERE er.event_id = $1 AND er.status = 'active' AND sp.stakeholder_type IS NOT NULL
      GROUP BY sp.stakeholder_type ORDER BY COUNT(*) DESC
    `, [eid], []);

    var themes = await safeAll(`
      SELECT theme, COUNT(*) as count
      FROM event_registrations er JOIN stakeholder_profiles sp ON sp.user_id = er.user_id,
        LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(sp.themes) = 'array' THEN sp.themes ELSE '[]'::jsonb END) as theme
      WHERE er.event_id = $1 AND er.status = 'active'
      GROUP BY theme ORDER BY COUNT(*) DESC LIMIT 10
    `, [eid], []);

    res.json({
      event: event,
      regs: parseInt(regs.c) || 0, matches: parseInt(matches.c) || 0,
      accepted: parseInt(accepted.c) || 0, revealed: parseInt(revealed.c) || 0,
      avgScore: parseFloat(avgScore.avg) || 0,
      stakeholders: stakeholders.map(function(s) { return { type: s.type, count: parseInt(s.count) || 0 }; }),
      themes: themes.map(function(t) { return { theme: t.theme, count: parseInt(t.count) || 0 }; })
    });
  } catch(e) {
    console.error('Event drill error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;