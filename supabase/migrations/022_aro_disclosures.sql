-- Migration 022 — ARO Disclosure tables (Provisions + Bonds)
--
-- Two distinct disclosure styles, two tables:
--
--   aro_provisions — for consolidating operators that publish a single ARO
--                    provision figure under IAS 37 / ASC 410. One row per
--                    operator per FY.
--
--   aro_bonds      — for investment-entity YieldCos (Greencoat UK Wind,
--                    NextEnergy Solar Fund, Bluefield, Foresight, Gore
--                    Street, etc.) that hold SPVs at fair value and disclose
--                    per-site decommissioning bonds and guarantees instead
--                    of a consolidated provision. One row per site-bond.
--
-- Strict asset_class taxonomy ensures onshore wind, offshore wind, solar PV,
-- and BESS never get mixed — decom cost intensities differ by 10× between
-- onshore and offshore, so per-MW figures must always be filtered by subtype.
--
-- Pure-play operators only: rows where the operator has nuclear, hydro, or
-- thermal assets are excluded entirely (mixing those AROs would distort
-- per-MW analysis for renewable decom).

-- ── Drop old hardcoded data path ─────────────────────────────────────────────
-- (No prior aro_* tables — previously the panel used hardcoded TS array)

-- ── Provisions table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS aro_provisions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator            text NOT NULL,
  ticker              text,
  jurisdiction        text NOT NULL,                       -- ISO-2 (GB / DE / DK / US / JP / AU)
  asset_class         text NOT NULL CHECK (asset_class IN (
                        'onshore_wind', 'offshore_wind',
                        'solar_pv', 'bess'
                      )),
  framework           text NOT NULL CHECK (framework IN ('IFRS', 'CSRD', 'US-GAAP', 'METI')),
  fy                  text NOT NULL,                       -- 'FY2024' / 'FY24' / 'FY24-25'
  filing_date         date,                                -- when the AR/10-K was published

  -- The ARO provision figure
  total_aro_m         numeric NOT NULL,                    -- in stated currency, millions
  currency            text NOT NULL CHECK (currency IN ('EUR','GBP','USD','DKK','JPY','AUD')),
  capacity_mw         numeric,                             -- portfolio capacity used to derive per-MW
  per_mw_k            numeric GENERATED ALWAYS AS (
                        CASE WHEN capacity_mw > 0 THEN (total_aro_m * 1000) / capacity_mw ELSE NULL END
                      ) STORED,

  -- Disclosure quality
  attribution         text NOT NULL CHECK (attribution IN ('disclosed', 'derived')),
  attribution_notes   text,                                -- e.g. "Derived: total - nuclear share"

  -- Source
  source_name         text NOT NULL,                       -- e.g. "Greencoat UK Wind 2024 AR"
  source_url          text NOT NULL,                       -- precise URL — PDF or filing
  filing_page         integer,                             -- specific page number in PDF

  -- Curation metadata
  last_verified       date NOT NULL DEFAULT current_date,
  notes               text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aro_provisions_asset_class_idx ON aro_provisions(asset_class);
CREATE INDEX IF NOT EXISTS aro_provisions_jurisdiction_idx ON aro_provisions(jurisdiction);
CREATE INDEX IF NOT EXISTS aro_provisions_fy_idx ON aro_provisions(fy);

-- ── Bonds / Guarantees table ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS aro_bonds (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator                text NOT NULL,                   -- e.g. 'Greencoat UK Wind plc'
  operator_ticker         text,
  jurisdiction            text NOT NULL,                   -- operator domicile, ISO-2
  fy                      text NOT NULL,
  filing_date             date,

  -- Per-site detail
  site_name               text NOT NULL,
  site_asset_class        text NOT NULL CHECK (site_asset_class IN (
                            'onshore_wind', 'offshore_wind',
                            'solar_pv', 'bess'
                          )),
  site_country            text,                            -- ISO-2 (sometimes differs from operator)
  site_capacity_mw        numeric,
  ownership_pct           numeric,                         -- operator's stake in the SPV (0-100)

  -- Counterparty
  beneficiary             text NOT NULL,                   -- who holds the security
  beneficiary_type        text CHECK (beneficiary_type IN (
                            'crown_estate', 'council', 'landowner',
                            'grid_operator', 'oem', 'developer', 'other'
                          )),

  -- The bond
  bond_currency           text NOT NULL CHECK (bond_currency IN ('EUR','GBP','USD','DKK','JPY','AUD')),
  bond_amount_thousands   numeric NOT NULL,                -- raw figure in £'000 / €'000 etc.
  bond_instrument         text,                            -- 'guarantee' / 'letter_of_credit' / 'counter_indemnity'

  -- Whether this bond is purely decom-related, or a combined-purpose bond
  purpose_pure_decom      boolean NOT NULL DEFAULT true,
  purpose_notes           text,                            -- e.g. "covers grid + radar + decom"

  -- Source
  source_name             text NOT NULL,
  source_url              text NOT NULL,
  filing_page             integer,

  -- Curation metadata
  last_verified           date NOT NULL DEFAULT current_date,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aro_bonds_operator_idx ON aro_bonds(operator);
CREATE INDEX IF NOT EXISTS aro_bonds_site_asset_class_idx ON aro_bonds(site_asset_class);
CREATE INDEX IF NOT EXISTS aro_bonds_jurisdiction_idx ON aro_bonds(jurisdiction);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Permissive read (app gates at Clerk route layer)

ALTER TABLE aro_provisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aro_bonds      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_aro_provisions" ON aro_provisions;
CREATE POLICY "read_aro_provisions" ON aro_provisions FOR SELECT USING (true);

DROP POLICY IF EXISTS "read_aro_bonds" ON aro_bonds;
CREATE POLICY "read_aro_bonds" ON aro_bonds FOR SELECT USING (true);

-- ── Idempotent re-seed: clear prior Greencoat rows ──────────────────────────

DELETE FROM aro_bonds WHERE operator = 'Greencoat UK Wind plc' AND fy = 'FY2024';

-- ── Seed: Greencoat UK Wind plc — 2024 Annual Report Note 10 ────────────────
-- Source: https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf#page=88
--
-- All site-level bonds and counter-indemnities posted by Greencoat that are
-- decommissioning-related. Mixed-purpose bonds (where decom is bundled with
-- grid / radar / wake-compensation) are flagged with purpose_pure_decom=false.
--
-- Pure financing items (DSRA letters of credit, lease-obligation guarantees,
-- offtake guarantees, OFTO O&M, JOA participant guarantees) are excluded —
-- they are not decom security.

INSERT INTO aro_bonds (
  operator, operator_ticker, jurisdiction, fy, filing_date,
  site_name, site_asset_class, site_country, site_capacity_mw, ownership_pct,
  beneficiary, beneficiary_type,
  bond_currency, bond_amount_thousands, bond_instrument,
  purpose_pure_decom, purpose_notes,
  source_name, source_url, filing_page
) VALUES
  -- ── OFFSHORE WIND ─────────────────────────────────────────────────────────
  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'North Hoyle', 'offshore_wind', 'GB', 60, 100,
   'The Crown Estate', 'crown_estate',
   'GBP', 11843, 'guarantee',
   false, 'Decommissioning & rent obligations (combined)',
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'Rhyl Flats', 'offshore_wind', 'GB', 90, 24.95,
   'The Crown Estate', 'crown_estate',
   'GBP', 3401, 'guarantee',
   true, NULL,
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  -- ── ONSHORE WIND ──────────────────────────────────────────────────────────
  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'Clyde', 'onshore_wind', 'GB', 522, 28.2,
   'SSE', 'developer',
   'GBP', 21771, 'counter_indemnity',
   false, 'Combined: grid + radar + decommissioning',
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'Glen Kyllachy', 'onshore_wind', 'GB', 48.5, 100,
   'RWE', 'developer',
   'GBP', 12238, 'counter_indemnity',
   false, 'Combined: decommissioning + grid + Farr wind farm wake compensation',
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'South Kyle', 'onshore_wind', 'GB', 240, 100,
   'Landowner', 'landowner',
   'GBP', 5332, 'guarantee',
   true, NULL,
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'South Kyle', 'onshore_wind', 'GB', 240, 100,
   'East Ayrshire Council', 'council',
   'GBP', 5000, 'counter_indemnity',
   true, NULL,
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'South Kyle', 'onshore_wind', 'GB', 240, 100,
   'FLS / Scottish Ministers', 'council',
   'GBP', 4327, 'counter_indemnity',
   true, NULL,
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'South Kyle', 'onshore_wind', 'GB', 240, 100,
   'Dumfries & Galloway Council', 'council',
   'GBP', 3748, 'counter_indemnity',
   true, NULL,
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'Andershaw', 'onshore_wind', 'GB', 36, 100,
   'Statkraft', 'developer',
   'GBP', 3500, 'guarantee',
   true, NULL,
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'Dalquhandy', 'onshore_wind', 'GB', 23.4, 100,
   'South Lanarkshire Council', 'council',
   'GBP', 2525, 'counter_indemnity',
   true, NULL,
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'Braes of Doune', 'onshore_wind', 'GB', 72, 50,
   'Landowner', 'landowner',
   'GBP', 2000, 'guarantee',
   true, NULL,
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'Twentyshilling', 'onshore_wind', 'GB', 37.8, 100,
   'Dumfries & Galloway Council', 'council',
   'GBP', 1897, 'counter_indemnity',
   true, NULL,
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'Douglas West', 'onshore_wind', 'GB', 45, 100,
   'Landowner', 'landowner',
   'GBP', 1610, 'guarantee',
   true, NULL,
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'Windy Rig', 'onshore_wind', 'GB', 43.2, 100,
   'National Grid', 'grid_operator',
   'GBP', 1479, 'counter_indemnity',
   false, 'Combined: access rights + grid + decommissioning',
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'Nanclach', 'onshore_wind', 'GB', NULL, 100,
   'Landowners', 'landowner',
   'GBP', 1348, 'counter_indemnity',
   true, NULL,
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'Stroupster', 'onshore_wind', 'GB', 29.9, 100,
   'Landowners', 'landowner',
   'GBP', 338, 'counter_indemnity',
   true, NULL,
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'Cotton Farm', 'onshore_wind', 'GB', 16.4, 100,
   'Landowner', 'landowner',
   'GBP', 165, 'guarantee',
   true, NULL,
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'Yelvertoft', 'onshore_wind', 'GB', 16.4, 100,
   'Daventry District Council', 'council',
   'GBP', 82, 'guarantee',
   true, NULL,
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'Langhope Rig', 'onshore_wind', 'GB', 16, 100,
   'Barclays Bank / Landowner', 'landowner',
   'GBP', 81, 'counter_indemnity',
   true, NULL,
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88),

  ('Greencoat UK Wind plc', 'UKW.L', 'GB', 'FY2024', '2025-04-01',
   'Twentyshilling', 'onshore_wind', 'GB', 37.8, 100,
   'Landowner', 'landowner',
   'GBP', 101, 'counter_indemnity',
   true, NULL,
   'Greencoat UK Wind 2024 AR · Note 10',
   'https://www.greencoat-ukwind.com/application/files/9217/4532/0622/gukw-annual-report-2024.pdf', 88);

-- ── Telemetry ──────────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_022_aro_disclosures', 'success', NOW(), NOW(),
  20,
  'Greencoat UK Wind plc · 2024 Annual Report Note 10 (page 88)',
  'Migration 022 — created aro_provisions + aro_bonds tables with strict asset_class taxonomy (onshore_wind / offshore_wind / solar_pv / bess). Seeded 20 site-level decom bonds from Greencoat UK Wind 2024 AR: 2 offshore (North Hoyle, Rhyl Flats) + 18 onshore. Mixed-purpose bonds (Clyde, Glen Kyllachy, Windy Rig) flagged purpose_pure_decom=false. aro_provisions empty pending verified pure-play provision-style operator (Ørsted next).'
);
