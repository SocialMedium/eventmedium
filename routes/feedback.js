var express = require('express');
var router = express.Router();
var { dbGet, dbRun, dbAll } = require('../db');
var { authenticateToken } = require('../middleware/auth');

// Admin check
function adminOnly(req, res, next) {
  if (req.user.id != 2) return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── POST /api/feedback — public, no auth required ──
router.post('/feedback', async function(req, res) {
  try {
    var message = (req.body.message || '').trim();
    var category = req.body.category || 'general';
    var page_context = req.body.page_context || null;

    if (!message || message.length < 3) {
      return res.status(400).json({ error: 'Feedback message required' });
    }

    // Get user_id if logged in (optional)
    var user_id = null;
    var authHeader = req.headers.authorization;
    if (authHeader && authHeader.indexOf('Bearer ') === 0) {
      try {
        var token = authHeader.split(' ')[1];
        var session = await dbGet('SELECT user_id FROM sessions WHERE token = $1 AND expires_at > NOW()', [token]);
        user_id = session ? session.user_id : null;
      } catch(e) { /* anonymous is fine */ }
    }

    await dbRun(
      'INSERT INTO feedback (user_id, category, message, page_context, user_agent) VALUES ($1, $2, $3, $4, $5)',
      [user_id, category, message, page_context, req.headers['user-agent'] || null]
    );

    // Critical keyword detection — send immediate email alert
    var criticalKeywords = ['broken', 'crash', 'error', 'cant login', "can't login", 'lost', 'deleted', 'missing', 'not working', 'failed', 'bug', 'urgent'];
    var isCritical = criticalKeywords.some(function(kw) {
      return message.toLowerCase().indexOf(kw) !== -1;
    });

    if (isCritical && process.env.RESEND_API_KEY) {
      try {
        var Resend = require('resend').Resend;
        var resend = new Resend(process.env.RESEND_API_KEY);
        var adminEmail = process.env.ADMIN_EMAIL || 'jt@socialmedium.ai';
        await resend.emails.send({
          from: 'EventMedium Alerts <nev@eventmedium.ai>',
          to: adminEmail,
          subject: '[CRITICAL FEEDBACK] ' + message.substring(0, 60) + (message.length > 60 ? '...' : ''),
          html: '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:20px">' +
            '<h2 style="color:#dc2626">Critical Feedback Alert</h2>' +
            '<p><strong>From:</strong> ' + (user_id ? 'User #' + user_id : 'Anonymous') + '</p>' +
            '<p><strong>Category:</strong> ' + category + '</p>' +
            '<p><strong>Page:</strong> ' + (page_context || 'unknown') + '</p>' +
            '<p><strong>Message:</strong></p>' +
            '<blockquote style="background:#f9f9f7;padding:12px 16px;border-left:3px solid #dc2626;font-size:15px;color:#1a1d29">' + message + '</blockquote>' +
            '<p style="margin-top:20px"><a href="https://www.eventmedium.ai/admin-dashboard.html" style="background:#1a1d29;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">View admin dashboard</a></p>' +
            '</div>'
        });
      } catch(emailErr) {
        console.error('[Feedback] Critical alert email error:', emailErr.message);
      }
    }

    res.json({ success: true, message: 'Feedback received \u2014 thank you.' });
  } catch(err) {
    console.error('[Feedback] Submit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/feedback — admin only ──
router.get('/admin/feedback', authenticateToken, adminOnly, async function(req, res) {
  try {
    var status = req.query.status;
    var limit = parseInt(req.query.limit) || 50;
    var sql = 'SELECT f.*, u.name as user_name, u.email as user_email FROM feedback f LEFT JOIN users u ON u.id = f.user_id';
    var params = [];
    if (status) {
      sql += ' WHERE f.status = $1';
      params.push(status);
    }
    sql += ' ORDER BY f.created_at DESC LIMIT ' + limit;
    var items = await dbAll(sql, params);
    res.json({ success: true, feedback: items });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/admin/feedback/:id — update status/notes ──
router.patch('/admin/feedback/:id', authenticateToken, adminOnly, async function(req, res) {
  try {
    var severity = req.body.severity;
    var status = req.body.status;
    var admin_notes = req.body.admin_notes;
    await dbRun(
      'UPDATE feedback SET severity = COALESCE($1, severity), status = COALESCE($2, status), admin_notes = COALESCE($3, admin_notes), updated_at = NOW() WHERE id = $4',
      [severity, status, admin_notes, req.params.id]
    );
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
