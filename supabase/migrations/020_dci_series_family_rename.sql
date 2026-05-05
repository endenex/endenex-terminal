-- Migration 020 — DCI series family rename + solar series scaffolding
--
-- Aligns the dci_series enum to the official Endenex index family:
--
--   dci_wind_europe          (EUR)   covers EU + UK
--   dci_wind_north_america   (USD)   covers US + CA
--   dci_solar_europe         (EUR)   covers EU + UK         — Phase 2
--   dci_solar_north_america  (USD)   covers US + CA         — Phase 2
--   dci_solar_japan          (JPY)   Japan only             — Phase 2
--
-- UK is folded into Europe (no separate uk_wind series).
--
-- Approach:
--   1. RENAME existing enum values in-place (auto-updates every dependent row,
--      no separate UPDATE needed, no transaction restriction).
--   2. DELETE legacy uk_wind / eu_exuk_wind publication rows.
--   3. ADD the 5 solar enum values for future use.

-- ── Step 1: rename existing wind enum values (in-place, atomic) ─────────────
-- ALTER TYPE ... RENAME VALUE auto-updates every row using the old value.
ALTER TYPE dci_series RENAME VALUE 'europe_wind' TO 'dci_wind_europe';
ALTER TYPE dci_series RENAME VALUE 'us_wind'     TO 'dci_wind_north_america';

-- ── Step 2: delete legacy series rows (UK + EU-ex-UK) ───────────────────────
-- Both reference the original enum names (still exist in the type).
DELETE FROM dci_publications WHERE series = 'uk_wind';
DELETE FROM dci_publications WHERE series = 'eu_exuk_wind';

-- ── Step 3: add the 5 solar enum values for Phase 2 ────────────────────────
-- These are added but not used in this migration — Phase 2 work will populate
-- dci_publications rows for them.
ALTER TYPE dci_series ADD VALUE IF NOT EXISTS 'dci_solar_europe';
ALTER TYPE dci_series ADD VALUE IF NOT EXISTS 'dci_solar_north_america';
ALTER TYPE dci_series ADD VALUE IF NOT EXISTS 'dci_solar_japan';

-- ── Telemetry ──────────────────────────────────────────────────────────────
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_020_series_rename', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM dci_publications),
  'Endenex DCI Methodology v1.1 (series family rename)',
  'Migration 020 — RENAME europe_wind→dci_wind_europe, us_wind→dci_wind_north_america; ' ||
  'deleted uk_wind/eu_exuk_wind series (UK folded into Europe); ' ||
  'added solar enum values for Phase 2 (no rows seeded yet)'
);
