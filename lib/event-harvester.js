// ── Event Harvester ──────────────────────────────────────────────────────────
// Fetches an official event URL, extracts structured data via Claude AI,
// returns a validated event object ready for DB insertion.
// Uses node-fetch@2 (CommonJS) + cheerio for HTML cleaning.
// No Puppeteer — Claude interprets the raw text.

var fetch = require('node-fetch');
var cheerio = require('cheerio');
var { normalizeThemes } = require('./theme_taxonomy');

var CANONICAL_THEMES = [
  'AI', 'Connectivity', 'IoT', 'Enterprise SaaS', 'Cybersecurity', 'FinTech',
  'Climate Tech', 'HealthTech', 'Hardware', 'Privacy', 'Regulation', 'EdTech',
  'Open Source', 'Robotics', 'SpaceTech', 'Gaming', 'Web3', 'DeepTech',
  'Media', 'Sustainability',
  // Also support the taxonomy file's names
  'Fintech', 'Climate', 'Health', 'Defence', 'Education', 'Supply Chain',
  'Real Estate', 'Food & Agriculture', 'Media & Entertainment', 'Quantum', 'Space'
];

var USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
var FETCH_TIMEOUT_MS = 15000;
var MAX_TEXT_CHARS = 6000;

// ── Step 1: Fetch HTML ────────────────────────────────────────────────────────
async function fetchPage(url) {
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, FETCH_TIMEOUT_MS);
  try {
    var resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var html = await resp.text();
    return html;
  } catch(e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Could not reach that URL — request timed out');
    throw new Error('Could not reach that URL: ' + e.message);
  }
}

// ── Step 2: Clean HTML ────────────────────────────────────────────────────────
function extractText(html, url) {
  var $ = cheerio.load(html);

  // Extract meta tags before stripping
  var pageTitle = $('title').first().text().trim();
  var metaDesc = $('meta[name="description"]').attr('content') || '';
  var ogTitle = $('meta[property="og:title"]').attr('content') || '';
  var ogDesc = $('meta[property="og:description"]').attr('content') || '';

  // Remove noise elements
  $('script, style, nav, footer, header, iframe, svg, noscript, aside').remove();
  $('[class*="cookie"], [class*="banner"], [class*="popup"], [id*="cookie"]').remove();

  // Extract body text
  var bodyText = $('body').text()
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Combine meta + body, prioritise structured meta info
  var combined = '';
  if (pageTitle) combined += 'PAGE TITLE: ' + pageTitle + '\n';
  if (ogTitle && ogTitle !== pageTitle) combined += 'OG TITLE: ' + ogTitle + '\n';
  if (metaDesc) combined += 'META DESCRIPTION: ' + metaDesc + '\n';
  if (ogDesc && ogDesc !== metaDesc) combined += 'OG DESCRIPTION: ' + ogDesc + '\n';
  combined += 'URL: ' + url + '\n\n';
  combined += bodyText;

  return combined.substring(0, MAX_TEXT_CHARS);
}

// ── Step 3: Claude Extraction ─────────────────────────────────────────────────
async function extractWithClaude(pageText) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  var systemPrompt = 'You are an event data extractor. Extract structured information from event website text.\nRespond ONLY with valid JSON. No markdown, no explanation, no code fences.';

  var userPrompt = 'Extract event details from this website content and return JSON with exactly these fields:\n\n' +
    '{\n' +
    '  "name": "full event name",\n' +
    '  "event_date": "YYYY-MM-DD or null if unknown",\n' +
    '  "end_date": "YYYY-MM-DD or null",\n' +
    '  "city": "city name or null",\n' +
    '  "country": "country name or null",\n' +
    '  "venue": "venue name or null",\n' +
    '  "description": "2-3 sentence description of the event",\n' +
    '  "themes": ["array", "of", "relevant", "topics"],\n' +
    '  "expected_attendees": "number as integer or null",\n' +
    '  "website": "the original URL",\n' +
    '  "organiser": "organiser name or null",\n' +
    '  "ticket_url": "URL if found or null",\n' +
    '  "is_flagship": false\n' +
    '}\n\n' +
    'For themes, use only these canonical values where applicable:\n' +
    CANONICAL_THEMES.join(', ') + '\n\n' +
    'Website content:\n' + pageText;

  var resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!resp.ok) {
    var errText = await resp.text().catch(function() { return ''; });
    throw new Error('Claude API error ' + resp.status + ': ' + errText.substring(0, 200));
  }

  var data = await resp.json();
  var raw = data.content && data.content[0] && data.content[0].text || '';

  // Strip accidental markdown fences
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch(e) {
    throw new Error('Claude returned invalid JSON. This may not be an event page.');
  }

  return parsed;
}

// ── Step 4: Validate + normalise ─────────────────────────────────────────────
function validate(extracted, url) {
  if (!extracted.name || typeof extracted.name !== 'string' || extracted.name.length < 3) {
    throw new Error("This doesn't look like an event page. Could not extract an event name.");
  }

  // Normalise date
  if (extracted.event_date) {
    var d = new Date(extracted.event_date);
    if (isNaN(d.getTime())) extracted.event_date = null;
  }
  if (extracted.end_date) {
    var ed = new Date(extracted.end_date);
    if (isNaN(ed.getTime())) extracted.end_date = null;
  }

  // Normalise themes against taxonomy
  var rawThemes = Array.isArray(extracted.themes) ? extracted.themes : [];
  var normalized = normalizeThemes(rawThemes);
  // Keep any that didn't normalise but match CANONICAL_THEMES directly
  rawThemes.forEach(function(t) {
    if (!normalized.includes(t) && CANONICAL_THEMES.includes(t)) normalized.push(t);
  });
  extracted.themes = normalized;

  // Ensure website is set
  if (!extracted.website) extracted.website = url;

  // Coerce expected_attendees to integer or null
  if (extracted.expected_attendees) {
    var n = parseInt(extracted.expected_attendees);
    extracted.expected_attendees = isNaN(n) ? null : n;
  } else {
    extracted.expected_attendees = null;
  }

  extracted.is_flagship = false; // always default false, admin sets manually

  return extracted;
}

// ── Public API ────────────────────────────────────────────────────────────────
async function harvestEvent(url) {
  // Basic URL validation
  try { new URL(url); } catch(e) { throw new Error('Invalid URL format'); }

  var html = await fetchPage(url);
  var pageText = extractText(html, url);
  var extracted = await extractWithClaude(pageText);
  return validate(extracted, url);
}

module.exports = { harvestEvent };
