var express = require('express');
var router = express.Router();
var { dbGet, dbAll, dbRun } = require('../db');
var { authenticateToken, optionalAuth } = require('../middleware/auth');


// ── GET /api/admin/dashboard — full network intelligence ──
router.get('/dashboard', authenticateToken, function(req, res, next) { if (req.user.id != 2) return res.status(403).json({ error: 'Admin only' }); next(); }, async function(req, res) {
  try {
    // ─── NETWORK TOTALS ───
    var totalUsers = await dbGet('SELECT COUNT(*) as c FROM users');
    var completeCanisters = await dbGet("SELECT COUNT(*) as c FROM stakeholder_profiles WHERE stakeholder_type IS NOT NULL");
    var totalRegs = await dbGet("SELECT COUNT(*) as c FROM event_registrations WHERE status = 'active'");
    var activeEvents = await dbGet("SELECT COUNT(*) as c FROM events WHERE event_date >= CURRENT_DATE");
    var totalMatches = await dbGet('SELECT COUNT(*) as c FROM event_matches');
    var acceptedOneWay = await dbGet("SELECT COUNT(*) as c FROM event_matches WHERE user_a_decision = 'accept' OR user_b_decision = 'accept'");
    var revealed = await dbGet("SELECT COUNT(*) as c FROM event_matches WHERE status = 'revealed'");
    var meetingsHeld = await dbGet("SELECT COUNT(*) as c FROM match_feedback WHERE did_meet = true");
    var debriefsDone = await dbGet("SELECT COUNT(DISTINCT match_id) as c FROM nev_debrief_messages WHERE role = 'user'");
    var avgScore = await dbGet('SELECT AVG(score_total) as avg FROM event_matches WHERE score_total > 0');

    var network = {
      totalUsers: parseInt(totalUsers.c),
      completeCanisters: parseInt(completeCanisters.c),
      totalRegistrations: parseInt(totalRegs.c),
      activeEvents: parseInt(activeEvents.c),
      totalMatches: parseInt(totalMatches.c),
      acceptedMatches: parseInt(acceptedOneWay.c),
      revealedMatches: parseInt(revealed.c),
      meetingsConfirmed: parseInt(meetingsHeld.c),
      debriefsDone: parseInt(debriefsDone.c),
      avgMatchScore: parseFloat(avgScore.avg) || 0
    };

    // ─── FUNNEL ───
    var profileComplete = parseInt(completeCanisters.c);
    var firstReg = await dbGet("SELECT COUNT(DISTINCT user_id) as c FROM event_registrations WHERE status = 'active'");
    var matchGenerated = await dbGet("SELECT COUNT(DISTINCT user_a_id) + COUNT(DISTINCT user_b_id) as c FROM event_matches");
    var matchAccepted = await dbGet("SELECT COUNT(DISTINCT CASE WHEN user_a_decision='accept' THEN user_a_id END) + COUNT(DISTINCT CASE WHEN user_b_decision='accept' THEN user_b_id END) as c FROM event_matches");
    var mutualReveal = await dbGet("SELECT COUNT(DISTINCT user_a_id) + COUNT(DISTINCT user_b_id) as c FROM event_matches WHERE status = 'revealed'");
    var messageSent = await dbGet("SELECT COUNT(DISTINCT user_id) as c FROM nev_debrief_messages WHERE role = 'user'");
    var meetingHeld = await dbGet("SELECT COUNT(DISTINCT user_id) as c FROM match_feedback WHERE did_meet = true");
    var debriefComplete = await dbGet("SELECT COUNT(DISTINCT user_id) as c FROM nev_debrief_messages WHERE role = 'user'");

    var funnel = [
      { stage: 'Signups', count: network.totalUsers },
      { stage: 'Canister complete', count: profileComplete },
      { stage: 'First registration', count: parseInt(firstReg.c) },
      { stage: 'Match generated', count: Math.min(parseInt(matchGenerated.c), network.totalUsers) },
      { stage: 'Match accepted', count: Math.min(parseInt(matchAccepted.c), network.totalUsers) },
      { stage: 'Mutual reveal', count: Math.min(parseInt(mutualReveal.c), network.totalUsers) },
      { stage: 'Meeting held', count: parseInt(meetingHeld.c) },
      { stage: 'Debrief done', count: parseInt(debriefComplete.c) }
    ];

    // ─── SCORE BAND → ACCEPTANCE ───
    var scoreBands = await dbAll(`
      SELECT 
        CASE 
          WHEN score_total >= 0.9 THEN '90-100%'
          WHEN score_total >= 0.8 THEN '80-89%'
          WHEN score_total >= 0.7 THEN '70-79%'
          WHEN score_total >= 0.6 THEN '60-69%'
          WHEN score_total >= 0.5 THEN '50-59%'
          WHEN score_total >= 0.4 THEN '40-49%'
          ELSE '<40%'
        END as band,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE user_a_decision='accept' AND user_b_decision='accept') as mutual_accept,
        COUNT(*) FILTER (WHERE user_a_decision='accept' OR user_b_decision='accept') as any_accept,
        COUNT(*) FILTER (WHERE user_a_decision='decline' OR user_b_decision='decline') as any_decline
      FROM event_matches 
      WHERE score_total > 0
      GROUP BY 1
      ORDER BY 1 DESC
    `);

    var scoreAcceptance = scoreBands.map(function(b) {
      var total = parseInt(b.total);
      var accepted = parseInt(b.any_accept);
      return {
        band: b.band,
        total: total,
        accepted: accepted,
        declined: parseInt(b.any_decline),
        rate: total > 0 ? accepted / total : 0
      };
    });

    // ─── ARCHETYPE PAIR PERFORMANCE ───
    var archetypePairs = await dbAll(`
      SELECT 
        LEAST(sp_a.stakeholder_type, sp_b.stakeholder_type) || ' ↔ ' || GREATEST(sp_a.stakeholder_type, sp_b.stakeholder_type) as pair,
        COUNT(*) as matches,
        COUNT(*) FILTER (WHERE em.user_a_decision='accept' OR em.user_b_decision='accept')::float / NULLIF(COUNT(*), 0) as accept_rate,
        AVG(em.score_total) as avg_score,
        COUNT(*) FILTER (WHERE em.status='revealed')::float / NULLIF(COUNT(*), 0) as reveal_rate
      FROM event_matches em
      JOIN stakeholder_profiles sp_a ON sp_a.user_id = em.user_a_id
      JOIN stakeholder_profiles sp_b ON sp_b.user_id = em.user_b_id
      WHERE sp_a.stakeholder_type IS NOT NULL AND sp_b.stakeholder_type IS NOT NULL
      GROUP BY 1
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `);

    // ─── ACCEPTANCE BY ARCHETYPE ───
    var acceptByType = await dbAll(`
      SELECT 
        sp.stakeholder_type as type,
        COUNT(*) as total_matches,
        COUNT(*) FILTER (WHERE 
          (em.user_a_id = sp.user_id AND em.user_a_decision = 'accept') OR
          (em.user_b_id = sp.user_id AND em.user_b_decision = 'accept')
        ) as accepted
      FROM stakeholder_profiles sp
      JOIN event_matches em ON em.user_a_id = sp.user_id OR em.user_b_id = sp.user_id
      WHERE sp.stakeholder_type IS NOT NULL
      GROUP BY sp.stakeholder_type
      ORDER BY COUNT(*) DESC
    `);

    var acceptanceByType = acceptByType.map(function(a) {
      var total = parseInt(a.total_matches);
      var accepted = parseInt(a.accepted);
      return {
        type: a.type.charAt(0).toUpperCase() + a.type.slice(1) + 's',
        total: total,
        accepted: accepted,
        rate: total > 0 ? accepted / total : 0
      };
    });

    // ─── SUPPLY-DEMAND: Theme × Archetype ───
    var themeArchetype = await dbAll(`
      SELECT 
        theme.val as theme,
        sp.stakeholder_type as type,
        COUNT(DISTINCT sp.user_id) as user_count
      FROM stakeholder_profiles sp,
      LATERAL jsonb_array_elements_text(sp.themes) as theme(val)
      WHERE sp.stakeholder_type IS NOT NULL
      GROUP BY theme.val, sp.stakeholder_type
      ORDER BY theme.val
    `);

    // Pivot into matrix
    var themeMap = {};
    themeArchetype.forEach(function(r) {
      if (!themeMap[r.theme]) themeMap[r.theme] = { theme: r.theme, founders: 0, investors: 0, corporates: 0, researchers: 0, advisors: 0, operators: 0 };
      var key = r.type + 's';
      themeMap[r.theme][key] = parseInt(r.user_count);
    });
    var supplyDemand = Object.values(themeMap).map(function(t) {
      var ratio = t.investors > 0 ? (t.founders / t.investors).toFixed(1) : (t.founders > 0 ? '∞' : '0');
      return { ...t, ratio: ratio };
    }).sort(function(a, b) { return (b.founders + b.investors + b.corporates + b.researchers) - (a.founders + a.investors + a.corporates + a.researchers); });

    // ─── INTENT vs OFFERING GAPS ───
    var intents = await dbAll(`
      SELECT intent.val as intent, COUNT(DISTINCT user_id) as seeking
      FROM stakeholder_profiles,
      LATERAL jsonb_array_elements_text(intent) as intent(val)
      GROUP BY intent.val ORDER BY COUNT(*) DESC LIMIT 10
    `);
    var offerings = await dbAll(`
      SELECT offer.val as offering, COUNT(DISTINCT user_id) as providing
      FROM stakeholder_profiles,
      LATERAL jsonb_array_elements_text(offering) as offer(val)
      GROUP BY offer.val ORDER BY COUNT(*) DESC LIMIT 10
    `);

    // Match intents to offerings
    var offerMap = {};
    offerings.forEach(function(o) { offerMap[o.offering.toLowerCase()] = parseInt(o.providing); });
    var intentGaps = intents.map(function(i) {
      var seeking = parseInt(i.seeking);
      var offering = offerMap[i.intent.toLowerCase()] || 0;
      return { intent: i.intent, seeking: seeking, offering: offering, gap: seeking - offering };
    }).sort(function(a, b) { return b.gap - a.gap; });

    // ─── EVENT SCORECARDS ───
    var events = await dbAll(`
      SELECT 
        e.id, e.name, e.event_date, e.city,
        COUNT(DISTINCT er.user_id) as regs,
        COUNT(DISTINCT em.id) as matches,
        COUNT(DISTINCT em.id) FILTER (WHERE em.user_a_decision='accept' OR em.user_b_decision='accept')::float / NULLIF(COUNT(DISTINCT em.id), 0) as accept_rate,
        COUNT(DISTINCT em.id) FILTER (WHERE em.status='revealed')::float / NULLIF(COUNT(DISTINCT em.id), 0) as reveal_rate,
        AVG(em.score_total) as avg_score
      FROM events e
      LEFT JOIN event_registrations er ON er.event_id = e.id AND er.status = 'active'
      LEFT JOIN event_matches em ON em.event_id = e.id
      WHERE e.event_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY e.id, e.name, e.event_date, e.city
      HAVING COUNT(DISTINCT er.user_id) > 0
      ORDER BY e.event_date ASC
    `);

    var eventScorecard = events.map(function(e) {
      return {
        id: e.id,
        name: e.name,
        date: e.event_date ? new Date(e.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'TBD',
        city: e.city,
        regs: parseInt(e.regs),
        matches: parseInt(e.matches),
        acceptRate: parseFloat(e.accept_rate) || 0,
        revealRate: parseFloat(e.reveal_rate) || 0,
        avgScore: parseFloat(e.avg_score) || 0
      };
    });

    // ─── GROWTH (weekly signups) ───
    var weeklyGrowth = await dbAll(`
      SELECT 
        date_trunc('week', created_at)::date as week,
        COUNT(*) as users
      FROM users
      WHERE created_at >= CURRENT_DATE - INTERVAL '8 weeks'
      GROUP BY 1
      ORDER BY 1
    `);

    var weeklyRegs = await dbAll(`
      SELECT 
        date_trunc('week', created_at)::date as week,
        COUNT(*) as regs
      FROM event_registrations
      WHERE created_at >= CURRENT_DATE - INTERVAL '8 weeks'
      GROUP BY 1
      ORDER BY 1
    `);

    // Merge
    var growthMap = {};
    weeklyGrowth.forEach(function(w) {
      var key = new Date(w.week).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      growthMap[key] = { week: key, users: parseInt(w.users), regs: 0 };
    });
    weeklyRegs.forEach(function(w) {
      var key = new Date(w.week).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      if (!growthMap[key]) growthMap[key] = { week: key, users: 0, regs: 0 };
      growthMap[key].regs = parseInt(w.regs);
    });
    var growth = Object.values(growthMap).sort(function(a, b) { return new Date(a.week) - new Date(b.week); });

    // ─── CANISTER DEPTH ───
    var canisterDepth = await dbGet(`
      SELECT 
        COUNT(*) FILTER (WHERE stakeholder_type IS NOT NULL)::float / NULLIF(COUNT(*), 0) as type_pct,
        COUNT(*) FILTER (WHERE themes IS NOT NULL AND themes != '[]'::jsonb)::float / NULLIF(COUNT(*), 0) as themes_pct,
        COUNT(*) FILTER (WHERE intent IS NOT NULL AND intent != '[]'::jsonb)::float / NULLIF(COUNT(*), 0) as intent_pct,
        COUNT(*) FILTER (WHERE offering IS NOT NULL AND offering != '[]'::jsonb)::float / NULLIF(COUNT(*), 0) as offering_pct,
        COUNT(*) FILTER (WHERE geography IS NOT NULL AND geography != '')::float / NULLIF(COUNT(*), 0) as geo_pct,
        COUNT(*) FILTER (WHERE focus_text IS NOT NULL AND focus_text != '')::float / NULLIF(COUNT(*), 0) as focus_pct,
        COUNT(*) FILTER (WHERE deal_details IS NOT NULL AND deal_details != '{}'::jsonb AND deal_details != 'null'::jsonb)::float / NULLIF(COUNT(*), 0) as deal_pct,
        COUNT(*) FILTER (WHERE context IS NOT NULL AND context != '')::float / NULLIF(COUNT(*), 0) as context_pct
      FROM stakeholder_profiles
    `);

    var canister = [
      { field: 'Stakeholder type', pct: Math.round((parseFloat(canisterDepth.type_pct) || 0) * 100) },
      { field: 'Themes', pct: Math.round((parseFloat(canisterDepth.themes_pct) || 0) * 100) },
      { field: 'Intent', pct: Math.round((parseFloat(canisterDepth.intent_pct) || 0) * 100) },
      { field: 'Geography', pct: Math.round((parseFloat(canisterDepth.geo_pct) || 0) * 100) },
      { field: 'Offering', pct: Math.round((parseFloat(canisterDepth.offering_pct) || 0) * 100) },
      { field: 'Focus text', pct: Math.round((parseFloat(canisterDepth.focus_pct) || 0) * 100) },
      { field: 'Context', pct: Math.round((parseFloat(canisterDepth.context_pct) || 0) * 100) },
      { field: 'Deal details', pct: Math.round((parseFloat(canisterDepth.deal_pct) || 0) * 100) }
    ];

    res.json({
      network: network,
      funnel: funnel,
      scoreAcceptance: scoreAcceptance,
      archetypePairs: archetypePairs.map(function(a) {
        return {
          pair: a.pair,
          matches: parseInt(a.matches),
          acceptRate: parseFloat(a.accept_rate) || 0,
          revealRate: parseFloat(a.reveal_rate) || 0,
          avgScore: parseFloat(a.avg_score) || 0
        };
      }),
      acceptanceByType: acceptanceByType,
      supplyDemand: supplyDemand,
      intentGaps: intentGaps,
      eventScorecard: eventScorecard,
      growth: growth,
      canisterDepth: canister
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard', detail: err.message });
  }
});

// ── GET /api/admin/dashboard/event/:id — single event drill-down ──
router.get('/dashboard/event/:id', authenticateToken, function(req, res, next) { if (req.user.id != 2) return res.status(403).json({ error: 'Admin only' }); next(); }, async function(req, res) {
  try {
    var eventId = parseInt(req.params.id);

    var event = await dbGet('SELECT * FROM events WHERE id = $1', [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    var regs = await dbGet("SELECT COUNT(*) as c FROM event_registrations WHERE event_id = $1 AND status = 'active'", [eventId]);
    var matches = await dbGet('SELECT COUNT(*) as c FROM event_matches WHERE event_id = $1', [eventId]);
    var accepted = await dbGet("SELECT COUNT(*) as c FROM event_matches WHERE event_id = $1 AND (user_a_decision='accept' OR user_b_decision='accept')", [eventId]);
    var revealed = await dbGet("SELECT COUNT(*) as c FROM event_matches WHERE event_id = $1 AND status = 'revealed'", [eventId]);
    var avgScore = await dbGet('SELECT AVG(score_total) as avg FROM event_matches WHERE event_id = $1 AND score_total > 0', [eventId]);

    // Stakeholder breakdown for this event
    var stakeholders = await dbAll(`
      SELECT sp.stakeholder_type, COUNT(DISTINCT sp.user_id) as count
      FROM event_registrations er
      JOIN stakeholder_profiles sp ON sp.user_id = er.user_id
      WHERE er.event_id = $1 AND er.status = 'active' AND sp.stakeholder_type IS NOT NULL
      GROUP BY sp.stakeholder_type
      ORDER BY COUNT(*) DESC
    `, [eventId]);

    // Theme breakdown for this event
    var themes = await dbAll(`
      SELECT theme.val as theme, COUNT(DISTINCT sp.user_id) as count
      FROM event_registrations er
      JOIN stakeholder_profiles sp ON sp.user_id = er.user_id,
      LATERAL jsonb_array_elements_text(sp.themes) as theme(val)
      WHERE er.event_id = $1 AND er.status = 'active'
      GROUP BY theme.val
      ORDER BY COUNT(*) DESC
    `, [eventId]);

    res.json({
      event: { id: event.id, name: event.name, date: event.event_date, city: event.city, country: event.country },
      regs: parseInt(regs.c),
      matches: parseInt(matches.c),
      accepted: parseInt(accepted.c),
      revealed: parseInt(revealed.c),
      avgScore: parseFloat(avgScore.avg) || 0,
      stakeholders: stakeholders.map(function(s) { return { type: s.stakeholder_type, count: parseInt(s.count) }; }),
      themes: themes.map(function(t) { return { theme: t.theme, count: parseInt(t.count) }; })
    });
  } catch (err) {
    console.error('Event dashboard error:', err);
    res.status(500).json({ error: 'Failed to load event dashboard' });
  }
});

module.exports = { router: router };
