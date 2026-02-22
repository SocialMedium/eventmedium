
BEGIN;

UPDATE events SET event_date = '2026-01-06'
WHERE name ILIKE '%%CES%%' OR name ILIKE '%%Consumer Electronics Show%%';

UPDATE events SET event_date = '2026-03-02'
WHERE name ILIKE '%%MWC%%' OR name ILIKE '%%Mobile World Congress%%';

UPDATE events SET event_date = '2026-03-12'
WHERE name ILIKE '%%SXSW%%' OR name ILIKE '%%South by Southwest%%';

UPDATE events SET event_date = '2026-03-16'
WHERE name ILIKE '%%GTC%%' OR name ILIKE '%%GPU Technology%%';

UPDATE events SET event_date = '2026-04-29'
WHERE name ILIKE '%%TOKEN2049%%' AND (city ILIKE '%%Dubai%%' OR event_date < '2026-07-01');

UPDATE events SET event_date = '2026-05-19'
WHERE name ILIKE '%%Google I/O%%' OR name ILIKE '%%Google IO%%';

UPDATE events SET event_date = '2026-06-02'
WHERE name ILIKE '%%Computex%%';

UPDATE events SET event_date = '2026-06-03'
WHERE name ILIKE '%%Collision%%' AND city ILIKE '%%Toronto%%';

UPDATE events SET event_date = '2026-06-17'
WHERE name ILIKE '%%VivaTech%%' OR name ILIKE '%%Viva Tech%%';

UPDATE events SET event_date = '2026-10-07'
WHERE name ILIKE '%%TOKEN2049%%' AND (city ILIKE '%%Singapore%%' OR event_date > '2026-07-01');

UPDATE events SET event_date = '2026-10-13'
WHERE name ILIKE '%%TechCrunch%%' OR name ILIKE '%%Disrupt%%';

UPDATE events SET event_date = '2026-11-09'
WHERE name ILIKE '%%Web Summit%%';

UPDATE events SET event_date = '2026-12-07'
WHERE name ILIKE '%%GITEX%%';

COMMIT;

SELECT id, name, city, event_date FROM events ORDER BY event_date ASC;
