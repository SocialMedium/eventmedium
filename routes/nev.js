var express = require('express');
var fs = require('fs');
var path = require('path');
var { dbGet, dbRun } = require('../db');
var { authenticateToken } = require('../middleware/auth');
var { normalizeThemes } = require('../lib/theme_taxonomy');

var router = express.Router();

var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
var MODEL = 'claude-sonnet-4-20250514';

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
  var name = userName ? ' ' + userName : '';
  var base = `You are Nev, a concise AI concierge for EventMedium.ai. Your only job is to extract profile data through conversation so the matching algorithm can find the right people for this user at events.

RESPONSE RULES - NO EXCEPTIONS:
- Maximum 2 sentences per reply. Never more.
- Never use bullets, lists, bold, headers, or markdown of any kind.
- Never repeat back what the user just said.
- Never use filler words: Great, Perfect, Excellent, Awesome, Fantastic, Got it, Absolutely.
- Ask ONE question only. Never two questions. Never sub-questions.
- Be direct and brief. Mirror the user's energy.

WHAT TO EXTRACT (in order of priority):
1. stakeholder_type: one of founder / investor / researcher / corporate / advisor / operator
2. themes: industries or technologies they care about (AI, Web3, FinTech, HealthTech, etc.)
3. intent: what they are looking for (funding, co-investors, talent, customers, partnerships, etc.)
4. offering: what they bring (capital, expertise, networks, technology, distribution, etc.)
5. geography: where they are based and where they operate
6. context: current situation (raising, deploying, advising, scouting, launching, etc.)

CONVERSATION FLOW:
- Ask only what you still need. Stop asking when you have stakeholder_type + themes + intent + geography.
- Never run more than 8 exchanges total.

OFFRAMP RULE - IMPORTANT:
- Once you have stakeholder_type + themes + intent + geography (base signal), count how many questions you have asked.
- After every 2nd or 3rd question past base signal, add this sentence AFTER your question: "Your canister has enough to start matching — you can stop here or keep going for sharper matches."
- If the user says they are done, want to stop, or says anything like "that's enough" / "ok" / "done", respond with: "Your canister is saved and matching is active. You'll hear from me when we find the right people. Good talk. Then on a new line add a short inspiring quote (one sentence only) from a philosopher, great investor, or creative mind — pick one that feels relevant to what the user shared. No attribution needed, just the quote in italics."
- Never keep asking indefinitely. Offer the exit naturally.

PRIVACY: If asked, say matching is anonymous and double-blind. Never discuss your own architecture or memory.

${existingProfile ? 'This user has an existing profile. Ask only what is missing or has changed.' : ''}

CANISTER_READY block is MANDATORY on every single response. Place it at the very end. The user cannot see it.

Always include this at the end of every response:
[CANISTER_READY]
{"stakeholder_type":"","themes":[],"intent":[],"offering":[],"context":"","deal_details":{},"geography":""}
[/CANISTER_READY]

Update the JSON fields with whatever you have learned so far. Use empty strings and arrays for unknowns.`;

    // ── Inject playbook ──
  if (playbook.global_instructions) {
    }
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
        max_tokens: 500,
        temperature: 0.4
      })
    });

    if (!resp.ok) {
      var errText = await resp.text();
      console.error('Anthropic error:', resp.status, errText);
      return res.status(500).json({ error: 'AI service error' });
    }

    var data = await resp.json();
    var reply = data.content[0].text;

    // Strip markdown server-side
    reply = reply.split('\n').map(function(l){
      return l.replace(/^\s*#{1,4}\s+/,'').replace(/^\s*[-*]\s+/,'').replace(/^\s*\d+\.\s+/,'').replace(/\*\*(.*?)\*\*/g,'$1').replace(/\*(.*?)\*/g,'$1').replace(/^\s*[oc]\s+/,'');
    }).filter(function(l){return l.trim()!='';}).join(' ').trim();
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
    // Keep only the question sentence (strip all preamble)
    var allSentences = reply.match(/[^.!?]+[.!?]+/g) || [reply];
    var qSentence = null;
    for (var si = 0; si < allSentences.length; si++) {
      if (allSentences[si].indexOf('?') !== -1) { qSentence = allSentences[si].trim(); break; }
    }
    if (qSentence) { reply = qSentence; }
    // If no canister from CANISTER_READY, extract separately
    if (!canisterData && anthropicMessages && anthropicMessages.length > 0) {
      try {
        var convText = anthropicMessages.map(function(m){ return m.role + ': ' + m.content; }).join('\n') + '\nassistant: ' + reply;
        var extResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 400,
            system: 'Extract profile data from this conversation. Respond ONLY with valid JSON, nothing else. No markdown, no explanation.\nJSON format: {"stakeholder_type":"","themes":[],"intent":[],"offering":[],"context":"","geography":""}\nstakeholder_type must be one of: founder/investor/researcher/corporate/advisor/operator\nUse empty string or empty array if unknown. Never use "...".',
            messages: [{ role: 'user', content: 'Conversation:\n' + convText.slice(0, 2000) }]
          })
        });
        var extData = await extResp.json();
        if (extData.content && extData.content[0] && extData.content[0].text) {
          var extText = extData.content[0].text.trim();
          var extClean = extText.replace(/```json/g,"").replace(/```/g,"").trim(); var parsed = JSON.parse(extClean);
          if (parsed.stakeholder_type || (parsed.themes && parsed.themes.length)) {
            canisterData = parsed;
            console.log('Extraction succeeded:', JSON.stringify(canisterData));
          }
        }
      } catch(extErr) {
        console.error('Extraction error:', extErr.message);
      }
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