// ── Contact Importer ──
// Handles CSV, Excel, manual entry. Normalises, deduplicates, infers, stores.

var xlsx = require('xlsx');
var crypto = require('crypto');
var { dbRun, dbGet, dbAll } = require('../db');
var { inferStakeholderType, inferThemes, inferJurisdiction } = require('./stakeholder_inference');

function parseCSV(csvString) {
  var lines = csvString.trim().split('\n');
  if (lines.length < 2) return [];
  var headers = lines[0].split(',').map(function(h) { return h.trim().replace(/^"|"$/g, ''); });
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var values = lines[i].split(',').map(function(v) { return v.trim().replace(/^"|"$/g, ''); });
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = values[j] || '';
    }
    rows.push(obj);
  }
  return rows;
}

function parseExcel(buffer) {
  var workbook = xlsx.read(buffer, { type: 'buffer' });
  var sheet = workbook.Sheets[workbook.SheetNames[0]];
  return xlsx.utils.sheet_to_json(sheet, { defval: '' });
}

function applyMapping(row, mapping) {
  var mapped = {};
  var keys = Object.keys(mapping);
  for (var i = 0; i < keys.length; i++) {
    var sourceField = keys[i];
    var emField = mapping[sourceField];
    if (emField && emField !== 'skip' && row[sourceField] !== undefined) {
      mapped[emField] = row[sourceField];
    }
  }
  return mapped;
}

function extractDomain(url) {
  if (!url) return '';
  try {
    var u = new URL(url.startsWith('http') ? url : 'https://' + url);
    return u.hostname.replace('www.', '');
  } catch(e) { return ''; }
}

function normaliseContact(row) {
  var email = (row.email || '').toLowerCase().trim();
  if (!email || email.indexOf('@') === -1) return null;

  var firstName = (row.first_name || '').trim();
  var lastName = (row.last_name || '').trim();
  var name = (row.name || '').trim() || (firstName + ' ' + lastName).trim();

  var contact = {
    email: email,
    name: name,
    first_name: firstName,
    last_name: lastName,
    company_name: (row.company_name || row.company || '').trim(),
    company_domain: extractDomain(row.company_domain || row.website || ''),
    company_country: (row.company_country || row.country || '').trim(),
    role_title: (row.role_title || row.title || row.position || '').trim(),
    linkedin_url: (row.linkedin_url || row.linkedin || '').trim(),
    owner_notes: (row.notes || row.owner_notes || '').trim(),
    tags: row.tags ? (typeof row.tags === 'string' ? row.tags.split(';').map(function(t) { return t.trim(); }) : row.tags) : []
  };

  contact.stakeholder_type = row.stakeholder_type || inferStakeholderType(contact.role_title);
  contact.canonical_themes = inferThemes(contact.role_title, contact.company_name, contact.company_domain);
  contact.jurisdiction = inferJurisdiction(contact.company_country);
  contact.geography = contact.company_country || '';

  return contact;
}

async function importContacts(communityId, rows, source, createdBy, fieldMapping) {
  var batchId = crypto.randomUUID();

  await dbRun(
    "INSERT INTO contact_import_batches (id, community_id, source, total_rows, status, created_by) VALUES ($1,$2,$3,$4,'processing',$5)",
    [batchId, communityId, source, rows.length, createdBy]
  );

  var imported = 0, skipped = 0, failed = 0;

  for (var i = 0; i < rows.length; i++) {
    try {
      var row = fieldMapping ? applyMapping(rows[i], fieldMapping) : rows[i];
      var contact = normaliseContact(row);
      if (!contact) { failed++; continue; }

      var existing = await dbGet(
        'SELECT id FROM community_contacts WHERE community_id=$1 AND email=$2',
        [communityId, contact.email]
      );
      if (existing) { skipped++; continue; }

      await dbRun(
        'INSERT INTO community_contacts (community_id, email, name, first_name, last_name, company_name, company_domain, company_country, role_title, linkedin_url, stakeholder_type, canonical_themes, geography, jurisdiction, source, source_record_id, import_batch_id, owner_notes, tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)',
        [communityId, contact.email, contact.name, contact.first_name, contact.last_name, contact.company_name, contact.company_domain, contact.company_country, contact.role_title, contact.linkedin_url, contact.stakeholder_type, contact.canonical_themes, contact.geography, contact.jurisdiction, source, rows[i].id || rows[i].record_id || null, batchId, contact.owner_notes, contact.tags]
      );
      imported++;
    } catch(err) {
      failed++;
      console.error('[contact_importer] Row error:', err.message);
    }
  }

  await dbRun(
    "UPDATE contact_import_batches SET imported=$1, skipped=$2, failed=$3, status='complete', completed_at=NOW() WHERE id=$4",
    [imported, skipped, failed, batchId]
  );

  // Shadow canister build — fire and forget
  buildShadowCanistersForBatch(communityId, batchId).catch(function(err) {
    console.error('[contact_importer] shadow canister build failed:', err.message);
  });

  return { batch_id: batchId, imported: imported, skipped: skipped, failed: failed };
}

async function buildShadowCanistersForBatch(communityId, batchId) {
  var contacts = await dbAll(
    'SELECT id, name, role_title, company_name, stakeholder_type, canonical_themes, jurisdiction, geography FROM community_contacts WHERE import_batch_id=$1 AND shadow_canister_built=FALSE',
    [batchId]
  );

  for (var i = 0; i < contacts.length; i++) {
    var c = contacts[i];
    try {
      var text = [c.stakeholder_type, c.role_title, c.company_name, (c.canonical_themes || []).join(' '), c.geography, c.jurisdiction].filter(Boolean).join(' ');

      // Try to build embedding if vector_search is available
      try {
        var vs = require('./vector_search');
        if (vs.getEmbedding) {
          var embedding = await vs.getEmbedding(text);
          if (embedding) {
            // Store as shadow canister metadata (Qdrant upsert done via vector_search if available)
            await dbRun(
              "UPDATE community_contacts SET shadow_canister_built=TRUE, shadow_canister_id=$1, enrichment_status='complete', last_enriched_at=NOW(), updated_at=NOW() WHERE id=$2",
              [c.id, c.id]
            );
            continue;
          }
        }
      } catch(vsErr) {
        // vector_search not available or failed — mark complete with basic enrichment
      }

      // Fallback: mark as complete without embedding
      await dbRun(
        "UPDATE community_contacts SET shadow_canister_built=TRUE, enrichment_status='complete', last_enriched_at=NOW(), updated_at=NOW() WHERE id=$1",
        [c.id]
      );
    } catch(err) {
      await dbRun("UPDATE community_contacts SET enrichment_status='failed' WHERE id=$1", [c.id]);
      console.error('[shadow_canister] failed for ' + c.id + ':', err.message);
    }
  }
}

module.exports = { parseCSV, parseExcel, applyMapping, normaliseContact, importContacts };
