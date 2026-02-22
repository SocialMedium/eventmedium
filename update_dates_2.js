// update_dates_2.js — Run from project root: node update_dates_2.js
// Updates all remaining placeholder dates with verified 2026 dates.
// Also corrects 3 wrong locations: Consensus→Miami, ICML→Seoul, NeurIPS→Sydney.
require('dotenv').config();
const { dbRun, dbAll } = require('./db');

// [date, namePattern] — date is start day of the event
const dateUpdates = [
  // JANUARY
  ['2026-01-13', '%World Future Energy%'],
  ['2026-01-13', '%WFES%'],
  ['2026-01-26', '%CyberTech%'],

  // FEBRUARY
  ['2026-02-10', '%Finovate Europe%'],
  ['2026-02-10', '%FinovateEurope%'],
  ['2026-02-12', '%World AI Cannes%'],
  ['2026-02-12', '%WAICF%'],

  // MARCH
  ['2026-03-09', '%MIPIM%'],
  ['2026-03-23', '%RSA Conference%'],
  ['2026-03-23', '%RSAC%'],
  ['2026-03-24', '%LogiMAT%'],

  // APRIL
  ['2026-04-15', '%Paris Blockchain%'],

  // MAY
  ['2026-05-05', '%Consensus%'],
  ['2026-05-12', '%SaaStr%'],
  ['2026-05-21', '%Latitude59%'],
  ['2026-05-21', '%Latitude 59%'],

  // JUNE
  ['2026-06-02', '%Money20/20 Europe%'],
  ['2026-06-02', '%Money2020 Europe%'],

  // JULY
  ['2026-07-06', '%ICML%'],
  ['2026-07-06', '%International Conference on Machine Learning%'],

  // AUGUST
  ['2026-08-01', '%Black Hat%'],

  // SEPTEMBER
  ['2026-09-15', '%Dreamforce%'],

  // OCTOBER
  ['2026-10-18', '%Money20/20 USA%'],
  ['2026-10-18', '%Money2020 USA%'],

  // NOVEMBER
  ['2026-11-15', '%HLTH%'],
  ['2026-11-18', '%Slush%'],

  // DECEMBER
  ['2026-12-06', '%NeurIPS%'],
  ['2026-12-06', '%Neural Information%'],
];

// Location corrections (city field): [newCity, namePattern]
const locationFixes = [
  ['Miami', '%Consensus%'],       // Was Austin — moved to Miami Beach Convention Center
  ['Seoul', '%ICML%'],            // Was Vienna — ICML 2026 is at COEX, Seoul
  ['Sydney', '%NeurIPS%'],        // Was Vancouver — NeurIPS 2026 is in Sydney, Australia
];

// Money20/20 variants: need to distinguish Europe vs USA by existing city
const moneyUpdates = [
  ['2026-06-02', '%Money20%20%', 'Amsterdam'],
  ['2026-06-02', '%Money 20%20%', 'Amsterdam'],
  ['2026-10-18', '%Money20%20%', 'Las Vegas'],
  ['2026-10-18', '%Money 20%20%', 'Las Vegas'],
];

(async () => {
  console.log('=== update_dates_2.js ===\n');
  let updated = 0;

  // 1. Simple date updates (match by name)
  for (const [date, pattern] of dateUpdates) {
    const res = await dbRun(
      'UPDATE events SET event_date = $1 WHERE name ILIKE $2',
      [date, pattern]
    );
    if (res && res.rowCount > 0) {
      console.log(`✓ ${pattern.replace(/%/g, '')} → ${date} (${res.rowCount} row(s))`);
      updated += res.rowCount;
    }
  }

  // 2. Money20/20 by city (to avoid EU/US confusion)
  for (const [date, pattern, city] of moneyUpdates) {
    const res = await dbRun(
      'UPDATE events SET event_date = $1 WHERE name ILIKE $2 AND city ILIKE $3',
      [date, pattern, '%' + city + '%']
    );
    if (res && res.rowCount > 0) {
      console.log(`✓ ${pattern.replace(/%/g, '')} (${city}) → ${date} (${res.rowCount} row(s))`);
      updated += res.rowCount;
    }
  }

  // 3. Location corrections
  for (const [newCity, pattern] of locationFixes) {
    const res = await dbRun(
      'UPDATE events SET city = $1 WHERE name ILIKE $2',
      [newCity, pattern]
    );
    if (res && res.rowCount > 0) {
      console.log(`✓ ${pattern.replace(/%/g, '')} city → ${newCity} (${res.rowCount} row(s))`);
    }
  }

  // 4. Print full event list
  const rows = await dbAll(
    'SELECT id, name, city, event_date FROM events ORDER BY event_date ASC'
  );

  console.log('\n--- ALL EVENTS ---');
  console.log('ID  | Date       | Event                          | City');
  console.log('----|------------|--------------------------------|--------');
  let placeholders = 0;
  rows.forEach(r => {
    const d = r.event_date ? r.event_date.toISOString().slice(0, 10) : 'NULL';
    const isPlaceholder = d.endsWith('-14') || d.endsWith('-13'); // 14th of month = placeholder
    if (isPlaceholder) placeholders++;
    const marker = isPlaceholder ? ' ⚠️' : '';
    console.log(
      String(r.id).padEnd(4) + '| ' +
      d + ' | ' +
      (r.name || '').slice(0, 30).padEnd(31) + '| ' +
      (r.city || '') + marker
    );
  });

  console.log(`\n✅ Updated ${updated} rows.`);
  console.log(`⚠️  ${placeholders} events may still have placeholder dates (14th or 13th of month).`);
  console.log(`📊 ${rows.length} events total.`);
  process.exit(0);
})().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});