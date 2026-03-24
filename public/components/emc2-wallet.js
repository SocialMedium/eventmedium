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
      fetch('/api/emc2/wallet', { headers: { 'Authorization': 'Bearer ' + token } }),
      fetch('/api/emc2/history?limit=5', { headers: { 'Authorization': 'Bearer ' + token } })
    ]);
    var walletData = await results[0].json();
    var historyData = await results[1].json();
    wallet = walletData.wallet || null;
    history = historyData.history || [];
    console.log('[EMC² Wallet] API response:', { wallet: wallet, history: history });
  } catch (err) {
    console.warn('[EMC² Wallet] API fetch error (rendering zero-state):', err);
  }

  if (!wallet) {
    wallet = { emc2_balance: 0, emc2_lifetime_earned: 0, global_access_active: false, founding_member: false, og_member: false, access_summary: null };
  }

  var isOG = !!wallet.og_member;
  var cardClass = isOG ? 'emc2-wallet og-card' : 'emc2-wallet';

  // Badge
  var accessBadge = '';
  if (isOG) {
    accessBadge = '<span class="emc2-badge og">\u2B21 Original Genesis</span>';
  } else if (wallet.founding_member) {
    accessBadge = '<span class="emc2-badge founding">\u2B21 Founding Member</span>';
  }

  var ogTagHTML = isOG ? '<div class="emc2-og-tag">\u2B21 Original Genesis</div>' : '';
  var logoHTML = '<div class="emc2-logo">EMC\u00B2</div>';

  // Canister number display
  var cohortNumber = wallet.emc2_cohort_number;
  var numberColor = isOG ? '#C9A84C' : 'rgba(255,255,255,0.9)';
  var numberLabelColor = isOG ? 'rgba(201,168,76,0.6)' : 'rgba(255,255,255,0.3)';
  var numberHTML = cohortNumber
    ? '<div style="font-size:22px;font-weight:500;color:' + numberColor + ';letter-spacing:0.02em;margin-top:4px;line-height:1">#' + cohortNumber.toLocaleString() + '</div>' +
      '<div style="font-size:10px;color:' + numberLabelColor + ';letter-spacing:0.06em;text-transform:uppercase;margin-top:3px">' + (isOG ? 'OG canister' : 'Canister') + ' number</div>'
    : '';

  // Match cost table
  var summary = wallet.access_summary;
  var accessHTML = '<div class="emc2-access-block">' +
    '<div class="emc2-access-row"><span class="emc2-access-label">Community matches</span><span class="emc2-access-value free">Free</span></div>' +
    '<div class="emc2-access-row"><span class="emc2-access-label">Event &amp; location matches</span><span class="emc2-access-value">5 EMC\u00B2 each</span></div>' +
    '<div class="emc2-access-row"><span class="emc2-access-label">Global network matches</span><span class="emc2-access-value">10 EMC\u00B2 each</span></div>' +
    (summary && summary.low_balance ? '<div class="emc2-low-balance-note">Low balance \u2014 earn more by updating your canister or completing a Nev debrief</div>' : '') +
    '</div>';

  // Action labels
  var actionLabels = {
    canister_complete: 'Canister completed', canister_quality_bonus: 'Quality bonus',
    community_join: 'Joined community', event_attend: 'Event attended',
    match_accepted: 'Match accepted', match_confirmed: 'Meeting confirmed',
    match_debrief: 'Debrief completed', referral_complete: 'Referral credited',
    admin_adjustment: 'Adjustment', network_query_spend: 'Network query',
    community_owner_award: 'Community award', community_multiplier_bonus: 'Multiplier bonus'
  };

  var historyHTML = '';
  if (history && history.length) {
    for (var i = 0; i < history.length; i++) {
      var tx = history[i];
      historyHTML += '<div class="emc2-tx">' +
        '<span class="emc2-tx-label">' + (actionLabels[tx.action_type] || tx.action_type) + '</span>' +
        '<span class="emc2-tx-amount ' + (tx.amount > 0 ? 'earn' : 'spend') + '">' +
        (tx.amount > 0 ? '+' : '') + tx.amount + ' EMC\u00B2</span></div>';
    }
  }

  // Footer with canister number
  var footerColor = isOG ? 'rgba(201,168,76,0.5)' : 'rgba(255,255,255,0.3)';
  var footerExtra = '';
  if (cohortNumber) {
    footerExtra = '<div style="font-size:11px;color:' + footerColor + ';text-align:center;margin-top:12px;line-height:1.6">' +
      'Canister #' + cohortNumber.toLocaleString() + ' of ' + (isOG ? '10,000 OG members' : 'the network') +
      '<br><span style="font-size:10px;opacity:0.7">This number is permanent and on-chain verifiable</span></div>';
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
      (accessBadge ? '<div class="emc2-access-row">' + accessBadge + '</div>' : '') +
      numberHTML +
      accessHTML +
      '<div class="emc2-history">' +
        '<div class="emc2-history-title">Recent Activity</div>' +
        (historyHTML || '<div class="emc2-empty">No activity yet</div>') +
      '</div>' +
      '<div class="emc2-footer">' +
        '<small>EMC\u00B2 credits are spent when you accept matches. Earn more through network activity.' +
        '<br><span class="emc2-asset-note">Early members build a verified position as the ecosystem grows.</span></small>' +
        footerExtra +
      '</div>' +
    '</div>';

  console.log('[EMC² Wallet] rendered successfully, og:', isOG);
}
