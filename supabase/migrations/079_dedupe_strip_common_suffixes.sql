-- Migration 079 — Strengthen dedupe_key to strip common project-name suffixes
-- ===========================================================================
-- Migration 074 introduced a dedupe_key normalisation that lowercased and
-- stripped non-alphanumerics. That caught "Tahivilla Acciona" vs
-- "Tahivilla" pairs, but did NOT catch:
--
--   "Tahivilla"           vs  "Tahivilla wind farm"
--   "Montes de Cierzo"    vs  "Montes de Cierzo wind farm"
--   "Burgar Hill"         vs  "Burgar Hill Energy" (developer-suffix variant)
--
-- because the suffix words ("wind farm", "energy", etc.) survived the
-- normalisation as part of the alphanumeric blob.
--
-- This migration:
--   1. Drops the UNIQUE index temporarily so we can re-key safely
--   2. Replaces the trigger function with a stronger normalisation that
--      strips common renewable-industry suffixes BEFORE the alnum strip
--   3. Backfills dedupe_key on all existing rows under the new logic
--   4. Re-merges any newly-colliding pairs (latest stage_date / highest
--      confidence wins)
--   5. Re-adds the UNIQUE index
--
-- Suffix patterns stripped (case-insensitive, only when at end of name):
--   wind farm | wind park | wind project | wind centre | wind center
--   solar farm | solar park | solar plant | solar pv | pv plant
--   battery storage | energy storage | battery facility | bess
--   farm | park | plant | project | facility | complex (single-word too)
--
-- Plus the leading "the" article is dropped.

BEGIN;

-- ── Step 1: Drop UNIQUE index so re-keying can proceed safely ──────────

DROP INDEX IF EXISTS repowering_projects_dedupe_key_uidx;

-- ── Step 2: New normalisation function ─────────────────────────────────

CREATE OR REPLACE FUNCTION _normalise_project_name(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT
    -- Final pass: strip non-alphanumerics
    regexp_replace(
      -- 4) Strip leading "the " article
      regexp_replace(
        -- 3) Strip trailing single-word suffix (farm/park/plant/etc.)
        regexp_replace(
          -- 2) Strip trailing two-word industry suffix
          regexp_replace(
            lower(coalesce(p_name, '')),
            '\s+(wind\s+farm|wind\s+park|wind\s+project|wind\s+centre|wind\s+center|'
              'solar\s+farm|solar\s+park|solar\s+plant|solar\s+pv|pv\s+plant|'
              'battery\s+storage|energy\s+storage|battery\s+facility|bess|'
              'energy\s+complex|energy\s+center|energy\s+centre)$',
            '',
            'gi'
          ),
          '\s+(farm|park|plant|project|facility|complex|centre|center)$',
          '',
          'gi'
        ),
        '^the\s+',
        '',
        'gi'
      ),
      '[^a-zA-Z0-9]', '', 'g'
    );
$$;

-- ── Step 3: Replace trigger to use new normalisation ───────────────────

CREATE OR REPLACE FUNCTION set_repowering_dedupe_key()
RETURNS TRIGGER AS $$
BEGIN
  NEW.dedupe_key := _normalise_project_name(NEW.project_name)
                    || '|' || NEW.country_code || '|' || NEW.asset_class;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Step 4: Backfill existing rows under new normalisation ─────────────

UPDATE repowering_projects
   SET dedupe_key = _normalise_project_name(project_name)
                    || '|' || country_code || '|' || asset_class;

-- ── Step 5: Show collisions before merging (visibility) ────────────────

SELECT dedupe_key,
       array_agg(project_name ORDER BY project_name) AS variant_names,
       count(*)                                       AS collision_count
FROM repowering_projects
GROUP BY dedupe_key
HAVING count(*) > 1
ORDER BY count(*) DESC;

-- ── Step 6: Merge newly-colliding rows ─────────────────────────────────
-- Keep the row with: most recent stage_date → highest confidence →
-- earliest created_at. The "longer / more detailed" name wins as a
-- tiebreaker only if all else is equal.

WITH ranked AS (
  SELECT
    id,
    dedupe_key,
    ROW_NUMBER() OVER (
      PARTITION BY dedupe_key
      ORDER BY
        stage_date    DESC NULLS LAST,
        CASE confidence WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 END,
        last_reviewed DESC NULLS LAST,
        length(project_name) DESC,    -- prefer the more descriptive name
        created_at    ASC
    ) AS rn
  FROM repowering_projects
)
DELETE FROM repowering_projects
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── Step 7: Re-add UNIQUE index ────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS repowering_projects_dedupe_key_uidx
  ON repowering_projects (dedupe_key);

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_079_dedupe_strip_common_suffixes', 'success', NOW(), NOW(),
  (SELECT count(*) FROM repowering_projects),
  'Editorial cleanup',
  'Migration 079 — strengthened dedupe_key normalisation: now strips common renewable-industry suffixes (wind farm / solar park / energy storage / etc.) and the leading "the" article before the alphanumeric strip. Backfilled all rows under new logic, merged newly-colliding pairs (Tahivilla, Montes de Cierzo, Burgar Hill, etc.), re-added UNIQUE index.'
);

COMMIT;
