# EventMedium.ai — Inbox Integration Guide

**Date:** Feb 22, 2026

---

## Files Delivered

| File | What it does |
|------|-------------|
| `migration_inbox.sql` | Creates tables: `match_feedback`, `nev_debrief_messages`, `feedback_insights` + adds `user_a_context`/`user_b_context` columns to `event_matches` |
| `inbox_routes.js` | 6 new API routes to paste into `matches.js` |
| `debrief.html` | Nev debrief chat UI — post-meeting feedback page |
| `db_patch.js` | Adds `dbGet` and `dbAll` to your `db.js` |
| `inbox_patch_notes.js` | Small changes to `inbox.html` for debrief button |

---

## Integration Order

### Step 1: Patch db.js

Add `dbGet` and `dbAll` wrappers (see `db_patch.js`). They wrap your existing `dbRun`.

### Step 2: Run migration

```bash
psql $DATABASE_URL -f migration_inbox.sql
```

Or via node:
```bash
node -e "require('dotenv').config(); const {dbRun}=require('./db'); const fs=require('fs'); const sql=fs.readFileSync('migration_inbox.sql','utf8'); dbRun(sql).then(()=>{console.log('Done');process.exit(0)})"
```

### Step 3: Add routes to matches.js

Copy the route handlers from `inbox_routes.js` into `matches.js` — paste them **before** the `module.exports` line. The routes are:

- `GET /mutual` — inbox primary data
- `POST /:matchId/context` — inline message notes
- `POST /:matchId/feedback` — quick rating buttons
- `POST /:matchId/debrief` — structured post-meeting feedback
- `GET /:matchId/debrief` — debrief state + chat history
- `POST /:matchId/debrief/chat` — Nev conversation turns

Also update `module.exports` to include new helpers.

### Step 4: Add npm dependency

```bash
npm install @anthropic-ai/sdk
```

Add to `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

### Step 5: Place frontend files

```bash
cp debrief.html public/
```

Apply the patches from `inbox_patch_notes.js` to your existing `inbox.html`.

### Step 6: Verify route mounting

In your main `app.js` / `server.js`, confirm matches routes are mounted:
```javascript
app.use('/api/matches', require('./routes/matches').router);
```

---

## How the Feedback Loop Works

```
MATCH REVEALED
     ↓
  INBOX (inbox.html)
     ├── Quick feedback buttons: valuable / not relevant / didn't connect
     ├── Inline message notes (context)
     └── "Debrief with Nev" button
              ↓
       DEBRIEF CHAT (debrief.html)
         Nev asks: "How'd it go with [name]?"
         Conversational 3-5 turn debrief
              ↓
       SIGNAL EXTRACTION (automatic)
         ├── theme_correction    → did shared themes match reality?
         ├── intent_update       → did wants/offers align?
         ├── archetype_signal    → was the pairing type useful?
         ├── meeting_preference  → positive patterns to repeat
         ├── anti_pattern        → what to avoid next time
         └── enrichment          → new interests, focus shifts
              ↓
       feedback_insights table
         (feeds back into scoreMatch() for future matching)
```

### Nev's Debrief Style
- Casual, warm, 1 question at a time
- Extracts structured signals without feeling like a survey
- 3-5 turns typical, respects brevity
- Automatically marks complete when enough signal gathered
- Uses Anthropic API (Claude Sonnet) for conversation

### Data Flow for Tuning
Each debrief produces rows in `feedback_insights` with:
- `insight_type`: what kind of signal
- `insight_key`: specific attribute
- `insight_value`: what was learned
- `confidence`: 0-1 reliability score

Future matching runs can query these to adjust weights:
```sql
-- Find anti-patterns for a user
SELECT * FROM feedback_insights
WHERE user_id = ? AND insight_type = 'anti_pattern';

-- Find what archetype pairings actually work
SELECT * FROM feedback_insights
WHERE insight_type = 'meeting_preference' AND confidence > 0.7;
```

---

## Deploy Checklist

- [ ] `db.js` patched with `dbGet`/`dbAll`
- [ ] Migration run on Railway Postgres
- [ ] Routes pasted into `matches.js`
- [ ] `@anthropic-ai/sdk` installed
- [ ] `ANTHROPIC_API_KEY` in Railway env vars
- [ ] `debrief.html` in `public/`
- [ ] `inbox.html` patched with debrief button
- [ ] `git add -A && git commit -m "Inbox + Nev debrief feedback loop"`
- [ ] `git push origin main`
- [ ] Railway auto-deploy or `railway up`
- [ ] Test: mutual match → inbox → message → debrief → Nev chat
