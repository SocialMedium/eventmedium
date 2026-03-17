var { dbGet, dbRun, dbAll } = require('../../db');

async function cleanupTestRun(testRunId, confirm) {
  if (!confirm) {
    console.log('[cleanup] Dry run for test_run_id=' + testRunId + '. Pass confirm=true to execute.');
  }

  // Load test run
  var run = await dbGet('SELECT * FROM community_test_runs WHERE id = $1', [testRunId]);
  if (!run) throw new Error('Test run not found: ' + testRunId);

  // Load synthetic users
  var syntheticUsers = await dbAll(
    'SELECT fake_user_id FROM synthetic_test_users WHERE test_run_id = $1',
    [testRunId]
  );
  var userIds = syntheticUsers.map(function(s) { return s.fake_user_id; }).filter(Boolean);

  console.log('[cleanup] Test run: ' + run.test_cohort_label + ' | ' + userIds.length + ' synthetic users');

  if (!confirm) {
    console.log('[cleanup] Would delete:');
    console.log('  - ' + userIds.length + ' synthetic users + profiles');
    console.log('  - Associated event_registrations');
    console.log('  - Associated event_matches');
    console.log('  - synthetic_test_users records');
    console.log('  - Would NOT delete: community_taxonomies or test_run evaluation');
    return { dry_run: true, user_count: userIds.length };
  }

  if (!userIds.length) {
    console.log('[cleanup] No synthetic users to clean up');
    await dbRun("UPDATE community_test_runs SET status = 'cleaned_up' WHERE id = $1", [testRunId]);
    return { deleted_users: 0 };
  }

  // Delete in correct order (foreign key constraints)
  // 1. Event matches involving synthetic users
  var matchResult = await dbRun(
    "DELETE FROM event_matches WHERE user_a_id = ANY($1::int[]) OR user_b_id = ANY($1::int[])",
    [userIds]
  );
  console.log('[cleanup] Deleted ' + matchResult.rowCount + ' event_matches');

  // 2. Event registrations
  var regResult = await dbRun(
    "DELETE FROM event_registrations WHERE user_id = ANY($1::int[])",
    [userIds]
  );
  console.log('[cleanup] Deleted ' + regResult.rowCount + ' event_registrations');

  // 3. Stakeholder profiles
  var profileResult = await dbRun(
    "DELETE FROM stakeholder_profiles WHERE user_id = ANY($1::int[])",
    [userIds]
  );
  console.log('[cleanup] Deleted ' + profileResult.rowCount + ' stakeholder_profiles');

  // 4. Synthetic test user records
  var synResult = await dbRun(
    'DELETE FROM synthetic_test_users WHERE test_run_id = $1',
    [testRunId]
  );
  console.log('[cleanup] Deleted ' + synResult.rowCount + ' synthetic_test_users records');

  // 5. Users themselves
  var userResult = await dbRun(
    "DELETE FROM users WHERE id = ANY($1::int[]) AND email LIKE 'synthetic_%@test.eventmedium.ai'",
    [userIds]
  );
  console.log('[cleanup] Deleted ' + userResult.rowCount + ' users');

  // 6. Update test run status (keep the evaluation data)
  await dbRun("UPDATE community_test_runs SET status = 'cleaned_up' WHERE id = $1", [testRunId]);
  console.log('[cleanup] Test run ' + testRunId + ' marked as cleaned_up');

  return {
    deleted_users: userResult.rowCount,
    deleted_profiles: profileResult.rowCount,
    deleted_matches: matchResult.rowCount,
    deleted_registrations: regResult.rowCount
  };
}

module.exports = { cleanupTestRun: cleanupTestRun };
