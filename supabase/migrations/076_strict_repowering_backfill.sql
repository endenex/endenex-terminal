-- Migration 076 — Strict repowering / decommissioning backfill
-- ============================================================
-- The repowering_projects table is meant ONLY for projects that tear
-- down an existing renewable installation and replace it. It is NOT a
-- live-pipeline tracker for net-new builds.
--
-- Earlier this week we pointed CAISO ingestion at the full
-- PublicQueueReport, which dumped ~290 net-new greenfield projects
-- into the table (1400 MW BESS, 500 MW solar farms, hybrids, phase
-- 2/3 expansions). This migration deletes anything that doesn't
-- explicitly indicate repowering/decommissioning, and preserves any
-- manually curated rows.
--
-- Inclusion criteria (one of):
--   1) name OR notes contains explicit repowering language
--      (repower, decommission, dismantling, demolition, retirement,
--       repotenciación, desmantelamiento, sustitución, renouvellement,
--       démantèlement, remplacement, rückbau)
--   2) source_type IN ('manual', 'airtable')  — curated entries are
--      assumed to be intentional repowers
--   3) source_type IN ('repd', 'mastr', 'eeg_register')  — these
--      sources include BOTH repowering candidates and live operating
--      assets that may be near-EOL (kept; the EEG-promoter and REPD-
--      promoter scripts already filter to repowering candidates).
--
-- Everything else gets deleted. Phase 1-3 ingestion scripts have been
-- updated to apply the same filter going forward.

BEGIN;

-- Snapshot what we're about to delete for the audit trail
CREATE TEMP TABLE _deletion_audit AS
SELECT id, project_name, country_code, asset_class, capacity_mw,
       developer, source_type, stage, created_at
FROM repowering_projects
WHERE
  -- Auto-ingested sources we want to filter strictly
  source_type IN (
    'caiso_queue', 'ercot_giinr', 'aemo_giinr',
    'miso_queue', 'pjm_queue', 'nyiso_queue', 'spp_queue',
    'sec_edgar', 'lse_rns', 'euronext_disclosure',
    'miteco_tramita', 'rte_open_data', 'terna_anagrafica',
    'energistyrelsen', 'rvo_sde', 'eirgrid_tso',
    'meti_anre_fit', 'kepco_rps',
    'boe_gazette', 'regional_gazette',
    'company_filing', 'investor_disclosure', 'company_press_release',
    'trade_press', 'regulator_announcement', 'industry_association'
  )
  -- AND no explicit repowering language anywhere
  AND NOT (
       project_name ~* '\m(repower(ing|ed)?|decommission(ing|ed)?|dismantl(e|ing|ement)|demolition|retire(ment)?|replacement\s+of|repotenciación|repotenciado|desmantelamiento|desmantelado|sustitución|renouvellement|démantèlement|remplacement|rückbau)\M'
    OR coalesce(notes, '') ~* '\m(repower(ing|ed)?|decommission(ing|ed)?|dismantl(e|ing|ement)|demolition|retire(ment)?|replacement\s+of|repotenciación|repotenciado|desmantelamiento|desmantelado|sustitución|renouvellement|démantèlement|remplacement|rückbau)\M'
  );

-- Show how many rows we're about to delete and from which sources
DO $$
DECLARE
  total INTEGER;
BEGIN
  SELECT count(*) INTO total FROM _deletion_audit;
  RAISE NOTICE 'Migration 076: about to delete % rows from repowering_projects', total;
END $$;

-- Per-source breakdown for visibility (will appear in migration log)
SELECT
  source_type,
  count(*)            AS rows_to_delete,
  sum(capacity_mw)    AS mw_to_delete
FROM _deletion_audit
GROUP BY source_type
ORDER BY count(*) DESC;

-- The actual delete
DELETE FROM repowering_projects rp
USING _deletion_audit a
WHERE rp.id = a.id;

-- Telemetry record
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at, records_written,
  source_attribution, notes
) VALUES (
  'migration_076_strict_repowering_backfill',
  'success',
  NOW(),
  NOW(),
  (SELECT count(*) FROM _deletion_audit),
  'manual migration',
  'Migration 076 — deleted auto-ingested rows that lack explicit repowering / decommissioning language. Repowering pipeline is now strict: only projects that tear down an existing asset qualify. Phase 1-3 ingestion scripts updated to apply the same filter going forward.'
);

DROP TABLE _deletion_audit;

COMMIT;
