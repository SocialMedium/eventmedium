// ── SEC EDGAR Adapter ──
// Category B — public feed (US)
// Auth: Free | Signals: company_filing, insider_trade, ipo_filing, material_event

var { storeSignals, rateLimit } = require('./base');
var { normalizeTheme } = require('../theme_taxonomy');

var MODULE_NAME = 'sec_edgar';
var BASE_URL = 'https://efts.sec.gov/LATEST';
var FULL_TEXT_URL = 'https://efts.sec.gov/LATEST/search-index';

async function connect(communityId, credentials) {
  return { provider: MODULE_NAME, status: 'active' };
}

async function fetchRaw(communityId, since) {
  var results = [];
  if (!rateLimit(MODULE_NAME, 10)) return results; // SEC: 10 req/sec max

  try {
    var sinceDate = since ? new Date(since).toISOString().split('T')[0] : new Date(Date.now() - 86400000 * 7).toISOString().split('T')[0];
    // Recent filings search
    var resp = await fetch(BASE_URL + '/search-index?q=%22form%204%22&dateRange=custom&startdt=' + sinceDate + '&enddt=' + new Date().toISOString().split('T')[0], {
      headers: { 'User-Agent': 'EventMedium signals@eventmedium.ai', 'Accept': 'application/json' }
    });
    if (resp.ok) {
      var data = await resp.json();
      results.push({ type: 'filings', records: (data.hits || data.filings || []).slice(0, 100) });
    }
  } catch (err) {
    console.error('[sec_edgar] Fetch error:', err.message);
  }

  // Form 4 (insider trades)
  if (!rateLimit(MODULE_NAME, 10)) return results;
  try {
    var form4Resp = await fetch('https://efts.sec.gov/LATEST/search-index?q=%22form+4%22&forms=4&dateRange=custom&startdt=' + (since ? new Date(since).toISOString().split('T')[0] : new Date(Date.now() - 86400000 * 3).toISOString().split('T')[0]), {
      headers: { 'User-Agent': 'EventMedium signals@eventmedium.ai', 'Accept': 'application/json' }
    });
    if (form4Resp.ok) {
      var form4Data = await form4Resp.json();
      results.push({ type: 'insider_trades', records: (form4Data.hits || form4Data.filings || []).slice(0, 50) });
    }
  } catch (err) {
    console.error('[sec_edgar] Form 4 fetch error:', err.message);
  }

  return results;
}

async function transformToSignals(rawData, communityId) {
  var signals = [];
  for (var i = 0; i < rawData.length; i++) {
    var batch = rawData[i];
    for (var j = 0; j < (batch.records || []).length; j++) {
      var filing = batch.records[j];
      var isInsider = batch.type === 'insider_trades';
      signals.push({
        community_id: communityId,
        source_type: isInsider ? 'insider_trade' : 'company_filing',
        provider: MODULE_NAME,
        canonical_theme: 'Venture & Capital',
        signal_action: isInsider ? 'filing' : 'filing',
        cost_of_signal: isInsider ? 'high' : 'medium',
        constraint_level: 'high',
        region: 'us',
        jurisdiction: 'us',
        entity_type: 'company',
        entity_name: filing.entity_name || filing.display_names || 'Unknown',
        summary_raw: (isInsider ? 'Insider trade filing: ' : 'SEC filing: ') + (filing.entity_name || filing.file_description || ''),
        timestamp: new Date(filing.file_date || filing.date_filed || Date.now()),
        metadata: { form_type: filing.form_type, file_number: filing.file_num }
      });
    }
  }
  return signals;
}

async function writeEnrichment() { return { status: 'not_implemented', provider: MODULE_NAME }; }

module.exports = { name: MODULE_NAME, category: 'public', connect: connect, fetchRaw: fetchRaw, transformToSignals: transformToSignals, writeEnrichment: writeEnrichment };
