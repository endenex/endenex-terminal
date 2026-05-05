-- Migration 011 — Seed 13 months of historical DCI publications and NRO estimates
--
-- Replays compute_dci.py and compute_nro.py logic in pure SQL so the indices are
-- populated immediately after migration runs, without requiring the Python
-- pipelines to execute first. Production cadence still uses the Python compute
-- pipelines on a monthly schedule (see ingestion/compute_dci.py, compute_nro.py).
--
-- Methodology v1.0:
--   net_liability(t) = gross_cost(t) − material_recovery(t) + disposal_costs(t)
--   gross_cost(t)    = base_gross × (1 + 3.5%/yr)^(years_since_base)
--   index_value(t)   = net_liability(t) / base_net_liability × 100
--
-- All computations use the seed data from migration 010.

-- ============================================================
-- HELPER FUNCTIONS — temporary, dropped at end of migration
-- ============================================================

CREATE OR REPLACE FUNCTION _years_since_base(asof DATE) RETURNS NUMERIC AS $$
  SELECT (asof - '2025-01-01'::DATE)::NUMERIC / 365.25;
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION _inflation_factor(asof DATE) RETURNS NUMERIC AS $$
  SELECT POWER(1.035, _years_since_base(asof));
$$ LANGUAGE SQL IMMUTABLE;

-- Latest commodity price for a material × region on or before a given date
CREATE OR REPLACE FUNCTION _price_at(mat TEXT, reg TEXT, asof DATE)
RETURNS NUMERIC AS $$
  SELECT price_per_tonne
  FROM commodity_prices
  WHERE material_type = mat AND region = reg AND price_date <= asof
  ORDER BY price_date DESC
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Median merchant markup for a material × region on or before a given date
CREATE OR REPLACE FUNCTION _markup_median(mat TEXT, reg TEXT, asof DATE)
RETURNS NUMERIC AS $$
  SELECT COALESCE(
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY markup_per_tonne),
    _price_at(mat, reg, asof) * 0.12
  )
  FROM merchant_markups
  WHERE material_type = mat AND region = reg AND effective_from <= asof;
$$ LANGUAGE SQL STABLE;

-- Min markup → high recovery
CREATE OR REPLACE FUNCTION _markup_min(mat TEXT, reg TEXT, asof DATE)
RETURNS NUMERIC AS $$
  SELECT COALESCE(MIN(markup_per_tonne), _price_at(mat, reg, asof) * 0.10)
  FROM merchant_markups
  WHERE material_type = mat AND region = reg AND effective_from <= asof;
$$ LANGUAGE SQL STABLE;

-- Max markup → low recovery
CREATE OR REPLACE FUNCTION _markup_max(mat TEXT, reg TEXT, asof DATE)
RETURNS NUMERIC AS $$
  SELECT COALESCE(MAX(markup_per_tonne), _price_at(mat, reg, asof) * 0.14)
  FROM merchant_markups
  WHERE material_type = mat AND region = reg AND effective_from <= asof;
$$ LANGUAGE SQL STABLE;

-- Average LCA volume per MW across all turbine profiles for a material
CREATE OR REPLACE FUNCTION _avg_volume_per_mw(mat TEXT) RETURNS NUMERIC AS $$
  SELECT COALESCE(AVG(volume_per_mw), 0)
  FROM turbine_material_profiles
  WHERE material_type = mat AND volume_basis = 'per_mw';
$$ LANGUAGE SQL STABLE;

-- FX rate EUR → currency, latest on or before asof
CREATE OR REPLACE FUNCTION _fx_eur_to(ccy TEXT, asof DATE) RETURNS NUMERIC AS $$
  SELECT COALESCE(
    (SELECT rate FROM fx_rates
     WHERE base_currency = 'EUR' AND quote_currency = ccy AND rate_date <= asof
     ORDER BY rate_date DESC LIMIT 1),
    1.0
  );
$$ LANGUAGE SQL STABLE;

-- Net price per tonne (price minus median markup)
CREATE OR REPLACE FUNCTION _net_price(mat TEXT, reg TEXT, asof DATE) RETURNS NUMERIC AS $$
  SELECT _price_at(mat, reg, asof) - _markup_median(mat, reg, asof);
$$ LANGUAGE SQL STABLE;

-- Category recovery per MW (sum of net_price × avg_volume across the materials)
CREATE OR REPLACE FUNCTION _category_recovery(mats TEXT[], reg TEXT, asof DATE)
RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(_net_price(m, reg, asof) * _avg_volume_per_mw(m)), 0)
  FROM unnest(mats) AS m;
$$ LANGUAGE SQL STABLE;

-- ============================================================
-- DCI base parameters from methodology v1.0
-- ============================================================
-- base_gross_cost_eur_mw          = 82000
-- base_blade_transport_eur_mw     =  4800
-- base_blade_gate_fees_eur_mw     =  1500
-- base_scrap_haulage_eur_mw       =  2200
-- base_period_date                = 2025-01-01
-- base_net_liability (EUR/MW)     = 78500   (matches compute_dci.py constant)

-- ============================================================
-- SEED — DCI publications: 13 months × 3 series
-- Series: europe_wind (EU/EUR), us_wind (US/USD), uk_wind (GB/GBP)
-- ============================================================

DO $$
DECLARE
  m INTEGER;
  d DATE;
  series_rec RECORD;

  v_infl NUMERIC;
  v_fx   NUMERIC;
  v_gross NUMERIC;
  v_blade_t NUMERIC;
  v_blade_g NUMERIC;
  v_haul NUMERIC;
  v_disposal NUMERIC;
  v_rec_fe NUMERIC;
  v_rec_cu NUMERIC;
  v_rec_al NUMERIC;
  v_rec NUMERIC;
  v_net_pos NUMERIC;
  v_net_liab NUMERIC;
  v_index NUMERIC;
  v_base_in_ccy NUMERIC;
BEGIN
  -- Iterate over 13 monthly publication dates (most recent first)
  FOR m IN 0..12 LOOP
    d := (date_trunc('month', CURRENT_DATE) - (m * INTERVAL '1 month'))::date + 14;

    -- Iterate over series
    FOR series_rec IN
      SELECT * FROM (VALUES
        ('europe_wind'::dci_series, 'EU', 'EUR'),
        ('us_wind'::dci_series,     'US', 'USD'),
        ('uk_wind'::dci_series,     'GB', 'GBP')
      ) AS t(series, region, currency)
    LOOP
      v_infl := _inflation_factor(d);
      v_fx   := _fx_eur_to(series_rec.currency, d);

      v_gross   := ROUND(82000 * v_infl * v_fx, 2);
      v_blade_t := ROUND( 4800 * v_infl * v_fx, 2);
      v_blade_g := ROUND( 1500 * v_infl * v_fx, 2);
      v_haul    := ROUND( 2200 * v_infl * v_fx, 2);
      v_disposal := v_blade_t + v_blade_g + v_haul;

      v_rec_fe := ROUND(_category_recovery(ARRAY['steel_hms1','steel_hms2','steel_cast_iron','steel_stainless'], series_rec.region, d), 2);
      v_rec_cu := ROUND(_category_recovery(ARRAY['copper'],    series_rec.region, d), 2);
      v_rec_al := ROUND(_category_recovery(ARRAY['aluminium'], series_rec.region, d), 2);
      v_rec    := v_rec_fe + v_rec_cu + v_rec_al;

      v_net_pos  := v_rec - v_disposal;
      v_net_liab := v_gross - v_net_pos;

      -- Convert base_net (78500 EUR) to series currency at base date
      v_base_in_ccy := 78500 * _fx_eur_to(series_rec.currency, '2025-01-01'::DATE);
      v_index := CASE WHEN v_base_in_ccy > 0
                      THEN ROUND((v_net_liab / v_base_in_ccy) * 100.0, 2)
                      ELSE NULL END;

      INSERT INTO dci_publications (
        series, publication_date, is_headline, index_value, index_base_date,
        currency, net_liability, net_liability_low, net_liability_high,
        gross_cost,
        recovery_ferrous, recovery_copper, recovery_aluminium, material_recovery,
        blade_transport, blade_gate_fees, scrap_haulage, disposal_costs,
        net_material_position,
        methodology_version, is_published, notes
      ) VALUES (
        series_rec.series, d, TRUE, v_index, '2025-01-01'::DATE,
        series_rec.currency,
        ROUND(v_net_liab, 2), ROUND(v_net_liab * 0.92, 2), ROUND(v_net_liab * 1.08, 2),
        v_gross,
        v_rec_fe, v_rec_cu, v_rec_al, v_rec,
        v_blade_t, v_blade_g, v_haul, v_disposal,
        v_net_pos,
        '1.0', TRUE,
        'Backfilled from migration 011 · methodology v1.0 · inflation factor ' || ROUND(v_infl, 4)
      ) ON CONFLICT (series, publication_date) DO UPDATE SET
        index_value           = EXCLUDED.index_value,
        net_liability         = EXCLUDED.net_liability,
        net_liability_low     = EXCLUDED.net_liability_low,
        net_liability_high    = EXCLUDED.net_liability_high,
        gross_cost            = EXCLUDED.gross_cost,
        recovery_ferrous      = EXCLUDED.recovery_ferrous,
        recovery_copper       = EXCLUDED.recovery_copper,
        recovery_aluminium    = EXCLUDED.recovery_aluminium,
        material_recovery     = EXCLUDED.material_recovery,
        blade_transport       = EXCLUDED.blade_transport,
        blade_gate_fees       = EXCLUDED.blade_gate_fees,
        scrap_haulage         = EXCLUDED.scrap_haulage,
        disposal_costs        = EXCLUDED.disposal_costs,
        net_material_position = EXCLUDED.net_material_position,
        methodology_version   = EXCLUDED.methodology_version,
        is_published          = EXCLUDED.is_published,
        notes                 = EXCLUDED.notes,
        updated_at            = NOW();
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- SEED — NRO estimates: 13 months × 7 materials × 3 regions
-- ============================================================
DO $$
DECLARE
  m INTEGER;
  d DATE;
  mat_r RECORD;
  v_price NUMERIC;
  v_mk_min NUMERIC;
  v_mk_max NUMERIC;
  v_mk_med NUMERIC;
  v_vol NUMERIC;
  v_npt_low NUMERIC;
  v_npt_mid NUMERIC;
  v_npt_high NUMERIC;
BEGIN
  FOR m IN 0..12 LOOP
    d := (date_trunc('month', CURRENT_DATE) - (m * INTERVAL '1 month'))::date + 14;
    FOR mat_r IN
      SELECT * FROM (VALUES
        ('steel_hms1','EU','EUR'), ('steel_hms1','GB','GBP'), ('steel_hms1','US','USD'),
        ('steel_hms2','EU','EUR'), ('steel_hms2','GB','GBP'), ('steel_hms2','US','USD'),
        ('steel_cast_iron','EU','EUR'), ('steel_cast_iron','GB','GBP'), ('steel_cast_iron','US','USD'),
        ('steel_stainless','EU','EUR'), ('steel_stainless','GB','GBP'), ('steel_stainless','US','USD'),
        ('copper','EU','EUR'), ('copper','GB','GBP'), ('copper','US','USD'),
        ('aluminium','EU','EUR'), ('aluminium','GB','GBP'), ('aluminium','US','USD'),
        ('rare_earth','EU','EUR'), ('rare_earth','GB','GBP'), ('rare_earth','US','USD')
      ) AS t(mat, reg, ccy)
    LOOP
      v_price := _price_at(mat_r.mat, mat_r.reg, d);
      IF v_price IS NULL THEN CONTINUE; END IF;
      v_mk_min := _markup_min(mat_r.mat, mat_r.reg, d);
      v_mk_max := _markup_max(mat_r.mat, mat_r.reg, d);
      v_mk_med := _markup_median(mat_r.mat, mat_r.reg, d);
      v_vol := _avg_volume_per_mw(mat_r.mat);

      v_npt_high := ROUND(v_price - v_mk_min, 2);
      v_npt_mid  := ROUND(v_price - v_mk_med, 2);
      v_npt_low  := ROUND(v_price - v_mk_max, 2);

      INSERT INTO nro_estimates (
        material_type, region, currency, reference_date,
        net_per_tonne_low, net_per_tonne_mid, net_per_tonne_high,
        net_per_mw_low, net_per_mw_mid, net_per_mw_high,
        source_type, source_date, confidence, derivation, last_reviewed
      ) VALUES (
        mat_r.mat, mat_r.reg, mat_r.ccy, d,
        v_npt_low, v_npt_mid, v_npt_high,
        CASE WHEN v_vol > 0 THEN ROUND(v_npt_low  * v_vol, 2) ELSE NULL END,
        CASE WHEN v_vol > 0 THEN ROUND(v_npt_mid  * v_vol, 2) ELSE NULL END,
        CASE WHEN v_vol > 0 THEN ROUND(v_npt_high * v_vol, 2) ELSE NULL END,
        'Endenex Recovery Model', d, 'High', 'Modelled', d
      ) ON CONFLICT (material_type, region, reference_date) DO UPDATE SET
        net_per_tonne_low  = EXCLUDED.net_per_tonne_low,
        net_per_tonne_mid  = EXCLUDED.net_per_tonne_mid,
        net_per_tonne_high = EXCLUDED.net_per_tonne_high,
        net_per_mw_low     = EXCLUDED.net_per_mw_low,
        net_per_mw_mid     = EXCLUDED.net_per_mw_mid,
        net_per_mw_high    = EXCLUDED.net_per_mw_high,
        last_reviewed      = EXCLUDED.last_reviewed,
        updated_at         = NOW();
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- Record this seed run in ingestion_runs telemetry
-- ============================================================
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'compute_dci_seed', 'success', NOW(), NOW(),
  39, 'Endenex DCI Methodology v1.0',
  'Migration 011 — backfilled 13 monthly publications across 3 series'
), (
  'compute_nro_seed', 'success', NOW(), NOW(),
  273, 'LME, Fastmarkets, AMM, OEM LCAs',
  'Migration 011 — backfilled 13 monthly NRO estimates × 7 materials × 3 regions'
);

-- ============================================================
-- Drop temporary helper functions
-- ============================================================
DROP FUNCTION IF EXISTS _years_since_base(DATE);
DROP FUNCTION IF EXISTS _inflation_factor(DATE);
DROP FUNCTION IF EXISTS _price_at(TEXT, TEXT, DATE);
DROP FUNCTION IF EXISTS _markup_median(TEXT, TEXT, DATE);
DROP FUNCTION IF EXISTS _markup_min(TEXT, TEXT, DATE);
DROP FUNCTION IF EXISTS _markup_max(TEXT, TEXT, DATE);
DROP FUNCTION IF EXISTS _avg_volume_per_mw(TEXT);
DROP FUNCTION IF EXISTS _fx_eur_to(TEXT, DATE);
DROP FUNCTION IF EXISTS _net_price(TEXT, TEXT, DATE);
DROP FUNCTION IF EXISTS _category_recovery(TEXT[], TEXT, DATE);
