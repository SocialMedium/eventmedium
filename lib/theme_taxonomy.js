// ── Theme Taxonomy ──
// Maps variant terms to canonical themes. Used for matching, signal classification, and search.
// When adding new variants, keep them lowercase.

var THEME_MAP = {
  'AI': ['ai', 'artificial intelligence', 'machine learning', 'deep learning', 'generative ai', 'gen ai', 'llm', 'large language model', 'nlp', 'natural language processing', 'computer vision', 'neural network', 'foundation model', 'transformer', 'gpt', 'diffusion model'],
  'Fintech': ['fintech', 'financial technology', 'payments', 'neobank', 'banking tech', 'insurtech', 'regtech', 'defi', 'decentralized finance', 'open banking', 'embedded finance', 'lending tech', 'wealthtech'],
  'Climate': ['climate', 'climate tech', 'cleantech', 'sustainability', 'carbon', 'renewable energy', 'solar', 'wind energy', 'green hydrogen', 'carbon capture', 'esg', 'net zero', 'decarbonization', 'energy transition'],
  'Health': ['health', 'healthtech', 'biotech', 'medtech', 'digital health', 'genomics', 'precision medicine', 'drug discovery', 'clinical trials', 'telemedicine', 'pharma', 'diagnostics', 'medical devices', 'life sciences'],
  'Cybersecurity': ['cybersecurity', 'cyber security', 'infosec', 'information security', 'threat detection', 'zero trust', 'endpoint security', 'cloud security', 'identity management', 'soc', 'penetration testing'],
  'Enterprise SaaS': ['saas', 'enterprise saas', 'b2b software', 'enterprise software', 'cloud software', 'vertical saas', 'horizontal saas', 'workflow automation', 'erp', 'crm'],
  'Web3': ['web3', 'blockchain', 'crypto', 'cryptocurrency', 'dao', 'nft', 'smart contract', 'ethereum', 'solana', 'tokenization', 'digital assets', 'distributed ledger'],
  'Quantum': ['quantum', 'quantum computing', 'quantum sensing', 'quantum networking', 'qubit', 'quantum advantage', 'quantum cryptography', 'post-quantum'],
  'Space': ['space', 'space tech', 'aerospace', 'satellite', 'launch', 'orbital', 'earth observation', 'space manufacturing', 'deep space'],
  'Robotics': ['robotics', 'autonomous systems', 'drones', 'autonomous vehicles', 'self-driving', 'industrial automation', 'cobots', 'humanoid robots', 'embodied ai'],
  'Defence': ['defence', 'defense', 'defense tech', 'defence tech', 'military', 'dual-use', 'govtech', 'national security', 'intelligence', 'defense industrial base'],
  'Education': ['education', 'edtech', 'education technology', 'e-learning', 'online learning', 'upskilling', 'reskilling', 'workforce development', 'higher education', 'k-12'],
  'Supply Chain': ['supply chain', 'logistics', 'freight', 'shipping', 'warehousing', 'procurement', 'trade finance', 'trade tech', 'last mile', 'supply chain resilience'],
  'Real Estate': ['real estate', 'proptech', 'property technology', 'construction tech', 'contech', 'smart buildings', 'commercial real estate', 'residential tech'],
  'Food & Agriculture': ['food', 'agtech', 'agriculture', 'food tech', 'agritech', 'precision agriculture', 'alternative protein', 'vertical farming', 'food safety', 'ag biotech'],
  'Media & Entertainment': ['media', 'entertainment', 'creator economy', 'streaming', 'gaming', 'esports', 'content', 'adtech', 'martech', 'digital media']
};

// Build reverse lookup: variant → canonical theme
var VARIANT_TO_THEME = {};
Object.keys(THEME_MAP).forEach(function(canonical) {
  THEME_MAP[canonical].forEach(function(variant) {
    VARIANT_TO_THEME[variant] = canonical;
  });
  // Also map the canonical name itself (lowercased)
  VARIANT_TO_THEME[canonical.toLowerCase()] = canonical;
});

// Normalize a single theme string to its canonical form
function normalizeTheme(raw) {
  if (!raw) return null;
  var lower = raw.toLowerCase().trim();
  return VARIANT_TO_THEME[lower] || null;
}

// Normalize an array of theme strings, return unique canonical themes
function normalizeThemes(themes) {
  if (!themes || !Array.isArray(themes)) return [];
  var seen = {};
  var result = [];
  themes.forEach(function(t) {
    var canonical = normalizeTheme(t);
    if (canonical && !seen[canonical]) {
      seen[canonical] = true;
      result.push(canonical);
    }
  });
  return result;
}

// Get all canonical theme names
function getCanonicalThemes() {
  return Object.keys(THEME_MAP);
}

module.exports = { THEME_MAP, normalizeTheme, normalizeThemes, getCanonicalThemes };
