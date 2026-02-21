require('dotenv').config();
var fs = require('fs');
var path = require('path');
var { pool } = require('./index');

async function init() {
  console.log('Initializing database...');
  var schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(schema);
    console.log('Schema applied successfully.');
  } catch (err) {
    console.error('Schema error:', err.message);
    process.exit(1);
  }
  await pool.end();
  console.log('Done.');
}

init();
