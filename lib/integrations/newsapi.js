// ── NewsAPI Adapter ──
// Category B — public feed (Global)
// Auth: API key (paid) | Signals: news, press_feature

var { storeSignals, rateLimit } = require('./base');
var { normalizeTheme } = require('../theme_taxonomy');

var MODULE_NAME = 'newsapi';
var BASE_URL = 'https://newsapi.org/v2';
var API_KEY = process.env.NEWSAPI_KEY;

async function connect(communityId, credentials) {
  if (!API_KEY && (!credentials || !credentials.api_key)) {
    throw new Error('NewsAPI key required');
  }
  return { provider: MODULE_NAME, status: 'active' };
}

async function fetchRaw(communityId, since) {
  var results = [];
  var key = API_KEY;
  if (!key) return results;
  if (!rateLimit(MODULE_NAME, 500)) return results;

  try {
    var sinceDate = since ? new Date(since).toISOString().split('T')[0] : new Date(Date.now() - 86400000 * 7).toISOString().split('T')[0];
    // Fetch top headlines in business/technology
    var resp = await fetch(BASE_URL + '/everything?q=startup+OR+funding+OR+acquisition+OR+IPO&from=' + sinceDate + '&sortBy=publishedAt&pageSize=100&apiKey=' + key);
    if (resp.ok) {
      var data = await resp.json();
      results.push({ type: 'articles', records: data.articles || [] });
    }
  } catch (err) {
    console.error('[newsapi] Fetch error:', err.message);
  }

  return results;
}

async function transformToSignals(rawData, communityId) {
  var signals = [];
  for (var i = 0; i < rawData.length; i++) {
    var batch = rawData[i];
    for (var j = 0; j < (batch.records || []).length; j++) {
      var article = batch.records[j];
      var title = (article.title || '').toLowerCase();
      var action = 'publishing';
      var cost = 'medium';
      if (title.indexOf('acquisition') !== -1 || title.indexOf('acquire') !== -1) { action = 'exiting'; cost = 'high'; }
      else if (title.indexOf('ipo') !== -1 || title.indexOf('public') !== -1) { action = 'launching'; cost = 'high'; }
      else if (title.indexOf('funding') !== -1 || title.indexOf('raise') !== -1 || title.indexOf('series') !== -1) { action = 'raising'; cost = 'high'; }
      else if (title.indexOf('hiring') !== -1 || title.indexOf('hire') !== -1) { action = 'hiring'; cost = 'low'; }

      signals.push({
        community_id: communityId,
        source_type: 'news',
        provider: MODULE_NAME,
        canonical_theme: 'Growth & GTM',
        signal_action: action,
        cost_of_signal: cost,
        constraint_level: 'low',
        region: 'global',
        jurisdiction: 'global',
        entity_type: 'company',
        entity_name: article.source ? article.source.name : 'Unknown',
        summary_raw: article.title || 'News article',
        timestamp: new Date(article.publishedAt || Date.now()),
        metadata: { url: article.url, source: article.source ? article.source.name : null }
      });
    }
  }
  return signals;
}

async function writeEnrichment() { return { status: 'not_implemented', provider: MODULE_NAME }; }

module.exports = { name: MODULE_NAME, category: 'public', connect: connect, fetchRaw: fetchRaw, transformToSignals: transformToSignals, writeEnrichment: writeEnrichment };
