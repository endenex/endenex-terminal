-- Migration 040 — Link material intensities to scrap grades
--
-- Recoverability % captures PHYSICAL mass recovery ("we pull 95% of cast
-- iron out of the wreck"). It does NOT capture VALUE — cast iron from
-- a turbine hub fetches ~70% of HMS 1&2 steel pricing at the merchant
-- because it's a different scrap grade.
--
-- This migration adds:
--   • cast_iron_general to scrap_price_benchmarks.material enum
--     (we'd missed it in the original constraint)
--   • scrap_grade column on material_intensities, mapping each row to a
--     specific tradable benchmark in scrap_price_benchmarks.material
--   • Backfilled scrap_grade for every existing seed row, with explicit
--     NULL for materials with no clean tradable grade (waste fractions,
--     hazardous fractions, sui-generis closed-loop streams)
--
-- After this lands, joins between material_intensities_v and
-- scrap_price_benchmarks become straightforward — once Argus prices flow
-- in, the Material Intensity Calculator can compute Value-Yield-per-MW.

-- ── (1) Extend the scrap_price_benchmarks material enum ─────────────────

ALTER TABLE scrap_price_benchmarks
  DROP CONSTRAINT IF EXISTS scrap_price_benchmarks_material_check;

ALTER TABLE scrap_price_benchmarks
  ADD  CONSTRAINT scrap_price_benchmarks_material_check
  CHECK (material IN (
    -- Steel
    'steel_hms_1','steel_hms_2','steel_hms_1_2_8020',
    'steel_busheling','steel_shred',
    'cast_iron_general',                                  -- NEW: hubs, gearbox housings, etc.
    -- Copper
    'copper_no_1','copper_no_2','copper_birch_cliff',
    -- Aluminium
    'aluminium_taint_tabor','aluminium_zorba','aluminium_twitch',
    'aluminium_tense','aluminium_alloy_356',
    -- Solar PV
    'silicon_solar','silver_solar_grade','glass_pv_cullet',
    -- Battery / critical metals
    'lithium_carbonate','lithium_hydroxide',
    'cobalt_metal','nickel_class_1','manganese_ore',
    'graphite_synthetic','rare_earth_neodymium',
    -- Composites
    'composite_blade_glass_fibre','composite_blade_carbon_fibre'
  ));

-- ── (2) Add scrap_grade column to material_intensities ──────────────────
--
-- Free text rather than FK so the schema doesn't fragment when we add
-- new grades. The Material Intensity Calculator joins by string match
-- against scrap_price_benchmarks.material when looking up prices.

ALTER TABLE material_intensities
  ADD COLUMN IF NOT EXISTS scrap_grade text;

COMMENT ON COLUMN material_intensities.scrap_grade IS
  'Tradable scrap grade benchmark (e.g. steel_hms_1_2_8020, cast_iron_general). '
  'Joins string-wise to scrap_price_benchmarks.material. NULL for fractions '
  'with no open-market scrap grade — waste (eva, backsheet), hazardous '
  '(electrolyte_lipf6), or closed-loop (cadmium_telluride, iron_phosphate '
  'in black mass).';

CREATE INDEX IF NOT EXISTS material_intensities_grade_idx
  ON material_intensities (scrap_grade)
  WHERE scrap_grade IS NOT NULL;

-- ── (3) Backfill scrap_grade for every existing seed row ────────────────
--
-- Mapping decisions:
--
--   Wind tower steel               → steel_hms_1_2_8020 (mixed grade, mill input)
--   Wind cast iron (hubs/gearbox)  → cast_iron_general (~70% of HMS price)
--   Wind generator copper cabling  → copper_no_2 (insulated, mixed gauge)
--   Wind nacelle aluminium cabling → aluminium_taint_tabor (clean Al with attachments)
--   Wind blade GFRP                → composite_blade_glass_fibre (specialty stream)
--   Wind PMG NdFeB magnets         → rare_earth_neodymium (specialty market)
--
--   Solar glass                    → glass_pv_cullet (cullet recovery)
--   Solar aluminium frame          → aluminium_taint_tabor
--   Solar silicon                  → silicon_solar (high-purity stream)
--   Solar silver metallisation     → silver_solar_grade (specialty)
--   Solar copper ribbons           → copper_no_2
--
--   BESS steel casing/racking      → steel_shred (structural mild steel)
--   BESS Li carbonate equivalent   → lithium_carbonate
--   BESS nickel                    → nickel_class_1
--   BESS cobalt                    → cobalt_metal
--   BESS manganese                 → manganese_ore
--   BESS graphite                  → graphite_synthetic
--   BESS copper foil (anode)       → copper_no_1 (clean foil = high grade)
--   BESS aluminium foil (cathode)  → aluminium_twitch (clean Al)
--
--   NULL (no open-market grade):
--     eva, backsheet, electrolyte_lipf6, plastic_separator,
--     iron_phosphate (bundled in black mass), cadmium_telluride
--     (closed-loop, First Solar internal recycling)

UPDATE material_intensities mi
   SET scrap_grade = CASE
     -- Steel — distinguish wind tower vs BESS structural by subclass
     WHEN material = 'steel' AND material_subclass IN ('casing_racking') THEN 'steel_shred'
     WHEN material = 'steel'                                              THEN 'steel_hms_1_2_8020'

     WHEN material = 'cast_iron'                                          THEN 'cast_iron_general'

     -- Copper — distinguish BESS foil (high grade) vs wind/solar cabling (No.2)
     WHEN material = 'copper' AND material_subclass = 'current_coll_anode' THEN 'copper_no_1'
     WHEN material = 'copper'                                              THEN 'copper_no_2'

     -- Aluminium — distinguish BESS foil (high grade) vs other (taint/tabor)
     WHEN material = 'aluminium' AND material_subclass = 'current_coll_cathode' THEN 'aluminium_twitch'
     WHEN material = 'aluminium'                                                 THEN 'aluminium_taint_tabor'

     WHEN material = 'composite_gfrp'                                     THEN 'composite_blade_glass_fibre'
     WHEN material = 'permanent_magnet_ndfeb'                             THEN 'rare_earth_neodymium'

     WHEN material = 'glass'                                              THEN 'glass_pv_cullet'
     WHEN material = 'silicon'                                            THEN 'silicon_solar'
     WHEN material = 'silver'                                             THEN 'silver_solar_grade'

     WHEN material = 'lithium_carbonate_eq'                               THEN 'lithium_carbonate'
     WHEN material = 'nickel'                                             THEN 'nickel_class_1'
     WHEN material = 'cobalt'                                             THEN 'cobalt_metal'
     WHEN material = 'manganese'                                          THEN 'manganese_ore'
     WHEN material = 'graphite'                                           THEN 'graphite_synthetic'

     -- Explicit NULL: no open-market scrap grade
     WHEN material IN ('eva','backsheet','electrolyte_lipf6','plastic_separator',
                       'iron_phosphate','cadmium_telluride')              THEN NULL

     ELSE NULL
   END
 WHERE scrap_grade IS NULL;

-- ── (4) Recreate convenience view to expose scrap_grade ─────────────────

DROP VIEW IF EXISTS material_intensities_v;

CREATE VIEW material_intensities_v AS
SELECT
  m.id                      AS oem_model_id,
  m.asset_class,
  m.manufacturer,
  m.model_name,
  m.technology,
  m.rated_capacity_value,
  m.rated_capacity_unit,
  m.introduction_year,
  m.status,
  i.material,
  i.material_subclass,
  i.scrap_grade,                                          -- NEW
  i.intensity_value,
  i.intensity_unit,
  i.recoverability_pct,
  i.recoverability_basis,
  CASE WHEN i.recoverability_pct IS NOT NULL
       THEN ROUND((i.intensity_value * i.recoverability_pct / 100)::numeric, 2)
       ELSE NULL
  END AS recoverable_intensity_value,
  i.source_publication,
  i.source_url,
  i.source_year,
  i.confidence
FROM oem_models m
LEFT JOIN material_intensities i ON i.oem_model_id = m.id;

-- ── (5) Telemetry ────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_040_scrap_grade_link', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM material_intensities WHERE scrap_grade IS NOT NULL),
  'Migration 040 — scrap_grade dimension on material_intensities',
  'Added cast_iron_general to scrap_price_benchmarks enum. Backfilled scrap_grade across all seeded material rows; NULL where no open-market grade exists (eva, backsheet, electrolyte, iron phosphate, CdTe).'
);
