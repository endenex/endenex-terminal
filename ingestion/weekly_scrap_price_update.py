#!/usr/bin/env python3
"""
Weekly scrap-price refresh — keeps the SMI Scrap Prices panel "latest".

Mechanism (free-source pipeline):
  1. For each tracked scrap grade, look up the most recent existing row in
     scrap_price_benchmarks (= the anchor — typically a hand-curated Argus /
     AMM print).
  2. Pull the latest FRED PPI scrap-index value (free, monthly). Compute the
     % movement of the index from the anchor's price_date to today.
  3. Apply that movement to the anchor price → modelled latest price.
  4. INSERT a new row with publisher='fred', confidence='Modelled', and
     today's price_date. The panel reads "latest" by max(price_date) so it
     surfaces this new row automatically.
  5. Logs telemetry to ingestion_runs.

This is *not* a substitute for an Argus / AMM live feed — it's a free
movement-tracker. The anchor stays the authoritative source; FRED just
keeps the most recent print roughly current.

Cadence:
  Weekly. FRED PPI updates monthly, so a weekly run will be a no-op three
  weeks out of four (idempotent — UNIQUE on (material, region, publisher,
  benchmark_name, price_date, period_type) blocks dupes).

Usage:
  python3 weekly_scrap_price_update.py
  python3 weekly_scrap_price_update.py --dry-run
"""

from __future__ import annotations

import argparse
import sys
from datetime import date

from base_ingestor import get_supabase_client, log
from fred_client import fetch_fred, FRED_CSV_URL

# Each tracked scrap grade gets one FRED PPI index that we apply movements
# from. Anchor row is looked up dynamically — the most-recent published
# price for that (material, region) other than our own modelled rows.
TRACKED = [
    {
        'material':       'steel_hms_1_2_8020',
        'region':         'TR',
        'fred_series':    'WPU101211',
        'benchmark_name': 'HMS 1&2 80:20 CFR Turkey (FRED-tracked from anchor)',
        'note':           'Movement from FRED WPU101211 (US Iron & Steel scrap PPI) applied to most-recent anchor.',
    },
    {
        'material':       'steel_hms_1_2_8020',
        'region':         'US',
        'fred_series':    'WPU101211',
        'benchmark_name': 'HMS 1&2 80:20 US composite (FRED-tracked from anchor)',
        'note':           'Movement from FRED WPU101211 (US Iron & Steel scrap PPI) applied to most-recent anchor.',
    },
    {
        'material':       'steel_shred',
        'region':         'US',
        'fred_series':    'WPU101211',
        'benchmark_name': 'Steel shred US composite (FRED-tracked from anchor)',
        'note':           'Movement from FRED WPU101211 applied to most-recent anchor.',
    },
    {
        'material':       'cast_iron_general',
        'region':         'US',
        'fred_series':    'WPU101211',
        'benchmark_name': 'Cast iron US composite (FRED-tracked from anchor)',
        'note':           'Movement from FRED WPU101211 applied to most-recent cast iron anchor.',
    },
    {
        'material':       'copper_no_2',
        'region':         'US',
        'fred_series':    'WPU10230102',
        'benchmark_name': 'Copper No.2 US (FRED-tracked from anchor)',
        'note':           'Movement from FRED WPU10230102 (No.2 Copper Scrap PPI) applied to most-recent anchor.',
    },
    {
        'material':       'copper_no_2',
        'region':         'EU',
        'fred_series':    'WPU10230102',
        'benchmark_name': 'Copper No.2 EU (FRED-tracked from anchor)',
        'note':           'Movement from FRED WPU10230102 applied to most-recent EU anchor.',
    },
    {
        'material':       'aluminium_taint_tabor',
        'region':         'US',
        'fred_series':    'WPU102302',
        'benchmark_name': 'Aluminium taint/tabor US (FRED-tracked from anchor)',
        'note':           'Movement from FRED WPU102302 (Aluminum Base Scrap PPI) applied to most-recent anchor.',
    },
    {
        'material':       'aluminium_taint_tabor',
        'region':         'EU',
        'fred_series':    'WPU102302',
        'benchmark_name': 'Aluminium taint/tabor EU (FRED-tracked from anchor)',
        'note':           'Movement from FRED WPU102302 applied to most-recent EU anchor.',
    },
]


def get_anchor_row(client, material: str, region: str) -> dict | None:
    """
    Most recent NON-fred anchor row for (material, region). We don't want to
    chain modelled-on-modelled, so we exclude publisher='fred'.
    """
    res = client.table('scrap_price_benchmarks') \
        .select('material, region, publisher, benchmark_name, price, unit, '
                'price_date, period_type, source_url, confidence, notes') \
        .eq('material', material) \
        .eq('region', region) \
        .neq('publisher', 'fred') \
        .order('price_date', desc=True) \
        .limit(1) \
        .execute()
    return res.data[0] if res.data else None


def index_at_or_before(history: list[tuple[str, float]], target_date: str) -> float | None:
    """Return the FRED value on or immediately before target_date."""
    best: float | None = None
    for d, v in history:
        if d <= target_date:
            best = v
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='Compute updates but do not insert.')
    args = ap.parse_args()

    client = get_supabase_client()
    today = date.today().isoformat()

    log.info(f'=== weekly scrap price update · {today} ===')

    # Cache FRED histories (one HTTP call per distinct series).
    # fetch_fred returns [] on transport failure (timeout / 5xx / network)
    # rather than raising — we track which series failed so the run can
    # be marked failed in telemetry rather than silently passing with
    # 0 records.
    fred_cache: dict[str, list[tuple[str, float]]] = {}
    fetch_failures: list[str] = []
    for cfg in TRACKED:
        sid = cfg['fred_series']
        if sid not in fred_cache:
            history = fetch_fred(sid)
            fred_cache[sid] = history
            if not history:
                fetch_failures.append(sid)

    # If every FRED series failed to fetch, this isn't a "no movement"
    # week — it's an upstream outage. Log to telemetry as failed and
    # exit non-zero so CI flags it.
    distinct_series = list({cfg['fred_series'] for cfg in TRACKED})
    if fetch_failures and len(fetch_failures) == len(distinct_series):
        msg = (f'All {len(distinct_series)} FRED series failed to fetch '
               f'(upstream outage or auth failure): {", ".join(fetch_failures)}')
        log.error(msg)
        try:
            client.table('ingestion_runs').insert({
                'pipeline':    'weekly_scrap_price_update',
                'status':      'failure',
                'started_at':  f'{today}T00:00:00Z',
                'finished_at': f'{today}T00:00:00Z',
                'records_written': 0,
                'notes':       msg,
            }).execute()
        except Exception as tex:
            log.error(f'  telemetry insert also failed: {tex}')
        sys.exit(1)

    inserted = 0
    skipped  = 0
    rows_to_insert: list[dict] = []

    for cfg in TRACKED:
        anchor = get_anchor_row(client, cfg['material'], cfg['region'])
        if anchor is None:
            log.warning(f'  no anchor for {cfg["material"]}/{cfg["region"]} — skip')
            skipped += 1
            continue

        history = fred_cache[cfg['fred_series']]
        if not history:
            log.warning(f'  empty FRED history for {cfg["fred_series"]} — skip')
            skipped += 1
            continue

        latest_date, latest_idx = history[-1]
        idx_at_anchor = index_at_or_before(history, anchor['price_date'])
        if idx_at_anchor is None or idx_at_anchor <= 0:
            log.warning(f'  no FRED value at/before anchor date {anchor["price_date"]} — skip')
            skipped += 1
            continue

        movement = latest_idx / idx_at_anchor
        new_price = round(float(anchor['price']) * movement, 2)
        delta_pct = (movement - 1) * 100

        log.info(
            f'  {cfg["material"]}/{cfg["region"]}: '
            f'anchor ${anchor["price"]:.2f} ({anchor["price_date"]}) '
            f'× FRED movement {delta_pct:+.2f}% → ${new_price:.2f} (FRED latest {latest_date})'
        )

        rows_to_insert.append({
            'material':        cfg['material'],
            'region':          cfg['region'],
            'publisher':       'fred',
            'benchmark_name':  cfg['benchmark_name'],
            'price':           new_price,
            'unit':            anchor['unit'],
            'price_date':      today,
            'period_type':     'weekly',
            'source_url':      f'https://fred.stlouisfed.org/series/{cfg["fred_series"]}',
            'ingestion_method':'auto_scraper',
            'confidence':      'medium',
            'notes':           (
                f'{cfg["note"]} '
                f'Anchor: ${anchor["price"]:.2f}/t @ {anchor["price_date"]} '
                f'({anchor["publisher"]} {anchor["benchmark_name"]}). '
                f'FRED {cfg["fred_series"]} movement {delta_pct:+.2f}% from '
                f'{anchor["price_date"]} ({idx_at_anchor:.2f}) → {latest_date} ({latest_idx:.2f}).'
            ),
        })

    if args.dry_run:
        log.info(f'=== dry-run: {len(rows_to_insert)} rows would be inserted, {skipped} skipped ===')
        return

    # Idempotent: UNIQUE constraint blocks dupes if run twice in same week.
    if rows_to_insert:
        try:
            client.table('scrap_price_benchmarks').upsert(
                rows_to_insert,
                on_conflict='material,region,publisher,benchmark_name,price_date,period_type',
            ).execute()
            inserted = len(rows_to_insert)
        except Exception as e:
            log.error(f'  upsert failed: {e}')
            raise

    # Telemetry. Status is 'partial' when some FRED series failed but
    # others succeeded — the panel still gets fresh data, but we want
    # the partial outage visible.
    status = 'partial' if fetch_failures else 'success'
    notes  = f'Weekly run · {inserted} rows inserted · {skipped} skipped (no anchor or no FRED value).'
    if fetch_failures:
        notes += f' FRED fetch failed for: {", ".join(fetch_failures)}.'
    client.table('ingestion_runs').insert({
        'pipeline':           'weekly_scrap_price_update',
        'status':             status,
        'started_at':         f'{today}T00:00:00Z',
        'finished_at':        f'{today}T00:00:00Z',
        'records_written':    inserted,
        'source_attribution': 'FRED PPI scrap series (free; movements applied to most-recent hand-curated anchor)',
        'notes':              notes,
    }).execute()

    log.info(f'=== complete: {inserted} inserted, {skipped} skipped, status={status} ===')


if __name__ == '__main__':
    main()
