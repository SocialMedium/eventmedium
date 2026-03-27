#!/usr/bin/env node
// ── Enrichment Write-backs ──
// Schedule: Daily 06:00 UTC
// Purpose: Process pending write-back queue for enabled communities

var { dbAll, dbGet, dbRun } = require('../db');

async function run() {
  console.log('[enrichment_writebacks] Starting write-back processing...');

  try {
    // Only process for communities with write-back enabled
    var pending = await dbAll(
      `SELECT ew.*, ct.write_enrichment_enabled
       FROM enrichment_writebacks ew
       JOIN community_tenants ct ON ct.community_id = ew.community_id
       WHERE ew.status = 'pending' AND ct.write_enrichment_enabled = true
       ORDER BY ew.community_id, ew.provider
       LIMIT 500`
    );

    console.log('[enrichment_writebacks] Processing', pending.length, 'pending write-backs');

    var successes = 0;
    var failures = 0;

    for (var i = 0; i < pending.length; i++) {
      var wb = pending[i];

      try {
        var adapter = require('../lib/integrations/' + wb.provider);
        var result = await adapter.writeEnrichment(
          wb.community_id,
          wb.entity_type,
          wb.external_entity_id,
          wb.payload
        );

        if (result.status === 'written') {
          await dbRun(
            "UPDATE enrichment_writebacks SET status = 'completed', written_at = NOW() WHERE id = $1",
            [wb.id]
          );
          successes++;
        } else if (result.status === 'not_implemented' || result.status === 'write_disabled') {
          await dbRun(
            "UPDATE enrichment_writebacks SET status = 'skipped' WHERE id = $1",
            [wb.id]
          );
        } else {
          await dbRun(
            "UPDATE enrichment_writebacks SET status = 'error' WHERE id = $1",
            [wb.id]
          );
          failures++;
        }
      } catch (err) {
        console.error('[enrichment_writebacks] Error processing', wb.id, ':', err.message);
        await dbRun(
          "UPDATE enrichment_writebacks SET status = 'error' WHERE id = $1",
          [wb.id]
        );
        failures++;
      }
    }

    console.log('[enrichment_writebacks] Complete. Successes:', successes, 'Failures:', failures);
  } catch (err) {
    console.error('[enrichment_writebacks] Fatal error:', err);
  }

  process.exit(0);
}

run();
