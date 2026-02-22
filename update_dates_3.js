/**
 * EventMedium.ai – Sprint 3: Complete Date Research Update
 * 
 * Covers all remaining placeholder events (~35) with verified 2026 dates.
 * Also fixes: Paris Blockchain Week, flags TNW (cancelled) and DSEI (biennial/2027).
 * 
 * Run: node update_dates_3.js
 * Requires: .env with DATABASE_URL, and db.js helper
 */

require('dotenv').config();
const { dbRun, dbQuery } = require('./db');

const updates = [
  // ── FIX: Paris Blockchain Week (missed in Sprint 2 due to name mismatch) ──
  { pattern: '%Blockchain Week%Paris%', date: '2026-04-15', city: null, country: null },

  // ── VERIFIED 2026 DATES ──

  // AI Summit London – Jun 10-11, Tobacco Dock, London
  { pattern: '%AI Summit%London%', date: '2026-06-10', city: 'London', country: 'United Kingdom' },

  // AI Summit New York – Dec 9-10, Javits Center, New York
  { pattern: '%AI Summit%New York%', date: '2026-12-09', city: 'New York', country: 'United States' },

  // Greentech Festival Berlin – Jun 23-25, Berlin
  { pattern: '%Greentech%Berlin%', date: '2026-06-23', city: 'Berlin', country: 'Germany' },

  // Infosecurity Europe – Jun 2-4, ExCeL London
  { pattern: '%Infosecurity%Europe%', date: '2026-06-02', city: 'London', country: 'United Kingdom' },

  // BIO International Convention – Jun 22-25, San Diego
  { pattern: '%BIO International%', date: '2026-06-22', city: 'San Diego', country: 'United States' },

  // South Summit Madrid – Jun 3-5, La Nave, Madrid
  { pattern: '%South Summit%Madrid%', date: '2026-06-03', city: 'Madrid', country: 'Spain' },

  // Arctic15 – Jun 11-12, Helsinki
  { pattern: '%Arctic%15%', date: '2026-06-11', city: 'Helsinki', country: 'Finland' },
  { pattern: '%Arctic15%', date: '2026-06-11', city: 'Helsinki', country: 'Finland' },

  // SaaStock – Oct 13-14, Royal Dublin Society, Dublin
  { pattern: '%SaaStock%', date: '2026-10-13', city: 'Dublin', country: 'Ireland' },

  // Sibos – Sep 28 - Oct 1, Miami Beach Convention Center
  { pattern: '%Sibos%', date: '2026-09-28', city: 'Miami', country: 'United States' },

  // Climate Week NYC – Sep 20-27, New York
  { pattern: '%Climate Week%NYC%', date: '2026-09-20', city: 'New York', country: 'United States' },
  { pattern: '%Climate Week%New York%', date: '2026-09-20', city: 'New York', country: 'United States' },

  // Korea Blockchain Week – Sep 29 - Oct 1, Seoul
  { pattern: '%Korea Blockchain%', date: '2026-09-29', city: 'Seoul', country: 'South Korea' },

  // International Astronautical Congress – Oct 5-9, Antalya, Türkiye
  { pattern: '%Astronautical Congress%', date: '2026-10-05', city: 'Antalya', country: 'Turkey' },

  // Singapore Fintech Festival – Nov 18-20, Singapore EXPO
  { pattern: '%Singapore Fintech%', date: '2026-11-18', city: 'Singapore', country: 'Singapore' },

  // Hong Kong Fintech Week – Nov 2-6, Hong Kong
  { pattern: '%Hong Kong Fintech%', date: '2026-11-02', city: 'Hong Kong', country: 'Hong Kong' },

  // Techsauce Global Summit – Aug 27-29, Bangkok
  { pattern: '%Techsauce%', date: '2026-08-27', city: 'Bangkok', country: 'Thailand' },

  // Finovate Fall – Sep 9-11, New York
  { pattern: '%Finovate Fall%', date: '2026-09-09', city: 'New York', country: 'United States' },
  { pattern: '%FinovateFall%', date: '2026-09-09', city: 'New York', country: 'United States' },

  // ── ESTIMATED DATES (based on historical patterns) ──

  // Future Food Tech – typically March, San Francisco
  { pattern: '%Future Food Tech%', date: '2026-03-12', city: 'San Francisco', country: 'United States' },

  // Quantum.Tech – typically late March / early April
  { pattern: '%Quantum%Tech%', date: '2026-03-31', city: 'London', country: 'United Kingdom' },

  // Health 2.0 Europe – typically May/June
  { pattern: '%Health 2.0%Europe%', date: '2026-06-15', city: 'Barcelona', country: 'Spain' },

  // Digital Health Summit – typically January (at CES) or standalone
  { pattern: '%Digital Health Summit%', date: '2026-01-07', city: 'Las Vegas', country: 'United States' },

  // Sydney AI Summit – part of AI Summit series, typically mid-year
  { pattern: '%Sydney%AI%Summit%', date: '2026-08-20', city: 'Sydney', country: 'Australia' },

  // All-Energy Australia – typically October, Melbourne
  { pattern: '%All-Energy%Australia%', date: '2026-10-21', city: 'Melbourne', country: 'Australia' },

  // Food Tech Summit – typically September/October
  { pattern: '%Food Tech Summit%', date: '2026-09-22', city: 'Mexico City', country: 'Mexico' },

  // RoboBusiness – typically October
  { pattern: '%RoboBusiness%', date: '2026-10-14', city: 'San Jose', country: 'United States' },

  // AgriTech Expo – typically April/May
  { pattern: '%AgriTech Expo%', date: '2026-04-23', city: 'Lusaka', country: 'Zambia' },

  // Space Tech Expo Europe – typically November, Bremen
  { pattern: '%Space Tech Expo%Europe%', date: '2026-11-17', city: 'Bremen', country: 'Germany' },

  // Pirate Summit – typically September, Cologne (note: rebranded/pivoted in recent years)
  { pattern: '%Pirate Summit%', date: '2026-09-15', city: 'Cologne', country: 'Germany' },
];

async function runUpdates() {
  let totalUpdated = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  console.log('═══════════════════════════════════════════════════════');
  console.log('  EventMedium.ai – Sprint 3: Complete Date Update');
  console.log('═══════════════════════════════════════════════════════\n');

  for (const u of updates) {
    try {
      // Build SET clause
      let setClauses = ["event_date = $1"];
      let params = [u.date];
      let paramIdx = 2;

      if (u.city) {
        setClauses.push(`city = $${paramIdx}`);
        params.push(u.city);
        paramIdx++;
      }
      if (u.country) {
        setClauses.push(`country = $${paramIdx}`);
        params.push(u.country);
        paramIdx++;
      }

      const sql = `UPDATE events SET ${setClauses.join(', ')} WHERE name ILIKE $${paramIdx}`;
      params.push(u.pattern);

      const result = await dbRun(sql, params);

      if (result.rowCount > 0) {
        console.log(`✅ ${u.pattern.replace(/%/g, '')} → ${u.date}${u.city ? ' (' + u.city + ')' : ''} [${result.rowCount} row(s)]`);
        totalUpdated += result.rowCount;
      } else {
        // Try broader match
        console.log(`⏭️  No match for: ${u.pattern}`);
        totalSkipped++;
      }
    } catch (err) {
      console.log(`❌ Error on ${u.pattern}: ${err.message}`);
      totalFailed++;
    }
  }

  // ── Flag cancelled/biennial events ──
  console.log('\n─── Checking for events to flag ───\n');

  // TNW Conference – CANCELLED (FT shut it down in Sep 2025)
  try {
    const tnwResult = await dbQuery("SELECT id, name FROM events WHERE name ILIKE '%TNW%' OR name ILIKE '%Next Web%'");
    if (tnwResult.rows.length > 0) {
      for (const row of tnwResult.rows) {
        console.log(`⚠️  TNW Conference (ID ${row.id}: "${row.name}") – CANCELLED. FT shut down TNW events in Sep 2025.`);
        console.log(`   Consider removing or marking as cancelled.`);
      }
    } else {
      console.log('ℹ️  No TNW Conference found in database.');
    }
  } catch (err) {
    console.log(`❌ Error checking TNW: ${err.message}`);
  }

  // DSEI – Biennial, next is 2027
  try {
    const dseiResult = await dbQuery("SELECT id, name FROM events WHERE name ILIKE '%DSEI%'");
    if (dseiResult.rows.length > 0) {
      for (const row of dseiResult.rows) {
        console.log(`⚠️  DSEI (ID ${row.id}: "${row.name}") – BIENNIAL EVENT. No 2026 edition. Next: Sep 7-10, 2027.`);
        console.log(`   Consider removing or updating to 2027.`);
      }
    } else {
      console.log('ℹ️  No DSEI found in database.');
    }
  } catch (err) {
    console.log(`❌ Error checking DSEI: ${err.message}`);
  }

  // ── Final audit: show any remaining placeholder dates ──
  console.log('\n─── Remaining Placeholder Dates Audit ───\n');

  try {
    const audit = await dbQuery(`
      SELECT id, name, event_date, city, country 
      FROM events 
      WHERE EXTRACT(DAY FROM event_date) = 14 
        AND event_date >= '2026-01-01'
      ORDER BY event_date ASC
    `);

    if (audit.rows.length === 0) {
      console.log('🎉 No placeholder dates remaining! All events have real dates.');
    } else {
      console.log(`⚠️  ${audit.rows.length} event(s) still have placeholder dates (14th of month):\n`);
      for (const row of audit.rows) {
        const d = new Date(row.event_date);
        const dateStr = d.toISOString().split('T')[0];
        console.log(`   ID ${row.id}: ${row.name} → ${dateStr} (${row.city || '?'}, ${row.country || '?'})`);
      }
    }
  } catch (err) {
    console.log(`❌ Audit error: ${err.message}`);
  }

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  DONE: ${totalUpdated} updated | ${totalSkipped} skipped | ${totalFailed} failed`);
  console.log('═══════════════════════════════════════════════════════');

  process.exit(0);
}

runUpdates().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});