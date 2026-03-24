var crypto = require('crypto');
var db = require('../db/index.js');

// Single source of truth for all action values
var EMC2_ACTIONS = {
  canister_complete:        { amount: 1000, type: 'earn',   once: true },
  canister_quality_bonus:   { amount: 50,   type: 'earn',   once: true },
  community_join:           { amount: 25,   type: 'earn',   once_per_entity: true },
  event_attend:             { amount: 75,   type: 'earn',   once_per_entity: true },
  match_accepted:           { amount: 50,   type: 'earn',   once_per_entity: true },
  match_confirmed:          { amount: 75,   type: 'earn',   once_per_entity: true },
  match_debrief:            { amount: 50,   type: 'earn',   once_per_entity: true },
  referral_complete:        { amount: 100,  type: 'earn',   once_per_entity: true },
  community_owner_award:    { amount: null, type: 'earn' },
  community_multiplier_bonus: { amount: null, type: 'earn' },
  global_access_unlock:     { amount: -200, type: 'spend' },
  network_query_spend:      { amount: -50,  type: 'spend' },
  founding_member_grant:    { amount: 0,    type: 'status' },
  admin_adjustment:         { amount: null, type: 'admin' }
};

function computeTxHash(tx, prevTxHash) {
  var payload = JSON.stringify({
    user_id:       tx.user_id,
    amount:        tx.amount,
    action_type:   tx.action_type,
    entity_id:     tx.entity_id || null,
    entity_type:   tx.entity_type || null,
    balance_after: tx.balance_after,
    prev_tx_hash:  prevTxHash || '0000000000000000',
    created_at:    tx.created_at
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function recordTransaction(opts) {
  var user_id = opts.user_id;
  var action_type = opts.action_type;
  var amount_override = opts.amount_override;
  var entity_id = opts.entity_id;
  var entity_type = opts.entity_type;
  var metadata = opts.metadata;

  var action = EMC2_ACTIONS[action_type];
  if (!action) throw new Error('Unknown action_type: ' + action_type);

  var amount = amount_override !== undefined ? amount_override : action.amount;

  if (amount === null) {
    throw new Error('action_type ' + action_type + ' requires amount_override');
  }

  // Status-only actions (founding member) — no ledger entry
  if (action.type === 'status') {
    await grantFoundingMember(user_id);
    return { status: 'founding_member_granted' };
  }

  // Idempotency check for once/once_per_entity actions
  if (action.once) {
    var exists = await db.dbGet(
      'SELECT id FROM emc2_ledger WHERE user_id = $1 AND action_type = $2 LIMIT 1',
      [user_id, action_type]
    );
    if (exists) return { status: 'already_awarded', skipped: true };
  }

  if (action.once_per_entity && entity_id) {
    var exists2 = await db.dbGet(
      'SELECT id FROM emc2_ledger WHERE user_id = $1 AND action_type = $2 AND entity_id = $3 LIMIT 1',
      [user_id, action_type, entity_id]
    );
    if (exists2) return { status: 'already_awarded', skipped: true };
  }

  // Get current state
  var current = await db.dbGet(
    'SELECT balance_after, tx_hash FROM emc2_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [user_id]
  );

  var current_balance = current ? current.balance_after : 0;
  var prev_tx_hash    = current ? current.tx_hash : null;
  var balance_after   = current_balance + amount;

  if (balance_after < 0) {
    throw new Error('INSUFFICIENT_EMC2_BALANCE');
  }

  var created_at = new Date();
  var tx = {
    user_id: user_id,
    amount: amount,
    action_type: action_type,
    entity_id: entity_id,
    entity_type: entity_type,
    balance_after: balance_after,
    created_at: created_at
  };

  var tx_hash = computeTxHash(tx, prev_tx_hash);

  await db.dbRun(
    'INSERT INTO emc2_ledger (user_id, amount, action_type, entity_id, entity_type, balance_after, metadata, prev_tx_hash, tx_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [
      user_id, amount, action_type,
      entity_id || null, entity_type || null,
      balance_after,
      JSON.stringify(metadata || {}),
      prev_tx_hash, tx_hash, created_at
    ]
  );

  // Update cached balance on canister
  await db.dbRun(
    'UPDATE stakeholder_profiles SET emc2_balance = $1, emc2_lifetime_earned = emc2_lifetime_earned + $2, global_access_active = CASE WHEN $3 = TRUE THEN TRUE ELSE global_access_active END WHERE user_id = $4',
    [
      balance_after,
      amount > 0 ? amount : 0,
      action_type === 'global_access_unlock',
      user_id
    ]
  );

  // Check and apply community multiplier
  await applyMultiplierIfActive({
    user_id: user_id,
    action_type: action_type,
    base_amount: amount,
    entity_id: entity_id,
    entity_type: entity_type
  });

  return { tx_hash: tx_hash, balance_after: balance_after, amount: amount };
}

async function grantFoundingMember(user_id) {
  await db.dbRun(
    'UPDATE stakeholder_profiles SET founding_member = TRUE, founding_member_granted_at = NOW(), global_access_active = TRUE WHERE user_id = $1',
    [user_id]
  );
  await db.dbRun(
    "INSERT INTO emc2_wallets (user_id, founding_member, founding_member_granted_at) VALUES ($1, TRUE, NOW()) ON CONFLICT (user_id) DO UPDATE SET founding_member = TRUE, founding_member_granted_at = NOW()",
    [user_id]
  );
}

async function applyMultiplierIfActive(opts) {
  var user_id = opts.user_id;
  var action_type = opts.action_type;
  var base_amount = opts.base_amount;
  var entity_id = opts.entity_id;
  var entity_type = opts.entity_type;

  if (base_amount <= 0) return;

  // Find active multiplier for this user's communities
  var multiplier = await db.dbGet(
    'SELECT c.* FROM community_emc2_config c JOIN community_members cm ON cm.community_id = c.community_id WHERE cm.user_id = $1 AND c.multiplier_active = TRUE AND c.multiplier_action = $2 AND NOW() BETWEEN c.multiplier_starts AND c.multiplier_ends LIMIT 1',
    [user_id, action_type]
  );

  if (!multiplier) return;

  var bonus = Math.floor(base_amount * (multiplier.multiplier_value - 1));
  if (bonus <= 0) return;

  await recordTransaction({
    user_id: user_id,
    action_type: 'community_multiplier_bonus',
    amount_override: bonus,
    entity_id: entity_id,
    entity_type: entity_type,
    metadata: {
      source_action: action_type,
      multiplier: multiplier.multiplier_value,
      community_id: multiplier.community_id
    }
  });
}

function computeAccessTier(profile) {
  if (profile.og_member || profile.founding_member || profile.global_access_active) {
    return {
      tier: 3, name: 'Global Access',
      next_tier: 4, next_name: 'Network Amplifier',
      next_threshold: 5000,
      progress: profile.emc2_lifetime_earned || 0,
      progress_target: 5000,
      locked: false
    };
  }
  var earned = profile.emc2_lifetime_earned || 0;
  if (earned >= 5000) {
    return { tier: 4, name: 'Network Amplifier', next_tier: null, next_name: null, next_threshold: null, progress: earned, progress_target: 5000, locked: false };
  }
  if (earned >= 1000) {
    return { tier: 3, name: 'Global Access', next_tier: 4, next_name: 'Network Amplifier', next_threshold: 5000, progress: earned, progress_target: 5000, locked: false };
  }
  if (earned >= 500) {
    return { tier: 2, name: 'Regional Access', next_tier: 3, next_name: 'Global Access', next_threshold: 1000, progress: earned, progress_target: 1000, locked: false };
  }
  return { tier: 1, name: 'Local Access', next_tier: 2, next_name: 'Regional Access', next_threshold: 500, progress: earned, progress_target: 500, locked: false };
}

var WALLET_DEFAULTS = { emc2_balance: 0, emc2_lifetime_earned: 0, global_access_active: false, founding_member: false, founding_member_granted_at: null, og_member: false, emc2_cohort: null, emc2_cohort_number: null, emc2_earn_multiplier: 1.0, wallet_address: null, chain_id: null, verified: false };

async function getWallet(user_id) {
  var profile = null;
  try {
    profile = await db.dbGet(
      'SELECT sp.emc2_balance, sp.emc2_lifetime_earned, sp.global_access_active, sp.founding_member, sp.founding_member_granted_at, sp.og_member, sp.emc2_cohort, sp.emc2_cohort_number, sp.emc2_earn_multiplier, w.wallet_address, w.chain_id, w.verified FROM stakeholder_profiles sp LEFT JOIN emc2_wallets w ON w.user_id = sp.user_id WHERE sp.user_id = $1',
      [user_id]
    );
  } catch(e) {
    // EMC² columns may not exist yet — fall back to safe query
    try {
      profile = await db.dbGet(
        'SELECT 0 as emc2_balance, 0 as emc2_lifetime_earned, false as global_access_active, false as founding_member, null as founding_member_granted_at, false as og_member, null as emc2_cohort, null as emc2_cohort_number, 1.0 as emc2_earn_multiplier, w.wallet_address, w.chain_id, w.verified FROM stakeholder_profiles sp LEFT JOIN emc2_wallets w ON w.user_id = sp.user_id WHERE sp.user_id = $1',
        [user_id]
      );
    } catch(e2) {
      var def = Object.assign({}, WALLET_DEFAULTS);
      def.access_tier = computeAccessTier(def);
      return def;
    }
  }
  if (!profile) {
    var def = Object.assign({}, WALLET_DEFAULTS);
    def.access_tier = computeAccessTier(def);
    return def;
  }
  profile.access_tier = computeAccessTier(profile);
  return profile;
}

async function getHistory(user_id, limit) {
  limit = limit || 20;
  return db.dbAll(
    'SELECT * FROM emc2_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [user_id, limit]
  );
}

async function verifyLedgerIntegrity(user_id) {
  var txs = await db.dbAll(
    'SELECT * FROM emc2_ledger WHERE user_id = $1 ORDER BY created_at ASC',
    [user_id]
  );

  var valid = true;
  for (var i = 0; i < txs.length; i++) {
    var tx       = txs[i];
    var prevHash = i === 0 ? null : txs[i - 1].tx_hash;
    var expected = computeTxHash(tx, prevHash);
    if (expected !== tx.tx_hash) {
      valid = false;
      console.error('Chain broken at tx_id: ' + tx.tx_id);
      break;
    }
  }
  return { valid: valid, tx_count: txs.length };
}

// Community owner: award EMC² to a member
async function communityOwnerAward(opts) {
  var owner_user_id = opts.owner_user_id;
  var recipient_user_id = opts.recipient_user_id;
  var community_id = opts.community_id;
  var amount = opts.amount;
  var reason = opts.reason;

  // Verify owner has pool balance
  var config = await db.dbGet(
    'SELECT * FROM community_emc2_config WHERE community_id = $1',
    [community_id]
  );

  if (!config || config.owner_award_pool < amount) {
    throw new Error('INSUFFICIENT_COMMUNITY_POOL');
  }

  // Deduct from pool
  await db.dbRun(
    'UPDATE community_emc2_config SET owner_award_pool = owner_award_pool - $1 WHERE community_id = $2',
    [amount, community_id]
  );

  return recordTransaction({
    user_id: recipient_user_id,
    action_type: 'community_owner_award',
    amount_override: amount,
    entity_id: community_id,
    entity_type: 'community',
    metadata: {
      awarded_by: owner_user_id,
      community_id: community_id,
      reason: reason
    }
  });
}

// Community analytics: node health scores
async function getCommunityNodeHealth(community_id) {
  return db.dbAll(
    "SELECT sp.user_id, sp.emc2_lifetime_earned, sp.emc2_balance, sp.founding_member, sp.stakeholder_type, COUNT(DISTINCT em.id) FILTER (WHERE em.user_a_id = sp.user_id OR em.user_b_id = sp.user_id) as match_count, COUNT(DISTINCT em.id) FILTER (WHERE (em.user_a_id = sp.user_id OR em.user_b_id = sp.user_id) AND em.status = 'confirmed') as confirmed_matches, CASE WHEN sp.emc2_lifetime_earned >= 400 THEN 'anchor' WHEN sp.emc2_lifetime_earned >= 200 THEN 'active' WHEN sp.emc2_lifetime_earned >= 100 THEN 'engaged' ELSE 'passive' END as node_health FROM community_members cm JOIN stakeholder_profiles sp ON sp.user_id = cm.user_id LEFT JOIN event_matches em ON (em.user_a_id = sp.user_id OR em.user_b_id = sp.user_id) WHERE cm.community_id = $1 GROUP BY sp.user_id, sp.emc2_lifetime_earned, sp.emc2_balance, sp.founding_member, sp.stakeholder_type ORDER BY sp.emc2_lifetime_earned DESC",
    [community_id]
  );
}

module.exports = {
  EMC2_ACTIONS: EMC2_ACTIONS,
  recordTransaction: recordTransaction,
  getWallet: getWallet,
  getHistory: getHistory,
  verifyLedgerIntegrity: verifyLedgerIntegrity,
  grantFoundingMember: grantFoundingMember,
  communityOwnerAward: communityOwnerAward,
  getCommunityNodeHealth: getCommunityNodeHealth,
  computeTxHash: computeTxHash,
  computeAccessTier: computeAccessTier
};
