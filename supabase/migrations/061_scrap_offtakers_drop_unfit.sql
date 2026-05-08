-- Migration 061 — Drop unfit operators + collapse NA confidence into LOW
--
-- Per user feedback on the Off-takers panel:
--   • "we should not have smelters and mills in this list at all"
--   • "confidence cannot be NA. NA means LOW, no?"
--   • "if Cronimet is wrong fit don't put it on the list at all"
--   • "no need to call out EMR as the only UK operator — companies without
--     promotion"
--
-- Changes:
--   1. DELETE pure mills + pure non-ferrous smelters + structurally unfit
--      operators (Unimetals defunct; KGHM Cu smelter; Nucor pure mill; Steel
--      Dynamics pure mill; Cronimet stainless wrong fit).
--   2. Collapse NA → LOW. Drop NA from the CHECK constraint.
--   3. Neutralise EMR notes (no "largest" / "only operator" claims).

-- ── Step 1: Drop unfit ─────────────────────────────────────────────────

DELETE FROM scrap_offtakers
 WHERE name IN (
   'Unimetals (formerly Sims Metal UK)',  -- defunct (winding-up Nov 2025)
   'KGHM Polska Miedź',                   -- pure copper smelter
   'Nucor',                               -- pure mill (buys via DJJ only)
   'Steel Dynamics (SDI)',                -- pure mill (buys via OmniSource only)
   'Cronimet Holding'                     -- stainless specialist, wrong fit
 );

-- ── Step 2: Collapse NA → LOW (any leftovers) and update CHECK ─────────

UPDATE scrap_offtakers
   SET wind_decom_confidence = 'LOW'
 WHERE wind_decom_confidence = 'NA';

ALTER TABLE scrap_offtakers
  DROP CONSTRAINT IF EXISTS scrap_offtakers_wind_decom_confidence_check;
ALTER TABLE scrap_offtakers
  ADD CONSTRAINT scrap_offtakers_wind_decom_confidence_check
  CHECK (wind_decom_confidence IN ('HIGH','MEDIUM','LOW'));

-- ── Step 3: Neutralise EMR notes (drop promotional language) ───────────

UPDATE scrap_offtakers
   SET notes          = '~150 sites across UK + DE + NL + US. Glasgow Wind Turbine Processing Centre (dedicated wind decom hub) live. DE port hubs at Hamburg + Rostock. Parent: Ausurus Group; HQ Warrington, Cheshire.',
       last_verified  = CURRENT_DATE
 WHERE name = 'European Metal Recycling (EMR)';

UPDATE scrap_offtakers
   SET wind_decom_reason = 'Dedicated Wind Turbine Processing Centre at Glasgow; pan-EU + US + NL footprint with port hubs (Hamburg, Rostock).'
 WHERE name = 'European Metal Recycling (EMR)';

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_061_scrap_offtakers_drop_unfit', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM scrap_offtakers),
  'User editorial pass — drop unfit + neutralise tone',
  'Migration 061 — dropped 5 unfit operators (Unimetals defunct, KGHM Cu smelter, Nucor + SDI pure mills, Cronimet stainless wrong fit). Collapsed NA confidence into LOW. Neutralised EMR notes (no promotional "largest"/"only" language).'
);
