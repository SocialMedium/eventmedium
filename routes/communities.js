var express = require('express');
var router = express.Router();
var { dbGet, dbRun, dbAll } = require('../db');
var { authenticateToken } = require('../middleware/auth');

// Generate 6-char access code
function generateCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I,O,0,1 confusion
  var code = '';
  for (var i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

// Slugify name
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

// ── GET /api/communities/mine ── communities I belong to
router.get('/mine', authenticateToken, async function(req, res) {
  try {
    var communities = await dbAll(
      `SELECT c.*, cm.role, cm.joined_at,
        (SELECT COUNT(*) FROM community_members WHERE community_id = c.id) as member_count,
        (SELECT COUNT(*) FROM events WHERE community_id = c.id AND event_date >= CURRENT_DATE) as upcoming_events
       FROM communities c
       JOIN community_members cm ON cm.community_id = c.id
       WHERE cm.user_id = $1 AND c.is_active = true
       ORDER BY cm.joined_at DESC`,
      [req.user.id]
    );
    res.json({ communities: communities });
  } catch (err) {
    console.error('Get communities error:', err);
    res.status(500).json({ error: 'Failed to load communities' });
  }
});

// ── POST /api/communities ── create a new community
router.post('/', authenticateToken, async function(req, res) {
  try {
    var name = (req.body.name || '').trim();
    var description = (req.body.description || '').trim();
    if (!name) return res.status(400).json({ error: 'Community name required' });

    // Generate unique code
    var code = generateCode();
    var codeExists = await dbGet('SELECT id FROM communities WHERE access_code = $1', [code]);
    while (codeExists) {
      code = generateCode();
      codeExists = await dbGet('SELECT id FROM communities WHERE access_code = $1', [code]);
    }

    var slug = slugify(name);
    var slugExists = await dbGet('SELECT id FROM communities WHERE slug = $1', [slug]);
    if (slugExists) slug = slug + '-' + code.toLowerCase();

    var result = await dbRun(
      `INSERT INTO communities (name, slug, description, owner_user_id, access_code)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, slug, description, req.user.id, code]
    );
    var communityId = result.rows[0].id;

    // Add owner as member
    await dbRun(
      "INSERT INTO community_members (community_id, user_id, role) VALUES ($1, $2, 'owner')",
      [communityId, req.user.id]
    );

    res.json({
      community: { id: communityId, name: name, slug: slug, access_code: code },
      message: 'Community created. Share code ' + code + ' with your members.'
    });
  } catch (err) {
    console.error('Create community error:', err);
    res.status(500).json({ error: 'Failed to create community' });
  }
});

// ── POST /api/communities/join ── join with access code
router.post('/join', authenticateToken, async function(req, res) {
  try {
    var code = (req.body.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Access code required' });

    var community = await dbGet(
      'SELECT id, name, slug FROM communities WHERE access_code = $1 AND is_active = true',
      [code]
    );
    if (!community) return res.status(404).json({ error: 'Invalid access code' });

    // Check if already member
    var existing = await dbGet(
      'SELECT id FROM community_members WHERE community_id = $1 AND user_id = $2',
      [community.id, req.user.id]
    );
    if (existing) return res.json({ community: community, message: 'Already a member' });

    await dbRun(
      "INSERT INTO community_members (community_id, user_id, role) VALUES ($1, $2, 'member')",
      [community.id, req.user.id]
    );

    res.json({ community: community, message: 'Joined ' + community.name });
  } catch (err) {
    console.error('Join community error:', err);
    res.status(500).json({ error: 'Failed to join community' });
  }
});


// ── GET /api/communities/:slug/public ── unauthenticated landing page info
router.get('/:slug/public', async function(req, res) {
  try {
    var community = await dbGet(
      `SELECT name, slug, description, created_at,
        (SELECT COUNT(*) FROM community_members WHERE community_id = communities.id) as member_count,
        (SELECT COUNT(*) FROM events WHERE community_id = communities.id AND event_date >= CURRENT_DATE) as upcoming_events
       FROM communities WHERE slug = $1 AND is_active = true`,
      [req.params.slug]
    );
    if (!community) return res.status(404).json({ error: 'Community not found' });
    res.json({ community: community });
  } catch (err) {
    console.error('Public community error:', err);
    res.status(500).json({ error: 'Failed to load community' });
  }
});
// ── GET /api/communities/:slug ── community detail + events
router.get('/:slug', authenticateToken, async function(req, res) {
  try {
    var community = await dbGet(
      `SELECT c.*,
        (SELECT COUNT(*) FROM community_members WHERE community_id = c.id) as member_count
       FROM communities c WHERE c.slug = $1 AND c.is_active = true`,
      [req.params.slug]
    );
    if (!community) return res.status(404).json({ error: 'Community not found' });

    // Check membership
    var membership = await dbGet(
      'SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2',
      [community.id, req.user.id]
    );
    if (!membership) return res.status(403).json({ error: 'Not a member. Enter the access code to join.' });

    // Get community events
    var events = await dbAll(
      `SELECT e.*,
        (SELECT COUNT(*) FROM event_registrations WHERE event_id = e.id AND status = 'active') as reg_count
       FROM events e
       WHERE e.community_id = $1
       ORDER BY e.event_date ASC`,
      [community.id]
    );

    // Hide access code from non-owners
    if (membership.role !== 'owner') {
      community.access_code = undefined;
    }

    res.json({
      community: community,
      role: membership.role,
      events: events
    });
  } catch (err) {
    console.error('Get community error:', err);
    res.status(500).json({ error: 'Failed to load community' });
  }
});

// ── POST /api/communities/:slug/events ── create community event (owner only)
router.post('/:slug/events', authenticateToken, async function(req, res) {
  try {
    var community = await dbGet(
      'SELECT id FROM communities WHERE slug = $1 AND is_active = true', [req.params.slug]
    );
    if (!community) return res.status(404).json({ error: 'Community not found' });

    var membership = await dbGet(
      'SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2',
      [community.id, req.user.id]
    );
    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only community owners can create events' });
    }

    var b = req.body;
    var name = (b.name || '').trim();
    var eventDate = b.event_date;
    if (!name || !eventDate) return res.status(400).json({ error: 'Name and date required' });

    var eventSlug = slugify(name) + '-' + community.id;
    var result = await dbRun(
      `INSERT INTO events (name, slug, event_date, city, country, themes, community_id, expected_attendees)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        name, eventSlug, eventDate,
        (b.city || '').trim(), (b.country || '').trim(),
        JSON.stringify(b.themes || []),
        community.id,
        b.expected_attendees || 50
      ]
    );

    res.json({ event_id: result.rows[0].id, slug: eventSlug });
  } catch (err) {
    console.error('Create community event error:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// ── GET /api/communities/:slug/members ── member list (owner only, anonymized for others)
router.get('/:slug/members', authenticateToken, async function(req, res) {
  try {
    var community = await dbGet(
      'SELECT id FROM communities WHERE slug = $1 AND is_active = true', [req.params.slug]
    );
    if (!community) return res.status(404).json({ error: 'Community not found' });

    var membership = await dbGet(
      'SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2',
      [community.id, req.user.id]
    );
    if (!membership) return res.status(403).json({ error: 'Not a member' });

    if (membership.role === 'owner') {
      // Owner sees names
      var members = await dbAll(
        `SELECT u.name, u.company, sp.stakeholder_type, cm.role, cm.joined_at
         FROM community_members cm
         JOIN users u ON u.id = cm.user_id
         LEFT JOIN stakeholder_profiles sp ON sp.user_id = u.id
         WHERE cm.community_id = $1
         ORDER BY cm.joined_at ASC`,
        [community.id]
      );
      res.json({ members: members, total: members.length });
    } else {
      // Members see anonymized stats only
      var stats = await dbAll(
        `SELECT sp.stakeholder_type, COUNT(*) as count
         FROM community_members cm
         LEFT JOIN stakeholder_profiles sp ON sp.user_id = cm.user_id
         WHERE cm.community_id = $1
         GROUP BY sp.stakeholder_type`,
        [community.id]
      );
      var total = await dbGet(
        'SELECT COUNT(*) as total FROM community_members WHERE community_id = $1',
        [community.id]
      );
      res.json({ stats: stats, total: parseInt(total.total) });
    }
  } catch (err) {
    console.error('Get members error:', err);
    res.status(500).json({ error: 'Failed to load members' });
  }
});

// ── PUT /api/communities/:slug ── update community (owner only)
router.put('/:slug', authenticateToken, async function(req, res) {
  try {
    var community = await dbGet(
      'SELECT id FROM communities WHERE slug = $1 AND is_active = true', [req.params.slug]
    );
    if (!community) return res.status(404).json({ error: 'Community not found' });

    var membership = await dbGet(
      'SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2',
      [community.id, req.user.id]
    );
    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can update community' });
    }

    var updates = [];
    var params = [];
    var idx = 1;
    if (req.body.name) { updates.push('name = $' + idx); params.push(req.body.name.trim()); idx++; }
    if (req.body.description !== undefined) { updates.push('description = $' + idx); params.push(req.body.description.trim()); idx++; }
    if (req.body.logo_url) { updates.push('logo_url = $' + idx); params.push(req.body.logo_url); idx++; }

    if (updates.length) {
      params.push(community.id);
      await dbRun('UPDATE communities SET ' + updates.join(', ') + ' WHERE id = $' + idx, params);
    }

    res.json({ updated: true });
  } catch (err) {
    console.error('Update community error:', err);
    res.status(500).json({ error: 'Failed to update community' });
  }
});

// ── POST /api/communities/:slug/regenerate-code ── new access code (owner only)
router.post('/:slug/regenerate-code', authenticateToken, async function(req, res) {
  try {
    var community = await dbGet(
      'SELECT id FROM communities WHERE slug = $1 AND is_active = true', [req.params.slug]
    );
    if (!community) return res.status(404).json({ error: 'Community not found' });

    var membership = await dbGet(
      'SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2',
      [community.id, req.user.id]
    );
    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can regenerate codes' });
    }

    var code = generateCode();
    var codeExists = await dbGet('SELECT id FROM communities WHERE access_code = $1', [code]);
    while (codeExists) {
      code = generateCode();
      codeExists = await dbGet('SELECT id FROM communities WHERE access_code = $1', [code]);
    }

    await dbRun('UPDATE communities SET access_code = $1 WHERE id = $2', [code, community.id]);
    res.json({ access_code: code });
  } catch (err) {
    console.error('Regenerate code error:', err);
    res.status(500).json({ error: 'Failed to regenerate code' });
  }
});

module.exports = { router: router };
