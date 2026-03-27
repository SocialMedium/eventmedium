// ── Stub Adapters ──
// Providers with connect + fetchRaw stubs, ready for full implementation.
// Each exports the standard interface. Write-back stubs return not_implemented.

var { encryptCredentials } = require('./base');

function createStubAdapter(name, category) {
  return {
    name: name,
    category: category,
    connect: async function(communityId, credentials) {
      if (credentials && Object.keys(credentials).length > 0) {
        return encryptCredentials(credentials);
      }
      return { provider: name, status: 'active' };
    },
    fetchRaw: async function(communityId, since) {
      console.log('[' + name + '] Adapter not yet fully implemented — returning empty');
      return [];
    },
    transformToSignals: async function(rawData, communityId) {
      return [];
    },
    writeEnrichment: async function(communityId, entityType, entityId, payload) {
      return { status: 'not_implemented', provider: name };
    }
  };
}

// Category A stubs
module.exports.mailchimp = createStubAdapter('mailchimp', 'owner_controlled');
module.exports.beehiiv = createStubAdapter('beehiiv', 'owner_controlled');
module.exports.eventbrite = createStubAdapter('eventbrite', 'owner_controlled');
module.exports.luma = createStubAdapter('luma', 'owner_controlled');
module.exports.circle = createStubAdapter('circle', 'owner_controlled');
module.exports.hivebrite = createStubAdapter('hivebrite', 'owner_controlled');
module.exports.wild_apricot = createStubAdapter('wild_apricot', 'owner_controlled');
module.exports.glue_up = createStubAdapter('glue_up', 'owner_controlled');
module.exports.slack = createStubAdapter('slack', 'owner_controlled');
module.exports.typeform = createStubAdapter('typeform', 'owner_controlled');
module.exports.xero = createStubAdapter('xero', 'owner_controlled');
module.exports.google_calendar = createStubAdapter('google_calendar', 'owner_controlled');

// Category B stubs
module.exports.london_gazette = createStubAdapter('london_gazette', 'public');
module.exports.asic = createStubAdapter('asic', 'public');
module.exports.abn_lookup = createStubAdapter('abn_lookup', 'public');
module.exports.asx = createStubAdapter('asx', 'public');
module.exports.acra = createStubAdapter('acra', 'public');
module.exports.sgx = createStubAdapter('sgx', 'public');
module.exports.opencorporates = createStubAdapter('opencorporates', 'public');
module.exports.au_gazette = createStubAdapter('au_gazette', 'public');
module.exports.sg_gazette = createStubAdapter('sg_gazette', 'public');
module.exports.semantic_scholar = createStubAdapter('semantic_scholar', 'public');
module.exports.arc_grants = createStubAdapter('arc_grants', 'public');
module.exports.ukri = createStubAdapter('ukri', 'public');
module.exports.nsf = createStubAdapter('nsf', 'public');
module.exports.hm_land_registry = createStubAdapter('hm_land_registry', 'public');
module.exports.ura_sg = createStubAdapter('ura_sg', 'public');
module.exports.uspto = createStubAdapter('uspto', 'public');
module.exports.rss = createStubAdapter('rss', 'public');
