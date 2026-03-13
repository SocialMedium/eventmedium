// ── Theme Taxonomy ──
// Maps variant terms to canonical themes. Used for matching, signal classification, and search.
// Themes serve as UI labels and conversation vocabulary — Qdrant vectors handle semantic matching.
// When adding new variants, keep them lowercase.

var THEME_MAP = {
  // ── Technology verticals ──
  'AI': ['ai', 'artificial intelligence', 'machine learning', 'deep learning', 'generative ai', 'gen ai', 'llm', 'large language model', 'nlp', 'natural language processing', 'computer vision', 'neural network', 'foundation model', 'transformer', 'gpt', 'diffusion model', 'agentic ai', 'ai agents'],
  'Fintech': ['fintech', 'financial technology', 'payments', 'neobank', 'banking tech', 'insurtech', 'regtech', 'defi', 'decentralized finance', 'open banking', 'embedded finance', 'lending tech', 'wealthtech', 'banking', 'financial services', 'stablecoin', 'digital banking', 'cross-border payments'],
  'Cybersecurity': ['cybersecurity', 'cyber security', 'infosec', 'information security', 'threat detection', 'zero trust', 'endpoint security', 'cloud security', 'identity management', 'soc', 'penetration testing', 'security operations', 'data protection'],
  'Enterprise SaaS': ['saas', 'enterprise saas', 'b2b software', 'enterprise software', 'cloud software', 'vertical saas', 'horizontal saas', 'workflow automation', 'erp', 'crm', 'b2b', 'software platform', 'process automation', 'productivity software', 'workforce technology', 'hr tech', 'hrtech', 'people tech', 'workforce strategy', 'talent management'],
  'Web3': ['web3', 'blockchain', 'crypto', 'cryptocurrency', 'dao', 'nft', 'smart contract', 'ethereum', 'solana', 'tokenization', 'digital assets', 'distributed ledger', 'wallet', 'defi protocol'],
  'Quantum': ['quantum', 'quantum computing', 'quantum sensing', 'quantum networking', 'qubit', 'quantum advantage', 'quantum cryptography', 'post-quantum'],
  'Robotics': ['robotics', 'autonomous systems', 'drones', 'autonomous vehicles', 'self-driving', 'industrial automation', 'cobots', 'humanoid robots', 'embodied ai'],
  'IoT': ['iot', 'internet of things', 'connected devices', 'edge computing', 'embedded systems', 'sensors', 'smart devices', 'industrial iot', 'iiot'],
  'Hardware': ['hardware', 'semiconductors', 'chips', 'electronics', 'manufacturing tech', 'advanced materials', '3d printing', 'additive manufacturing'],

  // ── Industry verticals ──
  'Climate': ['climate', 'climate tech', 'cleantech', 'sustainability', 'carbon', 'renewable energy', 'solar', 'wind energy', 'green hydrogen', 'carbon capture', 'esg', 'net zero', 'decarbonization', 'energy transition', 'energy', 'clean energy', 'circular economy'],
  'Health': ['health', 'healthtech', 'biotech', 'medtech', 'digital health', 'genomics', 'precision medicine', 'drug discovery', 'clinical trials', 'telemedicine', 'pharma', 'diagnostics', 'medical devices', 'life sciences', 'mental health', 'wellbeing', 'wellness', 'healthcare'],
  'Education': ['education', 'edtech', 'education technology', 'e-learning', 'online learning', 'upskilling', 'reskilling', 'workforce development', 'higher education', 'k-12', 'early education', 'childcare', 'learning platforms', 'training'],
  'Media & Entertainment': ['media', 'entertainment', 'creator economy', 'streaming', 'gaming', 'esports', 'content', 'adtech', 'martech', 'digital media', 'video production', 'publishing', 'sports tech', 'music tech', 'film', 'broadcast'],
  'Real Estate': ['real estate', 'proptech', 'property technology', 'construction tech', 'contech', 'smart buildings', 'commercial real estate', 'residential tech', 'property management', 'architecture tech'],
  'Food & Agriculture': ['food', 'agtech', 'agriculture', 'food tech', 'agritech', 'precision agriculture', 'alternative protein', 'vertical farming', 'food safety', 'ag biotech', 'foodservice', 'hospitality tech'],
  'Supply Chain': ['supply chain', 'logistics', 'freight', 'shipping', 'warehousing', 'procurement', 'trade finance', 'trade tech', 'last mile', 'supply chain resilience', 'fleet management'],
  'Space': ['space', 'space tech', 'aerospace', 'satellite', 'launch', 'orbital', 'earth observation', 'space manufacturing', 'deep space', 'aviation', 'air mobility'],
  'Defence': ['defence', 'defense', 'defense tech', 'defence tech', 'military', 'dual-use', 'govtech', 'national security', 'intelligence', 'defense industrial base', 'government technology'],

  // ── Business & professional domains ──
  'Growth & GTM': ['growth', 'go-to-market', 'gtm', 'growth strategy', 'sales strategy', 'revenue operations', 'revops', 'business development', 'partnerships', 'channel strategy', 'market expansion', 'growth marketing', 'demand generation', 'consultancy', 'management consulting', 'strategy consulting'],
  'Impact & Social': ['impact', 'social impact', 'social enterprise', 'nonprofit', 'not-for-profit', 'ngo', 'philanthropy', 'social innovation', 'community development', 'diversity', 'inclusion', 'dei', 'social good', 'mission-driven', 'youth', 'advocacy'],
  'Venture & Capital': ['venture capital', 'vc', 'private equity', 'pe', 'angel investing', 'angel', 'seed funding', 'fundraising', 'capital markets', 'investment', 'fund management', 'lp', 'family office', 'venture studio', 'accelerator', 'incubator', 'corporate venture'],
  'Data & Analytics': ['data', 'analytics', 'data science', 'big data', 'business intelligence', 'data engineering', 'data platform', 'data infrastructure', 'predictive analytics', 'behavioral analytics'],
  'Privacy & Regulation': ['privacy', 'regulation', 'compliance', 'gdpr', 'data governance', 'legal tech', 'legaltech', 'policy', 'regulatory technology', 'open source', 'open-source'],
  'Infrastructure & Cloud': ['infrastructure', 'cloud', 'devops', 'platform engineering', 'cloud native', 'kubernetes', 'serverless', 'developer tools', 'developer experience', 'api', 'microservices'],
  'Marketplace & Commerce': ['marketplace', 'ecommerce', 'e-commerce', 'commerce', 'retail tech', 'direct-to-consumer', 'dtc', 'd2c', 'platform', 'two-sided marketplace', 'multi-sided platform'],
  'Travel & Mobility': ['travel', 'travel tech', 'mobility', 'transport', 'transportation', 'ride-sharing', 'micromobility', 'ev', 'electric vehicles', 'charging infrastructure', 'fleet']
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
// Preserves unrecognised themes rather than silently dropping them
function normalizeThemes(themes) {
  if (!themes || !Array.isArray(themes)) return [];
  var seen = {};
  var result = [];
  themes.forEach(function(t) {
    if (!t || typeof t !== 'string') return;
    var canonical = normalizeTheme(t);
    var value = canonical || t.trim();
    if (value && !seen[value.toLowerCase()]) {
      seen[value.toLowerCase()] = true;
      result.push(canonical || value);
    }
  });
  return result;
}

// Get all canonical theme names
function getCanonicalThemes() {
  return Object.keys(THEME_MAP);
}

module.exports = { THEME_MAP, normalizeTheme, normalizeThemes, getCanonicalThemes };
