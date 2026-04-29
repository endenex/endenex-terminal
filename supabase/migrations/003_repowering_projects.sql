-- Migration 003 — Repowering Projects
-- Pipeline-stage tracking for active repowering projects.
-- One row per project, showing current stage.
-- Separate from market_events (which tracks individual events/history).

CREATE TABLE IF NOT EXISTS repowering_projects (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Project identity
  project_name          TEXT NOT NULL,
  country_code          TEXT NOT NULL,
  asset_class           TEXT NOT NULL DEFAULT 'onshore_wind'
                          CHECK (asset_class IN ('onshore_wind', 'solar_pv', 'bess', 'offshore_wind')),

  -- Pipeline stage — current status only
  stage                 TEXT NOT NULL CHECK (stage IN (
                          'announced',
                          'application_submitted',
                          'application_approved',
                          'permitted',
                          'ongoing'
                        )),
  stage_date            DATE,

  -- Project details
  capacity_mw           NUMERIC,
  turbine_count         INTEGER,
  developer             TEXT,
  operator              TEXT,
  planning_reference    TEXT,
  location_description  TEXT,
  source_url            TEXT,
  notes                 TEXT,

  -- Link to existing asset being repowered (nullable — project may precede asset match)
  asset_id              UUID REFERENCES assets(id) ON DELETE SET NULL,

  -- Source metadata — mandatory on every record
  source_type           TEXT NOT NULL,
  source_date           DATE NOT NULL,
  confidence            TEXT NOT NULL CHECK (confidence IN ('High', 'Medium', 'Low')),
  derivation            TEXT NOT NULL CHECK (derivation IN ('Observed', 'Inferred', 'Modelled')),
  last_reviewed         DATE NOT NULL,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update trigger
CREATE TRIGGER repowering_projects_updated_at
  BEFORE UPDATE ON repowering_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Row Level Security
ALTER TABLE repowering_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_repowering_projects"
  ON repowering_projects FOR SELECT USING (true);

CREATE POLICY "write_repowering_projects"
  ON repowering_projects FOR ALL USING (auth.role() = 'service_role');

-- Indexes
CREATE INDEX idx_repowering_projects_country
  ON repowering_projects (country_code, asset_class);

CREATE INDEX idx_repowering_projects_stage
  ON repowering_projects (stage, stage_date DESC);

CREATE INDEX idx_repowering_projects_asset
  ON repowering_projects (asset_id);
