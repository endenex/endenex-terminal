-- Migration 078 — Drop repowering_projects rows older than 3 years
-- ================================================================
-- Per user 2026-05-09: announcements / mentions older than 3 years
-- aren't actionable. The repowering panel is forward-looking; a 2010
-- wind farm's planning application submitted then doesn't represent
-- current repowering intent.
--
-- This migration:
--   1) Deletes rows where stage_date is more than 3 years old
--   2) Logs the deletion to ingestion_runs for audit
--
-- Going forward, all ingestion scripts (caiso_queue, spain_boe,
-- france_eia, sec_edgar, promote_airtable_repowering,
-- promote_repd_repowering) apply the same 3-year cutoff at insert
-- time via the is_too_old() helper in repowering._base.

BEGIN;

CREATE TEMP TABLE _stale_audit AS
SELECT id, project_name, country_code, asset_class, capacity_mw,
       developer, source_type, stage, stage_date, created_at
FROM repowering_projects
WHERE stage_date < (CURRENT_DATE - INTERVAL '3 years');

DO $$
DECLARE
  total INTEGER;
BEGIN
  SELECT count(*) INTO total FROM _stale_audit;
  RAISE NOTICE 'Migration 078: about to delete % stale rows from repowering_projects', total;
END $$;

-- Per-source breakdown for visibility
SELECT
  source_type,
  count(*)            AS rows_to_delete,
  min(stage_date)     AS oldest_date,
  max(stage_date)     AS newest_stale_date
FROM _stale_audit
GROUP BY source_type
ORDER BY count(*) DESC;

DELETE FROM repowering_projects rp
USING _stale_audit a
WHERE rp.id = a.id;

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at, records_written,
  source_attribution, notes
) VALUES (
  'migration_078_three_year_cutoff_backfill',
  'success',
  NOW(),
  NOW(),
  (SELECT count(*) FROM _stale_audit),
  'manual migration',
  'Migration 078 — deleted repowering_projects rows where stage_date is older than 3 years. Going forward, all ingestion scripts apply the same cutoff via is_too_old() in repowering._base.'
);

DROP TABLE _stale_audit;

COMMIT;
