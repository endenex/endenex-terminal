-- Migration 021 — Seed verified Decom Mandates feed into watch_events
--
-- Purpose: replace earlier hardcoded illustrative data with REAL commercial
-- transactions in the wind decom market — contractor awards, contractor
-- mobilizations, operator exits / portfolio disposals, insolvency-driven
-- distressed-asset moves.
--
-- Each row carries a precise source URL pointing directly to the announcement
-- (operator press release, contractor PR, regulator filing, or trade press
-- article confirming the named transaction).
--
-- Going forward, new mandates flow in via the existing Airtable curation →
-- daily sync pipeline (.github/workflows/daily_pipeline.yml step 1).

-- ── Step 1: ensure source publications exist in watch_sources ────────────────

INSERT INTO watch_sources (name, url, source_type, regions, notes)
VALUES
  ('RenerCycle Press',          'https://renercycle.com/en/news-press/',                                                      'company',     ARRAY['ES','EU'],          'Wind decom + recycling specialist (Spain)'),
  ('Iberdrola Press Room',      'https://www.iberdrola.com/press-room',                                                       'company',     ARRAY['ES','GB'],          'ScottishPower / Iberdrola Group press'),
  ('reNews',                    'https://renews.biz/',                                                                        'trade press', ARRAY['GB','EU'],          'UK renewables trade press'),
  ('Siemens Gamesa Press',      'https://www.siemensgamesa.com/global/en/home/press-releases.html',                           'company',     ARRAY['Global'],           'OEM contractor press releases'),
  ('Renewable Energy Industry', 'https://www.renewable-energy-industry.com/',                                                 'trade press', ARRAY['Global'],           'Renewable energy industry trade press'),
  ('Offshore Wind (.biz)',      'https://www.offshorewind.biz/',                                                              'trade press', ARRAY['EU','GB','US'],     'Navingo offshore wind trade press'),
  ('Bondoro Bankruptcy Watch',  'https://bondoro.com/',                                                                       'regulator',   ARRAY['US'],               'US Chapter 11 case summaries'),
  ('The Well News',             'https://www.thewellnews.com/',                                                               'trade press', ARRAY['US'],               'US news / restructuring coverage'),
  ('Ørsted Newsroom',           'https://orsted.com/en/media/newsroom',                                                       'company',     ARRAY['DK','EU','GB','US'],'Ørsted official press / IR releases (held for future decom-tied events)')
ON CONFLICT DO NOTHING;

-- ── Step 2: idempotent re-run cleanup ───────────────────────────────────────

DELETE FROM watch_events
WHERE source_url IN (
  -- 7 mandate-focused rows (current set)
  'https://renercycle.com/en/renercycle-is-awarded-the-contract-for-the-decommissioning-and-recycling-of-the-muel-wind-farm-owned-by-rwe/',
  'https://renews.biz/86950/spr-starts-decommissioning-scotlands-first-commercial-wind-farm/',
  'https://www.siemensgamesa.com/global/en/home/press-releases/siemens-gamesa-to-repower-two-wind-farms-in-texas.html',
  'https://www.renewable-energy-industry.com/news/world/article-7151-year-end-sprint-nordex-and-vestas-secure-new-major-projects-in-europe-and-overseas-just-before-christmas',
  'https://www.offshorewind.biz/2025/05/22/alpha-ventus-consortium-decides-to-decommission-germanys-first-offshore-wind-farm/',
  'https://bondoro.com/shannon-wind/',
  'https://www.thewellnews.com/renewable-energy/wind-turbine-blade-maker-files-ch-11-in-texas/',
  -- v2 generic M&A rows (now removed) — keep cleanup paths so older runs are scrubbed
  'https://www.bp.com/en/global/corporate/news-and-insights/press-releases/bp-agrees-to-sell-us-onshore-wind-business-to-ls-power.html',
  'https://orsted.com/en/media/news/2026/02/orsted-signs-agreement-with-cip-to-divest-its-euro-1477764911',
  'https://orsted.com/en/media/news/2025/11/orsted-signs-agreement-to-divest-50-stake-in-horns-1465396411'
);

-- Also remove any prior seed from this migration's earlier (incorrect) version
DELETE FROM watch_events
WHERE source_url IN (
  'https://www.power-technology.com/features/full-circle-decommissioning-first-ever-offshore-windfarm/',
  'https://www.powermag.com/vattenfall-completes-worlds-first-decommissioning-offshore-wind-farm/',
  'https://www.offshorewind.biz/2016/12/07/lely-wind-farm-fully-decommissioned-video/',
  'https://www.eon.com/en/about-us/media/press-release/2019/eon-decommissions-blyth-offshore-wind-farm.html',
  'https://www.iberdrola.com/press-room/news/detail/scottishpower-successfully-completes-repowering-scotland-first-wind-farm',
  'https://www.scottishpowerrenewables.com/pages/carland_cross_repowering.aspx'
);

-- ── Step 3: insert 10 verified decom mandates ───────────────────────────────

-- Field semantics:
--   developer    = asset owner / operator (the seller / appointing party)
--   company_name = contractor / acquirer / counterparty (the awarded firm or buyer)

INSERT INTO watch_events (
  category, event_type, scope, headline, notes,
  site_name, developer, company_name, capacity_mw, turbine_count,
  source_id, source_url,
  event_date, confidence, last_reviewed,
  liability_tags, is_duplicate, source_count
)
SELECT
  e.category::watch_category, e.event_type, e.scope, e.headline, e.notes,
  e.site_name, e.developer, e.company_name, e.capacity_mw, e.turbine_count,
  ws.id, e.source_url,
  e.event_date::date, e.confidence, current_date,
  e.liability_tags, false, 1
FROM (VALUES
  -- ── CONTRACTOR AWARDS ──────────────────────────────────────────────────────

  -- 1) Muel (ES) — RWE awards Renercycle the decom + recycling contract
  ('market', 'Decommissioning award', 'ES',
   'RenerCycle awarded Muel decom + recycling mandate by RWE',
   'RenerCycle (ES) selected by RWE to dismantle and recycle the 27-turbine 16.2 MW Muel wind farm in Aragón. Replacement: 3×6.6 MW (19.8 MW total). 35 personnel across project phases. Completion target 2025.',
   'Muel', 'RWE', 'RenerCycle', 16.2, 27,
   'https://renercycle.com/en/renercycle-is-awarded-the-contract-for-the-decommissioning-and-recycling-of-the-muel-wind-farm-owned-by-rwe/',
   '2024-04-15', 'High', ARRAY['CAP']::text[],
   'RenerCycle Press'),

  -- 2) Hagshaw Hill (UK) — ScottishPower awards Forsyth of Denny the dismantling contract
  ('market', 'Decommissioning award', 'GB',
   'Forsyth of Denny awarded Hagshaw Hill dismantling by ScottishPower Renewables',
   'Scottish firm Forsyth of Denny appointed to dismantle 26 original Bonus turbines at Hagshaw Hill (16 MW, commissioned 1995) — Scotland''s first commercial wind farm. Land prep for repower with 14×Nordex N149 (79 MW, 5× original output). Decom completed late 2023; repower commissioned Nov 2025.',
   'Hagshaw Hill', 'ScottishPower Renewables', 'Forsyth of Denny', 16, 26,
   'https://renews.biz/86950/spr-starts-decommissioning-scotlands-first-commercial-wind-farm/',
   '2023-07-12', 'High', ARRAY['CAP','REC_UP']::text[],
   'reNews'),

  -- 3) NextEra Texas (US) — Siemens Gamesa awarded repower of two wind farms
  ('market', 'Repowering award', 'US',
   'Siemens Gamesa awarded repower contract for two NextEra Texas wind farms',
   'Siemens Gamesa Renewable Energy selected by NextEra Energy Resources to repower two Texas wind farms running existing SWT-2.3-93 turbines, upgrading to SWT-2.3-108 model. Up to 25% more annual energy production. Sites remain operational during repower.',
   'NextEra Texas portfolio', 'NextEra Energy Resources', 'Siemens Gamesa', NULL, NULL,
   'https://www.siemensgamesa.com/global/en/home/press-releases/siemens-gamesa-to-repower-two-wind-farms-in-texas.html',
   '2024-09-10', 'High', ARRAY['CAP','REC_UP']::text[],
   'Siemens Gamesa Press'),

  -- 4) Hollich (DE) — Nordex awarded major German repowering order
  ('market', 'Repowering award', 'DE',
   'Nordex awarded 106.8 MW Hollich repowering order by Bürgerwind community',
   'Bürgerwind Hollich GmbH selected Nordex for 16-turbine repower (12×N163/6.X on 164m hybrid towers + 4×N149/5.X) totalling 106.8 MW. 25-year long-term maintenance contract included.',
   'Hollich', 'Bürgerwind Hollich GmbH', 'Nordex', 106.8, 16,
   'https://www.renewable-energy-industry.com/news/world/article-7151-year-end-sprint-nordex-and-vestas-secure-new-major-projects-in-europe-and-overseas-just-before-christmas',
   '2024-12-18', 'High', ARRAY['CAP','REC_UP']::text[],
   'Renewable Energy Industry'),

  -- ── OPEN TENDERS ──────────────────────────────────────────────────────────

  -- 5) Alpha Ventus (DE) — first German offshore wind farm decom tender
  ('market', 'Decommissioning tender', 'DE',
   'Alpha Ventus consortium opens €50M decom tender for Germany''s first offshore wind farm',
   'Alpha Ventus consortium (EWE / EnBW / Vattenfall) formally decided 21 May 2025 to decommission the 60 MW pioneer site (6×Adwen AD 5-116 + 6×Senvion 5M, 45 km north of Borkum). Estimated contract ~€50M. EOI deadline 16 Dec 2025; tender invitations 16 Mar 2026; execution start early 2027 (or 2028).',
   'Alpha Ventus', 'EWE / EnBW / Vattenfall', NULL, 60, 12,
   'https://www.offshorewind.biz/2025/05/22/alpha-ventus-consortium-decides-to-decommission-germanys-first-offshore-wind-farm/',
   '2025-05-21', 'High', ARRAY['CAP','COST_UP']::text[],
   'Offshore Wind (.biz)'),

  -- ── INSOLVENCY / DISTRESSED ASSETS ─────────────────────────────────────────

  -- 6) Shannon Wind (US TX) — Chapter 11 driving forced sale
  ('market', 'Insolvency', 'US',
   'Shannon Wind files Chapter 11 — 204 MW Texas wind farm forced sale',
   'Shannon Wind LLC filed Chapter 11 on 25 Jan 2026 to effectuate a going-concern sale via competitive bidding. 119×GE 1.7-103 turbines, 204.1 MW nameplate. Insolvency triggered by Winter Storm Uri (Feb 2021) energy hedge fallout — $39.5M balance-sheet liability. Receiver opening process to decom/repower buyers.',
   'Shannon Wind', 'Shannon Wind LLC (in admin)', NULL, 204.1, 119,
   'https://bondoro.com/shannon-wind/',
   '2026-01-25', 'High', ARRAY['CAP','PROV']::text[],
   'Bondoro Bankruptcy Watch'),

  -- 7) TPI Composites (US) — wind blade manufacturer Chapter 11 (supply-chain signal)
  ('market', 'Insolvency', 'US',
   'TPI Composites files Chapter 11 — wind blade supplier $1B+ debt',
   'TPI Composites Inc. (Scottsdale, AZ), the largest independent wind blade manufacturer, filed Chapter 11 with $1B+ debt citing macroeconomic headwinds plus operational and regulatory challenges. $82.5M DIP financing agreed with Oaktree Capital Management. Operations continue through proceedings. Read-across: blade supply tightness and processing pathway implications.',
   'TPI Composites Inc.', 'TPI Composites Inc. (in admin)', 'Oaktree Capital Management', NULL, NULL,
   'https://www.thewellnews.com/renewable-energy/wind-turbine-blade-maker-files-ch-11-in-texas/',
   '2025-11-14', 'High', ARRAY['CAP','REC_DN']::text[],
   'The Well News')

  -- Note: 'Operator exit' / generic M&A rows (BP→LS Power, Ørsted→CIP, Ørsted→Apollo)
  -- were removed in v2.1 — none mentioned decom, repower, or end-of-life intent
  -- in their source announcements. They were diluting the feed. Only re-add
  -- when the source explicitly references decom, repower, or EoL for named assets.

) AS e(
  category, event_type, scope, headline, notes,
  site_name, developer, company_name, capacity_mw, turbine_count,
  source_url, event_date, confidence, liability_tags, source_name
)
LEFT JOIN watch_sources ws ON ws.name = e.source_name;

-- ── Telemetry ──────────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_021_decom_mandates_v2_1', 'success', NOW(), NOW(),
  7,
  'RenerCycle, reNews, Siemens Gamesa, Renewable Energy Industry, OffshoreWind.biz, Bondoro, The Well News',
  'Migration 021 v2.1 — 7 verified mandate-focused events: 4 contractor awards (Muel/RenerCycle, Hagshaw Hill/Forsyth of Denny, NextEra Texas/Siemens Gamesa, Hollich/Nordex), 1 open tender (Alpha Ventus €50M), 2 insolvencies (Shannon Wind 204MW Ch11, TPI Composites Ch11). Generic M&A rows (BP→LS Power, Ørsted→CIP, Ørsted→Apollo) dropped — none mentioned decom/repower/EoL in source.'
);
