#!/usr/bin/env node
// Test the Nev chat pipeline end-to-end:
// 1. Simulates a user conversation (3 messages)
// 2. Verifies canister_data is returned to frontend
// 3. Verifies nev_messages are persisted
// 4. Verifies stakeholder_profiles UPSERT works for new users
//
// Usage: node scripts/test-nev-pipeline.js
// Requires: DATABASE_URL and ANTHROPIC_API_KEY in .env

require('dotenv').config();
var pg = require('pg');
var pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

var TEST_EMAIL = 'nev-pipeline-test-' + Date.now() + '@test.eventmedium.ai';
var TEST_NAME = 'Pipeline Test User';
var testUserId = null;
var testToken = null;

// Simulated conversation: a founder based in London working on climate tech
var MESSAGES = [
  "Hi, I'm Sarah. I run a climate tech startup called GreenGrid — we're building smart grid infrastructure for renewable energy communities.",
  "We're Series A, just closed. Looking for strategic partners in the energy sector, particularly utilities and grid operators in the UK and Europe. I can offer deep expertise in distributed energy systems and regulatory navigation.",
  "My most pressing priority is hiring a VP of Engineering and expanding into Germany in Q2. I'm also attending Climate Week NYC in September."
];

async function createTestUser() {
  var result = await pool.query(
    'INSERT INTO users (name, email, created_at) VALUES ($1, $2, NOW()) RETURNING id',
    [TEST_NAME, TEST_EMAIL]
  );
  testUserId = result.rows[0].id;

  // Create a session token
  var crypto = require('crypto');
  testToken = crypto.randomBytes(32).toString('hex');
  await pool.query(
    "INSERT INTO sessions (user_id, token, created_at, expires_at) VALUES ($1, $2, NOW(), NOW() + INTERVAL '1 hour')",
    [testUserId, testToken]
  );
  console.log('Created test user:', TEST_EMAIL, '(id:', testUserId + ')');
}

async function sendNevMessage(message, conversation) {
  var resp = await fetch(process.env.APP_URL + '/api/nev/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + testToken
    },
    body: JSON.stringify({ message: message, conversation: conversation })
  });

  if (!resp.ok) {
    var errText = await resp.text();
    throw new Error('Nev chat failed (' + resp.status + '): ' + errText);
  }

  return resp.json();
}

async function checkResults() {
  // Check nev_messages
  var messages = await pool.query(
    'SELECT role, LEFT(content, 150) as preview, created_at FROM nev_messages WHERE user_id = $1 ORDER BY created_at',
    [testUserId]
  );
  console.log('\n--- nev_messages (' + messages.rows.length + ' rows) ---');
  messages.rows.forEach(function(m) {
    console.log('  [' + m.role + '] ' + m.preview);
  });

  // Check stakeholder_profiles
  var profile = await pool.query(
    'SELECT stakeholder_type, themes, intent, offering, geography, focus_text, deal_details, onboarding_method FROM stakeholder_profiles WHERE user_id = $1',
    [testUserId]
  );
  console.log('\n--- stakeholder_profiles ---');
  if (profile.rows.length === 0) {
    console.log('  NO PROFILE ROW - UPSERT FAILED');
  } else {
    var p = profile.rows[0];
    console.log('  stakeholder_type:', p.stakeholder_type || '(empty)');
    console.log('  themes:', p.themes);
    console.log('  intent:', p.intent);
    console.log('  offering:', p.offering);
    console.log('  geography:', p.geography || '(empty)');
    console.log('  focus_text:', p.focus_text || '(empty)');
    console.log('  deal_details:', p.deal_details);
    console.log('  onboarding_method:', p.onboarding_method);
  }
}

async function cleanup() {
  await pool.query('DELETE FROM nev_messages WHERE user_id = $1', [testUserId]);
  await pool.query('DELETE FROM stakeholder_profiles WHERE user_id = $1', [testUserId]);
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId]);
  await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
  console.log('\nCleaned up test user');
}

async function run() {
  try {
    await createTestUser();

    var conversation = [];
    for (var i = 0; i < MESSAGES.length; i++) {
      console.log('\n--- Message ' + (i + 1) + ' ---');
      console.log('User:', MESSAGES[i].substring(0, 80) + '...');

      var result = await sendNevMessage(MESSAGES[i], conversation);
      console.log('Nev:', result.reply);
      console.log('canister_data:', result.canister_data ? JSON.stringify(result.canister_data) : 'NULL');

      conversation.push({ role: 'user', content: MESSAGES[i] });
      conversation.push({ role: 'assistant', content: result.reply });

      // Small delay for fire-and-forget writes to complete
      await new Promise(function(r) { setTimeout(r, 2000); });
    }

    // Check DB state
    await checkResults();

    // Determine pass/fail
    var profile = await pool.query('SELECT * FROM stakeholder_profiles WHERE user_id = $1', [testUserId]);
    var msgs = await pool.query('SELECT COUNT(*) as c FROM nev_messages WHERE user_id = $1', [testUserId]);
    var msgCount = parseInt(msgs.rows[0].c);
    var hasProfile = profile.rows.length > 0;
    var hasType = hasProfile && !!profile.rows[0].stakeholder_type;

    console.log('\n=== RESULTS ===');
    console.log('Messages persisted:', msgCount, msgCount >= 6 ? 'PASS' : 'FAIL (expected >= 6)');
    console.log('Profile row created:', hasProfile ? 'PASS' : 'FAIL');
    console.log('Stakeholder type set:', hasType ? 'PASS (' + profile.rows[0].stakeholder_type + ')' : 'FAIL');

    var allPass = msgCount >= 6 && hasProfile && hasType;
    console.log('\nOverall:', allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');

  } catch (err) {
    console.error('Test error:', err);
  } finally {
    await cleanup();
    pool.end();
  }
}

run();
