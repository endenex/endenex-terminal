-- Migration 039 — Secondary Materials Intelligence: schema & v1 seed
--
-- Three new tables underpinning the redesigned SMI module:
--
--   scrap_price_benchmarks  — long-form benchmark price series, accepts any
--                             publisher (Argus / Fastmarkets-AMM / FRED /
--                             World Bank / USGS / etc.) so the Historical
--                             Prices & Basis panel queries from one place.
--
--   oem_models              — curated catalogue of wind turbines, PV panel
--                             technologies, and battery chemistries. Powers
--                             the Material Intensity Calculator's selector.
--
--   material_intensities    — kg of each material per unit of capacity (per
--                             MW for wind, per Wp for solar, per MWh for
--                             BESS) referenced to a specific OEM model.
--                             Includes recoverability% with explicit basis.
--
-- Seed numbers are drawn from public LCAs / EPDs / agency studies and are
-- cited inline in source_publication. The seed is deliberately small but
-- representative — meant as the v1 catalogue, easy to extend.

-- ── (1) scrap_price_benchmarks ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scrap_price_benchmarks (
  id                bigserial PRIMARY KEY,

  -- What is being priced
  material          text NOT NULL CHECK (material IN (
                      'steel_hms_1','steel_hms_2','steel_hms_1_2_8020',
                      'steel_busheling','steel_shred',
                      'copper_no_1','copper_no_2','copper_birch_cliff',
                      'aluminium_taint_tabor','aluminium_zorba','aluminium_twitch',
                      'aluminium_tense','aluminium_alloy_356',
                      'silicon_solar','silver_solar_grade','glass_pv_cullet',
                      'lithium_carbonate','lithium_hydroxide',
                      'cobalt_metal','nickel_class_1','manganese_ore',
                      'graphite_synthetic','rare_earth_neodymium',
                      'composite_blade_glass_fibre','composite_blade_carbon_fibre'
                    )),
  region            text NOT NULL CHECK (region IN ('EU','GB','US','CN','IN','GLOBAL')),

  -- Where the number comes from
  publisher         text NOT NULL CHECK (publisher IN (
                      'argus','amm_fastmarkets','platts','metalbulletin',
                      'lme','comex','shfe',
                      'fred','world_bank_pink_sheet','usgs','un_comtrade',
                      'eurofer','euric','bcmr','bir',
                      'irsi_recycling','recycling_today',
                      'airtable_curated','manual'
                    )),
  benchmark_name    text NOT NULL,                      -- verbatim, e.g. 'HMS 1&2 80:20 CFR Turkey'
  price             numeric NOT NULL,
  unit              text NOT NULL,                      -- 'USD/t' / 'GBP/t' / 'EUR/t'
  price_date        date NOT NULL,
  period_type       text NOT NULL CHECK (period_type IN
                      ('spot','daily','weekly','monthly','quarterly','annual')),

  -- Provenance
  source_url        text,
  source_document   text,                               -- PDF filename / article title
  ingestion_method  text NOT NULL CHECK (ingestion_method IN
                      ('auto_scraper','pdf_extract','airtable','manual','rpc_compute')),
  confidence        text NOT NULL DEFAULT 'medium'
                      CHECK (confidence IN ('high','medium','low')),
  notes             text,
  created_at        timestamptz DEFAULT now(),

  UNIQUE (material, region, publisher, benchmark_name, price_date, period_type)
);

CREATE INDEX IF NOT EXISTS scrap_price_material_date_idx
  ON scrap_price_benchmarks (material, region, price_date DESC);
CREATE INDEX IF NOT EXISTS scrap_price_publisher_date_idx
  ON scrap_price_benchmarks (publisher, price_date DESC);

-- ── (2) oem_models ────────────────────────────────────────────────────────
--
-- One row per OEM × model combination. Curated. Each model has at least
-- one row in material_intensities pinned to its `id`.

CREATE TABLE IF NOT EXISTS oem_models (
  id                   bigserial PRIMARY KEY,
  asset_class          text NOT NULL CHECK (asset_class IN
                          ('onshore_wind','offshore_wind','solar_pv','bess')),
  manufacturer         text NOT NULL,                   -- 'Vestas' / 'First Solar' / 'CATL'
  model_name           text NOT NULL,                   -- 'V150-4.2 MW' / 'Series 7 CdTe' / 'EnerC LFP'
  technology           text,                            -- 'three_blade_horizontal' / 'mono_perc' / 'lfp_prismatic'

  -- Headline rated capacity. Units differ by asset class:
  --   wind: rated_capacity_value in MW
  --   solar_pv: rated_capacity_value in Wp (per panel) — total MWp comes from system size
  --   bess: rated_capacity_value in MWh (per pack reference)
  rated_capacity_value numeric NOT NULL,
  rated_capacity_unit  text NOT NULL CHECK (rated_capacity_unit IN ('MW','Wp','MWh')),

  -- Wind-specific
  rotor_diameter_m         numeric,
  default_hub_height_m     numeric,
  hub_height_options_m     numeric[],                   -- array of available hub heights
  drivetrain               text,                        -- 'gearbox_dfig' / 'direct_drive' / 'medium_speed'

  -- Solar-specific
  panel_wattage_w          numeric,
  panel_area_m2            numeric,
  cell_efficiency_pct      numeric,
  cell_technology          text,                        -- 'mono_perc' / 'topcon' / 'hjt' / 'cdte' / 'cigs'

  -- BESS-specific
  pack_format              text,                        -- 'prismatic' / 'pouch' / 'cylindrical_2170'
  cathode_chemistry        text,                        -- 'lfp' / 'nmc_622' / 'nmc_811' / 'nca' / 'lmo'
  cycles_to_eol            integer,
  energy_density_wh_kg     numeric,

  -- Common
  introduction_year        integer,
  status                   text CHECK (status IN
                              ('in_production','discontinued','legacy','emerging')),
  source_url               text,                        -- spec sheet / EPD link
  notes                    text,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now(),

  UNIQUE (asset_class, manufacturer, model_name)
);

CREATE INDEX IF NOT EXISTS oem_models_class_idx ON oem_models (asset_class, status);

-- ── (3) material_intensities ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS material_intensities (
  id                       bigserial PRIMARY KEY,
  oem_model_id             bigint NOT NULL REFERENCES oem_models(id) ON DELETE CASCADE,

  material                 text NOT NULL,               -- 'steel' / 'copper' / 'aluminium' / 'glass' / etc.
  material_subclass        text,                        -- 'tower_steel' / 'cast_iron_hub' / 'gfrp_blade' etc.

  intensity_value          numeric NOT NULL,
  intensity_unit           text NOT NULL CHECK (intensity_unit IN
                              ('kg/MW','kg/Wp','kg/MWh','kg/turbine','kg/panel','kg/pack')),

  -- Recoverability — what fraction is typically recovered as scrap-grade
  recoverability_pct       numeric CHECK (recoverability_pct IS NULL OR
                              (recoverability_pct >= 0 AND recoverability_pct <= 100)),
  recoverability_basis     text CHECK (recoverability_basis IN
                              ('theoretical','observed_demolition','industry_avg','target')),

  -- Provenance
  source_publication       text NOT NULL,                -- citation
  source_url               text,
  source_year              integer,
  confidence               text NOT NULL DEFAULT 'medium'
                              CHECK (confidence IN ('high','medium','low')),
  notes                    text,
  created_at               timestamptz DEFAULT now(),

  UNIQUE (oem_model_id, material, material_subclass)
);

CREATE INDEX IF NOT EXISTS mat_int_model_idx ON material_intensities (oem_model_id);

-- ── (4) Convenience view: model + intensity (joined, calculator-ready) ───

DROP VIEW IF EXISTS material_intensities_v;

CREATE VIEW material_intensities_v AS
SELECT
  m.id                      AS oem_model_id,
  m.asset_class,
  m.manufacturer,
  m.model_name,
  m.technology,
  m.rated_capacity_value,
  m.rated_capacity_unit,
  m.introduction_year,
  m.status,
  i.material,
  i.material_subclass,
  i.intensity_value,
  i.intensity_unit,
  i.recoverability_pct,
  i.recoverability_basis,
  -- Recovered = intensity × recoverability%; useful for the calculator's
  -- "what comes out as scrap" column
  CASE WHEN i.recoverability_pct IS NOT NULL
       THEN ROUND((i.intensity_value * i.recoverability_pct / 100)::numeric, 2)
       ELSE NULL
  END AS recoverable_intensity_value,
  i.source_publication,
  i.source_url,
  i.source_year,
  i.confidence
FROM oem_models m
LEFT JOIN material_intensities i ON i.oem_model_id = m.id;

-- ── (5) RLS ──────────────────────────────────────────────────────────────

ALTER TABLE scrap_price_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE oem_models             ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_intensities   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_scrap_price_benchmarks" ON scrap_price_benchmarks;
DROP POLICY IF EXISTS "read_oem_models"             ON oem_models;
DROP POLICY IF EXISTS "read_material_intensities"   ON material_intensities;

CREATE POLICY "read_scrap_price_benchmarks" ON scrap_price_benchmarks FOR SELECT USING (true);
CREATE POLICY "read_oem_models"             ON oem_models             FOR SELECT USING (true);
CREATE POLICY "read_material_intensities"   ON material_intensities   FOR SELECT USING (true);

-- ── (6) Seed: representative OEM models ──────────────────────────────────

INSERT INTO oem_models
  (asset_class, manufacturer, model_name, technology, rated_capacity_value, rated_capacity_unit,
   rotor_diameter_m, default_hub_height_m, hub_height_options_m, drivetrain,
   introduction_year, status, source_url, notes)
VALUES
  -- ── Onshore wind ─────────────────────────────────────────────────────
  ('onshore_wind', 'Vestas',          'V90-3.0 MW',     'three_blade_horizontal', 3.0, 'MW',
   90, 80, ARRAY[80,90,105]::numeric[], 'gearbox_dfig',
   2008, 'legacy', NULL,
   'Mid-2000s mainstream onshore turbine; large fleet now hitting end-of-life'),

  ('onshore_wind', 'Vestas',          'V112-3.45 MW',   'three_blade_horizontal', 3.45, 'MW',
   112, 94, ARRAY[84,94,119]::numeric[], 'gearbox_dfig',
   2014, 'legacy', NULL,
   'Workhorse mid-2010s onshore unit; large EU fleet'),

  ('onshore_wind', 'Vestas',          'V150-4.2 MW',    'three_blade_horizontal', 4.2, 'MW',
   150, 105, ARRAY[105,125,148,166]::numeric[], 'medium_speed',
   2019, 'in_production', 'https://www.vestas.com',
   'EnVentus platform; current onshore mainstay'),

  ('onshore_wind', 'Siemens Gamesa',  'SG 4.5-145',     'three_blade_horizontal', 4.5, 'MW',
   145, 107.5, ARRAY[107.5,127.5,165]::numeric[], 'gearbox',
   2020, 'in_production', NULL,
   'Direct competitor to Vestas V150 platform'),

  ('onshore_wind', 'GE Renewable',    'Cypress 5.5-158','three_blade_horizontal', 5.5, 'MW',
   158, 120, ARRAY[101,120,161]::numeric[], 'gearbox',
   2021, 'in_production', NULL,
   'Two-piece blade design; latest GE onshore'),

  -- ── Offshore wind ────────────────────────────────────────────────────
  ('offshore_wind','Vestas',          'V236-15.0 MW',   'three_blade_horizontal', 15.0, 'MW',
   236, 150, ARRAY[150]::numeric[], 'medium_speed',
   2024, 'in_production', NULL,
   'Largest commercial turbine to date; ramping up 2024-2026'),

  -- ── Solar PV ─────────────────────────────────────────────────────────
  ('solar_pv',     'Generic',         'Mono-Si 270 Wp', 'mono_si',                270, 'Wp',
   NULL, NULL, NULL, NULL,
   2015, 'legacy', NULL,
   'Pre-PERC mono-Si baseline; large 2014-2018 vintage fleet'),

  ('solar_pv',     'Generic',         'Mono-Si PERC 405 Wp','mono_perc',          405, 'Wp',
   NULL, NULL, NULL, NULL,
   2020, 'in_production', NULL,
   'Mainstream utility-scale PV 2019-2024'),

  ('solar_pv',     'Generic',         'TOPCon 580 Wp',  'topcon',                 580, 'Wp',
   NULL, NULL, NULL, NULL,
   2023, 'in_production', NULL,
   'Current state-of-art crystalline silicon'),

  ('solar_pv',     'First Solar',     'Series 7 CdTe',  'cdte',                   545, 'Wp',
   NULL, NULL, NULL, NULL,
   2023, 'in_production', 'https://www.firstsolar.com',
   'Thin-film, large utility-scale; non-Si recovery stream'),

  -- ── BESS ─────────────────────────────────────────────────────────────
  ('bess',         'Generic',         'LFP grid pack',  'lfp_prismatic',          1.0, 'MWh',
   NULL, NULL, NULL, NULL,
   2022, 'in_production', NULL,
   'Reference grid LFP pack (e.g. CATL EnerC, BYD Cube). Dominant grid chemistry 2022-2025.'),

  ('bess',         'Generic',         'NMC 622 grid pack','nmc_622_prismatic',    1.0, 'MWh',
   NULL, NULL, NULL, NULL,
   2018, 'in_production', NULL,
   'Earlier-generation NMC; largely displaced by LFP for grid storage'),

  ('bess',         'Generic',         'NMC 811 EV pack','nmc_811_pouch',          0.075, 'MWh',
   NULL, NULL, NULL, NULL,
   2021, 'in_production', NULL,
   'Higher-density NMC; relevant for second-life EV→grid pathways')
;

-- BESS-specific & solar-specific fields populated separately for clarity
UPDATE oem_models SET cathode_chemistry = 'lfp',     pack_format = 'prismatic', cycles_to_eol = 6000, energy_density_wh_kg = 165
  WHERE asset_class = 'bess' AND model_name = 'LFP grid pack';
UPDATE oem_models SET cathode_chemistry = 'nmc_622', pack_format = 'prismatic', cycles_to_eol = 4000, energy_density_wh_kg = 220
  WHERE asset_class = 'bess' AND model_name = 'NMC 622 grid pack';
UPDATE oem_models SET cathode_chemistry = 'nmc_811', pack_format = 'pouch',     cycles_to_eol = 2500, energy_density_wh_kg = 270
  WHERE asset_class = 'bess' AND model_name = 'NMC 811 EV pack';

UPDATE oem_models SET cell_technology = 'mono_si',   panel_wattage_w = 270, panel_area_m2 = 1.65, cell_efficiency_pct = 16.5
  WHERE asset_class = 'solar_pv' AND model_name = 'Mono-Si 270 Wp';
UPDATE oem_models SET cell_technology = 'mono_perc', panel_wattage_w = 405, panel_area_m2 = 2.00, cell_efficiency_pct = 20.3
  WHERE asset_class = 'solar_pv' AND model_name = 'Mono-Si PERC 405 Wp';
UPDATE oem_models SET cell_technology = 'topcon',    panel_wattage_w = 580, panel_area_m2 = 2.58, cell_efficiency_pct = 22.5
  WHERE asset_class = 'solar_pv' AND model_name = 'TOPCon 580 Wp';
UPDATE oem_models SET cell_technology = 'cdte',      panel_wattage_w = 545, panel_area_m2 = 2.47, cell_efficiency_pct = 22.0
  WHERE asset_class = 'solar_pv' AND model_name = 'Series 7 CdTe';

-- ── (7) Seed: material intensities ───────────────────────────────────────
--
-- Numbers compiled from publicly-available LCAs / EPDs / agency studies.
-- Each row cites source_publication; recoverability_basis flagged.
-- Round numbers shown — analysts should refine via specific OEM EPDs as
-- those become available.
--
-- Wind onshore reference: NREL Wind Turbine Materials Inventory (2023);
--   IEA Wind Task 45 Decommissioning & Recycling (2022); Vestas EPDs.
-- Solar PV reference: IEA PVPS Task 12 (2018, 2022); NREL PV Recycling.
-- BESS reference: Argonne GREET 2022; BNEF Battery Storage 2024;
--   Ellingsen et al. (NTNU) battery LCA studies.

-- Helper function: returns oem_model_id by manufacturer + model
CREATE OR REPLACE FUNCTION _oem_id(p_class text, p_mfr text, p_model text)
RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT id FROM oem_models
   WHERE asset_class = p_class
     AND manufacturer = p_mfr
     AND model_name = p_model
   LIMIT 1
$$;

-- ── Wind: per MW intensity (full turbine, foundation excluded) ──────────

-- Vestas V90-3.0 MW (legacy)
INSERT INTO material_intensities (oem_model_id, material, material_subclass, intensity_value, intensity_unit, recoverability_pct, recoverability_basis, source_publication, source_year, confidence) VALUES
  (_oem_id('onshore_wind','Vestas','V90-3.0 MW'), 'steel', 'tower',     45000, 'kg/MW', 92, 'observed_demolition', 'NREL Wind Turbine Materials Inventory 2023', 2023, 'high'),
  (_oem_id('onshore_wind','Vestas','V90-3.0 MW'), 'cast_iron','hub_main_shaft', 5500, 'kg/MW', 95, 'observed_demolition', 'NREL Wind Turbine Materials Inventory 2023', 2023, 'high'),
  (_oem_id('onshore_wind','Vestas','V90-3.0 MW'), 'copper','generator_cabling', 950, 'kg/MW', 93, 'observed_demolition', 'IEA Wind Task 45 (2022)', 2022, 'high'),
  (_oem_id('onshore_wind','Vestas','V90-3.0 MW'), 'aluminium','nacelle_cabling', 320, 'kg/MW', 88, 'observed_demolition', 'IEA Wind Task 45 (2022)', 2022, 'medium'),
  (_oem_id('onshore_wind','Vestas','V90-3.0 MW'), 'composite_gfrp','blade', 9000, 'kg/MW', 5, 'observed_demolition', 'WindEurope Blade Recycling Roadmap (2022)', 2022, 'high'),
  (_oem_id('onshore_wind','Vestas','V90-3.0 MW'), 'permanent_magnet_ndfeb','generator', 0, 'kg/MW', 0, 'theoretical', 'V90 uses DFIG, no DD magnets', 2023, 'high');

-- Vestas V112-3.45 MW
INSERT INTO material_intensities (oem_model_id, material, material_subclass, intensity_value, intensity_unit, recoverability_pct, recoverability_basis, source_publication, source_year, confidence) VALUES
  (_oem_id('onshore_wind','Vestas','V112-3.45 MW'), 'steel', 'tower',     42000, 'kg/MW', 92, 'observed_demolition', 'Vestas V112 EPD; NREL 2023', 2023, 'high'),
  (_oem_id('onshore_wind','Vestas','V112-3.45 MW'), 'cast_iron','hub_main_shaft', 5200, 'kg/MW', 95, 'observed_demolition', 'NREL 2023', 2023, 'high'),
  (_oem_id('onshore_wind','Vestas','V112-3.45 MW'), 'copper','generator_cabling', 920, 'kg/MW', 93, 'observed_demolition', 'IEA Wind Task 45 (2022)', 2022, 'high'),
  (_oem_id('onshore_wind','Vestas','V112-3.45 MW'), 'aluminium','nacelle_cabling', 310, 'kg/MW', 88, 'observed_demolition', 'IEA Wind Task 45 (2022)', 2022, 'medium'),
  (_oem_id('onshore_wind','Vestas','V112-3.45 MW'), 'composite_gfrp','blade', 10500, 'kg/MW', 8, 'observed_demolition', 'WindEurope (2022)', 2022, 'high'),
  (_oem_id('onshore_wind','Vestas','V112-3.45 MW'), 'permanent_magnet_ndfeb','generator', 0, 'kg/MW', 0, 'theoretical', 'V112 uses DFIG, no DD magnets', 2023, 'high');

-- Vestas V150-4.2 MW (current)
INSERT INTO material_intensities (oem_model_id, material, material_subclass, intensity_value, intensity_unit, recoverability_pct, recoverability_basis, source_publication, source_year, confidence) VALUES
  (_oem_id('onshore_wind','Vestas','V150-4.2 MW'), 'steel', 'tower',     38000, 'kg/MW', 93, 'industry_avg', 'Vestas V150 EnVentus EPD 2023', 2023, 'high'),
  (_oem_id('onshore_wind','Vestas','V150-4.2 MW'), 'cast_iron','hub_main_shaft', 4800, 'kg/MW', 95, 'observed_demolition', 'NREL 2023', 2023, 'high'),
  (_oem_id('onshore_wind','Vestas','V150-4.2 MW'), 'copper','generator_cabling', 880, 'kg/MW', 93, 'observed_demolition', 'IEA Wind Task 45 (2022)', 2022, 'high'),
  (_oem_id('onshore_wind','Vestas','V150-4.2 MW'), 'aluminium','nacelle_cabling', 295, 'kg/MW', 88, 'observed_demolition', 'IEA Wind Task 45 (2022)', 2022, 'medium'),
  (_oem_id('onshore_wind','Vestas','V150-4.2 MW'), 'composite_gfrp','blade', 11800, 'kg/MW', 12, 'industry_avg', 'WindEurope (2022); Vestas circularity report 2023', 2023, 'high'),
  (_oem_id('onshore_wind','Vestas','V150-4.2 MW'), 'permanent_magnet_ndfeb','generator', 0, 'kg/MW', 0, 'theoretical', 'V150 medium-speed gearbox, no full-DD magnets', 2023, 'high');

-- Siemens Gamesa SG 4.5-145
INSERT INTO material_intensities (oem_model_id, material, material_subclass, intensity_value, intensity_unit, recoverability_pct, recoverability_basis, source_publication, source_year, confidence) VALUES
  (_oem_id('onshore_wind','Siemens Gamesa','SG 4.5-145'), 'steel', 'tower',     39000, 'kg/MW', 93, 'industry_avg', 'NREL 2023; Siemens Gamesa public LCA', 2023, 'medium'),
  (_oem_id('onshore_wind','Siemens Gamesa','SG 4.5-145'), 'cast_iron','hub_main_shaft', 5000, 'kg/MW', 95, 'industry_avg', 'NREL 2023', 2023, 'medium'),
  (_oem_id('onshore_wind','Siemens Gamesa','SG 4.5-145'), 'copper','generator_cabling', 900, 'kg/MW', 93, 'industry_avg', 'IEA Wind Task 45 (2022)', 2022, 'medium'),
  (_oem_id('onshore_wind','Siemens Gamesa','SG 4.5-145'), 'aluminium','nacelle_cabling', 300, 'kg/MW', 88, 'industry_avg', 'IEA Wind Task 45 (2022)', 2022, 'medium'),
  (_oem_id('onshore_wind','Siemens Gamesa','SG 4.5-145'), 'composite_gfrp','blade', 11500, 'kg/MW', 10, 'industry_avg', 'WindEurope (2022)', 2022, 'medium'),
  (_oem_id('onshore_wind','Siemens Gamesa','SG 4.5-145'), 'permanent_magnet_ndfeb','generator', 0, 'kg/MW', 0, 'theoretical', 'SG 4.5 onshore uses gearbox; offshore variants use DD', 2023, 'high');

-- GE Cypress 5.5-158
INSERT INTO material_intensities (oem_model_id, material, material_subclass, intensity_value, intensity_unit, recoverability_pct, recoverability_basis, source_publication, source_year, confidence) VALUES
  (_oem_id('onshore_wind','GE Renewable','Cypress 5.5-158'), 'steel', 'tower',     36500, 'kg/MW', 93, 'industry_avg', 'NREL 2023; GE published spec', 2023, 'medium'),
  (_oem_id('onshore_wind','GE Renewable','Cypress 5.5-158'), 'cast_iron','hub_main_shaft', 4700, 'kg/MW', 95, 'industry_avg', 'NREL 2023', 2023, 'medium'),
  (_oem_id('onshore_wind','GE Renewable','Cypress 5.5-158'), 'copper','generator_cabling', 870, 'kg/MW', 93, 'industry_avg', 'IEA Wind Task 45 (2022)', 2022, 'medium'),
  (_oem_id('onshore_wind','GE Renewable','Cypress 5.5-158'), 'aluminium','nacelle_cabling', 290, 'kg/MW', 88, 'industry_avg', 'IEA Wind Task 45 (2022)', 2022, 'medium'),
  (_oem_id('onshore_wind','GE Renewable','Cypress 5.5-158'), 'composite_gfrp','blade', 13200, 'kg/MW', 10, 'industry_avg', 'WindEurope (2022); two-piece blade reduces transport but not material', 2022, 'medium'),
  (_oem_id('onshore_wind','GE Renewable','Cypress 5.5-158'), 'permanent_magnet_ndfeb','generator', 0, 'kg/MW', 0, 'theoretical', 'Cypress uses gearbox-DFIG, not DD', 2023, 'high');

-- Vestas V236-15 (offshore)
INSERT INTO material_intensities (oem_model_id, material, material_subclass, intensity_value, intensity_unit, recoverability_pct, recoverability_basis, source_publication, source_year, confidence) VALUES
  (_oem_id('offshore_wind','Vestas','V236-15.0 MW'), 'steel', 'tower',     58000, 'kg/MW', 93, 'industry_avg', 'NREL 2023; offshore towers heavier per MW', 2023, 'medium'),
  (_oem_id('offshore_wind','Vestas','V236-15.0 MW'), 'cast_iron','hub_main_shaft', 6200, 'kg/MW', 95, 'industry_avg', 'NREL 2023', 2023, 'medium'),
  (_oem_id('offshore_wind','Vestas','V236-15.0 MW'), 'copper','generator_cabling', 1450, 'kg/MW', 93, 'industry_avg', 'IEA Wind Task 45 (2022) — offshore higher copper for inter-array cabling', 2022, 'medium'),
  (_oem_id('offshore_wind','Vestas','V236-15.0 MW'), 'aluminium','nacelle_cabling', 380, 'kg/MW', 88, 'industry_avg', 'IEA Wind Task 45 (2022)', 2022, 'medium'),
  (_oem_id('offshore_wind','Vestas','V236-15.0 MW'), 'composite_gfrp','blade', 16800, 'kg/MW', 12, 'industry_avg', 'WindEurope (2022)', 2022, 'medium'),
  (_oem_id('offshore_wind','Vestas','V236-15.0 MW'), 'permanent_magnet_ndfeb','generator', 320, 'kg/MW', 60, 'theoretical', 'Medium-speed PMG; ~600 kg total per turbine', 2023, 'medium');

-- ── Solar PV: per Wp intensity (per panel basis × panel wattage) ────────
-- Numbers in kg/Wp; multiply by deployed wattage to get kg per system.
-- Reference: IEA PVPS Task 12, NREL PV Recycling Database.

-- Mono-Si 270 Wp (legacy)
INSERT INTO material_intensities (oem_model_id, material, material_subclass, intensity_value, intensity_unit, recoverability_pct, recoverability_basis, source_publication, source_year, confidence) VALUES
  (_oem_id('solar_pv','Generic','Mono-Si 270 Wp'), 'glass',     'front_glass',  0.190, 'kg/Wp', 90, 'industry_avg', 'IEA PVPS Task 12 (2018)', 2018, 'high'),
  (_oem_id('solar_pv','Generic','Mono-Si 270 Wp'), 'aluminium', 'frame',         0.014, 'kg/Wp', 92, 'industry_avg', 'IEA PVPS Task 12 (2018)', 2018, 'high'),
  (_oem_id('solar_pv','Generic','Mono-Si 270 Wp'), 'silicon',   'cell_si',       0.0033,'kg/Wp', 70, 'industry_avg', 'IEA PVPS Task 12 (2018)', 2018, 'high'),
  (_oem_id('solar_pv','Generic','Mono-Si 270 Wp'), 'silver',    'metallisation', 0.000125,'kg/Wp', 80, 'industry_avg', 'IEA PVPS Task 12 (2018)', 2018, 'high'),
  (_oem_id('solar_pv','Generic','Mono-Si 270 Wp'), 'copper',    'ribbons_cabling', 0.0011,'kg/Wp', 85, 'industry_avg', 'IEA PVPS Task 12 (2018)', 2018, 'high'),
  (_oem_id('solar_pv','Generic','Mono-Si 270 Wp'), 'eva',       'encapsulant',   0.018, 'kg/Wp',  0, 'theoretical',   'EVA cannot be recovered in current processes', 2018, 'high'),
  (_oem_id('solar_pv','Generic','Mono-Si 270 Wp'), 'backsheet', 'pvf_pet',       0.005, 'kg/Wp',  0, 'theoretical',   'Layered backsheet — current processes lose this', 2018, 'high');

-- Mono-Si PERC 405 Wp
INSERT INTO material_intensities (oem_model_id, material, material_subclass, intensity_value, intensity_unit, recoverability_pct, recoverability_basis, source_publication, source_year, confidence) VALUES
  (_oem_id('solar_pv','Generic','Mono-Si PERC 405 Wp'), 'glass',     'front_glass',  0.156, 'kg/Wp', 92, 'industry_avg', 'IEA PVPS Task 12 (2022)', 2022, 'high'),
  (_oem_id('solar_pv','Generic','Mono-Si PERC 405 Wp'), 'aluminium', 'frame',         0.011, 'kg/Wp', 92, 'industry_avg', 'IEA PVPS Task 12 (2022)', 2022, 'high'),
  (_oem_id('solar_pv','Generic','Mono-Si PERC 405 Wp'), 'silicon',   'cell_si',       0.0028,'kg/Wp', 75, 'industry_avg', 'IEA PVPS Task 12 (2022)', 2022, 'high'),
  (_oem_id('solar_pv','Generic','Mono-Si PERC 405 Wp'), 'silver',    'metallisation', 0.0001,'kg/Wp', 82, 'industry_avg', 'IEA PVPS Task 12 (2022); silver loading reduced', 2022, 'high'),
  (_oem_id('solar_pv','Generic','Mono-Si PERC 405 Wp'), 'copper',    'ribbons_cabling', 0.001,'kg/Wp', 88, 'industry_avg', 'IEA PVPS Task 12 (2022)', 2022, 'high'),
  (_oem_id('solar_pv','Generic','Mono-Si PERC 405 Wp'), 'eva',       'encapsulant',   0.015, 'kg/Wp',  0, 'theoretical',   'IEA PVPS Task 12 (2022)', 2022, 'high'),
  (_oem_id('solar_pv','Generic','Mono-Si PERC 405 Wp'), 'backsheet', 'pvf_pet',       0.0035,'kg/Wp',  0, 'theoretical',   'IEA PVPS Task 12 (2022)', 2022, 'high');

-- TOPCon 580 Wp
INSERT INTO material_intensities (oem_model_id, material, material_subclass, intensity_value, intensity_unit, recoverability_pct, recoverability_basis, source_publication, source_year, confidence) VALUES
  (_oem_id('solar_pv','Generic','TOPCon 580 Wp'), 'glass',     'front_back_glass', 0.130, 'kg/Wp', 92, 'industry_avg', 'Fraunhofer ISE TOPCon LCA 2024 (preliminary)', 2024, 'medium'),
  (_oem_id('solar_pv','Generic','TOPCon 580 Wp'), 'aluminium', 'frame',            0.009, 'kg/Wp', 92, 'industry_avg', 'Fraunhofer ISE 2024', 2024, 'medium'),
  (_oem_id('solar_pv','Generic','TOPCon 580 Wp'), 'silicon',   'cell_si',          0.0024,'kg/Wp', 78, 'industry_avg', 'Fraunhofer ISE 2024', 2024, 'medium'),
  (_oem_id('solar_pv','Generic','TOPCon 580 Wp'), 'silver',    'metallisation',    0.00007,'kg/Wp', 82, 'industry_avg', 'Lower silver loading vs PERC', 2024, 'medium'),
  (_oem_id('solar_pv','Generic','TOPCon 580 Wp'), 'copper',    'ribbons_cabling',  0.0009,'kg/Wp', 88, 'industry_avg', 'Fraunhofer ISE 2024', 2024, 'medium'),
  (_oem_id('solar_pv','Generic','TOPCon 580 Wp'), 'eva',       'encapsulant',      0.013, 'kg/Wp',  0, 'theoretical',   'Same encapsulant chemistry as PERC', 2024, 'medium');

-- First Solar Series 7 CdTe
INSERT INTO material_intensities (oem_model_id, material, material_subclass, intensity_value, intensity_unit, recoverability_pct, recoverability_basis, source_publication, source_year, confidence) VALUES
  (_oem_id('solar_pv','First Solar','Series 7 CdTe'), 'glass',     'front_back_glass', 0.165, 'kg/Wp', 95, 'industry_avg', 'First Solar S7 EPD 2023', 2023, 'high'),
  (_oem_id('solar_pv','First Solar','Series 7 CdTe'), 'aluminium', 'frame',            0.000, 'kg/Wp',  0, 'theoretical',   'CdTe panels are frameless', 2023, 'high'),
  (_oem_id('solar_pv','First Solar','Series 7 CdTe'), 'cadmium_telluride','semiconductor', 0.000016,'kg/Wp', 95, 'observed_demolition', 'First Solar closed-loop recycling 2023', 2023, 'high'),
  (_oem_id('solar_pv','First Solar','Series 7 CdTe'), 'copper',    'ribbons_cabling',  0.0008,'kg/Wp', 88, 'industry_avg', 'IEA PVPS Task 12 (2022)', 2022, 'medium'),
  (_oem_id('solar_pv','First Solar','Series 7 CdTe'), 'eva',       'encapsulant',      0.020, 'kg/Wp',  0, 'theoretical',   'Higher encapsulant for thin-film', 2023, 'medium');

-- ── BESS: per MWh intensity (energy-rated) ──────────────────────────────
-- Reference: Argonne GREET 2022, BNEF 2024, Ellingsen et al. NTNU LCAs.

-- LFP grid pack
INSERT INTO material_intensities (oem_model_id, material, material_subclass, intensity_value, intensity_unit, recoverability_pct, recoverability_basis, source_publication, source_year, confidence) VALUES
  (_oem_id('bess','Generic','LFP grid pack'), 'lithium_carbonate_eq', 'cathode',        90,  'kg/MWh', 60, 'target',        'BNEF 2024; recovery emerging', 2024, 'medium'),
  (_oem_id('bess','Generic','LFP grid pack'), 'iron_phosphate',       'cathode_struct', 240, 'kg/MWh',  5, 'theoretical',   'Argonne GREET 2022', 2022, 'medium'),
  (_oem_id('bess','Generic','LFP grid pack'), 'graphite',             'anode',          110, 'kg/MWh',  5, 'theoretical',   'Argonne GREET 2022', 2022, 'medium'),
  (_oem_id('bess','Generic','LFP grid pack'), 'copper',               'current_coll_anode', 80, 'kg/MWh', 92, 'industry_avg', 'BNEF 2024', 2024, 'high'),
  (_oem_id('bess','Generic','LFP grid pack'), 'aluminium',            'current_coll_cathode', 60, 'kg/MWh', 92, 'industry_avg', 'BNEF 2024', 2024, 'high'),
  (_oem_id('bess','Generic','LFP grid pack'), 'electrolyte_lipf6',    'electrolyte',    100, 'kg/MWh',  0, 'theoretical',   'Hazardous; not recovered', 2022, 'medium'),
  (_oem_id('bess','Generic','LFP grid pack'), 'steel',                'casing_racking', 720, 'kg/MWh', 95, 'industry_avg', 'BNEF 2024 — pack-level', 2024, 'high'),
  (_oem_id('bess','Generic','LFP grid pack'), 'plastic_separator',    'separator',       50, 'kg/MWh',  0, 'theoretical',   'Argonne GREET 2022', 2022, 'medium');

-- NMC 622 grid pack
INSERT INTO material_intensities (oem_model_id, material, material_subclass, intensity_value, intensity_unit, recoverability_pct, recoverability_basis, source_publication, source_year, confidence) VALUES
  (_oem_id('bess','Generic','NMC 622 grid pack'), 'lithium_carbonate_eq','cathode',        110, 'kg/MWh', 65, 'industry_avg', 'BNEF 2024', 2024, 'high'),
  (_oem_id('bess','Generic','NMC 622 grid pack'), 'nickel',              'cathode',        320, 'kg/MWh', 90, 'observed_demolition', 'BNEF 2024 — high-value recovery', 2024, 'high'),
  (_oem_id('bess','Generic','NMC 622 grid pack'), 'cobalt',              'cathode',        100, 'kg/MWh', 95, 'observed_demolition', 'BNEF 2024 — high-value recovery, target metal', 2024, 'high'),
  (_oem_id('bess','Generic','NMC 622 grid pack'), 'manganese',           'cathode',         95, 'kg/MWh', 60, 'industry_avg', 'BNEF 2024', 2024, 'medium'),
  (_oem_id('bess','Generic','NMC 622 grid pack'), 'graphite',            'anode',           95, 'kg/MWh',  5, 'theoretical',   'Argonne GREET 2022', 2022, 'medium'),
  (_oem_id('bess','Generic','NMC 622 grid pack'), 'copper',              'current_coll_anode', 75, 'kg/MWh', 92, 'industry_avg', 'BNEF 2024', 2024, 'high'),
  (_oem_id('bess','Generic','NMC 622 grid pack'), 'aluminium',           'current_coll_cathode', 55, 'kg/MWh', 92, 'industry_avg', 'BNEF 2024', 2024, 'high'),
  (_oem_id('bess','Generic','NMC 622 grid pack'), 'electrolyte_lipf6',   'electrolyte',     90, 'kg/MWh',  0, 'theoretical',   'Hazardous; not recovered', 2022, 'medium'),
  (_oem_id('bess','Generic','NMC 622 grid pack'), 'steel',               'casing_racking', 600, 'kg/MWh', 95, 'industry_avg', 'BNEF 2024', 2024, 'high');

-- NMC 811 EV pack
INSERT INTO material_intensities (oem_model_id, material, material_subclass, intensity_value, intensity_unit, recoverability_pct, recoverability_basis, source_publication, source_year, confidence) VALUES
  (_oem_id('bess','Generic','NMC 811 EV pack'), 'lithium_carbonate_eq','cathode',         95, 'kg/MWh', 65, 'industry_avg', 'BNEF 2024', 2024, 'high'),
  (_oem_id('bess','Generic','NMC 811 EV pack'), 'nickel',              'cathode',        420, 'kg/MWh', 90, 'observed_demolition', 'BNEF 2024 — high-value recovery', 2024, 'high'),
  (_oem_id('bess','Generic','NMC 811 EV pack'), 'cobalt',              'cathode',         55, 'kg/MWh', 95, 'observed_demolition', 'BNEF 2024 — lower Co loading vs 622', 2024, 'high'),
  (_oem_id('bess','Generic','NMC 811 EV pack'), 'manganese',           'cathode',         55, 'kg/MWh', 60, 'industry_avg', 'BNEF 2024', 2024, 'medium'),
  (_oem_id('bess','Generic','NMC 811 EV pack'), 'graphite',            'anode',           85, 'kg/MWh',  5, 'theoretical',   'Argonne GREET 2022', 2022, 'medium'),
  (_oem_id('bess','Generic','NMC 811 EV pack'), 'copper',              'current_coll_anode', 65, 'kg/MWh', 92, 'industry_avg', 'BNEF 2024', 2024, 'high'),
  (_oem_id('bess','Generic','NMC 811 EV pack'), 'aluminium',           'current_coll_cathode', 50, 'kg/MWh', 92, 'industry_avg', 'BNEF 2024', 2024, 'high'),
  (_oem_id('bess','Generic','NMC 811 EV pack'), 'electrolyte_lipf6',   'electrolyte',     85, 'kg/MWh',  0, 'theoretical',   'Hazardous; not recovered', 2022, 'medium'),
  (_oem_id('bess','Generic','NMC 811 EV pack'), 'steel',               'casing_racking', 380, 'kg/MWh', 95, 'industry_avg', 'BNEF 2024 — lighter EV pack', 2024, 'high');

-- Drop helper function — no longer needed after seed
DROP FUNCTION IF EXISTS _oem_id(text, text, text);

-- ── (8) Telemetry ────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_039_smi_scrap_and_intensities', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM oem_models),
  'Migration 039 — SMI schema (scrap_price_benchmarks + oem_models + material_intensities)',
  'Seeded 13 OEM models (5 onshore + 1 offshore wind, 4 solar, 3 BESS) and ~80 material-intensity rows from public LCAs / EPDs / agency studies. scrap_price_benchmarks left empty — populate via Argus PDF ingester or direct insert.'
);
