#!/bin/bash
# ══════════════════════════════════════════════════════
# EventMedium.ai — Deploy Script
# Inbox + Nev Debrief Feedback Loop
# 
# INSTRUCTIONS:
# 1. Open VS Code
# 2. Open Terminal (Terminal → New Terminal)
# 3. Copy-paste this ENTIRE script and press Enter
# ══════════════════════════════════════════════════════

set -e  # Stop on any error

echo ""
echo "═══════════════════════════════════════════════"
echo "  EventMedium Deploy — Starting..."
echo "═══════════════════════════════════════════════"
echo ""

# ── STEP 1: Navigate to project ──
cd ~/Downloads/event-medium
echo "✓ In project directory: $(pwd)"

# ── STEP 2: Replace matches.js with patched version ──
# (backs up original first)
cp routes/matches.js routes/matches.js.backup
cp ~/Downloads/event-medium/matches_patched.js routes/matches.js
echo "✓ routes/matches.js patched (backup at matches.js.backup)"

# ── STEP 3: Place inbox.html ──
cp ~/Downloads/event-medium/inbox_patched.html public/inbox.html
echo "✓ public/inbox.html created with debrief button"

# ── STEP 4: Place debrief.html ──
cp debrief.html public/debrief.html
echo "✓ public/debrief.html placed"

# ── STEP 5: Copy migration file to project root ──
# (already there if you dropped the files in the project)
if [ ! -f migration_inbox.sql ]; then
  echo "⚠ migration_inbox.sql not found in project root"
  echo "  Make sure it's in ~/Downloads/event-medium/"
  exit 1
fi
echo "✓ migration_inbox.sql ready"

# ── STEP 6: Install Anthropic SDK ──
npm install @anthropic-ai/sdk
echo "✓ @anthropic-ai/sdk installed"

# ── STEP 7: Create .gitignore if missing ──
if [ ! -f .gitignore ]; then
cat > .gitignore << 'GITIGNORE'
node_modules/
.env
.DS_Store
*.backup
GITIGNORE
echo "✓ .gitignore created"
else
  # Make sure node_modules and .env are ignored
  grep -q "node_modules" .gitignore || echo "node_modules/" >> .gitignore
  grep -q ".env" .gitignore || echo ".env" >> .gitignore
  echo "✓ .gitignore verified"
fi

# ── STEP 8: Init git + push to GitHub ──
if [ ! -d .git ]; then
  git init
  echo "✓ Git initialized"
fi

# Set branch to main
git branch -M main

# Add GitHub remote (skip if already set)
git remote get-url origin 2>/dev/null || git remote add origin https://github.com/SocialMedium/eventmedium.git
echo "✓ GitHub remote set"

# Commit everything
git add -A
git commit -m "EventMedium v1 — inbox + Nev debrief feedback loop"
echo "✓ Committed"

# Push
echo ""
echo "═══════════════════════════════════════════════"
echo "  Pushing to GitHub..."
echo "  (you may be asked to log in to GitHub)"
echo "═══════════════════════════════════════════════"
echo ""
git push -u origin main
echo ""
echo "✓ Code pushed to GitHub!"

# ── STEP 9: Run migration on Railway Postgres ──
echo ""
echo "═══════════════════════════════════════════════"
echo "  Running database migration on Railway..."
echo "═══════════════════════════════════════════════"
echo ""
railway run node -e "
  require('dotenv').config();
  const {dbRun} = require('./db');
  const fs = require('fs');
  const sql = fs.readFileSync('migration_inbox.sql', 'utf8');
  const statements = sql.split(';').filter(s => s.trim());
  (async () => {
    for (const stmt of statements) {
      if (stmt.trim()) {
        try {
          await dbRun(stmt);
        } catch(e) {
          if (!e.message.includes('already exists')) {
            console.error('Migration error:', e.message);
          }
        }
      }
    }
    console.log('Migration complete!');
    process.exit(0);
  })();
"
echo "✓ Database migration complete"

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅  DEPLOY COMPLETE!"
echo "═══════════════════════════════════════════════"
echo ""
echo "  NEXT STEPS (do these in your browser):"
echo ""
echo "  1. Go to https://railway.app → your project"
echo "  2. Click '+ New' → 'GitHub Repo'"
echo "  3. Select 'SocialMedium/eventmedium'"
echo "  4. Add these environment variables:"
echo "     • ANTHROPIC_API_KEY = sk-ant-..."
echo "     • DATABASE_URL = (copy from your Postgres service)"
echo "     • JWT_SECRET = (whatever you use locally)"
echo "     • NODE_ENV = production"
echo "     • PORT = (Railway sets this, but check)"
echo "  5. Railway will auto-deploy from GitHub"
echo ""
echo "  TEST THE FLOW:"
echo "  mutual match → inbox → message → debrief → Nev chat"
echo ""
