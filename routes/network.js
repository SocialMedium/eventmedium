var express = require('express');
var { dbAll, dbGet } = require('../db');
var { authenticateToken } = require('../middleware/auth');
var { getCanonicalThemes } = require('../lib/theme_taxonomy');
var { getCityCoords } = require('../lib/geocode');
var router = express.Router();

function safeJson(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch(e) { return []; } }
  return [];
}

function firstCity(geo) {
  if (!geo) return null;
  return geo.split(',')[0].trim();
}

// ── GET /api/network/graph-data ── aggregated network visualisation data ──────
router.get('/graph-data', authenticateToken, async function(req, res) {
  try {
    var canonicalThemes = getCanonicalThemes();
    var communityId = req.query.community_id ? parseInt(req.query.community_id) : null;

    // Community filter clause for stakeholder_profiles queries
    var communityFilter = '';
    var communityParams = [];
    if (communityId) {
      communityFilter = ' AND sp.user_id IN (SELECT user_id FROM event_registrations WHERE event_id = $1)';
      communityParams = [communityId];
    }

    var queries = [
      // Stats — filtered when community selected
      communityId
        ? dbGet('SELECT COUNT(DISTINCT sp.user_id) AS count FROM stakeholder_profiles sp WHERE sp.user_id IN (SELECT user_id FROM event_registrations WHERE event_id = $1)', [communityId])
        : dbGet('SELECT COUNT(DISTINCT user_id) AS count FROM stakeholder_profiles'),
      communityId
        ? dbGet('SELECT 1 AS count')
        : dbGet('SELECT COUNT(*) AS count FROM events'),
      communityId
        ? dbGet("SELECT COUNT(*) AS count FROM event_matches WHERE status = 'accepted' AND event_id = $1", [communityId])
        : dbGet("SELECT COUNT(*) AS count FROM event_matches WHERE status = 'accepted'"),
      communityId
        ? dbGet('SELECT COUNT(*) AS count FROM match_feedback mf JOIN event_matches em ON em.id = mf.match_id WHERE mf.did_meet = true AND em.event_id = $1', [communityId])
        : dbGet('SELECT COUNT(*) AS count FROM match_feedback WHERE did_meet = true'),
      // Themes — filtered
      dbAll('SELECT themes FROM stakeholder_profiles sp WHERE themes IS NOT NULL' + communityFilter, communityParams),
      // Stakeholder types — filtered
      dbAll('SELECT sp.stakeholder_type, COUNT(*) as count FROM stakeholder_profiles sp WHERE sp.stakeholder_type IS NOT NULL' + communityFilter + ' GROUP BY sp.stakeholder_type', communityParams),
      // Global geo nodes — filtered
      dbAll('SELECT sp.geography, COUNT(*) AS canister_count, array_agg(DISTINCT sp.stakeholder_type) AS types FROM stakeholder_profiles sp WHERE sp.geography IS NOT NULL AND sp.geography != \'\'' + communityFilter + ' GROUP BY sp.geography ORDER BY canister_count DESC', communityParams),
      // User's communities (always unfiltered — for the dropdown)
      dbAll('SELECT e.id, e.name FROM event_registrations er JOIN events e ON e.id = er.event_id WHERE er.user_id = $1 ORDER BY e.name ASC', [req.user.id])
    ];

    var [canisterRow, eventRow, matchRow, meetingRow, themeRows, stakeholderRows, globalGeoRows, myCommunitiesRows] = await Promise.all(queries);

    // Stats
    var stats = {
      canisters: parseInt(canisterRow.count) || 0,
      events: communityId ? 1 : (parseInt(eventRow.count) || 0),
      matches: parseInt(matchRow.count) || 0,
      meetings: parseInt(meetingRow.count) || 0
    };

    // Theme frequency from JSONB arrays
    var themeFreq = {};
    canonicalThemes.forEach(function(t) { themeFreq[t] = 0; });
    themeRows.forEach(function(row) {
      var arr = safeJson(row.themes);
      arr.forEach(function(t) {
        if (themeFreq.hasOwnProperty(t)) themeFreq[t]++;
      });
    });
    var themes = canonicalThemes.map(function(t) { return { name: t, count: themeFreq[t] }; })
      .sort(function(a, b) { return b.count - a.count; });

    // Stakeholder breakdown
    var stakeholders = stakeholderRows.map(function(r) {
      return { type: r.stakeholder_type || 'other', count: parseInt(r.count) || 0 };
    });

    // Geo nodes with coords
    var globalNodes = globalGeoRows.map(function(r) {
      var label = firstCity(r.geography);
      var coords = getCityCoords(label);
      return {
        label: label,
        canister_count: parseInt(r.canister_count) || 0,
        lat: coords ? coords[0] : null,
        lng: coords ? coords[1] : null,
        types: (r.types || []).filter(Boolean)
      };
    }).filter(function(n) { return n.label; });

    // Communities for dropdown
    var myCommunities = myCommunitiesRows.map(function(r) {
      return { id: r.id, name: r.name };
    });

    res.json({
      stats: stats,
      themes: themes,
      stakeholders: stakeholders,
      globalNodes: globalNodes,
      myCommunities: myCommunities
    });
  } catch(err) {
    console.error('[Network] graph-data error:', err);
    res.status(500).json({ error: 'Failed to load network data' });
  }
});

// ── GET /api/network/graph ────────────────────────────────────────────────────
router.get('/graph', async function(req, res) {
  try {

    // Members — users with geography, with event + match counts
    var memberRows = await dbAll(`
      SELECT
        u.id,
        sp.stakeholder_type,
        sp.geography,
        sp.themes,
        u.company,
        COUNT(DISTINCT er.event_id)                                          AS event_count,
        COUNT(DISTINCT CASE WHEN em.status = 'revealed' THEN em.id END)     AS match_count
      FROM users u
      JOIN stakeholder_profiles sp ON sp.user_id = u.id
      LEFT JOIN event_registrations er ON er.user_id = u.id AND er.status = 'active'
      LEFT JOIN event_matches em
             ON (em.user_a_id = u.id OR em.user_b_id = u.id)
      WHERE sp.geography IS NOT NULL AND sp.geography <> ''
      GROUP BY u.id, sp.stakeholder_type, sp.geography, sp.themes, u.company
    `);

    var members = memberRows.map(function(r) {
      return {
        id:               r.id,
        type:             'member',
        stakeholder_type: r.stakeholder_type || 'other',
        geography:        firstCity(r.geography),
        themes:           safeJson(r.themes),
        company:          r.company || null,
        event_count:      parseInt(r.event_count)  || 0,
        match_count:      parseInt(r.match_count)  || 0,
        avatar_url:       null
      };
    }).filter(function(m) { return m.geography; });

    // Events — with registration + match counts
    var eventRows = await dbAll(`
      SELECT
        e.id, e.name, e.slug, e.event_date, e.city, e.country, e.themes,
        COUNT(DISTINCT er.id)                                              AS registered_count,
        COUNT(DISTINCT em.id)                                              AS match_count,
        COUNT(DISTINCT CASE WHEN em.status = 'revealed' THEN em.id END)   AS revealed_count
      FROM events e
      LEFT JOIN event_registrations er ON er.event_id = e.id AND er.status = 'active'
      LEFT JOIN event_matches em ON em.event_id = e.id
      WHERE e.city IS NOT NULL
      GROUP BY e.id, e.name, e.slug, e.event_date, e.city, e.country, e.themes
      ORDER BY e.event_date DESC
      LIMIT 50
    `);

    var events = eventRows.map(function(r) {
      return {
        id:               r.id,
        type:             'event',
        name:             r.name,
        slug:             r.slug || null,
        event_date:       r.event_date,
        city:             r.city,
        country:          r.country || null,
        themes:           safeJson(r.themes),
        registered_count: parseInt(r.registered_count) || 0,
        match_count:      parseInt(r.match_count)       || 0,
        revealed_count:   parseInt(r.revealed_count)    || 0
      };
    });

    // Corridors — cross-city match flows
    var corridorRows = await dbAll(`
      SELECT
        LEAST(    SPLIT_PART(spa.geography, ',', 1),
                  SPLIT_PART(spb.geography, ',', 1))          AS city_a,
        GREATEST( SPLIT_PART(spa.geography, ',', 1),
                  SPLIT_PART(spb.geography, ',', 1))          AS city_b,
        COUNT(*)                                               AS match_count,
        AVG(em.score_total)                                    AS avg_score,
        AVG(CASE WHEN em.status = 'revealed' THEN 1.0 ELSE 0.0 END) AS reveal_rate
      FROM event_matches em
      JOIN stakeholder_profiles spa ON spa.user_id = em.user_a_id
      JOIN stakeholder_profiles spb ON spb.user_id = em.user_b_id
      WHERE spa.geography IS NOT NULL AND spb.geography IS NOT NULL
        AND SPLIT_PART(spa.geography, ',', 1) <> SPLIT_PART(spb.geography, ',', 1)
      GROUP BY city_a, city_b
      HAVING COUNT(*) >= 2
      ORDER BY match_count DESC
      LIMIT 40
    `);

    var corridors = corridorRows.map(function(r) {
      return {
        from:        (r.city_a || '').trim(),
        to:          (r.city_b || '').trim(),
        match_count: parseInt(r.match_count)         || 0,
        avg_score:   Math.round((parseFloat(r.avg_score)    || 0) * 100) / 100,
        reveal_rate: Math.round((parseFloat(r.reveal_rate)  || 0) * 100) / 100
      };
    }).filter(function(c) { return c.from && c.to && c.from !== c.to; });

    // Geo clusters — built in JS from members + events
    var cityMap = {};
    members.forEach(function(m) {
      var city = m.geography;
      if (!cityMap[city]) cityMap[city] = { city: city, member_count: 0, event_count: 0, theme_freq: {}, arc_freq: {}, total_matches: 0 };
      var c = cityMap[city];
      c.member_count++;
      c.total_matches += m.match_count;
      if (m.stakeholder_type) c.arc_freq[m.stakeholder_type] = (c.arc_freq[m.stakeholder_type] || 0) + 1;
      m.themes.forEach(function(t) { c.theme_freq[t] = (c.theme_freq[t] || 0) + 1; });
    });
    events.forEach(function(e) {
      var city = e.city;
      if (!cityMap[city]) cityMap[city] = { city: city, member_count: 0, event_count: 0, theme_freq: {}, arc_freq: {}, total_matches: 0 };
      cityMap[city].event_count++;
    });

    var geo_clusters = Object.values(cityMap).map(function(c) {
      return {
        city:          c.city,
        member_count:  c.member_count,
        event_count:   c.event_count,
        top_themes:    Object.keys(c.theme_freq)
                         .sort(function(a,b){ return c.theme_freq[b] - c.theme_freq[a]; }).slice(0, 5)
                         .map(function(t){ return { theme: t, count: c.theme_freq[t] }; }),
        archetype_breakdown: Object.keys(c.arc_freq)
                         .sort(function(a,b){ return c.arc_freq[b] - c.arc_freq[a]; })
                         .map(function(t){ return { type: t, count: c.arc_freq[t] }; }),
        total_matches: c.total_matches
      };
    }).filter(function(c) { return c.member_count > 0 || c.event_count > 0; })
      .sort(function(a,b) { return b.member_count - a.member_count; });

    res.json({
      members:      members,
      events:       events,
      corridors:    corridors,
      geo_clusters: geo_clusters,
      meta: {
        total_members:    members.length,
        total_events:     events.length,
        total_corridors:  corridors.length,
        generated_at:     new Date().toISOString()
      }
    });

  } catch(err) {
    console.error('[Network] Graph error:', err);
    res.status(500).json({ error: 'Failed to load network graph' });
  }
});

// ── GET /api/network/my-network ── all users, tagged by relationship ──────────
router.get('/my-network', authenticateToken, async function(req, res) {
  try {
    var myId = req.user.id;

    // Self node
    var self = await dbGet(
      "SELECT u.id, u.name, u.avatar_url, u.city_lat, u.city_lng, sp.stakeholder_type, sp.emc2_cohort, sp.emc2_cohort_number, sp.og_member, sp.emc2_lifetime_earned, sp.themes, sp.geography FROM users u JOIN stakeholder_profiles sp ON sp.user_id = u.id WHERE u.id = $1",
      [myId]
    );
    if (!self) return res.json({ success: true, self: null, nodes: [], edges: [] });

    // My direct matches
    var matchRows = await dbAll(
      "SELECT DISTINCT CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END as connected_id, id as match_id, score_total, status FROM event_matches WHERE (user_a_id = $1 OR user_b_id = $1) AND status = 'revealed'",
      [myId]
    );
    var matchIdSet = {};
    matchRows.forEach(function(m) { matchIdSet[m.connected_id] = m; });

    // ALL platform users with a profile
    var allUsers = await dbAll(
      "SELECT u.id, u.city_lat, u.city_lng, sp.stakeholder_type, sp.emc2_cohort, sp.emc2_cohort_number, sp.og_member, sp.emc2_lifetime_earned, sp.themes, sp.geography FROM users u JOIN stakeholder_profiles sp ON sp.user_id = u.id WHERE u.id != $1 AND sp.stakeholder_type IS NOT NULL",
      [myId]
    );

    // Tag each node by relationship
    var nodes = allUsers.map(function(u) {
      var matchInfo = matchIdSet[u.id];
      return Object.assign({}, u, {
        node_type: matchInfo ? 'match' : 'network',
        confirmed: matchInfo ? true : false,
        match_score: matchInfo ? matchInfo.score_total : null,
        node_status: 'active'
      });
    });

    // Build edges only for direct matches
    var edges = matchRows.map(function(m) {
      return {
        source: myId,
        target: m.connected_id,
        type: 'match_confirmed',
        match_score: m.score_total
      };
    });

    res.json({
      success: true,
      self: Object.assign({}, self, { node_type: 'self' }),
      nodes: nodes,
      edges: edges
    });
  } catch (err) {
    console.error('[Network] my-network error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/network/communities ── community co-members ──────────────────────
router.get('/communities', authenticateToken, async function(req, res) {
  try {
    // User's communities
    var userCommunities = [];
    var coMembers = [];
    try {
      userCommunities = await dbAll(
        "SELECT c.id, c.name, c.slug FROM communities c JOIN community_members cm ON cm.community_id = c.id WHERE cm.user_id = $1",
        [req.user.id]
      );
      coMembers = await dbAll(
        "SELECT DISTINCT u.id, sp.stakeholder_type, sp.themes, sp.emc2_cohort, sp.geography, cm.community_id, c.name as community_name, 'community' as node_type FROM community_members cm JOIN communities c ON c.id = cm.community_id JOIN users u ON u.id = cm.user_id LEFT JOIN stakeholder_profiles sp ON sp.user_id = u.id WHERE cm.community_id IN (SELECT community_id FROM community_members WHERE user_id = $1) AND cm.user_id != $1 AND sp.stakeholder_type IS NOT NULL",
        [req.user.id]
      );
    } catch(e) {
      // communities/community_members tables may not exist
      console.warn('[Network] communities query error:', e.message);
    }

    res.json({
      success: true,
      communities: userCommunities,
      nodes: coMembers
    });
  } catch (err) {
    console.error('[Network] communities error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/network/global-stats ── aggregate network stats ──────────────────
router.get('/global-stats', authenticateToken, async function(req, res) {
  try {
    var stats = await dbGet(
      "SELECT COUNT(*) as total_canisters, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as added_today, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as added_this_week FROM stakeholder_profiles WHERE stakeholder_type IS NOT NULL"
    );

    // Geography clusters (anonymised aggregate, min 3 nodes)
    var clusters = [];
    try {
      clusters = await dbAll(
        "SELECT SPLIT_PART(sp.geography, ',', 1) as city, sp.stakeholder_type, COUNT(*) as node_count FROM stakeholder_profiles sp WHERE sp.geography IS NOT NULL AND sp.geography != '' AND sp.stakeholder_type IS NOT NULL GROUP BY SPLIT_PART(sp.geography, ',', 1), sp.stakeholder_type HAVING COUNT(*) >= 3"
      );
    } catch(e) {
      console.warn('[Network] clusters query error:', e.message);
    }

    res.json({
      success: true,
      stats: {
        total_canisters: parseInt(stats.total_canisters) || 0,
        added_today: parseInt(stats.added_today) || 0,
        added_this_week: parseInt(stats.added_this_week) || 0
      },
      clusters: clusters
    });
  } catch (err) {
    console.error('[Network] global-stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
