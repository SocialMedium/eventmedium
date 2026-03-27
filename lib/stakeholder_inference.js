// ── Stakeholder Type & Theme Inference ──
// Infers stakeholder type and canonical themes from role title and company context.

var { normalizeTheme } = require('./theme_taxonomy');

var ROLE_PATTERNS = [
  { type: 'founder', patterns: [/founder/i, /co-founder/i, /\bceo\b/i, /chief executive/i, /entrepreneur/i] },
  { type: 'investor', patterns: [/partner.*fund/i, /partner.*capital/i, /partner.*venture/i, /principal/i, /venture/i, /\bvc\b/i, /private equity/i, /\bpe\b/i, /angel/i, /fund manager/i, /portfolio/i, /investment director/i, /general partner/i, /limited partner/i] },
  { type: 'researcher', patterns: [/professor/i, /research fellow/i, /\bphd\b/i, /postdoc/i, /scientist/i, /research director/i, /chief scientist/i, /academic/i, /lecturer/i, /associate professor/i] },
  { type: 'corporate', patterns: [/\bvp\b/i, /vice president/i, /director/i, /head of/i, /\bcto\b/i, /\bcoo\b/i, /\bcfo\b/i, /\bcmo\b/i, /managing director/i, /general manager/i, /president/i] },
  { type: 'advisor', patterns: [/advisor/i, /adviser/i, /consultant/i, /mentor/i, /board member/i, /non.executive/i, /\bned\b/i, /strategic advisor/i, /independent director/i] },
  { type: 'operator', patterns: [/manager/i, /engineer/i, /developer/i, /designer/i, /analyst/i, /specialist/i, /lead/i, /coordinator/i, /executive/i, /officer/i] }
];

var SECTOR_KEYWORDS = {
  'fintech': 'Fintech', 'financial technology': 'Fintech', 'banking': 'Fintech', 'payments': 'Fintech', 'insurance': 'Fintech',
  'artificial intelligence': 'AI', 'machine learning': 'AI', 'deep learning': 'AI', 'nlp': 'AI', 'llm': 'AI',
  'climate': 'Climate', 'clean energy': 'Climate', 'sustainability': 'Climate', 'renewable': 'Climate',
  'health': 'Health', 'medtech': 'Health', 'biotech': 'Health', 'pharmaceutical': 'Health', 'medical': 'Health',
  'saas': 'Enterprise SaaS', 'software': 'Enterprise SaaS', 'b2b': 'Enterprise SaaS', 'enterprise': 'Enterprise SaaS',
  'cyber': 'Cybersecurity', 'security': 'Cybersecurity',
  'iot': 'IoT', 'internet of things': 'IoT',
  'hardware': 'Hardware', 'semiconductor': 'Hardware', 'chip': 'Hardware',
  'edtech': 'Education', 'education': 'Education', 'learning': 'Education',
  'privacy': 'Privacy & Regulation', 'data protection': 'Privacy & Regulation', 'regulation': 'Privacy & Regulation', 'compliance': 'Privacy & Regulation',
  'robotics': 'Robotics', 'automation': 'Robotics', 'drone': 'Robotics',
  'space': 'Space', 'satellite': 'Space', 'aerospace': 'Space',
  'gaming': 'Media & Entertainment', 'game': 'Media & Entertainment', 'media': 'Media & Entertainment',
  'open source': 'Infrastructure & Cloud', 'developer tools': 'Infrastructure & Cloud', 'cloud': 'Infrastructure & Cloud',
  'real estate': 'Real Estate', 'proptech': 'Real Estate', 'property': 'Real Estate',
  'food': 'Food & Agriculture', 'agriculture': 'Food & Agriculture', 'agtech': 'Food & Agriculture',
  'supply chain': 'Supply Chain', 'logistics': 'Supply Chain',
  'venture capital': 'Venture & Capital', 'fundraising': 'Venture & Capital', 'investment': 'Venture & Capital',
  'growth': 'Growth & GTM', 'go-to-market': 'Growth & GTM', 'sales': 'Growth & GTM',
  'impact': 'Impact & Social', 'social enterprise': 'Impact & Social', 'nonprofit': 'Impact & Social',
  'data': 'Data & Analytics', 'analytics': 'Data & Analytics',
  'marketplace': 'Marketplace & Commerce', 'ecommerce': 'Marketplace & Commerce',
  'travel': 'Travel & Mobility', 'mobility': 'Travel & Mobility', 'transport': 'Travel & Mobility'
};

function inferStakeholderType(roleTitle) {
  if (!roleTitle) return 'operator';
  for (var i = 0; i < ROLE_PATTERNS.length; i++) {
    var rp = ROLE_PATTERNS[i];
    for (var j = 0; j < rp.patterns.length; j++) {
      if (rp.patterns[j].test(roleTitle)) return rp.type;
    }
  }
  return 'operator';
}

function inferThemes(roleTitle, companyName, companyDomain) {
  var text = ((roleTitle || '') + ' ' + (companyName || '') + ' ' + (companyDomain || '')).toLowerCase();
  var matched = {};
  var keys = Object.keys(SECTOR_KEYWORDS);
  for (var i = 0; i < keys.length; i++) {
    if (text.indexOf(keys[i]) !== -1) {
      var theme = SECTOR_KEYWORDS[keys[i]];
      matched[theme] = true;
      if (Object.keys(matched).length >= 3) break;
    }
  }
  return Object.keys(matched);
}

function inferJurisdiction(countryCode) {
  if (!countryCode) return 'global';
  var map = { 'GB': 'uk', 'UK': 'uk', 'AU': 'au', 'SG': 'sg', 'US': 'us', 'CA': 'us' };
  return map[countryCode.toUpperCase()] || 'global';
}

module.exports = { inferStakeholderType, inferThemes, inferJurisdiction };
