var express = require('express');
var fs = require('fs');
var path = require('path');
var { dbGet, dbAll, dbRun } = require('../db');
var { authenticateToken } = require('../middleware/auth');
var { normalizeThemes, getCanonicalThemes } = require('../lib/theme_taxonomy');
var { nevChatLimiter, nevBehaviourCheck, flagUser, checkCanisterVelocity } = require('../middleware/anti_abuse');

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

// ── loadUserCanister: fetch all context needed for canister-aware prompting ──
async function loadUserCanister(userId) {
  var profile = null;
  var hasProfile = false;
  var gaps = [];
  var feedbackSignals = [];
  var priorMessageCount = 0;

  // 1. Load stakeholder profile joined with user
  try {
    profile = await dbGet(
      'SELECT sp.*, u.name, u.email, u.company FROM stakeholder_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.user_id = $1',
      [userId]
    );
  } catch(e) {
    console.warn('[Nev] Could not load stakeholder_profiles:', e.message);
  }

  // If no join result, try to at least get user info
  var userName = null;
  if (!profile) {
    try {
      var userRow = await dbGet('SELECT name, email, company FROM users WHERE id = $1', [userId]);
      if (userRow) {
        userName = userRow.name;
      }
    } catch(e) {}
  }

  hasProfile = !!profile;

  // 2. Parse JSONB fields defensively
  var themes = [];
  var intent = {};
  var offering = {};
  var dealDetails = {};

  if (profile) {
    try { themes = profile.themes ? (Array.isArray(profile.themes) ? profile.themes : JSON.parse(profile.themes)) : []; } catch(e) { themes = []; }
    try { intent = profile.intent ? (typeof profile.intent === 'object' && !Array.isArray(profile.intent) ? profile.intent : JSON.parse(profile.intent)) : {}; } catch(e) { intent = {}; }
    try { offering = profile.offering ? (typeof profile.offering === 'object' && !Array.isArray(profile.offering) ? profile.offering : JSON.parse(profile.offering)) : {}; } catch(e) { offering = {}; }
    try { dealDetails = profile.deal_details ? (typeof profile.deal_details === 'object' && !Array.isArray(profile.deal_details) ? profile.deal_details : JSON.parse(profile.deal_details)) : {}; } catch(e) { dealDetails = {}; }
  }

  // 3. Gap detection
  if (!profile || !profile.stakeholder_type || profile.stakeholder_type === '') {
    gaps.push('stakeholder type');
  }
  if (!themes || themes.length === 0) {
    gaps.push('themes/sectors — ask what industry or technology areas they work in. Map their answer to the closest from: ' + getCanonicalThemes().join(', '));
  }
  if (!profile || !profile.geography || profile.geography === '') {
    gaps.push('geography');
  }
  if (!profile || !profile.focus_text || profile.focus_text.trim().length < 40) {
    gaps.push('focus description');
  }
  if (!intent || Object.keys(intent).length === 0) {
    gaps.push('intent (what they seek)');
  }
  if (!offering || Object.keys(offering).length === 0) {
    gaps.push('offering (what they bring)');
  }
  var stakeholderType = profile ? (profile.stakeholder_type || '') : '';
  if (!dealDetails || Object.keys(dealDetails).length === 0) {
    gaps.push('timing and priorities — ask: "What is your most pressing priority in the next 90 days — raising, hiring, launching, partnering, or something else?"');
  }

  // 4. Load message history (nev_messages table)
  try {
    var messages = await dbAll(
      'SELECT role, content, created_at FROM nev_messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [userId]
    );
    priorMessageCount = messages ? messages.length : 0;
  } catch(e) {
    console.warn('[Nev] Could not load nev_messages (table may not exist yet):', e.message);
    priorMessageCount = 0;
  }

  // 5. Load feedback signals
  try {
    var signals = await dbAll(
      'SELECT insight_type, insight_value, created_at FROM feedback_insights WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
      [userId]
    );
    feedbackSignals = signals || [];
  } catch(e) {
    // table may not exist — silently skip
    feedbackSignals = [];
  }

  return {
    profile: {
      name: profile ? profile.name : (userName || null),
      company: profile ? profile.company : null,
      stakeholder_type: stakeholderType,
      geography: profile ? (profile.geography || null) : null,
      focus_text: profile ? (profile.focus_text || null) : null,
      themes: themes,
      intent: intent,
      offering: offering,
      deal_details: dealDetails
    },
    hasProfile: hasProfile,
    gaps: gaps,
    feedbackSignals: feedbackSignals,
    priorMessageCount: priorMessageCount
  };
}

// ── buildNevSystemPromptStable: all content that is stable within a session ──
function buildNevSystemPromptStable(canisterData) {
  var p = canisterData.profile;
  var hasProfile = canisterData.hasProfile;
  var gaps = canisterData.gaps || [];
  var feedbackSignals = canisterData.feedbackSignals || [];
  var priorMessageCount = canisterData.priorMessageCount || 0;

  // Section A: Role
  var sectionA = 'You are Nev, the AI concierge for EventMedium.ai.\n\nYOUR PURPOSE:\nYou help people build a rich private profile — called a "canister" — that powers EventMedium\'s matching engine. You are a signal extractor, not a research agent. You surface matches from within the EventMedium ecosystem only. The matching engine does the matching — you do the listening.';

  // Section B: Canister state
  var sectionB;
  if (hasProfile) {
    var insightTypes = feedbackSignals.length > 0 ? feedbackSignals.map(function(s) { return s.insight_type; }).join(', ') : 'none yet';
    sectionB = 'WHAT I ALREADY KNOW — DO NOT RE-ASK ANY OF THIS:\n' +
      '- Name: ' + (p.name || 'not captured') + '\n' +
      '- Company: ' + (p.company || 'not captured') + '\n' +
      '- Stakeholder type: ' + (p.stakeholder_type || 'not captured') + '\n' +
      '- Geography: ' + (p.geography || 'not captured') + '\n' +
      '- Themes/sectors: ' + (p.themes && p.themes.length > 0 ? p.themes.join(', ') : 'not captured') + '\n' +
      '- Focus: ' + (p.focus_text || 'not captured') + '\n' +
      '- Intent (what they seek): ' + (p.intent && Object.keys(p.intent).length > 0 ? JSON.stringify(p.intent) : 'not captured') + '\n' +
      '- Offering (what they bring): ' + (p.offering && Object.keys(p.offering).length > 0 ? JSON.stringify(p.offering) : 'not captured') + '\n' +
      '- Timing & priorities: ' + (p.deal_details && Object.keys(p.deal_details).length > 0 ? JSON.stringify(p.deal_details) : 'not captured') + '\n' +
      '- Prior Nev conversations: ' + priorMessageCount + ' messages on record\n' +
      '- Match feedback signals: ' + insightTypes;
  } else {
    sectionB = 'CANISTER STATUS: Empty. This person has not completed onboarding. Start from the beginning — stakeholder type, geography, and primary themes first.';
  }

  // Section C: Gaps
  var sectionC;
  if (gaps.length > 0) {
    sectionC = 'GAPS TO FILL — address these one at a time, never as a list of questions:\n' +
      gaps.map(function(g) { return '- ' + g; }).join('\n') + '\n\nAsk about the highest-priority gap first. One question per response.';
  } else if (priorMessageCount < 8) {
    sectionC = 'CANISTER IS WELL POPULATED. Do not re-ask basics.\nAsk ONE more deepening question from this list (pick the most relevant one you haven\'t covered):\n- What would make a meeting feel like a waste of time?\n- What does a perfect introduction look like to them?\n- Who specifically is NOT a fit, and why?\n\nAfter this question, you should be ready to wrap up.';
  } else {
    sectionC = 'CANISTER IS COMPLETE. You have enough signal for strong matching.\n\nWRAP UP NOW. Thank them warmly, confirm their canister is saved and matching is active. Tell them they can come back anytime to refine. Do NOT ask another question. End the conversation.\n\nKeep it brief — two or three sentences maximum.';
  }

  // Section D: Extraction targets
  var sectionD = 'WHAT YOU ARE EXTRACTING FOR THE MATCHING ENGINE:\n\nBeyond the basics, you are building meta-signal:\n\n1. SPECIFICITY — not "I want investors" but "angels who have operated a community or marketplace and can open doors in the UK or Spain". Push every vague answer toward a specific one.\n\n2. ANTI-PATTERNS — who is NOT a good match and why. This sharpens the algorithm as much as positive signals.\n\n3. TIMING AND URGENCY — are they raising now, hiring now, attending an event next week? Time-bound signals are high value.\n\n4. LATENT INTENT — things they want but haven\'t articulated. Listen for them and reflect them back.\n\n5. OFFERING NUANCE — what do they give beyond their product? Introductions, knowledge, access, validation?\n\n6. MATCH ACCEPTANCE CRITERIA — what would make them say yes to a meeting request versus ignore a match? Capture this explicitly.';

  // Section E: Hard constraints
  var sectionE = 'HARD CONSTRAINTS — never violate these:\n\n1. NEVER name specific real investors, funds, advisors, or people from your training data. You have no access to live investor databases. Names you generate may be factually wrong and will destroy trust immediately. If a user asks you to find investors or contacts, do this instead:\n   - Acknowledge their intent\n   - Capture it precisely in the canister ("Strategic angels with events/media experience, €25–50k ticket, London/Barcelona")\n   - Say: "I\'ve saved that to your canister. As investors and community operators join the EventMedium network, I\'ll surface matches based on this — I won\'t generate names from outside the ecosystem."\n\n2. NEVER ask more than ONE question per response.\n\n3. NEVER re-ask something already in the canister. If you see it above in "What I already know", it is already captured. Acknowledge it if relevant, but do not ask for it again.\n\n4. ALWAYS confirm when you\'ve captured something new: "Got it — I\'ve added [X] to your canister."\n\n5. NEVER produce bullet-point lists of questions. Never run through a checklist. This is a conversation.\n\n6. If the user corrects something, update it and confirm: "Updated — [X] is now your [field]."';

  // Section F: Tone
  var sectionF = 'TONE:\nWarm, precise, unhurried. You are an attentive listener who occasionally reflects back what you\'ve heard to check you\'ve got it right. Not chatty. Not corporate. Not a form. Think thoughtful colleague, not customer service bot.';

  // Section G: Canister output
  var themeList = getCanonicalThemes().join(', ');
  var sectionG = 'CANISTER OUTPUT — CRITICAL:\n\nAfter EVERY response, append a [CANISTER_READY] block containing the CUMULATIVE canister state based on everything you know so far. This is how the system saves profile data.\n\nFormat:\n[CANISTER_READY]\n{"stakeholder_type":"founder","themes":["AI","Fintech"],"intent":["fundraising","strategic partnerships"],"offering":["product expertise","market knowledge"],"context":"Building an AI-powered fintech platform","geography":"UK, US"}\n[/CANISTER_READY]\n\nRules:\n- Include ALL fields you have data for, not just what was mentioned in the latest message\n- stakeholder_type must be one of: founder, investor, researcher, corporate, advisor, operator (or compound like "founder/advisor")\n- themes MUST use ONLY these canonical values: ' + themeList + '\n- Map what the user describes to the closest canonical theme(s). For example: "workforce technology" → "Enterprise SaaS", "video production platform" → "Media & Entertainment", "GTM consultancy" → "Enterprise SaaS". If someone works across multiple domains, include all relevant themes.\n- If their work does not fit any canonical theme, pick the closest match — never leave themes empty if they have described what they do\n- Use empty string or empty array for fields with genuinely no data yet — never omit fields\n- This block is stripped from the visible reply — the user never sees it\n- Even after the first message, output whatever you can extract';

  return [sectionA, sectionB, sectionC, sectionD, sectionE, sectionF, sectionG].join('\n\n---\n\n');
}

// ── extractAndSaveCanisterUpdates: fire-and-forget write-back ──
async function extractAndSaveCanisterUpdates(userId, nevResponse, userMessage) {
  try {
    var themeList = getCanonicalThemes().join(', ');
    var extractionPrompt = 'Given this Nev response and the user message that preceded it, extract any of the following if they were clearly confirmed or updated in the conversation:\n\n- geography (string)\n- stakeholder_type (one of: founder, investor, researcher, corporate, advisor, operator — or compound like "founder/advisor")\n- themes (array — MUST use only these canonical values: ' + themeList + '. Map what the user describes to the closest theme(s). Never leave empty if they described their work.)\n- focus_text (string — their focus in their own words)\n- intent (object — what they are actively seeking)\n- offering (object — what they bring to others)\n- deal_details (object — timing and priorities: what they are focused on in the next 90 days, e.g. raising, hiring, launching, scaling, partnering, attending events, exploring new markets)\n\nReturn ONLY a JSON object with the fields that were clearly confirmed. If nothing was confirmed, return {}.\nDo not invent or infer — only extract what was explicitly stated.\n\nUser message: ' + userMessage + '\nNev response: ' + nevResponse;

    var extractResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: 'You are a data extraction assistant. Return ONLY valid JSON, no markdown, no explanation.',
        messages: [{ role: 'user', content: extractionPrompt }]
      })
    });

    if (!extractResp.ok) {
      console.warn('[Nev] Extraction API error:', extractResp.status);
      return;
    }

    var extractData = await extractResp.json();
    if (!extractData.content || !extractData.content[0] || !extractData.content[0].text) return;

    var rawText = extractData.content[0].text.trim().replace(/```json/g, '').replace(/```/g, '').trim();
    var extracted;
    try {
      extracted = JSON.parse(rawText);
    } catch(e) {
      console.warn('[Nev] Could not parse extraction result:', rawText);
      return;
    }

    if (!extracted || typeof extracted !== 'object' || Object.keys(extracted).length === 0) return;

    // Build UPDATE query — only update fields present in result
    var setClauses = [];
    var params = [];
    var idx = 1;

    var jsonbFields = ['themes', 'intent', 'offering', 'deal_details'];
    var stringFields = ['geography', 'stakeholder_type', 'focus_text'];

    stringFields.forEach(function(field) {
      if (extracted[field] !== undefined && extracted[field] !== null) {
        setClauses.push(field + ' = $' + idx);
        params.push(extracted[field]);
        idx++;
      }
    });

    jsonbFields.forEach(function(field) {
      if (extracted[field] !== undefined && extracted[field] !== null) {
        setClauses.push(field + ' = $' + idx);
        params.push(JSON.stringify(extracted[field]));
        idx++;
      }
    });

    if (setClauses.length === 0) return;

    // UPSERT: create profile row if it doesn't exist, then update
    try {
      var existing = await dbGet('SELECT id FROM stakeholder_profiles WHERE user_id = $1', [userId]);
      if (!existing) {
        await dbRun(
          'INSERT INTO stakeholder_profiles (user_id, onboarding_method, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())',
          [userId, 'chat']
        );
        console.log('[Nev] Created stakeholder_profiles row for user', userId);
      }

      setClauses.push('updated_at = NOW()');
      params.push(userId);
      var updateSql = 'UPDATE stakeholder_profiles SET ' + setClauses.join(', ') + ' WHERE user_id = $' + idx;
      await dbRun(updateSql, params);
      console.log('[Nev] Write-back updated fields:', Object.keys(extracted).join(', '), 'for user', userId);
    } catch(e) {
      console.warn('[Nev] Write-back DB error:', e.message);
    }
  } catch(e) {
    console.error('[Nev] extractAndSaveCanisterUpdates error:', e);
  }
}

// ── POST /api/nev/chat ──
router.post('/chat', authenticateToken, nevChatLimiter, nevBehaviourCheck, async function(req, res) {
  try {
    var { message, conversation } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    // Server-side exit detection - bypass AI entirely for clean signoff
    var exitPhrases = ['have to go', 'gotta go', 'got to go', 'bye', 'goodbye', 'i am done', "i'm done", 'finished now', 'finish now', 'that is enough', "that's enough", 'all good', 'got to run', 'gotta run', 'stop here', 'no more', 'just matches', 'i have finished', 'enough for now', 'ok thanks', 'thank you', 'thanks bye', 'need to go'];
    var msgLower = message.toLowerCase().trim();
    var isExit = msgLower === "done" || msgLower === "stop" || msgLower === "ok done" || exitPhrases.some(function(p) { return msgLower.indexOf(p) !== -1; });
    if (isExit) {
      var quotes = [
        { q: "The best investment you can make is in yourself.", a: "Warren Buffett" },
        { q: "The only way to do great work is to love what you do.", a: "Steve Jobs" },
        { q: "In the middle of every difficulty lies opportunity.", a: "Albert Einstein" },
        { q: "It's not about ideas. It's about making ideas happen.", a: "Scott Belsky" },
        { q: "The secret of getting ahead is getting started.", a: "Mark Twain" },
        { q: "Move fast and learn things.", a: "Reid Hoffman" },
        { q: "Your network is your net worth — invest in it accordingly.", a: "Porter Gale" },
        { q: "The most valuable thing you can give someone is your attention.", a: "Jim Rohn" },
        { q: "Go confidently in the direction of your dreams.", a: "Henry David Thoreau" },
        { q: "Risk comes from not knowing what you're doing.", a: "Warren Buffett" },
        { q: "The people who are crazy enough to think they can change the world are the ones who do.", a: "Steve Jobs" },
        { q: "An investment in knowledge pays the best interest.", a: "Benjamin Franklin" },
        { q: "The impediment to action advances action. What stands in the way becomes the way.", a: "Marcus Aurelius" },
        { q: "We are all connected; to each other, biologically. To the earth, chemically. To the rest of the universe atomically.", a: "Neil deGrasse Tyson" }
      ];
      var picked = quotes[Math.floor(Math.random() * quotes.length)];
      return res.json({
        reply: "Your canister is saved and matching is active. I will continue to monitor events and communities for strong matches for your needs.\n\nGood talk.\n\n*\"" + picked.q + "\"*\n— " + picked.a,
        canister_data: null
      });
    }

    // Load canister data for canister-aware prompting
    var canisterData = await loadUserCanister(req.user.id);
    // Include current session messages in count (DB may lag behind fire-and-forget writes)
    var sessionMsgCount = conversation ? conversation.length : 0;
    canisterData.priorMessageCount = Math.max(canisterData.priorMessageCount, sessionMsgCount);
    var stablePrompt = buildNevSystemPromptStable(canisterData);

    // Build system as content blocks with cache_control on stable part
    var systemBlocks = [
      {
        type: 'text',
        text: stablePrompt,
        cache_control: { type: 'ephemeral' }
      }
    ];

    // Build messages for Anthropic format
    var anthropicMessages = [];
    if (conversation && Array.isArray(conversation)) {
      conversation.forEach(function(msg) {
        anthropicMessages.push({ role: msg.role, content: msg.content });
      });
    }
    anthropicMessages.push({ role: 'user', content: message });

    // Call Anthropic with prompt caching
    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        system: systemBlocks,
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

    // Log cache usage for cost monitoring
    if (data.usage) {
      console.log('[nev cache]', {
        input_tokens: data.usage.input_tokens,
        output_tokens: data.usage.output_tokens,
        cache_creation_input_tokens: data.usage.cache_creation_input_tokens || 0,
        cache_read_input_tokens: data.usage.cache_read_input_tokens || 0
      });
    }

    var fullReply = data.content[0].text;

    // Strip markdown server-side
    var reply = fullReply.split('\n').map(function(l){
      return l.replace(/^\s*#{1,4}\s+/,'').replace(/^\s*[-*]\s+/,'').replace(/^\s*\d+\.\s+/,'').replace(/\*\*(.*?)\*\*/g,'$1').replace(/\*(.*?)\*/g,'$1').replace(/^\s*[oc]\s+/,'');
    }).filter(function(l){return l.trim()!='';}).join(' ').trim();

    var canisterReply = null;
    var canisterMatch = reply.match(/\[CANISTER_READY\]([\s\S]*?)\[\/CANISTER_READY\]/);
    if (canisterMatch) {
      try {
        canisterReply = JSON.parse(canisterMatch[1].trim());

        // Normalize themes
        if (canisterReply.themes) {
          canisterReply.themes = normalizeThemes(canisterReply.themes);
        }

        // Clean empty values for frontend
        if (canisterReply.stakeholder_type === '...') canisterReply.stakeholder_type = '';
        if (canisterReply.context === '...') canisterReply.context = '';
        if (canisterReply.geography === '...') canisterReply.geography = '';
        if (canisterReply.themes && canisterReply.themes[0] === '...') canisterReply.themes = [];
        if (canisterReply.intent && canisterReply.intent[0] === '...') canisterReply.intent = [];
        if (canisterReply.offering && canisterReply.offering[0] === '...') canisterReply.offering = [];
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

    // If no canister from CANISTER_READY, extract separately using full conversation
    if (!canisterReply && anthropicMessages && anthropicMessages.length > 0) {
      try {
        // Use recent messages (tail) not head — latest context is richest
        var convText = anthropicMessages.map(function(m){ return m.role + ': ' + m.content; }).join('\n') + '\nassistant: ' + fullReply;
        if (convText.length > 4000) convText = convText.slice(-4000);
        var extResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 400,
            system: 'Extract profile data from this conversation. Respond ONLY with valid JSON, nothing else. No markdown, no explanation.\nJSON format: {"stakeholder_type":"","themes":[],"intent":[],"offering":[],"context":"","geography":""}\nstakeholder_type must be one of: founder/investor/researcher/corporate/advisor/operator (or compound like "founder/advisor")\nthemes MUST use only these canonical values: ' + getCanonicalThemes().join(', ') + '. Map what the user describes to the closest theme(s). Never leave themes empty if the user described what they do.\nUse empty string or empty array if genuinely unknown. Never use "...".',
            messages: [{ role: 'user', content: 'Conversation:\n' + convText }]
          })
        });
        var extData = await extResp.json();
        if (extData.content && extData.content[0] && extData.content[0].text) {
          var extText = extData.content[0].text.trim();
          var extClean = extText.replace(/```json/g,"").replace(/```/g,"").trim(); var parsed = JSON.parse(extClean);
          if (parsed.stakeholder_type || (parsed.themes && parsed.themes.length) || (parsed.intent && parsed.intent.length) || (parsed.offering && parsed.offering.length) || parsed.geography || parsed.context) {
            canisterReply = parsed;
            console.log('[Nev] Extraction succeeded:', JSON.stringify(canisterReply));
          }
        }
      } catch(extErr) {
        console.error('[Nev] Extraction error:', extErr.message);
      }
    }

    // Send response
    res.json({
      reply: reply,
      canister_data: canisterReply
    });

    // Fire-and-forget: persist messages to nev_messages (full reply, not stripped)
    (async function() {
      try {
        await dbRun(
          'INSERT INTO nev_messages (user_id, role, content, created_at) VALUES ($1, $2, $3, NOW())',
          [req.user.id, 'user', message]
        );
        await dbRun(
          'INSERT INTO nev_messages (user_id, role, content, created_at) VALUES ($1, $2, $3, NOW())',
          [req.user.id, 'assistant', fullReply]
        );
      } catch(e) {
        console.warn('[Nev] Message persist error:', e.message);
      }
    })();

    // Fire-and-forget write-back extraction (uses full reply for richer context)
    extractAndSaveCanisterUpdates(req.user.id, fullReply, message).catch(function(e) {
      console.error('[Nev] write-back error:', e);
    });

    // Fire-and-forget canister velocity check
    checkCanisterVelocity(req.user.id).then(function(v) {
      if (v.suspicious) flagUser(req.user.id, 'canister_velocity', v.reason + ' (' + v.elapsed_ms + 'ms)', 75);
    }).catch(function() {});

    // Fire-and-forget embedding after canister update
    var nevUserId = req.user.id;
    (async function() {
      try {
        var { embedProfile, embedIntentOffering } = require('../lib/vector_search');
        var { dbGet: nevDbGet, dbRun: nevDbRun } = require('../db');
        var updatedProfile = await nevDbGet('SELECT * FROM stakeholder_profiles WHERE user_id = $1', [nevUserId]);
        var nevUser = await nevDbGet('SELECT name, company FROM users WHERE id = $1', [nevUserId]);
        if (updatedProfile && nevUser) {
          var vectorId = await embedProfile(updatedProfile, nevUser);
          if (vectorId) {
            await nevDbRun('UPDATE stakeholder_profiles SET qdrant_vector_id = $1, embedding_updated_at = NOW() WHERE user_id = $2', [vectorId, nevUserId]);
            console.log('[embedding] canister embedded for user', nevUserId, 'after Nev session');
          }
          await embedIntentOffering(updatedProfile, nevUser);
        }
      } catch(e) {
        console.error('[embedding] Nev canister embed failed for user', nevUserId, e.message);
      }
    })();

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
      opening += ' Anything new I should know about? You can sign off anytime by saying done.';
    } else if (user) {
      opening = 'Hi ' + user.name.split(' ')[0] + ' — I\'m Nev. I help match you with the right people at events. I\'ll ask a few quick questions — just say done whenever you want to stop. First up: what do you do, and what are you working on right now?';
    } else {
      opening = 'Hey there! I\'m Nev, your networking concierge. A few quick questions and I\'ll start matching you with the right people at events. Just say done whenever you are ready to stop — more context means sharper matches, but a few answers is enough to get started. Tell me a bit about yourself — what do you do, and what are you working on?';
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
