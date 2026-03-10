// ── Event Link Finder ─────────────────────────────────────────────────────────
// Discovers event URLs using Google Custom Search API.
// Results are ephemeral — only harvested events get stored in DB.
//
// Setup (Google CSE):
//   1. Go to https://programmablesearchengine.google.com/
//   2. Create a new search engine — set to "Search the entire web"
//   3. Copy the CX (Search Engine ID)
//   4. Go to https://console.cloud.google.com/ → APIs → Custom Search JSON API
//   5. Enable it and create an API key
//   6. Set Railway env vars:
//        GOOGLE_SEARCH_API_KEY=your_api_key
//        GOOGLE_SEARCH_CX=your_cx_id
//   Free tier: 100 queries/day. Theme mode uses ~2 queries/theme.

var fetch = require('node-fetch');
var { getCanonicalThemes } = require('./theme_taxonomy');

var GOOGLE_API_BASE = 'https://www.googleapis.com/customsearch/v1';

// ── Blocklists ────────────────────────────────────────────────────────────────
var AGGREGATOR_DOMAINS = [
  'eventbrite.com', 'meetup.com', 'lu.ma', 'luma.events',
  'eventbrite.co.uk', 'ticketmaster.com', 'eventbrite.ca',
  'allevents.in', 'eventful.com', '10times.com', 'eventil.com',
  'confcal.io', 'papercall.io', 'sessionize.com'
];
var SOCIAL_DOMAINS = ['twitter.com', 'x.com', 'linkedin.com', 'facebook.com', 'instagram.com', 'tiktok.com'];
var NEWS_DOMAINS = ['techcrunch.com', 'forbes.com', 'medium.com', 'substack.com', 'wired.com', 'theverge.com', 'venturebeat.com', 'reuters.com', 'bloomberg.com', 'businessinsider.com', 'wsj.com', 'ft.com'];
var BLOCK_DOMAINS = [].concat(AGGREGATOR_DOMAINS, SOCIAL_DOMAINS, NEWS_DOMAINS, ['wikipedia.org', 'arxiv.org', 'researchgate.net', 'academia.edu', 'youtube.com', 'reddit.com', 'quora.com', 'slideshare.net']);

var EVENT_KEYWORDS = ['conference', 'summit', 'forum', 'congress', 'expo', 'festival', 'symposium', 'event', 'meetup', 'hackathon', 'convention', 'workshop', 'bootcamp'];

// ── Filtering ─────────────────────────────────────────────────────────────────
function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch(e) { return ''; }
}

function isBlocked(url) {
  var domain = getDomain(url);
  return BLOCK_DOMAINS.some(function(d) { return domain === d || domain.endsWith('.' + d); });
}

function hasEventKeyword(text) {
  var lower = (text || '').toLowerCase();
  return EVENT_KEYWORDS.some(function(kw) { return lower.includes(kw); });
}

// ── Relevance scoring ─────────────────────────────────────────────────────────
var CANONICAL_THEMES = getCanonicalThemes();
var THEME_KEYWORDS = CANONICAL_THEMES.map(function(t) { return t.toLowerCase(); });

function scoreResult(item) {
  var score = 0;
  var url = item.link || '';
  var title = item.title || '';
  var snippet = item.snippet || '';
  var allText = (title + ' ' + snippet).toLowerCase();

  // +30 URL contains event keyword
  if (hasEventKeyword(url)) score += 30;

  // +20 title contains a year
  if (/20(25|26|27)/.test(title)) score += 20;

  // +20 snippet mentions dates, location, or registration
  if (/register|registration|tickets?|attendees?|speakers?|january|february|march|april|may|june|july|august|september|october|november|december/i.test(snippet)) score += 20;

  // +15 domain matches event name heuristic (short domain similar to title words)
  var domain = getDomain(url);
  var titleWords = title.toLowerCase().split(/\s+/).filter(function(w) { return w.length > 3; });
  if (titleWords.some(function(w) { return domain.includes(w.replace(/[^a-z]/g, '')); })) score += 15;

  // +15 title/snippet contains canonical theme
  if (THEME_KEYWORDS.some(function(t) { return allText.includes(t); })) score += 15;

  return Math.min(score, 100);
}

function detectThemes(title, snippet) {
  var text = (title + ' ' + snippet).toLowerCase();
  return CANONICAL_THEMES.filter(function(t) { return text.includes(t.toLowerCase()); }).slice(0, 4);
}

// ── Core search function ──────────────────────────────────────────────────────
async function findEventLinks(query, options) {
  var opts = options || {};
  var apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  var cx = process.env.GOOGLE_SEARCH_CX;

  if (!apiKey || !cx) throw new Error('GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX must be set in environment variables');

  var num = Math.min(opts.num || 10, 10); // Google max is 10 per request
  var params = new URLSearchParams({
    key: apiKey, cx: cx, q: query, num: num, dateRestrict: opts.dateRestrict || 'y2'
  });

  console.log('[event-link-finder] Searching:', query);

  var resp = await fetch(GOOGLE_API_BASE + '?' + params.toString());
  if (!resp.ok) {
    var errBody = await resp.text().catch(function() { return ''; });
    if (resp.status === 429) throw new Error('RATE_LIMIT');
    if (resp.status === 403) throw new Error('API_KEY_INVALID');
    throw new Error('Google Search API error ' + resp.status + ': ' + errBody.substring(0, 200));
  }

  var data = await resp.json();
  var items = data.items || [];

  return items
    .filter(function(item) {
      return item.link && !isBlocked(item.link) && (hasEventKeyword(item.link) || hasEventKeyword(item.title));
    })
    .map(function(item) {
      return {
        url: item.link,
        title: item.title || '',
        snippet: item.snippet || '',
        relevanceScore: scoreResult(item),
        themes_detected: detectThemes(item.title, item.snippet),
        domain: getDomain(item.link)
      };
    })
    .sort(function(a, b) { return b.relevanceScore - a.relevanceScore; });
}

// ── Theme query generation ────────────────────────────────────────────────────
function generateThemeQueries(themes, year) {
  var y = year || 2026;
  var queries = [];
  (themes || CANONICAL_THEMES).forEach(function(theme) {
    queries.push(theme + ' conference ' + y);
    queries.push(theme + ' summit ' + y + ' Europe');
  });
  return queries;
}

module.exports = { findEventLinks, generateThemeQueries };
