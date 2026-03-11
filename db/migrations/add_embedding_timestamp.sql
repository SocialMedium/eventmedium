ALTER TABLE stakeholder_profiles
  ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qdrant_vector_id TEXT;
