-- Migration 052 — Trade Flows: scrap export-import corridors + policy timeline
--
-- Two tables that power the Trade Flows panel in SMI:
--
--   trade_flows         — annual export volume by (material × exporter × importer × year)
--                         Seeded from BIR / Eurostat / GMK Center / UN Comtrade public data.
--   trade_policy_events — major policy events that reshape scrap flows
--                         (Basel amendments, China import bans, EU WSR, India standards).
--
-- The panel surfaces:
--   • Top export corridors per material (Exporter → Importer · volume · % of total)
--   • Recent + upcoming policy events with effective/announced/proposed status
--
-- v1 seeded with 2023 + 2024 ferrous-scrap flows (best-documented), plus
-- representative copper + aluminium flows from BIR World Mirror summaries.
-- More precision via UN Comtrade ingester later.

CREATE TABLE IF NOT EXISTS trade_flows (
  id                bigserial PRIMARY KEY,
  material          text NOT NULL CHECK (material IN (
                      'ferrous_scrap', 'copper_scrap', 'aluminium_scrap',
                      'battery_black_mass', 'lithium_battery_cells'
                    )),
  exporter          text NOT NULL,                        -- 'EU27' / 'US' / 'UK' / 'Japan' / etc.
  importer          text NOT NULL,                        -- 'Turkey' / 'India' / 'Pakistan' / etc.
  volume_tonnes     numeric NOT NULL,
  year              integer NOT NULL,
  yoy_change_pct    numeric,                              -- year-on-year % change

  source_publisher  text,                                 -- 'UN Comtrade' / 'Eurostat' / 'BIR' / 'GMK Center'
  source_url        text,
  notes             text,
  created_at        timestamptz DEFAULT now(),

  UNIQUE (material, exporter, importer, year)
);

CREATE INDEX IF NOT EXISTS trade_flows_material_year_idx
  ON trade_flows (material, year DESC, volume_tonnes DESC);


CREATE TABLE IF NOT EXISTS trade_policy_events (
  id                  bigserial PRIMARY KEY,
  event_date          date NOT NULL,                       -- effective date OR announcement date
  jurisdiction        text NOT NULL,                       -- 'EU' / 'CN' / 'US' / 'UK' / 'IN' / 'GLOBAL'
  event_type          text NOT NULL CHECK (event_type IN (
                        'export_restriction', 'import_ban', 'tariff', 'standard',
                        'amendment', 'consultation', 'authorisation_list'
                      )),
  status              text NOT NULL DEFAULT 'effective' CHECK (status IN (
                        'effective', 'announced', 'proposed', 'consultation', 'superseded'
                      )),
  title               text NOT NULL,
  description         text,
  affected_materials  text[],                              -- ['ferrous','copper','aluminium','plastic']
  source_publisher    text,
  source_url          text,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trade_policy_events_date_idx
  ON trade_policy_events (event_date DESC);

-- ── RLS ───────────────────────────────────────────────────────────────

ALTER TABLE trade_flows         ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_policy_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_trade_flows"         ON trade_flows;
DROP POLICY IF EXISTS "read_trade_policy_events" ON trade_policy_events;
CREATE POLICY "read_trade_flows"         ON trade_flows         FOR SELECT USING (true);
CREATE POLICY "read_trade_policy_events" ON trade_policy_events FOR SELECT USING (true);

-- ── (1) Ferrous scrap flows — best-documented stream ──────────────────
-- Source: GMK Center compiling from Eurostat / Trade Data Monitor (Dec 2024).
-- EU 2024: 16.7Mt total exports; Turkey 9.88Mt; Egypt + India + Pakistan
-- combine for 83% with Turkey. We capture the top corridors only.

INSERT INTO trade_flows
  (material, exporter, importer, volume_tonnes, year, yoy_change_pct, source_publisher, source_url, notes) VALUES
  -- 2024 (latest full year available)
  ('ferrous_scrap', 'EU27', 'Turkey',   9_880_000, 2024, 4.8,
   'GMK Center / Eurostat', 'https://gmk.center/en/news/the-eu-exported-16-7-million-tons-of-scrap-in-2024/',
   'Turkey absorbs ~60% of EU exports; recovering steel sector drives import demand'),
  ('ferrous_scrap', 'EU27', 'Egypt',    2_300_000, 2024, NULL,
   'GMK Center / Eurostat', 'https://gmk.center/en/news/the-eu-exported-16-7-million-tons-of-scrap-in-2024/',
   'Second-largest EU destination; Egypt steel capacity expanding'),
  ('ferrous_scrap', 'EU27', 'India',      900_000, 2024, -48.4,
   'GMK Center / Eurostat', 'https://gmk.center/en/news/the-eu-exported-16-7-million-tons-of-scrap-in-2024/',
   'Sharp decline 2024 vs 2023 — India tightening scrap import standards'),
  ('ferrous_scrap', 'EU27', 'Pakistan',   780_000, 2024, NULL,
   'GMK Center / Eurostat', 'https://gmk.center/en/news/the-eu-exported-16-7-million-tons-of-scrap-in-2024/',
   'Fourth-largest EU destination'),
  ('ferrous_scrap', 'EU27', 'Other',    2_840_000, 2024, NULL,
   'GMK Center / Eurostat', 'https://gmk.center/en/news/the-eu-exported-16-7-million-tons-of-scrap-in-2024/',
   'Remainder: ~17% to other destinations (Bangladesh, Indonesia, etc.)'),

  -- 2023 baseline for YoY comparison
  ('ferrous_scrap', 'EU27', 'Turkey',   9_430_000, 2023, NULL,
   'GMK Center / Eurostat', NULL,
   '2023 baseline; close to all-time record EU export year'),
  ('ferrous_scrap', 'EU27', 'India',    1_745_000, 2023, NULL,
   'GMK Center / Eurostat', NULL,
   '2023 baseline; subsequent collapse driven by Indian standards tightening'),

  -- US ferrous scrap 2024 (from BIR data; approximate)
  ('ferrous_scrap', 'US', 'Turkey',     1_900_000, 2024, NULL,
   'BIR World Steel Recycling',  'https://www.bir.org/en/members-area/world-mirrors',
   'US to Turkey is the largest single corridor for US ferrous'),
  ('ferrous_scrap', 'US', 'Mexico',     1_400_000, 2024, NULL,
   'BIR World Steel Recycling', NULL,
   'Domestic-adjacent NAFTA/USMCA flow'),
  ('ferrous_scrap', 'US', 'Bangladesh',   850_000, 2024, NULL,
   'BIR World Steel Recycling', NULL, NULL),

  -- UK 2024 ferrous (post-Brexit, tracked separately from EU27)
  ('ferrous_scrap', 'UK', 'Turkey',     2_100_000, 2024, NULL,
   'UK Trade Info / Eurostat', NULL,
   'UK is one of largest single-country ferrous scrap exporters globally'),
  ('ferrous_scrap', 'UK', 'EU27',         700_000, 2024, NULL,
   'UK Trade Info / Eurostat', NULL,
   'Post-Brexit UK→EU flow; constrained by EU WSR rules'),
  ('ferrous_scrap', 'UK', 'India',        450_000, 2024, NULL,
   'UK Trade Info / Eurostat', NULL, NULL);

-- ── (2) Copper scrap flows — China dominant importer until 2019, then shifted ──

INSERT INTO trade_flows
  (material, exporter, importer, volume_tonnes, year, yoy_change_pct, source_publisher, source_url, notes) VALUES
  ('copper_scrap', 'EU27', 'China',     800_000, 2024, NULL,
   'BIR Non-Ferrous World Mirror', 'https://www.bir.org/en/news-press/news/',
   'China remains largest single importer of EU copper scrap despite 2018-2020 import policy tightening'),
  ('copper_scrap', 'EU27', 'India',     280_000, 2024, NULL,
   'BIR Non-Ferrous World Mirror', NULL,
   'India growing rapidly as copper scrap importer'),
  ('copper_scrap', 'EU27', 'Turkey',    160_000, 2024, NULL,
   'BIR Non-Ferrous World Mirror', NULL, NULL),
  ('copper_scrap', 'US',   'China',     500_000, 2024, NULL,
   'BIR Non-Ferrous World Mirror', NULL,
   'US-China copper scrap flow has been hit by tariffs but remains major'),
  ('copper_scrap', 'US',   'Malaysia',  250_000, 2024, NULL,
   'BIR Non-Ferrous World Mirror', NULL,
   'Malaysia emerged as key US copper-scrap destination after China tightening');

-- ── (3) Aluminium scrap flows ──

INSERT INTO trade_flows
  (material, exporter, importer, volume_tonnes, year, yoy_change_pct, source_publisher, source_url, notes) VALUES
  ('aluminium_scrap', 'EU27', 'India',    420_000, 2024, NULL,
   'BIR Non-Ferrous World Mirror', NULL,
   'India largest single importer of EU aluminium scrap'),
  ('aluminium_scrap', 'EU27', 'Turkey',   280_000, 2024, NULL,
   'BIR Non-Ferrous World Mirror', NULL, NULL),
  ('aluminium_scrap', 'EU27', 'Pakistan', 220_000, 2024, NULL,
   'BIR Non-Ferrous World Mirror', NULL, NULL),
  ('aluminium_scrap', 'US',   'Mexico',   480_000, 2024, NULL,
   'BIR Non-Ferrous World Mirror', NULL,
   'USMCA flow dominant for US aluminium scrap'),
  ('aluminium_scrap', 'US',   'Malaysia', 200_000, 2024, NULL,
   'BIR Non-Ferrous World Mirror', NULL, NULL);

-- ── (4) Battery black mass — emerging trade pattern ────────────────────

INSERT INTO trade_flows
  (material, exporter, importer, volume_tonnes, year, yoy_change_pct, source_publisher, source_url, notes) VALUES
  ('battery_black_mass', 'EU27', 'South Korea',  18_000, 2024, NULL,
   'Fastmarkets battery commentary', 'https://www.fastmarkets.com/insights/six-key-trends-battery-recycling-market/',
   'EU exports of black mass to Korean hydromet recyclers (Sungeel, Posco). Volumes still small but growing fast.'),
  ('battery_black_mass', 'EU27', 'China',         6_000, 2024, NULL,
   'Fastmarkets battery commentary', NULL,
   'China imports despite formal 2018 ban; specialty hydromet exemption applies'),
  ('battery_black_mass', 'US',   'South Korea',  12_000, 2024, NULL,
   'Fastmarkets battery commentary', NULL,
   'US Inflation Reduction Act provides incentives for domestic black mass processing; outflows shrinking');

-- ── (5) Trade policy events — major ones reshaping flows ──────────────

INSERT INTO trade_policy_events
  (event_date, jurisdiction, event_type, status, title, description, affected_materials, source_publisher, source_url) VALUES
  ('2018-01-01', 'CN', 'import_ban', 'effective',
   'China bans imports of 24 categories of scrap',
   'Operation National Sword / Green Fence — China ceased imports of mixed paper, mixed plastics, post-consumer textiles and unsorted scrap. Reshaped global scrap flows; redirected EU/US copper and ferrous to Turkey/India/SE Asia.',
   ARRAY['ferrous','copper','aluminium','plastic'],
   'China MEE', NULL),

  ('2020-12-31', 'CN', 'import_ban', 'effective',
   'China extends ban to all "solid waste" imports',
   'Final phase of multi-year wind-down. Smaller specialty exemptions remained for high-grade processed scrap (e.g. brass ingots, refined copper) but bulk scrap flows ended.',
   ARRAY['ferrous','copper','aluminium'],
   'China MEE', NULL),

  ('2020-01-01', 'GLOBAL', 'amendment', 'effective',
   'Basel Convention plastic scrap amendment effective',
   'Mixed/contaminated plastic waste reclassified as hazardous; Annex II. Required prior informed consent for shipments. Affected specialty plastic streams; ferrous/non-ferrous metallics largely unaffected.',
   ARRAY['plastic'],
   'Basel Convention Secretariat', 'https://www.basel.int/'),

  ('2024-05-20', 'EU', 'amendment', 'effective',
   'EU Waste Shipment Regulation 2024/1157 enters into force',
   'Comprehensive overhaul of EU waste-shipment rules. Most provisions apply from May 2026; export rules from May 2027. Plastic waste ban to non-OECD from Nov 2026. First authorisation list of non-OECD recipients due Nov 2026.',
   ARRAY['ferrous','copper','aluminium','plastic'],
   'European Commission', 'https://environment.ec.europa.eu/news/new-regulation-waste-shipments-enters-force-2024-05-20_en'),

  ('2024-04-01', 'IN', 'standard', 'effective',
   'India tightens metal scrap import standards (BIS 11409)',
   'Updated Bureau of Indian Standards spec requires pre-shipment inspection certification + tightened contamination thresholds. Result: EU ferrous exports to India fell -48% YoY in 2024.',
   ARRAY['ferrous','copper','aluminium'],
   'BIS India', NULL),

  ('2026-05-21', 'EU', 'export_restriction', 'effective',
   'EU WSR mixed-waste export ban effective',
   'Most provisions of Regulation 2024/1157 begin applying. Mixed municipal waste exports to non-EEA countries banned. Notification regime tightened for non-hazardous waste shipments.',
   ARRAY['ferrous','copper','aluminium','plastic'],
   'European Commission', 'https://environment.ec.europa.eu/news/new-regulation-waste-shipments-enters-force-2024-05-20_en'),

  ('2026-11-21', 'EU', 'export_restriction', 'announced',
   'EU plastic waste ban to non-OECD effective',
   'Specific ban on exporting plastic waste to non-OECD countries for at least 2.5 years. Coincides with first authorisation list publication.',
   ARRAY['plastic'],
   'European Commission', NULL),

  ('2026-11-21', 'EU', 'authorisation_list', 'announced',
   'First EU non-OECD authorisation list due',
   'Commission publishes inaugural list of non-OECD countries permitted to receive EU waste exports under WSR 2024/1157. Recipient countries must demonstrate sustainable management capability.',
   ARRAY['ferrous','copper','aluminium','plastic'],
   'European Commission', NULL),

  ('2027-05-21', 'EU', 'export_restriction', 'announced',
   'EU WSR non-OECD export rules fully effective',
   'Final phase: non-OECD destinations must be on authorisation list to receive EU waste. Expected major impact on EU → non-EEA scrap corridors (especially for India, Pakistan, Bangladesh, etc.).',
   ARRAY['ferrous','copper','aluminium','plastic'],
   'European Commission', NULL),

  ('2025-03-15', 'US', 'tariff', 'effective',
   'US Section 232 derivative-product tariffs',
   'Expanded Section 232 steel/aluminium tariffs to cover broader range of derivative products. Indirect impact on scrap flows via demand-side substitution.',
   ARRAY['ferrous','aluminium'],
   'US Commerce', NULL);

-- ── Telemetry ─────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_052_trade_flows', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM trade_flows) + (SELECT COUNT(*) FROM trade_policy_events),
  'Hand-curated from BIR World Mirror, GMK Center, Eurostat, EU Commission, India BIS',
  'Migration 052 — trade_flows (ferrous + copper + aluminium + black mass corridors) + trade_policy_events (Basel, China, EU WSR, India BIS, US Section 232).'
);
