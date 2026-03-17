require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

var fs = require('fs');
var path = require('path');
var { runCommunitySetup } = require('./orchestrate');

// Parse --test flag for small run
var isTest = process.argv.indexOf('--test') !== -1;

var config = {
  community_id: 1,  // UPDATE to actual CCS community ID once created
  label: 'CCS',
  urls: [
    'https://www.coca-colascholarsfoundation.org/',
    'https://www.coca-colascholarsfoundation.org/blog/',
    'https://www.coca-colascholarsfoundation.org/community/',
    'https://www.coca-colascholarsfoundation.org/about/'
  ],
  context_hint: 'The Coca-Cola Scholars Foundation is a scholarship program that selects approximately 150 exceptional high school seniors per year based on leadership, service, and academic achievement. Alumni (Scholars) are now spread across all professional sectors 3-25 years into their careers. The community identity is values-driven around leadership and service — not sector-specific. Members are high-achievers with broad professional distributions across medicine, law, technology, finance, consulting, nonprofit, policy, and entrepreneurship. The shared identity is strong but not a professional matching signal in itself.',
  known_facts: [
    '~150 new Scholars selected per year since 1989',
    'Total living alumni community approximately 4000-6000',
    'Strong US geographic spread with New York, DC, California, Texas as key clusters',
    'High representation in: medicine/healthcare, law, management consulting, tech, finance, policy/government, nonprofit/social enterprise, entrepreneurship',
    'Community organises annual Scholar Weekend and regional chapter events',
    'Members are motivated by service and impact — values language matters more than sector language',
    'Career stages span from early career (recent graduates) to senior executives and established professionals'
  ],
  community_profile_count: isTest ? 10 : 2500,
  event_id: null,  // UPDATE to actual CCS event ID once created
  event_profile_count: isTest ? 5 : 250,
  canister_distribution: {
    rich: 0.28,
    moderate: 0.47,
    thin: 0.25
  }
};

// Log to file
var logDir = path.resolve(__dirname, '../../logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
var logFile = path.join(logDir, 'ccs_test_' + Date.now() + '.log');
var origLog = console.log;
var origErr = console.error;

console.log = function() {
  var msg = Array.prototype.slice.call(arguments).join(' ');
  fs.appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n');
  origLog.apply(console, arguments);
};
console.error = function() {
  var msg = Array.prototype.slice.call(arguments).join(' ');
  fs.appendFileSync(logFile, new Date().toISOString() + ' ERROR ' + msg + '\n');
  origErr.apply(console, arguments);
};

console.log('[CCS] Starting ' + (isTest ? 'TEST' : 'FULL') + ' run');
console.log('[CCS] Config: ' + config.community_profile_count + ' community profiles, ' + (config.event_profile_count || 0) + ' event profiles');
console.log('[CCS] Log file: ' + logFile);

runCommunitySetup(config).then(function(result) {
  console.log('[CCS] Complete!');
  console.log('[CCS] Community run ID: ' + result.communityRunId);
  if (result.eventRunId) console.log('[CCS] Event run ID: ' + result.eventRunId);
  console.log('[CCS] View report at: /admin-community-report.html?id=' + result.communityRunId);
  process.exit(0);
}).catch(function(err) {
  console.error('[CCS] Fatal error:', err);
  process.exit(1);
});
