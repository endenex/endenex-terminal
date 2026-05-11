#!/usr/bin/env python3
"""
One-shot backfill of scrap_price_benchmarks with FRED-modelled monthly
history per (grade, region) pair.

Same calibration as weekly_scrap_price_update.py, but applied to every
historical month from the FRED PPI series rather than just the latest one:

  For each (grade, region) tracked:
    1. Find the most recent NON-fred anchor row (= hand-curated Argus/AMM
       print already in scrap_price_benchmarks).
    2. Pull full FRED PPI history for the relevant series.
    3. Calibration factor: anchor_price / index_at_anchor_date.
    4. For every monthly FRED value within the look-back window:
         modelled_price = anchor_price × (this_month_index / anchor_index)
    5. Upsert as scrap_price_benchmarks rows, publisher='fred',
       period_type='monthly', confidence='Modelled'.

Idempotent: UNIQUE (material, region, publisher, benchmark_name,
price_date, period_type) blocks dupes if re-run.

Usage:
  python3 backfill_scrap_price_history.py
  python3 backfill_scrap_price_history.py --years 10
  python3 backfill_scrap_price_history.py --dry-run
"""

from __future__ import annotations

import argparse
import sys
from io import StringIO
from datetime import date, timedelta

import requests

from base_ingestor import get_supabase_client, log
from fred_client import fetch_fred, FRED_CSV_URL
from weekly_scrap_price_update import TRACKED, get_anchor_row, index_at_or_before


BATCH = 500


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--years',  type=int, default=5,  help='Look-back depth (default 5y)')
    ap.add_argument('--dry-run', action='store_true', help='Compute but do not insert')
    args = ap.parse_args()

    client  = get_supabase_client()
    today   = date.today().isoformat()
    cutoff  = (date.today() - timedelta(days=args.years * 365)).isoformat()
    log.info(f'=== scrap_price_benchmarks backfill · {args.years}y · cutoff {cutoff} ===')

    # Cache FRED histories — one HTTP call per distinct series
    fred_cache: dict[str, list[tuple[str, float]]] = {}
    for cfg in TRACKED:
        sid = cfg['fred_series']
        if sid not in fred_cache:
            log.info(f'  fetching FRED {sid}…')
            fred_cache[sid] = fetch_fred(sid)

    rows_to_insert: list[dict] = []
    skipped_pairs = 0

    for cfg in TRACKED:
        anchor = get_anchor_row(client, cfg['material'], cfg['region'])
        if anchor is None:
            log.warning(f'  no anchor for {cfg["material"]}/{cfg["region"]} — skip')
            skipped_pairs += 1
            continue

        history = fred_cache[cfg['fred_series']]
        if not history:
            log.warning(f'  empty FRED history for {cfg["fred_series"]} — skip')
            skipped_pairs += 1
            continue

        idx_at_anchor = index_at_or_before(history, anchor['price_date'])
        if idx_at_anchor is None or idx_at_anchor <= 0:
            log.warning(f'  no FRED value at/before anchor date {anchor["price_date"]} — skip')
            skipped_pairs += 1
            continue

        anchor_price = float(anchor['price'])
        rows_for_pair = 0
        for d, idx in history:
            if d < cutoff:
                continue
            # Skip the anchor's own date — keep the original print authoritative
            if d == anchor['price_date']:
                continue
            modelled_price = round(anchor_price * (idx / idx_at_anchor), 2)
            rows_to_insert.append({
                'material':       cfg['material'],
                'region':         cfg['region'],
                'publisher':      'fred',
                'benchmark_name': f'{cfg["benchmark_name"]} · history',
                'price':          modelled_price,
                'unit':           anchor['unit'],
                'price_date':     d,
                'period_type':    'monthly',
                'source_url':     f'https://fred.stlouisfed.org/series/{cfg["fred_series"]}',
                'ingestion_method':'auto_scraper',
                'confidence':     'medium',
                'notes':          (
                    f'FRED-modelled monthly history. '
                    f'Anchor: ${anchor_price:.2f}/t @ {anchor["price_date"]} '
                    f'({anchor["publisher"]} {anchor["benchmark_name"]}). '
                    f'FRED {cfg["fred_series"]} index: {idx_at_anchor:.2f} (anchor date) → '
                    f'{idx:.2f} ({d}). Modelled price = anchor × (this_index / anchor_index).'
                ),
            })
            rows_for_pair += 1

        log.info(
            f'  {cfg["material"]}/{cfg["region"]}: '
            f'anchor ${anchor_price:.2f} ({anchor["price_date"]}) → '
            f'{rows_for_pair} modelled monthly rows'
        )

    log.info(f'=== prepared {len(rows_to_insert)} rows across {len(TRACKED) - skipped_pairs} pairs ===')

    if args.dry_run:
        log.info('=== dry-run: nothing inserted ===')
        return

    inserted = 0
    for i in range(0, len(rows_to_insert), BATCH):
        chunk = rows_to_insert[i:i + BATCH]
        try:
            client.table('scrap_price_benchmarks').upsert(
                chunk,
                on_conflict='material,region,publisher,benchmark_name,price_date,period_type',
            ).execute()
            inserted += len(chunk)
        except Exception as e:
            log.error(f'  batch {i}-{i+BATCH} upsert failed: {e}')
            raise

    # Telemetry
    client.table('ingestion_runs').insert({
        'pipeline':           'backfill_scrap_price_history',
        'status':             'success',
        'started_at':         f'{today}T00:00:00Z',
        'finished_at':        f'{today}T00:00:00Z',
        'records_written':    inserted,
        'source_attribution': 'FRED PPI scrap series — monthly history calibrated to anchor prints',
        'notes':              f'Backfill · {args.years}y · {inserted} rows across {len(TRACKED) - skipped_pairs} pairs.',
    }).execute()

    log.info(f'=== complete: {inserted} rows inserted ===')


if __name__ == '__main__':
    main()
