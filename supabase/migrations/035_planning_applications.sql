-- Migration 035 — UK planning applications cache (via PlanIt aggregator)
--
-- Why this exists: the second-strongest evidence leg in the SPV bridge is
-- the applicant name on the planning consent. (LPA + planning_ref) is a
-- unique key into the LPA's planning portal where the application's
-- "applicant" field is the legal entity that holds the consent — almost
-- always the project SPV.
--
-- There's no national planning API. PlanIt (planit.org.uk) is a free
-- public aggregator of UK planning applications across virtually all
-- ~333 local planning authorities. We hit PlanIt once per (LPA, ref)
-- pair, cache the result here, and surface the applicant in the
-- repd_operational_onshore_wind_v view as a starting point for the SPV
-- search at Companies House.

CREATE TABLE IF NOT EXISTS planning_applications (
  -- Identity
  id                       bigserial PRIMARY KEY,
  planning_authority       text NOT NULL,                     -- as named in REPD ("East Lothian Council")
  planning_ref             text NOT NULL,                     -- as named in REPD ("E/2014/0567/F")

  -- Resolved fields from PlanIt
  applicant_name           text,                              -- THE BRIDGE — legal entity on the consent
  applicant_address        text,
  application_description  text,
  decision                 text,                              -- "Permitted", "Refused", "Withdrawn", etc.
  decision_date            date,
  application_received     date,
  application_validated    date,
  app_state                text,                              -- PlanIt's normalised state
  app_type                 text,                              -- planning permission, full, S36 etc.
  app_size                 text,                              -- PlanIt's size category

  -- Provenance — direct link to the LPA's portal so analysts can verify
  lpa_portal_url           text,                              -- the actual application page on the LPA portal
  planit_url               text,                              -- the PlanIt aggregator page
  raw_planit_response      jsonb,                             -- full record kept for audit + future fields

  -- Cache management
  fetched_at               timestamptz DEFAULT now(),
  fetch_status             text NOT NULL DEFAULT 'success'
                              CHECK (fetch_status IN ('success','not_found','error','manual')),
  fetch_error              text,

  UNIQUE (planning_authority, planning_ref)
);

CREATE INDEX IF NOT EXISTS planning_applications_applicant_idx
  ON planning_applications(applicant_name);
CREATE INDEX IF NOT EXISTS planning_applications_status_idx
  ON planning_applications(fetch_status);

-- ── Replace the convenience view to expose applicant ────────────────────

DROP VIEW IF EXISTS repd_operational_onshore_wind_v;

CREATE VIEW repd_operational_onshore_wind_v AS
SELECT
  e.repd_ref_id,
  e.site_name                       AS project_name,
  e.installed_capacity_mw           AS mw,
  e.country,
  e.region,
  e.local_planning_authority,
  e.operator                        AS repd_operator,        -- whatever REPD says
  p.applicant_name                  AS planning_applicant,   -- ★ the actual SPV from the consent
  p.lpa_portal_url                  AS planning_portal_url,
  p.decision                        AS planning_decision,
  p.decision_date                   AS planning_decision_date,
  e.developer,
  e.planning_application_ref,
  e.operational_date,
  a.latitude,
  a.longitude,
  -- Already-curated link (NULL until uk_wind_spv_universe row exists)
  u.ch_company_number,
  u.ch_company_name,
  u.confidence                      AS bridge_confidence
FROM repd_project_extras e
LEFT JOIN assets a
  ON  a.external_id = e.repd_ref_id
  AND a.source_type = 'REPD'
LEFT JOIN uk_wind_spv_universe u
  ON  u.repd_id = e.repd_ref_id
LEFT JOIN planning_applications p
  ON  p.planning_authority = e.local_planning_authority
  AND p.planning_ref       = e.planning_application_ref
WHERE e.technology_type = 'Wind Onshore'
  AND e.development_status_short ILIKE '%operational%'
  AND e.installed_capacity_mw >= 10
ORDER BY e.installed_capacity_mw DESC;

-- ── RLS ───────────────────────────────────────────────────────────────

ALTER TABLE planning_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_planning_applications" ON planning_applications;
CREATE POLICY "read_planning_applications" ON planning_applications
  FOR SELECT USING (true);

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_035_planning_applications', 'success', NOW(), NOW(),
  0,
  'Migration 035 — planning_applications cache + view extension',
  'Schema-only. Run fetch_planning_applications.py to populate from PlanIt aggregator.'
);
