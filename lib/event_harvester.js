require('dotenv').config();
/**
 * Event Harvester
 * 
 * Discovers events via search, fetches pages for structured data,
 * deduplicates, and stores in the events table + Qdrant.
 * 
 * Search: serper.dev (2,500 free queries, set SERPER_API_KEY)
 * Extraction: JSON-LD schema.org, Open Graph, HTML fallback
 * 
 * Usage:
 *   node lib/event_harvester.js                    # harvest all
 *   node lib/event_harvester.js --theme AI         # single theme
 *   node lib/event_harvester.js --city London      # single city
 *   node lib/event_harvester.js --dry-run          # search only, don't store
 */

var { dbGet, dbRun, dbAll } = require('../db');
var { normalizeThemes } = require('./theme_taxonomy');

// ── Configuration ──

var SERPER_API_KEY = process.env.SERPER_API_KEY;

var CITIES = [
  { name: 'London', country: 'UK' },
  { name: 'Barcelona', country: 'Spain' },
  { name: 'Madrid', country: 'Spain' },
  { name: 'Lisbon', country: 'Portugal' },
  { name: 'Singapore', country: 'Singapore' },
  { name: 'New York', country: 'USA' },
  { name: 'Las Vegas', country: 'USA' },
  { name: 'Los Angeles', country: 'USA' },
  { name: 'San Francisco', country: 'USA' },
  { name: 'Sydney', country: 'Australia' },
  { name: 'Melbourne', country: 'Australia' },
  { name: 'Kuala Lumpur', country: 'Malaysia' },
  { name: 'Hong Kong', country: 'Hong Kong' },
  { name: 'Helsinki', country: 'Finland' },
  { name: 'Berlin', country: 'Germany' },
  { name: 'Munich', country: 'Germany' },
  { name: 'Paris', country: 'France' },
  { name: 'Cannes', country: 'France' },
  { name: 'Dubai', country: 'UAE' },
  { name: 'Tokyo', country: 'Japan' },
  { name: 'Seoul', country: 'South Korea' },
  { name: 'Amsterdam', country: 'Netherlands' },
  { name: 'Zurich', country: 'Switzerland' },
  { name: 'Austin', country: 'USA' },
  { name: 'Miami', country: 'USA' },
  { name: 'Toronto', country: 'Canada' },
  { name: 'Tel Aviv', country: 'Israel' }
];

var THEME_SEARCHES = [
  { theme: 'AI', queries: ['AI conference', 'artificial intelligence summit', 'machine learning conference', 'generative AI event', 'LLM summit'] },
  { theme: 'Fintech', queries: ['fintech conference', 'financial technology summit', 'payments conference', 'banking innovation event'] },
  { theme: 'Web3', queries: ['blockchain conference', 'crypto summit', 'web3 event', 'DeFi conference', 'digital assets summit'] },
  { theme: 'Climate', queries: ['climate tech conference', 'sustainability summit', 'clean energy event', 'carbon conference', 'net zero summit'] },
  { theme: 'Energy', queries: ['energy transition conference', 'renewable energy summit', 'energy storage event', 'energy tech conference'] },
  { theme: 'Space', queries: ['space tech conference', 'satellite summit', 'space industry event', 'aerospace conference'] },
  { theme: 'Defence', queries: ['defence technology conference', 'defense innovation summit', 'cybersecurity defence event', 'military tech conference'] },
  { theme: 'Cybersecurity', queries: ['cybersecurity conference', 'infosec summit', 'cyber defence event', 'security conference'] },
  { theme: 'Health', queries: ['healthtech conference', 'digital health summit', 'biotech conference', 'medtech event', 'health innovation summit'] },
  { theme: 'Enterprise SaaS', queries: ['SaaS conference', 'enterprise software summit', 'B2B tech conference', 'cloud computing event'] },
  { theme: 'Robotics', queries: ['robotics conference', 'automation summit', 'industrial robotics event', 'autonomous systems conference'] },
  { theme: 'Quantum', queries: ['quantum computing conference', 'quantum technology summit', 'quantum event'] },
  { theme: 'Food & Agriculture', queries: ['agritech conference', 'food tech summit', 'agricultural technology event', 'foodtech conference'] },
  { theme: 'Supply Chain', queries: ['supply chain conference', 'logistics technology summit', 'supplychain innovation event'] },
  { theme: 'Real Estate', queries: ['proptech conference', 'real estate technology summit', 'property innovation event'] },
  { theme: 'Education', queries: ['edtech conference', 'education technology summit', 'learning innovation event'] },
  { theme: 'Media & Entertainment', queries: ['media tech conference', 'entertainment technology summit', 'creator economy event'] }
];

var CURRENT_YEAR = new Date().getFullYear();
var NEXT_YEAR = CURRENT_YEAR + 1;

// ── Search via Serper.dev ──

async function searchEvents(query) {
  if (!SERPER_API_KEY) {
    console.warn('No SERPER_API_KEY — skipping search for:', query);
    return [];
  }

  try {
    var resp = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: query,
        num: 10,
        gl: 'us'
      })
    });

    if (!resp.ok) {
      console.error('Serper error:', resp.status, await resp.text());
      return [];
    }

    var data = await resp.json();
    var results = (data.organic || []).map(function(r) {
      return {
        title: r.title,
        url: r.link,
        snippet: r.snippet || '',
        position: r.position
      };
    });

    return results;
  } catch (err) {
    console.error('Search failed for:', query, err.message);
    return [];
  }
}

// ── Fetch and extract event data from a page ──

async function extractEventFromPage(url) {
  try {
    var resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EventMediumBot/1.0)',
        'Accept': 'text/html'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!resp.ok) return null;

    var contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;

    var html = await resp.text();

    // 1. Try JSON-LD schema.org
    var jsonld = extractJsonLd(html);
    if (jsonld) return jsonld;

    // 2. Try Open Graph
    var og = extractOpenGraph(html);
    if (og) return og;

    // 3. HTML fallback
    return extractHtmlFallback(html, url);
  } catch (err) {
    // Timeout or fetch error
    return null;
  }
}

function extractJsonLd(html) {
  var matches = html.match(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (!matches) return null;

  for (var i = 0; i < matches.length; i++) {
    try {
      var content = matches[i].replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
      var data = JSON.parse(content);

      // Handle arrays
      if (Array.isArray(data)) data = data[0];

      // Look for Event type
      if (data['@type'] === 'Event' || data['@type'] === 'BusinessEvent' || data['@type'] === 'EducationEvent') {
        var location = data.location || {};
        var address = location.address || {};
        if (typeof address === 'string') address = { addressLocality: address };

        return {
          name: data.name || '',
          description: stripHtml(data.description || ''),
          start_date: data.startDate || null,
          end_date: data.endDate || null,
          city: address.addressLocality || '',
          country: address.addressCountry || '',
          venue: location.name || '',
          website: data.url || '',
          organizer: typeof data.organizer === 'object' ? (data.organizer.name || '') : (data.organizer || ''),
          source: 'json-ld'
        };
      }
    } catch (e) {
      // invalid JSON, continue
    }
  }
  return null;
}

function extractOpenGraph(html) {
  var og = {};
  var metaRegex = /<meta\s+(?:property|name)\s*=\s*["'](og:[^"']+)["']\s+content\s*=\s*["']([^"']*)["']/gi;
  var match;
  while ((match = metaRegex.exec(html)) !== null) {
    og[match[1]] = match[2];
  }

  // Also try reversed attribute order
  var metaRegex2 = /<meta\s+content\s*=\s*["']([^"']*)["']\s+(?:property|name)\s*=\s*["'](og:[^"']+)["']/gi;
  while ((match = metaRegex2.exec(html)) !== null) {
    og[match[2]] = match[1];
  }

  if (og['og:title'] && og['og:type'] === 'event') {
    return {
      name: decodeHtmlEntities(og['og:title']),
      description: decodeHtmlEntities(og['og:description'] || ''),
      start_date: og['event:start_time'] || null,
      end_date: og['event:end_time'] || null,
      city: '',
      country: '',
      venue: '',
      website: og['og:url'] || '',
      organizer: '',
      source: 'opengraph'
    };
  }

  // Even without event type, if it looks like an event page
  if (og['og:title']) {
    return {
      name: decodeHtmlEntities(og['og:title']),
      description: decodeHtmlEntities(og['og:description'] || ''),
      start_date: null,
      end_date: null,
      city: '',
      country: '',
      venue: '',
      website: og['og:url'] || '',
      organizer: '',
      source: 'opengraph-inferred'
    };
  }

  return null;
}

function extractHtmlFallback(html, url) {
  var titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  var descMatch = html.match(/<meta\s+name\s*=\s*["']description["']\s+content\s*=\s*["']([^"']*)["']/i);
  if (!descMatch) descMatch = html.match(/<meta\s+content\s*=\s*["']([^"']*)["']\s+name\s*=\s*["']description["']/i);

  if (!titleMatch) return null;

  return {
    name: decodeHtmlEntities(titleMatch[1].trim()),
    description: descMatch ? decodeHtmlEntities(descMatch[1]) : '',
    start_date: null,
    end_date: null,
    city: '',
    country: '',
    venue: '',
    website: url,
    organizer: '',
    source: 'html-fallback'
  };
}

// ── Date extraction from text ──

function extractDatesFromText(text) {
  // Try common date patterns
  var patterns = [
    // "March 15-17, 2026" or "March 15 - 17, 2026"
    /(\w+ \d{1,2})\s*[-–]\s*(\d{1,2}),?\s*(\d{4})/i,
    // "15-17 March 2026"
    /(\d{1,2})\s*[-–]\s*(\d{1,2})\s+(\w+)\s+(\d{4})/i,
    // "March 15, 2026"
    /(\w+ \d{1,2}),?\s+(\d{4})/i,
    // "15 March 2026"
    /(\d{1,2})\s+(\w+)\s+(\d{4})/i,
    // ISO-ish: 2026-03-15
    /(\d{4}-\d{2}-\d{2})/
  ];

  for (var i = 0; i < patterns.length; i++) {
    var match = text.match(patterns[i]);
    if (match) {
      try {
        var dateStr = match[0];
        var parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          return { start_date: parsed.toISOString().split('T')[0] };
        }
      } catch(e) {}
    }
  }
  return {};
}

// ── Filter: is this actually an event? ──

function isLikelyEvent(title, snippet, url) {
  var combined = (title + ' ' + snippet + ' ' + url).toLowerCase();

  // Positive signals
  var eventTerms = ['conference', 'summit', 'expo', 'forum', 'symposium', 'congress',
    'convention', 'festival', 'hackathon', 'meetup', 'workshop', 'seminar',
    'event', 'annual', 'edition', 'register', 'tickets', 'attend'];
  var hasEventTerm = eventTerms.some(function(t) { return combined.indexOf(t) !== -1; });

  // Negative signals — skip these
  var skipTerms = ['wikipedia.org', 'youtube.com', 'twitter.com', 'linkedin.com/posts',
    'reddit.com', 'medium.com/@', 'news article', 'blog post', '.pdf',
    'amazon.com', 'github.com'];
  var isSkippable = skipTerms.some(function(t) { return combined.indexOf(t) !== -1; });

  // Event platform domains — high confidence
  var eventDomains = ['eventbrite.com', 'lu.ma', 'luma.com', 'meetup.com', 'hopin.com',
    'bizzabo.com', 'cvent.com', 'airmeet.com', 'splash.events', 'eventyco.com',
    'techcrunch.com/event', 'websummit.com', 'ces.tech', 'sxsw.com',
    'collision.com', 'vivatech.com', 'tnw.com', 'slush.org', 'pirate.global',
    'money2020.com', 'finovate.com', 'sibos.com', 'consensus.coindesk.com',
    'ethglobal.com', 'gitex.com', 'mwcbarcelona.com', 'hannovermes.de',
    'supercomputingasia.com', 'riseconf.com'];
  var isEventDomain = eventDomains.some(function(d) { return combined.indexOf(d) !== -1; });

  if (isSkippable) return false;
  if (isEventDomain) return true;
  return hasEventTerm;
}

// ── City/country matching ──

function matchCity(text, searchCity, searchCountry) {
  var lower = text.toLowerCase();
  // Check if the search city appears in the text
  if (lower.indexOf(searchCity.toLowerCase()) !== -1) {
    return { city: searchCity, country: searchCountry };
  }
  // Fallback: check all cities
  for (var i = 0; i < CITIES.length; i++) {
    if (lower.indexOf(CITIES[i].name.toLowerCase()) !== -1) {
      return { city: CITIES[i].name, country: CITIES[i].country };
    }
  }
  return { city: searchCity, country: searchCountry };
}

// ── Slug generation ──

function generateSlug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

// ── Store event ──

async function storeEvent(eventData) {
  // Check for duplicate by URL or name+date
  var existing = null;
  if (eventData.website) {
    existing = await dbGet('SELECT id FROM events WHERE source_url = $1', [eventData.website]);
  }
  if (!existing && eventData.name && eventData.start_date) {
    existing = await dbGet('SELECT id FROM events WHERE name = $1 AND event_date = $2', [eventData.name, eventData.start_date]);
  }
  // Also check by slug
  var slug = generateSlug(eventData.name);
  if (!existing) {
    existing = await dbGet('SELECT id FROM events WHERE slug = $1', [slug]);
  }

  if (existing) {
    return { stored: false, reason: 'duplicate', id: existing.id };
  }

  // Normalize themes
  var themes = normalizeThemes(eventData.themes || []);

  var result = await dbRun(
    `INSERT INTO events (name, slug, description, event_date, city, country, themes, source_url, event_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      eventData.name,
      slug,
      (eventData.description || '').slice(0, 2000),
      eventData.start_date || null,
      eventData.city || '',
      eventData.country || '',
      JSON.stringify(themes),
      eventData.website || '',
      'conference'
    ]
  );

  return { stored: true, id: result.id, slug: slug };
}

// ── Main harvest function ──

async function harvest(options) {
  options = options || {};
  var filterTheme = options.theme || null;
  var filterCity = options.city || null;
  var dryRun = options.dryRun || false;
  var maxQueriesPerTheme = options.maxQueries || 2; // limit queries per theme-city combo

  var themes = THEME_SEARCHES;
  if (filterTheme) {
    themes = themes.filter(function(t) { return t.theme.toLowerCase() === filterTheme.toLowerCase(); });
  }

  var cities = CITIES;
  if (filterCity) {
    cities = cities.filter(function(c) { return c.name.toLowerCase() === filterCity.toLowerCase(); });
  }

  var stats = {
    queries: 0,
    results: 0,
    fetched: 0,
    extracted: 0,
    stored: 0,
    duplicates: 0,
    skipped: 0,
    errors: 0,
    events: []
  };

  console.log('Event Harvester starting...');
  console.log('Themes:', themes.length, '| Cities:', cities.length);
  console.log('Estimated queries:', themes.length * cities.length * maxQueriesPerTheme);
  console.log('Dry run:', dryRun);
  console.log('---');

  // Collect all search URLs first to deduplicate
  var seenUrls = new Set();
  var candidates = [];

  for (var t = 0; t < themes.length; t++) {
    var themeConfig = themes[t];
    var queries = themeConfig.queries.slice(0, maxQueriesPerTheme);

    for (var c = 0; c < cities.length; c++) {
      var city = cities[c];

      for (var q = 0; q < queries.length; q++) {
        var searchQuery = queries[q] + ' ' + city.name + ' ' + CURRENT_YEAR;
        console.log('Searching:', searchQuery);

        var results = await searchEvents(searchQuery);
        stats.queries++;

        for (var r = 0; r < results.length; r++) {
          var result = results[r];
          stats.results++;

          // Skip non-event results
          if (!isLikelyEvent(result.title, result.snippet, result.url)) {
            stats.skipped++;
            continue;
          }

          // Deduplicate by URL base (strip query params)
          var baseUrl = result.url.split('?')[0].split('#')[0];
          if (seenUrls.has(baseUrl)) continue;
          seenUrls.add(baseUrl);

          candidates.push({
            url: result.url,
            title: result.title,
            snippet: result.snippet,
            searchTheme: themeConfig.theme,
            searchCity: city.name,
            searchCountry: city.country
          });
        }

        // Rate limit: 50ms between searches
        await sleep(50);
      }
    }
  }

  console.log('\n--- Search complete ---');
  console.log('Unique candidates:', candidates.length);
  console.log('Fetching event pages...\n');

  // Fetch and extract
  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];

    if (dryRun) {
      console.log('[DRY]', candidate.searchTheme, '|', candidate.searchCity, '|', candidate.title);
      console.log('     ', candidate.url);
      stats.events.push({
        name: candidate.title,
        url: candidate.url,
        theme: candidate.searchTheme,
        city: candidate.searchCity
      });
      continue;
    }

    try {
      console.log('Fetching [' + (i + 1) + '/' + candidates.length + ']:', candidate.url);
      stats.fetched++;

      var pageData = await extractEventFromPage(candidate.url);

      if (!pageData) {
        // Use search result data as fallback
        pageData = {
          name: cleanTitle(candidate.title),
          description: candidate.snippet,
          website: candidate.url,
          source: 'search-result'
        };
      }

      // Enrich with search context
      if (!pageData.city) {
        var cityMatch = matchCity(
          pageData.name + ' ' + pageData.description + ' ' + candidate.snippet,
          candidate.searchCity,
          candidate.searchCountry
        );
        pageData.city = cityMatch.city;
        pageData.country = cityMatch.country;
      }

      // Extract dates from title/snippet if missing
      if (!pageData.start_date) {
        var dates = extractDatesFromText(candidate.title + ' ' + candidate.snippet + ' ' + pageData.description);
        if (dates.start_date) pageData.start_date = dates.start_date;
      }

      // Add theme
      pageData.themes = [candidate.searchTheme];
      pageData.harvest_source = 'harvester:' + (pageData.source || 'unknown');

      // Clean the name
      pageData.name = cleanTitle(pageData.name || candidate.title);

      // Skip if name is too short or generic
      if (!pageData.name || pageData.name.length < 5) {
        stats.skipped++;
        continue;
      }

      stats.extracted++;

      // Store
      var storeResult = await storeEvent(pageData);
      if (storeResult.stored) {
        stats.stored++;
        console.log('  ✓ Stored:', pageData.name, '| ID:', storeResult.id);
        stats.events.push({
          id: storeResult.id,
          name: pageData.name,
          city: pageData.city,
          theme: candidate.searchTheme,
          date: pageData.start_date,
          url: pageData.website
        });
      } else {
        stats.duplicates++;
        console.log('  ○ Duplicate:', pageData.name);
      }

      // Rate limit: 200ms between fetches
      await sleep(200);

    } catch (err) {
      stats.errors++;
      console.error('  ✗ Error:', err.message);
    }
  }

  console.log('\n=== Harvest Complete ===');
  console.log('Queries:', stats.queries);
  console.log('Search results:', stats.results);
  console.log('Pages fetched:', stats.fetched);
  console.log('Events extracted:', stats.extracted);
  console.log('New events stored:', stats.stored);
  console.log('Duplicates:', stats.duplicates);
  console.log('Skipped (not events):', stats.skipped);
  console.log('Errors:', stats.errors);

  return stats;
}

// ── Helpers ──

function cleanTitle(title) {
  if (!title) return '';
  // Remove common suffixes
  return title
    .replace(/\s*[-|–—]\s*(Eventbrite|Luma|Meetup|Hopin|Register|Tickets|Home).*$/i, '')
    .replace(/\s*[-|–—]\s*\d{4}.*$/i, '')
    .trim();
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(text) {
  return (text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// ── CLI entry point ──

if (require.main === module) {
  var args = process.argv.slice(2);
  var options = {};

  for (var i = 0; i < args.length; i++) {
    if (args[i] === '--theme' && args[i + 1]) { options.theme = args[++i]; }
    else if (args[i] === '--city' && args[i + 1]) { options.city = args[++i]; }
    else if (args[i] === '--dry-run') { options.dryRun = true; }
    else if (args[i] === '--max-queries' && args[i + 1]) { options.maxQueries = parseInt(args[++i]); }
  }

  harvest(options).then(function(stats) {
    console.log('\nDone. Stored ' + stats.stored + ' new events.');
    process.exit(0);
  }).catch(function(err) {
    console.error('Harvest failed:', err);
    process.exit(1);
  });
}

module.exports = { harvest, searchEvents, extractEventFromPage, CITIES, THEME_SEARCHES };