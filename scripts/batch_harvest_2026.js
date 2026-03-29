#!/usr/bin/env node
// Batch harvest — curated B2B tech conference URLs for 2026
// Run: node scripts/batch_harvest_2026.js
//
// Uses the single-URL harvester (Claude extraction) — no search API needed.
// Skips events already in DB by name+year dedup.

require('dotenv').config();
var { harvestEvent } = require('../lib/event-harvester');
var { normalizeThemes } = require('../lib/theme_taxonomy');
var { dbGet, dbRun, dbAll } = require('../db');

var URLS = [
  // ── AI / ML ──
  'https://neurips.cc',
  'https://icml.cc',
  'https://iclr.cc',
  'https://aaai.org/conference/aaai/aaai-26/',
  'https://london.theaisummit.com',
  'https://worldsummit.ai',
  'https://www.ai-expo.net/global/',
  'https://www.re-work.co/events/deep-learning-summit-2026',
  'https://www.gartner.com/en/conferences/na/data-analytics-us',
  'https://www.nvidia.com/gtc/',

  // ── FinTech / Payments ──
  'https://europe.money2020.com',
  'https://us.money2020.com',
  'https://www.finovate.com/finovatefall/',
  'https://www.finovate.com/finovateeurope/',
  'https://www.sibos.com',
  'https://paris-fintech-forum.com',
  'https://fintechconnect.com',
  'https://www.lendit.com',
  'https://www.seamless-expo.com',
  'https://www.paymentsexpo.com',

  // ── Enterprise SaaS / Cloud ──
  'https://www.saastrannual.com',
  'https://www.salesforce.com/dreamforce/',
  'https://reinvent.awsevents.com',
  'https://ignite.microsoft.com',
  'https://cloud.withgoogle.com/next',
  'https://www.atlassian.com/company/events/team',
  'https://www.hubspot.com/inbound',
  'https://www.gartner.com/en/conferences/na/it-symposium-us',
  'https://saastock.com',
  'https://www.subscribed.com',

  // ── Cybersecurity ──
  'https://www.rsaconference.com',
  'https://www.blackhat.com',
  'https://www.defcon.org',
  'https://cyberweek.ae',
  'https://www.infosecurityeurope.com',
  'https://www.gisec.ae',

  // ── HealthTech / BioTech ──
  'https://www.hlth.com',
  'https://europe.hlth.com',
  'https://www.himss.org/global-health-conference-exhibition',
  'https://www.vivatech.com',
  'https://www.bio.org/events/bio-international-convention',
  'https://www.medteceurope.org',
  'https://www.healthcareitnews.com/himss',
  'https://www.biostartupday.com',

  // ── Climate / Energy / Sustainability ──
  'https://www.climatetechforum.com',
  'https://greentech.eco',
  'https://www.cop30.org',
  'https://www.wef.org',
  'https://www.all-energy.co.uk',
  'https://www.greenbiz.com/events/verge',
  'https://www.smart-energy.com',

  // ── Web3 / Crypto ──
  'https://www.token2049.com/singapore',
  'https://ethglobal.com',
  'https://www.mainnet.events',
  'https://www.permissionless.org',
  'https://www.ethcc.io',
  'https://www.cosmoverse.org',
  'https://solana.com/breakpoint',

  // ── Robotics / Hardware / IoT ──
  'https://www.hannovermes.de/en/',
  'https://www.automate.org/events/automate',
  'https://www.robobusiness.com',
  'https://www.embedded-world.de/en',
  'https://www.iotsworldcongress.com',
  'https://www.ceskarepublika.com',

  // ── SpaceTech / Aerospace ──
  'https://www.spacecomexpo.com',
  'https://www.newspace.im',
  'https://www.satellite-expo.com',
  'https://www.iac2026.org',
  'https://www.spacetechexpo.com',

  // ── EdTech ──
  'https://www.bettshow.com',
  'https://www.asugsvsummit.com',
  'https://www.learntechuk.co.uk',
  'https://educationfest.co.uk',

  // ── General Tech / Multi-theme ──
  'https://websummit.com',
  'https://collisionconf.com',
  'https://sxsw.com',
  'https://www.ces.tech',
  'https://vivatech.com',
  'https://londontechweek.com',
  'https://tnw.com/conference',
  'https://www.gitex.com',
  'https://techcrunch.com/events/tc-disrupt-2026/',
  'https://www.southsummit.co',
  'https://pirate.global',
  'https://www.slush.org',
  'https://www.wearedevelopers.com/world-congress',
  'https://www.techbbbq.dk',
  'https://arcticfintech.com',

  // ── APAC Focus ──
  'https://www.techweek.co.nz',
  'https://rise.web-summit.com',
  'https://www.switch.org.sg',
  'https://techsauce.co/en',
  'https://www.echelon.asia',
  'https://www.wild-digital.com',
  'https://innovfest.com',
  'https://bangkokblockchainweek.com',
  'https://webx-asia.com',
  'https://www.supercomputingasia.com',

  // ── Australia Focus ──
  'https://www.afinnovationsummit.com.au',
  'https://www.startcon.com',
  'https://pausefest.com.au',
  'https://cebit.com.au',
  'https://www.sxswsydney.com',
  'https://www.all-energy.com.au',

  // ── Middle East Focus ──
  'https://www.stepconference.com',
  'https://expand.northstar.ae',
  'https://www.futureblockchainsummit.com',

  // ── RegTech / GovTech / LegalTech ──
  'https://www.govtechsummit.eu',
  'https://www.legaltechshow.com',
  'https://www.regtech-summit.com',

  // ── Gaming ──
  'https://gdconf.com',
  'https://www.gamescom.global/en',
  'https://www.e3expo.com',
  'https://www.paborevents.com/pocketgamerconnects',

  // ── Privacy / Data ──
  'https://www.privacysymposium.org',
  'https://www.datacouncil.ai',
  'https://www.strata-data.ai',

  // ── Open Source / DevTools ──
  'https://events.linuxfoundation.org/kubecon-cloudnativecon-europe/',
  'https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/',
  'https://github.com/universe',
  'https://www.hashiconf.com',
  'https://www.devoxx.com',
];

// Remove duplicates
var seen = {};
URLS = URLS.filter(function(u) {
  var key = u.replace(/\/$/, '').toLowerCase();
  if (seen[key]) return false;
  seen[key] = true;
  return true;
});

var stats = { total: URLS.length, success: 0, duplicate: 0, failed: 0, events: [] };

async function run() {
  console.log('=== Batch Harvest 2026 ===');
  console.log('URLs to harvest:', URLS.length);
  console.log('');

  for (var i = 0; i < URLS.length; i++) {
    var url = URLS[i];
    var prefix = '[' + (i + 1) + '/' + URLS.length + ']';

    try {
      var extracted = await harvestEvent(url);

      // Dedup: check by name + year
      var year = extracted.event_date ? new Date(extracted.event_date).getFullYear() : null;
      var existing = year
        ? await dbGet("SELECT id, name FROM events WHERE name ILIKE $1 AND EXTRACT(YEAR FROM event_date) = $2", [extracted.name, year])
        : await dbGet("SELECT id, name FROM events WHERE name ILIKE $1", [extracted.name]);

      if (existing) {
        stats.duplicate++;
        console.log(prefix, 'DUPE', extracted.name);
        continue;
      }

      // Generate slug
      var slug = (extracted.name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (extracted.event_date) slug += '-' + String(extracted.event_date).replace(/-/g, '').substring(0, 8);
      slug += '-' + Date.now().toString(36);

      var themes = normalizeThemes(extracted.themes || []);

      // Filter stale events — reject anything before 2025
      if (extracted.event_date) {
        var eventYear = new Date(extracted.event_date).getFullYear();
        if (eventYear < 2025) {
          stats.failed++;
          console.log(prefix, ' STALE', extracted.name, '(', extracted.event_date, ')');
          continue;
        }
      }

      var result = await dbRun(
        `INSERT INTO events (name, description, event_date, city, country, event_type, themes, slug, source_url, expected_attendees)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (name, event_date, city, country) DO NOTHING
         RETURNING *`,
        [
          extracted.name, extracted.description || null,
          extracted.event_date || null, extracted.city || null, extracted.country || null,
          'conference', JSON.stringify(themes), slug,
          extracted.website || url,
          extracted.expected_attendees || null
        ]
      );

      if (result && result.rows && result.rows[0]) {
        stats.success++;
        stats.events.push({ name: extracted.name, city: extracted.city, date: extracted.event_date, themes: themes.slice(0, 3) });
        console.log(prefix, '  +', extracted.name, '|', extracted.city || '?', '|', extracted.event_date || 'no date', '|', themes.slice(0, 3).join(', '));
      } else {
        stats.duplicate++;
        console.log(prefix, 'DUPE', extracted.name, '(conflict)');
      }
    } catch(e) {
      stats.failed++;
      console.log(prefix, '  X', url.substring(0, 50), '—', e.message.substring(0, 80));
    }

    // Rate limit: 1.5s between harvests to be kind to Claude + target sites
    if (i < URLS.length - 1) await new Promise(function(r) { setTimeout(r, 1500); });
  }

  console.log('\n=== RESULTS ===');
  console.log('Total URLs:', stats.total);
  console.log('New events added:', stats.success);
  console.log('Duplicates skipped:', stats.duplicate);
  console.log('Failed:', stats.failed);

  var total = await dbGet('SELECT COUNT(*) as count FROM events');
  console.log('Total events in DB:', total.count);

  process.exit(0);
}

run().catch(function(err) {
  console.error('Fatal:', err);
  process.exit(1);
});
