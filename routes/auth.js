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
