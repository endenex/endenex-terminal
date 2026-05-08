-- Migration 055 — Scrap Off-takers cleanup: drop mills/smelters, add real yards
--
-- Migration 054 included steel mills (ArcelorMittal, Nucor, Tata, etc.) and
-- secondary smelters (Aurubis, Hydro, Boliden, Novelis, etc.) — but for an
-- asset owner with a decommissioned wind farm those are NOT counterparties.
-- The flow is:
--
--   Wind farm decom → Dismantling contractor → Scrap merchant/yard → Mill/Smelter
--                                                       ▲
--                                  asset owner's counterparty is HERE
--
-- This migration:
--   • DROPs mills and smelters (they buy from merchants, not asset owners)
--   • ADDs more UK regional yards (Belson Steel, Ward, Bird, Recycling Lives,
--     John Lawrie Metals, etc.) so a UK wind-farm operator sees real options
--   • KEEPs the integrated entities (DJJ, OmniSource, Radius/Schnitzer, CMC)
--     because their YARD operations buy from external sellers — even though
--     they're owned by mills, they operate as merchants in the market.

-- ── Drop pure mills and smelters ────────────────────────────────────────

DELETE FROM scrap_offtakers
 WHERE offtaker_type IN ('mill', 'smelter');

-- ── Add UK regional yards (the ones a UK wind-farm operator would call) ─

INSERT INTO scrap_offtakers
  (name, parent_company, region, countries, hq_country, offtaker_type,
   materials_accepted, scrap_grades_accepted,
   intake_capacity_kt_year, capacity_basis, plant_count,
   pricing_approach, pricing_notes,
   certifications, website, notes, source_publisher) VALUES

  ('Stena Recycling UK', 'Stena Metall AB', 'UK', ARRAY['GB'], 'GB', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium','lead'],
   ARRAY['steel_hms_1_2_8020','copper_no_2','aluminium_taint_tabor'],
   400, 'estimated', 12,
   'merchant_spread', 'UK arm of Stena Metall; integrated with Nordic mill supply.',
   ARRAY['ISO14001','BRSO'],
   'https://www.stenarecycling.co.uk', 'UK yards in Sheffield, Felixstowe, others.',
   'Stena Metall sustainability report 2024'),

  ('John Lawrie Metals', 'John Lawrie Group', 'UK', ARRAY['GB'], 'GB', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   200, 'estimated', 6,
   'merchant_spread', 'Aberdeen-based; specialist in oil & gas decommissioning scrap. Strong fit for offshore wind decom (Scottish North Sea).',
   ARRAY['ISO14001','BRSO'],
   'https://www.johnlawrie.com', 'Major Scottish operator; significant decom-of-energy-infrastructure expertise.',
   'John Lawrie Group corporate'),

  ('Ward Recycling', 'Ward Holdings Ltd', 'UK', ARRAY['GB'], 'GB', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   500, 'estimated', 12,
   'merchant_spread', 'Ilkeston (Derbyshire) HQ; multi-site UK operator.',
   ARRAY['ISO14001','BRSO'],
   'https://www.ward.com', 'Significant UK regional player with shredding capacity.',
   'Ward Recycling corporate'),

  ('Recycling Lives', 'Recycling Lives Ltd', 'UK', ARRAY['GB'], 'GB', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   300, 'estimated', 10,
   'merchant_spread', 'Preston-based UK operator; charity-affiliated (Recycling Lives Foundation).',
   ARRAY['ISO14001','BRSO'],
   'https://www.recyclinglives.com', NULL,
   'Recycling Lives corporate'),

  ('Bird Group / Bird Yorkshire', 'Bird Group Ltd', 'UK', ARRAY['GB'], 'GB', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2'],
   180, 'estimated', 4,
   'merchant_spread', 'Yorkshire-based regional yard.',
   ARRAY['ISO14001'],
   'https://www.birdrecycling.co.uk', NULL,
   'Industry estimates'),

  ('Belson Steel Centre', 'Belson Steel Ltd', 'UK', ARRAY['GB'], 'GB', 'merchant',
   ARRAY['steel','cast_iron'],
   ARRAY['steel_hms_1_2_8020','steel_shred'],
   80, 'estimated', 1,
   'merchant_spread', 'East Midlands ferrous-focused operator.',
   ARRAY['ISO14001'],
   'https://www.belsonsteel.co.uk', NULL,
   'Industry estimates'),

  ('Hopkin Recycling', 'Hopkin Bros & Sons', 'UK', ARRAY['GB'], 'GB', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2'],
   120, 'estimated', 2,
   'merchant_spread', 'North-West England regional yard.',
   ARRAY['ISO14001'],
   'https://www.hopkinrecycling.com', NULL,
   'Industry estimates'),

  ('TJ Lawrence Recycling', 'TJ Lawrence Ltd', 'UK', ARRAY['GB'], 'GB', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','copper_no_2','aluminium_taint_tabor'],
   60, 'estimated', 2,
   'merchant_spread', 'Cumbria/North-West regional yard.',
   ARRAY['ISO14001'],
   'https://www.tjlawrence.co.uk', NULL,
   'Industry estimates'),

  ('Smith Brothers Metals', 'Smith Bros (Stockport) Ltd', 'UK', ARRAY['GB'], 'GB', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium','lead'],
   ARRAY['steel_hms_1_2_8020','copper_no_2','aluminium_taint_tabor'],
   150, 'estimated', 3,
   'merchant_spread', 'NW England regional operator with multiple sites.',
   ARRAY['ISO14001'],
   'https://www.smithbros-metals.co.uk', NULL,
   'Industry estimates'),

  ('George Stockton & Sons', 'Stockton Group', 'UK', ARRAY['GB'], 'GB', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','copper_no_2'],
   100, 'estimated', 2,
   'merchant_spread', 'East Anglia regional yard.',
   ARRAY['ISO14001'],
   'https://www.gstockton.co.uk', NULL,
   'Industry estimates'),

  -- ── Add more Continental EU yards ──

  ('Scholz Recycling', 'Chiho Environmental Group', 'EU', ARRAY['DE','AT','CZ','PL'], 'DE', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   3500, 'estimated', 50,
   'merchant_spread', 'Major German scrap operator; owned by Chinese Chiho Environmental since 2016.',
   ARRAY['ISO14001'],
   'https://www.scholz-recycling.de', 'Multi-country EU presence.',
   'Industry coverage'),

  ('Cronimet Holding', 'Cronimet Holding GmbH', 'EU', ARRAY['DE','PL','CZ','HR','RO'], 'DE', 'merchant',
   ARRAY['steel','cast_iron'],
   ARRAY['steel_hms_1_2_8020','steel_shred'],
   2000, 'estimated', 25,
   'merchant_spread', 'Stainless steel scrap specialist (less relevant for wind/solar but covers all ferrous).',
   ARRAY['ISO14001'],
   'https://www.cronimet.de', NULL,
   'Industry coverage'),

  -- ── Add more US yards ──

  ('Alter Trading Corporation', 'Alter Trading Corp', 'US', ARRAY['US'], 'US', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   2500, 'estimated', 60,
   'merchant_spread', 'Major US Midwest/South operator; family-owned.',
   ARRAY['ISRI','ISO14001'],
   'https://www.altertrading.com', 'Significant Midwest scrap aggregator.',
   'Industry coverage'),

  ('Cohen Recycling', 'Cohen USA', 'US', ARRAY['US'], 'US', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2'],
   1500, 'estimated', 25,
   'merchant_spread', 'Ohio-based US Midwest operator.',
   ARRAY['ISRI','ISO14001','RIOS'],
   'https://www.cohenusa.com', NULL,
   'Industry coverage'),

  ('PADNOS Industries', 'PADNOS', 'US', ARRAY['US'], 'US', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','copper_no_2','aluminium_taint_tabor'],
   1200, 'estimated', 18,
   'merchant_spread', 'Michigan-based US operator; broader plastics + paper coverage too.',
   ARRAY['ISRI','ISO14001'],
   'https://www.padnos.com', NULL,
   'Industry coverage'),

  ('Ferrous Processing & Trading', 'Soave Enterprises', 'US', ARRAY['US'], 'US', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2'],
   1000, 'estimated', 18,
   'merchant_spread', 'Detroit-based; major auto-recycling specialist.',
   ARRAY['ISRI','ISO14001'],
   'https://www.fergusonprocessing.com', NULL,
   'Industry coverage'),

  ('Metalico', 'Metalico Inc', 'US', ARRAY['US'], 'US', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium','lead'],
   ARRAY['steel_hms_1_2_8020','copper_no_2','aluminium_taint_tabor'],
   600, 'estimated', 18,
   'merchant_spread', 'NY/NJ/PA + South-East US regional operator.',
   ARRAY['ISRI'],
   'https://www.metalico.com', NULL,
   'Industry coverage');

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_055_scrap_offtakers_cleanup', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM scrap_offtakers),
  'Hand-curated from corporate disclosures + industry coverage',
  'Migration 055 — dropped mills/smelters (not asset-owner counterparties); added 17 more scrap merchants/yards (10 UK regional, 2 EU, 5 US). Directory now realistic for asset-owner outreach.'
);
