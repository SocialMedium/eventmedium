var express = require('express');
var crypto = require('crypto');
var bcrypt = require('bcryptjs');
var { dbGet, dbRun } = require('../db');
var { authenticateToken } = require('../middleware/auth');

var router = express.Router();

// ── Helper: create session token ──
async function createSession(userId) {
  var token = crypto.randomBytes(32).toString('hex');
  var expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await dbRun(
    'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expires]
  );
  return token;
}

// ── POST /api/auth/signup ──
router.post('/signup', async function(req, res) {
  try {
    var { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    var existing = await dbGet('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    var passwordHash = await bcrypt.hash(password, 12);
    var result = await dbRun(
      'INSERT INTO users (name, email, password_hash, auth_provider) VALUES ($1, $2, $3, $4) RETURNING id',
      [name.trim(), email.toLowerCase().trim(), passwordHash, 'email']
    );
    var userId = result.rows[0].id;
    var token = await createSession(userId);

    res.json({ token, user: { id: userId, name: name.trim(), email: email.toLowerCase().trim() } });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// ── POST /api/auth/login ──
router.post('/login', async function(req, res) {
  try {
    var { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    var user = await dbGet(
      'SELECT id, name, email, password_hash, auth_provider FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!user.password_hash) {
      return res.status(401).json({ error: 'This account uses ' + user.auth_provider + ' login' });
    }

    var valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    var token = await createSession(user.id);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ══════════════════════════════════════════════════
// MAGIC LINK (6-digit code via email)
// Bypasses OAuth — works for corp Google Workspace
// ══════════════════════════════════════════════════

// POST /api/auth/magic-send — send 6-digit code
router.post('/magic-send', async function(req, res) {
  try {
    var email = (req.body.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    // Generate 6-digit code
    var code = Math.floor(100000 + Math.random() * 900000).toString();
    var expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Ensure magic_codes table exists
    await dbRun(`
      CREATE TABLE IF NOT EXISTS magic_codes (
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Clear old codes for this email
    await dbRun('DELETE FROM magic_codes WHERE email = $1', [email]);

    // Store code
    await dbRun(
      'INSERT INTO magic_codes (email, code, expires_at) VALUES ($1, $2, $3)',
      [email, code, expiresAt]
    );

    // Send via Resend
    var Resend;
    try { Resend = require('resend'); } catch(e) {
      console.error('Resend not installed');
      return res.status(500).json({ error: 'Email service not configured' });
    }
    var resend = new Resend.Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'nev@eventmedium.ai',
      to: email,
      subject: 'Your Event Medium sign-in code: ' + code,
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:40px 24px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:32px">
            <div style="width:28px;height:28px;border-radius:6px;background:linear-gradient(135deg,#6366f1,#4f46e5)"></div>
            <span style="font-size:16px;font-weight:700;color:#1a1a2e">Event <span style="color:#6366f1">Medium</span></span>
          </div>
          <h1 style="font-size:22px;font-weight:700;color:#1a1a2e;margin-bottom:8px">Your sign-in code</h1>
          <p style="font-size:14px;color:#555;margin-bottom:24px">Enter this code to sign in. It expires in 10 minutes.</p>
          <div style="background:linear-gradient(135deg,rgba(99,102,241,0.08),rgba(79,70,229,0.04));border:1px solid rgba(99,102,241,0.2);border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
            <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#6366f1;font-family:ui-monospace,monospace">${code}</span>
          </div>
          <p style="font-size:12px;color:#999">If you didn't request this code, you can safely ignore this email.</p>
          <div style="margin-top:32px;padding-top:16px;border-top:1px solid rgba(0,0,0,0.06);font-size:11px;color:#999">
            EventMedium.ai · Signal-driven networking
          </div>
        </div>
      `
    });

    console.log('Magic code sent to', email);
    res.json({ ok: true, message: 'Code sent' });
  } catch (err) {
    console.error('Magic send error:', err);
    res.status(500).json({ error: 'Failed to send code' });
  }
});

// POST /api/auth/magic-verify — verify code, create/find user, return token
router.post('/magic-verify', async function(req, res) {
  try {
    var email = (req.body.email || '').toLowerCase().trim();
    var code = (req.body.code || '').trim();

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code required' });
    }

    // Look up valid code
    var record = await dbGet(
      'SELECT * FROM magic_codes WHERE email = $1 AND code = $2 AND used = false AND expires_at > NOW()',
      [email, code]
    );

    if (!record) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    // Mark code as used
    await dbRun('UPDATE magic_codes SET used = true WHERE email = $1 AND code = $2', [email, code]);

    // Find or create user
    var user = await dbGet('SELECT id, name, email FROM users WHERE email = $1', [email]);

    if (!user) {
      // New user — create account
      var namePart = email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
      var result = await dbRun(
        'INSERT INTO users (name, email, auth_provider) VALUES ($1, $2, $3) RETURNING id',
        [namePart, email, 'magic']
      );
      user = { id: result.rows[0].id, name: namePart, email: email };
    }

    var token = await createSession(user.id);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email }, isNew: !user.name });
  } catch (err) {
    console.error('Magic verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ── POST /api/auth/logout ──
router.post('/logout', authenticateToken, async function(req, res) {
  try {
    var token = req.headers.authorization.replace('Bearer ', '');
    await dbRun('DELETE FROM sessions WHERE token = $1', [token]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ── GET /api/auth/me ── (check current session)
router.get('/me', authenticateToken, async function(req, res) {
  try {
    var user = await dbGet(
      'SELECT id, name, email, company, avatar_url, role, tier FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    console.error('Auth check error:', err);
    res.status(500).json({ error: 'Auth check failed' });
  }
});

// Export both router and createSession (needed by OAuth routes)
module.exports = { router, createSession };