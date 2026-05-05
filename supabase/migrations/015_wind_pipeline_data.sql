-- Migration 015 — Wind pipeline annual installations (UK by nation, US total, Canada)
-- + US state fractions (time-averaged 2000–2025)
--
-- Source data: Endenex Marketing/Website data files (pipeline-uk.js, pipeline-us.js)
-- Derived from: BEIS/DESNZ REPD, DUKES, WindEurope UK; EIA Form 860, AWEA/ACP, GWEC; CanWEA, NRCan
--
-- Powers: ARI Tab 03 (Fleet Cohorts, Retirement Waves) — fleet-level installation
-- volumes by year × region, used to model decommissioning waves 2025-2050.

-- ============================================================
-- ANNUAL INSTALLATIONS — onshore wind, GW per year by sub-region
-- ============================================================
CREATE TABLE IF NOT EXISTS wind_pipeline_annual_installations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code    TEXT NOT NULL,
  sub_region      TEXT NOT NULL,                       -- e.g. 'Scotland', 'England', 'Total', 'Texas', 'Iowa'
  install_year    INTEGER NOT NULL CHECK (install_year >= 1980 AND install_year <= 2050),
  installed_gw    NUMERIC NOT NULL,
  scope           TEXT NOT NULL DEFAULT 'onshore' CHECK (scope IN ('onshore','offshore')),

  source_doc      TEXT NOT NULL,
  source_type     TEXT NOT NULL DEFAULT 'Regulator / Industry Body',
  source_date     DATE NOT NULL,
  confidence      TEXT NOT NULL CHECK (confidence IN ('High','Medium','Low')),
  last_reviewed   DATE NOT NULL,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (country_code, sub_region, install_year, scope)
);

CREATE INDEX IF NOT EXISTS idx_wind_pipeline_country_year
  ON wind_pipeline_annual_installations (country_code, install_year);

ALTER TABLE wind_pipeline_annual_installations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_wind_pipeline" ON wind_pipeline_annual_installations FOR SELECT USING (true);
CREATE POLICY "write_wind_pipeline" ON wind_pipeline_annual_installations FOR ALL USING (auth.role() = 'service_role');

CREATE TRIGGER wind_pipeline_updated_at
  BEFORE UPDATE ON wind_pipeline_annual_installations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- SEED — UK by nation (4 nations × 26 years = 104 rows)
-- Source: BEIS/DESNZ REPD; DUKES; WindEurope UK country reports
-- ============================================================
DO $$
DECLARE
  scotland_data NUMERIC[][] := ARRAY[
    [2000,0.10],[2001,0.09],[2002,0.11],[2003,0.20],[2004,0.18],
    [2005,0.25],[2006,0.36],[2007,0.24],[2008,0.48],[2009,0.58],
    [2010,0.55],[2011,0.43],[2012,1.09],[2013,0.66],[2014,0.99],
    [2015,0.48],[2016,0.36],[2017,0.16],[2018,0.21],[2019,0.16],
    [2020,0.15],[2021,0.21],[2022,0.25],[2023,0.39],[2024,0.46],[2025,0.68]
  ];
  england_data NUMERIC[][] := ARRAY[
    [2000,0.05],[2001,0.05],[2002,0.06],[2003,0.10],[2004,0.09],
    [2005,0.13],[2006,0.18],[2007,0.12],[2008,0.25],[2009,0.30],
    [2010,0.28],[2011,0.22],[2012,0.55],[2013,0.34],[2014,0.51],
    [2015,0.25],[2016,0.18],[2017,0.08],[2018,0.10],[2019,0.08],
    [2020,0.08],[2021,0.10],[2022,0.13],[2023,0.20],[2024,0.23],[2025,0.35]
  ];
  wales_data NUMERIC[][] := ARRAY[
    [2000,0.01],[2001,0.01],[2002,0.02],[2003,0.03],[2004,0.03],
    [2005,0.04],[2006,0.06],[2007,0.04],[2008,0.08],[2009,0.09],
    [2010,0.09],[2011,0.07],[2012,0.17],[2013,0.10],[2014,0.16],
    [2015,0.08],[2016,0.06],[2017,0.03],[2018,0.03],[2019,0.03],
    [2020,0.02],[2021,0.03],[2022,0.04],[2023,0.06],[2024,0.07],[2025,0.11]
  ];
  ni_data NUMERIC[][] := ARRAY[
    [2000,0.01],[2001,0.01],[2002,0.01],[2003,0.02],[2004,0.02],
    [2005,0.02],[2006,0.04],[2007,0.03],[2008,0.05],[2009,0.07],
    [2010,0.06],[2011,0.05],[2012,0.13],[2013,0.08],[2014,0.11],
    [2015,0.05],[2016,0.04],[2017,0.01],[2018,0.03],[2019,0.01],
    [2020,0.02],[2021,0.03],[2022,0.02],[2023,0.04],[2024,0.04],[2025,0.07]
  ];
  i INTEGER;
BEGIN
  FOR i IN 1..array_length(scotland_data, 1) LOOP
    INSERT INTO wind_pipeline_annual_installations (country_code, sub_region, install_year, installed_gw, source_doc, source_date, confidence, last_reviewed)
    VALUES ('GB', 'Scotland', scotland_data[i][1]::INTEGER, scotland_data[i][2], 'BEIS/DESNZ REPD; DUKES; WindEurope UK', CURRENT_DATE, 'High', CURRENT_DATE)
    ON CONFLICT (country_code, sub_region, install_year, scope) DO UPDATE SET installed_gw = EXCLUDED.installed_gw, last_reviewed = EXCLUDED.last_reviewed;
  END LOOP;
  FOR i IN 1..array_length(england_data, 1) LOOP
    INSERT INTO wind_pipeline_annual_installations (country_code, sub_region, install_year, installed_gw, source_doc, source_date, confidence, last_reviewed)
    VALUES ('GB', 'England', england_data[i][1]::INTEGER, england_data[i][2], 'BEIS/DESNZ REPD; DUKES; WindEurope UK', CURRENT_DATE, 'High', CURRENT_DATE)
    ON CONFLICT (country_code, sub_region, install_year, scope) DO UPDATE SET installed_gw = EXCLUDED.installed_gw, last_reviewed = EXCLUDED.last_reviewed;
  END LOOP;
  FOR i IN 1..array_length(wales_data, 1) LOOP
    INSERT INTO wind_pipeline_annual_installations (country_code, sub_region, install_year, installed_gw, source_doc, source_date, confidence, last_reviewed)
    VALUES ('GB', 'Wales', wales_data[i][1]::INTEGER, wales_data[i][2], 'BEIS/DESNZ REPD; DUKES; WindEurope UK', CURRENT_DATE, 'High', CURRENT_DATE)
    ON CONFLICT (country_code, sub_region, install_year, scope) DO UPDATE SET installed_gw = EXCLUDED.installed_gw, last_reviewed = EXCLUDED.last_reviewed;
  END LOOP;
  FOR i IN 1..array_length(ni_data, 1) LOOP
    INSERT INTO wind_pipeline_annual_installations (country_code, sub_region, install_year, installed_gw, source_doc, source_date, confidence, last_reviewed)
    VALUES ('GB', 'Northern Ireland', ni_data[i][1]::INTEGER, ni_data[i][2], 'BEIS/DESNZ REPD; DUKES; WindEurope UK', CURRENT_DATE, 'High', CURRENT_DATE)
    ON CONFLICT (country_code, sub_region, install_year, scope) DO UPDATE SET installed_gw = EXCLUDED.installed_gw, last_reviewed = EXCLUDED.last_reviewed;
  END LOOP;
END $$;

-- ============================================================
-- SEED — US total + Canada total (annual GW, 2000-2025)
-- Source: EIA Form 860, AWEA/ACP, GWEC; CanWEA, NRCan
-- ============================================================
DO $$
DECLARE
  us_data NUMERIC[][] := ARRAY[
    [2000,0.76],[2001,1.68],[2002,0.41],[2003,1.67],[2004,0.37],
    [2005,2.43],[2006,2.45],[2007,5.25],[2008,8.56],[2009,10.01],
    [2010,5.12],[2011,6.82],[2012,13.12],[2013,1.08],[2014,4.85],
    [2015,8.60],[2016,8.20],[2017,7.02],[2018,7.59],[2019,9.14],
    [2020,16.84],[2021,12.75],[2022,8.47],[2023,6.44],[2024,7.50],[2025,8.50]
  ];
  ca_data NUMERIC[][] := ARRAY[
    [2001,0.10],[2002,0.12],[2003,0.14],[2004,0.16],[2005,0.32],
    [2006,0.76],[2007,0.48],[2008,0.52],[2009,0.95],[2010,0.69],
    [2011,1.27],[2012,0.86],[2013,1.60],[2014,0.62],[2015,1.51],
    [2016,0.70],[2017,0.34],[2018,0.56],[2019,0.60],[2020,1.47],
    [2021,0.65],[2022,0.40],[2023,0.50],[2024,0.60],[2025,0.80]
  ];
  i INTEGER;
BEGIN
  FOR i IN 1..array_length(us_data, 1) LOOP
    INSERT INTO wind_pipeline_annual_installations (country_code, sub_region, install_year, installed_gw, source_doc, source_date, confidence, last_reviewed)
    VALUES ('US', 'Total', us_data[i][1]::INTEGER, us_data[i][2], 'EIA Form 860; AWEA/ACP Annual Market Reports; GWEC', CURRENT_DATE, 'High', CURRENT_DATE)
    ON CONFLICT (country_code, sub_region, install_year, scope) DO UPDATE SET installed_gw = EXCLUDED.installed_gw, last_reviewed = EXCLUDED.last_reviewed;
  END LOOP;
  FOR i IN 1..array_length(ca_data, 1) LOOP
    INSERT INTO wind_pipeline_annual_installations (country_code, sub_region, install_year, installed_gw, source_doc, source_date, confidence, last_reviewed)
    VALUES ('CA', 'Total', ca_data[i][1]::INTEGER, ca_data[i][2], 'CanWEA / GWEC Canada Annual Reports; Natural Resources Canada', CURRENT_DATE, 'High', CURRENT_DATE)
    ON CONFLICT (country_code, sub_region, install_year, scope) DO UPDATE SET installed_gw = EXCLUDED.installed_gw, last_reviewed = EXCLUDED.last_reviewed;
  END LOOP;
END $$;

-- ============================================================
-- US STATE FRACTIONS — time-averaged 2000-2025 (% of US total)
-- US state-year GW = US_total[year] × (state_fraction / 100)
-- Source: USGS Wind Turbine Database; EIA Form 860 state-year data
-- ============================================================
CREATE TABLE IF NOT EXISTS wind_us_state_fractions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code      TEXT UNIQUE NOT NULL,
  state_name      TEXT NOT NULL,
  share_pct       NUMERIC NOT NULL CHECK (share_pct >= 0 AND share_pct <= 100),
  notes           TEXT,
  source_doc      TEXT NOT NULL,
  source_date     DATE NOT NULL,
  last_reviewed   DATE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE wind_us_state_fractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_wind_us_state_fractions" ON wind_us_state_fractions FOR SELECT USING (true);
CREATE POLICY "write_wind_us_state_fractions" ON wind_us_state_fractions FOR ALL USING (auth.role() = 'service_role');

INSERT INTO wind_us_state_fractions (state_code, state_name, share_pct, notes, source_doc, source_date, last_reviewed) VALUES
  ('TX', 'Texas',          24, '2006-2009 dominant; sustained leadership through 2025', 'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('IA', 'Iowa',             8, '2010-2014 surge era',                                   'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('OK', 'Oklahoma',         7, '2010-2014 surge era',                                   'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('KS', 'Kansas',           5, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('IL', 'Illinois',         4, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('MN', 'Minnesota',        4, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('CO', 'Colorado',         4, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('NE', 'Nebraska',         3, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('ND', 'North Dakota',     3, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('IN', 'Indiana',          3, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('CA', 'California',       3, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('WY', 'Wyoming',          2, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('SD', 'South Dakota',     2, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('MI', 'Michigan',         2, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('MO', 'Missouri',         2, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('NM', 'New Mexico',       2, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('WA', 'Washington',       2, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('OR', 'Oregon',           2, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('NY', 'New York',         2, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('WI', 'Wisconsin',        1, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('PA', 'Pennsylvania',     1, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('MT', 'Montana',          1, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('ME', 'Maine',            1, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('WV', 'West Virginia',    1, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('ID', 'Idaho',            1, NULL,                                                    'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE),
  ('XX', 'Other States',     9, 'Residual; sum across remaining states',                 'USGS Wind Turbine Database; EIA Form 860', CURRENT_DATE, CURRENT_DATE)
ON CONFLICT (state_code) DO UPDATE SET share_pct = EXCLUDED.share_pct, last_reviewed = EXCLUDED.last_reviewed;

-- ============================================================
-- Helper view — UK total by year (sum across nations)
-- ============================================================
CREATE OR REPLACE VIEW wind_pipeline_uk_total AS
  SELECT install_year, SUM(installed_gw) AS uk_total_gw
  FROM wind_pipeline_annual_installations
  WHERE country_code = 'GB' AND scope = 'onshore'
  GROUP BY install_year
  ORDER BY install_year;

-- ============================================================
-- Telemetry
-- ============================================================
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'seed_wind_pipeline_data', 'success', NOW(), NOW(),
  104 + 26 + 25 + 26,
  'BEIS/DESNZ REPD; DUKES; WindEurope; EIA Form 860; AWEA/ACP; GWEC; CanWEA; NRCan; USGS',
  'Migration 015 — 104 UK nation-year + 26 US-year + 25 CA-year + 26 US state fractions'
);
