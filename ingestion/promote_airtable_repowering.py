"""
Airtable Watch → Repowering Promoter
=====================================

Reads `watch_events` rows that signal repowering activity and promotes them to
`repowering_projects` rows at the appropriate stage.

Promotion rules (event_type → stage):
  • 'Planning Application'        → application_submitted
  • 'Consent Granted'             → application_approved
  • 'Permit Granted'              → application_approved
  • 'Awaiting Construction'       → permitted
  • 'Repowering Announcement'     → announced
  • 'Construction Start'          → ongoing
  • 'Mobilisation'                → ongoing
  • 'Contractor Awarded'          → permitted
  • 'Decommissioning Start'       → ongoing

We require BOTH a site_name AND (developer or company_name) to promote — without
identification we can't dedupe rows or link to assets.

Confidence inherits from the watch_event. Source_type is set to
'Airtable Watch Promotion' so re-runs cleanly replace prior promotions.

Usage:
  python promote_airtable_repowering.py [--dry-run]
"""
from __future__ import annotations

import argparse
import logging
from datetime import date

from base_ingestor import get_supabase_client, today_iso

log = logging.getLogger(__name__)
PIPELINE = 'promote_airtable_repowering'

EVENT_TYPE_TO_STAGE = {
    'Planning Application':         'application_submitted',
    'Application Submitted':        'application_submitted',
    'Consent Granted':              'application_approved',
    'Permit Granted':               'application_approved',
    'Application Approved':         'application_approved',
    'Awaiting Construction':        'permitted',
    'Repowering Announcement':      'announced',
    'Repowering':                   'announced',
    'Repowering Decision':          'announced',
    'Construction Start':           'ongoing',
    'Mobilisation':                 'ongoing',
    'Contractor Awarded':           'permitted',
    'Contractor Mobilisation':      'ongoing',
    'Decommissioning Start':        'ongoing',
    'Decommissioning':              'ongoing',
    'Decommissioning Announcement': 'announced',
}

# Confidence values are stored as 'High'/'Medium'/'Low' on watch_events
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


def event_to_project(ev: dict) -> dict | None:
    """Map a single watch_event to a repowering_projects row."""
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
    today = today_iso()

    # Country: scope can be a country code (DE, GB, US, JP, etc.) or 'EU'/'Global'
    scope = (ev.get('scope') or '').strip().upper()
    country = scope if scope and len(scope) == 2 else 'XX'

    return {
        'project_name':         site[:255],
        'country_code':         country,
        'asset_class':          'onshore_wind',   # default; Watch doesn't carry asset_class
        'stage':                stage,
        'stage_date':           ev.get('event_date'),
        'capacity_mw':          ev.get('capacity_mw'),
        'turbine_count':        ev.get('turbine_count'),
        'developer':            ev.get('developer'),
        'operator':             ev.get('company_name'),
        'planning_reference':   None,
        'location_description': country,
        'source_url':           ev.get('source_url'),
        'notes':                f"Promoted from Airtable Watch event: {ev['event_type']} · {ev.get('headline', '')[:140]}",
        'asset_id':             None,
        'source_type':          'Airtable Watch Promotion',
        'source_date':          today,
        'confidence':           confidence,
        'derivation':           'Observed',
        'last_reviewed':        today,
    }


def upsert_projects(client, rows: list[dict]) -> int:
    if not rows:
        return 0
    client.table('repowering_projects').delete().eq('source_type', 'Airtable Watch Promotion').execute()
    BATCH = 200
    total = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i+BATCH]
        client.table('repowering_projects').insert(chunk).execute()
        total += len(chunk)
    return total


def log_run(client, status: str, written: int, error: str | None = None):
    client.table('ingestion_runs').insert({
        'pipeline':           PIPELINE,
        'status':             status,
        'started_at':         f'{date.today()}T00:00:00Z',
        'finished_at':        f'{date.today()}T00:00:01Z',
        'records_written':    written,
        'source_attribution': 'Airtable curated intelligence feed',
        'notes':              'Watch event → repowering_projects promotion',
        'error_message':      error,
    }).execute()


def run(dry_run: bool = False):
    log.info('=== promote_airtable_repowering starting ===')
    client = get_supabase_client()

    events = fetch_promotable_events(client)
    log.info(f'Found {len(events)} candidate watch_events')

    rows = []
    for ev in events:
        row = event_to_project(ev)
        if row:
            rows.append(row)
    log.info(f'Mapped {len(rows)} promotable rows ({len(events) - len(rows)} skipped — missing site/org)')

    if dry_run:
        for r in rows[:10]:
            log.info(f'  {r["project_name"]} · {r["stage"]} · {r["country_code"]} · {r["confidence"]}')
        return

    try:
        n = upsert_projects(client, rows)
        log_run(client, 'success', n)
        log.info(f'=== complete: {n} repowering_projects rows from Airtable ===')
    except Exception as e:
        log.exception('promote_airtable_repowering failed')
        log_run(client, 'failure', 0, str(e))
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    run(args.dry_run)
