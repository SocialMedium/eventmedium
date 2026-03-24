var express = require('express');
var router  = express.Router();
var emc2    = require('../lib/emc2.js');
var db      = require('../db/index.js');
var { authenticateToken } = require('../middleware/auth');

// GET /api/emc2/wallet — user's own wallet
router.get('/wallet', authenticateToken, async function(req, res) {
  try {
    var wallet = await emc2.getWallet(req.user.id);
    res.json({ success: true, wallet: wallet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/emc2/history — transaction history
router.get('/history', authenticateToken, async function(req, res) {
  try {
    var limit   = parseInt(req.query.limit) || 20;
    var history = await emc2.getHistory(req.user.id, limit);
    res.json({ success: true, history: history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/emc2/unlock-global — legacy endpoint, access is now universal
router.post('/unlock-global', authenticateToken, async function(req, res) {
  res.json({
    success: true,
    message: 'Access is universal. EMC\u00B2 is spent per accepted match based on context: community matches are free, event and location matches cost 5 EMC\u00B2, global network matches cost 10 EMC\u00B2.'
  });
});

// POST /api/emc2/connect-wallet — store web3 wallet address
router.post('/connect-wallet', authenticateToken, async function(req, res) {
  try {
    var wallet_address = req.body.wallet_address;
    var chain_id = req.body.chain_id;
    await db.dbRun(
      "INSERT INTO emc2_wallets (user_id, wallet_address, chain_id, connected_at, verified) VALUES ($1, $2, $3, NOW(), FALSE) ON CONFLICT (user_id) DO UPDATE SET wallet_address = $2, chain_id = $3, connected_at = NOW()",
      [req.user.id, wallet_address, chain_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/emc2/community/:id/nodes — community owner view
router.get('/community/:id/nodes', authenticateToken, async function(req, res) {
  try {
    // Verify requester is community owner
    var community = await db.dbGet(
      'SELECT * FROM communities WHERE id = $1 AND owner_id = $2',
      [req.params.id, req.user.id]
    );
    if (!community) {
      return res.status(403).json({ error: 'Not authorised' });
    }

    var nodes = await emc2.getCommunityNodeHealth(req.params.id);
    res.json({ success: true, nodes: nodes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/emc2/community/:id/award — owner awards member
router.post('/community/:id/award', authenticateToken, async function(req, res) {
  try {
    var recipient_user_id = req.body.recipient_user_id;
    var amount = req.body.amount;
    var reason = req.body.reason;

    var community = await db.dbGet(
      'SELECT * FROM communities WHERE id = $1 AND owner_id = $2',
      [req.params.id, req.user.id]
    );
    if (!community) {
      return res.status(403).json({ error: 'Not authorised' });
    }

    var result = await emc2.communityOwnerAward({
      owner_user_id:     req.user.id,
      recipient_user_id: recipient_user_id,
      community_id:      parseInt(req.params.id),
      amount:            amount,
      reason:            reason
    });

    res.json({ success: true, result: result });
  } catch (err) {
    if (err.message === 'INSUFFICIENT_COMMUNITY_POOL') {
      return res.status(402).json({
        error: 'Insufficient community award pool'
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/emc2/community/:id/multiplier — set earn multiplier
router.post('/community/:id/multiplier', authenticateToken, async function(req, res) {
  try {
    var action_type = req.body.action_type;
    var multiplier_value = req.body.multiplier_value;
    var starts = req.body.starts;
    var ends = req.body.ends;

    var community = await db.dbGet(
      'SELECT * FROM communities WHERE id = $1 AND owner_id = $2',
      [req.params.id, req.user.id]
    );
    if (!community) {
      return res.status(403).json({ error: 'Not authorised' });
    }

    await db.dbRun(
      "INSERT INTO community_emc2_config (community_id, multiplier_active, multiplier_value, multiplier_action, multiplier_starts, multiplier_ends) VALUES ($1, TRUE, $2, $3, $4, $5) ON CONFLICT (community_id) DO UPDATE SET multiplier_active = TRUE, multiplier_value = $2, multiplier_action = $3, multiplier_starts = $4, multiplier_ends = $5, updated_at = NOW()",
      [req.params.id, multiplier_value, action_type, starts, ends]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/emc2/verify — integrity check (admin/audit)
router.get('/verify', authenticateToken, async function(req, res) {
  try {
    var result = await emc2.verifyLedgerIntegrity(req.user.id);
    res.json({ success: true, valid: result.valid, tx_count: result.tx_count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
