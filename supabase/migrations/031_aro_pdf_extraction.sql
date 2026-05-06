-- Migration 031 — Operator-PDF + LLM ARO extraction storage
--
-- Why this exists: Companies House serves most of our watchlist as PDFs
-- (large companies file PDF-only; iXBRL is mostly a small-filer regime).
-- Provision balances are buried in the "Provisions for liabilities" note
-- typically 1-3 pages of a 100-300 page report. We:
--
--   1. Download the PDF from CH Document API
--   2. Extract per-page text via pdfplumber
--   3. Identify pages mentioning decommission / restoration / asset
--      retirement / dilapidation
--   4. Send those pages to Claude with a forced tool-use schema
--   5. Persist the structured tool input to aro_extractions
--   6. Manual review → promotion to aro_provisions (curated truth table)
--
-- The flow is intentionally NOT auto-promote. LLM extraction is reliable
-- enough to surface candidates but not yet trusted enough to write
-- directly to the curated table operators see in the panel.

-- ── (1) Downloaded PDF index ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS aro_pdf_filings (
  id                 bigserial PRIMARY KEY,
  company_number     text NOT NULL REFERENCES ch_companies_watch(company_number) ON DELETE CASCADE,
  transaction_id     text NOT NULL,
  period_end         date,
  date_filed         date,
  document_url       text,                            -- CH metadata URL
  num_pages          integer,
  relevant_pages     int[],                           -- pages where decom keyword hit
  downloaded_at      timestamptz DEFAULT now(),
  UNIQUE (company_number, transaction_id)
);

CREATE INDEX IF NOT EXISTS aro_pdf_filings_company_idx
  ON aro_pdf_filings(company_number, period_end DESC);

-- ── (2) LLM extraction output ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS aro_extractions (
  id                                bigserial PRIMARY KEY,
  filing_id                         bigint NOT NULL REFERENCES aro_pdf_filings(id) ON DELETE CASCADE,
  company_number                    text NOT NULL REFERENCES ch_companies_watch(company_number) ON DELETE CASCADE,

  -- Period
  period_end                        date,
  prior_period_end                  date,

  -- Currency / scale
  currency                          text,             -- 'GBP', 'EUR', 'USD', 'DKK', 'SEK'
  scale                             text,             -- 'raw', 'thousands', 'millions'

  -- Headline balances
  decom_provision_amount            numeric,          -- in `currency` × `scale` = display amount
  decom_provision_amount_raw        numeric,          -- normalised to base units (raw)
  prior_decom_provision_amount      numeric,
  prior_decom_provision_amount_raw  numeric,

  -- Movement (current year, optional)
  movement_recognised_in_year       numeric,
  movement_settled_in_year          numeric,
  movement_unwinding_discount       numeric,
  movement_fx                       numeric,

  -- Disclosure quality flags
  is_separately_disclosed           boolean,          -- TRUE if decom provision shown on its own line
  is_aggregated_in_other            boolean,          -- TRUE if bundled in "other provisions"
  no_decom_provision_found          boolean,          -- TRUE if AR genuinely doesn't disclose

  decom_concept_label               text,             -- e.g. "Decommissioning provision", "Site restoration"

  -- Provenance
  source_quote                      text,             -- 1-2 sentence verbatim from the PDF
  source_page                       integer,
  confidence                        text CHECK (confidence IN ('high','medium','low')),
  notes                             text,

  -- Operational
  model_name                        text,             -- e.g. "claude-haiku-4-5"
  raw_tool_input                    jsonb,            -- complete LLM tool input for audit
  prompt_token_count                integer,
  completion_token_count            integer,
  extracted_at                      timestamptz DEFAULT now(),

  -- Review workflow
  review_status                     text NOT NULL DEFAULT 'pending'
                                      CHECK (review_status IN
                                        ('pending','approved','rejected','superseded')),
  reviewed_by                       text,
  reviewed_at                       timestamptz,
  promoted_to_aro_provisions_id     uuid REFERENCES aro_provisions(id) ON DELETE SET NULL,

  UNIQUE (filing_id, model_name)
);

CREATE INDEX IF NOT EXISTS aro_extractions_company_idx        ON aro_extractions(company_number, period_end DESC);
CREATE INDEX IF NOT EXISTS aro_extractions_review_status_idx  ON aro_extractions(review_status);

-- ── (3) View: most recent extraction per company, pending review ───────

DROP VIEW IF EXISTS aro_extractions_pending_v;

CREATE VIEW aro_extractions_pending_v AS
WITH ranked AS (
  SELECT
    x.*,
    w.company_name,
    w.parent_group,
    w.asset_class,
    ROW_NUMBER() OVER (
      PARTITION BY x.company_number
      ORDER BY x.period_end DESC NULLS LAST, x.extracted_at DESC
    ) AS rn
  FROM aro_extractions x
  JOIN ch_companies_watch w ON w.company_number = x.company_number
  WHERE x.review_status = 'pending'
)
SELECT * FROM ranked WHERE rn = 1;

-- ── RLS ────────────────────────────────────────────────────────────────

ALTER TABLE aro_pdf_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE aro_extractions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_aro_pdf_filings" ON aro_pdf_filings;
DROP POLICY IF EXISTS "read_aro_extractions" ON aro_extractions;

CREATE POLICY "read_aro_pdf_filings" ON aro_pdf_filings FOR SELECT USING (true);
CREATE POLICY "read_aro_extractions" ON aro_extractions FOR SELECT USING (true);

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_031_aro_pdf_extraction', 'success', NOW(), NOW(),
  0,
  'Migration 031 — aro_pdf_filings + aro_extractions',
  'Storage scaffolding for operator-PDF + LLM ARO extraction. Run extract_aro_from_pdfs.py to populate.'
);
