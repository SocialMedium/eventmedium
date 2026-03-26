var express = require('express');
var router = express.Router();
var { dbGet, dbAll, dbRun } = require('../db');
var { authenticateToken } = require('../middleware/auth');
var { fireCommunityWelcomeTrigger } = require('../lib/community_triggers');
var { getAbuseSummary, getSuspiciousProfiles } = require('../middleware/anti_abuse');

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

// ── GET /api/admin/live — live activity analytics ──
router.get('/live', authenticateToken, adminOnly, async function(req, res) {
  try {
    // ── Active users by time window (based on sessions) ──
    var active24h = await safeGet("SELECT COUNT(DISTINCT user_id) as c FROM sessions WHERE created_at >= NOW() - INTERVAL '24 hours'", [], {c:0});
    var active7d = await safeGet("SELECT COUNT(DISTINCT user_id) as c FROM sessions WHERE created_at >= NOW() - INTERVAL '7 days'", [], {c:0});
    var active30d = await safeGet("SELECT COUNT(DISTINCT user_id) as c FROM sessions WHERE created_at >= NOW() - INTERVAL '30 days'", [], {c:0});

    // ── Pulse: activity counts in last 24h ──
    var signups24h = await safeGet("SELECT COUNT(*) as c FROM users WHERE created_at >= NOW() - INTERVAL '24 hours'", [], {c:0});
    var logins24h = await safeGet("SELECT COUNT(*) as c FROM sessions WHERE created_at >= NOW() - INTERVAL '24 hours'", [], {c:0});
    var nevChats24h = await safeGet("SELECT COUNT(*) as c FROM nev_messages WHERE role = 'user' AND created_at >= NOW() - INTERVAL '24 hours'", [], {c:0});
    var joins24h = await safeGet("SELECT COUNT(*) as c FROM community_members WHERE joined_at >= NOW() - INTERVAL '24 hours'", [], {c:0});
    var matches24h = await safeGet("SELECT COUNT(*) as c FROM event_matches WHERE created_at >= NOW() - INTERVAL '24 hours'", [], {c:0});
    var canisterUpdates24h = await safeGet("SELECT COUNT(*) as c FROM stakeholder_profiles WHERE updated_at >= NOW() - INTERVAL '24 hours'", [], {c:0});

    // ── Pulse: 7d for comparison ──
    var signups7d = await safeGet("SELECT COUNT(*) as c FROM users WHERE created_at >= NOW() - INTERVAL '7 days'", [], {c:0});
    var logins7d = await safeGet("SELECT COUNT(*) as c FROM sessions WHERE created_at >= NOW() - INTERVAL '7 days'", [], {c:0});
    var nevChats7d = await safeGet("SELECT COUNT(*) as c FROM nev_messages WHERE role = 'user' AND created_at >= NOW() - INTERVAL '7 days'", [], {c:0});
    var joins7d = await safeGet("SELECT COUNT(*) as c FROM community_members WHERE joined_at >= NOW() - INTERVAL '7 days'", [], {c:0});
    var matches7d = await safeGet("SELECT COUNT(*) as c FROM event_matches WHERE created_at >= NOW() - INTERVAL '7 days'", [], {c:0});

    // ── Daily signups for last 30 days ──
    var dailySignups = await safeAll(
      "SELECT DATE(created_at) as day, COUNT(*) as count FROM users WHERE created_at >= NOW() - INTERVAL '30 days' GROUP BY day ORDER BY day ASC",
      [], []
    );

    // ── Daily active users (sessions) for last 30 days ──
    var dailyActive = await safeAll(
      "SELECT DATE(created_at) as day, COUNT(DISTINCT user_id) as count FROM sessions WHERE created_at >= NOW() - INTERVAL '30 days' GROUP BY day ORDER BY day ASC",
      [], []
    );

    // ── Recent activity feed — last 50 actions ──
    var recentActivity = await safeAll(`
      (SELECT 'signup' as action, u.name as detail, NULL as extra, u.created_at as ts
       FROM users u WHERE u.created_at >= NOW() - INTERVAL '7 days')
      UNION ALL
      (SELECT 'nev_chat' as action, u.name as detail, NULL as extra, nm.created_at as ts
       FROM nev_messages nm JOIN users u ON u.id = nm.user_id
       WHERE nm.role = 'user' AND nm.created_at >= NOW() - INTERVAL '7 days')
      UNION ALL
      (SELECT 'community_join' as action, u.name as detail, c.name as extra, cm.joined_at as ts
       FROM community_members cm JOIN users u ON u.id = cm.user_id JOIN communities c ON c.id = cm.community_id
       WHERE cm.joined_at >= NOW() - INTERVAL '7 days')
      UNION ALL
      (SELECT 'canister_update' as action, u.name as detail, sp.stakeholder_type as extra, sp.updated_at as ts
       FROM stakeholder_profiles sp JOIN users u ON u.id = sp.user_id
       WHERE sp.updated_at >= NOW() - INTERVAL '7 days' AND sp.stakeholder_type IS NOT NULL)
      UNION ALL
      (SELECT 'login' as action, u.name as detail, NULL as extra, s.created_at as ts
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.created_at >= NOW() - INTERVAL '7 days')
      ORDER BY ts DESC LIMIT 50
    `, [], []);

    // ── Nev engagement: users who chatted with Nev in last 7d ──
    var nevUsers7d = await safeGet("SELECT COUNT(DISTINCT user_id) as c FROM nev_messages WHERE role = 'user' AND created_at >= NOW() - INTERVAL '7 days'", [], {c:0});

    // ── Notification delivery stats ──
    var notifsSent = await safeGet("SELECT COUNT(*) as c FROM notifications WHERE created_at >= NOW() - INTERVAL '7 days'", [], {c:0});
    var notifsRead = await safeGet("SELECT COUNT(*) as c FROM notifications WHERE created_at >= NOW() - INTERVAL '7 days' AND read_at IS NOT NULL", [], {c:0});

    res.json({
      activeUsers: {
        last24h: parseInt(active24h.c) || 0,
        last7d: parseInt(active7d.c) || 0,
        last30d: parseInt(active30d.c) || 0
      },
      pulse24h: {
        signups: parseInt(signups24h.c) || 0,
        logins: parseInt(logins24h.c) || 0,
        nevChats: parseInt(nevChats24h.c) || 0,
        communityJoins: parseInt(joins24h.c) || 0,
        matches: parseInt(matches24h.c) || 0,
        canisterUpdates: parseInt(canisterUpdates24h.c) || 0
      },
      pulse7d: {
        signups: parseInt(signups7d.c) || 0,
        logins: parseInt(logins7d.c) || 0,
        nevChats: parseInt(nevChats7d.c) || 0,
        communityJoins: parseInt(joins7d.c) || 0,
        matches: parseInt(matches7d.c) || 0
      },
      dailySignups: dailySignups,
      dailyActive: dailyActive,
      recentActivity: recentActivity,
      engagement: {
        nevUsers7d: parseInt(nevUsers7d.c) || 0,
        notifsSent7d: parseInt(notifsSent.c) || 0,
        notifsRead7d: parseInt(notifsRead.c) || 0
      }
    });
  } catch(e) {
    console.error('Live analytics error:', e);
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

// ── GET /api/admin/people — all users with canister status ──
router.get('/people', authenticateToken, adminOnly, async function(req, res) {
  try {
    var users = await safeAll(
      `SELECT u.id, u.email, u.name, u.created_at,
        sp.stakeholder_type, sp.themes, sp.intent, sp.offering, sp.geography, sp.focus_text,
        CASE
          WHEN sp.id IS NULL THEN 'no_profile'
          WHEN sp.stakeholder_type IS NULL THEN 'started'
          WHEN sp.themes IS NULL OR sp.themes::text = '[]' OR sp.themes::text = 'null' THEN 'partial'
          WHEN (sp.intent IS NULL OR sp.intent::text = '[]' OR sp.intent::text = 'null')
               AND (sp.offering IS NULL OR sp.offering::text = '[]' OR sp.offering::text = 'null') THEN 'partial'
          ELSE 'complete'
        END as canister_status
       FROM users u
       LEFT JOIN stakeholder_profiles sp ON sp.user_id = u.id
       ORDER BY u.created_at DESC`,
      [], []
    );
    // Attach community memberships
    for (var i = 0; i < users.length; i++) {
      var memberships = await safeAll(
        'SELECT cm.community_id, cm.role, c.name as community_name FROM community_members cm JOIN communities c ON c.id = cm.community_id WHERE cm.user_id = $1',
        [users[i].id], []
      );
      users[i].communities = memberships;
    }
    // Summary stats
    var total = users.length;
    var complete = users.filter(function(u) { return u.canister_status === 'complete'; }).length;
    var partial = users.filter(function(u) { return u.canister_status === 'partial'; }).length;
    var started = users.filter(function(u) { return u.canister_status === 'started'; }).length;
    var noProfile = users.filter(function(u) { return u.canister_status === 'no_profile'; }).length;

    res.json({
      summary: { total: total, complete: complete, partial: partial, started: started, noProfile: noProfile },
      users: users
    });
  } catch(e) {
    console.error('People endpoint error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/user-lookup — find users by name/email ──
router.get('/user-lookup', authenticateToken, adminOnly, async function(req, res) {
  try {
    var q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Query required (?q=name or email)' });
    var users = await safeAll(
      "SELECT u.id, u.email, u.name, u.created_at, sp.stakeholder_type, sp.themes, sp.intent, sp.offering, sp.geography, sp.focus_text FROM users u LEFT JOIN stakeholder_profiles sp ON sp.user_id = u.id WHERE u.name ILIKE $1 OR u.email ILIKE $1",
      ['%' + q + '%'], []
    );
    // For each user, check community memberships
    for (var i = 0; i < users.length; i++) {
      var memberships = await safeAll(
        'SELECT cm.community_id, cm.role, cm.joined_at, c.name as community_name FROM community_members cm JOIN communities c ON c.id = cm.community_id WHERE cm.user_id = $1',
        [users[i].id], []
      );
      users[i].communities = memberships;
    }
    res.json({ users: users });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/communities — list all communities ──
router.get('/communities', authenticateToken, adminOnly, async function(req, res) {
  try {
    var communities = await safeAll(
      'SELECT id, name, slug, access_code, is_active, (SELECT COUNT(*) FROM community_members WHERE community_id = communities.id) as member_count FROM communities ORDER BY name',
      [], []
    );
    res.json({ communities: communities });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/admin/force-join — manually add user to community ──
router.post('/force-join', authenticateToken, adminOnly, async function(req, res) {
  try {
    var { user_id, community_id } = req.body;
    if (!user_id || !community_id) return res.status(400).json({ error: 'user_id and community_id required' });
    // Check not already a member
    var existing = await dbGet('SELECT id FROM community_members WHERE user_id = $1 AND community_id = $2', [user_id, community_id]);
    if (existing) return res.json({ status: 'already_member' });
    var { dbRun } = require('../db');
    await dbRun('INSERT INTO community_members (community_id, user_id, role) VALUES ($1, $2, $3)', [community_id, user_id, 'member']);

    // Fire-and-forget: first-community welcome trigger
    fireCommunityWelcomeTrigger(user_id, community_id).catch(function(err) {
      console.error('[community-welcome] admin force-join path failed:', err.message);
    });

    res.json({ status: 'joined' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/admin/send-welcome — manually fire community welcome for a user (bypasses first-community check) ──
router.post('/send-welcome', authenticateToken, adminOnly, async function(req, res) {
  try {
    var { user_id, community_id } = req.body;
    if (!user_id || !community_id) return res.status(400).json({ error: 'user_id and community_id required' });

    var user = await dbGet('SELECT id, name, email FROM users WHERE id = $1', [user_id]);
    var community = await dbGet('SELECT id, name, slug FROM communities WHERE id = $1', [community_id]);
    if (!user || !community) return res.status(404).json({ error: 'User or community not found' });

    var firstName = (user.name || '').split(' ')[0] || 'there';

    // Write notification
    var { dbRun } = require('../db');
    await dbRun(
      'INSERT INTO notifications (user_id, type, title, body, link, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        user_id,
        'community_welcome',
        "You're in: " + community.name,
        "You're confirmed as a member of " + community.name + ". If Nev finds a compelling match for you here, you'll receive a notification to review and accept or decline. Your canister is never shared unless you say yes.",
        '/c/' + community.slug,
        JSON.stringify({ community_id: community_id, community_name: community.name, trigger: 'admin_manual' })
      ]
    );

    // Send email
    var emailSent = false;
    if (process.env.RESEND_API_KEY && user.email) {
      var { Resend } = require('resend');
      var resend = new Resend(process.env.RESEND_API_KEY);
      var { buildFirstCommunityEmail } = require('../lib/community_triggers');

      await resend.emails.send({
        from: process.env.FROM_EMAIL || 'nev@eventmedium.ai',
        to: user.email,
        subject: 'Nev is watching for your first match in ' + community.name,
        html: buildFirstCommunityEmail(firstName, community)
      });
      emailSent = true;
    }

    res.json({ status: 'sent', notification: true, email: emailSent });
  } catch(e) {
    console.error('[admin] send-welcome error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/debug-recommendations — test recommendation scoring for a user ──
router.get('/debug-recommendations', authenticateToken, adminOnly, async function(req, res) {
  try {
    var userId = parseInt(req.query.user_id) || req.user.id;
    var profile = await dbGet(
      'SELECT stakeholder_type, themes, intent, offering, geography, focus_text FROM stakeholder_profiles WHERE user_id = $1',
      [userId]
    );
    if (!profile) return res.json({ error: 'no_profile', userId: userId });

    var userThemes = typeof profile.themes === 'string' ? JSON.parse(profile.themes) : (profile.themes || []);
    var userIntent = typeof profile.intent === 'string' ? JSON.parse(profile.intent) : (profile.intent || []);
    var userOffering = typeof profile.offering === 'string' ? JSON.parse(profile.offering) : (profile.offering || []);
    var userGeo = (profile.geography || '').toLowerCase();
    var userFocus = (profile.focus_text || '').toLowerCase();

    var userKeywords = new Set();
    userThemes.forEach(function(t) { userKeywords.add(t.toLowerCase()); });
    userIntent.forEach(function(t) { if (typeof t === 'string') userKeywords.add(t.toLowerCase()); });
    userOffering.forEach(function(t) { if (typeof t === 'string') userKeywords.add(t.toLowerCase()); });
    if (userFocus) {
      userFocus.split(/[\s,;]+/).forEach(function(w) { if (w.length > 3) userKeywords.add(w); });
    }

    var events = await dbAll(
      `SELECT e.id, e.name, e.event_date, e.city, e.country, e.themes, e.community_id, e.is_public
       FROM events e
       WHERE e.event_date >= CURRENT_DATE
       ORDER BY e.event_date ASC`
    );

    var registrations = await safeAll(
      "SELECT event_id FROM event_registrations WHERE user_id = $1 AND status = 'active'",
      [userId], []
    );
    var regSet = new Set(registrations.map(function(r) { return r.event_id; }));

    var debug = events.map(function(ev) {
      var evThemes = typeof ev.themes === 'string' ? JSON.parse(ev.themes) : (ev.themes || []);
      var evCity = (ev.city || '').toLowerCase();
      var evCountry = (ev.country || '').toLowerCase();
      var evName = (ev.name || '').toLowerCase();

      var themeSet = new Set(userThemes.map(function(t) { return t.toLowerCase(); }));
      var evSet = new Set(evThemes.map(function(t) { return t.toLowerCase(); }));
      var intersection = 0;
      evSet.forEach(function(t) { if (themeSet.has(t)) intersection++; });
      var union = new Set([...themeSet, ...evSet]).size;
      var themeScore = union > 0 ? intersection / union : 0;

      var keywordHits = 0;
      userKeywords.forEach(function(kw) {
        if (evName.indexOf(kw) !== -1) keywordHits++;
        evThemes.forEach(function(t) { if (t.toLowerCase().indexOf(kw) !== -1) keywordHits++; });
      });
      var keywordScore = userKeywords.size > 0 ? Math.min(1, keywordHits / Math.max(3, userKeywords.size * 0.3)) : 0;

      var geoScore = 0;
      if (userGeo) {
        if (evCity && (userGeo.indexOf(evCity) !== -1 || evCity.indexOf(userGeo) !== -1)) geoScore = 1;
        else if (evCountry && (userGeo.indexOf(evCountry) !== -1 || evCountry.indexOf(userGeo) !== -1)) geoScore = 0.6;
      }

      var total = (themeScore * 0.4) + (keywordScore * 0.3) + (geoScore * 0.3);

      return {
        id: ev.id, name: ev.name, event_date: ev.event_date, city: ev.city,
        community_id: ev.community_id, is_public: ev.is_public,
        registered: regSet.has(ev.id),
        themeScore: Math.round(themeScore * 100) / 100,
        keywordScore: Math.round(keywordScore * 100) / 100,
        keywordHits: keywordHits,
        geoScore: geoScore,
        totalScore: Math.round(total * 100) / 100,
        wouldRecommend: total > 0.05
      };
    });

    res.json({
      userId: userId,
      profile: {
        stakeholder_type: profile.stakeholder_type,
        themes: userThemes,
        intent: userIntent,
        offering: userOffering,
        geography: profile.geography,
        focus_text: profile.focus_text,
        keywordCount: userKeywords.size,
        keywords: Array.from(userKeywords).slice(0, 20)
      },
      upcomingEvents: events.length,
      scoredEvents: debug
    });
  } catch(e) {
    console.error('Debug recommendations error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/abuse — abuse flags and suspicious profiles ──
router.get('/abuse', authenticateToken, adminOnly, async function(req, res) {
  try {
    var flags = await getAbuseSummary();
    var suspicious = await getSuspiciousProfiles();
    res.json({ flags: flags, suspicious_profiles: suspicious });
  } catch (err) {
    console.error('Abuse dashboard error:', err);
    res.status(500).json({ error: 'Failed to load abuse data' });
  }
});

// ── GET /api/admin/nev-diagnostic — check Nev engagement & canister status for users ──
router.get('/nev-diagnostic', authenticateToken, adminOnly, async function(req, res) {
  try {
    var emails = req.query.emails;
    if (!emails) return res.status(400).json({ error: 'Provide ?emails=a@b.com,c@d.com' });
    var emailList = emails.split(',').map(function(e) { return e.trim().toLowerCase(); });

    var results = [];
    for (var i = 0; i < emailList.length; i++) {
      var email = emailList[i];
      var user = await safeGet(
        'SELECT id, name, email, created_at FROM users WHERE LOWER(email) = $1',
        [email], null
      );
      if (!user) {
        results.push({ email: email, status: 'user_not_found' });
        continue;
      }

      // Canister status
      var profile = await safeGet(
        'SELECT stakeholder_type, themes, intent, offering, geography, focus_text, deal_details, canister_version, onboarding_method, created_at, updated_at FROM stakeholder_profiles WHERE user_id = $1',
        [user.id], null
      );

      // Nev messages
      var nevStats = await safeGet(
        "SELECT COUNT(*) as total_messages, COUNT(CASE WHEN role = 'user' THEN 1 END) as user_messages, COUNT(CASE WHEN role = 'assistant' THEN 1 END) as assistant_messages, MIN(created_at) as first_message, MAX(created_at) as last_message FROM nev_messages WHERE user_id = $1",
        [user.id], { total_messages: 0 }
      );

      // Last few Nev messages to see where they got stuck
      var recentMessages = await safeAll(
        "SELECT role, LEFT(content, 200) as content_preview, created_at FROM nev_messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT 6",
        [user.id], []
      );

      // Sessions (login activity)
      var sessionCount = await safeGet(
        'SELECT COUNT(*) as c, MAX(created_at) as last_login FROM sessions WHERE user_id = $1',
        [user.id], { c: 0 }
      );

      // Community memberships
      var communities = await safeAll(
        'SELECT c.name, cm.role, cm.joined_at FROM community_members cm JOIN communities c ON c.id = cm.community_id WHERE cm.user_id = $1',
        [user.id], []
      );

      var canisterStatus = 'no_profile';
      if (profile) {
        if (!profile.stakeholder_type) canisterStatus = 'started';
        else if (!profile.themes || profile.themes === '[]') canisterStatus = 'partial';
        else if ((!profile.intent || profile.intent === '[]') && (!profile.offering || profile.offering === '[]')) canisterStatus = 'partial';
        else canisterStatus = 'complete';
      }

      results.push({
        email: email,
        user_id: user.id,
        name: user.name,
        signed_up: user.created_at,
        canister_status: canisterStatus,
        profile: profile,
        nev_engagement: {
          total_messages: parseInt(nevStats.total_messages) || 0,
          user_messages: parseInt(nevStats.user_messages) || 0,
          assistant_messages: parseInt(nevStats.assistant_messages) || 0,
          first_message: nevStats.first_message,
          last_message: nevStats.last_message
        },
        recent_nev_messages: recentMessages.reverse(),
        login_count: parseInt(sessionCount.c) || 0,
        last_login: sessionCount.last_login,
        communities: communities
      });
    }

    res.json({ diagnostic: results });
  } catch(e) {
    console.error('Nev diagnostic error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/admin/analyse-feedback — Claude-powered feedback triage ──
router.post('/analyse-feedback', authenticateToken, adminOnly, async function(req, res) {
  try {
    var feedback = req.body.feedback;
    if (!feedback || !feedback.length) return res.status(400).json({ error: 'No feedback provided' });

    var feedbackText = feedback.map(function(f, i) {
      return '[' + (i + 1) + '] Category: ' + f.category + ' | User: ' + (f.user_name || 'Anonymous') + ' | Date: ' + new Date(f.created_at).toLocaleDateString() + ' | Status: ' + f.status + '\nMessage: ' + f.message;
    }).join('\n\n');

    var response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: 'You are reviewing beta feedback for EventMedium.ai \u2014 a professional networking platform that matches people at events using AI-built profiles called canisters. Users earn EC\u00B3 credits through network activity.\n\nAnalyse the feedback batch and produce a structured briefing in this exact JSON format:\n{"critical":[{"id":0,"summary":"","action":""}],"bugs":[{"id":0,"summary":"","priority":"high"}],"improvements":[{"summary":"","frequency":1,"impact":"high"}],"patterns":[""],"praise":[""],"schedule":{"this_week":[""],"next_sprint":[""],"backlog":[""]},"overall_health":"good","headline":""}\n\nBe direct. Flag anything breaking core flows (matching, canister save, auth, EC\u00B3) as critical. Tone: senior product manager briefing a founder. Return only valid JSON, no preamble.',
        messages: [{ role: 'user', content: 'Analyse this feedback batch (' + feedback.length + ' items):\n\n' + feedbackText }]
      })
    });

    var data = await response.json();
    var raw = (data.content && data.content[0] && data.content[0].text) || '{}';
    var analysis;
    try { analysis = JSON.parse(raw); } catch(e) {
      var clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
      analysis = JSON.parse(clean);
    }

    res.json({ success: true, analysis: analysis });
  } catch(err) {
    console.error('[Feedback Analysis] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/fix-emc2-now — one-shot EC³ state fix for user 2 ──
router.post('/fix-emc2-now', authenticateToken, adminOnly, async function(req, res) {
  var results = [];
  try {
    // 1. Fix action_type column — switch from ENUM to VARCHAR if needed
    try {
      await dbRun("ALTER TABLE emc2_ledger ALTER COLUMN action_type TYPE VARCHAR(50)");
      results.push('action_type column converted to VARCHAR');
    } catch(e) {
      results.push('action_type already VARCHAR or no change needed: ' + e.message);
    }

    // 2. Check current ledger state
    var ledger = await dbAll("SELECT id, action_type, amount, balance_after, tx_hash FROM emc2_ledger WHERE user_id = 2 ORDER BY created_at ASC");
    results.push('Current ledger entries: ' + JSON.stringify(ledger));
    var currentBalance = ledger.length > 0 ? ledger[ledger.length - 1].balance_after : 0;

    // 3. Apply correction if needed
    if (currentBalance < 1000) {
      var correction = 1000 - currentBalance;
      var lastTxHash = ledger.length > 0 ? ledger[ledger.length - 1].tx_hash : null;
      var balanceAfter = currentBalance + correction;
      var createdAt = new Date();
      var crypto = require('crypto');
      var payload = JSON.stringify({
        user_id: 2, amount: correction, action_type: 'admin_adjustment',
        entity_id: null, entity_type: 'correction',
        balance_after: balanceAfter, prev_tx_hash: lastTxHash || '0000000000000000',
        created_at: createdAt
      });
      var txHash = crypto.createHash('sha256').update(payload).digest('hex');

      await dbRun(
        "INSERT INTO emc2_ledger (user_id, amount, action_type, entity_id, entity_type, balance_after, metadata, prev_tx_hash, tx_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [2, correction, 'admin_adjustment', null, 'correction', balanceAfter,
         JSON.stringify({ reason: 'canister_complete_correction', corrected_from: currentBalance }),
         lastTxHash, txHash, createdAt]
      );
      await dbRun("UPDATE stakeholder_profiles SET emc2_balance = $1, emc2_lifetime_earned = $1 WHERE user_id = 2", [balanceAfter]);
      results.push('Ledger correction applied: +' + correction + ', new balance: ' + balanceAfter);
    } else {
      results.push('Balance already correct: ' + currentBalance);
    }

    // 4. Set OG status and Genesis cohort
    var cols = [['og_member', 'BOOLEAN DEFAULT FALSE'], ['emc2_cohort', 'VARCHAR(20)'], ['emc2_cohort_number', 'INTEGER'], ['emc2_earn_multiplier', 'NUMERIC(3,1) DEFAULT 1.0']];
    for (var i = 0; i < cols.length; i++) {
      await dbRun('ALTER TABLE stakeholder_profiles ADD COLUMN IF NOT EXISTS ' + cols[i][0] + ' ' + cols[i][1]).catch(function() {});
    }
    await dbRun("UPDATE stakeholder_profiles SET og_member = TRUE, emc2_cohort = 'genesis', emc2_cohort_number = 2, emc2_earn_multiplier = 3.0 WHERE user_id = 2");
    results.push('OG status set: genesis, #1, 3.0x multiplier');

    // 5. Fix referral code to OG-0002
    await dbRun("ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20)").catch(function() {});
    await dbRun("UPDATE users SET referral_code = 'OG-0002' WHERE id = 2");
    results.push('Referral code set to OG-0002');

    // 6. Reserve OG-0001
    await dbRun("CREATE TABLE IF NOT EXISTS reserved_codes (id SERIAL PRIMARY KEY, code VARCHAR(20) UNIQUE NOT NULL, reason VARCHAR(100), assigned_to INTEGER REFERENCES users(id), assigned_at TIMESTAMP, reserved_at TIMESTAMP DEFAULT NOW())");
    await dbRun("INSERT INTO reserved_codes (code, reason) VALUES ('OG-0001', 'platform_genesis_collectible') ON CONFLICT (code) DO NOTHING");
    results.push('OG-0001 reserved as platform collectible');

    // 7. Verify final state
    var finalProfile = await dbGet("SELECT sp.emc2_balance, sp.emc2_lifetime_earned, sp.og_member, sp.emc2_cohort, sp.emc2_cohort_number, sp.emc2_earn_multiplier, u.referral_code FROM stakeholder_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.user_id = 2");
    results.push('Final state: ' + JSON.stringify(finalProfile));

    res.json({ success: true, results: results });
  } catch(err) {
    results.push('FATAL ERROR: ' + err.message);
    console.error('[fix-emc2-now]', err);
    res.status(500).json({ success: false, error: err.message, results: results });
  }
});

// ── Beta email campaign ──────────────────────────────────────────────────────

function getSegment(user) {
  var hasCity = !!(user.city && user.city !== 'Unknown');
  var themes = user.themes;
  if (typeof themes === 'string') try { themes = JSON.parse(themes); } catch(e) { themes = null; }
  var isComplete = !!(user.stakeholder_type && user.focus_text && themes && (Array.isArray(themes) ? themes.length > 0 : !!themes));
  var isPartial = !!(user.user_id && !isComplete && (user.stakeholder_type || user.focus_text));
  if (isComplete && !hasCity) return 'complete_no_city';
  if (isComplete && hasCity) return 'complete_with_city';
  if (isPartial) return 'partial';
  return 'zero';
}

function getSubject(segment, user) {
  var name = user.name ? user.name.split(' ')[0] : null;
  var p = name ? name + ' \u2014 ' : '';
  switch(segment) {
    case 'complete_with_city': return p + 'your Founding Member position on EventMedium is confirmed';
    case 'complete_no_city': return p + 'one thing missing from your Founding Member profile';
    case 'partial': return p + 'your Founding Member position is still open';
    default: return p + 'your Founding Member position is waiting';
  }
}

function emailWrapper(headerContent, bodyContent, refCode) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
  '<body style="margin:0;padding:0;background:#f4f4f0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif">' +
  '<div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden">' +
    '<div style="background:#0a0a0a;padding:28px 32px 24px;border-bottom:2px solid #C9A84C">' +
      '<div style="font-size:13px;font-weight:500;letter-spacing:0.08em;color:#C9A84C;margin-bottom:8px">EC\u00B3 \u00b7 EventMedium</div>' +
      headerContent +
    '</div>' +
    '<div style="padding:28px 32px">' + bodyContent + '</div>' +
    '<div style="height:1px;background:#f0efe9"></div>' +
    '<div style="padding:20px 32px;font-size:12px;color:#9ca3af;line-height:1.7">' +
      (refCode ? '<div style="background:#0a0a0a;border-radius:8px;padding:16px 20px;margin-bottom:16px">' +
        '<div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:8px">Your referral code</div>' +
        '<div style="font-size:22px;font-weight:500;letter-spacing:0.1em;color:#C9A84C;margin-bottom:6px">' + refCode + '</div>' +
        '<div style="font-size:12px;color:rgba(255,255,255,0.45);line-height:1.6">Earn 200 EC\u00B3 when someone you invite completes their profile, 100 more when they get their first match, and 50 when they confirm a meeting.<br><br>eventmedium.ai/join?ref=' + refCode + '</div>' +
      '</div>' : '') +
      'EventMedium is in live beta \u2014 we\'re actively improving the platform. If anything doesn\'t work as expected, <a href="https://www.eventmedium.ai/feedback.html" style="color:#1a1d29;text-decoration:none">share your feedback here</a>.<br><br>' +
      'EventMedium \u00b7 eventmedium.ai \u00b7 <a href="https://www.eventmedium.ai/canister.html" style="color:#1a1d29;text-decoration:none">Open my canister</a>' +
    '</div>' +
  '</div></body></html>';
}

function sectionDiv(content) { return '<div style="margin-bottom:20px">' + content + '</div>'; }
function personalNoteBlock(note) {
  if (!note || !note.trim()) return '';
  // Escape HTML in note
  var escaped = note.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  return sectionDiv('<div style="background:#f0fdf4;border-left:3px solid #059669;border-radius:0 8px 8px 0;padding:14px 16px"><p style="font-size:15px;line-height:1.7;color:#065f46;margin:0">' + escaped + '</p></div>');
}
function hookP(text) { return '<p style="font-size:16px;line-height:1.6;color:#1a1d29;font-style:italic;margin:0">' + text + '</p>'; }
function bodyP(text) { return '<p style="font-size:15px;line-height:1.7;color:#4b5563;margin:0">' + text + '</p>'; }
function urgencyP(text) { return '<p style="font-size:13px;color:#6b7280;font-style:italic;margin:0">' + text + '</p>'; }
function ctaBtn(href, text) { return '<a href="' + href + '" style="display:block;background:#1a1d29;color:#ffffff;text-decoration:none;text-align:center;padding:14px 24px;border-radius:8px;font-size:15px;font-weight:500">' + text + '</a>'; }
function benefitRow(label, value, cls) { return '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:7px 0;border-bottom:1px solid #eeede9;font-size:14px"><span style="color:#6b7280;flex:1">' + label + '</span><span style="font-weight:500;text-align:right;margin-left:16px;color:' + (cls === 'gold' ? '#92700a' : cls === 'green' ? '#065f46' : '#1a1d29') + '">' + value + '</span></div>'; }
function benefitBlock(rows) { return '<div style="background:#f9f9f7;border-radius:8px;padding:16px 20px">' + rows + '</div>'; }
function actionBlock(text) { return '<div style="background:#fffbeb;border-left:3px solid #C9A84C;border-radius:0 8px 8px 0;padding:14px 16px"><p style="color:#92400e;font-size:14px;margin:0">' + text + '</p></div>'; }

var hookLine = 'The connection that could have changed everything\u2026 was probably in the room.<br>But you didn\'t meet. And neither did they.';

function buildCompleteNoCityEmail(opts) {
  var user = opts.user; var refCode = opts.refCode; var refUrl = opts.refUrl;
  var header = '<div style="font-size:18px;font-weight:500;color:#ffffff;line-height:1.4">Founding Member Invitation</div><div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:6px;letter-spacing:0.04em;text-transform:uppercase">EventMedium.AI \u00b7 Position confirmed</div>';
  var body =
    sectionDiv(hookP(hookLine)) +
    personalNoteBlock(opts.personalNote) +
    sectionDiv(bodyP('EventMedium exists to fix that. We match people before events begin \u2014 privately, anonymously, and only when the fit is mutual. So when you walk in, the right conversations are already waiting.')) +
    sectionDiv(bodyP('Your canister is complete and your Founding Member position is confirmed.')) +
    sectionDiv(benefitBlock(
      benefitRow('Status', 'Founding Member', 'gold') +
      benefitRow('Member number', '#' + (user.emc2_cohort_number || '\u2014') + ' \u00b7 permanent', 'gold') +
      benefitRow('EC\u00B3 opening balance', '1,000 EC\u00B3', 'gold') +
      benefitRow('Earn multiplier', (user.emc2_earn_multiplier || 2) + '\u00d7 for life', 'gold') +
      benefitRow('Community matching', 'Free', 'green')
    )) +
    sectionDiv(actionBlock('<strong>One thing missing: your home city.</strong> Without it you won\'t appear on the network map and local matching won\'t find you. Confirm your home city with Nev \u2014 it takes 30 seconds.')) +
    sectionDiv(ctaBtn(refUrl, 'Confirm my city with Nev \u2192')) +
    sectionDiv(urgencyP('Then let the network work for you.'));
  return emailWrapper(header, body, refCode);
}

function buildPartialEmail(opts) {
  var user = opts.user; var refCode = opts.refCode; var refUrl = opts.refUrl;
  var header = '<div style="font-size:18px;font-weight:500;color:#ffffff;line-height:1.4">Founding Member Invitation</div><div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:6px;letter-spacing:0.04em;text-transform:uppercase">EventMedium.AI \u00b7 Position still open</div>';
  var body =
    sectionDiv(hookP(hookLine)) +
    personalNoteBlock(opts.personalNote) +
    sectionDiv(bodyP('A few things since your last visit: we\'ve tuned Nev to be a little less chatty, and we\'d love you to come back and finish your canister, claim your Founding Member position, and activate your wallet and rewards.')) +
    sectionDiv(bodyP('EventMedium matches people before events begin \u2014 privately, anonymously, and only when the fit is mutual. So when you walk in, the right conversations are already waiting.')) +
    sectionDiv(bodyP('Your Founding Member position is still open. Your member number, 1,000 EC\u00B3 opening balance, and accelerated rewards for life are all sitting there \u2014 they activate the moment your canister is complete.')) +
    sectionDiv(benefitBlock(
      benefitRow('EC\u00B3 opening balance', '1,000 EC\u00B3', 'gold') +
      benefitRow('Earn multiplier', 'Accelerated \u00b7 for life', 'gold') +
      benefitRow('Community matching', 'Free', 'green') +
      benefitRow('Member number', 'Permanent \u00b7 yours on completion', 'gold')
    )) +
    sectionDiv(urgencyP('We\'re still in the first 10,000. The live beta window closes soon.')) +
    sectionDiv(ctaBtn(refUrl, 'Finish my canister with Nev \u2192')) +
    sectionDiv(urgencyP('Takes 5 minutes. Talk to Nev and share your mission, then let the network work for you.'));
  return emailWrapper(header, body, refCode);
}

function buildZeroEmail(opts) {
  var user = opts.user; var refCode = opts.refCode; var refUrl = opts.refUrl;
  var header = '<div style="font-size:18px;font-weight:500;color:#ffffff;line-height:1.4">Founding Member Invitation</div><div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:6px;letter-spacing:0.04em;text-transform:uppercase">EventMedium.AI \u00b7 Your position is waiting</div>';
  var body =
    sectionDiv(hookP(hookLine)) +
    personalNoteBlock(opts.personalNote) +
    sectionDiv(bodyP('A few things since you signed up: we\'ve tuned Nev to be a little less chatty, and we\'d love you to come back, build your canister, claim your Founding Member position, and activate your wallet and rewards.')) +
    sectionDiv(bodyP('EventMedium matches people before events begin \u2014 privately, anonymously, and only when the fit is mutual. So when you walk in, the right conversations are already waiting.')) +
    sectionDiv(bodyP('Your Founding Member position is reserved \u2014 but the network can\'t match you until your profile exists. Your member number, 1,000 EC\u00B3 opening balance, and accelerated rewards are all on hold.')) +
    sectionDiv(benefitBlock(
      benefitRow('EC\u00B3 opening balance', '1,000 EC\u00B3', 'gold') +
      benefitRow('Earn multiplier', 'Accelerated \u00b7 for life', 'gold') +
      benefitRow('Community matching', 'Free', 'green') +
      benefitRow('Member number', 'Permanent \u00b7 yours on completion', 'gold')
    )) +
    sectionDiv(urgencyP('We\'re still in the first 10,000. The live beta window closes soon.')) +
    sectionDiv(ctaBtn(refUrl, 'Build my canister with Nev \u2192')) +
    sectionDiv(urgencyP('Takes 5 minutes. Talk to Nev and share your mission, then let the network work for you.'));
  return emailWrapper(header, body, refCode);
}

function buildCompleteWithCityEmail(opts) {
  var user = opts.user; var refCode = opts.refCode;
  var header = '<div style="font-size:18px;font-weight:500;color:#ffffff;line-height:1.4">Founding Member Invitation</div><div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:6px;letter-spacing:0.04em;text-transform:uppercase">EventMedium.AI \u00b7 Everything is active</div>';
  var body =
    sectionDiv(hookP(hookLine)) +
    personalNoteBlock(opts.personalNote) +
    sectionDiv(bodyP('EventMedium exists to fix that. We match people before events begin \u2014 privately, anonymously, and only when the fit is mutual. So when you walk in, the right conversations are already waiting.')) +
    sectionDiv(bodyP('Your canister is complete, your home city is set, and your Founding Member position is fully active.')) +
    sectionDiv(benefitBlock(
      benefitRow('Status', 'Founding Member \u00b7 confirmed', 'gold') +
      benefitRow('Member number', '#' + (user.emc2_cohort_number || '\u2014') + ' \u00b7 permanent', 'gold') +
      benefitRow('EC\u00B3 balance', '1,000 EC\u00B3', 'gold') +
      benefitRow('Earn multiplier', (user.emc2_earn_multiplier || 2) + '\u00d7 for life', 'gold') +
      benefitRow('Community matching', 'Free', 'green')
    )) +
    sectionDiv(ctaBtn('https://www.eventmedium.ai/canister.html', 'Open my canister and wallet \u2192')) +
    sectionDiv(urgencyP('The network is working for you. Keep your canister current \u2014 update your mission with Nev whenever your focus changes.'));
  return emailWrapper(header, body, refCode);
}

// ── POST /api/admin/send-beta-emails ──
router.post('/send-beta-emails', authenticateToken, adminOnly, async function(req, res) {
  try {
    var dryRun = req.body.dry_run !== false;
    var users = await dbAll("SELECT u.id, u.name, u.email, u.referral_code, u.city, u.country, sp.user_id, sp.emc2_cohort, sp.emc2_cohort_number, sp.og_member, sp.emc2_balance, sp.emc2_earn_multiplier, sp.stakeholder_type, sp.focus_text, sp.themes FROM users u LEFT JOIN stakeholder_profiles sp ON sp.user_id = u.id WHERE u.email IS NOT NULL AND u.id != 2 ORDER BY u.id ASC");

    var results = { total: users.length, sent: [], errors: [] };
    var Resend, resend;
    if (!dryRun && process.env.RESEND_API_KEY) {
      Resend = require('resend').Resend;
      resend = new Resend(process.env.RESEND_API_KEY);
    }

    for (var i = 0; i < users.length; i++) {
      var user = users[i];
      var segment = getSegment(user);
      var subject = getSubject(segment, user);
      var firstName = user.name ? user.name.split(' ')[0] : 'there';
      var refCode = user.referral_code || null;
      var refUrl = 'https://www.eventmedium.ai/onboard.html';

      if (dryRun) {
        results.sent.push({ id: user.id, name: user.name, email: user.email, subject: subject, segment: segment, refCode: refCode, dry_run: true });
        continue;
      }

      try {
        var html;
        var emailOpts = { user: user, firstName: firstName, refCode: refCode, refUrl: refUrl };
        switch(segment) {
          case 'complete_no_city': html = buildCompleteNoCityEmail(emailOpts); break;
          case 'partial': html = buildPartialEmail(emailOpts); break;
          case 'zero': html = buildZeroEmail(emailOpts); break;
          case 'complete_with_city': default: html = buildCompleteWithCityEmail(emailOpts); break;
        }

        await resend.emails.send({
          from: process.env.FROM_EMAIL || 'nev@eventmedium.ai',
          to: user.email,
          subject: subject,
          html: html
        });
        results.sent.push({ id: user.id, email: user.email, subject: subject, segment: segment, refCode: refCode });
      } catch(sendErr) {
        results.errors.push({ id: user.id, email: user.email, error: sendErr.message });
      }
    }

    res.json({ success: true, dry_run: dryRun, results: results });
  } catch(err) {
    console.error('[Beta emails] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/send-single-beta-email — send to one user with optional segment override ──
router.post('/send-single-beta-email', authenticateToken, adminOnly, async function(req, res) {
  try {
    var userId = req.body.user_id;
    var segmentOverride = req.body.segment_override;
    var personalNote = req.body.personal_note || '';
    if (!userId) return res.status(400).json({ error: 'user_id required' });

    var user = await dbGet("SELECT u.id, u.name, u.email, u.referral_code, u.city, u.country, sp.user_id, sp.emc2_cohort, sp.emc2_cohort_number, sp.og_member, sp.emc2_balance, sp.emc2_earn_multiplier, sp.stakeholder_type, sp.focus_text, sp.themes FROM users u LEFT JOIN stakeholder_profiles sp ON sp.user_id = u.id WHERE u.id = $1", [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    var segment = segmentOverride || getSegment(user);
    var subject = getSubject(segment, user);
    var firstName = user.name ? user.name.split(' ')[0] : 'there';
    var refCode = user.referral_code || null;
    var refUrl = 'https://www.eventmedium.ai/onboard.html';
    var emailOpts = { user: user, firstName: firstName, refCode: refCode, refUrl: refUrl, personalNote: personalNote };

    var html;
    switch(segment) {
      case 'complete_no_city': html = buildCompleteNoCityEmail(emailOpts); break;
      case 'partial': html = buildPartialEmail(emailOpts); break;
      case 'zero': html = buildZeroEmail(emailOpts); break;
      case 'complete_with_city': default: html = buildCompleteWithCityEmail(emailOpts); break;
    }

    if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY not set' });
    var Resend = require('resend').Resend;
    var resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'nev@eventmedium.ai',
      to: user.email,
      subject: subject,
      html: html
    });

    res.json({ success: true, email: user.email, segment: segment, subject: subject });
  } catch(err) {
    console.error('[Single beta email] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/preview-beta-email — return HTML without sending ──
router.post('/preview-beta-email', authenticateToken, adminOnly, async function(req, res) {
  try {
    var userId = req.body.user_id;
    var segmentOverride = req.body.segment_override;
    var personalNote = req.body.personal_note || '';
    if (!userId) return res.status(400).json({ error: 'user_id required' });

    var user = await dbGet("SELECT u.id, u.name, u.email, u.referral_code, u.city, u.country, sp.user_id, sp.emc2_cohort, sp.emc2_cohort_number, sp.og_member, sp.emc2_balance, sp.emc2_earn_multiplier, sp.stakeholder_type, sp.focus_text, sp.themes FROM users u LEFT JOIN stakeholder_profiles sp ON sp.user_id = u.id WHERE u.id = $1", [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    var segment = segmentOverride || getSegment(user);
    var subject = getSubject(segment, user);
    var firstName = user.name ? user.name.split(' ')[0] : 'there';
    var refCode = user.referral_code || null;
    var refUrl = 'https://www.eventmedium.ai/onboard.html';
    var emailOpts = { user: user, firstName: firstName, refCode: refCode, refUrl: refUrl, personalNote: personalNote };

    var html;
    switch(segment) {
      case 'complete_no_city': html = buildCompleteNoCityEmail(emailOpts); break;
      case 'partial': html = buildPartialEmail(emailOpts); break;
      case 'zero': html = buildZeroEmail(emailOpts); break;
      case 'complete_with_city': default: html = buildCompleteWithCityEmail(emailOpts); break;
    }

    res.json({ success: true, html: html, subject: subject, segment: segment, name: user.name, email: user.email });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;