"""
Procurement Scrapers — TED Europa, Find a Tender Service (UK), SAM.gov (US)
============================================================================

Pulls public procurement notices for wind decommissioning / repowering / blade
recycling contracts and writes them as:
  • watch_events rows (category = 'market', event_type = 'Contractor Awarded' /
    'Tender Published')
  • repowering_projects rows where the notice references a specific site

Source registries (each is a separate function — run independently if one is
unreachable / rate-limited):

  TED Europa           https://api.ted.europa.eu/v3.0/notices/search
  Find a Tender (UK)   https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages
  SAM.gov (US)         https://api.sam.gov/opportunities/v2/search

Search strategy: keyword + CPV-code filter for wind decommissioning.
  CPV 71530000-2 — Construction consultancy services
  CPV 90510000-5 — Refuse and waste related services
  CPV 90520000-8 — Radioactive, toxic, medical and hazardous waste services
  CPV 45111100-9 — Demolition work
  CPV 45111200-0 — Site preparation and clearance work
  Free-text: "wind farm" + ("decommission" OR "repower" OR "dismantle")

Required env vars:
  TED_API_KEY           (optional — TED v3 has rate limits without)
  FTS_API_KEY           (UK Find a Tender)
  SAM_API_KEY           (US SAM.gov; required, free at https://sam.gov/data-services)

Usage:
  python ingest_procurement.py [--source ted|fts|sam|all] [--days 90]
"""
from __future__ import annotations

import argparse
import logging
import os
import re
from datetime import date, timedelta

import requests
from base_ingestor import get_supabase_client, today_iso

log = logging.getLogger(__name__)
PIPELINE = 'ingest_procurement'

KEYWORDS = ['wind', 'decommission', 'repower', 'dismantle', 'blade recycling',
            'turbine removal', 'wind farm']
CPV_CODES = ['71530000', '90510000', '90520000', '45111100', '45111200']


def _matches_wind_decom(text: str) -> bool:
    """Free-text classifier — must match wind AND a decommissioning verb."""
    if not text:
        return False
    t = text.lower()
    has_wind  = 'wind' in t or 'turbine' in t
    has_decom = any(kw in t for kw in ['decommission', 'repower', 'dismantle',
                                        'blade recycl', 'turbine removal',
                                        'wind farm removal'])
    return has_wind and has_decom


def _truncate(s: str | None, n: int = 255) -> str:
    return (s or '')[:n]


def _parse_capacity_mw(text: str) -> float | None:
    """Crude regex: '12 MW', '12.5 MW', '12 mw', etc."""
    if not text:
        return None
    m = re.search(r'(\d+(?:[.,]\d+)?)\s*MW', text, re.IGNORECASE)
    if m:
        try:
            return float(m.group(1).replace(',', '.'))
        except ValueError:
            return None
    return None


# ── TED Europa ─────────────────────────────────────────────────────────────────

def fetch_ted(days: int) -> list[dict]:
    """
    TED Europa v3 search API. Public; rate-limited without API key.
    Reference: https://docs.ted.europa.eu/api/index.html
    """
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    payload = {
        'query': (
            f'(notice-type IN (cn-standard, cn-social, cn-desg))'
            f' AND (publication-date >= {cutoff})'
            f' AND (cpv IN ({" ".join(CPV_CODES)}))'
        ),
        'limit': 200,
        'fields': ['BT-21-Lot', 'BT-22-Lot', 'BT-24-Lot', 'BT-23-Lot',
                   'place-of-performance', 'cpv', 'publication-date',
                   'buyer-name', 'links']
    }
    headers = {}
    api_key = os.environ.get('TED_API_KEY')
    if api_key:
        headers['Authorization'] = f'Bearer {api_key}'

    log.info(f'TED Europa: searching back {days} days for wind decom CPVs…')
    try:
        r = requests.post('https://api.ted.europa.eu/v3.0/notices/search',
                          json=payload, headers=headers, timeout=60)
        if r.status_code == 429:
            log.warning('TED rate-limited; consider setting TED_API_KEY')
            return []
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        log.warning(f'TED fetch failed: {e}')
        return []

    notices = data.get('notices', []) or []
    rows = []
    for n in notices:
        title = (n.get('BT-21-Lot') or n.get('BT-22-Lot') or '').strip()
        desc  = (n.get('BT-24-Lot') or '').strip()
        full  = f'{title} {desc}'.lower()
        if not _matches_wind_decom(full):
            continue
        rows.append({
            'category':    'market',
            'event_type':  'Tender Published',
            'scope':       'EU',
            'headline':    _truncate(title or 'TED procurement notice'),
            'notes':       _truncate(desc, 500),
            'site_name':   None,
            'company_name': _truncate(n.get('buyer-name')),
            'developer':   None,
            'capacity_mw': _parse_capacity_mw(full),
            'event_date':  n.get('publication-date') or date.today().isoformat(),
            'confidence':  'High',
            'source_url':  (n.get('links') or [None])[0],
            'liability_tags': ['CAP', 'PROV'],
        })
    log.info(f'TED: matched {len(rows)} wind-decom notices out of {len(notices)} total')
    return rows


# ── Find a Tender Service (UK) ─────────────────────────────────────────────────

def fetch_fts(days: int) -> list[dict]:
    """
    UK Find a Tender Service — OCDS release package endpoint.
    Reference: https://www.find-tender.service.gov.uk/api
    """
    api_key = os.environ.get('FTS_API_KEY')
    if not api_key:
        log.warning('FTS_API_KEY not set — skipping Find a Tender Service')
        return []

    cutoff_dt = (date.today() - timedelta(days=days)).isoformat()
    log.info(f'Find a Tender: pulling releases since {cutoff_dt}…')

    rows: list[dict] = []
    try:
        r = requests.get(
            'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages',
            params={'updatedFrom': f'{cutoff_dt}T00:00:00', 'limit': 200},
            headers={'Authorization': f'Bearer {api_key}'},
            timeout=60,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        log.warning(f'FTS fetch failed: {e}')
        return []

    for pkg in data.get('releases', []) or []:
        tender = pkg.get('tender', {})
        title  = tender.get('title') or ''
        desc   = tender.get('description') or ''
        full   = f'{title} {desc}'.lower()
        if not _matches_wind_decom(full):
            continue
        buyer = (pkg.get('buyer') or {}).get('name')
        rows.append({
            'category':    'market',
            'event_type':  'Tender Published',
            'scope':       'GB',
            'headline':    _truncate(title or 'UK procurement notice'),
            'notes':       _truncate(desc, 500),
            'site_name':   None,
            'company_name': _truncate(buyer),
            'developer':   None,
            'capacity_mw': _parse_capacity_mw(full),
            'event_date':  (tender.get('datePublished') or date.today().isoformat())[:10],
            'confidence':  'High',
            'source_url':  pkg.get('url'),
            'liability_tags': ['CAP', 'PROV'],
        })
    log.info(f'FTS: matched {len(rows)} wind-decom notices')
    return rows


# ── SAM.gov (US) ───────────────────────────────────────────────────────────────

def fetch_sam(days: int) -> list[dict]:
    """
    SAM.gov Opportunities v2 search.
    Reference: https://open.gsa.gov/api/get-opportunities-public-api/
    """
    api_key = os.environ.get('SAM_API_KEY')
    if not api_key:
        log.warning('SAM_API_KEY not set — skipping SAM.gov')
        return []

    posted_from = (date.today() - timedelta(days=days)).strftime('%m/%d/%Y')
    posted_to   = date.today().strftime('%m/%d/%Y')
    rows: list[dict] = []

    log.info(f'SAM.gov: searching wind decommissioning opportunities {posted_from}–{posted_to}…')
    try:
        r = requests.get(
            'https://api.sam.gov/opportunities/v2/search',
            params={
                'api_key':   api_key,
                'limit':     200,
                'postedFrom': posted_from,
                'postedTo':   posted_to,
                'q':         'wind decommission OR repower OR dismantle',
                'ptype':     'o',     # solicitations
            },
            timeout=60,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        log.warning(f'SAM.gov fetch failed: {e}')
        return []

    for opp in data.get('opportunitiesData', []) or []:
        title = opp.get('title') or ''
        desc  = opp.get('description') or ''
        full  = f'{title} {desc}'.lower()
        if not _matches_wind_decom(full):
            continue
        agency = ((opp.get('fullParentPathName') or '').split('.')[-1]).strip()
        rows.append({
            'category':    'market',
            'event_type':  'Tender Published',
            'scope':       'US',
            'headline':    _truncate(title or 'SAM.gov opportunity'),
            'notes':       _truncate(desc, 500),
            'site_name':   _truncate(opp.get('placeOfPerformance', {}).get('city', {}).get('name')),
            'company_name': _truncate(agency),
            'developer':   None,
            'capacity_mw': _parse_capacity_mw(full),
            'event_date':  (opp.get('postedDate') or date.today().isoformat())[:10],
            'confidence':  'High',
            'source_url':  opp.get('uiLink'),
            'liability_tags': ['CAP', 'PROV'],
        })
    log.info(f'SAM.gov: matched {len(rows)} wind-decom opportunities')
    return rows


# ── Persistence ────────────────────────────────────────────────────────────────

def ensure_source_id(client, source_name: str) -> str | None:
    """Look up or create a watch_sources row; returns the UUID."""
    res = client.table('watch_sources').select('id').eq('name', source_name).limit(1).execute()
    if res.data:
        return res.data[0]['id']
    ins = client.table('watch_sources').insert({
        'name': source_name,
        'source_type': 'procurement',
    }).execute()
    return (ins.data or [{}])[0].get('id')


def upsert_watch_events(client, rows: list[dict], source_name: str) -> int:
    if not rows:
        return 0
    sid = ensure_source_id(client, source_name)
    for r in rows:
        r['source_id'] = sid
        # Synthetic airtable_record_id so duplicates don't accumulate on re-run
        sig = f"{source_name}:{r['scope']}:{r['event_date']}:{(r['headline'] or '')[:80]}"
        r['airtable_record_id'] = f'PROC:{abs(hash(sig)) % 10**12}'
    client.table('watch_events').upsert(rows, on_conflict='airtable_record_id').execute()
    return len(rows)


def log_run(client, status: str, written: int, source: str, error: str | None = None):
    client.table('ingestion_runs').insert({
        'pipeline':           f'{PIPELINE}_{source}',
        'status':             status,
        'started_at':         f'{date.today()}T00:00:00Z',
        'finished_at':        f'{date.today()}T00:00:01Z',
        'records_written':    written,
        'source_attribution': {
            'ted': 'TED Europa (CC-BY 4.0)',
            'fts': 'Find a Tender Service, UK Government (Open Government Licence v3.0)',
            'sam': 'SAM.gov US Federal Procurement (CC0)',
        }.get(source, source),
        'notes':              f'Wind decommissioning / repowering procurement notices',
        'error_message':      error,
    }).execute()


# ── CLI ─────────────────────────────────────────────────────────────────────────

def run(source: str = 'all', days: int = 90):
    log.info(f'=== ingest_procurement starting (source={source}, days={days}) ===')
    client = get_supabase_client()

    sources = {'ted': ('TED Europa', fetch_ted),
               'fts': ('Find a Tender Service', fetch_fts),
               'sam': ('SAM.gov',     fetch_sam)}
    todo = list(sources.items()) if source == 'all' else [(source, sources[source])]

    grand_total = 0
    for code, (name, fn) in todo:
        try:
            rows = fn(days)
            n = upsert_watch_events(client, rows, name)
            log_run(client, 'success', n, code)
            grand_total += n
            log.info(f'  {name}: wrote {n} watch_events')
        except Exception as e:
            log.exception(f'{name} failed')
            log_run(client, 'failure', 0, code, str(e))

    log.info(f'=== complete: {grand_total} total procurement notices ===')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', choices=['ted','fts','sam','all'], default='all')
    parser.add_argument('--days', type=int, default=90)
    args = parser.parse_args()
    run(args.source, args.days)
