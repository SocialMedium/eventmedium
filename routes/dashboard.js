var express = require('express');
var router = express.Router();
var { dbGet, dbAll } = require('../db');
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
        system: 'You are reviewing beta feedback for EventMedium.ai \u2014 a professional networking platform that matches people at events using AI-built profiles called canisters. Users earn EMC\u00B2 credits through network activity.\n\nAnalyse the feedback batch and produce a structured briefing in this exact JSON format:\n{"critical":[{"id":0,"summary":"","action":""}],"bugs":[{"id":0,"summary":"","priority":"high"}],"improvements":[{"summary":"","frequency":1,"impact":"high"}],"patterns":[""],"praise":[""],"schedule":{"this_week":[""],"next_sprint":[""],"backlog":[""]},"overall_health":"good","headline":""}\n\nBe direct. Flag anything breaking core flows (matching, canister save, auth, EMC\u00B2) as critical. Tone: senior product manager briefing a founder. Return only valid JSON, no preamble.',
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

module.exports = router;