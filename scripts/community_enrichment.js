#!/usr/bin/env node
// ── Community Enrichment ──
// Schedule: Daily 05:00 UTC
// Purpose: Pull Category B public feeds, normalise, update community signals

var { dbAll, dbGet } = require('../db');
var { storeSignals, updateSyncStatus } = require('../lib/integrations/base');

async function run() {
  console.log('[community_enrichment] Starting Category B feed enrichment...');

  try {
    var integrations = await dbAll(
      "SELECT ci.*, ct.name as community_name FROM community_integrations ci JOIN community_tenants ct ON ct.community_id = ci.community_id WHERE ci.enabled = true AND ci.category = 'public'"
    );

    console.log('[community_enrichment] Processing', integrations.length, 'public feed integrations');

    for (var i = 0; i < integrations.length; i++) {
      var integration = integrations[i];
      var provider = integration.provider;

      try {
        var adapter = require('../lib/integrations/' + provider);

        var since = integration.last_synced_at || new Date(Date.now() - 86400000 * 7);
        var rawData = await adapter.fetchRaw(integration.community_id, since);

        if (!rawData || rawData.length === 0) {
          await updateSyncStatus(integration.id, 'synced_empty');
          continue;
        }

        var signals = await adapter.transformToSignals(rawData, integration.community_id);
        var stored = await storeSignals(signals);
        await updateSyncStatus(integration.id, 'synced');

        console.log('[community_enrichment]', integration.community_name, '/', provider, '- stored', stored, 'signals');
      } catch (err) {
        console.error('[community_enrichment] Error for', provider, ':', err.message);
        await updateSyncStatus(integration.id, 'error');
      }
    }

    console.log('[community_enrichment] Complete');
  } catch (err) {
    console.error('[community_enrichment] Fatal error:', err);
  }

  process.exit(0);
}

run();
