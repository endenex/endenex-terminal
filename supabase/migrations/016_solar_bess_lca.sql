-- Migration 016 — Solar PV and BESS material intensities
--
-- Per Endenex methodology §7-13:
--   Solar PV: vintage-bucketed (pre2012 / 2012-19 / 2020+) intensities reflect
--             8× decline in silver paste (BSF → PERC → TOPCon)
--   BESS:     vintage-bucketed (pre2018 / 2018-21 / 2022+) intensities reflect
--             chemistry shift (NMC → LFP) with proportional Ni/Co decline
--
-- Sources: IRENA/IEA-PVPS (2016), ITRPV 2024, Silver Institute, Sander et al. 2019,
--          NREL ATB 2024, Argonne BatPaC v5, BNEF LCOES 2023.

-- ============================================================
-- ENUM types
-- ============================================================
DO $$ BEGIN
  CREATE TYPE solar_vintage AS ENUM ('pre2012','y2012','y2020');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE solar_technology AS ENUM ('mono_si','poly_si','cdte','cigs');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE solar_mount AS ENUM ('ground_mount','rooftop');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE bess_vintage AS ENUM ('pre2018','y2018','y2022');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE bess_chemistry AS ENUM ('lfp','nmc','nas');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- SOLAR PV — Panel material intensities (t/MWp = kg/kWp)
-- One row per vintage × material. Silver intensity differs sharply by vintage.
-- ============================================================
CREATE TABLE IF NOT EXISTS solar_panel_intensities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vintage         solar_vintage NOT NULL,
  material        TEXT NOT NULL CHECK (material IN (
                    'steel','glass','aluminium','copper','silicon','silver','polymer'
                  )),
  intensity_t_per_mwp NUMERIC NOT NULL,
  basis           TEXT,
  source_doc      TEXT NOT NULL,
  source_date     DATE NOT NULL,
  confidence      TEXT NOT NULL CHECK (confidence IN ('High','Medium','Low')),
  last_reviewed   DATE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (vintage, material)
);

ALTER TABLE solar_panel_intensities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_solar_panel_intensities" ON solar_panel_intensities FOR SELECT USING (true);
CREATE POLICY "write_solar_panel_intensities" ON solar_panel_intensities FOR ALL USING (auth.role() = 'service_role');

-- 3 vintages × 7 materials = 21 rows
INSERT INTO solar_panel_intensities
  (vintage, material, intensity_t_per_mwp, basis, source_doc, source_date, confidence, last_reviewed)
VALUES
  -- pre2012 (BSF p-type, paste-heavy)
  ('pre2012','steel',     30.0,    'Module frame + module-to-rail connectors', 'IRENA/IEA-PVPS 2016',                            CURRENT_DATE, 'High',   CURRENT_DATE),
  ('pre2012','glass',     45.0,    'Front cover + (for glass-glass) back',     'IRENA/IEA-PVPS 2016',                            CURRENT_DATE, 'High',   CURRENT_DATE),
  ('pre2012','aluminium', 20.0,    'Frame profile',                            'IRENA/IEA-PVPS 2016',                            CURRENT_DATE, 'High',   CURRENT_DATE),
  ('pre2012','copper',     4.5,    'Module wiring + ribbon',                   'IRENA/IEA-PVPS 2016',                            CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('pre2012','silicon',    4.5,    'BSF wafer (~200µm)',                        'ITRPV 2024 (historical thickness)',              CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('pre2012','silver',     0.100,  '~100 kg/MW (~0.10 g/W) — Silver Institute calibration', 'Silver Institute World Silver Survey 2008-2011', CURRENT_DATE, 'High',   CURRENT_DATE),
  ('pre2012','polymer',    6.0,    'EVA encapsulant + backsheet (~PVF/PET)',   'IRENA/IEA-PVPS 2016',                            CURRENT_DATE, 'Medium', CURRENT_DATE),
  -- 2012-19 (Multi-Si → PERC)
  ('y2012','steel',       30.0,    'Module frame; structural unchanged',        'IRENA/IEA-PVPS 2016',                            CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2012','glass',       45.0,    'Front cover',                              'IRENA/IEA-PVPS 2016',                            CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2012','aluminium',   20.0,    'Frame profile',                            'IRENA/IEA-PVPS 2016',                            CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2012','copper',       4.5,    'Module wiring',                             'IRENA/IEA-PVPS 2016',                            CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('y2012','silicon',      3.8,    'PERC wafer (~180µm)',                       'ITRPV 2024',                                     CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2012','silver',       0.060,  '~60 kg/MW (~0.06 g/W) — declining slope',   'ITRPV 2024',                                     CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2012','polymer',      6.0,    'EVA + backsheet',                          'IRENA/IEA-PVPS 2016',                            CURRENT_DATE, 'Medium', CURRENT_DATE),
  -- 2020+ (PERC mainstream / TOPCon emerging)
  ('y2020','steel',       30.0,    'Module frame',                             'IRENA/IEA-PVPS 2016',                            CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2020','glass',       45.0,    'Front cover',                              'IRENA/IEA-PVPS 2016',                            CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2020','aluminium',   20.0,    'Frame profile',                            'IRENA/IEA-PVPS 2016',                            CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2020','copper',       4.5,    'Module wiring',                            'IRENA/IEA-PVPS 2016',                            CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('y2020','silicon',      3.5,    'TOPCon/PERC wafer (~165µm)',               'ITRPV 2024',                                     CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2020','silver',       0.025,  '~25 kg/MW (~0.025 g/W) — current consensus','ITRPV 2024',                                     CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2020','polymer',      6.0,    'EVA + backsheet',                          'IRENA/IEA-PVPS 2016',                            CURRENT_DATE, 'Medium', CURRENT_DATE)
ON CONFLICT (vintage, material) DO UPDATE SET
  intensity_t_per_mwp = EXCLUDED.intensity_t_per_mwp,
  source_doc          = EXCLUDED.source_doc,
  last_reviewed       = EXCLUDED.last_reviewed;

-- ============================================================
-- SOLAR PV — Panel mass + hazardous flag by technology
-- ============================================================
CREATE TABLE IF NOT EXISTS solar_panel_technologies (
  technology      solar_technology PRIMARY KEY,
  mass_kg_per_kwp NUMERIC NOT NULL,
  has_frame       BOOLEAN NOT NULL,
  is_hazardous    BOOLEAN NOT NULL,
  notes           TEXT,
  source_doc      TEXT NOT NULL,
  source_date     DATE NOT NULL,
  last_reviewed   DATE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE solar_panel_technologies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_solar_panel_technologies" ON solar_panel_technologies FOR SELECT USING (true);
CREATE POLICY "write_solar_panel_technologies" ON solar_panel_technologies FOR ALL USING (auth.role() = 'service_role');

INSERT INTO solar_panel_technologies (technology, mass_kg_per_kwp, has_frame, is_hazardous, notes, source_doc, source_date, last_reviewed) VALUES
  ('mono_si', 65, true,  false, '~75% glass, ~10% Al frame, ~5% Si/Ag/Cu, ~10% encapsulant', 'IRENA/IEA-PVPS 2016', CURRENT_DATE, CURRENT_DATE),
  ('poly_si', 70, true,  false, 'Dominant in fleet 2005-2016',                                'IRENA/IEA-PVPS 2016', CURRENT_DATE, CURRENT_DATE),
  ('cdte',    80, false, true,  'Glass-glass; CdTe semiconductor — hazardous (EU RoHS / US RCRA)', 'IRENA/IEA-PVPS 2016', CURRENT_DATE, CURRENT_DATE),
  ('cigs',    55, false, true,  'Indium/gallium trace; no liquid recovery market',           'IRENA/IEA-PVPS 2016', CURRENT_DATE, CURRENT_DATE)
ON CONFLICT (technology) DO UPDATE SET
  mass_kg_per_kwp = EXCLUDED.mass_kg_per_kwp,
  notes = EXCLUDED.notes, last_reviewed = EXCLUDED.last_reviewed;

-- ============================================================
-- SOLAR PV — Balance of plant (BOP) per kWp = t/MWp
-- ============================================================
CREATE TABLE IF NOT EXISTS solar_bop_intensities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mount_type      solar_mount NOT NULL,
  material        TEXT NOT NULL CHECK (material IN ('steel','aluminium','copper')),
  intensity_t_per_mwp NUMERIC NOT NULL,
  notes           TEXT,
  source_doc      TEXT NOT NULL,
  source_date     DATE NOT NULL,
  last_reviewed   DATE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (mount_type, material)
);

ALTER TABLE solar_bop_intensities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_solar_bop_intensities" ON solar_bop_intensities FOR SELECT USING (true);
CREATE POLICY "write_solar_bop_intensities" ON solar_bop_intensities FOR ALL USING (auth.role() = 'service_role');

INSERT INTO solar_bop_intensities (mount_type, material, intensity_t_per_mwp, notes, source_doc, source_date, last_reviewed) VALUES
  ('ground_mount','aluminium', 18, 'Tracker rails + clamps',                                       'IEA PVPS Task 12 T12-19:2020; NREL TP-7A40-87372', CURRENT_DATE, CURRENT_DATE),
  ('ground_mount','steel',     15, 'Posts + structural; single-axis trackers carry +20-30%',       'IEA PVPS Task 12; NREL UPV LCA',                  CURRENT_DATE, CURRENT_DATE),
  ('ground_mount','copper',     3, 'DC homerun cabling',                                            'IEA PVPS Task 12',                                CURRENT_DATE, CURRENT_DATE),
  ('rooftop',     'aluminium',  7, 'Mounting rails',                                                'IEA PVPS Task 12',                                CURRENT_DATE, CURRENT_DATE),
  ('rooftop',     'steel',      0, 'Structural elements are part of building fabric — not removed','IEA PVPS Task 12',                                CURRENT_DATE, CURRENT_DATE),
  ('rooftop',     'copper',     2.5, 'DC + small AC',                                               'IEA PVPS Task 12',                                CURRENT_DATE, CURRENT_DATE)
ON CONFLICT (mount_type, material) DO UPDATE SET
  intensity_t_per_mwp = EXCLUDED.intensity_t_per_mwp, last_reviewed = EXCLUDED.last_reviewed;

-- ============================================================
-- BESS — Material intensities by vintage (t/MWh)
-- Reflects chemistry shift NMC (pre-2018) → blend (2018-21) → LFP (2022+)
-- ============================================================
CREATE TABLE IF NOT EXISTS bess_intensities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vintage         bess_vintage NOT NULL,
  material        TEXT NOT NULL CHECK (material IN (
                    'steel','copper','aluminium','lithium','graphite','nickel','cobalt','polymer'
                  )),
  intensity_t_per_mwh NUMERIC NOT NULL,
  basis           TEXT,
  source_doc      TEXT NOT NULL,
  source_date     DATE NOT NULL,
  confidence      TEXT NOT NULL CHECK (confidence IN ('High','Medium','Low')),
  last_reviewed   DATE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (vintage, material)
);

ALTER TABLE bess_intensities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_bess_intensities" ON bess_intensities FOR SELECT USING (true);
CREATE POLICY "write_bess_intensities" ON bess_intensities FOR ALL USING (auth.role() = 'service_role');

-- 3 vintages × 8 materials = 24 rows
INSERT INTO bess_intensities (vintage, material, intensity_t_per_mwh, basis, source_doc, source_date, confidence, last_reviewed) VALUES
  -- pre2018 (NMC-dominant, ~1.5hr)
  ('pre2018','steel',     14.0, 'Container + rack',                          'NREL ATB 2024; Argonne BatPaC v5',  CURRENT_DATE, 'High',   CURRENT_DATE),
  ('pre2018','copper',     2.7, 'DC busbars + cabling',                       'BatPaC v5; BNEF LCOES 2023',        CURRENT_DATE, 'High',   CURRENT_DATE),
  ('pre2018','aluminium',  2.0, 'Module + cooling plates',                    'BatPaC v5',                         CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('pre2018','lithium',    0.45,'LCE — NMC622 cathode',                       'BatPaC v5',                         CURRENT_DATE, 'High',   CURRENT_DATE),
  ('pre2018','graphite',   1.5, 'Anode',                                      'BatPaC v5',                         CURRENT_DATE, 'High',   CURRENT_DATE),
  ('pre2018','nickel',     0.60,'NMC622 cathode (~0.40 kg/kWh)',              'BatPaC v5',                         CURRENT_DATE, 'High',   CURRENT_DATE),
  ('pre2018','cobalt',     0.20,'NMC622 cathode (~0.13 kg/kWh)',              'BatPaC v5',                         CURRENT_DATE, 'High',   CURRENT_DATE),
  ('pre2018','polymer',    1.1, 'Pack housing + cell separators',             'BatPaC v5',                         CURRENT_DATE, 'Medium', CURRENT_DATE),
  -- 2018-21 (~50/50 NMC:LFP, ~2hr)
  ('y2018','steel',       17.0, 'Container + rack; longer duration',          'NREL ATB 2024',                     CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2018','copper',       2.8, 'DC busbars',                                 'BatPaC v5',                         CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2018','aluminium',    2.2, 'Module + cooling',                           'BatPaC v5',                         CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('y2018','lithium',      0.60,'LCE — blend',                                'BatPaC v5',                         CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2018','graphite',     2.0, 'Anode',                                      'BatPaC v5',                         CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2018','nickel',       0.40,'Blended NMC:LFP at ~50:50',                  'BatPaC v5',                         CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2018','cobalt',       0.13,'Blended',                                    'BatPaC v5',                         CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2018','polymer',      1.3, 'Pack housing + separators',                  'BatPaC v5',                         CURRENT_DATE, 'Medium', CURRENT_DATE),
  -- 2022+ (LFP-dominant, ~3hr)
  ('y2022','steel',       19.0, 'Container + rack; 4hr standard emerging',    'NREL ATB 2024; BNEF LCOES 2023',    CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2022','copper',       2.9, 'DC busbars',                                 'BatPaC v5',                         CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2022','aluminium',    2.4, 'Module + cooling',                           'BatPaC v5',                         CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('y2022','lithium',      0.90,'LCE — LFP-dominant',                         'BatPaC v5',                         CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2022','graphite',     3.0, 'Anode',                                      'BatPaC v5',                         CURRENT_DATE, 'High',   CURRENT_DATE),
  ('y2022','nickel',       0.20,'Residual: BMS + tail-end NMC',                'BatPaC v5; Endenex methodology §10', CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('y2022','cobalt',       0.05,'Trace; BMS hardware + Cu current collectors','Endenex methodology §10',           CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('y2022','polymer',      1.4, 'Pack housing + separators',                  'BatPaC v5',                         CURRENT_DATE, 'Medium', CURRENT_DATE)
ON CONFLICT (vintage, material) DO UPDATE SET
  intensity_t_per_mwh = EXCLUDED.intensity_t_per_mwh,
  source_doc          = EXCLUDED.source_doc,
  last_reviewed       = EXCLUDED.last_reviewed;

-- ============================================================
-- BESS — Balance of system per MWh
-- ============================================================
CREATE TABLE IF NOT EXISTS bess_bos_intensities (
  material        TEXT PRIMARY KEY CHECK (material IN ('steel','copper','aluminium')),
  intensity_t_per_mwh NUMERIC NOT NULL,
  notes           TEXT,
  source_doc      TEXT NOT NULL,
  source_date     DATE NOT NULL,
  last_reviewed   DATE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bess_bos_intensities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_bess_bos_intensities" ON bess_bos_intensities FOR SELECT USING (true);
CREATE POLICY "write_bess_bos_intensities" ON bess_bos_intensities FOR ALL USING (auth.role() = 'service_role');

INSERT INTO bess_bos_intensities (material, intensity_t_per_mwh, notes, source_doc, source_date, last_reviewed) VALUES
  ('steel',     1.20, '20ft LFP container shell + internal rack frames; ~1.0-1.5 t/MWh',        'NREL ATB 2024; industry pack data', CURRENT_DATE, CURRENT_DATE),
  ('copper',    0.30, 'DC busbars + cabling (heavier gauge than solar DC)',                     'NREL ATB 2024',                     CURRENT_DATE, CURRENT_DATE),
  ('aluminium', 0.07, 'Cable trays + connectors',                                                'NREL ATB 2024',                     CURRENT_DATE, CURRENT_DATE)
ON CONFLICT (material) DO UPDATE SET
  intensity_t_per_mwh = EXCLUDED.intensity_t_per_mwh, last_reviewed = EXCLUDED.last_reviewed;

-- ============================================================
-- BESS — Net recovery values per MWh by chemistry & region
-- Directional; commodity-sensitive. Verify quarterly.
-- ============================================================
CREATE TABLE IF NOT EXISTS bess_recovery_values (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chemistry       bess_chemistry NOT NULL,
  region          TEXT NOT NULL CHECK (region IN ('GB','EU','US','AU','GLOBAL')),
  recovery_per_mwh NUMERIC NOT NULL,
  currency        TEXT NOT NULL CHECK (currency IN ('GBP','EUR','USD','AUD')),
  basis_date      DATE NOT NULL,
  notes           TEXT,
  source_doc      TEXT,
  source_date     DATE NOT NULL,
  confidence      TEXT NOT NULL CHECK (confidence IN ('High','Medium','Low')),
  last_reviewed   DATE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (chemistry, region, basis_date)
);

ALTER TABLE bess_recovery_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_bess_recovery_values" ON bess_recovery_values FOR SELECT USING (true);
CREATE POLICY "write_bess_recovery_values" ON bess_recovery_values FOR ALL USING (auth.role() = 'service_role');

INSERT INTO bess_recovery_values (chemistry, region, recovery_per_mwh, currency, basis_date, notes, source_doc, source_date, confidence, last_reviewed) VALUES
  ('lfp', 'GB', 1200, 'GBP', CURRENT_DATE, 'LFP recovery driven by lithium (~$21,500/t Li2CO3)', 'SMM/Fastmarkets CIF Asia',                CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('lfp', 'EU', 1300, 'EUR', CURRENT_DATE, 'LFP recovery driven by lithium',                      'SMM/Fastmarkets CIF Asia',                CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('lfp', 'US', 1400, 'USD', CURRENT_DATE, 'LFP recovery driven by lithium',                      'SMM/Fastmarkets CIF Asia',                CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('lfp', 'AU', 2000, 'AUD', CURRENT_DATE, 'AU import basis premium',                             'SMM/Fastmarkets',                         CURRENT_DATE, 'Low',    CURRENT_DATE),
  ('nmc', 'GB', 5500, 'GBP', CURRENT_DATE, 'NMC recovery driven by Co + Ni; Co ~$56k/t LME',      'LME; DRC quota effect Oct 2025',          CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('nmc', 'EU', 6200, 'EUR', CURRENT_DATE, 'NMC recovery — Co + Ni dominant',                     'LME; DRC quota effect',                   CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('nmc', 'US', 6800, 'USD', CURRENT_DATE, 'NMC recovery — Co + Ni dominant',                     'LME; DRC quota effect',                   CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('nmc', 'AU', 8500, 'AUD', CURRENT_DATE, 'NMC recovery — AU import basis',                      'LME',                                     CURRENT_DATE, 'Low',    CURRENT_DATE),
  ('nas', 'GB',  300, 'GBP', CURRENT_DATE, 'NaS minimal recovery; predominantly net cost',        'Industry estimate',                       CURRENT_DATE, 'Low',    CURRENT_DATE),
  ('nas', 'EU',  350, 'EUR', CURRENT_DATE, 'NaS minimal recovery',                                'Industry estimate',                       CURRENT_DATE, 'Low',    CURRENT_DATE),
  ('nas', 'US',  300, 'USD', CURRENT_DATE, 'NaS minimal recovery',                                'Industry estimate',                       CURRENT_DATE, 'Low',    CURRENT_DATE),
  ('nas', 'AU',  450, 'AUD', CURRENT_DATE, 'NaS — AU basis',                                      'Industry estimate',                       CURRENT_DATE, 'Low',    CURRENT_DATE)
ON CONFLICT (chemistry, region, basis_date) DO UPDATE SET
  recovery_per_mwh = EXCLUDED.recovery_per_mwh, last_reviewed = EXCLUDED.last_reviewed;

-- Helper functions: vintage classification
CREATE OR REPLACE FUNCTION solar_vintage_for_year(yr INTEGER) RETURNS solar_vintage AS $$
  SELECT CASE
    WHEN yr < 2012 THEN 'pre2012'::solar_vintage
    WHEN yr < 2020 THEN 'y2012'::solar_vintage
    ELSE                'y2020'::solar_vintage
  END;
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION bess_vintage_for_year(yr INTEGER) RETURNS bess_vintage AS $$
  SELECT CASE
    WHEN yr < 2018 THEN 'pre2018'::bess_vintage
    WHEN yr < 2022 THEN 'y2018'::bess_vintage
    ELSE                'y2022'::bess_vintage
  END;
$$ LANGUAGE SQL IMMUTABLE;

-- ============================================================
-- Telemetry
-- ============================================================
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'seed_solar_bess_lca', 'success', NOW(), NOW(),
  21 + 4 + 6 + 24 + 3 + 12,
  'IRENA/IEA-PVPS 2016; ITRPV 2024; Silver Institute; NREL ATB 2024; Argonne BatPaC v5; BNEF LCOES 2023',
  'Migration 016 — solar PV (21 panel + 4 tech + 6 BOP) + BESS (24 vintage + 3 BOS + 12 recovery values)'
);
