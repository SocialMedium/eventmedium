-- Community Setup & Contact Onboarding — Schema Migration
-- These tables are also auto-created in server.js runMigrations()

CREATE TABLE IF NOT EXISTS community_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL,
  name VARCHAR(255), first_name VARCHAR(100), last_name VARCHAR(100),
  company_name VARCHAR(255), company_domain VARCHAR(255), company_reg_number VARCHAR(100),
  company_country VARCHAR(10), role_title VARCHAR(255), linkedin_url VARCHAR(500),
  stakeholder_type VARCHAR(50), canonical_themes TEXT[], geography VARCHAR(100),
  jurisdiction VARCHAR(10), source VARCHAR(50) NOT NULL DEFAULT 'manual',
  source_record_id VARCHAR(255), import_batch_id UUID,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','invited','joined','active','bounced','opted_out')),
  user_id INTEGER, invited_at TIMESTAMPTZ, joined_at TIMESTAMPTZ,
  enrichment_status VARCHAR(50) DEFAULT 'pending' CHECK (enrichment_status IN ('pending','running','complete','failed','insufficient_data')),
  enrichment_data JSONB, last_enriched_at TIMESTAMPTZ,
  shadow_canister_id VARCHAR(255), shadow_canister_built BOOLEAN DEFAULT FALSE,
  owner_notes TEXT, tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(community_id, email)
);

CREATE TABLE IF NOT EXISTS contact_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id VARCHAR(255) NOT NULL, source VARCHAR(50) NOT NULL,
  filename VARCHAR(255), total_rows INT DEFAULT 0, imported INT DEFAULT 0,
  skipped INT DEFAULT 0, failed INT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'processing' CHECK (status IN ('processing','complete','failed')),
  error_detail TEXT, created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS contact_field_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id VARCHAR(255) NOT NULL, source VARCHAR(50) NOT NULL,
  mappings JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(community_id, source)
);

CREATE TABLE IF NOT EXISTS contact_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL, community_id VARCHAR(255) NOT NULL,
  invite_token VARCHAR(255) UNIQUE NOT NULL, nev_message TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(), opened_at TIMESTAMPTZ, clicked_at TIMESTAMPTZ,
  status VARCHAR(50) DEFAULT 'sent' CHECK (status IN ('sent','opened','clicked','joined','bounced','expired'))
);

CREATE INDEX IF NOT EXISTS idx_contacts_community ON community_contacts(community_id, status);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON community_contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_company_domain ON community_contacts(company_domain, jurisdiction);
CREATE INDEX IF NOT EXISTS idx_contacts_shadow ON community_contacts(shadow_canister_built, enrichment_status);
CREATE INDEX IF NOT EXISTS idx_import_batches_community ON contact_import_batches(community_id, created_at);
CREATE INDEX IF NOT EXISTS idx_invites_token ON contact_invites(invite_token);
CREATE INDEX IF NOT EXISTS idx_invites_contact ON contact_invites(contact_id, status);
