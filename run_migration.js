require('dotenv').config();
const {dbRun} = require('./db');
const fs = require('fs');
const sql = fs.readFileSync('migration_inbox.sql', 'utf8');
const stmts = sql.split(';').filter(s => s.trim());
(async () => {
  for (const s of stmts) {
    if (s.trim()) {
      try { await dbRun(s); } catch(e) {
        if (e.message.indexOf('already exists') === -1) console.error(e.message);
      }
    }
  }
  console.log('Migration complete!');
  process.exit(0);
})();
