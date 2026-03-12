var { dbGet, dbRun } = require('../db');

// ── First-community gate ──
// Runs AFTER the membership row has been inserted.
// Returns true only if the user has exactly 1 community membership total.
async function isFirstCommunity(userId) {
  var result = await dbGet(
    'SELECT COUNT(*) as count FROM community_members WHERE user_id = $1',
    [userId]
  );
  return parseInt(result.count, 10) === 1;
}

// ── First-community welcome trigger ──
// Fires once per user, on their first community join only.
// Writes an in-app notification and sends a transactional email via Resend.
async function fireCommunityWelcomeTrigger(userId, communityId) {
  try {
    var first = await isFirstCommunity(userId);
    if (!first) {
      console.log('[community-welcome] skipped — user ' + userId + ' already has prior communities');
      return;
    }

    var user = await dbGet('SELECT id, name, email FROM users WHERE id = $1', [userId]);
    var community = await dbGet('SELECT id, name, slug FROM communities WHERE id = $1', [communityId]);

    if (!user || !community) {
      console.error('[community-welcome] missing user or community', { userId: userId, communityId: communityId });
      return;
    }

    var firstName = (user.name || '').split(' ')[0] || 'there';

    // ── In-app notification ──
    await dbRun(
      'INSERT INTO notifications (user_id, type, title, body, link, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        userId,
        'community_welcome',
        "You're in: " + community.name,
        "You're confirmed as a member of " + community.name + ". If Nev finds a compelling match for you here, you'll receive a notification to review and accept or decline. Your canister is never shared unless you say yes.",
        '/c/' + community.slug,
        JSON.stringify({
          community_id: communityId,
          community_name: community.name,
          trigger: 'first_community'
        })
      ]
    );

    console.log('[community-welcome] notification written for user ' + userId);

    // ── Email via Resend ──
    if (process.env.RESEND_API_KEY && user.email) {
      var { Resend } = require('resend');
      var resend = new Resend(process.env.RESEND_API_KEY);

      await resend.emails.send({
        from: process.env.FROM_EMAIL || 'nev@eventmedium.ai',
        to: user.email,
        subject: 'Nev is watching for your first match in ' + community.name,
        html: buildFirstCommunityEmail(firstName, community)
      });

      console.log('[community-welcome] email sent to ' + user.email);
    }

  } catch (err) {
    // Never throw — side-effect trigger must not break the calling route
    console.error('[community-welcome] trigger failed:', err.message, { userId: userId, communityId: communityId });
  }
}

function buildFirstCommunityEmail(firstName, community) {
  var baseUrl = process.env.APP_URL || 'https://eventmedium.ai';
  var canisterUrl = baseUrl + '/nev.html';
  var communityUrl = baseUrl + '/c/' + community.slug;
  var createUrl = baseUrl + '/communities/new';

  return '<!DOCTYPE html>' +
'<html lang="en">' +
'<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
'<body style="margin:0;padding:0;background:#f8f6f1;font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif">' +
'  <div style="max-width:560px;margin:40px auto;background:#fdfcf9;border-radius:8px;overflow:hidden;border:1px solid rgba(26,23,20,0.08)">' +
'    <div style="padding:32px 40px 0">' +
'      <p style="margin:0 0 24px;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#b8b4ae">EventMedium \u00b7 Nev</p>' +
'      <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#1a1714;line-height:1.3">You\'re in, ' + firstName + '.</h1>' +
'      <p style="margin:0;font-size:15px;color:#7a7570">' + community.name + ' is now part of your network.</p>' +
'    </div>' +
'    <div style="margin:28px 40px;border-top:1px solid rgba(26,23,20,0.08)"></div>' +
'    <div style="padding:0 40px">' +
'      <p style="margin:0 0 18px;font-size:15px;color:#3d3a35;line-height:1.7">' +
'        No directories. No cold outreach. If Nev finds someone in this community whose goals, expertise, and timing align with yours \u2014 you\'ll get a notification and a choice. Accept or decline. Your canister is never shared unless you say yes.' +
'      </p>' +
'      <p style="margin:0 0 28px;font-size:15px;color:#3d3a35;line-height:1.7">' +
'        The sharper your canister, the sharper your matches. If you haven\'t spoken with Nev yet, that\'s the one thing worth doing now.' +
'      </p>' +
'      <a href="' + canisterUrl + '"' +
'         style="display:inline-block;padding:13px 28px;background:#1a1714;color:#fdfcf9;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;letter-spacing:0.01em;margin-bottom:32px">' +
'        Build your canister \u2192' +
'      </a>' +
'    </div>' +
'    <div style="margin:0 40px 24px;border-top:1px solid rgba(26,23,20,0.08)"></div>' +
'    <div style="padding:0 40px 32px">' +
'      <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#1a1714">' +
'        Know someone who belongs in ' + community.name + '?' +
'      </p>' +
'      <p style="margin:0 0 18px;font-size:14px;color:#7a7570;line-height:1.6">' +
'        Invite them directly \u2014 your invitation carries your name, not ours. Every person you bring in strengthens your own match pool.' +
'      </p>' +
'      <a href="' + communityUrl + '"' +
'         style="display:inline-block;padding:11px 24px;background:transparent;color:#1a1714;text-decoration:none;border-radius:6px;border:1px solid rgba(26,23,20,0.2);font-size:14px;font-weight:500">' +
'        Invite someone \u2192' +
'      </a>' +
'    </div>' +
'    <div style="padding:20px 40px;background:#f8f6f1;border-top:1px solid rgba(26,23,20,0.08)">' +
'      <p style="margin:0 0 8px;font-size:12px;color:#b8b4ae;line-height:1.6">' +
'        You can create public or private communities of your own at any time. ' +
'        Private communities require members to register with a verified organisation email domain. ' +
'        <a href="' + createUrl + '" style="color:#7a7570;text-decoration:underline">Create a community</a>' +
'      </p>' +
'      <p style="margin:8px 0 0;font-size:12px;color:#b8b4ae">' +
'        Nev \u00b7 EventMedium.ai \u00b7 Private by default' +
'      </p>' +
'    </div>' +
'  </div>' +
'</body>' +
'</html>';
}

module.exports = { fireCommunityWelcomeTrigger: fireCommunityWelcomeTrigger, buildFirstCommunityEmail: buildFirstCommunityEmail };
