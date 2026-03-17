var { dbRun } = require('../../db');
var { getCanonicalThemes } = require('../../lib/theme_taxonomy');

function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchUrl(url) {
  try {
    var resp = await fetch(url, {
      headers: { 'User-Agent': 'EventMedium-CommunitySetup/1.0' },
      signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) {
      console.log('[ingest] Failed to fetch ' + url + ': ' + resp.status);
      return '';
    }
    var html = await resp.text();
    return stripHtml(html);
  } catch (err) {
    console.log('[ingest] Error fetching ' + url + ': ' + err.message);
    return '';
  }
}

async function callClaude(prompt) {
  var body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }]
  });

  var resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: body
  });

  if (!resp.ok) {
    var err = await resp.text();
    throw new Error('Claude API error: ' + resp.status + ' ' + err);
  }

  var data = await resp.json();
  return data.content[0].text;
}

function extractJson(text) {
  // Try raw parse first
  try { return JSON.parse(text); } catch(e) {}
  // Try extracting from markdown code block
  var match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try { return JSON.parse(match[1].trim()); } catch(e) {}
  }
  // Try finding first { to last }
  var start = text.indexOf('{');
  var end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch(e) {}
  }
  return null;
}

async function ingestCommunitySignals(communityConfig) {
  console.log('[ingest] Starting ingestion for: ' + communityConfig.label);

  // 1. Fetch URLs
  var urls = communityConfig.urls || [];
  var fetchedTexts = [];
  for (var i = 0; i < urls.length; i++) {
    console.log('[ingest] Fetching: ' + urls[i]);
    var text = await fetchUrl(urls[i]);
    if (text) fetchedTexts.push(text);
  }
  console.log('[ingest] Fetched ' + fetchedTexts.length + '/' + urls.length + ' URLs');

  // 2. Combine corpus
  var corpus = fetchedTexts.join('\n\n');
  if (corpus.length > 8000) corpus = corpus.slice(0, 8000);

  var knownFacts = (communityConfig.known_facts || []).map(function(f) { return '- ' + f; }).join('\n');
  var canonicalThemes = getCanonicalThemes().join(', ');

  // 3. Build prompt
  var prompt = 'You are building a Community Intelligence Taxonomy for a professional networking platform.\n\n' +
    'Analyse the following public information about a community and produce a structured taxonomy that will be used to generate realistic synthetic member profiles and calibrate a matching engine.\n\n' +
    'Community context:\n' + (communityConfig.context_hint || '') + '\n\n' +
    'Known facts:\n' + knownFacts + '\n\n' +
    'Public content ingested:\n' + corpus + '\n\n' +
    'Produce a JSON object with EXACTLY this structure (no markdown, no explanation, raw JSON only):\n\n' +
    '{\n' +
    '  "sector_distribution": {\n' +
    '    "description": "approximate proportion of members by professional sector",\n' +
    '    "sectors": [{"sector": "string", "weight": 0.0, "notes": "string"}]\n' +
    '  },\n' +
    '  "theme_distribution": {\n' +
    '    "description": "mapping to EventMedium canonical themes with confidence scores",\n' +
    '    "themes": [{"theme": "one of the canonical themes", "weight": 0.0, "rationale": "string"}],\n' +
    '    "canonical_themes": ["' + canonicalThemes.split(', ').join('","') + '"]\n' +
    '  },\n' +
    '  "stakeholder_distribution": {\n' +
    '    "description": "approximate proportion by EventMedium stakeholder type",\n' +
    '    "types": [{"type": "founder|investor|researcher|corporate|advisor|operator", "weight": 0.0, "notes": "string"}]\n' +
    '  },\n' +
    '  "career_stage_distribution": {"early": 0.0, "mid": 0.0, "senior": 0.0, "notes": "string"},\n' +
    '  "geography_clusters": [{"city": "string", "state": "string", "country": "string", "weight": 0.0}],\n' +
    '  "values_language": {\n' +
    '    "description": "recurring language, values, and framing patterns members use",\n' +
    '    "patterns": ["string"],\n' +
    '    "avoid_patterns": ["string"]\n' +
    '  },\n' +
    '  "signal_richness_profile": {"engaged_pct": 0.0, "passive_pct": 0.0, "notes": "string"},\n' +
    '  "matching_challenge": {\n' +
    '    "primary_challenge": "string",\n' +
    '    "recommended_weight_adjustments": {"theme": 0.0, "intent": 0.0, "stakeholder": 0.0, "capital": 0.0, "signal_convergence": 0.0},\n' +
    '    "rationale": "string"\n' +
    '  },\n' +
    '  "community_intelligence_preview": {\n' +
    '    "headline": "one sentence describing this community matching opportunity",\n' +
    '    "key_insight": "the single most important thing a community owner should know",\n' +
    '    "example_match_types": [{"type_a": "string", "type_b": "string", "connection_logic": "string"}]\n' +
    '  }\n' +
    '}';

  // 4. Call Claude
  console.log('[ingest] Calling Claude for taxonomy generation...');
  var responseText = await callClaude(prompt);
  var taxonomy = extractJson(responseText);

  // Retry once if parsing failed
  if (!taxonomy) {
    console.log('[ingest] JSON parse failed, retrying with stricter prompt...');
    responseText = await callClaude(prompt + '\n\nIMPORTANT: Return ONLY raw JSON. No markdown, no code fences, no explanation. Start with { and end with }.');
    taxonomy = extractJson(responseText);
  }

  if (!taxonomy) {
    throw new Error('Failed to parse taxonomy JSON from Claude after 2 attempts');
  }

  console.log('[ingest] Taxonomy generated successfully');

  // 5. Save to DB
  var result = await dbRun(
    'INSERT INTO community_taxonomies (community_id, sector_distribution, theme_distribution, stakeholder_distribution, career_stage_distribution, geography_clusters, values_language, signal_sources, raw_ingestion_summary, matching_weights) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
    [
      communityConfig.community_id,
      JSON.stringify(taxonomy.sector_distribution || {}),
      JSON.stringify(taxonomy.theme_distribution || {}),
      JSON.stringify(taxonomy.stakeholder_distribution || {}),
      JSON.stringify(taxonomy.career_stage_distribution || {}),
      JSON.stringify(taxonomy.geography_clusters || []),
      JSON.stringify(taxonomy.values_language || {}),
      JSON.stringify(communityConfig.urls || []),
      responseText.slice(0, 10000),
      JSON.stringify((taxonomy.matching_challenge || {}).recommended_weight_adjustments || {})
    ]
  );

  console.log('[ingest] Saved taxonomy id=' + result.rows[0].id);
  return taxonomy;
}

module.exports = { ingestCommunitySignals: ingestCommunitySignals };
