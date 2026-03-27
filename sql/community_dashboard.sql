-- Community Intelligence Dashboard — Schema Migration
-- Run with: psql $DATABASE_URL -f sql/community_dashboard.sql
-- Verify enums first: SELECT enum_range(NULL::signal_type)

-- ══════════════════════════════════════════════════════
-- Community tenant registry
-- ══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS community_tenants (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id             VARCHAR(255) UNIQUE NOT NULL,
  name                     VARCHAR(255) NOT NULL,
  community_type           VARCHAR(100),
  -- alumni_network | industry_association | research_institution
  -- startup_ecosystem | private_club | corporate_network | event_community
  region                   VARCHAR(100),
  primary_themes           TEXT[],
  api_key_hash             VARCHAR(255) NOT NULL,
  active_canister_count    INT DEFAULT 0,
  write_enrichment_enabled BOOLEAN DEFAULT FALSE,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════
-- Anonymised aggregate signals only
-- No individual identity may ever be stored here
-- ══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS community_signals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id   VARCHAR(255) NOT NULL,
  signal_type    VARCHAR(100) NOT NULL,
  region         VARCHAR(100),
  theme_tags     TEXT[],
  member_count   INT DEFAULT 1,
  metadata       JSONB,
  aggregate_only BOOLEAN NOT NULL DEFAULT TRUE,
  received_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT aggregate_only_enforced CHECK (aggregate_only = TRUE),
  CONSTRAINT k_anonymity_floor CHECK (member_count >= 5)
);

-- ══════════════════════════════════════════════════════
-- Connected feed/integration registry
-- ══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS community_integrations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id          VARCHAR(255) NOT NULL,
  provider              VARCHAR(100) NOT NULL,
  category              VARCHAR(50) NOT NULL
    CHECK (category IN ('owner_controlled', 'public')),
  credentials           JSONB,
  last_synced_at        TIMESTAMPTZ,
  sync_status           VARCHAR(50) DEFAULT 'pending',
  signal_types_produced TEXT[],
  enabled               BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════
-- Cached pulse outputs — aggregate only
-- ══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pulse_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  VARCHAR(255) NOT NULL,
  filter_hash   VARCHAR(64) NOT NULL,
  payload       JSONB NOT NULL,
  generated_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  UNIQUE(community_id, filter_hash)
);

-- ══════════════════════════════════════════════════════
-- Community owner match triggers
-- Owner surfaces a connection opportunity; members decide independently
-- Member IDs NOT stored here — double-blind flow in event_matches
-- ══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS community_match_triggers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id     VARCHAR(255) NOT NULL,
  triggered_by     UUID NOT NULL REFERENCES users(id),
  signal_basis     TEXT[],
  signal_rationale TEXT,
  theme_context    VARCHAR(100),
  status           VARCHAR(50) DEFAULT 'pending',
  -- pending | notified | accepted_both | declined_one | declined_both
  notified_at      TIMESTAMPTZ,
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════
-- Enrichment write-back log — ops-activated only
-- ══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS enrichment_writebacks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id       VARCHAR(255) NOT NULL,
  provider           VARCHAR(100) NOT NULL,
  entity_type        VARCHAR(50) NOT NULL
    CHECK (entity_type IN ('person', 'company', 'event')),
  external_entity_id VARCHAR(255) NOT NULL,
  payload            JSONB NOT NULL,
  status             VARCHAR(50) DEFAULT 'pending',
  written_at         TIMESTAMPTZ
);

-- ══════════════════════════════════════════════════════
-- Indexes
-- ══════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_community_signals_community
  ON community_signals(community_id, received_at);
CREATE INDEX IF NOT EXISTS idx_community_integrations_community
  ON community_integrations(community_id, provider);
CREATE INDEX IF NOT EXISTS idx_pulse_cache_lookup
  ON pulse_cache(community_id, filter_hash, expires_at);
CREATE INDEX IF NOT EXISTS idx_match_triggers_community
  ON community_match_triggers(community_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_enrichment_writebacks_community
  ON enrichment_writebacks(community_id, entity_type, status);
