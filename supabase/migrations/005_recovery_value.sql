-- Migration 005 — Recovery Value Module
-- Three-layer data model: material profiles (LCA) + commodity prices + merchant markups
-- Merchant markups are confidential: service_role read only.
-- nro_estimates exposes only net figures to authenticated users.

-- ============================================================
-- MATERIAL TYPES
-- ============================================================
-- steel_hms1     Heavy Melting Scrap 1 — tower sections, heavy plate
-- steel_hms2     Heavy Melting Scrap 2 — thinner structural sections
-- steel_cast_iron  Gearbox housing (geared turbines only)
-- steel_stainless  Smaller nacelle components
-- copper         Generator windings, cabling
-- aluminium      Nacelle housing, components
-- rare_earth     Permanent magnet generators only — not all turbines

-- ============================================================
-- TURBINE MATERIAL PROFILES
-- Source: OEM Life Cycle Assessment (LCA) documents
-- One row per turbine model per material type.
-- ============================================================
CREATE TABLE IF NOT EXISTS turbine_material_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  turbine_make      TEXT NOT NULL,
  turbine_model     TEXT NOT NULL,

  material_type     TEXT NOT NULL CHECK (material_type IN (
                      'steel_hms1',
                      'steel_hms2',
                      'steel_cast_iron',
                      'steel_stainless',
                      'copper',
                      'aluminium',
                      'rare_earth'
                    )),

  volume_per_mw     NUMERIC,            -- tonnes per MW
  volume_per_unit   NUMERIC,            -- tonnes per turbine (alternative basis)
  volume_basis      TEXT NOT NULL DEFAULT 'per_mw'
                      CHECK (volume_basis IN ('per_mw', 'per_unit')),

  lca_document      TEXT,               -- Document title / reference
  lca_year          INTEGER,            -- Year of LCA publication

  -- Source metadata — mandatory
  source_type       TEXT NOT NULL DEFAULT 'OEM LCA',
  source_date       DATE NOT NULL,
  confidence        TEXT NOT NULL CHECK (confidence IN ('High', 'Medium', 'Low')),
  derivation        TEXT NOT NULL CHECK (derivation IN ('Observed', 'Inferred', 'Modelled')),
  last_reviewed     DATE NOT NULL,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (turbine_make, turbine_model, material_type)
);

-- ============================================================
-- COMMODITY PRICES
-- Scrap metal prices by material, region, and date.
-- Updated daily (manual Phase 1, automated feed Phase 2).
-- ============================================================
CREATE TABLE IF NOT EXISTS commodity_prices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  material_type   TEXT NOT NULL CHECK (material_type IN (
                    'steel_hms1',
                    'steel_hms2',
                    'steel_cast_iron',
                    'steel_stainless',
                    'copper',
                    'aluminium',
                    'rare_earth'
                  )),

  region          TEXT NOT NULL CHECK (region IN ('EU', 'GB', 'US')),
  price_per_tonne NUMERIC NOT NULL,
  currency        TEXT NOT NULL CHECK (currency IN ('EUR', 'GBP', 'USD')),
  price_date      DATE NOT NULL,

  source_name     TEXT NOT NULL,        -- e.g. 'LME', 'Fastmarkets', 'AMM'
  source_url      TEXT,

  -- Source metadata — mandatory
  source_type     TEXT NOT NULL DEFAULT 'Market Data',
  source_date     DATE NOT NULL,
  confidence      TEXT NOT NULL CHECK (confidence IN ('High', 'Medium', 'Low')),
  derivation      TEXT NOT NULL CHECK (derivation IN ('Observed', 'Inferred', 'Modelled')),
  last_reviewed   DATE NOT NULL,

  created_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (material_type, region, price_date)
);

-- ============================================================
-- MERCHANT MARKUPS — CONFIDENTIAL
-- Sourced directly from merchants. Updated monthly.
-- One row per merchant per material per effective period.
-- RLS: service_role only — never exposed to terminal users.
-- ============================================================
CREATE TABLE IF NOT EXISTS merchant_markups (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  merchant_name     TEXT NOT NULL,
  country_code      TEXT NOT NULL,      -- ISO 3166-1 alpha-2
  region            TEXT NOT NULL CHECK (region IN ('EU', 'GB', 'US')),

  material_type     TEXT NOT NULL CHECK (material_type IN (
                      'steel_hms1',
                      'steel_hms2',
                      'steel_cast_iron',
                      'steel_stainless',
                      'copper',
                      'aluminium',
                      'rare_earth'
                    )),

  markup_per_tonne  NUMERIC NOT NULL,   -- deducted from scrap price
  currency          TEXT NOT NULL CHECK (currency IN ('EUR', 'GBP', 'USD')),

  effective_from    DATE NOT NULL,
  effective_to      DATE,               -- NULL = currently active

  -- Source metadata — mandatory
  source_type       TEXT NOT NULL DEFAULT 'Merchant Direct',
  source_date       DATE NOT NULL,
  confidence        TEXT NOT NULL CHECK (confidence IN ('High', 'Medium', 'Low')),
  derivation        TEXT NOT NULL DEFAULT 'Observed'
                      CHECK (derivation IN ('Observed', 'Inferred', 'Modelled')),
  last_reviewed     DATE NOT NULL,

  notes             TEXT,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NRO ESTIMATES
-- Net Recovery Offset per material per region — computed from
-- commodity prices minus merchant markups. Markup not exposed.
-- Always stored as ranges (low / mid / high).
-- ============================================================
CREATE TABLE IF NOT EXISTS nro_estimates (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  material_type             TEXT NOT NULL CHECK (material_type IN (
                              'steel_hms1',
                              'steel_hms2',
                              'steel_cast_iron',
                              'steel_stainless',
                              'copper',
                              'aluminium',
                              'rare_earth'
                            )),

  region                    TEXT NOT NULL CHECK (region IN ('EU', 'GB', 'US')),
  currency                  TEXT NOT NULL CHECK (currency IN ('EUR', 'GBP', 'USD')),
  reference_date            DATE NOT NULL,

  -- Net recovery per tonne (scrap price − merchant markup)
  net_per_tonne_low         NUMERIC NOT NULL,
  net_per_tonne_mid         NUMERIC NOT NULL,
  net_per_tonne_high        NUMERIC NOT NULL,

  -- Net recovery per MW (net_per_tonne × volume_per_mw)
  -- Populated where LCA volume data exists
  net_per_mw_low            NUMERIC,
  net_per_mw_mid            NUMERIC,
  net_per_mw_high           NUMERIC,

  -- Source metadata — mandatory
  source_type               TEXT NOT NULL DEFAULT 'Endenex Recovery Model',
  source_date               DATE NOT NULL,
  confidence                TEXT NOT NULL CHECK (confidence IN ('High', 'Medium', 'Low')),
  derivation                TEXT NOT NULL DEFAULT 'Modelled'
                              CHECK (derivation IN ('Observed', 'Inferred', 'Modelled')),
  last_reviewed             DATE NOT NULL,

  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (material_type, region, reference_date)
);

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE TRIGGER turbine_material_profiles_updated_at
  BEFORE UPDATE ON turbine_material_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER merchant_markups_updated_at
  BEFORE UPDATE ON merchant_markups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER nro_estimates_updated_at
  BEFORE UPDATE ON nro_estimates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE turbine_material_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE commodity_prices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_markups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE nro_estimates             ENABLE ROW LEVEL SECURITY;

-- Public: turbine profiles, commodity prices, NRO estimates (net only)
CREATE POLICY "read_turbine_material_profiles"
  ON turbine_material_profiles FOR SELECT USING (true);

CREATE POLICY "read_commodity_prices"
  ON commodity_prices FOR SELECT USING (true);

CREATE POLICY "read_nro_estimates"
  ON nro_estimates FOR SELECT USING (true);

-- Confidential: merchant markups — service_role only
CREATE POLICY "no_user_read_merchant_markups"
  ON merchant_markups FOR SELECT USING (auth.role() = 'service_role');

-- Writes: service_role only across all tables
CREATE POLICY "write_turbine_material_profiles"
  ON turbine_material_profiles FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "write_commodity_prices"
  ON commodity_prices FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "write_merchant_markups"
  ON merchant_markups FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "write_nro_estimates"
  ON nro_estimates FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_turbine_profiles_make_model
  ON turbine_material_profiles (turbine_make, turbine_model);

CREATE INDEX idx_commodity_prices_material_region
  ON commodity_prices (material_type, region, price_date DESC);

CREATE INDEX idx_merchant_markups_region_material
  ON merchant_markups (region, material_type, effective_from DESC);

CREATE INDEX idx_nro_estimates_material_region
  ON nro_estimates (material_type, region, reference_date DESC);
