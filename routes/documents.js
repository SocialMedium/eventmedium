var express = require('express');
var multer = require('multer');
var path = require('path');
var fs = require('fs');
var { dbGet, dbRun, dbAll } = require('../db');
var { authenticateToken } = require('../middleware/auth');
var { extractText } = require('../lib/document_extractor');
var { extractCanisterFields, extractSignals, classifyDocumentType } = require('../lib/document_intelligence');
var { normalizeThemes } = require('../lib/theme_taxonomy');

var router = express.Router();

// Multer config — temp disk, max 10MB
var upload = multer({
  dest: '/tmp/em_uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    var allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain'
    ];
    if (allowed.indexOf(file.mimetype) !== -1) return cb(null, true);
    cb(new Error('Unsupported file type. Please upload PDF, DOCX, PPTX, or TXT.'));
  }
});

// Weight by document type
var DOCUMENT_WEIGHTS = {
  pitch_deck: 1.8,
  investment_thesis: 1.8,
  company_overview: 1.5,
  cv: 1.3,
  bio: 1.0,
  other: 1.0
};

// ── POST /api/documents/ingest ──
router.post('/ingest', authenticateToken, upload.single('file'), async function(req, res) {
  var userId = req.user.id;
  var rawText = '';
  var filename = 'pasted_text';
  var fileType = 'paste';
  var tempPath = null;

  try {
    // ── Extract text from file or body ──
    if (req.file) {
      tempPath = req.file.path;
      filename = req.file.originalname;
      fileType = path.extname(filename).replace('.', '').toLowerCase() || 'unknown';
      rawText = await extractText(req.file.path, req.file.mimetype, filename);
    } else if (req.body && req.body.text) {
      rawText = req.body.text;
      fileType = 'paste';
    } else {
      return res.status(400).json({ error: 'No file or text provided' });
    }

    if (!rawText || rawText.trim().length < 50) {
      return res.status(400).json({ error: 'Document appears to be empty or unreadable' });
    }

    var processText = rawText.slice(0, 25000);

    // ── Classify document type ──
    var documentType = await classifyDocumentType(processText);

    // ── Load user context ──
    var user = await dbGet('SELECT id, name, company FROM users WHERE id = $1', [userId]);
    var entityName = (user && user.company) || (user && user.name) || '';

    // ── Run both extractions in parallel ──
    var results = await Promise.all([
      extractCanisterFields(processText, documentType).catch(function(err) {
        console.error('[documents] canister extraction failed:', err.message);
        return null;
      }),
      extractSignals(processText, documentType, entityName).catch(function(err) {
        console.error('[documents] signal extraction failed:', err.message);
        return [];
      })
    ]);

    var canisterFields = results[0];
    var signals = results[1] || [];

    // ── Create document record ──
    var docRecord = await dbGet(
      "INSERT INTO user_documents (user_id, filename, file_type, document_type, raw_text_length, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW()) RETURNING id",
      [userId, filename, fileType, documentType, rawText.length]
    );
    var documentId = docRecord.id;

    // ── Write canister fields ──
    var fieldsSet = [];
    var fieldProvenance = {};

    if (canisterFields && canisterFields.confidence > 0.3) {
      var existing = await dbGet('SELECT * FROM stakeholder_profiles WHERE user_id = $1', [userId]);

      var updates = {};

      // Scalar fields — only set if not empty
      if (canisterFields.stakeholder_type) updates.stakeholder_type = canisterFields.stakeholder_type;
      if (canisterFields.focus_text) updates.focus_text = canisterFields.focus_text;
      if (canisterFields.geography) updates.geography = canisterFields.geography;

      // JSON array fields
      if (canisterFields.themes && canisterFields.themes.length) {
        var normalized = normalizeThemes(canisterFields.themes);
        if (normalized.length) updates.themes = JSON.stringify(normalized);
      }
      if (canisterFields.intent && canisterFields.intent.length) {
        updates.intent = JSON.stringify(canisterFields.intent);
      }
      if (canisterFields.offering && canisterFields.offering.length) {
        updates.offering = JSON.stringify(canisterFields.offering);
      }
      if (canisterFields.deal_details) {
        var hasDD = Object.keys(canisterFields.deal_details).some(function(k) { return canisterFields.deal_details[k]; });
        if (hasDD) updates.deal_details = JSON.stringify(canisterFields.deal_details);
      }

      // Track provenance
      Object.keys(updates).forEach(function(k) {
        fieldsSet.push(k);
        fieldProvenance[k] = documentId;
      });

      if (Object.keys(updates).length) {
        if (existing) {
          var setClauses = [];
          var params = [userId];
          var idx = 2;
          Object.keys(updates).forEach(function(k) {
            setClauses.push(k + ' = $' + idx);
            params.push(updates[k]);
            idx++;
          });
          // Merge provenance
          setClauses.push('field_provenance = COALESCE(field_provenance, \'{}\'::jsonb) || $' + idx + '::jsonb');
          params.push(JSON.stringify(fieldProvenance));
          setClauses.push('updated_at = NOW()');

          await dbRun(
            'UPDATE stakeholder_profiles SET ' + setClauses.join(', ') + ' WHERE user_id = $1',
            params
          );
        } else {
          await dbRun(
            'INSERT INTO stakeholder_profiles (user_id, stakeholder_type, themes, focus_text, intent, offering, deal_details, geography, field_provenance, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())',
            [
              userId,
              updates.stakeholder_type || null,
              updates.themes || '[]',
              updates.focus_text || null,
              updates.intent || '[]',
              updates.offering || '[]',
              updates.deal_details || '{}',
              updates.geography || null,
              JSON.stringify(fieldProvenance)
            ]
          );
        }
      }
    }

    // ── Write signals ──
    var signalIds = [];
    var qdrantPointIds = [];
    var weight = DOCUMENT_WEIGHTS[documentType] || 1.0;

    for (var i = 0; i < signals.length; i++) {
      var signal = signals[i];
      if (!signal.signal_text) continue;

      var sigRecord = await dbGet(
        'INSERT INTO unified_signals (source_type, sub_type, entity_name, user_id, document_id, theme, signal_type, signal_text, signal_summary, lifecycle_stage, geography, urgency, dollar_amount, dollar_unit, cost_of_signal, constraint_level, base_weight, source_weight, final_weight, visibility, signal_date, ingested_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW(),NOW()) RETURNING id',
        [
          'user_document',                          // source_type
          documentType,                              // sub_type
          entityName,                                // entity_name
          userId,                                    // user_id
          documentId,                                // document_id
          signal.theme,                              // theme
          'document_extract',                        // signal_type
          signal.signal_text,                        // signal_text
          signal.signal_summary,                     // signal_summary
          signal.lifecycle_stage || 'emerging',      // lifecycle_stage
          signal.geography || null,                  // geography
          signal.urgency || 'medium',                // urgency
          signal.dollar_amount || null,              // dollar_amount
          signal.dollar_unit || null,                // dollar_unit
          'high',                                    // cost_of_signal
          'high',                                    // constraint_level
          1.0,                                       // base_weight
          weight,                                    // source_weight
          weight,                                    // final_weight
          'private',                                 // visibility
        ]
      );

      signalIds.push(sigRecord.id);

      // Embed in Qdrant
      try {
        var { embedSignal } = require('../lib/vector_search');
        await embedSignal({
          id: sigRecord.id,
          source_type: 'user_document',
          entity_name: entityName,
          theme: signal.theme,
          signal_text: signal.signal_text,
          signal_summary: signal.signal_summary,
          lifecycle_stage: signal.lifecycle_stage || 'emerging',
          cost_of_signal: 'high',
          signal_date: new Date().toISOString()
        });
        qdrantPointIds.push(sigRecord.id);
      } catch (embedErr) {
        console.error('[documents] signal embed failed:', embedErr.message);
      }
    }

    // ── Update document record with provenance ──
    await dbRun(
      'UPDATE user_documents SET canister_fields_set = $2, signal_ids = $3, qdrant_point_ids = $4, updated_at = NOW() WHERE id = $1',
      [documentId, JSON.stringify(fieldsSet), JSON.stringify(signalIds), JSON.stringify(qdrantPointIds)]
    );

    // ── Re-embed canister ──
    try {
      var { embedProfile } = require('../lib/vector_search');
      var fullProfile = await dbGet('SELECT * FROM stakeholder_profiles WHERE user_id = $1', [userId]);
      if (fullProfile) {
        embedProfile(fullProfile, user).catch(function(err) {
          console.error('[documents] canister re-embed failed:', err.message);
        });
      }
    } catch (e) {
      console.error('[documents] re-embed error:', e.message);
    }

    // ── Clean up temp file ──
    if (tempPath) {
      fs.unlink(tempPath, function() {});
    }

    res.json({
      success: true,
      document_id: documentId,
      document_type: documentType,
      canister_fields_set: fieldsSet,
      signals_created: signalIds.length,
      canister_preview: canisterFields ? {
        stakeholder_type: canisterFields.stakeholder_type,
        themes: canisterFields.themes,
        intent: canisterFields.intent,
        offering: canisterFields.offering,
        geography: canisterFields.geography,
        deal_details: canisterFields.deal_details,
        confidence: canisterFields.confidence
      } : null,
      nev_context: buildNevHandoffContext(documentType, canisterFields || {}, signals)
    });

  } catch (err) {
    if (tempPath) fs.unlink(tempPath, function() {});
    console.error('[documents] ingest failed:', err);
    res.status(500).json({ error: err.message || 'Document processing failed' });
  }
});

// ── GET /api/documents/mine ──
router.get('/mine', authenticateToken, async function(req, res) {
  try {
    var docs = await dbAll(
      "SELECT id, filename, file_type, document_type, raw_text_length, canister_fields_set, signal_ids, created_at FROM user_documents WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC",
      [req.user.id]
    );
    res.json({ documents: docs || [] });
  } catch (err) {
    console.error('[documents] list failed:', err.message);
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

// ── DELETE /api/documents/:id ──
router.delete('/:id', authenticateToken, async function(req, res) {
  var userId = req.user.id;
  var documentId = parseInt(req.params.id, 10);

  try {
    var doc = await dbGet(
      "SELECT * FROM user_documents WHERE id = $1 AND user_id = $2 AND status = 'active'",
      [documentId, userId]
    );
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    var signalIds = [];
    var qdrantPointIds = [];
    var fieldsSet = [];
    try { signalIds = JSON.parse(doc.signal_ids || '[]'); } catch(e) {}
    try { qdrantPointIds = JSON.parse(doc.qdrant_point_ids || '[]'); } catch(e) {}
    try { fieldsSet = JSON.parse(doc.canister_fields_set || '[]'); } catch(e) {}

    // 1. Delete signal records
    if (signalIds.length) {
      for (var i = 0; i < signalIds.length; i++) {
        await dbRun('DELETE FROM unified_signals WHERE id = $1 AND user_id = $2', [signalIds[i], userId]);
      }
    }

    // 2. Delete Qdrant points
    if (qdrantPointIds.length) {
      try {
        var { deletePoint, COLLECTIONS } = require('../lib/vector_search');
        for (var j = 0; j < qdrantPointIds.length; j++) {
          await deletePoint(COLLECTIONS.signals, qdrantPointIds[j]).catch(function(e) {
            console.error('[documents] Qdrant delete failed:', e.message);
          });
        }
      } catch (e) {
        console.error('[documents] Qdrant cleanup error:', e.message);
      }
    }

    // 3. Mark document as deleted
    await dbRun("UPDATE user_documents SET status = 'deleted', deleted_at = NOW() WHERE id = $1", [documentId]);

    // 4. Clear field provenance
    if (fieldsSet.length) {
      var profile = await dbGet('SELECT field_provenance FROM stakeholder_profiles WHERE user_id = $1', [userId]);
      if (profile && profile.field_provenance) {
        var provenance = typeof profile.field_provenance === 'string'
          ? JSON.parse(profile.field_provenance)
          : (profile.field_provenance || {});

        fieldsSet.forEach(function(field) {
          if (provenance[field] === documentId) {
            delete provenance[field];
          }
        });

        await dbRun(
          'UPDATE stakeholder_profiles SET field_provenance = $2 WHERE user_id = $1',
          [userId, JSON.stringify(provenance)]
        );
      }
    }

    // 5. Re-embed canister
    try {
      var { embedProfile } = require('../lib/vector_search');
      var fullProfile = await dbGet('SELECT * FROM stakeholder_profiles WHERE user_id = $1', [userId]);
      var user = await dbGet('SELECT name, company FROM users WHERE id = $1', [userId]);
      if (fullProfile) {
        embedProfile(fullProfile, user).catch(function(err) {
          console.error('[documents] re-embed after delete failed:', err.message);
        });
      }
    } catch (e) {}

    // 6. Build Nev refresh context
    var nevRefreshContext = fieldsSet.length
      ? 'User deleted their ' + (doc.document_type || 'document') + ' ("' + doc.filename + '"). ' +
        'The following canister fields may have come from it: ' + fieldsSet.join(', ') + '. ' +
        'Gently confirm whether these are still current. Do not re-ask all at once.'
      : null;

    res.json({
      success: true,
      document_id: documentId,
      signals_removed: signalIds.length,
      qdrant_points_removed: qdrantPointIds.length,
      canister_fields_affected: fieldsSet,
      nev_refresh_context: nevRefreshContext
    });

  } catch (err) {
    console.error('[documents] delete failed:', err);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// ── Nev handoff context ──
function buildNevHandoffContext(documentType, canister, signals) {
  var docLabel = {
    pitch_deck: 'pitch deck',
    cv: 'CV',
    bio: 'bio',
    investment_thesis: 'investment thesis',
    company_overview: 'company overview',
    other: 'document'
  }[documentType] || 'document';

  var signalSummary = signals && signals.length
    ? signals.map(function(s) { return s.signal_summary; }).filter(Boolean).join('; ')
    : null;

  var parts = [
    "I've read your " + docLabel + " and pulled together your profile."
  ];

  if (canister && canister.stakeholder_type) {
    parts.push("You're coming through as a " + canister.stakeholder_type +
      (canister.geography ? ' based in ' + canister.geography : '') + '.');
  }

  if (signalSummary) {
    parts.push("I can see you're " + signalSummary + '.');
  }

  parts.push("Let me confirm a couple of things before we go further —");

  return parts.join(' ');
}

module.exports = { router: router };
