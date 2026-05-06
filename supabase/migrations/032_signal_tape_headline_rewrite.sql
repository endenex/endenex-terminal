-- Migration 032 — Signal Tape: LLM-rewritten headlines (FT / Bloomberg grade)
--
-- The `headline` column always holds the original (RSS feed title or
-- Airtable-curated text). A daily rewrite step (rewrite_headlines.py)
-- writes an editorial-grade restatement into `headline_rewritten`.
--
-- The frontend renders `coalesce(headline_rewritten, headline)` so
-- rewriting is fully optional and rollback-safe (just clear the column).
--
-- We also track the rewriter model + timestamp for audit, so users can
-- see when a row was last touched by the rewriter.

ALTER TABLE watch_events
  ADD COLUMN IF NOT EXISTS headline_rewritten      text,
  ADD COLUMN IF NOT EXISTS headline_rewriter_model text,
  ADD COLUMN IF NOT EXISTS headline_rewritten_at   timestamptz,
  ADD COLUMN IF NOT EXISTS headline_rewrite_unchanged boolean;
  -- ^ TRUE when the rewriter decided the original was already FT-grade
  -- or that rewriting risked changing meaning. In that case we don't
  -- write to headline_rewritten; the column stays NULL and the original
  -- is rendered unchanged.

CREATE INDEX IF NOT EXISTS watch_events_rewriter_pending_idx
  ON watch_events(id)
  WHERE headline_rewritten IS NULL
    AND headline_rewrite_unchanged IS NOT TRUE
    AND is_duplicate = false;

-- Telemetry
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_032_signal_tape_headline_rewrite', 'success', NOW(), NOW(),
  0,
  'Migration 032 — headline_rewritten + audit columns',
  'Schema-only migration. Run rewrite_headlines.py to populate.'
);
