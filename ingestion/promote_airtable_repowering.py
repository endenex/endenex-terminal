"""
Airtable Watch → Repowering Promoter
=====================================

Reads `watch_events` rows that signal repowering / decommissioning
activity and promotes them to `repowering_projects` rows at the
appropriate stage.

STRICT FILTER (per user 2026-05-09): only promotes events whose
event_type is explicitly repowering or decommissioning. Net-new build
events (Permit Granted, Construction Start for greenfield, etc.) are
NOT promoted, even though Airtable may carry them, because the
repowering_projects table is reserved for asset replacement /
retirement / decommissioning only.

Event types that qualify:
  • Repowering Announcement / Repowering / Repowering Decision
  • Decommissioning / Decommissioning Start / Decommissioning Announcement

For all other event types, only promote if the headline OR notes
explicitly contain repowering / decommissioning keywords (multilingual
support: repower, decommission, dismantle, demolition, retirement,
repotenciación, desmantelamiento, renouvellement, démantèlement,
rückbau).

Identity: requires both site_name and (developer or company_name).
Without identification we can't dedupe rows or link to assets.

Idempotency: uses upsert_project() with ON CONFLICT (dedupe_key) so
re-runs cleanly UPDATE existing rows rather than failing on UNIQUE
violations (legacy delete+insert pattern was broken by migration 074).

Usage:
  python promote_airtable_repowering.py [--dry-run]
"""
from __future__ import annotations

import argparse
import logging
import re
from datetime import date

from base_ingestor import get_supabase_client, today_iso
from repowering._base import upsert_project, is_too_old

log = logging.getLogger(__name__)
PIPELINE = 'promote_airtable_repowering'

# Stage mapping for QUALIFYING event types only. Anything not in this
# map gets dropped unless headline/notes contain the repowering regex.
EVENT_TYPE_TO_STAGE = {
    # Generic planning events — only promoted if headline/notes mention
    # repowering/decommissioning explicitly
    'Planning Application':         'application_submitted',
    'Application Submitted':        'application_submitted',
    'Consent Granted':              'application_approved',
    'Permit Granted':               'application_approved',
    'Application Approved':         'application_approved',
    'Awaiting Construction':        'permitted',
    'Construction Start':           'ongoing',
    'Mobilisation':                 'ongoing',
    'Contractor Awarded':           'permitted',
    'Contractor Mobilisation':      'ongoing',
    # Repowering-specific (auto-qualify)
    'Repowering':                   'announced',
    'Repowering Announcement':      'announced',
    'Repowering Decision':          'announced',
    'Repowering award':             'application_approved',
    'End-of-life planning':         'announced',
    # Decommissioning-specific (auto-qualify)
    'Decommissioning':              'ongoing',
    'Decommissioning Start':        'ongoing',
    'Decommissioning Announcement': 'announced',
    'Decommissioning award':        'application_approved',
    'Decommissioning tender':       'application_submitted',
}

# Event types that ALWAYS qualify regardless of headline content.
# Verified against actual watch_events distinct values 2026-05-09:
# Repowering (162) + Decommissioning (72) + End-of-life planning (7)
# + Repowering award (2) + Decommissioning award (2) + Decommissioning
# tender (1) = 246 of 254 candidate events.
ALWAYS_QUALIFY = {
    'Repowering',
    'Repowering Announcement',
    'Repowering Decision',
    'Repowering award',
    'End-of-life planning',
    'Decommissioning',
    'Decommissioning Start',
    'Decommissioning Announcement',
    'Decommissioning award',
    'Decommissioning tender',
}

# Multilingual repowering / decommissioning vocabulary. Used to filter
# generic event types (Planning Application, Permit Granted, etc.)
# down to those that actually concern asset replacement.
REPOWERING_TEXT_RE = re.compile(
    r'\b('
    r'repower(ing|ed)?|decommission(ing|ed)?|dismantl(e|ing|ement)|'
    r'demolition|retire(ment|d)?|replacement\s+of|'
    r'repotenciación|repotenciado|desmantelamiento|desmantelado|sustitución|'
    r'renouvellement|démantèlement|remplacement|'
    r'rückbau'
    r')\b',
    re.I,
)

ALLOWED_CONFIDENCE = {'High', 'Medium', 'Low'}


def fetch_promotable_events(client) -> list[dict]:
    """All non-duplicate market-category events of interest."""
    types = list(EVENT_TYPE_TO_STAGE.keys())
    res = (
        client.table('watch_events')
        .select('id, headline, notes, event_type, scope, site_name, company_name, '
                'developer, capacity_mw, turbine_count, event_date, confidence, '
                'source_url, liability_tags')
        .eq('is_duplicate', False)
        .eq('category', 'market')
        .in_('event_type', types)
        .execute()
    )
    return res.data or []


def is_strict_repowering_event(ev: dict) -> bool:
    """Strict filter: event_type explicitly says repowering/decommissioning,
    OR the headline/notes text mentions it.
    """
    if ev.get('event_type') in ALWAYS_QUALIFY:
        return True
    text_blob = (ev.get('headline') or '') + ' ' + (ev.get('notes') or '')
    return bool(REPOWERING_TEXT_RE.search(text_blob))


def event_to_project(ev: dict, today: str) -> dict | None:
    """Map a single watch_event to a repowering_projects row.
    Returns None to skip (not strict repowering, missing identity, etc.)."""
    if not is_strict_repowering_event(ev):
        return None
    # 3-year cutoff — stale events aren't actionable
    if is_too_old(ev.get('event_date'), today):
        return None
    site = (ev.get('site_name') or '').strip()
    if not site:
        return None
    org = (ev.get('developer') or ev.get('company_name') or '').strip()
    if not org:
        return None
    stage = EVENT_TYPE_TO_STAGE.get(ev['event_type'])
    if not stage:
        return None

    confidence = ev.get('confidence') if ev.get('confidence') in ALLOWED_CONFIDENCE else 'Medium'

    # Country: scope can be a country code (DE, GB, US, JP, etc.) or 'EU'/'Global'
    scope = (ev.get('scope') or '').strip().upper()
    country = scope if scope and len(scope) == 2 else 'XX'

    return {
        'project_name':         site[:255],
        'country_code':         country,
        'asset_class':          'onshore_wind',   # Airtable Watch doesn't carry asset_class
        'stage':                stage,
        'stage_date':           ev.get('event_date') or today,
        'capacity_mw':          ev.get('capacity_mw'),
        'turbine_count':        ev.get('turbine_count'),
        'developer':            ev.get('developer'),
        'operator':             ev.get('company_name'),
        'planning_reference':   None,
        'location_description': country,
        'source_url':           ev.get('source_url'),
        'notes':                f"Promoted from Airtable Watch event: {ev['event_type']} · {ev.get('headline', '')[:140]}",
        'source_type':          'airtable',          # lowercase enum value
        'source_date':          today,
        'confidence':           confidence,
        'derivation':           'Observed',
        'last_reviewed':        today,
    }


def log_run(client, status: str, written: int, attempted: int, skipped_filter: int, error: str | None = None):
    client.table('ingestion_runs').insert({
        'pipeline':           PIPELINE,
        'status':             status,
        'started_at':         f'{date.today()}T00:00:00Z',
        'finished_at':        f'{date.today()}T00:00:01Z',
        'records_written':    written,
        'source_attribution': 'Airtable curated intelligence feed',
        'notes':              f'Watch event → repowering_projects · {attempted} candidate events · {skipped_filter} non-repowering filtered · {written} upserted.',
        'error_message':      error,
    }).execute()


def run(dry_run: bool = False):
    log.info('=== promote_airtable_repowering starting ===')
    client = get_supabase_client()
    today = today_iso()

    events = fetch_promotable_events(client)
    log.info(f'Found {len(events)} candidate watch_events')

    rows: list[dict] = []
    skipped_filter = 0
    for ev in events:
        row = event_to_project(ev, today)
        if row is None:
            # Distinguish "filtered as non-repowering" from "missing identity"
            if not is_strict_repowering_event(ev):
                skipped_filter += 1
            continue
        rows.append(row)

    log.info(f'  {len(rows)} qualify as strict repowering (skipped {skipped_filter} non-repowering)')

    if dry_run:
        for r in rows[:10]:
            log.info(f'  → {r["project_name"]} · {r["stage"]} · {r["country_code"]} · {r["confidence"]}')
        return

    upserted = 0
    try:
        for row in rows:
            if upsert_project(client, row):
                upserted += 1
        log_run(client, 'success', upserted, len(events), skipped_filter)
        log.info(f'=== complete: {upserted} of {len(rows)} promoted ===')
    except Exception as e:
        log.exception('promote_airtable_repowering failed')
        log_run(client, 'failure', upserted, len(events), skipped_filter, str(e))
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    run(args.dry_run)
