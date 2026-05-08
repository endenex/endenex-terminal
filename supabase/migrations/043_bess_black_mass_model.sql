-- Migration 043 — BESS: collapse cell-internal materials into black mass
--
-- The current model lists Li / Co / Ni / Mn / graphite / electrolyte /
-- separator as independent scrap rows for BESS packs. That's analytically
-- correct for "what's in the cell" but COMMERCIALLY wrong: those materials
-- are locked inside the cell until a hydrometallurgical recycler buys
-- BLACK MASS (the powder produced by shredding cells after pre-treatment)
-- and extracts metals downstream.
--
-- The asset owner's cash event is at the BLACK MASS GATE. They sell:
--
--   1. Steel scrap            (casing/racking)         — separated upstream
--   2. Copper foil             (anode current collector) — separated upstream
--   3. Aluminium foil          (cathode current collector) — separated upstream
--   4. BLACK MASS              (everything else)       — single price by chemistry
--
-- This migration:
--   • Adds black_mass_nmc and black_mass_lfp to scrap_price_benchmarks enum
--   • Seeds May 2026 black mass prices (Benchmark Minerals / Fastmarkets)
--   • Replaces the granular cell-internal rows in material_intensities with
--     a single 'black_mass' aggregate row per chemistry, scrap_grade
--     pointing to black_mass_<chem>
--   • Keeps steel/Cu foil/Al foil rows untouched (they're separately traded)
--
-- Black mass mass-yields per MWh derived from the prior granular seeds
-- by summing cathode + anode + binder + electrolyte + separator.

-- ── (1) Extend scrap_price_benchmarks enum with black mass grades ───────

ALTER TABLE scrap_price_benchmarks
  DROP CONSTRAINT IF EXISTS scrap_price_benchmarks_material_check;

ALTER TABLE scrap_price_benchmarks
  ADD  CONSTRAINT scrap_price_benchmarks_material_check
  CHECK (material IN (
    -- Steel
    'steel_hms_1','steel_hms_2','steel_hms_1_2_8020',
    'steel_busheling','steel_shred',
    'cast_iron_general',
    -- Copper
    'copper_no_1','copper_no_2','copper_birch_cliff',
    -- Aluminium
    'aluminium_taint_tabor','aluminium_zorba','aluminium_twitch',
    'aluminium_tense','aluminium_alloy_356',
    -- Solar PV
    'silicon_solar','silver_solar_grade','glass_pv_cullet',
    -- Battery (kept for refined inputs / hydromet downstream visibility,
    -- but BESS asset-owner sales now go via black_mass_*)
    'lithium_carbonate','lithium_hydroxide',
    'cobalt_metal','nickel_class_1','manganese_ore',
    'graphite_synthetic','rare_earth_neodymium',
    -- BLACK MASS (NEW — what the BESS asset owner actually sells) ─────
    'black_mass_nmc','black_mass_lfp','black_mass_nca',
    -- Composites
    'composite_blade_glass_fibre','composite_blade_carbon_fibre'
  ));

-- ── (2) Seed May 2026 black mass prices ─────────────────────────────────

INSERT INTO scrap_price_benchmarks
  (material, region, publisher, benchmark_name, price, unit, price_date, period_type,
   source_url, source_document, ingestion_method, confidence, notes)
VALUES
  ('black_mass_nmc', 'CN', 'argus', 'NMC black mass CN spot (NCM523 grade indicative)',
   8000, 'USD/t', '2026-04-30', 'monthly',
   'https://source.benchmarkminerals.com/article/runaway-rally-before-stabilisation-black-mass-q1-2026-price-review',
   'Migration 043 v1 seed · Benchmark Minerals Q1 2026 Black Mass Price Review',
   'manual', 'medium',
   'Q1 2026 saw runaway rally then stabilisation. Cobalt at $56k/t May 2026 pushes NMC payables higher. NCM523 was $6.37/kg April 2025; with current Co/Ni levels ~$8k/t midpoint.'),

  ('black_mass_nmc', 'GLOBAL', 'amm_fastmarkets', 'NMC black mass CIF Asia (composite)',
   8200, 'USD/t', '2026-04-30', 'monthly',
   'https://www.fastmarkets.com/metals-and-mining/black-mass-prices/',
   'Migration 043 v1 seed · Fastmarkets Black Mass Index April 2026',
   'manual', 'medium',
   'Asian recyclers reportedly paused buying briefly on uncompetitive pricing; midpoint ~$8.2k/t.'),

  ('black_mass_lfp', 'CN', 'argus', 'LFP black mass CN spot',
   1800, 'USD/t', '2026-04-30', 'monthly',
   'https://www.fastmarkets.com/insights/lfp-black-mass-and-battery-scrap-prices-surge-in-china/',
   'Migration 043 v1 seed · Fastmarkets LFP Black Mass / Mysteel China Daily April 2026',
   'manual', 'medium',
   'Late 2025 China: 9,500-10,000 yuan/t (~$1,400/t). With Li carb rebound to $24k/t, LFP black mass uplifted to ~$1,800/t. Per-% lithium pricing: ~3,000 yuan/% Li.'),

  ('black_mass_lfp', 'EU', 'eurofer', 'LFP black mass EU — gate fee zone',
   -3500, 'USD/t', '2026-04-30', 'annual',
   'https://www.fastmarkets.com/insights/european-lfp-recycling-vital-for-future-but-facing-economic-barriers-lme-week/',
   'Migration 043 v1 seed · Fastmarkets EU LFP recycling commentary',
   'manual', 'low',
   'NEGATIVE — many EU recyclers charge gate fees of €3-4k/t (~$3,500/t) for LFP because contained value insufficient to cover hydromet costs. Asset owner pays.'),

  ('black_mass_nca', 'GLOBAL', 'amm_fastmarkets', 'NCA black mass (Tesla-style EV) CIF Asia',
   9500, 'USD/t', '2026-04-30', 'monthly',
   'https://www.fastmarkets.com/metals-and-mining/black-mass-prices/',
   'Migration 043 v1 seed · Fastmarkets — NCA premium for higher Ni/Co payables',
   'manual', 'medium',
   'NCA black mass typically prices above NMC due to higher Ni content; ~$9-10k/t typical 2026.');

-- ── (3) Drop granular cell-internal rows for BESS chemistries ───────────
--
-- These materials are inside the cell — they end up in black mass and are
-- NOT separately tradable by the asset owner. Drop them so the calculator
-- shows only what's actually traded.

DELETE FROM material_intensities
 WHERE material IN (
   'lithium_carbonate_eq', 'iron_phosphate', 'nickel', 'cobalt', 'manganese',
   'graphite', 'electrolyte_lipf6', 'plastic_separator'
 )
   AND oem_model_id IN (SELECT id FROM oem_models WHERE asset_class = 'bess');

-- ── (4) Insert aggregate black-mass rows per BESS chemistry ─────────────
--
-- Mass yield = sum of all cell-internal materials from the prior granular
-- seeds (cathode actives + anode + binder + electrolyte + separator).
-- Recoverability_pct ≈ 95% of cell mass enters saleable black mass after
-- pre-treatment (small losses in shredding + magnetic separation).

CREATE OR REPLACE FUNCTION _oem_id(p_class text, p_mfr text, p_model text)
RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT id FROM oem_models
   WHERE asset_class = p_class AND manufacturer = p_mfr AND model_name = p_model
   LIMIT 1
$$;

INSERT INTO material_intensities
  (oem_model_id, material, material_subclass, scrap_grade,
   intensity_value, intensity_unit, recoverability_pct, recoverability_basis,
   source_publication, source_year, confidence, notes)
VALUES
  -- LFP grid pack: 90 (Li) + 240 (FePO4) + 110 (graphite) + 100 (electrolyte) + 50 (separator) = 590 kg/MWh
  (_oem_id('bess','Generic','LFP grid pack'),
   'black_mass', 'cell_active_materials', 'black_mass_lfp',
   590, 'kg/MWh', 95, 'industry_avg',
   'Derived: sum of cathode + anode + electrolyte + separator (Argonne GREET 2022 + BNEF 2024)',
   2024, 'high',
   'Black mass yield after pre-treatment (casing + Cu/Al foils removed). LFP black mass commands the lowest scrap value of all chemistries — sometimes negative in EU.'),

  -- NMC 622 grid pack: 110 (Li) + 320 (Ni) + 100 (Co) + 95 (Mn) + 95 (graphite) + 90 (electrolyte) + 50 (separator est) = 760 kg/MWh
  (_oem_id('bess','Generic','NMC 622 grid pack'),
   'black_mass', 'cell_active_materials', 'black_mass_nmc',
   760, 'kg/MWh', 95, 'observed_demolition',
   'Derived: sum of cathode + anode + electrolyte + separator (BNEF 2024)',
   2024, 'high',
   'Black mass yield after pre-treatment. High Ni + Co content means strong payables from hydromet recyclers.'),

  -- NMC 811 EV pack: 95 (Li) + 420 (Ni) + 55 (Co) + 55 (Mn) + 85 (graphite) + 85 (electrolyte) + 50 (separator est) = 845 kg/MWh
  (_oem_id('bess','Generic','NMC 811 EV pack'),
   'black_mass', 'cell_active_materials', 'black_mass_nmc',
   845, 'kg/MWh', 95, 'observed_demolition',
   'Derived: sum of cathode + anode + electrolyte + separator (BNEF 2024)',
   2024, 'high',
   'Higher density EV pack. Prices as NMC black mass; lower Co fraction vs 622 but offset by higher Ni (~75%).');

DROP FUNCTION IF EXISTS _oem_id(text, text, text);

-- ── (5) Telemetry ───────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_043_bess_black_mass_model', 'success', NOW(), NOW(),
  3,
  'Benchmark Minerals Q1 2026 Black Mass Review · Fastmarkets LFP/NMC indices · BNEF 2024 derived yields',
  'Migration 043 — BESS material model collapsed: cell-internal materials → single black mass row per chemistry. Asset owner sees: steel casing + Cu foil + Al foil + black mass (priced by chemistry). NMC ~$8k/t, LFP ~$1.8k/t (CN) / -$3.5k/t (EU gate fee).'
);
