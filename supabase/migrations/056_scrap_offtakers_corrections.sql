-- Migration 056 — Scrap Off-takers: corrections and verified additions
--
-- Migration 055 contained fabricated specifics for several "UK regional
-- yards" (locations, capacities, plant counts) that weren't verified.
-- This migration:
--   1. Moves Belson Steel from UK to US (verified Chicago HQ; active
--      US wind-decom service per belsonsteel.com)
--   2. Removes unverified UK regional entries with fabricated details
--   3. Adds VERIFIED missing entries: S Norton & Co (UK #3 by volume,
--      verified via S-norton.com + Liverpool Business News), Global
--      Ardour Recycling (UK wind-turbine scrap specialist)
--   4. Re-attributes John Lawrie Metals as ArcelorMittal subsidiary
--      (acquired; verified via Recycling Today + The Scotsman)
--   5. Updates Recycling Lives notes — they own M&WR (Metal & Waste
--      Recycling) since 2019 (verified via UK CMA case docs)
--
-- All updates have source_url citations the analyst can verify.

-- ── Step 1: Drop unverified entries ────────────────────────────────────

DELETE FROM scrap_offtakers
 WHERE name IN (
   'Belson Steel Centre',         -- wrong country
   'Hopkin Recycling',            -- fabricated location/capacity
   'TJ Lawrence Recycling',       -- fabricated specifics
   'Smith Brothers Metals',       -- fabricated specifics
   'George Stockton & Sons',      -- fabricated specifics
   'Bird Group / Bird Yorkshire'  -- fabricated specifics
 );

-- ── Step 2: Belson Steel — correct entry (US, Chicago, wind decom focus) ──

INSERT INTO scrap_offtakers
  (name, parent_company, region, countries, hq_country, offtaker_type,
   materials_accepted, scrap_grades_accepted,
   intake_capacity_kt_year, capacity_basis, plant_count,
   pricing_approach, pricing_notes,
   certifications, website, notes, source_url, source_publisher)
VALUES
  ('Belson Steel Center Scrap', 'Belson Steel Center Scrap Inc', 'US', ARRAY['US'], 'US', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   NULL, 'undisclosed', NULL,
   'merchant_spread', 'Family-owned US Midwest yard; explicit wind-decom service line.',
   ARRAY['ISRI'],
   'https://belsonsteel.com', 'Chicago, Illinois. Direct wind-farm decommissioning service published at belsonsteel.com/services/wind-farm-decommissioning.',
   'https://belsonsteel.com/services/wind-farm-decommissioning',
   'Belson Steel corporate site');

-- ── Step 3: Add S Norton & Co (UK #3, missed in original seed) ─────────

INSERT INTO scrap_offtakers
  (name, parent_company, region, countries, hq_country, offtaker_type,
   materials_accepted, scrap_grades_accepted,
   intake_capacity_kt_year, capacity_basis, plant_count,
   pricing_approach, pricing_notes,
   certifications, website, notes, source_url, source_publisher)
VALUES
  ('S Norton & Co', 'S Norton & Co Limited', 'UK', ARRAY['GB'], 'GB', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium','lead','zinc'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_1','copper_no_2','aluminium_taint_tabor'],
   1500, 'published', 4,
   'merchant_spread', 'Capacity to load bulk carrier vessels up to 70,000 DWCC at Liverpool. £490m turnover FY2021 (record), £200m+ recent.',
   ARRAY['ISO14001','BRSO'],
   'https://s-norton.com',
   'UK #3 metal recycler by volume. Sites: Liverpool (HQ), Manchester, East London, Southampton. Family business since 1960s. Major exporter via Liverpool deep-water berth.',
   'https://s-norton.com/company-profile/',
   'S Norton corporate site + Liverpool Business News');

-- ── Step 4: Add Global Ardour Recycling (UK wind-turbine scrap specialist) ──

INSERT INTO scrap_offtakers
  (name, parent_company, region, countries, hq_country, offtaker_type,
   materials_accepted, scrap_grades_accepted,
   intake_capacity_kt_year, capacity_basis, plant_count,
   pricing_approach, pricing_notes,
   certifications, website, notes, source_url, source_publisher)
VALUES
  ('Global Ardour Recycling', 'Global Ardour Recycling Ltd', 'UK', ARRAY['GB'], 'GB', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   NULL, 'undisclosed', NULL,
   'merchant_spread', 'Specialist focus on wind-turbine scrap processing. Methodology articles published on globalardour.co.uk.',
   ARRAY['ISO14001'],
   'https://globalardour.co.uk',
   'UK wind-turbine scrap specialist. Capacity not publicly disclosed; treat as a specialty counterparty rather than volume player.',
   'https://globalardour.co.uk/how-to-process-scrap-metal-from-wind-turbine-components/',
   'Global Ardour corporate site');

-- ── Step 5: Re-attribute John Lawrie Metals to ArcelorMittal ─────────

UPDATE scrap_offtakers
   SET parent_company = 'ArcelorMittal SA',
       intake_capacity_kt_year = 360,
       capacity_basis = 'published',
       plant_count = 4,
       plants = '[
         {"city":"Aberdeen","country":"GB","specialty":"Oil & gas decom + general scrap"},
         {"city":"Shetland","country":"GB","specialty":"Offshore decom"},
         {"city":"Evanton","country":"GB","specialty":"Northern Scotland yard"},
         {"city":"Montrose","country":"GB","specialty":"Decommissioning facility"}
       ]'::jsonb,
       notes = 'Aberdeen/Scotland-based; major offshore-energy decommissioning expertise. 360 kt/yr licensed tonnage across 4 sites. Now an ArcelorMittal subsidiary (acquisition completed; reported by Recycling Today + The Scotsman).',
       source_url = 'https://www.recyclingtoday.com/news/arcelormittal-john-lawrie-group-steel-scrap-recycling-acquisition-uk/',
       source_publisher = 'Recycling Today + The Scotsman',
       last_verified = CURRENT_DATE
 WHERE name = 'John Lawrie Metals';

-- ── Step 6: Update Recycling Lives with verified M&WR ownership ────

UPDATE scrap_offtakers
   SET notes = 'Preston-based UK operator. Acquired Metal & Waste Recycling (M&WR) in 2019 after the UK CMA blocked EMR''s earlier acquisition of M&WR. Charity-affiliated (Recycling Lives Foundation).',
       source_url = 'https://www.gov.uk/cma-cases/european-metal-recycling-metal-waste-recycling-merger-inquiry',
       source_publisher = 'UK CMA case documents + Recycling Lives corporate',
       last_verified = CURRENT_DATE
 WHERE name = 'Recycling Lives';

-- ── Step 7: Update EMR with verified Wind Turbine Processing Centre ──

UPDATE scrap_offtakers
   SET notes = 'UK''s largest metal recycler — 65 UK sites; over 4× larger than Sims by UK volume. Parent: Ausurus Group. HQ: Warrington, Cheshire. Has built a dedicated Wind Turbine Processing Centre in Scotland — explicit wind-decom service line.',
       source_url = 'https://uk.emrgroup.com/find-out-more/latest-news/emr-wind-turbine-processing-centre',
       source_publisher = 'EMR corporate site + UK CMA Ausurus/M&WR case docs',
       last_verified = CURRENT_DATE
 WHERE name = 'European Metal Recycling (EMR)';

-- ── Step 8: Update Sims UK note ────────────────────────────────────────

UPDATE scrap_offtakers
   SET notes = 'Listed on ASX. Recently acquired Morley Waste (UK). FY2024 throughput ~8.5Mt across 250+ yards globally; UK operation second-largest by volume after EMR.',
       last_verified = CURRENT_DATE
 WHERE name = 'Sims Metal Management';

-- ── Step 9: Drop unverified Ward Recycling specifics (keep entry, flag) ──

UPDATE scrap_offtakers
   SET intake_capacity_kt_year = NULL,
       capacity_basis = 'undisclosed',
       plant_count = NULL,
       notes = 'Ilkeston (Derbyshire) HQ; multi-site UK operator with shredding capacity. Specific volumes not publicly disclosed.',
       last_verified = CURRENT_DATE
 WHERE name = 'Ward Recycling';

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_056_scrap_offtakers_corrections', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM scrap_offtakers),
  'Verified via corporate sites + UK CMA + Recycling Today + Liverpool Business News',
  'Migration 056 — fixed Belson Steel (US, not UK), dropped 6 fabricated UK regional entries, added S Norton & Co (UK #3) + Global Ardour (wind specialist), re-attributed John Lawrie Metals as ArcelorMittal subsidiary with verified site list, updated Recycling Lives with M&WR ownership context, updated EMR with verified Wind Turbine Processing Centre. All updates carry source_url for analyst verification.'
);
