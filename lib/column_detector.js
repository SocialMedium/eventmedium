// ── Column Auto-Detection ──
// Maps uploaded column names to EventMedium contact fields.

var COLUMN_PATTERNS = {
  email: [/email/i, /e-mail/i, /email.address/i],
  first_name: [/first.?name/i, /given.?name/i, /forename/i, /^first$/i],
  last_name: [/last.?name/i, /surname/i, /family.?name/i, /^last$/i],
  name: [/^name$/i, /full.?name/i, /contact.?name/i, /display.?name/i],
  company_name: [/company/i, /organisation/i, /organization/i, /employer/i, /account.?name/i, /firm/i],
  role_title: [/title/i, /job.?title/i, /^role$/i, /position/i, /function/i],
  company_country: [/country/i, /nation/i, /^location$/i],
  company_domain: [/domain/i, /website/i, /^url$/i, /^web$/i],
  linkedin_url: [/linkedin/i],
  owner_notes: [/notes?/i, /comments?/i, /^description$/i],
  tags: [/tags?/i, /labels?/i, /categories/i]
};

function detectMapping(columns) {
  var mapping = {};
  var confidence = {};
  for (var c = 0; c < columns.length; c++) {
    var col = columns[c];
    var fields = Object.keys(COLUMN_PATTERNS);
    for (var f = 0; f < fields.length; f++) {
      var field = fields[f];
      var patterns = COLUMN_PATTERNS[field];
      var matched = false;
      for (var p = 0; p < patterns.length; p++) {
        if (patterns[p].test(col)) { matched = true; break; }
      }
      if (matched) {
        mapping[col] = field;
        confidence[col] = 'high';
        break;
      }
    }
  }
  var unmapped = columns.filter(function(c) { return !mapping[c]; });
  return {
    mapping: mapping,
    confidence: confidence,
    unmapped: unmapped,
    complete: !!mapping[Object.keys(mapping).find(function(k) { return mapping[k] === 'email'; })]
  };
}

module.exports = { detectMapping };
