// /public/js/info-bubbles.js
// Single source of truth for all info bubble content
// Add new tips here as features are built

var TIPS = {

  // EC³ WALLET
  emc2_balance: {
    title: "Your EC\u00B3 balance",
    body: "Spent when you accept matches: community " +
          "matches are free, event and location matches " +
          "cost 5 EC\u00B3 each, global network matches cost " +
          "10 EC\u00B3 each. Earn more through debriefs, " +
          "canister updates, and referrals.",
    tag: "Free in your community"
  },
  emc2_lifetime: {
    title: "Lifetime earned",
    body: "Total EC\u00B3 ever earned \u2014 never decrements. " +
          "Your verified contribution record to the network, " +
          "carried forward into the tokenised ecosystem.",
    tag: "Permanent provenance"
  },
  emc2_global_access: {
    title: "Universal access",
    body: "All members can match across the full EventMedium " +
          "network. Community matches are free, event matches " +
          "cost 5 EC\u00B3, global matches cost 10 EC\u00B3.",
    tag: null
  },
  emc2_genesis: {
    title: "Genesis Member",
    body: "You completed your canister in the first 1,000 " +
          "on the network. Permanent global access, 3\u00D7 earn " +
          "multiplier, and cascade awards at every milestone.",
    tag: "First 1,000 canisters"
  },
  emc2_founding: {
    title: "Founding Member",
    body: "You completed your canister in the first 10,000 " +
          "on the network. Permanent global access and a 2\u00D7 " +
          "earn multiplier on all activity.",
    tag: "First 10,000 canisters"
  },
  emc2_cohort_number: {
    title: "Your canister number",
    body: "Your permanent position in the network \u2014 recorded " +
          "on the ledger at the moment you completed your " +
          "canister. The 847th will always have been the 847th.",
    tag: "On-chain verifiable"
  },
  emc2_multiplier: {
    title: "Earn multiplier",
    body: "Every EC\u00B3 earn event credits your wallet at your " +
          "cohort rate. Genesis = 3\u00D7. Founding = 2\u00D7. " +
          "Early = 1.5\u00D7. This compounds significantly " +
          "over time.",
    tag: null
  },
  emc2_activity: {
    title: "Earn events",
    body: "Credits are earned by actions that improve the " +
          "network graph: completing your canister, confirming " +
          "meetings, running debriefs with Nev, and referring " +
          "members who complete their profiles.",
    tag: null
  },
  emc2_cascade: {
    title: "Cascade award",
    body: "A retroactive bonus awarded to early members when " +
          "the network crosses a milestone. The more milestones " +
          "the network reaches, the more your early " +
          "contribution is recognised.",
    tag: "Milestone reward"
  },

  // CANISTER
  canister_themes: {
    title: "Your themes",
    body: "The sectors and domains that define your " +
          "professional focus. Themes are used to identify " +
          "alignment across the network \u2014 the more specific, " +
          "the better your matches.",
    tag: null
  },
  canister_intent: {
    title: "Your intent",
    body: "What you are actively looking for right now. " +
          "Intent signals are the primary driver of match " +
          "quality \u2014 they reflect what you want from " +
          "a connection, not just who you are.",
    tag: null
  },
  canister_offering: {
    title: "Your offering",
    body: "What you bring to a connection. Nev uses this to " +
          "find people whose intent matches what you can " +
          "provide \u2014 and vice versa.",
    tag: null
  },
  canister_stakeholder: {
    title: "Stakeholder type",
    body: "Your role in the ecosystem: founder, investor, " +
          "researcher, corporate, advisor, or operator. " +
          "Used to weight match scoring across different " +
          "stakeholder combinations.",
    tag: null
  },
  canister_signal_score: {
    title: "Signal score",
    body: "Nev\u2019s assessment of your canister\u2019s richness. " +
          "Higher scores mean more precise matches. " +
          "Update your canister monthly to keep signal " +
          "current and earn EC\u00B3.",
    tag: "Improves match quality"
  },

  // MATCHING
  match_score: {
    title: "Match score",
    body: "A composite score across theme alignment, intent " +
          "complementarity, stakeholder fit, and signal " +
          "convergence. Higher scores indicate stronger " +
          "structural alignment.",
    tag: null
  },
  match_intent_score: {
    title: "Intent alignment",
    body: "How well your current intent matches what the " +
          "other person is offering \u2014 and theirs matches " +
          "yours. The most predictive component of " +
          "meeting quality.",
    tag: null
  },
  match_tier: {
    title: "Match tier",
    body: "Whether this match comes from your event, " +
          "community, or the global network. Global matches " +
          "require EC\u00B3 and represent connections outside " +
          "your existing membership contexts.",
    tag: null
  },

  // COMMUNITY OWNER
  community_node_health: {
    title: "Node health",
    body: "A member\u2019s contribution tier based on lifetime " +
          "EC\u00B3 earned: Anchor (400+), Active (200+), " +
          "Engaged (100+), Passive (<100). Reflects signal " +
          "quality, not just activity.",
    tag: null
  },
  community_award_pool: {
    title: "Award pool",
    body: "EC\u00B3 you have allocated to recognise your most " +
          "active community members. Awards are sent " +
          "directly to member wallets and logged on " +
          "the network ledger.",
    tag: null
  },
  community_multiplier: {
    title: "Earn multiplier",
    body: "A time-limited boost you set for specific earn " +
          "actions in your community \u2014 e.g. 2\u00D7 EC\u00B3 for " +
          "canister completion before your next event. " +
          "Useful for seeding engagement ahead of events.",
    tag: null
  },
  community_founding_threshold: {
    title: "Founding threshold",
    body: "The number of canisters in your community that " +
          "qualify for founding member status. The first N " +
          "members to complete their canister receive " +
          "permanent global access.",
    tag: null
  }
};

// ─── Tooltip engine ───────────────────────────────────────

(function() {
  var box = document.createElement('div');
  box.id = 'em-tooltip';
  box.style.cssText =
    'display:none;position:fixed;z-index:9999;' +
    'background:var(--color-background-primary,#fff);' +
    'border:0.5px solid var(--color-border-secondary,#e5e7eb);' +
    'border-radius:8px;padding:10px 12px;width:220px;' +
    'pointer-events:none;' +
    'font-family:var(--font-sans,system-ui,-apple-system,BlinkMacSystemFont,sans-serif);' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.08)';
  document.body.appendChild(box);

  var activeEl = null;

  function render(key) {
    var d = TIPS[key];
    if (!d) return;
    var html =
      '<div style="font-size:12px;font-weight:500;' +
        'color:var(--color-text-primary,#1a1d29);margin-bottom:5px">' +
        d.title +
      '</div>' +
      '<div style="font-size:12px;line-height:1.55;' +
        'color:var(--color-text-secondary,#6b7280)">' +
        d.body +
      '</div>';
    if (d.tag) {
      html +=
        '<span style="display:inline-block;margin-top:7px;' +
          'font-size:10px;padding:2px 7px;border-radius:20px;' +
          'background:#EEEDFE;color:#3C3489">' +
          d.tag +
        '</span>';
    }
    box.innerHTML = html;
  }

  function position(el) {
    var r  = el.getBoundingClientRect();
    var tw = 220;
    box.style.display = 'block';
    var th = box.offsetHeight;
    var left = r.left + r.width / 2 - tw / 2;
    var top  = r.top - th - 8;
    if (left < 8) left = 8;
    if (left + tw > window.innerWidth - 8)
      left = window.innerWidth - tw - 8;
    if (top < 8) top = r.bottom + 8;
    box.style.left = left + 'px';
    box.style.top  = top  + 'px';
    box.style.animation = 'emTipIn 0.12s ease';
  }

  function show(el) {
    render(el.dataset.tip);
    position(el);
    activeEl = el;
  }

  function hide() {
    box.style.display = 'none';
    activeEl = null;
  }

  // Inject keyframe once
  if (!document.getElementById('em-tip-style')) {
    var s = document.createElement('style');
    s.id = 'em-tip-style';
    s.textContent =
      '@keyframes emTipIn {' +
        'from { opacity:0; transform:translateY(4px) }' +
        'to   { opacity:1; transform:translateY(0) }' +
      '}' +
      '.em-info {' +
        'display:inline-flex;align-items:center;' +
        'justify-content:center;' +
        'width:14px;height:14px;border-radius:50%;' +
        'border:1px solid var(--color-border-secondary,#e5e7eb);' +
        'font-size:9px;color:var(--color-text-tertiary,#9ca3af);' +
        'cursor:pointer;flex-shrink:0;user-select:none;' +
        'transition:border-color 0.15s,color 0.15s;' +
        'vertical-align:middle;margin-left:4px;' +
      '}' +
      '.em-info:hover {' +
        'border-color:var(--color-border-primary,#d1d5db);' +
        'color:var(--color-text-secondary,#6b7280);' +
      '}';
    document.head.appendChild(s);
  }

  // Delegate — works on dynamically added triggers
  document.addEventListener('mouseover', function(e) {
    var el = e.target.closest('[data-tip]');
    if (el) show(el);
  });
  document.addEventListener('mouseout', function(e) {
    var el = e.target.closest('[data-tip]');
    if (el) hide();
  });
  document.addEventListener('click', function(e) {
    var el = e.target.closest('[data-tip]');
    if (el) {
      e.stopPropagation();
      if (activeEl === el) { hide(); } else { show(el); }
    } else {
      hide();
    }
  });
  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('resize', hide, { passive: true });

})();
