#!/usr/bin/env python3
"""
USGS U.S. Wind Turbine Database (USWTDB) → Supabase sync.

Pulls every utility-scale wind turbine in the US from the USGS USWTDB REST API
and upserts into us_wind_assets. Updated quarterly by USGS; we run monthly to
catch new commissioning entries.

USWTDB schema reference (per-turbine fields):
  case_id        — primary key
  faa_ors        — FAA Obstruction Repository ID
  eia_id         — Energy Information Administration plant ID
  t_state        — state postal code
  t_county       — county
  xlong / ylat   — turbine point coordinates (WGS84)
  p_name         — project name (consistent across all turbines in same project)
  p_year         — project commissioning year
  p_tnum         — total turbines in project
  p_cap          — total project capacity (MW)
  t_manu / t_model — turbine make/model
  t_cap          — turbine nameplate capacity (kW)
  t_hh / t_rd / t_ttlh — hub height / rotor diameter / total tip height (m)
  t_offshore     — boolean, offshore flag
  t_retrofit / t_retro_yr — retrofit flag + year

Required env vars:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import io
import sys
import zipfile
import csv
import requests

from base_ingestor import get_supabase_client, log


USWTDB_CSV_ZIP_URL = 'https://energy.usgs.gov/uswtdb/assets/data/uswtdbCSV.zip'
BATCH_SIZE = 500


def fetch_uswtdb_csv() -> list[dict]:
    """Download the USWTDB CSV ZIP, unpack, parse to list[dict]."""
    log.info(f'Fetching {USWTDB_CSV_ZIP_URL} …')
    resp = requests.get(USWTDB_CSV_ZIP_URL, timeout=120, headers={'User-Agent': 'Mozilla/5.0 endenex-terminal'})
    resp.raise_for_status()
    log.info(f'  Downloaded {len(resp.content) / 1024:.0f} KB ZIP')

    with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
        # Find the CSV — name pattern is uswtdb_v{N}_{N}_{date}.csv
        csv_names = [n for n in z.namelist() if n.lower().endswith('.csv')]
        if not csv_names:
            raise RuntimeError(f'No CSV file in archive: {z.namelist()}')
        csv_name = csv_names[0]
        log.info(f'  Extracting {csv_name}')

        with z.open(csv_name) as f:
            text = io.TextIOWrapper(f, encoding='utf-8-sig')
            reader = csv.DictReader(text)
            rows = list(reader)

    log.info(f'  Parsed {len(rows)} turbine rows')
    return rows


def parse_int(v) -> int | None:
    if v is None or v == '' or str(v).strip().lower() in ('null', 'na', 'nan'):
        return None
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return None


def parse_float(v) -> float | None:
    if v is None or v == '' or str(v).strip().lower() in ('null', 'na', 'nan'):
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def parse_bool(v) -> bool:
    if v is None:
        return False
    s = str(v).strip().lower()
    return s in ('1', 'true', 't', 'yes', 'y')


def map_record(row: dict) -> dict | None:
    """Map a USWTDB CSV row to a us_wind_assets insert dict."""
    case_id = (row.get('case_id') or '').strip()
    if not case_id:
        return None

    lat = parse_float(row.get('ylat'))
    lon = parse_float(row.get('xlong'))
    if lat is None or lon is None:
        return None
    state = (row.get('t_state') or '').strip()
    if not state:
        return None

    return {
        'case_id':              case_id,
        'faa_ors':              (row.get('faa_ors') or '').strip() or None,
        'eia_id':               (row.get('eia_id')  or '').strip() or None,
        'project_name':         (row.get('p_name')  or '').strip() or None,
        'project_capacity_mw':  parse_float(row.get('p_cap')),
        'project_turbine_count': parse_int(row.get('p_tnum')),
        'commissioning_year':   parse_int(row.get('p_year')),
        'state':                state,
        'county':               (row.get('t_county') or '').strip() or None,
        'lat':                  lat,
        'lon':                  lon,
        'turbine_capacity_kw':  parse_float(row.get('t_cap')),
        'hub_height_m':         parse_float(row.get('t_hh')),
        'rotor_diameter_m':     parse_float(row.get('t_rd')),
        'total_tip_height_m':   parse_float(row.get('t_ttlh')),
        'is_offshore':          parse_bool(row.get('t_offshore')),
        'is_retrofit':          parse_bool(row.get('t_retrofit')),
        'retrofit_year':        parse_int(row.get('t_retro_yr')),
        'turbine_make':         (row.get('t_manu')  or '').strip() or None,
        'turbine_model':        (row.get('t_model') or '').strip() or None,
        # operator is not in USWTDB; left null and enriched separately if needed
    }


def _log_run(client, status: str, written: int, error: str | None = None, notes: str = ''):
    try:
        client.table('ingestion_runs').insert({
            'pipeline':           'sync_uswtdb',
            'status':             status,
            'started_at':         f'{__import__("datetime").date.today()}T00:00:00Z',
            'finished_at':        f'{__import__("datetime").date.today()}T00:00:01Z',
            'records_written':    written,
            'source_attribution': 'USGS U.S. Wind Turbine Database (USWTDB) V8.3+',
            'notes':              notes,
            'error_message':      error,
        }).execute()
    except Exception as e:
        log.warning(f'Failed to write ingestion_runs telemetry: {e}')


def main():
    log.info('=== USWTDB → us_wind_assets sync starting ===')
    client = get_supabase_client()
    written = 0

    try:
        raw = fetch_uswtdb_csv()
        mapped = [r for r in (map_record(row) for row in raw) if r is not None]
        skipped = len(raw) - len(mapped)
        log.info(f'Mapped {len(mapped)} rows ({skipped} skipped — missing case_id / lat-lon / state)')

        # Upsert in batches on case_id (PRIMARY KEY)
        for i in range(0, len(mapped), BATCH_SIZE):
            batch = mapped[i:i + BATCH_SIZE]
            client.table('us_wind_assets').upsert(batch, on_conflict='case_id').execute()
            written += len(batch)
            if (i // BATCH_SIZE) % 10 == 0:
                log.info(f'  Upserted {written:,} / {len(mapped):,}')

        log.info(f'=== Sync complete: {written:,} turbines upserted ===')
        _log_run(client, 'success', written, notes=f'USWTDB full refresh · {skipped} rows skipped')
    except Exception as e:
        log.exception('USWTDB sync failed')
        _log_run(client, 'failure', written, error=str(e))
        sys.exit(1)


if __name__ == '__main__':
    main()
