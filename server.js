require('dotenv').config();

var express = require('express');
var helmet = require('helmet');
var cors = require('cors');
var rateLimit = require('express-rate-limit');
var path = require('path');
var { pool } = require('./db');
var { initCollections } = require('./lib/vector_search');

var app = express();
app.set('trust proxy', 1);
var PORT = process.env.PORT || 3000;

// ── Security ──
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.APP_URL || 'http://localhost:3000',
  credentials: true
}));

// ── Rate limiting ──
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, try again later' }
}));

// ── Body parsing ──
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Static files ──
app.use(express.static(path.join(__dirname, 'public')));

// ── Health check ──
app.get('/health', async function(req, res) {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

// ── Routes ──

// Auth (email + session tokens)
app.use('/api/auth', require('./routes/auth').router);

// OAuth (Google + LinkedIn → session tokens, NEVER JWT)
app.use('/api/auth', require('./routes/oauth').router);

// Stakeholder profiles (canisters)
app.use('/api/stakeholder', require('./routes/stakeholder').router);

// Events
app.use('/api/events', require('./routes/events').router);

// Signals (ingestion, search, source-specific endpoints)
app.use('/api/signals', require('./routes/signals').router);

// Matching engine
app.use('/api/matches', require('./routes/matches').router);
app.use('/api/inbox', require('./routes/inbox_routes').router);
app.use('/api/communities', require('./routes/communities').router);

// Nev (AI concierge)
app.use('/api/nev', require('./routes/nev').router);

// Messaging
app.use('/api/messages', require('./routes/messages').router);

// Notifications
app.use('/api/notifications', require('./routes/notifications').router);

// EMC² (EventMedium Community Credit)
app.use('/api/emc2', require('./routes/emc2'));

app.use('/api/graph', require('./routes/graph').router);
app.use('/api/network', require('./routes/network'));
app.use('/api/admin', require('./routes/dashboard'));
app.use('/api/privacy', require('./routes/privacy'));
app.use('/api/documents', require('./routes/documents').router);
app.use('/api/admin', require('./routes/community_setup'));

// ── Landing page ──
app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// ── Community landing pages ──
app.get("/c/:slug", function(req, res) {
  res.sendFile(path.join(__dirname, "public", "community.html"));
});

// ── Schema migrations (safe to run on every startup) ──────────────────────────
async function runMigrations() {
  try {
    var { dbRun } = require('./db');
    await dbRun('ALTER TABLE event_matches ADD COLUMN IF NOT EXISTS community_id INTEGER REFERENCES communities(id)');
    await dbRun("ALTER TABLE communities ADD COLUMN IF NOT EXISTS comm_type TEXT DEFAULT 'open'");
    await dbRun("ALTER TABLE event_matches ADD COLUMN IF NOT EXISTS scope_type TEXT DEFAULT 'event'");
    await dbRun('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_global_match TIMESTAMP');
    await dbRun(`CREATE TABLE IF NOT EXISTS nev_messages (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      context JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await dbRun('CREATE INDEX IF NOT EXISTS nev_messages_user_id_idx ON nev_messages(user_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS nev_messages_created_at_idx ON nev_messages(created_at)');
    // Embedding pipeline columns
    await dbRun('ALTER TABLE stakeholder_profiles ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ');
    await dbRun('ALTER TABLE stakeholder_profiles ADD COLUMN IF NOT EXISTS qdrant_vector_id TEXT');
    // Match score columns
    await dbRun('ALTER TABLE event_matches ADD COLUMN IF NOT EXISTS score_intent_offering NUMERIC(5,3)');
    await dbRun('ALTER TABLE event_matches ADD COLUMN IF NOT EXISTS score_geography NUMERIC(5,3)');
    await dbRun('ALTER TABLE event_matches ADD COLUMN IF NOT EXISTS score_urgency NUMERIC(5,3)');
    await dbRun('ALTER TABLE event_matches ADD COLUMN IF NOT EXISTS score_canister_richness NUMERIC(5,3)');
    await dbRun('ALTER TABLE event_matches ADD COLUMN IF NOT EXISTS score_feedback_adjustment NUMERIC(5,3)');
    await dbRun('ALTER TABLE event_matches ADD COLUMN IF NOT EXISTS scoring_tier INTEGER DEFAULT 1');
    await dbRun("ALTER TABLE event_matches ADD COLUMN IF NOT EXISTS match_mode TEXT DEFAULT 'event'");
    // Event visibility for community events
    await dbRun('ALTER TABLE events ADD COLUMN IF NOT EXISTS community_id INTEGER REFERENCES communities(id)');
    await dbRun('ALTER TABLE events ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE');
    // Community intelligence tables
    await dbRun(`CREATE TABLE IF NOT EXISTS community_taxonomies (
      id SERIAL PRIMARY KEY, community_id INTEGER REFERENCES communities(id),
      generated_at TIMESTAMPTZ DEFAULT NOW(), sector_distribution JSONB, theme_distribution JSONB,
      stakeholder_distribution JSONB, career_stage_distribution JSONB, geography_clusters JSONB,
      values_language JSONB, signal_sources JSONB, raw_ingestion_summary TEXT,
      matching_weights JSONB, calibration_run_at TIMESTAMPTZ, calibration_notes TEXT
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS community_test_runs (
      id SERIAL PRIMARY KEY, community_id INTEGER REFERENCES communities(id),
      test_cohort_label VARCHAR(100), run_at TIMESTAMPTZ DEFAULT NOW(),
      profile_count INTEGER, match_count INTEGER, avg_match_score FLOAT,
      strong_match_pct FLOAT, moderate_match_pct FLOAT, thin_match_pct FLOAT,
      evaluator_score FLOAT, weight_recommendations JSONB, evaluation_report TEXT,
      status VARCHAR(50) DEFAULT 'running'
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS synthetic_test_users (
      id SERIAL PRIMARY KEY, test_run_id INTEGER REFERENCES community_test_runs(id),
      fake_user_id INTEGER, persona_brief TEXT, career_stage VARCHAR(50),
      canister_completeness FLOAT, is_event_subset BOOLEAN DEFAULT FALSE
    )`);
    // EMC² system tables
    await dbRun("DO $$ BEGIN CREATE TYPE emc2_action AS ENUM ('canister_complete','canister_quality_bonus','community_join','event_attend','match_accepted','match_confirmed','match_debrief','referral_complete','global_access_unlock','network_query_spend','founding_member_grant','community_owner_award','community_multiplier_bonus','admin_adjustment'); EXCEPTION WHEN duplicate_object THEN NULL; END $$");
    await dbRun(`CREATE TABLE IF NOT EXISTS emc2_ledger (
      id SERIAL PRIMARY KEY, tx_id UUID DEFAULT gen_random_uuid() NOT NULL UNIQUE,
      user_id INTEGER REFERENCES users(id) NOT NULL, wallet_address VARCHAR(255),
      amount INTEGER NOT NULL, action_type emc2_action NOT NULL,
      entity_id INTEGER, entity_type VARCHAR(50), balance_after INTEGER NOT NULL,
      metadata JSONB DEFAULT '{}', prev_tx_hash VARCHAR(64), tx_hash VARCHAR(64) UNIQUE,
      created_at TIMESTAMP DEFAULT NOW(), CONSTRAINT no_zero_amount CHECK (amount != 0)
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS emc2_wallets (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) UNIQUE,
      wallet_address VARCHAR(255), chain_id VARCHAR(50), connected_at TIMESTAMP,
      verified BOOLEAN DEFAULT FALSE, founding_member BOOLEAN DEFAULT FALSE,
      founding_member_granted_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS community_emc2_config (
      id SERIAL PRIMARY KEY, community_id INTEGER REFERENCES communities(id) UNIQUE,
      owner_award_pool INTEGER DEFAULT 0, multiplier_active BOOLEAN DEFAULT FALSE,
      multiplier_value NUMERIC(3,1) DEFAULT 1.0, multiplier_action emc2_action,
      multiplier_starts TIMESTAMP, multiplier_ends TIMESTAMP,
      founding_threshold INTEGER DEFAULT 50,
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await dbRun(`CREATE TABLE IF NOT EXISTS network_milestones (
      id SERIAL PRIMARY KEY, milestone INTEGER NOT NULL UNIQUE,
      reached_at TIMESTAMP, canister_count INTEGER,
      cascade_processed BOOLEAN DEFAULT FALSE
    )`);
    await dbRun("INSERT INTO network_milestones (milestone) VALUES (1000),(10000),(100000),(1000000),(10000000) ON CONFLICT (milestone) DO NOTHING");
    // emc2_ledger columns for chain anchoring
    await dbRun('ALTER TABLE emc2_ledger ADD COLUMN IF NOT EXISTS anchored_at TIMESTAMP');
    await dbRun('ALTER TABLE emc2_ledger ADD COLUMN IF NOT EXISTS anchor_tx_hash VARCHAR(64)');
    // stakeholder_profiles EMC² columns
    await dbRun('ALTER TABLE stakeholder_profiles ADD COLUMN IF NOT EXISTS emc2_balance INTEGER DEFAULT 0');
    await dbRun('ALTER TABLE stakeholder_profiles ADD COLUMN IF NOT EXISTS emc2_lifetime_earned INTEGER DEFAULT 0');
    await dbRun('ALTER TABLE stakeholder_profiles ADD COLUMN IF NOT EXISTS global_access_active BOOLEAN DEFAULT FALSE');
    await dbRun('ALTER TABLE stakeholder_profiles ADD COLUMN IF NOT EXISTS founding_member BOOLEAN DEFAULT FALSE');
    await dbRun('ALTER TABLE stakeholder_profiles ADD COLUMN IF NOT EXISTS founding_member_granted_at TIMESTAMP');
    await dbRun("ALTER TABLE stakeholder_profiles ADD COLUMN IF NOT EXISTS emc2_cohort VARCHAR(20)");
    await dbRun('ALTER TABLE stakeholder_profiles ADD COLUMN IF NOT EXISTS emc2_cohort_number INTEGER');
    await dbRun('ALTER TABLE stakeholder_profiles ADD COLUMN IF NOT EXISTS emc2_earn_multiplier NUMERIC(3,1) DEFAULT 1.0');
    await dbRun('ALTER TABLE stakeholder_profiles ADD COLUMN IF NOT EXISTS og_member BOOLEAN DEFAULT FALSE');
    // User geocoding columns
    await dbRun('ALTER TABLE users ADD COLUMN IF NOT EXISTS city_lat NUMERIC(9,6)');
    await dbRun('ALTER TABLE users ADD COLUMN IF NOT EXISTS city_lng NUMERIC(9,6)');
    // emc2_ledger indexes
    await dbRun('CREATE INDEX IF NOT EXISTS idx_emc2_ledger_user_id ON emc2_ledger(user_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_emc2_ledger_created_at ON emc2_ledger(created_at)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_emc2_ledger_action_type ON emc2_ledger(action_type)');
    console.log('[Migrations] Schema up to date');
  } catch(err) {
    console.error('[Migrations] Error:', err);
  }
}

async function backfillEMC2Corrections() {
  try {
    var emc2 = require('./lib/emc2.js');
    // Check if correction already applied for user 2
    var already = await dbRun("SELECT id FROM emc2_ledger WHERE user_id = 2 AND action_type = 'admin_adjustment' AND metadata->>'reason' = 'canister_complete_correction' LIMIT 1");
    if (already && already.rows && already.rows.length > 0) return;
    // Check user 2 has a canister_complete entry
    var original = await dbGet("SELECT tx_id FROM emc2_ledger WHERE user_id = 2 AND action_type = 'canister_complete' LIMIT 1");
    if (!original) return;
    // Issue correction for 900 difference
    await emc2.recordTransaction({
      user_id: 2,
      action_type: 'admin_adjustment',
      amount_override: 900,
      entity_type: 'correction',
      metadata: { reason: 'canister_complete_correction', original_tx_id: original.tx_id }
    });
    console.log('[EMC² backfill] Correction applied for user 2: +900');
    // Confirm OG status for user 2
    var profile = await dbGet('SELECT og_member FROM stakeholder_profiles WHERE user_id = 2');
    if (profile && !profile.og_member) {
      await dbRun('UPDATE stakeholder_profiles SET og_member = TRUE WHERE user_id = 2');
      console.log('[EMC² backfill] OG status granted to user 2');
    }
  } catch(err) {
    console.error('[EMC² backfill] Error:', err.message);
  }
}

async function geocodeUsers() {
  try {
    var { getCityCoords } = require('./lib/geocode.js');
    // Geocode from stakeholder_profiles.geography since users table has no city column
    var rows = await dbAll("SELECT sp.user_id, sp.geography FROM stakeholder_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.geography IS NOT NULL AND sp.geography != '' AND u.city_lat IS NULL");
    var geocoded = 0;
    for (var i = 0; i < rows.length; i++) {
      var city = rows[i].geography.split(',')[0].trim();
      var coords = getCityCoords(city);
      if (coords) {
        var lat = coords[0] + (Math.random() - 0.5) * 0.02;
        var lng = coords[1] + (Math.random() - 0.5) * 0.02;
        await dbRun('UPDATE users SET city_lat = $1, city_lng = $2 WHERE id = $3', [lat, lng, rows[i].user_id]);
        geocoded++;
      }
    }
    if (geocoded > 0) console.log('[Geocode] Geocoded ' + geocoded + ' users');
  } catch(err) {
    console.error('[Geocode] Error:', err.message);
  }
}

runMigrations().then(function() {
  backfillEMC2Corrections();
  geocodeUsers();
});

// ── Scheduled matching: 3x daily (8am, 1pm, 6pm UTC) ──────────────────────────
// node-cron is not installed — using setInterval with hour checking
function scheduleMatching() {
  var MATCH_HOURS = [8, 13, 18]; // UTC
  setInterval(async function() {
    var hour = new Date().getUTCHours();
    var minute = new Date().getUTCMinutes();
    if (MATCH_HOURS.indexOf(hour) === -1 || minute !== 0) return;
    console.log('[Scheduler] Running matching cycle at ' + new Date().toISOString());
    try {
      var { runEventMatching, runCommunityMatching, generateMatchesForUser } = require('./routes/matches');
      var db = require('./db');

      // 1. Event-scoped matches
      await runEventMatching().catch(function(e) { console.error('[Scheduler] runEventMatching error:', e.message); });

      // 2. Community-scoped matches
      await runCommunityMatching().catch(function(e) { console.error('[Scheduler] runCommunityMatching error:', e.message); });

      // 3. Location-scoped matches — city clusters of 3+ users
      var cityRows = await db.dbAll(
        "SELECT DISTINCT SPLIT_PART(geography, ',', 1) as city FROM stakeholder_profiles WHERE geography IS NOT NULL AND geography != ''"
      );
      for (var i = 0; i < cityRows.length; i++) {
        var city = (cityRows[i].city || '').trim();
        if (!city) continue;
        var cityUsers = await db.dbAll(
          "SELECT user_id FROM stakeholder_profiles WHERE geography ILIKE $1", [city + '%']
        );
        if (cityUsers.length < 3) continue;
        for (var j = 0; j < cityUsers.length; j++) {
          try { await generateMatchesForUser(cityUsers[j].user_id, { type: 'location', city: city }); } catch(e) {}
        }
        console.log('[Scheduler] Location ' + city + ': processed ' + cityUsers.length + ' users');
      }

      // 4. Global scope — users where last_global_match is null or >7 days AND other scopes are thin
      var globalCandidates = await db.dbAll(
        `SELECT u.id FROM users u JOIN stakeholder_profiles sp ON sp.user_id = u.id
         WHERE (u.last_global_match IS NULL OR u.last_global_match < NOW() - INTERVAL '7 days')
         AND sp.stakeholder_type IS NOT NULL AND sp.themes IS NOT NULL LIMIT 20`
      );
      for (var i = 0; i < globalCandidates.length; i++) {
        var uid = globalCandidates[i].id;
        try {
          var localCnt = await db.dbGet(
            "SELECT COUNT(*)::int as cnt FROM event_matches WHERE (user_a_id = $1 OR user_b_id = $1) AND scope_type IN ('event','community')",
            [uid]
          );
          if ((localCnt && localCnt.cnt || 0) < 3) {
            await generateMatchesForUser(uid, { type: 'global' });
            await db.dbRun("UPDATE users SET last_global_match = NOW() WHERE id = $1", [uid]);
            console.log('[Scheduler] Global run for user ' + uid);
          }
        } catch(e) {}
      }
    } catch(err) {
      console.error('[Scheduler] Matching cycle error:', err);
    }
  }, 60000); // check every minute
}
scheduleMatching();

// ── Admin: backfill embeddings ──
app.post('/api/admin/backfill-embeddings', async function(req, res) {
  if (!req.session || req.session.userId !== 2) return res.status(403).json({ error: 'Forbidden' });
  try {
    var { backfillUnembeddedProfiles } = require('./lib/vector_search');
    // Run async, return immediately
    backfillUnembeddedProfiles().then(function(result) {
      console.log('[admin] backfill complete:', result);
    }).catch(function(e) {
      console.error('[admin] backfill error:', e);
    });
    res.json({ status: 'backfill started' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 404 ──
app.use(function(req, res) {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).send('Not found');
});

// ── Error handler ──
app.use(function(err, req, res, next) {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──
app.listen(PORT, async function() {
  console.log('Event Medium running on port ' + PORT);
  console.log('Environment: ' + (process.env.NODE_ENV || 'development'));
  if (process.env.QDRANT_URL && process.env.QDRANT_API_KEY) {
    await initCollections();
    var { ensureCollections } = require('./lib/vector_search');
    await ensureCollections().catch(function(e){ console.error('[startup] ensureCollections failed:', e.message); });
  } else {
    console.log('Qdrant not configured — skipping collection init');
  }
});
