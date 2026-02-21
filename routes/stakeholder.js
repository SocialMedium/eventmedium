var express = require('express');
var { dbGet, dbRun, dbAll } = require('../db');
var { authenticateToken } = require('../middleware/auth');
var { normalizeThemes } = require('../lib/theme_taxonomy');
var { embedProfile } = require('../lib/vector_search');

var router = express.Router();

// ── GET /api/stakeholder/profile ── (current user's canister)
router.get('/profile', authenticateToken, async function(req, res) {
  try {
    var profile = await dbGet(
      'SELECT sp.*, u.name, u.email, u.company, u.avatar_url FROM stakeholder_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.user_id = $1',
      [req.user.id]
    );
    if (!profile) return res.json({ profile: null });
    res.json({ profile: profile });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// ── GET /api/stakeholder/profile/:userId ── (another user's profile, privacy-filtered)
router.get('/profile/:userId', authenticateToken, async function(req, res) {
  try {
    var userId = parseInt(req.params.userId);
    // Only return public-safe fields
    var profile = await dbGet(
      'SELECT sp.stakeholder_type, sp.themes, sp.focus_text, sp.geography, u.name, u.company, u.avatar_url FROM stakeholder_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.user_id = $1',
      [userId]
    );
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json({ profile: profile });
  } catch (err) {
    console.error('Get user profile error:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// ── POST /api/stakeholder/profile ── (create or update canister + embed in Qdrant)
router.post('/profile', authenticateToken, async function(req, res) {
  try {
    var {
      stakeholder_type, themes, focus_text, intent, offering,
      context, deal_details, geography, onboarding_method
    } = req.body;

    // Normalize themes
    var rawThemes = themes || [];
    if (typeof rawThemes === 'string') {
      try { rawThemes = JSON.parse(rawThemes); } catch(e) { rawThemes = [rawThemes]; }
    }
    var normalizedThemes = normalizeThemes(rawThemes);

    // Normalize intent/offering arrays
    var intentArr = intent || [];
    if (typeof intentArr === 'string') {
      try { intentArr = JSON.parse(intentArr); } catch(e) { intentArr = [intentArr]; }
    }
    var offeringArr = offering || [];
    if (typeof offeringArr === 'string') {
      try { offeringArr = JSON.parse(offeringArr); } catch(e) { offeringArr = [offeringArr]; }
    }

    // Deal details
    var dealObj = deal_details || {};
    if (typeof dealObj === 'string') {
      try { dealObj = JSON.parse(dealObj); } catch(e) { dealObj = {}; }
    }

    // Check if profile exists
    var existing = await dbGet('SELECT id, canister_version FROM stakeholder_profiles WHERE user_id = $1', [req.user.id]);

    var profile;
    if (existing) {
      // Update
      await dbRun(
        `UPDATE stakeholder_profiles SET
          stakeholder_type = COALESCE($1, stakeholder_type),
          themes = $2,
          focus_text = COALESCE($3, focus_text),
          intent = $4,
          offering = $5,
          context = COALESCE($6, context),
          deal_details = $7,
          geography = COALESCE($8, geography),
          onboarding_method = COALESCE($9, onboarding_method),
          canister_version = $10,
          updated_at = NOW()
        WHERE user_id = $11`,
        [
          stakeholder_type, JSON.stringify(normalizedThemes), focus_text,
          JSON.stringify(intentArr), JSON.stringify(offeringArr),
          context, JSON.stringify(dealObj), geography,
          onboarding_method, (existing.canister_version || 1) + 1,
          req.user.id
        ]
      );
    } else {
      // Insert
      await dbRun(
        `INSERT INTO stakeholder_profiles
          (user_id, stakeholder_type, themes, focus_text, intent, offering, context, deal_details, geography, onboarding_method)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          req.user.id, stakeholder_type, JSON.stringify(normalizedThemes),
          focus_text, JSON.stringify(intentArr), JSON.stringify(offeringArr),
          context, JSON.stringify(dealObj), geography,
          onboarding_method || 'chat'
        ]
      );
    }

    // Also update user_intents
    await dbRun(
      `INSERT INTO user_intents (user_id, intent_types, themes, geography)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         intent_types = $2, themes = $3, geography = $4, updated_at = NOW()`,
      [req.user.id, JSON.stringify(intentArr), JSON.stringify(normalizedThemes), geography]
    );

    // Reload full profile for embedding
    profile = await dbGet('SELECT * FROM stakeholder_profiles WHERE user_id = $1', [req.user.id]);
    var user = await dbGet('SELECT name, company FROM users WHERE id = $1', [req.user.id]);

    // Embed in Qdrant (async, don't block response)
    embedProfile(profile, user).then(function(vectorId) {
      if (vectorId) {
        dbRun('UPDATE stakeholder_profiles SET qdrant_vector_id = $1 WHERE user_id = $2', [vectorId, req.user.id]);
      }
    }).catch(function(err) {
      console.error('Profile embedding error:', err);
    });

    res.json({ profile: profile, embedded: true });
  } catch (err) {
    console.error('Save profile error:', err);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

module.exports = { router };
