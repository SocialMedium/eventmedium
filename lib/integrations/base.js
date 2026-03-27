// ── Integration Adapter Base ──
// Every adapter exports the same interface. This file provides
// shared helpers and the contract definition.

var { dbGet, dbRun, dbAll } = require('../../db');
var { normalizeTheme, getCanonicalThemes } = require('../theme_taxonomy');
var crypto = require('crypto');

// ── Encryption helpers for credentials at rest ──
var CRED_KEY = process.env.COMMUNITY_API_SECRET || 'dev-key-change-me-32chars!!!!!';

function encryptCredentials(obj) {
  var iv = crypto.randomBytes(16);
  var key = crypto.scryptSync(CRED_KEY, 'salt', 32);
  var cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  var encrypted = cipher.update(JSON.stringify(obj), 'utf8', 'hex') + cipher.final('hex');
  return { iv: iv.toString('hex'), data: encrypted };
}

function decryptCredentials(stored) {
  if (!stored || !stored.iv || !stored.data) return null;
  var key = crypto.scryptSync(CRED_KEY, 'salt', 32);
  var decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(stored.iv, 'hex'));
  var decrypted = decipher.update(stored.data, 'hex', 'utf8') + decipher.final('utf8');
  return JSON.parse(decrypted);
}

// ── Signal schema validator ──
var VALID_ACTIONS = [
  'hiring', 'raising', 'launching', 'exiting', 'partnering',
  'publishing', 'awarding', 'filing', 'speaking', 'recognising'
];
var VALID_COSTS = ['low', 'medium', 'high'];
var VALID_CONSTRAINTS = ['low', 'medium', 'high'];
var VALID_ENTITY_TYPES = ['company', 'institution', 'topic', 'event'];
var VALID_JURISDICTIONS = ['au', 'uk', 'us', 'sg', 'global'];

function validateSignal(sig) {
  var errors = [];
  if (!sig.community_id) errors.push('missing community_id');
  if (!sig.source_type) errors.push('missing source_type');
  if (!sig.provider) errors.push('missing provider');

  // Validate canonical theme
  if (sig.canonical_theme) {
    var themes = getCanonicalThemes();
    if (themes.indexOf(sig.canonical_theme) === -1) {
      // Try normalizing
      var normalized = normalizeTheme(sig.canonical_theme);
      if (normalized) {
        sig.canonical_theme = normalized;
      } else {
        errors.push('invalid canonical_theme: ' + sig.canonical_theme);
      }
    }
  }

  if (sig.signal_action && VALID_ACTIONS.indexOf(sig.signal_action) === -1) {
    errors.push('invalid signal_action: ' + sig.signal_action);
  }
  if (sig.cost_of_signal && VALID_COSTS.indexOf(sig.cost_of_signal) === -1) {
    errors.push('invalid cost_of_signal: ' + sig.cost_of_signal);
  }
  if (sig.constraint_level && VALID_CONSTRAINTS.indexOf(sig.constraint_level) === -1) {
    errors.push('invalid constraint_level: ' + sig.constraint_level);
  }
  if (sig.entity_type && VALID_ENTITY_TYPES.indexOf(sig.entity_type) === -1) {
    errors.push('invalid entity_type: ' + sig.entity_type);
  }

  return { valid: errors.length === 0, errors: errors, signal: sig };
}

// ── Store signals in community_signals ──
async function storeSignals(signals) {
  var stored = 0;
  for (var i = 0; i < signals.length; i++) {
    var sig = signals[i];
    var validation = validateSignal(sig);
    if (!validation.valid) {
      console.warn('[integrations] Signal rejected:', validation.errors, sig);
      continue;
    }
    try {
      await dbRun(
        `INSERT INTO community_signals (community_id, signal_type, region, theme_tags, member_count, metadata, aggregate_only)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
        [
          sig.community_id,
          sig.source_type,
          sig.region || null,
          sig.canonical_theme ? [sig.canonical_theme] : [],
          5, // k-anonymity floor
          JSON.stringify({
            provider: sig.provider,
            signal_action: sig.signal_action,
            cost_of_signal: sig.cost_of_signal,
            constraint_level: sig.constraint_level,
            entity_type: sig.entity_type,
            entity_name: sig.entity_name,
            summary_raw: sig.summary_raw,
            jurisdiction: sig.jurisdiction,
            timestamp: sig.timestamp,
            metadata: sig.metadata
          })
        ]
      );
      stored++;
    } catch (err) {
      console.error('[integrations] Failed to store signal:', err.message);
    }
  }
  return stored;
}

// ── Update sync status for an integration ──
async function updateSyncStatus(integrationId, status) {
  await dbRun(
    'UPDATE community_integrations SET sync_status = $1, last_synced_at = NOW() WHERE id = $2',
    [status, integrationId]
  );
}

// ── Rate limiter (simple token bucket per provider) ──
var _buckets = {};
function rateLimit(provider, maxPerMinute) {
  var now = Date.now();
  if (!_buckets[provider]) _buckets[provider] = { tokens: maxPerMinute, last: now };
  var bucket = _buckets[provider];
  var elapsed = (now - bucket.last) / 60000;
  bucket.tokens = Math.min(maxPerMinute, bucket.tokens + elapsed * maxPerMinute);
  bucket.last = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens--;
  return true;
}

module.exports = {
  encryptCredentials,
  decryptCredentials,
  validateSignal,
  storeSignals,
  updateSyncStatus,
  rateLimit,
  VALID_ACTIONS,
  VALID_COSTS,
  VALID_CONSTRAINTS,
  VALID_ENTITY_TYPES,
  VALID_JURISDICTIONS
};
