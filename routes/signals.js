var express = require('express');
var { dbGet, dbRun, dbAll } = require('../db');
var { authenticateToken } = require('../middleware/auth');
var { normalizeTheme, normalizeThemes } = require('../lib/theme_taxonomy');
var { embedSignal, embedSignalsBatch, searchSignalsByThemes } = require('../lib/vector_search');

var router = express.Router();

// ── POST /api/signals/ingest ── (ingest a single signal from any source)
router.post('/ingest', async function(req, res) {
  try {
    var s = req.body;

    if (!s.source_type) {
      return res.status(400).json({ error: 'source_type required' });
    }

    // Normalize themes
    var theme = s.theme ? normalizeTheme(s.theme) : null;
    var themesArr = s.themes ? normalizeThemes(s.themes) : [];
    if (theme && themesArr.indexOf(theme) === -1) themesArr.push(theme);

    // Cost and constraint inference based on source type
    var costMap = {
      'regulatory': 'high', 'sec_filing': 'high', 'corporate': 'high',
      'venture': 'high', 'funding': 'high', 'patent': 'high',
      'hiring': 'medium', 'event': 'medium', 'podcast': 'medium',
      'news': 'low', 'pr': 'low', 'social': 'low', 'blog': 'low'
    };
    var costOfSignal = s.cost_of_signal || costMap[s.source_type] || 'low';

    var constraintMap = {
      'regulatory': 'high', 'sec_filing': 'high',
      'corporate': 'medium', 'venture': 'medium',
      'podcast': 'low', 'news': 'low', 'pr': 'low', 'social': 'low'
    };
    var constraintLevel = s.constraint_level || constraintMap[s.source_type] || 'low';

    // Source weight by type (high-cost signals outweigh low-cost ones)
    var sourceWeightMap = {
      'sec_filing': 2.0, 'regulatory': 2.0, 'venture': 1.8, 'funding': 1.8,
      'corporate': 1.5, 'patent': 1.5, 'hiring': 1.3, 'event': 1.2,
      'podcast': 1.0, 'news': 0.8, 'pr': 0.6, 'social': 0.5, 'blog': 0.5
    };
    var sourceWeight = s.source_weight || sourceWeightMap[s.source_type] || 1.0;

    // Recency weight (decay over 90 days)
    var recencyWeight = 1.0;
    if (s.signal_date) {
      var age = (Date.now() - new Date(s.signal_date).getTime()) / (1000 * 60 * 60 * 24);
      recencyWeight = Math.max(0.2, 1.0 - (age / 90) * 0.8);
    }

    var finalWeight = (s.base_weight || 1.0) * sourceWeight * recencyWeight;

    var result = await dbRun(
      `INSERT INTO unified_signals (
        source_type, source_id, source_table, source_url,
        entity_type, entity_name, entity_id, entities_json,
        theme, themes_json, theme_confidence,
        signal_type, signal_text, signal_summary,
        sentiment, sentiment_score,
        geography, country, city,
        cost_of_signal, constraint_level,
        independence_score, is_derivative,
        base_weight, source_weight, recency_weight, final_weight,
        dollar_amount, dollar_unit,
        lifecycle_stage, signal_date
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31
      ) RETURNING *`,
      [
        s.source_type, s.source_id || null, s.source_table || null, s.source_url || null,
        s.entity_type || null, s.entity_name || null, s.entity_id || null,
        JSON.stringify(s.entities || []),
        theme, JSON.stringify(themesArr), s.theme_confidence || 0.0,
        s.signal_type || null, s.signal_text || null, s.signal_summary || null,
        s.sentiment || null, s.sentiment_score || null,
        s.geography || null, s.country || null, s.city || null,
        costOfSignal, constraintLevel,
        s.independence_score || 0.5, s.is_derivative || false,
        s.base_weight || 1.0, sourceWeight, recencyWeight, finalWeight,
        s.dollar_amount || null, s.dollar_unit || null,
        s.lifecycle_stage || 'unknown', s.signal_date || null
      ]
    );

    var signal = result.rows[0];

    // Resolve to canonical entity if entity_name provided
    if (s.entity_name) {
      resolveEntity(s.entity_type || 'company', s.entity_name, signal.id).catch(function(err) {
        console.error('Entity resolution error:', err);
      });
    }

    // Embed in Qdrant (async)
    embedSignal(signal).catch(function(err) {
      console.error('Signal embedding error:', err);
    });

    res.json({ signal: signal });
  } catch (err) {
    console.error('Signal ingest error:', err);
    res.status(500).json({ error: 'Failed to ingest signal' });
  }
});

// ── POST /api/signals/ingest-batch ── (ingest multiple signals)
router.post('/ingest-batch', async function(req, res) {
  try {
    var signals = req.body.signals;
    if (!signals || !Array.isArray(signals) || !signals.length) {
      return res.status(400).json({ error: 'signals array required' });
    }

    var inserted = [];
    for (var i = 0; i < signals.length; i++) {
      var s = signals[i];
      if (!s.source_type) continue;

      var theme = s.theme ? normalizeTheme(s.theme) : null;
      var themesArr = s.themes ? normalizeThemes(s.themes) : [];
      if (theme && themesArr.indexOf(theme) === -1) themesArr.push(theme);

      var sourceWeightMap = {
        'sec_filing': 2.0, 'regulatory': 2.0, 'venture': 1.8, 'funding': 1.8,
        'corporate': 1.5, 'patent': 1.5, 'hiring': 1.3, 'event': 1.2,
        'podcast': 1.0, 'news': 0.8, 'pr': 0.6, 'social': 0.5
      };
      var sourceWeight = sourceWeightMap[s.source_type] || 1.0;

      var recencyWeight = 1.0;
      if (s.signal_date) {
        var age = (Date.now() - new Date(s.signal_date).getTime()) / (1000 * 60 * 60 * 24);
        recencyWeight = Math.max(0.2, 1.0 - (age / 90) * 0.8);
      }

      var costMap = {
        'regulatory': 'high', 'sec_filing': 'high', 'corporate': 'high',
        'venture': 'high', 'funding': 'high',
        'hiring': 'medium', 'event': 'medium', 'podcast': 'medium',
        'news': 'low', 'pr': 'low', 'social': 'low'
      };

      var result = await dbRun(
        `INSERT INTO unified_signals (
          source_type, source_id, source_url,
          entity_type, entity_name, entities_json,
          theme, themes_json, theme_confidence,
          signal_type, signal_text, signal_summary,
          sentiment, sentiment_score,
          geography, country, city,
          cost_of_signal, constraint_level,
          independence_score, is_derivative,
          source_weight, recency_weight, final_weight,
          dollar_amount, dollar_unit,
          lifecycle_stage, signal_date
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27, $28
        ) RETURNING *`,
        [
          s.source_type, s.source_id || null, s.source_url || null,
          s.entity_type || null, s.entity_name || null, JSON.stringify(s.entities || []),
          theme, JSON.stringify(themesArr), s.theme_confidence || 0.0,
          s.signal_type || null, s.signal_text || null, s.signal_summary || null,
          s.sentiment || null, s.sentiment_score || null,
          s.geography || null, s.country || null, s.city || null,
          costMap[s.source_type] || 'low', s.constraint_level || 'low',
          s.independence_score || 0.5, s.is_derivative || false,
          sourceWeight, recencyWeight, sourceWeight * recencyWeight,
          s.dollar_amount || null, s.dollar_unit || null,
          s.lifecycle_stage || 'unknown', s.signal_date || null
        ]
      );
      inserted.push(result.rows[0]);
    }

    // Batch embed all inserted signals
    var embeddedCount = await embedSignalsBatch(inserted);

    // Resolve entities (async)
    inserted.forEach(function(sig) {
      if (sig.entity_name) {
        resolveEntity(sig.entity_type || 'company', sig.entity_name, sig.id).catch(function() {});
      }
    });

    res.json({ inserted: inserted.length, embedded: embeddedCount });
  } catch (err) {
    console.error('Batch ingest error:', err);
    res.status(500).json({ error: 'Batch ingest failed' });
  }
});

// ── GET /api/signals/search ── (search signals by theme/entity)
router.get('/search', async function(req, res) {
  try {
    var { theme, entity, source_type, limit } = req.query;
    var conditions = [];
    var params = [];
    var idx = 1;

    if (theme) {
      conditions.push('(theme = $' + idx + ' OR themes_json::text ILIKE $' + (idx + 1) + ')');
      params.push(theme, '%' + theme + '%');
      idx += 2;
    }
    if (entity) {
      conditions.push('entity_name ILIKE $' + idx);
      params.push('%' + entity + '%');
      idx++;
    }
    if (source_type) {
      conditions.push('source_type = $' + idx);
      params.push(source_type);
      idx++;
    }

    var where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    var lim = parseInt(limit) || 50;

    var signals = await dbAll(
      'SELECT * FROM unified_signals' + where + ' ORDER BY final_weight DESC, signal_date DESC LIMIT $' + idx,
      params.concat([lim])
    );

    res.json({ signals: signals });
  } catch (err) {
    console.error('Signal search error:', err);
    res.status(500).json({ error: 'Signal search failed' });
  }
});

// ── GET /api/signals/semantic ── (vector search for signals by theme text)
router.get('/semantic', async function(req, res) {
  try {
    var { q, limit } = req.query;
    if (!q) return res.status(400).json({ error: 'Query q required' });

    var results = await searchSignalsByThemes([q], parseInt(limit) || 20);
    res.json({ results: results });
  } catch (err) {
    console.error('Semantic signal search error:', err);
    res.status(500).json({ error: 'Semantic search failed' });
  }
});

// ── Source-specific ingest helpers ──

// POST /api/signals/ingest/corporate — SEC filings
router.post('/ingest/corporate', async function(req, res) {
  try {
    var s = req.body;
    if (!s.ticker || !s.signal_type) {
      return res.status(400).json({ error: 'ticker and signal_type required' });
    }

    // Insert into corporate_signals
    var corp = await dbRun(
      `INSERT INTO corporate_signals (ticker, company_name, signal_type, theme, signal_text, source_type, source_date, dollar_amount, dollar_unit, confidence, segment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [s.ticker, s.company_name, s.signal_type, normalizeTheme(s.theme), s.signal_text,
       s.source_type || 'sec_filing', s.source_date, s.dollar_amount, s.dollar_unit,
       s.confidence || 0.8, s.segment || 'macro']
    );

    // Also push into unified_signals with high cost/constraint
    var unified = await dbRun(
      `INSERT INTO unified_signals (
        source_type, source_table, source_id,
        entity_type, entity_name,
        theme, themes_json, signal_type, signal_text,
        cost_of_signal, constraint_level,
        source_weight, final_weight,
        dollar_amount, dollar_unit,
        signal_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
      [
        'sec_filing', 'corporate_signals', String(corp.rows[0].id),
        'company', s.company_name || s.ticker,
        normalizeTheme(s.theme), JSON.stringify(s.themes ? normalizeThemes(s.themes) : []),
        s.signal_type, s.signal_text,
        'high', 'high',
        2.0, 2.0,
        s.dollar_amount, s.dollar_unit,
        s.source_date
      ]
    );

    // Embed the unified signal
    embedSignal(unified.rows[0]).catch(function(err) {
      console.error('Corporate signal embedding error:', err);
    });

    res.json({ corporate_signal: corp.rows[0], unified_signal: unified.rows[0] });
  } catch (err) {
    console.error('Corporate signal ingest error:', err);
    res.status(500).json({ error: 'Failed to ingest corporate signal' });
  }
});

// POST /api/signals/ingest/podcast — podcast episodes
router.post('/ingest/podcast', async function(req, res) {
  try {
    var s = req.body;

    // Upsert podcast source
    var source;
    if (s.podcast_name) {
      var existing = await dbGet('SELECT id FROM podcast_sources WHERE name = $1', [s.podcast_name]);
      if (existing) {
        source = existing;
      } else {
        var ins = await dbRun(
          'INSERT INTO podcast_sources (name, feed_url) VALUES ($1, $2) RETURNING id',
          [s.podcast_name, s.feed_url || null]
        );
        source = ins.rows[0];
      }
    }

    // Insert episode
    var episode = await dbRun(
      'INSERT INTO podcast_episodes (source_id, title, description, episode_url, published_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [source ? source.id : null, s.title, s.description, s.episode_url, s.published_at]
    );

    // Push into unified_signals
    var themesArr = s.themes ? normalizeThemes(s.themes) : [];
    var unified = await dbRun(
      `INSERT INTO unified_signals (
        source_type, source_table, source_id, source_url,
        entity_name, entities_json,
        theme, themes_json,
        signal_type, signal_text, signal_summary,
        cost_of_signal, constraint_level,
        source_weight, final_weight,
        signal_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
      [
        'podcast', 'podcast_episodes', String(episode.rows[0].id), s.episode_url,
        s.podcast_name, JSON.stringify(s.guests || []),
        themesArr[0] || null, JSON.stringify(themesArr),
        'commentary', s.signal_text || s.description, s.signal_summary || s.title,
        'medium', 'low',
        1.0, 1.0,
        s.published_at || null
      ]
    );

    embedSignal(unified.rows[0]).catch(function(err) {
      console.error('Podcast signal embedding error:', err);
    });

    res.json({ episode: episode.rows[0], unified_signal: unified.rows[0] });
  } catch (err) {
    console.error('Podcast ingest error:', err);
    res.status(500).json({ error: 'Failed to ingest podcast' });
  }
});

// POST /api/signals/ingest/news — news articles / PR
router.post('/ingest/news', async function(req, res) {
  try {
    var s = req.body;
    var themesArr = s.themes ? normalizeThemes(s.themes) : [];
    var isPR = s.is_pr || s.source_type === 'pr';

    var unified = await dbRun(
      `INSERT INTO unified_signals (
        source_type, source_url,
        entity_type, entity_name, entities_json,
        theme, themes_json, theme_confidence,
        signal_type, signal_text, signal_summary,
        sentiment, sentiment_score,
        geography, country, city,
        cost_of_signal, constraint_level,
        independence_score, is_derivative,
        source_weight, final_weight,
        dollar_amount, dollar_unit,
        lifecycle_stage, signal_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26) RETURNING *`,
      [
        isPR ? 'pr' : 'news', s.source_url,
        s.entity_type || null, s.entity_name || null, JSON.stringify(s.entities || []),
        themesArr[0] || null, JSON.stringify(themesArr), s.theme_confidence || 0.0,
        s.signal_type || 'coverage', s.signal_text, s.signal_summary || s.headline,
        s.sentiment || null, s.sentiment_score || null,
        s.geography || null, s.country || null, s.city || null,
        isPR ? 'low' : 'low', isPR ? 'low' : 'low',
        isPR ? 0.3 : 0.6, isPR || false,
        isPR ? 0.6 : 0.8, isPR ? 0.6 : 0.8,
        s.dollar_amount || null, s.dollar_unit || null,
        s.lifecycle_stage || 'unknown', s.signal_date || null
      ]
    );

    embedSignal(unified.rows[0]).catch(function(err) {
      console.error('News signal embedding error:', err);
    });

    res.json({ signal: unified.rows[0] });
  } catch (err) {
    console.error('News ingest error:', err);
    res.status(500).json({ error: 'Failed to ingest news signal' });
  }
});

// POST /api/signals/ingest/venture — funding rounds
router.post('/ingest/venture', async function(req, res) {
  try {
    var s = req.body;
    var themesArr = s.themes ? normalizeThemes(s.themes) : [];

    var unified = await dbRun(
      `INSERT INTO unified_signals (
        source_type, source_url,
        entity_type, entity_name, entities_json,
        theme, themes_json,
        signal_type, signal_text, signal_summary,
        geography, country, city,
        cost_of_signal, constraint_level,
        source_weight, final_weight,
        dollar_amount, dollar_unit,
        lifecycle_stage, signal_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING *`,
      [
        'venture', s.source_url,
        'company', s.company_name, JSON.stringify(s.investors || []),
        themesArr[0] || null, JSON.stringify(themesArr),
        s.round_type || 'funding', s.signal_text, s.signal_summary || (s.company_name + ' ' + (s.round_type || 'funding')),
        s.geography || null, s.country || null, s.city || null,
        'high', 'medium',
        1.8, 1.8,
        s.amount || null, s.currency || 'USD',
        s.lifecycle_stage || 'emerging', s.signal_date || null
      ]
    );

    embedSignal(unified.rows[0]).catch(function(err) {
      console.error('Venture signal embedding error:', err);
    });

    res.json({ signal: unified.rows[0] });
  } catch (err) {
    console.error('Venture ingest error:', err);
    res.status(500).json({ error: 'Failed to ingest venture signal' });
  }
});

// ── Entity Resolution Helper ──

async function resolveEntity(entityType, name, signalId) {
  if (!name) return null;

  var canonical = name.trim();
  // Try to find existing entity
  var entity = await dbGet(
    `SELECT id FROM entities
     WHERE entity_type = $1 AND (canonical_name = $2 OR aliases::text ILIKE $3)`,
    [entityType, canonical, '%' + canonical + '%']
  );

  if (!entity) {
    // Create new entity
    var result = await dbRun(
      'INSERT INTO entities (entity_type, canonical_name) VALUES ($1, $2) ON CONFLICT (entity_type, canonical_name) DO NOTHING RETURNING id',
      [entityType, canonical]
    );
    if (result.rows.length) {
      entity = result.rows[0];
    } else {
      entity = await dbGet('SELECT id FROM entities WHERE entity_type = $1 AND canonical_name = $2', [entityType, canonical]);
    }
  }

  // Link signal to entity
  if (entity && signalId) {
    await dbRun(
      'UPDATE unified_signals SET entity_id = $1 WHERE id = $2',
      [String(entity.id), signalId]
    );
  }

  return entity ? entity.id : null;
}

module.exports = { router, resolveEntity };
