-- Migration 038 — Operator IR-site PDF extraction (parallel to CH path)
--
-- The pivot from the CH-SPV path: rather than extracting ARO from
-- subsidiary SPV filings (often scanned, often abridged, often filed at
-- parent group level instead), we extract from the **consolidated annual
-- reports published on operator investor-relations sites**.
--
-- These PDFs are publication-grade (always have a text layer), have
-- proper Provisions notes (group-level IAS 37 disclosure), and cover
-- the full estate of operating wind/solar/BESS assets in one document.
--
-- Trade-off: smaller universe (~15-25 major operators vs ~200 SPVs),
-- but much higher information density per row and zero PDF-extraction
-- friction. Coverage is by-operator not by-site, so the £/MW metric is
-- group-weighted, not site-weighted.
--
-- Architecture mirrors the CH path so the same Claude tool-use schema
-- and pdf_structure.py module are reused. aro_extractions becomes
-- polymorphic: a row can come from either ch_company OR operator_ir,
-- distinguished by which of the two FKs is populated.

-- ── (1) Curated operator IR sources ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS operator_ir_sources (
  id                       bigserial PRIMARY KEY,
  operator_name            text NOT NULL,                 -- canonical name, e.g. "Ørsted A/S"
  parent_group             text,                          -- ultimate listed parent
  country                  text NOT NULL,                 -- domicile of parent
  asset_classes            text[] NOT NULL,               -- ['onshore_wind','offshore_wind','solar_pv','bess']
  capacity_mw_estimate     numeric,                       -- denominator for £/MW
  capacity_year            integer,                       -- year the MW estimate refers to

  -- URLs
  ir_landing_url           text,                          -- IR page (periodic URL refresh)
  latest_ar_url            text,                          -- direct PDF URL (operator publishes new annually)
  latest_ar_year           integer,
  latest_ar_published_date date,

  -- Audit
  last_checked             date,
  notes                    text,
  created_at               timestamptz DEFAULT now(),

  UNIQUE (operator_name, latest_ar_year)
);

CREATE INDEX IF NOT EXISTS operator_ir_sources_country_idx
  ON operator_ir_sources(country);

-- ── (2) Downloaded PDF index for IR sources ────────────────────────────

CREATE TABLE IF NOT EXISTS ir_pdf_filings (
  id                       bigserial PRIMARY KEY,
  operator_ir_source_id    bigint NOT NULL REFERENCES operator_ir_sources(id) ON DELETE CASCADE,
  document_url             text NOT NULL,
  reporting_period         text,                          -- 'FY2024' / 'H1 2024'
  reporting_period_end     date,
  num_pages                integer,
  relevant_pages           int[],                         -- 1-indexed pages where notes were located
  downloaded_at            timestamptz DEFAULT now(),
  download_status          text DEFAULT 'success'
                              CHECK (download_status IN ('success','not_found','error','manual')),
  download_error           text,

  UNIQUE (operator_ir_source_id, document_url)
);

CREATE INDEX IF NOT EXISTS ir_pdf_filings_operator_idx
  ON ir_pdf_filings(operator_ir_source_id, reporting_period_end DESC);

-- ── (3) Extend aro_extractions to support IR-source rows ───────────────
--
-- Polymorphic source pattern: exactly one of (filing_id, ir_pdf_filing_id)
-- is populated. company_number relaxes from NOT NULL to nullable; for
-- IR-derived extractions there is no per-SPV company number.

ALTER TABLE aro_extractions
  ADD COLUMN IF NOT EXISTS ir_pdf_filing_id bigint
    REFERENCES ir_pdf_filings(id) ON DELETE CASCADE;

ALTER TABLE aro_extractions
  ALTER COLUMN filing_id      DROP NOT NULL,
  ALTER COLUMN company_number DROP NOT NULL;

-- Constraint: exactly one of the two source FKs must be set
ALTER TABLE aro_extractions
  DROP CONSTRAINT IF EXISTS aro_extractions_one_source_chk;
ALTER TABLE aro_extractions
  ADD CONSTRAINT aro_extractions_one_source_chk
    CHECK (
      (filing_id IS NOT NULL AND ir_pdf_filing_id IS NULL) OR
      (filing_id IS NULL     AND ir_pdf_filing_id IS NOT NULL)
    );

-- ── (4) Convenience view: IR-source extractions ready for review ───────

DROP VIEW IF EXISTS ir_aro_extractions_v;

CREATE VIEW ir_aro_extractions_v AS
SELECT
  s.operator_name,
  s.parent_group,
  s.country,
  s.asset_classes,
  s.capacity_mw_estimate,
  s.latest_ar_year,
  x.period_end,
  x.currency,
  x.scale,
  x.decom_provision_amount,
  x.decom_provision_amount_raw,
  x.decom_concept_label,
  x.is_separately_disclosed,
  x.is_aggregated_in_other,
  x.no_decom_provision_found,
  x.ppe_decom_addition_present,
  x.source_quote,
  x.source_page,
  x.confidence,
  x.notes,
  x.review_status,
  x.extracted_at,
  -- Computed: GBP-equivalent ÷ MW (illustrative; FX not applied here)
  CASE
    WHEN x.decom_provision_amount_raw IS NOT NULL
     AND s.capacity_mw_estimate > 0
    THEN ROUND((x.decom_provision_amount_raw / s.capacity_mw_estimate)::numeric, 0)
    ELSE NULL
  END AS provision_per_mw_native_currency,
  f.document_url,
  f.reporting_period_end
FROM aro_extractions x
JOIN ir_pdf_filings f      ON f.id = x.ir_pdf_filing_id
JOIN operator_ir_sources s ON s.id = f.operator_ir_source_id
ORDER BY x.extracted_at DESC;

-- ── (5) RLS ───────────────────────────────────────────────────────────

ALTER TABLE operator_ir_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE ir_pdf_filings      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_operator_ir_sources" ON operator_ir_sources;
DROP POLICY IF EXISTS "read_ir_pdf_filings"      ON ir_pdf_filings;

CREATE POLICY "read_operator_ir_sources" ON operator_ir_sources FOR SELECT USING (true);
CREATE POLICY "read_ir_pdf_filings"      ON ir_pdf_filings      FOR SELECT USING (true);

-- ── (6) Seed: known relevant operators (latest_ar_url left NULL) ───────
--
-- URLs rotate annually, so we don't hardcode them here. After running
-- this migration, populate latest_ar_url for each operator by visiting
-- the ir_landing_url and copying the link to the latest annual report PDF.
-- The extractor reads whatever URL is in the column.

INSERT INTO operator_ir_sources
  (operator_name, parent_group, country, asset_classes, capacity_mw_estimate, capacity_year,
   ir_landing_url, latest_ar_url, latest_ar_year, notes)
VALUES
  ('Greencoat UK Wind PLC',     'Greencoat Capital',    'United Kingdom',
   ARRAY['onshore_wind','offshore_wind'], 2050, 2024,
   'https://www.greencoat-ukwind.com/investors/financial-results/results-and-reports',
   NULL, NULL,
   'PRIMARY VALIDATION CANDIDATE — we hand-curated their FY2024 ARO note as £36m of asset-retirement bonds across 20 sites; extractor result should match.'),

  ('Ørsted A/S',                'Ørsted A/S',           'Denmark',
   ARRAY['offshore_wind','onshore_wind','solar_pv','bess'], 17000, 2024,
   'https://orsted.com/en/investors/ir-material/financial-reports-and-presentations',
   NULL, NULL,
   'Already curated by hand at FY2024 (DKK 9,347m offshore_wind ARO from segment disclosure p.193) — second validation candidate.'),

  ('SSE plc',                   'SSE plc',              'United Kingdom',
   ARRAY['onshore_wind','offshore_wind','solar_pv','bess'], 6800, 2024,
   'https://www.sse.com/investors/results-and-reports/',
   NULL, NULL,
   'Major UK operator, listed PLC; consolidated AR has clean Provisions note.'),

  ('RWE AG',                    'RWE AG',               'Germany',
   ARRAY['onshore_wind','offshore_wind','solar_pv','bess'], 41000, 2024,
   'https://www.rwe.com/en/investor-relations/financial-calendar-publications-events/financial-publications',
   NULL, NULL,
   'German listed parent; AR is full IFRS with detailed decom note. URL pattern is annual.'),

  ('Vattenfall AB',             'Vattenfall AB',        'Sweden',
   ARRAY['onshore_wind','offshore_wind','solar_pv','bess'], 11000, 2024,
   'https://group.vattenfall.com/who-we-are/investors/financial-reports',
   NULL, NULL,
   'Swedish state-owned; comprehensive ARO disclosure including nuclear (filter to renewable only via segment note).');

-- ── (7) Telemetry ──────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_038_operator_ir_pdf_extraction', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM operator_ir_sources),
  'Migration 038 — operator_ir_sources + ir_pdf_filings + aro_extractions polymorphic',
  'Schema for the IR-PDF pivot. Seeded 5 operator rows with NULL latest_ar_url — populate manually from each ir_landing_url, then run extract_aro_from_operator_ir.py.'
);
