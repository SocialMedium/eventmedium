var express = require('express');
var { OAuth2Client } = require('google-auth-library');
var { dbGet, dbRun } = require('../db');
var { createSession } = require('./auth');

var router = express.Router();

// ══════════════════════════════════════════════════════
// GOOGLE OAUTH
// ══════════════════════════════════════════════════════

function getGoogleClient() {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    (process.env.APP_URL || 'http://localhost:3000') + '/api/auth/google/callback'
  );
}

// ── GET /api/auth/google ── redirect to Google consent screen
router.get('/google', function(req, res) {
  var client = getGoogleClient();
  var url = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['email', 'profile', 'openid'],
    prompt: 'select_account'
  });
  res.redirect(url);
});

// ── GET /api/auth/google/callback ── handle Google OAuth response
router.get('/google/callback', async function(req, res) {
  try {
    var code = req.query.code;
    if (!code) return res.redirect('/auth.html?error=no_code');

    var client = getGoogleClient();
    var { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Get user info
    var resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': 'Bearer ' + tokens.access_token }
    });
    var profile = await resp.json();

    if (!profile.email) return res.redirect('/auth.html?error=no_email');

    // Find or create user
    var user = await dbGet('SELECT * FROM users WHERE email = $1', [profile.email.toLowerCase()]);

    if (!user) {
      var result = await dbRun(
        `INSERT INTO users (name, email, avatar_url, auth_provider, google_id, email_verified)
         VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING *`,
        [profile.name || profile.email, profile.email.toLowerCase(), profile.picture, 'google', profile.id]
      );
      user = result.rows[0];
    } else {
      // Update google_id and avatar if not set
      await dbRun(
        'UPDATE users SET google_id = COALESCE(google_id, $1), avatar_url = COALESCE(avatar_url, $2), email_verified = TRUE WHERE id = $3',
        [profile.id, profile.picture, user.id]
      );
    }

    // Create session token — SAME mechanism as email login. NEVER JWT.
    var token = await createSession(user.id);

    // Redirect to auth page with token
    res.redirect('/auth.html?token=' + token);
  } catch (err) {
    console.error('Google OAuth error:', err);
    res.redirect('/auth.html?error=oauth_failed');
  }
});

// ══════════════════════════════════════════════════════
// LINKEDIN OAUTH
// ══════════════════════════════════════════════════════

var LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
var LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
var LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';

// ── GET /api/auth/linkedin ── redirect to LinkedIn consent screen
router.get('/linkedin', function(req, res) {
  var redirectUri = (process.env.APP_URL || 'http://localhost:3000') + '/api/auth/linkedin/callback';
  var params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.LINKEDIN_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile email'
  });
  res.redirect(LINKEDIN_AUTH_URL + '?' + params.toString());
});

// ── GET /api/auth/linkedin/callback ──
router.get('/linkedin/callback', async function(req, res) {
  try {
    var code = req.query.code;
    if (!code) return res.redirect('/auth.html?error=no_code');

    var redirectUri = (process.env.APP_URL || 'http://localhost:3000') + '/api/auth/linkedin/callback';

    // Exchange code for token
    var tokenResp = await fetch(LINKEDIN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET
      })
    });

    var tokenData = await tokenResp.json();
    if (!tokenData.access_token) {
      console.error('LinkedIn token error:', tokenData);
      return res.redirect('/auth.html?error=token_failed');
    }

    // Get user info via OpenID Connect userinfo endpoint
    var profileResp = await fetch(LINKEDIN_USERINFO_URL, {
      headers: { 'Authorization': 'Bearer ' + tokenData.access_token }
    });
    var profile = await profileResp.json();

    if (!profile.email) return res.redirect('/auth.html?error=no_email');

    // Find or create user
    var user = await dbGet('SELECT * FROM users WHERE email = $1', [profile.email.toLowerCase()]);

    if (!user) {
      var result = await dbRun(
        `INSERT INTO users (name, email, avatar_url, auth_provider, linkedin_id, email_verified)
         VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING *`,
        [profile.name || profile.email, profile.email.toLowerCase(), profile.picture, 'linkedin', profile.sub]
      );
      user = result.rows[0];
    } else {
      await dbRun(
        'UPDATE users SET linkedin_id = COALESCE(linkedin_id, $1), avatar_url = COALESCE(avatar_url, $2), email_verified = TRUE WHERE id = $3',
        [profile.sub, profile.picture, user.id]
      );
    }

    // Session token — SAME mechanism. NEVER JWT.
    var token = await createSession(user.id);
    res.redirect('/auth.html?token=' + token);
  } catch (err) {
    console.error('LinkedIn OAuth error:', err);
    res.redirect('/auth.html?error=oauth_failed');
  }
});

module.exports = { router };
