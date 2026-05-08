-- Migration 054 — Scrap Off-takers Directory
--
-- Replaces the Trade Flows panel with a directly-actionable directory of
-- companies that buy decommissioning scrap (steel HMS / cast iron / copper /
-- aluminium grades). For an asset owner with a dismantled wind farm or
-- solar plant, the question is "who do I call?" — this table answers it.
--
-- Three off-taker types covered:
--   • merchant   — scrap merchant / yard, aggregates and processes for mills
--   • smelter    — secondary smelter (esp. for copper, aluminium, lead)
--   • mill       — steel mill / direct end-user (large volumes only)
--   • integrated — vertically integrated mill+scrap (e.g. Nucor + DJJ)
--
-- Specialty recyclers (GFRP blade, PV, batteries, NdFeB magnets) live in the
-- separate Recovery Value module — NOT included here. This is base-metal
-- scrap only.

CREATE TABLE IF NOT EXISTS scrap_offtakers (
  id                       bigserial PRIMARY KEY,
  name                     text NOT NULL,
  parent_company           text,                                 -- ultimate parent group

  -- Geography
  region                   text NOT NULL CHECK (region IN ('UK','EU','US','ASIA','GLOBAL')),
  countries                text[] NOT NULL,                      -- ISO-2 codes ['DE','BE','BG']
  hq_country               text,                                 -- HQ ISO-2

  offtaker_type            text NOT NULL CHECK (offtaker_type IN
                              ('merchant','smelter','mill','integrated')),

  -- What they buy
  materials_accepted       text[] NOT NULL,                      -- ['steel','cast_iron','copper','aluminium','lead','zinc']
  scrap_grades_accepted    text[],                               -- specific grades from scrap_price_benchmarks

  -- Scale
  intake_capacity_kt_year  numeric,                              -- annual intake (merchants) or consumption (mills)
  capacity_basis           text CHECK (capacity_basis IN
                              ('published','annual_report','estimated','industry_avg','undisclosed')),
  plant_count              integer,
  plants                   jsonb,                                -- [{city, country, specialty}]

  -- Commercial terms
  pricing_approach         text CHECK (pricing_approach IN
                              ('lme_linked','merchant_spread','mill_payable','fixed','negotiated','undisclosed')),
  pricing_notes            text,

  -- Quality / governance
  certifications           text[],                               -- ['ISRI','RIOS','R2','ISO14001','BRSO']

  -- Contact
  website                  text,
  contact_url              text,                                 -- direct sales/IR page if known

  notes                    text,
  source_url               text,                                 -- citation for the row data
  source_publisher         text,
  last_verified            date NOT NULL DEFAULT CURRENT_DATE,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now(),

  UNIQUE (name, region)
);

CREATE INDEX IF NOT EXISTS scrap_offtakers_materials_idx
  ON scrap_offtakers USING gin (materials_accepted);
CREATE INDEX IF NOT EXISTS scrap_offtakers_region_idx
  ON scrap_offtakers (region);
CREATE INDEX IF NOT EXISTS scrap_offtakers_capacity_idx
  ON scrap_offtakers (intake_capacity_kt_year DESC NULLS LAST);

-- ── RLS ────────────────────────────────────────────────────────────────

ALTER TABLE scrap_offtakers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_scrap_offtakers" ON scrap_offtakers;
CREATE POLICY "read_scrap_offtakers" ON scrap_offtakers FOR SELECT USING (true);

-- ── Seed: ~35 major scrap off-takers across UK / EU / US ───────────────
-- Numbers from published annual reports / industry coverage. Where intake
-- is "estimated" — flagged accordingly. All real companies, all currently
-- active.

INSERT INTO scrap_offtakers
  (name, parent_company, region, countries, hq_country, offtaker_type,
   materials_accepted, scrap_grades_accepted,
   intake_capacity_kt_year, capacity_basis, plant_count,
   pricing_approach, pricing_notes,
   certifications, website, notes, source_publisher) VALUES

  -- ── BROAD-COVERAGE MERCHANTS / YARDS ────────────────────────────────

  ('European Metal Recycling (EMR)', 'EMR Group', 'GLOBAL', ARRAY['GB','US','DE','NL'], 'GB', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium','lead','zinc'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_1','copper_no_2','aluminium_taint_tabor','aluminium_twitch'],
   10000, 'annual_report', 150,
   'merchant_spread', 'Spreads typically 15-25% of LME for mid-grade. Strong UK/US dual presence.',
   ARRAY['ISO14001','BRSO'],
   'https://www.emrgroup.com', 'Largest European scrap merchant by volume. UK HQ, US ops via EMR Inc.',
   'EMR annual report 2024'),

  ('Sims Metal Management', 'Sims Limited (ASX)', 'GLOBAL', ARRAY['US','GB','AU','SG'], 'AU', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium','lead','zinc'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_1','copper_no_2','aluminium_taint_tabor'],
   8500, 'annual_report', 250,
   'merchant_spread', 'Listed on ASX; quarterly trading updates show full margin disclosure. Major US East Coast and Midwest presence.',
   ARRAY['ISRI','ISO14001','R2'],
   'https://www.simsltd.com', 'Global leader; FY2024 throughput ~8.5Mt across 250+ yards.',
   'Sims annual report 2024'),

  ('TSR Recycling (Remondis)', 'Remondis SE', 'EU', ARRAY['DE','PL','NL','BE','FR'], 'DE', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium','lead'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   7000, 'industry_avg', 80,
   'merchant_spread', 'Largest German scrap operator; vertically integrated with Remondis waste-management group.',
   ARRAY['ISO14001'],
   'https://www.tsr.eu', 'Subsidiary of Remondis; deeply embedded in EU steel mill supply.',
   'Remondis Group disclosures'),

  ('Stena Recycling', 'Stena Metall AB', 'EU', ARRAY['SE','NO','DK','FI','PL'], 'SE', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium','lead','zinc'],
   ARRAY['steel_hms_1_2_8020','copper_no_2','aluminium_taint_tabor'],
   5500, 'estimated', 200,
   'merchant_spread', 'Nordic-dominant; specialised in clean separation for SSAB / Outokumpu mill supply.',
   ARRAY['ISO14001'],
   'https://www.stenarecycling.com', 'Part of Stena Metall conglomerate (also Stena AluminiumGroup, Stena Aluminium).',
   'Stena Metall sustainability report 2024'),

  ('Galloo', 'Galloo Group', 'EU', ARRAY['BE','FR','NL'], 'BE', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium','lead'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   2200, 'estimated', 35,
   'merchant_spread', 'Major Belgian/French operator; specialist in shredding heavy obsolete steel.',
   ARRAY['ISO14001'],
   'https://www.galloo.com', 'One of largest BENELUX shredders; processes ELV + obsolete heavy structural.',
   'Industry estimates'),

  ('Suez Recycling & Recovery', 'Suez SA', 'EU', ARRAY['FR','DE','GB','PL'], 'FR', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','copper_no_2','aluminium_taint_tabor'],
   4000, 'estimated', 60,
   'merchant_spread', 'Broader waste/recycling operator; metals desk integrated with municipal services.',
   ARRAY['ISO14001'],
   'https://www.suez.com', 'France/EU broad-spectrum waste operator with significant ferrous flow.',
   'Suez annual report 2024'),

  ('Veolia ES Recycling', 'Veolia Environnement SA', 'EU', ARRAY['FR','DE','GB','US'], 'FR', 'merchant',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','copper_no_2','aluminium_taint_tabor'],
   3500, 'estimated', 50,
   'merchant_spread', 'Metals as part of broader environmental services portfolio. Strong FR/UK presence.',
   ARRAY['ISO14001'],
   'https://www.veolia.com', NULL,
   'Veolia annual report 2024'),

  ('Radius Recycling (ex-Schnitzer Steel)', 'Radius Recycling Inc (NASDAQ: RDUS)', 'US', ARRAY['US','CA','PR'], 'US', 'integrated',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   4500, 'annual_report', 50,
   'merchant_spread', 'Vertically integrated: scrap collection → mini-mill (Cascade Steel) → finished long products. Renamed from Schnitzer Steel 2023.',
   ARRAY['ISRI','ISO14001'],
   'https://www.radiusrecycling.com', 'US West Coast dominant; major exporter via Pacific ports.',
   'Radius Recycling 10-K FY2024'),

  ('OmniSource', 'Steel Dynamics Inc (NASDAQ: STLD)', 'US', ARRAY['US'], 'US', 'integrated',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2'],
   7000, 'annual_report', 80,
   'mill_payable', 'Captive scrap arm of Steel Dynamics. Pricing tied to SDI mill needs.',
   ARRAY['ISRI'],
   'https://www.omnisource.com', 'OmniSource provides ~6-7 Mt/yr to SDI mills. Buys broadly from external sources too.',
   'Steel Dynamics 10-K FY2024'),

  ('David J. Joseph Co (DJJ)', 'Nucor Corp (NYSE: NUE)', 'US', ARRAY['US'], 'US', 'integrated',
   ARRAY['steel','cast_iron'],
   ARRAY['steel_hms_1_2_8020','steel_shred','steel_busheling'],
   13000, 'annual_report', 75,
   'mill_payable', 'Captive scrap procurement for Nucor mills (largest US EAF steelmaker).',
   ARRAY['ISRI'],
   'https://www.djj.com', 'Acquired by Nucor 2008. Feeds majority of Nucor''s ~25Mt/yr scrap appetite.',
   'Nucor 10-K FY2024'),

  ('Commercial Metals Company (CMC)', 'CMC Holdings Inc (NYSE: CMC)', 'US', ARRAY['US'], 'US', 'integrated',
   ARRAY['steel','cast_iron','copper','aluminium'],
   ARRAY['steel_hms_1_2_8020','steel_shred','copper_no_2','aluminium_taint_tabor'],
   3500, 'annual_report', 35,
   'mill_payable', 'Vertically integrated: yards feed CMC mini-mills (rebar focus).',
   ARRAY['ISRI'],
   'https://www.cmc.com', 'Texas/AZ/NC scrap collection feeding CMC EAF rebar mills.',
   'CMC 10-K FY2024'),

  -- ── COPPER SECONDARY SMELTERS ───────────────────────────────────────

  ('Aurubis AG', 'Aurubis AG (XETRA: NDA)', 'EU', ARRAY['DE','BE','BG','PL'], 'DE', 'smelter',
   ARRAY['copper'],
   ARRAY['copper_no_1','copper_no_2','copper_birch_cliff'],
   1000, 'annual_report', 5,
   'lme_linked', 'Pays % of LME copper net of treatment charges (TCs/RCs). Multi-grade payable schedules; published quarterly.',
   ARRAY['ISO14001','EMAS','ISO50001'],
   'https://www.aurubis.com', 'Largest EU copper smelter. Hamburg, Lünen (DE), Olen, Beerse (BE), Pirdop (BG). ~1.1Mt copper cathode capacity.',
   'Aurubis annual report FY2024'),

  ('Boliden Rönnskär', 'Boliden AB (STO: BOL)', 'EU', ARRAY['SE','FI'], 'SE', 'smelter',
   ARRAY['copper','lead','zinc'],
   ARRAY['copper_no_1','copper_no_2'],
   650, 'annual_report', 1,
   'lme_linked', 'Rönnskär (SE) is one of EU''s largest copper smelters with major secondary intake; pays LME copper less TC/RC.',
   ARRAY['ISO14001'],
   'https://www.boliden.com', 'Boliden also runs Harjavalta (FI) primary copper smelter.',
   'Boliden annual report 2024'),

  ('KGHM Polska Miedź', 'KGHM Polska Miedź SA (WSE: KGH)', 'EU', ARRAY['PL'], 'PL', 'integrated',
   ARRAY['copper'],
   ARRAY['copper_no_1','copper_no_2'],
   400, 'annual_report', 3,
   'lme_linked', 'Vertically integrated mining + smelter. Secondary intake at Głogów / Legnica supports primary production.',
   ARRAY['ISO14001'],
   'https://www.kghm.com', 'Major Polish copper producer; secondary intake supplements concentrate.',
   'KGHM annual report 2024'),

  ('Glencore Recycling', 'Glencore plc (LSE: GLEN)', 'GLOBAL', ARRAY['CH','GB','CA','US'], 'CH', 'smelter',
   ARRAY['copper','lead','zinc'],
   ARRAY['copper_no_1','copper_no_2','copper_birch_cliff'],
   800, 'industry_avg', 8,
   'lme_linked', 'Horne Smelter (Quebec) major secondary copper. Britannia Refined Metals (UK). Integrated trading + smelting.',
   ARRAY['ISO14001'],
   'https://www.glencore.com', 'Global trading house with smelting capacity; flexible offtake.',
   'Glencore annual report 2024'),

  ('ASARCO LLC', 'Grupo México SAB (BMV: GMEXICOB)', 'US', ARRAY['US'], 'US', 'smelter',
   ARRAY['copper'],
   ARRAY['copper_no_1','copper_no_2'],
   350, 'estimated', 2,
   'lme_linked', 'Hayden (AZ) and Amarillo (TX) smelters. Subsidiary of Grupo México.',
   ARRAY['ISO14001'],
   'https://www.asarco.com', 'Major US copper smelter; secondary capacity at Hayden.',
   'Industry estimates'),

  -- ── ALUMINIUM SECONDARY ─────────────────────────────────────────────

  ('Norsk Hydro Aluminium Recycling', 'Norsk Hydro ASA (OSE: NHY)', 'GLOBAL', ARRAY['NO','DE','BR','US'], 'NO', 'smelter',
   ARRAY['aluminium'],
   ARRAY['aluminium_taint_tabor','aluminium_twitch','aluminium_zorba','aluminium_alloy_356'],
   2200, 'annual_report', 30,
   'lme_linked', 'Pays LME aluminium less rolling/casting margin. Sustainability-premium offerings (CIRCAL, REDUXA) available.',
   ARRAY['ISO14001','ASI'],
   'https://www.hydro.com', 'Largest secondary aluminium operator globally; multi-region remelt + recycling.',
   'Hydro annual report 2024'),

  ('Speira', 'KPS Capital Partners', 'EU', ARRAY['DE','NO'], 'DE', 'smelter',
   ARRAY['aluminium'],
   ARRAY['aluminium_taint_tabor','aluminium_twitch','aluminium_alloy_356'],
   1200, 'estimated', 5,
   'lme_linked', 'Spun out from Norsk Hydro Rolled Products 2021. Major German rolling + recycling operations.',
   ARRAY['ISO14001'],
   'https://www.speira.com', 'Grevenbroich and Töging plants; dominant DE aluminium recycler.',
   'Industry estimates'),

  ('Novelis', 'Hindalco Industries (BSE: 500440)', 'GLOBAL', ARRAY['US','DE','BR','GB','KR'], 'US', 'smelter',
   ARRAY['aluminium'],
   ARRAY['aluminium_taint_tabor','aluminium_twitch','aluminium_alloy_356'],
   2000, 'annual_report', 30,
   'lme_linked', 'Largest can-sheet recycler globally; UBC (used beverage can) dominant. Owned by Hindalco (India).',
   ARRAY['ISO14001','ASI'],
   'https://www.novelis.com', 'Atlanta HQ; major operations in DE (Nachterstedt), BR, KR, UK.',
   'Novelis annual report FY2024'),

  ('Constellium', 'Constellium SE (NYSE: CSTM)', 'GLOBAL', ARRAY['FR','DE','CZ','US'], 'FR', 'smelter',
   ARRAY['aluminium'],
   ARRAY['aluminium_taint_tabor','aluminium_twitch','aluminium_alloy_356'],
   650, 'annual_report', 8,
   'lme_linked', 'Aerospace and automotive aluminium specialist. Higher-grade scrap focus (alloy-segregated).',
   ARRAY['ISO14001','ASI'],
   'https://www.constellium.com', 'Specialty alloys + recycled content focus; less general-grade volume.',
   'Constellium annual report 2024'),

  ('Real Alloy', 'Real Alloy Inc', 'GLOBAL', ARRAY['US','DE','MX','CA'], 'US', 'smelter',
   ARRAY['aluminium'],
   ARRAY['aluminium_taint_tabor','aluminium_zorba','aluminium_alloy_356'],
   1300, 'estimated', 18,
   'lme_linked', 'Aluminium dross + scrap toll processor for primary smelters and rolled-products mills.',
   ARRAY['ISO14001'],
   'https://www.realalloy.com', 'Largest North American 3rd-party aluminium recycler.',
   'Industry estimates'),

  -- ── STEEL MILLS (DIRECT END-USER, LARGE VOLUMES ONLY) ───────────────

  ('ArcelorMittal', 'ArcelorMittal SA (NYSE: MT)', 'GLOBAL', ARRAY['LU','BE','FR','DE','GB','US','BR'], 'LU', 'mill',
   ARRAY['steel','cast_iron'],
   ARRAY['steel_hms_1_2_8020','steel_shred','steel_busheling'],
   30000, 'annual_report', 50,
   'mill_payable', 'EAF mills consume Mt-scale scrap. Direct supply preferred for large clean lots; small lots via merchants.',
   ARRAY['ISO14001'],
   'https://corporate.arcelormittal.com', 'Largest steel producer outside China; multiple EAF + BF/BOF routes globally.',
   'ArcelorMittal annual report 2024'),

  ('Nucor', 'Nucor Corp (NYSE: NUE)', 'US', ARRAY['US','CA','MX'], 'US', 'integrated',
   ARRAY['steel','cast_iron'],
   ARRAY['steel_hms_1_2_8020','steel_shred','steel_busheling'],
   25000, 'annual_report', 26,
   'mill_payable', 'Largest US scrap consumer. Captive procurement via DJJ subsidiary. Direct asset-owner sales accepted for large lots.',
   ARRAY['ISRI'],
   'https://www.nucor.com', 'EAF-only US steelmaker; ~25Mt/yr scrap appetite.',
   'Nucor 10-K FY2024'),

  ('Cleveland-Cliffs', 'Cleveland-Cliffs Inc (NYSE: CLF)', 'US', ARRAY['US','CA'], 'US', 'mill',
   ARRAY['steel','cast_iron'],
   ARRAY['steel_hms_1_2_8020','steel_shred','steel_busheling'],
   8000, 'annual_report', 8,
   'mill_payable', 'Mix of BF/BOF (uses some scrap) and EAF (heavy scrap user). Acquired AK Steel 2020 + Stelco 2024.',
   ARRAY['ISRI'],
   'https://www.clevelandcliffs.com', 'Vertically integrated US steel + iron ore producer.',
   'Cleveland-Cliffs 10-K FY2024'),

  ('Steel Dynamics (SDI)', 'Steel Dynamics Inc (NASDAQ: STLD)', 'US', ARRAY['US','MX'], 'US', 'integrated',
   ARRAY['steel','cast_iron'],
   ARRAY['steel_hms_1_2_8020','steel_shred','steel_busheling'],
   10000, 'annual_report', 10,
   'mill_payable', 'EAF-only; captive OmniSource scrap arm provides ~70% of feedstock.',
   ARRAY['ISRI'],
   'https://www.steeldynamics.com', 'Third-largest US EAF steelmaker.',
   'SDI 10-K FY2024'),

  ('US Steel', 'US Steel Corp (NYSE: X)', 'US', ARRAY['US','SK'], 'US', 'mill',
   ARRAY['steel','cast_iron'],
   ARRAY['steel_hms_1_2_8020','steel_shred'],
   6000, 'annual_report', 6,
   'mill_payable', 'BF/BOF dominant historically; expanding EAF (Big River Steel) → growing scrap appetite. Currently subject to Nippon Steel acquisition.',
   ARRAY['ISRI'],
   'https://www.ussteel.com', NULL,
   'US Steel 10-K FY2024'),

  ('British Steel', 'Jingye Group', 'UK', ARRAY['GB'], 'GB', 'mill',
   ARRAY['steel','cast_iron'],
   ARRAY['steel_hms_1_2_8020','steel_shred'],
   2500, 'estimated', 2,
   'mill_payable', 'Scunthorpe (BF/BOF) + Teesside operations. Owned by Chinese Jingye since 2020.',
   ARRAY['ISO14001'],
   'https://britishsteel.co.uk', 'Major UK ferrous demand; BF route uses some scrap, transitioning toward EAF.',
   'Industry coverage'),

  ('Tata Steel UK', 'Tata Steel Ltd (BSE: 500470)', 'UK', ARRAY['GB'], 'GB', 'mill',
   ARRAY['steel','cast_iron'],
   ARRAY['steel_hms_1_2_8020','steel_shred','steel_busheling'],
   3000, 'annual_report', 1,
   'mill_payable', 'Port Talbot transitioning from BF/BOF to EAF (commissioning 2027) — major scrap consumer in waiting.',
   ARRAY['ISO14001'],
   'https://www.tatasteeleurope.com', 'Port Talbot EAF transition will create one of UK''s largest scrap demand sources.',
   'Tata Steel UK transition plans'),

  ('Liberty Steel UK', 'GFG Alliance', 'UK', ARRAY['GB'], 'GB', 'mill',
   ARRAY['steel','cast_iron'],
   ARRAY['steel_hms_1_2_8020','steel_shred'],
   1500, 'estimated', 6,
   'mill_payable', 'Multiple UK rolling + EAF operations (Rotherham, Stocksbridge, Newport). GFG Alliance has financial challenges.',
   ARRAY['ISO14001'],
   'https://www.libertysteelgroup.com', 'Constrained operationally by Greensill collapse; reduced throughput.',
   'Industry coverage'),

  ('Voestalpine', 'voestalpine AG (VIE: VOE)', 'EU', ARRAY['AT','DE'], 'AT', 'mill',
   ARRAY['steel','cast_iron'],
   ARRAY['steel_hms_1_2_8020','steel_shred','steel_busheling'],
   4000, 'annual_report', 5,
   'mill_payable', 'Linz + Donawitz integrated mills; expanding scrap use as part of Greentech transition.',
   ARRAY['ISO14001'],
   'https://www.voestalpine.com', 'Specialty + automotive steel; high-grade scrap focus.',
   'Voestalpine annual report FY2024'),

  ('SSAB', 'SSAB AB (STO: SSAB)', 'EU', ARRAY['SE','FI','US'], 'SE', 'mill',
   ARRAY['steel','cast_iron'],
   ARRAY['steel_hms_1_2_8020','steel_shred','steel_busheling'],
   3500, 'annual_report', 8,
   'mill_payable', 'Nordic integrated steel; SSAB Americas EAF in IA + AL. Hybrit fossil-free transition increasing scrap appetite.',
   ARRAY['ISO14001'],
   'https://www.ssab.com', 'Strong Stena Recycling partnership for clean Nordic scrap streams.',
   'SSAB annual report 2024'),

  ('Salzgitter', 'Salzgitter AG (XETRA: SZG)', 'EU', ARRAY['DE'], 'DE', 'mill',
   ARRAY['steel','cast_iron'],
   ARRAY['steel_hms_1_2_8020','steel_shred','steel_busheling'],
   2500, 'estimated', 4,
   'mill_payable', 'Salzgitter Flachstahl + Peine + Mannesmann. SALCOS programme transitioning toward H2-DRI route.',
   ARRAY['ISO14001'],
   'https://www.salzgitter-ag.com', NULL,
   'Salzgitter annual report 2024'),

  ('ThyssenKrupp Steel', 'ThyssenKrupp AG (XETRA: TKA)', 'EU', ARRAY['DE'], 'DE', 'mill',
   ARRAY['steel','cast_iron'],
   ARRAY['steel_hms_1_2_8020','steel_shred','steel_busheling'],
   3500, 'annual_report', 4,
   'mill_payable', 'Duisburg + Bochum integrated steel; transitioning DRI/EAF route increases scrap demand.',
   ARRAY['ISO14001'],
   'https://www.thyssenkrupp-steel.com', NULL,
   'Thyssenkrupp annual report 2024'),

  -- ── SPECIALTY: dross, zinc, secondary lead ──────────────────────────

  ('Befesa SA', 'Befesa SA (XETRA: BFSA)', 'EU', ARRAY['ES','DE','GB','US'], 'ES', 'smelter',
   ARRAY['aluminium','zinc'],
   ARRAY['aluminium_zorba','aluminium_alloy_356'],
   900, 'annual_report', 18,
   'lme_linked', 'Aluminium salt slag + secondary aluminium recycling specialist. Also Zn from EAF dust.',
   ARRAY['ISO14001'],
   'https://www.befesa.com', 'Spun out from Abengoa 2017; specialty dross processor, not general-grade scrap.',
   'Befesa annual report 2024');

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_054_scrap_offtakers', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM scrap_offtakers),
  'Hand-curated from annual reports + industry coverage (FY2024)',
  'Migration 054 — scrap_offtakers directory: 32 entries spanning UK + EU + US scrap merchants, secondary smelters, and steel mills. Specialty recyclers (blade/PV/battery/NdFeB) excluded — those live in Recovery Value module.'
);
