#!/usr/bin/env node
// ── Community Signals Ingest ──
// Schedule: Every 30 minutes
// Purpose: Pull Category A integrations, normalise, store in community_signals

var { dbAll, dbGet } = require('../db');
var { storeSignals, updateSyncStatus } = require('../lib/integrations/base');

async function run() {
  console.log('[signals_ingest] Starting Category A signal ingest...');

  try {
    var integrations = await dbAll(
      "SELECT ci.*, ct.name as community_name FROM community_integrations ci JOIN community_tenants ct ON ct.community_id = ci.community_id WHERE ci.enabled = true AND ci.category = 'owner_controlled'"
    );

    console.log('[signals_ingest] Processing', integrations.length, 'integrations');

    for (var i = 0; i < integrations.length; i++) {
      var integration = integrations[i];
      var provider = integration.provider;

      try {
        var adapter = require('../lib/integrations/' + provider);

        // Fetch raw data since last sync
        var since = integration.last_synced_at || new Date(Date.now() - 86400000 * 7);
        var rawData = await adapter.fetchRaw(integration.community_id, since);

        if (!rawData || rawData.length === 0) {
          await updateSyncStatus(integration.id, 'synced_empty');
          continue;
        }

        // Transform to signals
        var signals = await adapter.transformToSignals(rawData, integration.community_id);

        // Store
        var stored = await storeSignals(signals);
        await updateSyncStatus(integration.id, 'synced');

        console.log('[signals_ingest]', integration.community_name, '/', provider, '- stored', stored, 'signals');
      } catch (err) {
        console.error('[signals_ingest] Error for', provider, ':', err.message);
        await updateSyncStatus(integration.id, 'error');
      }
    }

    console.log('[signals_ingest] Complete');
  } catch (err) {
    console.error('[signals_ingest] Fatal error:', err);
  }

  process.exit(0);
}

run();
