var express = require('express');
var { dbGet, dbRun, dbAll } = require('../db');
var { authenticateToken } = require('../middleware/auth');

var router = express.Router();

// ── GET /api/messages/unread ── unread count
router.get('/unread', authenticateToken, async function(req, res) {
  try {
    var result = await dbGet(
      'SELECT COUNT(*) as count FROM messages WHERE receiver_id = $1 AND read_at IS NULL',
      [req.user.id]
    );
    res.json({ unread: parseInt(result.count) });
  } catch (err) {
    console.error('Unread count error:', err);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// ── GET /api/messages/:matchId ── message thread
router.get('/:matchId', authenticateToken, async function(req, res) {
  try {
    var matchId = parseInt(req.params.matchId);

    // Verify user is part of this match
    var match = await dbGet(
      'SELECT * FROM event_matches WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2)',
      [matchId, req.user.id]
    );
    if (!match) return res.status(403).json({ error: 'Not your match' });
    if (match.status !== 'revealed') return res.status(403).json({ error: 'Match not yet revealed' });

    var messages = await dbAll(
      'SELECT * FROM messages WHERE match_id = $1 ORDER BY created_at ASC',
      [matchId]
    );

    // Get other user info
    var otherId = match.user_a_id === req.user.id ? match.user_b_id : match.user_a_id;
    var otherUser = await dbGet(
      'SELECT id, name, company, avatar_url FROM users WHERE id = $1',
      [otherId]
    );

    res.json({ messages: messages, other_user: otherUser, match: match });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// ── POST /api/messages ── send message
router.post('/', authenticateToken, async function(req, res) {
  try {
    var { match_id, body, message_type, metadata } = req.body;
    if (!match_id || !body) return res.status(400).json({ error: 'match_id and body required' });

    // Verify user is part of this match and it's revealed
    var match = await dbGet(
      "SELECT * FROM event_matches WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2) AND status = 'revealed'",
      [match_id, req.user.id]
    );
    if (!match) return res.status(403).json({ error: 'Cannot message this match' });

    var receiverId = match.user_a_id === req.user.id ? match.user_b_id : match.user_a_id;

    var result = await dbRun(
      'INSERT INTO messages (match_id, sender_id, receiver_id, body, message_type, metadata) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [match_id, req.user.id, receiverId, body, message_type || 'text', metadata ? JSON.stringify(metadata) : null]
    );

    var message = result.rows[0];

    // Update match_outcomes message count
    await dbRun(
      'UPDATE match_outcomes SET messages_exchanged = messages_exchanged + 1, updated_at = NOW() WHERE match_id = $1',
      [match_id]
    );

    // Notify receiver (async)
    notifyNewMessage(message.id).catch(function(err) {
      console.error('Message notification error:', err);
    });

    // Create in-app notification
    var { createNotification } = require('./matches');
    var sender = await dbGet('SELECT name FROM users WHERE id = $1', [req.user.id]);
    await createNotification(
      receiverId, 'new_message',
      'New message from ' + (sender ? sender.name : 'someone'),
      body.slice(0, 100),
      '/chat.html?match=' + match_id
    );

    res.json({ message: message });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ── POST /api/messages/read/:matchId ── mark thread as read
router.post('/read/:matchId', authenticateToken, async function(req, res) {
  try {
    await dbRun(
      'UPDATE messages SET read_at = NOW() WHERE match_id = $1 AND receiver_id = $2 AND read_at IS NULL',
      [parseInt(req.params.matchId), req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// ── POST /api/messages/schedule ── send calendar meeting invite
router.post('/schedule', authenticateToken, async function(req, res) {
  try {
    var { match_id, proposed_time, duration_minutes, location, notes } = req.body;
    if (!match_id || !proposed_time) {
      return res.status(400).json({ error: 'match_id and proposed_time required' });
    }

    var match = await dbGet(
      "SELECT * FROM event_matches WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2) AND status = 'revealed'",
      [match_id, req.user.id]
    );
    if (!match) return res.status(403).json({ error: 'Cannot schedule with this match' });

    var receiverId = match.user_a_id === req.user.id ? match.user_b_id : match.user_a_id;

    var metadata = {
      proposed_time: proposed_time,
      duration_minutes: duration_minutes || 30,
      location: location || 'TBD',
      notes: notes || ''
    };

    var body = 'Meeting proposal: ' + new Date(proposed_time).toLocaleString() +
               ' (' + (duration_minutes || 30) + ' min)' +
               (location ? ' at ' + location : '');

    var result = await dbRun(
      'INSERT INTO messages (match_id, sender_id, receiver_id, body, message_type, metadata) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [match_id, req.user.id, receiverId, body, 'calendar', JSON.stringify(metadata)]
    );

    // Update match_outcomes
    await dbRun(
      'UPDATE match_outcomes SET meeting_scheduled = TRUE, updated_at = NOW() WHERE match_id = $1',
      [match_id]
    );

    // Email notification
    notifyMeetingProposal(result.rows[0].id).catch(function(err) {
      console.error('Meeting notification error:', err);
    });

    res.json({ message: result.rows[0] });
  } catch (err) {
    console.error('Schedule error:', err);
    res.status(500).json({ error: 'Failed to schedule meeting' });
  }
});

// ══════════════════════════════════════════════════════
// EMAIL NOTIFICATION HELPERS
// ══════════════════════════════════════════════════════

async function notifyNewMessage(messageId) {
  try {
    var { Resend } = require('resend');
    var resend = new Resend(process.env.RESEND_API_KEY);

    var msg = await dbGet('SELECT * FROM messages WHERE id = $1', [messageId]);
    if (!msg) return;

    // Only email on first unread message in thread (don't spam)
    var unreadCount = await dbGet(
      'SELECT COUNT(*) as count FROM messages WHERE match_id = $1 AND receiver_id = $2 AND read_at IS NULL',
      [msg.match_id, msg.receiver_id]
    );
    if (parseInt(unreadCount.count) > 1) return; // Already has unread, skip

    var receiver = await dbGet('SELECT name, email FROM users WHERE id = $1', [msg.receiver_id]);
    var sender = await dbGet('SELECT name FROM users WHERE id = $1', [msg.sender_id]);
    if (!receiver || !sender) return;

    var appUrl = process.env.APP_URL || 'https://eventmedium.ai';

    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'nev@eventmedium.ai',
      to: receiver.email,
      subject: 'New message from ' + sender.name,
      html: '<p>Hi ' + receiver.name + ',</p>' +
            '<p><strong>' + sender.name + '</strong> sent you a message:</p>' +
            '<blockquote>' + msg.body.slice(0, 200) + '</blockquote>' +
            '<p><a href="' + appUrl + '/chat.html?match=' + msg.match_id + '">Reply →</a></p>' +
            '<p>— Nev</p>'
    });
  } catch (err) {
    console.error('notifyNewMessage error:', err);
  }
}

async function notifyMeetingProposal(messageId) {
  try {
    var { Resend } = require('resend');
    var resend = new Resend(process.env.RESEND_API_KEY);

    var msg = await dbGet('SELECT * FROM messages WHERE id = $1', [messageId]);
    if (!msg) return;

    var receiver = await dbGet('SELECT name, email FROM users WHERE id = $1', [msg.receiver_id]);
    var sender = await dbGet('SELECT name FROM users WHERE id = $1', [msg.sender_id]);
    if (!receiver || !sender) return;

    var meta = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : (msg.metadata || {});
    var appUrl = process.env.APP_URL || 'https://eventmedium.ai';

    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'nev@eventmedium.ai',
      to: receiver.email,
      subject: sender.name + ' wants to meet',
      html: '<p>Hi ' + receiver.name + ',</p>' +
            '<p><strong>' + sender.name + '</strong> proposed a meeting:</p>' +
            '<p>When: ' + new Date(meta.proposed_time).toLocaleString() + '</p>' +
            '<p>Duration: ' + (meta.duration_minutes || 30) + ' minutes</p>' +
            (meta.location ? '<p>Where: ' + meta.location + '</p>' : '') +
            (meta.notes ? '<p>Notes: ' + meta.notes + '</p>' : '') +
            '<p><a href="' + appUrl + '/chat.html?match=' + msg.match_id + '">Respond →</a></p>' +
            '<p>— Nev</p>'
    });
  } catch (err) {
    console.error('notifyMeetingProposal error:', err);
  }
}

module.exports = { router, notifyNewMessage, notifyMeetingProposal };
