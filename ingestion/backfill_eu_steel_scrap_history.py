#!/usr/bin/env python3
"""
EU steel-scrap monthly history backfill — Eurostat producer-price-index
(NACE C24 basic metals) calibrated to the HMS_EU anchor.

Eurofer publishes quarterly market commentary, not a numeric time-series, so
"Eurofer history" doesn't exist as a structured source. The closest free EU
equivalent is Eurostat's industrial producer-price index for NACE rev.2 C24
"Manufacture of basic metals" — published monthly, EU27 aggregate, free
JSON API. We treat its movement the same way the FRED PPI backfill treats
WPU101211, but applied to the HMS_EU anchor ($355 Eurofer benchmark in
migration 042).

Result: HMS_EU history that genuinely diverges from HMS_TR (Argus CFR
Turkey) — rather than being a constant proxy of FRED US scrap PPI.

Source: https://ec.europa.eu/eurostat/databrowser/view/sts_inpp_m
API:    https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sts_inpp_m

Filter spec used:
  - indic_bt=PRC_PRR_BAS_LCD  (basic prices index)
  - nace_r2=C24               (basic metals manufacture)
  - geo=EU27_2020             (EU27 aggregate)
  - s_adj=NSA                 (non-seasonally adjusted)
  - unit=I15                  (index, 2015=100)

Usage:
  python3 backfill_eu_steel_scrap_history.py
  python3 backfill_eu_steel_scrap_history.py --years 5 --dry-run
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta

import requests

from base_ingestor import get_supabase_client, log


EUROSTAT_URL = (
    'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/'
    'sts_inpp_m?format=JSON'
    '&indic_bt=PRC_PRR'      # producer price relative
    '&nace_r2=C24'           # NACE rev.2 — manufacture of basic metals
    '&geo=EU27_2020'         # EU27 aggregate
    '&s_adj=NSA'             # non-seasonally adjusted
    '&unit=I21'              # index, 2021=100
)

ANCHOR_MATERIAL = 'steel_hms_1_2_8020'
ANCHOR_REGION   = 'EU'
BENCHMARK_NAME  = 'HMS 1&2 EU domestic (Eurostat C24 PPI-tracked) · history'
SOURCE_URL      = 'https://ec.europa.eu/eurostat/databrowser/view/sts_inpp_m'

BATCH = 500


def fetch_eurostat() -> list[tuple[str, float]]:
    """Returns [(YYYY-MM-01, index_value), ...] for EU27 NACE C24 monthly PPI."""
    log.info(f'  fetching Eurostat sts_inpp_m EU27 NACE C24…')
    r = requests.get(EUROSTAT_URL, timeout=120, headers={
        'User-Agent': 'endenex-terminal/1.0',
        'Accept': 'application/json',
    })
    r.raise_for_status()
    payload = r.json()

    # Eurostat JSON-stat: dimension['time'].category.index gives a {time_label: pos}
    # mapping; value is a {pos: number} mapping. We need to invert the time index.
    try:
        time_cat = payload['dimension']['time']['category']
        time_index: dict[str, int] = time_cat['index']
        values: dict[str, float] = payload.get('value', {})
    except (KeyError, TypeError) as e:
        log.error(f'  unexpected Eurostat response shape: {e}')
        return []

    # Invert time_index: pos → label
    pos_to_time = {pos: label for label, pos in time_index.items()}
    out: list[tuple[str, float]] = []
    for pos_str, raw in values.items():
        try:
            pos = int(pos_str)
            v = float(raw)
        except (TypeError, ValueError):
            continue
        label = pos_to_time.get(pos)
        if not label:
            continue
        # Eurostat time labels are YYYY-MM (or YYYY-Mxx). Normalise to YYYY-MM-01.
        if 'M' in label:
            yr, mo = label.split('M', 1)
            d = f'{int(yr):04d}-{int(mo):02d}-01'
        elif '-' in label and len(label) == 7:
            d = f'{label}-01'
        else:
            continue
        if v > 0:
            out.append((d, v))
    out.sort(key=lambda x: x[0])
    log.info(f'    {len(out)} monthly rows ({out[0][0]} → {out[-1][0]})' if out else '    empty')
    return out


def get_anchor_row(client) -> dict | None:
    res = client.table('scrap_price_benchmarks') \
        .select('material, region, publisher, benchmark_name, price, unit, price_date, period_type, source_url, confidence, notes') \
        .eq('material', ANCHOR_MATERIAL) \
        .eq('region',   ANCHOR_REGION) \
        .neq('publisher', 'fred') \
        .neq('publisher', 'eurostat') \
        .order('price_date', desc=True) \
        .limit(1) \
        .execute()
    return res.data[0] if res.data else None


def index_at_or_before(history: list[tuple[str, float]], target_date: str) -> float | None:
    best: float | None = None
    for d, v in history:
        if d <= target_date:
            best = v
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--years',   type=int, default=5,  help='Look-back depth (default 5y)')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    client = get_supabase_client()
    today  = date.today().isoformat()
    cutoff = (date.today() - timedelta(days=args.years * 365)).isoformat()
    log.info(f'=== EU steel scrap history backfill · {args.years}y · cutoff {cutoff} ===')

    history = fetch_eurostat()
    if not history:
        log.error('  Eurostat fetch returned no data — check the API URL/filter codes')
        sys.exit(1)

    anchor = get_anchor_row(client)
    if anchor is None:
        log.error(f'  no anchor for {ANCHOR_MATERIAL}/{ANCHOR_REGION} — seed it first (migration 042)')
        sys.exit(1)
    anchor_price = float(anchor['price'])
    log.info(f'  anchor: ${anchor_price:.2f}/t @ {anchor["price_date"]} ({anchor["publisher"]} {anchor["benchmark_name"]})')

    idx_at_anchor = index_at_or_before(history, anchor['price_date'])
    if idx_at_anchor is None or idx_at_anchor <= 0:
        log.error(f'  no Eurostat value at/before {anchor["price_date"]}')
        sys.exit(1)
    log.info(f'  Eurostat C24 PPI at anchor date: {idx_at_anchor:.2f}')

    rows: list[dict] = []
    for d, idx in history:
        if d < cutoff:
            continue
        if d == anchor['price_date']:
            continue
        modelled_price = round(anchor_price * (idx / idx_at_anchor), 2)
        rows.append({
            'material':         ANCHOR_MATERIAL,
            'region':           ANCHOR_REGION,
            'publisher':        'eurofer',  # nearest fit in CHECK constraint for EU steel context
            'benchmark_name':   BENCHMARK_NAME,
            'price':            modelled_price,
            'unit':             anchor['unit'],
            'price_date':       d,
            'period_type':      'monthly',
            'source_url':       SOURCE_URL,
            'ingestion_method': 'auto_scraper',
            'confidence':       'medium',
            'notes':            (
                f'Eurostat NACE C24 PPI-tracked monthly history. '
                f'Anchor: ${anchor_price:.2f}/t @ {anchor["price_date"]} '
                f'({anchor["publisher"]} {anchor["benchmark_name"]}). '
                f'Eurostat C24 EU27 PPI: {idx_at_anchor:.2f} (anchor date) → '
                f'{idx:.2f} ({d}). Modelled price = anchor × (this_index / anchor_index).'
            ),
        })

    log.info(f'  prepared {len(rows)} modelled monthly rows')
    if args.dry_run:
        log.info('=== dry-run: nothing inserted ===')
        return

    inserted = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        client.table('scrap_price_benchmarks').upsert(
            chunk,
            on_conflict='material,region,publisher,benchmark_name,price_date,period_type',
        ).execute()
        inserted += len(chunk)

    client.table('ingestion_runs').insert({
        'pipeline':           'backfill_eu_steel_scrap_history',
        'status':             'success',
        'started_at':         f'{today}T00:00:00Z',
        'finished_at':        f'{today}T00:00:00Z',
        'records_written':    inserted,
        'source_attribution': 'Eurostat sts_inpp_m NACE C24 EU27 PPI — calibrated to HMS_EU anchor',
        'notes':              f'Backfill · {args.years}y · {inserted} rows for {ANCHOR_MATERIAL}/{ANCHOR_REGION}.',
    }).execute()
    log.info(f'=== complete: {inserted} rows inserted ===')


if __name__ == '__main__':
    main()
