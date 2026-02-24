require('dotenv').config();

var express = require('express');
var helmet = require('helmet');
var cors = require('cors');
var rateLimit = require('express-rate-limit');
var path = require('path');
var { pool } = require('./db');
var { initCollections } = require('./lib/vector_search');

var app = express();
var PORT = process.env.PORT || 3000;

// ── Security ──
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.APP_URL || 'http://localhost:3000',
  credentials: true
}));

// ── Rate limiting ──
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, try again later' }
}));

// ── Body parsing ──
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Static files ──
app.use(express.static(path.join(__dirname, 'public')));

// ── Health check ──
app.get('/health', async function(req, res) {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

// ── Routes ──

// Auth (email + session tokens)
app.use('/api/auth', require('./routes/auth').router);

// OAuth (Google + LinkedIn → session tokens, NEVER JWT)
app.use('/api/auth', require('./routes/oauth').router);

// Stakeholder profiles (canisters)
app.use('/api/stakeholder', require('./routes/stakeholder').router);

// Events
app.use('/api/events', require('./routes/events').router);

// Signals (ingestion, search, source-specific endpoints)
app.use('/api/signals', require('./routes/signals').router);

// Matching engine
app.use('/api/matches', require('./routes/matches').router);

// Nev (AI concierge)
app.use('/api/nev', require('./routes/nev').router);

// Messaging
app.use('/api/messages', require('./routes/messages').router);

// Notifications
app.use('/api/notifications', require('./routes/notifications').router);

app.use('/api/admin', require('./routes/dashboard').router);

// ── Landing page ──
app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── 404 ──
app.use(function(req, res) {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).send('Not found');
});

// ── Error handler ──
app.use(function(err, req, res, next) {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──
app.listen(PORT, async function() {
  console.log('Event Medium running on port ' + PORT);
  console.log('Environment: ' + (process.env.NODE_ENV || 'development'));
  if (process.env.QDRANT_URL && process.env.QDRANT_API_KEY) {
    await initCollections();
  } else {
    console.log('Qdrant not configured — skipping collection init');
  }
});
