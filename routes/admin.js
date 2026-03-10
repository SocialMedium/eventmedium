
// One-time migration route - DELETE AFTER USE
router.post('/run-migration', authenticateToken, async function(req, res) {
  if (req.user.id !== 2) return res.status(403).json({ error: 'Forbidden' });
  try {
    await dbRun(`ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id)`);
    await dbRun(`ALTER TABLE events ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP`);
    await dbRun(`ALTER TABLE events ADD COLUMN IF NOT EXISTS claim_verified BOOLEAN DEFAULT false`);
    await dbRun(`ALTER TABLE events ADD COLUMN IF NOT EXISTS claim_pending BOOLEAN DEFAULT false`);
    await dbRun(`ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_website TEXT`);
    await dbRun(`ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_email TEXT`);
    await dbRun(`ALTER TABLE events ADD COLUMN IF NOT EXISTS is_flagship BOOLEAN DEFAULT false`);
    await dbRun(`ALTER TABLE events ADD COLUMN IF NOT EXISTS claim_token TEXT`);
    await dbRun(`ALTER TABLE events ADD COLUMN IF NOT EXISTS claim_token_expires TIMESTAMP`);
    await dbRun(`ALTER TABLE events ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT false`);
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});
