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

app.use('/api/graph', require('./routes/graph').router);
app.use('/api/network', require('./routes/network'));
app.use('/api/admin', require('./routes/dashboard'));
app.use('/api/privacy', require('./routes/privacy'));

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
    await dbRun("ALTER TABLE event_matches ADD COLUMN IF NOT EXISTS scope_type TEXT DEFAULT 'event'");
    await dbRun('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_global_match TIMESTAMP');
    console.log('[Migrations] Schema up to date');
  } catch(err) {
    console.error('[Migrations] Error:', err);
  }
}
runMigrations();

// ── Scheduled matching: 3x daily (8am, 1pm, 6pm UTC) ──────────────────────────
function scheduleMatching() {
  var MATCH_HOURS = [8, 13, 18]; // UTC
  setInterval(async function() {
    var hour = new Date().getUTCHours();
    var minute = new Date().getUTCMinutes();
    if (MATCH_HOURS.indexOf(hour) === -1 || minute !== 0) return;
    console.log('[Scheduler] Running matching cycle at ' + new Date().toISOString());
    try {
      var { generateMatchesForUser } = require('./routes/matches');
      var db = require('./db');

      // 1. Event-scoped matches — events within 30 days
      var events = await db.dbAll(
        "SELECT e.id FROM events e WHERE e.event_date >= CURRENT_DATE AND e.event_date <= CURRENT_DATE + INTERVAL '30 days'"
      );
      for (var i = 0; i < events.length; i++) {
        var regs = await db.dbAll(
          "SELECT user_id FROM event_registrations WHERE event_id = $1 AND status = 'active'",
          [events[i].id]
        );
        for (var j = 0; j < regs.length; j++) {
          try { await generateMatchesForUser(regs[j].user_id, { type: 'event', id: events[i].id }); } catch(e) {}
        }
        if (regs.length) console.log('[Scheduler] Event ' + events[i].id + ': processed ' + regs.length + ' users');
      }

      // 2. Community-scoped matches — all active communities
      var communities = await db.dbAll("SELECT id FROM communities WHERE is_active = true");
      for (var i = 0; i < communities.length; i++) {
        var members = await db.dbAll(
          "SELECT user_id FROM community_members WHERE community_id = $1", [communities[i].id]
        );
        for (var j = 0; j < members.length; j++) {
          try { await generateMatchesForUser(members[j].user_id, { type: 'community', id: communities[i].id }); } catch(e) {}
        }
        if (members.length) console.log('[Scheduler] Community ' + communities[i].id + ': processed ' + members.length + ' users');
      }

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
  } else {
    console.log('Qdrant not configured — skipping collection init');
  }
});
