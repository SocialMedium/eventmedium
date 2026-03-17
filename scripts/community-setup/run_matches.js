var { dbGet, dbRun, dbAll } = require('../../db');
var { generateMatchesForUser } = require('../../routes/matches');

async function runTestMatches(testRunId) {
  var testRun = await dbGet('SELECT * FROM community_test_runs WHERE id = $1', [testRunId]);
  if (!testRun) throw new Error('Test run not found: ' + testRunId);

  var communityId = testRun.community_id;

  // Load synthetic user IDs
  var syntheticUsers = await dbAll(
    'SELECT fake_user_id FROM synthetic_test_users WHERE test_run_id = $1',
    [testRunId]
  );
  var userIds = syntheticUsers.map(function(s) { return s.fake_user_id; }).filter(Boolean);
  console.log('[matches] Running matches for ' + userIds.length + ' synthetic users in community ' + communityId);

  if (!userIds.length) {
    console.log('[matches] No synthetic users found');
    return testRun;
  }

  // Ensure synthetic users are community members (for community matching)
  for (var i = 0; i < userIds.length; i++) {
    var existing = await dbGet(
      'SELECT id FROM community_members WHERE community_id = $1 AND user_id = $2',
      [communityId, userIds[i]]
    );
    if (!existing) {
      await dbRun(
        "INSERT INTO community_members (community_id, user_id, role) VALUES ($1, $2, 'member')",
        [communityId, userIds[i]]
      );
    }
  }

  // Run matching for each user
  var processed = 0;
  var errors = 0;
  for (var i = 0; i < userIds.length; i++) {
    try {
      await generateMatchesForUser(userIds[i], { type: 'community', id: communityId });
      processed++;
    } catch (err) {
      errors++;
      if (errors <= 5) console.error('[matches] Error for user ' + userIds[i] + ':', err.message);
    }

    if ((i + 1) % 50 === 0) {
      console.log('[matches] Progress: ' + (i + 1) + '/' + userIds.length + ' (' + errors + ' errors)');
    }
  }

  console.log('[matches] Complete: ' + processed + ' processed, ' + errors + ' errors');

  // Calculate stats
  var stats = await dbGet(
    'SELECT COUNT(*)::int as match_count, AVG(score_total) as avg_score, ' +
    'COUNT(*) FILTER (WHERE score_total >= 0.75)::int as strong, ' +
    'COUNT(*) FILTER (WHERE score_total >= 0.50 AND score_total < 0.75)::int as moderate, ' +
    'COUNT(*) FILTER (WHERE score_total < 0.50)::int as thin ' +
    'FROM event_matches WHERE user_a_id = ANY($1::int[]) OR user_b_id = ANY($1::int[])',
    [userIds]
  );

  var matchCount = stats.match_count || 0;
  var strongPct = matchCount > 0 ? (stats.strong || 0) / matchCount : 0;
  var moderatePct = matchCount > 0 ? (stats.moderate || 0) / matchCount : 0;
  var thinPct = matchCount > 0 ? (stats.thin || 0) / matchCount : 0;

  await dbRun(
    "UPDATE community_test_runs SET match_count = $1, avg_match_score = $2, strong_match_pct = $3, moderate_match_pct = $4, thin_match_pct = $5, status = 'matches_complete' WHERE id = $6",
    [matchCount, stats.avg_score || 0, strongPct, moderatePct, thinPct, testRunId]
  );

  console.log('[matches] Stats: ' + matchCount + ' matches | avg=' + ((stats.avg_score || 0) * 100).toFixed(1) + '% | strong=' + (strongPct * 100).toFixed(1) + '% | moderate=' + (moderatePct * 100).toFixed(1) + '% | thin=' + (thinPct * 100).toFixed(1) + '%');

  return await dbGet('SELECT * FROM community_test_runs WHERE id = $1', [testRunId]);
}

module.exports = { runTestMatches: runTestMatches };
