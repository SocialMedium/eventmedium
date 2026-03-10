-- ══════════════════════════════════════════════════════
-- EventMedium.ai — Event Harvest Migration
-- Run: psql $DATABASE_URL -f db/migration_harvest.sql
-- ══════════════════════════════════════════════════════

ALTER TABLE events ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_events_needs_review ON events(needs_review);
