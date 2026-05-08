#!/usr/bin/env python3
"""
FRED PPI scrap series → commodity_prices for Historical Prices & Basis chart.

FRED (St. Louis Fed) publishes long-history monthly Producer Price Index
series for scrap metals — the only free authoritative source for multi-
decade mill-payable scrap history. We fetch via the public CSV endpoint
(no API key required), calibrate each index series to a known current spot
price from scrap_price_benchmarks, and insert as monthly rows into
commodity_prices with derivation='Modelled' (calibrated index, not raw
spot).

The Historical Prices & Basis chart picks these up as a third series ─
"Mill payable (FRED PPI)" — alongside LME refined (Observed) and the
Asset-Owner-Net derived band.

Series:
  WPU101211     Iron and Steel Scrap PPI       (since 1947)
  WPU10230102   No.2 Copper Scrap PPI
  WPU102302     Aluminum Base Scrap PPI

Calibration:
  Each FRED series is an INDEX (e.g., 1982 = 100). To plot in USD/t we
  anchor the most-recent FRED value to a known current scrap price from
  scrap_price_benchmarks. Anchor factor = anchor_$ / latest_index. All
  historical FRED values are then multiplied by that factor.

Usage:
  python3 fetch_fred_scrap_history.py
  python3 fetch_fred_scrap_history.py --years 10
  python3 fetch_fred_scrap_history.py --series steel_scrap
"""

from __future__ import annotations

import argparse
import sys
from io import StringIO
from datetime import date, timedelta

import requests

from base_ingestor import get_supabase_client, log


FRED_CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}'

FRED_SERIES = {
    'steel_scrap': {
        'series_id':       'WPU101211',
        'material_type':   'iron_ore',                 # uses Steel·iron tab
        'region':          'US',
        'anchor_grade':    'steel_hms_1_2_8020',
        'anchor_region':   'US',
        'note':            'PPI by Commodity: Iron and Steel Scrap (since 1947, base 1982=100)',
    },
    'copper_scrap': {
        'series_id':       'WPU10230102',
        'material_type':   'copper',
        'region':          'US',
        'anchor_grade':    'copper_no_2',
        'anchor_region':   'US',
        'note':            'PPI by Commodity: No.2 Copper Scrap',
    },
    'aluminium_scrap': {
        'series_id':       'WPU102302',
        'material_type':   'aluminium',
        'region':          'US',
        'anchor_grade':    'aluminium_taint_tabor',
        'anchor_region':   'US',
        'note':            'PPI by Commodity: Aluminum Base Scrap',
    },
}

BATCH = 500


def fetch_fred(series_id: str):
    """Returns list of (date_iso, index_value) for the FRED series."""
    try:
        import pandas as pd
    except ImportError:
        log.error('pandas required: pip install pandas')
        sys.exit(1)

    url = FRED_CSV_URL.format(series_id=series_id)
    log.info(f'  fetching FRED {series_id}…')
    r = requests.get(url, timeout=60, headers={'User-Agent': 'endenex-terminal/1.0'})
    r.raise_for_status()

    df = pd.read_csv(StringIO(r.text))
    if len(df.columns) < 2:
        log.warning(f'    unexpected CSV shape: {df.columns.tolist()}')
        return []
    # First column = DATE, second = series value (named after series_id)
    date_col = df.columns[0]
    val_col  = df.columns[1]
    df[date_col] = df[date_col].astype(str)
    df = df[[date_col, val_col]].rename(columns={date_col: 'd', val_col: 'v'})

    out: list[tuple[str, float]] = []
    for _, row in df.iterrows():
        d = str(row['d']).strip()
        try:
            v = float(row['v'])
        except (TypeError, ValueError):
            continue
        if v != v or v <= 0:
            continue
        out.append((d, v))
    log.info(f'    {len(out)} monthly rows fetched ({out[0][0]} → {out[-1][0]})' if out else '    empty')
    return out


def get_anchor_price(client, scrap_grade: str, anchor_region: str) -> tuple[float | None, str | None]:
    """Most recent published spot price for scrap_grade — used to calibrate FRED index."""
    res = client.table('scrap_price_benchmarks') \
        .select('price, price_date, region') \
        .eq('material', scrap_grade) \
        .order('price_date', desc=True).limit(50).execute()
    if not res.data:
        return None, None
    # Prefer the anchor_region; fall back to first row
    for r in res.data:
        if r.get('region') == anchor_region:
            return float(r['price']), r['price_date']
    return float(res.data[0]['price']), res.data[0]['price_date']


def upsert_batch(client, rows: list[dict]) -> int:
    if not rows:
        return 0
    total = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        client.table('commodity_prices').upsert(
            chunk, on_conflict='material_type,region,price_date'
        ).execute()
        total += len(chunk)
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--series', help='Restrict to one series (steel_scrap / copper_scrap / aluminium_scrap)')
    ap.add_argument('--years',  type=int, default=10, help='How far back to load (default 10y)')
    args = ap.parse_args()

    series_keys = [args.series] if args.series else list(FRED_SERIES.keys())
    series_keys = [k for k in series_keys if k in FRED_SERIES]
    if not series_keys:
        sys.exit('No matching series in FRED_SERIES')

    client = get_supabase_client()
    today = date.today().isoformat()
    cutoff = (date.today() - timedelta(days=args.years * 365)).isoformat()

    log.info(f'=== FRED PPI scrap backfill · {len(series_keys)} series · {args.years}y ===')
    grand_total = 0

    for key in series_keys:
        cfg = FRED_SERIES[key]
        history = fetch_fred(cfg['series_id'])
        if not history:
            continue

        # Anchor calibration
        anchor_price, anchor_date = get_anchor_price(client, cfg['anchor_grade'], cfg['anchor_region'])
        if anchor_price is None:
            log.warning(f'  no anchor price for {cfg["anchor_grade"]} — skipping {key} (run scrap_price_benchmarks seed first)')
            continue
        latest_idx = history[-1][1]
        factor = anchor_price / latest_idx
        log.info(f'  {key}: anchor ${anchor_price}/t = {latest_idx:.1f} index pts → ×{factor:.4f}')

        rows = []
        for d, idx in history:
            if d < cutoff:
                continue
            rows.append({
                'material_type':   cfg['material_type'],
                'region':          cfg['region'],
                'price_per_tonne': round(idx * factor, 2),
                'currency':        'USD',
                'price_date':      d,
                'source_name':     f'FRED PPI {cfg["series_id"]} (calibrated to {cfg["anchor_grade"]} ${anchor_price:.0f}/t @ {anchor_date})',
                'source_date':     today,
                'confidence':      'High',
                'derivation':      'Modelled',
                'last_reviewed':   today,
            })
        n = upsert_batch(client, rows)
        grand_total += n
        log.info(f'  {key}: upserted {n} rows ({cfg["material_type"]}/{cfg["region"]})')

    log.info(f'=== complete: {grand_total} total rows ===')


if __name__ == '__main__':
    main()
