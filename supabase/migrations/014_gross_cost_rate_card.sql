-- Migration 014 — Gross-cost rate card + country multipliers + blade gate fees by pathway
--
-- Per Endenex methodology §19, §20:
--   • DCI gross cost is built from 8 work categories with detailed rate cards
--   • Country cost multipliers normalise UK baseline across 12 European markets
--   • Blade gate fees vary by recycling pathway (5 pathways with own rates)

-- ============================================================
-- DCI GROSS-COST COMPONENTS
-- One row per work category contributing to DCI gross cost.
-- Rates are EUR/MW at base period (2025-01-01); UK baseline.
-- ============================================================
CREATE TABLE IF NOT EXISTS dci_gross_cost_components (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id    TEXT UNIQUE NOT NULL,
  label           TEXT NOT NULL,
  category        TEXT NOT NULL,                       -- 'mechanical' | 'civils' | 'electrical' | 'soft' | 'contractor'
  base_rate_eur_mw NUMERIC NOT NULL,                   -- per MW at base period (EUR, UK baseline)
  scope_notes     TEXT,
  source_doc      TEXT,
  source_date     DATE NOT NULL,
  confidence      TEXT NOT NULL CHECK (confidence IN ('High','Medium','Low')),
  last_reviewed   DATE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE dci_gross_cost_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_dci_gross_cost_components" ON dci_gross_cost_components FOR SELECT USING (true);
CREATE POLICY "write_dci_gross_cost_components" ON dci_gross_cost_components FOR ALL USING (auth.role() = 'service_role');

-- Seed: 8 work categories — sum should align to DCI methodology v1.0 base of €82,000/MW
INSERT INTO dci_gross_cost_components
  (component_id, label, category, base_rate_eur_mw, scope_notes, source_doc, source_date, confidence, last_reviewed)
VALUES
  ('crane_mob_lift',     'Crane mobilisation and lift',           'mechanical',  18500,
   '500-1000t class; mob/demob amortised across fleet + day-rate × days/turbine',
   'Ainscough/Sparrows/ALE/Mammoet UK day-rate guides',                    CURRENT_DATE, 'High',   CURRENT_DATE),
  ('dismantling_crew',   'Dismantling crew, plant & establishment','mechanical', 14200,
   'Tower cutting, rigging, plant hire — CIJC 2024 + 35% on-costs',
   'CIJC 2024 day rates + plant hire indexed',                             CURRENT_DATE, 'High',   CURRENT_DATE),
  ('blade_field_cutting','Blade onsite cutting',                  'mechanical',   3800,
   'Field cutting to 12-25m sections — blade cutting line',
   'WindEurope industry guidance + DecomBlades',                           CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('foundation',         'Foundation handling',                    'civils',     14500,
   'Partial extraction (0.35 fraction) — pedestal + upper frustum of tapered octagonal gravity base',
   'Spons Civil Engineering Price Book; CDAS/NFDC; RSMeans',               CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('cables',             'Cable treatment',                        'electrical',  6800,
   'Mode-dependent: extract & recover (per-metre) / retain (per-circuit) / abandon (per-termination)',
   'Industry tender data + back-solved blended at 10 turbines',            CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('grid_disconnection', 'Grid disconnection & switchgear',        'electrical',  4400,
   'Substation disconnect, switchgear handling, DNO/TNO interface',
   'DNO/TNO tender records, grid interface scope',                         CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('site_restoration',   'Site restoration & civils',              'civils',      8200,
   'Hardstanding break-out, track restoration, drainage, ecological reinstatement',
   'CESMM4 + Spons rates; ecology clerk-of-works adders',                  CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('soft_costs',         'Permitting, HSE, ecology, PM, community','soft',       11600,
   'Principal Contractor / CDM, permitting (€60k base), community engagement, PM, QS, closeout',
   'Endenex decom estimator §19 soft-cost breakdown',                      CURRENT_DATE, 'Medium', CURRENT_DATE)
ON CONFLICT (component_id) DO UPDATE SET
  label            = EXCLUDED.label,
  category         = EXCLUDED.category,
  base_rate_eur_mw = EXCLUDED.base_rate_eur_mw,
  scope_notes      = EXCLUDED.scope_notes,
  source_doc       = EXCLUDED.source_doc,
  last_reviewed    = EXCLUDED.last_reviewed;

-- Helper view: total base gross cost (sums to ~82000 EUR/MW)
CREATE OR REPLACE VIEW dci_gross_cost_total AS
  SELECT SUM(base_rate_eur_mw) AS total_eur_mw FROM dci_gross_cost_components;

-- ============================================================
-- COUNTRY COST MULTIPLIERS — relative to UK = 1.00
-- Per methodology §20: Eurostat 2024/25 LCS/LCI, T&T ICMS 2024, IRU.
-- ============================================================
CREATE TABLE IF NOT EXISTS country_cost_multipliers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code    TEXT UNIQUE NOT NULL,
  country_name    TEXT NOT NULL,
  labour_mult     NUMERIC NOT NULL,
  plant_mult      NUMERIC NOT NULL,
  haul_mult       NUMERIC NOT NULL,
  gate_mult       NUMERIC NOT NULL,
  notes           TEXT,
  source_doc      TEXT NOT NULL,
  source_date     DATE NOT NULL,
  confidence      TEXT NOT NULL CHECK (confidence IN ('High','Medium','Low')),
  last_reviewed   DATE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE country_cost_multipliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_country_cost_multipliers" ON country_cost_multipliers FOR SELECT USING (true);
CREATE POLICY "write_country_cost_multipliers" ON country_cost_multipliers FOR ALL USING (auth.role() = 'service_role');

INSERT INTO country_cost_multipliers
  (country_code, country_name, labour_mult, plant_mult, haul_mult, gate_mult, notes, source_doc, source_date, confidence, last_reviewed)
VALUES
  ('GB','United Kingdom',  1.00, 1.00, 1.00, 1.00, 'Baseline',                                                'Methodology §20 baseline',                                CURRENT_DATE, 'High',   CURRENT_DATE),
  ('DE','Germany',         1.05, 1.00, 0.93, 1.30, 'Most competitive N/W European freight; highest gate (DepV)','Eurostat LCS 2024; IRU; T&T ICMS 2024',                  CURRENT_DATE, 'High',   CURRENT_DATE),
  ('FR','France',          1.02, 0.97, 0.92, 1.05, 'High social charges offset lower base wage',              'Eurostat LCS 2024; T&T ICMS 2024',                       CURRENT_DATE, 'High',   CURRENT_DATE),
  ('NL','Netherlands',     1.18, 1.08, 0.90, 1.35, 'Logistics hub; highest gate (strict composite waste)',    'Eurostat LCS 2024; IRU; Dutch waste regulator',          CURRENT_DATE, 'High',   CURRENT_DATE),
  ('DK','Denmark',         1.30, 1.22, 0.98, 1.20, 'Highest labour; active EPR scheme',                       'Eurostat LCS 2024; T&T ICMS 2024',                       CURRENT_DATE, 'High',   CURRENT_DATE),
  ('IE','Ireland',         0.90, 1.10, 1.18, 0.88, 'Island logistics premium on plant and haul',              'Eurostat LCS 2024; Irish freight indices',               CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('ES','Spain',           0.60, 0.82, 0.78, 0.82, 'Deep crane fleet; lower labour base',                     'Eurostat LCS 2024; T&T ICMS 2024',                       CURRENT_DATE, 'High',   CURRENT_DATE),
  ('IT','Italy',           0.75, 0.88, 0.88, 1.08, 'Southern-weighted fleet reduces effective rate',          'Eurostat LCS 2024; T&T ICMS 2024',                       CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('PT','Portugal',        0.42, 0.80, 0.75, 0.82, 'Lowest labour multiplier in set',                         'Eurostat LCS 2024',                                      CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('BE','Belgium',         1.20, 1.05, 0.88, 1.20, 'Antwerp logistics hub',                                   'Eurostat LCS 2024; IRU',                                 CURRENT_DATE, 'High',   CURRENT_DATE),
  ('AT','Austria',         1.00, 1.02, 0.95, 1.25, 'Comparable to UK; Alpine site premium in gate',           'Eurostat LCS 2024; Austrian permits',                    CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('SE','Sweden',          1.18, 1.05, 0.95, 1.15, 'Higher labour; Nordic baseline',                          'Eurostat LCS 2024',                                      CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('PL','Poland',          0.55, 0.85, 0.80, 0.78, 'Eastern Europe baseline',                                 'Eurostat LCS 2024',                                      CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('US','United States',   1.10, 1.05, 0.85, 0.90, 'US Midwest baseline; lower haul (long-haul logistics deep)','BLS ECEC; Turner & Townsend ICMS 2024',                 CURRENT_DATE, 'High',   CURRENT_DATE),
  ('JP','Japan',           1.25, 1.20, 0.98, 1.30, 'High labour; complex permitting',                         'JETRO statistics; T&T ICMS 2024',                        CURRENT_DATE, 'Medium', CURRENT_DATE)
ON CONFLICT (country_code) DO UPDATE SET
  labour_mult   = EXCLUDED.labour_mult,
  plant_mult    = EXCLUDED.plant_mult,
  haul_mult     = EXCLUDED.haul_mult,
  gate_mult     = EXCLUDED.gate_mult,
  notes         = EXCLUDED.notes,
  source_doc    = EXCLUDED.source_doc,
  last_reviewed = EXCLUDED.last_reviewed;

-- ============================================================
-- BLADE GATE FEES BY PATHWAY
-- Per methodology §19: 5 distinct pathways with very different rates.
-- Stored in EUR/tonne; converted at portfolio time using FX.
-- ============================================================
DO $$ BEGIN
  CREATE TYPE blade_pathway AS ENUM ('landfill','storage','mechanical','cement','pyrolysis');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS blade_gate_fees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pathway         blade_pathway NOT NULL,
  region          TEXT NOT NULL CHECK (region IN ('EU','GB','US','GLOBAL')),
  eur_per_tonne   NUMERIC NOT NULL,
  basis           TEXT NOT NULL,
  facility_examples TEXT,
  source_doc      TEXT,
  source_date     DATE NOT NULL,
  confidence      TEXT NOT NULL CHECK (confidence IN ('High','Medium','Low')),
  last_reviewed   DATE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (pathway, region)
);

ALTER TABLE blade_gate_fees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_blade_gate_fees" ON blade_gate_fees FOR SELECT USING (true);
CREATE POLICY "write_blade_gate_fees" ON blade_gate_fees FOR ALL USING (auth.role() = 'service_role');

INSERT INTO blade_gate_fees
  (pathway, region, eur_per_tonne, basis, facility_examples, source_doc, source_date, confidence, last_reviewed)
VALUES
  -- UK: post-1 April 2026 landfill tax £130.75/t + £25/t gate
  ('landfill',   'GB',  175,  'UK £130.75/t landfill tax (from 1 April 2026) + £25/t gate, EUR-equivalent', NULL,                                              'HMRC landfill tax schedule + UK gate fees',  CURRENT_DATE, 'High',   CURRENT_DATE),
  ('landfill',   'EU',   65,  'Continental landfill rates 50-80/t (where permitted)',                       NULL,                                              'WindEurope; national waste regulators',      CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('landfill',   'US',   50,  'US landfill rates highly variable; Midwest reference',                       NULL,                                              'EPA + state landfill permit fees',           CURRENT_DATE, 'Low',    CURRENT_DATE),
  ('storage',    'GLOBAL', 65,'Bonded handling cost only; no treatment',                                   'EMR Glasgow South Street WTPC',                   'WindEurope industry data',                   CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('mechanical', 'GLOBAL',220,'WindEurope market range 150-300/t; Beauson et al. 2021',                    'EnergyLOOP / Reciclalia (Spain); EMR Glasgow',    'WindEurope; Beauson et al. 2021',            CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('cement',     'EU',   150,'WindEurope market-observed German rate; Neocomp + Holcim Lägerdorf chain',    'Neocomp Bremen + Holcim Lägerdorf kiln',          'WindEurope; Holcim/Neocomp public data',     CURRENT_DATE, 'High',   CURRENT_DATE),
  ('cement',     'GB',   170,'UK cement co-processing — slightly higher than DE due to logistics',          'UK kiln operators',                               'WindEurope UK; UK cement industry data',     CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('cement',     'US',   180,'US cement co-processing; thinner blade-recycling kiln base',                  'US kiln operators',                               'PCA US data',                                CURRENT_DATE, 'Low',    CURRENT_DATE),
  ('pyrolysis',  'GLOBAL',680,'Cambridge TEA: cost ~$382.5/t, recyclate ~$240.5/t; 2026 assessment 702-780','R3FIBER / Waste2Fiber Navarra (Spain)',           'Cambridge TEA; Beauson et al. 2022',         CURRENT_DATE, 'Low',    CURRENT_DATE)
ON CONFLICT (pathway, region) DO UPDATE SET
  eur_per_tonne     = EXCLUDED.eur_per_tonne,
  basis             = EXCLUDED.basis,
  facility_examples = EXCLUDED.facility_examples,
  source_doc        = EXCLUDED.source_doc,
  last_reviewed     = EXCLUDED.last_reviewed;

-- ============================================================
-- Telemetry
-- ============================================================
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'seed_gross_cost_rate_card', 'success', NOW(), NOW(),
  8 + 15 + 9,
  'Methodology §19 (rate card), §20 (country multipliers); WindEurope blade pathway data',
  'Migration 014 — 8 gross-cost components + 15 country multipliers + 9 blade gate fee rows'
);
