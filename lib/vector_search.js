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

  // High-level embed + upsert
  embedProfile,
  buildProfileText,
  embedEvent,
  buildEventText,
  embedSignal,
  buildSignalText,
  embedSignalsBatch,

  // Search
  searchSimilarProfiles,
  searchSignalsByThemes,
  searchSimilarEvents
};
