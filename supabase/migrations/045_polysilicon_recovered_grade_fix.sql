-- Migration 045 — Polysilicon: replace primary spot with recovered-grade value
--
-- Migration 042 quoted PRIMARY polysilicon spot ($5k/t CN, $18.7k/t Ex-CN
-- via OPIS) which is the price a NEW solar wafer manufacturer pays for
-- virgin feedstock. That's not what asset owners get from end-of-life PV
-- panels — recovered PV silicon is heavily contaminated and either:
--
--   • Landfilled (most volume today), OR
--   • Sold at $500-1,500/t to specialty processors (ROSI Solar France,
--     Reiling Glas Germany) who try to recover wafer-grade Si, OR
--   • Used as low-value silica feedstock to cement / aluminium melts
--
-- The PV silicon stream is barely commercial. Most modern PV recycling
-- focuses on glass cullet + aluminium frames + copper ribbons; the cell
-- material is shredded and disposed.
--
-- This migration:
--   • Updates the existing two silicon_solar rows to recovered-grade values
--   • Adds clear notes explaining the primary-vs-recovered gap
--   • Leaves room to add primary spot back later (in a separate panel
--     for context) without polluting the Scrap Prices view

-- Drop both primary-spot rows
DELETE FROM scrap_price_benchmarks
 WHERE material = 'silicon_solar';

-- Insert a single recovered-grade row (EU specialty processor market)
INSERT INTO scrap_price_benchmarks
  (material, region, publisher, benchmark_name, price, unit, price_date, period_type,
   source_url, source_document, ingestion_method, confidence, notes)
VALUES
  ('silicon_solar', 'EU', 'recycling_today', 'Recovered PV silicon — specialty processor (ROSI / Reiling)',
   1200, 'USD/t', '2026-04-30', 'monthly',
   NULL,
   'Migration 045 v1 · ROSI Solar + Reiling Glas commentary; commercial PV recycling',
   'manual', 'low',
   'Recovered-grade only — what asset owners actually get. Primary polysilicon spot is $5k/t (CN) / $18.7k/t (Ex-CN) for NEW wafer manufacturers, but asset owners do NOT see those prices. Most PV silicon is landfilled or sold at $500-1,500/t to specialty processors (ROSI Solar France, Reiling Glas Germany). Commercial PV recycling rarely separates silicon today; the real PV scrap streams are glass cullet + aluminium frames + copper ribbons.');

-- Telemetry
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_045_polysilicon_recovered_grade_fix', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM scrap_price_benchmarks WHERE material = 'silicon_solar'),
  'ROSI Solar + Reiling Glas published cost-recovery commentary',
  'Migration 045 — replaced primary polysilicon spot with recovered-grade value (~$1,200/t). Primary spot is for new wafer mfrs, not asset owners.'
);
