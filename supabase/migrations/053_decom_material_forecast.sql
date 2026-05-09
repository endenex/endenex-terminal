-- Migration 053 — Decom Material Volume Forecast view
--
-- The headline analytical question of the SMI module: how many tonnes of
-- each material come out of decommissioning by year and region?
--
-- Method:
--   1. Each asset retires at commissioning_date + 25 years (typical wind
--      design life). Group fleet by (retire_year, country, asset_class).
--   2. For each (asset_class, material), use the average intensity across
--      seeded OEM models in material_intensities_v (kg/MW for wind,
--      kg/Wp for solar, kg/MWh for BESS).
--   3. Multiply retiring_capacity × intensity → tonnes per material.
--   4. Apply recoverability% to get recoverable tonnes (sellable as scrap).
--
-- v1 covers UK + IE + DE + US onshore wind (whatever's in `assets` table).
-- US onshore wind from USWTDB lives in `us_wind_assets` (separate table) —
-- UNIONed in below. Offshore / solar / BESS retirement schedules pending
-- ingestion of those source datasets (e.g., 4C Offshore wind farms,
-- IEA-PVPS plant database).

-- Constants for the standard design life by asset class.
-- Sources: IEA Wind Task 26 (onshore 25y typical), 4C Offshore (offshore
-- 25-30y), IEA PVPS (solar 25-30y), BNEF (BESS ~10-15y).
CREATE OR REPLACE FUNCTION _design_life_years(p_class text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_class
    WHEN 'onshore_wind'  THEN 25
    WHEN 'offshore_wind' THEN 27
    WHEN 'solar_pv'      THEN 30
    WHEN 'bess'          THEN 15
    ELSE 25
  END
$$;

-- ── Retirement schedule: union of `assets` + `us_wind_assets` ──────────
--
-- `assets` carries REPD UK onshore wind plus any other regional registries.
-- `us_wind_assets` carries USGS USWTDB turbine-level US fleet with p_year +
-- t_cap (per-turbine MW).

DROP VIEW IF EXISTS retirement_schedule_v;

CREATE VIEW retirement_schedule_v AS
WITH unified AS (
  -- Layer 1: assets table (REPD + others)
  SELECT
    a.asset_class,
    a.country_code                                              AS country,
    EXTRACT(YEAR FROM a.commissioning_date)::integer
      + _design_life_years(a.asset_class)                       AS retire_year,
    EXTRACT(YEAR FROM a.commissioning_date)::integer            AS commission_year,
    COALESCE(a.capacity_mw, 0)                                  AS capacity_mw,
    'assets/' || a.source_type                                  AS source
  FROM assets a
  WHERE a.commissioning_date IS NOT NULL
    AND a.capacity_mw IS NOT NULL
    AND a.capacity_mw > 0
    AND a.decommissioning_date IS NULL  -- exclude already-decommissioned

  UNION ALL

  -- Layer 2: USWTDB US wind turbines (table us_wind_assets)
  -- Each row is a single turbine; turbine_capacity_kw / 1000 = MW.
  -- NOTE: USWTDB raw fields are p_year / t_cap; migration 024 renamed
  -- them to commissioning_year / turbine_capacity_kw on insert.
  SELECT
    'onshore_wind'                                              AS asset_class,
    'US'                                                        AS country,
    u.commissioning_year + 25                                   AS retire_year,
    u.commissioning_year                                        AS commission_year,
    COALESCE(u.turbine_capacity_kw, 0) / 1000.0                 AS capacity_mw,
    'uswtdb'                                                    AS source
  FROM us_wind_assets u
  WHERE u.commissioning_year IS NOT NULL
    AND u.commissioning_year > 1980
    AND u.turbine_capacity_kw IS NOT NULL
    AND u.turbine_capacity_kw > 0
)
SELECT
  asset_class,
  country,
  retire_year,
  commission_year,
  ROUND(SUM(capacity_mw)::numeric, 1) AS retiring_mw,
  COUNT(*)                            AS asset_count,
  ARRAY_AGG(DISTINCT source)          AS sources
FROM unified
WHERE retire_year IS NOT NULL
  AND retire_year BETWEEN 2024 AND 2055    -- forecast window
GROUP BY asset_class, country, retire_year, commission_year;

-- ── Material intensity per asset_class (averaged across seeded models) ──

DROP VIEW IF EXISTS material_intensity_per_class_v;

CREATE VIEW material_intensity_per_class_v AS
SELECT
  asset_class,
  material,
  intensity_unit,
  COUNT(DISTINCT oem_model_id)                                  AS model_count,
  ROUND(AVG(intensity_value)::numeric, 2)                       AS avg_intensity,
  ROUND(AVG(recoverability_pct)::numeric, 1)                    AS avg_recoverability_pct
FROM material_intensities_v
WHERE intensity_value IS NOT NULL
GROUP BY asset_class, material, intensity_unit;

-- ── The headline forecast view: tonnes by year × region × material ─────

DROP VIEW IF EXISTS decom_material_forecast_v;

CREATE VIEW decom_material_forecast_v AS
SELECT
  r.retire_year,
  r.country,
  r.asset_class,
  r.retiring_mw,
  r.asset_count,
  i.material,
  i.avg_intensity                                                  AS intensity_kg_per_unit,
  i.intensity_unit,
  -- Convert to tonnes:
  --   kg/MW  × MW  → kg → /1000 → tonnes
  --   kg/Wp  × MW  → kg per MW: Wp = 1e-6 MW → multiply by 1e6 first
  --                   so kg = (kg/Wp) × (capacity_MW × 1e6) → /1000 = tonnes
  --   kg/MWh × MW  — for BESS we'd need MWh; treating MW as MWh for v1 (rough)
  CASE i.intensity_unit
    WHEN 'kg/MW'  THEN ROUND((r.retiring_mw * i.avg_intensity / 1000)::numeric, 1)
    WHEN 'kg/Wp'  THEN ROUND((r.retiring_mw * 1000000 * i.avg_intensity / 1000)::numeric, 1)
    WHEN 'kg/MWh' THEN ROUND((r.retiring_mw * i.avg_intensity / 1000)::numeric, 1)
    ELSE NULL
  END                                                              AS total_tonnes,
  CASE i.intensity_unit
    WHEN 'kg/MW'  THEN ROUND((r.retiring_mw * i.avg_intensity * COALESCE(i.avg_recoverability_pct,0) / 100 / 1000)::numeric, 1)
    WHEN 'kg/Wp'  THEN ROUND((r.retiring_mw * 1000000 * i.avg_intensity * COALESCE(i.avg_recoverability_pct,0) / 100 / 1000)::numeric, 1)
    WHEN 'kg/MWh' THEN ROUND((r.retiring_mw * i.avg_intensity * COALESCE(i.avg_recoverability_pct,0) / 100 / 1000)::numeric, 1)
    ELSE NULL
  END                                                              AS recoverable_tonnes,
  i.avg_recoverability_pct
FROM retirement_schedule_v r
JOIN material_intensity_per_class_v i ON i.asset_class = r.asset_class;

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_053_decom_material_forecast', 'success', NOW(), NOW(),
  0,
  'Schema-only · views over assets + us_wind_assets + material_intensities_v',
  'Migration 053 — decom_material_forecast_v (retirement_schedule × material_intensity = annual tonnes by year/region/material). v1 covers REPD UK onshore + USWTDB US onshore. Offshore/solar/BESS retirement schedules pending source-data ingestion.'
);
