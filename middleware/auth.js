var { dbGet } = require('../db');

async function authenticateToken(req, res, next) {
  var authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });

  var token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    var session = await dbGet(
      'SELECT user_id FROM sessions WHERE token = $1 AND expires_at > NOW()',
      [token]
    );
    if (!session) return res.status(401).json({ error: 'Invalid or expired token' });

    req.user = { id: session.user_id };
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Auth check failed' });
  }
}

// Optional auth — sets req.user if valid token exists, but doesn't block
async function optionalAuth(req, res, next) {
  var authHeader = req.headers.authorization;
  if (!authHeader) return next();

  var token = authHeader.replace('Bearer ', '');
  if (!token) return next();

  try {
    var session = await dbGet(
      'SELECT user_id FROM sessions WHERE token = $1 AND expires_at > NOW()',
      [token]
    );
    if (session) req.user = { id: session.user_id };
  } catch (err) {
    // Silent fail for optional auth
  }
  next();
}

module.exports = { authenticateToken, optionalAuth };
