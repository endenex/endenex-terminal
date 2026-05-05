-- Migration 013 — Vintage-bucketed wind LCA + three-layer recovery model
--
-- Brings the Terminal in line with website methodology §3, §5, §6, §15:
--   1. Vintage-bucketed material intensities (pre2005 / 2005-09 / 2010-14 / 2015+)
--   2. Two scope versions: full (inter-turbine cables in scope) vs repowering (turbine only)
--   3. Material taxonomy expanded: zinc, composite (GRP), polymer added
--   4. Three distinct recovery concepts modelled separately:
--        a. Metallurgical recovery rate (95% steel etc.) — physics
--        b. Merchant contamination yield (88% ferrous, 92% non-ferrous) — haul-to-sold mass
--        c. Broker margin (30% default) — what owner actually receives
--
-- The legacy turbine_material_profiles table is retained for OEM-specific work.
-- New tables here are fleet-level vintage averages used by DCI / SMI / Portfolio.

-- ============================================================
-- ENUM types
-- ============================================================
DO $$ BEGIN
  CREATE TYPE wind_vintage_bracket AS ENUM ('pre2005','y2005','y2010','y2015');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE wind_scope AS ENUM ('full','repowering');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- WIND MATERIAL INTENSITIES — vintage × scope × material
-- ============================================================
CREATE TABLE IF NOT EXISTS wind_material_intensities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vintage         wind_vintage_bracket NOT NULL,
  scope           wind_scope NOT NULL,
  material        TEXT NOT NULL CHECK (material IN (
                    'steel','castiron','composite','copper','aluminium',
                    'zinc','polymer','rareearth'
                  )),
  volume_per_mw   NUMERIC NOT NULL,            -- t/MW

  source_doc      TEXT NOT NULL,
  source_type     TEXT NOT NULL DEFAULT 'OEM LCA / Academic',
  source_date     DATE NOT NULL,
  confidence      TEXT NOT NULL CHECK (confidence IN ('High','Medium','Low')),
  derivation      TEXT NOT NULL CHECK (derivation IN ('Observed','Inferred','Modelled')),
  last_reviewed   DATE NOT NULL,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (vintage, scope, material)
);

CREATE INDEX IF NOT EXISTS idx_wind_intensity_lookup
  ON wind_material_intensities (vintage, scope, material);

ALTER TABLE wind_material_intensities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_wind_material_intensities"
  ON wind_material_intensities FOR SELECT USING (true);
CREATE POLICY "write_wind_material_intensities"
  ON wind_material_intensities FOR ALL USING (auth.role() = 'service_role');

CREATE TRIGGER wind_material_intensities_updated_at
  BEFORE UPDATE ON wind_material_intensities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Seed: 4 vintages × 2 scopes × 8 materials = 64 rows ─────────────────────
DO $$
DECLARE today_d DATE := CURRENT_DATE;
BEGIN

INSERT INTO wind_material_intensities
  (vintage, scope, material, volume_per_mw, source_doc, source_date, confidence, derivation, last_reviewed)
VALUES
  -- pre2005 — full scope
  ('pre2005','full','steel',     128.0, 'Vestas LCA V47/V80; NREL REMPD (2023)',                 today_d, 'High',   'Observed', today_d),
  ('pre2005','full','castiron',   42.0, 'Vestas LCA V47/V80; Enercon E-66 LCA',                  today_d, 'High',   'Observed', today_d),
  ('pre2005','full','composite',   8.0, 'NREL REMPD (2023); IRENA (2017)',                        today_d, 'Medium', 'Observed', today_d),
  ('pre2005','full','copper',      5.0, 'Vestas LCA + inter-turbine cabling estimate',            today_d, 'High',   'Observed', today_d),
  ('pre2005','full','aluminium',   1.5, 'Vestas LCA series',                                      today_d, 'Medium', 'Inferred', today_d),
  ('pre2005','full','zinc',        0.8, 'Galvanised tower coating; Martínez et al. 2009',         today_d, 'Medium', 'Modelled', today_d),
  ('pre2005','full','polymer',     2.5, 'Inter-turbine cable sheathing + nacelle cabling',        today_d, 'Medium', 'Inferred', today_d),
  ('pre2005','full','rareearth',   0.0, 'No PMG turbines in pre-2005 fleet (DFIG / EESG only)',   today_d, 'High',   'Observed', today_d),

  -- pre2005 — repowering scope (turbine-only copper, no buried cables)
  ('pre2005','repowering','steel',    128.0, 'Vestas LCA V47/V80',                                 today_d, 'High',   'Observed', today_d),
  ('pre2005','repowering','castiron',  42.0, 'Vestas LCA + Enercon E-66',                          today_d, 'High',   'Observed', today_d),
  ('pre2005','repowering','composite',  8.0, 'NREL REMPD (2023)',                                  today_d, 'Medium', 'Observed', today_d),
  ('pre2005','repowering','copper',     3.5, 'Vestas LCA — turbine only (excl. inter-turbine cables)', today_d, 'High', 'Observed', today_d),
  ('pre2005','repowering','aluminium',  1.5, 'Vestas LCA series',                                  today_d, 'Medium', 'Inferred', today_d),
  ('pre2005','repowering','zinc',       0.8, 'Galvanised tower coating',                           today_d, 'Medium', 'Modelled', today_d),
  ('pre2005','repowering','polymer',    0.8, 'Turbine-level cabling only (no buried cable sheathing)', today_d, 'Medium', 'Inferred', today_d),
  ('pre2005','repowering','rareearth',  0.0, 'No PMG in pre-2005',                                 today_d, 'High',   'Observed', today_d),

  -- 2005-09 — full scope
  ('y2005','full','steel',     109.0, 'Vestas V82/V90 LCA; NREL REMPD (2023)',                   today_d, 'High',   'Observed', today_d),
  ('y2005','full','castiron',   36.0, 'Vestas V82/V90 LCA',                                       today_d, 'High',   'Observed', today_d),
  ('y2005','full','composite',  11.0, 'NREL REMPD (2023); blade growth observed',                 today_d, 'Medium', 'Observed', today_d),
  ('y2005','full','copper',      4.0, 'Vestas LCA + inter-turbine cabling',                       today_d, 'High',   'Observed', today_d),
  ('y2005','full','aluminium',   1.3, 'Vestas LCA series',                                        today_d, 'Medium', 'Inferred', today_d),
  ('y2005','full','zinc',        0.6, 'Galvanised tower; lighter tower designs',                  today_d, 'Medium', 'Modelled', today_d),
  ('y2005','full','polymer',     2.2, 'Cable sheathing + nacelle cabling',                        today_d, 'Medium', 'Inferred', today_d),
  ('y2005','full','rareearth',  0.01, 'Trace — early PMG platforms (10 kg NdPr per MW)',          today_d, 'Low',    'Modelled', today_d),

  -- 2005-09 — repowering
  ('y2005','repowering','steel',    109.0, 'Vestas V82/V90 LCA',                                  today_d, 'High',   'Observed', today_d),
  ('y2005','repowering','castiron',  36.0, 'Vestas V82/V90 LCA',                                  today_d, 'High',   'Observed', today_d),
  ('y2005','repowering','composite', 11.0, 'NREL REMPD (2023)',                                   today_d, 'Medium', 'Observed', today_d),
  ('y2005','repowering','copper',     2.8, 'Turbine only; -1.2 t/MW for inter-turbine cables',    today_d, 'High',   'Observed', today_d),
  ('y2005','repowering','aluminium',  1.3, 'Vestas LCA',                                          today_d, 'Medium', 'Inferred', today_d),
  ('y2005','repowering','zinc',       0.6, 'Galvanised tower',                                    today_d, 'Medium', 'Modelled', today_d),
  ('y2005','repowering','polymer',    0.7, 'Turbine-level cabling only',                          today_d, 'Medium', 'Inferred', today_d),
  ('y2005','repowering','rareearth', 0.01, 'Trace early PMG',                                     today_d, 'Low',    'Modelled', today_d),

  -- 2010-14 — full scope
  ('y2010','full','steel',     101.0, 'Vestas V90-3.0/V100/V112; SGRE SG2.5; GE 1.5/1.6',        today_d, 'High',   'Observed', today_d),
  ('y2010','full','castiron',   34.0, 'Vestas/SGRE/GE LCA composite',                            today_d, 'High',   'Observed', today_d),
  ('y2010','full','composite',  13.0, 'Larger blades — DecomBlades dataset',                      today_d, 'Medium', 'Observed', today_d),
  ('y2010','full','copper',      3.5, 'Vestas/SGRE LCA + inter-turbine cabling',                  today_d, 'High',   'Observed', today_d),
  ('y2010','full','aluminium',   1.3, 'Vestas/SGRE LCA',                                          today_d, 'Medium', 'Inferred', today_d),
  ('y2010','full','zinc',        0.6, 'Galvanised tower coating',                                 today_d, 'Medium', 'Modelled', today_d),
  ('y2010','full','polymer',     2.0, 'Cable sheathing + cabling',                                today_d, 'Medium', 'Inferred', today_d),
  ('y2010','full','rareearth',  0.03, '~30 kg NdPr per MW; SGRE direct-drive PMG share growing',  today_d, 'Low',    'Modelled', today_d),

  -- 2010-14 — repowering
  ('y2010','repowering','steel',    101.0, 'Vestas/SGRE/GE LCA',                                  today_d, 'High',   'Observed', today_d),
  ('y2010','repowering','castiron',  34.0, 'Vestas/SGRE/GE LCA composite',                        today_d, 'High',   'Observed', today_d),
  ('y2010','repowering','composite', 13.0, 'DecomBlades dataset',                                 today_d, 'Medium', 'Observed', today_d),
  ('y2010','repowering','copper',     2.3, 'Turbine only; -1.2 t/MW vs full scope',               today_d, 'High',   'Observed', today_d),
  ('y2010','repowering','aluminium',  1.3, 'Vestas/SGRE LCA',                                     today_d, 'Medium', 'Inferred', today_d),
  ('y2010','repowering','zinc',       0.6, 'Galvanised tower',                                    today_d, 'Medium', 'Modelled', today_d),
  ('y2010','repowering','polymer',    0.6, 'Turbine-level cabling only',                          today_d, 'Medium', 'Inferred', today_d),
  ('y2010','repowering','rareearth', 0.03, '~30 kg NdPr per MW',                                  today_d, 'Low',    'Modelled', today_d),

  -- 2015+ — full scope
  ('y2015','full','steel',      90.0, 'Vestas V117/V136; SGRE SG3.4-132; Nordex N117/N131',      today_d, 'High',   'Observed', today_d),
  ('y2015','full','castiron',   30.0, 'Modern OEM LCA composite',                                 today_d, 'High',   'Observed', today_d),
  ('y2015','full','composite',  15.0, 'Larger blades; DecomBlades + Beauson et al. 2022',         today_d, 'Medium', 'Observed', today_d),
  ('y2015','full','copper',      3.0, 'Vestas/SGRE LCA + inter-turbine cabling',                  today_d, 'High',   'Observed', today_d),
  ('y2015','full','aluminium',   1.2, 'Modern OEM LCA',                                           today_d, 'Medium', 'Inferred', today_d),
  ('y2015','full','zinc',        0.5, 'Lighter tower coatings',                                   today_d, 'Medium', 'Modelled', today_d),
  ('y2015','full','polymer',     1.8, 'Cable sheathing + cabling',                                today_d, 'Medium', 'Inferred', today_d),
  ('y2015','full','rareearth',  0.05, '~50 kg NdPr per MW; PMG share at ~20% of installed fleet', today_d, 'Low',    'Modelled', today_d),

  -- 2015+ — repowering
  ('y2015','repowering','steel',     90.0, 'Vestas V117/V136; SGRE SG3.4-132',                    today_d, 'High',   'Observed', today_d),
  ('y2015','repowering','castiron',  30.0, 'Modern OEM LCA',                                      today_d, 'High',   'Observed', today_d),
  ('y2015','repowering','composite', 15.0, 'DecomBlades; Beauson et al. 2022',                    today_d, 'Medium', 'Observed', today_d),
  ('y2015','repowering','copper',     2.0, 'Turbine only; -1.0 t/MW vs full',                     today_d, 'High',   'Observed', today_d),
  ('y2015','repowering','aluminium',  1.2, 'Modern OEM LCA',                                      today_d, 'Medium', 'Inferred', today_d),
  ('y2015','repowering','zinc',       0.5, 'Galvanised tower',                                    today_d, 'Medium', 'Modelled', today_d),
  ('y2015','repowering','polymer',    0.5, 'Turbine-level cabling only',                          today_d, 'Medium', 'Inferred', today_d),
  ('y2015','repowering','rareearth', 0.05, '~50 kg NdPr per MW',                                  today_d, 'Low',    'Modelled', today_d)
ON CONFLICT (vintage, scope, material) DO UPDATE SET
  volume_per_mw = EXCLUDED.volume_per_mw,
  source_doc    = EXCLUDED.source_doc,
  last_reviewed = EXCLUDED.last_reviewed,
  updated_at    = NOW();

END $$;

-- Helper function: pick vintage from commissioning year
CREATE OR REPLACE FUNCTION wind_vintage_for_year(yr INTEGER) RETURNS wind_vintage_bracket AS $$
  SELECT CASE
    WHEN yr < 2005 THEN 'pre2005'::wind_vintage_bracket
    WHEN yr < 2010 THEN 'y2005'::wind_vintage_bracket
    WHEN yr < 2015 THEN 'y2010'::wind_vintage_bracket
    ELSE                'y2015'::wind_vintage_bracket
  END;
$$ LANGUAGE SQL IMMUTABLE;

-- ============================================================
-- LAYER 1: METALLURGICAL RECOVERY RATES (physics)
-- Per methodology §5: shredder/EAF, smelter, etc. yield rates.
-- ============================================================
CREATE TABLE IF NOT EXISTS metallurgical_recovery_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material        TEXT NOT NULL CHECK (material IN (
                    'steel','castiron','copper','aluminium','zinc',
                    'rareearth','composite','polymer',
                    'glass','silicon','silver',
                    'lithium','graphite','nickel','cobalt'
                  )),
  rate            NUMERIC NOT NULL CHECK (rate >= 0 AND rate <= 1),
  pathway         TEXT NOT NULL,                      -- 'Shredder/EAF', 'Strip+smelt', etc.
  rationale       TEXT,
  source_type     TEXT NOT NULL DEFAULT 'Industry / Academic',
  source_date     DATE NOT NULL,
  confidence      TEXT NOT NULL CHECK (confidence IN ('High','Medium','Low')),
  last_reviewed   DATE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (material)
);

ALTER TABLE metallurgical_recovery_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_metallurgical_recovery_rates" ON metallurgical_recovery_rates FOR SELECT USING (true);
CREATE POLICY "write_metallurgical_recovery_rates" ON metallurgical_recovery_rates FOR ALL USING (auth.role() = 'service_role');

INSERT INTO metallurgical_recovery_rates
  (material, rate, pathway, rationale, source_date, confidence, last_reviewed)
VALUES
  ('steel',     0.95, 'Shredder / EAF',          '5% loss = mill scale, slag, fines',                             CURRENT_DATE, 'High',   CURRENT_DATE),
  ('castiron',  0.95, 'Shredder / foundry',      'Large clean castings, minimal contamination',                   CURRENT_DATE, 'High',   CURRENT_DATE),
  ('copper',    0.90, 'Strip + smelt',           '~5% strip loss + ~5% smelter oxidation',                        CURRENT_DATE, 'High',   CURRENT_DATE),
  ('aluminium', 0.92, 'Remelt',                  '~3% oxide layer + ~5% dross loss',                              CURRENT_DATE, 'High',   CURRENT_DATE),
  ('zinc',      0.85, 'Waelz kiln',              'Hot-dip galvanised tower; 15% loss to oxidation/slag',          CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('rareearth', 0.60, 'Magnet recycling',        'Commercial scale immature in 2026; lab/pilot achieves 85-90%',  CURRENT_DATE, 'Low',    CURRENT_DATE),
  ('composite', 0.00, 'No commercial pathway',   'Cement co-processing = waste treatment, not material recovery', CURRENT_DATE, 'High',   CURRENT_DATE),
  ('polymer',   0.00, 'No recovery value',       'Mixed cable sheathing has no commodity value',                  CURRENT_DATE, 'High',   CURRENT_DATE),
  -- Solar
  ('glass',     0.90, 'Thermal-mechanical',      'Well-established pathway',                                      CURRENT_DATE, 'High',   CURRENT_DATE),
  ('silicon',   0.70, 'Wet chemistry',           'Commercially available at specialist operators',                CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('silver',    0.65, 'Acid leach',              'Conservative; many recyclers skip the leach step',              CURRENT_DATE, 'Medium', CURRENT_DATE),
  -- BESS
  ('lithium',   0.80, 'Hydromet (LFP route)',    'Tighter than NMC due to LFP process economics',                 CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('graphite',  0.50, 'Partial recovery',        'Limited commercial infrastructure (2026)',                      CURRENT_DATE, 'Low',    CURRENT_DATE),
  ('nickel',    0.85, 'Hydromet leach/SX',       'NMC622 recoverable fraction',                                   CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('cobalt',    0.90, 'Hydromet',                'Highest-value BESS cathode material',                           CURRENT_DATE, 'High',   CURRENT_DATE)
ON CONFLICT (material) DO UPDATE SET
  rate = EXCLUDED.rate, pathway = EXCLUDED.pathway, rationale = EXCLUDED.rationale, last_reviewed = EXCLUDED.last_reviewed;

-- ============================================================
-- LAYER 2: MERCHANT CONTAMINATION YIELDS (haul-to-sold)
-- Per methodology §15 / §19: merchant-side mass loss applied to physical haul.
-- ============================================================
CREATE TABLE IF NOT EXISTS merchant_contamination_yields (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_class  TEXT NOT NULL CHECK (material_class IN ('ferrous','non_ferrous','rare_earth')),
  region          TEXT NOT NULL CHECK (region IN ('EU','GB','US','GLOBAL')),
  yield_rate      NUMERIC NOT NULL CHECK (yield_rate >= 0 AND yield_rate <= 1),
  rationale       TEXT,
  source_date     DATE NOT NULL,
  confidence      TEXT NOT NULL CHECK (confidence IN ('High','Medium','Low')),
  last_reviewed   DATE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (material_class, region)
);

ALTER TABLE merchant_contamination_yields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_merchant_contamination_yields" ON merchant_contamination_yields FOR SELECT USING (true);
CREATE POLICY "write_merchant_contamination_yields" ON merchant_contamination_yields FOR ALL USING (auth.role() = 'service_role');

INSERT INTO merchant_contamination_yields (material_class, region, yield_rate, rationale, source_date, confidence, last_reviewed) VALUES
  ('ferrous',     'GLOBAL', 0.88, '12% lost to contamination, paint, concrete debris at merchant yard',  CURRENT_DATE, 'High', CURRENT_DATE),
  ('non_ferrous', 'GLOBAL', 0.92, '8% lost to sheathing, varnish, bonded composites',                    CURRENT_DATE, 'High', CURRENT_DATE),
  ('rare_earth',  'GLOBAL', 0.75, 'Higher loss in magnet separation; conservative',                      CURRENT_DATE, 'Medium', CURRENT_DATE)
ON CONFLICT (material_class, region) DO UPDATE SET
  yield_rate = EXCLUDED.yield_rate, last_reviewed = EXCLUDED.last_reviewed;

-- ============================================================
-- LAYER 3: BROKER MARGINS (what the asset owner actually receives)
-- Per methodology §19: scrap broker takes a cut between merchant price and owner.
-- Range 15-45% depending on broker, distance, grade, conditions.
-- ============================================================
CREATE TABLE IF NOT EXISTS broker_margins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region          TEXT NOT NULL CHECK (region IN ('EU','GB','US','GLOBAL')),
  margin_low      NUMERIC NOT NULL CHECK (margin_low >= 0 AND margin_low <= 1),
  margin_default  NUMERIC NOT NULL CHECK (margin_default >= 0 AND margin_default <= 1),
  margin_high     NUMERIC NOT NULL CHECK (margin_high >= 0 AND margin_high <= 1),
  rationale       TEXT,
  source_date     DATE NOT NULL,
  confidence      TEXT NOT NULL CHECK (confidence IN ('High','Medium','Low')),
  last_reviewed   DATE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (region)
);

ALTER TABLE broker_margins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_broker_margins" ON broker_margins FOR SELECT USING (true);
CREATE POLICY "write_broker_margins" ON broker_margins FOR ALL USING (auth.role() = 'service_role');

INSERT INTO broker_margins (region, margin_low, margin_default, margin_high, rationale, source_date, confidence, last_reviewed) VALUES
  ('GB',     0.15, 0.30, 0.45, 'UK scrap broker margin; range observed across brokers, distances, grades', CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('EU',     0.15, 0.30, 0.45, 'EEA scrap broker margin; comparable to UK structure',                       CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('US',     0.12, 0.25, 0.40, 'US Midwest broker margin; tighter than UK/EEA due to deeper market',        CURRENT_DATE, 'Medium', CURRENT_DATE),
  ('GLOBAL', 0.15, 0.30, 0.45, 'Default fallback when region-specific data unavailable',                    CURRENT_DATE, 'Low',    CURRENT_DATE)
ON CONFLICT (region) DO UPDATE SET
  margin_low = EXCLUDED.margin_low, margin_default = EXCLUDED.margin_default,
  margin_high = EXCLUDED.margin_high, last_reviewed = EXCLUDED.last_reviewed;

-- ============================================================
-- DEPRECATE merchant_markups (keep for legacy; flag deprecated)
-- ============================================================
COMMENT ON TABLE merchant_markups IS
  'DEPRECATED in v1.1 — superseded by broker_margins (% margin) + merchant_contamination_yields (mass yield). Retained for legacy data. New compute pipelines should use the three-layer model from migration 013.';

-- ============================================================
-- Telemetry
-- ============================================================
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'seed_vintage_lca_and_recovery_layers', 'success', NOW(), NOW(),
  64 + 15 + 3 + 4,
  'Vestas LCA series, NREL REMPD (2023), DecomBlades, Beauson et al. 2022, IRENA',
  'Migration 013 — seeded 64 vintage×scope×material rows + 15 metallurgical rates + 3 contamination yields + 4 broker margins'
);
