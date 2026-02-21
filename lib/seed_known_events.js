require('dotenv').config();

var { dbGet, dbRun } = require('../db');

// Real 2026 dates — verified from official sources
var KNOWN_EVENTS = [
  // ── JANUARY ──
  { name: 'CES 2026', start: '2026-01-06', end: '2026-01-09', city: 'Las Vegas', country: 'USA', themes: ['AI', 'Consumer Tech', 'Robotics', 'Health'], website: 'https://www.ces.tech' },

  // ── FEBRUARY ──
  { name: 'World AI Cannes Festival 2026', start: '2026-02-12', end: '2026-02-13', city: 'Cannes', country: 'France', themes: ['AI'], website: 'https://worldaicannes.com' },
  { name: 'Consensus Hong Kong 2026', start: '2026-02-10', end: '2026-02-12', city: 'Hong Kong', country: 'Hong Kong', themes: ['Web3/Crypto', 'Fintech'], website: 'https://consensus.coindesk.com/hong-kong' },
  { name: 'ETHDenver 2026', start: '2026-02-17', end: '2026-02-21', city: 'Denver', country: 'USA', themes: ['Web3/Crypto'], website: 'https://www.ethdenver.com' },

  // ── MARCH ──
  { name: 'MWC Barcelona 2026', start: '2026-03-02', end: '2026-03-05', city: 'Barcelona', country: 'Spain', themes: ['Enterprise SaaS', 'AI', 'Cybersecurity'], website: 'https://www.mwcbarcelona.com' },
  { name: 'SXSW 2026', start: '2026-03-12', end: '2026-03-18', city: 'Austin', country: 'USA', themes: ['AI', 'Media & Entertainment', 'Enterprise SaaS'], website: 'https://sxsw.com' },
  { name: 'RSA Conference 2026', start: '2026-03-23', end: '2026-03-26', city: 'San Francisco', country: 'USA', themes: ['Cybersecurity'], website: 'https://www.rsaconference.com' },

  // ── APRIL ──
  { name: 'Paris Blockchain Week 2026', start: '2026-04-15', end: '2026-04-16', city: 'Paris', country: 'France', themes: ['Web3/Crypto', 'Fintech'], website: 'https://www.parisblockchainweek.com' },
  { name: 'Bitcoin 2026', start: '2026-04-27', end: '2026-04-29', city: 'Las Vegas', country: 'USA', themes: ['Web3/Crypto'], website: 'https://b.tc/conference' },
  { name: 'TOKEN2049 Dubai 2026', start: '2026-04-29', end: '2026-04-30', city: 'Dubai', country: 'UAE', themes: ['Web3/Crypto', 'Fintech'], website: 'https://www.token2049.com/dubai' },

  // ── MAY ──
  { name: 'Consensus Miami 2026', start: '2026-05-05', end: '2026-05-07', city: 'Miami', country: 'USA', themes: ['Web3/Crypto', 'Fintech', 'AI'], website: 'https://consensus.coindesk.com' },
  { name: 'SaaStr Annual 2026', start: '2026-05-12', end: '2026-05-14', city: 'San Francisco', country: 'USA', themes: ['Enterprise SaaS', 'AI'], website: 'https://www.saastrannual.com' },

  // ── JUNE ──
  { name: 'Money20/20 Europe 2026', start: '2026-06-02', end: '2026-06-04', city: 'Amsterdam', country: 'Netherlands', themes: ['Fintech'], website: 'https://europe.money2020.com' },
  { name: 'Collision 2026', start: '2026-06-03', end: '2026-06-04', city: 'Toronto', country: 'Canada', themes: ['AI', 'Enterprise SaaS', 'Fintech'], website: 'https://collisionconf.com' },
  { name: 'South Summit Madrid 2026', start: '2026-06-03', end: '2026-06-05', city: 'Madrid', country: 'Spain', themes: ['AI', 'Fintech', 'Enterprise SaaS', 'Climate'], website: 'https://www.southsummit.co' },
  { name: 'London Tech Week 2026', start: '2026-06-08', end: '2026-06-12', city: 'London', country: 'UK', themes: ['AI', 'Enterprise SaaS', 'Cybersecurity', 'Space'], website: 'https://londontechweek.com' },
  { name: 'HLTH Europe 2026', start: '2026-06-15', end: '2026-06-18', city: 'Amsterdam', country: 'Netherlands', themes: ['Health'], website: 'https://europe.hlth.com' },
  { name: 'Eurosatory 2026', start: '2026-06-15', end: '2026-06-19', city: 'Paris', country: 'France', themes: ['Defence'], website: 'https://www.eurosatory.com' },
  { name: 'VivaTech 2026', start: '2026-06-17', end: '2026-06-20', city: 'Paris', country: 'France', themes: ['AI', 'Enterprise SaaS', 'Climate'], website: 'https://vivatech.com' },

  // ── JULY ──
  { name: 'WebX 2026', start: '2026-07-13', end: '2026-07-14', city: 'Tokyo', country: 'Japan', themes: ['Web3/Crypto', 'AI'], website: 'https://webx-asia.com' },

  // ── AUGUST ──
  { name: 'Black Hat USA 2026', start: '2026-08-01', end: '2026-08-06', city: 'Las Vegas', country: 'USA', themes: ['Cybersecurity'], website: 'https://www.blackhat.com' },

  // ── OCTOBER ──
  { name: 'TOKEN2049 Singapore 2026', start: '2026-10-07', end: '2026-10-08', city: 'Singapore', country: 'Singapore', themes: ['Web3/Crypto', 'Fintech'], website: 'https://www.token2049.com/singapore' },
  { name: 'TechCrunch Disrupt 2026', start: '2026-10-13', end: '2026-10-15', city: 'San Francisco', country: 'USA', themes: ['AI', 'Enterprise SaaS', 'Fintech', 'Health'], website: 'https://techcrunch.com/events/tc-disrupt-2026/' },

  // ── NOVEMBER ──
  { name: 'Web Summit 2026', start: '2026-11-09', end: '2026-11-12', city: 'Lisbon', country: 'Portugal', themes: ['AI', 'Enterprise SaaS', 'Fintech', 'Climate'], website: 'https://websummit.com' },
  { name: 'HLTH USA 2026', start: '2026-11-15', end: '2026-11-18', city: 'Las Vegas', country: 'USA', themes: ['Health', 'AI'], website: 'https://hlth.com/events/usa/' },
  { name: 'Slush 2026', start: '2026-11-18', end: '2026-11-19', city: 'Helsinki', country: 'Finland', themes: ['AI', 'Enterprise SaaS', 'Fintech', 'Climate'], website: 'https://slush.org' },
  { name: 'Singapore FinTech Festival 2026', start: '2026-11-18', end: '2026-11-20', city: 'Singapore', country: 'Singapore', themes: ['Fintech', 'AI'], website: 'https://www.fintechfestival.sg' },

  // ── DECEMBER ──
  { name: 'GITEX Global 2026', start: '2026-12-07', end: '2026-12-11', city: 'Dubai', country: 'UAE', themes: ['AI', 'Enterprise SaaS', 'Cybersecurity', 'Fintech'], website: 'https://www.gitex.com' },
];

function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeThemes(themes) {
  var themeMap = {
    'ai': 'AI', 'artificial intelligence': 'AI', 'machine learning': 'AI',
    'fintech': 'Fintech', 'financial technology': 'Fintech', 'payments': 'Fintech',
    'web3': 'Web3/Crypto', 'web3/crypto': 'Web3/Crypto', 'crypto': 'Web3/Crypto', 'blockchain': 'Web3/Crypto',
    'climate': 'Climate', 'sustainability': 'Climate', 'cleantech': 'Climate', 'energy': 'Climate',
    'health': 'Health', 'healthtech': 'Health', 'biotech': 'Health', 'digital health': 'Health',
    'enterprise saas': 'Enterprise SaaS', 'saas': 'Enterprise SaaS', 'cloud': 'Enterprise SaaS',
    'cybersecurity': 'Cybersecurity', 'security': 'Cybersecurity',
    'defence': 'Defence', 'defense': 'Defence',
    'space': 'Space',
    'robotics': 'Robotics',
    'quantum': 'Quantum',
    'consumer tech': 'Consumer Tech',
    'media & entertainment': 'Media & Entertainment',
    'food & agriculture': 'Food & Agriculture',
    'supply chain': 'Supply Chain',
    'real estate': 'Real Estate',
    'education': 'Education',
  };
  return themes.map(function(t) {
    return themeMap[t.toLowerCase()] || t;
  }).filter(function(v, i, a) { return a.indexOf(v) === i; });
}

async function seed() {
  console.log('Seeding ' + KNOWN_EVENTS.length + ' known events with real 2026 dates...');

  var stored = 0;
  var duplicates = 0;
  var errors = 0;

  for (var i = 0; i < KNOWN_EVENTS.length; i++) {
    var e = KNOWN_EVENTS[i];
    var slug = generateSlug(e.name);

    // Check duplicate by slug or source_url
    var existing = await dbGet('SELECT id FROM events WHERE slug = $1 OR source_url = $2', [slug, e.website]);
    if (existing) {
      duplicates++;
      continue;
    }

    var themes = normalizeThemes(e.themes || []);
    var desc = e.name + ' — ' + e.city + ', ' + e.country + '. ' + themes.join(', ') + '.';

    try {
      await dbRun(
        `INSERT INTO events (name, slug, description, event_date, city, country, themes, source_url, event_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          e.name,
          slug,
          desc,
          e.start,
          e.city,
          e.country,
          JSON.stringify(themes),
          e.website,
          'conference'
        ]
      );

      stored++;
      console.log('✓', e.name, '|', e.start, '→', e.end, '|', e.city, '|', themes.join(', '));
    } catch (err) {
      errors++;
      console.error('✗', e.name, err.message);
    }
  }

  console.log('\nDone:', stored, 'stored,', duplicates, 'duplicates,', errors, 'errors');
  console.log('Total events in DB:', (await dbGet('SELECT COUNT(*) as count FROM events')).count);
  process.exit(0);
}

seed().catch(function(err) {
  console.error('Seed failed:', err);
  process.exit(1);
});