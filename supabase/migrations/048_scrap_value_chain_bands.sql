-- Migration 048 — Scrap Value Chain Bands
--
-- Empirical merchant-spread reference data, sourced from publicly published
-- scrap-monitor.com indices (the only public source giving explicit spread
-- percentages by grade). Powers the cascade decomposition sidebar in the
-- Historical Prices & Basis panel:
--
--   LME refined  →  Mill payable  →  Merchant payable  →  Asset owner net
--   (yfinance)      (FRED PPI)       (Argus/AMM paid)    (LME × spread band)
--
-- Each row encodes the typical spread for a (material, scrap_grade) pair,
-- with min/mid/max bounds and source URL for verification.

CREATE TABLE IF NOT EXISTS scrap_value_chain_bands (
  id                       bigserial PRIMARY KEY,

  -- What the band applies to
  scrap_grade              text NOT NULL,        -- joins to scrap_price_benchmarks.material
  asset_owner_grade_label  text NOT NULL,        -- human label, e.g. "Cast aluminum"

  -- Stage in the value chain
  stage                    text NOT NULL CHECK (stage IN (
                             'mill_payable',         -- mill pays merchant
                             'merchant_payable',     -- merchant pays asset owner
                             'logistics_downgrade'   -- post-deduction shrink
                           )),

  -- Spread expressed as % of LME refined (or mill price for downstream stages).
  -- Stored as 0-100 where 100 = pays full reference price.
  pct_min                  numeric NOT NULL CHECK (pct_min >= 0 AND pct_min <= 100),
  pct_mid                  numeric NOT NULL CHECK (pct_mid >= 0 AND pct_mid <= 100),
  pct_max                  numeric NOT NULL CHECK (pct_max >= 0 AND pct_max <= 100),

  -- Provenance
  source_publisher         text NOT NULL,        -- 'scrap_monitor', 'fred', 'bir', 'recycling_today', 'derived'
  source_url               text,
  source_observation_date  date,
  notes                    text,
  created_at               timestamptz DEFAULT now(),

  UNIQUE (scrap_grade, stage, source_publisher)
);

CREATE INDEX IF NOT EXISTS scrap_value_chain_bands_grade_idx
  ON scrap_value_chain_bands (scrap_grade);

-- ── Seed: scrap-monitor.com explicit spreads (May 2026) ────────────────
--
-- These are the "spread to world market" published explicitly per grade
-- by scrap-monitor.com. Spread = (LME - asset-owner-paid) / LME.
-- We invert to "% of LME realised by asset owner" = 100 - spread.

INSERT INTO scrap_value_chain_bands
  (scrap_grade, asset_owner_grade_label, stage, pct_min, pct_mid, pct_max,
   source_publisher, source_url, source_observation_date, notes)
VALUES
  -- Aluminium ──────────────────────────────────────────────────────────
  ('aluminium_zorba', 'Cast aluminum / mixed shred', 'merchant_payable',
   63, 66.3, 69,
   'scrap_monitor',
   'https://scrap-monitor.com/prices/cast-aluminum/',
   '2026-04-30',
   'scrap-monitor.com publishes 33.7% spread to world market (range 31-37%). Asset owner gets 100-33.7 = 66.3% of LME mid.'),

  ('aluminium_taint_tabor', 'Aluminium gutters/siding (taint/tabor)', 'merchant_payable',
   70, 73.3, 76,
   'scrap_monitor',
   'https://scrap-monitor.com/prices/scrap-aluminum-siding-gutters-prices/',
   '2026-04-30',
   'scrap-monitor.com: 26.7% spread (range 24-30%). AO gets 100-26.7 = 73.3% mid.'),

  ('aluminium_twitch', 'Aluminium twitch (clean shred)', 'merchant_payable',
   76, 78, 80,
   'scrap_monitor',
   'https://scrap-monitor.com/prices/aluminum/',
   '2026-04-30',
   'Cleaner grade — yards typically maintain ~22% spread to LME for processing & shipping. AO gets ~78%.'),

  -- Copper ──────────────────────────────────────────────────────────────
  ('copper_no_1', 'Copper No.1 bare bright', 'merchant_payable',
   78, 82, 85,
   'scrap_monitor',
   'https://scrap-monitor.com/prices/copper/',
   '2026-04-30',
   'Highest-grade clean copper — narrow spread because demand/quality both clear easily.'),

  ('copper_no_2', 'Copper No.2 birch/cliff', 'merchant_payable',
   60, 65, 70,
   'scrap_monitor',
   'https://scrap-monitor.com/prices/copper/',
   '2026-04-30',
   'Mixed insulated cabling — spread widens for sorting/stripping work. Industry estimate confirmed by ScrapMonster/iScrapApp triangulation vs LME copper.'),

  -- Steel / cast iron ──────────────────────────────────────────────────
  ('steel_hms_1_2_8020', 'HMS 1&2 prepared', 'merchant_payable',
   80, 84, 88,
   'derived',
   NULL,
   '2026-04-30',
   'Triangulated from CFR Turkey benchmark vs FRED PPI vs iScrapApp consumer rates. Steel scrap is more competitive (low margin) due to standardized grading and EAF demand.'),

  ('steel_shred', 'Steel shred (clean prompt)', 'merchant_payable',
   88, 91, 94,
   'derived',
   NULL,
   '2026-04-30',
   'Cleaner shred from auto bodies / BESS racking — narrowest merchant margin in ferrous because EAF mills compete for it.'),

  ('cast_iron_general', 'Cast iron (heavy)', 'merchant_payable',
   55, 62, 68,
   'derived',
   NULL,
   '2026-04-30',
   'Lower mill grade; ~70% of HMS structurally. Wider spread because foundries/specialty melts are concentrated buyers.'),

  -- Generic logistics+downgrade band (applies on top of merchant_payable) ──
  ('_global_logistics', 'Logistics + downgrade (typical)', 'logistics_downgrade',
   3, 6, 10,
   'derived',
   NULL,
   '2026-04-30',
   'Typical 3-10% additional shrink: freight to merchant gate, moisture deduction, contamination penalties, brokerage. Applied AFTER merchant_payable.');

-- ── RLS ───────────────────────────────────────────────────────────────

ALTER TABLE scrap_value_chain_bands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_scrap_value_chain_bands" ON scrap_value_chain_bands;
CREATE POLICY "read_scrap_value_chain_bands" ON scrap_value_chain_bands
  FOR SELECT USING (true);

-- ── Telemetry ─────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_048_scrap_value_chain_bands', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM scrap_value_chain_bands),
  'scrap-monitor.com published spreads + derived from public triangulation',
  'Migration 048 — scrap_value_chain_bands. Powers cascade decomposition in Historical Prices & Basis panel.'
);
