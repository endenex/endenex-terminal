-- Migration 019 — Add 'zinc' to material_type CHECK constraints
--
-- The original v005 schema only enumerated 7 materials in the CHECK constraint
-- on commodity_prices, turbine_material_profiles, merchant_markups, and
-- nro_estimates. Adding 'zinc' so the daily LME scrap-price fetcher can write
-- zinc rows alongside copper and aluminium.
--
-- (wind_material_intensities from migration 013 already includes zinc.)

-- ── commodity_prices ────────────────────────────────────────────────────────
ALTER TABLE commodity_prices
  DROP CONSTRAINT IF EXISTS commodity_prices_material_type_check;

ALTER TABLE commodity_prices
  ADD CONSTRAINT commodity_prices_material_type_check
  CHECK (material_type IN (
    'steel_hms1','steel_hms2','steel_cast_iron','steel_stainless',
    'copper','aluminium','zinc','rare_earth'
  ));

-- ── nro_estimates ───────────────────────────────────────────────────────────
ALTER TABLE nro_estimates
  DROP CONSTRAINT IF EXISTS nro_estimates_material_type_check;

ALTER TABLE nro_estimates
  ADD CONSTRAINT nro_estimates_material_type_check
  CHECK (material_type IN (
    'steel_hms1','steel_hms2','steel_cast_iron','steel_stainless',
    'copper','aluminium','zinc','rare_earth'
  ));

-- ── merchant_markups ────────────────────────────────────────────────────────
ALTER TABLE merchant_markups
  DROP CONSTRAINT IF EXISTS merchant_markups_material_type_check;

ALTER TABLE merchant_markups
  ADD CONSTRAINT merchant_markups_material_type_check
  CHECK (material_type IN (
    'steel_hms1','steel_hms2','steel_cast_iron','steel_stainless',
    'copper','aluminium','zinc','rare_earth'
  ));

-- ── turbine_material_profiles ──────────────────────────────────────────────
ALTER TABLE turbine_material_profiles
  DROP CONSTRAINT IF EXISTS turbine_material_profiles_material_type_check;

ALTER TABLE turbine_material_profiles
  ADD CONSTRAINT turbine_material_profiles_material_type_check
  CHECK (material_type IN (
    'steel_hms1','steel_hms2','steel_cast_iron','steel_stainless',
    'copper','aluminium','zinc','rare_earth'
  ));

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_019', 'success', NOW(), NOW(),
  4, 'Schema migration',
  'Migration 019 — added zinc to material_type CHECK across 4 tables'
);
