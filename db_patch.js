// ══════════════════════════════════════════════════════
// db.js — PATCH: Add dbGet and dbAll
// ══════════════════════════════════════════════════════
//
// matches.js (and inbox routes) require three exports:
//   dbRun  — already exists (returns { rows, rowCount })
//   dbGet  — SELECT single row (returns row or null)
//   dbAll  — SELECT multiple rows (returns array)
//
// Add these to your existing db.js, using your existing pool/client:

async function dbGet(sql, params) {
  const result = await dbRun(sql, params);
  return result.rows && result.rows.length > 0 ? result.rows[0] : null;
}

async function dbAll(sql, params) {
  const result = await dbRun(sql, params);
  return result.rows || [];
}

// Then update your module.exports:
// module.exports = { dbRun, dbGet, dbAll };
