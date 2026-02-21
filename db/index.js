var pg = require('pg');

var pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', function(err) {
  console.error('Unexpected pool error:', err);
});

// Run a query, return all rows
async function dbAll(text, params) {
  var result = await pool.query(text, params);
  return result.rows;
}

// Run a query, return first row or null
async function dbGet(text, params) {
  var result = await pool.query(text, params);
  return result.rows[0] || null;
}

// Run a query (INSERT/UPDATE/DELETE), return result
async function dbRun(text, params) {
  var result = await pool.query(text, params);
  return result;
}

module.exports = { pool, dbAll, dbGet, dbRun };
