INSERT INTO events (
  name, slug, description, event_date, city, country,
  event_type, themes, source_url, expected_attendees,
  start_at, end_at, timezone, venue_type
) VALUES (
  'EthCC [9]',
  'ethcc-9-cannes-2026',
  'The largest annual European Ethereum event focused on technology and community. EthCC [9] brings together developers, researchers, investors, and builders across the Ethereum ecosystem for talks, workshops, and deep networking in Cannes, France.',
  '2026-03-30',
  'Cannes',
  'France',
  'conference',
  '["AI", "FinTech", "Privacy", "Open Source", "Cybersecurity", "Climate Tech"]',
  'https://ethcc.io',
  '4000',
  '2026-03-30 09:00:00',
  '2026-04-02 18:00:00',
  'Europe/Paris',
  'convention_center'
)
ON CONFLICT (name, event_date, city, country) DO UPDATE SET
  description = EXCLUDED.description,
  themes = EXCLUDED.themes,
  source_url = EXCLUDED.source_url,
  expected_attendees = EXCLUDED.expected_attendees,
  start_at = EXCLUDED.start_at,
  end_at = EXCLUDED.end_at,
  timezone = EXCLUDED.timezone,
  venue_type = EXCLUDED.venue_type,
  updated_at = NOW();


-- ── 2. CREATE SIDECAR EVENTS TABLE ─────────────────────────

CREATE TABLE IF NOT EXISTS sidecar_events (
    id SERIAL PRIMARY KEY,
    parent_event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    organizer TEXT,
    description TEXT,
    event_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    venue_name TEXT,
    venue_address TEXT,
    cost TEXT DEFAULT 'Free',
    tags JSONB DEFAULT '[]',
    themes JSONB DEFAULT '[]',
    source_url TEXT,
    food BOOLEAN DEFAULT FALSE,
    bar BOOLEAN DEFAULT FALSE,
    notes TEXT,
    invite_only BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(parent_event_id, name, event_date)
);

CREATE INDEX IF NOT EXISTS idx_sidecar_parent ON sidecar_events(parent_event_id);
CREATE INDEX IF NOT EXISTS idx_sidecar_date ON sidecar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_sidecar_themes ON sidecar_events USING GIN(themes);
CREATE INDEX IF NOT EXISTS idx_sidecar_tags ON sidecar_events USING GIN(tags);


-- ── 3. SEED ALL 32 EthCC [9] SIDECAR EVENTS ────────────────
-- Source: sheeets.xyz community spreadsheet

-- Get the parent event ID
DO $$
DECLARE
  parent_id INTEGER;
BEGIN
  SELECT id INTO parent_id FROM events WHERE slug = 'ethcc-9-cannes-2026' LIMIT 1;

  IF parent_id IS NULL THEN
    RAISE EXCEPTION 'Parent event ethcc-9-cannes-2026 not found. Run core event INSERT first.';
  END IF;

  -- ── Fri Mar 27 ──

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, venue_name, venue_address, cost, tags, themes, source_url)
  VALUES (parent_id, 'Stable Summit IV: Cannes (Day 1)', 'Stable Summit', '2026-03-27', '09:00', '18:00',
    'JW Marriott Cannes', 'Boulevard de la Croisette, Cannes, France',
    '$150-500',
    '["Conference", "Panel/Talk", "Networking", "DeFi"]'::jsonb,
    '["FinTech", "Privacy"]'::jsonb,
    'https://www.stablesummit.xyz/')
  ON CONFLICT DO NOTHING;

  -- ── Sat Mar 28 ──

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, venue_name, venue_address, cost, tags, themes, source_url)
  VALUES (parent_id, 'Stable Summit IV: Cannes (Day 2)', 'Stable Summit', '2026-03-28', '09:00', '18:00',
    'JW Marriott Cannes', 'Boulevard de la Croisette, Cannes, France',
    '$150-500',
    '["Conference", "Panel/Talk", "Networking", "DeFi"]'::jsonb,
    '["FinTech", "Privacy"]'::jsonb,
    'https://www.stablesummit.xyz/')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, cost, tags, themes, source_url)
  VALUES (parent_id, 'BEAST MODE - zkEVM / Ethproofs Day', 'Will Corcoran', '2026-03-28', '10:30', '18:00',
    'Free',
    '["Conference", "Devs/Builders", "ETH"]'::jsonb,
    '["Cybersecurity", "Open Source"]'::jsonb,
    'https://luma.com/beast_mode')
  ON CONFLICT DO NOTHING;

  -- ── Sun Mar 29 ──

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, cost, tags, themes, source_url)
  VALUES (parent_id, 'The Scaling Summit by 499', '499', '2026-03-29', '09:30', '15:00',
    'Free',
    '["Conference", "Panel/Talk", "Networking", "AI", "DeFi", "DAOs", "RWA", "ETH", "SOL"]'::jsonb,
    '["AI", "FinTech", "Open Source"]'::jsonb,
    'https://luma.com/ScalingEthCC2026')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, cost, tags, themes, source_url)
  VALUES (parent_id, 'FORT MODE - Post-Quantum Consensus', 'Will Corcoran', '2026-03-29', '10:30', '18:00',
    'Free',
    '["Conference", "Devs/Builders", "ETH"]'::jsonb,
    '["Cybersecurity", "Privacy"]'::jsonb,
    'https://luma.com/fort_mode')
  ON CONFLICT DO NOTHING;

  -- ── Mon Mar 30 (EthCC Day 1) ──

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, venue_address, cost, tags, themes, source_url)
  VALUES (parent_id, 'Proof of Run 5K', 'Everstake Events', '2026-03-30', '08:00', '09:00',
    'Indacity Rue Buttura, 06400 Cannes, France',
    'Free',
    '["Wellness", "Networking", "ETH"]'::jsonb,
    '[]'::jsonb,
    'https://luma.com/Proof-of-Run-Cannes-Everstake')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, cost, tags, themes, source_url)
  VALUES (parent_id, 'Quantum Qafe Coffee Meetup', 'Tectonic Labs', '2026-03-30', '10:00', '12:00',
    'Free',
    '["Networking", "Devs/Builders", "VCs/Angels", "Jobs/Hiring", "DeFi", "AI"]'::jsonb,
    '["AI", "FinTech"]'::jsonb,
    'https://luma.com/3olk6nlk')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, cost, tags, themes, source_url, invite_only)
  VALUES (parent_id, 'Founders & Investors Brunch', 'fractl', '2026-03-30', '11:00', '14:00',
    'Free',
    '["Brunch", "Networking", "VCs/Angels"]'::jsonb,
    '["FinTech"]'::jsonb,
    'https://luma.com/o7icgo88',
    TRUE)
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, cost, tags, themes, source_url)
  VALUES (parent_id, 'Breakfast with Friends by Masterkey VC (Mon)', 'Masterkey VC', '2026-03-30', '11:00', '13:00',
    'Free',
    '["Brunch", "Networking", "Devs/Builders", "VCs/Angels"]'::jsonb,
    '["FinTech"]'::jsonb,
    'https://luma.com/vtkh3515')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, cost, tags, themes, source_url)
  VALUES (parent_id, 'Proof of Liquidity by Yield Network & Ink', 'Yield Network', '2026-03-30', '12:00', '18:00',
    'Free',
    '["Conference", "Party", "Networking", "VCs/Angels", "DeFi", "RWA", "ETH"]'::jsonb,
    '["FinTech"]'::jsonb,
    'https://luma.com/yc8j7c70')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, venue_name, venue_address, cost, tags, themes, source_url)
  VALUES (parent_id, 'TezDev 2026', 'Tezos Events', '2026-03-30', '13:00', '20:30',
    'Hôtel Martinez', '73 Bd de la Croisette, 06400 Cannes, France',
    'Free',
    '["Conference", "Devs/Builders"]'::jsonb,
    '["Open Source"]'::jsonb,
    'https://luma.com/tezdev-2026')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, venue_name, venue_address, cost, tags, themes, source_url)
  VALUES (parent_id, 'Family Offices & Investors Summit', 'FamilyOfficesInvestors', '2026-03-30', '14:00', '17:00',
    'Hôtel Martinez', '73 Bd de la Croisette, 06400 Cannes, France',
    'Free-$1,000',
    '["Dinner", "Brunch", "Networking", "VCs/Angels", "AI", "DeFi", "RWA"]'::jsonb,
    '["AI", "FinTech"]'::jsonb,
    'https://luma.com/FOIS_ETHCannes')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, venue_name, venue_address, cost, tags, themes, source_url)
  VALUES (parent_id, 'ORAK Cannes - Private Institutional Summit', 'Maxence', '2026-03-30', '14:00', '19:00',
    'Casino Barriere Le Croisette', '1 espace Lucien Barrière, 06400 Cannes, France',
    'Free',
    '["Panel/Talk", "Networking", "VCs/Angels", "DeFi", "RWA"]'::jsonb,
    '["FinTech"]'::jsonb,
    'https://luma.com/as36dn76')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, cost, tags, themes, source_url, invite_only)
  VALUES (parent_id, 'VCs & LPs Cocktail Hour', 'fractl', '2026-03-30', '15:00', '17:00',
    'Free',
    '["Bar/Pub", "Networking", "VCs/Angels", "ETH"]'::jsonb,
    '["FinTech"]'::jsonb,
    'https://luma.com/jiy91q0e',
    TRUE)
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, cost, tags, themes, source_url)
  VALUES (parent_id, 'Wine & Web3 Growth', 'Hacken Events', '2026-03-30', '18:00', '21:00',
    'Free',
    '["Party", "Art", "Performance", "Networking", "Devs/Builders", "ETH"]'::jsonb,
    '["Cybersecurity"]'::jsonb,
    'https://luma.com/us2f37l6')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, cost, tags, themes, source_url)
  VALUES (parent_id, 'Founder x VC Happy Hour', 'BackersStage Capital', '2026-03-30', '18:00', '22:00',
    'Free',
    '["Party", "Bar/Pub", "Networking", "Devs/Builders", "VCs/Angels", "AI", "ETH"]'::jsonb,
    '["AI", "FinTech"]'::jsonb,
    'https://luma.com/lqm55oiv')
  ON CONFLICT DO NOTHING;

  -- ── Tue Mar 31 (EthCC Day 2) ──

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, venue_name, venue_address, cost, tags, themes, source_url)
  VALUES (parent_id, 'The Agora', 'Kaiko', '2026-03-31', '08:00', '18:00',
    'JW Marriott Cannes', '50 Bd de la Croisette, 06400 Cannes, France',
    '€1,050-1,300',
    '["Conference", "Panel/Talk", "Networking"]'::jsonb,
    '["FinTech"]'::jsonb,
    'https://agora.kaiko.com/')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, venue_address, cost, tags, themes, source_url)
  VALUES (parent_id, 'Arbitrum DAO Morning Run', 'Tekrox.eth', '2026-03-31', '08:00', '09:00',
    'Fontaine de la Place du Général de Gaulle, 06400 Cannes, France',
    'Free',
    '["Wellness", "Networking", "DAOs"]'::jsonb,
    '["Open Source"]'::jsonb,
    'https://luma.com/kv6ur67u')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, cost, tags, themes, source_url)
  VALUES (parent_id, 'Scaling Onchain Finance for Real Money', 'The Big Whale', '2026-03-31', '08:30', '11:30',
    'Free',
    '["Brunch", "Panel/Talk", "Networking", "DeFi", "RWA"]'::jsonb,
    '["FinTech"]'::jsonb,
    'https://luma.com/thebigwhale-ethcc')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, venue_name, venue_address, cost, tags, themes, source_url)
  VALUES (parent_id, 'Real-World Asset Summit Cannes 2026', 'Centrifuge', '2026-03-31', '09:00', '19:00',
    'Palm Beach', 'Cannes, France',
    '€499-799',
    '["Conference", "Networking", "RWA"]'::jsonb,
    '["FinTech"]'::jsonb,
    'https://www.rwasummit.io/cannes-2026')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, venue_name, venue_address, cost, tags, themes, source_url)
  VALUES (parent_id, 'TERSE at EthCC', 'Bancor', '2026-03-31', '10:30', '17:00',
    'Palace of Festivals and Congresses', '1 Bd de la Croisette, 06400 Cannes, France',
    'Free',
    '["Panel/Talk", "Networking", "Devs/Builders", "DeFi", "DAOs", "ETH"]'::jsonb,
    '["FinTech", "Open Source"]'::jsonb,
    'https://luma.com/sq4gdmxq')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, cost, tags, themes, source_url)
  VALUES (parent_id, 'WalletCon Cannes 2026', 'WalletConnect', '2026-03-31', '10:00', '18:00',
    'Free',
    '["Conference", "Panel/Talk", "Bar/Pub", "Networking", "Devs/Builders", "BTC", "ETH"]'::jsonb,
    '["Cybersecurity", "Open Source"]'::jsonb,
    'https://luma.com/walletcon_cannes')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, cost, tags, themes, source_url)
  VALUES (parent_id, 'Breakfast with Friends by Masterkey VC (Tue)', 'Masterkey VC', '2026-03-31', '11:00', '13:00',
    'Free',
    '["Brunch", "Networking", "Devs/Builders", "VCs/Angels"]'::jsonb,
    '["FinTech"]'::jsonb,
    'https://luma.com/5mixdy45')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, venue_name, venue_address, cost, tags, themes, source_url)
  VALUES (parent_id, 'Encryption Day', 'Fhenix', '2026-03-31', '12:00', '18:00',
    'Espace Croisette', '21 Rue du Canada, 06400 Cannes, France',
    'Free',
    '["Conference", "Panel/Talk", "Networking", "Devs/Builders", "ETH"]'::jsonb,
    '["Privacy", "Cybersecurity"]'::jsonb,
    'https://luma.com/9ft7s880')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, venue_name, venue_address, cost, tags, themes, source_url)
  VALUES (parent_id, 'Mezo Devs Rooftop Happy Hour', 'Mezo', '2026-03-31', '16:00', '20:00',
    'Five Seas Hotel Cannes', '1 Rue Notre Dame, 06400 Cannes, France',
    'Free',
    '["Bar/Pub", "Panel/Talk", "Networking", "Devs/Builders", "DeFi", "BTC"]'::jsonb,
    '["FinTech"]'::jsonb,
    'https://luma.com/68xoxztv')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, venue_name, venue_address, cost, tags, themes, source_url)
  VALUES (parent_id, 'After Hours with Rain & Turnkey', 'Rain', '2026-03-31', '17:30', '20:30',
    'Vilebrequin La Plage Cannes', '64 Bd de la Croisette, 06400 Cannes, France',
    'Free',
    '["Party", "Networking", "DeFi"]'::jsonb,
    '["FinTech"]'::jsonb,
    'https://luma.com/3ngkor0o')
  ON CONFLICT DO NOTHING;

  -- ── Wed Apr 1 (EthCC Day 3) ──

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, venue_address, cost, tags, themes, source_url)
  VALUES (parent_id, 'RedStone Bolt Cannes Run', 'RedStone France', '2026-04-01', '08:00', '09:00',
    'Le kiosque à musique, 06400 Cannes, France',
    'Free',
    '["Wellness", "DeFi", "RWA", "ETH"]'::jsonb,
    '[]'::jsonb,
    'https://luma.com/qrtylk2u')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, venue_address, cost, tags, themes, source_url)
  VALUES (parent_id, 'Hack Seasons Conference Cannes', 'Metaverse Post', '2026-04-01', '09:00', '16:00',
    'Cannes, France',
    'Free',
    '["Conference", "AI"]'::jsonb,
    '["AI"]'::jsonb,
    'https://luma.com/mixer_cannes')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, venue_name, venue_address, cost, tags, themes, source_url)
  VALUES (parent_id, 'Vault Summit: Cannes', 'Morpho', '2026-04-01', '09:00', '18:00',
    'Palm Beach', 'Cannes, France',
    'TBA',
    '["Conference", "Panel/Talk", "Networking", "DeFi"]'::jsonb,
    '["FinTech"]'::jsonb,
    'https://x.com/Vault__Summit')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, cost, tags, themes, source_url)
  VALUES (parent_id, 'Breakfast with Friends by Masterkey VC (Wed)', 'Masterkey VC', '2026-04-01', '11:00', '13:00',
    'Free',
    '["Brunch", "Networking", "Devs/Builders", "VCs/Angels"]'::jsonb,
    '["FinTech"]'::jsonb,
    'https://luma.com/b9zu5hvw')
  ON CONFLICT DO NOTHING;

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, cost, tags, themes, source_url)
  VALUES (parent_id, 'OpenClaw Speed Hackathon', 'Bryn Bennett', '2026-04-01', '15:00', '19:00',
    'Free',
    '["Hackathon", "Networking", "Devs/Builders", "AI"]'::jsonb,
    '["AI", "Open Source"]'::jsonb,
    'https://luma.com/wvftim9o')
  ON CONFLICT DO NOTHING;

  -- ── Thu Apr 2 (EthCC Day 4) ──

  INSERT INTO sidecar_events (parent_event_id, name, organizer, event_date, start_time, end_time, cost, tags, themes, source_url)
  VALUES (parent_id, 'Pragma Cannes 2026', 'ETHGlobal', '2026-04-02', '09:30', '18:00',
    '$99',
    '["Conference", "Panel/Talk", "Devs/Builders", "DeFi", "ETH"]'::jsonb,
    '["FinTech", "Open Source"]'::jsonb,
    'https://luma.com/pragma-cannes2026')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Seeded sidecar events for EthCC [9] (parent_id=%)', parent_id;
END $$;


-- ── 4. VERIFY ───────────────────────────────────────────────

SELECT
  'Core event' as type,
  e.name, e.event_date, e.city,
  (SELECT COUNT(*) FROM sidecar_events WHERE parent_event_id = e.id) as sidecar_count
FROM events e WHERE e.slug = 'ethcc-9-cannes-2026';

SELECT event_date, COUNT(*) as events, string_agg(name, ' | ' ORDER BY start_time) as lineup
FROM sidecar_events
WHERE parent_event_id = (SELECT id FROM events WHERE slug = 'ethcc-9-cannes-2026')
GROUP BY event_date
ORDER BY event_date;
