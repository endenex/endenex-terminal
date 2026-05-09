"""
REPD Planning-Status Repowering Promoter (UK)
==============================================

Re-reads the REPD Excel and identifies sites whose Development Status indicates
active repowering / decommissioning planning. These are observed planning
applications, not inferences — high-confidence signals.

Triggers (from REPD's "Development Status" column):
  • 'Application Submitted'
  • 'Awaiting Construction'
  • 'Decommissioned'
  • 'Application Refused' (still indicates intent)
  • 'Revised'

For sites already commissioned (have an Operational date) where any of these
statuses applies, we treat as a repowering signal.

Outputs to repowering_projects with:
  source_type        = 'BEIS REPD Planning Status'
  confidence         = 'High'
  derivation         = 'Observed'
  stage              = mapped from Development Status

Usage:
  python promote_repd_repowering.py [--dry-run]
"""
from __future__ import annotations

import argparse
import io
import logging
from datetime import date

import pandas as pd
import requests
from base_ingestor import get_supabase_client, today_iso
from ingest_repd import discover_repd_url, TECHNOLOGY_FILTER, osgb_to_latlon, parse_date
from repowering._base import is_too_old

log = logging.getLogger(__name__)
PIPELINE = 'promote_repd_repowering'

# Map REPD Development Status → repowering_projects.stage
# Note: REPD doesn't distinguish "repowering" from "new build" in the status field.
# We restrict to sites that ALREADY have an Operational date (i.e. they're already
# generating, so any new application status implies repowering activity).
STATUS_TO_STAGE = {
    'Application Submitted':                 'application_submitted',
    'Application Lodged':                    'application_submitted',
    'Awaiting Construction':                 'permitted',
    'Application Granted':                   'application_approved',
    'Application Approved':                  'application_approved',
    'Under Construction':                    'ongoing',
    'Decommissioned':                        'ongoing',         # already retired, in repowering pipeline
    'Application Refused':                   'application_submitted',  # signal of intent
    'Revised':                               'application_submitted',
}


def fetch_repd() -> pd.DataFrame:
    repd_url = discover_repd_url()
    log.info(f'Downloading REPD from {repd_url}')
    r = requests.get(repd_url, timeout=120)
    r.raise_for_status()
    df = pd.read_excel(io.BytesIO(r.content), sheet_name='REPD')
    log.info(f'Downloaded {len(df):,} REPD rows')
    return df


def find_status_column(df: pd.DataFrame) -> str | None:
    """REPD column names vary slightly between releases."""
    for col in df.columns:
        if 'development status' in str(col).lower():
            return col
    return None


def find_operator_column(df: pd.DataFrame) -> str | None:
    for col in df.columns:
        if str(col).lower().startswith('operator'):
            return col
    return None


def find_developer_column(df: pd.DataFrame) -> str | None:
    for col in df.columns:
        if str(col).lower().startswith('developer'):
            return col
    return None


def map_records(df: pd.DataFrame) -> list[dict]:
    df = df[df['Technology Type'] == TECHNOLOGY_FILTER].copy()
    log.info(f'Filtered to {len(df):,} onshore wind rows')

    status_col = find_status_column(df)
    if not status_col:
        raise RuntimeError('Could not find Development Status column in REPD')
    operator_col  = find_operator_column(df)
    developer_col = find_developer_column(df)

    # Already-commissioned sites only
    df = df[df['Operational'].notna()].copy()
    log.info(f'  …of which {len(df):,} have an Operational date')

    # Active planning statuses
    mask = df[status_col].astype(str).isin(STATUS_TO_STAGE.keys())
    df = df[mask].copy()
    log.info(f'  …of which {len(df):,} have an active repowering/decom planning status')

    today = today_iso()
    rows: list[dict] = []
    for _, r in df.iterrows():
        ext_id = str(r.get('Ref ID', '')).strip()
        if not ext_id or ext_id == 'nan':
            continue
        status = str(r[status_col])
        stage  = STATUS_TO_STAGE.get(status)
        if not stage:
            continue
        # 3-year cutoff — drop rows whose latest planning activity is stale
        stage_date = parse_date(r.get('Planning Application Submitted')) or parse_date(r.get('Operational'))
        if is_too_old(stage_date, today):
            continue
        lat, lon = osgb_to_latlon(r.get('X-coordinate'), r.get('Y-coordinate'))
        loc_desc = f'GB · {lat:.3f}, {lon:.3f}' if lat and lon else 'GB'

        rows.append({
            'project_name':         _to_str(r.get('Site Name')) or f'REPD {ext_id}',
            'country_code':         'GB',
            'asset_class':          'onshore_wind',
            'stage':                stage,
            'stage_date':           parse_date(r.get('Planning Application Submitted')) or parse_date(r.get('Operational')),
            'capacity_mw':          _to_float(r.get('Installed Capacity (MWelec)')),
            'turbine_count':        int(r['No. of Turbines']) if pd.notna(r.get('No. of Turbines')) else None,
            'developer':            _to_str(r.get(developer_col)) if developer_col else None,
            'operator':             _to_str(r.get(operator_col)) if operator_col else None,
            'planning_reference':   ext_id,
            'location_description': loc_desc,
            'source_url':           'https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract',
            'notes':                f'REPD Development Status: {status}. Already commissioned site with active planning activity — observed repowering signal.',
            'asset_id':             None,
            'source_type':          'repd',
            'source_date':          today,
            'confidence':           'High',
            'derivation':           'Observed',
            'last_reviewed':        today,
        })
    log.info(f'Mapped {len(rows)} REPD repowering candidates')
    return rows


def _to_str(v):
    if v is None:
        return None
    s = str(v).strip()
    return None if s in ('', 'nan', 'None') else s


def _to_float(v):
    try:
        f = float(v)
        return None if pd.isna(f) else f
    except (TypeError, ValueError):
        return None


def upsert_projects(client, rows: list[dict]) -> int:
    """Idempotent upsert via dedupe_key (migration 074). Replaces the
    legacy delete-by-source_type + bulk-insert pattern that broke when
    two records collided on (name × country × asset_class).
    """
    if not rows:
        return 0
    from repowering._base import upsert_project
    total = 0
    for row in rows:
        if upsert_project(client, row):
            total += 1
    return total


def log_run(client, status: str, written: int, error: str | None = None):
    client.table('ingestion_runs').insert({
        'pipeline':           PIPELINE,
        'status':             status,
        'started_at':         f'{date.today()}T00:00:00Z',
        'finished_at':        f'{date.today()}T00:00:01Z',
        'records_written':    written,
        'source_attribution': 'DESNZ Renewable Energy Planning Database (Open Government Licence v3.0)',
        'notes':              'REPD planning-status repowering promotion',
        'error_message':      error,
    }).execute()


def run(dry_run: bool = False):
    log.info('=== promote_repd_repowering starting ===')
    client = get_supabase_client()

    try:
        df = fetch_repd()
        rows = map_records(df)
    except Exception as e:
        log.exception('REPD fetch/map failed')
        log_run(client, 'failure', 0, str(e))
        raise

    if dry_run:
        log.info('DRY RUN — sample:')
        for r in rows[:10]:
            log.info(f'  {r["project_name"]} · {r["stage"]} · {r["capacity_mw"]} MW')
        return

    try:
        n = upsert_projects(client, rows)
        log_run(client, 'success', n)
        log.info(f'=== complete: {n} REPD repowering rows ===')
    except Exception as e:
        log.exception('REPD upsert failed')
        log_run(client, 'failure', 0, str(e))
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    run(args.dry_run)
