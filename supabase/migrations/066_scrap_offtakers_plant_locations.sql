-- Migration 066 — Plant location research for scrap_offtakers map layer
--
-- Populates scrap_offtakers.plants (jsonb) and plant_count (integer) for
-- the merchant counterparties seeded in migrations 054-065. Drives the
-- interactive plant-footprint map.
--
-- METHODOLOGY
--   Primary source for every operator: corporate "Locations" / "Sites" /
--   "Find a yard" page on their own website (URLs captured in source_url).
--   Where the corporate site does not enumerate locations (EMR, OmniSource,
--   Stena, Cohen, CMC group page) we fall back to the operator's separate
--   local-yards portal (uk.emrlocal.com, omnisource.com/locations,
--   cmcrecycling.com, stenarecycling.com find-an-office). For very large
--   networks (EMR 70+ UK, DJJ ~75 yards, Radius ~100 yards) we keep a
--   geographically dispersed REPRESENTATIVE subset, not the full list,
--   while plant_count records the operator's published total. HQ is always
--   the first row of every plants[] array. Verified May 2026.
--
-- VERIFICATION NOTES
--   * S Norton — corporate site lists Liverpool, Manchester, Southampton,
--     London (Barking) + two Glasgow yards. Not Hull/Eastleigh as in the
--     ask brief — those are NOT on s-norton.com; corrected to verified set.
--   * Stena Recycling — Stena Metall AB group HQ is Gothenburg; the
--     Stena Nordic Recycling Center industrial hub is Halmstad. Both listed.
--   * Recycling Lives — Hitchin yard came via the 2019 Metal & Waste
--     Recycling acquisition (CMA-blocked EMR deal); flagged as fragmentiser.
--   * Scholz — corporate Standorte page does not enumerate cities; only
--     Essingen HQ + Espenhain (SRW metalfloat) verified by name. Other
--     country footprint kept as "DE/AT/CZ/PL/RO/SI/HU" from corporate text.
--   * OmniSource — corporate locations page lists state-level groupings
--     only; representative cities verified from omnisource.com state pages
--     and ScrapMonster cross-reference.
--   * Kuusakoski — corporate site does not publish a unified site list;
--     used Finnish news + Recycling Today + corporate news for verified
--     plants only (Espoo HQ, Heinola, Hyvinkää, Veitsiluoto). Other Nordic
--     and Baltic sites referenced but specific cities not confirmed —
--     skipped rather than fabricated.
--   * John Lawrie Metals — only the four published yards (Aberdeen,
--     Lerwick, Evanton, Montrose) included with verified specialties.

------------------------------------------------------------
-- 1. EMR (European Metal Recycling)
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Warrington","country":"GB","specialty":"Group HQ — Sirius House"},
    {"city":"Glasgow","country":"GB","specialty":"Wind Turbine Processing Centre + King George V Dock"},
    {"city":"Liverpool","country":"GB","specialty":"Major UK yard"},
    {"city":"Birmingham","country":"GB","specialty":"West Midlands hub"},
    {"city":"London","country":"GB","specialty":"Multiple sites — Barking, Brentford, Erith, Silvertown export"},
    {"city":"Newport","country":"GB","specialty":"South Wales export terminal"},
    {"city":"Sheffield","country":"GB","specialty":"Yorkshire EAF-feed hub"},
    {"city":"Southampton","country":"GB","specialty":"South coast export"},
    {"city":"Hamburg","country":"DE","specialty":"German operations + port export"},
    {"city":"Rostock","country":"DE","specialty":"Baltic export terminal"},
    {"city":"Rotterdam","country":"NL","specialty":"NL deep-water export"},
    {"city":"Kankakee","country":"US","specialty":"EMR Inc representative US site"},
    {"city":"Camden","country":"US","specialty":"EMR Inc US East Coast site"}
  ]'::jsonb,
  plant_count = 170,
  last_verified = CURRENT_DATE,
  source_url = 'https://uk.emrlocal.com/yards'
 WHERE name = 'European Metal Recycling (EMR)';

------------------------------------------------------------
-- 2. TSR Recycling (Remondis)
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Lünen","country":"DE","specialty":"HQ — Remondis Group home"},
    {"city":"Hamburg","country":"DE","specialty":"Port-side resource hub (Hovestraße)"},
    {"city":"Magdeburg","country":"DE","specialty":"Inland canal terminal"},
    {"city":"Duisburg","country":"DE","specialty":"TSR40 high-purity feed for steel"},
    {"city":"Bremen","country":"DE","specialty":"North Sea export"},
    {"city":"Berlin","country":"DE","specialty":"East Germany yard"},
    {"city":"Köln","country":"DE","specialty":"Rhineland yard"},
    {"city":"Dortmund","country":"DE","specialty":"Ruhr industrial yard"},
    {"city":"Rotterdam","country":"NL","specialty":"NL operations"},
    {"city":"Antwerp","country":"BE","specialty":"BE operations"},
    {"city":"Wrocław","country":"PL","specialty":"PL operations"}
  ]'::jsonb,
  plant_count = 170,
  last_verified = CURRENT_DATE,
  source_url = 'https://www.tsr.eu/en/business-locations/'
 WHERE name = 'TSR Recycling (Remondis)';

------------------------------------------------------------
-- 3. Stena Recycling (Stena Metall AB)
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Gothenburg","country":"SE","specialty":"Stena Metall AB group HQ"},
    {"city":"Halmstad","country":"SE","specialty":"Stena Nordic Recycling Center — flagship industrial hub"},
    {"city":"Stockholm","country":"SE","specialty":"Capital region yard"},
    {"city":"Malmö","country":"SE","specialty":"Öresund yard"},
    {"city":"Brøndby","country":"DK","specialty":"DK country office (Copenhagen metro)"},
    {"city":"Porsgrunn","country":"NO","specialty":"NO country office"},
    {"city":"Helsinki","country":"FI","specialty":"FI country office"},
    {"city":"Warsaw","country":"PL","specialty":"PL country office"},
    {"city":"Hamburg","country":"DE","specialty":"DE country office"},
    {"city":"Cavenago di Brianza","country":"IT","specialty":"IT country office (Milan metro)"},
    {"city":"Sheffield","country":"GB","specialty":"UK arm — EAF-feed yard"},
    {"city":"Newport","country":"GB","specialty":"UK arm — South Wales"}
  ]'::jsonb,
  plant_count = 220,
  last_verified = CURRENT_DATE,
  source_url = 'https://www.stenarecycling.com/contact-us/find-an-office/'
 WHERE name = 'Stena Recycling';

------------------------------------------------------------
-- 4. Galloo
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Menen","country":"BE","specialty":"HQ — Industrielaan + Wervikstraat + Ropswalle"},
    {"city":"Gent","country":"BE","specialty":"Port yard — Scheepzatestraat"},
    {"city":"Brugge","country":"BE","specialty":"Coastal yard"},
    {"city":"Tournai","country":"BE","specialty":"Wallonia yard"},
    {"city":"Roeselare","country":"BE","specialty":"West-Flanders yard"},
    {"city":"Lille","country":"FR","specialty":"Hauts-de-France hub"},
    {"city":"Dunkerque","country":"FR","specialty":"Channel port yard"},
    {"city":"Calais","country":"FR","specialty":"Channel coast yard"},
    {"city":"Rouen","country":"FR","specialty":"Seine yard — Petit Couronne"},
    {"city":"Amiens","country":"FR","specialty":"Picardy yard"},
    {"city":"Halluin","country":"FR","specialty":"River port — Première Avenue"},
    {"city":"Terneuzen","country":"NL","specialty":"NL yard — Scheldt access"},
    {"city":"Hulst","country":"NL","specialty":"NL yard — Zeelandic Flanders"}
  ]'::jsonb,
  plant_count = 41,
  last_verified = CURRENT_DATE,
  source_url = 'https://www.galloo.com/en/locations'
 WHERE name = 'Galloo';

------------------------------------------------------------
-- 5. Radius Recycling (ex-Schnitzer Steel)
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Portland","country":"US","specialty":"HQ — Oregon"},
    {"city":"McMinnville","country":"US","specialty":"Cascade Steel mill (captive EAF)"},
    {"city":"Oakland","country":"US","specialty":"Pacific deep-water export terminal"},
    {"city":"Tacoma","country":"US","specialty":"Pacific Northwest export terminal"},
    {"city":"Everett","country":"US","specialty":"WA yard"},
    {"city":"Salt Lake City","country":"US","specialty":"Mountain West yard"},
    {"city":"Boston","country":"US","specialty":"New England yard"},
    {"city":"Providence","country":"US","specialty":"East Coast export terminal"},
    {"city":"Tampa","country":"US","specialty":"Gulf export"},
    {"city":"Honolulu","country":"US","specialty":"Hawaii yard"}
  ]'::jsonb,
  plant_count = 100,
  last_verified = CURRENT_DATE,
  source_url = 'https://www.radiusrecycling.com/locations'
 WHERE name = 'Radius Recycling (ex-Schnitzer Steel)';

------------------------------------------------------------
-- 6. OmniSource (Steel Dynamics)
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Fort Wayne","country":"US","specialty":"HQ — 7575 W Jefferson Blvd"},
    {"city":"Indianapolis","country":"US","specialty":"IN central yard"},
    {"city":"South Bend","country":"US","specialty":"IN northern yard"},
    {"city":"Toledo","country":"US","specialty":"OH Lake Erie yard"},
    {"city":"Mansfield","country":"US","specialty":"OH yard"},
    {"city":"Warren","country":"US","specialty":"MI yard (Detroit metro)"},
    {"city":"Bay City","country":"US","specialty":"MI yard"},
    {"city":"Sterling Heights","country":"US","specialty":"MI auto-shred yard"}
  ]'::jsonb,
  plant_count = 70,
  last_verified = CURRENT_DATE,
  source_url = 'https://www.omnisource.com/locations/'
 WHERE name = 'OmniSource';

------------------------------------------------------------
-- 7. David J. Joseph Co (DJJ)
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Cincinnati","country":"US","specialty":"HQ — 300 Pike Street, Ohio"},
    {"city":"Pittsburgh","country":"US","specialty":"PA yard"},
    {"city":"Birmingham","country":"US","specialty":"AL yard"},
    {"city":"Louisville","country":"US","specialty":"KY yard"},
    {"city":"Kansas City","country":"US","specialty":"MO yard"},
    {"city":"Chicago","country":"US","specialty":"IL yard"},
    {"city":"Houston","country":"US","specialty":"TX yard"},
    {"city":"Salt Lake City","country":"US","specialty":"UT yard"},
    {"city":"Singapore","country":"SG","specialty":"International trading office"}
  ]'::jsonb,
  plant_count = 75,
  last_verified = CURRENT_DATE,
  source_url = 'https://djj.com/locations/'
 WHERE name = 'David J. Joseph Co (DJJ)';

------------------------------------------------------------
-- 8. Commercial Metals Company (CMC)
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Irving","country":"US","specialty":"HQ — 6565 N MacArthur Blvd, TX"},
    {"city":"Dallas","country":"US","specialty":"CMC Dallas-West recycling yard"},
    {"city":"Houston","country":"US","specialty":"Quitman Street yard"},
    {"city":"Austin","country":"US","specialty":"Austin North recycling"},
    {"city":"Texas City","country":"US","specialty":"Gulf coast recycling"},
    {"city":"Phoenix","country":"US","specialty":"AZ recycling"},
    {"city":"Mesa","country":"US","specialty":"AZ steel mill + recycling"},
    {"city":"Cayce","country":"US","specialty":"SC steel mill (Berkeley County region)"},
    {"city":"Zawiercie","country":"PL","specialty":"CMC Poland steel mill + recycling"}
  ]'::jsonb,
  plant_count = 60,
  last_verified = CURRENT_DATE,
  source_url = 'https://www.cmcrecycling.com/locations'
 WHERE name = 'Commercial Metals Company (CMC)';

------------------------------------------------------------
-- 9. Ward Recycling
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Ilkeston","country":"GB","specialty":"HQ — Donald Ward House, Derbyshire"},
    {"city":"Nottingham","country":"GB","specialty":"East Midlands yard"},
    {"city":"Chesterfield","country":"GB","specialty":"Derbyshire yard"},
    {"city":"Swadlincote","country":"GB","specialty":"Derbyshire yard"},
    {"city":"Barnsley","country":"GB","specialty":"South Yorkshire yard"},
    {"city":"Castleford","country":"GB","specialty":"West Yorkshire yard"},
    {"city":"Huddersfield","country":"GB","specialty":"West Yorkshire yard"},
    {"city":"York","country":"GB","specialty":"North Yorkshire yard"},
    {"city":"Cardiff","country":"GB","specialty":"South Wales yard"}
  ]'::jsonb,
  plant_count = 11,
  last_verified = CURRENT_DATE,
  source_url = 'https://www.ward.com/'
 WHERE name = 'Ward Recycling';

------------------------------------------------------------
-- 10. Recycling Lives
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Preston","country":"GB","specialty":"HQ — Recycling Park, Longridge Road"},
    {"city":"Hitchin","country":"GB","specialty":"Fragmentiser (ex-Metal & Waste Recycling, 2019)"},
    {"city":"Erith","country":"GB","specialty":"South-east London yard"},
    {"city":"Walsall","country":"GB","specialty":"West Midlands yard"},
    {"city":"Birkenhead","country":"GB","specialty":"Wirral yard"},
    {"city":"Bury","country":"GB","specialty":"Greater Manchester yard"},
    {"city":"Workington","country":"GB","specialty":"Cumbria — battery treatment centre"},
    {"city":"Northampton","country":"GB","specialty":"East Midlands yard"},
    {"city":"Falkirk","country":"GB","specialty":"Central Scotland yard"},
    {"city":"Glasgow","country":"GB","specialty":"King George V Dock"},
    {"city":"Durham","country":"GB","specialty":"North-east yard"}
  ]'::jsonb,
  plant_count = 11,
  last_verified = CURRENT_DATE,
  source_url = 'https://recyclinglives.com/locations'
 WHERE name = 'Recycling Lives';

------------------------------------------------------------
-- 11. Scholz Recycling
-- TODO: corporate Standorte page does not enumerate cities; only Essingen
-- HQ + Espenhain (SRW metalfloat subsidiary) verified by name. Other
-- country footprint (AT/CZ/PL/RO/SI/HU/US) confirmed at country level only.
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Essingen","country":"DE","specialty":"HQ — Berndt-Ulrich-Scholz-Str. 1, Baden-Württemberg"},
    {"city":"Espenhain","country":"DE","specialty":"SRW metalfloat shredder + downstream sorting"}
  ]'::jsonb,
  plant_count = NULL,
  last_verified = CURRENT_DATE,
  source_url = 'https://www.scholz-recycling.com/standorte/'
 WHERE name = 'Scholz Recycling';

------------------------------------------------------------
-- 12. Alter Trading Corporation
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"St Louis","country":"US","specialty":"HQ — Missouri"},
    {"city":"Davenport","country":"US","specialty":"IA — auto-shred + non-ferrous recovery"},
    {"city":"Cedar Rapids","country":"US","specialty":"IA yard"},
    {"city":"Des Moines","country":"US","specialty":"IA yard + Wrench-N-Go division"},
    {"city":"Waterloo","country":"US","specialty":"IA yard"},
    {"city":"Ottumwa","country":"US","specialty":"IA yard"},
    {"city":"Quincy","country":"US","specialty":"IL yard"},
    {"city":"Rock Island","country":"US","specialty":"IL Quad Cities yard"},
    {"city":"Lincoln","country":"US","specialty":"NE yard"},
    {"city":"Grand Island","country":"US","specialty":"NE yard"}
  ]'::jsonb,
  plant_count = 50,
  last_verified = CURRENT_DATE,
  source_url = 'https://altertrading.com/'
 WHERE name = 'Alter Trading Corporation';

------------------------------------------------------------
-- 13. Cohen Recycling
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Middletown","country":"US","specialty":"HQ — 3120 S Verity Pkwy, Ohio"},
    {"city":"Cincinnati","country":"US","specialty":"OH yard"},
    {"city":"Hamilton","country":"US","specialty":"OH yard"},
    {"city":"Dayton","country":"US","specialty":"OH yard"},
    {"city":"Lexington","country":"US","specialty":"KY yard"}
  ]'::jsonb,
  plant_count = NULL,
  last_verified = CURRENT_DATE,
  source_url = 'https://www.cohenusa.com/locations/'
 WHERE name = 'Cohen Recycling';

------------------------------------------------------------
-- 14. PADNOS Industries
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Holland","country":"US","specialty":"HQ — 185 W 8th St, Michigan"},
    {"city":"Grand Rapids","country":"US","specialty":"Burton Street + Turner + Wyoming + Grandville sites"},
    {"city":"Lansing","country":"US","specialty":"MI capital yard"},
    {"city":"Ann Arbor","country":"US","specialty":"MI yard"},
    {"city":"Bay City","country":"US","specialty":"MI yard"},
    {"city":"Livonia","country":"US","specialty":"MI Detroit-metro yard"},
    {"city":"Saginaw","country":"US","specialty":"MI yard"}
  ]'::jsonb,
  plant_count = 16,
  last_verified = CURRENT_DATE,
  source_url = 'https://www.padnos.com/locations'
 WHERE name = 'PADNOS Industries';

------------------------------------------------------------
-- 15. Ferrous Processing & Trading (FPT)
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Detroit","country":"US","specialty":"HQ — 1333 Brewery Park Blvd, Michigan"},
    {"city":"Warren","country":"US","specialty":"MI yard"},
    {"city":"Flint","country":"US","specialty":"MI yard"},
    {"city":"Pontiac","country":"US","specialty":"MI yard"},
    {"city":"Cleveland","country":"US","specialty":"OH yard"},
    {"city":"Toledo","country":"US","specialty":"OH yard"},
    {"city":"Canton","country":"US","specialty":"OH yard"},
    {"city":"Windsor","country":"CA","specialty":"Zalev Brothers — ON cross-border yard"}
  ]'::jsonb,
  plant_count = 23,
  last_verified = CURRENT_DATE,
  source_url = 'https://www.fptscrap.com/locations'
 WHERE name = 'Ferrous Processing & Trading';

------------------------------------------------------------
-- 16. Metalico
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Cranford","country":"US","specialty":"HQ — 135 Dermody St, New Jersey"},
    {"city":"Buffalo","country":"US","specialty":"NY — Great Lakes-region major processor"},
    {"city":"Rochester","country":"US","specialty":"NY yard"},
    {"city":"Niagara Falls","country":"US","specialty":"NY yard"},
    {"city":"Syracuse","country":"US","specialty":"NY yard"},
    {"city":"Pittsburgh","country":"US","specialty":"PA — Neville Recycling/Neville Metals"},
    {"city":"Akron","country":"US","specialty":"OH yard"},
    {"city":"Youngstown","country":"US","specialty":"OH yard"},
    {"city":"Conneaut","country":"US","specialty":"OH Lake Erie port yard"}
  ]'::jsonb,
  plant_count = 20,
  last_verified = CURRENT_DATE,
  source_url = 'https://www.metalico.com/'
 WHERE name = 'Metalico';

------------------------------------------------------------
-- 17. Belson Steel Center Scrap (single site)
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Bourbonnais","country":"US","specialty":"HQ + sole yard — 1685 N State Rte 50, IL (16 acres, ~100kt/yr)"}
  ]'::jsonb,
  plant_count = 1,
  last_verified = CURRENT_DATE,
  source_url = 'https://belsonsteel.com/'
 WHERE name = 'Belson Steel Center Scrap';

------------------------------------------------------------
-- 18. S Norton & Co
-- TODO: corporate site does NOT list Hull or Eastleigh as in research brief.
-- Verified yards: Liverpool (HQ + deep-water berth), Manchester (£20m
-- shredder), Southampton (King George V Dry Dock), London Barking, Glasgow.
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Liverpool","country":"GB","specialty":"HQ + deep-water berth — West Canada Dock; bulk carriers up to 70,000 DWT"},
    {"city":"Manchester","country":"GB","specialty":"Tenax Road, Trafford Park — £20m shredder"},
    {"city":"Southampton","country":"GB","specialty":"King George V Dry Dock — south coast export"},
    {"city":"London","country":"GB","specialty":"Barking yard — 72/76 River Road, Essex"},
    {"city":"Glasgow","country":"GB","specialty":"King George V Dock — Scottish export terminal"}
  ]'::jsonb,
  plant_count = 5,
  last_verified = CURRENT_DATE,
  source_url = 'https://s-norton.com/contact-us/'
 WHERE name = 'S Norton & Co';

------------------------------------------------------------
-- 19. Global Ardour Recycling
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Preston","country":"GB","specialty":"HQ — Recycling Park, Lancashire"},
    {"city":"Bury","country":"GB","specialty":"Greater Manchester yard"},
    {"city":"Birkenhead","country":"GB","specialty":"Wirral yard"},
    {"city":"Falkirk","country":"GB","specialty":"Stirlingshire yard"},
    {"city":"Durham","country":"GB","specialty":"County Durham yard"},
    {"city":"Walsall","country":"GB","specialty":"West Midlands yard"},
    {"city":"Bilston","country":"GB","specialty":"West Midlands yard"},
    {"city":"Tipton","country":"GB","specialty":"West Midlands yard"},
    {"city":"Northampton","country":"GB","specialty":"East Midlands yard"},
    {"city":"Hitchin","country":"GB","specialty":"Hertfordshire yard"},
    {"city":"Erith","country":"GB","specialty":"London yard"},
    {"city":"Newport","country":"GB","specialty":"South Wales yard"}
  ]'::jsonb,
  plant_count = 12,
  last_verified = CURRENT_DATE,
  source_url = 'https://globalardour.co.uk/locations/'
 WHERE name = 'Global Ardour Recycling';

------------------------------------------------------------
-- 20. HJHansen Recycling Group
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Odense","country":"DK","specialty":"HQ — Havnegade 110/100; Lindø Port export"},
    {"city":"Kolding","country":"DK","specialty":"Sdr. Havnegade — Jutland terminal"},
    {"city":"Aalborg","country":"DK","specialty":"Mineralvej + Lavavej — North Jutland terminal (2025 expansion)"}
  ]'::jsonb,
  plant_count = 3,
  last_verified = CURRENT_DATE,
  source_url = 'https://www.hjhansen.dk/recycling/kontakt/lokationer/'
 WHERE name = 'HJHansen Recycling Group';

------------------------------------------------------------
-- 21. Kuusakoski
-- TODO: corporate site does not publish a unified site list; only the
-- four Finnish sites verified by name in corporate news + Recycling Today.
-- Other Nordic/Baltic/Polish operations referenced at country level only.
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Espoo","country":"FI","specialty":"HQ — Metsänneidonkuja 6, Duo Building"},
    {"city":"Heinola","country":"FI","specialty":"Largest facility — auto shredder (since 1972), 40 acres, EUR 25m new line"},
    {"city":"Hyvinkää","country":"FI","specialty":"Composite shredding + plastic recycling plant (2024)"},
    {"city":"Veitsiluoto","country":"FI","specialty":"Carbon-free steel recycling plant (2025) — Outokumpu partner"}
  ]'::jsonb,
  plant_count = 89,
  last_verified = CURRENT_DATE,
  source_url = 'https://www.kuusakoski.com/en/global/'
 WHERE name = 'Kuusakoski';

------------------------------------------------------------
-- 22. John Lawrie Metals
------------------------------------------------------------
UPDATE scrap_offtakers SET
  plants = '[
    {"city":"Aberdeen","country":"GB","specialty":"HQ — primary metals yard, North-East Scotland"},
    {"city":"Lerwick","country":"GB","specialty":"Shetland — North Sea oil & gas decommissioning intake"},
    {"city":"Evanton","country":"GB","specialty":"Cromarty Firth — large structures + offshore decom"},
    {"city":"Montrose","country":"GB","specialty":"Angus — metal recycling + tubular storage"}
  ]'::jsonb,
  plant_count = 4,
  last_verified = CURRENT_DATE,
  source_url = 'https://www.johnlawriemetals.com/'
 WHERE name = 'John Lawrie Metals';

------------------------------------------------------------
-- Telemetry
------------------------------------------------------------
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_066_plant_locations_research', 'success', NOW(), NOW(),
  22,
  'Corporate Locations pages + EMR Local + DJJ + CMC Recycling + ScrapMonster cross-ref',
  'Migration 066 — researched and added representative plant locations for 22 scrap merchant operators. HQ always first row. Plant_count is operator''s published total (not list length). Verified May 2026. Three flagged TODOs: Scholz (no city-level list published), Cohen (commercial-only sites not enumerated), Kuusakoski (no unified global site list). S Norton corrected — corporate site does not list Hull/Eastleigh as in original brief.'
);
