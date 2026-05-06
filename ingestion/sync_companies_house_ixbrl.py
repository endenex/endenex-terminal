#!/usr/bin/env python3
"""
Companies House iXBRL → Supabase sync.

For each UK company in ch_companies_watch:
  1. Hit the Companies House Public API filing-history endpoint to find the
     most recent annual-accounts filing (`category = "accounts"`).
  2. Hit the Companies House Document API to download the iXBRL document
     (Accept: application/xhtml+xml — the iXBRL variant of the accounts).
  3. Parse <ix:nonFraction> elements whose `name` attribute matches a
     curated list of FRS 102 / IFRS provision concepts (decommissioning,
     dilapidation, restoration).
  4. Upsert into ch_filings + ch_provisions.

References:
  Public API:    https://developer-specs.company-information.service.gov.uk/
  Document API:  https://developer-specs.company-information.service.gov.uk/document-api/
  Auth:          HTTP Basic, username = API key, password empty.
                 Get a key at https://developer.company-information.service.gov.uk/

Env vars:
  CH_API_KEY                — Companies House REST API key (free, rate-limited)
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Rate limit: 600 requests / 5 min per IP. We sleep 0.6s between API hits.

Why iXBRL not pdf/xml: iXBRL is the canonical CH machine-readable form for
small/medium/full accounts since 2010. Tags are HTML-namespaced
<ix:nonFraction name="uk-bus:Foo" contextRef="..." decimals="-3">1234</ix:nonFraction>.
We parse with lxml directly — no need for arelle (heavyweight, slow).
"""

from __future__ import annotations

import os
import re
import sys
import time
import requests
from datetime import date, datetime
from typing import Iterable
from decimal import Decimal, InvalidOperation

from base_ingestor import get_supabase_client, log

try:
    from lxml import etree, html as lxml_html
except ImportError:
    log.error('lxml is required: pip install lxml')
    sys.exit(1)


# ── Configuration ──────────────────────────────────────────────────────────

CH_API_KEY = os.environ.get('CH_API_KEY', '').strip()
PUBLIC_API = 'https://api.company-information.service.gov.uk'
DOC_API    = 'https://document-api.company-information.service.gov.uk'

# Politeness — CH allows 600 req / 5 min per IP. 0.6s between requests = safe.
REQUEST_SPACING_S = 0.6

# Filings to consider — annual accounts only.
ACCOUNTS_CATEGORIES = {'accounts'}

# How many recent annual accounts filings to fetch per company.
N_RECENT_FILINGS = 2

# iXBRL concept names we care about (substring match, case-insensitive).
# Spans both UK GAAP / FRS 102 (uk-bus, uk-gaap) and IFRS (ifrs-full) taxonomies.
# Real-world tag names vary by taxonomy version; we match permissively.
DECOM_CONCEPT_PATTERNS = [
    'decommission',          # ProvisionsForDecommissioningCosts, DecommissioningRestorationAndRehabilitationCostsProvision
    'dilapidation',          # Dilapidations (lease end-of-term)
    'siterestoration',       # SiteRestoration
    'restorationcost',       # RestorationCosts
    'restorationprovision',  # RestorationProvision
    'environmentalrestoration',
    'rehabilitationprovision',
    'asset retirement',
    'aro',
]

# Generic provisions concepts — captured but flagged as is_provision but
# concept_name doesn't necessarily mean decom. View filters by concept LIKE
# decom/restoration to surface the relevant subset.
GENERIC_PROVISION_PATTERNS = [
    'provisionsforliabilities',
    'totalprovisions',
    'otherprovisions',
]

ALL_CONCEPT_PATTERNS = DECOM_CONCEPT_PATTERNS + GENERIC_PROVISION_PATTERNS


# ── HTTP helpers ───────────────────────────────────────────────────────────

def _check_api_key() -> None:
    if not CH_API_KEY:
        log.error('CH_API_KEY env var is not set.')
        log.error('Get a free key at https://developer.company-information.service.gov.uk/')
        sys.exit(1)


def _ch_get(url: str, accept: str = 'application/json', stream: bool = False) -> requests.Response:
    """GET against either CH API. Basic-auth: username=API key, password empty."""
    time.sleep(REQUEST_SPACING_S)
    resp = requests.get(
        url,
        auth=(CH_API_KEY, ''),
        headers={'Accept': accept, 'User-Agent': 'endenex-terminal/1.0'},
        stream=stream,
        timeout=60,
        allow_redirects=True,
    )
    return resp


# ── Companies House API wrappers ───────────────────────────────────────────

def fetch_filing_history(company_number: str, category: str = 'accounts',
                         items_per_page: int = 25) -> list[dict]:
    """List recent filings for a company, filtered to accounts category."""
    url = f'{PUBLIC_API}/company/{company_number}/filing-history'
    params = f'?category={category}&items_per_page={items_per_page}'
    resp = _ch_get(url + params)
    if resp.status_code == 404:
        log.warning(f'  {company_number}: not found at Companies House')
        return []
    if resp.status_code == 429:
        log.warning(f'  {company_number}: rate-limited; sleeping 60s')
        time.sleep(60)
        return fetch_filing_history(company_number, category, items_per_page)
    resp.raise_for_status()
    items = resp.json().get('items') or []
    # We want filings with a linked iXBRL document
    return [i for i in items if i.get('links', {}).get('document_metadata')]


def fetch_document_metadata(metadata_url: str) -> dict | None:
    """Document API metadata — tells us which content types are available."""
    resp = _ch_get(metadata_url)
    if resp.status_code != 200:
        return None
    return resp.json()


def fetch_ixbrl_document(metadata_url: str) -> bytes | None:
    """
    Fetch the iXBRL representation of a filing.

    The Document API content endpoint is `{metadata_url}/content`. We send
    Accept: application/xhtml+xml to ask for the iXBRL flavour. CH redirects
    to a signed S3-style URL; requests follows it.
    """
    resp = _ch_get(metadata_url + '/content', accept='application/xhtml+xml', stream=False)
    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        log.warning(f'    document fetch returned {resp.status_code} for {metadata_url}')
        return None
    # Some filings return PDF even when iXBRL was requested (the Accept header
    # is honoured only when an iXBRL variant exists). Sniff content-type.
    ct = (resp.headers.get('content-type') or '').lower()
    if 'pdf' in ct or 'application/pdf' in ct:
        return None
    return resp.content


# ── iXBRL parser ───────────────────────────────────────────────────────────

# Namespace map seen in CH iXBRL filings. The <ix:nonFraction> tag lives in
# the XBRL inline namespace; the `name` attribute references whatever taxonomy
# the filer used (frs-102, ifrs-full, uk-bus, uk-gaap, etc.).
IX_NS = {
    'ix':   'http://www.xbrl.org/2013/inlineXBRL',
    'ix11': 'http://www.xbrl.org/2008/inlineXBRL',  # older filings
    'xbrli':'http://www.xbrl.org/2003/instance',
}


def _norm_concept(s: str | None) -> str:
    """lowercase + strip namespaces + collapse whitespace for substring match."""
    if not s:
        return ''
    s = s.split(':')[-1]    # uk-bus:ProvisionsForDecommissioningCosts → ProvisionsForDecommissioningCosts
    return re.sub(r'[\s_-]+', '', s).lower()


def _matches_any(needle: str, patterns: Iterable[str]) -> bool:
    n = needle.lower()
    return any(p.lower().replace(' ', '').replace('-', '').replace('_', '') in n for p in patterns)


def _decode_ixbrl_value(text: str | None, sign_attr: str | None,
                        scale_attr: str | None, decimals_attr: str | None) -> Decimal | None:
    """
    iXBRL numeric values are presentation-formatted. Apply sign, scale, and
    digit-only normalisation. The `decimals` attribute is metadata about
    precision (negative = thousands/millions) but in CH practice the visible
    number is already in the unit shown (e.g. £'000) — we use scale to lift
    back to base units.
    """
    if not text:
        return None
    # Strip presentation chars: thousand separators, parentheses for negatives, currency symbols
    txt = text.strip().replace(',', '').replace('£', '').replace('$', '').replace('€', '').strip()
    is_paren_neg = txt.startswith('(') and txt.endswith(')')
    if is_paren_neg:
        txt = txt[1:-1]
    if txt in ('', '-', '–'):
        return None
    try:
        val = Decimal(txt)
    except InvalidOperation:
        return None
    if is_paren_neg or (sign_attr or '').strip() == '-':
        val = -val
    # Apply ix:nonFraction scale: presented value × 10^scale = reported value.
    # Common CH practice: numbers shown in £'000 use scale="3".
    if scale_attr:
        try:
            val = val * (Decimal(10) ** Decimal(scale_attr))
        except InvalidOperation:
            pass
    return val


def _context_period_end(root, context_ref: str) -> date | None:
    """Look up xbrli:context by id, return its endDate or instant."""
    if not context_ref:
        return None
    # Use XPath with namespace map. Contexts may live anywhere in the doc.
    ctxs = root.xpath(
        f'//xbrli:context[@id=$cid]',
        namespaces=IX_NS,
        cid=context_ref,
    )
    if not ctxs:
        return None
    ctx = ctxs[0]
    end = ctx.xpath('.//xbrli:endDate/text() | .//xbrli:instant/text()',
                    namespaces=IX_NS)
    if not end:
        return None
    try:
        return datetime.strptime(end[0].strip(), '%Y-%m-%d').date()
    except (ValueError, IndexError):
        return None


def parse_ixbrl(content: bytes) -> list[dict]:
    """
    Parse an iXBRL document and return all <ix:nonFraction> facts that
    match our concept patterns, with context-resolved period and decoded value.
    """
    try:
        root = lxml_html.fromstring(content)
    except Exception as e:
        log.warning(f'    iXBRL parse failed: {e}')
        return []

    # Find ix:nonFraction tags across both inline-XBRL namespace versions.
    nf_nodes = root.xpath('//ix:nonFraction | //ix11:nonFraction', namespaces=IX_NS)
    facts: list[dict] = []

    for node in nf_nodes:
        name = node.get('name') or ''
        if not name:
            continue
        norm = _norm_concept(name)
        if not _matches_any(norm, ALL_CONCEPT_PATTERNS):
            continue

        ctx_ref = node.get('contextRef')
        period_end = _context_period_end(root, ctx_ref)
        if not period_end:
            continue  # can't anchor in time → skip

        val = _decode_ixbrl_value(
            text=''.join(node.itertext()),
            sign_attr=node.get('sign'),
            scale_attr=node.get('scale'),
            decimals_attr=node.get('decimals'),
        )
        if val is None:
            continue

        facts.append({
            'concept_name':  name,
            'concept_label': name.split(':')[-1],
            'taxonomy':      name.split(':')[0] if ':' in name else None,
            'period_end':    period_end.isoformat(),
            'value_gbp':     float(val),
            'currency':      (node.get('unitRef') or 'GBP').upper().replace('ISO4217:', ''),
            'decimals':      int(node.get('decimals')) if (node.get('decimals') or '').lstrip('-').isdigit() else None,
            'is_provision':  _matches_any(norm, DECOM_CONCEPT_PATTERNS + ['provisionsforliabilities','totalprovisions','otherprovisions']),
            'context_ref':   ctx_ref,
        })

    return facts


# ── Per-company sync ───────────────────────────────────────────────────────

def sync_company(client, watch_row: dict) -> tuple[int, int]:
    """
    Sync one company. Returns (filings_processed, provisions_extracted).
    """
    cn = watch_row['company_number']
    name = watch_row['company_name']
    log.info(f'  {cn} {name}')

    try:
        filings = fetch_filing_history(cn, category='accounts',
                                       items_per_page=N_RECENT_FILINGS * 4)
    except requests.RequestException as e:
        log.warning(f'    filing-history fetch failed: {e}')
        return 0, 0

    if not filings:
        log.info('    no accounts filings found')
        return 0, 0

    # Take the N most recent
    filings = filings[:N_RECENT_FILINGS]
    n_filings, n_provisions = 0, 0

    for f in filings:
        txn_id        = f.get('transaction_id') or ''
        date_filed    = f.get('date')
        period_end    = (f.get('description_values') or {}).get('made_up_date')
        subtype       = f.get('description', '').split(' ')[0] if f.get('description') else None
        meta_url      = (f.get('links') or {}).get('document_metadata')
        if not meta_url or not txn_id:
            continue

        # Upsert filing row first (so we have an FK target for provisions)
        try:
            f_row = {
                'company_number': cn,
                'transaction_id': txn_id,
                'filing_type':    f.get('type', 'AA'),
                'filing_subtype': subtype,
                'date_filed':     date_filed,
                'period_end':     period_end,
                'document_url':   meta_url,
                'parse_status':   'pending',
            }
            up = client.table('ch_filings').upsert(
                f_row, on_conflict='company_number,transaction_id', returning='representation',
            ).execute()
            filing_id = (up.data or [{}])[0].get('id')
            if filing_id is None:
                # Fallback select if upsert didn't return the row
                got = client.table('ch_filings').select('id') \
                    .eq('company_number', cn).eq('transaction_id', txn_id).limit(1).execute()
                filing_id = (got.data or [{}])[0].get('id')
        except Exception as e:
            log.warning(f'    filing upsert failed: {e}')
            continue
        if filing_id is None:
            continue

        # Fetch + parse iXBRL
        try:
            content = fetch_ixbrl_document(meta_url)
        except requests.RequestException as e:
            log.warning(f'    document fetch failed: {e}')
            content = None

        if not content:
            client.table('ch_filings').update(
                {'parse_status': 'no_provisions', 'ixbrl_present': False}
            ).eq('id', filing_id).execute()
            n_filings += 1
            continue

        facts = parse_ixbrl(content)
        if not facts:
            client.table('ch_filings').update(
                {'parse_status': 'no_provisions', 'ixbrl_present': True}
            ).eq('id', filing_id).execute()
            n_filings += 1
            continue

        # Insert provision rows
        rows = [{**fct, 'company_number': cn, 'filing_id': filing_id} for fct in facts]
        try:
            client.table('ch_provisions').upsert(
                rows, on_conflict='filing_id,concept_name,period_end,context_ref',
            ).execute()
            n_provisions += len(rows)
            client.table('ch_filings').update(
                {'parse_status': 'success', 'ixbrl_present': True}
            ).eq('id', filing_id).execute()
            log.info(f'    {len(rows)} provision facts extracted')
        except Exception as e:
            log.warning(f'    provision upsert failed: {e}')
            client.table('ch_filings').update(
                {'parse_status': 'error', 'parse_error': str(e)[:500]}
            ).eq('id', filing_id).execute()

        n_filings += 1

    # Touch last_synced
    client.table('ch_companies_watch').update(
        {'last_synced': datetime.utcnow().isoformat() + 'Z'}
    ).eq('company_number', cn).execute()

    return n_filings, n_provisions


# ── Telemetry + main ───────────────────────────────────────────────────────

def _log_run(client, status: str, filings: int, provisions: int,
             error: str | None = None, notes: str = ''):
    try:
        client.table('ingestion_runs').insert({
            'pipeline':           'sync_companies_house_ixbrl',
            'status':             status,
            'started_at':         f'{date.today()}T00:00:00Z',
            'finished_at':        f'{date.today()}T00:00:01Z',
            'records_written':    provisions,
            'source_attribution': 'Companies House Public API + Document API (iXBRL)',
            'notes':              notes or f'{filings} filings · {provisions} provision facts',
            'error_message':      error,
        }).execute()
    except Exception as e:
        log.warning(f'Failed to write ingestion_runs telemetry: {e}')


def main():
    log.info('=== Companies House iXBRL → Supabase sync starting ===')
    _check_api_key()
    client = get_supabase_client()

    watch = client.table('ch_companies_watch').select('*') \
        .order('parent_group', desc=False).execute().data or []

    if not watch:
        log.error('ch_companies_watch is empty — run migration 026 first')
        sys.exit(1)

    log.info(f'  Tracking {len(watch)} companies')
    total_filings, total_provisions = 0, 0
    failures: list[str] = []

    try:
        for w in watch:
            try:
                f, p = sync_company(client, w)
                total_filings    += f
                total_provisions += p
            except Exception as e:
                log.exception(f'  failed: {w.get("company_number")}')
                failures.append(f'{w.get("company_number")} ({type(e).__name__})')

        notes = (f'{len(watch)} companies · {total_filings} filings · '
                 f'{total_provisions} provision facts'
                 + (f' · failures: {", ".join(failures)}' if failures else ''))
        log.info('')
        log.info(f'=== Sync complete: {notes} ===')
        _log_run(client,
                 status='success' if not failures else 'partial',
                 filings=total_filings, provisions=total_provisions,
                 notes=notes)

    except Exception as e:
        log.exception('Sync aborted')
        _log_run(client, 'failure', total_filings, total_provisions, error=str(e))
        sys.exit(1)


if __name__ == '__main__':
    main()
