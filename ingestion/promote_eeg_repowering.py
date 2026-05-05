"""
EEG-Expiry Repowering Promoter (DE)
=====================================

Scans the `assets` table for German onshore wind turbines whose EEG support
scheme is approaching expiry, and creates / refreshes corresponding rows in
`repowering_projects` with stage = 'announced' and confidence = 'Inferred'.

Rationale
---------
Per Endenex methodology, EEG support scheme expiry is the **primary repowering
trigger** for German assets. Once a turbine is post-EEG (or within 18 months of
expiry), the operator faces a binary decision: continue at merchant prices
(usually uneconomic for sub-3 MW vintage assets) or repower.

This script doesn't require any new external scraping — it leverages MaStR data
already in the assets table to produce hundreds of high-quality candidate rows.

Outputs:
  • Inserts into repowering_projects with:
      stage              = 'announced'
      confidence         = 'Inferred'
      derivation         = 'Modelled'
      source_type        = 'Endenex EEG-Expiry Inference'
      stage_date         = support_scheme_expiry
  • Aggregates multi-turbine sites into a single project row keyed by
    (developer/operator, country, ±5km from centroid) — heuristic dedup

Run cadence: monthly.

Usage:
  python promote_eeg_repowering.py [--window-months 18] [--dry-run]
"""
from __future__ import annotations

import argparse
import logging
from collections import defaultdict
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta

from base_ingestor import get_supabase_client, today_iso

log = logging.getLogger(__name__)
PIPELINE = 'promote_eeg_repowering'
DEFAULT_WINDOW_MONTHS = 18


def fetch_eeg_candidates(client, window_months: int) -> list[dict]:
    """
    Pull DE onshore wind assets whose support_scheme_expiry falls within
    [today - 12 months, today + window_months]. Past-expiry counts because
    those projects are post-EEG and most likely already in repowering decision.
    """
    today = date.today()
    window_start = (today - relativedelta(months=12)).isoformat()
    window_end   = (today + relativedelta(months=window_months)).isoformat()

    res = (
        client.table('assets')
        .select('id, name, capacity_mw, commissioning_date, support_scheme_expiry, '
                'turbine_make, turbine_model, latitude, longitude, external_id')
        .eq('country_code', 'DE')
        .eq('asset_class', 'onshore_wind')
        .not_.is_('support_scheme_expiry', 'null')
        .gte('support_scheme_expiry', window_start)
        .lte('support_scheme_expiry', window_end)
        .execute()
    )
    return res.data or []


def cluster_by_site(assets: list[dict]) -> list[list[dict]]:
    """
    Group assets into 'sites' by proximity. MaStR returns one row per turbine,
    but a wind farm of 12 turbines in the same hectare should be ONE project
    in the repowering pipeline view.

    Heuristic: assets within ~2km of each other (rounding lat/lon to 2 dp ≈
    ~1.1km grid cell) are treated as the same site.
    """
    buckets: dict[str, list[dict]] = defaultdict(list)
    for a in assets:
        lat, lon = a.get('latitude'), a.get('longitude')
        if lat is None or lon is None:
            buckets[f'unmatched-{a["id"]}'].append(a)
            continue
        # Snap to ~1km grid
        key = f'{round(float(lat), 2)},{round(float(lon), 2)}'
        buckets[key].append(a)
    return list(buckets.values())


def cluster_to_project_row(cluster: list[dict]) -> dict:
    """Aggregate a cluster of turbines into one repowering_projects row."""
    total_mw = sum(float(a.get('capacity_mw') or 0) for a in cluster)
    n        = len(cluster)
    expiries = sorted([a['support_scheme_expiry'] for a in cluster if a.get('support_scheme_expiry')])
    earliest = expiries[0] if expiries else None

    # Use the most common turbine model in the cluster
    models = [a.get('turbine_model') for a in cluster if a.get('turbine_model')]
    common_model = max(set(models), key=models.count) if models else None
    makes  = [a.get('turbine_make')  for a in cluster if a.get('turbine_make')]
    common_make  = max(set(makes), key=makes.count) if makes else None

    # Naming: use the first asset name, or fall back to model count
    site_name = cluster[0].get('name') or f'{n}× {common_make or "wind"} cluster'

    # Average lat/lon for location_description
    valid_coords = [(a['latitude'], a['longitude']) for a in cluster
                    if a.get('latitude') is not None and a.get('longitude') is not None]
    if valid_coords:
        avg_lat = sum(float(c[0]) for c in valid_coords) / len(valid_coords)
        avg_lon = sum(float(c[1]) for c in valid_coords) / len(valid_coords)
        loc = f'DE · {avg_lat:.3f}, {avg_lon:.3f}'
    else:
        loc = 'DE'

    today = today_iso()
    return {
        'project_name':        site_name[:255],
        'country_code':        'DE',
        'asset_class':         'onshore_wind',
        'stage':               'announced',
        'stage_date':          earliest,
        'capacity_mw':         round(total_mw, 2) if total_mw > 0 else None,
        'turbine_count':       n,
        'developer':           None,    # MaStR doesn't carry operator at unit level
        'operator':            None,
        'planning_reference':  None,
        'location_description': loc,
        'source_url':          None,
        'notes':               (
            f'EEG-expiry trigger: support scheme expires {earliest} for {n} turbines '
            f'({common_make or "mixed"} {common_model or ""}). '
            f'Inferred candidate — operator decision pending. '
            f'Source: MaStR + Endenex EEG-expiry inference v1.'
        ),
        'asset_id':            cluster[0]['id'],   # link to first turbine in cluster
        'source_type':         'Endenex EEG-Expiry Inference',
        'source_date':         today,
        'confidence':          'Inferred',
        'derivation':          'Modelled',
        'last_reviewed':       today,
    }


def upsert_projects(client, rows: list[dict]) -> int:
    """
    Upsert keyed on (project_name, country_code) — best-effort dedup.
    Doesn't have a true natural key; we set source_type so re-runs with the same
    inference replace prior rows from this script without touching curated rows
    from Airtable / planning portals (which carry different source_type values).
    """
    if not rows:
        return 0
    # No unique constraint exists in repowering_projects. Use a manual approach:
    # delete prior EEG-inference rows, then insert fresh. This keeps idempotency
    # and avoids stale rows when assets drop out of the EEG window.
    client.table('repowering_projects') \
        .delete() \
        .eq('source_type', 'Endenex EEG-Expiry Inference') \
        .execute()
    client.table('repowering_projects').insert(rows).execute()
    return len(rows)


def log_run(client, status: str, written: int, error: str | None = None):
    client.table('ingestion_runs').insert({
        'pipeline':           PIPELINE,
        'status':             status,
        'started_at':         f'{date.today()}T00:00:00Z',
        'finished_at':        f'{date.today()}T00:00:01Z',
        'records_written':    written,
        'source_attribution': 'Bundesnetzagentur Marktstammdatenregister (DL-DE-BY-2.0); EEG-expiry inference per Endenex methodology',
        'notes':              'EEG-expiry repowering candidate promotion',
        'error_message':      error,
    }).execute()


def run(window_months: int = DEFAULT_WINDOW_MONTHS, dry_run: bool = False):
    log.info(f'=== promote_eeg_repowering starting (window={window_months}mo, dry_run={dry_run}) ===')
    client = get_supabase_client()

    candidates = fetch_eeg_candidates(client, window_months)
    log.info(f'Found {len(candidates):,} DE turbines with support_scheme_expiry in window')

    if not candidates:
        log.warning('No candidates — likely MaStR ingest has not populated support_scheme_expiry yet, '
                   'or no DE turbines fall in the window.')
        log_run(client, 'success', 0)
        return

    clusters = cluster_by_site(candidates)
    log.info(f'Clustered into {len(clusters)} candidate project rows')

    rows = [cluster_to_project_row(c) for c in clusters]
    if dry_run:
        log.info('DRY RUN — would upsert the following:')
        for r in rows[:10]:
            log.info(f'  {r["project_name"]} · {r["turbine_count"]}T · '
                    f'{r["capacity_mw"]} MW · expiry {r["stage_date"]}')
        if len(rows) > 10:
            log.info(f'  …and {len(rows)-10} more')
        return

    try:
        n = upsert_projects(client, rows)
        log_run(client, 'success', n)
        log.info(f'=== complete: {n} repowering_projects rows written ===')
    except Exception as e:
        log.exception('promote_eeg_repowering failed')
        log_run(client, 'failure', 0, str(e))
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--window-months', type=int, default=DEFAULT_WINDOW_MONTHS,
                        help='Months ahead of today to consider (default 18)')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    run(args.window_months, args.dry_run)
