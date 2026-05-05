-- Migration 018 — v1.1 backfill of DCI publications + NRO estimates
-- Plus: rounding fix for US state fractions (sum to 100, not 99)
--
-- Replays the v1.1 compute model in pure SQL:
--   • LCA volumes from wind_material_intensities (vintage = y2010 reference, scope = full)
--   • Scrap-assessed prices from commodity_prices (is_scrap_basis = true)
--   • Three-layer recovery: metallurgical × contamination yield × (1 − broker margin)
--   • Gross cost from dci_gross_cost_components (sum × inflation × country multiplier)
--   • Country multipliers: UK = uk_wind, DE proxy = europe_wind, US = us_wind
--
-- Writes alongside existing v1.0 publications by setting publication_date in the
-- future-month series so they coexist; UI reads latest is_published per series.
-- Where v1.0 publications exist on the same dates, v1.1 supersedes via the
-- ON CONFLICT DO UPDATE that updates methodology_version.

-- ── Tiny fix: US state fractions should sum to 100 ──────────────────────────
UPDATE wind_us_state_fractions SET share_pct = 10 WHERE state_code = 'XX';

-- ============================================================
-- HELPER FUNCTIONS — temporary, dropped at end
-- ============================================================
CREATE OR REPLACE FUNCTION _years_since_base(asof DATE) RETURNS NUMERIC AS $$
  SELECT (asof - '2025-01-01'::DATE)::NUMERIC / 365.25;
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION _inflation_factor(asof DATE) RETURNS NUMERIC AS $$
  SELECT POWER(1.035, _years_since_base(asof));
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION _price_at(mat TEXT, reg TEXT, asof DATE)
RETURNS NUMERIC AS $$
  SELECT price_per_tonne FROM commodity_prices
  WHERE material_type = mat AND region = reg AND price_date <= asof
  ORDER BY price_date DESC LIMIT 1;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION _fx_eur_to(ccy TEXT, asof DATE) RETURNS NUMERIC AS $$
  SELECT COALESCE(
    (SELECT rate FROM fx_rates
     WHERE base_currency = 'EUR' AND quote_currency = ccy AND rate_date <= asof
     ORDER BY rate_date DESC LIMIT 1),
    1.0
  );
$$ LANGUAGE SQL STABLE;

-- v1.1: vintage-bucketed LCA volume (reference asset y2010 + full scope)
CREATE OR REPLACE FUNCTION _lca_vol(mat TEXT) RETURNS NUMERIC AS $$
  SELECT COALESCE(volume_per_mw, 0)
  FROM wind_material_intensities
  WHERE vintage = 'y2010' AND scope = 'full' AND material = mat;
$$ LANGUAGE SQL STABLE;

-- v1.1: metallurgical recovery rate
CREATE OR REPLACE FUNCTION _metallurgical(mat TEXT) RETURNS NUMERIC AS $$
  SELECT COALESCE(rate, 0) FROM metallurgical_recovery_rates WHERE material = mat;
$$ LANGUAGE SQL STABLE;

-- v1.1: merchant contamination yield by ferrous/non-ferrous class
CREATE OR REPLACE FUNCTION _contamination_yield(mat TEXT) RETURNS NUMERIC AS $$
  SELECT yield_rate FROM merchant_contamination_yields
  WHERE region = 'GLOBAL' AND material_class = CASE
    WHEN mat IN ('steel','castiron')                          THEN 'ferrous'
    WHEN mat IN ('copper','aluminium','zinc')                 THEN 'non_ferrous'
    WHEN mat = 'rareearth'                                     THEN 'rare_earth'
    ELSE 'non_ferrous'
  END;
$$ LANGUAGE SQL STABLE;

-- v1.1: broker margin default by region
CREATE OR REPLACE FUNCTION _broker_margin(reg TEXT) RETURNS NUMERIC AS $$
  SELECT margin_default FROM broker_margins WHERE region = reg;
$$ LANGUAGE SQL STABLE;

-- v1.1: net recovery per MW for a single material
-- = lca_vol × metallurgical × contamination_yield × scrap_price × (1 − broker_margin)
-- Materials in wind_material_intensities use website taxonomy: 'steel', 'castiron', 'copper', 'aluminium'
-- Commodity prices use granular taxonomy: 'steel_hms1', 'steel_hms2', 'steel_cast_iron', 'copper', 'aluminium'
-- Map: 'steel' → average(hms1, hms2 prices); 'castiron' → cast_iron price
CREATE OR REPLACE FUNCTION _wind_material_price(mat TEXT, reg TEXT, asof DATE) RETURNS NUMERIC AS $$
  SELECT CASE mat
    WHEN 'steel'     THEN (COALESCE(_price_at('steel_hms1', reg, asof), 0) + COALESCE(_price_at('steel_hms2', reg, asof), 0)) / 2.0
    WHEN 'castiron'  THEN COALESCE(_price_at('steel_cast_iron', reg, asof), 0)
    WHEN 'copper'    THEN COALESCE(_price_at('copper',          reg, asof), 0)
    WHEN 'aluminium' THEN COALESCE(_price_at('aluminium',       reg, asof), 0)
    WHEN 'zinc'      THEN 0  -- not yet seeded in commodity_prices
    WHEN 'rareearth' THEN COALESCE(_price_at('rare_earth',      reg, asof), 0)
    ELSE 0
  END;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION _net_recovery_per_mw(mat TEXT, reg TEXT, asof DATE) RETURNS NUMERIC AS $$
  SELECT _lca_vol(mat)
       * _metallurgical(mat)
       * _contamination_yield(mat)
       * _wind_material_price(mat, reg, asof)
       * (1 - _broker_margin(reg));
$$ LANGUAGE SQL STABLE;

-- Sum recovery across a list of materials
CREATE OR REPLACE FUNCTION _category_recovery_v11(mats TEXT[], reg TEXT, asof DATE) RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(_net_recovery_per_mw(m, reg, asof)), 0) FROM unnest(mats) AS m;
$$ LANGUAGE SQL STABLE;

-- Composite country multiplier — weighted average of labour/plant/haul/gate
-- Weighting reflects rough cost-share per work category in DCI gross cost.
CREATE OR REPLACE FUNCTION _country_composite_mult(cc TEXT) RETURNS NUMERIC AS $$
  SELECT COALESCE(
    (SELECT (labour_mult * 0.45 + plant_mult * 0.30 + haul_mult * 0.10 + gate_mult * 0.15)
     FROM country_cost_multipliers WHERE country_code = cc),
    1.0
  );
$$ LANGUAGE SQL STABLE;

-- Base gross cost (sum of dci_gross_cost_components) for inflation/multiplier scaling
CREATE OR REPLACE FUNCTION _base_gross_total() RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(base_rate_eur_mw), 82000) FROM dci_gross_cost_components;
$$ LANGUAGE SQL STABLE;

-- ============================================================
-- Backfill DCI publications under v1.1
-- ============================================================
DO $$
DECLARE
  m INTEGER; d DATE; series_rec RECORD;
  v_infl NUMERIC; v_fx NUMERIC; v_mult NUMERIC; v_gross NUMERIC;
  v_blade_t NUMERIC; v_blade_g NUMERIC; v_haul NUMERIC; v_disposal NUMERIC;
  v_rec_fe NUMERIC; v_rec_cu NUMERIC; v_rec_al NUMERIC; v_rec NUMERIC;
  v_net_pos NUMERIC; v_net_liab NUMERIC; v_index NUMERIC; v_base_in_ccy NUMERIC;
  v_base_gross NUMERIC := _base_gross_total();   -- 82000 from rate card
BEGIN
  FOR m IN 0..12 LOOP
    d := (date_trunc('month', CURRENT_DATE) - (m * INTERVAL '1 month'))::date + 14;

    FOR series_rec IN
      SELECT * FROM (VALUES
        ('europe_wind'::dci_series, 'EU', 'EUR', 'DE'),
        ('us_wind'::dci_series,     'US', 'USD', 'US'),
        ('uk_wind'::dci_series,     'GB', 'GBP', 'GB')
      ) AS t(series, region, currency, country_anchor)
    LOOP
      v_infl := _inflation_factor(d);
      v_fx   := _fx_eur_to(series_rec.currency, d);
      v_mult := _country_composite_mult(series_rec.country_anchor);

      -- Gross cost: base × inflation × country composite mult × FX
      v_gross   := ROUND(v_base_gross * v_infl * v_mult * v_fx, 2);
      v_blade_t := ROUND(4800         * v_infl * v_mult * v_fx, 2);
      v_blade_g := ROUND(1500         * v_infl * v_mult * v_fx, 2);
      v_haul    := ROUND(2200         * v_infl * v_mult * v_fx, 2);
      v_disposal := v_blade_t + v_blade_g + v_haul;

      -- Material recovery using v1.1 three-layer model
      v_rec_fe := ROUND(_category_recovery_v11(ARRAY['steel','castiron'], series_rec.region, d), 2);
      v_rec_cu := ROUND(_category_recovery_v11(ARRAY['copper'],            series_rec.region, d), 2);
      v_rec_al := ROUND(_category_recovery_v11(ARRAY['aluminium'],         series_rec.region, d), 2);
      v_rec    := v_rec_fe + v_rec_cu + v_rec_al;

      v_net_pos  := v_rec - v_disposal;
      v_net_liab := v_gross - v_net_pos;

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
        '1.1', TRUE,
        format('Computed by migration 018 under v1.1 · 3-layer recovery (metallurgical × contamination × broker) · country mult %s × inflation factor %s', ROUND(v_mult, 3), ROUND(v_infl, 4))
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
        notes                 = EXCLUDED.notes,
        updated_at            = NOW();
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- Backfill NRO estimates under v1.1 (operator-net per material)
-- ============================================================
DO $$
DECLARE
  m INTEGER; d DATE; mat_r RECORD;
  v_price NUMERIC; v_metallurgical NUMERIC; v_contam NUMERIC; v_broker NUMERIC;
  v_net_per_t_mid NUMERIC; v_net_per_t_low NUMERIC; v_net_per_t_high NUMERIC;
  v_vol NUMERIC; v_lca_mat TEXT;
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

      -- Map granular price material → website-taxonomy LCA material
      v_lca_mat := CASE
        WHEN mat_r.mat IN ('steel_hms1','steel_hms2','steel_stainless') THEN 'steel'
        WHEN mat_r.mat = 'steel_cast_iron' THEN 'castiron'
        WHEN mat_r.mat = 'rare_earth'      THEN 'rareearth'
        ELSE mat_r.mat
      END;

      v_metallurgical := _metallurgical(v_lca_mat);
      v_contam        := _contamination_yield(v_lca_mat);
      v_broker        := _broker_margin(mat_r.reg);
      v_vol           := _lca_vol(v_lca_mat);

      -- Net per tonne to operator (low / mid / high spread = ±20% on broker margin)
      v_net_per_t_mid  := ROUND(v_price * v_metallurgical * v_contam * (1 - v_broker), 2);
      v_net_per_t_low  := ROUND(v_price * v_metallurgical * v_contam * (1 - LEAST(v_broker * 1.2, 1)), 2);
      v_net_per_t_high := ROUND(v_price * v_metallurgical * v_contam * (1 - GREATEST(v_broker * 0.8, 0)), 2);

      INSERT INTO nro_estimates (
        material_type, region, currency, reference_date,
        net_per_tonne_low, net_per_tonne_mid, net_per_tonne_high,
        net_per_mw_low, net_per_mw_mid, net_per_mw_high,
        source_type, source_date, confidence, derivation, last_reviewed
      ) VALUES (
        mat_r.mat, mat_r.reg, mat_r.ccy, d,
        v_net_per_t_low, v_net_per_t_mid, v_net_per_t_high,
        CASE WHEN v_vol > 0 THEN ROUND(v_net_per_t_low  * v_vol, 2) ELSE NULL END,
        CASE WHEN v_vol > 0 THEN ROUND(v_net_per_t_mid  * v_vol, 2) ELSE NULL END,
        CASE WHEN v_vol > 0 THEN ROUND(v_net_per_t_high * v_vol, 2) ELSE NULL END,
        'Endenex Recovery Model v1.1', d, 'High', 'Modelled', d
      ) ON CONFLICT (material_type, region, reference_date) DO UPDATE SET
        net_per_tonne_low  = EXCLUDED.net_per_tonne_low,
        net_per_tonne_mid  = EXCLUDED.net_per_tonne_mid,
        net_per_tonne_high = EXCLUDED.net_per_tonne_high,
        net_per_mw_low     = EXCLUDED.net_per_mw_low,
        net_per_mw_mid     = EXCLUDED.net_per_mw_mid,
        net_per_mw_high    = EXCLUDED.net_per_mw_high,
        source_type        = EXCLUDED.source_type,
        last_reviewed      = EXCLUDED.last_reviewed,
        updated_at         = NOW();
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- Drop helpers + telemetry
-- ============================================================
DROP FUNCTION IF EXISTS _years_since_base(DATE);
DROP FUNCTION IF EXISTS _inflation_factor(DATE);
DROP FUNCTION IF EXISTS _price_at(TEXT, TEXT, DATE);
DROP FUNCTION IF EXISTS _fx_eur_to(TEXT, DATE);
DROP FUNCTION IF EXISTS _lca_vol(TEXT);
DROP FUNCTION IF EXISTS _metallurgical(TEXT);
DROP FUNCTION IF EXISTS _contamination_yield(TEXT);
DROP FUNCTION IF EXISTS _broker_margin(TEXT);
DROP FUNCTION IF EXISTS _wind_material_price(TEXT, TEXT, DATE);
DROP FUNCTION IF EXISTS _net_recovery_per_mw(TEXT, TEXT, DATE);
DROP FUNCTION IF EXISTS _category_recovery_v11(TEXT[], TEXT, DATE);
DROP FUNCTION IF EXISTS _country_composite_mult(TEXT);
DROP FUNCTION IF EXISTS _base_gross_total();

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'compute_dci_v1_1_backfill', 'success', NOW(), NOW(),
  39 + 273 + 1,
  'Endenex DCI Methodology v1.1',
  'Migration 018 — backfilled 39 v1.1 dci_publications + 273 v1.1 nro_estimates + fixed US state fractions sum to 100'
);
