-- Migration 080 — Clean procedural prefixes from BOE / EIA project names
-- ======================================================================
-- The Spanish BOE LLM extractor was sometimes returning the BOE notice
-- HEADLINE as project_name instead of the actual installation name.
-- e.g. "Modificación del parque eólico Mudarra" instead of just
-- "Parque Eólico Mudarra".
--
-- Same risk on French EIA consultations ("Projet de…", "Demande
-- d'autorisation…", "Renouvellement du…").
--
-- This migration strips the most common procedural prefixes from
-- existing rows. Going forward, the LLM tool description in
-- spain_boe.py and france_eia.py instructs Claude to return only the
-- project name itself.
--
-- Strategy: for each known prefix, regexp_replace the project_name
-- (case-insensitive). After cleanup, re-trigger the dedupe_key
-- recalculation (the trigger fires on UPDATE OF project_name so this
-- is automatic).

BEGIN;

-- Snapshot what we're about to change
CREATE TEMP TABLE _name_cleanup_audit AS
SELECT id, project_name AS before, country_code, source_type
FROM repowering_projects
WHERE project_name ~* '^(Anuncio\s+|Resolución\s+|Modificación\s+|Solicitud\s+|Modification\s+|Projet\s+de\s+|Demande\s+|Renouvellement\s+du?\s+|Information\s+publique\s+)';

-- Spanish prefixes
UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '^(Anuncio(\s+de(\s+resolución)?)?|Resolución(\s+relativa\s+al?)?|'
     'Modificación\s+(del?\s+|de\s+la\s+)?|'
     'Solicitud\s+de\s+(autorización|modificación)\s+(para|de)\s+(la|el)?\s+|'
     'Información\s+pública\s+(de\s+)?(la|el)?\s+|'
     'Sometimiento\s+a\s+información\s+pública\s+(de\s+)?(la|el)?\s+|'
     'Convalidación\s+de\s+(las|los)?\s+)',
     '',
     'gi'
   )
 WHERE project_name ~* '^(Anuncio|Resolución|Modificación|Solicitud|Información\s+pública|Sometimiento|Convalidación)';

-- French prefixes
UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '^(Projet\s+de\s+(modification\s+du\s+)?|'
     'Demande\s+d''?(autorisation|enquête|exploitation)\s+(de|pour)\s+(le|la|l'')?\s+|'
     'Renouvellement\s+du?\s+|'
     'Modification\s+(substantielle\s+)?(de\s+l''?|du?\s+)?|'
     'Avis\s+de\s+(consultation\s+publique\s+sur\s+)?(le|la|l''?)?\s+|'
     'Consultation\s+publique\s+(sur\s+)?(le|la|l''?)?\s+|'
     'Enquête\s+publique\s+(sur\s+)?(le|la|l''?)?\s+)',
     '',
     'gi'
   )
 WHERE project_name ~* '^(Projet\s+de|Demande\s+d|Renouvellement|Modification|Avis|Consultation\s+publique|Enquête)';

-- Trim residual whitespace + uppercase first letter of each word for
-- cleaner display (Spanish + French both prefer Title Case for project
-- names that follow procedural prefix removal)
UPDATE repowering_projects
   SET project_name = trim(both ' ,.;:' from project_name)
 WHERE id IN (SELECT id FROM _name_cleanup_audit);

-- Show before/after for visibility
SELECT a.before AS original_name,
       p.project_name AS cleaned_name,
       a.country_code,
       a.source_type
FROM _name_cleanup_audit a
JOIN repowering_projects p ON p.id = a.id
WHERE a.before IS DISTINCT FROM p.project_name
ORDER BY a.country_code, p.project_name;

-- Telemetry
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_080_clean_procedural_project_names', 'success', NOW(), NOW(),
  (SELECT count(*) FROM _name_cleanup_audit),
  'Editorial cleanup',
  'Migration 080 — stripped procedural prefixes from BOE / EIA-derived project names so they read as installation names rather than notice headlines. Anuncio / Modificación / Solicitud / Resolución / Sometimiento / Convalidación (Spanish) and Projet de / Demande / Renouvellement / Modification / Avis / Consultation / Enquête (French) prefixes removed. Going forward the LLM extractors are instructed to return the installation name only.'
);

DROP TABLE _name_cleanup_audit;

COMMIT;
