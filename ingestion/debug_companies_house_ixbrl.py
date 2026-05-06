#!/usr/bin/env python3
"""
Debug helper for Companies House iXBRL.

Pass a company number (and optionally an index 0..N-1 picking which recent
accounts filing to inspect) and this dumps every <ix:nonFraction> tag found
in the iXBRL document, sorted by namespace + concept name. Lets us see what
concepts the filer actually used so we can decide whether to expand the
DECOM_CONCEPT_PATTERNS list in sync_companies_house_ixbrl.py.

Usage:
    python3 debug_companies_house_ixbrl.py 07385051            # latest filing
    python3 debug_companies_house_ixbrl.py 07385051 1          # second-most-recent
    python3 debug_companies_house_ixbrl.py 07385051 0 raw      # also dump raw HTML to /tmp

Requires CH_API_KEY env var.
"""

from __future__ import annotations

import os
import sys
import time
from collections import Counter

import requests
from lxml import html as lxml_html

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

CH_API_KEY = os.environ.get('CH_API_KEY', '').strip()
PUBLIC_API = 'https://api.company-information.service.gov.uk'

IX_NS = {
    'ix':   'http://www.xbrl.org/2013/inlineXBRL',
    'ix11': 'http://www.xbrl.org/2008/inlineXBRL',
    'xbrli':'http://www.xbrl.org/2003/instance',
}


def _ch_get(url: str, accept: str = 'application/json') -> requests.Response:
    time.sleep(0.6)
    return requests.get(
        url,
        auth=(CH_API_KEY, ''),
        headers={'Accept': accept, 'User-Agent': 'endenex-terminal/debug'},
        timeout=60,
        allow_redirects=True,
    )


def main():
    if not CH_API_KEY:
        sys.exit('Set CH_API_KEY env var first')
    if len(sys.argv) < 2:
        sys.exit('Usage: debug_companies_house_ixbrl.py <company_number> [filing_index] [raw]')

    cn          = sys.argv[1]
    idx         = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 0
    dump_raw    = 'raw' in sys.argv[2:]

    # 1. List filings
    fh = _ch_get(f'{PUBLIC_API}/company/{cn}/filing-history?category=accounts&items_per_page=10').json()
    items = [i for i in (fh.get('items') or []) if i.get('links', {}).get('document_metadata')]
    if not items:
        sys.exit(f'No accounts filings for {cn}')
    if idx >= len(items):
        sys.exit(f'Only {len(items)} filings; idx={idx} out of range')

    f = items[idx]
    meta_url = f['links']['document_metadata']
    print(f'Company:    {cn}')
    print(f'Filing:     {f.get("description", "")} ({f.get("date")})')
    print(f'Period:     {(f.get("description_values") or {}).get("made_up_date")}')
    print(f'Document:   {meta_url}')

    # 2a. Ask metadata endpoint which formats are available
    meta_resp = _ch_get(meta_url, accept='application/json')
    if meta_resp.status_code != 200:
        sys.exit(f'metadata fetch failed: HTTP {meta_resp.status_code}')
    meta = meta_resp.json()
    resources = (meta.get('resources') or {})
    print(f'Available:  {list(resources.keys()) or "(none listed)"}')
    print()

    if 'application/xhtml+xml' not in resources:
        print('No iXBRL variant available — filing is PDF-only.')
        if 'application/pdf' in resources:
            print('PDF-only filings have no machine-readable provision tags.')
        return

    # 2b. Fetch iXBRL
    resp = _ch_get(meta_url + '/content', accept='application/xhtml+xml')
    ct = (resp.headers.get('content-type') or '').lower()
    print(f'HTTP:       {resp.status_code}  Content-Type: {ct}')
    print()
    if resp.status_code != 200 or 'pdf' in ct:
        sys.exit(f'iXBRL fetch failed (status {resp.status_code}, ct={ct}).')

    if dump_raw:
        out = f'/tmp/ch_{cn}_{idx}.html'
        with open(out, 'wb') as fh:
            fh.write(resp.content)
        print(f'Raw iXBRL dumped to {out}')

    # 3. Parse and list every nonFraction tag
    root = lxml_html.fromstring(resp.content)
    nodes = root.xpath('//ix:nonFraction | //ix11:nonFraction', namespaces=IX_NS)
    print(f'Found {len(nodes)} <ix:nonFraction> tags')
    print()

    counts: Counter[str] = Counter()
    for n in nodes:
        name = n.get('name') or '(no name)'
        counts[name] += 1

    # Sort by namespace then concept
    rows = sorted(counts.items(), key=lambda kv: (kv[0].split(':')[0], kv[0].split(':')[-1]))

    # Highlight likely-relevant ones
    needle = ('decommission', 'restoration', 'dilapidation', 'rehab', 'provision',
              'retire', 'aro', 'environmental')
    print(f'{"count":>6}  {"concept":<70}  hit')
    print(f'{"-"*6}  {"-"*70}  ---')
    for name, n in rows:
        flag = '★' if any(k in name.lower() for k in needle) else ''
        print(f'{n:>6}  {name:<70}  {flag}')

    # Also show what unique namespaces appeared
    print()
    nss = Counter(name.split(':')[0] for name in counts)
    print('Namespaces seen:')
    for ns, n in nss.most_common():
        print(f'  {ns:<20} {n} unique concepts')


if __name__ == '__main__':
    main()
