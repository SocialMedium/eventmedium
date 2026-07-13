// ── Autonomous Event Ingestion Scheduler ──────────────────────────────────────
// Runs discovery + curated harvest inside the server process so ingestion
// never depends on someone remembering to run a script. The April 2026 freeze
// happened because all harvesting was manual — this module makes it a daily,
// self-healing background job.
//
// Design:
//   - Daily cycle at INGEST_HOUR_UTC, plus a boot-time catch-up if the last
//     successful run is older than 26h (survives restarts and missed ticks).
//   - Every run is recorded in ingestion_runs (status, stats, error) so
//     "when did ingestion last work?" is a SQL query, not an archaeology dig.
//   - Postgres advisory lock prevents concurrent runs across replicas;
//     an in-memory flag prevents them within the process.
//   - Rotating slice of the theme×city query pool per run — deterministic
//     offset from the run counter, so the full pool is covered over time
//     without burning the Serper quota in one go.
//   - Watchdog deadline: a run hard-stops inserting new work after
//     MAX_RUN_MINUTES so a hung network can't wedge the scheduler.
//   - Past-dated events are never inserted; years beyond +2 are rejected.

var { pool, dbGet, dbRun } = require('../db');
var { searchEvents } = require('./event_harvester');
var { harvestEvent } = require('./event-harvester');
var { findDuplicate } = require('./event_dedup');
var { normalizeThemes } = require('./theme_taxonomy');

var INGEST_HOUR_UTC = parseInt(process.env.INGEST_HOUR_UTC || '5', 10);
var QUERIES_PER_RUN = parseInt(process.env.INGEST_QUERIES_PER_RUN || '40', 10);
var URLS_PER_QUERY = 5;
var MAX_RUN_MINUTES = parseInt(process.env.INGEST_MAX_RUN_MINUTES || '45', 10);
var CATCHUP_STALE_HOURS = 26;
var ADVISORY_LOCK_KEY = 824642; // arbitrary constant, unique to ingestion

var CITIES = [
  'London', 'Singapore', 'Sydney', 'Melbourne', 'New York', 'Las Vegas',
  'Barcelona', 'Madrid', 'Berlin', 'Stockholm', 'Copenhagen', 'Paris',
  'Amsterdam', 'Dubai', 'San Francisco', 'Austin', 'Toronto', 'Lisbon',
  'Tel Aviv', 'Seoul', 'Hong Kong', 'Zurich', 'Vienna', 'Dublin',
  'Helsinki', 'Brussels', 'Milan', 'Munich', 'Boston', 'Miami'
];

var THEMES = [
  'AI', 'FinTech', 'Cybersecurity', 'SaaS', 'Climate Tech', 'HealthTech',
  'Web3', 'Blockchain', 'IoT', 'Robotics', 'SpaceTech', 'EdTech',
  'GovTech', 'PropTech', 'DeepTech', 'BioTech', 'Defence Tech',
  'Data', 'Privacy', 'Sustainability', 'Venture Capital', 'Startup'
];

// Block list pages, blog posts, aggregator sites
var BLOCKLIST = [
  'best-', 'top-', 'biggest', 'guide', 'list-of', 'blog', '/blog/',
  'splunk.com', 'panorama', 'bizzabo.com/blog', 'meetup.com',
  'eventbrite.com', 'lu.ma', 'medium.com', 'forbes.com', 'wikipedia',
  'conferences-to-attend', 'events-in-', 'conferences-in-',
  'reddit.com', 'quora.com', 'youtube.com'
];

// ── Query pool: theme × city × format × (this year, next year) ──
// Years are computed at call time so the pool never goes stale.
function buildQueryPool() {
  var year = new Date().getUTCFullYear();
  var pool_ = [];
  [String(year), String(year + 1)].forEach(function(y) {
    THEMES.forEach(function(theme) {
      CITIES.forEach(function(city) {
        pool_.push(theme + ' conference ' + y + ' ' + city);
        pool_.push(theme + ' summit ' + y + ' ' + city);
      });
    });
  });
  return pool_;
}

// ── Run ledger ──
async function ensureTables() {
  await dbRun(`CREATE TABLE IF NOT EXISTS ingestion_runs (
    id SERIAL PRIMARY KEY,
    kind TEXT DEFAULT 'daily',
    status TEXT DEFAULT 'running',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    stats JSONB DEFAULT '{}',
    error TEXT
  )`);
}

// ── Date sanity: only future events, at most 2 years out ──
function isAcceptableDate(dateStr) {
  if (!dateStr) return true; // undated events allowed; homepage filters them
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  var today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (d < today) return false;
  return d.getUTCFullYear() <= today.getUTCFullYear() + 2;
}

function makeSlug(name, eventDate, runId) {
  var slug = (name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (eventDate) slug += '-' + String(eventDate).replace(/-/g, '').substring(0, 8);
  return slug + '-' + Date.now().toString(36) + (runId ? '-r' + runId : '');
}

async function insertEvent(ex, fallbackUrl, runId, stats) {
  if (!ex.name || ex.name.length < 5) { stats.skipped++; return; }
  if (!isAcceptableDate(ex.event_date)) { stats.stale++; return; }

  var dupe = await findDuplicate(ex.name, ex.event_date, ex.city);
  if (dupe) { stats.duplicates++; return; }

  var themes = normalizeThemes(ex.themes || []);
  var res = await dbRun(
    `INSERT INTO events (name, description, event_date, city, country, event_type, themes, slug, source_url, expected_attendees)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (name, event_date, city, country) DO NOTHING
     RETURNING id`,
    [ex.name, ex.description || null, ex.event_date || null, ex.city || null, ex.country || null,
     ex.event_format || 'conference', JSON.stringify(themes), makeSlug(ex.name, ex.event_date, runId),
     ex.website || fallbackUrl, ex.expected_attendees || null]
  );

  if (res && res.rows && res.rows[0]) {
    stats.added++;
    console.log('[Ingest]   + ' + ex.name + ' | ' + (ex.city || '?') + ' | ' + (ex.event_date || 'tbd'));
  } else {
    stats.duplicates++;
  }
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// ── Phase 1: rotating search discovery ──
async function runDiscoverySlice(runId, deadline, stats) {
  var queryPool = buildQueryPool();

  // Deterministic rotation: each run picks up where the run counter points,
  // so consecutive runs sweep the whole pool instead of re-shuffling it.
  var counted = await dbGet('SELECT COUNT(*)::int AS c FROM ingestion_runs');
  var offset = ((counted.c || 0) * QUERIES_PER_RUN) % queryPool.length;
  var batch = [];
  for (var i = 0; i < Math.min(QUERIES_PER_RUN, queryPool.length); i++) {
    batch.push(queryPool[(offset + i) % queryPool.length]);
  }
  console.log('[Ingest] Discovery slice: ' + batch.length + ' queries at offset ' + offset + '/' + queryPool.length);

  for (var q = 0; q < batch.length; q++) {
    if (Date.now() > deadline) {
      console.warn('[Ingest] Watchdog deadline hit — stopping discovery at query ' + q + '/' + batch.length);
      stats.deadline_hit = true;
      break;
    }

    var results = [];
    try {
      results = await searchEvents(batch[q]);
      stats.queries++;
    } catch (e) {
      stats.search_errors++;
      continue;
    }

    var taken = 0;
    for (var j = 0; j < results.length && taken < URLS_PER_QUERY; j++) {
      if (Date.now() > deadline) break;
      var r = results[j];
      var lo = (r.url + ' ' + r.title).toLowerCase();
      if (BLOCKLIST.some(function(b) { return lo.includes(b); })) { stats.skipped++; continue; }
      if (!/conference|summit|congress|forum|expo/i.test(r.title + ' ' + r.snippet)) { stats.skipped++; continue; }
      taken++;

      try {
        var ex = await harvestEvent(r.url);
        await insertEvent(ex, r.url, runId, stats);
      } catch (e) {
        stats.failed++;
      }
      await sleep(1000);
    }
    await sleep(300);
  }
}

// ── Phase 2: weekly curated re-check ──
async function runCuratedCheck(runId, deadline, stats) {
  var urls = [];
  try {
    urls = require('../scripts/batch_harvest_2026').URLS || [];
  } catch (e) { /* curated list optional */ }
  if (!urls.length) {
    urls = ['https://websummit.com', 'https://sxsw.com', 'https://www.ces.tech',
            'https://vivatech.com', 'https://londontechweek.com', 'https://www.gitex.com',
            'https://www.slush.org'];
  }

  console.log('[Ingest] Curated re-check: ' + urls.length + ' URLs');
  for (var i = 0; i < urls.length; i++) {
    if (Date.now() > deadline) {
      console.warn('[Ingest] Watchdog deadline hit — stopping curated check at ' + i + '/' + urls.length);
      stats.deadline_hit = true;
      break;
    }
    try {
      var ex = await harvestEvent(urls[i]);
      await insertEvent(ex, urls[i], runId, stats);
    } catch (e) {
      stats.failed++;
    }
    await sleep(1000);
  }
}

// ── One full ingestion cycle ──
var runningInProcess = false;

async function runIngestionCycle(opts) {
  opts = opts || {};
  var kind = opts.kind || 'daily';

  if (runningInProcess) {
    console.warn('[Ingest] Cycle already running in this process — skipping');
    return { skipped: 'already_running' };
  }
  runningInProcess = true;

  var client = null;
  var lockHeld = false;
  var runId = null;
  var stats = { queries: 0, added: 0, duplicates: 0, skipped: 0, stale: 0, failed: 0, search_errors: 0 };

  try {
    await ensureTables();

    var hasSearch = process.env.SERPER_API_KEY ||
      (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX);
    if (!hasSearch && kind !== 'curated') {
      // Record the failure loudly instead of freezing silently — a missing key
      // is exactly the kind of thing that killed ingestion the first time.
      console.error('[Ingest] No search credentials (SERPER_API_KEY or GOOGLE_SEARCH_API_KEY+GOOGLE_SEARCH_CX) — falling back to curated-only.');
      kind = 'curated';
    }

    // Cross-process guard: advisory lock held on a dedicated connection
    client = await pool.connect();
    var lock = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [ADVISORY_LOCK_KEY]);
    if (!lock.rows[0].ok) {
      console.warn('[Ingest] Another instance holds the ingestion lock — skipping');
      return { skipped: 'locked' };
    }
    lockHeld = true;

    var runRow = await dbGet(
      "INSERT INTO ingestion_runs (kind, status) VALUES ($1, 'running') RETURNING id", [kind]
    );
    runId = runRow.id;
    var deadline = Date.now() + MAX_RUN_MINUTES * 60 * 1000;
    console.log('[Ingest] Run #' + runId + ' (' + kind + ') started at ' + new Date().toISOString());

    if (kind !== 'curated') {
      await runDiscoverySlice(runId, deadline, stats);
    }

    // Curated pass: weekly on Sundays, or when explicitly requested
    if (kind === 'curated' || new Date().getUTCDay() === 0) {
      await runCuratedCheck(runId, deadline, stats);
    }

    await dbRun(
      "UPDATE ingestion_runs SET status = 'success', finished_at = NOW(), stats = $2 WHERE id = $1",
      [runId, JSON.stringify(stats)]
    );
    console.log('[Ingest] Run #' + runId + ' complete: ' + JSON.stringify(stats));
    return stats;

  } catch (err) {
    console.error('[Ingest] Run failed:', err.message);
    if (runId) {
      await dbRun(
        "UPDATE ingestion_runs SET status = 'failed', finished_at = NOW(), stats = $2, error = $3 WHERE id = $1",
        [runId, JSON.stringify(stats), String(err.message || err).slice(0, 500)]
      ).catch(function() {});
    }
    return { error: err.message, stats: stats };

  } finally {
    runningInProcess = false;
    if (client) {
      if (lockHeld) {
        try { await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]); } catch (e) {}
      }
      client.release();
    }
  }
}

// ── Status for the admin dashboard ──
async function getIngestionStatus() {
  await ensureTables();
  var runs = await pool.query(
    'SELECT id, kind, status, started_at, finished_at, stats, error FROM ingestion_runs ORDER BY id DESC LIMIT 14'
  );
  var freshness = await dbGet(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE event_date >= CURRENT_DATE)::int AS future,
            MAX(created_at) AS newest_created
     FROM events`
  );
  var provider = process.env.SERPER_API_KEY ? 'serper'
    : (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX) ? 'google_cse'
    : null;
  return { runs: runs.rows, events: freshness, search_provider: provider };
}

// ── Scheduler: daily tick + boot catch-up ──
function startIngestionScheduler() {
  // Daily tick, same minute-check pattern as scheduleMatching
  setInterval(function() {
    var now = new Date();
    if (now.getUTCHours() !== INGEST_HOUR_UTC || now.getUTCMinutes() !== 0) return;
    runIngestionCycle({ kind: 'daily' });
  }, 60000);

  // Boot catch-up: if ingestion hasn't succeeded in >26h (or ever), run now.
  // This is what makes the pipeline self-healing — a redeploy or crash can
  // never silently take ingestion offline for months again.
  setTimeout(async function() {
    try {
      await ensureTables();
      var last = await dbGet(
        "SELECT MAX(finished_at) AS t FROM ingestion_runs WHERE status = 'success'"
      );
      var stale = !last || !last.t ||
        (Date.now() - new Date(last.t).getTime()) > CATCHUP_STALE_HOURS * 3600 * 1000;
      if (stale) {
        console.log('[Ingest] No successful run in ' + CATCHUP_STALE_HOURS + 'h — starting catch-up cycle');
        runIngestionCycle({ kind: 'catchup' });
      } else {
        console.log('[Ingest] Last successful run ' + last.t + ' — no catch-up needed');
      }
    } catch (e) {
      console.error('[Ingest] Boot catch-up check failed:', e.message);
    }
  }, 2 * 60 * 1000);

  console.log('[Ingest] Scheduler armed: daily at ' + INGEST_HOUR_UTC + ':00 UTC, ' +
    QUERIES_PER_RUN + ' queries/run, boot catch-up in 2 min');
}

module.exports = { startIngestionScheduler, runIngestionCycle, getIngestionStatus };
