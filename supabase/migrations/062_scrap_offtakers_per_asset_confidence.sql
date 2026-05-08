-- Migration 062 — Per-asset-class confidence ratings on scrap_offtakers
--
-- Replaces single wind_decom_confidence with three columns: one per asset
-- class (Wind / Solar / BESS). Panel will tab between them.
--
-- Asset-class scrap profile drivers:
--   • Wind  — bulk HMS structural steel + cast iron lots; port-side handling
--             matters for offshore; torch-cutting crews a plus.
--   • Solar — aluminium frames (taint/tabor) + Cu cabling. ~50-100 t/MW Al,
--             ~5-10 t/MW Cu. Mid-size lots, rural geographies.
--   • BESS  — black mass goes to specialty processors (separate module).
--             What scrap merchants see: steel casings, Cu busbars, Al cooling
--             plates. Tiny per-MWh volumes; almost any merchant can absorb.
--             HIGH reserved for proven battery-residual handlers.
--
-- Ratings: HIGH (capable + scaled + geography fit), MEDIUM (capable,
-- generic regional), LOW (sub-scale, wrong specialty, or weak geography).

-- ── Step 1: Schema additions ───────────────────────────────────────────

ALTER TABLE scrap_offtakers
  ADD COLUMN IF NOT EXISTS solar_decom_confidence text
    CHECK (solar_decom_confidence IN ('HIGH','MEDIUM','LOW'));
ALTER TABLE scrap_offtakers
  ADD COLUMN IF NOT EXISTS bess_decom_confidence text
    CHECK (bess_decom_confidence IN ('HIGH','MEDIUM','LOW'));
ALTER TABLE scrap_offtakers
  ADD COLUMN IF NOT EXISTS solar_decom_reason text;
ALTER TABLE scrap_offtakers
  ADD COLUMN IF NOT EXISTS bess_decom_reason text;

-- Rename wind_decom_confidence is unnecessary (it already serves Wind).

-- ── Step 2: Default everything to MEDIUM, then refine ─────────────────

UPDATE scrap_offtakers SET solar_decom_confidence = 'MEDIUM',
  solar_decom_reason = 'Capable regional merchant for Al taint/tabor + Cu cabling lots.'
 WHERE solar_decom_confidence IS NULL;

UPDATE scrap_offtakers SET bess_decom_confidence = 'MEDIUM',
  bess_decom_reason = 'Can absorb post-black-mass residuals (steel casings, Cu/Al busbars). Black mass routed separately to specialty processors.'
 WHERE bess_decom_confidence IS NULL;

-- ── Step 3: SOLAR — HIGH where multi-Mt with strong NF/Al capability ──

UPDATE scrap_offtakers SET solar_decom_confidence = 'HIGH',
  solar_decom_reason = 'Multi-Mt operator with established Al taint/tabor + Cu segregation; can absorb large solar farm Al frame lots.'
 WHERE name IN (
   'European Metal Recycling (EMR)',
   'TSR Recycling (Remondis)',
   'Stena Recycling',
   'Galloo',
   'Radius Recycling (ex-Schnitzer Steel)',
   'S Norton & Co',
   'HJHansen Recycling Group',
   'Derichebourg',
   'HKS Scrap Metals',
   'Kuusakoski'
 );

-- SOLAR — LOW where wrong specialty or sub-scale for Al frames
UPDATE scrap_offtakers SET solar_decom_confidence = 'LOW',
  solar_decom_reason = 'Waste-led operator; no dedicated Al frame processing route.'
 WHERE name IN ('Suez Recycling & Recovery', 'Veolia ES Recycling', 'Van Gansewinkel (Renewi)');

UPDATE scrap_offtakers SET solar_decom_confidence = 'LOW',
  solar_decom_reason = 'Wind-specialist marketing; scale and Al frame route unclear from primary sources.'
 WHERE name = 'Global Ardour Recycling';

UPDATE scrap_offtakers SET solar_decom_confidence = 'LOW',
  solar_decom_reason = 'Captive ferrous feed for Celsa mills; Al frame lots not core route.'
 WHERE name = 'Ferimet';

-- ── Step 4: BESS — HIGH for proven battery-residual handlers ──────────

UPDATE scrap_offtakers SET bess_decom_confidence = 'HIGH',
  bess_decom_reason = 'Kuusakoski Veitsiluoto (2025) has integrated battery line; handles BESS dismantling + residual scrap streams in one place.'
 WHERE name = 'Kuusakoski';

UPDATE scrap_offtakers SET bess_decom_confidence = 'HIGH',
  bess_decom_reason = 'Müller-Guttenbrunn Metran (Kematen) handles battery dismantling residuals; explicit ELV+battery focus.'
 WHERE name = 'Müller-Guttenbrunn (MGG)';

UPDATE scrap_offtakers SET bess_decom_confidence = 'HIGH',
  bess_decom_reason = 'Stena Recycling Battery Solutions (Halmstad) handles BESS dismantling + residual scrap.'
 WHERE name = 'Stena Recycling';

-- BESS — LOW for waste-led / wind-specialist / sub-scale Irish/Iberian
UPDATE scrap_offtakers SET bess_decom_confidence = 'LOW',
  bess_decom_reason = 'Waste-led; no dedicated battery residual handling route.'
 WHERE name IN ('Suez Recycling & Recovery', 'Veolia ES Recycling', 'Van Gansewinkel (Renewi)');

UPDATE scrap_offtakers SET bess_decom_confidence = 'LOW',
  bess_decom_reason = 'Wind/oil-and-gas decom specialist; battery residuals not core.'
 WHERE name IN ('John Lawrie Metals', 'Belson Steel Center Scrap', 'Global Ardour Recycling');

UPDATE scrap_offtakers SET bess_decom_confidence = 'LOW',
  bess_decom_reason = 'Sub-scale regional ops; BESS residual volumes too small to justify routing here.'
 WHERE name IN ('Hammond Lane', 'Ambigroup', 'Enva Metals', 'Ferimet');

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_062_per_asset_confidence', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM scrap_offtakers),
  'Editorial rating pass — wind / solar / BESS scrap fit',
  'Migration 062 — added solar_decom_confidence + bess_decom_confidence (each w/ reason). Rated all active operators across 3 asset classes. Solar HIGH=10 (multi-Mt Al/Cu capable). BESS HIGH=3 (Kuusakoski Veitsiluoto, MGG Metran, Stena Battery Solutions Halmstad — each have integrated battery dismantling capability).'
);
