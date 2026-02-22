// update_dates.js — Run from project root: node update_dates.js
require('dotenv').config();
const { dbRun, dbAll } = require('./db');

const updates = [
  ['2026-01-06', '%CES%'],
  ['2026-01-06', '%Consumer Electronics Show%'],
  ['2026-03-02', '%MWC%'],
  ['2026-03-02', '%Mobile World Congress%'],
  ['2026-03-12', '%SXSW%'],
  ['2026-03-12', '%South by Southwest%'],
  ['2026-03-16', '%GTC%'],
  ['2026-03-16', '%GPU Technology%'],
  ['2026-05-19', '%Google I/O%'],
  ['2026-05-19', '%Google IO%'],
  ['2026-06-02', '%Computex%'],
  ['2026-06-03', '%Collision%'],
  ['2026-06-17', '%VivaTech%'],
  ['2026-06-17', '%Viva Tech%'],
  ['2026-10-13', '%TechCrunch%'],
  ['2026-10-13', '%Disrupt%'],
  ['2026-11-09', '%Web Summit%'],
  ['2026-12-07', '%GITEX%'],
];

// These two need compound WHERE clauses
const compound = [
  ['2026-04-29', '%TOKEN2049%', 'Dubai'],
  ['2026-10-07', '%TOKEN2049%', 'Singapore'],
];

(async () => {
  console.log('Updating event dates...\n');

  for (const [date, pattern] of updates) {
    await dbRun(
      'UPDATE events SET event_date = $1 WHERE name ILIKE $2',
      [date, pattern]
    );
  }

  for (const [date, pattern, city] of compound) {
    await dbRun(
      'UPDATE events SET event_date = $1 WHERE name ILIKE $2 AND city ILIKE $3',
      [date, pattern, '%' + city + '%']
    );
  }

  const rows = await dbAll(
    'SELECT id, name, city, event_date FROM events ORDER BY event_date ASC'
  );

  console.log('ID  | Date       | Event                          | City');
  console.log('----|------------|--------------------------------|--------');
  rows.forEach(r => {
    var d = r.event_date ? r.event_date.toISOString().slice(0, 10) : 'NULL';
    console.log(
      String(r.id).padEnd(4) + '| ' +
      d + ' | ' +
      (r.name || '').slice(0, 30).padEnd(31) + '| ' +
      (r.city || '')
    );
  });

  console.log('\n✅ Done —', rows.length, 'events total');
  process.exit(0);
})().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
