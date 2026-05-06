-- Migration 024 — US Wind Federal Lands · Bonded Liability Gap
--
-- Architecture:
--
--   us_wind_assets        — every US wind turbine (USWTDB ingest, ~75k rows).
--                          Each row = one turbine. Source: USGS U.S. Wind
--                          Turbine Database (V8.3+, updated quarterly).
--
--   blm_row_polygons      — every BLM-permitted wind/solar Right-of-Way grant
--                          polygon, scraped from BLM state-office ArcGIS
--                          FeatureServers. Used to spatially flag turbines
--                          on US federal land.
--
--   us_wind_projects_v    — project-level rollup view. Computes per-project:
--                          turbine count, capacity, BLM statutory minimum
--                          bond (per 43 CFR 2805.20: $10k × turbines<1MW
--                          + $20k × turbines≥1MW), DCI economic estimate
--                          (capacity × current dci_wind_north_america
--                          net liability), and the underbonded gap.
--
-- Output displayed in the Bonds panel as a third "operator-style" row:
-- "BLM US Federal Lands · Statutory Min vs DCI Economic Liability".

-- ── PostGIS ──────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS postgis;

-- ── us_wind_assets ──────────────────────────────────────────────────────────
-- One row per turbine. case_id is the USWTDB primary key.

CREATE TABLE IF NOT EXISTS us_wind_assets (
  case_id              text PRIMARY KEY,                  -- USWTDB case_id
  faa_ors              text,
  eia_id               text,

  -- Project (each turbine carries its project's totals; we group by p_name in the view)
  project_name         text,
  project_capacity_mw  numeric,                            -- p_cap (project total MW)
  project_turbine_count integer,                           -- p_tnum
  commissioning_year   integer,                            -- p_year

  -- Operator / ownership
  operator             text,                               -- often null in USWTDB; enriched separately

  -- Location
  state                text NOT NULL,                      -- t_state
  county               text,
  lat                  numeric NOT NULL,                   -- ylat
  lon                  numeric NOT NULL,                   -- xlong
  geom                 geography(Point, 4326)
                         GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED,

  -- Turbine specs
  turbine_capacity_kw  numeric,                            -- t_cap (kW; divide by 1000 for MW)
  hub_height_m         numeric,
  rotor_diameter_m     numeric,
  total_tip_height_m   numeric,
  is_offshore          boolean DEFAULT false,
  is_retrofit          boolean DEFAULT false,
  retrofit_year        integer,
  turbine_make         text,
  turbine_model        text,

  -- Federal-lands flag (set by compute_federal_land_flags.py via PostGIS spatial join)
  is_federal_land      boolean DEFAULT false,
  blm_row_serial       text,                               -- matched BLM ROW serial number
  flagged_at           timestamptz,                        -- when the flag was last computed

  last_synced          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS us_wind_assets_geom_idx       ON us_wind_assets USING gist (geom);
CREATE INDEX IF NOT EXISTS us_wind_assets_state_idx      ON us_wind_assets(state);
CREATE INDEX IF NOT EXISTS us_wind_assets_project_idx    ON us_wind_assets(project_name);
CREATE INDEX IF NOT EXISTS us_wind_assets_federal_idx    ON us_wind_assets(is_federal_land) WHERE is_federal_land = true;
CREATE INDEX IF NOT EXISTS us_wind_assets_offshore_idx   ON us_wind_assets(is_offshore);

-- ── blm_row_polygons ────────────────────────────────────────────────────────
-- BLM Right-of-Way grant polygons scraped from state-office ArcGIS FeatureServers.

CREATE TABLE IF NOT EXISTS blm_row_polygons (
  serial_number        text PRIMARY KEY,                   -- BLM case serial number
  project_name         text,
  state_office         text NOT NULL,                      -- AK / CA / NV / WY / etc.
  authorization_type   text,                               -- ROW grant, lease, etc.
  case_type            text,                               -- 'Wind' / 'Solar'
  disposition          text,                               -- 'Active' / 'Closed' / 'Pending'
  application_date     date,
  effective_date       date,
  expiration_date      date,
  project_acres        numeric,
  blm_acres            numeric,

  -- Staging column for GeoJSON ingest (Python ingestion sends this; trigger
  -- converts to geom). PostgREST doesn't accept geography literals directly,
  -- so we round-trip via GeoJSON text.
  geom_geojson         text,
  geom                 geography(MultiPolygon, 4326),

  source_endpoint      text,                               -- which ArcGIS FeatureServer URL
  last_synced          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blm_row_polygons_geom_idx          ON blm_row_polygons USING gist (geom);
CREATE INDEX IF NOT EXISTS blm_row_polygons_state_office_idx  ON blm_row_polygons(state_office);
CREATE INDEX IF NOT EXISTS blm_row_polygons_disposition_idx   ON blm_row_polygons(disposition);

-- Trigger: convert geom_geojson (text, set by Python) → geom (geography) on insert/update
CREATE OR REPLACE FUNCTION blm_row_polygons_geom_from_geojson()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.geom_geojson IS NOT NULL AND NEW.geom_geojson <> '' THEN
    BEGIN
      NEW.geom := ST_GeomFromGeoJSON(NEW.geom_geojson)::geography;
    EXCEPTION WHEN others THEN
      -- Bad GeoJSON: leave geom NULL (compute_federal_land_flags.py will skip)
      NEW.geom := NULL;
    END;
  END IF;
  NEW.last_synced := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS blm_row_polygons_geom_trigger ON blm_row_polygons;
CREATE TRIGGER blm_row_polygons_geom_trigger
  BEFORE INSERT OR UPDATE ON blm_row_polygons
  FOR EACH ROW EXECUTE FUNCTION blm_row_polygons_geom_from_geojson();

-- ── Project-level rollup view ───────────────────────────────────────────────
--
-- BLM statutory minimum bond per 43 CFR 2805.20:
--   $10,000 per authorized turbine <1 MW nameplate capacity
--   $20,000 per authorized turbine ≥1 MW nameplate capacity
--
-- DCI economic estimate uses the latest published net_liability for
-- dci_wind_north_america (USD/MW). This makes the "underbonded gap" =
-- (capacity_mw × dci_per_mw) − statutory_minimum, exposing the structural
-- mismatch between regulator-required bond and economic decom liability.

CREATE OR REPLACE VIEW us_wind_projects_v AS
WITH dci_latest AS (
  SELECT net_liability AS na_per_mw_usd
  FROM dci_publications
  WHERE series = 'dci_wind_north_america'
    AND is_published = true
  ORDER BY publication_date DESC
  LIMIT 1
)
SELECT
  COALESCE(a.project_name, '(unnamed)')                                    AS project_name,
  a.state,
  a.is_federal_land,
  a.is_offshore,
  COUNT(*)                                                                 AS turbine_count,
  ROUND((SUM(a.turbine_capacity_kw) / 1000.0)::numeric, 2)                 AS capacity_mw,
  COUNT(*) FILTER (WHERE a.turbine_capacity_kw < 1000)                     AS turbines_lt_1mw,
  COUNT(*) FILTER (WHERE a.turbine_capacity_kw >= 1000)                    AS turbines_gte_1mw,
  -- BLM statutory minimum bond (USD)
  (COUNT(*) FILTER (WHERE a.turbine_capacity_kw < 1000)  * 10000 +
   COUNT(*) FILTER (WHERE a.turbine_capacity_kw >= 1000) * 20000)::numeric AS statutory_min_bond_usd,
  -- DCI economic estimate (USD)
  ROUND(((SUM(a.turbine_capacity_kw) / 1000.0) * (SELECT na_per_mw_usd FROM dci_latest))::numeric, 0)
                                                                           AS dci_economic_estimate_usd,
  MIN(a.commissioning_year)                                                AS earliest_commissioning,
  MAX(a.commissioning_year)                                                AS latest_commissioning,
  STRING_AGG(DISTINCT a.operator, ' · ' ORDER BY a.operator)
    FILTER (WHERE a.operator IS NOT NULL)                                  AS operators
FROM us_wind_assets a
GROUP BY a.project_name, a.state, a.is_federal_land, a.is_offshore;

-- ── Federal-lands aggregate view (panel headline) ──────────────────────────

CREATE OR REPLACE VIEW us_federal_wind_bonds_summary_v AS
WITH dci_latest AS (
  SELECT net_liability AS na_per_mw_usd
  FROM dci_publications
  WHERE series = 'dci_wind_north_america' AND is_published = true
  ORDER BY publication_date DESC LIMIT 1
)
SELECT
  COUNT(DISTINCT project_name)                                AS federal_project_count,
  SUM(turbine_count)                                          AS federal_turbine_count,
  ROUND(SUM(capacity_mw)::numeric, 1)                         AS federal_capacity_mw,
  SUM(statutory_min_bond_usd)                                 AS federal_statutory_min_bond_usd,
  SUM(dci_economic_estimate_usd)                              AS federal_dci_economic_estimate_usd,
  SUM(dci_economic_estimate_usd - statutory_min_bond_usd)     AS federal_underbonded_gap_usd,
  (SELECT na_per_mw_usd FROM dci_latest)                      AS dci_na_per_mw_usd
FROM us_wind_projects_v
WHERE is_federal_land = true AND NOT is_offshore;

-- ── Spatial-join function (called by compute_federal_land_flags.py) ────────
-- Tags every us_wind_assets row with is_federal_land=true when its turbine
-- point falls inside any active blm_row_polygons polygon.

CREATE OR REPLACE FUNCTION compute_federal_land_flags()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  n_flagged integer := 0;
BEGIN
  -- Reset prior flags so re-runs are idempotent
  UPDATE us_wind_assets
     SET is_federal_land = false,
         blm_row_serial  = NULL,
         flagged_at      = now()
   WHERE is_federal_land = true;

  -- Spatial join: turbine point inside active BLM ROW polygon
  WITH matches AS (
    SELECT DISTINCT ON (a.case_id)
           a.case_id, p.serial_number
    FROM   us_wind_assets a
    JOIN   blm_row_polygons p
      ON   ST_Intersects(a.geom, p.geom)
    WHERE  p.geom IS NOT NULL
      AND  COALESCE(p.disposition, '') NOT ILIKE '%closed%'
      AND  COALESCE(p.disposition, '') NOT ILIKE '%terminated%'
      AND  COALESCE(p.disposition, '') NOT ILIKE '%relinquished%'
  )
  UPDATE us_wind_assets a
     SET is_federal_land = true,
         blm_row_serial  = m.serial_number,
         flagged_at      = now()
    FROM matches m
   WHERE a.case_id = m.case_id;

  GET DIAGNOSTICS n_flagged = ROW_COUNT;
  RETURN n_flagged;
END;
$fn$;

-- ── RLS (permissive read; app gates at Clerk) ───────────────────────────────

ALTER TABLE us_wind_assets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE blm_row_polygons  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_us_wind_assets"   ON us_wind_assets;
CREATE POLICY "read_us_wind_assets"   ON us_wind_assets   FOR SELECT USING (true);

DROP POLICY IF EXISTS "read_blm_row_polygons" ON blm_row_polygons;
CREATE POLICY "read_blm_row_polygons" ON blm_row_polygons FOR SELECT USING (true);

-- ── Telemetry ──────────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_024_us_federal_wind_bonds', 'success', NOW(), NOW(),
  0,
  'USGS USWTDB · BLM state-office ArcGIS FeatureServers · BLM 43 CFR 2805.20',
  'Created us_wind_assets + blm_row_polygons tables with PostGIS geometry + projects rollup view + federal-lands summary view. Statutory bond formula per 43 CFR 2805.20. Tables empty until sync_uswtdb.py + sync_blm_row_polygons.py + compute_federal_land_flags.py run.'
);
