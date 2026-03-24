var db = require('../db/index.js');

function generateReferralCode(cohortNumber) {
  if (cohortNumber && cohortNumber <= 10000) {
    // OG-0001 is reserved as a platform collectible.
    // All OG members get cohortNumber + 1 so sequence starts at OG-0002.
    var displayNumber = cohortNumber + 1;
    return 'OG-' + String(displayNumber).padStart(4, '0');
  }
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = 'EM-';
  for (var i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function ensureReferralCode(userId) {
  try {
    var user = await db.dbGet('SELECT id, referral_code FROM users WHERE id = $1', [userId]);
    if (!user || user.referral_code) return user ? user.referral_code : null;

    var profile = await db.dbGet('SELECT emc2_cohort_number, og_member FROM stakeholder_profiles WHERE user_id = $1', [userId]);
    var code = generateReferralCode(profile ? profile.emc2_cohort_number : null);

    // Ensure uniqueness
    var existing = await db.dbGet('SELECT id FROM users WHERE referral_code = $1', [code]);
    if (existing) {
      code = code + String(Math.floor(Math.random() * 90) + 10);
    }

    await db.dbRun('UPDATE users SET referral_code = $1 WHERE id = $2', [code, userId]);
    return code;
  } catch(e) {
    console.warn('[Referrals] ensureReferralCode error:', e.message);
    return null;
  }
}

async function backfillReferralCodes() {
  try {
    var users = await db.dbAll("SELECT u.id, sp.emc2_cohort_number, sp.og_member FROM users u JOIN stakeholder_profiles sp ON sp.user_id = u.id WHERE u.referral_code IS NULL AND sp.stakeholder_type IS NOT NULL");
    var count = 0;
    for (var i = 0; i < users.length; i++) {
      var code = generateReferralCode(users[i].og_member ? users[i].emc2_cohort_number : null);
      var existing = await db.dbGet('SELECT id FROM users WHERE referral_code = $1', [code]);
      if (existing) code = code + String(Math.floor(Math.random() * 90) + 10);
      await db.dbRun('UPDATE users SET referral_code = $1 WHERE id = $2', [code, users[i].id]);
      count++;
    }
    if (count > 0) console.log('[Referrals] Backfilled ' + count + ' referral codes');
  } catch(e) {
    console.warn('[Referrals] backfillReferralCodes error:', e.message);
  }
}

async function getReferralStats(userId) {
  try {
    var user = await db.dbGet('SELECT referral_code FROM users WHERE id = $1', [userId]);
    return { referral_code: user ? user.referral_code : null };
  } catch(e) {
    return { referral_code: null };
  }
}

async function awardOG0001(userId, reason) {
  var reservation = await db.dbGet("SELECT * FROM reserved_codes WHERE code = 'OG-0001'");
  if (reservation && reservation.assigned_to) {
    throw new Error('OG-0001 already assigned');
  }
  await db.dbRun("UPDATE reserved_codes SET assigned_to = $1, assigned_at = NOW(), reason = $2 WHERE code = 'OG-0001'", [userId, reason]);
  await db.dbRun("UPDATE users SET referral_code = 'OG-0001' WHERE id = $1", [userId]);
  console.log('[OG-0001] Awarded to user ' + userId + ': ' + reason);
}

module.exports = {
  generateReferralCode: generateReferralCode,
  ensureReferralCode: ensureReferralCode,
  backfillReferralCodes: backfillReferralCodes,
  getReferralStats: getReferralStats,
  awardOG0001: awardOG0001
};
