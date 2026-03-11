ALTER TABLE event_matches
  ADD COLUMN IF NOT EXISTS score_intent_offering NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS score_geography NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS score_urgency NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS score_canister_richness NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS score_feedback_adjustment NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS scoring_tier INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS community_id INTEGER,
  ADD COLUMN IF NOT EXISTS match_mode TEXT DEFAULT 'event';
