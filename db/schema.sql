-- ══════════════════════════════════════════════════════
-- Event Medium — PostgreSQL Schema
-- Converted from SQLite. All tables use IF NOT EXISTS.
-- JSONB instead of TEXT for structured data.
-- ══════════════════════════════════════════════════════

-- ── CORE TABLES ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    company TEXT,
    avatar_url TEXT,
    auth_provider TEXT DEFAULT 'email',
    email_verified BOOLEAN DEFAULT FALSE,
    linkedin_id TEXT,
    google_id TEXT,
    role TEXT DEFAULT 'user',
    tier TEXT DEFAULT 'free',
    platform_links JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ── STAKEHOLDER PROFILES (CANISTERS) ────────────────

CREATE TABLE IF NOT EXISTS stakeholder_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stakeholder_type TEXT,
    themes JSONB DEFAULT '[]',
    focus_text TEXT,
    intent JSONB DEFAULT '[]',
    offering JSONB DEFAULT '[]',
    context TEXT,
    deal_details JSONB DEFAULT '{}',
    geography TEXT,
    signal_strength INTEGER DEFAULT 0,
    qdrant_vector_id TEXT,
    onboarding_method TEXT DEFAULT 'chat',
    canister_version INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_intents (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    intent_types JSONB DEFAULT '[]',
    themes JSONB DEFAULT '[]',
    geography TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ── EVENTS ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    event_date DATE NOT NULL,
    city TEXT,
    country TEXT,
    event_type TEXT CHECK(event_type IN ('conference', 'meetup', 'virtual')),
    themes JSONB DEFAULT '[]',
    slug TEXT UNIQUE,
    source_url TEXT,
    expected_attendees TEXT,
    start_at TIMESTAMP,
    end_at TIMESTAMP,
    timezone TEXT,
    venue_type TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(name, event_date, city, country)
);

CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug);

CREATE TABLE IF NOT EXISTS event_registrations (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stakeholder_type TEXT,
    themes JSONB DEFAULT '[]',
    status TEXT DEFAULT 'active',
    registered_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_reg_event ON event_registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_event_reg_user ON event_registrations(user_id);

-- ── MATCHING ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_matches (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score_total REAL,
    score_semantic REAL,
    score_theme REAL,
    score_intent REAL,
    score_stakeholder REAL,
    score_capital REAL,
    score_signal_convergence REAL,
    score_timing REAL,
    score_constraint_complementarity REAL,
    match_reason TEXT,
    match_reasons JSONB DEFAULT '[]',
    signal_context JSONB DEFAULT '{}',
    status TEXT DEFAULT 'pending',
    user_a_decision TEXT,
    user_b_decision TEXT,
    revealed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(event_id, user_a_id, user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_matches_event ON event_matches(event_id);
CREATE INDEX IF NOT EXISTS idx_matches_user_a ON event_matches(user_a_id);
CREATE INDEX IF NOT EXISTS idx_matches_user_b ON event_matches(user_b_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON event_matches(status);

-- ── MESSAGING ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    match_id INTEGER NOT NULL REFERENCES event_matches(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    message_type TEXT DEFAULT 'text',
    metadata JSONB,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread ON messages(receiver_id, read_at);

-- ── NOTIFICATIONS ────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    link TEXT,
    metadata JSONB,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at);

-- ── SIGNAL INTELLIGENCE ──────────────────────────────

CREATE TABLE IF NOT EXISTS unified_signals (
    id SERIAL PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_id TEXT,
    source_table TEXT,
    source_url TEXT,
    entity_type TEXT,
    entity_name TEXT,
    entity_id TEXT,
    entities_json JSONB DEFAULT '[]',
    theme TEXT,
    themes_json JSONB DEFAULT '[]',
    theme_confidence REAL DEFAULT 0.0,
    signal_type TEXT,
    signal_text TEXT,
    signal_summary TEXT,
    sentiment TEXT,
    sentiment_score REAL,
    geography TEXT,
    country TEXT,
    city TEXT,
    cost_of_signal TEXT DEFAULT 'low',
    constraint_level TEXT DEFAULT 'low',
    independence_score REAL DEFAULT 0.5,
    is_derivative BOOLEAN DEFAULT FALSE,
    base_weight REAL DEFAULT 1.0,
    source_weight REAL DEFAULT 1.0,
    recency_weight REAL DEFAULT 1.0,
    final_weight REAL DEFAULT 1.0,
    dollar_amount REAL,
    dollar_unit TEXT,
    lifecycle_stage TEXT DEFAULT 'unknown',
    signal_date DATE,
    ingested_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP,
    cluster_id INTEGER,
    cluster_assigned_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_signals_source_type ON unified_signals(source_type);
CREATE INDEX IF NOT EXISTS idx_signals_theme ON unified_signals(theme);
CREATE INDEX IF NOT EXISTS idx_signals_entity ON unified_signals(entity_name);
CREATE INDEX IF NOT EXISTS idx_signals_date ON unified_signals(signal_date);
CREATE INDEX IF NOT EXISTS idx_signals_lifecycle ON unified_signals(lifecycle_stage);

CREATE TABLE IF NOT EXISTS signal_clusters (
    id SERIAL PRIMARY KEY,
    theme TEXT,
    entity_name TEXT,
    signal_count INTEGER DEFAULT 0,
    convergence_score REAL DEFAULT 0.0,
    acceleration_score REAL DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS insights (
    id SERIAL PRIMARY KEY,
    cluster_id INTEGER REFERENCES signal_clusters(id),
    title TEXT NOT NULL,
    core_observation TEXT,
    evidence_summary JSONB DEFAULT '{}',
    timing_assessment TEXT CHECK(timing_assessment IN ('Early','Emerging','Accelerating','Late')),
    urgency TEXT CHECK(urgency IN ('Low','Medium','High')),
    stakeholder_relevance JSONB DEFAULT '{}',
    coordination_opportunity TEXT,
    themes JSONB DEFAULT '[]',
    entities JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS corporate_signals (
    id SERIAL PRIMARY KEY,
    ticker TEXT NOT NULL,
    company_name TEXT,
    signal_type TEXT NOT NULL,
    theme TEXT,
    signal_text TEXT,
    source_type TEXT,
    source_date DATE,
    base_weight REAL DEFAULT 1.0,
    source_weight REAL DEFAULT 1.0,
    recency_weight REAL DEFAULT 1.0,
    dollar_weight REAL DEFAULT 1.0,
    final_weight REAL DEFAULT 1.0,
    dollar_amount REAL,
    dollar_unit TEXT,
    extracted_by TEXT DEFAULT 'regex',
    confidence REAL DEFAULT 0.8,
    segment TEXT DEFAULT 'macro',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corporate_ticker ON corporate_signals(ticker);
CREATE INDEX IF NOT EXISTS idx_corporate_theme ON corporate_signals(theme);

CREATE TABLE IF NOT EXISTS podcast_sources (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    feed_url TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS podcast_episodes (
    id SERIAL PRIMARY KEY,
    source_id INTEGER REFERENCES podcast_sources(id),
    title TEXT,
    description TEXT,
    episode_url TEXT,
    published_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ── KNOWLEDGE GRAPH FOUNDATION ───────────────────────
-- Entity types and naming should align with SocialMedium Neo4j schema.
-- These tables are EM's local cache; Neo4j is eventual source of truth.

CREATE TABLE IF NOT EXISTS entities (
    id SERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    aliases JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    qdrant_vector_id TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(entity_type, canonical_name)
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(canonical_name);

CREATE TABLE IF NOT EXISTS entity_links (
    id SERIAL PRIMARY KEY,
    source_entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
    target_entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
    link_type TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    metadata JSONB DEFAULT '{}',
    signal_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entity_links_source ON entity_links(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_target ON entity_links(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_type ON entity_links(link_type);

CREATE TABLE IF NOT EXISTS match_outcomes (
    id SERIAL PRIMARY KEY,
    match_id INTEGER REFERENCES event_matches(id) ON DELETE CASCADE,
    messages_exchanged INTEGER DEFAULT 0,
    meeting_scheduled BOOLEAN DEFAULT FALSE,
    meeting_completed BOOLEAN DEFAULT FALSE,
    outcome_type TEXT,
    outcome_value TEXT,
    user_a_rating INTEGER,
    user_b_rating INTEGER,
    feedback_text TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_meta_signals (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
    signal_type TEXT NOT NULL,
    signal_text TEXT,
    themes JSONB DEFAULT '[]',
    metric_value REAL,
    metric_unit TEXT,
    detected_at TIMESTAMP DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_event_meta_event ON event_meta_signals(event_id);
CREATE INDEX IF NOT EXISTS idx_event_meta_type ON event_meta_signals(signal_type);
