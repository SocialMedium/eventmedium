// ── Integration Routes ──
// Mount at /api/integrations
// Feed catalogue, connect/disconnect, sync status

var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var { dbGet, dbRun, dbAll } = require('../db');
var { authenticateToken } = require('../middleware/auth');
var { encryptCredentials, decryptCredentials } = require('../lib/integrations/base');
var { getCanonicalThemes } = require('../lib/theme_taxonomy');

// ── Community auth middleware ──
// Verifies user is owner of the community
async function communityOwnerAuth(req, res, next) {
  var communityId = req.params.communityId || req.body.community_id;
  if (!communityId) return res.status(400).json({ error: 'community_id required' });

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
    console.error('[integrations] Auth error:', err);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

// ══════════════════════════════════════════════════════
// FEED CATALOGUE
// ══════════════════════════════════════════════════════

var FEED_CATALOGUE = [
  // ── Category A: Owner-controlled ──
  {
    id: 'hubspot', name: 'HubSpot', provider: 'hubspot',
    category: 'owner_controlled', auth_type: 'oauth',
    description: 'Detects deal stage changes, company activity patterns, and contact segment shifts across your CRM.',
    signal_types: ['company_activity', 'deal_stage', 'contact_segment'],
    cost_of_signal: 'medium', jurisdiction: 'global',
    community_types: ['startup_ecosystem', 'corporate_network', 'industry_association'],
    themes: ['Enterprise SaaS', 'Venture & Capital', 'Growth & GTM']
  },
  {
    id: 'salesforce', name: 'Salesforce', provider: 'salesforce',
    category: 'owner_controlled', auth_type: 'oauth',
    description: 'Surfaces pipeline movement, account health changes, and opportunity signals from your Salesforce org.',
    signal_types: ['company_activity', 'deal_stage', 'contact_segment'],
    cost_of_signal: 'medium', jurisdiction: 'global',
    community_types: ['corporate_network', 'industry_association', 'startup_ecosystem'],
    themes: ['Enterprise SaaS', 'Venture & Capital', 'Growth & GTM']
  },
  {
    id: 'mailchimp', name: 'Mailchimp', provider: 'mailchimp',
    category: 'owner_controlled', auth_type: 'api_key',
    description: 'Reveals which newsletter topics drive the most engagement across your audience — aggregate only.',
    signal_types: ['newsletter_topic_engagement'],
    cost_of_signal: 'low', jurisdiction: 'global',
    community_types: ['industry_association', 'alumni_network', 'event_community'],
    themes: ['Growth & GTM', 'Media & Entertainment']
  },
  {
    id: 'beehiiv', name: 'Beehiiv', provider: 'beehiiv',
    category: 'owner_controlled', auth_type: 'api_key',
    description: 'Tracks topic-level newsletter engagement patterns and subscriber growth signals.',
    signal_types: ['newsletter_topic_engagement'],
    cost_of_signal: 'low', jurisdiction: 'global',
    community_types: ['industry_association', 'event_community', 'startup_ecosystem'],
    themes: ['Growth & GTM', 'Media & Entertainment']
  },
  {
    id: 'eventbrite', name: 'Eventbrite', provider: 'eventbrite',
    category: 'owner_controlled', auth_type: 'oauth',
    description: 'Surfaces event attendance patterns and topic interest signals across your event portfolio.',
    signal_types: ['event_attendance', 'topic_interest'],
    cost_of_signal: 'low', jurisdiction: 'global',
    community_types: ['event_community', 'startup_ecosystem', 'industry_association'],
    themes: ['Growth & GTM']
  },
  {
    id: 'luma', name: 'Luma', provider: 'luma',
    category: 'owner_controlled', auth_type: 'api_key',
    description: 'Detects event attendance patterns, RSVP velocity, and topic clustering across your Luma events.',
    signal_types: ['event_attendance', 'topic_interest'],
    cost_of_signal: 'low', jurisdiction: 'global',
    community_types: ['event_community', 'startup_ecosystem'],
    themes: ['Growth & GTM']
  },
  {
    id: 'circle', name: 'Circle', provider: 'circle',
    category: 'owner_controlled', auth_type: 'api_key',
    description: 'Tracks community topic activity, discussion momentum, and engagement depth.',
    signal_types: ['community_topic_activity'],
    cost_of_signal: 'low', jurisdiction: 'global',
    community_types: ['startup_ecosystem', 'industry_association', 'alumni_network'],
    themes: ['Growth & GTM']
  },
  {
    id: 'hivebrite', name: 'Hivebrite', provider: 'hivebrite',
    category: 'owner_controlled', auth_type: 'api_key',
    description: 'Surfaces membership activity signals and community engagement patterns.',
    signal_types: ['community_topic_activity'],
    cost_of_signal: 'low', jurisdiction: 'global',
    community_types: ['alumni_network', 'industry_association', 'private_club'],
    themes: ['Growth & GTM']
  },
  {
    id: 'wild_apricot', name: 'Wild Apricot', provider: 'wild_apricot',
    category: 'owner_controlled', auth_type: 'api_key',
    description: 'Tracks membership lifecycle signals — renewals, lapses, and engagement shifts.',
    signal_types: ['membership_activity'],
    cost_of_signal: 'low', jurisdiction: 'global',
    community_types: ['industry_association', 'alumni_network', 'private_club'],
    themes: ['Growth & GTM']
  },
  {
    id: 'glue_up', name: 'Glue Up', provider: 'glue_up',
    category: 'owner_controlled', auth_type: 'api_key',
    description: 'Detects membership engagement patterns and event participation signals.',
    signal_types: ['membership_activity'],
    cost_of_signal: 'low', jurisdiction: 'global',
    community_types: ['industry_association', 'corporate_network'],
    themes: ['Growth & GTM']
  },
  {
    id: 'slack', name: 'Slack (workspace)', provider: 'slack',
    category: 'owner_controlled', auth_type: 'oauth',
    description: 'Surfaces topic momentum — which conversations are accelerating and which are cooling.',
    signal_types: ['topic_momentum'],
    cost_of_signal: 'low', jurisdiction: 'global',
    community_types: ['startup_ecosystem', 'corporate_network', 'event_community'],
    themes: ['Growth & GTM']
  },
  {
    id: 'typeform', name: 'Typeform', provider: 'typeform',
    category: 'owner_controlled', auth_type: 'api_key',
    description: 'Surfaces aggregate member sentiment and topic interest from survey responses.',
    signal_types: ['member_sentiment'],
    cost_of_signal: 'low', jurisdiction: 'global',
    community_types: ['alumni_network', 'industry_association', 'event_community'],
    themes: ['Growth & GTM']
  },
  {
    id: 'xero', name: 'Xero', provider: 'xero',
    category: 'owner_controlled', auth_type: 'oauth',
    description: 'Financial health signals from your accounts — cash flow trends and invoice patterns.',
    signal_types: ['financial_health_signal'],
    cost_of_signal: 'medium', jurisdiction: 'global',
    community_types: ['startup_ecosystem', 'industry_association'],
    themes: ['Fintech']
  },
  {
    id: 'google_calendar', name: 'Google Calendar', provider: 'google_calendar',
    category: 'owner_controlled', auth_type: 'oauth',
    description: 'Detects event density signals and scheduling patterns across your community calendar.',
    signal_types: ['event_density_signal'],
    cost_of_signal: 'low', jurisdiction: 'global',
    community_types: ['event_community', 'corporate_network'],
    themes: ['Growth & GTM']
  },

  // ── Category B: Public feeds ──
  {
    id: 'companies_house', name: 'Companies House', provider: 'companies_house',
    category: 'public', auth_type: 'api_key',
    description: 'UK company filings — board appointments, director changes, charges, accounts. High-cost legal signals.',
    signal_types: ['director_appointment', 'company_filing', 'accounts_filed', 'charge_registered'],
    cost_of_signal: 'high', jurisdiction: 'uk',
    community_types: ['alumni_network', 'startup_ecosystem', 'private_club', 'industry_association'],
    themes: ['Enterprise SaaS', 'Fintech', 'Venture & Capital']
  },
  {
    id: 'london_gazette', name: 'London Gazette', provider: 'london_gazette',
    category: 'public', auth_type: 'none',
    description: 'UK national honours (CBE, OBE, MBE), insolvency notices, and state announcements. Highest-cost signals.',
    signal_types: ['honours_award', 'insolvency', 'company_dissolution'],
    cost_of_signal: 'high', jurisdiction: 'uk',
    community_types: ['alumni_network', 'private_club'],
    themes: ['Impact & Social']
  },
  {
    id: 'asic', name: 'ASIC Connect', provider: 'asic',
    category: 'public', auth_type: 'api_key',
    description: 'Australian company registry — director appointments, company filings, officeholder changes.',
    signal_types: ['director_appointment', 'company_filing', 'officeholder_change'],
    cost_of_signal: 'high', jurisdiction: 'au',
    community_types: ['alumni_network', 'startup_ecosystem', 'industry_association'],
    themes: ['Enterprise SaaS', 'Fintech']
  },
  {
    id: 'abn_lookup', name: 'ABN Lookup', provider: 'abn_lookup',
    category: 'public', auth_type: 'none',
    description: 'Australian Business Number registry — entity registration and status signals.',
    signal_types: ['entity_registration'],
    cost_of_signal: 'low', jurisdiction: 'au',
    community_types: ['startup_ecosystem', 'industry_association'],
    themes: ['Enterprise SaaS']
  },
  {
    id: 'asx', name: 'ASX Announcements', provider: 'asx',
    category: 'public', auth_type: 'none',
    description: 'Australian Securities Exchange — capital raises, M&A, director trades. High-cost market signals.',
    signal_types: ['capital_raise', 'm_and_a', 'director_trade'],
    cost_of_signal: 'high', jurisdiction: 'au',
    community_types: ['alumni_network', 'startup_ecosystem', 'private_club'],
    themes: ['Venture & Capital', 'Fintech']
  },
  {
    id: 'sec_edgar', name: 'SEC EDGAR', provider: 'sec_edgar',
    category: 'public', auth_type: 'none',
    description: 'US Securities filings — IPOs, insider trades, material events. Legal commitment signals.',
    signal_types: ['company_filing', 'insider_trade', 'ipo_filing', 'material_event'],
    cost_of_signal: 'high', jurisdiction: 'us',
    community_types: ['alumni_network', 'startup_ecosystem', 'private_club'],
    themes: ['Venture & Capital', 'Fintech']
  },
  {
    id: 'acra', name: 'ACRA BizFile+', provider: 'acra',
    category: 'public', auth_type: 'api_key',
    description: 'Singapore company registry — director appointments, filings, annual returns.',
    signal_types: ['director_appointment', 'company_filing', 'annual_return'],
    cost_of_signal: 'medium', jurisdiction: 'sg',
    community_types: ['alumni_network', 'startup_ecosystem'],
    themes: ['Enterprise SaaS', 'Fintech']
  },
  {
    id: 'sgx', name: 'SGX Announcements', provider: 'sgx',
    category: 'public', auth_type: 'none',
    description: 'Singapore Exchange — capital raises and director trades.',
    signal_types: ['capital_raise', 'director_trade'],
    cost_of_signal: 'high', jurisdiction: 'sg',
    community_types: ['alumni_network', 'startup_ecosystem'],
    themes: ['Venture & Capital', 'Fintech']
  },
  {
    id: 'opencorporates', name: 'OpenCorporates', provider: 'opencorporates',
    category: 'public', auth_type: 'api_key',
    description: 'Global company registry aggregator — filings and director changes across 140+ jurisdictions.',
    signal_types: ['company_filing', 'director_change'],
    cost_of_signal: 'medium', jurisdiction: 'global',
    community_types: ['corporate_network', 'alumni_network'],
    themes: ['Enterprise SaaS']
  },
  {
    id: 'au_gazette', name: 'Commonwealth Gazette (AU)', provider: 'au_gazette',
    category: 'public', auth_type: 'none',
    description: 'Australian national honours (AO, AM, OAM) — announced Australia Day and King\'s Birthday. State-level recognition.',
    signal_types: ['honours_award'],
    cost_of_signal: 'high', jurisdiction: 'au',
    community_types: ['alumni_network', 'private_club'],
    themes: ['Impact & Social']
  },
  {
    id: 'sg_gazette', name: 'Singapore Government Gazette', provider: 'sg_gazette',
    category: 'public', auth_type: 'none',
    description: 'Singapore National Day Awards — announced 9 August. National-level recognition.',
    signal_types: ['honours_award'],
    cost_of_signal: 'high', jurisdiction: 'sg',
    community_types: ['alumni_network', 'private_club'],
    themes: ['Impact & Social']
  },
  {
    id: 'openalex', name: 'OpenAlex', provider: 'openalex',
    category: 'public', auth_type: 'none',
    description: 'Global academic publication tracking — high-citation works, institutional research output, grant-funded publications.',
    signal_types: ['publication', 'grant_award'],
    cost_of_signal: 'high', jurisdiction: 'global',
    community_types: ['research_institution', 'alumni_network', 'industry_association'],
    themes: ['Data & Analytics', 'Health', 'Climate', 'AI']
  },
  {
    id: 'semantic_scholar', name: 'Semantic Scholar', provider: 'semantic_scholar',
    category: 'public', auth_type: 'api_key',
    description: 'AI-powered academic paper tracking — citation velocity, influential papers, research trends.',
    signal_types: ['publication'],
    cost_of_signal: 'high', jurisdiction: 'global',
    community_types: ['research_institution', 'alumni_network'],
    themes: ['AI', 'Data & Analytics', 'Health']
  },
  {
    id: 'arc_grants', name: 'ARC Grants', provider: 'arc_grants',
    category: 'public', auth_type: 'none',
    description: 'Australian Research Council grant awards — competitive funding signals from Australia\'s peak research body.',
    signal_types: ['grant_award'],
    cost_of_signal: 'high', jurisdiction: 'au',
    community_types: ['research_institution', 'alumni_network'],
    themes: ['Data & Analytics', 'Health', 'Climate']
  },
  {
    id: 'ukri', name: 'UKRI / Innovate UK', provider: 'ukri',
    category: 'public', auth_type: 'none',
    description: 'UK research and innovation grants — funding awards from UKRI councils and Innovate UK.',
    signal_types: ['grant_award'],
    cost_of_signal: 'high', jurisdiction: 'uk',
    community_types: ['research_institution', 'alumni_network', 'industry_association'],
    themes: ['Data & Analytics', 'Health', 'Climate', 'AI']
  },
  {
    id: 'nsf', name: 'NSF Award Search', provider: 'nsf',
    category: 'public', auth_type: 'none',
    description: 'US National Science Foundation awards — competitive federal research funding signals.',
    signal_types: ['grant_award'],
    cost_of_signal: 'high', jurisdiction: 'us',
    community_types: ['research_institution', 'alumni_network'],
    themes: ['Data & Analytics', 'AI', 'Climate']
  },
  {
    id: 'crunchbase', name: 'Crunchbase', provider: 'crunchbase',
    category: 'public', auth_type: 'api_key',
    description: 'Global startup funding rounds, acquisitions, and IPOs. The canonical source for venture activity.',
    signal_types: ['funding_round', 'm_and_a', 'ipo_filing'],
    cost_of_signal: 'high', jurisdiction: 'global',
    community_types: ['startup_ecosystem', 'alumni_network', 'private_club', 'industry_association'],
    themes: ['Venture & Capital', 'AI', 'Fintech']
  },
  {
    id: 'newsapi', name: 'NewsAPI', provider: 'newsapi',
    category: 'public', auth_type: 'api_key',
    description: 'Global press coverage — detects when companies or institutions in your ecosystem make the news.',
    signal_types: ['news', 'press_feature'],
    cost_of_signal: 'medium', jurisdiction: 'global',
    community_types: ['startup_ecosystem', 'corporate_network', 'alumni_network', 'private_club'],
    themes: ['Growth & GTM', 'Media & Entertainment']
  },
  {
    id: 'hm_land_registry', name: 'HM Land Registry', provider: 'hm_land_registry',
    category: 'public', auth_type: 'none',
    description: 'UK property price-paid data — high-value property transactions as wealth and capital deployment signals.',
    signal_types: ['property_transaction'],
    cost_of_signal: 'high', jurisdiction: 'uk',
    community_types: ['alumni_network', 'private_club'],
    themes: ['Real Estate']
  },
  {
    id: 'ura_sg', name: 'URA Property (SG)', provider: 'ura_sg',
    category: 'public', auth_type: 'none',
    description: 'Singapore property transactions via URA — residential and commercial transaction signals.',
    signal_types: ['property_transaction'],
    cost_of_signal: 'high', jurisdiction: 'sg',
    community_types: ['alumni_network', 'private_club'],
    themes: ['Real Estate']
  },
  {
    id: 'uspto', name: 'USPTO Patents', provider: 'uspto',
    category: 'public', auth_type: 'none',
    description: 'US Patent and Trademark Office — patent grants and applications. 18+ months of IP commitment.',
    signal_types: ['patent_grant'],
    cost_of_signal: 'high', jurisdiction: 'us',
    community_types: ['research_institution', 'startup_ecosystem', 'industry_association'],
    themes: ['AI', 'Hardware', 'Health']
  },
  {
    id: 'rss', name: 'RSS / Web Feed', provider: 'rss',
    category: 'public', auth_type: 'url',
    description: 'Custom RSS or web feed — configure any URL to pull structured content signals.',
    signal_types: ['news', 'publication'],
    cost_of_signal: 'low', jurisdiction: 'global',
    community_types: ['event_community', 'industry_association', 'startup_ecosystem'],
    themes: []
  }
];

// ── Recommendations by community type ──
var TYPE_RECOMMENDATIONS = {
  'alumni_network': ['companies_house', 'asic', 'sec_edgar', 'acra', 'london_gazette', 'au_gazette', 'sg_gazette', 'crunchbase', 'openalex', 'asx', 'hm_land_registry', 'ura_sg', 'arc_grants', 'ukri', 'nsf', 'newsapi', 'eventbrite'],
  'industry_association': ['arc_grants', 'ukri', 'nsf', 'uspto', 'companies_house', 'newsapi', 'openalex', 'crunchbase'],
  'research_institution': ['openalex', 'semantic_scholar', 'arc_grants', 'ukri', 'nsf', 'uspto'],
  'startup_ecosystem': ['crunchbase', 'sec_edgar', 'companies_house', 'newsapi', 'uspto', 'luma'],
  'private_club': ['newsapi', 'companies_house', 'crunchbase', 'london_gazette', 'au_gazette'],
  'corporate_network': ['newsapi', 'crunchbase', 'companies_house', 'hubspot', 'salesforce'],
  'event_community': ['eventbrite', 'luma', 'newsapi', 'rss']
};

// ══════════════════════════════════════════════════════
// GET /api/integrations/:communityId/feeds — catalogue with recommendations
// ══════════════════════════════════════════════════════
router.get('/:communityId/feeds', authenticateToken, communityOwnerAuth, async function(req, res) {
  try {
    var communityId = req.communityId;

    // Get community type and connected feeds
    var community = await dbGet('SELECT * FROM communities WHERE id = $1', [communityId]);
    var tenant = await dbGet('SELECT * FROM community_tenants WHERE community_id = $1', [communityId]);
    var connected = await dbAll(
      'SELECT * FROM community_integrations WHERE community_id = $1',
      [communityId]
    );

    var communityType = (tenant && tenant.community_type) || (community && community.community_type) || 'event_community';
    var jurisdiction = (tenant && tenant.region) || 'global';

    var connectedProviders = {};
    for (var i = 0; i < connected.length; i++) {
      connectedProviders[connected[i].provider] = {
        id: connected[i].id,
        enabled: connected[i].enabled,
        last_synced_at: connected[i].last_synced_at,
        sync_status: connected[i].sync_status
      };
    }

    // Build catalogue with recommendations
    var recommended = TYPE_RECOMMENDATIONS[communityType] || [];
    var feeds = FEED_CATALOGUE.map(function(feed) {
      var isConnected = !!connectedProviders[feed.provider];
      var connInfo = connectedProviders[feed.provider] || null;
      return {
        id: feed.id,
        name: feed.name,
        provider: feed.provider,
        category: feed.category,
        auth_type: feed.auth_type,
        description: feed.description,
        signal_types: feed.signal_types,
        cost_of_signal: feed.cost_of_signal,
        jurisdiction: feed.jurisdiction,
        community_types: feed.community_types,
        themes: feed.themes,
        recommended: recommended.indexOf(feed.id) !== -1,
        connected: isConnected,
        connection: connInfo
      };
    });

    // Sort: connected first, then recommended, then alphabetical
    feeds.sort(function(a, b) {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      feeds: feeds,
      community_type: communityType,
      jurisdiction: jurisdiction,
      connected_count: connected.length
    });
  } catch (err) {
    console.error('[integrations] Feed catalogue error:', err);
    res.status(500).json({ error: 'Failed to load feed catalogue' });
  }
});

// ══════════════════════════════════════════════════════
// POST /api/integrations/:communityId/connect
// ══════════════════════════════════════════════════════
router.post('/:communityId/connect', authenticateToken, communityOwnerAuth, async function(req, res) {
  try {
    var communityId = req.communityId;
    var provider = req.body.provider;
    var credentials = req.body.credentials || {};

    if (!provider) return res.status(400).json({ error: 'provider required' });

    // Find feed in catalogue
    var feed = null;
    for (var i = 0; i < FEED_CATALOGUE.length; i++) {
      if (FEED_CATALOGUE[i].provider === provider) { feed = FEED_CATALOGUE[i]; break; }
    }
    if (!feed) return res.status(400).json({ error: 'Unknown provider: ' + provider });

    // Check if already connected
    var existing = await dbGet(
      'SELECT id FROM community_integrations WHERE community_id = $1 AND provider = $2',
      [communityId, provider]
    );
    if (existing) return res.status(409).json({ error: 'Already connected', integration_id: existing.id });

    // Try to load and connect via adapter
    var encryptedCreds = null;
    try {
      var adapters = require('../lib/integrations');
      var adapter = adapters.getAdapter(provider) || require('../lib/integrations/' + provider);
      var result = await adapter.connect(communityId, credentials);
      if (result && result.iv) {
        encryptedCreds = result;
      } else {
        encryptedCreds = encryptCredentials(credentials);
      }
    } catch (adapterErr) {
      // Adapter not yet implemented — store credentials directly
      encryptedCreds = Object.keys(credentials).length > 0 ? encryptCredentials(credentials) : null;
    }

    var row = await dbGet(
      `INSERT INTO community_integrations (community_id, provider, category, credentials, signal_types_produced, sync_status)
       VALUES ($1, $2, $3, $4, $5, 'connected')
       RETURNING id`,
      [communityId, provider, feed.category, encryptedCreds ? JSON.stringify(encryptedCreds) : null, feed.signal_types]
    );

    res.json({ status: 'connected', integration_id: row.id, provider: provider });
  } catch (err) {
    console.error('[integrations] Connect error:', err);
    res.status(500).json({ error: 'Failed to connect provider' });
  }
});

// ══════════════════════════════════════════════════════
// DELETE /api/integrations/:communityId/:integrationId — disconnect
// ══════════════════════════════════════════════════════
router.delete('/:communityId/:integrationId', authenticateToken, communityOwnerAuth, async function(req, res) {
  try {
    await dbRun(
      'DELETE FROM community_integrations WHERE id = $1 AND community_id = $2',
      [req.params.integrationId, req.communityId]
    );
    res.json({ status: 'disconnected' });
  } catch (err) {
    console.error('[integrations] Disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// ══════════════════════════════════════════════════════
// GET /api/integrations/:communityId/:integrationId/status
// ══════════════════════════════════════════════════════
router.get('/:communityId/:integrationId/status', authenticateToken, communityOwnerAuth, async function(req, res) {
  try {
    var integration = await dbGet(
      'SELECT id, provider, sync_status, last_synced_at, enabled, created_at FROM community_integrations WHERE id = $1 AND community_id = $2',
      [req.params.integrationId, req.communityId]
    );
    if (!integration) return res.status(404).json({ error: 'Integration not found' });

    // Count signals from this provider
    var signalCount = await dbGet(
      "SELECT COUNT(*) as count FROM community_signals WHERE community_id = $1 AND metadata->>'provider' = $2",
      [req.communityId, integration.provider]
    );

    res.json({
      integration: integration,
      signal_count: parseInt(signalCount.count) || 0
    });
  } catch (err) {
    console.error('[integrations] Status error:', err);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// ══════════════════════════════════════════════════════
// POST /api/integrations/:communityId/:integrationId/test
// ══════════════════════════════════════════════════════
router.post('/:communityId/:integrationId/test', authenticateToken, communityOwnerAuth, async function(req, res) {
  try {
    var integration = await dbGet(
      'SELECT * FROM community_integrations WHERE id = $1 AND community_id = $2',
      [req.params.integrationId, req.communityId]
    );
    if (!integration) return res.status(404).json({ error: 'Integration not found' });

    // Try fetching a small sample
    try {
      var adapter = require('../lib/integrations/' + integration.provider);
      var raw = await adapter.fetchRaw(req.communityId, new Date(Date.now() - 86400000 * 7));
      var totalRecords = 0;
      for (var i = 0; i < raw.length; i++) {
        totalRecords += (raw[i].records || []).length;
      }
      res.json({ status: 'ok', provider: integration.provider, sample_count: totalRecords });
    } catch (adapterErr) {
      res.json({ status: 'adapter_not_available', provider: integration.provider, message: adapterErr.message });
    }
  } catch (err) {
    console.error('[integrations] Test error:', err);
    res.status(500).json({ error: 'Test failed' });
  }
});

module.exports = { router: router, FEED_CATALOGUE: FEED_CATALOGUE };
