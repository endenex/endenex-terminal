-- Migration 058 — Align scrap_offtakers to Endenex Wind Decom Estimator dataset
--
-- The estimator (Marketing/Website tool) carries a curated dataset of 238
-- plant locations across European scrap merchants. This migration syncs
-- the Terminal's scrap_offtakers seed with that authoritative list:
--
--   • Renames Sims Metal Management → Unimetals (UK rebrand reflected in
--     estimator). Sims globally remains; the UK operation rebranded.
--   • Adds 12 major EU/Nordic/Iberian operators that were in the estimator
--     but missed from earlier seeds.
--   • Skips smaller regional yards (Italian / Spanish / Portuguese single-
--     site operators) for v1; focus on operators an asset owner with a
--     50+MW farm would credibly call.
--   • Skips blade/composite specialty processors (Continuum, Renercycle,
--     R3Fiber, Neocomp etc.) — those live in the separate Recovery Value
--     module, not scrap_offtakers.
--   • Skips mills (Acciaierie Venete, Alfa Acciai, Riva, Voestalpine,
--     ArcelorMittal Riwald, Siderurgia Nacional, etc.) — not asset-owner
--     counterparties.
--
-- Each addition has a verifiable source.

-- ── Step 1: Rename Sims → Unimetals (UK rebrand) ────────────────────────

UPDATE scrap_offtakers
   SET name             = 'Unimetals (formerly Sims Metal UK)',
       parent_company   = 'Sims Limited (ASX) — UK operations rebranded as Unimetals',
       region           = 'EU',
       countries        = ARRAY['GB','NL'],
       hq_country       = 'GB',
       plant_count      = 6,
       plants           = '[
         {"city":"Newport","country":"GB","specialty":"Welsh shipping"},
         {"city":"Glasgow","country":"GB","specialty":""},
         {"city":"Tilbury","country":"GB","specialty":"Thames Estuary terminal"},
         {"city":"Aberdeen","country":"GB","specialty":"NE Scotland"},
         {"city":"Long Marston","country":"GB","specialty":""},
         {"city":"Rotterdam Europoort","country":"NL","specialty":"Continental hub"}
       ]'::jsonb,
       notes            = 'UK arm of Sims Metal Management was rebranded "Unimetals" (per Endenex Wind Decom Estimator dataset). Sims globally still listed on ASX. Recently acquired Morley Waste UK.',
       source_url       = 'https://www.simsmm.co.uk',
       source_publisher = 'Sims annual report + Endenex internal estimator dataset',
       last_verified    = CURRENT_DATE
 WHERE name = 'Sims Metal Management';

-- ── Step 2: Add EMR Wind Turbine Processing Centre as a noted plant ────
-- The estimator explicitly marks "EMR Wind Turbine Processing Centre Glasgow"
-- as a separate plant location. Update the EMR notes to call it out.

UPDATE scrap_offtakers
   SET plants = '[
         {"city":"Glasgow Wind Turbine Processing Centre","country":"GB","specialty":"Dedicated wind decom hub"},
         {"city":"Hamburg","country":"DE","specialty":"Continental EMR"},
         {"city":"Rostock","country":"DE","specialty":"North Sea decom hub"}
       ]'::jsonb,
       plant_count = 65,
       notes = 'UK''s largest metal recycler — 65 UK sites + Glasgow Wind Turbine Processing Centre (dedicated wind decom hub) + DE sites (Hamburg, Rostock). Parent: Ausurus Group. HQ: Warrington, Cheshire.',
       last_verified = CURRENT_DATE
 WHERE name = 'European Metal Recycling (EMR)';

-- ── Step 3: Add major EU operators missing from the seed ────────────────

INSERT INTO scrap_offtakers
  (name, parent_company, region, countries, hq_country, offtaker_type,
   materials_accepted, scrap_grades_accepted,
   intake_capacity_kt_year, capacity_basis, plant_count,
   plants, pricing_approach, pricing_notes,
   certifications, website, notes, source_url, source_publisher) VALUES

  ('Derichebourg', 'Derichebourg SA (EPA: DBG)', 'EU', ARRAY['FR'], 'FR', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium','lead','zinc'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   NULL, 'undisclosed', 12,
   '[
     {"city":"Bordeaux","country":"FR"},
     {"city":"Dunkerque","country":"FR","specialty":"Channel/North Sea port"},
     {"city":"Le Havre","country":"FR","specialty":"Atlantic export terminal"},
     {"city":"Lille","country":"FR"},
     {"city":"Lyon","country":"FR"},
     {"city":"Marseille","country":"FR","specialty":"Mediterranean port"},
     {"city":"Nantes","country":"FR"},
     {"city":"Paris Gennevilliers","country":"FR","specialty":"Île-de-France hub"},
     {"city":"Rennes","country":"FR"},
     {"city":"Rouen","country":"FR","specialty":"Seine river port"},
     {"city":"Strasbourg","country":"FR","specialty":"Rhine port"},
     {"city":"Toulouse","country":"FR"}
   ]'::jsonb,
   'merchant_spread', 'France''s largest scrap merchant; listed on Euronext Paris.',
   ARRAY['ISO14001'],
   'https://www.derichebourg.com',
   'Major French scrap operator with national network and port-side terminals (Le Havre, Marseille, Dunkerque). 12 yards across France per Endenex Wind Decom Estimator dataset.',
   'https://www.derichebourg.com',
   'Derichebourg corporate + Endenex internal estimator dataset'),

  ('Ferimet', 'Ferimet SA', 'EU', ARRAY['ES'], 'ES', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium','lead','zinc'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   NULL, 'undisclosed', 9,
   '[
     {"city":"Barcelona","country":"ES","specialty":"Catalonia hub"},
     {"city":"Bilbao","country":"ES","specialty":"Basque port"},
     {"city":"Madrid","country":"ES"},
     {"city":"Sevilla","country":"ES","specialty":"Andalusia"},
     {"city":"Tarragona","country":"ES","specialty":"Mediterranean port"},
     {"city":"Valencia","country":"ES","specialty":"Mediterranean port"},
     {"city":"Valladolid","country":"ES"},
     {"city":"Vitoria-Gasteiz","country":"ES","specialty":"Basque country"},
     {"city":"Zaragoza","country":"ES","specialty":"Aragon"}
   ]'::jsonb,
   'merchant_spread', 'Spain''s largest scrap operator by site count.',
   ARRAY['ISO14001'],
   'https://www.ferimet.com',
   'Spain''s major national scrap merchant network. 9 sites covering all major Spanish regions per Endenex Wind Decom Estimator dataset.',
   'https://www.ferimet.com',
   'Endenex internal estimator dataset'),

  ('Lyrsa', 'Lyrsa SA', 'EU', ARRAY['ES','PT'], 'ES', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   NULL, 'undisclosed', 5,
   '[
     {"city":"Barcelona","country":"ES"},
     {"city":"Madrid","country":"ES"},
     {"city":"Sevilla","country":"ES"},
     {"city":"Zaragoza","country":"ES"},
     {"city":"Lisboa","country":"PT","specialty":"Portuguese ops"}
   ]'::jsonb,
   'merchant_spread', 'Iberian operator: 4 Spanish sites + Lisbon Portugal.',
   ARRAY['ISO14001'],
   'https://www.lyrsa.es',
   'Iberian peninsula scrap operator. 4 Spanish + 1 Portuguese site per Endenex Wind Decom Estimator dataset.',
   'https://www.lyrsa.es',
   'Endenex internal estimator dataset'),

  ('HKS Scrap Metals', 'HKS Metals BV', 'EU', ARRAY['NL'], 'NL', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   NULL, 'undisclosed', 5,
   '[
     {"city":"s-Hertogenbosch","country":"NL"},
     {"city":"Amsterdam","country":"NL"},
     {"city":"Eindhoven","country":"NL"},
     {"city":"Rotterdam","country":"NL","specialty":"Major Continental port"},
     {"city":"Utrecht","country":"NL"}
   ]'::jsonb,
   'merchant_spread', 'Major Dutch national scrap merchant.',
   ARRAY['ISO14001'],
   'https://www.hksmetals.com',
   'Netherlands national scrap merchant network. 5 sites across major Dutch metro areas per Endenex Wind Decom Estimator dataset.',
   'https://www.hksmetals.com',
   'Endenex internal estimator dataset'),

  ('Hammond Lane', 'Hammond Lane Metal Co Ltd', 'EU', ARRAY['IE'], 'IE', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   NULL, 'undisclosed', 3,
   '[
     {"city":"Cork","country":"IE","specialty":"Southern Ireland"},
     {"city":"Dublin","country":"IE","specialty":"East coast"},
     {"city":"Limerick","country":"IE","specialty":"Western Ireland"}
   ]'::jsonb,
   'merchant_spread', 'Ireland''s largest scrap merchant; national network.',
   ARRAY['ISO14001'],
   'https://www.hammondlane.ie',
   'Ireland-wide ferrous + non-ferrous scrap operator. Three regional sites per Endenex Wind Decom Estimator dataset.',
   'https://www.hammondlane.ie',
   'Endenex internal estimator dataset'),

  ('Kuusakoski', 'Kuusakoski Group Oy', 'EU', ARRAY['FI','SE','DK','EE','LT','LV','PL'], 'FI', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium','lead','zinc'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   NULL, 'undisclosed', NULL,
   '[
     {"city":"Gävle","country":"SE","specialty":"Swedish operations"},
     {"city":"Stockholm","country":"SE","specialty":"Swedish capital"}
   ]'::jsonb,
   'merchant_spread', 'Finnish-headquartered Nordic + Baltic scrap operator. Family-owned group founded 1914.',
   ARRAY['ISO14001'],
   'https://www.kuusakoski.com',
   'Major Nordic-Baltic operator. Estimator lists 2 SE sites; Kuusakoski operates broader Finnish + Baltic + Polish network from FI HQ.',
   'https://www.kuusakoski.com',
   'Kuusakoski corporate + Endenex internal estimator dataset'),

  ('Müller-Guttenbrunn (MGG)', 'Müller-Guttenbrunn Gruppe GmbH', 'EU', ARRAY['AT'], 'AT', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   NULL, 'undisclosed', 1,
   '[{"city":"Amstetten","country":"AT","specialty":"Austrian HQ"}]'::jsonb,
   'merchant_spread', 'Austrian recycling group; family-owned. ELV + electronic scrap focus.',
   ARRAY['ISO14001','EuCertPlast'],
   'https://www.mgg-recycling.com', NULL,
   'https://www.mgg-recycling.com',
   'MGG corporate + Endenex internal estimator dataset'),

  ('Loacker Recycling', 'Loacker Recycling GmbH', 'EU', ARRAY['AT','DE','IT','CZ','HU'], 'AT', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','copper_no_2','aluminium_taint_tabor'],
   NULL, 'undisclosed', 1,
   '[{"city":"Götzis","country":"AT","specialty":"Vorarlberg HQ"}]'::jsonb,
   'merchant_spread', 'Austrian operator with broader DACH + CEE network from Vorarlberg HQ.',
   ARRAY['ISO14001'],
   'https://www.loacker.cc', NULL,
   'https://www.loacker.cc',
   'Loacker corporate + Endenex internal estimator dataset'),

  ('Comet Traitements', 'Comet Group SA', 'EU', ARRAY['BE'], 'BE', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','copper_no_2','aluminium_taint_tabor'],
   NULL, 'undisclosed', 1,
   '[{"city":"Liège","country":"BE","specialty":"Wallonia operations"}]'::jsonb,
   'merchant_spread', 'Belgian Walloon operator; ELV shredding + ferrous/non-ferrous separation.',
   ARRAY['ISO14001'],
   'https://www.comet.eu', NULL,
   'https://www.comet.eu',
   'Comet corporate + Endenex internal estimator dataset'),

  ('Van Gansewinkel (Renewi)', 'Renewi plc (LSE: RWI)', 'EU', ARRAY['BE','NL'], 'BE', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','copper_no_2','aluminium_taint_tabor'],
   NULL, 'undisclosed', 1,
   '[{"city":"Antwerp","country":"BE","specialty":"Antwerp port"}]'::jsonb,
   'merchant_spread', 'Belgian-Dutch recycling group; metals desk part of broader waste-management portfolio. Now part of Renewi plc.',
   ARRAY['ISO14001'],
   'https://www.renewi.com', NULL,
   'https://www.renewi.com',
   'Renewi corporate + Endenex internal estimator dataset'),

  ('Ambigroup', 'Ambigroup SGPS SA', 'EU', ARRAY['PT'], 'PT', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','copper_no_2','aluminium_taint_tabor'],
   NULL, 'undisclosed', 2,
   '[
     {"city":"Porto","country":"PT","specialty":"Northern Portugal"},
     {"city":"Seixal (Setúbal estuary)","country":"PT","specialty":"Lisbon area + estuary access"}
   ]'::jsonb,
   'merchant_spread', 'Major Portuguese scrap operator with two regional sites.',
   ARRAY['ISO14001'],
   'https://www.ambigroup.com', NULL,
   'https://www.ambigroup.com',
   'Ambigroup corporate + Endenex internal estimator dataset'),

  ('Enva Metals', 'Enva Ireland Ltd', 'EU', ARRAY['IE'], 'IE', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','copper_no_2','aluminium_taint_tabor'],
   NULL, 'undisclosed', 1,
   '[{"city":"Dublin","country":"IE","specialty":"Eastern Ireland"}]'::jsonb,
   'merchant_spread', 'Irish recycling group; metals desk part of broader environmental services.',
   ARRAY['ISO14001'],
   'https://www.enva.com', NULL,
   'https://www.enva.com',
   'Enva corporate + Endenex internal estimator dataset')
ON CONFLICT (name, region) DO NOTHING;

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_058_align_to_estimator', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM scrap_offtakers),
  'Endenex Wind Decom Estimator dataset (Marketing/Website tools/) + corporate sites',
  'Migration 058 — aligned scrap_offtakers seed to estimator data: renamed Sims UK→Unimetals (rebrand), updated EMR with Wind Turbine Processing Centre + DE sites, added 12 major EU operators (Derichebourg FR, Ferimet ES, Lyrsa ES/PT, HKS NL, Hammond Lane IE, Kuusakoski FI/SE, MGG AT, Loacker AT, Comet BE, Renewi-Van Gansewinkel BE/NL, Ambigroup PT, Enva IE).'
);
