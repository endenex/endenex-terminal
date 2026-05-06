#!/usr/bin/env python3
"""
Curated seed of well-known BLM-permitted onshore wind projects.

Why this exists: the BLM ArcGIS state-office endpoints (sync_blm_row_polygons.py)
have patchy/incomplete coverage of operational wind ROW polygons. To give the
Bonds panel meaningful Federal Lands data right now, we seed a hand-curated
list of ~15 wind farms that are publicly documented as being on BLM land.

Each row is matched against us_wind_assets.project_name (USWTDB p_name field).
Matched turbines have is_federal_land=true and blm_row_serial set, so the
project-rollup view + spatial-join function pick them up automatically.

Each entry has a public citation for verifiability — typically a BLM ROW
serial number from a press release, EIS, or NEPA document.

Run AFTER sync_uswtdb.py has populated us_wind_assets.

Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import sys
from datetime import date

from base_ingestor import get_supabase_client, log


# Curated list of (USWTDB project name match pattern, BLM serial number, citation).
# Project names are matched case-insensitively against the START of p_name, so
# "Alta Wind" catches "Alta Wind Energy Center I", "Alta Wind II", etc.
KNOWN_BLM_WIND: list[tuple[str, str, str]] = [
    # ── California ────────────────────────────────────────────────────────────
    ('Alta Wind',           'CACA-052537', 'BLM CA Tehachapi · Alta Wind Energy Center ROD (2010)'),
    ('Manzana Wind',        'CACA-049395', 'BLM CA Antelope Valley · Manzana Wind Power Project (Iberdrola)'),
    ('Tule Wind',           'CACA-049867', 'BLM CA McCain Valley ROD (2011)'),
    ('Ocotillo Express',    'CACA-049397', 'BLM CA Imperial County ROD (2012)'),
    ('Pinyon Pines',        'CACA-049390', 'BLM CA Tehachapi · Pinyon Pines Wind ROW grant'),

    # ── Wyoming ──────────────────────────────────────────────────────────────
    ('Chokecherry',         'WYW-179692',  'BLM WY · Chokecherry & Sierra Madre Wind ROD (2012, Phase I 2017)'),
    ('Sierra Madre',        'WYW-179692',  'BLM WY · Chokecherry & Sierra Madre Wind ROD (2012)'),
    ('Rail Tie',            'WYW-185003',  'BLM WY · Rail Tie Wind ROD (2022)'),

    # ── Nevada ───────────────────────────────────────────────────────────────
    ('Spring Valley Wind',  'NVN-084626',  'BLM NV Ely District · Spring Valley Wind ROD (2010)'),

    # ── New Mexico ───────────────────────────────────────────────────────────
    ('High Lonesome',       'NMNM-129257', 'BLM NM Roswell Field Office · High Lonesome Mesa Wind ROD'),
    ('Western Spirit Wind', 'NMNM-138750', 'BLM NM Pattern Energy · Western Spirit Wind ROW grants'),
    ('Corona Wind',         'NMNM-129180', 'BLM NM Roswell Field Office · Corona Wind ROW'),

    # ── Oregon ───────────────────────────────────────────────────────────────
    ('Stateline Wind',      'ORW-058620',  'BLM OR Vale District · Stateline Wind Project ROW'),

    # ── Idaho ────────────────────────────────────────────────────────────────
    ('Cotterel Mountain',   'IDI-035091',  'BLM ID Burley Field Office · Cotterel Mountain Wind Project'),

    # ── Arizona ──────────────────────────────────────────────────────────────
    ('Mohave County Wind',  'AZA-034914',  'BLM AZ Kingman Field Office · Mohave County Wind Farm Project'),
]


def _log_run(client, status: str, written: int, error: str | None = None, notes: str = ''):
    try:
        client.table('ingestion_runs').insert({
            'pipeline':           'seed_known_blm_wind_projects',
            'status':             status,
            'started_at':         f'{date.today()}T00:00:00Z',
            'finished_at':        f'{date.today()}T00:00:01Z',
            'records_written':    written,
            'source_attribution': 'Curated · BLM RODs, NEPA documents, project ROW serial numbers',
            'notes':              notes,
            'error_message':      error,
        }).execute()
    except Exception as e:
        log.warning(f'Failed to write ingestion_runs telemetry: {e}')


def main():
    log.info('=== Seeding known BLM-permitted wind projects ===')
    client = get_supabase_client()
    total_flagged = 0
    matched_projects: list[str] = []

    try:
        for pattern, serial, citation in KNOWN_BLM_WIND:
            # Case-insensitive prefix match on USWTDB project_name (p_name)
            res = client.table('us_wind_assets') \
                .update({
                    'is_federal_land': True,
                    'blm_row_serial':  serial,
                    'flagged_at':      f'{date.today()}T00:00:00Z',
                }) \
                .ilike('project_name', f'{pattern}%') \
                .execute()
            n = len(res.data) if res.data else 0
            if n > 0:
                matched_projects.append(f'{pattern} ({serial}): {n} turbines')
                total_flagged += n
                log.info(f'  {pattern:25s} → {n:4d} turbines flagged ({serial})')
            else:
                log.info(f'  {pattern:25s} → 0 turbines (no USWTDB match)')

        log.info('')
        log.info(f'=== Seeding complete: {total_flagged:,} turbines flagged across {len(matched_projects)} BLM projects ===')
        for line in matched_projects:
            log.info(f'  · {line}')

        _log_run(client, 'success', total_flagged,
                 notes=f'{len(matched_projects)} projects matched · {total_flagged} turbines flagged')

    except Exception as e:
        log.exception('Seeding failed')
        _log_run(client, 'failure', total_flagged, error=str(e))
        sys.exit(1)


if __name__ == '__main__':
    main()
