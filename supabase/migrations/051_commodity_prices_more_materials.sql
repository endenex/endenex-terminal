-- Migration 051 — Extend commodity_prices.material_type allowed values
--
-- Migration 005 originally limited material_type to a small set
-- (steel_hms1/2/cast_iron/stainless, copper, aluminium, rare_earth).
-- The Historical Prices & Basis panel now backfills nickel, silver, lead,
-- zinc, tin from World Bank Pink Sheet — adding them to the constraint.

ALTER TABLE commodity_prices
  DROP CONSTRAINT IF EXISTS commodity_prices_material_type_check;

ALTER TABLE commodity_prices
  ADD  CONSTRAINT commodity_prices_material_type_check
  CHECK (material_type IN (
    -- Original ferrous + base metals
    'steel_hms1', 'steel_hms2', 'steel_cast_iron', 'steel_stainless',
    'copper', 'aluminium', 'zinc', 'rare_earth',
    -- Added Migration 051: extra LME / WB Pink Sheet metals for the
    -- Historical Prices & Basis chart
    'nickel', 'silver', 'lead', 'tin', 'iron_ore', 'cobalt'
  ));

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_051_commodity_prices_more_materials', 'success', NOW(), NOW(),
  0,
  'Schema-only',
  'Migration 051 — extended commodity_prices.material_type to allow nickel/silver/lead/tin/iron_ore/cobalt for chart backfill.'
);
