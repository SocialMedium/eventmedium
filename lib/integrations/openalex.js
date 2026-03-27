// ── OpenAlex Adapter ──
// Category B — public feed
// Auth: Free (email param for polite pool)
// Signals: publication, grant_award, research activity

var { storeSignals, rateLimit } = require('./base');
var { normalizeTheme } = require('../theme_taxonomy');

var MODULE_NAME = 'openalex';
var BASE_URL = 'https://api.openalex.org';
var POLITE_EMAIL = process.env.OPENALEX_EMAIL || 'signals@eventmedium.ai';

// ── Connect (no credentials needed) ──
async function connect(communityId, credentials) {
  return { provider: MODULE_NAME, status: 'active' };
}

// ── Fetch raw works and authors ──
async function fetchRaw(communityId, since) {
  var results = [];
  var sinceDate = since ? new Date(since).toISOString().split('T')[0] : new Date(Date.now() - 86400000 * 30).toISOString().split('T')[0];

  // Fetch recent high-cited works
  if (!rateLimit(MODULE_NAME, 10)) return results;
  try {
    var url = BASE_URL + '/works?filter=from_publication_date:' + sinceDate +
      ',cited_by_count:>5&sort=publication_date:desc&per_page=100' +
      '&mailto=' + encodeURIComponent(POLITE_EMAIL);
    var resp = await fetch(url);
    if (resp.ok) {
      var data = await resp.json();
      results.push({ type: 'works', records: data.results || [] });
    }
  } catch (err) {
    console.error('[openalex] Works fetch error:', err.message);
  }

  // Fetch recent grants (funders)
  if (!rateLimit(MODULE_NAME, 10)) return results;
  try {
    var grantUrl = BASE_URL + '/funders?sort=works_count:desc&per_page=50' +
      '&mailto=' + encodeURIComponent(POLITE_EMAIL);
    var grantResp = await fetch(grantUrl);
    if (grantResp.ok) {
      var grantData = await grantResp.json();
      results.push({ type: 'funders', records: grantData.results || [] });
    }
  } catch (err) {
    console.error('[openalex] Funders fetch error:', err.message);
  }

  return results;
}

// ── Map OpenAlex concepts to canonical themes ──
function mapConceptToTheme(concepts) {
  if (!concepts || !concepts.length) return 'Data & Analytics';
  // OpenAlex concepts are hierarchical; use top-level
  var conceptNames = concepts.map(function(c) { return c.display_name || ''; });
  for (var i = 0; i < conceptNames.length; i++) {
    var theme = normalizeTheme(conceptNames[i]);
    if (theme) return theme;
  }
  return 'Data & Analytics';
}

// ── Transform to EventMedium signals ──
async function transformToSignals(rawData, communityId) {
  var signals = [];

  for (var i = 0; i < rawData.length; i++) {
    var batch = rawData[i];

    if (batch.type === 'works') {
      for (var j = 0; j < batch.records.length; j++) {
        var work = batch.records[j];
        var citedBy = work.cited_by_count || 0;
        var cost = citedBy > 50 ? 'high' : citedBy > 10 ? 'medium' : 'low';
        var theme = mapConceptToTheme(work.concepts);

        // Extract institution names (no individual author names)
        var institutions = [];
        if (work.authorships) {
          for (var k = 0; k < work.authorships.length; k++) {
            var auth = work.authorships[k];
            if (auth.institutions) {
              for (var m = 0; m < auth.institutions.length; m++) {
                var instName = auth.institutions[m].display_name;
                if (instName && institutions.indexOf(instName) === -1) {
                  institutions.push(instName);
                }
              }
            }
          }
        }

        signals.push({
          community_id: communityId,
          source_type: 'publication',
          provider: MODULE_NAME,
          canonical_theme: theme,
          signal_action: 'publishing',
          cost_of_signal: cost,
          constraint_level: cost === 'high' ? 'high' : 'medium',
          region: 'global',
          jurisdiction: 'global',
          entity_type: 'institution',
          entity_name: institutions[0] || 'Unknown institution',
          summary_raw: (work.title || 'Untitled') + '. Published in ' +
            (work.primary_location && work.primary_location.source ? work.primary_location.source.display_name : 'unknown journal') +
            '. Cited by ' + citedBy + '.',
          timestamp: new Date(work.publication_date || Date.now()),
          metadata: {
            doi: work.doi,
            cited_by_count: citedBy,
            open_access: work.open_access ? work.open_access.is_oa : false,
            institutions: institutions.slice(0, 5),
            concepts: (work.concepts || []).slice(0, 5).map(function(c) { return c.display_name; })
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
