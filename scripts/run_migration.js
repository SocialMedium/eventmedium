#!/usr/bin/env node
// One-off migration runner for community_dashboard.sql
var fs = require('fs');
var path = require('path');
var { pool } = require('../db');

async function run() {
  var sqlPath = path.join(__dirname, '..', 'sql', 'community_dashboard.sql');
  var sql = fs.readFileSync(sqlPath, 'utf8');

  // Split by semicolons, filter out comments-only blocks
  var statements = sql.split(';')
    .map(function(s) { return s.trim(); })
    .filter(function(s) {
      // Remove empty or comment-only statements
      var lines = s.split('\n').filter(function(l) { return l.trim() && !l.trim().startsWith('--'); });
      return lines.length > 0;
    });

  console.log('Running', statements.length, 'statements...\n');

  for (var i = 0; i < statements.length; i++) {
    var stmt = statements[i];
    var preview = stmt.split('\n').filter(function(l) { return l.trim() && !l.trim().startsWith('--'); })[0] || '';
    try {
      await pool.query(stmt);
      console.log('✓', (i + 1) + '/' + statements.length, preview.substring(0, 80));
    } catch (err) {
      console.error('✗', (i + 1) + '/' + statements.length, preview.substring(0, 80));
      console.error('  Error:', err.message);
    }
  }

  // Verify tables created
  console.log('\n── Verifying tables ──');
  var result = await pool.query("SELECT tablename FROM pg_tables WHERE tablename LIKE 'community_%' OR tablename IN ('pulse_cache', 'enrichment_writebacks') ORDER BY tablename");
  result.rows.forEach(function(r) { console.log('  ✓', r.tablename); });

  await pool.end();
  console.log('\nDone.');
}

run().catch(function(err) { console.error('Fatal:', err); process.exit(1); });
