var crypto = require('crypto');
var { dbGet, dbRun, dbAll } = require('../../db');
var { getCanonicalThemes } = require('../../lib/theme_taxonomy');

function weightedRandom(items) {
  var totalWeight = 0;
  for (var i = 0; i < items.length; i++) totalWeight += (items[i].weight || 0);
  if (totalWeight === 0) return items[0] ? items[0].value : null;

  var r = Math.random() * totalWeight;
  var running = 0;
  for (var i = 0; i < items.length; i++) {
    running += (items[i].weight || 0);
    if (r <= running) return items[i].value;
  }
  return items[items.length - 1].value;
}

function pickN(items, n) {
  var picked = [];
  var remaining = items.slice();
  for (var i = 0; i < n && remaining.length > 0; i++) {
    var totalWeight = 0;
    for (var j = 0; j < remaining.length; j++) totalWeight += (remaining[j].weight || 0);
    if (totalWeight === 0) break;
    var r = Math.random() * totalWeight;
    var running = 0;
    for (var j = 0; j < remaining.length; j++) {
      running += (remaining[j].weight || 0);
      if (r <= running) {
        picked.push(remaining[j].value);
        remaining.splice(j, 1);
        break;
      }
    }
  }
  return picked;
}

function extractJson(text) {
  try { return JSON.parse(text); } catch(e) {}
  var match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) { try { return JSON.parse(match[1].trim()); } catch(e) {} }
  var start = text.indexOf('{');
  var end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch(e) {}
  }
  return null;
}

async function callClaude(prompt) {
  var body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
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

async function generateSyntheticProfiles(communityId, count, options) {
  options = options || {};
  var dist = options.canister_completeness_distribution || { rich: 0.30, moderate: 0.45, thin: 0.25 };

  // 1. Load taxonomy
  var taxonomy = await dbGet(
    'SELECT * FROM community_taxonomies WHERE community_id = $1 ORDER BY generated_at DESC LIMIT 1',
    [communityId]
  );
  if (!taxonomy) throw new Error('No taxonomy found for community ' + communityId);

  // Parse JSONB fields
  var sectorDist = typeof taxonomy.sector_distribution === 'string' ? JSON.parse(taxonomy.sector_distribution) : (taxonomy.sector_distribution || {});
  var themeDist = typeof taxonomy.theme_distribution === 'string' ? JSON.parse(taxonomy.theme_distribution) : (taxonomy.theme_distribution || {});
  var stakeholderDist = typeof taxonomy.stakeholder_distribution === 'string' ? JSON.parse(taxonomy.stakeholder_distribution) : (taxonomy.stakeholder_distribution || {});
  var careerDist = typeof taxonomy.career_stage_distribution === 'string' ? JSON.parse(taxonomy.career_stage_distribution) : (taxonomy.career_stage_distribution || {});
  var geoClusters = typeof taxonomy.geography_clusters === 'string' ? JSON.parse(taxonomy.geography_clusters) : (taxonomy.geography_clusters || []);
  var valuesLang = typeof taxonomy.values_language === 'string' ? JSON.parse(taxonomy.values_language) : (taxonomy.values_language || {});

  // Build weighted items
  var stakeholderItems = (stakeholderDist.types || []).map(function(t) { return { value: t.type, weight: t.weight }; });
  var careerItems = [
    { value: 'early', weight: careerDist.early || 0.2 },
    { value: 'mid', weight: careerDist.mid || 0.45 },
    { value: 'senior', weight: careerDist.senior || 0.35 }
  ];
  var themeItems = (themeDist.themes || []).map(function(t) { return { value: t.theme, weight: t.weight }; });
  var geoItems = geoClusters.map(function(g) {
    return { value: g.city + ', ' + g.country, weight: g.weight };
  });
  var completenessItems = [
    { value: 'rich', weight: dist.rich },
    { value: 'moderate', weight: dist.moderate },
    { value: 'thin', weight: dist.thin }
  ];

  var valuesPatterns = (valuesLang.patterns || []).join(', ');
  var communityHeadline = '';
  try {
    var preview = typeof taxonomy.raw_ingestion_summary === 'string' ?
      taxonomy.raw_ingestion_summary.slice(0, 200) : '';
    communityHeadline = preview;
  } catch(e) {}

  // 2. Create test run
  var runResult = await dbRun(
    "INSERT INTO community_test_runs (community_id, test_cohort_label, profile_count, status) VALUES ($1, $2, $3, 'running') RETURNING id",
    [communityId, options.test_run_label || 'test_' + count, count]
  );
  var testRunId = runResult.rows[0].id;
  console.log('[generate] Test run ' + testRunId + ' created for ' + count + ' profiles');

  // 3. Generate in batches of 20
  var batchSize = 20;
  var generated = 0;
  var failed = 0;

  for (var batch = 0; batch < Math.ceil(count / batchSize); batch++) {
    var batchCount = Math.min(batchSize, count - (batch * batchSize));
    var batchPromises = [];

    for (var b = 0; b < batchCount; b++) {
      var idx = batch * batchSize + b;
      var stakeholderType = weightedRandom(stakeholderItems) || 'operator';
      var careerStage = weightedRandom(careerItems);
      var themes = pickN(themeItems, 2 + Math.floor(Math.random() * 2));
      var geo = weightedRandom(geoItems) || 'New York, USA';
      var completeness = weightedRandom(completenessItems);

      batchPromises.push((function(st, cs, th, ge, comp, profileIdx) {
        return generateOneProfile(st, cs, th, ge, comp, profileIdx, testRunId, communityId, communityHeadline, valuesPatterns, options);
      })(stakeholderType, careerStage, themes, geo, completeness, idx));
    }

    var results = await Promise.allSettled(batchPromises);
    for (var r = 0; r < results.length; r++) {
      if (results[r].status === 'fulfilled' && results[r].value) generated++;
      else failed++;
    }

    if ((generated + failed) % 50 === 0 || batch === Math.ceil(count / batchSize) - 1) {
      console.log('[generate] Progress: ' + generated + ' generated, ' + failed + ' failed of ' + count);
    }

    // Rate limit between batches
    if (batch < Math.ceil(count / batchSize) - 1) {
      await new Promise(function(resolve) { setTimeout(resolve, 500); });
    }
  }

  // 4. Update test run
  await dbRun(
    "UPDATE community_test_runs SET profile_count = $1, status = 'profiles_complete' WHERE id = $2",
    [generated, testRunId]
  );

  console.log('[generate] Complete: ' + generated + '/' + count + ' profiles generated for test run ' + testRunId);
  return { id: testRunId, profile_count: generated };
}

async function generateOneProfile(stakeholderType, careerStage, themes, geography, completeness, profileIdx, testRunId, communityId, communityHeadline, valuesPatterns, options) {
  var prompt = 'You are generating a realistic synthetic professional profile for a member of a professional community.\n\n' +
    'Community context: ' + communityHeadline + '\n\n' +
    'This person\'s profile parameters:\n' +
    '- Stakeholder type: ' + stakeholderType + '\n' +
    '- Career stage: ' + careerStage + ' (' + (careerStage === 'early' ? '1-5 yrs' : careerStage === 'mid' ? '6-15 yrs' : '15+ yrs') + ')\n' +
    '- Primary professional themes: ' + themes.join(', ') + '\n' +
    '- Location: ' + geography + '\n' +
    '- Profile completeness: ' + completeness + ' (' + (completeness === 'rich' ? 'detailed and specific' : completeness === 'moderate' ? 'some gaps' : 'vague, minimal') + ')\n' +
    '- Community values language to incorporate naturally: ' + valuesPatterns + '\n\n' +
    'Generate a JSON object with EXACTLY this structure (raw JSON only, no markdown):\n\n' +
    '{\n' +
    '  "name": "realistic full name",\n' +
    '  "company": "realistic company or organisation name",\n' +
    '  "persona_brief": "2-3 sentences describing who this person is",\n' +
    '  "stakeholder_profile": {\n' +
    '    "stakeholder_type": "' + stakeholderType + '",\n' +
    '    "themes": ' + JSON.stringify(themes) + ',\n' +
    '    "focus_text": "if rich: 2-3 specific sentences. if moderate: 1 vague sentence. if thin: empty string",\n' +
    '    "geography": "' + geography + '",\n' +
    '    "intent": ["specific things they want — concrete if rich, vague if thin"],\n' +
    '    "offering": ["specific things they can offer — concrete if rich, vague if thin"],\n' +
    '    "deal_details": {\n' +
    '      "stage": "if investor/founder: seed|series_a|series_b|growth|not_applicable",\n' +
    '      "ticket_size": "if investor: realistic range or empty",\n' +
    '      "sectors": []\n' +
    '    }\n' +
    '  },\n' +
    '  "canister_completeness": ' + (completeness === 'rich' ? '0.85' : completeness === 'moderate' ? '0.55' : '0.25') + '\n' +
    '}';

  try {
    var responseText = await callClaude(prompt);
    var profile = extractJson(responseText);
    if (!profile || !profile.name) throw new Error('Invalid profile JSON');

    var sp = profile.stakeholder_profile || {};
    var uuid = crypto.randomUUID();
    var email = 'synthetic_' + uuid + '@test.eventmedium.ai';

    // Insert user
    var userResult = await dbRun(
      "INSERT INTO users (email, name, company, provider) VALUES ($1, $2, $3, 'synthetic') RETURNING id",
      [email, profile.name, profile.company || '']
    );
    var userId = userResult.rows[0].id;

    // Insert stakeholder profile
    await dbRun(
      "INSERT INTO stakeholder_profiles (user_id, stakeholder_type, themes, focus_text, geography, intent, offering, deal_details, onboarding_method, canister_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'synthetic', 1)",
      [
        userId,
        sp.stakeholder_type || stakeholderType,
        JSON.stringify(sp.themes || themes),
        sp.focus_text || '',
        sp.geography || geography,
        JSON.stringify(sp.intent || []),
        JSON.stringify(sp.offering || []),
        JSON.stringify(sp.deal_details || {})
      ]
    );

    // Insert synthetic_test_users record
    await dbRun(
      'INSERT INTO synthetic_test_users (test_run_id, fake_user_id, persona_brief, career_stage, canister_completeness, is_event_subset) VALUES ($1, $2, $3, $4, $5, $6)',
      [testRunId, userId, profile.persona_brief || '', careerStage, profile.canister_completeness || 0.5, options.is_event_subset || false]
    );

    // If event subset, add event registration
    if (options.is_event_subset && options.event_id) {
      await dbRun(
        "INSERT INTO event_registrations (event_id, user_id, status) VALUES ($1, $2, 'active')",
        [options.event_id, userId]
      );
    }

    return userId;
  } catch (err) {
    console.error('[generate] Profile ' + profileIdx + ' failed:', err.message);
    return null;
  }
}

module.exports = { generateSyntheticProfiles: generateSyntheticProfiles };
