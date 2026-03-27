// ── Outcome Logger ──
// Fire-and-forget logging for signals, matches, and Nev sessions.
// Never throws — never blocks the primary flow.

var { dbRun } = require('../db');

async function logSignalOutcome(data) {
  try {
    await dbRun(
      `INSERT INTO signal_outcome_log (
        community_id, signal_type, source_type, provider,
        cost_of_signal, canonical_theme, jurisdiction,
        action_taken, action_taken_at, outcome, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        data.community_id || null,
        data.signal_type,
        data.source_type || null,
        data.provider || null,
        data.cost_of_signal || null,
        data.canonical_theme || null,
        data.jurisdiction || null,
        data.action_taken || 'ignored',
        data.action_taken_at || new Date(),
        data.outcome || 'pending',
        JSON.stringify(data.metadata || {})
      ]
    );
  } catch (err) {
    console.error('[outcome_logger] signal log failed:', err.message);
  }
}

async function logMatchOutcome(data) {
  try {
    await dbRun(
      `INSERT INTO match_outcome_log (
        match_id, community_id, event_id, source,
        score_total, score_theme, score_intent,
        score_stakeholder, score_capital, score_signal_convergence,
        stakeholder_a, stakeholder_b, themes_a, themes_b,
        both_accepted, signal_context
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        data.match_id || null,
        data.community_id || null,
        data.event_id || null,
        data.source || 'event',
        data.score_total || null,
        data.score_theme || null,
        data.score_intent || null,
        data.score_stakeholder || null,
        data.score_capital || null,
        data.score_signal_convergence || null,
        data.stakeholder_a || null,
        data.stakeholder_b || null,
        data.themes_a || [],
        data.themes_b || [],
        data.both_accepted || false,
        JSON.stringify(data.signal_context || {})
      ]
    );
  } catch (err) {
    console.error('[outcome_logger] match log failed:', err.message);
  }
}

async function logNevOutcome(data) {
  try {
    await dbRun(
      `INSERT INTO nev_outcome_log (
        session_type, community_id, stakeholder_type,
        turn_count, session_duration_seconds,
        outcome, outcome_detail
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        data.session_type,
        data.community_id || null,
        data.stakeholder_type || null,
        data.turn_count || null,
        data.session_duration_seconds || null,
        data.outcome || 'unknown',
        JSON.stringify(data.outcome_detail || {})
      ]
    );
  } catch (err) {
    console.error('[outcome_logger] nev log failed:', err.message);
  }
}

module.exports = { logSignalOutcome, logMatchOutcome, logNevOutcome };
