-- ══════════════════════════════════════════════════════
-- EventMedium.ai — Event Claiming System Migration
-- Run: psql $DATABASE_URL -f db/migration_claim.sql
-- ══════════════════════════════════════════════════════

ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP;
ALTER TABLE events ADD COLUMN IF NOT EXISTS claim_verified BOOLEAN DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS claim_pending BOOLEAN DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_website TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_flagship BOOLEAN DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS claim_token TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS claim_token_expires TIMESTAMP;

-- Mark large events as flagship (top-tier events requiring manual approval)
UPDATE events SET is_flagship = true WHERE expected_attendees::text ~ '^\d+$' AND expected_attendees::integer > 5000;

CREATE INDEX IF NOT EXISTS idx_events_claim_token ON events(claim_token);
CREATE INDEX IF NOT EXISTS idx_events_owner ON events(owner_user_id);
