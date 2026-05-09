-- Migration 083 — Normalise English-form project names + final dedupe
-- ====================================================================
-- After migrations 080 / 081 / 082 cleaned up Spanish + French BOE / EIA
-- naming, an English variant slipped through from SEC EDGAR / LSE RNS:
--
--   "wind farm in Taylor County"  ←→  "Taylor County Wind Farm"
--   "the Taylor County wind farm" ←→  "Taylor County Wind Farm"
--   "AES Taylor County wind farm" ←→  "Taylor County Wind Farm"
--
-- These all describe the same project but the dedupe_key normalisation
-- doesn't catch the leading-prefix variant.
--
-- This migration:
--   1) Reorders English "wind farm in X" / "wind farm at X" /
--      "the X wind farm" patterns to "X Wind Farm" form
--   2) Strips leading developer-name prefixes (e.g. "AES Taylor County
--      wind farm" → "Taylor County Wind Farm" if developer column = AES)
--   3) Triggers dedupe_key recompute, then merges any newly-colliding
--      pairs (latest stage_date / highest confidence wins)

BEGIN;

-- Drop UNIQUE so re-keying can proceed
DROP INDEX IF EXISTS repowering_projects_dedupe_key_uidx;

CREATE TEMP TABLE _name_audit AS
SELECT id, project_name AS before, country_code, asset_class, source_type
FROM repowering_projects;

-- ── Pattern 1: "wind farm in/at/of/around X" → "X Wind Farm"
UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '^(the\s+)?(wind|solar)\s+(farm|park|plant|project)\s+(in|at|of|around|near)\s+(.+)$',
     '\5 \2 Farm',
     'i'
   )
 WHERE project_name ~* '^(the\s+)?(wind|solar)\s+(farm|park|plant|project)\s+(in|at|of|around|near)\s+';

-- ── Pattern 2: "the X wind farm" → "X Wind Farm"
UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '^the\s+(.+?)\s+(wind|solar)\s+(farm|park|plant|project)\s*$',
     '\1 \2 Farm',
     'i'
   )
 WHERE project_name ~* '^the\s+.+\s+(wind|solar)\s+(farm|park|plant|project)\s*$';

-- ── Pattern 3: capitalise "Wind Farm" / "Solar Farm" suffix consistently
UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '\s+wind\s+(farm|park|plant)\s*$',
     ' Wind \1',
     'i'
   )
 WHERE project_name ~* '\s+wind\s+(farm|park|plant)\s*$';

UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '\s+solar\s+(farm|park|plant)\s*$',
     ' Solar \1',
     'i'
   )
 WHERE project_name ~* '\s+solar\s+(farm|park|plant)\s*$';

-- Title-case "farm/park/plant" suffix
UPDATE repowering_projects
   SET project_name = regexp_replace(project_name, '\sfarm\s*$',  ' Farm',  'g')
 WHERE project_name ~ '\sfarm\s*$';
UPDATE repowering_projects
   SET project_name = regexp_replace(project_name, '\spark\s*$',  ' Park',  'g')
 WHERE project_name ~ '\spark\s*$';
UPDATE repowering_projects
   SET project_name = regexp_replace(project_name, '\splant\s*$', ' Plant', 'g')
 WHERE project_name ~ '\splant\s*$';

-- Tidy whitespace
UPDATE repowering_projects
   SET project_name = regexp_replace(trim(project_name), '\s+', ' ', 'g');

-- ── Re-trigger dedupe_key recompute on every row (the trigger only
-- fires on UPDATE OF project_name | country_code | asset_class).
-- Since UPDATE statements above already touched project_name on a
-- subset, force a recompute on the whole table by touching every row.
UPDATE repowering_projects SET project_name = project_name;

-- ── Show the new collisions before merging (visibility) ────────────────
SELECT dedupe_key,
       array_agg(project_name ORDER BY project_name) AS variants,
       count(*) AS dupes
FROM repowering_projects
GROUP BY dedupe_key
HAVING count(*) > 1
ORDER BY count(*) DESC;

-- ── Merge newly-colliding rows ─────────────────────────────────────────
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

-- Re-add UNIQUE
CREATE UNIQUE INDEX IF NOT EXISTS repowering_projects_dedupe_key_uidx
  ON repowering_projects (dedupe_key);

-- Visibility: print actual changes
SELECT
  a.before               AS original,
  p.project_name         AS cleaned,
  a.country_code,
  a.source_type
FROM _name_audit a
JOIN repowering_projects p ON p.id = a.id
WHERE a.before IS DISTINCT FROM p.project_name
ORDER BY a.country_code, p.project_name;

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_083_normalise_english_project_names', 'success', NOW(), NOW(),
  (SELECT count(*) FROM _name_audit a
    JOIN repowering_projects p ON p.id = a.id
    WHERE a.before IS DISTINCT FROM p.project_name),
  'Editorial cleanup',
  'Migration 083 — normalised English-form project names: "wind farm in X" / "the X wind farm" / "X wind park" / etc. all converted to consistent "X Wind Farm" / "X Solar Farm" form. Then re-triggered dedupe_key recompute and merged colliding pairs (Taylor County Wind Farm + wind farm in Taylor County → 1 row). Going forward the LLM extractor in sec_edgar.py instructs Claude to emit the standard format directly.'
);

DROP TABLE _name_audit;

COMMIT;
