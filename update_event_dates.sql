-- EventMedium Sprint 1: Replace placeholder 15th-of-month dates with verified 2026 dates
-- Run: psql $DATABASE_URL -f update_event_dates.sql

BEGIN;

-- CES 2026 — Las Vegas, Jan 6–9
UPDATE events SET event_date = '2026-01-06'
WHERE name ILIKE '%CES%' OR name ILIKE '%Consumer Electronics Show%';

-- MWC Barcelona 2026 — Mar 2–5
UPDATE events SET event_date = '2026-03-02'
WHERE name ILIKE '%MWC%' OR name ILIKE '%Mobile World Congress%';

-- SXSW 2026 — Austin, Mar 12–18
UPDATE events SET event_date = '2026-03-12'
WHERE name ILIKE '%SXSW%' OR name ILIKE '%South by Southwest%';

-- NVIDIA GTC 2026 — San Jose, Mar 16–19
UPDATE events SET event_date = '2026-03-16'
WHERE name ILIKE '%GTC%' OR name ILIKE '%GPU Technology%';

-- TOKEN2049 Dubai 2026 — Apr 29–30
UPDATE events SET event_date = '2026-04-29'
WHERE name ILIKE '%TOKEN2049%' AND (city ILIKE '%Dubai%' OR event_date < '2026-07-01');

-- Google I/O 2026 — Mountain View, May 19–20
UPDATE events SET event_date = '2026-05-19'
WHERE name ILIKE '%Google I/O%' OR name ILIKE '%Google IO%';

-- Computex 2026 — Taipei, Jun 2–5
UPDATE events SET event_date = '2026-06-02'
WHERE name ILIKE '%Computex%';

-- Collision 2026 — Toronto, Jun 3–4
UPDATE events SET event_date = '2026-06-03'
WHERE name ILIKE '%Collision%' AND city ILIKE '%Toronto%';

-- VivaTech 2026 — Paris, Jun 17–20
UPDATE events SET event_date = '2026-06-17'
WHERE name ILIKE '%VivaTech%' OR name ILIKE '%Viva Tech%';

-- TOKEN2049 Singapore 2026 — Oct 7–8
UPDATE events SET event_date = '2026-10-07'
WHERE name ILIKE '%TOKEN2049%' AND (city ILIKE '%Singapore%' OR event_date > '2026-07-01');

-- TechCrunch Disrupt 2026 — San Francisco, Oct 13–15
UPDATE events SET event_date = '2026-10-13'
WHERE name ILIKE '%TechCrunch%' OR name ILIKE '%Disrupt%';

-- Web Summit 2026 — Lisbon, Nov 9–12
UPDATE events SET event_date = '2026-11-09'
WHERE name ILIKE '%Web Summit%';

-- GITEX Global 2026 — Dubai (Expo City), Dec 7–11
UPDATE events SET event_date = '2026-12-07'
WHERE name ILIKE '%GITEX%';

COMMIT;

-- Verify results
SELECT id, name, city, event_date FROM events ORDER BY event_date ASC;
