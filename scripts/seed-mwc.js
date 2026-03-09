#!/usr/bin/env node
require('dotenv').config();
var { dbGet, dbRun, dbAll } = require('../db');
var { embedProfile } = require('../lib/vector_search');

var MWC_EVENT_ID = 50;
var JT_USER_ID = 2;

// Profiles designed to complement JT's canister:
// JT = founder/angel/advisor, themes: Fintech, AI, Web3, Media, Robotics
// JT wants: exec search opps, market entry, angel investing, warm intros
// JT offers: capital ($10-50K), exec talent networks, distribution, market expansion

var SEEDS = [
  {
    name: 'Sofia Marchetti',
    email: 'seed_sofia@eventmedium.ai',
    company: 'PayLoop',
    stakeholder_type: 'founder',
    themes: ['Fintech', 'AI', 'Enterprise SaaS'],
    intent: ['angel investment ($25-100K)', 'distribution partnerships', 'warm introductions to enterprise clients'],
    offering: ['equity in Series A fintech startup', 'API-first payments infrastructure', 'open banking integrations'],
    focus_text: 'Building embedded payments for SMBs across Europe. Closing seed extension, looking for angels with distribution reach into consulting and enterprise.',
    geography: 'Milan, Italy — expanding to UK and DACH',
    deal_details: { stage: 'Seed+', raise_amount: '$2M', sectors: ['Fintech', 'Payments'] }
  },
  {
    name: 'Marcus Chen',
    email: 'seed_marcus@eventmedium.ai',
    company: 'Arcana AI',
    stakeholder_type: 'founder',
    themes: ['AI', 'Enterprise SaaS', 'Cybersecurity'],
    intent: ['angel investment', 'introductions to CISOs at Fortune 500', 'go-to-market advice for North America'],
    offering: ['AI-powered threat detection platform', 'partnership opportunities', 'technical co-development'],
    focus_text: 'Former Google DeepMind researcher. Building AI-native cybersecurity for enterprise. Need help cracking US market — strong product, weak distribution.',
    geography: 'London, UK — targeting US expansion',
    deal_details: { stage: 'Series A', raise_amount: '$8M', sectors: ['AI', 'Cybersecurity'] }
  },
  {
    name: 'Priya Sharma',
    email: 'seed_priya@eventmedium.ai',
    company: 'CredBridge',
    stakeholder_type: 'founder',
    themes: ['Fintech', 'AI', 'Privacy'],
    intent: ['angel investors with fintech networks', 'market entry advice for Australia and APAC', 'introductions to banking partners'],
    offering: ['credit scoring AI for emerging markets', 'alternative data partnerships', 'regulatory sandbox experience'],
    focus_text: 'AI-driven credit infrastructure for underbanked populations. Live in India and SE Asia, looking to expand to Australia. Backed by Sequoia India.',
    geography: 'Singapore — expanding to Australia, Middle East',
    deal_details: { stage: 'Series A', raise_amount: '$5M', sectors: ['Fintech', 'AI'] }
  },
  {
    name: 'Henrik Larsson',
    email: 'seed_henrik@eventmedium.ai',
    company: 'Vodafone Group',
    stakeholder_type: 'corporate',
    themes: ['Connectivity', 'AI', 'IoT'],
    intent: ['technology scouting', 'startup partnerships for 5G/AI use cases', 'talent acquisition for AI division'],
    offering: ['distribution across 21 European markets', 'API sandbox for telco integrations', 'co-development budgets'],
    focus_text: 'Head of Innovation Partnerships at Vodafone. Scouting AI and fintech startups to integrate into our B2B platform. Budget to pilot with 3-5 startups this year.',
    geography: 'Düsseldorf, Germany — European footprint',
    deal_details: {}
  },
  {
    name: 'Aisha Okafor',
    email: 'seed_aisha@eventmedium.ai',
    company: 'WealthStack',
    stakeholder_type: 'founder',
    themes: ['Fintech', 'Web3', 'AI'],
    intent: ['angel investment ($10-50K)', 'introductions to wealth management firms', 'advisor with consulting network'],
    offering: ['tokenized asset management platform', 'DeFi yield infrastructure', 'compliance-first Web3 architecture'],
    focus_text: 'Building the Vanguard for tokenized assets. Ex-Goldman, ex-Consensys. Need angels who bring more than capital — specifically consulting and enterprise distribution.',
    geography: 'New York, US — expanding to London and Dubai',
    deal_details: { stage: 'Pre-seed', raise_amount: '$1.5M', sectors: ['Fintech', 'Web3'] }
  },
  {
    name: 'Tom Wickham',
    email: 'seed_tom@eventmedium.ai',
    company: 'McKinsey & Company',
    stakeholder_type: 'advisor',
    themes: ['AI', 'Fintech', 'Enterprise SaaS'],
    intent: ['deal flow for personal angel portfolio', 'co-investment opportunities', 'board positions at growth-stage startups'],
    offering: ['McKinsey partner network across 60 offices', 'strategy advisory', 'Fortune 500 CxO introductions'],
    focus_text: 'Senior Partner at McKinsey Digital. Active angel investor on the side. Looking for founders in fintech and AI who need enterprise distribution, not just capital.',
    geography: 'London, UK — global network',
    deal_details: { check_size: '$25-100K', sectors: ['Fintech', 'AI'] }
  },
  {
    name: 'Laura Kim',
    email: 'seed_laura@eventmedium.ai',
    company: 'Hana Ventures',
    stakeholder_type: 'investor',
    themes: ['Fintech', 'AI', 'Web3'],
    intent: ['early-stage deal flow', 'co-investment with strategic angels', 'founders building for APAC markets'],
    offering: ['$500K-2M seed checks', 'Korea/Japan market entry support', 'portfolio company introductions'],
    focus_text: 'VC based in Seoul backing fintech and AI founders. Sweet spot is pre-seed to seed. Especially interested in founders with global ambition and APAC interest.',
    geography: 'Seoul, South Korea — investing globally',
    deal_details: { check_size: '$500K-2M', stage: 'Pre-seed to Seed', sectors: ['Fintech', 'AI', 'Web3'] }
  },
  {
    name: 'Diego Fernandez',
    email: 'seed_diego@eventmedium.ai',
    company: 'Motive Robotics',
    stakeholder_type: 'founder',
    themes: ['Robotics', 'AI', 'IoT'],
    intent: ['angel investment', 'introductions to industrial partners', 'talent sourcing for senior robotics engineers'],
    offering: ['autonomous inspection drones for infrastructure', 'computer vision IP', 'pilot deployment partnerships'],
    focus_text: 'Building autonomous inspection drones for telecoms towers and energy infrastructure. MIT spin-out. Need angels with industrial networks and help hiring senior talent.',
    geography: 'Boston, US — deploying in Europe and Middle East',
    deal_details: { stage: 'Seed', raise_amount: '$3M', sectors: ['Robotics', 'AI'] }
  },
  {
    name: 'Yuki Tanaka',
    email: 'seed_yuki@eventmedium.ai',
    company: 'NTT DATA',
    stakeholder_type: 'corporate',
    themes: ['AI', 'Fintech', 'Connectivity'],
    intent: ['startup scouting for enterprise AI', 'executive recruitment for new AI division', 'partnership with boutique search firms'],
    offering: ['access to Japanese enterprise market', 'NTT distribution network', 'R&D co-development funding'],
    focus_text: 'Leading NTT DATA new AI ventures unit. Building team from scratch — need world-class executive search support. Also scouting fintech startups for Japanese banking clients.',
    geography: 'Tokyo, Japan — global operations',
    deal_details: {}
  },
  {
    name: 'Rachel Stein',
    email: 'seed_rachel@eventmedium.ai',
    company: 'StreamLayer',
    stakeholder_type: 'founder',
    themes: ['Media & Entertainment', 'AI', 'Web3'],
    intent: ['angel investment', 'introductions to media companies', 'distribution partnerships for content platforms'],
    offering: ['AI-powered live streaming monetization', 'creator economy infrastructure', 'Web3 loyalty/rewards integration'],
    focus_text: 'Building the Shopify for live commerce. Ex-Twitch, ex-YouTube. Need angels with media industry connections and help getting in front of major broadcasters.',
    geography: 'Los Angeles, US — expanding to Europe and APAC',
    deal_details: { stage: 'Seed', raise_amount: '$4M', sectors: ['Media & Entertainment', 'AI'] }
  },
  {
    name: 'Oliver Grant',
    email: 'seed_oliver@eventmedium.ai',
    company: 'Talent Protocol',
    stakeholder_type: 'hirer',
    themes: ['AI', 'Web3', 'Enterprise SaaS'],
    intent: ['executive search partners', 'sourcing CTOs and VPs Engineering for portfolio companies', 'talent mapping in AI/ML space'],
    offering: ['access to 40+ VC-backed startups needing senior hires', 'talent data and market intelligence', 'referral fees for successful placements'],
    focus_text: 'Talent Partner at a top-20 VC. Our portfolio companies are desperate for senior AI/ML talent. Looking for executive search partners who understand deep tech.',
    geography: 'San Francisco, US — hiring globally',
    deal_details: {}
  },
  {
    name: 'Fatima Al-Rashid',
    email: 'seed_fatima@eventmedium.ai',
    company: 'Dubai Future Foundation',
    stakeholder_type: 'partner',
    themes: ['Fintech', 'AI', 'Robotics'],
    intent: ['partnerships with international accelerators', 'deal flow for Dubai sandbox programs', 'connecting global founders to Middle East investors'],
    offering: ['regulatory sandbox fast-track in Dubai', 'connections to sovereign wealth funds', 'soft-landing programs for MENA expansion'],
    focus_text: 'Running international partnerships for Dubai Future Foundation. We fast-track fintech and AI companies into MENA markets. Looking for global partners who bring quality deal flow.',
    geography: 'Dubai, UAE — connecting global founders to MENA',
    deal_details: {}
  }
];

async function run() {
  console.log('\n🌱 Seeding MWC profiles...\n');

  // Register JT for MWC if not already
  var jtReg = await dbGet('SELECT id FROM event_registrations WHERE event_id = $1 AND user_id = $2', [MWC_EVENT_ID, JT_USER_ID]);
  if (jtReg) {
    console.log('   ✓ JT already registered for MWC');
  }

  // Ensure JT is embedded in Qdrant
  var jtProfile = await dbGet('SELECT * FROM stakeholder_profiles WHERE user_id = $1', [JT_USER_ID]);
  var jtUser = await dbGet('SELECT name, company FROM users WHERE id = $1', [JT_USER_ID]);
  if (jtProfile) {
    var jtVector = await embedProfile(jtProfile, jtUser);
    console.log('   ✓ JT embedded in Qdrant: ' + (jtVector ? 'yes' : 'already exists'));
  }

  var created = 0;
  for (var i = 0; i < SEEDS.length; i++) {
    var s = SEEDS[i];

    // Check if already exists
    var existing = await dbGet('SELECT id FROM users WHERE email = $1', [s.email]);
    if (existing) {
      console.log('   ⚠  ' + s.name + ' already exists, skipping');
      continue;
    }

    // Create user
    var userResult = await dbRun(
      "INSERT INTO users (name, email, company, auth_provider) VALUES ($1, $2, $3, 'seed') RETURNING id",
      [s.name, s.email, s.company]
    );
    var userId = userResult.rows[0].id;

    // Create profile
    await dbRun(
      `INSERT INTO stakeholder_profiles
        (user_id, stakeholder_type, themes, intent, offering, focus_text, geography, deal_details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId, s.stakeholder_type,
        JSON.stringify(s.themes),
        JSON.stringify(s.intent),
        JSON.stringify(s.offering),
        s.focus_text,
        s.geography,
        JSON.stringify(s.deal_details || {})
      ]
    );

    // Register for MWC
    await dbRun(
      "INSERT INTO event_registrations (event_id, user_id, status) VALUES ($1, $2, 'active')",
      [MWC_EVENT_ID, userId]
    );

    // Embed in Qdrant
    var profile = await dbGet('SELECT * FROM stakeholder_profiles WHERE user_id = $1', [userId]);
    var vectorId = await embedProfile(profile, { name: s.name, company: s.company });

    console.log('   ✓ ' + s.name + ' (' + s.stakeholder_type + ' @ ' + s.company + ')' + (vectorId ? ' [embedded]' : ''));
    created++;
  }

  console.log('\n   Created ' + created + ' seed profiles for MWC');

  // Now trigger matching for JT
  console.log('\n⚡ Generating matches for JT at MWC...');
  var { generateMatchesForUser } = require('../routes/matches');
  var matches = await generateMatchesForUser(JT_USER_ID, MWC_EVENT_ID);
  console.log('   ✓ ' + matches.length + ' matches generated\n');

  if (matches.length) {
    matches.sort(function(a, b) { return b.score_total - a.score_total; });
    console.log('   Top matches:');
    for (var m = 0; m < Math.min(matches.length, 8); m++) {
      var match = matches[m];
      var other = await dbGet('SELECT u.name, u.company, sp.stakeholder_type FROM users u JOIN stakeholder_profiles sp ON sp.user_id = u.id WHERE u.id = $1', [match.other_user_id || match.userB]);
      if (other) {
        console.log('   ' + (m+1) + '. ' + (match.score_total * 100).toFixed(0) + '% — ' + other.name + ' (' + other.stakeholder_type + ' @ ' + other.company + ')');
      }
    }
  }

  console.log('\n✅ Done! Check matches at https://www.eventmedium.ai/matches.html\n');
  process.exit();
}

run().catch(function(err) { console.error('Seed error:', err); process.exit(1); });
