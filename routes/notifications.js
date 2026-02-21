var express = require('express');
var { dbGet, dbRun, dbAll } = require('../db');
var { authenticateToken } = require('../middleware/auth');

var router = express.Router();

// ── GET /api/notifications ── list notifications
router.get('/', authenticateToken, async function(req, res) {
  try {
    var limit = parseInt(req.query.limit) || 50;
    var notifications = await dbAll(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [req.user.id, limit]
    );
    res.json({ notifications: notifications });
  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// ── GET /api/notifications/unread-count ── badge count
router.get('/unread-count', authenticateToken, async function(req, res) {
  try {
    var result = await dbGet(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [req.user.id]
    );
    res.json({ count: parseInt(result.count) });
  } catch (err) {
    console.error('Unread count error:', err);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// ── POST /api/notifications/read ── mark all read
router.post('/read', authenticateToken, async function(req, res) {
  try {
    await dbRun(
      'UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL',
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// ── POST /api/notifications/read/:id ── mark single read
router.post('/read/:id', authenticateToken, async function(req, res) {
  try {
    await dbRun(
      'UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2',
      [parseInt(req.params.id), req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Mark single read error:', err);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

module.exports = { router };
