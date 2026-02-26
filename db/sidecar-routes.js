// ============================================================
// SIDECAR EVENTS — Add this to routes/events.js
// ============================================================

// GET /api/events/:id/sidecars — list all sidecar events for a parent event
router.get('/:id/sidecars', async function(req, res) {
  try {
    var eventId = parseInt(req.params.id);
    if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid event ID' });

    // Check parent exists
    var parent = await dbGet('SELECT id, name, slug FROM events WHERE id = $1', [eventId]);
    if (!parent) return res.status(404).json({ error: 'Event not found' });

    // Get sidecars grouped by date
    var sidecars = await dbAll(`
      SELECT
        id, name, organizer, description,
        event_date, start_time, end_time,
        venue_name, venue_address,
        cost, tags, themes, source_url,
        food, bar, notes, invite_only
      FROM sidecar_events
      WHERE parent_event_id = $1
      ORDER BY event_date ASC, start_time ASC
    `, [eventId]);

    // Summary stats
    var stats = await dbGet(`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT event_date) as days,
        COUNT(*) FILTER (WHERE cost = 'Free') as free_count,
        COUNT(*) FILTER (WHERE invite_only = TRUE) as invite_only_count
      FROM sidecar_events
      WHERE parent_event_id = $1
    `, [eventId]);

    res.json({
      parent: parent,
      stats: {
        total: parseInt(stats.total),
        days: parseInt(stats.days),
        free: parseInt(stats.free_count),
        invite_only: parseInt(stats.invite_only_count)
      },
      sidecars: sidecars
    });
  } catch (err) {
    console.error('Sidecar fetch error:', err);
    res.status(500).json({ error: 'Failed to load sidecar events' });
  }
});

// GET /api/events/:id/sidecars/by-date — grouped by date for UI
router.get('/:id/sidecars/by-date', async function(req, res) {
  try {
    var eventId = parseInt(req.params.id);
    var sidecars = await dbAll(`
      SELECT *
      FROM sidecar_events
      WHERE parent_event_id = $1
      ORDER BY event_date ASC, start_time ASC
    `, [eventId]);

    // Group by date
    var grouped = {};
    sidecars.forEach(function(s) {
      var dateKey = s.event_date;
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(s);
    });

    res.json({ dates: grouped });
  } catch (err) {
    console.error('Sidecar by-date error:', err);
    res.status(500).json({ error: 'Failed to load sidecar events' });
  }
});

// GET /api/events/:id/sidecar-count — lightweight count for badge
router.get('/:id/sidecar-count', async function(req, res) {
  try {
    var eventId = parseInt(req.params.id);
    var result = await dbGet(
      'SELECT COUNT(*) as count FROM sidecar_events WHERE parent_event_id = $1',
      [eventId]
    );
    res.json({ count: parseInt(result.count) });
  } catch (err) {
    res.json({ count: 0 });
  }
});
