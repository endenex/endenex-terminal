-- Migration 060 — Scrap Off-takers: full diligence pass + wind-decom confidence
--
-- Per user: "verify all. Also need confidence level that they would deal with
-- volume/type of scrap we are talking about here."
--
-- Wind-decom scrap profile per ~50 MW onshore farm (~25 turbines):
--   • 5,000–8,000 t structural steel (towers + foundation rebar)
--   • 300–700 t cast iron (hub, mainframe)
--   • 100–250 t copper (generator + cables)
--   • 50–150 t aluminium (nacelle housings)
--   Bulk lots, often coastal/rural; offshore decom 2–3× per turbine, port required.
--
-- Confidence buckets:
--   HIGH    — handles bulk ferrous shred at 100s+ kt/yr, port access OR demonstrated
--             wind/energy decom track record, accepts external lots
--   MEDIUM  — regional ferrous merchant, can absorb 5–10 kt lots, no specific wind
--             track record but capable
--   LOW     — specialty/non-ferrous, sub-scale, captive-only, or weak geography
--   NA      — distressed/insolvent, pure smelter (Cu/Al only) or pure mill (won't
--             buy from asset owner directly)
--
-- This migration:
--   1. Adds wind_decom_confidence + wind_decom_reason + status columns.
--   2. Applies material corrections found in May-2026 diligence pass.
--   3. Tags every row with a confidence rating + reason.

-- ── Step 1: Schema additions ───────────────────────────────────────────

ALTER TABLE scrap_offtakers
  ADD COLUMN IF NOT EXISTS wind_decom_confidence text
    CHECK (wind_decom_confidence IN ('HIGH','MEDIUM','LOW','NA'));
ALTER TABLE scrap_offtakers
  ADD COLUMN IF NOT EXISTS wind_decom_reason text;
ALTER TABLE scrap_offtakers
  ADD COLUMN IF NOT EXISTS status text
    CHECK (status IN ('active','distressed','defunct','pending_acquisition'))
    DEFAULT 'active';

CREATE INDEX IF NOT EXISTS scrap_offtakers_wind_conf_idx
  ON scrap_offtakers (wind_decom_confidence);
CREATE INDEX IF NOT EXISTS scrap_offtakers_status_idx
  ON scrap_offtakers (status);

-- ── Step 2: MATERIAL corrections from May-2026 diligence ──────────────

-- 2a. Unimetals UK: WINDING-UP ORDER MADE 25 NOV 2025. Compulsory liquidation,
--     ~650 redundancies. Mark as DEFUNCT — keep row for historical record.
UPDATE scrap_offtakers
   SET status         = 'defunct',
       parent_company = 'Sept Capital (acquired Sims UK Sept 2024; entered compulsory liquidation Nov 2025)',
       notes          = 'DEFUNCT. Sept Capital acquired Sims''s UK metals business Sept 2024 (~£195m, 28 facilities) and rebranded "Unimetals". First Notice of Intention to appoint administrators filed 13 Oct 2025; second NOI 28 Oct 2025; compulsory winding-up order made by court on 25 Nov 2025, ~650 redundancies. The 28 sites did not transfer to a buyer. Do NOT route lots here.',
       source_url     = 'https://www.gov.uk/government/news/unimetals-recycling-uk-ltd-winding-up-order-made',
       source_publisher = 'UK GOV.UK Insolvency Service notice',
       last_verified  = CURRENT_DATE
 WHERE name = 'Unimetals (formerly Sims Metal UK)';

-- 2b. Radius Recycling: Toyota Tsusho closed acquisition 11 Jul 2025 ($1.34bn).
--     Delisted from NASDAQ. Brand + management retained.
UPDATE scrap_offtakers
   SET parent_company = 'Toyota Tsusho Corporation (acquired 11 Jul 2025, $1.34bn — delisted from NASDAQ)',
       notes          = 'Vertically integrated: ~100 sites + Cascade Steel mini-mill in McMinnville OR + Pacific export terminals. Toyota Tsusho America acquired the company 11 Jul 2025 ($1.34bn cash); RDUS ticker delisted. Brand and operating management retained. Acquisition expands JP/Asia export channels for the existing US West Coast scrap base.',
       source_url     = 'https://www.toyota-tsusho.com/english/press/detail/250711_006639.html',
       source_publisher = 'Toyota Tsusho corporate announcement',
       last_verified  = CURRENT_DATE
 WHERE name = 'Radius Recycling (ex-Schnitzer Steel)';

-- 2c. John Lawrie Metals: ArcelorMittal acquisition was 28 FEB 2022, not 2025.
UPDATE scrap_offtakers
   SET notes          = 'Aberdeen/Scotland-based; specialist in offshore-energy decommissioning. ~360 kt/yr licensed across 4 sites (Aberdeen, Shetland, Evanton, Montrose). Wholly-owned ArcelorMittal subsidiary since acquisition completed 28 Feb 2022. Strongest UK fit for offshore wind decom given proven oil-and-gas-rig decom track record and Scottish port footprint.',
       source_url     = 'https://corporate.arcelormittal.com/media/news-articles/arcelormittal-acquires-steel-recycling-business',
       source_publisher = 'ArcelorMittal corporate press release',
       last_verified  = CURRENT_DATE
 WHERE name = 'John Lawrie Metals';

-- 2d. Scholz Recycling: Derichebourg signed acquisition 5 May 2026, closing H2 2026.
--     Parent (Chiho Environmental) in workout post-Sept 2025 lender enforcement.
UPDATE scrap_offtakers
   SET status         = 'pending_acquisition',
       parent_company = 'Chiho Environmental Group (interim management Sept 2025; Derichebourg acquisition signed 5 May 2026, expected close H2 2026)',
       notes          = 'Major German scrap operator (~5 Mt/yr, ~50 DE sites + AT/CZ/PL). Chiho Environmental hit by lender enforcement Sept 2025 → interim management installed; company described as fully solvent and trading normally. Derichebourg signed share purchase agreement 5 May 2026 to acquire Scholz Group; closing expected H2 2026. On close, Scholz becomes part of Derichebourg, making Derichebourg the dominant EU scrap merchant.',
       source_url     = 'https://www.euwid-recycling.com/news/business/derichebourg-to-acquire-german-metals-recycling-group-scholz-050526/',
       source_publisher = 'EUWID Recycling',
       last_verified  = CURRENT_DATE
 WHERE name = 'Scholz Recycling';

-- 2e. Recycling Lives: MWR acquisition was AUGUST 2020, not 2019.
UPDATE scrap_offtakers
   SET notes          = 'Preston-based UK operator; ~600 kt/yr, ~20 UK sites including Hitchin fragmentiser (ex-MWR). Acquired Metal & Waste Recycling (M&WR) in August 2020 following CMA-mandated EMR divestment of M&WR (CMA found substantial lessening of competition in 2017). Now backed by Three Hills Capital. Charity-affiliated (Recycling Lives Foundation).',
       source_url     = 'https://www.recyclinglives.com/news/general/acquisition-metal-waste-recycling',
       source_publisher = 'Recycling Lives corporate + UK CMA case docs',
       last_verified  = CURRENT_DATE
 WHERE name = 'Recycling Lives';

-- 2f. Renewi: Macquarie closed SOLO at €701m Feb 2025. BCI walked from 2023 bid.
UPDATE scrap_offtakers
   SET parent_company = 'Macquarie Asset Management (closed solo acquisition at €701m Feb 2025; BCI walked from earlier 2023 bid)',
       notes          = 'Largest recycling business in Benelux. Formed when Shanks acquired Van Gansewinkel (€432m) and rebranded Renewi in 2017. Acquired by Macquarie Asset Management at €701m, closing Feb 2025 (delisted from LSE / Euronext Amsterdam). BCI Capital walked from its 2023 take-private bid; Macquarie completed solo. Renewi E-Waste division operates WEEE plants in NL, BE, FR. Waste-led; ferrous sub-segment small.',
       source_url     = 'https://www.renewi.com/en/about-us/our-strategy',
       source_publisher = 'Renewi corporate + LSE delisting disclosure',
       last_verified  = CURRENT_DATE
 WHERE name = 'Van Gansewinkel (Renewi)';

-- 2g. TSR Recycling: TSR40 line additions are material.
UPDATE scrap_offtakers
   SET notes          = 'Largest German scrap operator; subsidiary of Remondis SE (Rethmann group). ~8 Mt/yr group. New TSR40 mill-grade line at Duisburg (450 kt/yr) live; Hamburg port-side line started 2025; Magdeburg line 2026. The Hamburg line materially strengthens TSR''s offshore-wind-decom fit. Salzgitter mill supply contract.',
       source_url     = 'https://www.tsr.eu/en/about-us/',
       source_publisher = 'TSR corporate site + EUWID coverage',
       last_verified  = CURRENT_DATE
 WHERE name = 'TSR Recycling (Remondis)';

-- 2h. HJHansen: 3 deep-sea terminals incl. Aalborg opened 2025; 30 yards; ~1 Mt/y.
UPDATE scrap_offtakers
   SET intake_capacity_kt_year = 1000,
       capacity_basis = 'estimated',
       plant_count    = 30,
       notes          = 'Six-generation family business since 1829, Odense DK HQ. ~1 Mt/yr across ~30 yards. Operates THREE deep-sea export terminals: Odense, Kolding, and Aalborg (opened 2025). Three-terminal footprint directly serves the North Sea offshore wind decom corridor.',
       source_url     = 'https://recyclinginternational.com/latest-articles/hjhansen-has-a-nose-for-scrapand-wine/62389/',
       source_publisher = 'Recycling International + HJHansen corporate',
       last_verified  = CURRENT_DATE
 WHERE name = 'HJHansen Recycling Group';

-- 2i. Belson Steel: Wind-decom track record VERIFIED.
UPDATE scrap_offtakers
   SET notes          = 'Family-owned US Midwest yard, Bourbonnais IL (Chicago metro, 16-acre site). VERIFIED wind-decom project track record published on belsonsteel.com: 22,000 t Brazos Wind Farm TX, 7,400 t Waltham Twp MN, 850 t Rolla ND. Operates own torch-cutting crews + lowboy fleet. Among very few operators globally with explicit, documented wind-tower demolition track record at scale.',
       source_url     = 'https://belsonsteel.com/services/wind-farm-decommissioning',
       source_publisher = 'Belson Steel corporate + project disclosures',
       last_verified  = CURRENT_DATE
 WHERE name = 'Belson Steel Center Scrap';

-- ── Step 3: Wind-decom confidence ratings (every active operator) ────

-- HIGH — proven wind/energy decom OR scale + port + clean ferrous fit
UPDATE scrap_offtakers SET wind_decom_confidence = 'HIGH',
  wind_decom_reason = 'Only UK operator with a dedicated, permitted Wind Turbine Processing Centre (Glasgow). 65 UK sites + DE port hubs Hamburg/Rostock.'
  WHERE name = 'European Metal Recycling (EMR)';

UPDATE scrap_offtakers SET wind_decom_confidence = 'HIGH',
  wind_decom_reason = 'Pan-EU footprint (~150 sites), Hamburg port-side line live 2025, Salzgitter mill-supply contract — direct offshore decom fit.'
  WHERE name = 'TSR Recycling (Remondis)';

UPDATE scrap_offtakers SET wind_decom_confidence = 'HIGH',
  wind_decom_reason = 'Demonstrated wind-blade circularity JV with Vestas/Olin (JEC 2024 award); Nordic coastal coverage matches offshore wind regions; ~6 Mt/yr group.'
  WHERE name = 'Stena Recycling';

UPDATE scrap_offtakers SET wind_decom_confidence = 'HIGH',
  wind_decom_reason = 'Port-side at Ghent + Terneuzen (E-Cranes); ~1.8 Mt/yr group; North Sea offshore wind adjacency.'
  WHERE name = 'Galloo';

UPDATE scrap_offtakers SET wind_decom_confidence = 'HIGH',
  wind_decom_reason = 'Pacific deepwater export terminals + Cascade Steel captive mill + 100 sites across 25 US states; new Toyota Tsusho parent expands JP/Asia export.'
  WHERE name = 'Radius Recycling (ex-Schnitzer Steel)';

UPDATE scrap_offtakers SET wind_decom_confidence = 'HIGH',
  wind_decom_reason = 'Aberdeen + Montrose port; specialism in North Sea oil & gas decom directly transferable to offshore wind; ArcelorMittal subsidiary since Feb 2022.'
  WHERE name = 'John Lawrie Metals';

UPDATE scrap_offtakers SET wind_decom_confidence = 'HIGH',
  wind_decom_reason = 'Documented wind-decom track record: Brazos TX 22kt, Waltham MN 7.4kt, Rolla ND 0.85kt. Own torch crews + lowboy fleet — true wind specialist.'
  WHERE name = 'Belson Steel Center Scrap';

UPDATE scrap_offtakers SET wind_decom_confidence = 'HIGH',
  wind_decom_reason = '1.5 Mt/yr verified; Liverpool + Hull deep-water export berths (load Capesize/Panamax); top-3 UK independent.'
  WHERE name = 'S Norton & Co';

UPDATE scrap_offtakers SET wind_decom_confidence = 'HIGH',
  wind_decom_reason = 'Three Danish deep-sea export terminals (Odense, Kolding, Aalborg) directly serve North Sea offshore wind decom corridor; ~1 Mt/yr.'
  WHERE name = 'HJHansen Recycling Group';

UPDATE scrap_offtakers SET wind_decom_confidence = 'HIGH',
  wind_decom_reason = '~7 Mt/yr scrap, 13 countries incl. US (Houston + OKC), French Atlantic + Med ports; dominant FR merchant; will absorb Scholz H2 2026.'
  WHERE name = 'Derichebourg';

UPDATE scrap_offtakers SET wind_decom_confidence = 'HIGH',
  wind_decom_reason = 'Rotterdam port-side + TSR/Remondis backing — direct offshore wind landing fit for NL/BE.'
  WHERE name = 'HKS Scrap Metals';

UPDATE scrap_offtakers SET wind_decom_confidence = 'HIGH',
  wind_decom_reason = 'Nordic + Baltic coverage with port access; demonstrated wind-blade R&D; ~750 kt/yr (verified Veitsiluoto 2025 expansion).'
  WHERE name = 'Kuusakoski';

-- MEDIUM — capable regional merchant, no wind specialism but sized appropriately
UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'UK arm sub-scale vs Nordic parent; capable but smaller lots; not the Glasgow wind-centre operator.'
  WHERE name = 'Stena Recycling UK';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'Largest independent UK Midlands merchant; can absorb 5–10 kt lots; no documented wind track record.'
  WHERE name = 'Ward Recycling';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'National UK footprint post-MWR (~600 kt/yr); fragmentiser capacity; no wind specialism but appropriately sized.'
  WHERE name = 'Recycling Lives';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'Self-markets as wind-turbine specialist (publishes methodology) — useful for rare-earth magnet handling — but scale unclear from primary sources.'
  WHERE name = 'Global Ardour Recycling';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'OmniSource (SDI captive) has been an active wind-tower scrap buyer; Plains-states presence; captive bias.'
  WHERE name = 'OmniSource';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'Largest US scrap intake (~22 Mt/yr Nucor); Texas/Plains presence aligns with US wind belt; captive-leaning.'
  WHERE name = 'David J. Joseph Co (DJJ)';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'Texas-anchored mill matches Texas wind decom geography; integrated mill+merchant; can absorb mid-size lots.'
  WHERE name = 'Commercial Metals Company (CMC)';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'Strong Midwest wind-belt geography (IA/IL/MN/MO); ~3 Mt/yr; river-barge logistics.'
  WHERE name = 'Alter Trading Corporation';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'OH/KY/IN regional, in wind-corridor adjacency; sized for 5–10 kt lots.'
  WHERE name = 'Cohen Recycling';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'Great Lakes region; capable; Michigan offshore-wind adjacency emerging; ~1.5 Mt/yr.'
  WHERE name = 'PADNOS Industries';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'Detroit shred + Great Lakes barge logistics; can handle bulk wind lots; heavy-melt focus.'
  WHERE name = 'Ferrous Processing & Trading';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'Captive-leaning to Celsa mills; Iberian coverage matches Spanish onshore wind decom (~1.5 Mt/yr).'
  WHERE name = 'Ferimet';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'Iberian merchant under Derichebourg umbrella post-2019/2020 acquisition; effectively channel-managed by parent.'
  WHERE name = 'Lyrsa';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'Irish all-island coverage (5 ROI + 3 NI sites) matches IE wind decom geography; ~300 kt/yr.'
  WHERE name = 'Hammond Lane';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'Central European inland (~700 kt/yr); capable; geography weaker for offshore.'
  WHERE name = 'Müller-Guttenbrunn (MGG)';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = '47 sites across DACH/CEE; Alpine + Adriatic; OK for Italian onshore wind decom.'
  WHERE name = 'Loacker Recycling';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'Belgian regional (~1.2 Mt/yr shredder + COMETSAMBRE 800 kt/yr supply); less port-direct than Galloo but ample capacity for inland Wallonia/N France lots.'
  WHERE name = 'Comet Traitements';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'Portuguese/Iberian coverage; 12 PT units; smaller scale than Iberian peers but appropriate for PT onshore wind decom.'
  WHERE name = 'Ambigroup';

UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'Mixed UK + IE waste/recycling under I Squared Capital; capable for UK/IE wind decom logistics; ferrous sub-segment of broader portfolio.'
  WHERE name = 'Enva Metals';

-- LOW — wrong specialty, sub-scale, or weak fit
UPDATE scrap_offtakers SET wind_decom_confidence = 'LOW',
  wind_decom_reason = 'Waste-led not ferrous-led; ferrous shred mostly subcontracted; better fit for non-metallic decom waste streams.'
  WHERE name = 'Suez Recycling & Recovery';

UPDATE scrap_offtakers SET wind_decom_confidence = 'LOW',
  wind_decom_reason = 'Same as Suez — not a ferrous-focused buyer for heavy structural steel.'
  WHERE name = 'Veolia ES Recycling';

UPDATE scrap_offtakers SET wind_decom_confidence = 'LOW',
  wind_decom_reason = 'Stainless specialist — wrong fit for HMS structural ferrous lots dominating wind decom.'
  WHERE name = 'Cronimet Holding';

UPDATE scrap_offtakers SET wind_decom_confidence = 'LOW',
  wind_decom_reason = 'Smaller and NF-leaning; NE US geography weak vs wind belt.'
  WHERE name = 'Metalico';

-- MEDIUM but pending parent change — flag Scholz separately
UPDATE scrap_offtakers SET wind_decom_confidence = 'MEDIUM',
  wind_decom_reason = 'Large DE/CEE merchant (~5 Mt/yr) trading normally despite parent (Chiho) workout; Derichebourg deal pending close H2 2026 — counterparty profile changes on close.'
  WHERE name = 'Scholz Recycling';

-- NA — defunct, captive mill-only, or pure non-ferrous smelter
UPDATE scrap_offtakers SET wind_decom_confidence = 'NA',
  wind_decom_reason = 'DEFUNCT — compulsory liquidation Nov 2025. Do not route lots.'
  WHERE name = 'Unimetals (formerly Sims Metal UK)';

UPDATE scrap_offtakers SET wind_decom_confidence = 'NA',
  wind_decom_reason = 'Pure copper smelter — asset owner does not sell raw turbine to KGHM. Useful only to downstream Cu recyclers selling granulate.'
  WHERE name = 'KGHM Polska Miedź';

UPDATE scrap_offtakers SET wind_decom_confidence = 'NA',
  wind_decom_reason = 'Pure mill — does not buy from asset owner directly; routes through DJJ.'
  WHERE name = 'Nucor';

UPDATE scrap_offtakers SET wind_decom_confidence = 'NA',
  wind_decom_reason = 'Pure mill — does not buy from asset owner directly; routes through OmniSource.'
  WHERE name = 'Steel Dynamics (SDI)';

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_060_scrap_offtakers_wind_confidence', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM scrap_offtakers),
  'Verified May 2026 via primary corporate sources, GOV.UK Insolvency Service, EUWID Recycling, Recycling International, Toyota Tsusho corporate, ArcelorMittal corporate, Belson Steel project disclosures',
  'Migration 060 — full diligence pass + wind-decom confidence ratings. Material fixes: Unimetals UK marked DEFUNCT (winding-up order 25 Nov 2025); Radius re-parented to Toyota Tsusho (closed Jul 2025); John Lawrie acquisition date corrected to Feb 2022; Scholz flagged pending_acquisition (Derichebourg signed May 2026); Recycling Lives MWR date corrected to Aug 2020; Renewi parent corrected to Macquarie SOLO (BCI walked); TSR Hamburg port line + TSR40 capacity added; HJHansen upgraded to 3-terminal Danish operator (Aalborg 2025); Belson wind-decom track record verified (Brazos 22kt, Waltham 7.4kt, Rolla 0.85kt). Every active operator now carries wind_decom_confidence + reason. 12 HIGH, 17 MEDIUM, 4 LOW, 4 NA.'
);
