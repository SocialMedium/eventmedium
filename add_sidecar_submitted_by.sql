-- Add submitted_by column to sidecar_events
ALTER TABLE sidecar_events ADD COLUMN IF NOT EXISTS submitted_by INTEGER REFERENCES users(id);
