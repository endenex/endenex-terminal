-- Migration 071 — Annual installation history for retirement-pipeline panels
--
-- Underpins the new Wind / Solar / BESS retirement panels in the ARI module.
-- For each (asset_class, country, region, year) we store annual installed
-- capacity in MW. The Terminal panels apply a Weibull retirement curve
-- (parameterised by user-adjustable design life) to project annual
-- retirements in the 2026-2035 horizon.
--
-- Phase 1 seed: UK (4 nations) + US (4 census regions) + Canada onshore wind.
-- Lifted from the curated Endenex marketing-site datasets at:
--   - site/external/uk-wind-pipeline.html
--   - site/external/us-canada-wind-pipeline.html
-- Original sources: BEIS REPD / DUKES, EIA Form 860, AWEA/ACP Annual Market
-- Reports, GWEC, CanWEA, USGS Wind Turbine Database.
--
-- Tier 1 expansion (DE/ES/FR/DK/NL/IT/SE/PL/BR wind, all solar, all BESS)
-- to follow in Migration 072 once research-agent verification completes.

-- ── Schema ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS installation_history (
  id                bigserial PRIMARY KEY,
  asset_class       text NOT NULL CHECK (asset_class IN
                      ('wind_onshore','wind_offshore','solar','bess')),
  country           text NOT NULL,                    -- ISO-2 ('GB','US','DE'...)
  region            text,                             -- sub-national label (e.g. 'Scotland', 'US-Midwest')
  year              integer NOT NULL CHECK (year BETWEEN 1990 AND 2030),
  capacity_mw       numeric NOT NULL CHECK (capacity_mw >= 0),
  duration_h        numeric,                          -- BESS only: avg duration; null otherwise
  source_publisher  text,
  source_url        text,
  notes             text,
  last_verified     date NOT NULL DEFAULT CURRENT_DATE,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (asset_class, country, region, year)
);

CREATE INDEX IF NOT EXISTS installation_history_class_country_idx
  ON installation_history (asset_class, country);
CREATE INDEX IF NOT EXISTS installation_history_year_idx
  ON installation_history (year);

ALTER TABLE installation_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_installation_history" ON installation_history;
CREATE POLICY "read_installation_history" ON installation_history FOR SELECT USING (true);

-- ── UK onshore wind — 4 nations, 2000-2025 (GW → MW) ───────────────────
-- Source: BEIS REPD, DUKES, WindEurope; from marketing site uk-wind-pipeline.

INSERT INTO installation_history
  (asset_class, country, region, year, capacity_mw, source_publisher, source_url) VALUES
  -- Scotland
  ('wind_onshore','GB','Scotland',2000, 100,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2001,  90,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2002, 110,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2003, 200,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2004, 180,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2005, 250,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2006, 360,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2007, 240,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2008, 480,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2009, 580,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2010, 550,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2011, 430,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2012,1090,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2013, 660,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2014, 990,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2015, 480,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2016, 360,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2017, 160,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2018, 210,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2019, 160,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2020, 150,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2021, 210,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2022, 250,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2023, 390,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2024, 460,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Scotland',2025, 680,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),

  -- England
  ('wind_onshore','GB','England',2000,  50,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2001,  50,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2002,  60,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2003, 100,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2004,  90,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2005, 130,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2006, 180,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2007, 120,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2008, 250,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2009, 300,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2010, 280,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2011, 220,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2012, 550,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2013, 340,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2014, 510,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2015, 250,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2016, 180,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2017,  80,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2018, 100,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2019,  80,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2020,  80,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2021, 100,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2022, 130,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2023, 200,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2024, 230,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','England',2025, 350,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),

  -- Wales
  ('wind_onshore','GB','Wales',2000,  10,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2001,  10,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2002,  20,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2003,  30,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2004,  30,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2005,  40,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2006,  60,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2007,  40,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2008,  80,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2009,  90,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2010,  90,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2011,  70,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2012, 170,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2013, 100,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2014, 160,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2015,  80,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2016,  60,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2017,  30,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2018,  30,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2019,  30,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2020,  20,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2021,  30,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2022,  40,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2023,  60,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2024,  70,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Wales',2025, 110,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),

  -- Northern Ireland
  ('wind_onshore','GB','Northern Ireland',2000,  10,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2001,  10,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2002,  10,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2003,  20,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2004,  20,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2005,  20,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2006,  40,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2007,  30,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2008,  50,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2009,  70,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2010,  60,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2011,  50,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2012, 130,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2013,  80,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2014, 110,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2015,  50,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2016,  40,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2017,  10,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2018,  30,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2019,  10,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2020,  20,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2021,  30,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2022,  20,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2023,  40,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2024,  40,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract'),
  ('wind_onshore','GB','Northern Ireland',2025,  70,'BEIS REPD','https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract')
ON CONFLICT (asset_class, country, region, year) DO NOTHING;

-- ── US onshore wind — 4 census regions, 2000-2025 (GW × regional fracs → MW) ──
-- Regional fractions of US total (from STATE_FRACS rollup):
--   Northeast (NY/PA/ME)     : 4%
--   Midwest (IA/IL/IN/KS/MI/MN/MO/NE/ND/SD/WI) : 37%
--   South (TX/OK/WV)         : 32%
--   West (CA/CO/WY/WA/OR/ID/MT/NM) : 17%
--   Other (allocated)        : 10%
-- Source: EIA Form 860 + USGS Wind Turbine Database

INSERT INTO installation_history
  (asset_class, country, region, year, capacity_mw, source_publisher, source_url) VALUES
  -- US-Northeast (4% of US total)
  ('wind_onshore','US','US-Northeast',2000,  30,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2001,  67,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2002,  16,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2003,  67,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2004,  15,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2005,  97,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2006,  98,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2007, 210,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2008, 342,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2009, 400,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2010, 205,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2011, 273,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2012, 525,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2013,  43,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2014, 194,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2015, 344,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2016, 328,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2017, 281,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2018, 304,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2019, 366,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2020, 674,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2021, 510,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2022, 339,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2023, 258,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2024, 300,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Northeast',2025, 340,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),

  -- US-Midwest (37%)
  ('wind_onshore','US','US-Midwest',2000, 281,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2001, 622,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2002, 152,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2003, 618,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2004, 137,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2005, 899,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2006, 906,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2007,1942,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2008,3167,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2009,3704,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2010,1894,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2011,2523,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2012,4854,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2013, 400,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2014,1795,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2015,3182,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2016,3034,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2017,2597,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2018,2808,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2019,3382,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2020,6231,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2021,4718,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2022,3134,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2023,2383,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2024,2775,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-Midwest',2025,3145,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),

  -- US-South (32%)
  ('wind_onshore','US','US-South',2000, 243,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2001, 538,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2002, 131,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2003, 534,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2004, 118,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2005, 778,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2006, 784,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2007,1680,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2008,2739,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2009,3203,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2010,1638,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2011,2182,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2012,4198,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2013, 346,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2014,1552,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2015,2752,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2016,2624,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2017,2246,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2018,2429,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2019,2925,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2020,5389,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2021,4080,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2022,2710,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2023,2061,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2024,2400,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-South',2025,2720,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),

  -- US-West (17%)
  ('wind_onshore','US','US-West',2000, 129,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2001, 286,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2002,  70,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2003, 284,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2004,  63,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2005, 413,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2006, 417,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2007, 893,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2008,1455,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2009,1702,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2010, 870,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2011,1159,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2012,2230,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2013, 184,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2014, 825,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2015,1462,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2016,1394,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2017,1193,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2018,1290,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2019,1554,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2020,2863,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2021,2168,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2022,1440,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2023,1095,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2024,1275,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/'),
  ('wind_onshore','US','US-West',2025,1445,'EIA Form 860 / USGS USWTDB','https://eerscmap.usgs.gov/uswtdb/')
ON CONFLICT (asset_class, country, region, year) DO NOTHING;

-- ── Canada onshore wind, 2001-2025 (GW → MW) ───────────────────────────
-- Source: CanWEA / GWEC Canada, Natural Resources Canada

INSERT INTO installation_history
  (asset_class, country, region, year, capacity_mw, source_publisher, source_url) VALUES
  ('wind_onshore','CA','Canada',2001, 100,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2002, 120,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2003, 140,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2004, 160,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2005, 320,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2006, 760,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2007, 480,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2008, 520,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2009, 950,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2010, 690,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2011,1270,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2012, 860,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2013,1600,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2014, 620,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2015,1510,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2016, 700,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2017, 340,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2018, 560,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2019, 600,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2020,1470,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2021, 650,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2022, 400,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2023, 500,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2024, 600,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/'),
  ('wind_onshore','CA','Canada',2025, 800,'CanWEA / GWEC','https://www.cer-rec.gc.ca/en/data-analysis/')
ON CONFLICT (asset_class, country, region, year) DO NOTHING;

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_071_installation_history', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM installation_history),
  'Endenex marketing-site curated datasets (BEIS REPD, EIA Form 860, USGS USWTDB, CanWEA, GWEC)',
  'Migration 071 — installation_history schema + Phase-1 wind onshore seed (UK 4 nations + US 4 census regions + Canada). Tier 1 EU + offshore + solar + BESS to follow in Migration 072 once research-agent verification completes. China explicitly excluded per product decision (distortion + non-addressable market for asset-owner audience).'
);
