var { ingestCommunitySignals } = require('./ingest');
var { generateSyntheticProfiles } = require('./generate_profiles');
var { runTestMatches } = require('./run_matches');
var { evaluateMatchQuality } = require('./evaluate_matches');

async function runCommunitySetup(config) {
  console.log('[Setup] Starting community setup for: ' + config.label);

  // Phase 1: Ingest
  var taxonomy = await ingestCommunitySignals(config);
  console.log('[Setup] Taxonomy generated for ' + config.label);

  // Phase 2: Generate community profiles
  var communityRun = await generateSyntheticProfiles(config.community_id, config.community_profile_count, {
    test_run_label: config.label.toLowerCase() + '_community_' + config.community_profile_count,
    is_event_subset: false,
    canister_completeness_distribution: config.canister_distribution
  });
  console.log('[Setup] ' + config.community_profile_count + ' community profiles generated');

  // Phase 3: Run community matches
  await runTestMatches(communityRun.id);
  console.log('[Setup] Community matches complete');

  // Phase 4: Evaluate community matches
  await evaluateMatchQuality(communityRun.id);
  console.log('[Setup] Community evaluation complete');

  // Phase 5: If event specified, generate event subset profiles and run event matches
  var eventRunId = null;
  if (config.event_id && config.event_profile_count) {
    var eventRun = await generateSyntheticProfiles(config.community_id, config.event_profile_count, {
      test_run_label: config.label.toLowerCase() + '_event_' + config.event_profile_count,
      is_event_subset: true,
      event_id: config.event_id,
      canister_completeness_distribution: { rich: 0.50, moderate: 0.40, thin: 0.10 }
    });

    await runTestMatches(eventRun.id);
    await evaluateMatchQuality(eventRun.id);
    eventRunId = eventRun.id;
    console.log('[Setup] Event subset complete');
  }

  console.log('[Setup] Community setup complete for: ' + config.label);
  return { taxonomy: taxonomy, communityRunId: communityRun.id, eventRunId: eventRunId };
}

module.exports = { runCommunitySetup: runCommunitySetup };
