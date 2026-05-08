-- Migration 044 — Clean up Scrap Prices: drop refined-metal benchmarks +
-- battery-internal metals + fix misleading 'GLOBAL' region tags.
--
-- Two domain corrections from analyst review:
--
-- 1. 'GLOBAL' isn't a real geography for metal prices. LME settles in
--    London with regional premiums on top; CIF Asia black mass deals
--    happen at Korea/Japan/China hubs; OPIS Global Polysilicon Marker
--    is specifically the EX-CHINA supply benchmark. Renaming the
--    region tags to be honest about this.
--
-- 2. If asset owners sell BLACK MASS, they don't sell the individual
--    cathode/anode metals. Listing Cobalt / Nickel / Lithium carbonate /
--    Manganese / Synthetic graphite in scrap_price_benchmarks conflates
--    REFINER inputs (which downstream hydromet recyclers buy on LME or
--    SHFE) with what an ASSET OWNER actually sells at decommissioning
--    (which is black mass priced by chemistry).
--
--    Same simplification we did to material_intensities in Migration 043,
--    now applied to the price benchmarks side.
--
-- LME basis data for Historical Prices & Basis panel (still pending) will
-- come from `commodity_prices` table populated by yfinance daily — not
-- duplicated here.

-- ── (1) Extend region CHECK constraint FIRST so subsequent UPDATEs pass ─
-- (Previously the constraint allowed only EU/GB/US/CN/IN/GLOBAL; we need
-- LDN/ASIA/EX-CN/TR for honest geography tagging.)

ALTER TABLE scrap_price_benchmarks
  DROP CONSTRAINT IF EXISTS scrap_price_benchmarks_region_check;

ALTER TABLE scrap_price_benchmarks
  ADD  CONSTRAINT scrap_price_benchmarks_region_check
  CHECK (region IN (
    'EU','GB','US','CN','IN',          -- existing geography
    'TR',                              -- HMS CFR Turkey is a delivery-specific hub
    'ASIA',                            -- Asia hub (CIF Korea/Japan/China)
    'LDN',                             -- LME / LBMA London settlements
    'EX-CN',                           -- OPIS non-China supply benchmarks
    'GLOBAL'                           -- kept as fallback for genuinely global indices
  ));

-- ── (2) Delete benchmarks not surfaced to asset owners ──────────────────

DELETE FROM scrap_price_benchmarks
 WHERE material IN (
   -- Refined-metal benchmarks (LME settlements — refiner inputs, not
   -- what asset owners sell):
   'cobalt_metal', 'nickel_class_1',
   -- Battery-internal materials (locked in cells, sold inside black mass):
   'lithium_carbonate', 'lithium_hydroxide',
   'manganese_ore', 'graphite_synthetic'
 );

-- Also drop the LME copper / aluminium "basis reference" rows added in
-- Migration 042 that conflated refined-metal benchmarks with scrap grades
-- (they used material='copper_no_1' / 'aluminium_twitch' but were really
-- LME settlements). Identifiable by publisher='lme' on those material codes.

DELETE FROM scrap_price_benchmarks
 WHERE publisher = 'lme'
   AND material IN ('copper_no_1', 'aluminium_twitch');

-- ── (3) Update region tags to be honest about geography ─────────────────

-- LBMA silver — set in London
UPDATE scrap_price_benchmarks
   SET region = 'LDN'
 WHERE material = 'silver_solar_grade'
   AND region   = 'GLOBAL';

-- OPIS Global Polysilicon Marker — explicitly the non-China supply benchmark
UPDATE scrap_price_benchmarks
   SET region = 'EX-CN'
 WHERE material = 'silicon_solar'
   AND region   = 'GLOBAL';

-- Black mass GLOBAL CIF Asia rows — actually Asia hub prices (Korea/Japan/China)
UPDATE scrap_price_benchmarks
   SET region = 'ASIA'
 WHERE material IN ('black_mass_nmc', 'black_mass_nca')
   AND region   = 'GLOBAL';

-- HMS 1&2 80:20 CFR Turkey — global benchmark but DELIVERY is to Turkey
UPDATE scrap_price_benchmarks
   SET region = 'TR'
 WHERE benchmark_name ILIKE '%CFR Turkey%'
   AND region          = 'GLOBAL';

-- ── (4) Telemetry ───────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_044_scrap_prices_cleanup_regions', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM scrap_price_benchmarks),
  'Manual cleanup',
  'Migration 044 — dropped LME refined-metal benchmarks + battery-internal metals (Co/Ni/Li/Mn/graphite) since asset owners sell black mass not individual metals. Renamed misleading GLOBAL tags: LME→LDN, OPIS marker→EX-CN, CIF Asia→ASIA, CFR Turkey→TR.'
);
