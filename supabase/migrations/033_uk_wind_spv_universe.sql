-- Migration 033 — UK wind SPV universe (the bridge table)
--
-- The architectural pivot: rather than scraping filings blind, we build the
-- evidence-chain bridge from project to legal entity FIRST. Every downstream
-- ARO extraction targets this universe; nothing scrapes a CH number we
-- haven't deliberately confirmed via documentary evidence.
--
-- Evidence chain (≥2 independent legs = high confidence):
--
--   REPD project ─┬─→ TEC Register applicant      → CH name search → CH#
--                 ├─→ CfD register holder          → CH#
--                 ├─→ RO accreditation operator    → CH#
--                 └─→ Planning permit applicant    → CH#
--                                                     ↓
--                                          CH charges register query
--                                                     ↓
--                                charge description references project?
--                                                     ↓
--                                           confidence tier assigned
--
-- Confidence tiers:
--   very_high — ≥2 independent sources name the same SPV CH#
--               AND CH charges register has a debenture whose description
--               references the project name or location.
--   high     — Either ≥2 sources agree on SPV with no charge confirmation,
--               OR 1 source + a charge confirms the project link.
--   medium   — 1 source names an SPV; no charge corroboration.
--   low      — Project name → CH name search only (NOT acceptable for
--               production use — listed only to flag analyst review needed).
--   failed   — No SPV identifiable; analyst review queue.
--
-- This is a curation table — populated by analyst research, not by a
-- scraper. The scrapers come later and operate ON this universe.

CREATE TABLE IF NOT EXISTS uk_wind_spv_universe (
  -- ── Project identity ─────────────────────────────────────────────────
  project_name              text PRIMARY KEY,           -- canonical name
  repd_id                   text,                       -- REPD record ref
  mw_consented              numeric,                    -- from REPD
  mw_installed              numeric,                    -- from CfD/RO/published
                                                        -- — preferred for £/MW
  technology                text NOT NULL DEFAULT 'onshore_wind'
                                CHECK (technology IN ('onshore_wind','offshore_wind',
                                                       'solar_pv','bess')),
  status                    text CHECK (status IN
                                ('operational','under_construction',
                                 'consented','planning','decommissioned','cancelled')),
  country                   text CHECK (country IN ('England','Scotland','Wales','Northern Ireland')),
  local_planning_authority  text,
  operational_date          date,

  -- ── The bridge (the actual product) ──────────────────────────────────
  ch_company_number         text,                        -- the SPV
  ch_company_name           text,
  entity_level              text CHECK (entity_level IN
                                ('spv','holdco','listed_parent','operator_imprint',
                                 'unknown')),

  -- ── Evidence chain ───────────────────────────────────────────────────
  -- evidence is an array of structured proofs:
  --   [{source: 'tec_register' | 'cfd_register' | 'ro_register'
  --              | 'planning_consent' | 'press' | 'company_website'
  --              | 'analyst_inference',
  --     applicant_name: text,
  --     entity_named:   text,             -- as written in the source doc
  --     reference:      text,             -- planning ref / TEC id / CfD id
  --     url:            text,
  --     evidence_date:  date,
  --     notes:          text}]
  evidence                  jsonb,
  ch_charge_confirmed       boolean DEFAULT false,
  ch_charge_evidence        jsonb,                       -- {charge_id, description_excerpt, registered_date, persons_entitled}

  -- ── Confidence ───────────────────────────────────────────────────────
  confidence                text NOT NULL DEFAULT 'failed'
                                CHECK (confidence IN
                                  ('very_high','high','medium','low','failed')),
  confidence_rationale      text,
  last_verified             date,
  verified_by               text,                        -- analyst initials

  -- ── Filings outcome (populated by downstream extractor) ──────────────
  filings_have_ixbrl        boolean,                     -- TRUE = iXBRL accounts exist for SPV
  filings_have_pdf          boolean,
  last_decom_provision      numeric,                     -- in GBP, raw units
  last_provision_period     date,
  disclosure_quality        text CHECK (disclosure_quality IN
                                ('explicit','inferred','absent','not_applicable')),
  disclosure_entity_level   text CHECK (disclosure_entity_level IN
                                ('spv','parent','none')),

  -- ── Operational ──────────────────────────────────────────────────────
  notes                     text,
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS uk_wind_spv_universe_ch_idx
  ON uk_wind_spv_universe(ch_company_number)
  WHERE ch_company_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS uk_wind_spv_universe_confidence_idx
  ON uk_wind_spv_universe(confidence);

CREATE INDEX IF NOT EXISTS uk_wind_spv_universe_status_idx
  ON uk_wind_spv_universe(status, technology);

-- ── Coverage view: how built-out is the universe? ─────────────────────

DROP VIEW IF EXISTS uk_wind_spv_coverage_v;

CREATE VIEW uk_wind_spv_coverage_v AS
SELECT
  technology,
  country,
  status,
  confidence,
  COUNT(*)                                                          AS n_projects,
  ROUND(SUM(COALESCE(mw_installed, mw_consented, 0))::numeric, 0)   AS total_mw,
  COUNT(*) FILTER (WHERE ch_company_number IS NOT NULL)             AS with_ch,
  COUNT(*) FILTER (WHERE ch_charge_confirmed)                       AS with_charge_confirm,
  COUNT(*) FILTER (WHERE last_decom_provision IS NOT NULL)          AS with_provision_extracted
FROM uk_wind_spv_universe
GROUP BY technology, country, status, confidence
ORDER BY technology, country, status, confidence;

-- ── £/MW benchmark view (production use, once data exists) ────────────

DROP VIEW IF EXISTS uk_wind_aro_per_mw_v;

CREATE VIEW uk_wind_aro_per_mw_v AS
SELECT
  project_name,
  ch_company_name,
  ch_company_number,
  technology,
  country,
  COALESCE(mw_installed, mw_consented) AS mw,
  last_provision_period,
  last_decom_provision,
  CASE
    WHEN COALESCE(mw_installed, mw_consented, 0) > 0 AND last_decom_provision IS NOT NULL
      THEN ROUND((last_decom_provision / COALESCE(mw_installed, mw_consented))::numeric, 0)
    ELSE NULL
  END AS gbp_per_mw,
  disclosure_quality,
  confidence
FROM uk_wind_spv_universe
WHERE confidence IN ('very_high','high','medium')
  AND last_decom_provision IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────────────

ALTER TABLE uk_wind_spv_universe ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_uk_wind_spv_universe" ON uk_wind_spv_universe;
CREATE POLICY "read_uk_wind_spv_universe" ON uk_wind_spv_universe
  FOR SELECT USING (true);

-- ── Telemetry ─────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_033_uk_wind_spv_universe', 'success', NOW(), NOW(),
  0,
  'Migration 033 — uk_wind_spv_universe schema',
  'Schema-only. Hand-curate 5 seed rows from REPD operational onshore wind ≥10 MW, then build extractor over confirmed entities.'
);

-- ─────────────────────────────────────────────────────────────────────
-- ANALYST CURATION TEMPLATE
-- ─────────────────────────────────────────────────────────────────────
-- Copy/paste the block below for each new SPV. Fill in evidence as you
-- collect it. Status field marks rows that are works-in-progress.
--
-- Example (fictitious — replace):
--
-- INSERT INTO uk_wind_spv_universe (
--   project_name, repd_id, mw_consented, mw_installed, technology, status,
--   country, local_planning_authority, operational_date,
--   ch_company_number, ch_company_name, entity_level,
--   evidence, ch_charge_confirmed, ch_charge_evidence,
--   confidence, confidence_rationale, last_verified, verified_by
-- ) VALUES (
--   'Example Wind Farm',
--   'REPD-12345',
--   24, 24, 'onshore_wind', 'operational',
--   'Scotland', 'East Lothian Council', '2018-06-15',
--   '01234567', 'Example Wind Farm Limited', 'spv',
--   '[
--     {"source":"tec_register","applicant_name":"Example Wind Farm Limited",
--      "entity_named":"Example Wind Farm Limited","reference":"TEC-2014-001",
--      "url":"https://www.nationalgrideso.com/...","evidence_date":"2014-03-01"},
--     {"source":"cfd_register","applicant_name":"Example Wind Farm Limited",
--      "entity_named":"Example Wind Farm Limited","reference":"CfD-AR2-024",
--      "url":"https://www.lowcarboncontracts.uk/...","evidence_date":"2017-09-11"},
--     {"source":"planning_consent","applicant_name":"Example Wind Farm Ltd",
--      "entity_named":"Example Wind Farm Ltd","reference":"E/2014/0567/F",
--      "url":"https://...","evidence_date":"2015-02-28"}
--   ]'::jsonb,
--   true,
--   '{"charge_id":"01234567-0001","description_excerpt":"Debenture over Example Wind Farm assets including turbines T1-T8 and grid connection",
--     "registered_date":"2017-12-01","persons_entitled":"Lloyds Bank plc"}'::jsonb,
--   'very_high',
--   'TEC + CfD + planning consent name same Ltd; CH charge debenture references project assets',
--   current_date,
--   'AG'
-- );
--
-- ─────────────────────────────────────────────────────────────────────
