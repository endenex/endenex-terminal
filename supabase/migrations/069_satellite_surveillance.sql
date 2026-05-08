-- Migration 069 — Endenex Eye satellite-surveillance scaffold
--
-- Two tables underpinning the Endenex Eye flagship feature:
--
--   satellite_facilities    — recyclers / processors we monitor; lat/lng
--                             + facility type + ownership; the universe.
--   satellite_observations  — per-facility per-date imagery + AI-derived
--                             signals (stockpile area, capacity tightness,
--                             narrative assessment).
--
-- Schema is intentionally provider-agnostic: imagery_provider can be
-- 'sentinel-2', 'planet', 'maxar', 'pleiades', 'capella', 'manual', etc.
-- image_url points to whatever we render in the panel (Supabase Storage
-- public bucket, an external CDN, or an MIT-licenced sample).

-- ── facilities ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS satellite_facilities (
  id              bigserial PRIMARY KEY,
  name            text NOT NULL,
  operator_name   text,
  asset_class     text NOT NULL CHECK (asset_class IN ('wind','solar','bess')),
  facility_type   text NOT NULL CHECK (facility_type IN
                    ('cement_kiln','pyrolysis','mech_shred','solvolysis',
                     'pv_mech','pv_specialty',
                     'battery_pretreatment','battery_hydromet','battery_pyromet')),
  country         text,                    -- ISO-2
  region          text,                    -- 'EU' | 'UK' | 'US' | 'AsiaPac'
  lat             numeric NOT NULL,
  lng             numeric NOT NULL,
  capacity_kt_year numeric,                -- nameplate annual intake
  status          text DEFAULT 'active'
                    CHECK (status IN ('active','planned','closed','idle')),
  source_url      text,
  notes           text,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (name, country)
);

CREATE INDEX IF NOT EXISTS satellite_facilities_class_idx
  ON satellite_facilities (asset_class, facility_type);
CREATE INDEX IF NOT EXISTS satellite_facilities_region_idx
  ON satellite_facilities (region);

-- ── observations ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS satellite_observations (
  id                       bigserial PRIMARY KEY,
  facility_id              bigint NOT NULL REFERENCES satellite_facilities(id) ON DELETE CASCADE,
  observation_date         date NOT NULL,

  -- Imagery
  image_url                text,                   -- public URL to displayable image
  imagery_provider         text NOT NULL CHECK (imagery_provider IN
                             ('sentinel-2','sentinel-1','planet','planetscope',
                              'skysat','maxar','pleiades','pleiades-neo',
                              'capella-sar','iceye','airbus-spot','manual','other')),
  resolution_m             numeric,                 -- ground sample distance (m)
  cloud_cover_pct          numeric CHECK (cloud_cover_pct IS NULL OR
                             (cloud_cover_pct >= 0 AND cloud_cover_pct <= 100)),

  -- AI-derived signals
  stockpile_area_m2        numeric,
  stockpile_change_pct     numeric,                 -- vs previous observation; +/- %
  capacity_tightness_pct   numeric CHECK (capacity_tightness_pct IS NULL OR
                             (capacity_tightness_pct >= 0 AND capacity_tightness_pct <= 150)),
  blade_count_estimate     integer,
  ai_assessment            text,                    -- 1-3 sentence narrative
  ai_model                 text,                    -- 'claude-sonnet-4.5' etc.
  confidence               text CHECK (confidence IN ('low','medium','high')),

  -- Provenance
  source_url               text,                    -- imagery vendor reference
  notes                    text,
  created_at               timestamptz DEFAULT now(),

  UNIQUE (facility_id, observation_date, imagery_provider)
);

CREATE INDEX IF NOT EXISTS satellite_observations_facility_date_idx
  ON satellite_observations (facility_id, observation_date DESC);
CREATE INDEX IF NOT EXISTS satellite_observations_tightness_idx
  ON satellite_observations (capacity_tightness_pct DESC NULLS LAST);

-- ── RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE satellite_facilities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE satellite_observations  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_satellite_facilities"   ON satellite_facilities;
DROP POLICY IF EXISTS "read_satellite_observations" ON satellite_observations;
CREATE POLICY "read_satellite_facilities"   ON satellite_facilities   FOR SELECT USING (true);
CREATE POLICY "read_satellite_observations" ON satellite_observations FOR SELECT USING (true);

-- ── Phase-1 facility seed (5 high-visibility wind blade processors) ────

INSERT INTO satellite_facilities
  (name, operator_name, asset_class, facility_type, country, region,
   lat, lng, capacity_kt_year, status, source_url, notes) VALUES

  ('Holcim Lägerdorf cement plant',
   'Holcim Deutschland (Holcim AG)', 'wind', 'cement_kiln',
   'DE', 'EU', 53.8826, 9.5808, 50, 'active',
   'https://www.holcim.de/de/standort-laegerdorf',
   'Flagship EU blade co-processing facility — Holcim partnered with WindEurope on blade-to-cement programme. Visible site north of Hamburg.'),

  ('Continuum Recycling Esbjerg',
   'Continuum (formerly Vestas joint venture)', 'wind', 'pyrolysis',
   'DK', 'EU', 55.4760, 8.4602, 25, 'active',
   'https://www.continuum.eco/',
   'Esbjerg port-side pyrolysis plant; opened 2024. ~25 kt/yr nameplate. Flagship EU pyrolysis route.'),

  ('LafargeHolcim Joppa cement plant',
   'Holcim US', 'wind', 'cement_kiln',
   'US', 'US', 37.2080, -89.0742, 25, 'active',
   'https://www.holcim.us/en/locations/joppa-cement-plant',
   'Largest US blade-acceptor cement kiln. Partners with Veolia for shred prep before kiln.'),

  ('Carbon Rivers blade pyrolysis pilot',
   'Carbon Rivers (DOE-supported)', 'wind', 'pyrolysis',
   'US', 'US', 35.6730, -84.4380, 50, 'active',
   'https://carbonrivers.com/',
   'Tennessee pyrolysis facility; DOE-supported scale-up to 50 kt/yr. Glass + carbon-fibre recovery.'),

  ('Global Fiberglass Solutions Sweetwater',
   'Global Fiberglass Solutions', 'wind', 'mech_shred',
   'US', 'US', 32.4711, -100.4061, 50, 'active',
   'https://www.globalfiberglass.com/',
   'Texas mechanical shredding plant; cement-grade aggregate output. Adjacent to West Texas wind farms (largest US blade-decom region).')

ON CONFLICT (name, country) DO NOTHING;

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_069_satellite_surveillance', 'success', NOW(), NOW(),
  5,
  'Manually curated facility coordinates + corporate sites',
  'Migration 069 — created satellite_facilities + satellite_observations tables. Seeded 5 wind blade processing facilities for Phase-1 Endenex Eye scaffold (Holcim Lägerdorf, Continuum Esbjerg, LafargeHolcim Joppa, Carbon Rivers TN, GFS Sweetwater TX). Observations table awaits ingestion script + first imagery pull.'
);
