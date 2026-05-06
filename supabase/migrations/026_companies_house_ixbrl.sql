-- Migration 026 — Companies House iXBRL provision scraper storage
--
-- The UK Companies House Document API publishes filed accounts as iXBRL
-- (inline XBRL) — HTML with embedded XBRL tags. Every UK wind/solar
-- operator subsidiary or SPV files annual accounts here, and most disclose
-- a decommissioning provision in the "Provisions for liabilities" note.
--
-- This migration stores three layers:
--   ch_companies_watch — curated watchlist of UK company numbers we track
--   ch_filings         — raw filing metadata (one row per accounts filing)
--   ch_provisions      — extracted provision balances (one row per tag value)
--
-- The scraper (ingestion/sync_companies_house_ixbrl.py) walks the watchlist,
-- fetches the most recent annual accounts (filing type "AA"), downloads the
-- iXBRL document, parses <ix:nonFraction> tags whose `name` attribute
-- matches known FRS 102 / IFRS provision concepts, and upserts to the
-- ch_provisions table.

-- ── Watchlist of tracked UK companies ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS ch_companies_watch (
  company_number     text PRIMARY KEY,                -- e.g. "06035334"
  company_name       text NOT NULL,
  parent_group       text,                            -- "RWE", "ScottishPower", etc.
  asset_class        text CHECK (asset_class IN
                       ('onshore_wind','offshore_wind','solar_pv','bess','mixed','utility_parent')),
  capacity_mw        numeric,
  region             text,                            -- "UK", "Scotland", "England"
  notes              text,
  last_synced        timestamptz,
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ch_companies_watch_group_idx
  ON ch_companies_watch(parent_group);

-- ── Raw filing metadata (one row per accounts filing) ──────────────────────

CREATE TABLE IF NOT EXISTS ch_filings (
  id                 bigserial PRIMARY KEY,
  company_number     text NOT NULL REFERENCES ch_companies_watch(company_number) ON DELETE CASCADE,
  transaction_id     text NOT NULL,                   -- CH transaction id (unique key)
  filing_type        text NOT NULL,                   -- "AA" = annual accounts
  filing_subtype     text,                            -- "FULL", "MEDIUM", "SMALL", etc.
  date_filed         date,
  period_end         date,
  document_url       text,                            -- iXBRL document API URL
  ixbrl_present      boolean DEFAULT false,
  pages              integer,
  fetched_at         timestamptz DEFAULT now(),
  parse_status       text DEFAULT 'pending'           -- pending / success / no_provisions / error
                       CHECK (parse_status IN
                         ('pending','success','no_provisions','error')),
  parse_error        text,
  UNIQUE (company_number, transaction_id)
);

CREATE INDEX IF NOT EXISTS ch_filings_company_idx       ON ch_filings(company_number, period_end DESC);
CREATE INDEX IF NOT EXISTS ch_filings_parse_status_idx  ON ch_filings(parse_status);

-- ── Extracted provision balances ──────────────────────────────────────────
-- One row per (filing × XBRL concept × period). A single filing typically
-- yields 2-4 rows (current year + prior year × current/non-current split).

CREATE TABLE IF NOT EXISTS ch_provisions (
  id                 bigserial PRIMARY KEY,
  company_number     text NOT NULL REFERENCES ch_companies_watch(company_number) ON DELETE CASCADE,
  filing_id          bigint NOT NULL REFERENCES ch_filings(id) ON DELETE CASCADE,
  concept_name       text NOT NULL,                   -- e.g. "uk-bus:ProvisionsForDecommissioningCosts"
  concept_label      text,                            -- human-readable
  taxonomy           text,                            -- "frs-102" / "ifrs-full" / "uk-bus" / "uk-gaap"
  period_end         date NOT NULL,                   -- the XBRL context period end
  value_gbp          numeric,                         -- normalised to GBP (CH filings are GBP by default)
  currency           text DEFAULT 'GBP',
  decimals           integer,                         -- iXBRL decimals attribute (-3 = thousands, etc.)
  is_provision       boolean DEFAULT true,            -- true = provision balance, false = movement
  context_ref        text,                            -- raw XBRL context id (for debugging)
  extracted_at       timestamptz DEFAULT now(),
  UNIQUE (filing_id, concept_name, period_end, context_ref)
);

CREATE INDEX IF NOT EXISTS ch_provisions_company_idx   ON ch_provisions(company_number, period_end DESC);
CREATE INDEX IF NOT EXISTS ch_provisions_concept_idx   ON ch_provisions(concept_name);

-- ── Convenience view: most recent decom provision per company ──────────────

DROP VIEW IF EXISTS ch_latest_decom_provision_v;

CREATE VIEW ch_latest_decom_provision_v AS
WITH ranked AS (
  SELECT
    p.company_number,
    w.company_name,
    w.parent_group,
    w.asset_class,
    w.capacity_mw,
    p.period_end,
    p.value_gbp,
    p.concept_name,
    p.concept_label,
    p.taxonomy,
    f.date_filed,
    f.document_url,
    ROW_NUMBER() OVER (
      PARTITION BY p.company_number
      ORDER BY p.period_end DESC, p.value_gbp DESC NULLS LAST
    ) AS rn
  FROM ch_provisions p
  JOIN ch_companies_watch w ON w.company_number = p.company_number
  JOIN ch_filings f ON f.id = p.filing_id
  WHERE p.is_provision
    AND p.value_gbp IS NOT NULL
    AND (
      LOWER(p.concept_name) LIKE '%decommission%'
      OR LOWER(p.concept_name) LIKE '%dilapidation%'
      OR LOWER(p.concept_label) LIKE '%decommission%'
      OR LOWER(p.concept_label) LIKE '%restoration%'
      OR LOWER(p.concept_label) LIKE '%site restoration%'
    )
)
SELECT * FROM ranked WHERE rn = 1;

-- ── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE ch_companies_watch ENABLE ROW LEVEL SECURITY;
ALTER TABLE ch_filings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ch_provisions      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_ch_companies_watch" ON ch_companies_watch;
DROP POLICY IF EXISTS "read_ch_filings"         ON ch_filings;
DROP POLICY IF EXISTS "read_ch_provisions"      ON ch_provisions;

CREATE POLICY "read_ch_companies_watch" ON ch_companies_watch FOR SELECT USING (true);
CREATE POLICY "read_ch_filings"         ON ch_filings         FOR SELECT USING (true);
CREATE POLICY "read_ch_provisions"      ON ch_provisions      FOR SELECT USING (true);

-- ── Idempotent re-seed of watchlist ────────────────────────────────────────

DELETE FROM ch_companies_watch;

-- Seed: known UK renewable operator parent companies + selected SPVs.
-- Parent companies file consolidated accounts (large provision balances).
-- SPVs file unconsolidated SPV accounts (one wind farm = one company).
INSERT INTO ch_companies_watch
  (company_number, company_name, parent_group, asset_class, capacity_mw, region, notes)
VALUES
  -- ── Utility parents (consolidating, large provision balances) ─────────
  ('03879547', 'SCOTTISHPOWER RENEWABLES (UK) LIMITED',  'ScottishPower',  'utility_parent', NULL,  'UK',       'Iberdrola UK renewables holding'),
  ('03002248', 'RWE RENEWABLES UK LIMITED',              'RWE',            'utility_parent', NULL,  'UK',       'RWE UK onshore + offshore holding'),
  ('06035334', 'EDF ENERGY RENEWABLES LIMITED',          'EDF',            'utility_parent', NULL,  'UK',       'EDF UK onshore wind operator'),
  ('06205750', 'VATTENFALL WIND POWER LTD',              'Vattenfall',     'utility_parent', NULL,  'UK',       'Vattenfall UK onshore + offshore'),
  ('05566064', 'GREENCOAT UK WIND PLC',                  'Greencoat',      'utility_parent', NULL,  'UK',       'Listed wind YieldCo (also files Note 10 ARO bonds)'),
  ('07535671', 'ORSTED WIND POWER A/S UK BRANCH',        'Orsted',         'utility_parent', NULL,  'UK',       'UK branch — limited disclosure; parent files in DK'),

  -- ── Single-asset SPVs (unconsolidated; one wind farm per filing) ──────
  -- Whitelee / ScottishPower
  ('SC234571', 'WHITELEE WINDFARM LIMITED',              'ScottishPower',  'onshore_wind',   539,   'Scotland', 'Largest onshore wind farm in UK'),
  ('SC289829', 'WHITELEE WINDFARM (EXTENSION) LIMITED',  'ScottishPower',  'onshore_wind',   217,   'Scotland', 'Whitelee Phase 2 extension'),
  -- RWE onshore SPVs
  ('05012085', 'GWYNT Y MOR OFFSHORE WIND FARM LIMITED', 'RWE',            'offshore_wind',  576,   'Wales',    'Co-owned with Stadtwerke München, Siemens'),
  ('06035334', 'TRIODOS RENEWABLES PLC',                 'Triodos',        'onshore_wind',   30,    'UK',       'Small co-op-owned wind portfolio'),
  -- BlackRock / energy infra wind SPVs
  ('05892422', 'GREATER GABBARD OFFSHORE WINDS LIMITED', 'SSE/RWE',        'offshore_wind',  504,   'England',  'JV between SSE Renewables and RWE'),
  ('07315002', 'BEATRICE OFFSHORE WINDFARM LIMITED',     'SSE',            'offshore_wind',  588,   'Scotland', 'JV: SSE 40% / Copenhagen Infra 35% / Red Rock 25%'),
  -- Solar SPVs / YieldCos
  ('07496363', 'NEXTENERGY SOLAR FUND LIMITED',          'NextEnergy',     'solar_pv',       NULL,  'UK',       'Listed solar YieldCo'),
  ('09312418', 'BLUEFIELD SOLAR INCOME FUND LIMITED',    'Bluefield',      'solar_pv',       NULL,  'UK',       'Listed solar YieldCo'),
  ('07385051', 'FORESIGHT SOLAR FUND LIMITED',           'Foresight',      'solar_pv',       NULL,  'UK',       'Listed solar YieldCo'),
  -- BESS YieldCos
  ('11160422', 'GORE STREET ENERGY STORAGE FUND PLC',    'Gore Street',    'bess',           NULL,  'UK',       'Listed BESS YieldCo (sector pattern: ARO=0)'),
  ('12102249', 'GRESHAM HOUSE ENERGY STORAGE FUND PLC',  'Gresham House',  'bess',           NULL,  'UK',       'Listed BESS YieldCo'),
  ('11352604', 'HARMONY ENERGY INCOME TRUST PLC',        'Harmony',        'bess',           NULL,  'UK',       'Listed BESS YieldCo (delisted 2024 — fund wind-down)'),
  -- Decom-active operators (older fleets)
  ('03070024', 'WINDPROSPECT (OPERATIONS) LIMITED',      'EDF',            'onshore_wind',   NULL,  'UK',       'EDF UK O&M arm — operates aged fleet incl. decom-eligible')
ON CONFLICT (company_number) DO NOTHING;

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_026_companies_house_ixbrl', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM ch_companies_watch),
  'Migration 026 — created ch_companies_watch + ch_filings + ch_provisions + ch_latest_decom_provision_v',
  'Storage scaffolding for Companies House iXBRL scraper. Seeded ~20 UK operator company numbers (utility parents + single-asset SPVs + YieldCos). Run sync_companies_house_ixbrl.py to populate filings + provisions.'
);
