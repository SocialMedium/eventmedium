require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

var fs = require('fs');
var path = require('path');
var pg = require('pg');

async function run() {
  var dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('DATABASE_URL not set'); process.exit(1); }

  var pool = new pg.Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('railway') ? { rejectUnauthorized: false } : false
  });

  try {
    var sql = fs.readFileSync(path.join(__dirname, '001_community_intelligence.sql'), 'utf8');
    var statements = sql.split(';').map(function(s) { return s.trim(); }).filter(Boolean);

    for (var i = 0; i < statements.length; i++) {
      var stmt = statements[i];
      var match = stmt.match(/(?:CREATE TABLE|CREATE INDEX).*?(?:IF NOT EXISTS\s+)?(\w+)/i);
      var label = match ? match[1] : 'statement_' + (i + 1);
      try {
        await pool.query(stmt);
        console.log('[ok] ' + label);
      } catch (err) {
        console.error('[fail] ' + label + ':', err.message);
      }
    }

    console.log('\n[migration] Community intelligence tables ready');
  } catch (err) {
    console.error('[migration] Fatal:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
