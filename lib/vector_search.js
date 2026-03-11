// ── Vector Search & Embedding Helpers ──
// OpenAI text-embedding-3-small (1536 dims) + Qdrant Cloud
// Collections: em_user_profiles, em_events, em_signals

var QDRANT_URL = process.env.QDRANT_URL;
var QDRANT_API_KEY = process.env.QDRANT_API_KEY;
var OPENAI_API_KEY = process.env.OPENAI_API_KEY;

var EMBEDDING_MODEL = 'text-embedding-3-small';
var EMBEDDING_DIMS = 1536;

var COLLECTIONS = {
  profiles: 'em_user_profiles',
  events: 'em_events',
  signals: 'em_signals'
};

// ── OpenAI Embedding ──

async function getEmbedding(text) {
  if (!text || !text.trim()) return null;
  // Truncate to ~8000 tokens worth of text (rough estimate)
  var truncated = text.slice(0, 30000);

  var resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + OPENAI_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: truncated
    })
  });

  if (!resp.ok) {
    var err = await resp.text();
    console.error('OpenAI embedding error:', resp.status, err);
    return null;
  }

  var data = await resp.json();
  return data.data[0].embedding;
}

// Batch embed multiple texts (up to 2048 per call)
async function getEmbeddings(texts) {
  if (!texts || !texts.length) return [];
  var cleaned = texts.map(function(t) { return (t || '').slice(0, 30000); });

  var resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + OPENAI_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: cleaned
    })
  });

  if (!resp.ok) {
    var err = await resp.text();
    console.error('OpenAI batch embedding error:', resp.status, err);
    return [];
  }

  var data = await resp.json();
  return data.data.map(function(d) { return d.embedding; });
}

// ── Qdrant Helpers ──

async function qdrantRequest(method, path, body) {
  var opts = {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'api-key': QDRANT_API_KEY
    }
  };
  if (body) opts.body = JSON.stringify(body);

  var resp = await fetch(QDRANT_URL + path, opts);
  if (!resp.ok) {
    var err = await resp.text();
    console.error('Qdrant error:', method, path, resp.status, err);
    return null;
  }
  return resp.json();
}

// Ensure collection exists (idempotent)
async function ensureCollection(name) {
  // Check if exists
  var check = await fetch(QDRANT_URL + '/collections/' + name, {
    headers: { 'api-key': QDRANT_API_KEY }
  });
  if (check.ok) return true;

  // Create
  var result = await qdrantRequest('PUT', '/collections/' + name, {
    vectors: {
      size: EMBEDDING_DIMS,
      distance: 'Cosine'
    }
  });
  if (result) console.log('Created Qdrant collection:', name);
  return !!result;
}

// Initialize all EM collections
async function initCollections() {
  try {
    await ensureCollection(COLLECTIONS.profiles);
    await ensureCollection(COLLECTIONS.events);
    await ensureCollection(COLLECTIONS.signals);
    console.log('Qdrant collections ready');
  } catch (err) {
    console.error('Qdrant init error:', err.message);
  }
}

// Upsert a single point
async function upsertPoint(collection, id, vector, payload) {
  return qdrantRequest('PUT', '/collections/' + collection + '/points', {
    points: [{
      id: id,
      vector: vector,
      payload: payload || {}
    }]
  });
}

// Upsert multiple points (batch)
async function upsertPoints(collection, points) {
  if (!points || !points.length) return null;
  return qdrantRequest('PUT', '/collections/' + collection + '/points', {
    points: points
  });
}

// Search by vector
async function searchByVector(collection, vector, limit, filter) {
  var body = {
    vector: vector,
    limit: limit || 10,
    with_payload: true
  };
  if (filter) body.filter = filter;
  return qdrantRequest('POST', '/collections/' + collection + '/points/search', body);
}

// Delete a point by ID
async function deletePoint(collection, id) {
  return qdrantRequest('POST', '/collections/' + collection + '/points/delete', {
    points: [id]
  });
}

// ── High-Level: Embed & Upsert Profile ──

function buildProfileText(profile, user) {
  var parts = [];
  if (user && user.name) parts.push('Name: ' + user.name);
  if (user && user.company) parts.push('Company: ' + user.company);
  if (profile.stakeholder_type) parts.push('Role: ' + profile.stakeholder_type);
  if (profile.focus_text) parts.push('Focus: ' + profile.focus_text);
  if (profile.themes && profile.themes.length) parts.push('Themes: ' + profile.themes.join(', '));
  if (profile.intent && profile.intent.length) parts.push('Looking for: ' + profile.intent.join(', '));
  if (profile.offering && profile.offering.length) parts.push('Offering: ' + profile.offering.join(', '));
  if (profile.context) parts.push('Context: ' + profile.context);
  if (profile.geography) parts.push('Geography: ' + profile.geography);
  if (profile.deal_details) {
    var dd = typeof profile.deal_details === 'string' ? JSON.parse(profile.deal_details) : profile.deal_details;
    if (dd.stage) parts.push('Stage: ' + dd.stage);
    if (dd.check_size) parts.push('Check size: ' + dd.check_size);
    if (dd.raise_amount) parts.push('Raising: ' + dd.raise_amount);
    if (dd.sectors) parts.push('Sectors: ' + (Array.isArray(dd.sectors) ? dd.sectors.join(', ') : dd.sectors));
  }
  return parts.join('. ');
}

async function embedProfile(profile, user) {
  var text = buildProfileText(profile, user);
  if (!text) return null;

  var vector = await getEmbedding(text);
  if (!vector) return null;

  var pointId = 'user_' + profile.user_id;
  // Qdrant needs numeric or UUID IDs — use user_id as integer
  await upsertPoint(COLLECTIONS.profiles, profile.user_id, vector, {
    user_id: profile.user_id,
    stakeholder_type: profile.stakeholder_type,
    themes: profile.themes || [],
    geography: profile.geography,
    text: text
  });

  return pointId;
}

// ── High-Level: Embed & Upsert Event ──

function buildEventText(event) {
  var parts = [];
  if (event.name) parts.push(event.name);
  if (event.description) parts.push(event.description);
  if (event.themes) {
    var themes = typeof event.themes === 'string' ? JSON.parse(event.themes) : event.themes;
    if (themes.length) parts.push('Themes: ' + themes.join(', '));
  }
  if (event.city) parts.push('Location: ' + event.city + (event.country ? ', ' + event.country : ''));
  if (event.event_type) parts.push('Type: ' + event.event_type);
  return parts.join('. ');
}

async function embedEvent(event) {
  var text = buildEventText(event);
  if (!text) return null;

  var vector = await getEmbedding(text);
  if (!vector) return null;

  await upsertPoint(COLLECTIONS.events, event.id, vector, {
    event_id: event.id,
    name: event.name,
    themes: event.themes || [],
    city: event.city,
    country: event.country,
    event_date: event.event_date,
    text: text
  });

  return 'event_' + event.id;
}

// ── High-Level: Embed & Upsert Signal ──

function buildSignalText(signal) {
  var parts = [];
  if (signal.source_type) parts.push('Source: ' + signal.source_type);
  if (signal.entity_name) parts.push('Entity: ' + signal.entity_name);
  if (signal.theme) parts.push('Theme: ' + signal.theme);
  if (signal.signal_text) parts.push(signal.signal_text);
  if (signal.signal_summary) parts.push(signal.signal_summary);
  if (signal.geography) parts.push('Geography: ' + signal.geography);
  if (signal.dollar_amount) parts.push('Amount: $' + signal.dollar_amount + (signal.dollar_unit || ''));
  return parts.join('. ');
}

async function embedSignal(signal) {
  var text = buildSignalText(signal);
  if (!text) return null;

  var vector = await getEmbedding(text);
  if (!vector) return null;

  await upsertPoint(COLLECTIONS.signals, signal.id, vector, {
    signal_id: signal.id,
    source_type: signal.source_type,
    entity_name: signal.entity_name,
    theme: signal.theme,
    themes: signal.themes_json || [],
    lifecycle_stage: signal.lifecycle_stage,
    cost_of_signal: signal.cost_of_signal,
    signal_date: signal.signal_date,
    text: text
  });

  return 'signal_' + signal.id;
}

// ── Batch Embed Signals ──

async function embedSignalsBatch(signals) {
  if (!signals || !signals.length) return 0;

  var texts = signals.map(buildSignalText);
  var vectors = await getEmbeddings(texts);
  if (!vectors.length) return 0;

  var points = [];
  for (var i = 0; i < signals.length; i++) {
    if (vectors[i]) {
      points.push({
        id: signals[i].id,
        vector: vectors[i],
        payload: {
          signal_id: signals[i].id,
          source_type: signals[i].source_type,
          entity_name: signals[i].entity_name,
          theme: signals[i].theme,
          themes: signals[i].themes_json || [],
          lifecycle_stage: signals[i].lifecycle_stage,
          cost_of_signal: signals[i].cost_of_signal,
          signal_date: signals[i].signal_date,
          text: texts[i]
        }
      });
    }
  }

  if (points.length) {
    // Qdrant batch limit is ~100 points per call
    for (var j = 0; j < points.length; j += 100) {
      var batch = points.slice(j, j + 100);
      await upsertPoints(COLLECTIONS.signals, batch);
    }
  }

  return points.length;
}

// ── Search Helpers ──

// Find similar profiles for matching
async function searchSimilarProfiles(vector, limit, excludeUserId) {
  var filter = null;
  if (excludeUserId) {
    filter = {
      must_not: [{ key: 'user_id', match: { value: excludeUserId } }]
    };
  }
  var result = await searchByVector(COLLECTIONS.profiles, vector, limit, filter);
  return result && result.result ? result.result : [];
}

// Find signals relevant to themes
async function searchSignalsByThemes(themes, limit) {
  if (!themes || !themes.length) return [];
  var text = themes.join(', ');
  var vector = await getEmbedding(text);
  if (!vector) return [];
  var result = await searchByVector(COLLECTIONS.signals, vector, limit || 20);
  return result && result.result ? result.result : [];
}

// Find events similar to a profile or theme set
async function searchSimilarEvents(vector, limit) {
  var result = await searchByVector(COLLECTIONS.events, vector, limit || 10);
  return result && result.result ? result.result : [];
}
// ── Retrieve stored vectors ──

async function getPointVector(collection, pointId) {
  var result = await qdrantRequest('POST', '/collections/' + collection + '/points', {
    ids: [pointId],
    with_vector: true
  });
  if (result && result.result && result.result.length > 0) {
    return result.result[0].vector;
  }
  return null;
}

async function getPointVectors(collection, pointIds) {
  if (!pointIds || !pointIds.length) return {};
  var result = await qdrantRequest('POST', '/collections/' + collection + '/points', {
    ids: pointIds,
    with_vector: true
  });
  var vectors = {};
  if (result && result.result) {
    result.result.forEach(function(p) {
      vectors[p.id] = p.vector;
    });
  }
  return vectors;
}

// ── ANN candidate search for matching ──

async function findCandidates(userId, eventRegistrantIds, limit) {
  // Get user's stored vector
  var userVector = await getPointVector(COLLECTIONS.profiles, userId);
  if (!userVector) return null; // no embedding stored

  // Build filter: must be in registrant list, must not be self
  var filter = {
    must: [
      { key: 'user_id', match: { any: eventRegistrantIds } }
    ],
    must_not: [
      { key: 'user_id', match: { value: userId } }
    ]
  };

  var result = await searchByVector(COLLECTIONS.profiles, userVector, limit || 50, filter);
  if (!result || !result.result) return [];

  return result.result.map(function(r) {
    return { user_id: r.payload.user_id, similarity: r.score };
  });
}

// ── Intent/Offering Collections ──

var INTENT_OFFERING_COLLECTIONS = {
  intents: 'em_user_intents',
  offerings: 'em_user_offerings'
};

async function ensureCollections() {
  try {
    await ensureCollection(INTENT_OFFERING_COLLECTIONS.intents);
    await ensureCollection(INTENT_OFFERING_COLLECTIONS.offerings);
    console.log('[vector_search] ensureCollections: intent/offering collections ready');
  } catch (err) {
    console.error('[vector_search] ensureCollections error:', err.message);
  }
}

async function embedIntentOffering(profile, user) {
  var intentId = null;
  var offeringId = null;

  try {
    // Build intent text
    var intentRaw = profile.intent;
    var intentText = '';
    if (intentRaw) {
      if (typeof intentRaw === 'string') {
        try { intentRaw = JSON.parse(intentRaw); } catch(e) {}
      }
      if (intentRaw) intentText = JSON.stringify(intentRaw);
    }
    if (profile.focus_text) intentText = intentText + ' ' + profile.focus_text;
    intentText = intentText.trim();

    if (intentText) {
      var intentVector = await getEmbedding(intentText);
      if (intentVector) {
        await upsertPoint(INTENT_OFFERING_COLLECTIONS.intents, profile.user_id, intentVector, {
          user_id: profile.user_id,
          stakeholder_type: profile.stakeholder_type,
          text: intentText.slice(0, 500)
        });
        intentId = 'intent_' + profile.user_id;
      }
    }

    // Build offering text
    var offeringRaw = profile.offering;
    var offeringText = '';
    if (offeringRaw) {
      if (typeof offeringRaw === 'string') {
        try { offeringRaw = JSON.parse(offeringRaw); } catch(e) {}
      }
      if (offeringRaw) offeringText = JSON.stringify(offeringRaw);
    }
    offeringText = offeringText.trim();

    if (offeringText) {
      var offeringVector = await getEmbedding(offeringText);
      if (offeringVector) {
        await upsertPoint(INTENT_OFFERING_COLLECTIONS.offerings, profile.user_id, offeringVector, {
          user_id: profile.user_id,
          stakeholder_type: profile.stakeholder_type,
          text: offeringText.slice(0, 500)
        });
        offeringId = 'offering_' + profile.user_id;
      }
    }
  } catch (err) {
    console.error('[vector_search] embedIntentOffering error:', err.message);
  }

  return { intentId: intentId, offeringId: offeringId };
}

async function backfillUnembeddedProfiles() {
  var success = 0;
  var failed = 0;
  try {
    var { dbAll, dbRun } = require('../db');
    var profiles = await dbAll(
      'SELECT sp.*, u.name, u.company FROM stakeholder_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.embedding_updated_at IS NULL AND (sp.stakeholder_type IS NOT NULL OR sp.focus_text IS NOT NULL OR sp.themes IS NOT NULL) ORDER BY sp.updated_at DESC'
    );
    console.log('[backfill] Found ' + profiles.length + ' profiles to embed');

    for (var i = 0; i < profiles.length; i++) {
      var profile = profiles[i];
      var user = { name: profile.name, company: profile.company };
      try {
        var vectorId = await embedProfile(profile, user);
        if (vectorId) {
          await dbRun(
            'UPDATE stakeholder_profiles SET qdrant_vector_id = $1, embedding_updated_at = NOW() WHERE user_id = $2',
            [vectorId, profile.user_id]
          );
        }
        await embedIntentOffering(profile, user);
        success++;
        console.log('[backfill] Embedded user ' + profile.user_id + ' (' + (i + 1) + '/' + profiles.length + ')');
      } catch (err) {
        failed++;
        console.error('[backfill] Failed user ' + profile.user_id + ':', err.message);
      }
      // Rate-limit OpenAI
      await new Promise(function(r) { setTimeout(r, 100); });
    }
  } catch (err) {
    console.error('[backfill] Fatal error:', err.message);
  }
  console.log('[backfill] Complete. success=' + success + ' failed=' + failed);
  return { success: success, failed: failed };
}

module.exports = {
  // Core
  getEmbedding,
  getEmbeddings,
  COLLECTIONS,

  // Qdrant ops
  initCollections,
  upsertPoint,
  upsertPoints,
  searchByVector,
  deletePoint,

  // Vector retrieval
  getPointVector,
  getPointVectors,
  findCandidates,

  // High-level embed + upsert
  embedProfile,
  buildProfileText,
  embedEvent,
  buildEventText,
  embedSignal,
  buildSignalText,
  embedSignalsBatch,

  // Intent/offering collections
  ensureCollections,
  embedIntentOffering,
  backfillUnembeddedProfiles,

  // Search
  searchSimilarProfiles,
  searchSignalsByThemes,
  searchSimilarEvents
};