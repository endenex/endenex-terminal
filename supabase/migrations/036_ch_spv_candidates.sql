-- Migration 036 — Companies House SPV candidate discovery
--
-- For each REPD project with planning-applicant data, find candidate
-- SPVs at Companies House and score them by (a) name similarity to the
-- project, (b) charges that reference the project. The analyst then
-- picks the right SPV from the top-ranked candidates and writes the
-- final row to uk_wind_spv_universe.
--
-- Two tables:
--   ch_spv_candidates       — every CH company we considered, with score
--   ch_spv_candidate_charges — the charges register for each candidate
--                               (separate table because each candidate
--                               can have many charges)

CREATE TABLE IF NOT EXISTS ch_spv_candidates (
  id                       bigserial PRIMARY KEY,
  repd_ref_id              text NOT NULL,                     -- = repd_project_extras.repd_ref_id
  search_strategy          text NOT NULL,                     -- which query produced this hit:
                                                              --   project_name_exact / project_name_wf /
                                                              --   project_name_wind / applicant_name /
                                                              --   project_locality
  search_query             text NOT NULL,                     -- the actual string searched

  -- CH company data
  ch_company_number        text NOT NULL,
  ch_company_name          text NOT NULL,
  ch_company_status        text,                              -- 'active'/'dissolved'/'liquidation'/etc.
  ch_company_type          text,                              -- 'ltd'/'plc'/'private-unlimited'
  date_of_creation         date,
  date_of_cessation        date,
  registered_office_address text,

  -- Scoring
  name_match_score         numeric,                           -- 0–100 (token similarity to project_name)
  charge_match_score       numeric,                           -- 0–100 (charges that mention project)
  charges_count            integer,
  charges_with_project_match integer,
  combined_confidence      numeric,                           -- weighted blend, 0–100
  best_charge_description  text,                              -- excerpt of the strongest matching charge

  -- Audit
  raw_company_response     jsonb,
  discovered_at            timestamptz DEFAULT now(),

  UNIQUE (repd_ref_id, ch_company_number)
);

CREATE INDEX IF NOT EXISTS ch_spv_candidates_repd_idx
  ON ch_spv_candidates(repd_ref_id, combined_confidence DESC);
CREATE INDEX IF NOT EXISTS ch_spv_candidates_status_idx
  ON ch_spv_candidates(ch_company_status);


CREATE TABLE IF NOT EXISTS ch_spv_candidate_charges (
  id                       bigserial PRIMARY KEY,
  candidate_id             bigint NOT NULL REFERENCES ch_spv_candidates(id) ON DELETE CASCADE,
  ch_company_number        text NOT NULL,
  ch_charge_id             text NOT NULL,                     -- CH charge id e.g. "01234567-0001"
  classification           text,                              -- "Charge", "Mortgage", "Debenture"
  status                   text,                              -- "outstanding"/"satisfied"/"part-satisfied"
  description              text,                              -- the GOLD field — often names the project
  persons_entitled         jsonb,                             -- list of lender/charge-holder names
  charge_code              text,
  delivered_on             date,
  created_on               date,
  satisfied_on             date,
  references_project       boolean DEFAULT false,             -- TRUE if description matches project tokens
  raw_charge_response      jsonb,

  UNIQUE (candidate_id, ch_charge_id)
);

CREATE INDEX IF NOT EXISTS ch_spv_candidate_charges_candidate_idx
  ON ch_spv_candidate_charges(candidate_id);
CREATE INDEX IF NOT EXISTS ch_spv_candidate_charges_refs_proj_idx
  ON ch_spv_candidate_charges(references_project)
  WHERE references_project = true;


-- ── Analyst-review view: top 3 candidates per project ─────────────────

DROP VIEW IF EXISTS ch_spv_candidate_review_v;

CREATE VIEW ch_spv_candidate_review_v AS
WITH ranked AS (
  SELECT
    c.repd_ref_id,
    e.site_name                  AS project_name,
    e.installed_capacity_mw      AS mw,
    e.country,
    e.local_planning_authority,
    p.applicant_name             AS planning_applicant,
    c.ch_company_number,
    c.ch_company_name,
    c.ch_company_status,
    c.date_of_creation,
    c.search_strategy,
    c.name_match_score,
    c.charge_match_score,
    c.charges_count,
    c.charges_with_project_match,
    c.combined_confidence,
    c.best_charge_description,
    ROW_NUMBER() OVER (
      PARTITION BY c.repd_ref_id
      ORDER BY c.combined_confidence DESC, c.name_match_score DESC
    ) AS rank
  FROM ch_spv_candidates c
  JOIN repd_project_extras e ON e.repd_ref_id = c.repd_ref_id
  LEFT JOIN planning_applications p
    ON  p.planning_authority = e.local_planning_authority
    AND p.planning_ref       = e.planning_application_ref
)
SELECT * FROM ranked WHERE rank <= 3 ORDER BY mw DESC, repd_ref_id, rank;


-- ── RLS ───────────────────────────────────────────────────────────────

ALTER TABLE ch_spv_candidates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ch_spv_candidate_charges  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_ch_spv_candidates" ON ch_spv_candidates;
DROP POLICY IF EXISTS "read_ch_spv_candidate_charges" ON ch_spv_candidate_charges;

CREATE POLICY "read_ch_spv_candidates"        ON ch_spv_candidates        FOR SELECT USING (true);
CREATE POLICY "read_ch_spv_candidate_charges" ON ch_spv_candidate_charges FOR SELECT USING (true);

-- ── Telemetry ─────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_036_ch_spv_candidates', 'success', NOW(), NOW(),
  0,
  'Migration 036 — ch_spv_candidates + ch_spv_candidate_charges',
  'Schema-only. Run find_spv_candidates.py to populate.'
);
