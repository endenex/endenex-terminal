-- Migration 057 — Add HJ Hansen Recycling Group (Denmark)
--
-- Notable Northern European scrap operator missed from earlier seeds.
-- Verified via hjhansen.dk + scrapmonster.com + Bloomberg profile.

INSERT INTO scrap_offtakers
  (name, parent_company, region, countries, hq_country, offtaker_type,
   materials_accepted, scrap_grades_accepted,
   intake_capacity_kt_year, capacity_basis, plant_count,
   pricing_approach, pricing_notes,
   certifications, website, notes, source_url, source_publisher) VALUES
  ('HJHansen Recycling Group', 'HJHansen Recycling A/S', 'EU',
   ARRAY['DK'], 'DK', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium','lead','zinc'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   NULL, 'undisclosed', NULL,
   'merchant_spread',
   'Family-owned (six generations, founded 1829). Major Northern European iron/metal scrap operator. Ships 25-35kt iron-scrap consignments via Lindø Port of Odense. Annual total tonnage not publicly disclosed.',
   ARRAY['ISO14001'],
   'https://www.hjhansen.dk',
   'Odense, Denmark HQ. One of Northern Europe''s leading iron and metal scrap recycling companies. Six-generation family business; founded 1829.',
   'https://www.hjhansen.dk/en/the-group/about-hjhansen/',
   'HJHansen corporate site + Bloomberg + ScrapMonster company profile')
ON CONFLICT (name, region) DO NOTHING;

-- Telemetry
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_057_scrap_offtakers_hj_hansen', 'success', NOW(), NOW(),
  1,
  'Verified via HJHansen corporate site',
  'Migration 057 — added HJ Hansen Recycling Group (Denmark). Capacity not publicly disclosed; flagged as such.'
);
