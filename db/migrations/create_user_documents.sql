-- Document ingestion: user_documents table + provenance tracking

CREATE TABLE IF NOT EXISTS user_documents (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename            TEXT,
  file_type           TEXT NOT NULL,
  document_type       TEXT,
  raw_text_length     INTEGER,
  canister_fields_set JSONB DEFAULT '[]',
  signal_ids          JSONB DEFAULT '[]',
  qdrant_point_ids    JSONB DEFAULT '[]',
  status              TEXT DEFAULT 'active' CHECK (status IN ('active','deleted')),
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_documents_user ON user_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_user_documents_status ON user_documents(user_id, status);

-- Provenance column on stakeholder_profiles
ALTER TABLE stakeholder_profiles
  ADD COLUMN IF NOT EXISTS field_provenance JSONB DEFAULT '{}';

-- Extra columns on unified_signals for document-sourced signals
ALTER TABLE unified_signals
  ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS document_id INTEGER,
  ADD COLUMN IF NOT EXISTS sub_type TEXT,
  ADD COLUMN IF NOT EXISTS urgency TEXT DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'public';

CREATE INDEX IF NOT EXISTS idx_unified_signals_user ON unified_signals(user_id);
CREATE INDEX IF NOT EXISTS idx_unified_signals_doc ON unified_signals(document_id);
