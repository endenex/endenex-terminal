#!/usr/bin/env python3
"""
Survey: for every company in ch_companies_watch, list each recent accounts
filing and tell us which content formats are available at the CH Document
API. Definitive answer to "is iXBRL even available for our watchlist".

Output is a CSV-style table to stdout.

Requires CH_API_KEY env var.
"""

from __future__ import annotations

import os
import sys
import time
from collections import Counter

import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from base_ingestor import get_supabase_client, log

CH_API_KEY = os.environ.get('CH_API_KEY', '').strip()
PUBLIC_API = 'https://api.company-information.service.gov.uk'


def _ch_get(url, accept='application/json'):
    time.sleep(0.6)
    return requests.get(
        url, auth=(CH_API_KEY, ''),
        headers={'Accept': accept, 'User-Agent': 'endenex-terminal/survey'},
        timeout=60, allow_redirects=True,
    )


def main():
    if not CH_API_KEY:
        sys.exit('Set CH_API_KEY in .env')

    client = get_supabase_client()
    watch = client.table('ch_companies_watch').select('company_number, company_name') \
        .order('company_name').execute().data or []

    print(f'{"company":<48} {"period":<12} {"description":<55} {"formats"}')
    print('-' * 150)

    fmt_tally: Counter[str] = Counter()
    n_filings = 0
    n_with_ixbrl = 0
    n_pdf_only  = 0

    for w in watch:
        cn = w['company_number']
        name = w['company_name'][:46]
        try:
            fh = _ch_get(f'{PUBLIC_API}/company/{cn}/filing-history?category=accounts&items_per_page=10')
            if fh.status_code != 200:
                print(f'{name:<48} (no filing-history: HTTP {fh.status_code})')
                continue
            items = fh.json().get('items') or []
        except Exception as e:
            print(f'{name:<48} (filing-history error: {e})')
            continue

        if not items:
            print(f'{name:<48} (no accounts filings)')
            continue

        for f in items:
            meta = (f.get('links') or {}).get('document_metadata')
            if not meta:
                continue
            try:
                m = _ch_get(meta)
                if m.status_code != 200:
                    formats = f'(meta {m.status_code})'
                else:
                    resources = (m.json().get('resources') or {})
                    formats = ','.join(sorted(resources.keys())) or '(none)'
                    for k in resources.keys():
                        fmt_tally[k] += 1
                    if 'application/xhtml+xml' in resources:
                        n_with_ixbrl += 1
                    elif 'application/pdf' in resources:
                        n_pdf_only += 1
            except Exception as e:
                formats = f'(err {type(e).__name__})'

            n_filings += 1
            period = (f.get('description_values') or {}).get('made_up_date') or '—'
            desc   = (f.get('description') or '')[:53]
            print(f'{name:<48} {period:<12} {desc:<55} {formats}')

    print()
    print('═══════════════════════════════════════════════════════════════════════')
    print(f'Total filings inspected: {n_filings}')
    print(f'  with iXBRL available:  {n_with_ixbrl}')
    print(f'  PDF-only:              {n_pdf_only}')
    print()
    print('Format availability across all filings:')
    for fmt, n in fmt_tally.most_common():
        print(f'  {n:>4} × {fmt}')


if __name__ == '__main__':
    main()
