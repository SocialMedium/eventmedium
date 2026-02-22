-- ══════════════════════════════════════════════════════
-- EventMedium.ai — Inbox & Feedback Loop Migration
-- Run: psql $DATABASE_URL -f migration_inbox.sql
-- ══════════════════════════════════════════════════════

-- 1. Context notes (inline messages between matched users)
ALTER TABLE event_matches ADD COLUMN IF NOT EXISTS user_a_context TEXT;
ALTER TABLE event_matches ADD COLUMN IF NOT EXISTS user_b_context TEXT;

-- 2. Ensure revealed_at exists (used as mutual_at in inbox)
ALTER TABLE event_matches ADD COLUMN IF NOT EXISTS revealed_at TIMESTAMPTZ;

-- 3. Match feedback table — post-meeting quality signals
CREATE TABLE IF NOT EXISTS match_feedback (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES event_matches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Quick feedback (from inbox buttons)
  rating VARCHAR(30),  -- 'valuable', 'not_relevant', 'didnt_connect'

  -- Post-meeting structured feedback
  did_meet BOOLEAN,
  meeting_quality INTEGER CHECK (meeting_quality BETWEEN 1 AND 5),
  would_meet_again BOOLEAN,
  outcome_type VARCHAR(50),  -- 'deal_progress', 'collaboration', 'referral', 'social', 'none'
  outcome_notes TEXT,

  -- What made it work / not work (for tuning)
  relevance_score INTEGER CHECK (relevance_score BETWEEN 1 AND 5),
  theme_accuracy BOOLEAN,         -- were the shared themes actually relevant?
  intent_accuracy BOOLEAN,        -- did wants/offers actually align?
  stakeholder_fit_accuracy BOOLEAN, -- was the archetype pairing useful?
  what_worked TEXT,
  what_didnt TEXT,

  -- Nev debrief chat (stored as conversation)
  nev_chat_started BOOLEAN DEFAULT false,
  nev_chat_completed BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(match_id, user_id)
);

-- 4. Nev debrief chat messages
CREATE TABLE IF NOT EXISTS nev_debrief_messages (
  id SERIAL PRIMARY KEY,
  match_feedback_id INTEGER NOT NULL REFERENCES match_feedback(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'nev', 'system')),
  content TEXT NOT NULL,
  metadata JSONB,  -- extracted signals, sentiment, entities
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Extracted insights from Nev debriefs (feeds back into matching)
CREATE TABLE IF NOT EXISTS feedback_insights (
  id SERIAL PRIMARY KEY,
  match_feedback_id INTEGER NOT NULL REFERENCES match_feedback(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  insight_type VARCHAR(50) NOT NULL,
  -- Types: 'theme_correction', 'intent_update', 'archetype_signal',
  --        'meeting_preference', 'anti_pattern', 'enrichment'
  insight_key VARCHAR(100),
  insight_value TEXT,
  confidence REAL DEFAULT 0.5,
  applied BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Ensure match_outcomes exists
CREATE TABLE IF NOT EXISTS match_outcomes (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES event_matches(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(match_id)
);

-- 7. Indexes
CREATE INDEX IF NOT EXISTS idx_match_feedback_match ON match_feedback(match_id);
CREATE INDEX IF NOT EXISTS idx_match_feedback_user ON match_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_nev_debrief_feedback ON nev_debrief_messages(match_feedback_id);
CREATE INDEX IF NOT EXISTS idx_feedback_insights_user ON feedback_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_insights_type ON feedback_insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_event_matches_status ON event_matches(status);
CREATE INDEX IF NOT EXISTS idx_event_matches_revealed ON event_matches(revealed_at);
