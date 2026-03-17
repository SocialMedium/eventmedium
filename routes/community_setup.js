var express = require('express');
var router = express.Router();
var { dbGet, dbRun, dbAll } = require('../db');
var { authenticateToken } = require('../middleware/auth');

// Admin-only middleware using ADMIN_SECRET header
function adminAuth(req, res, next) {
  // Accept either session auth (userId 2) or ADMIN_SECRET header
  var secret = req.headers['x-admin-secret'];
  if (secret && secret === process.env.ADMIN_SECRET) return next();
  if (req.user && req.user.id === 2) return next();
  return res.status(403).json({ error: 'forbidden' });
}

// ── POST /run-community-intelligence-migration ──
router.post('/run-community-intelligence-migration', authenticateToken, adminAuth, async function(req, res) {
  try {
    var fs = require('fs');
    var path = require('path');
    var sql = fs.readFileSync(path.join(__dirname, '../scripts/community-setup/migrations/001_community_intelligence.sql'), 'utf8');
    var statements = sql.split(';').map(function(s) { return s.trim(); }).filter(Boolean);
    var results = [];

    for (var i = 0; i < statements.length; i++) {
      try {
        await dbRun(statements[i]);
        results.push({ index: i, status: 'ok' });
      } catch (err) {
        results.push({ index: i, status: 'error', message: err.message });
      }
    }

    res.json({ status: 'migration_complete', results: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /ingest-community ──
router.post('/ingest-community', authenticateToken, adminAuth, async function(req, res) {
  try {
    var { ingestCommunitySignals } = require('../scripts/community-setup/ingest');
    var config = req.body;
    if (!config.community_id || !config.label) {
      return res.status(400).json({ error: 'community_id and label required' });
    }
    var taxonomy = await ingestCommunitySignals(config);
    res.json({ status: 'ingested', taxonomy: taxonomy });
  } catch (err) {
    console.error('[admin] ingest error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /generate-test-profiles ──
router.post('/generate-test-profiles', authenticateToken, adminAuth, async function(req, res) {
  try {
    var { generateSyntheticProfiles } = require('../scripts/community-setup/generate_profiles');
    var { community_id, count, options } = req.body;
    if (!community_id || !count) {
      return res.status(400).json({ error: 'community_id and count required' });
    }
    // Run async, return immediately
    generateSyntheticProfiles(community_id, count, options || {}).then(function(result) {
      console.log('[admin] profile generation complete:', result);
    }).catch(function(err) {
      console.error('[admin] profile generation error:', err);
    });
    res.json({ status: 'started', message: 'Generating ' + count + ' profiles in background' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /run-test-matches ──
router.post('/run-test-matches', authenticateToken, adminAuth, async function(req, res) {
  try {
    var { runTestMatches } = require('../scripts/community-setup/run_matches');
    var testRunId = req.body.test_run_id;
    if (!testRunId) return res.status(400).json({ error: 'test_run_id required' });
    // Run async
    runTestMatches(testRunId).then(function(result) {
      console.log('[admin] test matches complete:', result);
    }).catch(function(err) {
      console.error('[admin] test matches error:', err);
    });
    res.json({ status: 'started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /evaluate-test-run ──
router.post('/evaluate-test-run', authenticateToken, adminAuth, async function(req, res) {
  try {
    var { evaluateMatchQuality } = require('../scripts/community-setup/evaluate_matches');
    var testRunId = req.body.test_run_id;
    if (!testRunId) return res.status(400).json({ error: 'test_run_id required' });
    evaluateMatchQuality(testRunId).then(function(result) {
      console.log('[admin] evaluation complete:', result);
    }).catch(function(err) {
      console.error('[admin] evaluation error:', err);
    });
    res.json({ status: 'started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /run-community-setup ── full orchestrated run
router.post('/run-community-setup', authenticateToken, adminAuth, async function(req, res) {
  try {
    var { runCommunitySetup } = require('../scripts/community-setup/orchestrate');
    var config = req.body;
    if (!config.community_id || !config.label || !config.community_profile_count) {
      return res.status(400).json({ error: 'community_id, label, and community_profile_count required' });
    }
    // Run async
    runCommunitySetup(config).then(function(result) {
      console.log('[admin] community setup complete:', result);
    }).catch(function(err) {
      console.error('[admin] community setup error:', err);
    });
    res.json({ status: 'started', message: 'Full community setup running in background' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /community-report/:id ── report data for the admin page
router.get('/community-report/:id', authenticateToken, adminAuth, async function(req, res) {
  try {
    var runId = req.params.id;
    var run = await dbGet('SELECT * FROM community_test_runs WHERE id = $1', [runId]);
    if (!run) return res.status(404).json({ error: 'Test run not found' });

    // Load taxonomy
    var taxonomy = await dbGet(
      'SELECT * FROM community_taxonomies WHERE community_id = $1 ORDER BY generated_at DESC LIMIT 1',
      [run.community_id]
    );

    // Parse JSONB fields
    if (taxonomy) {
      ['sector_distribution', 'theme_distribution', 'stakeholder_distribution',
       'career_stage_distribution', 'geography_clusters', 'values_language',
       'signal_sources', 'matching_weights'].forEach(function(field) {
        if (taxonomy[field] && typeof taxonomy[field] === 'string') {
          try { taxonomy[field] = JSON.parse(taxonomy[field]); } catch(e) {}
        }
      });
    }

    // Parse evaluation report
    var evaluation = null;
    if (run.evaluation_report) {
      try { evaluation = JSON.parse(run.evaluation_report); } catch(e) { evaluation = run.evaluation_report; }
    }

    // Parse weight recommendations
    if (run.weight_recommendations && typeof run.weight_recommendations === 'string') {
      try { run.weight_recommendations = JSON.parse(run.weight_recommendations); } catch(e) {}
    }

    res.json({
      test_run: run,
      taxonomy: taxonomy,
      evaluation: evaluation
    });
  } catch (err) {
    console.error('[admin] report error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /apply-weight-recommendations ──
router.post('/apply-weight-recommendations', authenticateToken, adminAuth, async function(req, res) {
  try {
    var testRunId = req.body.test_run_id;
    if (!testRunId) return res.status(400).json({ error: 'test_run_id required' });

    var run = await dbGet('SELECT * FROM community_test_runs WHERE id = $1', [testRunId]);
    if (!run) return res.status(404).json({ error: 'Test run not found' });

    var weights = run.weight_recommendations;
    if (typeof weights === 'string') {
      try { weights = JSON.parse(weights); } catch(e) { return res.status(400).json({ error: 'No valid weight recommendations' }); }
    }
    if (!weights) return res.status(400).json({ error: 'No weight recommendations found' });

    await dbRun(
      'UPDATE community_taxonomies SET matching_weights = $1, calibration_run_at = NOW(), calibration_notes = $2 WHERE community_id = $3 AND id = (SELECT id FROM community_taxonomies WHERE community_id = $3 ORDER BY generated_at DESC LIMIT 1)',
      [JSON.stringify(weights), 'Applied from test run ' + testRunId, run.community_id]
    );

    res.json({ status: 'weights_applied', weights: weights });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /cleanup-test-run ──
router.post('/cleanup-test-run', authenticateToken, adminAuth, async function(req, res) {
  try {
    var { cleanupTestRun } = require('../scripts/community-setup/cleanup');
    var testRunId = req.body.test_run_id;
    var confirm = req.body.confirm === true;
    if (!testRunId) return res.status(400).json({ error: 'test_run_id required' });

    var result = await cleanupTestRun(testRunId, confirm);
    res.json({ status: confirm ? 'cleaned_up' : 'dry_run', result: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
