// EMC² Wallet Component — vanilla JS, inject into canister page after auth check
async function renderEMC2Wallet(containerId) {
  console.log('[EMC² Wallet] renderEMC2Wallet called, containerId:', containerId);
  var container = document.getElementById(containerId);
  if (!container) { console.warn('[EMC² Wallet] container not found:', containerId); return; }

  var token = localStorage.getItem('auth_token');

  var wallet = null;
  var history = [];
  try {
    var results = await Promise.all([
      fetch('/api/emc2/wallet', {
        headers: { 'Authorization': 'Bearer ' + token }
      }),
      fetch('/api/emc2/history?limit=5', {
        headers: { 'Authorization': 'Bearer ' + token }
      })
    ]);

    var walletData  = await results[0].json();
    var historyData = await results[1].json();
    wallet  = walletData.wallet || null;
    history = historyData.history || [];

    console.log('[EMC² Wallet] API response:', { wallet: wallet, history: history });
  } catch (err) {
    console.warn('[EMC² Wallet] API fetch error (rendering zero-state):', err);
  }

  // Always render — use defaults if API failed or returned null
  if (!wallet) {
    wallet = { emc2_balance: 0, emc2_lifetime_earned: 0, global_access_active: false, founding_member: false, og_member: false, access_tier: null };
  }

  var isOG = !!wallet.og_member;
  var cardClass = isOG ? 'emc2-wallet og-card' : 'emc2-wallet';

  // Access badge
  var accessBadge = '';
  if (isOG) {
    accessBadge = '<span class="emc2-badge og">\u2B21 Original Genesis</span>';
  } else if (wallet.founding_member) {
    accessBadge = '<span class="emc2-badge founding">\u2B21 Founding Member</span>';
  } else if (wallet.global_access_active) {
    accessBadge = '<span class="emc2-badge global">\u25C9 Global Access Active</span>';
  } else {
    accessBadge = '<span class="emc2-badge locked">\u25CE Local Access</span>';
  }

  // OG tag line under wallet label
  var ogTagHTML = isOG ? '<div class="emc2-og-tag">\u2B21 Original Genesis</div>' : '';

  // Logo — gold for OG, gradient for standard
  var logoHTML = '<div class="emc2-logo">EMC\u00B2</div>';

  // Tier progress bar
  var tierHTML = '';
  var tier = wallet.access_tier;
  if (tier) {
    var pct = tier.next_threshold
      ? Math.min(100, Math.round((tier.progress / tier.progress_target) * 100))
      : 100;

    var progressBar = tier.next_threshold
      ? '<div class="emc2-tier-bar-track"><div class="emc2-tier-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="emc2-tier-progress-label">' + (tier.progress || 0).toLocaleString() + ' / ' + tier.progress_target.toLocaleString() + ' EMC\u00B2 \u2014 ' + tier.next_name + '</div>'
      : '<div class="emc2-tier-progress-label">Maximum tier reached</div>';

    var nextHint = tier.next_threshold
      ? '<div class="emc2-tier-next">Next: ' + tier.next_name + ' at ' + tier.next_threshold.toLocaleString() + ' EMC\u00B2</div>'
      : '';

    tierHTML = '<div class="emc2-tier-block">' +
      '<div class="emc2-tier-name">\u25C9 ' + tier.name + '</div>' +
      progressBar +
      nextHint +
    '</div>';
  }

  // Action labels for history
  var actionLabels = {
    canister_complete:        'Canister completed',
    canister_quality_bonus:   'Quality bonus',
    community_join:           'Joined community',
    event_attend:             'Event attended',
    match_accepted:           'Match accepted',
    match_confirmed:          'Meeting confirmed',
    match_debrief:            'Debrief completed',
    referral_complete:        'Referral credited',
    global_access_unlock:     'Global access unlocked',
    network_query_spend:      'Network query',
    community_owner_award:    'Community award',
    community_multiplier_bonus: 'Multiplier bonus'
  };

  var historyHTML = '';
  if (history && history.length) {
    for (var i = 0; i < history.length; i++) {
      var tx = history[i];
      historyHTML += '<div class="emc2-tx">' +
        '<span class="emc2-tx-label">' + (actionLabels[tx.action_type] || tx.action_type) + '</span>' +
        '<span class="emc2-tx-amount ' + (tx.amount > 0 ? 'earn' : 'spend') + '">' +
        (tx.amount > 0 ? '+' : '') + tx.amount + ' EMC\u00B2</span>' +
        '</div>';
    }
  }

  // OG footer
  var footerExtra = '';
  if (isOG && wallet.emc2_cohort_number) {
    footerExtra = '<div class="emc2-og-footer">OG Member #' + wallet.emc2_cohort_number + ' of 10,000</div>';
  } else if (isOG) {
    footerExtra = '<div class="emc2-og-footer">OG Member \u2014 First 10,000</div>';
  }

  container.innerHTML =
    '<div class="' + cardClass + '">' +
      '<div class="emc2-wallet-header">' +
        '<div>' + logoHTML + ogTagHTML + '</div>' +
        '<div class="emc2-wallet-label">Your Wallet</div>' +
      '</div>' +
      '<div class="emc2-balance-row">' +
        '<div class="emc2-balance">' +
          '<div class="emc2-balance-value">' + (wallet.emc2_balance || 0).toLocaleString() + '</div>' +
          '<div class="emc2-balance-label">Balance</div>' +
        '</div>' +
        '<div class="emc2-lifetime">' +
          '<div class="emc2-balance-value lifetime">' + (wallet.emc2_lifetime_earned || 0).toLocaleString() + '</div>' +
          '<div class="emc2-balance-label">Lifetime Earned</div>' +
        '</div>' +
      '</div>' +
      '<div class="emc2-access-row">' + accessBadge + '</div>' +
      tierHTML +
      '<div class="emc2-history">' +
        '<div class="emc2-history-title">Recent Activity</div>' +
        (historyHTML || '<div class="emc2-empty">No activity yet</div>') +
      '</div>' +
      '<div class="emc2-footer">' +
        '<small>' +
          'EMC\u00B2 credits are earned through your network activity and unlock matching across the global EventMedium ecosystem.' +
          '<br><span class="emc2-asset-note">Early members build a verified position as the ecosystem grows.</span>' +
        '</small>' +
        footerExtra +
      '</div>' +
    '</div>';

  console.log('[EMC² Wallet] rendered successfully, og:', isOG, 'tier:', tier ? tier.name : 'none');
}

async function unlockGlobalAccess() {
  var token = localStorage.getItem('auth_token');
  try {
    var res = await fetch('/api/emc2/unlock-global', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    var data = await res.json();
    if (data.success) {
      renderEMC2Wallet('emc2-wallet-container');
    } else {
      alert(data.error || 'Could not unlock global access');
    }
  } catch (err) {
    console.error(err);
  }
}
