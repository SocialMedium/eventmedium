// ── Companies House Adapter ──
// Category B — public feed (UK)
// Auth: Free API key (register at developer.company-information.service.gov.uk)
// Signals: director_appointment, company_filing, accounts_filed, charge_registered

var { storeSignals, rateLimit } = require('./base');
var { normalizeTheme } = require('../theme_taxonomy');

var MODULE_NAME = 'companies_house';
var BASE_URL = 'https://api.company-information.service.gov.uk';
var API_KEY = process.env.COMPANIES_HOUSE_API_KEY;
var STREAM_URL = 'https://stream.companieshouse.gov.uk';

// ── Connect (API key only) ──
async function connect(communityId, credentials) {
  // Test the connection
  if (!API_KEY && (!credentials || !credentials.api_key)) {
    throw new Error('Companies House API key required');
  }
  return { provider: MODULE_NAME, status: 'active' };
}

// ── Auth header (basic auth with API key as username, empty password) ──
function authHeaders() {
  var key = API_KEY || '';
  return {
    'Authorization': 'Basic ' + Buffer.from(key + ':').toString('base64')
  };
}

// ── Fetch raw filings ──
async function fetchRaw(communityId, since) {
  var results = [];
  if (!API_KEY) {
    console.warn('[companies_house] No API key configured');
    return results;
  }

  // Fetch recent filing history (streaming endpoint or search)
  // Use the filing search for recent items
  if (!rateLimit(MODULE_NAME, 600)) return results; // CH allows 600/5min

  // Search for recent officer appointments
  try {
    var searchUrl = BASE_URL + '/advanced-search/companies?' +
      'incorporated_from=' + (since ? new Date(since).toISOString().split('T')[0] : new Date(Date.now() - 86400000 * 7).toISOString().split('T')[0]) +
      '&size=100';
    var resp = await fetch(searchUrl, { headers: authHeaders() });
    if (resp.ok) {
      var data = await resp.json();
      results.push({ type: 'new_companies', records: (data.items || []) });
    }
  } catch (err) {
    console.error('[companies_house] Company search error:', err.message);
  }

  // Fetch recent filing events via streaming API
  if (!rateLimit(MODULE_NAME, 600)) return results;
  try {
    var filingUrl = BASE_URL + '/search/disqualified-officers?q=*&items_per_page=50';
    // Note: in production, use the streaming endpoint for real-time filings
    // For now, use the search API for recent appointments
    var officerUrl = BASE_URL + '/search/officers?q=appointed&items_per_page=100';
    var officerResp = await fetch(officerUrl, { headers: authHeaders() });
    if (officerResp.ok) {
      var officerData = await officerResp.json();
      results.push({ type: 'officer_appointments', records: (officerData.items || []) });
    }
  } catch (err) {
    console.error('[companies_house] Officer search error:', err.message);
  }

  return results;
}

// ── Map SIC codes to canonical themes ──
var SIC_THEME_MAP = {
  '62': 'Enterprise SaaS', '63': 'Data & Analytics',
  '64': 'Fintech', '65': 'Fintech', '66': 'Fintech',
  '72': 'Data & Analytics', '86': 'Health', '85': 'Education',
  '26': 'Hardware', '27': 'Hardware', '28': 'Hardware',
  '61': 'Infrastructure & Cloud', '58': 'Media & Entertainment',
  '59': 'Media & Entertainment', '60': 'Media & Entertainment',
  '35': 'Climate', '01': 'Food & Agriculture', '02': 'Food & Agriculture',
  '41': 'Real Estate', '42': 'Real Estate', '43': 'Real Estate',
  '49': 'Travel & Mobility', '50': 'Travel & Mobility', '51': 'Travel & Mobility',
  '68': 'Real Estate'
};

function sicToTheme(sicCodes) {
  if (!sicCodes || !sicCodes.length) return 'Enterprise SaaS';
  for (var i = 0; i < sicCodes.length; i++) {
    var prefix = (sicCodes[i] || '').substring(0, 2);
    if (SIC_THEME_MAP[prefix]) return SIC_THEME_MAP[prefix];
  }
  return 'Enterprise SaaS';
}

// ── Signal cost by filing type ──
var FILING_COSTS = {
  'director_appointment': 'medium',
  'director_cessation': 'medium',
  'company_incorporation': 'medium',
  'annual_return': 'low',
  'accounts': 'low',
  'charge_registered': 'medium',
  'insolvency': 'high',
  'dissolution': 'medium'
};

// ── Transform to EventMedium signals ──
async function transformToSignals(rawData, communityId) {
  var signals = [];

  for (var i = 0; i < rawData.length; i++) {
    var batch = rawData[i];

    if (batch.type === 'new_companies') {
      for (var j = 0; j < batch.records.length; j++) {
        var co = batch.records[j];
        var theme = sicToTheme(co.sic_codes);
        signals.push({
          community_id: communityId,
          source_type: 'company_filing',
          provider: MODULE_NAME,
          canonical_theme: theme,
          signal_action: 'launching',
          cost_of_signal: 'medium',
          constraint_level: 'medium',
          region: 'uk',
          jurisdiction: 'uk',
          entity_type: 'company',
          entity_name: co.company_name || co.title || 'Unknown',
          summary_raw: 'New company incorporated: ' + (co.company_name || co.title || 'unknown') +
            '. Company number: ' + (co.company_number || 'unknown') +
            '. Type: ' + (co.company_type || 'unknown'),
          timestamp: new Date(co.date_of_creation || Date.now()),
          metadata: {
            company_number: co.company_number,
            company_type: co.company_type,
            sic_codes: co.sic_codes,
            registered_office: co.registered_office_address
          }
        });
      }
    }

    if (batch.type === 'officer_appointments') {
      for (var k = 0; k < batch.records.length; k++) {
        var officer = batch.records[k];
        signals.push({
          community_id: communityId,
          source_type: 'director_appointment',
          provider: MODULE_NAME,
          canonical_theme: 'Enterprise SaaS',
          signal_action: 'partnering',
          cost_of_signal: 'medium',
          constraint_level: 'medium',
          region: 'uk',
          jurisdiction: 'uk',
          entity_type: 'company',
          entity_name: officer.snippet ? officer.snippet.replace(/<[^>]+>/g, '') : 'Unknown',
          summary_raw: 'Officer appointment: ' + (officer.title || 'unknown') +
            ' — ' + (officer.description || ''),
          timestamp: new Date(officer.appointed_on || Date.now()),
          metadata: {
            officer_role: officer.officer_role,
            appointment_type: officer.description
          }
        });
      }
    }
  }

  return signals;
}

// ── No write-back for public feeds ──
async function writeEnrichment(communityId, entityType, entityId, payload) {
  return { status: 'not_implemented', provider: MODULE_NAME };
}

module.exports = {
  name: MODULE_NAME,
  category: 'public',
  connect: connect,
  fetchRaw: fetchRaw,
  transformToSignals: transformToSignals,
  writeEnrichment: writeEnrichment
};
