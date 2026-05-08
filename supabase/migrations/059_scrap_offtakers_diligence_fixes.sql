-- Migration 059 — Scrap Off-takers diligence corrections to Migration 058
--
-- Migration 058 aligned the seed to the Endenex estimator dataset, but
-- assumed the estimator was ground truth. Per user: "you should not assume
-- that estimator data is correct. diligence everything." This migration
-- applies primary-source verified corrections to every operator added in
-- 058.
--
-- Findings summary (each row carries a verifiable source URL):
--
--   • Unimetals — NOT a rebrand. Acquisition: Sims sold its UK metals
--     business to Sept Capital, rebranded Unimetals (Sept 2024, ~£195m,
--     28 facilities). October 2025: Unimetals filed Notice of Intention
--     to appoint administrators — flagged as distressed counterparty.
--   • Ferimet — owned by Celsa Group (Spanish steel mill). Reclassify
--     offtaker_type from 'merchant' to 'integrated'. ~1 Mt ferrous.
--     Caldes de Montbui X-ray separation plant (2019).
--   • Derichebourg — 13 countries (incl. US: Houston + Oklahoma City),
--     >5 Mt/yr scrap, €3.3bn revenue, founded 1956.
--   • Kuusakoski — ~750 kt/yr verified (600 baseline + 150 Veitsiluoto
--     2025 plant), founded 1914.
--   • HKS Scrap Metals — wholly-owned subsidiary of TSR Group (DE),
--     not independent. HQ Amersfoort, 13 sites incl. 2 in Belgium,
--     includes the Van Dalen Metals acquisition.
--   • Hammond Lane — since 1898, 5 ROI sites (Dublin, Athlone, Cork,
--     Sligo, Clondalkin) + NI sites (Belfast, Derry, Portadown). Parent:
--     Clearway Disposal Ltd. Not 3 sites in Cork/Dublin/Limerick as
--     estimator listed.
--   • MGG — 850 kt/yr verified, Amstetten + Kematen/Ybbs (Metran).
--   • Lyrsa — acquired by Derichebourg Environnement 2019/2020. Founded
--     1939, ~1 Mt/yr scrap (~160 kt non-ferrous), 17 ES + 1 PT sites.
--     Re-attribute parent to Derichebourg.
--   • Comet Traitements — 1.2 Mt/yr shredder capacity (METSO LINDEMANN
--     7,000 hp / 300 t/h). COMETSAMBRE handles 800 kt/yr scrap supply.
--     Family-owned, ~30 companies BE+FR.
--   • Loacker Recycling — 25 companies, 47 sites in 8 countries,
--     family-owned 5 generations, ~1,400 employees. HQ Götzis (AT).
--   • Renewi (Van Gansewinkel) — acquired by Macquarie + BCI consortium
--     June 2025 (delisted from LSE/Euronext Amsterdam). Largest Benelux
--     recycler. Update parent.
--   • Ambigroup — 12 recycling units in PT, 100,000 m² facilities,
--     >€25m revenue, Seixal Ecopark since 2012.
--   • Enva — owned by I Squared Capital since April 2023 (carved out
--     of DCC plc in 2017).

-- ── Step 1: Unimetals — flag distress + correct acquisition narrative ──

UPDATE scrap_offtakers
   SET parent_company   = 'Sept Capital (acquired UK Sims metals Sept 2024)',
       plant_count      = 28,
       notes            = 'CAUTIONARY COUNTERPARTY. Sims sold its UK metals business to Sept Capital in Sept 2024 (~£195m, 28 facilities) and the business was rebranded Unimetals — not a simple rebrand of Sims. In October 2025 Unimetals filed a Notice of Intention to appoint administrators. Treat as distressed; verify trading status before any commercial reliance.',
       source_url       = 'https://www.recyclingtoday.com/news/unimetals-uk-administration-notice-intention/',
       source_publisher = 'Recycling Today + Sims Limited ASX disclosures',
       last_verified    = CURRENT_DATE
 WHERE name = 'Unimetals (formerly Sims Metal UK)';

-- ── Step 2: Ferimet — reclassify as integrated (Celsa subsidiary) ──────

UPDATE scrap_offtakers
   SET parent_company   = 'Celsa Group (Spanish long-products steel mill)',
       offtaker_type    = 'integrated',
       intake_capacity_kt_year = 1000,
       capacity_basis   = 'estimated',
       plant_count      = 3,
       plants           = '[
         {"city":"Madrid","country":"ES","specialty":"Central Spain hub"},
         {"city":"Barcelona","country":"ES","specialty":"Catalonia hub"},
         {"city":"Caldes de Montbui","country":"ES","specialty":"X-ray separation plant (2019)"}
       ]'::jsonb,
       notes            = 'Spanish scrap arm of Celsa Group (one of Europe''s largest long-products steel producers). Captive scrap supply to Celsa mills — feeds parent rather than competing on merchant export. ~1 Mt/yr ferrous throughput. Caldes de Montbui plant features X-ray sorting (commissioned 2019).',
       source_url       = 'https://www.celsagroup.com',
       source_publisher = 'Celsa Group corporate + Recycling International',
       last_verified    = CURRENT_DATE
 WHERE name = 'Ferimet';

-- ── Step 3: Derichebourg — add US ops, scale up ───────────────────────

UPDATE scrap_offtakers
   SET countries        = ARRAY['FR','ES','DE','BE','PT','IT','PL','MA','CA','US','MX','CN','RO'],
       intake_capacity_kt_year = 5000,
       capacity_basis   = 'published',
       plant_count      = 14,
       plants           = '[
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
         {"city":"Toulouse","country":"FR"},
         {"city":"Houston","country":"US","specialty":"US Gulf operations"},
         {"city":"Oklahoma City","country":"US","specialty":"US Midcon operations"}
       ]'::jsonb,
       notes            = 'France''s largest scrap merchant; listed on Euronext Paris (DBG). Founded 1956. >5 Mt/yr scrap throughput, €3.3bn revenue. Operates across 13 countries including US (Houston + Oklahoma City). Parent of Lyrsa (acquired 2019/2020).',
       source_url       = 'https://www.derichebourg.com/en/group/profile/',
       source_publisher = 'Derichebourg annual report + corporate site',
       last_verified    = CURRENT_DATE
 WHERE name = 'Derichebourg';

-- ── Step 4: Kuusakoski — verified ~750 kt/yr ─────────────────────────

UPDATE scrap_offtakers
   SET intake_capacity_kt_year = 750,
       capacity_basis   = 'estimated',
       plant_count      = NULL,
       notes            = 'Finnish family-owned group, founded 1914. ~750 kt/yr (≈600 kt baseline + 150 kt Veitsiluoto plant commissioned 2025). Operates across Nordics (FI/SE/DK) + Baltics (EE/LT/LV) + Poland.',
       source_url       = 'https://www.kuusakoski.com/en/global/about-us/',
       source_publisher = 'Kuusakoski corporate + Recycling International',
       last_verified    = CURRENT_DATE
 WHERE name = 'Kuusakoski';

-- ── Step 5: HKS Scrap Metals — TSR Group parent ─────────────────────

UPDATE scrap_offtakers
   SET parent_company   = 'TSR Group (Germany) — Remondis Recycling',
       countries        = ARRAY['NL','BE'],
       plant_count      = 13,
       plants           = '[
         {"city":"Amersfoort","country":"NL","specialty":"Group HQ"},
         {"city":"s-Hertogenbosch","country":"NL"},
         {"city":"Amsterdam","country":"NL"},
         {"city":"Eindhoven","country":"NL"},
         {"city":"Rotterdam","country":"NL","specialty":"Major Continental port"},
         {"city":"Utrecht","country":"NL"},
         {"city":"Antwerp","country":"BE"},
         {"city":"Genk","country":"BE"}
       ]'::jsonb,
       notes            = 'Wholly-owned subsidiary of TSR Group (DE), itself part of Remondis. HQ Amersfoort (NL). 13 sites across NL + BE. Includes the Van Dalen Metals operations acquired by HKS.',
       source_url       = 'https://www.hksmetals.com/en/about-hks/',
       source_publisher = 'HKS corporate + TSR Group',
       last_verified    = CURRENT_DATE
 WHERE name = 'HKS Scrap Metals';

-- ── Step 6: Hammond Lane — 5 ROI + NI sites, Clearway parent ────────

UPDATE scrap_offtakers
   SET parent_company   = 'Clearway Disposal Ltd',
       countries        = ARRAY['IE','GB'],
       plant_count      = 8,
       plants           = '[
         {"city":"Dublin Ringsend","country":"IE","specialty":"Dublin port"},
         {"city":"Clondalkin","country":"IE","specialty":"Dublin metro"},
         {"city":"Athlone","country":"IE","specialty":"Midlands"},
         {"city":"Cork","country":"IE","specialty":"Southern Ireland"},
         {"city":"Sligo","country":"IE","specialty":"NW Ireland"},
         {"city":"Belfast","country":"GB","specialty":"Northern Ireland"},
         {"city":"Derry","country":"GB","specialty":"NI NW"},
         {"city":"Portadown","country":"GB","specialty":"NI ARM"}
       ]'::jsonb,
       notes            = 'Ireland''s leading metal recycler since 1898. Owned by Clearway Disposal Ltd. 5 ROI sites (Dublin Ringsend, Clondalkin, Athlone, Cork, Sligo) + 3 NI sites (Belfast, Derry, Portadown). All-island coverage.',
       source_url       = 'https://www.hammondlane.ie/locations/',
       source_publisher = 'Hammond Lane corporate + Clearway Disposal',
       last_verified    = CURRENT_DATE
 WHERE name = 'Hammond Lane';

-- ── Step 7: MGG — verified 850 kt/yr, Amstetten + Kematen ────────────

UPDATE scrap_offtakers
   SET intake_capacity_kt_year = 850,
       capacity_basis   = 'published',
       plant_count      = 2,
       plants           = '[
         {"city":"Amstetten","country":"AT","specialty":"Group HQ + main shredding"},
         {"city":"Kematen an der Ybbs","country":"AT","specialty":"Metran non-ferrous separation"}
       ]'::jsonb,
       notes            = 'Müller-Guttenbrunn Gruppe — Austrian family recycling group. ~850 kt/yr throughput. HQ Industriestraße 12, Amstetten. Metran subsidiary at Kematen handles non-ferrous separation. ELV + WEEE specialist.',
       source_url       = 'https://www.mgg-recycling.com/en/group/',
       source_publisher = 'MGG corporate site',
       last_verified    = CURRENT_DATE
 WHERE name = 'Müller-Guttenbrunn (MGG)';

-- ── Step 8: Lyrsa — re-attribute to Derichebourg parent ──────────────

UPDATE scrap_offtakers
   SET parent_company   = 'Derichebourg Environnement (acquired 2019/2020)',
       intake_capacity_kt_year = 1000,
       capacity_basis   = 'estimated',
       plant_count      = 18,
       notes            = 'Iberian operator founded 1939; acquired by Derichebourg Environnement in 2019/2020. ~1 Mt/yr scrap throughput (~160 kt/yr non-ferrous). 17 Spanish sites + 1 Portuguese (Lisbon). Now operationally integrated into Derichebourg group; functionally a Derichebourg subsidiary in Iberia.',
       source_url       = 'https://www.derichebourg.com/en/news/derichebourg-acquires-lyrsa/',
       source_publisher = 'Derichebourg corporate disclosures',
       last_verified    = CURRENT_DATE
 WHERE name = 'Lyrsa';

-- ── Step 9: Comet Traitements — verified large Belgian operator ──────

UPDATE scrap_offtakers
   SET intake_capacity_kt_year = 1200,
       capacity_basis   = 'published',
       plant_count      = 2,
       plants           = '[
         {"city":"Châtelet (Liège region)","country":"BE","specialty":"Comet Traitements — shredder residue treatment"},
         {"city":"Obourg","country":"BE","specialty":"COMETSAMBRE — main shredding (METSO LINDEMANN 7,000 hp / 300 t/h)"}
       ]'::jsonb,
       notes            = 'Belgian family-owned group of ~30 companies across BE + FR. Group shredder capacity 1.2 Mt/yr input (METSO LINDEMANN 7,000 hp / 300 t/h at Obourg). COMETSAMBRE handles ~800 kt/yr scrap supply — one of the largest steel-industry feed producers in BE. 98.4% valorisation rate published.',
       source_url       = 'https://www.cometgroup.be/?lang=en',
       source_publisher = 'Comet Group corporate + Recycling International',
       last_verified    = CURRENT_DATE
 WHERE name = 'Comet Traitements';

-- ── Step 10: Loacker Recycling — verified 25 companies / 47 sites / 8 countries ──

UPDATE scrap_offtakers
   SET countries        = ARRAY['AT','DE','IT','CZ','HU','SK','SI','HR'],
       plant_count      = 47,
       plants           = '[
         {"city":"Götzis","country":"AT","specialty":"Vorarlberg group HQ"},
         {"city":"Wonfurt","country":"DE","specialty":"Largest cable-reprocessing plant in DACH (~100 t/day)"}
       ]'::jsonb,
       notes            = 'Family-owned recycling group founded 1876, 5 generations. 25 companies across 47 sites in 8 countries. ~1,400 employees. Cable recycling specialist (Wonfurt plant ~100 t/day).',
       source_url       = 'https://loacker-recycling.com/at/',
       source_publisher = 'Loacker corporate + Recovery Magazine',
       last_verified    = CURRENT_DATE
 WHERE name = 'Loacker Recycling';

-- ── Step 11: Renewi (Van Gansewinkel) — Macquarie + BCI parent ───────

UPDATE scrap_offtakers
   SET parent_company   = 'Macquarie Group + BCI consortium (acquired June 2025; previously LSE: RWI / Euronext Amsterdam)',
       countries        = ARRAY['BE','NL','FR'],
       plant_count      = 3,
       plants           = '[
         {"city":"Antwerp","country":"BE","specialty":"Antwerp port operations"},
         {"city":"Eindhoven","country":"NL","specialty":"NL e-waste hub"},
         {"city":"Lyon","country":"FR","specialty":"FR e-waste plant"}
       ]'::jsonb,
       notes            = 'Largest recycling business in Benelux. Formed when Shanks acquired Van Gansewinkel (€432m) and rebranded Renewi in 2017. Delisted from LSE / Euronext Amsterdam June 2025 after acquisition by Macquarie + BCI consortium. Renewi E-Waste division operates WEEE plants in NL, BE, FR.',
       source_url       = 'https://www.renewi.com/en/about-us/',
       source_publisher = 'Renewi corporate + Sustainable Plastics + LSE disclosures',
       last_verified    = CURRENT_DATE
 WHERE name = 'Van Gansewinkel (Renewi)';

-- ── Step 12: Ambigroup — verified 12 units in PT + Seixal Ecopark ────

UPDATE scrap_offtakers
   SET plant_count      = 12,
       plants           = '[
         {"city":"Seixal Ecopark","country":"PT","specialty":"Shredding + metal separation lines (since 2012)"},
         {"city":"Pontinha (Lisboa)","country":"PT","specialty":"Group services HQ"},
         {"city":"Arrentela","country":"PT","specialty":"Plastics recycling"},
         {"city":"Porto","country":"PT","specialty":"Northern Portugal"}
       ]'::jsonb,
       notes            = 'Portuguese recycling group with 12 units across PT, >100,000 m² facilities, >500 employees, >€25m annual revenue. Seixal Ecopark (since 2012) is the main shredding + metal-separation site. Ambigroup Reciclagem SA covers metals + WEEE + ELV + plastics + metal packaging.',
       source_url       = 'https://www.ambigroup.com/en/business-areas/recycling/',
       source_publisher = 'Ambigroup corporate site',
       last_verified    = CURRENT_DATE
 WHERE name = 'Ambigroup';

-- ── Step 13: Enva — I Squared Capital parent (since April 2023) ──────

UPDATE scrap_offtakers
   SET parent_company   = 'I Squared Capital (acquired April 2023; previously DCC plc carve-out 2017)',
       countries        = ARRAY['IE','GB'],
       plant_count      = 2,
       plants           = '[
         {"city":"Dublin","country":"IE","specialty":"Eastern Ireland metals"},
         {"city":"Portadown","country":"GB","specialty":"NI metals (acquired site)"}
       ]'::jsonb,
       notes            = 'Irish-headquartered recycling/resource-recovery group. Created 2017 via carve-out of DCC plc Environmental Division. Acquired by I Squared Capital (US infrastructure PE) April 2023. Metals desk is one part of broader environmental services portfolio across IE + UK.',
       source_url       = 'https://enva.com/who-we-are/our-locations',
       source_publisher = 'Enva corporate + I Squared Capital + LetsRecycle',
       last_verified    = CURRENT_DATE
 WHERE name = 'Enva Metals';

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_059_scrap_offtakers_diligence_fixes', 'success', NOW(), NOW(),
  13,
  'Verified via corporate sites + Recycling International + Recycling Today + LetsRecycle + LSE disclosures + Sustainable Plastics + Recovery Magazine',
  'Migration 059 — diligence corrections to 12 EU operators added in Migration 058. Key fixes: flagged Unimetals as distressed (Oct 2025 administrator notice); re-classified Ferimet as integrated (Celsa parent); added Derichebourg US ops (Houston + OKC); re-attributed Lyrsa to Derichebourg (2019/2020 acquisition); HKS to TSR Group parent; Hammond Lane to 8 sites + Clearway parent (was 3 fabricated); MGG capacity 850 kt/yr verified; Loacker 47 sites / 8 countries verified; Renewi to new Macquarie+BCI owner; Comet 1.2 Mt/yr verified; Ambigroup 12 PT units verified; Enva to I Squared Capital. All updates carry source_url for analyst verification.'
);
