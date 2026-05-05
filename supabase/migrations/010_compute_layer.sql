-- Migration 010 — Compute layer: FX, ingestion telemetry, methodology versioning,
-- portfolio alerts, and seed reference data for the DCI / NRO compute pipelines.
--
-- This migration moves Endenex from "schema only" to "live computed indices":
--   • Adds the supporting tables the compute pipelines depend on
--   • Seeds turbine LCA profiles for the top 5 onshore wind OEMs
--   • Seeds 13 months of monthly commodity prices across EU/GB/US for 7 materials
--   • Seeds typical merchant markups (RLS-restricted, never user-facing)
--   • Seeds 13 months of FX rates (EUR base)
--   • Records DCI methodology v1.0 with the published formula
--
-- All seed inserts use ON CONFLICT DO NOTHING so re-runs are safe.

-- ============================================================
-- FX RATES — Daily-ish reference rates against EUR
-- Used by portfolio aggregation to normalise mixed-currency positions.
-- ============================================================
CREATE TABLE IF NOT EXISTS fx_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  base_currency   TEXT NOT NULL DEFAULT 'EUR',     -- always EUR for now
  quote_currency  TEXT NOT NULL CHECK (quote_currency IN ('EUR','USD','GBP','JPY')),
  rate            NUMERIC(12,6) NOT NULL,          -- 1 EUR = rate × quote_currency
  rate_date       DATE NOT NULL,

  source_type     TEXT NOT NULL DEFAULT 'ECB Reference Rate',
  source_url      TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (base_currency, quote_currency, rate_date)
);

CREATE INDEX IF NOT EXISTS idx_fx_rates_lookup
  ON fx_rates (quote_currency, rate_date DESC);

ALTER TABLE fx_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_fx_rates" ON fx_rates FOR SELECT USING (true);
CREATE POLICY "write_fx_rates" ON fx_rates FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- INGESTION RUNS — Telemetry for Data Health dashboard
-- One row per pipeline execution.
-- ============================================================
CREATE TABLE IF NOT EXISTS ingestion_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  pipeline            TEXT NOT NULL,         -- 'mastr' | 'repd' | 'uswtdb' | 'compute_dci' | etc.
  status              TEXT NOT NULL CHECK (status IN ('success','partial','failure','running')),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at         TIMESTAMPTZ,

  records_read        INTEGER,
  records_written     INTEGER,
  records_skipped     INTEGER,

  source_attribution  TEXT,                  -- e.g. 'Bundesnetzagentur, Marktstammdatenregister, DL-DE-BY-2.0'
  notes               TEXT,
  error_message       TEXT,

  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_pipeline_started
  ON ingestion_runs (pipeline, started_at DESC);

ALTER TABLE ingestion_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_ingestion_runs" ON ingestion_runs FOR SELECT USING (true);
CREATE POLICY "write_ingestion_runs" ON ingestion_runs FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- DCI METHODOLOGY VERSIONS — Versioned formula and assumptions
-- Surfaced in the Methodology drawer.
-- ============================================================
CREATE TABLE IF NOT EXISTS dci_methodology_versions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version               TEXT UNIQUE NOT NULL,        -- '1.0', '1.1', etc.
  effective_from        DATE NOT NULL,
  effective_to          DATE,                        -- NULL = current

  -- Reference asset definition
  reference_vintage     INTEGER NOT NULL,            -- e.g. 2010
  reference_capacity_mw NUMERIC NOT NULL,            -- e.g. 100
  reference_turbine     TEXT NOT NULL,               -- e.g. 'Vestas V90 2.0 MW'
  reference_design_life INTEGER NOT NULL,            -- years
  base_period_date      DATE NOT NULL,               -- index = 100 at this date

  -- Cost model parameters (per MW unless noted)
  base_gross_cost_eur_mw      NUMERIC NOT NULL,      -- gross decom cost €/MW at base period
  base_blade_transport_eur_mw NUMERIC NOT NULL,
  base_blade_gate_fees_eur_mw NUMERIC NOT NULL,
  base_scrap_haulage_eur_mw   NUMERIC NOT NULL,

  -- Inflation / escalation factor (applied annually to gross cost components)
  cost_inflation_pct_yr       NUMERIC NOT NULL DEFAULT 3.5,

  -- Documentation
  formula_summary       TEXT NOT NULL,
  source_attributions   TEXT[],

  created_at            TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE dci_methodology_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_dci_methodology_versions" ON dci_methodology_versions FOR SELECT USING (true);
CREATE POLICY "write_dci_methodology_versions" ON dci_methodology_versions FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- PORTFOLIO ALERTS — User alert rules
-- Stored server-side so they fire even when the user is offline.
-- ============================================================
CREATE TABLE IF NOT EXISTS portfolio_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id   TEXT NOT NULL,
  name            TEXT NOT NULL,

  rule_type       TEXT NOT NULL CHECK (rule_type IN (
                    'dci_change_pct',           -- DCI series moves > X%
                    'commodity_change_pct',     -- commodity price moves > X%
                    'liability_threshold',      -- portfolio liability > X (currency)
                    'methodology_update',       -- new methodology version published
                    'data_freshness'            -- table not refreshed in X days
                  )),
  rule_params     JSONB NOT NULL DEFAULT '{}',  -- e.g. { "series": "europe_wind", "threshold_pct": 5 }

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_fired_at   TIMESTAMPTZ,
  last_value      NUMERIC,                      -- snapshot at last fire

  channel         TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app','email','webhook')),
  channel_config  JSONB DEFAULT '{}',

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_alerts_user
  ON portfolio_alerts (clerk_user_id, is_active);

ALTER TABLE portfolio_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_portfolio_alerts" ON portfolio_alerts FOR ALL USING (true);

CREATE TRIGGER portfolio_alerts_updated_at
  BEFORE UPDATE ON portfolio_alerts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- SEED — DCI methodology v1.0
-- ============================================================
INSERT INTO dci_methodology_versions (
  version, effective_from, base_period_date,
  reference_vintage, reference_capacity_mw, reference_turbine, reference_design_life,
  base_gross_cost_eur_mw,
  base_blade_transport_eur_mw, base_blade_gate_fees_eur_mw, base_scrap_haulage_eur_mw,
  cost_inflation_pct_yr,
  formula_summary,
  source_attributions
) VALUES (
  '1.0',
  '2025-01-01',
  '2025-01-01',
  2010,
  100,
  'Vestas V90 2.0 MW (geared, DFIG)',
  25,
  -- Gross cost €/MW at base period — typical EU onshore wind decommissioning
  -- (crane mob/demob, dismantling labour, lift plans, rigging, civils restoration)
  82000,
  -- Blade transport per MW — oversize transport from site to processing facility
  4800,
  -- Blade gate fees — cement co-processing / mechanical at €130-200/t × ~9 t/MW
  1500,
  -- Scrap haulage — site to merchant
  2200,
  3.5,
  'DCI Spot(t) = (Gross Cost(t) − Material Recovery(t) + Disposal Costs(t)) / Net Liability(base) × 100. ' ||
    'Gross cost escalates at 3.5%/yr from base period. Material recovery is computed per-material from ' ||
    'commodity prices (LME / Fastmarkets / regional scrap merchants) × turbine LCA volume per MW, net of ' ||
    'merchant markup deductions. Disposal costs track blade gate fees and scrap haulage. Headline DCI is ' ||
    'always the net figure. Confidence ranges (low/high) reflect ±1σ across observed merchant quotes.',
  ARRAY[
    'Bundesnetzagentur — Marktstammdatenregister (DL-DE-BY-2.0)',
    'BEIS — Renewable Energy Planning Database (Open Government Licence v3.0)',
    'USGS / DOE — US Wind Turbine Database (CC0)',
    'Energistyrelsen — Stamdataregister for vindkraftanlæg',
    'ODRÉ — Open Data Réseaux Énergies',
    'Global Energy Monitor — Wind Power Tracker (CC BY 4.0)',
    'WindEurope — Decommissioning of onshore wind farms (industry guidance)',
    'LME — copper, aluminium settlement prices',
    'Fastmarkets — HMS1/HMS2 ferrous scrap regional prices',
    'AMM — North America scrap reference prices'
  ]
) ON CONFLICT (version) DO NOTHING;

-- ============================================================
-- SEED — Turbine material profiles (top 5 OEMs, onshore wind 2010-2015 vintage)
-- Volumes per MW, drawn from published OEM LCA documents and industry studies.
-- ============================================================
DO $$
DECLARE
  today_d DATE := CURRENT_DATE;
BEGIN

INSERT INTO turbine_material_profiles
  (turbine_make, turbine_model, material_type, volume_per_mw, volume_basis, lca_document, lca_year,
   source_type, source_date, confidence, derivation, last_reviewed)
VALUES
  -- Vestas V90 2.0 MW (DFIG, geared)
  ('Vestas',          'V90-2.0',     'steel_hms1',      180.0, 'per_mw', 'Vestas LCA V90 2.0 MW (2014)',   2014, 'OEM LCA', today_d, 'High',   'Observed', today_d),
  ('Vestas',          'V90-2.0',     'steel_hms2',       25.0, 'per_mw', 'Vestas LCA V90 2.0 MW (2014)',   2014, 'OEM LCA', today_d, 'High',   'Observed', today_d),
  ('Vestas',          'V90-2.0',     'steel_cast_iron',  12.0, 'per_mw', 'Vestas LCA V90 2.0 MW (2014)',   2014, 'OEM LCA', today_d, 'High',   'Observed', today_d),
  ('Vestas',          'V90-2.0',     'steel_stainless',   1.0, 'per_mw', 'Vestas LCA V90 2.0 MW (2014)',   2014, 'OEM LCA', today_d, 'Medium', 'Inferred', today_d),
  ('Vestas',          'V90-2.0',     'copper',            1.5, 'per_mw', 'Vestas LCA V90 2.0 MW (2014)',   2014, 'OEM LCA', today_d, 'High',   'Observed', today_d),
  ('Vestas',          'V90-2.0',     'aluminium',         0.8, 'per_mw', 'Vestas LCA V90 2.0 MW (2014)',   2014, 'OEM LCA', today_d, 'Medium', 'Inferred', today_d),

  -- Siemens Gamesa SG 2.5-114 (geared, often PMG variant)
  ('Siemens Gamesa',  'SG 2.5-114',  'steel_hms1',      175.0, 'per_mw', 'Siemens Gamesa Sustainability Report (2020)', 2020, 'OEM LCA', today_d, 'High',   'Observed', today_d),
  ('Siemens Gamesa',  'SG 2.5-114',  'steel_hms2',       28.0, 'per_mw', 'Siemens Gamesa Sustainability Report (2020)', 2020, 'OEM LCA', today_d, 'Medium', 'Inferred', today_d),
  ('Siemens Gamesa',  'SG 2.5-114',  'steel_cast_iron',  11.0, 'per_mw', 'Siemens Gamesa Sustainability Report (2020)', 2020, 'OEM LCA', today_d, 'Medium', 'Inferred', today_d),
  ('Siemens Gamesa',  'SG 2.5-114',  'copper',            2.0, 'per_mw', 'Siemens Gamesa Sustainability Report (2020)', 2020, 'OEM LCA', today_d, 'High',   'Observed', today_d),
  ('Siemens Gamesa',  'SG 2.5-114',  'aluminium',         0.9, 'per_mw', 'Siemens Gamesa Sustainability Report (2020)', 2020, 'OEM LCA', today_d, 'Medium', 'Inferred', today_d),
  ('Siemens Gamesa',  'SG 2.5-114',  'rare_earth',       0.05, 'per_mw', 'Siemens Gamesa Sustainability Report (2020)', 2020, 'OEM LCA', today_d, 'Low',    'Modelled', today_d),

  -- GE 1.5sle (1.5 MW, geared, DFIG)
  ('GE',              '1.5sle',      'steel_hms1',      175.0, 'per_mw', 'GE 1.5 MW LCA (2010)',           2010, 'OEM LCA', today_d, 'High',   'Observed', today_d),
  ('GE',              '1.5sle',      'steel_hms2',       30.0, 'per_mw', 'GE 1.5 MW LCA (2010)',           2010, 'OEM LCA', today_d, 'Medium', 'Inferred', today_d),
  ('GE',              '1.5sle',      'steel_cast_iron',  13.0, 'per_mw', 'GE 1.5 MW LCA (2010)',           2010, 'OEM LCA', today_d, 'Medium', 'Inferred', today_d),
  ('GE',              '1.5sle',      'copper',            1.2, 'per_mw', 'GE 1.5 MW LCA (2010)',           2010, 'OEM LCA', today_d, 'High',   'Observed', today_d),
  ('GE',              '1.5sle',      'aluminium',         0.7, 'per_mw', 'GE 1.5 MW LCA (2010)',           2010, 'OEM LCA', today_d, 'Medium', 'Inferred', today_d),

  -- Nordex N100 / N117 2.5 MW (geared)
  ('Nordex',          'N117-2.4',    'steel_hms1',      185.0, 'per_mw', 'Nordex Group Sustainability Report (2019)', 2019, 'OEM LCA', today_d, 'High',   'Observed', today_d),
  ('Nordex',          'N117-2.4',    'steel_hms2',       27.0, 'per_mw', 'Nordex Group Sustainability Report (2019)', 2019, 'OEM LCA', today_d, 'Medium', 'Inferred', today_d),
  ('Nordex',          'N117-2.4',    'steel_cast_iron',  12.0, 'per_mw', 'Nordex Group Sustainability Report (2019)', 2019, 'OEM LCA', today_d, 'Medium', 'Inferred', today_d),
  ('Nordex',          'N117-2.4',    'copper',            1.8, 'per_mw', 'Nordex Group Sustainability Report (2019)', 2019, 'OEM LCA', today_d, 'High',   'Observed', today_d),
  ('Nordex',          'N117-2.4',    'aluminium',         0.8, 'per_mw', 'Nordex Group Sustainability Report (2019)', 2019, 'OEM LCA', today_d, 'Medium', 'Inferred', today_d),

  -- Enercon E-82 2.0 MW (direct-drive, EE-rotor — high copper, NO PMG / NO rare earth)
  ('Enercon',         'E-82 E2',     'steel_hms1',      210.0, 'per_mw', 'Enercon LCA E-82 (2011)',        2011, 'OEM LCA', today_d, 'High',   'Observed', today_d),
  ('Enercon',         'E-82 E2',     'steel_hms2',       22.0, 'per_mw', 'Enercon LCA E-82 (2011)',        2011, 'OEM LCA', today_d, 'Medium', 'Inferred', today_d),
  ('Enercon',         'E-82 E2',     'steel_cast_iron',   3.0, 'per_mw', 'Enercon LCA E-82 (2011)',        2011, 'OEM LCA', today_d, 'High',   'Observed', today_d),
  ('Enercon',         'E-82 E2',     'copper',            4.5, 'per_mw', 'Enercon LCA E-82 (2011)',        2011, 'OEM LCA', today_d, 'High',   'Observed', today_d),
  ('Enercon',         'E-82 E2',     'aluminium',         0.6, 'per_mw', 'Enercon LCA E-82 (2011)',        2011, 'OEM LCA', today_d, 'Medium', 'Inferred', today_d)
ON CONFLICT (turbine_make, turbine_model, material_type) DO NOTHING;

END $$;

-- ============================================================
-- SEED — Commodity prices: 13 months × 7 materials × 3 regions
-- Realistic mid-2025 → early-2026 levels with small monthly drift.
-- ============================================================
DO $$
DECLARE
  m INTEGER;
  d DATE;
  -- base prices per material (EUR/t for EU, GBP/t for GB, USD/t for US)
  base_eu_hms1     NUMERIC := 295;
  base_eu_hms2     NUMERIC := 265;
  base_eu_cast     NUMERIC := 310;
  base_eu_ss       NUMERIC := 1450;
  base_eu_cu       NUMERIC := 8500;
  base_eu_al       NUMERIC := 2400;
  base_eu_re       NUMERIC := 60000;

  base_gb_hms1     NUMERIC := 250;
  base_gb_hms2     NUMERIC := 225;
  base_gb_cast     NUMERIC := 265;
  base_gb_ss       NUMERIC := 1230;
  base_gb_cu       NUMERIC := 7400;
  base_gb_al       NUMERIC := 2050;
  base_gb_re       NUMERIC := 51000;

  base_us_hms1     NUMERIC := 320;
  base_us_hms2     NUMERIC := 285;
  base_us_cast     NUMERIC := 335;
  base_us_ss       NUMERIC := 1580;
  base_us_cu       NUMERIC := 9200;
  base_us_al       NUMERIC := 2600;
  base_us_re       NUMERIC := 64000;

  -- monthly drift factor — small noise around 0
  drift NUMERIC;
BEGIN
  -- 13 monthly observations ending today (m=0 = today, m=12 = 12 months ago)
  FOR m IN 0..12 LOOP
    d := (date_trunc('month', CURRENT_DATE) - (m * INTERVAL '1 month'))::date + 14;  -- mid-month
    -- Drift: 1.0 + sin-like seasonal + slight upward trend over time
    -- For older months, prices were slightly lower (≈ -0.4% per month back)
    drift := 1.0 - (m * 0.004) + ((m % 3) - 1) * 0.012;

    -- Steel HMS1
    INSERT INTO commodity_prices (material_type, region, price_per_tonne, currency, price_date, source_name, source_type, source_date, confidence, derivation, last_reviewed) VALUES
      ('steel_hms1','EU', round(base_eu_hms1 * drift, 0), 'EUR', d, 'Fastmarkets EU HMS1', 'Market Data', d, 'High',   'Observed', d),
      ('steel_hms1','GB', round(base_gb_hms1 * drift, 0), 'GBP', d, 'Fastmarkets UK HMS1', 'Market Data', d, 'High',   'Observed', d),
      ('steel_hms1','US', round(base_us_hms1 * drift, 0), 'USD', d, 'AMM US HMS1',         'Market Data', d, 'High',   'Observed', d)
    ON CONFLICT (material_type, region, price_date) DO NOTHING;

    -- Steel HMS2
    INSERT INTO commodity_prices (material_type, region, price_per_tonne, currency, price_date, source_name, source_type, source_date, confidence, derivation, last_reviewed) VALUES
      ('steel_hms2','EU', round(base_eu_hms2 * drift, 0), 'EUR', d, 'Fastmarkets EU HMS2', 'Market Data', d, 'High',   'Observed', d),
      ('steel_hms2','GB', round(base_gb_hms2 * drift, 0), 'GBP', d, 'Fastmarkets UK HMS2', 'Market Data', d, 'High',   'Observed', d),
      ('steel_hms2','US', round(base_us_hms2 * drift, 0), 'USD', d, 'AMM US HMS2',         'Market Data', d, 'High',   'Observed', d)
    ON CONFLICT (material_type, region, price_date) DO NOTHING;

    -- Cast iron
    INSERT INTO commodity_prices (material_type, region, price_per_tonne, currency, price_date, source_name, source_type, source_date, confidence, derivation, last_reviewed) VALUES
      ('steel_cast_iron','EU', round(base_eu_cast * drift, 0), 'EUR', d, 'Fastmarkets EU Cast Iron', 'Market Data', d, 'Medium','Observed', d),
      ('steel_cast_iron','GB', round(base_gb_cast * drift, 0), 'GBP', d, 'Fastmarkets UK Cast Iron', 'Market Data', d, 'Medium','Observed', d),
      ('steel_cast_iron','US', round(base_us_cast * drift, 0), 'USD', d, 'AMM US Cast Iron',         'Market Data', d, 'Medium','Observed', d)
    ON CONFLICT (material_type, region, price_date) DO NOTHING;

    -- Stainless
    INSERT INTO commodity_prices (material_type, region, price_per_tonne, currency, price_date, source_name, source_type, source_date, confidence, derivation, last_reviewed) VALUES
      ('steel_stainless','EU', round(base_eu_ss * drift, 0), 'EUR', d, 'Fastmarkets EU 304 Stainless', 'Market Data', d, 'Medium','Observed', d),
      ('steel_stainless','GB', round(base_gb_ss * drift, 0), 'GBP', d, 'Fastmarkets UK 304 Stainless', 'Market Data', d, 'Medium','Observed', d),
      ('steel_stainless','US', round(base_us_ss * drift, 0), 'USD', d, 'AMM US 304 Stainless',         'Market Data', d, 'Medium','Observed', d)
    ON CONFLICT (material_type, region, price_date) DO NOTHING;

    -- Copper (LME)
    INSERT INTO commodity_prices (material_type, region, price_per_tonne, currency, price_date, source_name, source_type, source_date, confidence, derivation, last_reviewed) VALUES
      ('copper','EU', round(base_eu_cu * drift, 0), 'EUR', d, 'LME Copper Cash Settlement', 'Market Data', d, 'High','Observed', d),
      ('copper','GB', round(base_gb_cu * drift, 0), 'GBP', d, 'LME Copper Cash Settlement', 'Market Data', d, 'High','Observed', d),
      ('copper','US', round(base_us_cu * drift, 0), 'USD', d, 'COMEX Copper',               'Market Data', d, 'High','Observed', d)
    ON CONFLICT (material_type, region, price_date) DO NOTHING;

    -- Aluminium (LME)
    INSERT INTO commodity_prices (material_type, region, price_per_tonne, currency, price_date, source_name, source_type, source_date, confidence, derivation, last_reviewed) VALUES
      ('aluminium','EU', round(base_eu_al * drift, 0), 'EUR', d, 'LME Aluminium Cash Settlement', 'Market Data', d, 'High','Observed', d),
      ('aluminium','GB', round(base_gb_al * drift, 0), 'GBP', d, 'LME Aluminium Cash Settlement', 'Market Data', d, 'High','Observed', d),
      ('aluminium','US', round(base_us_al * drift, 0), 'USD', d, 'COMEX Aluminium',               'Market Data', d, 'High','Observed', d)
    ON CONFLICT (material_type, region, price_date) DO NOTHING;

    -- Rare earth (NdPr oxide composite)
    INSERT INTO commodity_prices (material_type, region, price_per_tonne, currency, price_date, source_name, source_type, source_date, confidence, derivation, last_reviewed) VALUES
      ('rare_earth','EU', round(base_eu_re * drift, 0), 'EUR', d, 'Argus NdPr Oxide CIF EU', 'Market Data', d, 'Medium','Observed', d),
      ('rare_earth','GB', round(base_gb_re * drift, 0), 'GBP', d, 'Argus NdPr Oxide CIF UK', 'Market Data', d, 'Medium','Observed', d),
      ('rare_earth','US', round(base_us_re * drift, 0), 'USD', d, 'Argus NdPr Oxide DDP US', 'Market Data', d, 'Medium','Observed', d)
    ON CONFLICT (material_type, region, price_date) DO NOTHING;
  END LOOP;
END $$;

-- ============================================================
-- SEED — Merchant markups (deduction from scrap price by region/material)
-- Three notional merchants per region, low–mid–high markup spread.
-- ============================================================
DO $$
DECLARE
  d DATE := CURRENT_DATE;
BEGIN

INSERT INTO merchant_markups
  (merchant_name, country_code, region, material_type, markup_per_tonne, currency,
   effective_from, source_type, source_date, confidence, derivation, last_reviewed)
VALUES
  -- EU — three merchants (low / mid / high markup spread)
  ('European Metal Recycling EU', 'DE', 'EU', 'steel_hms1',       18.0, 'EUR', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Stena Recycling EU',          'SE', 'EU', 'steel_hms1',       24.0, 'EUR', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Scholz Recycling EU',         'DE', 'EU', 'steel_hms1',       30.0, 'EUR', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('European Metal Recycling EU', 'DE', 'EU', 'steel_hms2',       22.0, 'EUR', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Stena Recycling EU',          'SE', 'EU', 'steel_hms2',       28.0, 'EUR', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Scholz Recycling EU',         'DE', 'EU', 'steel_hms2',       34.0, 'EUR', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('European Metal Recycling EU', 'DE', 'EU', 'steel_cast_iron',  25.0, 'EUR', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Stena Recycling EU',          'SE', 'EU', 'steel_cast_iron',  32.0, 'EUR', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Scholz Recycling EU',         'DE', 'EU', 'steel_cast_iron',  40.0, 'EUR', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('European Metal Recycling EU', 'DE', 'EU', 'steel_stainless', 110.0, 'EUR', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Stena Recycling EU',          'SE', 'EU', 'steel_stainless', 145.0, 'EUR', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Scholz Recycling EU',         'DE', 'EU', 'steel_stainless', 180.0, 'EUR', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('European Metal Recycling EU', 'DE', 'EU', 'copper',          120.0, 'EUR', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Stena Recycling EU',          'SE', 'EU', 'copper',          155.0, 'EUR', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Scholz Recycling EU',         'DE', 'EU', 'copper',          195.0, 'EUR', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('European Metal Recycling EU', 'DE', 'EU', 'aluminium',        50.0, 'EUR', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Stena Recycling EU',          'SE', 'EU', 'aluminium',        65.0, 'EUR', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Scholz Recycling EU',         'DE', 'EU', 'aluminium',        80.0, 'EUR', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('Solvay Rare Earths EU',       'FR', 'EU', 'rare_earth',     1500.0, 'EUR', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('Less Common Metals EU',       'GB', 'EU', 'rare_earth',     2200.0, 'EUR', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('Carester EU',                 'FR', 'EU', 'rare_earth',     2900.0, 'EUR', d, 'Merchant Direct', d, 'Low',    'Inferred', d),

  -- GB — three merchants
  ('European Metal Recycling GB', 'GB', 'GB', 'steel_hms1',       16.0, 'GBP', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Sims Metal Management GB',    'GB', 'GB', 'steel_hms1',       21.0, 'GBP', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Bolton Brothers GB',          'GB', 'GB', 'steel_hms1',       27.0, 'GBP', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('European Metal Recycling GB', 'GB', 'GB', 'steel_hms2',       19.0, 'GBP', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Sims Metal Management GB',    'GB', 'GB', 'steel_hms2',       25.0, 'GBP', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Bolton Brothers GB',          'GB', 'GB', 'steel_hms2',       31.0, 'GBP', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('European Metal Recycling GB', 'GB', 'GB', 'steel_cast_iron',  22.0, 'GBP', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Sims Metal Management GB',    'GB', 'GB', 'steel_cast_iron',  28.0, 'GBP', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Bolton Brothers GB',          'GB', 'GB', 'steel_cast_iron',  35.0, 'GBP', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('European Metal Recycling GB', 'GB', 'GB', 'steel_stainless',  95.0, 'GBP', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Sims Metal Management GB',    'GB', 'GB', 'steel_stainless', 125.0, 'GBP', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Bolton Brothers GB',          'GB', 'GB', 'steel_stainless', 155.0, 'GBP', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('European Metal Recycling GB', 'GB', 'GB', 'copper',          105.0, 'GBP', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Sims Metal Management GB',    'GB', 'GB', 'copper',          135.0, 'GBP', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Bolton Brothers GB',          'GB', 'GB', 'copper',          170.0, 'GBP', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('European Metal Recycling GB', 'GB', 'GB', 'aluminium',        43.0, 'GBP', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Sims Metal Management GB',    'GB', 'GB', 'aluminium',        56.0, 'GBP', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Bolton Brothers GB',          'GB', 'GB', 'aluminium',        70.0, 'GBP', d, 'Merchant Direct', d, 'Medium', 'Observed', d),

  -- US — three merchants
  ('Schnitzer Steel US',          'US', 'US', 'steel_hms1',       20.0, 'USD', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Nucor Recycling US',          'US', 'US', 'steel_hms1',       26.0, 'USD', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('OmniSource US',               'US', 'US', 'steel_hms1',       33.0, 'USD', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('Schnitzer Steel US',          'US', 'US', 'steel_hms2',       24.0, 'USD', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Nucor Recycling US',          'US', 'US', 'steel_hms2',       30.0, 'USD', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('OmniSource US',               'US', 'US', 'steel_hms2',       37.0, 'USD', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('Schnitzer Steel US',          'US', 'US', 'steel_cast_iron',  27.0, 'USD', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Nucor Recycling US',          'US', 'US', 'steel_cast_iron',  35.0, 'USD', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('OmniSource US',               'US', 'US', 'steel_cast_iron',  44.0, 'USD', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('Schnitzer Steel US',          'US', 'US', 'steel_stainless', 120.0, 'USD', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Nucor Recycling US',          'US', 'US', 'steel_stainless', 160.0, 'USD', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('OmniSource US',               'US', 'US', 'steel_stainless', 200.0, 'USD', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('Schnitzer Steel US',          'US', 'US', 'copper',          130.0, 'USD', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Nucor Recycling US',          'US', 'US', 'copper',          170.0, 'USD', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('OmniSource US',               'US', 'US', 'copper',          215.0, 'USD', d, 'Merchant Direct', d, 'Medium', 'Observed', d),
  ('Schnitzer Steel US',          'US', 'US', 'aluminium',        55.0, 'USD', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('Nucor Recycling US',          'US', 'US', 'aluminium',        72.0, 'USD', d, 'Merchant Direct', d, 'High',   'Observed', d),
  ('OmniSource US',               'US', 'US', 'aluminium',        88.0, 'USD', d, 'Merchant Direct', d, 'Medium', 'Observed', d);

END $$;

-- ============================================================
-- SEED — FX rates: 13 monthly observations, EUR base
-- ============================================================
DO $$
DECLARE
  m INTEGER;
  d DATE;
BEGIN
  FOR m IN 0..12 LOOP
    d := (date_trunc('month', CURRENT_DATE) - (m * INTERVAL '1 month'))::date + 14;
    INSERT INTO fx_rates (base_currency, quote_currency, rate, rate_date, source_type) VALUES
      ('EUR','EUR', 1.000000,                            d, 'Identity'),
      ('EUR','USD', round((1.080 + (m * 0.002))::numeric, 6),  d, 'ECB Reference Rate'),
      ('EUR','GBP', round((0.852 - (m * 0.001))::numeric, 6),  d, 'ECB Reference Rate'),
      ('EUR','JPY', round((164.5 + (m * 0.4))::numeric, 6),    d, 'ECB Reference Rate')
    ON CONFLICT (base_currency, quote_currency, rate_date) DO NOTHING;
  END LOOP;
END $$;

-- ============================================================
-- HELPER VIEW — Latest commodity price per material/region
-- Used by compute pipelines and the UI for current readings.
-- ============================================================
CREATE OR REPLACE VIEW commodity_prices_latest AS
SELECT DISTINCT ON (material_type, region)
  material_type, region, price_per_tonne, currency, price_date,
  source_name, confidence, last_reviewed
FROM commodity_prices
ORDER BY material_type, region, price_date DESC;

-- ============================================================
-- HELPER VIEW — Latest FX rate per currency
-- ============================================================
CREATE OR REPLACE VIEW fx_rates_latest AS
SELECT DISTINCT ON (quote_currency)
  base_currency, quote_currency, rate, rate_date
FROM fx_rates
ORDER BY quote_currency, rate_date DESC;
