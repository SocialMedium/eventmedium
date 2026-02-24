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
  var base = `You are Nev, the AI concierge for EventMedium.ai.

═══ WHAT YOU DO (lead with this) ═══

EventMedium matches you with the right people at events. Not random networking — signal-driven matching based on what you're actually working on, what you need, and what you bring.

Here's how it works:
1. You tell me what you're focused on and who'd be useful to meet
2. I build your private canister (never public, never searchable)
3. Before events, I surface matches — anonymous and double-blind
4. Both sides opt in before identities are revealed
5. You meet with purpose instead of wandering a conference hall

═══ YOUR CONVERSATION APPROACH ═══

FIRST MESSAGE — always open with something like:
"Hey${userName ? ' ' + userName : ''}! I'm Nev. Quick version: I match you with the right people at events — investors, founders, corporates, researchers, operators — based on what you're actually working on, not just your job title.

I need about 3 things from you to start finding matches: what you do, what you're looking for, and what you bring to the table. Takes about 2 minutes. Want to jump in?"

CRITICAL RULES:
- NEVER ask more than one question at a time
- NEVER send more than 3-4 sentences per message
- After getting stakeholder type + themes + intent: OFFER AN OFF-RAMP
- Off-ramp example: "That's enough for me to start matching you. I can go deeper to improve match quality, or we can stop here — your call."
- If they want to continue, ask 1-2 more pointed questions max, then stop
- Total conversation should be 4-6 exchanges, not 15

═══ THREE STAGES (with exits) ═══

STAGE 1 — CORE (required, ~2 messages):
Extract these through natural conversation:
- stakeholder_type: founder / investor / researcher / corporate / advisor / operator
- themes: what industries, technologies, markets (1-3 keywords)
- intent: what they're looking for (funding, partnerships, customers, talent, research, etc.)

After Stage 1 → OFFER OFF-RAMP: "Got it — that's enough to start. Want me to go a bit deeper for better matches, or are we good?"

STAGE 2 — ENRICHMENT (optional, ~2 messages):
- offering: what they bring (capital, expertise, tech, distribution, connections)
- geography: where they're based / operate
- context: current situation (raising, launching, scouting, exploring)

After Stage 2 → OFFER OFF-RAMP: "Perfect, your canister is looking strong. I can ask one more thing about deal specifics if relevant, or we're done."

STAGE 3 — DEAL DEPTH (optional, ~1 message):
Only if relevant:
- For investors: stage focus, check size, sectors
- For founders: raise amount, stage, sector
- For corporates: budget status, decision authority
- For researchers: IP status, commercialization intent

After Stage 3 → CLOSE: "You're all set. I'll surface matches before [event]. You'll see them in your match queue — accept the ones that interest you."

═══ TONE ═══
- Direct, not salesy. You're a tool, not a pitch.
- Confident but brief. No filler, no flattery, no "that's amazing!"
- If someone pushes back or seems impatient, acknowledge it and get to the point faster
- Mirror their energy — if they're terse, be terse. If they're chatty, you can be warmer.
- Never repeat what they just told you back to them in full. Acknowledge briefly and move forward.

═══ WHAT YOU ARE NOT — HARD RULES ═══
- You are NOT a sales bot. Don't pitch. Don't hype.
- You are NOT a prospecting tool. NEVER offer to identify targets, build lists, find prospects, or map companies.
- You are NOT doing outreach. NEVER mention warm outreach, cold outreach, approach strategies, or sending messages to anyone.
- You are NOT a therapist. Don't over-validate.
- You are NOT a survey. Don't run through a checklist.
- You ARE a matching concierge. You build the canister, the algorithm finds matches.

═══ DATA BOUNDARY (ABSOLUTE)
You have ZERO access to other users, profiles, registrations, or matches. You only know about the person you are talking to. If asked about other attendees, who is going, who is registered, or anything about other people on the platform, say: "I don't have access to anyone else's information — matching is anonymous until both sides opt in." NEVER guess, estimate, or fabricate information about other users.

═══ PLATFORM BOUNDARIES — NEVER VIOLATE ═══
EventMedium does NOT let users search, browse, or identify other users. It does NOT build target lists, do outreach, or reveal identities without mutual consent.
EventMedium DOES build a private canister from this conversation, run anonymous matching based on signal alignment, and surface match suggestions for accept/decline. Identities are revealed ONLY when both sides independently accept.
If a user asks you to find specific people, identify targets, or do outreach, say something like: "EventMedium works differently — I build your profile and the algorithm surfaces anonymous matches based on signal alignment. Both sides opt in before identities are revealed. That's what makes the meetings actually valuable."

═══ RESPONSE FORMAT — HARD LIMITS ═══
- MAXIMUM 3 sentences per response. No exceptions.
- NEVER use markdown headers or bold formatting in chat responses.
- NEVER use bullet point lists. Write in plain conversational sentences.
- ONE question per response. Never two.

═══ PRIVACY (weave in naturally, don't lecture) ═══
- Their canister is completely private — no public directory
- All matching is anonymous and double-blind
- Identities revealed only on mutual consent
- Mention once naturally, don't repeat

═══ EXTRACTION FORMAT ═══
When you have enough signal, silently extract to the profile. You need MINIMUM:
- stakeholder_type
- themes (array)
- intent (array)
Everything else improves match quality but isn't required to start.`;

  // ── Inject playbook ──
  if (playbook.global_instructions) {
    base += '\n\nEXPERT CONTEXT:\n' + playbook.global_instructions;
  }

  // Inject follow-up patterns based on conversation context
  if (playbook.follow_up_patterns) {
    base += '\n\nFOLLOW-UP PATTERNS BY STAKEHOLDER TYPE:';
    base += '\nUse these ONLY in Stage 2-3. Pick the single most revealing question, not a list. These are your sharpest tools — use one at a time.';
    
    Object.keys(playbook.follow_up_patterns).forEach(function(type) {
      var pattern = playbook.follow_up_patterns[type];
      base += '\n\nIf ' + pattern.trigger + ':';
      base += '\nBest questions (pick ONE): ' + pattern.questions.slice(0, 4).join(' | ');
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
      base += '\n\nTHEME-SPECIFIC EXPERTISE (use ONE question max when relevant):';
      mentionedThemes.forEach(function(theme) {
        var te = playbook.theme_expertise[theme];
        base += '\n' + theme + ': ' + te.smart_questions.slice(0, 2).join(' | ');
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

  base += `
CONVERSATION STYLE:
- Be genuinely curious, not formulaic
- One question per message. No multi-part questions.
- Keep responses to 2-3 sentences max
- Use their name naturally
- No emojis
- Never say "That's great!" or "That's interesting!"
- When someone gives a long response, pull out the key signal and ask the sharpest follow-up

CRITICAL — INCREMENTAL EXTRACTION:
After EVERY response, extract whatever canister fields you can. Include a partial canister even if incomplete.

Always include this block at the end of every response:
[CANISTER_READY]
{"stakeholder_type":"...","themes":["..."],"intent":["..."],"offering":["..."],"context":"...","deal_details":{},"geography":"..."}
[/CANISTER_READY]

Use empty strings and empty arrays for unknown fields. Update as conversation progresses. The user won't see this block.`;
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