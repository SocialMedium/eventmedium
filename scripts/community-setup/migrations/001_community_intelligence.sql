-- Community Intelligence tables for setup workflow + swarm testing

CREATE TABLE IF NOT EXISTS community_taxonomies (
  id SERIAL PRIMARY KEY,
  community_id INTEGER REFERENCES communities(id),
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  sector_distribution JSONB,
  theme_distribution JSONB,
  stakeholder_distribution JSONB,
  career_stage_distribution JSONB,
  geography_clusters JSONB,
  values_language JSONB,
  signal_sources JSONB,
  raw_ingestion_summary TEXT,
  matching_weights JSONB,
  calibration_run_at TIMESTAMPTZ,
  calibration_notes TEXT
);

CREATE TABLE IF NOT EXISTS community_test_runs (
  id SERIAL PRIMARY KEY,
  community_id INTEGER REFERENCES communities(id),
  test_cohort_label VARCHAR(100),
  run_at TIMESTAMPTZ DEFAULT NOW(),
  profile_count INTEGER,
  match_count INTEGER,
  avg_match_score FLOAT,
  strong_match_pct FLOAT,
  moderate_match_pct FLOAT,
  thin_match_pct FLOAT,
  evaluator_score FLOAT,
  weight_recommendations JSONB,
  evaluation_report TEXT,
  status VARCHAR(50) DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS synthetic_test_users (
  id SERIAL PRIMARY KEY,
  test_run_id INTEGER REFERENCES community_test_runs(id),
  fake_user_id INTEGER,
  persona_brief TEXT,
  career_stage VARCHAR(50),
  canister_completeness FLOAT,
  is_event_subset BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_community_taxonomies_community ON community_taxonomies(community_id);
CREATE INDEX IF NOT EXISTS idx_community_test_runs_community ON community_test_runs(community_id);
CREATE INDEX IF NOT EXISTS idx_synthetic_test_users_run ON synthetic_test_users(test_run_id);
