var fetch = require('node-fetch');

var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
var MODEL = 'claude-sonnet-4-20250514';

var CANONICAL_THEMES = [
  'AI','Connectivity','IoT','Enterprise SaaS','Cybersecurity','FinTech',
  'Climate Tech','HealthTech','Hardware','Privacy','Regulation',
  'EdTech','Open Source','Robotics','SpaceTech','Gaming'
];

// ── Call Claude with system + user message, return parsed JSON ──
async function callClaude(system, userContent, maxTokens) {
  var resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens || 1000,
      system: system,
      messages: [{ role: 'user', content: userContent }]
    })
  });

  if (!resp.ok) {
    var errText = await resp.text();
    throw new Error('Claude API error ' + resp.status + ': ' + errText);
  }

  var data = await resp.json();
  var raw = data.content[0].text.trim();
  try {
    return JSON.parse(raw);
  } catch (e) {
    var cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  }
}

// ── Extraction 1: Canister fields ──
async function extractCanisterFields(text, documentType) {
  var system = 'You extract structured professional profile data from documents.\n' +
    'Return ONLY valid JSON with no preamble, no markdown, no backticks.\n' +
    'Document type identified: ' + documentType + '\n\n' +
    'Extract these fields:\n' +
    '{\n' +
    '  "stakeholder_type": "founder|investor|researcher|corporate|advisor|operator",\n' +
    '  "themes": ["only from: ' + CANONICAL_THEMES.join(',') + '"],\n' +
    '  "intent": ["what they are actively seeking — be specific"],\n' +
    '  "offering": ["what they bring to a relationship — be specific"],\n' +
    '  "geography": "primary city or region",\n' +
    '  "focus_text": "2-3 sentences in their voice describing what they do and what they are working toward",\n' +
    '  "deal_details": {\n' +
    '    "priority": "their most pressing priority in the next 90 days",\n' +
    '    "timeline": "any specific timeline or deadline mentioned",\n' +
    '    "stage": "pre-seed|seed|series-a|series-b|growth|null",\n' +
    '    "raise_amount": "string or null",\n' +
    '    "check_size": "string or null — for investors"\n' +
    '  },\n' +
    '  "confidence": 0.0\n' +
    '}\n\n' +
    'confidence: 0.0–1.0 — how complete and specific the extraction is.\n' +
    'Use empty arrays and null for fields not present in the document.\n' +
    'Themes must match the canonical list exactly.';

  return callClaude(system, 'Extract canister fields from this document:\n\n' + text.slice(0, 20000), 1000);
}

// ── Extraction 2: Signals ──
async function extractSignals(text, documentType, entityName) {
  var system = 'You extract market signals from professional documents for a B2B matching platform.\n' +
    'Return ONLY valid JSON array with no preamble, no markdown, no backticks.\n\n' +
    'Extract 1–4 distinct signals. Each signal represents a specific, actionable market intent.\n' +
    'Focus on: fundraising activity, hiring intent, partnership seeking, customer acquisition, market entry, product launch timing.\n\n' +
    'Each signal object:\n' +
    '{\n' +
    '  "theme": "one canonical theme: ' + CANONICAL_THEMES.join('|') + '",\n' +
    '  "signal_text": "specific statement of intent or position — 1-2 sentences, factual",\n' +
    '  "signal_summary": "one line for intelligence display",\n' +
    '  "lifecycle_stage": "exploratory|emerging|accelerating|consolidating|decaying",\n' +
    '  "geography": "city/region or null",\n' +
    '  "urgency": "high|medium|low",\n' +
    '  "dollar_amount": "number or null",\n' +
    '  "dollar_unit": "K|M|B|null"\n' +
    '}\n\n' +
    'lifecycle_stage guidance:\n' +
    '- accelerating: active raise, active hire, launching imminently\n' +
    '- emerging: building toward a milestone, 1–6 month horizon\n' +
    '- exploratory: early stage, researching options\n' +
    '- consolidating: post-raise, post-launch, stabilising\n' +
    '- decaying: winding down, pivoting away\n\n' +
    'Do NOT include generic signals. Only include signals with specific, matchable intent.\n' +
    'Return [] if no clear signals can be extracted.';

  return callClaude(
    system,
    'Extract market signals from this ' + documentType + ':\n\nEntity: ' + (entityName || 'unknown') + '\n\n' + text.slice(0, 20000),
    1500
  );
}

// ── Document type classifier ──
async function classifyDocumentType(text) {
  var system = 'Classify the document type. Return only one word: pitch_deck, cv, bio, investment_thesis, company_overview, or other.';
  var resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 50,
      system: system,
      messages: [{ role: 'user', content: text.slice(0, 2000) }]
    })
  });

  if (!resp.ok) return 'other';
  var data = await resp.json();
  var raw = data.content[0].text.trim().toLowerCase().replace(/\s+/g, '_');
  var valid = ['pitch_deck', 'cv', 'bio', 'investment_thesis', 'company_overview', 'other'];
  return valid.indexOf(raw) !== -1 ? raw : 'other';
}

module.exports = {
  extractCanisterFields: extractCanisterFields,
  extractSignals: extractSignals,
  classifyDocumentType: classifyDocumentType
};
