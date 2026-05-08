-- Migration 046 — Neodymium: replace refined metal price with recovered magnet value
--
-- Same domain correction we made for polysilicon in Migration 045:
-- $244,900/t was the REFINED Nd metal spot (CN domestic) — the price that
-- magnet manufacturers and downstream refiners pay for separated neodymium.
-- Asset owners decommissioning a PMG wind turbine do NOT sell separated Nd
-- metal. They sell:
--
--   • Best case  — sorted magnet blocks to specialty recyclers (HyProMag UK,
--                  Noveon Magnetics US, REIA Germany): ~$30-50/kg
--                  = $30,000-50,000/t (≈ 12-20% of refined Nd price)
--   • Typical    — magnets bundled in copper-stream scrap at ~copper-No.2 rates
--   • Worst case — stockpiled or landfilled (no regional buyer)
--
-- The specialty-recycler market is real but small. We use the midpoint
-- ($40k/t) and flag it as low confidence because the recovery infrastructure
-- is nascent and prices vary widely by region and magnet condition.

-- Drop refined-metal row
DELETE FROM scrap_price_benchmarks
 WHERE material = 'rare_earth_neodymium';

-- Insert recovered-magnet row (sorted blocks to specialty recyclers)
INSERT INTO scrap_price_benchmarks
  (material, region, publisher, benchmark_name, price, unit, price_date, period_type,
   source_url, source_document, ingestion_method, confidence, notes)
VALUES
  ('rare_earth_neodymium', 'EU', 'recycling_today', 'Sorted NdFeB magnet blocks — specialty recycler',
   40000, 'USD/t', '2026-04-30', 'monthly',
   NULL,
   'Migration 046 v1 · HyProMag UK + Noveon Magnetics US + REIA Germany commentary',
   'manual', 'low',
   'Recovered-grade magnet blocks only — what asset owners actually get from sorted PMG turbine magnets. Refined Nd metal spot is ~$245k/t (CN domestic) for magnet manufacturers; asset owners receive ~12-20% of that ($30-50k/t) IF magnets are sorted and routed to a specialty recycler. Most magnets today end up in general copper scrap at ~copper-No.2 rates ($9-10k/t) or stockpiled. Recovery infrastructure remains nascent.');

-- Telemetry
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_046_neodymium_recovered_grade_fix', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM scrap_price_benchmarks WHERE material = 'rare_earth_neodymium'),
  'HyProMag UK / Noveon Magnetics / REIA published recycling rates',
  'Migration 046 — replaced refined Nd metal spot with recovered NdFeB magnet block value (~$40k/t). Refined market is for magnet mfrs not asset owners.'
);
