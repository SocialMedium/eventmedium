var express = require('express');
var crypto = require('crypto');
var { dbGet, dbRun, dbAll } = require('../db');
var { authenticateToken, optionalAuth } = require('../middleware/auth');
var { normalizeThemes } = require('../lib/theme_taxonomy');
var { embedEvent } = require('../lib/vector_search');

var router = express.Router();

// ── GET /api/events ── (list with filters)
router.get('/', optionalAuth, async function(req, res) {
  try {
    var { theme, city, country, search, upcoming, limit, offset } = req.query;
    var conditions = [];
    var params = [];
    var idx = 1;

    if (theme) {
      conditions.push('themes::text ILIKE $' + idx);
      params.push('%' + theme + '%');
      idx++;
    }
    if (city) {
      conditions.push('city ILIKE $' + idx);
      params.push('%' + city + '%');
      idx++;
    }
    if (country) {
      conditions.push('country ILIKE $' + idx);
      params.push('%' + country + '%');
      idx++;
    }
    if (search) {
      conditions.push('(name ILIKE $' + idx + ' OR description ILIKE $' + idx + ')');
      params.push('%' + search + '%');
      idx++;
    }
    if (upcoming === 'true') {
      conditions.push('event_date >= CURRENT_DATE');
    }

    conditions.push('community_id IS NULL');
    var where = ' WHERE ' + conditions.join(' AND ');
    var lim = parseInt(limit) || 50;
    var off = parseInt(offset) || 0;

    var events = await dbAll(
      'SELECT * FROM events' + where + ' ORDER BY event_date ASC LIMIT $' + idx + ' OFFSET $' + (idx + 1),
      params.concat([lim, off])
    );

    // Get registration counts
    for (var i = 0; i < events.length; i++) {
      var count = await dbGet(
        'SELECT COUNT(*) as count FROM event_registrations WHERE event_id = $1 AND status = $2',
        [events[i].id, 'active']
      );
      events[i].registration_count = parseInt(count.count);
    }

    res.json({ events: events });
  } catch (err) {
    console.error('List events error:', err);
    res.status(500).json({ error: 'Failed to load events' });
  }
});

// ── GET /api/events/user/registrations ──
router.get('/user/registrations', authenticateToken, async function(req, res) {
  try {
    var registrations = await dbAll(
      `SELECT e.*, er.registered_at, er.status
       FROM event_registrations er
       JOIN events e ON e.id = er.event_id
       WHERE er.user_id = $1 AND er.status = $2
       ORDER BY e.event_date ASC`,
      [req.user.id, 'active']
    );
    res.json({ registrations: registrations, events: registrations });
  } catch (err) {
    console.error('My registrations error:', err);
    res.status(500).json({ error: 'Failed to load registrations' });
  }
});


// ── GET /api/events/recommended — personalized event scoring ──
router.get('/recommended', authenticateToken, async function(req, res) {
  try {
    // Load user profile
    var profile = await dbGet(
      'SELECT stakeholder_type, themes, intent, offering, geography, deal_details FROM stakeholder_profiles WHERE user_id = $1',
      [req.user.id]
    );
    if (!profile || !profile.themes) {
      return res.json({ recommendations: [], reason: 'no_profile' });
    }

    var userThemes = typeof profile.themes === 'string' ? JSON.parse(profile.themes) : (profile.themes || []);
    var userIntent = typeof profile.intent === 'string' ? JSON.parse(profile.intent) : (profile.intent || []);
    var userOffering = typeof profile.offering === 'string' ? JSON.parse(profile.offering) : (profile.offering || []);
    var userGeo = (profile.geography || '').toLowerCase();
    var userType = profile.stakeholder_type || '';

    // Load upcoming events not already registered for
    var events = await dbAll(
      `SELECT e.*, 
        (SELECT COUNT(*) FROM event_registrations WHERE event_id = e.id AND status = 'active') as reg_count
       FROM events e 
       WHERE e.event_date >= CURRENT_DATE AND e.community_id IS NULL 
       AND e.id NOT IN (SELECT event_id FROM event_registrations WHERE user_id = $1 AND status = 'active')
       ORDER BY e.event_date ASC`,
      [req.user.id]
    );

    // Score each event
    var scored = [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var evThemes = typeof ev.themes === 'string' ? JSON.parse(ev.themes) : (ev.themes || []);
      var evCity = (ev.city || '').toLowerCase();
      var evCountry = (ev.country || '').toLowerCase();

      // 1. Theme overlap (0-1) — Jaccard
      var themeSet = new Set(userThemes.map(function(t) { return t.toLowerCase(); }));
      var evSet = new Set(evThemes.map(function(t) { return t.toLowerCase(); }));
      var intersection = 0;
      evSet.forEach(function(t) { if (themeSet.has(t)) intersection++; });
      var union = new Set([...themeSet, ...evSet]).size;
      var themeScore = union > 0 ? intersection / union : 0;

      // 2. Geographic relevance (0-1)
      var geoScore = 0;
      if (userGeo) {
        if (userGeo.indexOf(evCity) !== -1 || evCity.indexOf(userGeo) !== -1) geoScore = 1;
        else if (userGeo.indexOf(evCountry) !== -1 || evCountry.indexOf(userGeo) !== -1) geoScore = 0.6;
        else {
          // Region matching
          var euroCountries = ['uk','germany','france','spain','netherlands','sweden','switzerland','italy','portugal','austria','belgium','denmark','finland','norway','ireland','poland','czech','romania','greece'];
          var apacCountries = ['singapore','australia','japan','south korea','china','india','hong kong','taiwan','new zealand','indonesia','thailand','malaysia','vietnam','philippines'];
          var naCountries = ['usa','us','canada','united states'];
          var meaCountries = ['uae','saudi arabia','israel','qatar','south africa','kenya','nigeria','egypt'];
          var userRegion = '';
          var evRegion = '';
          [['europe', euroCountries], ['apac', apacCountries], ['americas', naCountries], ['mea', meaCountries]].forEach(function(r) {
            r[1].forEach(function(c) {
              if (userGeo.indexOf(c) !== -1) userRegion = r[0];
              if (evCountry.indexOf(c) !== -1 || evCity.indexOf(c) !== -1) evRegion = r[0];
            });
          });
          if (userRegion && userRegion === evRegion) geoScore = 0.3;
        }
      }
      // 3. Composite score
      var total = (themeScore * 0.6) + (geoScore * 0.4);
      if (total > 0.1) {
        scored.push({ id: ev.id, name: ev.name, event_date: ev.event_date, city: ev.city, country: ev.country, slug: ev.slug, score: Math.round(total * 100), reasons: [], themeScore: themeScore, geoScore: geoScore });
      }
    }
    scored.sort(function(a, b) { return b.score - a.score; });
    res.json({ recommendations: scored.slice(0, 10) });
  } catch (err) {
    console.error('Recommendations error:', err);
    res.status(500).json({ error: 'Failed to load recommendations' });
  }
});

// ── GET /api/events/verify-claim ── (email link, no auth)
router.get('/verify-claim', async function(req, res) {
  try {
    var token = req.query.token;
    if (!token) return res.status(400).json({ error: 'Token required' });

    var event = await dbGet(
      'SELECT * FROM events WHERE claim_token = $1 AND claim_token_expires > NOW()',
      [token]
    );
    if (!event) return res.status(400).json({ error: 'This verification link has expired or is invalid' });

    if (event.is_flagship) {
      // Flagship: verify email but require manual admin approval
      await dbRun(
        'UPDATE events SET claim_pending = true, claim_token = NULL, claim_token_expires = NULL WHERE id = $1',
        [event.id]
      );
      return res.json({ status: 'pending_approval', message: 'Your claim is verified and pending admin approval. You will be notified within 24 hours.', event_name: event.name });
    } else {
      // Non-flagship: auto-approve
      await dbRun(
        'UPDATE events SET claim_verified = true, claimed_at = NOW(), claim_pending = false, claim_token = NULL, claim_token_expires = NULL WHERE id = $1',
        [event.id]
      );
      return res.json({ status: 'approved', event_slug: event.slug, event_id: event.id, event_name: event.name });
    }
  } catch (err) {
    console.error('Verify claim error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ── GET /api/events/:id/claim-status ──
router.get('/:id/claim-status', optionalAuth, async function(req, res) {
  try {
    var event = await dbGet(
      'SELECT id, owner_user_id, claim_verified, claim_pending, is_flagship FROM events WHERE id = $1',
      [parseInt(req.params.id)]
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });

    var userId = req.user ? req.user.id : null;
    res.json({
      is_claimed: !!event.claim_verified,
      is_mine: !!(userId && event.owner_user_id === userId && event.claim_verified),
      claim_pending: !!event.claim_pending,
      is_my_pending: !!(userId && event.owner_user_id === userId && event.claim_pending),
      is_flagship: !!event.is_flagship
    });
  } catch (err) {
    console.error('Claim status error:', err);
    res.status(500).json({ error: 'Failed to load claim status' });
  }
});

// ── POST /api/events/:id/claim ──
router.post('/:id/claim', authenticateToken, async function(req, res) {
  try {
    var eventId = parseInt(req.params.id);
    var { organiser_email, organiser_role, website } = req.body;

    if (!organiser_email || !website) {
      return res.status(400).json({ error: 'Email and website are required' });
    }

    var event = await dbGet('SELECT * FROM events WHERE id = $1', [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (event.claim_verified) {
      return res.status(409).json({ error: 'This event already has a verified organiser' });
    }
    if (event.claim_pending && event.owner_user_id !== req.user.id) {
      return res.status(409).json({ error: 'A claim is already pending for this event' });
    }

    // Domain match check
    var emailDomain = organiser_email.split('@')[1] ? organiser_email.split('@')[1].toLowerCase() : '';
    var websiteDomain = '';
    try {
      websiteDomain = new URL(website).hostname.replace(/^www\./, '').toLowerCase();
    } catch(e) {
      return res.status(400).json({ error: 'Please enter a valid website URL (include https://)' });
    }
    if (!emailDomain || emailDomain !== websiteDomain) {
      return res.status(400).json({ error: 'Please use an email address from your event\'s official domain (' + websiteDomain + ')' });
    }

    // Generate token
    var claimToken = crypto.randomBytes(32).toString('hex');
    var tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await dbRun(
      `UPDATE events SET
        claim_pending = true,
        claim_token = $1,
        claim_token_expires = $2,
        owner_user_id = $3,
        owner_email = $4,
        owner_website = $5
       WHERE id = $6`,
      [claimToken, tokenExpires, req.user.id, organiser_email, website, eventId]
    );

    // Send verification email
    var appUrl = process.env.APP_URL || 'https://eventmedium.ai';
    var verifyUrl = appUrl + '/verify-claim.html?token=' + claimToken;
    var user = await dbGet('SELECT name FROM users WHERE id = $1', [req.user.id]);
    var userName = user ? user.name : 'Organiser';

    var Resend;
    try { Resend = require('resend'); } catch(e) {
      console.error('Resend not installed');
      return res.status(500).json({ error: 'Email service not configured' });
    }
    var resend = new Resend.Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'nev@eventmedium.ai',
      to: organiser_email,
      subject: 'Verify your claim for ' + event.name + ' on EventMedium.ai',
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:40px 24px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:32px">
            <div style="width:28px;height:28px;border-radius:6px;background:linear-gradient(135deg,#0066ff,#0052cc)"></div>
            <span style="font-size:16px;font-weight:700;color:#1a1a2e">Event <span style="color:#0066ff">Medium</span></span>
          </div>
          <h1 style="font-size:22px;font-weight:700;color:#1a1a2e;margin-bottom:8px">Verify your claim</h1>
          <p style="font-size:14px;color:#555;margin-bottom:24px">Hi ${userName}, you've requested to claim <strong>${event.name}</strong> on EventMedium.ai.</p>
          <p style="font-size:14px;color:#555;margin-bottom:24px">Click below to verify your email and complete your claim:</p>
          <a href="${verifyUrl}" style="display:inline-block;padding:14px 28px;background:#0066ff;color:white;font-size:14px;font-weight:600;border-radius:10px;text-decoration:none;margin-bottom:24px">Verify My Claim →</a>
          <p style="font-size:12px;color:#999;margin-bottom:8px">This link expires in 24 hours.</p>
          <p style="font-size:12px;color:#999">If you didn't request this, you can safely ignore this email.</p>
          <div style="margin-top:32px;padding-top:16px;border-top:1px solid rgba(0,0,0,0.06);font-size:11px;color:#999">
            EventMedium.ai · Signal-driven networking
          </div>
        </div>
      `
    });

    // Notify admin if flagship
    if (event.is_flagship) {
      try {
        await resend.emails.send({
          from: process.env.FROM_EMAIL || 'nev@eventmedium.ai',
          to: 'jon@mitchellake.com',
          subject: 'Flagship claim pending: ' + event.name,
          html: `
            <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:40px 24px">
              <h2 style="font-size:18px;font-weight:700;color:#1a1a2e;margin-bottom:16px">Flagship claim pending approval</h2>
              <p style="font-size:14px;color:#555;margin-bottom:8px"><strong>${userName}</strong> (${organiser_email}) has claimed <strong>${event.name}</strong>.</p>
              <p style="font-size:14px;color:#555;margin-bottom:8px">Role: ${organiser_role || 'Not specified'}</p>
              <p style="font-size:14px;color:#555;margin-bottom:24px">Website provided: ${website}</p>
              <p style="font-size:13px;color:#888;margin-bottom:16px">Use this admin endpoint to approve (POST with your auth token):</p>
              <code style="display:block;padding:12px 16px;background:#f0f4ff;border-radius:8px;font-size:13px;color:#0066ff;word-break:break-all">POST ${process.env.APP_URL || 'https://eventmedium.ai'}/api/events/${eventId}/approve-claim</code>
              <div style="margin-top:32px;padding-top:16px;border-top:1px solid rgba(0,0,0,0.06);font-size:11px;color:#999">EventMedium.ai</div>
            </div>
          `
        });
      } catch(adminEmailErr) {
        console.error('Admin notification email failed:', adminEmailErr);
      }
    }

    res.json({ message: 'Check your email at ' + organiser_email + ' to verify your claim. The link expires in 24 hours.' });
  } catch (err) {
    console.error('Claim event error:', err);
    res.status(500).json({ error: 'Claim failed: ' + err.message });
  }
});

// ── POST /api/events/:id/approve-claim (admin only, user ID 2) ──
router.post('/:id/approve-claim', authenticateToken, async function(req, res) {
  try {
    if (req.user.id !== 2) return res.status(403).json({ error: 'Admin only' });

    var eventId = parseInt(req.params.id);
    var event = await dbGet('SELECT * FROM events WHERE id = $1 AND claim_pending = true', [eventId]);
    if (!event) return res.status(404).json({ error: 'No pending claim found for this event' });

    await dbRun(
      'UPDATE events SET claim_verified = true, claimed_at = NOW(), claim_pending = false WHERE id = $1',
      [eventId]
    );

    // Notify the organiser
    if (event.owner_email) {
      var appUrl = process.env.APP_URL || 'https://eventmedium.ai';
      var dashUrl = appUrl + '/event-dashboard.html?id=' + eventId;
      var ownerUser = event.owner_user_id ? await dbGet('SELECT name FROM users WHERE id = $1', [event.owner_user_id]) : null;
      var ownerName = ownerUser ? ownerUser.name : 'Organiser';

      try {
        var Resend = require('resend');
        var resend = new Resend.Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: process.env.FROM_EMAIL || 'nev@eventmedium.ai',
          to: event.owner_email,
          subject: 'Your EventMedium dashboard for ' + event.name + ' is ready',
          html: `
            <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:40px 24px">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:32px">
                <div style="width:28px;height:28px;border-radius:6px;background:linear-gradient(135deg,#0066ff,#0052cc)"></div>
                <span style="font-size:16px;font-weight:700;color:#1a1a2e">Event <span style="color:#0066ff">Medium</span></span>
              </div>
              <h1 style="font-size:22px;font-weight:700;color:#1a1a2e;margin-bottom:8px">Your dashboard is ready</h1>
              <p style="font-size:14px;color:#555;margin-bottom:24px">Hi ${ownerName}, your claim for <strong>${event.name}</strong> has been approved.</p>
              <a href="${dashUrl}" style="display:inline-block;padding:14px 28px;background:#0066ff;color:white;font-size:14px;font-weight:600;border-radius:10px;text-decoration:none;margin-bottom:24px">Go to your dashboard →</a>
              <p style="font-size:14px;color:#555">You now have access to full attendee intelligence, gap analysis, and matching insights for your event.</p>
              <div style="margin-top:32px;padding-top:16px;border-top:1px solid rgba(0,0,0,0.06);font-size:11px;color:#999">EventMedium.ai · Signal-driven networking</div>
            </div>
          `
        });
      } catch(emailErr) {
        console.error('Approval email failed:', emailErr);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Approve claim error:', err);
    res.status(500).json({ error: 'Approval failed' });
  }
});

// ── GET /api/events/community/:communityId ── (events for a community, owner only)
router.get('/community/:communityId', authenticateToken, async function(req, res) {
  try {
    var communityId = parseInt(req.params.communityId);
    if (isNaN(communityId)) return res.status(400).json({ error: 'Invalid community ID' });

    var community = await dbGet(
      'SELECT id FROM communities WHERE id = $1 AND owner_user_id = $2',
      [communityId, req.user.id]
    );
    if (!community) return res.status(403).json({ error: 'Access denied' });

    var events = await dbAll(
      `SELECT e.*,
        (SELECT COUNT(*) FROM event_registrations WHERE event_id = e.id AND status = 'active') as registration_count
       FROM events e WHERE e.community_id = $1 ORDER BY e.event_date ASC`,
      [communityId]
    );
    res.json({ events: events });
  } catch (err) {
    console.error('Community events error:', err);
    res.status(500).json({ error: 'Failed to load community events' });
  }
});

// ── GET /api/events/:id ── (single event)
router.get('/:id', optionalAuth, async function(req, res) {
  try {
    var event = await dbGet('SELECT * FROM events WHERE id = $1', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    var count = await dbGet(
      'SELECT COUNT(*) as count FROM event_registrations WHERE event_id = $1 AND status = $2',
      [event.id, 'active']
    );
    event.registration_count = parseInt(count.count);

    // Check if current user is registered
    if (req.user) {
      var reg = await dbGet(
        'SELECT id FROM event_registrations WHERE event_id = $1 AND user_id = $2 AND status = $3',
        [event.id, req.user.id, 'active']
      );
      event.user_registered = !!reg;
    }

    res.json({ event: event });
  } catch (err) {
    console.error('Get event error:', err);
    res.status(500).json({ error: 'Failed to load event' });
  }
});

// ── GET /api/events/:id/calendar ── (.ics file download)
router.get('/:id/calendar', async function(req, res) {
  try {
    var event = await dbGet('SELECT * FROM events WHERE id = $1', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    var baseUrl = req.protocol + '://' + req.get('host');
    var eventUrl = baseUrl + '/event.html?id=' + event.id;
    var canisterUrl = baseUrl + '/canister.html?event_id=' + event.id;
    var nevUrl = baseUrl + '/onboard.html?event_id=' + event.id;

    var date = event.event_date ? new Date(event.event_date) : new Date();
    var endDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    var location = [event.venue, event.city, event.country].filter(Boolean).join(', ');

    var description = [
      'Your Event Hub: ' + eventUrl,
      '',
      'Find your matches before you go: ' + canisterUrl,
      '',
      'Tell Nev what you\'re looking for: ' + nevUrl,
      '',
      'Know someone who should be there?',
      eventUrl,
      '',
      'Event Medium finds the right conversations before you arrive.'
    ].join('\\n');

    var uid = 'event-' + event.id + '@eventmedium.ai';
    var now = formatICSDate(new Date());

    var ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Event Medium//eventmedium.ai//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + now,
      'DTSTART:' + formatICSDate(date),
      'DTEND:' + formatICSDate(endDate),
      'SUMMARY:' + icsEscape(event.name + ' \u00b7 Event Medium'),
      'LOCATION:' + icsEscape(location),
      'DESCRIPTION:' + description,
      'URL:' + eventUrl,
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-P7D',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + icsEscape(event.name) + ' is in 1 week. Check your matches on Event Medium.',
      'END:VALARM',
      'BEGIN:VALARM',
      'TRIGGER:-P1D',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + icsEscape(event.name) + ' is tomorrow. Your matches are ready.',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    var filename = (event.name || 'event').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_') + '.ics';

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(ics);
  } catch (err) {
    console.error('Calendar generation error:', err);
    res.status(500).json({ error: 'Failed to generate calendar file' });
  }
});

// ── GET /api/events/:id/calendar-links ── (calendar deep links)
router.get('/:id/calendar-links', async function(req, res) {
  try {
    var event = await dbGet('SELECT * FROM events WHERE id = $1', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    var baseUrl = req.protocol + '://' + req.get('host');
    var eventUrl = baseUrl + '/event.html?id=' + event.id;
    var nevUrl = baseUrl + '/onboard.html?event_id=' + event.id;

    var date = event.event_date ? new Date(event.event_date) : new Date();
    var endDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    var location = [event.venue, event.city, event.country].filter(Boolean).join(', ');

    var description = event.name + '\n\n' +
      'Your Event Hub: ' + eventUrl + '\n\n' +
      'Find your matches: ' + baseUrl + '/canister.html?event_id=' + event.id + '\n\n' +
      'Tell Nev what you\'re looking for: ' + nevUrl;

    var title = event.name + ' \u00b7 Event Medium';
    var start = formatICSDate(date);
    var end = formatICSDate(endDate);

    var google = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(title) +
      '&dates=' + start + '/' + end +
      '&details=' + encodeURIComponent(description) +
      (location ? '&location=' + encodeURIComponent(location) : '');

    var outlook = 'https://outlook.live.com/calendar/0/action/compose?' +
      'subject=' + encodeURIComponent(title) +
      '&startdt=' + date.toISOString() +
      '&enddt=' + endDate.toISOString() +
      (location ? '&location=' + encodeURIComponent(location) : '') +
      '&body=' + encodeURIComponent(description);

    var icsUrl = baseUrl + '/api/events/' + event.id + '/calendar';

    res.json({
      google: google,
      outlook: outlook,
      ics: icsUrl,
      apple: icsUrl
    });
  } catch (err) {
    console.error('Calendar links error:', err);
    res.status(500).json({ error: 'Failed to generate calendar links' });
  }
});

// ── POST /api/events/submit ── (community event submission)
router.post('/submit', authenticateToken, async function(req, res) {
  try {
    var { name, description, event_date, city, country, event_type, themes, source_url, expected_attendees, start_at, end_at, timezone, venue_type } = req.body;

    if (!name || !event_date) {
      return res.status(400).json({ error: 'Name and date are required' });
    }

    // Normalize themes
    var rawThemes = themes || [];
    if (typeof rawThemes === 'string') {
      try { rawThemes = JSON.parse(rawThemes); } catch(e) { rawThemes = [rawThemes]; }
    }
    var normalizedThemes = normalizeThemes(rawThemes);

    // Generate slug
    var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    slug = slug + '-' + event_date.replace(/-/g, '');

    var result = await dbRun(
      `INSERT INTO events (name, description, event_date, city, country, event_type, themes, slug, source_url, expected_attendees, start_at, end_at, timezone, venue_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (name, event_date, city, country) DO UPDATE SET
         description = COALESCE(EXCLUDED.description, events.description),
         themes = EXCLUDED.themes,
         source_url = COALESCE(EXCLUDED.source_url, events.source_url),
         updated_at = NOW()
       RETURNING *`,
      [name, description, event_date, city, country, event_type || 'conference',
       JSON.stringify(normalizedThemes), slug, source_url, expected_attendees,
       start_at, end_at, timezone, venue_type]
    );

    var event = result.rows[0];

    // Embed in Qdrant (async)
    embedEvent(event).catch(function(err) {
      console.error('Event embedding error:', err);
    });

    res.json({ event: event });
  } catch (err) {
    console.error('Submit event error:', err);
    res.status(500).json({ error: 'Failed to submit event' });
  }
});

// ── POST /api/events ── (community owner creates event)
router.post('/', authenticateToken, async function(req, res) {
  try {
    var { name, event_date, city, country, expected_attendees, themes, description, community_id } = req.body;

    if (!name || !event_date || !city || !country) {
      return res.status(400).json({ error: 'Name, date, city, and country are required' });
    }

    var communityId = community_id ? parseInt(community_id) : null;
    if (communityId) {
      var community = await dbGet(
        'SELECT id FROM communities WHERE id = $1 AND owner_user_id = $2',
        [communityId, req.user.id]
      );
      if (!community) return res.status(403).json({ error: 'You do not own this community' });
    }

    var rawThemes = themes || [];
    if (typeof rawThemes === 'string') {
      try { rawThemes = JSON.parse(rawThemes); } catch(e) { rawThemes = [rawThemes]; }
    }
    var normalizedThemes = normalizeThemes(rawThemes);

    var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    slug = slug + '-' + String(event_date).replace(/-/g, '') + '-' + Date.now().toString(36);

    var result = await dbRun(
      `INSERT INTO events (name, description, event_date, city, country, themes, slug,
        expected_attendees, community_id, owner_user_id, claim_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
       RETURNING *`,
      [name, description || null, event_date, city, country,
       JSON.stringify(normalizedThemes), slug,
       expected_attendees ? parseInt(expected_attendees) : null,
       communityId, req.user.id]
    );
    var event = result.rows[0];
    embedEvent(event).catch(function(err) { console.error('Event embed error:', err); });
    res.json({ event: event });
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// ── PATCH /api/events/:id ── (community owner edits event)
router.patch('/:id', authenticateToken, async function(req, res) {
  try {
    var eventId = parseInt(req.params.id);
    var { name, event_date, city, country, expected_attendees, themes, description } = req.body;

    var event = await dbGet('SELECT owner_user_id FROM events WHERE id = $1', [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.owner_user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    var result = await dbRun(
      `UPDATE events SET
        name = COALESCE($1, name),
        event_date = COALESCE($2, event_date),
        city = COALESCE($3, city),
        country = COALESCE($4, country),
        expected_attendees = COALESCE($5, expected_attendees),
        themes = COALESCE($6, themes),
        description = COALESCE($7, description),
        updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [name || null, event_date || null, city || null, country || null,
       expected_attendees ? parseInt(expected_attendees) : null,
       themes ? JSON.stringify(themes) : null, description || null, eventId]
    );
    res.json({ event: result.rows[0] });
  } catch (err) {
    console.error('Edit event error:', err);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// ── DELETE /api/events/:id ── (community owner deletes event)
router.delete('/:id', authenticateToken, async function(req, res) {
  try {
    var eventId = parseInt(req.params.id);
    var event = await dbGet('SELECT owner_user_id FROM events WHERE id = $1', [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.owner_user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    await dbRun('DELETE FROM event_registrations WHERE event_id = $1', [eventId]);
    await dbRun('DELETE FROM event_matches WHERE event_id = $1', [eventId]);
    await dbRun('DELETE FROM events WHERE id = $1', [eventId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete event error:', err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// ── POST /api/events/:id/register ──
router.post('/:id/register', authenticateToken, async function(req, res) {
  try {
    var eventId = parseInt(req.params.id);
    var event = await dbGet('SELECT id FROM events WHERE id = $1', [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Get user's profile for stakeholder_type and themes
    var profile = await dbGet(
      'SELECT stakeholder_type, themes FROM stakeholder_profiles WHERE user_id = $1',
      [req.user.id]
    );

    await dbRun(
      `INSERT INTO event_registrations (event_id, user_id, stakeholder_type, themes, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id, user_id) DO UPDATE SET status = $5, registered_at = NOW()`,
      [eventId, req.user.id, profile ? profile.stakeholder_type : null,
       profile ? JSON.stringify(profile.themes) : '[]', 'active']
    );

    res.json({ registered: true });
    // Async: generate matches for this user at this event
    try {
      var { generateMatchesForUser } = require('./matches');
      var hasProfile = await dbGet('SELECT user_id FROM stakeholder_profiles WHERE user_id = $1', [req.user.id]);
      if (hasProfile) {
        generateMatchesForUser(req.user.id, parseInt(req.params.id)).then(function(matches) {
          if (matches.length) console.log('Auto-matched user ' + req.user.id + ' at event ' + req.params.id + ': ' + matches.length + ' matches');
        }).catch(function(err) {
          console.error('Auto-match on registration error:', err);
        });
      }
    } catch(e) { console.error('Registration match trigger error:', e); }
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── DELETE /api/events/:id/register ──
router.delete('/:id/register', authenticateToken, async function(req, res) {
  try {
    await dbRun(
      'UPDATE event_registrations SET status = $1 WHERE event_id = $2 AND user_id = $3',
      ['cancelled', parseInt(req.params.id), req.user.id]
    );
    res.json({ unregistered: true });
  } catch (err) {
    console.error('Unregister error:', err);
    res.status(500).json({ error: 'Unregistration failed' });
  }
});

// ── GET /api/events/:id/demand-signals ── (organizer dashboard)
router.get('/:id/demand-signals', authenticateToken, async function(req, res) {
  try {
    var eventId = parseInt(req.params.id);

    // Only show for events with 100+ registrants
    var count = await dbGet(
      'SELECT COUNT(*) as count FROM event_registrations WHERE event_id = $1 AND status = $2',
      [eventId, 'active']
    );
    if (parseInt(count.count) < 100) {
      return res.json({ demand_signals: null, message: 'Demand signals available at 100+ registrants' });
    }

    // Stakeholder type breakdown
    var typeBreakdown = await dbAll(
      `SELECT stakeholder_type, COUNT(*) as count
       FROM event_registrations
       WHERE event_id = $1 AND status = $2 AND stakeholder_type IS NOT NULL
       GROUP BY stakeholder_type ORDER BY count DESC`,
      [eventId, 'active']
    );

    // Theme breakdown (unnest JSONB array)
    var themeBreakdown = await dbAll(
      `SELECT theme, COUNT(*) as count
       FROM event_registrations, jsonb_array_elements_text(themes) as theme
       WHERE event_id = $1 AND status = $2
       GROUP BY theme ORDER BY count DESC`,
      [eventId, 'active']
    );

    // Event meta signals
    var metaSignals = await dbAll(
      'SELECT * FROM event_meta_signals WHERE event_id = $1 ORDER BY detected_at DESC',
      [eventId]
    );

    res.json({
      demand_signals: {
        total_registrants: parseInt(count.count),
        stakeholder_breakdown: typeBreakdown,
        theme_breakdown: themeBreakdown,
        meta_signals: metaSignals
      }
    });
  } catch (err) {
    console.error('Demand signals error:', err);
    res.status(500).json({ error: 'Failed to load demand signals' });
  }
});

// ── POST /api/events/harvest (admin only, user ID 2) ──
router.post('/harvest', authenticateToken, async function(req, res) {
  try {
    if (req.user.id !== 2) return res.status(403).json({ error: 'Admin only' });

    var url = (req.body.url || '').trim();
    if (!url) return res.status(400).json({ error: 'URL is required' });
    try { new URL(url); } catch(e) { return res.status(400).json({ error: 'Invalid URL format' }); }

    var { harvestEvent } = require('../lib/event-harvester');
    var extracted = await harvestEvent(url);

    // Deduplicate: check by name + year
    var year = extracted.event_date ? new Date(extracted.event_date).getFullYear() : null;
    var existing = year
      ? await dbGet("SELECT id, name, slug FROM events WHERE name ILIKE $1 AND EXTRACT(YEAR FROM event_date) = $2", [extracted.name, year])
      : await dbGet("SELECT id, name, slug FROM events WHERE name ILIKE $1", [extracted.name]);

    if (existing) {
      return res.status(409).json({ error: 'Event already exists', existing: { id: existing.id, name: existing.name, slug: existing.slug } });
    }

    // Generate slug
    var slug = (extracted.name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (extracted.event_date) slug += '-' + String(extracted.event_date).replace(/-/g, '').substring(0, 8);

    var { normalizeThemes } = require('../lib/theme_taxonomy');
    var themes = normalizeThemes(extracted.themes || []);

    var result = await dbRun(
      `INSERT INTO events (name, description, event_date, city, country, event_type, themes, slug, source_url, expected_attendees, is_flagship, needs_review)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (name, event_date, city, country) DO UPDATE SET
         description = COALESCE(EXCLUDED.description, events.description),
         themes = EXCLUDED.themes, source_url = COALESCE(EXCLUDED.source_url, events.source_url),
         needs_review = true, updated_at = NOW()
       RETURNING *`,
      [
        extracted.name, extracted.description || null,
        extracted.event_date || null, extracted.city || null, extracted.country || null,
        'conference', JSON.stringify(themes), slug,
        extracted.website || url,
        extracted.expected_attendees || null,
        false, true
      ]
    );

    var event = result.rows[0];
    res.json({ success: true, event: event, extracted: extracted, needs_review: true });
  } catch (err) {
    console.error('Harvest error:', err);
    var msg = err.message || 'Extraction failed';
    if (msg.includes('Could not reach')) return res.status(422).json({ error: msg });
    if (msg.includes("doesn't look like")) return res.status(422).json({ error: msg });
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/events/find-links (admin only, user ID 2) ──
router.post('/find-links', authenticateToken, async function(req, res) {
  try {
    if (req.user.id !== 2) return res.status(403).json({ error: 'Admin only' });

    var { findEventLinks, generateThemeQueries } = require('../lib/event-link-finder');
    var mode = req.body.mode || 'keyword';
    var limit = Math.min(parseInt(req.body.limit) || 20, 50);
    var results = [];
    var queriesRun = 0;

    if (!process.env.GOOGLE_SEARCH_API_KEY || !process.env.GOOGLE_SEARCH_CX) {
      return res.status(422).json({ error: 'Google Search API not configured. Add GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX to environment variables.' });
    }

    if (mode === 'keyword') {
      var query = (req.body.query || '').trim();
      if (!query) return res.status(400).json({ error: 'Query is required for keyword mode' });
      results = await findEventLinks(query);
      queriesRun = 1;
    } else {
      // Theme mode — run queries per theme with 500ms delay
      var themes = req.body.themes && req.body.themes.length ? req.body.themes : null;
      var queries = generateThemeQueries(themes);
      var seen = {};
      for (var i = 0; i < queries.length; i++) {
        try {
          var found = await findEventLinks(queries[i], { num: 10 });
          found.forEach(function(r) {
            if (!seen[r.domain]) { seen[r.domain] = true; results.push(r); }
          });
          queriesRun++;
        } catch(e) {
          if (e.message === 'RATE_LIMIT') break;
          console.error('Query failed:', queries[i], e.message);
        }
        if (i < queries.length - 1) await new Promise(function(r) { setTimeout(r, 500); });
      }
      results.sort(function(a, b) { return b.relevanceScore - a.relevanceScore; });
      results = results.slice(0, limit);
    }

    // Check which are already in DB (by domain match against source_url)
    for (var j = 0; j < results.length; j++) {
      var existing = await dbGet(
        "SELECT id FROM events WHERE source_url ILIKE $1 OR source_url ILIKE $2",
        ['%' + results[j].domain + '%', '%' + results[j].domain.split('.')[0] + '%']
      );
      results[j].already_harvested = !!existing;
    }

    res.json({ results: results, total: results.length, queries_run: queriesRun });
  } catch (err) {
    console.error('Find-links error:', err);
    var msg = err.message || 'Search failed';
    if (msg === 'RATE_LIMIT') return res.status(429).json({ error: 'Search limit reached. Google allows 100 searches per day on the free tier.' });
    if (msg === 'API_KEY_INVALID') return res.status(422).json({ error: 'Google Search API key is invalid or the Custom Search API is not enabled.' });
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/events/harvest-batch (admin only, user ID 2) ──
router.post('/harvest-batch', authenticateToken, async function(req, res) {
  try {
    if (req.user.id !== 2) return res.status(403).json({ error: 'Admin only' });

    var urls = Array.isArray(req.body.urls) ? req.body.urls.filter(Boolean) : [];
    if (!urls.length) return res.status(400).json({ error: 'urls array is required' });

    var { harvestEvent } = require('../lib/event-harvester');
    var { normalizeThemes: nt } = require('../lib/theme_taxonomy');
    var added = 0, duplicates = 0, failed = 0;
    var results = [];

    for (var i = 0; i < urls.length; i++) {
      var url = urls[i];
      try {
        var extracted = await harvestEvent(url);

        // Deduplicate
        var year = extracted.event_date ? new Date(extracted.event_date).getFullYear() : null;
        var existing = year
          ? await dbGet("SELECT id, name, slug FROM events WHERE name ILIKE $1 AND EXTRACT(YEAR FROM event_date) = $2", [extracted.name, year])
          : await dbGet("SELECT id, name, slug FROM events WHERE name ILIKE $1", [extracted.name]);

        if (existing) {
          duplicates++;
          results.push({ url: url, status: 'duplicate', existing: existing });
        } else {
          var slug = (extracted.name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          if (extracted.event_date) slug += '-' + String(extracted.event_date).replace(/-/g, '').substring(0, 8);
          var themes = nt(extracted.themes || []);
          var result = await dbRun(
            `INSERT INTO events (name, description, event_date, city, country, event_type, themes, slug, source_url, expected_attendees, is_flagship, needs_review)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [extracted.name, extracted.description || null, extracted.event_date || null,
             extracted.city || null, extracted.country || null, 'conference',
             JSON.stringify(themes), slug, extracted.website || url,
             extracted.expected_attendees || null, false, true]
          );
          added++;
          results.push({ url: url, status: 'added', event: result.rows[0] });
        }
      } catch(e) {
        failed++;
        results.push({ url: url, status: 'failed', error: e.message });
      }
      if (i < urls.length - 1) await new Promise(function(r) { setTimeout(r, 2000); });
    }

    res.json({ added: added, duplicates: duplicates, failed: failed, results: results });
  } catch (err) {
    console.error('Harvest-batch error:', err);
    res.status(500).json({ error: err.message || 'Batch harvest failed' });
  }
});

// ── POST /api/events/admin/seed ── seed known events
router.post('/admin/seed', authenticateToken, async function(req, res) {
  try {
    var { seed } = require('../lib/seed_known_events');
    await seed();
    var count = await dbGet('SELECT COUNT(*) as count FROM events');
    res.json({ success: true, total_events: parseInt(count.count) });
  } catch (err) {
    console.error('Seed error:', err);
    res.status(500).json({ error: 'Seed failed: ' + err.message });
  }
});

// ── POST /api/events/admin/harvest ── trigger event harvester
router.post('/admin/harvest', authenticateToken, async function(req, res) {
  try {
    var { harvest } = require('../lib/event_harvester');
    var options = {
      theme: req.body.theme || null,
      city: req.body.city || null,
      dryRun: req.body.dry_run || false,
      maxQueries: req.body.max_queries || 1
    };

    // Run async — respond immediately
    res.json({ success: true, message: 'Harvest started', options: options });

    harvest(options).then(function(stats) {
      console.log('Harvest complete:', stats.stored, 'new events');
    }).catch(function(err) {
      console.error('Harvest failed:', err);
    });
  } catch (err) {
    console.error('Harvest trigger error:', err);
    res.status(500).json({ error: 'Harvest failed: ' + err.message });
  }
});

// ── Helpers ──
function formatICSDate(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsEscape(s) {
  if (!s) return '';
  return s.replace(/[\\;,]/g, function(c) { return '\\' + c; });
}
// ── SIDECAR EVENTS ───────────────────────────────────────

// GET /api/events/:id/sidecars
router.get('/:id/sidecars', async function(req, res) {
  try {
    var eventId = parseInt(req.params.id);
    if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid event ID' });

    var parent = await dbGet('SELECT id, name, slug FROM events WHERE id = $1', [eventId]);
    if (!parent) return res.status(404).json({ error: 'Event not found' });

    var sidecars = await dbAll(
      `SELECT id, name, organizer, description, event_date, start_time, end_time,
              venue_name, venue_address, cost, tags, themes, source_url,
              food, bar, notes, invite_only
       FROM sidecar_events WHERE parent_event_id = $1
       ORDER BY event_date ASC, start_time ASC`, [eventId]);

    var stats = await dbGet(
      `SELECT COUNT(*) as total, COUNT(DISTINCT event_date) as days,
              COUNT(*) FILTER (WHERE cost = 'Free') as free_count,
              COUNT(*) FILTER (WHERE invite_only = TRUE) as invite_only_count
       FROM sidecar_events WHERE parent_event_id = $1`, [eventId]);

    res.json({
      parent: parent,
      stats: { total: parseInt(stats.total), days: parseInt(stats.days), free: parseInt(stats.free_count), invite_only: parseInt(stats.invite_only_count) },
      sidecars: sidecars
    });
  } catch (err) {
    console.error('Sidecar fetch error:', err);
    res.status(500).json({ error: 'Failed to load sidecar events' });
  }
});

// GET /api/events/:id/sidecar-count
router.get('/:id/sidecar-count', async function(req, res) {
  try {
    var result = await dbGet('SELECT COUNT(*) as count FROM sidecar_events WHERE parent_event_id = $1', [parseInt(req.params.id)]);
    res.json({ count: parseInt(result.count) });
  } catch (err) {
    res.json({ count: 0 });
  }
});


// POST /api/events/:id/sidecars — user submits a sidecar event
router.post('/:id/sidecars', async function(req, res) {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Sign in to submit a side event' });
    }
    var eventId = parseInt(req.params.id);
    if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid event ID' });

    var parent = await dbGet('SELECT id, name FROM events WHERE id = $1', [eventId]);
    if (!parent) return res.status(404).json({ error: 'Event not found' });

    var b = req.body;
    if (!b.name || !b.event_date) {
      return res.status(400).json({ error: 'Event name and date are required' });
    }

    var result = await dbGet(
      `INSERT INTO sidecar_events
        (parent_event_id, name, organizer, event_date, start_time, end_time,
         venue_name, venue_address, cost, tags, source_url, invite_only, submitted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        eventId,
        b.name.trim(),
        (b.organizer || '').trim() || null,
        b.event_date,
        b.start_time || null,
        b.end_time || null,
        (b.venue_name || '').trim() || null,
        (b.venue_address || '').trim() || null,
        (b.cost || 'Free').trim(),
        JSON.stringify(b.tags || []),
        (b.source_url || '').trim() || null,
        b.invite_only || false,
        req.session.userId
      ]
    );

    res.json({ success: true, id: result.id });
  } catch (err) {
    console.error('Sidecar submit error:', err);
    res.status(500).json({ error: 'Failed to submit side event' });
  }
});

module.exports = { router };