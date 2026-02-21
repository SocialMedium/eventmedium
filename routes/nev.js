var express = require('express');
var fs = require('fs');
var path = require('path');
var { dbGet, dbRun } = require('../db');
var { authenticateToken } = require('../middleware/auth');
var { normalizeThemes } = require('../lib/theme_taxonomy');

var router = express.Router();

var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
var MODEL = 'claude-haiku-4-5-20251001';

// ── Load playbook ──
var playbook = {};
try {
  var playbookPath = path.join(__dirname, '..', 'lib', 'nev_playbook.json');
  playbook = JSON.parse(fs.readFileSync(playbookPath, 'utf8'));
  console.log('Nev playbook loaded');
} catch (e) {
  console.warn('No playbook found — Nev will use defaults');
}

// Hot-reload playbook on change (dev convenience)
try {
  var playbookPath = path.join(__dirname, '..', 'lib', 'nev_playbook.json');
  fs.watchFile(playbookPath, { interval: 5000 }, function() {
    try {
      playbook = JSON.parse(fs.readFileSync(playbookPath, 'utf8'));
      console.log('Nev playbook reloaded');
    } catch(e) { console.warn('Playbook reload failed:', e.message); }
  });
} catch(e) {}

// ── Build system prompt with playbook ──
function buildNevSystemPrompt(existingProfile, userName, conversationContext) {
  var base = `You are Nev, the AI concierge for Event Medium — an AI-powered networking platform that matches people at events using signal triangulation.

Your job is to have a natural, warm conversation to understand who this person is, what they're working on, and what connections would be valuable to them. You're building their "private canister" — a persistent profile that is never publicly visible. There is no public directory.

PRIVACY — EMPHASISE THIS NATURALLY:
- Their canister is completely private
- All matching is anonymous and double-blind
- Identities are only revealed when both parties independently consent
- No one can browse or search for them
- Weave this into conversation naturally, e.g. "Don't worry, none of this is public — your canister is private and matching is completely anonymous until both sides opt in"

WHAT YOU NEED TO EXTRACT (through natural conversation, not interrogation):
- stakeholder_type: Are they a founder, investor, researcher, corporate, advisor, or operator?
- themes: What industries, technologies, or markets do they focus on? (will be normalized to canonical themes)
- intent: What are they looking for? (funding, partnerships, talent, customers, research collaborations, market intelligence)
- offering: What do they bring to the table? (capital, expertise, technology, distribution, data, connections)
- context: What's their current situation? (raising a round, launching a product, exploring a pivot, conducting research)
- deal_details: For investors — stage focus, check size, sectors. For founders — what they're raising, stage, sector.
- geography: Where are they based? Where do they operate?`;

  // ── Inject playbook ──
  if (playbook.global_instructions) {
    base += '\n\nEXPERT CONTEXT:\n' + playbook.global_instructions;
  }

  // Inject follow-up patterns based on conversation context
  if (playbook.follow_up_patterns) {
    base += '\n\nFOLLOW-UP PATTERNS BY STAKEHOLDER TYPE:';
    base += '\nUse these expert questions naturally when you identify someone\'s type. Don\'t ask them all — pick the most relevant 1-2 based on what they\'ve shared.';
    
    Object.keys(playbook.follow_up_patterns).forEach(function(type) {
      var pattern = playbook.follow_up_patterns[type];
      base += '\n\nIf ' + pattern.trigger + ':';
      base += '\nSample questions: ' + pattern.questions.slice(0, 4).join(' | ');
      if (pattern.probing_signals) {
        base += '\nProbing signals: ' + pattern.probing_signals.slice(0, 3).join(' | ');
      }
    });
  }

  // Inject theme expertise
  if (playbook.theme_expertise && conversationContext) {
    var mentionedThemes = Object.keys(playbook.theme_expertise).filter(function(theme) {
      return conversationContext.toLowerCase().indexOf(theme.toLowerCase()) !== -1;
    });
    if (mentionedThemes.length) {
      base += '\n\nTHEME-SPECIFIC EXPERTISE (use when relevant):';
      mentionedThemes.forEach(function(theme) {
        var te = playbook.theme_expertise[theme];
        base += '\n' + theme + ': ' + te.smart_questions.join(' | ');
      });
    }
  }

  // Market entry expertise
  if (playbook.market_entry_expertise && conversationContext) {
    var geoTerms = ['international', 'market entry', 'expansion', 'US market', 'Europe', 'APAC', 'Asia', 'Australia'];
    var hasGeo = geoTerms.some(function(t) { return conversationContext.toLowerCase().indexOf(t.toLowerCase()) !== -1; });
    if (hasGeo) {
      base += '\n\nMARKET ENTRY EXPERTISE:\n' + playbook.market_entry_expertise.patterns.join('\n');
    }
  }

  // Deal intelligence
  if (playbook.deal_intelligence && conversationContext) {
    var dealTerms = ['raising', 'funding', 'revenue', 'partnership', 'hiring', 'deploying', 'investing'];
    var hasDeal = dealTerms.some(function(t) { return conversationContext.toLowerCase().indexOf(t.toLowerCase()) !== -1; });
    if (hasDeal) {
      base += '\n\nDEAL INTELLIGENCE:\n' + playbook.deal_intelligence.patterns.join('\n');
    }
  }

  // ── Conversation style ──
  base += `

CONVERSATION STYLE:
- Be genuinely curious, not formulaic
- Ask follow-up questions based on what they share — use the expert patterns above
- Make connections between what they say ("So if you're building in payments and targeting Southeast Asia, you'd probably benefit from meeting regulatory specialists there")
- Be concise — don't write paragraphs. Keep responses to 2-3 sentences max.
- Use their name naturally
- No emojis in your responses
- Never say "That's great!" or "That's interesting!" — show genuine engagement through specific follow-ups
- When someone gives a long voice-to-text response, acknowledge the key points and ask the single most valuable follow-up question rather than trying to address everything

CRITICAL — INCREMENTAL EXTRACTION:
After EVERY response from the user, extract whatever canister fields you can identify so far. Include a partial canister in your response even if incomplete. The frontend builds the canister live as you chat.

Always include this block at the end of every response (even if partially filled):

[CANISTER_READY]
{"stakeholder_type":"...","themes":["..."],"intent":["..."],"offering":["..."],"context":"...","deal_details":{},"geography":"..."}
[/CANISTER_READY]

Use empty strings and empty arrays for fields you haven't identified yet. Update the block with new information as the conversation progresses. The user won't see this block.`;

  // ── Returning user context ──
  if (existingProfile) {
    base += `

IMPORTANT — THIS IS A RETURNING USER:
${userName ? 'Their name is ' + userName + '.' : ''}
Here is their existing canister:
- Type: ${existingProfile.stakeholder_type || 'unknown'}
- Themes: ${JSON.stringify(parseJsonSafe(existingProfile.themes))}
- Focus: ${existingProfile.focus_text || 'not set'}
- Intent: ${JSON.stringify(parseJsonSafe(existingProfile.intent))}
- Offering: ${JSON.stringify(parseJsonSafe(existingProfile.offering))}
- Context: ${existingProfile.context || 'none'}
- Deal details: ${JSON.stringify(existingProfile.deal_details || {})}
- Geography: ${existingProfile.geography || 'unknown'}
- Last updated: ${existingProfile.updated_at || 'unknown'}

Greet them by name and reference what you know. Ask if anything has changed. For example:
"Welcome back, ${userName || 'there'}! Last time we talked you were [context from their canister]. How's that going? Anything new I should know about?"

When they update info, merge it with existing data in the [CANISTER_READY] block — don't lose existing fields.`;
  }

  return base;
}

// ── POST /api/nev/chat ──
router.post('/chat', authenticateToken, async function(req, res) {
  try {
    var { message, conversation } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    // Load user info
    var user = await dbGet('SELECT name, email, company FROM users WHERE id = $1', [req.user.id]);

    // Load existing profile if any
    var existingProfile = await dbGet(
      'SELECT * FROM stakeholder_profiles WHERE user_id = $1',
      [req.user.id]
    );

    // Build conversation context from history (for playbook matching)
    var conversationContext = message;
    if (conversation && Array.isArray(conversation)) {
      conversationContext = conversation.map(function(m) { return m.content; }).join(' ') + ' ' + message;
    }

    // Build messages for Anthropic format
    var systemPrompt = buildNevSystemPrompt(existingProfile, user ? user.name : null, conversationContext);

    var anthropicMessages = [];
    if (conversation && Array.isArray(conversation)) {
      conversation.forEach(function(msg) {
        anthropicMessages.push({ role: msg.role, content: msg.content });
      });
    }
    anthropicMessages.push({ role: 'user', content: message });

    // Call Anthropic
    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        system: systemPrompt,
        messages: anthropicMessages,
        max_tokens: 600,
        temperature: 0.7
      })
    });

    if (!resp.ok) {
      var errText = await resp.text();
      console.error('Anthropic error:', resp.status, errText);
      return res.status(500).json({ error: 'AI service error' });
    }

    var data = await resp.json();
    var reply = data.content[0].text;

    // Extract canister data
    var canisterData = null;
    var canisterMatch = reply.match(/\[CANISTER_READY\]([\s\S]*?)\[\/CANISTER_READY\]/);
    if (canisterMatch) {
      try {
        canisterData = JSON.parse(canisterMatch[1].trim());

        // Normalize themes
        if (canisterData.themes) {
          canisterData.themes = normalizeThemes(canisterData.themes);
        }

        // Clean empty values for frontend
        if (canisterData.stakeholder_type === '...') canisterData.stakeholder_type = '';
        if (canisterData.context === '...') canisterData.context = '';
        if (canisterData.geography === '...') canisterData.geography = '';
        if (canisterData.themes && canisterData.themes[0] === '...') canisterData.themes = [];
        if (canisterData.intent && canisterData.intent[0] === '...') canisterData.intent = [];
        if (canisterData.offering && canisterData.offering[0] === '...') canisterData.offering = [];
      } catch(e) {
        console.error('Failed to parse canister JSON:', e);
      }

      // Strip the canister block from the visible reply
      reply = reply.replace(/\[CANISTER_READY\][\s\S]*?\[\/CANISTER_READY\]/, '').trim();
    }

    res.json({
      reply: reply,
      canister_data: canisterData
    });
  } catch (err) {
    console.error('Nev chat error:', err);
    res.status(500).json({ error: 'Chat failed' });
  }
});

// ── POST /api/nev/opening ── get Nev's opening message
router.post('/opening', authenticateToken, async function(req, res) {
  try {
    var user = await dbGet('SELECT name FROM users WHERE id = $1', [req.user.id]);
    var existingProfile = await dbGet(
      'SELECT * FROM stakeholder_profiles WHERE user_id = $1',
      [req.user.id]
    );

    var opening;
    if (existingProfile && user) {
      var context = existingProfile.context || existingProfile.focus_text || '';
      var themes = parseJsonSafe(existingProfile.themes).join(', ');
      opening = 'Welcome back, ' + user.name + '!';
      if (context) {
        opening += ' Last time we talked, you mentioned ' + context.slice(0, 100) + '.';
      } else if (themes) {
        opening += ' Good to see you again — still focused on ' + themes + '?';
      }
      opening += ' Anything new I should know about?';
    } else if (user) {
      opening = 'Hey ' + user.name + '! I\'m Nev, your networking concierge. I\'m going to ask you a few questions so I can find the right people for you at events. Let\'s start simple — what do you do, and what are you working on right now?';
    } else {
      opening = 'Hey there! I\'m Nev, your networking concierge. Tell me a bit about yourself — what do you do, and what are you working on?';
    }

    res.json({ reply: opening, is_returning: !!existingProfile });
  } catch (err) {
    console.error('Nev opening error:', err);
    res.status(500).json({ error: 'Failed to get opening' });
  }
});

// ── GET /api/nev/playbook ── view current playbook (admin)
router.get('/playbook', authenticateToken, async function(req, res) {
  res.json({ playbook: playbook });
});

// ── PUT /api/nev/playbook ── update playbook (admin)
router.put('/playbook', authenticateToken, async function(req, res) {
  try {
    var newPlaybook = req.body;
    if (!newPlaybook || typeof newPlaybook !== 'object') {
      return res.status(400).json({ error: 'Invalid playbook format' });
    }

    var playbookPath = path.join(__dirname, '..', 'lib', 'nev_playbook.json');
    fs.writeFileSync(playbookPath, JSON.stringify(newPlaybook, null, 2), 'utf8');
    playbook = newPlaybook;

    res.json({ success: true, message: 'Playbook updated' });
  } catch (err) {
    console.error('Playbook update error:', err);
    res.status(500).json({ error: 'Failed to update playbook' });
  }
});

function parseJsonSafe(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch(e) { return []; }
  }
  return [];
}

module.exports = { router };