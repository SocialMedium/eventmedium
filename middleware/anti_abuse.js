var rateLimit = require('express-rate-limit');
var { dbGet, dbRun, dbAll } = require('../db');

// ── Per-endpoint rate limits ──

// Auth endpoints — tight limits to prevent brute force
var authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts. Please wait 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Magic code send — prevent email spam
var magicSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many code requests. Please wait before trying again.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Nev chat — prevent automated conversations
var nevChatLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute window
  max: 8,                     // 8 messages per minute (generous for real users, blocks bots)
  message: { error: 'Slow down — Nev needs a moment to think.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Document ingestion — prevent abuse of Claude extraction
var documentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour window
  max: 10,                     // 10 documents per hour
  message: { error: 'Document upload limit reached. Try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Signup — prevent mass account creation
var signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour window
  max: 5,                     // 5 signups per IP per hour
  message: { error: 'Too many accounts created. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ── Behavioural bot detection ──
// Tracks message timing to detect automated conversations

// In-memory store for message timestamps per user (resets on server restart — intentional)
var userMessageTimestamps = {};

function trackMessageTiming(userId) {
  var now = Date.now();
  if (!userMessageTimestamps[userId]) {
    userMessageTimestamps[userId] = [];
  }
  var timestamps = userMessageTimestamps[userId];
  timestamps.push(now);

  // Keep only last 20 messages
  if (timestamps.length > 20) {
    timestamps.shift();
  }

  return analyseTimingPattern(timestamps);
}

function analyseTimingPattern(timestamps) {
  if (timestamps.length < 5) return { suspicious: false, reason: null, score: 0 };

  var intervals = [];
  for (var i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i] - timestamps[i - 1]);
  }

  // Check 1: Unnaturally fast responses (< 2 seconds consistently)
  var fastCount = intervals.filter(function(i) { return i < 2000; }).length;
  if (fastCount > intervals.length * 0.6) {
    return { suspicious: true, reason: 'rapid_fire', score: 80 };
  }

  // Check 2: Suspiciously regular intervals (bot-like precision)
  if (intervals.length >= 4) {
    var avg = intervals.reduce(function(a, b) { return a + b; }, 0) / intervals.length;
    var variance = intervals.reduce(function(a, b) { return a + Math.pow(b - avg, 2); }, 0) / intervals.length;
    var stddev = Math.sqrt(variance);
    var cv = avg > 0 ? stddev / avg : 0; // coefficient of variation

    // Humans have high variance; bots have low variance
    if (cv < 0.15 && intervals.length >= 6) {
      return { suspicious: true, reason: 'mechanical_timing', score: 70 };
    }
  }

  // Check 3: Very high message volume in short window
  var windowMs = timestamps[timestamps.length - 1] - timestamps[0];
  var messagesPerMinute = (timestamps.length / windowMs) * 60000;
  if (messagesPerMinute > 10 && timestamps.length >= 8) {
    return { suspicious: true, reason: 'high_volume', score: 60 };
  }

  return { suspicious: false, reason: null, score: 0 };
}

// ── Canister velocity check ──
// Flags profiles that complete unusually fast (< 2 minutes from creation)

async function checkCanisterVelocity(userId) {
  try {
    var profile = await dbGet(
      'SELECT created_at, updated_at, stakeholder_type, themes, intent, offering, geography, focus_text FROM stakeholder_profiles WHERE user_id = $1',
      [userId]
    );
    if (!profile || !profile.created_at) return { suspicious: false };

    var created = new Date(profile.created_at);
    var updated = new Date(profile.updated_at || profile.created_at);
    var elapsed = updated - created;

    // Profile completed in under 2 minutes is suspicious
    var hasFullProfile = profile.stakeholder_type && profile.themes && profile.intent && profile.offering && profile.geography;
    if (hasFullProfile && elapsed < 120000) {
      return { suspicious: true, reason: 'instant_completion', elapsed_ms: elapsed };
    }

    return { suspicious: false };
  } catch (e) {
    return { suspicious: false };
  }
}

// ── Write abuse flag to DB ──

async function flagUser(userId, flagType, reason, score) {
  try {
    // Check if already flagged for this reason today
    var existing = await dbGet(
      "SELECT id FROM abuse_flags WHERE user_id = $1 AND flag_type = $2 AND created_at > NOW() - INTERVAL '24 hours'",
      [userId, flagType]
    );
    if (existing) return; // Don't duplicate

    await dbRun(
      'INSERT INTO abuse_flags (user_id, flag_type, reason, score, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [userId, flagType, reason, score || 0]
    );
    console.log('[anti-abuse] flagged user ' + userId + ': ' + flagType + ' — ' + reason);
  } catch (e) {
    // Table may not exist yet — silently skip
    if (e.message && e.message.indexOf('abuse_flags') !== -1) return;
    console.error('[anti-abuse] flag write error:', e.message);
  }
}

// ── Middleware: track Nev chat behaviour ──

function nevBehaviourCheck(req, res, next) {
  if (!req.user || !req.user.id) return next();

  var result = trackMessageTiming(req.user.id);
  if (result.suspicious) {
    flagUser(req.user.id, 'bot_behaviour', result.reason, result.score);

    // Don't block — just flag. Blocking creates false positives for fast typers.
    // But add a header so we can monitor
    res.set('X-Abuse-Flag', result.reason);
  }

  next();
}

// ── Middleware: check document ingest for abuse ──

async function documentAbuseCheck(req, res, next) {
  if (!req.user || !req.user.id) return next();

  try {
    // Check how many documents this user has uploaded today
    var todayCount = await dbGet(
      "SELECT COUNT(*) as count FROM user_documents WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'",
      [req.user.id]
    );
    if (todayCount && parseInt(todayCount.count, 10) >= 20) {
      return res.status(429).json({ error: 'Daily document limit reached. Try again tomorrow.' });
    }
  } catch (e) {
    // Table may not exist — pass through
  }

  next();
}

// ── Get abuse summary for admin ──

async function getAbuseSummary() {
  try {
    var flags = await dbAll(
      "SELECT af.user_id, u.name, u.email, af.flag_type, af.reason, af.score, af.created_at FROM abuse_flags af JOIN users u ON u.id = af.user_id WHERE af.created_at > NOW() - INTERVAL '7 days' ORDER BY af.created_at DESC LIMIT 50"
    );
    return flags || [];
  } catch (e) {
    return [];
  }
}

async function getSuspiciousProfiles() {
  try {
    // Profiles completed very fast OR flagged for bot behaviour
    var profiles = await dbAll(
      "SELECT DISTINCT u.id, u.name, u.email, u.created_at as user_created, sp.created_at as profile_created, sp.updated_at as profile_updated, sp.stakeholder_type, EXTRACT(EPOCH FROM (sp.updated_at - sp.created_at)) as completion_seconds, (SELECT COUNT(*) FROM abuse_flags af WHERE af.user_id = u.id AND af.created_at > NOW() - INTERVAL '7 days') as flag_count, (SELECT string_agg(DISTINCT af.flag_type, ', ') FROM abuse_flags af WHERE af.user_id = u.id AND af.created_at > NOW() - INTERVAL '7 days') as flag_types FROM users u JOIN stakeholder_profiles sp ON sp.user_id = u.id WHERE (EXTRACT(EPOCH FROM (sp.updated_at - sp.created_at)) < 120 AND sp.stakeholder_type IS NOT NULL) OR u.id IN (SELECT DISTINCT user_id FROM abuse_flags WHERE created_at > NOW() - INTERVAL '7 days') ORDER BY flag_count DESC, completion_seconds ASC LIMIT 30"
    );
    return profiles || [];
  } catch (e) {
    return [];
  }
}

module.exports = {
  authLimiter: authLimiter,
  magicSendLimiter: magicSendLimiter,
  nevChatLimiter: nevChatLimiter,
  documentLimiter: documentLimiter,
  signupLimiter: signupLimiter,
  nevBehaviourCheck: nevBehaviourCheck,
  documentAbuseCheck: documentAbuseCheck,
  trackMessageTiming: trackMessageTiming,
  checkCanisterVelocity: checkCanisterVelocity,
  flagUser: flagUser,
  getAbuseSummary: getAbuseSummary,
  getSuspiciousProfiles: getSuspiciousProfiles
};
