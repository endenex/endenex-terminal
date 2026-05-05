-- Migration 012 — Scrap-basis re-labelling
--
-- Per Endenex methodology §2 and §15: every price in every tool reflects
-- scrap-condition assessed prices, NOT LME or COMEX primary-metal benchmarks.
-- Operators decommissioning assets do not realise LME — they sell to scrap
-- merchants who apply contamination discounts, sorting costs, and buyer margin.
--
-- This migration:
--   1. Adds is_scrap_basis flag to commodity_prices (defaults TRUE)
--   2. Re-labels existing source_name values from "LME" / "COMEX" to the
--      correct scrap publishers (Argus UK, Argus EEA, AMM US)
--   3. Records the relabelling in ingestion_runs

-- ── Add scrap-basis flag ────────────────────────────────────────────────────
ALTER TABLE commodity_prices
  ADD COLUMN IF NOT EXISTS is_scrap_basis BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS publisher_grade TEXT;

COMMENT ON COLUMN commodity_prices.is_scrap_basis IS
  'TRUE if price is scrap-assessed (Argus/AMM/Fastmarkets). FALSE only if LME/COMEX primary-metal benchmark. Operators realise scrap, never LME.';

COMMENT ON COLUMN commodity_prices.publisher_grade IS
  'Reference grade as published, e.g. "HMS 1&2", "ISRI Grade 200 (Birch/Cliff)", "old cast/mixed", "E3 Germany delivered mill".';

-- ── Re-label copper to Argus / AMM scrap-assessed ───────────────────────────
UPDATE commodity_prices
SET source_name     = 'Argus Scrap Markets — UK Copper No.2',
    publisher_grade = 'No.2 scrap (~70-75% of LME)',
    is_scrap_basis  = TRUE
WHERE material_type = 'copper' AND region = 'GB';

UPDATE commodity_prices
SET source_name     = 'Argus Scrap Markets — EEA Copper Heavy/Cable',
    publisher_grade = 'Heavy/cable scrap (~70-75% of LME)',
    is_scrap_basis  = TRUE
WHERE material_type = 'copper' AND region = 'EU';

UPDATE commodity_prices
SET source_name     = 'AMM US Copper No.2 (ISRI Grade 200)',
    publisher_grade = 'ISRI Grade 200 Birch/Cliff (~82-87% of COMEX)',
    is_scrap_basis  = TRUE
WHERE material_type = 'copper' AND region = 'US';

-- ── Re-label aluminium to Argus / AMM scrap-assessed ────────────────────────
UPDATE commodity_prices
SET source_name     = 'Argus Scrap Markets — UK Aluminium Old Cast',
    publisher_grade = 'Old cast/mixed (~60-65% of LME)',
    is_scrap_basis  = TRUE
WHERE material_type = 'aluminium' AND region = 'GB';

UPDATE commodity_prices
SET source_name     = 'Argus Scrap Markets — EEA Aluminium Old Cast',
    publisher_grade = 'Old cast/mixed (~65-70% of LME)',
    is_scrap_basis  = TRUE
WHERE material_type = 'aluminium' AND region = 'EU';

UPDATE commodity_prices
SET source_name     = 'AMM Midwest Aluminium Shredded',
    publisher_grade = 'Midwest shredded dealer (~75-80% of LME)',
    is_scrap_basis  = TRUE
WHERE material_type = 'aluminium' AND region = 'US';

-- ── Re-label HMS1/HMS2 ferrous scrap with the right publishers ──────────────
UPDATE commodity_prices
SET source_name     = 'Argus UK Ferrous Scrap Index (MB-STE-0077)',
    publisher_grade = 'HMS 1&2'
WHERE material_type = 'steel_hms1' AND region = 'GB';

UPDATE commodity_prices
SET source_name     = 'Argus UK Ferrous Scrap Index (MB-STE-0077)',
    publisher_grade = 'HMS 2'
WHERE material_type = 'steel_hms2' AND region = 'GB';

UPDATE commodity_prices
SET source_name     = 'Fastmarkets MB-STE-0169 — E3 Germany Delivered Mill',
    publisher_grade = 'E3 Germany delivered mill'
WHERE material_type = 'steel_hms1' AND region = 'EU';

UPDATE commodity_prices
SET source_name     = 'Fastmarkets MB-STE-0169 — E3 Germany Delivered Mill',
    publisher_grade = 'E3 Germany (HMS 2 grade)'
WHERE material_type = 'steel_hms2' AND region = 'EU';

UPDATE commodity_prices
SET source_name     = 'AMM Midwest Composite (HMS 1&2)',
    publisher_grade = 'AMM Midwest composite'
WHERE material_type = 'steel_hms1' AND region = 'US';

UPDATE commodity_prices
SET source_name     = 'AMM Midwest Composite (HMS 2)',
    publisher_grade = 'AMM Midwest HMS 2'
WHERE material_type = 'steel_hms2' AND region = 'US';

-- ── Cast iron — UK/EEA standard practice 30% discount to HMS, US AMM dealer ─
UPDATE commodity_prices
SET source_name     = 'UK Dealer Mid (30% discount to HMS, standard practice)',
    publisher_grade = 'Cast iron, dealer mid'
WHERE material_type = 'steel_cast_iron' AND region = 'GB';

UPDATE commodity_prices
SET source_name     = 'EEA Dealer Mid (30% discount to HMS, standard practice)',
    publisher_grade = 'Cast iron, dealer mid'
WHERE material_type = 'steel_cast_iron' AND region = 'EU';

UPDATE commodity_prices
SET source_name     = 'AMM US Cast Iron Dealer Composite',
    publisher_grade = 'AMM dealer composite'
WHERE material_type = 'steel_cast_iron' AND region = 'US';

-- ── Stainless ───────────────────────────────────────────────────────────────
UPDATE commodity_prices
SET source_name     = 'Argus / Fastmarkets EEA 304 Stainless',
    publisher_grade = '304 stainless scrap'
WHERE material_type = 'steel_stainless' AND region = 'EU';

UPDATE commodity_prices
SET source_name     = 'Argus UK 304 Stainless',
    publisher_grade = '304 stainless scrap'
WHERE material_type = 'steel_stainless' AND region = 'GB';

UPDATE commodity_prices
SET source_name     = 'AMM US 304 Stainless',
    publisher_grade = '304 stainless scrap'
WHERE material_type = 'steel_stainless' AND region = 'US';

-- ── Rare earth (NdPr oxide) — Fastmarkets / Argus, recovered specialist basis
UPDATE commodity_prices
SET source_name     = 'Fastmarkets NdPr Oxide — European Ex-Works (Specialist Recycler)',
    publisher_grade = 'NdPr oxide (Solvay/Less Common Metals indicative)',
    confidence      = 'Medium'
WHERE material_type = 'rare_earth' AND region IN ('EU','GB');

UPDATE commodity_prices
SET source_name     = 'Fastmarkets/OPIS NdPr Oxide — US Import Basis (incl. Section 301)',
    publisher_grade = 'NdPr oxide (US import basis)',
    confidence      = 'Medium'
WHERE material_type = 'rare_earth' AND region = 'US';

-- ── Telemetry ───────────────────────────────────────────────────────────────
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'commodity_relabel_scrap_basis', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM commodity_prices WHERE is_scrap_basis = TRUE),
  'Argus, AMM, Fastmarkets — scrap-assessed publishers',
  'Migration 012 — re-labelled all commodity_prices.source_name from LME/COMEX placeholders to correct scrap publishers per Endenex methodology §2, §15'
);
