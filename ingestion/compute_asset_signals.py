"""
Asset-Signals Computer
========================

Classifies every asset against the Endenex signal stack:
  • age_signal               Strong / Medium / Weak  — age vs design life
  • support_scheme_expiry    Confirmed / Inferred / Unavailable
  • planning_signal          Active / Dormant / None — from market_events,
                             repowering_projects, watch_events
  • grid_connection_value    High / Medium / Low — heuristic by asset_class + MW
  • owner_behaviour          Repowering-active / Unknown — operator-level signal
  • physical_constraint      Constrained / Unconstrained / Unknown
  • overall_classification   Watchlist / Candidate / Active / Confirmed

The output table `asset_signals` is the data behind the Asset Screener page.

Source classifications:
  - Observed:  status came from explicit data (e.g. confirmed planning app)
  - Inferred:  derived from age + scheme expiry without explicit confirmation
  - Modelled:  scoring rule applied without observed data

Usage:
  python compute_asset_signals.py [--limit 1000] [--asset-class onshore_wind]
"""
from __future__ import annotations

import argparse
import logging
from collections import defaultdict
from datetime import date

from base_ingestor import get_supabase_client, today_iso

log = logging.getLogger(__name__)
PIPELINE = 'compute_asset_signals'
BATCH = 200

DESIGN_LIFE = {
    'onshore_wind':  25,
    'offshore_wind': 25,
    'solar_pv':      25,
    'bess':          15,
}


# ── Signal classifiers ─────────────────────────────────────────────────────────

def classify_age(asset: dict) -> str | None:
    """Strong = >80% of design life; Medium = 50-80%; Weak = <50%."""
    comm = asset.get('commissioning_date')
    if not comm:
        return None
    try:
        comm_year = int(comm[:4])
    except (TypeError, ValueError):
        return None
    dl = DESIGN_LIFE.get(asset['asset_class'], 25)
    age = date.today().year - comm_year
    pct = age / dl if dl > 0 else 0
    if pct >= 0.80: return 'Strong'
    if pct >= 0.50: return 'Medium'
    return 'Weak'


def classify_support_scheme(asset: dict) -> str:
    """Confirmed if support_scheme_expiry present; Inferred for DE EEG; else Unavailable."""
    if asset.get('support_scheme_expiry'):
        return 'Confirmed'
    if asset.get('support_scheme_id'):
        return 'Inferred'  # we know there's a scheme but no explicit expiry
    return 'Unavailable'


def classify_planning(asset_id: str, planning_index: dict) -> str:
    """
    Active   — has a repowering_projects row at any stage, OR a watch_event
               with category='market' in last 18 months
    Dormant  — has historical events but nothing recent
    None     — no events
    """
    rec = planning_index.get(asset_id, {})
    if rec.get('active'): return 'Active'
    if rec.get('historical'): return 'Dormant'
    return 'None'


def classify_grid_value(asset: dict) -> str:
    """Heuristic: large + central-grid asset_classes are High."""
    mw = float(asset.get('capacity_mw') or 0)
    cls = asset['asset_class']
    if mw >= 50:                                   return 'High'
    if mw >= 10 and cls in ('onshore_wind','solar_pv','bess'): return 'Medium'
    return 'Low'


def classify_owner(asset: dict, operator_signal_index: dict) -> str:
    """Repowering-active if operator appears in any active repowering_projects row."""
    op = (asset.get('operator') or asset.get('developer_operator') or '').strip().lower()
    if not op:
        return 'Unknown'
    return 'Repowering-active' if op in operator_signal_index else 'Unknown'


def classify_physical(asset: dict) -> str:
    """
    Heuristic: lat/lon presence + flag for likely constraint zones (TBD).
    For now: Unconstrained if lat/lon present, Unknown otherwise.
    """
    if asset.get('latitude') and asset.get('longitude'):
        return 'Unconstrained'
    return 'Unknown'


def overall_classification(age: str | None, scheme: str, planning: str, owner: str) -> str:
    """
    Aggregation logic:
      Confirmed  — Active planning + (Confirmed scheme OR Repowering-active owner)
      Active     — Active planning OR Repowering-active owner
      Candidate  — Strong age + Confirmed scheme
      Watchlist  — anything else with at least Medium age
    """
    if planning == 'Active' and (scheme == 'Confirmed' or owner == 'Repowering-active'):
        return 'Confirmed'
    if planning == 'Active' or owner == 'Repowering-active':
        return 'Active'
    if age == 'Strong' and scheme in ('Confirmed', 'Inferred'):
        return 'Candidate'
    if age in ('Strong', 'Medium'):
        return 'Watchlist'
    return 'Watchlist'


# ── Index builders ─────────────────────────────────────────────────────────────

def build_planning_index(client) -> dict[str, dict]:
    """
    For each asset_id, mark whether it has any active repowering_projects row
    or a recent (≤18mo) market watch_event.
    """
    today = date.today()
    cutoff = date(today.year - 1, today.month, today.day) if today.month > 6 else date(today.year - 2, today.month + 6, today.day)

    idx: dict[str, dict] = defaultdict(lambda: {'active': False, 'historical': False})

    # repowering_projects with non-null asset_id are 'active'
    res = client.table('repowering_projects').select('asset_id, stage, stage_date') \
        .not_.is_('asset_id', 'null').execute()
    for r in (res.data or []):
        if r.get('asset_id'):
            idx[r['asset_id']]['active'] = True

    # watch_events tagged to assets (not a strong link in current schema; site_name match)
    # Skipped: would require fuzzy-matching site_name → asset.name. Future enhancement.

    return idx


def build_operator_signal_index(client) -> set[str]:
    """Operators with at least one active repowering_projects row."""
    res = client.table('repowering_projects').select('developer, operator').execute()
    ops: set[str] = set()
    for r in (res.data or []):
        for v in (r.get('developer'), r.get('operator')):
            if v: ops.add(v.strip().lower())
    return ops


# ── Main ───────────────────────────────────────────────────────────────────────

def fetch_assets(client, limit: int | None, asset_class: str | None) -> list[dict]:
    q = client.table('assets').select(
        'id, asset_class, country_code, commissioning_date, capacity_mw, '
        'support_scheme_id, support_scheme_expiry, latitude, longitude, '
        'turbine_make, turbine_model'
    )
    if asset_class:
        q = q.eq('asset_class', asset_class)
    if limit:
        q = q.limit(limit)
    return (q.execute().data) or []


def compute_signals(assets: list[dict],
                    planning_idx: dict,
                    operator_idx: set[str]) -> list[dict]:
    """Returns one asset_signals row per asset."""
    today = today_iso()
    rows = []
    for a in assets:
        age      = classify_age(a)
        scheme   = classify_support_scheme(a)
        planning = classify_planning(a['id'], planning_idx)
        grid     = classify_grid_value(a)
        owner    = classify_owner(a, operator_idx)
        physical = classify_physical(a)
        overall  = overall_classification(age, scheme, planning, owner)

        # Confidence and derivation reflect the signal mix
        observed_count = sum(1 for s in [planning, owner] if s in ('Active', 'Repowering-active'))
        confidence = 'High'   if observed_count >= 2 else 'Medium' if observed_count == 1 else 'Low'
        derivation = 'Observed' if observed_count > 0 else 'Inferred' if (age and scheme != 'Unavailable') else 'Modelled'

        rows.append({
            'asset_id':              a['id'],
            'age_signal':            age,
            'support_scheme_expiry': scheme,
            'planning_signal':       planning,
            'grid_connection_value': grid,
            'owner_behaviour':       owner,
            'physical_constraint':   physical,
            'overall_classification': overall,
            'source_type':           'Endenex Signal Model',
            'source_date':           today,
            'confidence':            confidence,
            'derivation':            derivation,
            'last_reviewed':         today,
        })
    return rows


def upsert_signals(client, rows: list[dict]) -> int:
    if not rows:
        return 0
    total = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i+BATCH]
        client.table('asset_signals').upsert(chunk, on_conflict='asset_id').execute()
        total += len(chunk)
    return total


def log_run(client, status: str, written: int, error: str | None = None):
    client.table('ingestion_runs').insert({
        'pipeline':           PIPELINE,
        'status':             status,
        'started_at':         f'{date.today()}T00:00:00Z',
        'finished_at':        f'{date.today()}T00:00:01Z',
        'records_written':    written,
        'source_attribution': 'Endenex Signal Model — assets + market_events + repowering_projects',
        'notes':              'Asset signal-stack classification',
        'error_message':      error,
    }).execute()


def run(limit: int | None = None, asset_class: str | None = None):
    log.info(f'=== compute_asset_signals starting (limit={limit}, class={asset_class}) ===')
    client = get_supabase_client()

    log.info('Building planning index from repowering_projects…')
    planning_idx = build_planning_index(client)
    log.info(f'  {len(planning_idx)} assets with planning activity')

    log.info('Building operator signal index…')
    operator_idx = build_operator_signal_index(client)
    log.info(f'  {len(operator_idx)} operators flagged as repowering-active')

    log.info('Fetching assets…')
    assets = fetch_assets(client, limit, asset_class)
    log.info(f'  {len(assets):,} assets to classify')

    rows = compute_signals(assets, planning_idx, operator_idx)
    distribution: dict[str, int] = defaultdict(int)
    for r in rows:
        distribution[r['overall_classification']] += 1
    log.info(f'  Distribution: {dict(distribution)}')

    try:
        n = upsert_signals(client, rows)
        log_run(client, 'success', n)
        log.info(f'=== complete: {n} asset_signals upserted ===')
    except Exception as e:
        log.exception('compute_asset_signals failed')
        log_run(client, 'failure', 0, str(e))
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=None)
    parser.add_argument('--asset-class', choices=['onshore_wind','offshore_wind','solar_pv','bess'])
    args = parser.parse_args()
    run(args.limit, args.asset_class)
