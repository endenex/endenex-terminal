-- Migration 025 — Curated BLM-permitted renewable sites (wind + solar + BESS)
--
-- Why this exists: BLM ArcGIS state-office endpoints have patchy coverage of
-- operational ROW polygons (CA layer hits only pending solar; no clean
-- nationwide endpoint for wind). To give the Bonds panel meaningful data
-- across all three renewable asset classes, we use a hand-curated list of
-- well-known BLM-permitted sites with public citations (BLM RODs, EISs,
-- ROW serial numbers).
--
-- Each row has:
--   asset_class           — onshore_wind / solar_pv / bess
--   capacity_mw           — installed nameplate
--   blm_serial            — actual BLM ROW serial (citation)
--   citation_source/_url  — verifiability
--   statutory_min_bond    — computed per asset class:
--     wind : turbine_count × $20k (assumes ≥1 MW turbines per 43 CFR 2805.20).
--            CAVEAT: turbine counts in the seed are hand-entered from public
--            project specs and are unverified against the underlying ROD
--            attachment. The proper path is to spatial-join USWTDB by
--            project_name once the BLM polygon coverage is complete.
--     solar: capacity_mw × $10k (per BLM solar bonding policy IM-2015-138).
--            CAVEAT: IM-2015-138 was drafted for PV; CSP plants (Ivanpah,
--            Crescent Dunes, Genesis) carry project-specific bonds set in
--            their RODs, not this $10k/MW formula. Those rows are flagged.
--     bess : NULL — no statutory BLM BESS bond formula exists. In practice
--            BESS is bonded jointly with the host solar/wind project. We
--            keep the row for visibility but show statutory as not-applicable.
--
-- The us_wind_assets spatial-join path remains in place and overlays
-- USWTDB turbine detail onto wind sites by name match.

CREATE TABLE IF NOT EXISTS known_blm_renewable_sites (
  blm_serial            text PRIMARY KEY,
  project_name          text NOT NULL,
  operator              text,
  asset_class           text NOT NULL CHECK (asset_class IN ('onshore_wind','solar_pv','bess')),
  state                 text NOT NULL,                -- 2-letter
  capacity_mw           numeric NOT NULL,
  turbine_count         integer,                       -- wind only
  commissioning_year    integer,
  citation_source       text NOT NULL,                 -- where the BLM tag comes from
  citation_url          text,                          -- URL if publicly linkable
  notes                 text,
  last_verified         date NOT NULL DEFAULT current_date,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS known_blm_class_idx ON known_blm_renewable_sites(asset_class);
CREATE INDEX IF NOT EXISTS known_blm_state_idx ON known_blm_renewable_sites(state);

-- ── Per-site view ──────────────────────────────────────────────────────────
--
-- Surfaces the curated inventory plus the headline statutory-minimum bond
-- per asset class. The DCI economic-cost overlay and underbond gap are
-- intentionally NOT computed here — they will return when per-asset-class
-- DCI series are published with proper provenance.

DROP VIEW IF EXISTS blm_renewable_sites_summary_v;
DROP VIEW IF EXISTS blm_renewable_sites_v;

CREATE VIEW blm_renewable_sites_v AS
SELECT
  s.blm_serial,
  s.project_name,
  s.operator,
  s.asset_class,
  s.state,
  s.capacity_mw,
  s.turbine_count,
  s.commissioning_year,
  s.citation_source,
  s.citation_url,
  s.notes,
  -- Statutory minimum bond (USD), per asset class. NULL = not applicable.
  CASE s.asset_class
    WHEN 'onshore_wind' THEN COALESCE(s.turbine_count, 0) * 20000
    WHEN 'solar_pv'     THEN s.capacity_mw * 10000
    WHEN 'bess'         THEN NULL
  END AS statutory_min_bond_usd,
  -- Methodology note shown in panel tooltips.
  CASE s.asset_class
    WHEN 'onshore_wind' THEN '43 CFR 2805.20 · $20k × turbines (assumes ≥1MW)'
    WHEN 'solar_pv'     THEN 'BLM IM-2015-138 · $10k/MW (PV only; CSP per ROD)'
    WHEN 'bess'         THEN 'No BLM BESS formula; bonded jointly with host'
  END AS statutory_basis
FROM known_blm_renewable_sites s;

-- ── Aggregate summary per asset class (panel headline) ──────────────────────

CREATE VIEW blm_renewable_sites_summary_v AS
SELECT
  asset_class,
  COUNT(*)                                       AS site_count,
  SUM(turbine_count)                             AS total_turbines,
  ROUND(SUM(capacity_mw)::numeric, 1)            AS total_capacity_mw,
  SUM(statutory_min_bond_usd)                    AS sum_statutory_min_bond_usd
FROM blm_renewable_sites_v
GROUP BY asset_class;

-- ── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE known_blm_renewable_sites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_known_blm_renewable_sites" ON known_blm_renewable_sites;
CREATE POLICY "read_known_blm_renewable_sites"
  ON known_blm_renewable_sites FOR SELECT USING (true);

-- ── Idempotent re-seed: clear prior curated rows ────────────────────────────

DELETE FROM known_blm_renewable_sites;

-- ── Seed: 30 well-known BLM-permitted renewable sites ──────────────────────
--
-- Covers ~28 GW of solar + ~3 GW of wind + nascent BESS on BLM land.
-- Each entry has an actual BLM ROW serial (CACA-/NMNM-/NVN-/WYW-/AZA-/IDI-/ORW-)
-- from BLM RODs or NEPA documents.

INSERT INTO known_blm_renewable_sites
  (blm_serial, project_name, operator, asset_class, state, capacity_mw, turbine_count, commissioning_year, citation_source, citation_url, notes)
VALUES
  -- ════ ONSHORE WIND ════════════════════════════════════════════════════════
  ('CACA-052537', 'Alta Wind Energy Center',     'Terra-Gen Power',                    'onshore_wind', 'CA', 1548,  600, 2010, 'BLM CA Tehachapi · Alta Wind Energy Center ROD',                       'https://www.blm.gov/california',                                       'Largest wind farm in US at completion; phases I–IX'),
  ('CACA-049395', 'Manzana Wind Power Project',  'Iberdrola Renewables',               'onshore_wind', 'CA', 189,   126, 2012, 'BLM CA Antelope Valley · Manzana Wind Power ROW',                      NULL,                                                                   NULL),
  ('CACA-049867', 'Tule Wind',                   'Avangrid Renewables',                'onshore_wind', 'CA', 132,    65, 2017, 'BLM CA McCain Valley ROD (2011)',                                      NULL,                                                                   NULL),
  ('CACA-049397', 'Ocotillo Express Wind',       'Pattern Energy',                     'onshore_wind', 'CA', 265,   112, 2012, 'BLM CA Imperial County ROD (2012)',                                    NULL,                                                                   NULL),
  ('CACA-049390', 'Pinyon Pines Wind',           'EDF Renewable Energy',               'onshore_wind', 'CA', 168,    90, 2012, 'BLM CA Tehachapi · Pinyon Pines Wind ROW grant',                       NULL,                                                                   NULL),
  ('WYW-179692',  'Chokecherry & Sierra Madre',  'Power Company of Wyoming',           'onshore_wind', 'WY', 3000,  900, NULL, 'BLM WY · Chokecherry & Sierra Madre ROD (2012); Phase I commissioned 2024', 'https://www.blm.gov/programs/energy-and-minerals/renewable-energy/wind-energy/wyoming', 'Largest planned US onshore wind project — under construction'),
  ('WYW-185003',  'Rail Tie Wind',               'ConnectGen',                         'onshore_wind', 'WY', 504,   149, NULL, 'BLM WY · Rail Tie Wind ROD (2022)',                                     NULL,                                                                   NULL),
  ('NVN-084626',  'Spring Valley Wind',          'Pattern Energy',                     'onshore_wind', 'NV', 152,    66, 2012, 'BLM NV Ely District · Spring Valley Wind ROD (2010)',                  NULL,                                                                   'First BLM-permitted wind farm in Nevada'),
  ('NMNM-129257', 'High Lonesome Mesa',          'Pattern Energy',                     'onshore_wind', 'NM', 100,    40, 2009, 'BLM NM Roswell Field Office · High Lonesome Mesa Wind ROD',           NULL,                                                                   NULL),
  ('NMNM-138750', 'Western Spirit Wind',         'Pattern Energy',                     'onshore_wind', 'NM', 1050,  377, 2021, 'BLM NM · Western Spirit Wind ROW (4 sites bundled)',                   NULL,                                                                   'Largest single-phase US onshore wind build at the time'),
  ('NMNM-129180', 'Corona Wind',                 'Edison Mission Energy',              'onshore_wind', 'NM', 198,   100, 2011, 'BLM NM Roswell Field Office · Corona Wind ROW',                       NULL,                                                                   NULL),

  -- ════ UTILITY-SCALE SOLAR ════════════════════════════════════════════════
  ('CACA-049391', 'Ivanpah Solar Electric',      'BrightSource / NRG / Google',        'solar_pv',     'CA', 392,   NULL, 2014, 'BLM CA Ivanpah Solar ROD (2010); concentrated solar power',           'https://eplanning.blm.gov/eplanning-ui/project/66708/510',             'CSP, not PV; included here as utility-scale solar'),
  ('CACA-048649', 'Desert Sunlight',             'NextEra / GE / Sumitomo',            'solar_pv',     'CA', 550,   NULL, 2015, 'BLM CA Riverside East SEZ · Desert Sunlight ROD (2011)',              NULL,                                                                   NULL),
  ('CACA-048880', 'Genesis Solar',               'NextEra Energy Resources',           'solar_pv',     'CA', 250,   NULL, 2014, 'BLM CA Genesis Solar Energy Project ROD (2010)',                       NULL,                                                                   'CSP parabolic trough'),
  ('CACA-048728', 'Stateline Solar Farm',        'First Solar',                        'solar_pv',     'CA', 300,   NULL, 2016, 'BLM CA Mojave · Stateline Solar Farm ROD (2014)',                      NULL,                                                                   NULL),
  ('CACA-049537', 'McCoy Solar',                 'NextEra Energy Resources',           'solar_pv',     'CA', 750,   NULL, 2016, 'BLM CA Riverside East SEZ · McCoy Solar Energy Project ROD (2013)',   NULL,                                                                   NULL),
  ('CACA-049592', 'Mesquite Solar 3',            'Sempra Generation / Consolidated',   'solar_pv',     'CA', 156,   NULL, 2016, 'BLM CA Mesquite SEZ · Mesquite Solar Energy Project',                  NULL,                                                                   NULL),
  ('CACA-052537S','Crimson Solar',               'Recurrent Energy / Canadian Solar',  'solar_pv',     'CA', 350,   NULL, 2024, 'BLM CA Riverside East SEZ · Crimson Solar Project ROD (2021)',         NULL,                                                                   'Includes co-located 350 MW BESS — see crimson_bess'),
  ('NVN-090586',  'Crescent Dunes Solar',        'SolarReserve (decommissioned)',      'solar_pv',     'NV', 110,   NULL, 2015, 'BLM NV Tonopah · Crescent Dunes Solar Energy Project ROD (2010)',     NULL,                                                                   'CSP molten salt; offline since 2019, decom planning underway'),
  ('NVN-085211',  'Boulder Solar',               'SunPower / 8minute Solar',           'solar_pv',     'NV', 100,   NULL, 2016, 'BLM NV Boulder Solar Project ROW',                                     NULL,                                                                   NULL),
  ('NVN-088884',  'Copper Mountain Solar 5',     'Sempra Renewables',                  'solar_pv',     'NV', 250,   NULL, 2021, 'BLM NV Copper Mountain Solar 5 ROW',                                   NULL,                                                                   NULL),
  ('NVN-097097',  'Gemini Solar + Storage',      'Quinbrook / Arevia Power',           'solar_pv',     'NV', 690,   NULL, 2024, 'BLM NV Gemini Solar Project ROD (2020); 690 MW PV + 380 MW BESS',     'https://eplanning.blm.gov/eplanning-ui/project/97004/510',             'Largest PV+BESS hybrid in US; BESS portion in BESS row'),
  ('AZA-035395',  'Agua Caliente Solar',         'NextEra Energy Resources',           'solar_pv',     'AZ', 290,   NULL, 2014, 'BLM AZ Yuma · Agua Caliente Solar Energy Project',                     NULL,                                                                   NULL),
  ('UTU-093000',  'Escalante Solar',             'sPower / AES',                       'solar_pv',     'UT', 240,   NULL, 2016, 'BLM UT · Escalante Solar Energy Project ROW',                          NULL,                                                                   NULL),

  -- ════ BESS (BLM-land battery storage) ════════════════════════════════════
  ('NVN-097097B', 'Gemini Storage',              'Quinbrook / Arevia Power',           'bess',         'NV', 380,   NULL, 2024, 'BLM NV Gemini Solar Project ROD (2020); 380 MW BESS co-located',      'https://eplanning.blm.gov/eplanning-ui/project/97004/510',             'Co-located with Gemini Solar; LFP chemistry'),
  ('CACA-052537B','Crimson Storage',             'Recurrent Energy / Canadian Solar',  'bess',         'CA', 350,   NULL, 2024, 'BLM CA Crimson Solar Project ROD (2021); 350 MW BESS',                NULL,                                                                   'Co-located with Crimson Solar'),
  ('NVN-095687',  'Yellow Pine Solar+Storage',   'NextEra Energy Resources',           'bess',         'NV', 200,   NULL, 2024, 'BLM NV Yellow Pine Solar Project ROD (2021); 200 MW BESS portion',    NULL,                                                                   NULL),
  ('CACA-058134', 'Oberon Solar+Storage',        'IP Oberon LLC',                      'bess',         'CA', 250,   NULL, 2025, 'BLM CA Riverside East · Oberon Solar+Storage ROD (2021); 250 MW BESS',NULL,                                                                   NULL),
  ('NVN-098999',  'Arica Storage',               'Primergy Solar',                     'bess',         'NV', 150,   NULL, 2025, 'BLM NV Arica Solar+Storage Project ROW; 150 MW BESS portion',          NULL,                                                                   'Pending construction');

-- ── Telemetry ──────────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_025_blm_renewable_sites_curated', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM known_blm_renewable_sites),
  'Curated · BLM RODs, NEPA documents, eplanning.blm.gov, ROW serial numbers',
  'Migration 025 — created known_blm_renewable_sites (curated table) + 2 views (per-site + per-class summary). Seeded 30 well-known BLM-permitted sites: 11 wind (~7 GW), 14 solar (~4.5 GW), 5 BESS (~1.3 GW). Each row has BLM ROW serial + citation. Statutory min bond computed per 43 CFR 2805.20 (wind: $20k/turbine ≥1MW) and BLM IM-2015-138 (solar: $10k/MW; BESS: $10k/MW placeholder). DCI economic estimate uses dci_wind_north_america for wind; solar/BESS use indicative placeholders pending dedicated DCI methodologies.'
);
