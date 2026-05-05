"""
ECB FX Rates Daily Fetcher
============================

Pulls the European Central Bank's official daily reference rates and writes
them to the fx_rates table. Free, no API key required, official source.

Source: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
Format: XML, EUR-base, ~30 currencies, updated each ECB working day at ~16:00 CET
Licence: ECB free reuse

ECB schedule:
  • Published Mon-Fri at ~16:00 CET (15:00 UTC)
  • No update on TARGET2 holidays (~10 days/year)

If today's rates aren't out yet (run before 16:00 CET) the script falls back
to the most recent available date in the XML feed (ECB always returns the
latest day they've published).

Currencies kept: USD, GBP, JPY (matches the fx_rates table check constraint
quote_currency IN ('EUR','USD','GBP','JPY')). Plus EUR identity row.

Run cadence: daily.

Usage:
  python fetch_fx_rates.py [--dry-run]
"""
from __future__ import annotations

import argparse
import logging
import xml.etree.ElementTree as ET
from datetime import date

import requests
from base_ingestor import get_supabase_client, today_iso

log = logging.getLogger(__name__)
PIPELINE = 'fetch_fx_rates'

ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

# XML namespaces in the ECB feed
NS = {
    'gesmes': 'http://www.gesmes.org/xml/2002-08-01',
    'ecb':    'http://www.ecb.int/vocabulary/2002-08-01/eurofxref',
}

# Only currencies our fx_rates schema accepts (matches check constraint)
KEEP_CURRENCIES = {'USD', 'GBP', 'JPY'}


def fetch_ecb_xml() -> tuple[str, dict[str, float]] | None:
    """Returns (rate_date_iso, {currency: rate}) or None on failure."""
    log.info(f'GET {ECB_URL}')
    try:
        r = requests.get(ECB_URL, timeout=30,
                         headers={'User-Agent': 'Endenex Terminal FX Fetcher'})
        r.raise_for_status()
    except Exception as e:
        log.error(f'ECB fetch failed: {e}')
        return None

    try:
        root = ET.fromstring(r.content)
    except Exception as e:
        log.error(f'ECB XML parse failed: {e}')
        return None

    # The feed structure:
    # <Envelope><Cube><Cube time="2026-05-05"><Cube currency="USD" rate="1.0825"/>...
    cube = root.find('.//ecb:Cube/ecb:Cube[@time]', NS)
    if cube is None:
        log.error('ECB XML missing time-stamped Cube')
        return None

    rate_date = cube.attrib.get('time')
    rates: dict[str, float] = {}
    for c in cube.findall('ecb:Cube', NS):
        ccy = c.attrib.get('currency')
        rate = c.attrib.get('rate')
        if ccy in KEEP_CURRENCIES and rate:
            try:
                rates[ccy] = float(rate)
            except ValueError:
                continue

    log.info(f'ECB published rates for {rate_date}: {rates}')
    return rate_date, rates


def build_rows(rate_date: str, rates: dict[str, float]) -> list[dict]:
    """One row per currency including EUR identity."""
    rows = [{
        'base_currency':  'EUR',
        'quote_currency': 'EUR',
        'rate':           1.0,
        'rate_date':      rate_date,
        'source_type':    'ECB Reference Rate',
        'source_url':     ECB_URL,
    }]
    for ccy, rate in rates.items():
        rows.append({
            'base_currency':  'EUR',
            'quote_currency': ccy,
            'rate':           round(rate, 6),
            'rate_date':      rate_date,
            'source_type':    'ECB Reference Rate',
            'source_url':     ECB_URL,
        })
    return rows


def upsert_fx(client, rows: list[dict]) -> int:
    if not rows:
        return 0
    client.table('fx_rates').upsert(
        rows, on_conflict='base_currency,quote_currency,rate_date'
    ).execute()
    return len(rows)


def log_run(client, status: str, written: int, error: str | None = None,
            notes: str = ''):
    client.table('ingestion_runs').insert({
        'pipeline':           PIPELINE,
        'status':             status,
        'started_at':         f'{date.today()}T00:00:00Z',
        'finished_at':        f'{date.today()}T00:00:01Z',
        'records_written':    written,
        'source_attribution': 'European Central Bank — daily euro reference rates (free reuse)',
        'notes':              notes,
        'error_message':      error,
    }).execute()


def run(dry_run: bool = False):
    log.info('=== fetch_fx_rates starting ===')
    client = get_supabase_client()

    result = fetch_ecb_xml()
    if not result:
        log_run(client, 'failure', 0, 'ECB fetch or parse returned None')
        return

    rate_date, rates = result
    if not rates:
        log_run(client, 'failure', 0, 'ECB returned no usable currencies')
        return

    rows = build_rows(rate_date, rates)
    log.info(f'Built {len(rows)} fx_rates rows for {rate_date}')

    if dry_run:
        for r in rows:
            log.info(f'  EUR/{r["quote_currency"]} = {r["rate"]} on {r["rate_date"]}')
        return

    try:
        n = upsert_fx(client, rows)
        log_run(client, 'success', n,
                notes=f'ECB rates for {rate_date}: ' +
                      ' '.join(f'{c}={v:.4f}' for c, v in rates.items()))
        log.info(f'=== complete: {n} fx rows written for {rate_date} ===')
    except Exception as e:
        log.exception('fetch_fx_rates failed')
        log_run(client, 'failure', 0, str(e))
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    run(args.dry_run)
