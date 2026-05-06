-- Migration 034 — REPD project extras (operator, planning ref, evidence anchors)
--
-- The canonical `assets` table holds REPD's standard fields (name, capacity,
-- coordinates, dates) but doesn't capture the columns we need for SPV
-- bridging — operator name, planning reference, applicant, devolution
-- region, etc. Rather than bloat `assets` with REPD-specific fields, we
-- store them in a sibling table keyed on the REPD ref id.
--
-- Used by the uk_wind_spv_universe curation flow as the starting point for
-- the evidence chain (REPD project → operator name → CH name search).

CREATE TABLE IF NOT EXISTS repd_project_extras (
  repd_ref_id              text PRIMARY KEY,                  -- = assets.external_id when source_type='REPD'
  site_name                text,
  technology_type          text,
  storage_type             text,                              -- BESS sub-type when applicable
  installed_capacity_mw    numeric,
  development_status       text,                              -- "Operational", "Under Construction", "Awaiting Construction", "Application Submitted", etc.
  development_status_short text,                              -- the categorised version REPD also publishes

  -- Geographic context
  country                  text,                              -- "England" / "Scotland" / "Wales" / "Northern Ireland"
  region                   text,
  county                   text,
  local_planning_authority text,
  parliamentary_constituency text,

  -- Evidence-chain seed fields
  operator                 text,                              -- "Operator (or Applicant)" column
  developer                text,                              -- "Developer Name" if separately listed
  planning_application_ref text,                              -- "Planning Application Reference"
  planning_authority_decision_date date,
  planning_permission_expiry date,
  appeal_lodged            boolean,
  appeal_decision_date     date,

  -- Operational dates
  under_construction_date  date,
  operational_date         date,

  -- Connections / scheme
  ro_banding               text,
  cfd_capacity_mw          numeric,
  heat_network_ref         text,
  storage_co_located       boolean,

  -- Audit
  source_url               text,                              -- where the row was sourced
  source_publication       text,                              -- e.g. 'REPD_Publication_Q4_2025.xlsx'
  source_date              date NOT NULL,
  ingested_at              timestamptz DEFAULT now(),

  CONSTRAINT repd_extras_capacity_nonneg CHECK (installed_capacity_mw IS NULL OR installed_capacity_mw >= 0)
);

CREATE INDEX IF NOT EXISTS repd_extras_status_tech_idx
  ON repd_project_extras(development_status_short, technology_type);
CREATE INDEX IF NOT EXISTS repd_extras_country_idx
  ON repd_project_extras(country);
CREATE INDEX IF NOT EXISTS repd_extras_operator_idx
  ON repd_project_extras(operator);

-- ── Convenience view: REPD operational onshore wind ≥10 MW ─────────────
-- This is the primary input to the uk_wind_spv_universe curation flow.

DROP VIEW IF EXISTS repd_operational_onshore_wind_v;

CREATE VIEW repd_operational_onshore_wind_v AS
SELECT
  e.repd_ref_id,
  e.site_name                       AS project_name,
  e.installed_capacity_mw           AS mw,
  e.country,
  e.region,
  e.local_planning_authority,
  e.operator,
  e.developer,
  e.planning_application_ref,
  e.operational_date,
  a.latitude,
  a.longitude,
  -- Already-curated link (NULL until uk_wind_spv_universe row exists)
  u.ch_company_number,
  u.confidence                      AS bridge_confidence
FROM repd_project_extras e
LEFT JOIN assets a
  ON  a.external_id = e.repd_ref_id
  AND a.source_type = 'REPD'
LEFT JOIN uk_wind_spv_universe u
  ON  u.repd_id = e.repd_ref_id
WHERE e.technology_type = 'Wind Onshore'
  AND e.development_status_short ILIKE '%operational%'
  AND e.installed_capacity_mw >= 10
ORDER BY e.installed_capacity_mw DESC;

-- ── RLS ───────────────────────────────────────────────────────────────

ALTER TABLE repd_project_extras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_repd_project_extras" ON repd_project_extras;
CREATE POLICY "read_repd_project_extras" ON repd_project_extras
  FOR SELECT USING (true);

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_034_repd_project_extras', 'success', NOW(), NOW(),
  0,
  'Migration 034 — repd_project_extras schema',
  'Schema-only. Populate by re-running ingest_repd.py after extending it to capture operator + planning_ref + status fields.'
);
