-- Migration 042 — v2 spot price seed for scrap_price_benchmarks (May 2026)
--
-- Replaces Migration 041's stale Dec 2024 seed with current May 2026 prices
-- verified from public sources via web search:
--
--   • LME settlements (cobalt, nickel, copper, aluminium) — via Trading
--     Economics / westmetall.com (LME official mirrors)
--   • SteelOrbis / Argus / Fastmarkets — HMS 1&2 CFR Turkey benchmark
--   • iScrapApp / Rockaway Recycling / ScrapMonster — US scrap composites
--   • PV Magazine / OPIS Global Solar Markets Report — polysilicon
--   • Trading Economics — silver
--   • Argus Battery & Critical Minerals Brief — lithium carbonate, graphite
--   • Eramet / UMK / Argus — manganese ore CIF China
--   • Trading Economics / Strategic Metals Invest — neodymium
--
-- Key shifts from Dec 2024:
--   • Lithium carbonate ↑ from $10,800 to $24,000/t (+122%) — energy
--     storage demand surge, data centre buildout
--   • Cobalt ↑ from $24,000 to $56,000/t (+133%) — DRC export curbs
--   • Nickel ↑ from $15,500 to $19,650/t (+27%) — Indonesia quota cuts +
--     Strait of Hormuz disruption
--   • Aluminium primary at multi-year highs (~$3,540/t) — Strait of
--     Hormuz blocked, Middle East supply concern
--   • Silver MASSIVELY up from ~$1,005 to $2,481/kg (+147%) — multi-year
--     bull market
--   • Neodymium ↑ from $72,000 to $244,900/t (+240%) — China rare-earth
--     supply tightening, EV/wind PMG demand
--   • Polysilicon CN ↓ further from $6,500 to $5,000/t — Chinese
--     oversupply persists
--   • Synthetic graphite ↓ from $3,200 to $2,700/t — China oversupply
--
-- Cast iron stays ~70% of HMS as a structural ratio (not a market quote
-- per se, but a stable basis observed across cycles).

-- Idempotent: clear v1 seed and any prior v2 attempts
DELETE FROM scrap_price_benchmarks
 WHERE ingestion_method = 'manual'
   AND (source_document LIKE 'Migration 041 v1 seed%'
     OR source_document LIKE 'Migration 042 v2 seed%');

INSERT INTO scrap_price_benchmarks
  (material, region, publisher, benchmark_name, price, unit, price_date, period_type,
   source_url, source_document, ingestion_method, confidence, notes)
VALUES
  -- ── Steel ────────────────────────────────────────────────────────────
  ('steel_hms_1_2_8020', 'GLOBAL', 'argus', 'HMS 1&2 80:20 CFR Turkey',
   385, 'USD/t', '2026-05-01', 'monthly',
   'https://www.argusmedia.com/en/metals',
   'Migration 042 v2 seed · SteelOrbis / Argus May 2026 — recent deals at $369-404',
   'manual', 'medium',
   'Global benchmark. Recent range $369-404/t; midpoint ~$385.'),

  ('steel_hms_1_2_8020', 'EU',     'eurofer', 'HMS 1&2 EU domestic',
   355, 'USD/t', '2026-05-01', 'monthly',
   'https://www.eurofer.eu',
   'Migration 042 v2 seed · EUROFER market commentary May 2026',
   'manual', 'medium',
   'EU domestic typically discounts to CFR Turkey by ~5-8%.'),

  ('steel_hms_1_2_8020', 'US',     'amm_fastmarkets', 'HMS 1&2 US Midwest #1 Heavy Melt',
   380, 'USD/t', '2026-05-01', 'monthly',
   'https://www.fastmarkets.com',
   'Migration 042 v2 seed · AMM IRSI Composite May 2026',
   'manual', 'medium',
   'US Midwest mill delivered.'),

  ('steel_shred',        'US',     'amm_fastmarkets', 'Shredded auto/structural US Midwest',
   400, 'USD/t', '2026-05-01', 'monthly',
   'https://www.fastmarkets.com',
   'Migration 042 v2 seed · AMM IRSI Composite May 2026',
   'manual', 'medium',
   'Higher grade than HMS; clean shred from BESS racking and similar.'),

  ('cast_iron_general',  'EU',     'bcmr', 'Cast iron borings + lump (composite)',
   265, 'USD/t', '2026-05-01', 'monthly',
   'https://www.recyclemetals.org',
   'Migration 042 v2 seed · BCMR + ~70% of HMS structural ratio',
   'manual', 'medium',
   'Cast iron from turbine hubs typically clears at ~70% of HMS due to lower mill grade.'),

  ('cast_iron_general',  'US',     'amm_fastmarkets', 'Cast iron heavy (composite)',
   265, 'USD/t', '2026-05-01', 'monthly',
   'https://iscrapapp.com',
   'Migration 042 v2 seed · iScrapApp/Rockaway US national composite May 2026 (~$0.11-0.13/lb)',
   'manual', 'medium',
   'iScrapApp national composite ~$0.11/lb = $242/t; competitive yards $0.13/lb = $286/t. Midpoint $265.'),

  -- ── Copper ───────────────────────────────────────────────────────────
  ('copper_no_1',        'US',     'amm_fastmarkets', 'Copper No.1 bare bright',
   11000, 'USD/t', '2026-05-01', 'monthly',
   'https://iscrapapp.com',
   'Migration 042 v2 seed · ScrapMonster/iScrapApp US composite May 2026 (~$4.95-5.10/lb)',
   'manual', 'medium',
   'Cleanest grade; applies to BESS battery foil, stripped generator winding.'),

  ('copper_no_2',        'US',     'amm_fastmarkets', 'Copper No.2 birch/cliff',
   9500, 'USD/t', '2026-05-01', 'monthly',
   'https://iscrapapp.com',
   'Migration 042 v2 seed · iScrapApp US composite May 2026',
   'manual', 'medium',
   'Mixed gauge insulated cable; wind generator cabling, solar ribbons.'),

  ('copper_no_2',        'EU',     'argus', 'Copper No.2 EU CFR',
   9300, 'USD/t', '2026-05-01', 'monthly',
   'https://www.argusmedia.com/en/metals',
   'Migration 042 v2 seed · Argus Metals May 2026',
   'manual', 'medium', NULL),

  -- ── Aluminium scrap (LME primary itself ~$3,540 in May 2026) ─────────
  ('aluminium_taint_tabor','US',   'amm_fastmarkets', 'Aluminium taint/tabor (mixed clean)',
   2650, 'USD/t', '2026-05-01', 'monthly',
   'https://www.fastmarkets.com',
   'Migration 042 v2 seed · AMM May 2026 — ~75% of LME primary',
   'manual', 'medium',
   'Wind nacelle cabling, solar frame typical grade.'),

  ('aluminium_twitch',   'US',     'amm_fastmarkets', 'Aluminium twitch (clean)',
   3000, 'USD/t', '2026-05-01', 'monthly',
   'https://www.fastmarkets.com',
   'Migration 042 v2 seed · AMM May 2026 — ~85% of LME primary',
   'manual', 'medium',
   'Cleaner grade — BESS cathode foil typical grade.'),

  -- ── Solar PV materials ───────────────────────────────────────────────
  ('silicon_solar',      'CN',     'argus', 'Polysilicon mono-grade CN spot (OPIS)',
   5000, 'USD/t', '2026-04-25', 'weekly',
   'https://www.pv-magazine.com',
   'Migration 042 v2 seed · OPIS / PV Magazine April 2026 — China Mono Premium CNY 34.07/kg = $4.99/kg',
   'manual', 'high',
   'Polysilicon collapsed further from $6.5k Dec 2024 to ~$5k. Chinese oversupply persists.'),

  ('silicon_solar',      'GLOBAL', 'argus', 'Polysilicon Global Marker (non-China, OPIS)',
   18700, 'USD/t', '2026-01-13', 'weekly',
   'https://www.pv-magazine.com',
   'Migration 042 v2 seed · OPIS Global Polysilicon Marker Jan 2026 ($18.728/kg)',
   'manual', 'high',
   'Non-China premium reflects US Section 232 / FEOC compliance buyers paying for traceable supply.'),

  ('silver_solar_grade', 'GLOBAL', 'lme',   'LBMA silver spot',
   2481, 'USD/kg', '2026-05-06', 'spot',
   'https://tradingeconomics.com/commodity/silver',
   'Migration 042 v2 seed · LBMA / Trading Economics May 2026 ($77.18/oz × 32.15 oz/kg)',
   'manual', 'high',
   'Silver bull market — up ~147% from Dec 2024 ($1,005/kg). Solar metallisation tracks LBMA directly.'),

  ('glass_pv_cullet',    'EU',     'recycling_today', 'PV glass cullet (recovered)',
   60, 'USD/t', '2026-04-30', 'monthly',
   NULL,
   'Migration 042 v2 seed · Recycling International — low-value commodity, structural',
   'manual', 'low',
   'Low-value commodity; many EU recycling routes still net-cost for recyclers.'),

  -- ── Battery / critical metals ────────────────────────────────────────
  ('lithium_carbonate',  'CN',     'argus', 'Lithium carbonate battery-grade CN spot',
   24000, 'USD/t', '2026-04-30', 'monthly',
   'https://www.argusmedia.com',
   'Migration 042 v2 seed · Argus Battery Brief / Trading Economics April 2026 (CNY 175k/t)',
   'manual', 'high',
   'MASSIVE rebound. CNY 175,000/t late April 2026 = ~$24k USD; +122% from Dec 2024 trough. Driver: data centre + EV demand surge.'),

  ('cobalt_metal',       'GLOBAL', 'lme',   'LME cobalt settlement',
   56000, 'USD/t', '2026-05-05', 'spot',
   'https://www.lme.com/metals/ev/lme-cobalt',
   'Migration 042 v2 seed · LME via Trading Economics May 5 2026 ($56,290/t)',
   'manual', 'high',
   'More than doubled vs Dec 2024 ($24k/t). Drivers: DRC export curbs, supply discipline.'),

  ('nickel_class_1',     'GLOBAL', 'lme',   'LME nickel settlement',
   19650, 'USD/t', '2026-05-06', 'spot',
   'https://www.lme.com/metals/non-ferrous/lme-nickel',
   'Migration 042 v2 seed · LME via Trading Economics May 6 2026 ($19,652/t)',
   'manual', 'high',
   '+27% YoY. Drivers: Indonesia quota cuts; sulfur shortage from Strait of Hormuz disruption.'),

  ('manganese_ore',      'GLOBAL', 'world_bank_pink_sheet', 'Manganese ore 44% Mn CIF China',
   4.85, 'USD/t', '2026-04-30', 'monthly',
   'https://www.fastmarkets.com',
   'Migration 042 v2 seed · Eramet/UMK/CMG offer prices April 2026 ($4.45-5.40/dmtu, midpoint $4.85)',
   'manual', 'medium',
   'Per dmtu (dry metric tonne unit). Fastmarkets index range $4.45-5.40 across origins April 2026.'),

  ('graphite_synthetic', 'CN',     'argus', 'Synthetic graphite anode-grade CN',
   2700, 'USD/t', '2026-04-30', 'monthly',
   'https://www.argusmedia.com',
   'Migration 042 v2 seed · Argus Battery Brief April 2026',
   'manual', 'medium',
   'Down from $3,200 Dec 2024. China oversupply; market expects -38% from 2022 peak by 2026.'),

  -- ── Composites / specialty ──────────────────────────────────────────
  ('composite_blade_glass_fibre', 'EU', 'eurofer', 'GFRP wind blade — disposal cost',
   -200, 'USD/t', '2026-04-30', 'annual',
   'https://windeurope.org',
   'Migration 042 v2 seed · WindEurope Blade Decommissioning Roadmap update + EU landfill ban tightening',
   'manual', 'medium',
   'NEGATIVE price — asset owner PAYS to dispose. ~€150-250/t typical landfill / co-processing fee. Worsened from -$150 to -$200/t as EU landfill bans tighten.'),

  ('rare_earth_neodymium','CN',    'argus', 'Neodymium metal CN domestic',
   244900, 'USD/t', '2026-05-04', 'monthly',
   'https://strategicmetalsinvest.com/neodymium-prices/',
   'Migration 042 v2 seed · Strategic Metals Invest / Trading Economics May 4 2026 ($244.90/kg)',
   'manual', 'high',
   '+240% from Dec 2024 ($72k/t). MASSIVE 2026 surge driven by China rare-earth supply tightening + EV/wind PMG demand. Specialty market.'),

  -- ── LME refined (for basis comparison in Historical Prices panel) ────
  ('copper_no_1',         'GLOBAL','lme',   'LME copper grade A settlement',
   13000, 'USD/t', '2026-05-06', 'spot',
   'https://www.lme.com/metals/non-ferrous/lme-copper',
   'Migration 042 v2 seed · LME via Trading Economics May 6 2026 ($5.85-6.04/lb)',
   'manual', 'high',
   'LME refined copper benchmark. Use for basis analysis vs scrap grades.'),

  ('aluminium_twitch',    'GLOBAL','lme',   'LME aluminium primary settlement',
   3540, 'USD/t', '2026-05-06', 'spot',
   'https://www.lme.com/metals/non-ferrous/lme-aluminium',
   'Migration 042 v2 seed · LME via Trading Economics May 6 2026',
   'manual', 'high',
   'LME primary aluminium near 4-year high; Strait of Hormuz supply disruption.');

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_042_scrap_price_v2_seed_may_2026', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM scrap_price_benchmarks WHERE source_document LIKE 'Migration 042 v2 seed%'),
  'Web-search verified from LME / Trading Economics / iScrapApp / Argus / PV Magazine / Strategic Metals Invest May 2026',
  'Migration 042 — May 2026 spot prices replace Migration 041 v1 (Dec 2024). Big shifts: Li carb +122%, cobalt +133%, silver +147%, neodymium +240%; polysilicon -23%, graphite -16%.'
);
