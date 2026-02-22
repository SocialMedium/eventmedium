#!/usr/bin/env python3
"""
EventMedium Sprint 1 — Apply all 3 bug fixes
Run from project root: python3 apply_fixes.py
"""

import os
import sys
import shutil
import subprocess

ROOT = os.getcwd()
FIXES = 0
ERRORS = []

def log(icon, msg):
    print(f"  {icon}  {msg}")

def fix_calendar_filename():
    """Fix 2: Move calendar_modal.js from routes/ → public/js/calendar-modal.js"""
    js_dir = os.path.join(ROOT, "public", "js")
    right = os.path.join(js_dir, "calendar-modal.js")

    # Already in the right place?
    if os.path.exists(right):
        log("✅", "public/js/calendar-modal.js already exists — skipping")
        return True

    # Ensure public/js/ exists
    os.makedirs(js_dir, exist_ok=True)

    # Search everywhere the file might be hiding
    search_paths = [
        os.path.join(ROOT, "routes", "calendar_modal.js"),
        os.path.join(ROOT, "routes", "calendar-modal.js"),
        os.path.join(ROOT, "public", "js", "calendar_modal.js"),
        os.path.join(ROOT, "calendar_modal.js"),
        os.path.join(ROOT, "calendar-modal.js"),
        os.path.join(ROOT, "lib", "calendar_modal.js"),
        os.path.join(ROOT, "src", "calendar_modal.js"),
    ]

    source = None
    for path in search_paths:
        if os.path.exists(path):
            source = path
            break

    # Fallback: recursive search
    if not source:
        for dirpath, _, filenames in os.walk(ROOT):
            if "node_modules" in dirpath:
                continue
            for fn in filenames:
                if "calendar" in fn.lower() and "modal" in fn.lower() and fn.endswith(".js"):
                    source = os.path.join(dirpath, fn)
                    break
            if source:
                break

    if not source:
        ERRORS.append("Could not find calendar_modal.js anywhere in project")
        log("❌", "calendar_modal.js not found anywhere")
        return False

    rel = os.path.relpath(source, ROOT)
    shutil.copy2(source, right)
    log("✅", f"Copied {rel} → public/js/calendar-modal.js")
    log("📍", f"Was in wrong directory — browser couldn't reach it via /js/calendar-modal.js")
    return True


def fix_card_calendar_icon():
    """Fix 3: Swap share-2 icon → calendar-plus on event cards"""
    html_path = os.path.join(ROOT, "public", "events.html")

    if not os.path.exists(html_path):
        ERRORS.append("public/events.html not found")
        log("❌", "events.html not found")
        return False

    with open(html_path, "r", encoding="utf-8") as f:
        content = f.read()

    # The target line in renderEvents()
    old = (
        '''(isRegistered ? '<button class="share-icon-btn" '''
        '''onclick="event.stopPropagation();openShareForEvent(' + e.id + ')" '''
        '''title="Share this event"><i data-lucide="share-2"></i></button>' : '') +'''
    )

    new = (
        '''(isRegistered ? '<button class="share-icon-btn" style="background:var(--pL);color:var(--p)" '''
        '''onclick="event.stopPropagation();openShareForEvent(' + e.id + ')" '''
        '''title="Add to Calendar"><i data-lucide="calendar-plus"></i></button>' : '') +'''
    )

    if new in content:
        log("✅", "Calendar icon already patched — skipping")
        return True

    if old not in content:
        # Try a looser match
        if 'share-icon-btn' in content and 'openShareForEvent' in content and 'share-2' in content:
            content = content.replace(
                'title="Share this event"><i data-lucide="share-2"></i>',
                'title="Add to Calendar"><i data-lucide="calendar-plus"></i>'
            )
            content = content.replace(
                '''class="share-icon-btn" onclick''',
                '''class="share-icon-btn" style="background:var(--pL);color:var(--p)" onclick''',
                1  # only first occurrence (the card, not the modal)
            )
            with open(html_path, "w", encoding="utf-8") as f:
                f.write(content)
            log("✅", "Patched calendar icon (loose match)")
            return True

        ERRORS.append("Could not find the share-icon-btn line to patch in events.html")
        log("❌", "Target line not found in events.html — manual patch needed")
        return False

    # Backup
    shutil.copy2(html_path, html_path + ".bak")

    content = content.replace(old, new)
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(content)

    log("✅", "Patched events.html — share-2 → calendar-plus, blue styling")
    return True


def fix_event_dates():
    """Fix 1: Update placeholder dates via SQL"""
    sql = """
BEGIN;

UPDATE events SET event_date = '2026-01-06'
WHERE name ILIKE '%%CES%%' OR name ILIKE '%%Consumer Electronics Show%%';

UPDATE events SET event_date = '2026-03-02'
WHERE name ILIKE '%%MWC%%' OR name ILIKE '%%Mobile World Congress%%';

UPDATE events SET event_date = '2026-03-12'
WHERE name ILIKE '%%SXSW%%' OR name ILIKE '%%South by Southwest%%';

UPDATE events SET event_date = '2026-03-16'
WHERE name ILIKE '%%GTC%%' OR name ILIKE '%%GPU Technology%%';

UPDATE events SET event_date = '2026-04-29'
WHERE name ILIKE '%%TOKEN2049%%' AND (city ILIKE '%%Dubai%%' OR event_date < '2026-07-01');

UPDATE events SET event_date = '2026-05-19'
WHERE name ILIKE '%%Google I/O%%' OR name ILIKE '%%Google IO%%';

UPDATE events SET event_date = '2026-06-02'
WHERE name ILIKE '%%Computex%%';

UPDATE events SET event_date = '2026-06-03'
WHERE name ILIKE '%%Collision%%' AND city ILIKE '%%Toronto%%';

UPDATE events SET event_date = '2026-06-17'
WHERE name ILIKE '%%VivaTech%%' OR name ILIKE '%%Viva Tech%%';

UPDATE events SET event_date = '2026-10-07'
WHERE name ILIKE '%%TOKEN2049%%' AND (city ILIKE '%%Singapore%%' OR event_date > '2026-07-01');

UPDATE events SET event_date = '2026-10-13'
WHERE name ILIKE '%%TechCrunch%%' OR name ILIKE '%%Disrupt%%';

UPDATE events SET event_date = '2026-11-09'
WHERE name ILIKE '%%Web Summit%%';

UPDATE events SET event_date = '2026-12-07'
WHERE name ILIKE '%%GITEX%%';

COMMIT;

SELECT id, name, city, event_date FROM events ORDER BY event_date ASC;
"""

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        # Try .env file
        env_path = os.path.join(ROOT, ".env")
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("DATABASE_URL="):
                        db_url = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break

    if not db_url:
        log("⚠️", "DATABASE_URL not found — saving SQL to apply_dates.sql")
        sql_path = os.path.join(ROOT, "apply_dates.sql")
        with open(sql_path, "w") as f:
            f.write(sql)
        log("📄", f"Run manually: psql $DATABASE_URL -f {sql_path}")
        return False

    try:
        result = subprocess.run(
            ["psql", db_url, "-c", sql],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            log("✅", "Event dates updated in database")
            # Show results
            lines = result.stdout.strip().split("\n")
            for line in lines[-20:]:
                if line.strip():
                    log("  ", line)
            return True
        else:
            ERRORS.append(f"psql error: {result.stderr.strip()}")
            log("❌", f"SQL failed: {result.stderr.strip()[:200]}")
            return False
    except FileNotFoundError:
        log("⚠️", "psql not found — saving SQL to apply_dates.sql")
        sql_path = os.path.join(ROOT, "apply_dates.sql")
        with open(sql_path, "w") as f:
            f.write(sql)
        log("📄", f"Run manually: psql $DATABASE_URL -f {sql_path}")
        return False
    except Exception as e:
        ERRORS.append(str(e))
        log("❌", f"SQL error: {e}")
        return False


def main():
    global FIXES

    print()
    print("━" * 50)
    print("  EventMedium Sprint 1 — Applying 3 fixes")
    print("━" * 50)
    print()

    # Verify we're in the right directory
    if not os.path.exists(os.path.join(ROOT, "public")):
        print("  ❌  No 'public/' directory found.")
        print("     Run this from your EventMedium project root.")
        sys.exit(1)

    # Fix 1: Calendar file location + rename
    print("  [1/3] Calendar modal (move from routes/ → public/js/)")
    if fix_calendar_filename():
        FIXES += 1
    print()

    # Fix 2: Card icon patch
    print("  [2/3] Calendar icon on event cards")
    if fix_card_calendar_icon():
        FIXES += 1
    print()

    # Fix 3: Database dates
    print("  [3/3] Event dates (placeholder → real 2026)")
    if fix_event_dates():
        FIXES += 1
    print()

    # Summary
    print("━" * 50)
    if FIXES == 3:
        print("  ✅  All 3 fixes applied. Restart your server and verify.")
    elif FIXES > 0:
        print(f"  ⚠️  {FIXES}/3 fixes applied.")
        if ERRORS:
            print("  Issues:")
            for e in ERRORS:
                print(f"    • {e}")
    else:
        print("  ❌  No fixes applied. Check errors above.")
    print("━" * 50)
    print()


if __name__ == "__main__":
    main()
