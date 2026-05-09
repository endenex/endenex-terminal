-- Migration 082 — Strip capacity / dossier descriptors from project_name
-- ======================================================================
-- After migration 081 anglicised "Parque Eólico Mudarra de 100 MW" to
-- "Mudarra de 100 MW Wind Farm", the capacity descriptor "de 100 MW"
-- ended up wedged into the project name. Capacity belongs in
-- capacity_mw, not in the name. Same risk for similar descriptors:
-- year, dossier numbers, hectares.
--
-- This migration strips:
--   1. "de N MW(p|h)?" / "N MW(p|h)?"        — capacity (any unit)
--   2. "de N hectáreas/ha"                    — area
--   3. "(YYYY)" or "del año YYYY"              — years in parens
--   4. "expediente N"                          — file references
--
-- Pattern is generous on whitespace and punctuation around the
-- descriptor, then trims double-spaces / leading-trailing junk after.
--
-- Going forward, the LLM extractors in spain_boe.py and france_eia.py
-- have updated tool descriptions instructing Claude not to include
-- capacity in the name.

BEGIN;

CREATE TEMP TABLE _name_audit AS
SELECT id, project_name AS before, country_code, asset_class, source_type
FROM repowering_projects;

-- 1) Capacity descriptors: "de 100 MW", "100 MW", "de 50 MWp", "200 MWh"
--    Match anywhere in the name (multilingual de/of/—).
UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '\s*(de\s+|of\s+)?\d+(\.\d+)?\s*(MW(p|h)?|kW)\b',
     '',
     'gi'
   )
 WHERE project_name ~* '\d+\s*(MW|kW)';

-- 2) Area descriptors: "de 50 hectáreas", "50 ha"
UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '\s*(de\s+)?\d+(\.\d+)?\s*(hectáreas|hectares|ha)\b',
     '',
     'gi'
   )
 WHERE project_name ~* '\d+\s*(hectáreas|hectares|\sha)';

-- 3) Years in parens: "(2024)", "(años 2023-2025)"
UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '\s*\(\s*(años?\s+)?\d{4}([-–]\d{4})?\s*\)',
     '',
     'gi'
   )
 WHERE project_name ~* '\(\s*\d{4}';

-- 4) Expediente / dossier references: "expediente 12345", "ref XYZ"
UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '\s*(expediente|expte\.?|ref(\.|erencia)?\s+|dossier\s+)\s*\S+',
     '',
     'gi'
   )
 WHERE project_name ~* '(expediente|expte|ref\.|referencia\s|dossier\s)';

-- 5) Tidy: collapse double spaces, trim, fix leftover " ," or trailing junk
UPDATE repowering_projects
   SET project_name = regexp_replace(
     trim(both ' ,.;:-' from project_name),
     '\s+', ' ', 'g'
   );

-- Visibility: print actual changes
SELECT
  a.before               AS original,
  p.project_name         AS cleaned,
  a.country_code,
  a.asset_class,
  a.source_type
FROM _name_audit a
JOIN repowering_projects p ON p.id = a.id
WHERE a.before IS DISTINCT FROM p.project_name
ORDER BY a.country_code, p.project_name;

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_082_strip_capacity_from_names', 'success', NOW(), NOW(),
  (SELECT count(*) FROM _name_audit a
    JOIN repowering_projects p ON p.id = a.id
    WHERE a.before IS DISTINCT FROM p.project_name),
  'Editorial cleanup',
  'Migration 082 — stripped capacity (MW/MWp/MWh/kW), area (hectáreas/ha), year-in-parens, and expediente/dossier descriptors from project_name. These fragments belong in their own columns (capacity_mw, etc.), not in the display name. Going forward, the LLM extractors in spain_boe.py / france_eia.py instruct Claude to omit them.'
);

DROP TABLE _name_audit;

COMMIT;
