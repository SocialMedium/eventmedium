var express = require('express');
var { dbGet, dbRun, dbAll } = require('../db');
var { authenticateToken } = require('../middleware/auth');

var router = express.Router();

// ══════════════════════════════════════════════════
// GET /api/privacy/my-data
// GDPR Article 15 — Right of Access
// Returns everything we hold on this user as JSON
// ══════════════════════════════════════════════════
router.get('/my-data', authenticateToken, async function(req, res) {
  try {
    var userId = req.user.id;

    // Core identity
    var user = await dbGet(
      'SELECT id, name, email, company, avatar_url, auth_provider, created_at FROM users WHERE id = $1',
      [userId]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Canister / profile
    var profile = await dbGet(
      'SELECT stakeholder_type, themes, focus_text, geography, intent, offering, deal_details, created_at, updated_at FROM stakeholder_profiles WHERE user_id = $1',
      [userId]
    );

    // Event registrations
    var registrations = await dbAll(
      `SELECT er.event_id, e.name as event_name, e.event_date, er.status, er.created_at
       FROM event_registrations er
       LEFT JOIN events e ON e.id = er.event_id
       WHERE er.user_id = $1
       ORDER BY er.created_at DESC`,
      [userId]
    );

    // Matches (as either side)
    var matches = await dbAll(
      `SELECT em.id, em.event_id, e.name as event_name,
              em.score_total, em.score_theme, em.score_intent, em.score_stakeholder,
              em.score_capital, em.score_signal_convergence,
              em.match_reasons, em.status,
              em.user_a_decision, em.user_b_decision,
              em.created_at, em.revealed_at,
              CASE WHEN em.user_a_id = $1 THEN 'user_a' ELSE 'user_b' END as my_side
       FROM event_matches em
       LEFT JOIN events e ON e.id = em.event_id
       WHERE em.user_a_id = $1 OR em.user_b_id = $1
       ORDER BY em.created_at DESC`,
      [userId]
    );

    // Match feedback I gave
    var feedback = await dbAll(
      `SELECT mf.match_id, mf.rating, mf.did_meet, mf.meeting_quality, mf.outcome_type, mf.created_at
       FROM match_feedback mf
       WHERE mf.user_id = $1
       ORDER BY mf.created_at DESC`,
      [userId]
    );

    // Feedback insights
    var insights = await dbAll(
      `SELECT fi.match_id, fi.insight_type, fi.insight_data, fi.confidence, fi.created_at
       FROM feedback_insights fi
       WHERE fi.user_id = $1
       ORDER BY fi.created_at DESC`,
      [userId]
    );

    // Nev conversations
    var nevMessages = await dbAll(
      `SELECT ndm.match_id, ndm.role, ndm.content, ndm.created_at
       FROM nev_debrief_messages ndm
       WHERE ndm.user_id = $1
       ORDER BY ndm.created_at ASC`,
      [userId]
    );

    // Notifications
    var notifications = await dbAll(
      `SELECT type, title, body, link, read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    // Sessions (active)
    var sessions = await dbAll(
      `SELECT created_at, expires_at FROM sessions WHERE user_id = $1`,
      [userId]
    );

    var exportData = {
      exported_at: new Date().toISOString(),
      data_controller: {
        name: 'EventMedium.ai',
        contact: 'privacy@eventmedium.ai',
        purpose: 'Signal-driven networking matching at events'
      },
      your_data: {
        account: user,
        canister: profile || null,
        event_registrations: registrations,
        matches: matches,
        feedback_given: feedback,
        feedback_insights: insights,
        nev_conversations: nevMessages,
        notifications: notifications,
        active_sessions: sessions.length
      }
    };

    // Set headers for download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="eventmedium-my-data-' + userId + '.json"');
    res.json(exportData);

  } catch (err) {
    console.error('Data export error:', err);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// ══════════════════════════════════════════════════
// GET /api/privacy/summary
// Quick summary of what we hold (for the UI)
// ══════════════════════════════════════════════════
router.get('/summary', authenticateToken, async function(req, res) {
  try {
    var userId = req.user.id;

    var user = await dbGet('SELECT name, email, auth_provider, created_at FROM users WHERE id = $1', [userId]);
    var hasProfile = await dbGet('SELECT 1 FROM stakeholder_profiles WHERE user_id = $1', [userId]);
    var regCount = await dbGet('SELECT COUNT(*)::int as count FROM event_registrations WHERE user_id = $1', [userId]);
    var matchCount = await dbGet('SELECT COUNT(*)::int as count FROM event_matches WHERE user_a_id = $1 OR user_b_id = $1', [userId]);
    var nevCount = await dbGet('SELECT COUNT(*)::int as count FROM nev_debrief_messages WHERE user_id = $1', [userId]);
    var feedbackCount = await dbGet('SELECT COUNT(*)::int as count FROM match_feedback WHERE user_id = $1', [userId]);
    var notifCount = await dbGet('SELECT COUNT(*)::int as count FROM notifications WHERE user_id = $1', [userId]);

    res.json({
      account: {
        name: user ? user.name : null,
        email: user ? user.email : null,
        auth_provider: user ? user.auth_provider : null,
        member_since: user ? user.created_at : null
      },
      data_held: {
        canister_profile: hasProfile ? true : false,
        event_registrations: regCount ? regCount.count : 0,
        matches: matchCount ? matchCount.count : 0,
        nev_messages: nevCount ? nevCount.count : 0,
        feedback_entries: feedbackCount ? feedbackCount.count : 0,
        notifications: notifCount ? notifCount.count : 0
      }
    });
  } catch (err) {
    console.error('Privacy summary error:', err);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

// ══════════════════════════════════════════════════
// DELETE /api/privacy/delete-account
// GDPR Article 17 — Right to Erasure
// Cascading deletion of ALL user data
// Requires confirmation token in body
// ══════════════════════════════════════════════════
router.delete('/delete-account', authenticateToken, async function(req, res) {
  try {
    var userId = req.user.id;
    var confirmation = req.body.confirmation;

    if (confirmation !== 'DELETE_MY_ACCOUNT') {
      return res.status(400).json({
        error: 'Confirmation required',
        message: 'Send { "confirmation": "DELETE_MY_ACCOUNT" } to confirm'
      });
    }

    var user = await dbGet('SELECT email FROM users WHERE id = $1', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    console.log('GDPR DELETION: Starting for user', userId, user.email);

    // ── Cascade delete in dependency order ──

    // 1. Nev debrief messages
    await dbRun('DELETE FROM nev_debrief_messages WHERE user_id = $1', [userId]);

    // 2. Feedback insights (linked to matches)
    await dbRun('DELETE FROM feedback_insights WHERE user_id = $1', [userId]);

    // 3. Match feedback
    await dbRun('DELETE FROM match_feedback WHERE user_id = $1', [userId]);

    // 4. Notifications
    await dbRun('DELETE FROM notifications WHERE user_id = $1', [userId]);

    // 5. Event matches (either side) — delete the whole match record
    await dbRun('DELETE FROM event_matches WHERE user_a_id = $1 OR user_b_id = $1', [userId]);

    // 6. Event registrations
    await dbRun('DELETE FROM event_registrations WHERE user_id = $1', [userId]);

    // 7. Stakeholder profile (canister)
    await dbRun('DELETE FROM stakeholder_profiles WHERE user_id = $1', [userId]);

    // 8. Sessions
    await dbRun('DELETE FROM sessions WHERE user_id = $1', [userId]);

    // 9. Magic codes
    await dbRun('DELETE FROM magic_codes WHERE email = $1', [user.email]);

    // 10. User record — last
    await dbRun('DELETE FROM users WHERE id = $1', [userId]);

    console.log('GDPR DELETION: Complete for user', userId);

    res.json({
      ok: true,
      message: 'All your data has been permanently deleted',
      deleted_at: new Date().toISOString()
    });

  } catch (err) {
    console.error('GDPR deletion error:', err);
    res.status(500).json({ error: 'Deletion failed — contact privacy@eventmedium.ai' });
  }
});

module.exports = router;
