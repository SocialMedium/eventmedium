// ── Community Contact Setup Routes ──
// Mount at /api/community/:communityId/setup

var express = require('express');
var crypto = require('crypto');
var router = express.Router({ mergeParams: true });
var { dbGet, dbRun, dbAll } = require('../db');
var { authenticateToken } = require('../middleware/auth');
var { parseCSV, parseExcel, importContacts, normaliseContact } = require('../lib/contact_importer');
var { detectMapping } = require('../lib/column_detector');
var { inferStakeholderType, inferThemes, inferJurisdiction } = require('../lib/stakeholder_inference');

var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
var EDITORIAL_MODEL = process.env.EDITORIAL_MODEL || 'claude-sonnet-4-20250514';

// ── Community owner auth ──
async function ownerAuth(req, res, next) {
  var communityId = req.params.communityId;
  if (!communityId) return res.status(400).json({ error: 'communityId required' });
  try {
    var member = await dbGet(
      'SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2',
      [communityId, req.user.id]
    );
    if (!member || member.role !== 'owner') {
      return res.status(403).json({ error: 'Community owner access required' });
    }
    req.communityId = communityId;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Auth check failed' });
  }
}

// ══════════════════════════════════════════════════════
// GET /setup/status — setup completion status
// ══════════════════════════════════════════════════════
router.get('/status', authenticateToken, ownerAuth, async function(req, res) {
  try {
    var communityId = req.communityId;
    var community = await dbGet('SELECT * FROM communities WHERE id = $1', [communityId]);
    var tenant = await dbGet('SELECT * FROM community_tenants WHERE community_id = $1', [communityId]);
    var contactCount = await dbGet('SELECT COUNT(*) as count FROM community_contacts WHERE community_id = $1', [communityId]);
    var invitedCount = await dbGet("SELECT COUNT(*) as count FROM community_contacts WHERE community_id = $1 AND status = 'invited'", [communityId]);
    var activeCount = await dbGet("SELECT COUNT(*) as count FROM community_contacts WHERE community_id = $1 AND status = 'active'", [communityId]);
    var pendingEnrich = await dbGet("SELECT COUNT(*) as count FROM community_contacts WHERE community_id = $1 AND enrichment_status = 'pending'", [communityId]);
    var integrationCount = await dbGet('SELECT COUNT(*) as count FROM community_integrations WHERE community_id = $1 AND enabled = true', [communityId]);

    var total = parseInt(contactCount.count) || 0;
    var invited = parseInt(invitedCount.count) || 0;
    var active = parseInt(activeCount.count) || 0;

    res.json({
      community_id: communityId,
      setup_complete: total > 0 && invited > 0,
      steps: {
        profile: !!(community || tenant),
        contacts: total > 0,
        integrations: parseInt(integrationCount.count) > 0,
        invites_sent: invited > 0
      },
      contact_summary: {
        total: total,
        invited: invited,
        active: active,
        pending_enrichment: parseInt(pendingEnrich.count) || 0
      }
    });
  } catch (err) {
    console.error('[setup] Status error:', err);
    res.status(500).json({ error: 'Failed to load setup status' });
  }
});

// ══════════════════════════════════════════════════════
// POST /setup/contacts/upload — CSV or Excel upload
// ══════════════════════════════════════════════════════
router.post('/contacts/upload', authenticateToken, ownerAuth, async function(req, res) {
  try {
    var communityId = req.communityId;

    // Handle raw body (file content)
    var contentType = req.headers['content-type'] || '';
    var source = req.query.source || 'csv_upload';
    var mappingStr = req.query.mapping || req.body.mapping;
    var fileContent = req.body.file || req.body;

    var rows;
    if (source === 'excel_upload' && Buffer.isBuffer(fileContent)) {
      rows = parseExcel(fileContent);
    } else if (typeof fileContent === 'string') {
      rows = parseCSV(fileContent);
    } else if (fileContent && fileContent.data) {
      // Multipart form data
      if (source === 'excel_upload') {
        rows = parseExcel(Buffer.from(fileContent.data));
      } else {
        rows = parseCSV(fileContent.data.toString());
      }
    } else {
      return res.status(400).json({ error: 'No file content provided' });
    }

    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'File is empty or could not be parsed' });
    }

    // Auto-detect or use provided mapping
    var fieldMapping = null;
    if (mappingStr) {
      fieldMapping = typeof mappingStr === 'string' ? JSON.parse(mappingStr) : mappingStr;
    } else {
      var columns = Object.keys(rows[0]);
      var detection = detectMapping(columns);

      if (!detection.complete) {
        return res.json({
          needs_mapping: true,
          preview: rows.slice(0, 5),
          detected_columns: columns,
          suggested_mapping: detection.mapping,
          unmapped: detection.unmapped
        });
      }
      fieldMapping = detection.mapping;
    }

    var result = await importContacts(communityId, rows, source, req.user.id, fieldMapping);

    // Include preview of first few imported contacts
    var preview = await dbAll(
      "SELECT email, name, company_name, stakeholder_type, canonical_themes, status FROM community_contacts WHERE import_batch_id = $1 LIMIT 5",
      [result.batch_id]
    );

    res.json({
      batch_id: result.batch_id,
      imported: result.imported,
      skipped: result.skipped,
      failed: result.failed,
      preview: preview.map(function(p) {
        return {
          email: p.email.replace(/(.{2}).*(@.*)/, '$1***$2'),
          name: p.name,
          company_name: p.company_name,
          inferred_stakeholder_type: p.stakeholder_type,
          inferred_themes: p.canonical_themes,
          status: 'imported'
        };
      })
    });
  } catch (err) {
    console.error('[setup] Upload error:', err);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// ══════════════════════════════════════════════════════
// POST /setup/contacts/manual — add single contact
// ══════════════════════════════════════════════════════
router.post('/contacts/manual', authenticateToken, ownerAuth, async function(req, res) {
  try {
    var communityId = req.communityId;
    var result = await importContacts(communityId, [req.body], 'manual', req.user.id, null);

    if (result.imported > 0) {
      var contact = await dbGet(
        "SELECT id, email, name, company_name, role_title, stakeholder_type, canonical_themes, jurisdiction, status, shadow_canister_built FROM community_contacts WHERE import_batch_id = $1 LIMIT 1",
        [result.batch_id]
      );
      res.json({ status: 'created', contact: contact });
    } else if (result.skipped > 0) {
      res.status(409).json({ error: 'Contact with this email already exists' });
    } else {
      res.status(400).json({ error: 'Invalid contact data — email required' });
    }
  } catch (err) {
    console.error('[setup] Manual add error:', err);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

// ══════════════════════════════════════════════════════
// GET /setup/contacts — list contacts with pagination and filtering
// ══════════════════════════════════════════════════════
router.get('/contacts', authenticateToken, ownerAuth, async function(req, res) {
  try {
    var communityId = req.communityId;
    var status = req.query.status || 'all';
    var stakeholderType = req.query.stakeholder_type;
    var theme = req.query.theme;
    var jurisdiction = req.query.jurisdiction;
    var search = req.query.search;
    var page = parseInt(req.query.page) || 1;
    var limit = Math.min(parseInt(req.query.limit) || 50, 200);
    var offset = (page - 1) * limit;

    var conditions = ['community_id = $1'];
    var params = [communityId];
    var idx = 2;

    if (status !== 'all') { conditions.push('status = $' + idx); params.push(status); idx++; }
    if (stakeholderType) { conditions.push('stakeholder_type = $' + idx); params.push(stakeholderType); idx++; }
    if (theme) { conditions.push('$' + idx + ' = ANY(canonical_themes)'); params.push(theme); idx++; }
    if (jurisdiction) { conditions.push('jurisdiction = $' + idx); params.push(jurisdiction); idx++; }
    if (search) { conditions.push('(name ILIKE $' + idx + ' OR company_name ILIKE $' + idx + ')'); params.push('%' + search + '%'); idx++; }

    var where = conditions.join(' AND ');
    var countResult = await dbGet('SELECT COUNT(*) as count FROM community_contacts WHERE ' + where, params);
    var contacts = await dbAll(
      'SELECT id, email, name, company_name, role_title, stakeholder_type, canonical_themes, jurisdiction, status, shadow_canister_built, enrichment_status, tags, created_at FROM community_contacts WHERE ' + where + ' ORDER BY created_at DESC LIMIT $' + idx + ' OFFSET $' + (idx + 1),
      params.concat([limit, offset])
    );

    // Mask emails in list view
    contacts = contacts.map(function(c) {
      c.email = c.email.replace(/(.{2}).*(@.*)/, '$1***$2');
      return c;
    });

    res.json({
      contacts: contacts,
      total: parseInt(countResult.count) || 0,
      page: page,
      limit: limit
    });
  } catch (err) {
    console.error('[setup] List contacts error:', err);
    res.status(500).json({ error: 'Failed to load contacts' });
  }
});

// ══════════════════════════════════════════════════════
// PATCH /setup/contacts/:contactId — update contact
// ══════════════════════════════════════════════════════
router.patch('/contacts/:contactId', authenticateToken, ownerAuth, async function(req, res) {
  try {
    var contactId = req.params.contactId;
    var fields = [];
    var params = [];
    var idx = 1;

    var allowed = ['name', 'first_name', 'last_name', 'company_name', 'role_title', 'stakeholder_type', 'canonical_themes', 'geography', 'jurisdiction', 'owner_notes', 'tags'];
    for (var i = 0; i < allowed.length; i++) {
      var f = allowed[i];
      if (req.body[f] !== undefined) {
        fields.push(f + ' = $' + idx);
        params.push(req.body[f]);
        idx++;
      }
    }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    fields.push('updated_at = NOW()');
    params.push(contactId);
    params.push(req.communityId);

    await dbRun(
      'UPDATE community_contacts SET ' + fields.join(', ') + ' WHERE id = $' + idx + ' AND community_id = $' + (idx + 1),
      params
    );

    // If stakeholder_type or themes changed, mark for re-enrichment
    if (req.body.stakeholder_type || req.body.canonical_themes) {
      await dbRun("UPDATE community_contacts SET shadow_canister_built = FALSE, enrichment_status = 'pending' WHERE id = $1", [contactId]);
    }

    var updated = await dbGet('SELECT * FROM community_contacts WHERE id = $1', [contactId]);
    res.json({ status: 'updated', contact: updated });
  } catch (err) {
    console.error('[setup] Update contact error:', err);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// ══════════════════════════════════════════════════════
// DELETE /setup/contacts/:contactId — remove contact
// ══════════════════════════════════════════════════════
router.delete('/contacts/:contactId', authenticateToken, ownerAuth, async function(req, res) {
  try {
    var contact = await dbGet('SELECT status FROM community_contacts WHERE id = $1 AND community_id = $2', [req.params.contactId, req.communityId]);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    if (contact.status === 'active') return res.status(400).json({ error: 'Cannot delete active members — they have a live canister' });

    await dbRun('DELETE FROM contact_invites WHERE contact_id = $1', [req.params.contactId]);
    await dbRun('DELETE FROM community_contacts WHERE id = $1 AND community_id = $2', [req.params.contactId, req.communityId]);
    res.json({ status: 'deleted' });
  } catch (err) {
    console.error('[setup] Delete contact error:', err);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// ══════════════════════════════════════════════════════
// POST /setup/contacts/invite — send invites
// ══════════════════════════════════════════════════════
router.post('/contacts/invite', authenticateToken, ownerAuth, async function(req, res) {
  try {
    var communityId = req.communityId;
    var contactIds = req.body.contact_ids;
    var customMessage = req.body.custom_message || '';

    // Get community info
    var community = await dbGet('SELECT name, comm_type FROM communities WHERE id = $1', [communityId]);
    var communityName = community ? community.name : 'this community';

    // Resolve contact list
    var contacts;
    if (contactIds === 'all_pending') {
      contacts = await dbAll(
        "SELECT * FROM community_contacts WHERE community_id = $1 AND status = 'pending'",
        [communityId]
      );
    } else if (Array.isArray(contactIds)) {
      contacts = await dbAll(
        "SELECT * FROM community_contacts WHERE community_id = $1 AND id = ANY($2) AND status = 'pending'",
        [communityId, contactIds]
      );
    } else {
      return res.status(400).json({ error: 'contact_ids must be array or "all_pending"' });
    }

    var sent = 0, failed = 0;

    for (var i = 0; i < contacts.length; i++) {
      var contact = contacts[i];
      try {
        var inviteToken = crypto.randomBytes(24).toString('hex');
        var inviteUrl = 'https://eventmedium.ai/join?token=' + inviteToken;

        // Generate Nev invite message
        var nevMessage = await generateNevInvite(contact, communityName, customMessage, inviteUrl);

        // Create invite record
        await dbRun(
          "INSERT INTO contact_invites (contact_id, community_id, invite_token, nev_message) VALUES ($1, $2, $3, $4)",
          [contact.id, communityId, inviteToken, nevMessage]
        );

        // Update contact status
        await dbRun(
          "UPDATE community_contacts SET status = 'invited', invited_at = NOW(), updated_at = NOW() WHERE id = $1",
          [contact.id]
        );

        // TODO: Send email via Resend (nev@eventmedium.ai)
        // For now, invite is created and message stored

        sent++;
      } catch (err) {
        failed++;
        console.error('[setup] Invite send error for', contact.id, ':', err.message);
      }
    }

    res.json({ sent: sent, failed: failed, total: contacts.length });
  } catch (err) {
    console.error('[setup] Invite error:', err);
    res.status(500).json({ error: 'Failed to send invites' });
  }
});

// ── Generate Nev invite message ──
async function generateNevInvite(contact, communityName, customMessage, inviteUrl) {
  if (!ANTHROPIC_API_KEY) {
    return 'Hi ' + (contact.first_name || contact.name || 'there') + ',\n\n' +
      communityName + ' has added you to EventMedium — an AI-powered matching platform that connects the right people at the right time.\n\n' +
      'Complete your profile so Nev, your AI concierge, can start making the right connections for you:\n' +
      inviteUrl + '\n\nNev';
  }

  try {
    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: EDITORIAL_MODEL,
        max_tokens: 250,
        messages: [{ role: 'user', content:
          'You are Nev, writing a personal invitation to join ' + communityName + ' on EventMedium.\n\n' +
          'Contact: ' + (contact.name || 'Unknown') + '\n' +
          'Role: ' + (contact.role_title || 'Unknown') + '\n' +
          'Company: ' + (contact.company_name || 'Unknown') + '\n' +
          (customMessage ? 'Owner note: ' + customMessage + '\n' : '') +
          '\nWrite a short warm invite (4-6 sentences). Address by first name. Reference their role/company. Explain EventMedium in one sentence. Include invite link: ' + inviteUrl + '\nSign off as Nev. Never mention uploads, imports, or data. Tone: warm professional.'
        }]
      })
    });
    if (resp.ok) {
      var data = await resp.json();
      return data.content[0].text;
    }
  } catch (err) {
    console.error('[setup] Nev invite generation error:', err.message);
  }

  // Fallback
  return 'Hi ' + (contact.first_name || contact.name || 'there') + ',\n\n' +
    communityName + ' would love you to join EventMedium.\n\n' + inviteUrl + '\n\nNev';
}

// ══════════════════════════════════════════════════════
// POST /setup/contacts/sync-crm — trigger CRM contact sync
// ══════════════════════════════════════════════════════
router.post('/contacts/sync-crm', authenticateToken, ownerAuth, async function(req, res) {
  try {
    var provider = req.body.provider;
    if (!provider) return res.status(400).json({ error: 'provider required' });

    var adapters = require('../lib/integrations');
    var adapter = adapters.getAdapter(provider);
    if (!adapter) return res.status(400).json({ error: 'Unknown provider: ' + provider });

    if (!adapter.fetchContacts) {
      return res.status(400).json({ error: provider + ' does not support contact sync yet' });
    }

    var rawContacts = await adapter.fetchContacts(req.communityId);
    if (!rawContacts || rawContacts.length === 0) {
      return res.json({ imported: 0, skipped: 0, failed: 0, message: 'No contacts found' });
    }

    var result = await importContacts(req.communityId, rawContacts, 'crm_' + provider, req.user.id, null);
    res.json(result);
  } catch (err) {
    console.error('[setup] CRM sync error:', err);
    res.status(500).json({ error: 'CRM sync failed: ' + err.message });
  }
});

// ══════════════════════════════════════════════════════
// GET /setup/contacts/field-mapping/:source
// ══════════════════════════════════════════════════════
router.get('/contacts/field-mapping/:source', authenticateToken, ownerAuth, async function(req, res) {
  try {
    var mapping = await dbGet(
      'SELECT mappings FROM contact_field_mappings WHERE community_id = $1 AND source = $2',
      [req.communityId, req.params.source]
    );
    res.json({ mapping: mapping ? mapping.mappings : null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load mapping' });
  }
});

// ══════════════════════════════════════════════════════
// POST /setup/contacts/field-mapping/:source
// ══════════════════════════════════════════════════════
router.post('/contacts/field-mapping/:source', authenticateToken, ownerAuth, async function(req, res) {
  try {
    await dbRun(
      "INSERT INTO contact_field_mappings (community_id, source, mappings) VALUES ($1, $2, $3) ON CONFLICT (community_id, source) DO UPDATE SET mappings = $3, updated_at = NOW()",
      [req.communityId, req.params.source, JSON.stringify(req.body.mappings)]
    );
    res.json({ status: 'saved' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save mapping' });
  }
});

// ══════════════════════════════════════════════════════
// GET /setup/contacts/template — download CSV template
// ══════════════════════════════════════════════════════
router.get('/contacts/template', function(req, res) {
  var csv = 'email,first_name,last_name,company_name,role_title,country,notes\n';
  csv += 'jane@acme.com,Jane,Smith,Acme Corp,VP Product,GB,"Met at TechCrunch"\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=eventmedium-contacts-template.csv');
  res.send(csv);
});

module.exports = { router: router };
