var express = require('express');
var { dbAll, dbGet } = require('../db');
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

module.exports = router;
