#!/usr/bin/env python3
"""
Airtable → Supabase sync for the Watch module.

Fetches all records from the Endenex intelligence feed Airtable base,
maps fields to the watch_events schema, deduplicates cross-source coverage
of the same event, and upserts into Supabase.

Required env vars:
  AIRTABLE_TOKEN        — Airtable personal access token
  AIRTABLE_BASE_ID      — Airtable base ID (appXXXXXXXX)
  AIRTABLE_TABLE_ID     — Airtable table ID (tblXXXXXXXX)
  SUPABASE_URL          — Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY — Supabase service role key
"""

import os
import logging
from datetime import date, datetime

import requests
from dotenv import load_dotenv
from base_ingestor import get_supabase_client

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
log = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────────

AIRTABLE_TOKEN    = os.environ['AIRTABLE_TOKEN']
AIRTABLE_BASE_ID  = os.environ['AIRTABLE_BASE_ID']
AIRTABLE_TABLE_ID = os.environ['AIRTABLE_TABLE_ID']
AIRTABLE_URL      = f'https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{AIRTABLE_TABLE_ID}'

BATCH_SIZE = 200

# ── Field mapping tables ────────────────────────────────────────────────────────

ACTIVITY_CATEGORY: dict[str, str] = {
    'Repowering':              'market',
    'Decommissioning':         'market',
    'Foundation Removal':      'market',
    'Site Restoration':        'market',
    'End-of-Life Planning':    'market',
    'Blade/Recycling':         'supply_chain',
    'Regulatory/Bonding':      'regulatory',
    'Operator Announcement':   'market',
    'Contractor News':         'supply_chain',
    'Recycler Announcement':   'supply_chain',
    'Provision Disclosure':    'regulatory',
    'Policy':                  'regulatory',
    'Trade Body':              'regulatory',
    'Court Ruling':            'regulatory',
    'Insolvency':              'market',
    'Audit Guidance':          'regulatory',
    'Tender':                  'market',
    'Commodity':               'commodity',
    'Capacity':                'supply_chain',
    # Japan-specific
    'FIT Expiry':              'regulatory',
    'Post-FIT Decision':       'market',
    'METI Disclosure':         'regulatory',
    'Japan Cohort':            'market',
}

ACTIVITY_EVENT_TYPE: dict[str, str] = {
    'Repowering':              'Repowering',
    'Decommissioning':         'Decommissioning',
    'Foundation Removal':      'Foundation removal',
    'Site Restoration':        'Site restoration',
    'End-of-Life Planning':    'End-of-life planning',
    'Blade/Recycling':         'Blade / recycling',
    'Regulatory/Bonding':      'Regulatory / bonding',
    'Operator Announcement':   'Operator announcement',
    'Contractor News':         'Contractor news',
    'Recycler Announcement':   'Recycler announcement',
    'Provision Disclosure':    'Provision disclosure',
    'Policy':                  'Policy',
    'Trade Body':              'Trade body',
    'Court Ruling':            'Court ruling',
    'Insolvency':              'Insolvency',
    'Audit Guidance':          'Audit guidance',
    'Tender':                  'Tender',
    'Commodity':               'Commodity move',
    'Capacity':                'Capacity signal',
    'FIT Expiry':              'FIT expiry',
    'Post-FIT Decision':       'Post-FIT decision',
    'METI Disclosure':         'METI disclosure',
    'Japan Cohort':            'Japan cohort',
}

MARKET_SCOPE: dict[str, str] = {
    # Europe
    'UK':              'GB',
    'Germany':         'DE',
    'Spain':           'ES',
    'France':          'FR',
    'Denmark':         'DK',
    'Netherlands':     'NL',
    'Sweden':          'SE',
    'Italy':           'IT',
    'Other Europe':    'EU',
    'EU':              'EU',
    # US
    'Other US':        'US',
    'Midwest US':      'US',
    'Texas':           'US',
    'California':      'US',
    'US':              'US',
    # Japan — previously missing
    'Japan':           'JP',
    'Other Japan':     'JP',
    'JP':              'JP',
    # Australia
    'Australia':       'AU',
    # Global
    'Multiple':        'Global',
    'Global':          'Global',
}

# ── Liability-impact tag derivation ────────────────────────────────────────────
# Derive tags automatically from category + event_type.
# These can be overridden by an explicit 'Liability Tags' field in Airtable.

_LIABILITY_RULES: list[tuple[str, str, list[str]]] = [
    # (category_match_or_*, event_type_fragment_or_*, tags)
    ('regulatory', 'bond',       ['COST_UP']),
    ('regulatory', 'policy',     ['POL']),
    ('regulatory', 'disclosure', ['PROV']),
    ('regulatory', 'METI',       ['POL', 'PROV']),
    ('regulatory', 'FIT',        ['POL']),
    ('regulatory', 'court',      ['COST_UP']),
    ('regulatory', 'audit',      ['PROV']),
    ('market',     'decommission', ['COST_UP']),
    ('market',     'repower',    ['COST_UP']),
    ('market',     'insolvency', ['COST_UP']),
    ('market',     'provision',  ['PROV']),
    ('supply_chain','recycl',    ['REC_UP']),
    ('supply_chain','blade',     ['COST_UP']),
    ('supply_chain','capacity',  ['CAP']),
    ('supply_chain','contract',  ['CAP']),
    ('commodity',  '',           ['REC_UP']),   # commodity moves → recovery signal
]


def derive_liability_tags(category: str, event_type: str) -> list[str]:
    """Return liability-impact tags inferred from category and event_type."""
    tags: set[str] = set()
    cat_lc  = (category or '').lower()
    evt_lc  = (event_type or '').lower()

    for rule_cat, rule_frag, rule_tags in _LIABILITY_RULES:
        if rule_cat != '*' and rule_cat not in cat_lc:
            continue
        if rule_frag and rule_frag.lower() not in evt_lc:
            continue
        tags.update(rule_tags)

    return sorted(tags)

RELEVANCE_CONFIDENCE: dict[str, str] = {
    'HIGH':   'High',
    'MEDIUM': 'Medium',
    'LOW':    'Low',
}

CONFIDENCE_PRIORITY: dict[str, int] = {
    'High': 0, 'Medium': 1, 'Low': 2,
}

# ── Airtable fetch ─────────────────────────────────────────────────────────────

def fetch_airtable_records() -> list[dict]:
    """Paginate through all Airtable records and return them."""
    headers  = {'Authorization': f'Bearer {AIRTABLE_TOKEN}'}
    records: list[dict] = []
    params: dict        = {'pageSize': 100}

    while True:
        resp = requests.get(AIRTABLE_URL, headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        records.extend(data.get('records', []))
        log.info(f'  Fetched {len(records)} records…')

        offset = data.get('offset')
        if not offset:
            break
        params['offset'] = offset

    return records

# ── Field parsing helpers ──────────────────────────────────────────────────────

def parse_activity_types(raw) -> list[str]:
    """Handle Airtable single-select, multi-select, or plain text."""
    if not raw:
        return []
    if isinstance(raw, list):
        return [a.strip() for a in raw if str(a).strip()]
    return [a.strip() for a in str(raw).split(',') if a.strip()]


def parse_date(raw) -> str | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw)[:10]).date().isoformat()
    except Exception:
        return None


def parse_capacity(raw) -> float | None:
    try:
        v = float(raw)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None

# ── Record mapping ─────────────────────────────────────────────────────────────

def map_record(rec: dict, source_id_map: dict[str, str]) -> dict | None:
    """Map a single Airtable record to a watch_events row. Returns None to skip."""
    f = rec.get('fields', {})

    headline = (f.get('Title') or '').strip()
    if not headline:
        return None

    event_date = parse_date(f.get('Published Date')) or parse_date(f.get('Ingested Date'))
    if not event_date:
        return None

    activity_types  = parse_activity_types(f.get('Activity Type'))
    primary         = activity_types[0] if activity_types else None
    category        = ACTIVITY_CATEGORY.get(primary, 'market')      if primary else 'market'
    event_type      = ACTIVITY_EVENT_TYPE.get(primary, primary or 'Other') if primary else 'Other'

    market     = (f.get('Market') or '').strip()
    scope      = MARKET_SCOPE.get(market, 'Global')

    relevance  = (f.get('Relevance') or '').strip().upper()
    confidence = RELEVANCE_CONFIDENCE.get(relevance, 'Low')

    source_name = (f.get('Source') or '').strip()
    source_id   = source_id_map.get(source_name)

    stakeholder = (f.get('Stakeholder Type') or '').strip()
    operator    = (f.get('Operator') or '').strip() or None

    # Liability tags: use explicit Airtable field if present, else derive
    explicit_tags = [
        t.strip() for t in str(f.get('Liability Tags') or '').split(',')
        if t.strip()
    ]
    liability_tags = explicit_tags if explicit_tags else derive_liability_tags(category, event_type)

    return {
        'airtable_record_id': rec['id'],
        'category':           category,
        'event_type':         event_type,
        'scope':              scope,
        'headline':           headline,
        'notes':              (f.get('Summary') or '').strip() or None,
        'site_name':          (f.get('Asset Name') or '').strip() or None,
        'developer':          operator if stakeholder == 'Operator' else None,
        'company_name':       operator if stakeholder != 'Operator' else None,
        'capacity_mw':        parse_capacity(f.get('Capacity MW')),
        'asset_type':         (f.get('Asset Type') or '').strip() or None,
        'stakeholder_type':   stakeholder or None,
        'activity_types':     activity_types or None,
        'liability_tags':     liability_tags,
        'event_date':         event_date,
        'source_id':          source_id,
        'source_url':         (f.get('URL') or '').strip() or None,
        'confidence':         confidence,
        'last_reviewed':      date.today().isoformat(),
        'is_duplicate':       False,
        'source_count':       1,
    }

# ── Source sync ────────────────────────────────────────────────────────────────

def sync_sources(client, source_names: set[str]) -> dict[str, str]:
    """
    Ensure all source names exist in watch_sources.
    Returns {name: uuid} mapping.
    """
    existing   = client.table('watch_sources').select('id,name').execute()
    name_to_id = {s['name']: s['id'] for s in (existing.data or [])}

    new_names = [n for n in source_names if n and n not in name_to_id]
    if new_names:
        result = client.table('watch_sources').insert(
            [{'name': n} for n in new_names]
        ).execute()
        for s in (result.data or []):
            name_to_id[s['name']] = s['id']
        log.info(f'  Created {len(new_names)} new source records')

    return name_to_id

# ── Deduplication ──────────────────────────────────────────────────────────────

def date_bucket(d: str, window_days: int = 7) -> int:
    """
    Bucket a date into N-day windows so events within ~1 week of each other
    share the same bucket and can be compared as potential duplicates.
    """
    try:
        return date.fromisoformat(d).toordinal() // window_days
    except Exception:
        return 0


def dedup_key(rec: dict) -> str | None:
    """
    Generate a grouping key for duplicate detection.
    Requires an entity anchor (site_name or company/developer name) to avoid
    false positives on generic event types.
    """
    site      = (rec.get('site_name') or '').strip().lower()
    entity    = (rec.get('developer') or rec.get('company_name') or '').strip().lower()
    scope     = rec['scope']
    evt       = rec['event_type']
    bucket    = date_bucket(rec['event_date'])

    if site:
        return f"{scope}|{evt}|{site}|{bucket}"
    if entity:
        return f"{scope}|{evt}|{entity}|{bucket}"
    return None  # No anchor — cannot safely deduplicate


def mark_duplicates(records: list[dict]) -> list[dict]:
    """
    Sort records by confidence (best first).
    For each dedup key, the first record is canonical; the rest are duplicates.
    Set source_count on canonical records.
    """
    ordered = sorted(records, key=lambda r: CONFIDENCE_PRIORITY.get(r['confidence'], 3))

    canonical: dict[str, str] = {}   # key → canonical airtable_record_id
    counts:    dict[str, int] = {}   # canonical_id → count of records sharing that key

    for rec in ordered:
        key = dedup_key(rec)
        if key is None:
            continue
        if key in canonical:
            rec['is_duplicate'] = True
            counts[canonical[key]] = counts.get(canonical[key], 1) + 1
        else:
            canonical[key] = rec['airtable_record_id']

    # Write source_count back onto canonicals
    for rec in ordered:
        if not rec.get('is_duplicate'):
            rec['source_count'] = counts.get(rec['airtable_record_id'], 1)

    return records

# ── Main ───────────────────────────────────────────────────────────────────────

def _log_run(client, status: str, written: int, error: str | None = None, notes: str = ''):
    """Write a row to ingestion_runs telemetry so the Data Health overlay sees it."""
    try:
        client.table('ingestion_runs').insert({
            'pipeline':           'sync_airtable_watch',
            'status':             status,
            'started_at':         f'{date.today()}T00:00:00Z',
            'finished_at':        f'{date.today()}T00:00:01Z',
            'records_written':    written,
            'source_attribution': 'Airtable curated intelligence feed',
            'notes':              notes,
            'error_message':      error,
        }).execute()
    except Exception as e:
        log.warning(f'Failed to write ingestion_runs telemetry: {e}')


def main():
    log.info('=== Airtable → Watch sync starting ===')
    client = get_supabase_client()
    total = 0
    dup_count = 0

    try:
        # 1. Fetch from Airtable
        log.info('Fetching records from Airtable…')
        raw = fetch_airtable_records()
        log.info(f'Fetched {len(raw)} records')

        # 2. Sync sources
        source_names = {
            (r.get('fields', {}).get('Source') or '').strip()
            for r in raw
            if (r.get('fields', {}).get('Source') or '').strip()
        }
        log.info(f'Syncing {len(source_names)} sources…')
        source_id_map = sync_sources(client, source_names)

        # 3. Map records
        mapped: list[dict] = []
        skipped = 0
        for rec in raw:
            row = map_record(rec, source_id_map)
            if row:
                mapped.append(row)
            else:
                skipped += 1
        log.info(f'Mapped {len(mapped)} records ({skipped} skipped — missing title or date)')

        # 4. Deduplicate
        log.info('Running deduplication…')
        mapped     = mark_duplicates(mapped)
        dup_count  = sum(1 for r in mapped if r.get('is_duplicate'))
        log.info(f'{dup_count} duplicates flagged, {len(mapped) - dup_count} canonical events')

        # 5. Upsert to Supabase
        log.info('Upserting to watch_events…')
        for i in range(0, len(mapped), BATCH_SIZE):
            batch = mapped[i:i + BATCH_SIZE]
            client.table('watch_events').upsert(
                batch, on_conflict='airtable_record_id'
            ).execute()
            total += len(batch)
            log.info(f'  Batch {i // BATCH_SIZE + 1}: {len(batch)} records ({total} total)')

        log.info(f'=== Sync complete: {total} records upserted, {dup_count} marked as duplicates ===')
        _log_run(client, 'success', total, notes=f'{dup_count} duplicates flagged')
    except Exception as e:
        log.exception('Airtable sync failed')
        _log_run(client, 'failure', total, error=str(e))
        raise


if __name__ == '__main__':
    main()
