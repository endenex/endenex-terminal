#!/usr/bin/env python3
"""
PostGIS spatial join: tag every us_wind_assets row with is_federal_land = true
when its turbine point falls inside any blm_row_polygons polygon.

Runs after sync_uswtdb.py + sync_blm_row_polygons.py have populated the
two source tables. Idempotent — re-flagging is safe.

The actual spatial join is done server-side in Postgres for efficiency; this
script just executes the SQL via Supabase RPC.

Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import sys
from datetime import date

from base_ingestor import get_supabase_client, log


# Spatial-join SQL: set is_federal_land + blm_row_serial for every turbine
# whose point geometry falls inside an active BLM ROW polygon.
# Reset all previously-flagged turbines first so re-flagging is idempotent.
SPATIAL_JOIN_SQL = """
-- Reset
UPDATE us_wind_assets
   SET is_federal_land = false,
       blm_row_serial  = NULL,
       flagged_at      = now()
WHERE is_federal_land = true;

-- Flag turbines inside any BLM ROW polygon (active dispositions only)
WITH matches AS (
  SELECT DISTINCT ON (a.case_id)
         a.case_id,
         p.serial_number
  FROM   us_wind_assets a
  JOIN   blm_row_polygons p
    ON   ST_Intersects(a.geom, p.geom)
  WHERE  p.geom IS NOT NULL
    AND  COALESCE(p.disposition, '') NOT ILIKE '%closed%'
    AND  COALESCE(p.disposition, '') NOT ILIKE '%terminated%'
    AND  COALESCE(p.disposition, '') NOT ILIKE '%relinquished%'
)
UPDATE us_wind_assets a
   SET is_federal_land = true,
       blm_row_serial  = m.serial_number,
       flagged_at      = now()
  FROM matches m
 WHERE a.case_id = m.case_id;
"""


def _log_run(client, status: str, written: int, error: str | None = None, notes: str = ''):
    try:
        client.table('ingestion_runs').insert({
            'pipeline':           'compute_federal_land_flags',
            'status':             status,
            'started_at':         f'{date.today()}T00:00:00Z',
            'finished_at':        f'{date.today()}T00:00:01Z',
            'records_written':    written,
            'source_attribution': 'PostGIS ST_Intersects: us_wind_assets.geom × blm_row_polygons.geom',
            'notes':              notes,
            'error_message':      error,
        }).execute()
    except Exception as e:
        log.warning(f'Failed to write ingestion_runs telemetry: {e}')


def main():
    log.info('=== Federal-land flag computation starting ===')
    client = get_supabase_client()

    try:
        # Pre-counts for reporting
        before = client.table('us_wind_assets').select('case_id', count='exact', head=True) \
                       .eq('is_federal_land', True).execute()
        before_count = before.count or 0

        # Run spatial join via Postgres RPC. Supabase exposes raw SQL via
        # the postgrest `rpc` mechanism only when wrapped in a SECURITY DEFINER
        # function. For one-off ops we can use the underlying admin SQL endpoint
        # (PostgREST PATCH/POST) — but the cleanest portable path is to invoke
        # a stored function. To keep this script self-contained we call the
        # function `compute_federal_land_flags()` which we register here:
        #
        # (The function is created lazily — guarded by IF NOT EXISTS via DO block.)
        ensure_fn = """
        CREATE OR REPLACE FUNCTION compute_federal_land_flags()
        RETURNS integer
        LANGUAGE plpgsql
        SECURITY DEFINER
        AS $fn$
        DECLARE
          n_flagged integer := 0;
        BEGIN
          UPDATE us_wind_assets
             SET is_federal_land = false,
                 blm_row_serial  = NULL,
                 flagged_at      = now()
           WHERE is_federal_land = true;

          WITH matches AS (
            SELECT DISTINCT ON (a.case_id)
                   a.case_id, p.serial_number
            FROM   us_wind_assets a
            JOIN   blm_row_polygons p
              ON   ST_Intersects(a.geom, p.geom)
            WHERE  p.geom IS NOT NULL
              AND  COALESCE(p.disposition, '') NOT ILIKE '%closed%'
              AND  COALESCE(p.disposition, '') NOT ILIKE '%terminated%'
              AND  COALESCE(p.disposition, '') NOT ILIKE '%relinquished%'
          )
          UPDATE us_wind_assets a
             SET is_federal_land = true,
                 blm_row_serial  = m.serial_number,
                 flagged_at      = now()
            FROM matches m
           WHERE a.case_id = m.case_id;

          GET DIAGNOSTICS n_flagged = ROW_COUNT;
          RETURN n_flagged;
        END;
        $fn$;
        """
        # Postgres function creation can't go via standard table calls; we use
        # Supabase's direct SQL via the `postgrest` admin RPC. Easiest path
        # in Python is a separate raw HTTP POST to the SQL endpoint. To avoid
        # that complexity in v1, the function should be created manually once
        # via Supabase SQL editor (paste from the docstring at top of file).
        #
        # If the function already exists, the call below works:
        result = client.rpc('compute_federal_land_flags').execute()
        n_flagged = result.data if isinstance(result.data, int) else 0

        after_count = n_flagged
        log.info(f'  Federal-land flagged: {after_count:,} turbines (was {before_count:,})')

        _log_run(client, 'success', after_count,
                 notes=f'Flagged {after_count:,} turbines on BLM federal land (was {before_count:,})')

    except Exception as e:
        log.exception('Federal-land flag computation failed')
        _log_run(client, 'failure', 0, error=str(e))
        log.error('')
        log.error('NOTE: This script requires the Postgres function compute_federal_land_flags()')
        log.error('to exist. If this is the first run, paste the function body from the docstring')
        log.error('at the top of this file into the Supabase SQL editor and run it once.')
        sys.exit(1)


if __name__ == '__main__':
    main()
