-- Migration 067 — OEM model polish + composite recovery correction
--
-- Three fixes for the Material Intensity Calculator panel:
--
--   1. Composite blade recoverability set to 0%. Previous values (10%) were
--      aspirational from academic LCA papers; in practice GFRP/CFRP wind
--      blade recycling is <1% commercially, with most going to landfill or
--      cement co-processing (which doesn't pay the asset owner). For an
--      asset-owner-realised-value model, 0% is the honest figure.
--
--   2. Rename "GE Renewable" → "GE" (corporate rebrand following GE Vernova
--      spin-off; trade name in scrap-yard discussions is just "GE").
--
--   3. Mark legacy turbines without the "legacy" status flag visible in the
--      model dropdown — the panel will hide the suffix from display, but
--      rather than rely on UI logic alone we leave the status column intact
--      for filtering. (No DB change needed for this — UI-only fix.)

-- ── Step 1: Composite blade recoverability → 0% ────────────────────────

-- recoverable_intensity_value is computed by material_intensities_v as
-- (intensity_value × recoverability_pct / 100), so setting recoverability_pct
-- to 0 drives the computed recoverable to 0 automatically.
UPDATE material_intensities
   SET recoverability_pct   = 0,
       recoverability_basis = 'observed_demolition',
       notes                = COALESCE(notes || ' | ', '') ||
         'GFRP/CFRP composites are <1% recycled commercially today (most go to landfill or cement co-processing — neither pays the asset owner). 0% recoverable from an asset-owner-realised-value perspective. Update if WindEurope blade roadmap targets begin yielding paid offtakes.'
 WHERE material IN ('composite_blade_glass_fibre', 'composite_blade_carbon_fibre');

-- ── Step 2: Rename GE Renewable → GE ───────────────────────────────────

UPDATE oem_models
   SET manufacturer = 'GE'
 WHERE manufacturer = 'GE Renewable';

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_067_oem_polish_and_composite_recovery', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM material_intensities WHERE material LIKE 'composite_blade%'),
  'Editorial — asset-owner-realised perspective',
  'Migration 067 — composite blade recoverability set to 0% (was 10% aspirational); GE Renewable manufacturer renamed to GE. Legacy "(legacy)" display suffix dropped via UI fix.'
);
