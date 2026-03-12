CREATE TABLE IF NOT EXISTS abuse_flags (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flag_type   TEXT NOT NULL,
  reason      TEXT,
  score       INTEGER DEFAULT 0,
  reviewed    BOOLEAN DEFAULT false,
  reviewed_by INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abuse_flags_user ON abuse_flags(user_id);
CREATE INDEX IF NOT EXISTS idx_abuse_flags_recent ON abuse_flags(created_at DESC);
