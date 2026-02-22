# Sprint 1 — 3 Bug Fixes

## What's in this folder

```
sprint1-fixes/
├── README.md                     ← you are here
├── update_event_dates.sql        ← Fix 1: real dates
└── public/js/calendar-modal.js   ← Fix 2: correctly named file
```

---

## Bug 1: All events show 15th of each month

**Cause:** Seed script used placeholder dates.
**Fix:** Run the SQL.

```bash
psql $DATABASE_URL -f update_event_dates.sql
```

Updates 13 events with verified 2026 dates (CES, MWC, SXSW, GTC, TOKEN2049×2, I/O, Computex, Collision, VivaTech, Disrupt, Web Summit, GITEX).

For any other events still showing placeholders after this, run:
```sql
SELECT id, name, city, event_date FROM events
WHERE EXTRACT(DAY FROM event_date) = 15
ORDER BY event_date;
```
Then update manually.

---

## Bug 2: "Add to Calendar" button does nothing

**Root cause: Filename mismatch.**

Both `events.html` and `event.html` load:
```html
<script src="/js/calendar-modal.js"></script>
```

But the file on disk is `calendar_modal.js` (underscore). Browser gets 404 → `window.CalendarModal` is `undefined` → every calendar action silently fails.

**Fix — option A (rename existing):**
```bash
cd ~/event-medium
mv public/js/calendar_modal.js public/js/calendar-modal.js
```

**Fix — option B (use the file from this folder):**
```bash
cp sprint1-fixes/public/js/calendar-modal.js ~/event-medium/public/js/calendar-modal.js
```

The code inside the file is correct — Blob MIME type, download trigger, Google/Outlook URL builders all work. It was just never loading.

---

## Bug 3: No calendar icon on event cards

**Cause:** The card footer only shows the icon for registered events, and uses `share-2` icon instead of `calendar-plus`.

**Fix:** In `public/events.html`, find this in `renderEvents()` (≈ line 398):

```javascript
'<button class="share-icon-btn" onclick="event.stopPropagation();openShareForEvent(' + e.id + ')" title="Share this event"><i data-lucide="share-2"></i></button>'
```

Replace with:

```javascript
'<button class="share-icon-btn" style="background:var(--pL);color:var(--p)" onclick="event.stopPropagation();openShareForEvent(' + e.id + ')" title="Add to Calendar"><i data-lucide="calendar-plus"></i></button>'
```

This changes: icon → `calendar-plus`, colour → blue (matches brand), tooltip → "Add to Calendar".

The `openShareForEvent()` function already calls `CalendarModal.open()` which shows the full calendar + share + Nev modal — so the plumbing was always correct, it just needed the right icon.

---

## Verify

After applying all 3:

1. **Dates** — Events page shows real dates (Jan 6, Mar 2, etc.), not all 15th
2. **Calendar modal** — Click "Find My People" → register → modal appears with Google / Outlook / .ics / Apple buttons
3. **Calendar icon** — Blue calendar-plus icon visible on registered event cards
4. **Download .ics** — Click "Download .ics" in modal → file downloads → opens in calendar app
5. **Google Calendar** — Click "Google Calendar" → opens new tab with pre-filled event

---

## Still Needed

- Dates for any events not in the 13 above (Consensus, Money20/20, London Tech Week, Slush, etc.)
- Run `SELECT id, name, city, event_date FROM events ORDER BY event_date` to see full list
- Git push to https://github.com/SocialMedium/eventmedium (auth still not configured)
