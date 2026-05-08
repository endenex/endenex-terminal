-- Migration 068 — Composite recoverability → 0% (broader match)
--
-- Migration 067 only matched 'composite_blade_glass_fibre' /
-- 'composite_blade_carbon_fibre' but the seed in 039 actually uses
-- 'composite_gfrp' / 'composite_cfrp' as material names. This migration
-- catches ALL composite/blade-classified rows and zeroes their
-- recoverability_pct.

UPDATE material_intensities
   SET recoverability_pct   = 0,
       recoverability_basis = 'observed_demolition',
       notes                = COALESCE(notes || ' | ', '') ||
         '0% recoverable from asset-owner-realised-value perspective. GFRP/CFRP <1% recycled commercially today; landfill or cement co-processing don''t pay the asset owner.'
 WHERE material ILIKE 'composite%'
    OR material ILIKE '%gfrp%'
    OR material ILIKE '%cfrp%'
    OR material_subclass ILIKE '%blade%'
    OR material_subclass ILIKE '%composite%';

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_068_composite_recovery_zero_broader', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM material_intensities
    WHERE material ILIKE 'composite%' OR material ILIKE '%gfrp%' OR material ILIKE '%cfrp%'
       OR material_subclass ILIKE '%blade%' OR material_subclass ILIKE '%composite%'),
  'Editorial — broader composite match',
  'Migration 068 — composite recoverability set to 0% across all composite/blade rows (067 missed composite_gfrp/cfrp).'
);
