// ── Integration Adapter Registry ──
// Centralised loader. require('../lib/integrations/' + provider) will
// try the named file first; this index serves as fallback lookup.

var stubs = require('./stubs');

// Full adapters
var fullAdapters = {
  hubspot: require('./hubspot'),
  salesforce: require('./salesforce'),
  openalex: require('./openalex'),
  companies_house: require('./companies_house'),
  sec_edgar: require('./sec_edgar'),
  crunchbase: require('./crunchbase'),
  newsapi: require('./newsapi')
};

// Merge: full adapters override stubs
var all = Object.assign({}, stubs, fullAdapters);

module.exports = all;

// Also export a getAdapter helper
module.exports.getAdapter = function(provider) {
  return all[provider] || null;
};
