#!/usr/bin/env python3
"""
CAISO Generator Interconnection Queue → repowering_projects.

CAISO publishes a public CSV/XLS of all active interconnection requests in
California. The file is updated weekly. We pull it, filter to wind/solar/
storage, normalise to our five-stage enum, and upsert.

URL (verified May 2026):
  http://www.caiso.com/Documents/PublicQueueReport.xlsx

CAISO queue stages (Phase column):
  - Cluster Study (annual cluster window)
  - Phase I Study (System Impact)
  - Phase II Study (Facilities)
  - GIA Negotiation (Generator Interconnection Agreement)
  - GIA Executed (interconnection agreement signed)
  - In Service / Withdrawn

The California pipeline plus standalone-storage queue contains ~250-400 GW
worth of projects, dominated by solar+storage hybrids. After Texas, this
is the next-largest US ISO pipeline.
"""

from __future__ import annotations

import argparse
import sys
from io import BytesIO

import requests

from base_ingestor import get_supabase_client, log
from repowering._base import (
    normalise_stage, normalise_asset_class,
    upsert_project, today_iso, parse_date,
)


CAISO_URL = 'http://www.caiso.com/Documents/PublicQueueReport.xlsx'

CAISO_STAGE_MAP = {
    'cluster_study':         'announced',
    'phase_i_study':         'application_submitted',
    'phase_ii_study':        'application_submitted',
    'gia_negotiation':       'application_approved',
    'gia_executed':          'permitted',
    'in_service':            'ongoing',
    'commercial_operation':  'ongoing',
    'under_construction':    'ongoing',
}


def fetch_workbook() -> bytes:
    r = requests.get(CAISO_URL, timeout=120, headers={'User-Agent': 'endenex-terminal/1.0'})
    r.raise_for_status()
    return r.content


def parse_workbook(xls_bytes: bytes) -> list[dict]:
    try:
        import openpyxl
    except ImportError:
        log.error('openpyxl required: pip install openpyxl')
        sys.exit(1)
    wb = openpyxl.load_workbook(BytesIO(xls_bytes), data_only=True, read_only=True)
    # CAISO publishes "Grid queue" or "Active Projects" — use first sheet
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [str(h or '').strip() for h in rows[0]]
    out: list[dict] = []
    for r in rows[1:]:
        if not r or all(c is None for c in r):
            continue
        out.append(dict(zip(headers, r)))
    return out


def build_row(rec: dict, today: str) -> dict | None:
    fuel = ((rec.get('Fuel-1') or rec.get('Fuel') or rec.get('Type')) or '').strip()
    asset_class = normalise_asset_class(fuel)
    # CAISO tags storage as "BATTERY" or "STORAGE"
    if not asset_class and 'storage' in fuel.lower() or 'battery' in fuel.lower():
        asset_class = 'bess'
    if asset_class not in {'onshore_wind','offshore_wind','solar_pv','bess'}:
        return None

    project_name = (rec.get('Project Name') or rec.get('Generator Name') or '').strip()
    if not project_name:
        return None

    stage_raw = rec.get('Current Status') or rec.get('Phase') or 'cluster_study'
    stage = normalise_stage(stage_raw, CAISO_STAGE_MAP) or 'announced'

    queue_pos = (rec.get('Queue Position') or rec.get('Queue #') or '').strip() if isinstance(rec.get('Queue Position'), str) else str(rec.get('Queue Position') or '')

    capacity = rec.get('MW-1') or rec.get('Net MW') or rec.get('MW')
    try:
        capacity_mw = float(capacity) if capacity else None
    except (TypeError, ValueError):
        capacity_mw = None

    county = (rec.get('County') or '').strip()
    state = (rec.get('State') or 'CA').strip()
    location = f'{county}, {state}' if county else f'{state}, USA'

    cod = parse_date(rec.get('Proposed On-line Date') or rec.get('Online Date'))

    return {
        'project_name':        project_name,
        'country_code':        'US',
        'asset_class':         asset_class,
        'stage':               stage,
        'stage_date':          cod or today,
        'capacity_mw':         capacity_mw,
        'developer':           (rec.get('Interconnection Customer') or rec.get('Developer') or None),
        'operator':            None,
        'planning_reference':  queue_pos or None,
        'location_description': location,
        'source_url':          'http://www.caiso.com/PublishedDocs/Public/PublicQueueReport.xlsx',
        'notes':               f'CAISO Queue · Q# {queue_pos}' if queue_pos else 'CAISO Queue',
        'source_type':         'caiso_queue',
        'source_date':         today,
        'confidence':          'High',
        'derivation':          'Observed',
        'last_reviewed':       today,
        'external_source':     'caiso_queue',
        'external_source_id':  queue_pos or None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    client = get_supabase_client()
    today = today_iso()
    log.info(f'=== CAISO queue ingestion · {today} ===')

    xls = fetch_workbook()
    log.info(f'  fetched {len(xls)/1024/1024:.1f} MB')
    rows = parse_workbook(xls)
    log.info(f'  parsed {len(rows)} rows')

    inserted = skipped = 0
    for rec in rows:
        row = build_row(rec, today)
        if not row:
            skipped += 1
            continue
        if args.dry_run:
            log.info(f'    {row["project_name"]} [{row["asset_class"]}/{row["stage"]}] · {row["capacity_mw"]} MW · {row["developer"] or "—"}')
            continue
        if upsert_project(client, row):
            inserted += 1
        else:
            skipped += 1

    if not args.dry_run:
        client.table('ingestion_runs').insert({
            'pipeline':           'caiso_queue_repowering',
            'status':             'success',
            'started_at':         f'{today}T00:00:00Z',
            'finished_at':        f'{today}T00:00:00Z',
            'records_written':    inserted,
            'source_attribution': f'CAISO Public Queue Report ({CAISO_URL})',
            'notes':              f'CAISO queue ingestion · {inserted} upserts · {skipped} skipped.',
        }).execute()

    log.info(f'=== complete: {inserted} upserted · {skipped} skipped ===')


if __name__ == '__main__':
    main()
