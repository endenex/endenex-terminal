-- Migration 075 — Repowering lifecycle columns
--
-- Adds columns needed for the cross-cutting orchestrators introduced
-- alongside the Phase 1-3 ingestion expansion:
--
--   completion_checked_at — timestamp of last "is this still ongoing?"
--                           sweep (set by check_repowering_completions.py)
--   completed_at          — date the project was confirmed completed /
--                           commissioned. Once non-null, the panel can
--                           hide the row from the active pipeline.
--   developer_enrichment_at        — last attempt to enrich missing developer
--   developer_enrichment_attempts  — counter to avoid retrying forever
--   external_source_id    — opaque ID from the upstream system (ERCOT QID,
--                           CAISO Q#, AEMO DUID, MaStR EinheitID, etc.)
--   external_source       — which upstream system the row came from
--                           (matches `source_type` enum values)

ALTER TABLE repowering_projects
  ADD COLUMN IF NOT EXISTS completion_checked_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at                  DATE,
  ADD COLUMN IF NOT EXISTS developer_enrichment_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS developer_enrichment_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS external_source_id            TEXT,
  ADD COLUMN IF NOT EXISTS external_source               TEXT;

CREATE INDEX IF NOT EXISTS repowering_projects_completion_checked_idx
  ON repowering_projects (completion_checked_at NULLS FIRST);

CREATE INDEX IF NOT EXISTS repowering_projects_developer_enrichment_idx
  ON repowering_projects (developer_enrichment_at NULLS FIRST)
  WHERE developer IS NULL;

CREATE INDEX IF NOT EXISTS repowering_projects_external_source_idx
  ON repowering_projects (external_source, external_source_id);

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_075_repowering_lifecycle_columns', 'success', NOW(), NOW(),
  0,
  'Schema',
  'Migration 075 — added completion + developer-enrichment + external-id columns to repowering_projects. Underpins Phase 1-3 ingestion expansion + completion-detector + developer-enrichment orchestrators.'
);
