-- EMC² (EventMedium Community Credit) System
-- Hash-chained credit ledger with web2 wallet, designed to bridge to web3 tokenisation

-- Action type enum
CREATE TYPE emc2_action AS ENUM (
  'canister_complete',
  'canister_quality_bonus',
  'community_join',
  'event_attend',
  'match_accepted',
  'match_confirmed',
  'match_debrief',
  'referral_complete',
  'global_access_unlock',
  'network_query_spend',
  'founding_member_grant',
  'community_owner_award',
  'community_multiplier_bonus',
  'admin_adjustment'
);

-- Immutable hash-chained ledger
CREATE TABLE emc2_ledger (
  id                SERIAL PRIMARY KEY,
  tx_id             UUID DEFAULT gen_random_uuid() NOT NULL UNIQUE,
  user_id           INTEGER REFERENCES users(id) NOT NULL,
  wallet_address    VARCHAR(255),
  amount            INTEGER NOT NULL,
  action_type       emc2_action NOT NULL,
  entity_id         INTEGER,
  entity_type       VARCHAR(50),
  balance_after     INTEGER NOT NULL,
  metadata          JSONB DEFAULT '{}',
  prev_tx_hash      VARCHAR(64),
  tx_hash           VARCHAR(64) UNIQUE,
  anchored_at       TIMESTAMP,
  anchor_tx_hash    VARCHAR(64),
  created_at        TIMESTAMP DEFAULT NOW(),
  CONSTRAINT no_zero_amount CHECK (amount != 0)
);

-- Wallet registry (chain-agnostic)
CREATE TABLE emc2_wallets (
  id                        SERIAL PRIMARY KEY,
  user_id                   INTEGER REFERENCES users(id) UNIQUE,
  wallet_address            VARCHAR(255),
  chain_id                  VARCHAR(50),
  connected_at              TIMESTAMP,
  verified                  BOOLEAN DEFAULT FALSE,
  founding_member           BOOLEAN DEFAULT FALSE,
  founding_member_granted_at TIMESTAMP,
  created_at                TIMESTAMP DEFAULT NOW()
);

-- Community owner EMC² pools and multipliers
CREATE TABLE community_emc2_config (
  id                  SERIAL PRIMARY KEY,
  community_id        INTEGER REFERENCES communities(id) UNIQUE,
  owner_award_pool    INTEGER DEFAULT 0,
  multiplier_active   BOOLEAN DEFAULT FALSE,
  multiplier_value    NUMERIC(3,1) DEFAULT 1.0,
  multiplier_action   emc2_action,
  multiplier_starts   TIMESTAMP,
  multiplier_ends     TIMESTAMP,
  founding_threshold  INTEGER DEFAULT 50,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);

-- Network milestone tracking (for cascade awards)
CREATE TABLE network_milestones (
  id                  SERIAL PRIMARY KEY,
  milestone           INTEGER NOT NULL UNIQUE,
  reached_at          TIMESTAMP,
  canister_count      INTEGER,
  cascade_processed   BOOLEAN DEFAULT FALSE
);

INSERT INTO network_milestones (milestone)
VALUES (1000),(10000),(100000),(1000000),(10000000)
ON CONFLICT (milestone) DO NOTHING;

-- Add EMC² fields to stakeholder_profiles
ALTER TABLE stakeholder_profiles
ADD COLUMN IF NOT EXISTS emc2_balance INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS emc2_lifetime_earned INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS global_access_active BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS founding_member BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS founding_member_granted_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS emc2_cohort VARCHAR(20),
ADD COLUMN IF NOT EXISTS emc2_cohort_number INTEGER,
ADD COLUMN IF NOT EXISTS emc2_earn_multiplier NUMERIC(3,1) DEFAULT 1.0;

-- Indexes for performance
CREATE INDEX idx_emc2_ledger_user_id ON emc2_ledger(user_id);
CREATE INDEX idx_emc2_ledger_created_at ON emc2_ledger(created_at);
CREATE INDEX idx_emc2_ledger_action_type ON emc2_ledger(action_type);
