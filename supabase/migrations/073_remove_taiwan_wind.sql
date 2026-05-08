-- Migration 073 — Remove Taiwan from wind retirement pipeline
--
-- Editorial decision: Taiwan offshore wind data dropped from the Wind
-- Retirement Pipeline panel. Asset-owner audience for this Terminal does
-- not address Taiwanese wind decom in the typical commercial flow; keeping
-- the row distorts country comparison without adding actionable value.

DELETE FROM installation_history
 WHERE country = 'TW'
   AND asset_class IN ('wind_onshore','wind_offshore');

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_073_remove_taiwan_wind', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM installation_history),
  'Editorial cleanup',
  'Migration 073 — removed Taiwan (TW) wind installation history rows. Same rationale as China exclusion: not addressable for the asset-owner audience.'
);
