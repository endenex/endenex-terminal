-- Endenex Terminal — Initial Schema v1.0
-- Run this in full via the Supabase SQL editor (Database → SQL Editor → New query)
-- All tables carry source metadata as first-class fields on every record.

-- ============================================================
-- ASSETS
-- Core registry of clean energy assets across all markets.
-- country_code is mandatory and never inferred.
-- ============================================================
CREATE TABLE IF NOT EXISTS assets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  asset_class           TEXT NOT NULL CHECK (asset_class IN ('onshore_wind', 'solar_pv', 'bess', 'offshore_wind')),
  country_code          TEXT NOT NULL,   -- ISO 3166-1 alpha-2. Never inferred from any other field.
  external_id           TEXT,            -- Source registry identifier (MaStR unit ID, REPD ref, USWTDB ID, etc.)

  -- Asset attributes
  name                  TEXT,
  capacity_mw           NUMERIC,
  commissioning_date    DATE,
  decommissioning_date  DATE,
  hub_height_m          NUMERIC,
  rotor_diameter_m      NUMERIC,
  turbine_make          TEXT,
  turbine_model         TEXT,
  latitude              NUMERIC,
  longitude             NUMERIC,

  -- Support scheme (primary repowering trigger)
  support_scheme_id     TEXT,            -- EEG ID (DE), ROC ref (GB), etc.
  support_scheme_expiry DATE,

  -- Source metadata — mandatory on every record
  source_type           TEXT NOT NULL,   -- 'MaStR' | 'REPD' | 'USWTDB' | 'Energistyrelsen' | 'ODRÉ' | 'GEM'
  source_date           DATE NOT NULL,
  confidence            TEXT NOT NULL CHECK (confidence IN ('High', 'Medium', 'Low')),
  derivation            TEXT NOT NULL CHECK (derivation IN ('Observed', 'Inferred', 'Modelled')),
  last_reviewed         DATE NOT NULL,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MARKET EVENTS
-- Repowering and decommissioning events for the Market Monitor.
-- An event may exist without a matched asset record (asset_id nullable).
-- ============================================================
CREATE TABLE IF NOT EXISTS market_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id            UUID REFERENCES assets(id) ON DELETE SET NULL,

  -- Context (mandatory even without a matched asset)
  country_code        TEXT NOT NULL,
  asset_class         TEXT NOT NULL CHECK (asset_class IN ('onshore_wind', 'solar_pv', 'bess', 'offshore_wind')),

  event_type          TEXT NOT NULL CHECK (event_type IN (
                        'planning_application',
                        'consent_granted',
                        'consent_refused',
                        'construction_start',
                        'commissioning',
                        'decom_campaign_start',
                        'decom_campaign_complete',
                        'contractor_mobilisation',
                        'announcement'
                      )),
  event_date          DATE,
  event_title         TEXT NOT NULL,
  event_description   TEXT,
  project_name        TEXT,
  developer_operator  TEXT,
  capacity_mw         NUMERIC,
  source_url          TEXT,

  -- Source metadata — mandatory
  source_type         TEXT NOT NULL,
  source_date         DATE NOT NULL,
  signal_type         TEXT,
  confidence          TEXT NOT NULL CHECK (confidence IN ('High', 'Medium', 'Low')),
  derivation          TEXT NOT NULL CHECK (derivation IN ('Observed', 'Inferred', 'Modelled')),
  last_reviewed       DATE NOT NULL,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ASSET SIGNALS
-- Signal-stack classifications per asset for the Asset Screener.
-- All fields are classification labels — no numeric scores.
-- ============================================================
CREATE TABLE IF NOT EXISTS asset_signals (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id                  UUID REFERENCES assets(id) ON DELETE CASCADE UNIQUE,

  -- Individual signal classifications
  age_signal                TEXT CHECK (age_signal IN ('Strong', 'Medium', 'Weak')),
  support_scheme_expiry     TEXT CHECK (support_scheme_expiry IN ('Confirmed', 'Inferred', 'Unavailable')),
  planning_signal           TEXT CHECK (planning_signal IN ('Active', 'Dormant', 'None')),
  grid_connection_value     TEXT CHECK (grid_connection_value IN ('High', 'Medium', 'Low')),
  owner_behaviour           TEXT CHECK (owner_behaviour IN ('Repowering-active', 'Unknown')),
  physical_constraint       TEXT CHECK (physical_constraint IN ('Constrained', 'Unconstrained', 'Unknown')),

  -- Derived overall classification
  overall_classification    TEXT CHECK (overall_classification IN ('Watchlist', 'Candidate', 'Active', 'Confirmed')),

  -- Source metadata — mandatory
  source_type               TEXT NOT NULL DEFAULT 'Endenex Signal Model',
  source_date               DATE NOT NULL,
  confidence                TEXT NOT NULL CHECK (confidence IN ('High', 'Medium', 'Low')),
  derivation                TEXT NOT NULL CHECK (derivation IN ('Observed', 'Inferred', 'Modelled')),
  last_reviewed             DATE NOT NULL,

  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DCI VALUES
-- Decommissioning Cost Index values.
-- Always stored as ranges (low / mid / high) — never single point estimates.
-- DCI headline is always the net figure (gross minus NRO).
-- ============================================================
CREATE TABLE IF NOT EXISTS dci_values (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  asset_class                 TEXT NOT NULL CHECK (asset_class IN ('onshore_wind', 'solar_pv', 'bess', 'offshore_wind')),
  region                      TEXT NOT NULL CHECK (region IN ('Europe', 'US')),
  dci_type                    TEXT NOT NULL CHECK (dci_type IN ('Spot', 'Forward', 'Reserve')),

  period_start                DATE NOT NULL,
  period_end                  DATE NOT NULL,

  -- Gross cost range (per MW)
  gross_low_per_mw            NUMERIC,
  gross_mid_per_mw            NUMERIC,
  gross_high_per_mw           NUMERIC,

  -- Net Recovery Offset range (per MW)
  nro_low_per_mw              NUMERIC,
  nro_mid_per_mw              NUMERIC,
  nro_high_per_mw             NUMERIC,

  -- Net cost range = Gross − NRO (headline DCI value — mandatory)
  net_low_per_mw              NUMERIC NOT NULL,
  net_mid_per_mw              NUMERIC NOT NULL,
  net_high_per_mw             NUMERIC NOT NULL,

  currency                    TEXT NOT NULL CHECK (currency IN ('EUR', 'USD')),
  methodology_version         TEXT NOT NULL,

  -- DCI Reserve: Three Project Rule — minimum 3 distinct projects before publication
  contributing_projects_count INTEGER,

  -- Source metadata — mandatory
  source_type                 TEXT NOT NULL DEFAULT 'Endenex DCI Methodology',
  source_date                 DATE NOT NULL,
  confidence                  TEXT NOT NULL CHECK (confidence IN ('High', 'Medium', 'Low')),
  derivation                  TEXT NOT NULL DEFAULT 'Modelled' CHECK (derivation IN ('Observed', 'Inferred', 'Modelled')),
  last_reviewed               DATE NOT NULL,

  published_at                TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (asset_class, region, dci_type, period_start)
);

-- ============================================================
-- USER PROFILES
-- Extends Clerk user data with onboarding preferences.
-- geographic_focus has no default — no country is pre-applied.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id         TEXT UNIQUE NOT NULL,

  cohort                TEXT CHECK (cohort IN (
                          'developer_originator', 'fund_manager', 'lender',
                          'surety_underwriter', 'decom_contractor', 'recycler_processor',
                          'commodity_trader', 'ma_advisor', 'operator', 'regulator'
                        )),
  asset_class_interest  TEXT[]   DEFAULT '{}',
  geographic_focus      TEXT[]   DEFAULT '{}',  -- No country default. Empty = no filter applied.
  onboarding_completed  BOOLEAN  DEFAULT FALSE,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SAVED VIEWS
-- User-defined watchlists and filter states across workspaces.
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_views (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id   TEXT NOT NULL,
  workspace       TEXT NOT NULL CHECK (workspace IN ('market_monitor', 'asset_screener', 'workbench')),
  name            TEXT NOT NULL,
  filters         JSONB    DEFAULT '{}',
  is_watchlist    BOOLEAN  DEFAULT FALSE,
  asset_ids       UUID[]   DEFAULT '{}',

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUTO-UPDATE TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assets_updated_at
  BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER market_events_updated_at
  BEFORE UPDATE ON market_events FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER asset_signals_updated_at
  BEFORE UPDATE ON asset_signals FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER saved_views_updated_at
  BEFORE UPDATE ON saved_views FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- Phase 1: open reads for authenticated users.
-- Phase 2: tighten to subscription tier once Stripe is integrated.
-- ============================================================
ALTER TABLE assets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_signals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dci_values     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_views    ENABLE ROW LEVEL SECURITY;

-- Market data: any request can read (anon key gates access at app layer for Phase 1)
CREATE POLICY "read_assets"         ON assets         FOR SELECT USING (true);
CREATE POLICY "read_market_events"  ON market_events  FOR SELECT USING (true);
CREATE POLICY "read_asset_signals"  ON asset_signals  FOR SELECT USING (true);
CREATE POLICY "read_dci_values"     ON dci_values     FOR SELECT USING (true);

-- Market data writes: service role only (ingestion pipelines use service key)
CREATE POLICY "write_assets"        ON assets         FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "write_market_events" ON market_events  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "write_asset_signals" ON asset_signals  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "write_dci_values"    ON dci_values     FOR ALL USING (auth.role() = 'service_role');

-- User data: open for Phase 1 (Clerk user_id is the gate)
CREATE POLICY "all_user_profiles"   ON user_profiles  FOR ALL USING (true);
CREATE POLICY "all_saved_views"     ON saved_views    FOR ALL USING (true);

-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================
CREATE INDEX idx_assets_country_class      ON assets        (country_code, asset_class);
CREATE INDEX idx_assets_commissioning      ON assets        (commissioning_date);
CREATE INDEX idx_assets_external_id        ON assets        (external_id);
CREATE INDEX idx_market_events_country     ON market_events (country_code, asset_class);
CREATE INDEX idx_market_events_type_date   ON market_events (event_type, event_date DESC);
CREATE INDEX idx_asset_signals_class       ON asset_signals (overall_classification);
CREATE INDEX idx_dci_values_lookup         ON dci_values    (asset_class, region, dci_type, period_start DESC);
CREATE INDEX idx_user_profiles_clerk       ON user_profiles (clerk_user_id);
CREATE INDEX idx_saved_views_user          ON saved_views   (clerk_user_id, workspace);
