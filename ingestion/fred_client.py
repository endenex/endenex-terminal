"""
Shared FRED fetch client.

The CSV graph endpoint at fred.stlouisfed.org is unreliable — verified
2026-05-10/11 returning 60s+ read timeouts and HTTP/2 stream errors
under modest load. The proper API at api.stlouisfed.org is rock-solid
but requires a free key.

This module gives both endpoints a single shared implementation:
  - API first when FRED_API_KEY is set (reliable; no fallback needed)
  - CSV fallback with retry-with-backoff when no key (or API empty)

Used by:
  - weekly_scrap_price_update.py   (scheduled — failure here breaks CI)
  - fetch_fred_scrap_history.py    (backfill / refresh)

Two run-once backfills (backfill_lme_history.py,
backfill_black_mass_synthetic.py) still inline their own naive CSV
fetch. They're not scheduled so the timeout risk is bounded; migrate
when next touched.
"""

from __future__ import annotations

import os
import time
from io import StringIO

import requests

from base_ingestor import log


FRED_API_URL = 'https://api.stlouisfed.org/fred/series/observations'
FRED_CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}'

FRED_API_KEY = os.environ.get('FRED_API_KEY')


def _fetch_via_api(series_id: str) -> list[tuple[str, float]]:
    """Pull observations via the FRED JSON API. Requires FRED_API_KEY."""
    try:
        r = requests.get(FRED_API_URL, timeout=30, params={
            'series_id':  series_id,
            'api_key':    FRED_API_KEY,
            'file_type':  'json',
        })
        if r.status_code != 200:
            log.warning(f'    {series_id}: API HTTP {r.status_code} — {r.text[:200]}')
            return []
        observations = (r.json() or {}).get('observations') or []
        out: list[tuple[str, float]] = []
        for obs in observations:
            try:
                v = float(obs.get('value'))
            except (TypeError, ValueError):
                continue
            if v <= 0 or v != v:
                continue
            d = (obs.get('date') or '').strip()
            if d:
                out.append((d, v))
        log.info(f'    {series_id}: {len(out)} obs via API')
        return out
    except Exception as e:
        log.warning(f'    {series_id}: API fetch failed: {e}')
        return []


def _fetch_via_csv(series_id: str) -> list[tuple[str, float]]:
    """CSV graph endpoint with 3× retry + exponential backoff. Used as
    fallback when FRED_API_KEY is unset or API returns empty."""
    try:
        import pandas as pd
    except ImportError:
        log.error('pandas required for CSV fallback: pip install pandas')
        return []

    url = FRED_CSV_URL.format(series_id=series_id)
    last_exc: Exception | None = None
    response = None
    for attempt in range(3):
        try:
            response = requests.get(
                url,
                timeout=(30, 90),
                headers={'User-Agent': 'endenex-terminal/1.0'},
            )
            response.raise_for_status()
            break
        except (requests.exceptions.Timeout,
                requests.exceptions.ConnectionError,
                requests.exceptions.HTTPError) as e:
            last_exc = e
            if attempt < 2:
                wait = 5 * (2 ** attempt)
                log.warning(
                    f'    {series_id}: CSV {type(e).__name__} on attempt '
                    f'{attempt+1}, retrying in {wait}s'
                )
                time.sleep(wait)
            else:
                log.warning(f'    {series_id}: CSV gave up after 3 attempts: {e}')
                return []

    if response is None:
        log.warning(f'    {series_id}: CSV exhausted retries: {last_exc}')
        return []

    df = pd.read_csv(StringIO(response.text))
    if len(df.columns) < 2:
        return []
    date_col = df.columns[0]
    val_col  = df.columns[1]
    df[date_col] = df[date_col].astype(str)
    out: list[tuple[str, float]] = []
    for _, row in df.iterrows():
        try:
            v = float(row[val_col])
        except (TypeError, ValueError):
            continue
        if v <= 0 or v != v:
            continue
        d = str(row[date_col]).strip()
        if d:
            out.append((d, v))
    log.info(f'    {series_id}: {len(out)} obs via CSV')
    return out


def fetch_fred(series_id: str) -> list[tuple[str, float]]:
    """Returns [(date_iso, index_value), ...] for the FRED series.

    Tries the JSON API first when FRED_API_KEY is configured (reliable),
    falls back to the CSV graph endpoint with retries otherwise.
    Empty list on failure (caller decides whether to skip or fail).
    """
    log.info(f'  fetching FRED {series_id}…')
    if FRED_API_KEY:
        out = _fetch_via_api(series_id)
        if out:
            return out
        log.info(f'    {series_id}: API returned empty, falling back to CSV')
    return _fetch_via_csv(series_id)
