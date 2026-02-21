var express = require('express');
var { dbGet, dbRun, dbAll } = require('../db');
var { authenticateToken, optionalAuth } = require('../middleware/auth');
var { normalizeThemes } = require('../lib/theme_taxonomy');
var { embedEvent } = require('../lib/vector_search');

var router = express.Router();

// ── GET /api/events ── (list with filters)
router.get('/', optionalAuth, async function(req, res) {
  try {
    var { theme, city, country, search, upcoming, limit, offset } = req.query;
    var conditions = [];
    var params = [];
    var idx = 1;

    if (theme) {
      conditions.push('themes::text ILIKE $' + idx);
      params.push('%' + theme + '%');
      idx++;
    }
    if (city) {
      conditions.push('city ILIKE $' + idx);
      params.push('%' + city + '%');
      idx++;
    }
    if (country) {
      conditions.push('country ILIKE $' + idx);
      params.push('%' + country + '%');
      idx++;
    }
    if (search) {
      conditions.push('(name ILIKE $' + idx + ' OR description ILIKE $' + idx + ')');
      params.push('%' + search + '%');
      idx++;
    }
    if (upcoming === 'true') {
      conditions.push('event_date >= CURRENT_DATE');
    }

    var where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    var lim = parseInt(limit) || 50;
    var off = parseInt(offset) || 0;

    var events = await dbAll(
      'SELECT * FROM events' + where + ' ORDER BY event_date ASC LIMIT $' + idx + ' OFFSET $' + (idx + 1),
      params.concat([lim, off])
    );

    // Get registration counts
    for (var i = 0; i < events.length; i++) {
      var count = await dbGet(
        'SELECT COUNT(*) as count FROM event_registrations WHERE event_id = $1 AND status = $2',
        [events[i].id, 'active']
      );
      events[i].registration_count = parseInt(count.count);
    }

    res.json({ events: events });
  } catch (err) {
    console.error('List events error:', err);
    res.status(500).json({ error: 'Failed to load events' });
  }
});

// ── GET /api/events/user/registrations ──
router.get('/user/registrations', authenticateToken, async function(req, res) {
  try {
    var registrations = await dbAll(
      `SELECT e.*, er.registered_at, er.status
       FROM event_registrations er
       JOIN events e ON e.id = er.event_id
       WHERE er.user_id = $1 AND er.status = $2
       ORDER BY e.event_date ASC`,
      [req.user.id, 'active']
    );
    res.json({ registrations: registrations, events: registrations });
  } catch (err) {
    console.error('My registrations error:', err);
    res.status(500).json({ error: 'Failed to load registrations' });
  }
});

// ── GET /api/events/:id ── (single event)
router.get('/:id', optionalAuth, async function(req, res) {
  try {
    var event = await dbGet('SELECT * FROM events WHERE id = $1', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    var count = await dbGet(
      'SELECT COUNT(*) as count FROM event_registrations WHERE event_id = $1 AND status = $2',
      [event.id, 'active']
    );
    event.registration_count = parseInt(count.count);

    // Check if current user is registered
    if (req.user) {
      var reg = await dbGet(
        'SELECT id FROM event_registrations WHERE event_id = $1 AND user_id = $2 AND status = $3',
        [event.id, req.user.id, 'active']
      );
      event.user_registered = !!reg;
    }

    res.json({ event: event });
  } catch (err) {
    console.error('Get event error:', err);
    res.status(500).json({ error: 'Failed to load event' });
  }
});

// ── GET /api/events/:id/calendar ── (.ics file download)
router.get('/:id/calendar', async function(req, res) {
  try {
    var event = await dbGet('SELECT * FROM events WHERE id = $1', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    var baseUrl = req.protocol + '://' + req.get('host');
    var eventUrl = baseUrl + '/event.html?id=' + event.id;
    var canisterUrl = baseUrl + '/canister.html?event_id=' + event.id;
    var nevUrl = baseUrl + '/onboard.html?event_id=' + event.id;

    var date = event.event_date ? new Date(event.event_date) : new Date();
    var endDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    var location = [event.venue, event.city, event.country].filter(Boolean).join(', ');

    var description = [
      'Your Event Hub: ' + eventUrl,
      '',
      'Find your matches before you go: ' + canisterUrl,
      '',
      'Tell Nev what you\'re looking for: ' + nevUrl,
      '',
      'Know someone who should be there?',
      eventUrl,
      '',
      'Event Medium finds the right conversations before you arrive.'
    ].join('\\n');

    var uid = 'event-' + event.id + '@eventmedium.ai';
    var now = formatICSDate(new Date());

    var ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Event Medium//eventmedium.ai//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + now,
      'DTSTART:' + formatICSDate(date),
      'DTEND:' + formatICSDate(endDate),
      'SUMMARY:' + icsEscape(event.name + ' \u00b7 Event Medium'),
      'LOCATION:' + icsEscape(location),
      'DESCRIPTION:' + description,
      'URL:' + eventUrl,
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-P7D',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + icsEscape(event.name) + ' is in 1 week. Check your matches on Event Medium.',
      'END:VALARM',
      'BEGIN:VALARM',
      'TRIGGER:-P1D',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + icsEscape(event.name) + ' is tomorrow. Your matches are ready.',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    var filename = (event.name || 'event').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_') + '.ics';

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(ics);
  } catch (err) {
    console.error('Calendar generation error:', err);
    res.status(500).json({ error: 'Failed to generate calendar file' });
  }
});

// ── GET /api/events/:id/calendar-links ── (calendar deep links)
router.get('/:id/calendar-links', async function(req, res) {
  try {
    var event = await dbGet('SELECT * FROM events WHERE id = $1', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    var baseUrl = req.protocol + '://' + req.get('host');
    var eventUrl = baseUrl + '/event.html?id=' + event.id;
    var nevUrl = baseUrl + '/onboard.html?event_id=' + event.id;

    var date = event.event_date ? new Date(event.event_date) : new Date();
    var endDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    var location = [event.venue, event.city, event.country].filter(Boolean).join(', ');

    var description = event.name + '\n\n' +
      'Your Event Hub: ' + eventUrl + '\n\n' +
      'Find your matches: ' + baseUrl + '/canister.html?event_id=' + event.id + '\n\n' +
      'Tell Nev what you\'re looking for: ' + nevUrl;

    var title = event.name + ' \u00b7 Event Medium';
    var start = formatICSDate(date);
    var end = formatICSDate(endDate);

    var google = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(title) +
      '&dates=' + start + '/' + end +
      '&details=' + encodeURIComponent(description) +
      (location ? '&location=' + encodeURIComponent(location) : '');

    var outlook = 'https://outlook.live.com/calendar/0/action/compose?' +
      'subject=' + encodeURIComponent(title) +
      '&startdt=' + date.toISOString() +
      '&enddt=' + endDate.toISOString() +
      (location ? '&location=' + encodeURIComponent(location) : '') +
      '&body=' + encodeURIComponent(description);

    var icsUrl = baseUrl + '/api/events/' + event.id + '/calendar';

    res.json({
      google: google,
      outlook: outlook,
      ics: icsUrl,
      apple: icsUrl
    });
  } catch (err) {
    console.error('Calendar links error:', err);
    res.status(500).json({ error: 'Failed to generate calendar links' });
  }
});

// ── POST /api/events/submit ── (community event submission)
router.post('/submit', authenticateToken, async function(req, res) {
  try {
    var { name, description, event_date, city, country, event_type, themes, source_url, expected_attendees, start_at, end_at, timezone, venue_type } = req.body;

    if (!name || !event_date) {
      return res.status(400).json({ error: 'Name and date are required' });
    }

    // Normalize themes
    var rawThemes = themes || [];
    if (typeof rawThemes === 'string') {
      try { rawThemes = JSON.parse(rawThemes); } catch(e) { rawThemes = [rawThemes]; }
    }
    var normalizedThemes = normalizeThemes(rawThemes);

    // Generate slug
    var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    slug = slug + '-' + event_date.replace(/-/g, '');

    var result = await dbRun(
      `INSERT INTO events (name, description, event_date, city, country, event_type, themes, slug, source_url, expected_attendees, start_at, end_at, timezone, venue_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (name, event_date, city, country) DO UPDATE SET
         description = COALESCE(EXCLUDED.description, events.description),
         themes = EXCLUDED.themes,
         source_url = COALESCE(EXCLUDED.source_url, events.source_url),
         updated_at = NOW()
       RETURNING *`,
      [name, description, event_date, city, country, event_type || 'conference',
       JSON.stringify(normalizedThemes), slug, source_url, expected_attendees,
       start_at, end_at, timezone, venue_type]
    );

    var event = result.rows[0];

    // Embed in Qdrant (async)
    embedEvent(event).catch(function(err) {
      console.error('Event embedding error:', err);
    });

    res.json({ event: event });
  } catch (err) {
    console.error('Submit event error:', err);
    res.status(500).json({ error: 'Failed to submit event' });
  }
});

// ── POST /api/events/:id/register ──
router.post('/:id/register', authenticateToken, async function(req, res) {
  try {
    var eventId = parseInt(req.params.id);
    var event = await dbGet('SELECT id FROM events WHERE id = $1', [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Get user's profile for stakeholder_type and themes
    var profile = await dbGet(
      'SELECT stakeholder_type, themes FROM stakeholder_profiles WHERE user_id = $1',
      [req.user.id]
    );

    await dbRun(
      `INSERT INTO event_registrations (event_id, user_id, stakeholder_type, themes, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id, user_id) DO UPDATE SET status = $5, registered_at = NOW()`,
      [eventId, req.user.id, profile ? profile.stakeholder_type : null,
       profile ? JSON.stringify(profile.themes) : '[]', 'active']
    );

    res.json({ registered: true });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── DELETE /api/events/:id/register ──
router.delete('/:id/register', authenticateToken, async function(req, res) {
  try {
    await dbRun(
      'UPDATE event_registrations SET status = $1 WHERE event_id = $2 AND user_id = $3',
      ['cancelled', parseInt(req.params.id), req.user.id]
    );
    res.json({ unregistered: true });
  } catch (err) {
    console.error('Unregister error:', err);
    res.status(500).json({ error: 'Unregistration failed' });
  }
});

// ── GET /api/events/:id/demand-signals ── (organizer dashboard)
router.get('/:id/demand-signals', authenticateToken, async function(req, res) {
  try {
    var eventId = parseInt(req.params.id);

    // Only show for events with 100+ registrants
    var count = await dbGet(
      'SELECT COUNT(*) as count FROM event_registrations WHERE event_id = $1 AND status = $2',
      [eventId, 'active']
    );
    if (parseInt(count.count) < 100) {
      return res.json({ demand_signals: null, message: 'Demand signals available at 100+ registrants' });
    }

    // Stakeholder type breakdown
    var typeBreakdown = await dbAll(
      `SELECT stakeholder_type, COUNT(*) as count
       FROM event_registrations
       WHERE event_id = $1 AND status = $2 AND stakeholder_type IS NOT NULL
       GROUP BY stakeholder_type ORDER BY count DESC`,
      [eventId, 'active']
    );

    // Theme breakdown (unnest JSONB array)
    var themeBreakdown = await dbAll(
      `SELECT theme, COUNT(*) as count
       FROM event_registrations, jsonb_array_elements_text(themes) as theme
       WHERE event_id = $1 AND status = $2
       GROUP BY theme ORDER BY count DESC`,
      [eventId, 'active']
    );

    // Event meta signals
    var metaSignals = await dbAll(
      'SELECT * FROM event_meta_signals WHERE event_id = $1 ORDER BY detected_at DESC',
      [eventId]
    );

    res.json({
      demand_signals: {
        total_registrants: parseInt(count.count),
        stakeholder_breakdown: typeBreakdown,
        theme_breakdown: themeBreakdown,
        meta_signals: metaSignals
      }
    });
  } catch (err) {
    console.error('Demand signals error:', err);
    res.status(500).json({ error: 'Failed to load demand signals' });
  }
});

// ── POST /api/events/admin/seed ── seed known events
router.post('/admin/seed', authenticateToken, async function(req, res) {
  try {
    var { seed } = require('../lib/seed_known_events');
    await seed();
    var count = await dbGet('SELECT COUNT(*) as count FROM events');
    res.json({ success: true, total_events: parseInt(count.count) });
  } catch (err) {
    console.error('Seed error:', err);
    res.status(500).json({ error: 'Seed failed: ' + err.message });
  }
});

// ── POST /api/events/admin/harvest ── trigger event harvester
router.post('/admin/harvest', authenticateToken, async function(req, res) {
  try {
    var { harvest } = require('../lib/event_harvester');
    var options = {
      theme: req.body.theme || null,
      city: req.body.city || null,
      dryRun: req.body.dry_run || false,
      maxQueries: req.body.max_queries || 1
    };

    // Run async — respond immediately
    res.json({ success: true, message: 'Harvest started', options: options });

    harvest(options).then(function(stats) {
      console.log('Harvest complete:', stats.stored, 'new events');
    }).catch(function(err) {
      console.error('Harvest failed:', err);
    });
  } catch (err) {
    console.error('Harvest trigger error:', err);
    res.status(500).json({ error: 'Harvest failed: ' + err.message });
  }
});

// ── Helpers ──
function formatICSDate(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsEscape(s) {
  if (!s) return '';
  return s.replace(/[\\;,]/g, function(c) { return '\\' + c; });
}

module.exports = { router };