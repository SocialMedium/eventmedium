-- Outcome Logging Tables
-- Records what happened after signals, matches, and Nev sessions.
-- Foundation for model fine-tuning and proprietary scoring improvements.

CREATE TABLE IF NOT EXISTS signal_outcome_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id     VARCHAR(255),
  signal_type      VARCHAR(100) NOT NULL,
  source_type      VARCHAR(100),
  provider         VARCHAR(100),
  cost_of_signal   VARCHAR(50),
  canonical_theme  VARCHAR(100),
  jurisdiction     VARCHAR(10),
  action_taken     VARCHAR(100),
  action_taken_at  TIMESTAMPTZ,
  outcome          VARCHAR(100),
  outcome_lag_days INT,
  outcome_detail   TEXT,
  metadata         JSONB,
  logged_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match_outcome_log (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id                 INT,
  community_id             VARCHAR(255),
  event_id                 INT,
  source                   VARCHAR(50) DEFAULT 'event',
  score_total              FLOAT,
  score_theme              FLOAT,
  score_intent             FLOAT,
  score_stakeholder        FLOAT,
  score_capital            FLOAT,
  score_signal_convergence FLOAT,
  stakeholder_a            VARCHAR(50),
  stakeholder_b            VARCHAR(50),
  themes_a                 TEXT[],
  themes_b                 TEXT[],
  both_accepted            BOOLEAN,
  meeting_occurred         BOOLEAN,
  meeting_quality          INT,
  outcome_type             VARCHAR(100),
  signal_context           JSONB,
  logged_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nev_outcome_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_type     VARCHAR(50) NOT NULL,
  community_id     VARCHAR(255),
  stakeholder_type VARCHAR(50),
  turn_count       INT,
  session_duration_seconds INT,
  outcome          VARCHAR(100),
  outcome_detail   JSONB,
  logged_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_outcome_community ON signal_outcome_log(community_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_signal_outcome_type ON signal_outcome_log(signal_type, cost_of_signal, outcome);
CREATE INDEX IF NOT EXISTS idx_match_outcome_community ON match_outcome_log(community_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_match_outcome_scores ON match_outcome_log(score_total, both_accepted, meeting_occurred);
CREATE INDEX IF NOT EXISTS idx_nev_outcome_session ON nev_outcome_log(session_type, outcome, logged_at);
