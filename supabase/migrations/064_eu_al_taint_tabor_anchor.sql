-- Migration 064 — Aluminium taint/tabor EU anchor
--
-- Adds an EU anchor for aluminium taint/tabor so the weekly + backfill jobs
-- can populate genuine EU Al scrap history (via FRED WPU102302 modelling
-- in weekly_scrap_price_update.py / backfill_scrap_price_history.py).
-- Without this anchor, those scripts skip aluminium_taint_tabor/EU.
--
-- Price reference: ~$2,450/t (EU continental May 2026 indicative; tracks
-- ~7-10% below US due to lower freight and different scrap-mix premium).

INSERT INTO scrap_price_benchmarks
  (material, region, publisher, benchmark_name, price, unit, price_date,
   period_type, source_url, ingestion_method, confidence, notes)
VALUES
  ('aluminium_taint_tabor', 'EU', 'amm_fastmarkets',
   'Aluminium taint/tabor EU continental',
   2450, 'USD/t', '2026-05-01', 'monthly',
   'https://www.fastmarkets.com/metals-and-mining/scrap-and-secondary/',
   'manual', 'medium',
   'EU continental Al taint/tabor anchor — May 2026 indicative ($2,450/t). Tracks ~7-10% below US benchmark due to lower freight and different scrap-mix premium.')
ON CONFLICT (material, region, publisher, benchmark_name, price_date, period_type)
  DO NOTHING;

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_064_eu_al_taint_tabor_anchor', 'success', NOW(), NOW(),
  1,
  'Manual editorial anchor',
  'Migration 064 — added EU anchor for aluminium_taint_tabor at $2,450/t. Run backfill_scrap_price_history.py after this to populate FRED-modelled monthly history for Aluminium · Europe.'
);
