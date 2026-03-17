var { dbGet, dbRun, dbAll } = require('../../db');

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

function formatProfile(profile) {
  return 'Type: ' + (profile.stakeholder_type || 'unknown') +
    ' | Themes: ' + JSON.stringify(profile.themes || []) +
    ' | Focus: ' + (profile.focus_text || '').slice(0, 150) +
    ' | Seeking: ' + JSON.stringify(profile.intent || []) +
    ' | Offering: ' + JSON.stringify(profile.offering || []) +
    ' | Geography: ' + (profile.geography || 'unknown');
}

async function evaluateMatchQuality(testRunId) {
  var testRun = await dbGet('SELECT * FROM community_test_runs WHERE id = $1', [testRunId]);
  if (!testRun) throw new Error('Test run not found: ' + testRunId);

  var communityId = testRun.community_id;

  // Load taxonomy
  var taxonomy = await dbGet(
    'SELECT * FROM community_taxonomies WHERE community_id = $1 ORDER BY generated_at DESC LIMIT 1',
    [communityId]
  );

  // Load synthetic user IDs
  var syntheticUsers = await dbAll(
    'SELECT fake_user_id FROM synthetic_test_users WHERE test_run_id = $1',
    [testRunId]
  );
  var userIds = syntheticUsers.map(function(s) { return s.fake_user_id; }).filter(Boolean);

  if (!userIds.length) {
    console.log('[evaluate] No synthetic users found');
    return;
  }

  console.log('[evaluate] Sampling matches for evaluation...');

  // Sample matches
  var strong = await dbAll(
    'SELECT * FROM event_matches WHERE (user_a_id = ANY($1::int[]) OR user_b_id = ANY($1::int[])) AND score_total >= 0.75 ORDER BY RANDOM() LIMIT 20',
    [userIds]
  );
  var moderate = await dbAll(
    'SELECT * FROM event_matches WHERE (user_a_id = ANY($1::int[]) OR user_b_id = ANY($1::int[])) AND score_total >= 0.50 AND score_total < 0.75 ORDER BY RANDOM() LIMIT 20',
    [userIds]
  );
  var thin = await dbAll(
    'SELECT * FROM event_matches WHERE (user_a_id = ANY($1::int[]) OR user_b_id = ANY($1::int[])) AND score_total < 0.50 ORDER BY RANDOM() LIMIT 10',
    [userIds]
  );

  // Edge cases: high score but same stakeholder type
  var edge = await dbAll(
    'SELECT em.* FROM event_matches em ' +
    'JOIN stakeholder_profiles spa ON spa.user_id = em.user_a_id ' +
    'JOIN stakeholder_profiles spb ON spb.user_id = em.user_b_id ' +
    'WHERE (em.user_a_id = ANY($1::int[]) OR em.user_b_id = ANY($1::int[])) ' +
    'AND spa.stakeholder_type = spb.stakeholder_type ' +
    'ORDER BY em.score_total DESC LIMIT 10',
    [userIds]
  );

  var allSamples = strong.concat(moderate).concat(thin).concat(edge);
  console.log('[evaluate] Sampled ' + allSamples.length + ' matches (' + strong.length + ' strong, ' + moderate.length + ' moderate, ' + thin.length + ' thin, ' + edge.length + ' edge)');

  if (!allSamples.length) {
    console.log('[evaluate] No matches to evaluate');
    await dbRun(
      "UPDATE community_test_runs SET evaluator_score = 0, evaluation_report = 'No matches to evaluate', status = 'complete' WHERE id = $1",
      [testRunId]
    );
    return;
  }

  // Load profiles for all matched users
  var matchDetails = [];
  for (var i = 0; i < allSamples.length; i++) {
    var m = allSamples[i];
    var profileA = await dbGet(
      'SELECT stakeholder_type, themes, intent, offering, focus_text, geography FROM stakeholder_profiles WHERE user_id = $1',
      [m.user_a_id]
    );
    var profileB = await dbGet(
      'SELECT stakeholder_type, themes, intent, offering, focus_text, geography FROM stakeholder_profiles WHERE user_id = $1',
      [m.user_b_id]
    );

    var reasons = m.match_reasons;
    if (typeof reasons === 'string') { try { reasons = JSON.parse(reasons); } catch(e) {} }

    matchDetails.push({
      match_id: m.id,
      score: m.score_total,
      tier: i < strong.length ? 'strong' : i < strong.length + moderate.length ? 'moderate' : i < strong.length + moderate.length + thin.length ? 'thin' : 'edge',
      profile_a: profileA ? formatProfile(profileA) : 'no profile',
      profile_b: profileB ? formatProfile(profileB) : 'no profile',
      reasons: JSON.stringify(reasons || {})
    });
  }

  // Build evaluation prompt
  var taxonomySummary = taxonomy ? (taxonomy.raw_ingestion_summary || '').slice(0, 500) : 'No taxonomy available';
  var matchingWeights = taxonomy ? JSON.stringify(taxonomy.matching_weights || {}) : '{}';

  var samplesText = matchDetails.map(function(m, idx) {
    return 'Match #' + (idx + 1) + ' [' + m.tier + ', score=' + ((m.score || 0) * 100).toFixed(0) + '%]:\n' +
      '  Person A: ' + m.profile_a + '\n' +
      '  Person B: ' + m.profile_b + '\n' +
      '  Reasons: ' + m.reasons;
  }).join('\n\n');

  var evalPrompt = 'You are evaluating the match quality of an AI-powered professional networking platform.\n\n' +
    'Community context:\n' + taxonomySummary + '\n\n' +
    'Matching weight configuration used:\n' + matchingWeights + '\n\n' +
    'Below are ' + matchDetails.length + ' match samples. Each includes two profiles and the system\'s match reasons.\n\n' +
    'For each match, score it 0-1 on:\n' +
    '- coherence: do these two people genuinely have reason to meet?\n' +
    '- specificity: are the match reasons specific and credible, or generic?\n' +
    '- community_fit: does this match make sense in the context of this specific community?\n\n' +
    'Then produce a JSON object with:\n' +
    '1. aggregate_scores: { coherence: float, specificity: float, community_fit: float }\n' +
    '2. failure_patterns: array of specific ways the matching algorithm failed\n' +
    '3. success_patterns: array of specific ways the matching algorithm worked well\n' +
    '4. weight_recommendations: { theme: float, intent: float, stakeholder: float, capital: float, signal_convergence: float }\n' +
    '5. canister_quality_issues: array of patterns in thin canisters that hurt match quality\n' +
    '6. nev_recommendations: array of what Nev should ask to improve signal\n' +
    '7. overall_assessment: 2-3 sentence summary\n\n' +
    'Return raw JSON only, no markdown.\n\n' +
    'MATCH SAMPLES:\n' + samplesText;

  console.log('[evaluate] Calling Claude for evaluation (' + matchDetails.length + ' matches)...');
  var responseText = await callClaude(evalPrompt);
  var evalResult = extractJson(responseText);

  if (!evalResult) {
    console.error('[evaluate] Failed to parse evaluator response');
    await dbRun(
      "UPDATE community_test_runs SET evaluation_report = $1, status = 'complete' WHERE id = $2",
      [responseText.slice(0, 10000), testRunId]
    );
    return;
  }

  // Calculate aggregate evaluator score
  var agg = evalResult.aggregate_scores || {};
  var evalScore = ((agg.coherence || 0) + (agg.specificity || 0) + (agg.community_fit || 0)) / 3;

  // Update test run
  await dbRun(
    "UPDATE community_test_runs SET evaluator_score = $1, weight_recommendations = $2, evaluation_report = $3, status = 'complete' WHERE id = $4",
    [
      evalScore,
      JSON.stringify(evalResult.weight_recommendations || {}),
      JSON.stringify(evalResult),
      testRunId
    ]
  );

  console.log('[evaluate] Evaluator score: ' + (evalScore * 100).toFixed(1) + '%');
  console.log('[evaluate] Success patterns: ' + (evalResult.success_patterns || []).length);
  console.log('[evaluate] Failure patterns: ' + (evalResult.failure_patterns || []).length);

  // Auto-calibrate if score is low
  if (evalScore < 0.70 && evalResult.weight_recommendations && taxonomy) {
    console.log('[evaluate] Score below 0.70 — auto-applying weight recommendations');
    await dbRun(
      'UPDATE community_taxonomies SET matching_weights = $1, calibration_run_at = NOW(), calibration_notes = $2 WHERE id = $3',
      [
        JSON.stringify(evalResult.weight_recommendations),
        'Auto-calibrated from test run ' + testRunId + ' (score: ' + (evalScore * 100).toFixed(1) + '%)',
        taxonomy.id
      ]
    );
  }

  return evalResult;
}

module.exports = { evaluateMatchQuality: evaluateMatchQuality };
