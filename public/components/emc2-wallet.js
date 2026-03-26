// EC³ Wallet Component — vanilla JS, inject into canister page after auth check
async function renderEMC2Wallet(containerId) {
  console.log('[EC³ Wallet] renderEMC2Wallet called, containerId:', containerId);
  var container = document.getElementById(containerId);
  if (!container) { console.warn('[EC³ Wallet] container not found:', containerId); return; }

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
    console.log('[EC³ Wallet] API response:', { wallet: wallet, history: history });
  } catch (err) {
    console.warn('[EC³ Wallet] API fetch error (rendering zero-state):', err);
  }

  if (!wallet) {
    wallet = { emc2_balance: 0, emc2_lifetime_earned: 0, global_access_active: false, founding_member: false, og_member: false, access_summary: null };
  }

  var isOG = !!wallet.og_member;
  var cardClass = isOG ? 'emc2-wallet og-card' : 'emc2-wallet';

  // Badge — single instance, no duplicate in header
  var accessBadge = '';
  if (isOG) {
    accessBadge = '<span class="emc2-badge og">\u2B21 Original Genesis</span>';
  } else if (wallet.founding_member) {
    accessBadge = '<span class="emc2-badge founding">\u2B21 Founding Member</span>';
  }

  // Logo only — no OG tag in header (badge carries it)
  var logoHTML = '<div class="emc2-logo">EC\u00B3</div>';

  // Canister number — "OG #2" for OG, "#2" for standard, no subtitle
  var cohortNumber = wallet.emc2_cohort_number;
  var numberDisplay = cohortNumber
    ? (isOG ? 'OG #' : '#') + cohortNumber.toLocaleString()
    : '';
  var numberHTML = numberDisplay
    ? '<div style="font-size:28px;font-weight:600;color:#C9A84C;letter-spacing:0.04em;line-height:1;margin-bottom:12px">' + numberDisplay + '</div>'
    : '';

  // Match cost table
  var summary = wallet.access_summary;
  var accessHTML = '<div class="emc2-access-block">' +
    '<div class="emc2-access-row"><span class="emc2-access-label">Community matches</span><span class="emc2-access-value free">Free</span></div>' +
    '<div class="emc2-access-row"><span class="emc2-access-label">Event &amp; location matches</span><span class="emc2-access-value">5 EC\u00B3 each</span></div>' +
    '<div class="emc2-access-row"><span class="emc2-access-label">Global network matches</span><span class="emc2-access-value">10 EC\u00B3 each</span></div>' +
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
        (tx.amount > 0 ? '+' : '') + tx.amount + ' EC\u00B3</span></div>';
    }
  }

  // Footer
  var footerExtra = '';
  if (cohortNumber) {
    var footerNum = isOG ? 'OG #' + cohortNumber.toLocaleString() : '#' + cohortNumber.toLocaleString();
    footerExtra =
      '<div style="font-size:11px;color:rgba(201,168,76,0.75);text-align:center;margin-top:10px">' +
        'Canister ' + footerNum + ' of ' + (isOG ? '10,000 OG members' : 'the network') +
      '</div>' +
      '<div style="font-size:10px;color:rgba(255,255,255,0.3);text-align:center;margin-top:3px">This number is permanent and on-chain verifiable</div>';
  }

  container.innerHTML =
    '<div class="' + cardClass + '">' +
      '<div class="emc2-wallet-header">' +
        '<div>' + logoHTML + '</div>' +
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
      '<div style="height:0.5px;background:rgba(255,255,255,0.12);margin:12px 0"></div>' +
      '<div class="emc2-history">' +
        '<div style="font-size:10px;letter-spacing:0.07em;text-transform:uppercase;color:rgba(255,255,255,0.4);margin-bottom:8px">Recent Activity</div>' +
        (historyHTML || '<div class="emc2-empty">No activity yet</div>') +
      '</div>' +
      '<div class="emc2-footer">' +
        '<small>EC\u00B3 credits are spent when you accept matches. Earn more through network activity.' +
        '<br><span class="emc2-asset-note">Early members build a verified position as the ecosystem grows.</span></small>' +
        footerExtra +
      '</div>' +
    '</div>';

  console.log('[EC³ Wallet] rendered successfully, og:', isOG);
}
