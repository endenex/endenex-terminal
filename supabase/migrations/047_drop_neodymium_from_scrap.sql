-- Migration 047 — Remove neodymium from scrap_price_benchmarks
--
-- Migration 046 replaced refined Nd metal ($244k/t) with recovered magnet
-- block ($40k/t) on the assumption that asset owners route sorted magnets
-- to specialty recyclers (HyProMag UK, Noveon Magnetics US, REIA Germany).
--
-- That assumption is too optimistic. In practice the TYPICAL outcome for
-- decommissioned PMG turbine magnets is:
--   1. Magnets stay attached to generator stators → bundled in copper-stream
--      scrap at copper-No.2 rates ($9-10k/t)
--   2. Magnets stockpiled (no regional buyer)
--   3. Magnets landfilled
--
-- The recovery infrastructure simply isn't mature enough for the panel to
-- present a Nd price as something the asset owner reliably realises. Same
-- discipline we applied to refined battery metals and primary polysilicon.
--
-- The Nd intensity (kg per MW) stays in material_intensities — that's still
-- a real disclosure for an asset owner inventorying their fleet's NdFeB
-- exposure. But "what's the going price" doesn't have a clean answer yet.

DELETE FROM scrap_price_benchmarks
 WHERE material = 'rare_earth_neodymium';

-- Telemetry
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_047_drop_neodymium_from_scrap', 'success', NOW(), NOW(),
  0,
  'Manual cleanup',
  'Migration 047 — removed neodymium from scrap_price_benchmarks. Specialty recovery infrastructure too immature for asset owners to reliably realise sorted-magnet prices; typical outcome is bundled copper scrap or stockpiling.'
);
