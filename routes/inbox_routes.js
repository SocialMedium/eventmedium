var express = require('express');
var router = express.Router();
var { dbGet, dbRun, dbAll } = require('../db');
var { authenticateToken } = require('../middleware/auth');
// ──────────────────────────────────────────


// ── GET /api/matches/mutual ── inbox: revealed matches with full profiles
router.get('/mutual', authenticateToken, async function(req, res) {
  try {
    var matches = await dbAll(
      `SELECT
        em.id as match_id,
        em.event_id,
        em.score_total,
        em.match_reasons,
        em.signal_context,
        em.revealed_at as mutual_at,
        em.status,
        em.user_a_id, em.user_b_id,
        em.user_a_context, em.user_b_context,
        CASE WHEN em.user_a_id = $1 THEN em.user_b_id ELSE em.user_a_id END as other_user_id,
        e.name as event_name, e.event_date
       FROM event_matches em
       JOIN events e ON e.id = em.event_id
       WHERE (em.user_a_id = $1 OR em.user_b_id = $1)
         AND em.status = 'revealed'
       ORDER BY em.revealed_at DESC`,
      [req.user.id]
    );

    // Enrich with other user's profile
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      var isA = m.user_a_id === req.user.id;

      // Other user info
      var otherUser = await dbGet(
        'SELECT id, name, email, company, avatar_url FROM users WHERE id = $1',
        [m.other_user_id]
      );

      // Other user profile
      var otherProfile = await dbGet(
        `SELECT stakeholder_type, themes, focus_text, geography, intent, offering
         FROM stakeholder_profiles WHERE user_id = $1`,
        [m.other_user_id]
      );

      // Existing feedback
      var existingFeedback = await dbGet(
        'SELECT rating, did_meet, nev_chat_completed FROM match_feedback WHERE match_id = $1 AND user_id = $2',
        [m.match_id, req.user.id]
      );

      // Build flat match reason from array
      var reasons = [];
      try { reasons = JSON.parse(m.match_reasons || '[]'); } catch(e) {}

      matches[i] = {
        match_id: m.match_id,
        event_id: m.event_id,
        event_name: m.event_name,
        event_date: m.event_date,
        score_total: m.score_total,
        match_reason: reasons.slice(0, 2).join('. '),
        signal_context: m.signal_context,
        mutual_at: m.mutual_at,
        status: m.status,
        their_context: isA ? m.user_b_context : m.user_a_context,
        my_context: isA ? m.user_a_context : m.user_b_context,
        other_user: otherUser || {},
        other_profile: otherProfile || {},
        feedback: existingFeedback || null
      };
    }

    res.json({ matches: matches });
  } catch (err) {
    console.error('Get mutual matches error:', err);
    res.status(500).json({ error: 'Failed to load mutual matches' });
  }
});


// ── POST /api/matches/:id/context ── send a note to your match
router.post('/:matchId/context', authenticateToken, async function(req, res) {
  try {
    var matchId = parseInt(req.params.matchId);
    var { context } = req.body;
    if (!context || !context.trim()) return res.status(400).json({ error: 'Context message required' });

    var match = await dbGet('SELECT * FROM event_matches WHERE id = $1', [matchId]);
    if (!match) return res.status(404).json({ error: 'Match not found' });

    var isA = match.user_a_id === req.user.id;
    var isB = match.user_b_id === req.user.id;
    if (!isA && !isB) return res.status(403).json({ error: 'Not your match' });

    var column = isA ? 'user_a_context' : 'user_b_context';
    await dbRun(
      'UPDATE event_matches SET ' + column + ' = $1 WHERE id = $2',
      [context.trim().slice(0, 500), matchId]
    );

    // Notify the other user
    var otherUserId = isA ? match.user_b_id : match.user_a_id;
    await createNotification(
      otherUserId, 'match_message',
      'New message from a match',
      'Someone sent you a note. Check your inbox.',
      '/inbox.html'
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Context save error:', err);
    res.status(500).json({ error: 'Failed to save message' });
  }
});


// ── POST /api/matches/:id/feedback ── quick rating (inbox buttons)
router.post('/:matchId/feedback', authenticateToken, async function(req, res) {
  try {
    var matchId = parseInt(req.params.matchId);
    var { feedback } = req.body;
    var validRatings = ['valuable', 'not_relevant', 'didnt_connect'];
    if (!feedback || validRatings.indexOf(feedback) === -1) {
      return res.status(400).json({ error: 'Invalid feedback type' });
    }

    var match = await dbGet('SELECT * FROM event_matches WHERE id = $1', [matchId]);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.user_a_id !== req.user.id && match.user_b_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your match' });
    }

    await dbRun(
      `INSERT INTO match_feedback (match_id, user_id, rating)
       VALUES ($1, $2, $3)
       ON CONFLICT (match_id, user_id) DO UPDATE SET rating = $3, updated_at = NOW()`,
      [matchId, req.user.id, feedback]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Feedback error:', err);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});


// ══════════════════════════════════════════════════════
// POST-MEETING DEBRIEF — structured feedback + Nev chat
// ══════════════════════════════════════════════════════

// ── POST /api/matches/:id/debrief ── structured post-meeting feedback
router.post('/:matchId/debrief', authenticateToken, async function(req, res) {
  try {
    var matchId = parseInt(req.params.matchId);
    var {
      did_meet, meeting_quality, would_meet_again,
      outcome_type, outcome_notes,
      relevance_score, theme_accuracy, intent_accuracy, stakeholder_fit_accuracy,
      what_worked, what_didnt
    } = req.body;

    var match = await dbGet('SELECT * FROM event_matches WHERE id = $1', [matchId]);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.user_a_id !== req.user.id && match.user_b_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your match' });
    }

    await dbRun(
      `INSERT INTO match_feedback
        (match_id, user_id, did_meet, meeting_quality, would_meet_again,
         outcome_type, outcome_notes, relevance_score,
         theme_accuracy, intent_accuracy, stakeholder_fit_accuracy,
         what_worked, what_didnt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (match_id, user_id) DO UPDATE SET
         did_meet = COALESCE($3, match_feedback.did_meet),
         meeting_quality = COALESCE($4, match_feedback.meeting_quality),
         would_meet_again = COALESCE($5, match_feedback.would_meet_again),
         outcome_type = COALESCE($6, match_feedback.outcome_type),
         outcome_notes = COALESCE($7, match_feedback.outcome_notes),
         relevance_score = COALESCE($8, match_feedback.relevance_score),
         theme_accuracy = COALESCE($9, match_feedback.theme_accuracy),
         intent_accuracy = COALESCE($10, match_feedback.intent_accuracy),
         stakeholder_fit_accuracy = COALESCE($11, match_feedback.stakeholder_fit_accuracy),
         what_worked = COALESCE($12, match_feedback.what_worked),
         what_didnt = COALESCE($13, match_feedback.what_didnt),
         updated_at = NOW()`,
      [matchId, req.user.id, did_meet, meeting_quality, would_meet_again,
       outcome_type, outcome_notes, relevance_score,
       theme_accuracy, intent_accuracy, stakeholder_fit_accuracy,
       what_worked, what_didnt]
    );

    // Extract tuning insights from structured feedback
    await extractDebriefInsights(matchId, req.user.id, req.body, match);

    res.json({ success: true });
  } catch (err) {
    console.error('Debrief error:', err);
    res.status(500).json({ error: 'Failed to save debrief' });
  }
});


// ── GET /api/matches/:id/debrief ── get debrief state + chat history
router.get('/:matchId/debrief', authenticateToken, async function(req, res) {
  try {
    var matchId = parseInt(req.params.matchId);

    var feedback = await dbGet(
      'SELECT * FROM match_feedback WHERE match_id = $1 AND user_id = $2',
      [matchId, req.user.id]
    );

    var chatMessages = [];
    if (feedback) {
      chatMessages = await dbAll(
        'SELECT role, content, created_at FROM nev_debrief_messages WHERE match_feedback_id = $1 ORDER BY created_at ASC',
        [feedback.id]
      );
    }

    var match = await dbGet(
      `SELECT em.*, e.name as event_name,
        CASE WHEN em.user_a_id = $1 THEN em.user_b_id ELSE em.user_a_id END as other_user_id
       FROM event_matches em JOIN events e ON e.id = em.event_id
       WHERE em.id = $2`,
      [req.user.id, matchId]
    );

    var otherUser = null;
    if (match) {
      otherUser = await dbGet('SELECT name, company FROM users WHERE id = $1', [match.other_user_id]);
    }

    res.json({
      feedback: feedback || null,
      chat: chatMessages,
      match_context: match ? {
        event_name: match.event_name,
        other_name: otherUser ? otherUser.name : null,
        other_company: otherUser ? otherUser.company : null,
        score_total: match.score_total,
        match_reasons: match.match_reasons
      } : null
    });
  } catch (err) {
    console.error('Get debrief error:', err);
    res.status(500).json({ error: 'Failed to load debrief' });
  }
});


// ── POST /api/matches/:id/debrief/chat ── Nev debrief conversation
router.post('/:matchId/debrief/chat', authenticateToken, async function(req, res) {
  try {
    var matchId = parseInt(req.params.matchId);
    var { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });

    // Ensure feedback record exists
    var feedback = await dbGet(
      'SELECT * FROM match_feedback WHERE match_id = $1 AND user_id = $2',
      [matchId, req.user.id]
    );

    if (!feedback) {
      // Create skeleton record to hang chat on
      await dbRun(
        'INSERT INTO match_feedback (match_id, user_id, nev_chat_started) VALUES ($1, $2, true) ON CONFLICT (match_id, user_id) DO UPDATE SET nev_chat_started = true',
        [matchId, req.user.id]
      );
      feedback = await dbGet(
        'SELECT * FROM match_feedback WHERE match_id = $1 AND user_id = $2',
        [matchId, req.user.id]
      );
    }

    if (!feedback.nev_chat_started) {
      await dbRun('UPDATE match_feedback SET nev_chat_started = true WHERE id = $1', [feedback.id]);
    }

    // Save user message
    await dbRun(
      'INSERT INTO nev_debrief_messages (match_feedback_id, role, content) VALUES ($1, $2, $3)',
      [feedback.id, 'user', message.trim()]
    );

    // Load match context for Nev
    var match = await dbGet(
      `SELECT em.*, e.name as event_name,
        CASE WHEN em.user_a_id = $1 THEN em.user_b_id ELSE em.user_a_id END as other_user_id
       FROM event_matches em JOIN events e ON e.id = em.event_id WHERE em.id = $2`,
      [req.user.id, matchId]
    );

    var otherUser = match ? await dbGet('SELECT name, company FROM users WHERE id = $1', [match.other_user_id]) : null;
    var currentUser = await dbGet('SELECT name, company FROM users WHERE id = $1', [req.user.id]);
    var userProfile = await dbGet('SELECT * FROM stakeholder_profiles WHERE user_id = $1', [req.user.id]);

    // Load chat history
    var history = await dbAll(
      'SELECT role, content FROM nev_debrief_messages WHERE match_feedback_id = $1 ORDER BY created_at ASC',
      [feedback.id]
    );

    // Build Nev's system prompt
    var reasons = [];
    try { reasons = JSON.parse(match.match_reasons || '[]'); } catch(e) {}

    var systemPrompt = buildNevDebriefPrompt({
      userName: currentUser ? currentUser.name : 'there',
      userCompany: currentUser ? currentUser.company : null,
      userType: userProfile ? userProfile.stakeholder_type : null,
      otherName: otherUser ? otherUser.name : 'your match',
      otherCompany: otherUser ? otherUser.company : null,
      eventName: match ? match.event_name : 'the event',
      matchScore: match ? match.score_total : null,
      matchReasons: reasons,
      feedbackSoFar: feedback
    });

    // Call LLM for Nev's response
    var nevReply = await getNevResponse(systemPrompt, history);

    // Save Nev's response
    await dbRun(
      'INSERT INTO nev_debrief_messages (match_feedback_id, role, content, metadata) VALUES ($1, $2, $3, $4)',
      [feedback.id, 'nev', nevReply.message, JSON.stringify(nevReply.extracted || {})]
    );

    // If Nev extracted insights, store them
    if (nevReply.extracted && nevReply.extracted.insights) {
      for (var ins of nevReply.extracted.insights) {
        await dbRun(
          'INSERT INTO feedback_insights (match_feedback_id, user_id, insight_type, insight_key, insight_value, confidence) VALUES ($1,$2,$3,$4,$5,$6)',
          [feedback.id, req.user.id, ins.type, ins.key, ins.value, ins.confidence || 0.6]
        );
      }
    }

    // Check if debrief feels complete
    if (nevReply.extracted && nevReply.extracted.debrief_complete) {
      await dbRun('UPDATE match_feedback SET nev_chat_completed = true, updated_at = NOW() WHERE id = $1', [feedback.id]);
    }

    res.json({
      reply: nevReply.message,
      extracted: nevReply.extracted || {},
      chat_complete: nevReply.extracted ? nevReply.extracted.debrief_complete : false
    });
  } catch (err) {
    console.error('Nev debrief chat error:', err);
    res.status(500).json({ error: 'Failed to process message' });
  }
});


// ══════════════════════════════════════════════════════
// NEV DEBRIEF — PROMPT BUILDER & LLM CALL
// ══════════════════════════════════════════════════════

function buildNevDebriefPrompt(ctx) {
  return `You are Nev, the AI concierge for Event Medium. You're having a casual post-meeting debrief with ${ctx.userName}${ctx.userCompany ? ' from ' + ctx.userCompany : ''}.

They were matched with ${ctx.otherName}${ctx.otherCompany ? ' (' + ctx.otherCompany + ')' : ''} at ${ctx.eventName}.
${ctx.matchScore ? 'Match score was ' + (ctx.matchScore * 100).toFixed(0) + '%.' : ''}
${ctx.matchReasons.length ? 'Match reasons: ' + ctx.matchReasons.slice(0, 3).join('; ') : ''}

YOUR GOALS (in order):
1. Find out if they actually met and how it went — keep it conversational, not a survey
2. Understand what made the match useful or not useful
3. Gently extract signals that improve future matching:
   - Were the shared themes actually what they talked about?
   - Did the intent/offering alignment play out?
   - Any new interests, focus shifts, or connections they're now looking for?
   - Would they want more matches like this one, or different?
4. If they mention specific outcomes (deal progress, collaboration, referral), capture those
5. When you have enough signal, wrap up warmly

STYLE:
- Brief, warm, curious — like a friend asking "how'd it go?"
- One question at a time, max two sentences per turn
- Never robotic or survey-like
- Use their name naturally
- If they're brief, respect that. If they open up, follow the thread.
- It's ok to be done in 3-4 turns if there's not much to discuss

EXTRACTION:
After each response, also output a JSON block with any extracted insights.
Format your response EXACTLY as:
MESSAGE: <your conversational response>
EXTRACTED: <json object>

The JSON should include:
{
  "insights": [
    { "type": "theme_correction|intent_update|archetype_signal|meeting_preference|anti_pattern|enrichment",
      "key": "<specific attribute>",
      "value": "<what you learned>",
      "confidence": 0.0-1.0 }
  ],
  "debrief_complete": false
}

Set debrief_complete to true when the conversation has naturally concluded.
${ctx.feedbackSoFar && ctx.feedbackSoFar.rating ? 'They already rated this match as: ' + ctx.feedbackSoFar.rating : ''}
${ctx.feedbackSoFar && ctx.feedbackSoFar.did_meet === true ? 'They confirmed they did meet.' : ''}
${ctx.feedbackSoFar && ctx.feedbackSoFar.did_meet === false ? 'They said they did not meet.' : ''}`;
}


async function getNevResponse(systemPrompt, history) {
  try {
    var Anthropic = require('@anthropic-ai/sdk');
    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    var messages = history.map(function(m) {
      return { role: m.role === 'nev' ? 'assistant' : 'user', content: m.content };
    });

    var response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      system: systemPrompt,
      messages: messages
    });

    var raw = response.content[0].text;

    // Parse MESSAGE: and EXTRACTED: blocks
    var messagePart = raw;
    var extracted = {};

    var msgMatch = raw.match(/MESSAGE:\s*([\s\S]*?)(?=EXTRACTED:|$)/i);
    if (msgMatch) messagePart = msgMatch[1].trim();

    var extMatch = raw.match(/EXTRACTED:\s*(\{[\s\S]*\})/i);
    if (extMatch) {
      try { extracted = JSON.parse(extMatch[1]); } catch(e) {
        console.error('Failed to parse Nev extraction:', e);
      }
    }

    return { message: messagePart, extracted: extracted };
  } catch (err) {
    console.error('Nev LLM error:', err);
    return {
      message: "Sorry, I'm having a moment. Can you try that again?",
      extracted: {}
    };
  }
}


// ══════════════════════════════════════════════════════
// INSIGHT EXTRACTION — from structured feedback
// ══════════════════════════════════════════════════════

async function extractDebriefInsights(matchId, userId, feedback, match) {
  try {
    var feedbackRecord = await dbGet(
      'SELECT id FROM match_feedback WHERE match_id = $1 AND user_id = $2',
      [matchId, userId]
    );
    if (!feedbackRecord) return;

    var insights = [];

    // Theme accuracy signal
    if (feedback.theme_accuracy === false) {
      var reasons = [];
      try { reasons = JSON.parse(match.match_reasons || '[]'); } catch(e) {}
      var themeReasons = reasons.filter(function(r) { return r.toLowerCase().indexOf('theme') !== -1; });
      if (themeReasons.length) {
        insights.push({
          type: 'theme_correction',
          key: 'theme_mismatch',
          value: 'Shared themes did not match actual conversation. Reasons were: ' + themeReasons.join('; '),
          confidence: 0.8
        });
      }
    }

    // Intent accuracy signal
    if (feedback.intent_accuracy === false) {
      insights.push({
        type: 'intent_update',
        key: 'intent_mismatch',
        value: 'Intent/offering alignment did not play out in practice',
        confidence: 0.7
      });
    }

    // Stakeholder fit signal
    if (feedback.stakeholder_fit_accuracy === false) {
      insights.push({
        type: 'archetype_signal',
        key: 'archetype_mismatch',
        value: 'Archetype pairing was not useful for this user',
        confidence: 0.7
      });
    }

    // Meeting preference signals
    if (feedback.meeting_quality && feedback.meeting_quality >= 4 && feedback.would_meet_again) {
      insights.push({
        type: 'meeting_preference',
        key: 'positive_pattern',
        value: 'High quality meeting, would meet again. Outcome: ' + (feedback.outcome_type || 'unspecified'),
        confidence: 0.9
      });
    }

    // Anti-patterns
    if (feedback.meeting_quality && feedback.meeting_quality <= 2) {
      insights.push({
        type: 'anti_pattern',
        key: 'low_quality_meeting',
        value: (feedback.what_didnt || 'No specifics provided'),
        confidence: 0.7
      });
    }

    // Store all insights
    for (var ins of insights) {
      await dbRun(
        'INSERT INTO feedback_insights (match_feedback_id, user_id, insight_type, insight_key, insight_value, confidence) VALUES ($1,$2,$3,$4,$5,$6)',
        [feedbackRecord.id, userId, ins.type, ins.key, ins.value, ins.confidence]
      );
    }
  } catch (err) {
    console.error('Insight extraction error:', err);
  }
}

module.exports = { router: router };