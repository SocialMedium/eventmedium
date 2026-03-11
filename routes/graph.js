var express = require('express');
var { dbGet, dbAll } = require('../db');
var { authenticateToken } = require('../middleware/auth');

var router = express.Router();

function safeJson(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch(e) { return []; } }
  return [];
}

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).map(function(p) { return p[0] || ''; }).slice(0,2).join('').toUpperCase() || '?';
}

// ── GET /api/graph/me ──────────────────────────────────────────────────────────
router.get('/me', authenticateToken, async function(req, res) {
  try {
    var userId = req.user.id;
    var user = await dbGet('SELECT id, name FROM users WHERE id = $1', [userId]);
    var profile = await dbGet(
      'SELECT stakeholder_type, themes, geography FROM stakeholder_profiles WHERE user_id = $1',
      [userId]
    );

    var matches = await dbAll(`
      SELECT em.user_a_id, em.user_b_id, em.score_total, em.created_at,
        ua.name as name_a, ub.name as name_b,
        spa.stakeholder_type as type_a, spa.themes as themes_a,
        spb.stakeholder_type as type_b, spb.themes as themes_b
      FROM event_matches em
      JOIN users ua ON ua.id = em.user_a_id
      JOIN users ub ON ub.id = em.user_b_id
      LEFT JOIN stakeholder_profiles spa ON spa.user_id = em.user_a_id
      LEFT JOIN stakeholder_profiles spb ON spb.user_id = em.user_b_id
      WHERE (em.user_a_id = $1 OR em.user_b_id = $1)
      ORDER BY em.score_total DESC LIMIT 100
    `, [userId]);

    var nodes = [];
    var edges = [];
    var themeFreq = {};
    var seenUsers = new Set([String(userId)]);
    var myThemes = profile ? safeJson(profile.themes) : [];

    nodes.push({
      id: 'u' + userId,
      type: 'me',
      label: initials(user.name),
      stakeholder_type: profile ? profile.stakeholder_type : null,
      themes: myThemes,
      geography: profile ? profile.geography : null,
      size: 22
    });

    matches.forEach(function(m) {
      var isA = (m.user_a_id === userId);
      var otherId = isA ? m.user_b_id : m.user_a_id;
      var otherName = isA ? m.name_b : m.name_a;
      var otherType = isA ? m.type_b : m.type_a;
      var otherThemes = safeJson(isA ? m.themes_b : m.themes_a);
      var nid = 'u' + otherId;

      if (!seenUsers.has(String(otherId))) {
        seenUsers.add(String(otherId));
        nodes.push({
          id: nid,
          type: 'match',
          label: initials(otherName),
          stakeholder_type: otherType,
          themes: otherThemes.slice(0, 3),
          size: 12 + Math.round((m.score_total || 0.5) * 6)
        });
        edges.push({
          source: 'u' + userId,
          target: nid,
          strength: m.score_total || 0.5,
          type: 'match',
          age: m.created_at
        });
      }

      otherThemes.forEach(function(t) {
        if (myThemes.indexOf(t) !== -1) {
          themeFreq[t] = (themeFreq[t] || 0) + 1;
        }
      });
    });

    Object.keys(themeFreq).forEach(function(t) {
      nodes.push({ id: 'th_' + t, type: 'theme', label: t, theme: t, count: themeFreq[t], size: 14 + Math.min(themeFreq[t] * 2, 16) });
      edges.push({ source: 'u' + userId, target: 'th_' + t, strength: 0.3, type: 'theme' });
    });

    res.json({ nodes: nodes, edges: edges });
  } catch(err) {
    console.error('Graph me error:', err);
    res.status(500).json({ error: 'Failed to load graph' });
  }
});

// ── GET /api/graph/community/:id ───────────────────────────────────────────────
router.get('/community/:id', authenticateToken, async function(req, res) {
  try {
    var communityId = parseInt(req.params.id);
    var membership = await dbGet(
      'SELECT id FROM community_members WHERE community_id = $1 AND user_id = $2',
      [communityId, req.user.id]
    );
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    var members = await dbAll(`
      SELECT cm.user_id, cm.role,
        sp.stakeholder_type, sp.themes, sp.geography, sp.signal_strength
      FROM community_members cm
      LEFT JOIN stakeholder_profiles sp ON sp.user_id = cm.user_id
      WHERE cm.community_id = $1 LIMIT 200
    `, [communityId]);

    var nodes = [], edges = [];
    var themeFreq = {}, geoFreq = {};

    members.forEach(function(m) {
      var themes = safeJson(m.themes);
      nodes.push({
        id: 'u' + m.user_id,
        type: m.user_id === req.user.id ? 'me' : (m.role === 'owner' ? 'owner' : 'member'),
        label: m.user_id === req.user.id ? 'Me' : initials('?'),
        stakeholder_type: m.stakeholder_type,
        themes: themes.slice(0, 2),
        geography: m.geography,
        size: m.signal_strength ? Math.max(8, Math.min(20, 8 + m.signal_strength / 10)) : 10
      });
      themes.forEach(function(t) { themeFreq[t] = (themeFreq[t] || 0) + 1; });
      if (m.geography) {
        var city = m.geography.split(',')[0].trim();
        geoFreq[city] = (geoFreq[city] || 0) + 1;
      }
    });

    var topThemes = Object.keys(themeFreq)
      .sort(function(a, b) { return themeFreq[b] - themeFreq[a]; }).slice(0, 12);

    topThemes.forEach(function(t) {
      var tid = 'th_' + t;
      nodes.push({ id: tid, type: 'theme', label: t, theme: t, count: themeFreq[t], size: 14 + Math.min(themeFreq[t] * 2, 16) });
      members.forEach(function(m) {
        if (safeJson(m.themes).indexOf(t) !== -1) {
          edges.push({ source: 'u' + m.user_id, target: tid, strength: 0.4, type: 'theme' });
        }
      });
    });

    var topGeos = Object.keys(geoFreq)
      .sort(function(a, b) { return geoFreq[b] - geoFreq[a]; }).slice(0, 6);

    topGeos.forEach(function(g) {
      var gid = 'geo_' + g;
      nodes.push({ id: gid, type: 'geo', label: g, count: geoFreq[g], size: 18 });
      members.forEach(function(m) {
        if (m.geography && m.geography.split(',')[0].trim() === g) {
          edges.push({ source: 'u' + m.user_id, target: gid, strength: 0.2, type: 'geo' });
        }
      });
    });

    res.json({ nodes: nodes, edges: edges });
  } catch(err) {
    console.error('Graph community error:', err);
    res.status(500).json({ error: 'Failed to load graph' });
  }
});

// ── GET /api/graph/event/:id ───────────────────────────────────────────────────
router.get('/event/:id', authenticateToken, async function(req, res) {
  try {
    var eventId = parseInt(req.params.id);
    var reg = await dbGet(
      'SELECT id FROM event_registrations WHERE event_id = $1 AND user_id = $2 AND status = $3',
      [eventId, req.user.id, 'active']
    );
    var owner = await dbGet(
      'SELECT id FROM events WHERE id = $1 AND owner_user_id = $2',
      [eventId, req.user.id]
    );
    if (!reg && !owner) return res.status(403).json({ error: 'Access denied' });

    var registrants = await dbAll(`
      SELECT er.user_id, er.stakeholder_type, er.themes,
        sp.geography, sp.signal_strength
      FROM event_registrations er
      LEFT JOIN stakeholder_profiles sp ON sp.user_id = er.user_id
      WHERE er.event_id = $1 AND er.status = 'active' LIMIT 200
    `, [eventId]);

    var nodes = [], edges = [];
    var themeFreq = {}, geoFreq = {};

    registrants.forEach(function(r) {
      var themes = safeJson(r.themes);
      nodes.push({
        id: 'u' + r.user_id,
        type: r.user_id === req.user.id ? 'me' : 'member',
        label: r.user_id === req.user.id ? 'Me' : '·',
        stakeholder_type: r.stakeholder_type,
        themes: themes.slice(0, 2),
        geography: r.geography,
        size: r.signal_strength ? Math.max(8, Math.min(20, 8 + r.signal_strength / 10)) : 10
      });
      themes.forEach(function(t) { themeFreq[t] = (themeFreq[t] || 0) + 1; });
      if (r.geography) {
        var city = r.geography.split(',')[0].trim();
        geoFreq[city] = (geoFreq[city] || 0) + 1;
      }
    });

    var topThemes = Object.keys(themeFreq)
      .sort(function(a, b) { return themeFreq[b] - themeFreq[a]; }).slice(0, 12);

    topThemes.forEach(function(t) {
      var tid = 'th_' + t;
      nodes.push({ id: tid, type: 'theme', label: t, theme: t, count: themeFreq[t], size: 14 + Math.min(themeFreq[t] * 2, 16) });
      registrants.forEach(function(r) {
        if (safeJson(r.themes).indexOf(t) !== -1) {
          edges.push({ source: 'u' + r.user_id, target: tid, strength: 0.4, type: 'theme' });
        }
      });
    });

    var topGeos = Object.keys(geoFreq)
      .sort(function(a, b) { return geoFreq[b] - geoFreq[a]; }).slice(0, 6);

    topGeos.forEach(function(g) {
      var gid = 'geo_' + g;
      nodes.push({ id: gid, type: 'geo', label: g, count: geoFreq[g], size: 18 });
      registrants.forEach(function(r) {
        if (r.geography && r.geography.split(',')[0].trim() === g) {
          edges.push({ source: 'u' + r.user_id, target: gid, strength: 0.2, type: 'geo' });
        }
      });
    });

    res.json({ nodes: nodes, edges: edges });
  } catch(err) {
    console.error('Graph event error:', err);
    res.status(500).json({ error: 'Failed to load graph' });
  }
});

// ── GET /api/graph/global ──────────────────────────────────────────────────────
router.get('/global', authenticateToken, async function(req, res) {
  try {
    var themeRows = await dbAll(`
      SELECT theme, COUNT(*) as count
      FROM (SELECT jsonb_array_elements_text(themes) as theme FROM stakeholder_profiles WHERE themes IS NOT NULL) t
      GROUP BY theme ORDER BY count DESC
    `, []);

    var growthRows = await dbAll(`
      SELECT theme, COUNT(*) as count
      FROM (
        SELECT jsonb_array_elements_text(themes) as theme
        FROM stakeholder_profiles WHERE themes IS NOT NULL AND created_at > NOW() - INTERVAL '30 days'
      ) t GROUP BY theme
    `, []);
    var growthMap = {};
    growthRows.forEach(function(r) { growthMap[r.theme] = parseInt(r.count); });

    var coRows = await dbAll(`
      SELECT a.theme as theme_a, b.theme as theme_b, COUNT(*) as count
      FROM
        (SELECT user_id, jsonb_array_elements_text(themes) as theme FROM stakeholder_profiles WHERE themes IS NOT NULL) a
      JOIN
        (SELECT user_id, jsonb_array_elements_text(themes) as theme FROM stakeholder_profiles WHERE themes IS NOT NULL) b
        ON a.user_id = b.user_id AND a.theme < b.theme
      GROUP BY a.theme, b.theme HAVING COUNT(*) >= 2
      ORDER BY count DESC LIMIT 40
    `, []);

    var geoRows = await dbAll(`
      SELECT city, COUNT(*) as count FROM events
      WHERE city IS NOT NULL AND event_date > NOW() - INTERVAL '180 days'
      GROUP BY city ORDER BY count DESC LIMIT 10
    `, []);

    var statsRow = await dbGet(`
      SELECT
        (SELECT COUNT(*) FROM event_matches WHERE created_at > NOW() - INTERVAL '7 days') as matches_week,
        (SELECT COUNT(*) FROM stakeholder_profiles WHERE created_at > NOW() - INTERVAL '7 days') as new_canisters,
        (SELECT COUNT(*) FROM events WHERE event_date >= CURRENT_DATE) as active_events
    `, []);

    var themeNodes = themeRows.map(function(r) {
      return {
        id: 'th_' + r.theme, type: 'theme', label: r.theme, theme: r.theme,
        count: parseInt(r.count), growth: growthMap[r.theme] || 0,
        size: 18 + Math.min(parseInt(r.count) * 2, 30)
      };
    });

    var geoNodes = geoRows.map(function(r) {
      return { id: 'geo_' + r.city, type: 'geo', label: r.city, count: parseInt(r.count), size: 14 + Math.min(parseInt(r.count) * 3, 20) };
    });

    var coEdges = coRows.map(function(r) {
      return {
        source: 'th_' + r.theme_a, target: 'th_' + r.theme_b,
        strength: Math.min(1, parseInt(r.count) / 20), type: 'co', count: parseInt(r.count)
      };
    });

    res.json({
      nodes: themeNodes.concat(geoNodes),
      edges: coEdges,
      stats: {
        matches_week: parseInt(statsRow.matches_week) || 0,
        new_canisters: parseInt(statsRow.new_canisters) || 0,
        active_events: parseInt(statsRow.active_events) || 0
      }
    });
  } catch(err) {
    console.error('Graph global error:', err);
    res.status(500).json({ error: 'Failed to load graph' });
  }
});

// ── GET /api/graph/contexts ── communities + events for dropdown ───────────────
router.get('/contexts', authenticateToken, async function(req, res) {
  try {
    var communities = await dbAll(`
      SELECT c.id, c.name, 'community' as type FROM communities c
      JOIN community_members cm ON cm.community_id = c.id
      WHERE cm.user_id = $1 AND c.is_active = true ORDER BY c.name
    `, [req.user.id]);

    var events = await dbAll(`
      SELECT e.id, e.name, 'event' as type FROM events e
      JOIN event_registrations er ON er.event_id = e.id
      WHERE er.user_id = $1 AND er.status = 'active' AND e.event_date >= NOW() - INTERVAL '90 days'
      ORDER BY e.event_date DESC LIMIT 10
    `, [req.user.id]);

    res.json({ items: communities.concat(events) });
  } catch(err) {
    console.error('Graph contexts error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = { router: router };
