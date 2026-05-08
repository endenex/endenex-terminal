-- Migration 070 — Satellite facilities clean slate (EnergyLoop only)
--
-- Migration 069 seeded 5 facilities with insufficiently verified coordinates
-- and the wrong target type (cement kilns rather than preprocessing sites).
-- Per editorial review:
--
--   • The intelligence signal (blade-stockpile build-up) is at PREPROCESSING /
--     dismantling / shredding sites where whole blades arrive — NOT at cement
--     kilns, which only see ~50 mm shredded chips delivered by truck.
--   • Coordinates from migration 069 were either town centroids or speculative.
--
-- This migration:
--   1. Drops all 5 seeded facilities (and any observations linked to them
--      via FK ON DELETE CASCADE).
--   2. Inserts a single VERIFIED facility — EnergyLoop, Cortes (Navarra),
--      Spain — at coordinates personally verified by the user (Iberdrola /
--      PreZero / Siemens Gamesa joint pyrolysis-preprocessing line).
--
-- Future preprocessing-site additions will come in subsequent migrations
-- once each lat/lng has been verified to the actual industrial polygon.

DELETE FROM satellite_facilities
 WHERE name IN (
   'Holcim Lägerdorf cement plant',
   'Continuum Recycling Esbjerg',
   'LafargeHolcim Joppa cement plant',
   'Carbon Rivers blade pyrolysis pilot',
   'Global Fiberglass Solutions Sweetwater'
 );

INSERT INTO satellite_facilities
  (name, operator_name, asset_class, facility_type, country, region,
   lat, lng, capacity_kt_year, status, source_url, notes) VALUES
  ('EnergyLoop',
   'Iberdrola / PreZero / Siemens Gamesa',
   'wind', 'pyrolysis',
   'ES', 'EU',
   41.92826129824701, -1.4475302519766458,
   6, 'active',
   'https://www.iberdrola.com/about-us/what-we-do/onshore-wind-energy/blade-recycling-energyloop',
   'EnergyLoop: first commercial wind-blade pyrolysis preprocessing plant in Europe. Located in Cortes (Navarra), Spain. Coordinates verified by Endenex internal review — points to the actual industrial site north of the AP-15/A-68 corridor, not the town centroid. Phase-1 capacity ~6 kt/yr; ramping. Joint venture between Iberdrola, PreZero (operator) and Siemens Gamesa.')
ON CONFLICT (name, country) DO UPDATE
   SET lat              = EXCLUDED.lat,
       lng              = EXCLUDED.lng,
       capacity_kt_year = EXCLUDED.capacity_kt_year,
       source_url       = EXCLUDED.source_url,
       notes            = EXCLUDED.notes;

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_070_satellite_facilities_clean_slate', 'success', NOW(), NOW(),
  1,
  'Manual user verification (Cortes/Navarra plant coordinate)',
  'Migration 070 — cleared the unverified Phase-1 seed (Holcim Lägerdorf, Continuum Esbjerg, Holcim Joppa, Carbon Rivers TN, GFS Sweetwater) and replaced with one verified preprocessing facility (EnergyLoop, Cortes/Navarra, Spain). Future facilities to be added one-by-one with verified coordinates.'
);
