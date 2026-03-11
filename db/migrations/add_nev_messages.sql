CREATE TABLE IF NOT EXISTS nev_messages (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  context JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS nev_messages_user_id_idx ON nev_messages(user_id);
CREATE INDEX IF NOT EXISTS nev_messages_created_at_idx ON nev_messages(created_at);
