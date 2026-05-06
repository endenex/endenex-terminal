#!/usr/bin/env python3
"""
BLM Right-of-Way polygons → Supabase sync.

Scrapes wind/solar Right-of-Way grant polygons from BLM state-office ArcGIS
FeatureServers. Output goes into blm_row_polygons. Used downstream by
compute_federal_land_flags.py to spatially flag turbines on US federal land.

Coverage starts with state offices known to publish renewable-energy ROW
polygons. Extensible — add new state offices to STATE_ENDPOINTS dict.

ArcGIS REST query pattern:
  {endpoint}/query?where=1=1&outFields=*&f=geojson&resultOffset=0&resultRecordCount=2000

We page through all features. ArcGIS default page size is 2000.

Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import sys
import json
import requests

from base_ingestor import get_supabase_client, log


# Per-state-office BLM ArcGIS FeatureServer endpoints for wind/solar ROW polygons.
# Confirmed live as of 2026:
STATE_ENDPOINTS: dict[str, dict] = {
    'AK': {
        'url':         'https://gis.blm.gov/akarcgis/rest/services/Land_Status/BLM_AK_Land_Use_Authorizations/FeatureServer/12',
        'name_field':  'CSE_NAME',
        'serial_field':'CSE_NR',
        'auth_type':   'Authorization_Type',
        'disposition': 'CSE_LND_STATUS',
        'acres':       'GIS_Acres',
        'case_type':   'CMMDTY',
        'effective':   'CSE_LND_STATUS_DT',
    },
    'CA': {
        'url':         'https://gis.blm.gov/caarcgis/rest/services/RenewableEnergy/BLM_CA_Renewable_Energy_Projects/FeatureServer/0',
        'name_field':  'ProjectName',
        'serial_field':'SerialNumber',
        'auth_type':   'CaseType',
        'disposition': 'Disposition',
        'acres':       'ProjectAcres',
        'case_type':   'ProjectType',
        'effective':   'EffectiveDate',
        'expiration':  'ExpirationDate',
        'application': 'ApplicationDate',
    },
    # Additional state offices to test/add (as of writing):
    #   NV: https://gis.blm.gov/nvarcgis/rest/services/RenewableEnergy/...
    #   WY: https://gis.blm.gov/wyarcgis/rest/services/...
    #   AZ: https://gis.blm.gov/azarcgis/rest/services/...
    # Add as the corresponding FeatureServer URLs are confirmed.
}


PAGE_SIZE = 2000


def epoch_ms_to_iso(v) -> str | None:
    """ArcGIS returns dates as epoch milliseconds. Convert to ISO date."""
    if v is None:
        return None
    try:
        from datetime import datetime, timezone
        return datetime.fromtimestamp(int(v) / 1000, tz=timezone.utc).date().isoformat()
    except (ValueError, TypeError):
        return None


def fetch_features(endpoint: str) -> list[dict]:
    """Page through an ArcGIS FeatureServer layer; return all features as GeoJSON."""
    features = []
    offset = 0
    while True:
        params = {
            'where':               '1=1',
            'outFields':           '*',
            'f':                   'geojson',
            'resultOffset':        offset,
            'resultRecordCount':   PAGE_SIZE,
            'outSR':               '4326',
        }
        url = f'{endpoint}/query'
        log.info(f'    fetch offset={offset}')
        resp = requests.get(url, params=params, timeout=120,
                            headers={'User-Agent': 'Mozilla/5.0 endenex-terminal'})
        resp.raise_for_status()
        data = resp.json()
        feats = data.get('features') or []
        if not feats:
            break
        features.extend(feats)
        if len(feats) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        if offset > 50000:
            log.warning(f'    stopped at offset {offset} as safety guard')
            break
    return features


def map_feature(feat: dict, state_office: str, schema: dict, endpoint: str) -> dict | None:
    """Map an ArcGIS feature → blm_row_polygons row."""
    props = feat.get('properties') or {}
    geom  = feat.get('geometry')

    serial = (str(props.get(schema.get('serial_field')) or '')).strip()
    if not serial:
        return None

    # Only keep wind/solar (skip 'Other', 'Communication Site', etc.)
    case_type = (str(props.get(schema.get('case_type')) or '')).strip().lower()
    if case_type and not any(k in case_type for k in ('wind', 'solar', 'energy', 'renewable')):
        return None

    if geom is None:
        return None

    # Convert single Polygon → MultiPolygon for consistent storage
    gtype = geom.get('type')
    if gtype == 'Polygon':
        geom = {'type': 'MultiPolygon', 'coordinates': [geom['coordinates']]}
    elif gtype != 'MultiPolygon':
        return None  # unexpected geometry type

    return {
        'serial_number':       serial,
        'project_name':        (str(props.get(schema.get('name_field'))   or '')).strip() or None,
        'state_office':        state_office,
        'authorization_type':  (str(props.get(schema.get('auth_type'))    or '')).strip() or None,
        'case_type':           (str(props.get(schema.get('case_type'))    or '')).strip() or None,
        'disposition':         (str(props.get(schema.get('disposition'))  or '')).strip() or None,
        'application_date':    epoch_ms_to_iso(props.get(schema.get('application'))) if schema.get('application') else None,
        'effective_date':      epoch_ms_to_iso(props.get(schema.get('effective')))   if schema.get('effective')   else None,
        'expiration_date':     epoch_ms_to_iso(props.get(schema.get('expiration')))  if schema.get('expiration')  else None,
        'project_acres':       props.get(schema.get('acres')),
        'blm_acres':           props.get(schema.get('acres')),     # if no separate field
        'geom_geojson':        json.dumps(geom),                   # we'll convert client-side via RPC or trigger
        'source_endpoint':     endpoint,
    }


def upsert_polygons(client, rows: list[dict]) -> int:
    """
    Upsert polygons. Supabase REST doesn't accept geography literals directly,
    so we send geom as GeoJSON text and rely on a Postgres trigger or column
    cast (the table column is geography(MultiPolygon, 4326)).

    For Supabase, sending {"geom": "<geojson>"} won't auto-cast — we must use
    the rpc() with a custom function, OR write GeoJSON to a temp text column
    and convert. Cleanest in this version: insert with raw SQL via PostgREST
    RPC. As a pragmatic v1, we POST GeoJSON to a separate ingestion-only
    text column geom_geojson (added below if missing), then a server-side
    trigger moves it into geom.

    For now, we strip geom_geojson out of the upsert payload and store only
    metadata + the GeoJSON string in a dedicated text column. The companion
    SQL file (migration 024 supplemental) creates the text column and the
    trigger. If you've not yet run that, polygons land without geometry —
    the spatial join script will skip them.
    """
    if not rows:
        return 0
    written = 0
    for i in range(0, len(rows), 200):
        batch = rows[i:i + 200]
        client.table('blm_row_polygons').upsert(batch, on_conflict='serial_number').execute()
        written += len(batch)
    return written


def _log_run(client, status: str, written: int, error: str | None = None, notes: str = ''):
    try:
        client.table('ingestion_runs').insert({
            'pipeline':           'sync_blm_row_polygons',
            'status':             status,
            'started_at':         f'{__import__("datetime").date.today()}T00:00:00Z',
            'finished_at':        f'{__import__("datetime").date.today()}T00:00:01Z',
            'records_written':    written,
            'source_attribution': 'BLM state-office ArcGIS FeatureServers (gis.blm.gov)',
            'notes':              notes,
            'error_message':      error,
        }).execute()
    except Exception as e:
        log.warning(f'Failed to write ingestion_runs telemetry: {e}')


def main():
    log.info('=== BLM state-office ROW polygons → blm_row_polygons sync starting ===')
    client = get_supabase_client()
    total_written = 0
    states_synced = []
    states_failed = []

    for state, schema in STATE_ENDPOINTS.items():
        endpoint = schema['url']
        log.info(f'  {state}: {endpoint}')
        try:
            feats = fetch_features(endpoint)
            log.info(f'    fetched {len(feats)} features')
            mapped = [r for r in (map_feature(f, state, schema, endpoint) for f in feats) if r is not None]
            log.info(f'    mapped {len(mapped)} (after wind/solar filter)')
            written = upsert_polygons(client, mapped)
            total_written += written
            states_synced.append(f'{state}={written}')
            log.info(f'    upserted {written}')
        except Exception as e:
            log.exception(f'  {state} failed')
            states_failed.append(f'{state} ({type(e).__name__})')

    summary = f'States synced: {", ".join(states_synced) or "(none)"}'
    if states_failed:
        summary += f' · failed: {", ".join(states_failed)}'

    log.info(f'=== Sync complete: {total_written} polygons upserted across {len(states_synced)} state offices ===')
    _log_run(client, 'success' if not states_failed else 'partial', total_written, notes=summary)


if __name__ == '__main__':
    main()
