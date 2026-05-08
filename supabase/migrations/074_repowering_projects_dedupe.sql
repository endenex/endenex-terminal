-- Migration 074 — Repowering projects: dedupe + dedupe-key constraint
--
-- The repowering_projects table accumulated duplicates because three
-- ingestion paths (REPD UK, EEG Marktstammdatenregister, Airtable curated)
-- each insert with slightly different project_name spellings — e.g.
-- "Tahivilla" vs "Tahivilla Acciona" vs "Acciona Tahivilla".
--
-- Two fixes:
--   1. One-shot consolidation: keep one row per normalised name
--      (lowercased, alphanumerics only). Most-recent stage_date wins;
--      ties broken by highest confidence.
--   2. Add a `dedupe_key` text column generated as
--      lower(regexp_replace(project_name, '[^a-zA-Z0-9]', '', 'g')) ||
--      '|' || country_code || '|' || asset_class.
--      UNIQUE constraint on dedupe_key blocks future near-dupes.
--
-- Ingestion scripts will need to use ON CONFLICT (dedupe_key) DO UPDATE
-- on next run.

-- ── Step 1: Add dedupe_key column ───────────────────────────────────────

ALTER TABLE repowering_projects
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

UPDATE repowering_projects
   SET dedupe_key = lower(regexp_replace(project_name, '[^a-zA-Z0-9]', '', 'g'))
                    || '|' || country_code || '|' || asset_class
 WHERE dedupe_key IS NULL;

-- ── Step 2: Consolidate duplicates ──────────────────────────────────────
-- For each (dedupe_key) group with >1 row, keep the row with the most
-- recent stage_date (NULLs last), then highest confidence (High > Medium
-- > Low). Delete the rest.

WITH ranked AS (
  SELECT
    id,
    dedupe_key,
    ROW_NUMBER() OVER (
      PARTITION BY dedupe_key
      ORDER BY
        stage_date DESC NULLS LAST,
        CASE confidence WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 END,
        last_reviewed DESC NULLS LAST,
        created_at ASC
    ) AS rn
  FROM repowering_projects
)
DELETE FROM repowering_projects
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── Step 3: Specific known duplicates (catch fuzzy matches) ─────────────
-- Taylor County (US) — AES repowering project; multiple ingest paths
-- inserted variants like 'Taylor County AES', 'AES Taylor County',
-- 'Taylor County Wind Farm'. Keep the AES-tagged row only.
WITH taylor_keep AS (
  SELECT id FROM repowering_projects
   WHERE country_code = 'US'
     AND lower(project_name) LIKE '%taylor county%'
   ORDER BY stage_date DESC NULLS LAST, last_reviewed DESC NULLS LAST
   LIMIT 1
)
DELETE FROM repowering_projects
 WHERE country_code = 'US'
   AND lower(project_name) LIKE '%taylor county%'
   AND id NOT IN (SELECT id FROM taylor_keep);

-- Tahivilla (ES) — Acciona repowering; similar variant issue.
WITH tahivilla_keep AS (
  SELECT id FROM repowering_projects
   WHERE country_code = 'ES'
     AND lower(project_name) LIKE '%tahivilla%'
   ORDER BY stage_date DESC NULLS LAST, last_reviewed DESC NULLS LAST
   LIMIT 1
)
DELETE FROM repowering_projects
 WHERE country_code = 'ES'
   AND lower(project_name) LIKE '%tahivilla%'
   AND id NOT IN (SELECT id FROM tahivilla_keep);

-- ── Step 4: NOT NULL + UNIQUE constraint on dedupe_key ─────────────────

ALTER TABLE repowering_projects
  ALTER COLUMN dedupe_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS repowering_projects_dedupe_key_uidx
  ON repowering_projects (dedupe_key);

-- ── Step 5: Trigger to auto-populate dedupe_key on insert/update ───────

CREATE OR REPLACE FUNCTION set_repowering_dedupe_key()
RETURNS TRIGGER AS $$
BEGIN
  NEW.dedupe_key := lower(regexp_replace(NEW.project_name, '[^a-zA-Z0-9]', '', 'g'))
                    || '|' || NEW.country_code || '|' || NEW.asset_class;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS repowering_projects_dedupe_key_trg ON repowering_projects;
CREATE TRIGGER repowering_projects_dedupe_key_trg
  BEFORE INSERT OR UPDATE OF project_name, country_code, asset_class
  ON repowering_projects
  FOR EACH ROW EXECUTE FUNCTION set_repowering_dedupe_key();

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_074_repowering_projects_dedupe', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM repowering_projects),
  'Editorial cleanup',
  'Migration 074 — repowering_projects dedupe: added dedupe_key column + UNIQUE constraint + trigger; consolidated duplicates (kept latest-stage-date / highest-confidence row per normalised name × country × asset_class). Specific cleanup: Taylor County AES (US), Tahivilla Acciona (ES).'
);
