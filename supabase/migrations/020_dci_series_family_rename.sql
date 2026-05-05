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
-- UK is folded into Europe (no separate uk_wind series). The legacy
-- 'uk_wind' and 'eu_exuk_wind' enum values are dropped from active use
-- (Postgres can't drop enum values cleanly without recreating the type;
-- we leave them dangling but no rows reference them after this migration).
--
-- Existing data:
--   europe_wind  → renamed to dci_wind_europe
--   us_wind      → renamed to dci_wind_north_america
--   uk_wind      → DELETED (folded into europe series)
--   eu_exuk_wind → DELETED (was always empty)
--
-- Solar publications: enum values added but no rows seeded yet (full solar
-- DCI methodology is Phase 2 — different gross cost components, panel-mass
-- scaling, silver-driven recovery).

-- ── Step 1: add new enum values ─────────────────────────────────────────────
ALTER TYPE dci_series ADD VALUE IF NOT EXISTS 'dci_wind_europe';
ALTER TYPE dci_series ADD VALUE IF NOT EXISTS 'dci_wind_north_america';
ALTER TYPE dci_series ADD VALUE IF NOT EXISTS 'dci_solar_europe';
ALTER TYPE dci_series ADD VALUE IF NOT EXISTS 'dci_solar_north_america';
ALTER TYPE dci_series ADD VALUE IF NOT EXISTS 'dci_solar_japan';

-- ── Step 2: drop the unique constraint temporarily so we can update rows ────
-- (we need to rename publications without conflict)
-- Actually: UPDATE works fine because (series, publication_date) is unique
-- and we're only changing series, not date. No conflict possible.

-- ── Step 3: migrate existing rows ───────────────────────────────────────────
UPDATE dci_publications SET series = 'dci_wind_europe'
  WHERE series = 'europe_wind';

UPDATE dci_publications SET series = 'dci_wind_north_america'
  WHERE series = 'us_wind';

-- Drop UK rows entirely — UK is no longer a separate series, it's folded into Europe
DELETE FROM dci_publications WHERE series = 'uk_wind';
DELETE FROM dci_publications WHERE series = 'eu_exuk_wind';

-- ── Step 4: telemetry ──────────────────────────────────────────────────────
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_020_series_rename', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM dci_publications),
  'Endenex DCI Methodology v1.1 (series family rename)',
  'Migration 020 — renamed europe_wind→dci_wind_europe, us_wind→dci_wind_north_america; ' ||
  'deleted uk_wind/eu_exuk_wind series (UK folded into Europe); ' ||
  'added solar enum values for Phase 2 (no rows seeded yet)'
);
