// ── Crunchbase Adapter ──
// Category B — public feed (Global)
// Auth: API key (paid) | Signals: funding_round, m_and_a, ipo_filing

var { storeSignals, rateLimit } = require('./base');
var { normalizeTheme } = require('../theme_taxonomy');

var MODULE_NAME = 'crunchbase';
var BASE_URL = 'https://api.crunchbase.com/api/v4';
var API_KEY = process.env.CRUNCHBASE_API_KEY;

async function connect(communityId, credentials) {
  if (!API_KEY && (!credentials || !credentials.api_key)) {
    throw new Error('Crunchbase API key required');
  }
  return { provider: MODULE_NAME, status: 'active' };
}

async function fetchRaw(communityId, since) {
  var results = [];
  var key = API_KEY;
  if (!key) return results;
  if (!rateLimit(MODULE_NAME, 200)) return results;

  try {
    var sinceDate = since ? new Date(since).toISOString().split('T')[0] : new Date(Date.now() - 86400000 * 7).toISOString().split('T')[0];
    var resp = await fetch(BASE_URL + '/searches/funding_rounds', {
      method: 'POST',
      headers: { 'X-cb-user-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        field_ids: ['identifier', 'funded_organization_identifier', 'money_raised', 'investment_type', 'announced_on', 'num_investors'],
        query: [{ type: 'predicate', field_id: 'announced_on', operator_id: 'gte', values: [sinceDate] }],
        order: [{ field_id: 'announced_on', sort: 'desc' }],
        limit: 100
      })
    });
    if (resp.ok) {
      var data = await resp.json();
      results.push({ type: 'funding_rounds', records: data.entities || [] });
    }
  } catch (err) {
    console.error('[crunchbase] Fetch error:', err.message);
  }

  return results;
}

async function transformToSignals(rawData, communityId) {
  var signals = [];
  for (var i = 0; i < rawData.length; i++) {
    var batch = rawData[i];
    for (var j = 0; j < (batch.records || []).length; j++) {
      var round = batch.records[j].properties || batch.records[j];
      var amount = round.money_raised ? round.money_raised.value : 0;
      var cost = amount > 10000000 ? 'high' : amount > 1000000 ? 'medium' : 'low';
      var investmentType = round.investment_type || 'unknown';
      var theme = normalizeTheme(investmentType) || 'Venture & Capital';

      signals.push({
        community_id: communityId,
        source_type: 'funding_round',
        provider: MODULE_NAME,
        canonical_theme: theme,
        signal_action: 'raising',
        cost_of_signal: cost,
        constraint_level: cost,
        region: 'global',
        jurisdiction: 'global',
        entity_type: 'company',
        entity_name: round.funded_organization_identifier ? round.funded_organization_identifier.value : 'Unknown',
        summary_raw: 'Funding round: ' + (investmentType) + ' — ' + (round.funded_organization_identifier ? round.funded_organization_identifier.value : 'unknown'),
        timestamp: new Date(round.announced_on || Date.now()),
        metadata: { amount: amount, investment_type: investmentType, num_investors: round.num_investors }
      });
    }
  }
  return signals;
}

async function writeEnrichment() { return { status: 'not_implemented', provider: MODULE_NAME }; }

module.exports = { name: MODULE_NAME, category: 'public', connect: connect, fetchRaw: fetchRaw, transformToSignals: transformToSignals, writeEnrichment: writeEnrichment };
