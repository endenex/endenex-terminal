-- Migration 081 — Anglicise Spanish / French project-name patterns
-- ================================================================
-- Per user 2026-05-09: project_name should always read in standard
-- English form: "{Place} Wind Farm", "{Place} Solar Farm",
-- "{Place} BESS". Local accents on the place name are preserved.
--
-- Examples of intended transforms:
--   "Parque Eólico Mudarra"            → "Mudarra Wind Farm"
--   "Parque Eólico de la Sierra"       → "Sierra Wind Farm"
--   "Planta Solar Cabeza del Caballo"  → "Cabeza del Caballo Solar Farm"
--   "Parc Éolien de Saint-Crépin"      → "Saint-Crépin Wind Farm"
--   "Parc Éolien Saint-Crépin"         → "Saint-Crépin Wind Farm"
--   "Centrale Photovoltaïque de Cestas" → "Cestas Solar Farm"
--   "Parc Solaire de Lyon"             → "Lyon Solar Farm"
--
-- Patterns NOT transformed (left as-is):
--   - English-format names already (e.g. "Tahivilla Wind Farm")
--   - Names with no recognizable Spanish/French prefix
--   - Manually curated entries from Airtable (which are usually English)
--
-- Going forward, the LLM extractors in spain_boe.py and france_eia.py
-- are instructed to emit names in this format directly.

BEGIN;

CREATE TEMP TABLE _name_audit AS
SELECT id, project_name AS before, country_code, asset_class, source_type
FROM repowering_projects;

-- ── Spanish patterns ───────────────────────────────────────────────────

-- "Parque Eólico [de la|del|de|—] {Place}" → "{Place} Wind Farm"
UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '^Parque\s+Eólico(\s+de\s+(la|los|las)?\s*|\s+del\s+|\s+de\s+|\s+)(.+)$',
     '\3 Wind Farm',
     'i'
   )
 WHERE project_name ~* '^Parque\s+Eólico\s+';

-- "Planta Solar [de|del|—] {Place}" → "{Place} Solar Farm"
UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '^Planta\s+Solar(\s+de\s+(la|los|las)?\s*|\s+del\s+|\s+de\s+|\s+)(.+)$',
     '\3 Solar Farm',
     'i'
   )
 WHERE project_name ~* '^Planta\s+Solar\s+';

-- "Planta Fotovoltaica [de] {Place}" → "{Place} Solar Farm"
UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '^Planta\s+Fotovoltaica(\s+de\s+(la|los|las)?\s*|\s+del\s+|\s+de\s+|\s+)(.+)$',
     '\3 Solar Farm',
     'i'
   )
 WHERE project_name ~* '^Planta\s+Fotovoltaica\s+';

-- "Central Solar/Eólica/Fotovoltaica [de] {Place}" → "{Place} {Class} Farm"
UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '^Central\s+Solar(\s+de\s+(la|los|las)?\s*|\s+del\s+|\s+de\s+|\s+)(.+)$',
     '\3 Solar Farm',
     'i'
   )
 WHERE project_name ~* '^Central\s+Solar\s+';

UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '^Central\s+Eólica(\s+de\s+(la|los|las)?\s*|\s+del\s+|\s+de\s+|\s+)(.+)$',
     '\3 Wind Farm',
     'i'
   )
 WHERE project_name ~* '^Central\s+Eólica\s+';

-- ── French patterns ────────────────────────────────────────────────────

-- "Parc Éolien [de l'|de la|du|de|—] {Place}" → "{Place} Wind Farm"
UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '^Parc\s+Éolien(\s+(de\s+l''|de\s+la\s+|du\s+|de\s+|en\s+mer\s+de\s+l''|en\s+mer\s+))?(.+)$',
     '\3 Wind Farm',
     'i'
   )
 WHERE project_name ~* '^Parc\s+Éolien\s+';

-- "Centrale Photovoltaïque [de l'|de la|du|de|—] {Place}" → "{Place} Solar Farm"
UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '^Centrale\s+Photovoltaïque(\s+(de\s+l''|de\s+la\s+|du\s+|de\s+))?(.+)$',
     '\3 Solar Farm',
     'i'
   )
 WHERE project_name ~* '^Centrale\s+Photovoltaïque\s+';

-- "Parc Solaire [de l'|de la|du|de|—] {Place}" → "{Place} Solar Farm"
UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '^Parc\s+Solaire(\s+(de\s+l''|de\s+la\s+|du\s+|de\s+))?(.+)$',
     '\3 Solar Farm',
     'i'
   )
 WHERE project_name ~* '^Parc\s+Solaire\s+';

-- "Centrale Solaire [de l'|de la|du|de|—] {Place}" → "{Place} Solar Farm"
UPDATE repowering_projects
   SET project_name = regexp_replace(
     project_name,
     '^Centrale\s+Solaire(\s+(de\s+l''|de\s+la\s+|du\s+|de\s+))?(.+)$',
     '\3 Solar Farm',
     'i'
   )
 WHERE project_name ~* '^Centrale\s+Solaire\s+';

-- ── Tidy: trim whitespace, collapse double spaces, capitalise place ────

UPDATE repowering_projects
   SET project_name = regexp_replace(trim(project_name), '\s+', ' ', 'g');

-- ── Visibility: print the actual changes ───────────────────────────────

SELECT
  a.before               AS original,
  p.project_name         AS anglicised,
  a.country_code,
  a.asset_class,
  a.source_type
FROM _name_audit a
JOIN repowering_projects p ON p.id = a.id
WHERE a.before IS DISTINCT FROM p.project_name
ORDER BY a.country_code, p.project_name;

-- Telemetry
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_081_anglicise_project_names', 'success', NOW(), NOW(),
  (SELECT count(*) FROM _name_audit a
    JOIN repowering_projects p ON p.id = a.id
    WHERE a.before IS DISTINCT FROM p.project_name),
  'Editorial cleanup',
  'Migration 081 — converted Spanish (Parque Eólico / Planta Solar / Planta Fotovoltaica / Central Solar / Central Eólica) and French (Parc Éolien / Centrale Photovoltaïque / Parc Solaire / Centrale Solaire) project names to standard English form: "{Place} Wind Farm" / "{Place} Solar Farm". Local accents on place names preserved. Going forward, LLM extractors in spain_boe.py and france_eia.py emit names in this format directly.'
);

DROP TABLE _name_audit;

COMMIT;
