#!/usr/bin/env node
/**
 * EventMedium Match Quality Test Harness
 * 
 * Creates a test event, 100 diverse delegate profiles,
 * runs the matching engine, and outputs quality metrics.
 * 
 * Usage: node scripts/test-matching.js
 * Cleanup: node scripts/test-matching.js --cleanup
 */

var { dbGet, dbRun, dbAll } = require('../db');

// ══════════════════════════════════════════════════════
// TEST PROFILE GENERATOR
// ══════════════════════════════════════════════════════

var TEST_PREFIX = 'test_match_harness_';
var TEST_EVENT_SLUG = 'test-match-quality-2026';

// Realistic delegate archetypes with weighted distribution
function buildArchetypes() {
  var list = [];
  for (var i = 0; i < 30; i++) list.push(buildFounder(i));
  for (var i = 0; i < 20; i++) list.push(buildInvestor(i));
  for (var i = 0; i < 20; i++) list.push(buildCorporate(i));
  for (var i = 0; i < 12; i++) list.push(buildResearcher(i));
  for (var i = 0; i < 10; i++) list.push(buildAdvisor(i));
  for (var i = 0; i < 8; i++) list.push(buildOperator(i));
  return list;
}

// ── Theme pools (realistic clustering) ──
var THEME_CLUSTERS = {
  'ai_infra': ['AI', 'Enterprise SaaS', 'Open Source'],
  'ai_health': ['AI', 'HealthTech', 'Privacy'],
  'ai_finance': ['AI', 'FinTech', 'Cybersecurity'],
  'climate': ['Climate Tech', 'Hardware', 'IoT'],
  'web3_privacy': ['Privacy', 'FinTech', 'Cybersecurity'],
  'deeptech': ['Robotics', 'SpaceTech', 'Hardware'],
  'edtech': ['EdTech', 'AI', 'Open Source'],
  'connectivity': ['Connectivity', 'IoT', 'Enterprise SaaS'],
  'gaming_ai': ['Gaming', 'AI', 'Hardware'],
  'regulation': ['Regulation', 'Privacy', 'FinTech']
};

var CLUSTER_KEYS = Object.keys(THEME_CLUSTERS);

var GEOGRAPHIES = [
  'San Francisco, CA', 'New York, NY', 'London, UK', 'Berlin, Germany',
  'Singapore', 'Tel Aviv, Israel', 'Toronto, Canada', 'Paris, France',
  'Sydney, Australia', 'Bangalore, India', 'São Paulo, Brazil', 'Dubai, UAE',
  'Amsterdam, Netherlands', 'Stockholm, Sweden', 'Seoul, South Korea'
];

var COMPANIES_BY_TYPE = {
  founder: [
    'NeuralForge', 'ClimateAI', 'VaultPay', 'HealthScan', 'DataHive',
    'RoboLogic', 'EduFlow', 'CyberShield', 'QuantumLeap', 'GreenGrid',
    'TokenMint', 'DeepSense', 'MediBot', 'SolarScale', 'CodeWeave',
    'PrivacyFirst', 'AgriTech Labs', 'DroneOps', 'FinStack', 'BiomeAI',
    'Nexus Robotics', 'ClearPath', 'Orbital Labs', 'WaveNet', 'SecureID',
    'PulseAI', 'TerraSync', 'MetaLearn', 'FluxEnergy', 'SynthBio'
  ],
  investor: [
    'Sequoia Capital', 'a16z', 'Accel', 'Index Ventures', 'Balderton Capital',
    'Northzone', 'EQT Ventures', 'Atomico', 'Lightspeed', 'GV',
    'Lux Capital', 'First Round', 'USV', 'Greylock', 'Insight Partners',
    'Obvious Ventures', 'Breakthrough Energy', 'True Ventures', 'Founders Fund', 'Bessemer'
  ],
  corporate: [
    'Google', 'Microsoft', 'Siemens', 'Bosch', 'Samsung',
    'JPMorgan', 'Nvidia', 'SAP', 'Philips', 'Shell',
    'Roche', 'Airbus', 'Deutsche Telekom', 'Unilever', 'HSBC',
    'BMW', 'AstraZeneca', 'Ericsson', 'Nokia', 'ABB'
  ],
  researcher: [
    'MIT CSAIL', 'Stanford HAI', 'Oxford Internet Institute', 'ETH Zürich',
    'Max Planck Institute', 'DeepMind Research', 'INRIA', 'Tsinghua University',
    'Cambridge Bio', 'Imperial College', 'Caltech', 'CMU Robotics'
  ],
  advisor: [
    'Independent', 'McKinsey', 'BCG', 'Deloitte', 'EY',
    'Board Member', 'Angel Investor', 'Former CEO', 'Industry Expert', 'Venture Partner'
  ],
  operator: [
    'Stripe', 'Datadog', 'Cloudflare', 'Figma', 'Notion',
    'Linear', 'Vercel', 'Supabase'
  ]
};

// ── Builder functions ──

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickN(arr, n) {
  var shuffled = arr.slice().sort(function() { return 0.5 - Math.random(); });
  return shuffled.slice(0, n);
}
function pickCluster() { return pick(CLUSTER_KEYS); }

function buildFounder(i) {
  var cluster = pickCluster();
  var themes = THEME_CLUSTERS[cluster];
  var stages = ['pre-seed', 'seed', 'Series A', 'Series B', 'growth'];
  var stage = pick(stages);
  var raises = { 'pre-seed': '$500K', 'seed': '$2-4M', 'Series A': '$8-15M', 'Series B': '$25-50M', 'growth': '$50M+' };

  return {
    name: 'Test Founder ' + (i + 1),
    email: TEST_PREFIX + 'founder_' + i + '@test.eventmedium.ai',
    company: pick(COMPANIES_BY_TYPE.founder),
    stakeholder_type: 'founder',
    themes: themes,
    intent: pickN(['funding', 'partnerships', 'customers', 'talent', 'distribution', 'technical advisors'], 2),
    offering: pickN(['technology', 'proprietary data', 'domain expertise', 'team', 'IP', 'market access'], 2),
    geography: pick(GEOGRAPHIES),
    context: 'Building ' + themes[0].toLowerCase() + ' platform for ' + themes[1].toLowerCase() + '. ' + stage + ' stage, ' + (stage === 'pre-seed' ? 'bootstrapping' : 'raised ' + raises[stage]) + '.',
    deal_details: {
      stage: stage,
      raising: raises[stage],
      sector: themes[0]
    }
  };
}

function buildInvestor(i) {
  var cluster = pickCluster();
  var themes = THEME_CLUSTERS[cluster];
  var stages = [['pre-seed', 'seed'], ['seed', 'Series A'], ['Series A', 'Series B'], ['Series B', 'growth']];
  var stagePrefs = pick(stages);
  var checks = { 'pre-seed': '$100K-500K', 'seed': '$500K-2M', 'Series A': '$2-10M', 'Series B': '$10-30M', 'growth': '$30M+' };

  return {
    name: 'Test Investor ' + (i + 1),
    email: TEST_PREFIX + 'investor_' + i + '@test.eventmedium.ai',
    company: pick(COMPANIES_BY_TYPE.investor),
    stakeholder_type: 'investor',
    themes: themes,
    intent: pickN(['deal flow', 'co-investment', 'market intelligence', 'portfolio support', 'LP relationships'], 2),
    offering: pickN(['capital', 'board seats', 'network', 'operational support', 'follow-on funding', 'go-to-market'], 2),
    geography: pick(GEOGRAPHIES),
    context: 'Investing in ' + themes.join(' + ') + '. Focus on ' + stagePrefs.join('/') + '.',
    deal_details: {
      stage: stagePrefs.join(', '),
      check_size: checks[stagePrefs[0]],
      thesis: themes[0] + ' transformation',
      sector: themes[0]
    }
  };
}

function buildCorporate(i) {
  var cluster = pickCluster();
  var themes = THEME_CLUSTERS[cluster];

  return {
    name: 'Test Corporate ' + (i + 1),
    email: TEST_PREFIX + 'corporate_' + i + '@test.eventmedium.ai',
    company: pick(COMPANIES_BY_TYPE.corporate),
    stakeholder_type: 'corporate',
    themes: themes,
    intent: pickN(['technology scouting', 'partnerships', 'acquisition targets', 'pilot programs', 'research collaboration'], 2),
    offering: pickN(['distribution', 'enterprise customers', 'data', 'infrastructure', 'budget', 'domain expertise'], 2),
    geography: pick(GEOGRAPHIES),
    context: 'Leading ' + themes[0].toLowerCase() + ' strategy at ' + pick(COMPANIES_BY_TYPE.corporate) + '. Scouting for ' + themes[1].toLowerCase() + ' startups.',
    deal_details: {}
  };
}

function buildResearcher(i) {
  var cluster = pickCluster();
  var themes = THEME_CLUSTERS[cluster];

  return {
    name: 'Test Researcher ' + (i + 1),
    email: TEST_PREFIX + 'researcher_' + i + '@test.eventmedium.ai',
    company: pick(COMPANIES_BY_TYPE.researcher),
    stakeholder_type: 'researcher',
    themes: themes,
    intent: pickN(['industry collaboration', 'funding', 'data access', 'commercialization', 'publishing partners'], 2),
    offering: pickN(['research', 'IP', 'talent pipeline', 'academic credibility', 'novel algorithms', 'benchmark datasets'], 2),
    geography: pick(GEOGRAPHIES),
    context: 'Leading research in ' + themes.join(' & ') + '. Published 12+ papers, exploring commercialization.',
    deal_details: {}
  };
}

function buildAdvisor(i) {
  var cluster = pickCluster();
  var themes = THEME_CLUSTERS[cluster];

  return {
    name: 'Test Advisor ' + (i + 1),
    email: TEST_PREFIX + 'advisor_' + i + '@test.eventmedium.ai',
    company: pick(COMPANIES_BY_TYPE.advisor),
    stakeholder_type: 'advisor',
    themes: themes,
    intent: pickN(['advisory roles', 'board seats', 'angel investments', 'consulting engagements'], 2),
    offering: pickN(['strategic guidance', 'industry connections', 'operational experience', 'fundraising support', 'GTM expertise'], 2),
    geography: pick(GEOGRAPHIES),
    context: 'Former ' + pick(['CTO', 'CEO', 'VP Product', 'VP Eng']) + ' with 15+ years in ' + themes[0] + '. Active advisor to ' + pick(['3', '5', '8']) + ' startups.',
    deal_details: {}
  };
}

function buildOperator(i) {
  var cluster = pickCluster();
  var themes = THEME_CLUSTERS[cluster];

  return {
    name: 'Test Operator ' + (i + 1),
    email: TEST_PREFIX + 'operator_' + i + '@test.eventmedium.ai',
    company: pick(COMPANIES_BY_TYPE.operator),
    stakeholder_type: 'operator',
    themes: themes,
    intent: pickN(['talent', 'partnerships', 'best practices', 'vendor evaluation', 'peer learning'], 2),
    offering: pickN(['hiring pipeline', 'technical expertise', 'scaling playbooks', 'vendor relationships', 'operational systems'], 2),
    geography: pick(GEOGRAPHIES),
    context: pick(['VP Engineering', 'Head of Product', 'CTO', 'Director of Ops']) + ' at ' + pick(COMPANIES_BY_TYPE.operator) + '. Scaling ' + themes[0].toLowerCase() + ' team.',
    deal_details: {}
  };
}

// ══════════════════════════════════════════════════════
// SETUP + RUN + ANALYZE
// ══════════════════════════════════════════════════════

async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');

  // Find test users
  var testUsers = await dbAll(
    "SELECT id FROM users WHERE email LIKE $1",
    [TEST_PREFIX + '%']
  );
  var userIds = testUsers.map(function(u) { return u.id; });

  if (!userIds.length) {
    console.log('   No test data found.');
    return;
  }

  console.log('   Found ' + userIds.length + ' test users');

  // Find test event
  var testEvent = await dbGet("SELECT id FROM events WHERE slug = $1", [TEST_EVENT_SLUG]);

  // Delete in dependency order
  if (testEvent) {
    await dbRun("DELETE FROM event_matches WHERE event_id = $1", [testEvent.id]);
    await dbRun("DELETE FROM event_registrations WHERE event_id = $1", [testEvent.id]);
    await dbRun("DELETE FROM events WHERE id = $1", [testEvent.id]);
    console.log('   ✓ Deleted test event + matches + registrations');
  }

  for (var uid of userIds) {
    await dbRun("DELETE FROM stakeholder_profiles WHERE user_id = $1", [uid]);
    await dbRun("DELETE FROM sessions WHERE user_id = $1", [uid]);
  }
  await dbRun("DELETE FROM users WHERE email LIKE $1", [TEST_PREFIX + '%']);
  console.log('   ✓ Deleted ' + userIds.length + ' test users + profiles');
  console.log('   ✅ Cleanup complete\n');
}

async function setup() {
  console.log('\n📦 Creating test data...');

  // 1. Create test event
  var existing = await dbGet("SELECT id FROM events WHERE slug = $1", [TEST_EVENT_SLUG]);
  if (existing) {
    console.log('   ⚠  Test event already exists (id: ' + existing.id + '). Run --cleanup first.');
    return null;
  }

  var eventResult = await dbRun(
    `INSERT INTO events (name, slug, event_date, city, country, themes, expected_attendees)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      'Match Quality Test — AI + Climate Summit 2026',
      TEST_EVENT_SLUG,
      '2026-06-15',
      'London',
      'UK',
      JSON.stringify(['AI', 'Climate Tech', 'FinTech', 'Enterprise SaaS', 'HealthTech', 'Privacy']),
      200
    ]
  );
  var eventId = eventResult.rows[0].id;
  console.log('   ✓ Test event created (id: ' + eventId + ')');

  // 2. Create users + profiles + registrations
  var userIds = [];
  var profiles = [];
  var ARCHETYPES = buildArchetypes();
  for (var i = 0; i < ARCHETYPES.length; i++) {
    var a = ARCHETYPES[i];

    // Create user
    var userResult = await dbRun(
      "INSERT INTO users (name, email, company, auth_provider) VALUES ($1, $2, $3, 'test') RETURNING id",
      [a.name, a.email, a.company]
    );
    var userId = userResult.rows[0].id;
    userIds.push(userId);

    // Create profile
    await dbRun(
      `INSERT INTO stakeholder_profiles
        (user_id, stakeholder_type, themes, intent, offering, focus_text, geography, deal_details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId, a.stakeholder_type,
        JSON.stringify(a.themes),
        JSON.stringify(a.intent),
        JSON.stringify(a.offering),
        a.context,
        a.geography,
        JSON.stringify(a.deal_details || {})
      ]
    );

    // Register for event
    await dbRun(
      "INSERT INTO event_registrations (event_id, user_id, status) VALUES ($1, $2, 'active')",
      [eventId, userId]
    );

    profiles.push({ userId: userId, ...a });
  }

  console.log('   ✓ Created ' + userIds.length + ' test profiles');
  console.log('     → 30 founders, 20 investors, 20 corporates, 12 researchers, 10 advisors, 8 operators');
  console.log('   ✓ All registered for test event');

  return { eventId, userIds, profiles };
}

async function runMatching(eventId, userIds, profiles) {
  console.log('\n⚡ Running matching engine...');
  console.log('   Scoring all ' + (userIds.length * (userIds.length - 1) / 2) + ' unique pairs');
  console.log('   (This may take a few minutes if embeddings are enabled)\n');

  // We'll score ALL pairs but skip embeddings for speed
  // Load the scoring functions
  var { scoreMatch } = require('../routes/matches');

  var allScores = [];
  var pairsScored = 0;
  var startTime = Date.now();

  for (var i = 0; i < userIds.length; i++) {
    for (var j = i + 1; j < userIds.length; j++) {
      try {
        var result = await scoreMatch(userIds[i], userIds[j], eventId, {
          enrichWithSignals: false // skip external signals for speed
        });

        if (result) {
          allScores.push({
            ...result,
            typeA: profiles[i].stakeholder_type,
            typeB: profiles[j].stakeholder_type,
            themesA: profiles[i].themes,
            themesB: profiles[j].themes
          });
        }
      } catch(e) {
        // Skip errors (embedding failures etc)
      }

      pairsScored++;
      if (pairsScored % 500 === 0) {
        var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log('   ... ' + pairsScored + ' pairs scored (' + elapsed + 's)');
      }
    }
  }

  var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('   ✓ ' + allScores.length + ' pairs scored in ' + elapsed + 's');

  return allScores;
}

function analyze(scores, profiles) {
  console.log('\n' + '═'.repeat(60));
  console.log(' MATCH QUALITY ANALYSIS');
  console.log('═'.repeat(60));

  // ── 1. Score Distribution ──
  console.log('\n📊 SCORE DISTRIBUTION');
  var sorted = scores.map(function(s) { return s.score_total; }).sort(function(a, b) { return b - a; });

  var bands = [
    { label: '0.8-1.0 (Excellent)', min: 0.8, max: 1.01 },
    { label: '0.6-0.8 (Strong)', min: 0.6, max: 0.8 },
    { label: '0.4-0.6 (Moderate)', min: 0.4, max: 0.6 },
    { label: '0.2-0.4 (Weak)', min: 0.2, max: 0.4 },
    { label: '0.0-0.2 (Noise)', min: 0.0, max: 0.2 }
  ];

  bands.forEach(function(b) {
    var count = sorted.filter(function(s) { return s >= b.min && s < b.max; }).length;
    var pct = ((count / sorted.length) * 100).toFixed(1);
    var bar = '█'.repeat(Math.round(pct / 2));
    console.log('   ' + b.label.padEnd(25) + count.toString().padStart(5) + ' (' + pct.padStart(5) + '%) ' + bar);
  });

  console.log('\n   Mean:   ' + mean(sorted).toFixed(3));
  console.log('   Median: ' + median(sorted).toFixed(3));
  console.log('   StdDev: ' + stddev(sorted).toFixed(3));
  console.log('   P90:    ' + percentile(sorted, 90).toFixed(3));
  console.log('   P95:    ' + percentile(sorted, 95).toFixed(3));

  // ── 2. Archetype Pair Performance ──
  console.log('\n🎯 ARCHETYPE PAIR PERFORMANCE (avg score)');
  var pairScores = {};
  scores.forEach(function(s) {
    var pair = [s.typeA, s.typeB].sort().join(' ↔ ');
    if (!pairScores[pair]) pairScores[pair] = [];
    pairScores[pair].push(s.score_total);
  });

  var pairAvgs = Object.keys(pairScores).map(function(pair) {
    return { pair: pair, avg: mean(pairScores[pair]), count: pairScores[pair].length };
  }).sort(function(a, b) { return b.avg - a.avg; });

  pairAvgs.forEach(function(p) {
    var bar = '█'.repeat(Math.round(p.avg * 30));
    console.log('   ' + p.pair.padEnd(28) + p.avg.toFixed(3) + ' (n=' + p.count.toString().padStart(4) + ') ' + bar);
  });

  // ── 3. Component Contribution ──
  console.log('\n🔧 SCORING COMPONENT ANALYSIS');

  var components = ['score_semantic', 'score_theme', 'score_intent', 'score_stakeholder', 'score_capital', 'score_network_proximity'];
  var componentNames = {
    score_semantic: 'Semantic',
    score_theme: 'Theme Overlap',
    score_intent: 'Intent Comp.',
    score_stakeholder: 'Archetype Fit',
    score_capital: 'Capital Fit',
    score_network_proximity: 'Network Prox.'
  };

  components.forEach(function(comp) {
    var vals = scores.map(function(s) { return s[comp] || 0; }).filter(function(v) { return v > 0; });
    if (vals.length > 0) {
      console.log('   ' + (componentNames[comp] || comp).padEnd(18) +
        'mean=' + mean(vals).toFixed(3) +
        '  med=' + median(vals).toFixed(3) +
        '  active=' + vals.length + '/' + scores.length);
    } else {
      console.log('   ' + (componentNames[comp] || comp).padEnd(18) + '(no data)');
    }
  });

  // ── 4. Correlation: do high-component scores predict high totals? ──
  console.log('\n📈 COMPONENT-TOTAL CORRELATION');
  components.forEach(function(comp) {
    var vals = scores.filter(function(s) { return (s[comp] || 0) > 0; });
    if (vals.length > 20) {
      var corr = correlation(
        vals.map(function(s) { return s[comp] || 0; }),
        vals.map(function(s) { return s.score_total; })
      );
      var indicator = corr > 0.5 ? '🟢' : corr > 0.3 ? '🟡' : '🔴';
      console.log('   ' + indicator + ' ' + (componentNames[comp] || comp).padEnd(18) + 'r=' + corr.toFixed(3));
    }
  });

  // ── 5. Theme Cluster Analysis ──
  console.log('\n🏷️  THEME MATCHING QUALITY');
  var themeStats = { exact: 0, partial: 0, none: 0 };
  var highScoreThemeOverlap = [];

  scores.forEach(function(s) {
    var shared = s.themesA.filter(function(t) { return s.themesB.indexOf(t) !== -1; });
    if (shared.length === s.themesA.length || shared.length === s.themesB.length) {
      themeStats.exact++;
    } else if (shared.length > 0) {
      themeStats.partial++;
    } else {
      themeStats.none++;
    }

    if (s.score_total >= 0.6) {
      highScoreThemeOverlap.push(shared.length);
    }
  });

  console.log('   Full theme match:    ' + themeStats.exact + ' (' + ((themeStats.exact / scores.length) * 100).toFixed(1) + '%)');
  console.log('   Partial overlap:     ' + themeStats.partial + ' (' + ((themeStats.partial / scores.length) * 100).toFixed(1) + '%)');
  console.log('   Zero overlap:        ' + themeStats.none + ' (' + ((themeStats.none / scores.length) * 100).toFixed(1) + '%)');

  if (highScoreThemeOverlap.length > 0) {
    console.log('   Avg theme overlap in 0.6+ matches: ' + mean(highScoreThemeOverlap).toFixed(2) + ' themes');
  }

  // ── 6. Top Matches (sanity check) ──
  console.log('\n🏆 TOP 15 MATCHES (do these make sense?)');
  var top = scores.sort(function(a, b) { return b.score_total - a.score_total; }).slice(0, 15);

  top.forEach(function(s, idx) {
    var profileA = profiles.find(function(p) { return p.userId === s.user_a_id; });
    var profileB = profiles.find(function(p) { return p.userId === s.user_b_id; });
    if (!profileA || !profileB) return;

    var sharedThemes = profileA.themes.filter(function(t) { return profileB.themes.indexOf(t) !== -1; });

    console.log('\n   #' + (idx + 1) + ' Score: ' + s.score_total.toFixed(3));
    console.log('      ' + profileA.stakeholder_type.toUpperCase() + ' (' + profileA.company + ') ↔ ' +
                profileB.stakeholder_type.toUpperCase() + ' (' + profileB.company + ')');
    console.log('      Shared: ' + (sharedThemes.length ? sharedThemes.join(', ') : 'none'));
    console.log('      Sem=' + (s.score_semantic || 0).toFixed(2) +
                ' Thm=' + (s.score_theme || 0).toFixed(2) +
                ' Int=' + (s.score_intent || 0).toFixed(2) +
                ' Sth=' + (s.score_stakeholder || 0).toFixed(2) +
                ' Cap=' + (s.score_capital || '-') +
                ' Net=' + (s.score_network_proximity || 0).toFixed(2));
    if (s.match_reasons && s.match_reasons.length) {
      console.log('      Reasons: ' + s.match_reasons.slice(0, 3).join('; '));
    }
  });

  // ── 7. Worst Matches (false positive check) ──
  console.log('\n\n⚠️  WEAKEST MATCHES ABOVE 0.4 THRESHOLD (false positive candidates)');
  var aboveThreshold = scores.filter(function(s) { return s.score_total >= 0.4; })
    .sort(function(a, b) { return a.score_total - b.score_total; }).slice(0, 5);

  aboveThreshold.forEach(function(s) {
    var profileA = profiles.find(function(p) { return p.userId === s.user_a_id; });
    var profileB = profiles.find(function(p) { return p.userId === s.user_b_id; });
    if (!profileA || !profileB) return;

    console.log('   Score: ' + s.score_total.toFixed(3) + ' — ' +
                profileA.stakeholder_type + ' (' + profileA.company + ') ↔ ' +
                profileB.stakeholder_type + ' (' + profileB.company + ')');
    console.log('      A themes: ' + profileA.themes.join(', ') + '  |  B themes: ' + profileB.themes.join(', '));
  });

  // ── 8. Match Supply Stats ──
  var matchable = scores.filter(function(s) { return s.score_total >= 0.4; }).length;
  var strong = scores.filter(function(s) { return s.score_total >= 0.6; }).length;
  var excellent = scores.filter(function(s) { return s.score_total >= 0.8; }).length;

  console.log('\n\n📋 SUMMARY');
  console.log('   Total pairs scored:     ' + scores.length);
  console.log('   Above 0.4 (matchable):  ' + matchable + ' (' + ((matchable / scores.length) * 100).toFixed(1) + '%)');
  console.log('   Above 0.6 (strong):     ' + strong + ' (' + ((strong / scores.length) * 100).toFixed(1) + '%)');
  console.log('   Above 0.8 (excellent):  ' + excellent + ' (' + ((excellent / scores.length) * 100).toFixed(1) + '%)');
  console.log('   Avg matches per user:   ' + (matchable * 2 / profiles.length).toFixed(1) + ' (at 0.4 threshold)');
  console.log('   Avg strong per user:    ' + (strong * 2 / profiles.length).toFixed(1) + ' (at 0.6 threshold)');

  // Quality verdict
  console.log('\n' + '═'.repeat(60));
  var matchRatio = matchable / scores.length;
  var strongRatio = strong / scores.length;
  if (matchRatio > 0.5) {
    console.log(' ⚠️  VERDICT: Threshold too low — matching 50%+ of pairs is noise');
  } else if (matchRatio < 0.05) {
    console.log(' ⚠️  VERDICT: Threshold too high — under 5% match rate starves users');
  } else if (strongRatio > 0.3) {
    console.log(' ⚠️  VERDICT: Scores too concentrated — algorithm may not discriminate enough');
  } else if (strongRatio < 0.02) {
    console.log(' ⚠️  VERDICT: Too few strong matches — relax weights or threshold');
  } else {
    console.log(' ✅ VERDICT: Healthy distribution — algorithm is discriminating');
  }
  console.log('═'.repeat(60) + '\n');
}

// ── Stats helpers ──
function mean(arr) { return arr.reduce(function(a, b) { return a + b; }, 0) / arr.length; }
function median(arr) { var s = arr.slice().sort(function(a, b) { return a - b; }); var m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function stddev(arr) { var m = mean(arr); return Math.sqrt(arr.reduce(function(s, v) { return s + (v - m) * (v - m); }, 0) / arr.length); }
function percentile(arr, p) { var s = arr.slice().sort(function(a, b) { return a - b; }); var idx = Math.ceil(p / 100 * s.length) - 1; return s[Math.max(0, idx)]; }
function correlation(x, y) {
  var n = x.length;
  var mx = mean(x), my = mean(y);
  var num = 0, dx = 0, dy = 0;
  for (var i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) * (x[i] - mx);
    dy += (y[i] - my) * (y[i] - my);
  }
  var denom = Math.sqrt(dx) * Math.sqrt(dy);
  return denom === 0 ? 0 : num / denom;
}

// ══════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════

async function main() {
  var args = process.argv.slice(2);

  if (args.includes('--cleanup')) {
    await cleanup();
    process.exit(0);
  }

  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  EventMedium Match Quality Test Harness               ║');
  console.log('║  100 delegates × 4,950 pairs                         ║');
  console.log('╚════════════════════════════════════════════════════════╝');

  // Setup
  var data = await setup();
  if (!data) {
    console.log('   Run: node scripts/test-matching.js --cleanup');
    process.exit(1);
  }

  // Run matching
  var scores = await runMatching(data.eventId, data.userIds, data.profiles);

  if (scores.length === 0) {
    console.log('\n❌ No scores generated. Check if scoreMatch is exported correctly.');
    process.exit(1);
  }

  // Analyze
  analyze(scores, data.profiles);

  console.log('💡 To clean up test data: node scripts/test-matching.js --cleanup\n');
  process.exit(0);
}

main().catch(function(err) {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
