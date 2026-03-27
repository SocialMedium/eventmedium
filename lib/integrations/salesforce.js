// ── Salesforce Adapter ──
// Category A — owner-controlled
// Auth: OAuth2 | Signals: company_activity, deal_stage, contact_segment
// Write: Full implementation for enrichment write-back

var { decryptCredentials, encryptCredentials, storeSignals, updateSyncStatus, rateLimit } = require('./base');
var { normalizeTheme } = require('../theme_taxonomy');
var { dbGet, dbRun } = require('../../db');

var MODULE_NAME = 'salesforce';
var CLIENT_ID = process.env.SALESFORCE_CLIENT_ID;
var CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET;

// ── OAuth connect ──
async function connect(communityId, credentials) {
  return encryptCredentials({
    access_token: credentials.access_token,
    refresh_token: credentials.refresh_token,
    instance_url: credentials.instance_url,
    expires_at: credentials.expires_at
  });
}

// ── Refresh token if expired ──
async function getAccessToken(integrationId) {
  var row = await dbGet('SELECT credentials FROM community_integrations WHERE id = $1', [integrationId]);
  if (!row) throw new Error('Integration not found');
  var creds = decryptCredentials(row.credentials);
  if (!creds) throw new Error('Failed to decrypt credentials');

  if (creds.expires_at && Date.now() < creds.expires_at - 300000) {
    return { token: creds.access_token, url: creds.instance_url };
  }

  var resp = await fetch('https://login.salesforce.com/services/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: creds.refresh_token
    })
  });

  if (!resp.ok) throw new Error('Salesforce token refresh failed: ' + resp.status);
  var data = await resp.json();

  var newCreds = encryptCredentials({
    access_token: data.access_token,
    refresh_token: creds.refresh_token,
    instance_url: data.instance_url || creds.instance_url,
    expires_at: Date.now() + 7200000
  });
  await dbRun('UPDATE community_integrations SET credentials = $1 WHERE id = $2',
    [JSON.stringify(newCreds), integrationId]);

  return { token: data.access_token, url: data.instance_url || creds.instance_url };
}

// ── Fetch raw data ──
async function fetchRaw(communityId, since) {
  var integration = await dbGet(
    'SELECT * FROM community_integrations WHERE community_id = $1 AND provider = $2 AND enabled = true',
    [communityId, MODULE_NAME]
  );
  if (!integration) return [];

  var auth = await getAccessToken(integration.id);
  var results = [];
  var sinceDate = since ? new Date(since).toISOString() : new Date(Date.now() - 86400000 * 30).toISOString();

  // Fetch recently modified accounts
  if (!rateLimit(MODULE_NAME, 100)) return results;
  try {
    var query = encodeURIComponent(
      "SELECT Id, Name, Industry, BillingCity, BillingCountry, NumberOfEmployees, AnnualRevenue, Description, LastModifiedDate " +
      "FROM Account WHERE LastModifiedDate >= " + sinceDate + " ORDER BY LastModifiedDate DESC LIMIT 100"
    );
    var resp = await fetch(auth.url + '/services/data/v59.0/query/?q=' + query, {
      headers: { 'Authorization': 'Bearer ' + auth.token }
    });
    if (resp.ok) {
      var data = await resp.json();
      results.push({ type: 'accounts', records: data.records || [] });
    }
  } catch (err) {
    console.error('[salesforce] Account fetch error:', err.message);
  }

  // Fetch recently modified opportunities
  if (!rateLimit(MODULE_NAME, 100)) return results;
  try {
    var oppQuery = encodeURIComponent(
      "SELECT Id, Name, StageName, Amount, CloseDate, LastModifiedDate " +
      "FROM Opportunity WHERE LastModifiedDate >= " + sinceDate + " ORDER BY LastModifiedDate DESC LIMIT 100"
    );
    var oppResp = await fetch(auth.url + '/services/data/v59.0/query/?q=' + oppQuery, {
      headers: { 'Authorization': 'Bearer ' + auth.token }
    });
    if (oppResp.ok) {
      var oppData = await oppResp.json();
      results.push({ type: 'opportunities', records: oppData.records || [] });
    }
  } catch (err) {
    console.error('[salesforce] Opportunity fetch error:', err.message);
  }

  await updateSyncStatus(integration.id, 'synced');
  return results;
}

// ── Transform to EventMedium signals ──
async function transformToSignals(rawData, communityId) {
  var signals = [];

  for (var i = 0; i < rawData.length; i++) {
    var batch = rawData[i];

    if (batch.type === 'accounts') {
      for (var j = 0; j < batch.records.length; j++) {
        var acct = batch.records[j];
        var theme = normalizeTheme(acct.Industry) || 'Enterprise SaaS';
        signals.push({
          community_id: communityId,
          source_type: 'company_activity',
          provider: MODULE_NAME,
          canonical_theme: theme,
          signal_action: 'partnering',
          cost_of_signal: 'low',
          constraint_level: 'low',
          region: acct.BillingCountry || 'global',
          jurisdiction: 'global',
          entity_type: 'company',
          entity_name: acct.Name || 'Unknown',
          summary_raw: 'Account activity: ' + (acct.Name || 'unknown') + ' in ' + (acct.Industry || 'unknown sector'),
          timestamp: new Date(acct.LastModifiedDate || Date.now()),
          metadata: { employees: acct.NumberOfEmployees, revenue: acct.AnnualRevenue, city: acct.BillingCity }
        });
      }
    }

    if (batch.type === 'opportunities') {
      for (var k = 0; k < batch.records.length; k++) {
        var opp = batch.records[k];
        var amount = parseFloat(opp.Amount) || 0;
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
          entity_name: opp.Name || 'Unknown',
          summary_raw: 'Opportunity: ' + (opp.Name || 'unknown') + ' stage ' + (opp.StageName || 'unknown'),
          timestamp: new Date(opp.LastModifiedDate || Date.now()),
          metadata: { stage: opp.StageName, amount: opp.Amount, close_date: opp.CloseDate }
        });
      }
    }
  }

  return signals;
}

// ── Write enrichment back to Salesforce ──
async function writeEnrichment(communityId, entityType, entityId, payload) {
  var integration = await dbGet(
    'SELECT * FROM community_integrations WHERE community_id = $1 AND provider = $2 AND enabled = true',
    [communityId, MODULE_NAME]
  );
  if (!integration) return { status: 'not_connected', provider: MODULE_NAME };

  var tenant = await dbGet(
    'SELECT write_enrichment_enabled FROM community_tenants WHERE community_id = $1',
    [communityId]
  );
  if (!tenant || !tenant.write_enrichment_enabled) {
    return { status: 'write_disabled', provider: MODULE_NAME };
  }

  var auth = await getAccessToken(integration.id);

  // Allowed-list check
  var ALLOWED_FIELDS_CONTACT = [
    'Title', 'Department', 'MailingCity', 'MailingCountry',
    'EM_Signal_Score__c', 'EM_Last_Signal_Date__c', 'EM_Themes__c'
  ];
  var ALLOWED_FIELDS_ACCOUNT = [
    'Industry', 'EM_Funding_Stage__c', 'EM_Hiring_Velocity__c',
    'EM_Patent_Activity__c', 'EM_News_Velocity__c', 'EM_Theme_Heat__c'
  ];

  var sobject, fields, allowedList;
  if (entityType === 'person') {
    sobject = 'Contact';
    allowedList = ALLOWED_FIELDS_CONTACT;
  } else if (entityType === 'company') {
    sobject = 'Account';
    allowedList = ALLOWED_FIELDS_ACCOUNT;
  } else {
    return { status: 'unsupported_entity_type', provider: MODULE_NAME };
  }

  fields = {};
  for (var key in payload) {
    if (allowedList.indexOf(key) !== -1) fields[key] = payload[key];
  }
  if (Object.keys(fields).length === 0) {
    return { status: 'no_allowed_fields', provider: MODULE_NAME };
  }

  if (!rateLimit(MODULE_NAME, 100)) {
    return { status: 'rate_limited', provider: MODULE_NAME };
  }

  try {
    var resp = await fetch(auth.url + '/services/data/v59.0/sobjects/' + sobject + '/' + entityId, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + auth.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(fields)
    });

    if (!resp.ok && resp.status !== 204) {
      var errText = await resp.text();
      console.error('[salesforce] Write-back failed:', resp.status, errText);
      return { status: 'error', provider: MODULE_NAME, error: resp.status };
    }

    return { status: 'written', provider: MODULE_NAME, entity_type: entityType };
  } catch (err) {
    console.error('[salesforce] Write-back error:', err.message);
    return { status: 'error', provider: MODULE_NAME, error: err.message };
  }
}

module.exports = {
  name: MODULE_NAME,
  category: 'owner_controlled',
  connect: connect,
  fetchRaw: fetchRaw,
  transformToSignals: transformToSignals,
  writeEnrichment: writeEnrichment
};
