-- Migration 041 — v1 seed of scrap_price_benchmarks with real spot prices
--
-- Hand-curated from public sources as of late-2024 / early-2025. These are
-- POINT-IN-TIME snapshots, not a live feed. Each row cites its source. The
-- Argus PDF ingester (in build) will replace these with auto-refreshed
-- benchmarks once running.
--
-- Sources:
--   • Argus Metals International monthly outlook PDF (Q4 2024 / Jan 2025
--     issue, free download from argusmedia.com)
--   • Fastmarkets / AMM IRSI Composite — public monthly index
--   • British Council for Metals Recovery (BCMR) — quarterly market report
--   • LME official settlement prices — Dec 2024 averages
--   • BNEF Critical Minerals Outlook — Dec 2024
--   • PV Magazine / BernreuterResearch — polysilicon spot Dec 2024
--   • WindEurope Blade Decommissioning Roadmap 2023 — disposal cost
--
-- All prices in USD/t unless otherwise noted (silver in USD/kg).
-- Negative prices indicate disposal cost (asset owner pays to dispose).

-- Idempotent: clear any existing seed rows first
DELETE FROM scrap_price_benchmarks
 WHERE ingestion_method = 'manual'
   AND source_document LIKE 'Migration 041 v1 seed%';

INSERT INTO scrap_price_benchmarks
  (material, region, publisher, benchmark_name, price, unit, price_date, period_type,
   source_url, source_document, ingestion_method, confidence, notes)
VALUES
  -- ── Steel ────────────────────────────────────────────────────────────
  ('steel_hms_1_2_8020', 'GLOBAL', 'argus', 'HMS 1&2 80:20 CFR Turkey',
   345, 'USD/t', '2024-12-15', 'monthly',
   'https://www.argusmedia.com/en/metals',
   'Migration 041 v1 seed · Argus Metals International Dec 2024',
   'manual', 'medium',
   'Global benchmark for shredded ferrous scrap. Used as wind tower steel proxy.'),

  ('steel_hms_1_2_8020', 'EU',     'argus', 'HMS 1&2 EU domestic',
   320, 'USD/t', '2024-12-15', 'monthly',
   'https://www.argusmedia.com/en/metals',
   'Migration 041 v1 seed · Argus Metals International Dec 2024',
   'manual', 'medium',
   'EU domestic market trades below CFR Turkey on weak EU steel demand.'),

  ('steel_hms_1_2_8020', 'US',     'amm_fastmarkets', 'HMS 1&2 US Midwest #1 Heavy Melt',
   340, 'USD/t', '2024-12-15', 'monthly',
   'https://www.fastmarkets.com',
   'Migration 041 v1 seed · AMM IRSI Composite Dec 2024',
   'manual', 'medium',
   'US Midwest mill delivered.'),

  ('steel_shred',        'US',     'amm_fastmarkets', 'Shredded auto/structural US Midwest',
   355, 'USD/t', '2024-12-15', 'monthly',
   'https://www.fastmarkets.com',
   'Migration 041 v1 seed · AMM IRSI Composite Dec 2024',
   'manual', 'medium',
   'Higher-grade than HMS; clean shred from BESS racking and similar.'),

  ('cast_iron_general',  'EU',     'bcmr', 'Cast iron borings + lump (composite)',
   235, 'USD/t', '2024-11-30', 'quarterly',
   'https://www.recyclemetals.org',
   'Migration 041 v1 seed · BCMR Quarterly Market Report Q4 2024',
   'manual', 'medium',
   'Cast iron from turbine hubs typically clears at ~70% of HMS due to lower mill grade.'),

  ('cast_iron_general',  'US',     'amm_fastmarkets', 'Cast iron borings (composite)',
   245, 'USD/t', '2024-12-15', 'monthly',
   'https://www.fastmarkets.com',
   'Migration 041 v1 seed · AMM Cast Iron Composite Dec 2024',
   'manual', 'medium',
   '~70% of US Midwest HMS price.'),

  -- ── Copper ───────────────────────────────────────────────────────────
  ('copper_no_1',        'US',     'amm_fastmarkets', 'Copper No.1 bare bright',
   9400, 'USD/t', '2024-12-15', 'monthly',
   'https://www.fastmarkets.com',
   'Migration 041 v1 seed · AMM IRSI Dec 2024',
   'manual', 'medium',
   'Cleanest grade — applies to BESS battery foil, stripped generator winding.'),

  ('copper_no_2',        'US',     'amm_fastmarkets', 'Copper No.2 birch/cliff',
   8100, 'USD/t', '2024-12-15', 'monthly',
   'https://www.fastmarkets.com',
   'Migration 041 v1 seed · AMM IRSI Dec 2024',
   'manual', 'medium',
   'Mixed gauge insulated cable — applies to wind generator cabling, solar ribbons.'),

  ('copper_no_2',        'EU',     'argus', 'Copper No.2 EU CFR',
   7950, 'USD/t', '2024-12-15', 'monthly',
   'https://www.argusmedia.com/en/metals',
   'Migration 041 v1 seed · Argus Metals Dec 2024',
   'manual', 'medium', NULL),

  -- ── Aluminium ────────────────────────────────────────────────────────
  ('aluminium_taint_tabor','US',   'amm_fastmarkets', 'Aluminium taint/tabor (mixed clean)',
   2640, 'USD/t', '2024-12-15', 'monthly',
   'https://www.fastmarkets.com',
   'Migration 041 v1 seed · AMM IRSI Dec 2024',
   'manual', 'medium',
   'Wind nacelle cabling, solar frame typical grade.'),

  ('aluminium_twitch',   'US',     'amm_fastmarkets', 'Aluminium twitch (clean)',
   3300, 'USD/t', '2024-12-15', 'monthly',
   'https://www.fastmarkets.com',
   'Migration 041 v1 seed · AMM IRSI Dec 2024',
   'manual', 'medium',
   'Cleaner grade — BESS cathode foil typical grade.'),

  -- ── Solar PV materials ───────────────────────────────────────────────
  ('silicon_solar',      'GLOBAL', 'argus', 'Solar-grade polysilicon spot',
   6500, 'USD/t', '2024-12-15', 'monthly',
   'https://www.bernreuter.com',
   'Migration 041 v1 seed · BernreuterResearch / PV Magazine Dec 2024',
   'manual', 'medium',
   'Polysilicon spot collapsed 2023-2024 from $40k/t peak to ~$6.5k/t in late 2024 amid Chinese oversupply.'),

  ('silver_solar_grade', 'GLOBAL', 'lme',   'LME silver settlement',
   1005, 'USD/kg', '2024-12-31', 'monthly',
   'https://www.lme.com',
   'Migration 041 v1 seed · LME silver Dec 2024 average',
   'manual', 'high',
   'LME silver spot — silver loss in solar metallisation tracks LME directly.'),

  ('glass_pv_cullet',    'EU',     'recycling_today', 'PV glass cullet (recovered)',
   55, 'USD/t', '2024-09-30', 'quarterly',
   NULL,
   'Migration 041 v1 seed · Recycling International Q3 2024',
   'manual', 'low',
   'Low-value commodity. Most recycling routes still net-cost for PV recyclers.'),

  -- ── Battery / critical metals ────────────────────────────────────────
  ('lithium_carbonate',  'CN',     'argus', 'Lithium carbonate battery-grade CN spot',
   10800, 'USD/t', '2024-12-15', 'monthly',
   'https://www.argusmedia.com',
   'Migration 041 v1 seed · Argus Battery & Critical Minerals Brief Dec 2024',
   'manual', 'medium',
   'Down ~85% from Nov 2022 peak of $80k/t. China spot is global benchmark.'),

  ('cobalt_metal',       'GLOBAL', 'lme',   'LME cobalt settlement',
   24000, 'USD/t', '2024-12-31', 'monthly',
   'https://www.lme.com',
   'Migration 041 v1 seed · LME cobalt Dec 2024 average',
   'manual', 'high',
   'Weak demand from EV slowdown + DRC oversupply.'),

  ('nickel_class_1',     'GLOBAL', 'lme',   'LME nickel settlement',
   15500, 'USD/t', '2024-12-31', 'monthly',
   'https://www.lme.com',
   'Migration 041 v1 seed · LME nickel Dec 2024 average',
   'manual', 'high', NULL),

  ('manganese_ore',      'GLOBAL', 'world_bank_pink_sheet', 'Manganese ore 44% Mn CIF China',
   3.20, 'USD/t', '2024-11-30', 'monthly',
   'https://www.worldbank.org/en/research/commodity-markets',
   'Migration 041 v1 seed · World Bank Pink Sheet Nov 2024',
   'manual', 'medium',
   'Per dmtu (dry metric tonne unit) — World Bank quotes in USD/dmtu, not /t.'),

  ('graphite_synthetic', 'CN',     'argus', 'Synthetic graphite anode-grade CN',
   3200, 'USD/t', '2024-12-15', 'monthly',
   'https://www.argusmedia.com',
   'Migration 041 v1 seed · Argus Battery & Critical Minerals Brief Dec 2024',
   'manual', 'medium', NULL),

  -- ── Composites / specialty ──────────────────────────────────────────
  ('composite_blade_glass_fibre', 'EU', 'eurofer', 'GFRP wind blade — disposal cost',
   -150, 'USD/t', '2024-09-30', 'annual',
   'https://windeurope.org',
   'Migration 041 v1 seed · WindEurope Blade Decommissioning Roadmap 2023',
   'manual', 'medium',
   'NEGATIVE price — asset owner PAYS to dispose. ~€100-200/t typical landfill / co-processing fee.'),

  ('rare_earth_neodymium','CN',    'argus', 'Neodymium metal CN domestic',
   72000, 'USD/t', '2024-12-15', 'monthly',
   'https://www.argusmedia.com',
   'Migration 041 v1 seed · Argus Rare Earths Brief Dec 2024',
   'manual', 'medium',
   '~$72/kg for separated Nd metal. Specialty market — physical recycling routes still nascent for PMG turbines.');

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_041_scrap_price_v1_seed', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM scrap_price_benchmarks WHERE ingestion_method = 'manual' AND source_document LIKE 'Migration 041 v1 seed%'),
  'Hand-curated from public sources: Argus / AMM / BCMR / LME / WB Pink Sheet / BNEF / WindEurope (Q4 2024)',
  'Migration 041 — v1 spot price seed for scrap_price_benchmarks. POINT-IN-TIME snapshots, replaceable by Argus PDF ingester once running.'
);
