// ── Event Deduplication ──
// Fuzzy name matching to prevent near-duplicate events.
// "SXSW 2026" vs "SXSW Conference & Festivals 2026" = same event.

var { dbGet, dbAll } = require('../db');

/**
 * Normalise an event name for comparison.
 * Strips year, edition numbers, common suffixes, punctuation.
 */
function normaliseName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\b20\d{2}\b/g, '')           // strip years
    .replace(/\b\d{1,3}(st|nd|rd|th)\b/g, '') // strip ordinals
    .replace(/\bedition\b/g, '')
    .replace(/\bannual\b/g, '')
    .replace(/conference|summit|expo|forum|congress|convention|festival|symposium/gi, '')
    .replace(/&|and/g, '')
    .replace(/[^a-z0-9]/g, '')             // strip all non-alphanumeric
    .trim();
}

/**
 * Check if two normalised names are similar enough to be the same event.
 * Returns true if one contains the other or they share >80% of characters.
 */
function isSimilar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  // Dice coefficient on character bigrams
  var bigramsA = bigrams(a);
  var bigramsB = bigrams(b);
  if (bigramsA.size === 0 || bigramsB.size === 0) return false;

  var intersection = 0;
  bigramsA.forEach(function(v, k) {
    if (bigramsB.has(k)) intersection += Math.min(v, bigramsB.get(k));
  });

  var totalA = 0, totalB = 0;
  bigramsA.forEach(function(v) { totalA += v; });
  bigramsB.forEach(function(v) { totalB += v; });

  var dice = (2 * intersection) / (totalA + totalB);
  return dice > 0.8;
}

function bigrams(str) {
  var map = new Map();
  for (var i = 0; i < str.length - 1; i++) {
    var bg = str.substring(i, i + 2);
    map.set(bg, (map.get(bg) || 0) + 1);
  }
  return map;
}

/**
 * Check if an event is a duplicate of something already in the DB.
 * Uses exact match on name+year first, then fuzzy name matching
 * within the same date window (±7 days) and city.
 *
 * Returns the existing event if duplicate, null if not.
 */
async function findDuplicate(name, eventDate, city) {
  var year = eventDate ? new Date(eventDate).getFullYear() : null;

  // 1. Exact name + year match (case-insensitive)
  if (year) {
    var exact = await dbGet(
      "SELECT id, name, slug FROM events WHERE name ILIKE $1 AND EXTRACT(YEAR FROM event_date) = $2",
      [name, year]
    );
    if (exact) return exact;
  }

  // 2. Fuzzy match: same city, similar date range
  var normName = normaliseName(name);
  if (!normName || normName.length < 3) return null;

  var candidates;
  if (eventDate && city) {
    candidates = await dbAll(
      "SELECT id, name, slug, event_date, city FROM events WHERE city ILIKE $1 AND event_date BETWEEN $2::date - INTERVAL '7 days' AND $2::date + INTERVAL '7 days'",
      [city, eventDate]
    );
  } else if (eventDate) {
    candidates = await dbAll(
      "SELECT id, name, slug, event_date, city FROM events WHERE event_date BETWEEN $1::date - INTERVAL '7 days' AND $1::date + INTERVAL '7 days'",
      [eventDate]
    );
  } else {
    // No date — check by normalised name only
    candidates = await dbAll("SELECT id, name, slug FROM events");
  }

  for (var i = 0; i < candidates.length; i++) {
    var cNorm = normaliseName(candidates[i].name);
    if (isSimilar(normName, cNorm)) {
      return candidates[i];
    }
  }

  return null;
}

module.exports = { findDuplicate, normaliseName, isSimilar };
