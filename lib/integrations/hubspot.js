// ── HubSpot Adapter ──
// Category A — owner-controlled
// Auth: OAuth2 | Signals: company_activity, deal_stage, contact_segment
// Write: Full implementation for enrichment write-back

var { decryptCredentials, encryptCredentials, storeSignals, updateSyncStatus, rateLimit } = require('./base');
var { normalizeTheme } = require('../theme_taxonomy');
var { dbGet, dbRun } = require('../../db');

var MODULE_NAME = 'hubspot';
var BASE_URL = 'https://api.hubapi.com';
var CLIENT_ID = process.env.HUBSPOT_CLIENT_ID;
var CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET;

// ── OAuth connect ──
async function connect(communityId, credentials) {
  // credentials: { access_token, refresh_token, expires_at } from OAuth callback
  return encryptCredentials({
    access_token: credentials.access_token,
    refresh_token: credentials.refresh_token,
    expires_at: credentials.expires_at
  });
}

// ── Refresh token if expired ──
async function getAccessToken(integrationId) {
  var row = await dbGet('SELECT credentials FROM community_integrations WHERE id = $1', [integrationId]);
  if (!row) throw new Error('Integration not found');
  var creds = decryptCredentials(row.credentials);
  if (!creds) throw new Error('Failed to decrypt credentials');

  // Check expiry (with 5min buffer)
  if (creds.expires_at && Date.now() < creds.expires_at - 300000) {
    return creds.access_token;
  }

  // Refresh
  var resp = await fetch(BASE_URL + '/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: creds.refresh_token
    })
  });

  if (!resp.ok) throw new Error('HubSpot token refresh failed: ' + resp.status);
  var data = await resp.json();

  var newCreds = encryptCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in * 1000)
  });
  await dbRun('UPDATE community_integrations SET credentials = $1 WHERE id = $2',
    [JSON.stringify(newCreds), integrationId]);

  return data.access_token;
}

// ── Fetch raw data ──
async function fetchRaw(communityId, since) {
  var integration = await dbGet(
    'SELECT * FROM community_integrations WHERE community_id = $1 AND provider = $2 AND enabled = true',
    [communityId, MODULE_NAME]
  );
  if (!integration) return [];

  var token = await getAccessToken(integration.id);
  var results = [];

  // Fetch recently modified companies
  if (!rateLimit(MODULE_NAME, 100)) return results;
  try {
    var sinceMs = since ? new Date(since).getTime() : Date.now() - 86400000 * 30;
    var resp = await fetch(BASE_URL + '/crm/v3/objects/companies/search', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: 'hs_lastmodifieddate',
            operator: 'GTE',
            value: sinceMs.toString()
          }]
        }],
        properties: ['name', 'industry', 'city', 'country', 'numberofemployees',
                     'annualrevenue', 'description', 'hs_lastmodifieddate'],
        limit: 100
      })
    });
    if (resp.ok) {
      var data = await resp.json();
      results.push({ type: 'companies', records: data.results || [] });
    }
  } catch (err) {
    console.error('[hubspot] Company fetch error:', err.message);
  }

  // Fetch recently updated deals
  if (!rateLimit(MODULE_NAME, 100)) return results;
  try {
    var resp2 = await fetch(BASE_URL + '/crm/v3/objects/deals/search', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: 'hs_lastmodifieddate',
            operator: 'GTE',
            value: (since ? new Date(since).getTime() : Date.now() - 86400000 * 30).toString()
          }]
        }],
        properties: ['dealname', 'dealstage', 'amount', 'closedate',
                     'pipeline', 'hs_lastmodifieddate'],
        limit: 100
      })
    });
    if (resp2.ok) {
      var dealData = await resp2.json();
      results.push({ type: 'deals', records: dealData.results || [] });
    }
  } catch (err) {
    console.error('[hubspot] Deal fetch error:', err.message);
  }

  await updateSyncStatus(integration.id, 'synced');
  return results;
}

// ── Transform to EventMedium signals ──
async function transformToSignals(rawData, communityId) {
  var signals = [];

  for (var i = 0; i < rawData.length; i++) {
    var batch = rawData[i];

    if (batch.type === 'companies') {
      for (var j = 0; j < batch.records.length; j++) {
        var co = batch.records[j].properties || {};
        var theme = normalizeTheme(co.industry) || 'Enterprise SaaS';
        signals.push({
          community_id: communityId,
          source_type: 'company_activity',
          provider: MODULE_NAME,
          canonical_theme: theme,
          signal_action: 'partnering',
          cost_of_signal: 'low',
          constraint_level: 'low',
          region: co.country || 'global',
          jurisdiction: 'global',
          entity_type: 'company',
          entity_name: co.name || 'Unknown',
          summary_raw: 'Company activity detected: ' + (co.name || 'unknown') + ' in ' + (co.industry || 'unknown sector'),
          timestamp: new Date(parseInt(co.hs_lastmodifieddate) || Date.now()),
          metadata: {
            employees: co.numberofemployees,
            revenue: co.annualrevenue,
            city: co.city
          }
        });
      }
    }

    if (batch.type === 'deals') {
      for (var k = 0; k < batch.records.length; k++) {
        var deal = batch.records[k].properties || {};
        var amount = parseFloat(deal.amount) || 0;
        var cost = amount > 1000000 ? 'high' : amount > 100000 ? 'medium' : 'low';
        signals.push({
          community_id: communityId,
          source_type: 'deal_stage',
          provider: MODULE_NAME,
          canonical_theme: 'Venture & Capital',
          signal_action: 'raising',
          cost_of_signal: cost,
          constraint_level: 'medium',
          region: 'global',
          jurisdiction: 'global',
          entity_type: 'company',
          entity_name: deal.dealname || 'Unknown deal',
          summary_raw: 'Deal activity: ' + (deal.dealname || 'unknown') + ' stage ' + (deal.dealstage || 'unknown'),
          timestamp: new Date(parseInt(deal.hs_lastmodifieddate) || Date.now()),
          metadata: {
            stage: deal.dealstage,
            amount: deal.amount,
            pipeline: deal.pipeline
          }
        });
      }
    }
  }

  return signals;
}

// ── Write enrichment back to HubSpot ──
// Full implementation — ops-activated only
async function writeEnrichment(communityId, entityType, entityId, payload) {
  var integration = await dbGet(
    'SELECT * FROM community_integrations WHERE community_id = $1 AND provider = $2 AND enabled = true',
    [communityId, MODULE_NAME]
  );
  if (!integration) return { status: 'not_connected', provider: MODULE_NAME };

  // Verify write-back is enabled for this community
  var tenant = await dbGet(
    'SELECT write_enrichment_enabled FROM community_tenants WHERE community_id = $1',
    [communityId]
  );
  if (!tenant || !tenant.write_enrichment_enabled) {
    return { status: 'write_disabled', provider: MODULE_NAME };
  }

  var token = await getAccessToken(integration.id);

  // Allowed-list check: only public signal data
  var ALLOWED_FIELDS_PERSON = [
    'jobtitle', 'company', 'industry', 'city', 'state', 'country',
    'em_signal_score', 'em_last_signal_date', 'em_themes'
  ];
  var ALLOWED_FIELDS_COMPANY = [
    'industry', 'em_funding_stage', 'em_hiring_velocity', 'em_patent_activity',
    'em_news_velocity', 'em_theme_heat', 'em_jurisdiction'
  ];

  var objectType, properties;

  if (entityType === 'person') {
    objectType = 'contacts';
    properties = {};
    for (var key in payload) {
      if (ALLOWED_FIELDS_PERSON.indexOf(key) !== -1) {
        properties[key] = payload[key];
      }
    }
  } else if (entityType === 'company') {
    objectType = 'companies';
    properties = {};
    for (var key2 in payload) {
      if (ALLOWED_FIELDS_COMPANY.indexOf(key2) !== -1) {
        properties[key2] = payload[key2];
      }
    }
  } else if (entityType === 'event') {
    // Events written as notes on company records
    objectType = 'notes';
    properties = {
      hs_note_body: 'EventMedium Signal: ' + (payload.summary || 'Event intelligence update'),
      hs_timestamp: Date.now().toString()
    };
  } else {
    return { status: 'unsupported_entity_type', provider: MODULE_NAME };
  }

  if (Object.keys(properties).length === 0) {
    return { status: 'no_allowed_fields', provider: MODULE_NAME };
  }

  if (!rateLimit(MODULE_NAME, 100)) {
    return { status: 'rate_limited', provider: MODULE_NAME };
  }

  try {
    var resp = await fetch(BASE_URL + '/crm/v3/objects/' + objectType + '/' + entityId, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ properties: properties })
    });

    if (!resp.ok) {
      var errText = await resp.text();
      console.error('[hubspot] Write-back failed:', resp.status, errText);
      return { status: 'error', provider: MODULE_NAME, error: resp.status };
    }

    return { status: 'written', provider: MODULE_NAME, entity_type: entityType };
  } catch (err) {
    console.error('[hubspot] Write-back error:', err.message);
    return { status: 'error', provider: MODULE_NAME, error: err.message };
  }
}

// ── Fetch contacts for community import ──
async function fetchContacts(communityId) {
  var integration = await dbGet(
    'SELECT * FROM community_integrations WHERE community_id = $1 AND provider = $2 AND enabled = true',
    [communityId, MODULE_NAME]
  );
  if (!integration) return [];

  var token = await getAccessToken(integration.id);
  if (!rateLimit(MODULE_NAME, 100)) return [];

  try {
    var resp = await fetch(BASE_URL + '/crm/v3/objects/contacts?limit=100&properties=email,firstname,lastname,jobtitle,company,country,website,linkedin', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!resp.ok) return [];
    var data = await resp.json();
    return (data.results || []).map(function(c) {
      var p = c.properties || {};
      return {
        email: p.email || '',
        first_name: p.firstname || '',
        last_name: p.lastname || '',
        role_title: p.jobtitle || '',
        company_name: p.company || '',
        company_country: p.country || '',
        company_domain: p.website || '',
        linkedin_url: p.linkedin || '',
        source_record_id: c.id
      };
    }).filter(function(c) { return c.email; });
  } catch (err) {
    console.error('[hubspot] fetchContacts error:', err.message);
    return [];
  }
}

module.exports = {
  name: MODULE_NAME,
  category: 'owner_controlled',
  connect: connect,
  fetchRaw: fetchRaw,
  transformToSignals: transformToSignals,
  writeEnrichment: writeEnrichment,
  fetchContacts: fetchContacts
};
