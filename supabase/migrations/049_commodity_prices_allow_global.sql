-- Migration 049 — Allow 'GLOBAL' region in commodity_prices
--
-- Migration 005 restricted commodity_prices.region to ('EU','GB','US') —
-- right for the original use case (regional scrap basis derived from LME).
-- The new backfill_lme_history.py script needs to insert canonical LME
-- refined-metal rows that aren't regional. Adding 'GLOBAL' to the
-- constraint so those land cleanly.

ALTER TABLE commodity_prices
  DROP CONSTRAINT IF EXISTS commodity_prices_region_check;

ALTER TABLE commodity_prices
  ADD  CONSTRAINT commodity_prices_region_check
  CHECK (region IN ('EU','GB','US','GLOBAL'));

-- Telemetry
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_049_commodity_prices_allow_global', 'success', NOW(), NOW(),
  0,
  'Schema-only',
  'Migration 049 — added GLOBAL to commodity_prices.region CHECK so LME refined backfill can land canonical (non-regional) rows.'
);
