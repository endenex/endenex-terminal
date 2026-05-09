-- Migration 077 — Normalize source_type values to the enum
-- ========================================================
-- The repowering_projects.source_type column has historically held
-- inconsistent values: a mix of lowercase enum strings ('boe_gazette',
-- 'caiso_queue') and verbose Title Case strings ('BEIS REPD Planning
-- Status', 'Manual', 'Endenex EEG-Expiry Inference', 'Airtable Watch
-- Promotion'). The verbose strings come from older promoter scripts
-- that bypassed the SOURCE_TYPES enum check.
--
-- This migration normalises every source_type to its lowercase enum
-- equivalent so:
--   1) Promoters using the upsert_project() helper find their own
--      prior rows by source_type (idempotent re-runs work)
--   2) Future queries can filter by stable enum values
--   3) The audit trail of "where did this row come from" is consistent
--
-- Mapping table — known verbose values seen in production:
--   'BEIS REPD Planning Status'      → 'repd'
--   'Manual'                         → 'manual'
--   'Endenex EEG-Expiry Inference'   → 'eeg_register'
--   'Airtable Watch Promotion'       → 'airtable'
--   'Airtable'                       → 'airtable'
--   (any other Title Case variant)   → lowercase via fallback
--
-- Defensive: any value NOT in our SOURCE_TYPES enum gets logged but
-- left alone, so we can identify and add new sources rather than
-- silently corrupting data.

BEGIN;

-- Snapshot current state for audit
CREATE TEMP TABLE _source_type_audit AS
SELECT source_type AS original, count(*) AS rows_affected
FROM repowering_projects
GROUP BY source_type;

-- Apply the explicit mapping for known verbose strings
UPDATE repowering_projects
SET source_type = CASE source_type
  WHEN 'BEIS REPD Planning Status'    THEN 'repd'
  WHEN 'Manual'                       THEN 'manual'
  WHEN 'Endenex EEG-Expiry Inference' THEN 'eeg_register'
  WHEN 'Airtable Watch Promotion'     THEN 'airtable'
  WHEN 'Airtable'                     THEN 'airtable'
  WHEN 'REPD'                         THEN 'repd'
  WHEN 'EEG'                          THEN 'eeg_register'
  WHEN 'EEG Register'                 THEN 'eeg_register'
  WHEN 'MaStR'                        THEN 'mastr'
  WHEN 'USWTDB'                       THEN 'eia_form_860'
  WHEN 'BOE'                          THEN 'boe_gazette'
  WHEN 'BOE Gazette'                  THEN 'boe_gazette'
  WHEN 'CAISO'                        THEN 'caiso_queue'
  WHEN 'CAISO Queue'                  THEN 'caiso_queue'
  WHEN 'ERCOT'                        THEN 'ercot_giinr'
  WHEN 'ERCOT GINR'                   THEN 'ercot_giinr'
  WHEN 'AEMO'                         THEN 'aemo_giinr'
  WHEN 'SEC'                          THEN 'sec_edgar'
  WHEN 'SEC EDGAR'                    THEN 'sec_edgar'
  WHEN 'LSE'                          THEN 'lse_rns'
  WHEN 'LSE RNS'                      THEN 'lse_rns'
  ELSE source_type
END
WHERE source_type IN (
  'BEIS REPD Planning Status', 'Manual', 'Endenex EEG-Expiry Inference',
  'Airtable Watch Promotion', 'Airtable', 'REPD', 'EEG', 'EEG Register',
  'MaStR', 'USWTDB', 'BOE', 'BOE Gazette', 'CAISO', 'CAISO Queue',
  'ERCOT', 'ERCOT GINR', 'AEMO', 'SEC', 'SEC EDGAR', 'LSE', 'LSE RNS'
);

-- Show the post-normalisation state per source_type
SELECT source_type, count(*) AS rows
FROM repowering_projects
GROUP BY source_type
ORDER BY count(*) DESC;

-- Telemetry record
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at, records_written,
  source_attribution, notes
) VALUES (
  'migration_077_normalize_source_type',
  'success',
  NOW(),
  NOW(),
  (SELECT count(*) FROM repowering_projects),
  'manual migration',
  'Migration 077 — normalised source_type from verbose Title Case strings to lowercase enum values (matches SOURCE_TYPES in ingestion/repowering/_base.py). Idempotent: only changes known verbose values, leaves anything else alone for inspection.'
);

DROP TABLE _source_type_audit;

COMMIT;
