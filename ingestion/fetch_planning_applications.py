#!/usr/bin/env python3
"""
Planning-applications fetcher (PlanIt aggregator).

For every operational onshore wind project in repd_project_extras, look up
the planning application via PlanIt's free public API and cache the
applicant name + decision + LPA portal URL into planning_applications.

The applicant name on the consent is almost always the project SPV — this
is the second-strongest evidence leg in the SPV bridge (after CH charges).

PlanIt: https://www.planit.org.uk/api/
  Endpoint:  https://www.planit.org.uk/api/applics/json
  Free, no auth, courteous rate limit (we pace 1.0s/req).
  Aggregates ~333 UK local planning authorities.

Idempotent: skips rows already cached. Re-run with --refresh to re-fetch.

Required env vars: SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY

CLI:
  python3 fetch_planning_applications.py
  python3 fetch_planning_applications.py --limit 10              # process at most N
  python3 fetch_planning_applications.py --refresh               # ignore cache
  python3 fetch_planning_applications.py --ref "E/2014/0567/F"   # one application
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import json
from datetime import date, datetime

import requests

from base_ingestor import get_supabase_client, log


PLANIT_BASE = 'https://www.planit.org.uk/api/applics/json'
USER_AGENT  = 'endenex-terminal/1.0 (planning data sync; analyst contact via product owner)'
REQUEST_SPACING_S = 1.0


# ── PlanIt API ────────────────────────────────────────────────────────────

def planit_search(planning_ref: str, site_name: str | None = None,
                  lpa_hint: str | None = None, page_size: int = 25) -> list[dict]:
    """
    Search PlanIt with a cascade of strategies. PlanIt's coverage of pre-2010
    UK planning applications is patchy because LPAs only digitised their
    portals around then; many operational wind farms went through consent
    earlier and aren't fully indexed.

    Strategy order:
      1. search = exact planning_ref           (best when PlanIt has it)
      2. search = planning_ref without slashes (some LPAs use unslashed UIDs)
      3. search = site_name                    (fall back to project name)
    """
    headers = {'User-Agent': USER_AGENT, 'Accept': 'application/json'}
    queries: list[str] = [planning_ref]
    no_slash = planning_ref.replace('/', '').replace('-', '')
    if no_slash != planning_ref:
        queries.append(no_slash)
    if site_name:
        queries.append(site_name)

    for q in queries:
        time.sleep(REQUEST_SPACING_S)
        params = {'search': q, 'pg_sz': page_size}
        try:
            resp = requests.get(PLANIT_BASE, params=params, headers=headers, timeout=30)
        except Exception as e:
            log.warning(f'    PlanIt request failed (q={q!r}): {e}')
            continue
        if resp.status_code != 200:
            body_excerpt = resp.text[:200].replace('\n', ' ')
            log.warning(f'    PlanIt HTTP {resp.status_code} (q={q!r}) — body: {body_excerpt!r}')
            continue
        try:
            data = resp.json()
        except ValueError:
            continue
        records = data.get('records') or []
        if records:
            return records
    return []


def best_match(records: list[dict], planning_ref: str, lpa: str | None) -> dict | None:
    """
    Pick the best PlanIt record for our (LPA, ref) pair.

    Match priority:
      1. UID exactly equal to our ref AND area_name matches LPA
      2. UID exactly equal to our ref (any area)
      3. UID is a normalised match (case + whitespace) AND LPA matches
      4. None
    """
    norm = lambda s: (s or '').strip().lower().replace(' ', '')
    ref_n = norm(planning_ref)
    lpa_n = norm(lpa) if lpa else None

    # Tier 1
    for r in records:
        if norm(r.get('uid')) == ref_n and lpa_n and lpa_n in norm(r.get('area_name')):
            return r
    # Tier 2 — exact UID, any LPA
    for r in records:
        if norm(r.get('uid')) == ref_n:
            return r
    # Tier 3 — normalised UID + LPA match
    for r in records:
        if norm(r.get('uid')) == ref_n and lpa_n is not None:
            return r
    # Tier 3b — alt_id match
    for r in records:
        if norm(r.get('alt_id')) == ref_n:
            return r
    return None


def parse_date(val) -> str | None:
    """PlanIt returns dates as YYYY-MM-DD strings (or null)."""
    if not val:
        return None
    try:
        return datetime.strptime(str(val)[:10], '%Y-%m-%d').date().isoformat()
    except Exception:
        return None


# ── Extraction (PlanIt record → cache row) ────────────────────────────────
# Factored out so re-extract mode can apply the same logic to cached
# raw_planit_response without re-hitting PlanIt.

def build_cache_row_from_match(lpa: str, ref: str, match: dict) -> dict:
    """
    Map a PlanIt record dict to a planning_applications row.

    PlanIt's data model varies by source authority:
      • Idox local LPAs        → top-level `name` is applicant
      • Scottish ECU (S36)     → applicant is in other_fields.applicant_company
      • DfI / PEDW / others    → ditto, nested under other_fields
    Extract with fallback so we work across all variants.
    """
    of = match.get('other_fields') or {}

    def _pick_applicant() -> str | None:
        for src in (of.get('applicant_company'),
                    of.get('applicant_name'),
                    match.get('name')):
            v = (src or '').strip()
            if v and v.lower() not in ('see source', '', '—', 'unknown', 'not stated'):
                return v
        return None

    return {
        'planning_authority':       lpa,
        'planning_ref':             ref,
        'applicant_name':           _pick_applicant(),
        'applicant_address':        (of.get('applicant_address') or match.get('address') or '').strip() or None,
        'application_description':  (match.get('description') or of.get('development_type') or '').strip() or None,
        'decision':                 (of.get('decision') or match.get('app_state') or '').strip() or None,
        'decision_date':            parse_date(of.get('decision_date') or match.get('decided_date')),
        'application_received':     parse_date(of.get('date_received') or match.get('start_date')),
        'application_validated':    parse_date(match.get('valid_date')),
        'app_state':                (match.get('app_state') or '').strip() or None,
        'app_type':                 (match.get('app_type') or '').strip() or None,
        'app_size':                 (match.get('app_size') or '').strip() or None,
        'lpa_portal_url':           (match.get('url') or of.get('source_url') or '').strip() or None,
        'planit_url':               (match.get('link') or '').strip() or None,
        'raw_planit_response':      json.loads(json.dumps(match)),
        'fetch_status':             'success',
        'fetched_at':               datetime.utcnow().isoformat() + 'Z',
    }


def reextract_cached(client) -> tuple[int, int]:
    """
    Re-run extraction over every cached PlanIt response. Zero API hits.
    Use after fixing extraction logic to update existing rows in place.
    Returns (n_updated, n_skipped).
    """
    rows = client.table('planning_applications') \
        .select('id, planning_authority, planning_ref, raw_planit_response') \
        .not_.is_('raw_planit_response', 'null') \
        .execute().data or []
    log.info(f'  Re-extracting {len(rows)} cached PlanIt responses…')
    n_updated = n_skipped = 0
    for r in rows:
        raw = r.get('raw_planit_response')
        if not raw:
            n_skipped += 1
            continue
        new_cache = build_cache_row_from_match(
            r['planning_authority'], r['planning_ref'], raw,
        )
        # Drop fields that are unique-key (already match) + raw (already there)
        update = {k: v for k, v in new_cache.items()
                  if k not in ('planning_authority', 'planning_ref', 'raw_planit_response')}
        try:
            client.table('planning_applications').update(update).eq('id', r['id']).execute()
            n_updated += 1
            log.info(f'    {r["planning_authority"]} · {r["planning_ref"]} → applicant: {new_cache.get("applicant_name") or "—"}')
        except Exception as e:
            log.warning(f'    update failed: {e}')
            n_skipped += 1
    return n_updated, n_skipped


# ── Per-project pipeline ──────────────────────────────────────────────────

def process_project(client, row: dict, refresh: bool = False) -> str:
    """
    Returns one of: 'fetched', 'cached', 'not_found', 'skipped', 'error'.
    """
    lpa = (row.get('local_planning_authority') or '').strip()
    ref = (row.get('planning_application_ref') or '').strip()
    if not lpa or not ref:
        return 'skipped'

    # Cache check
    if not refresh:
        existing = client.table('planning_applications').select('id, fetch_status') \
            .eq('planning_authority', lpa).eq('planning_ref', ref).limit(1).execute()
        if existing.data:
            return 'cached'

    site_name = (row.get('site_name') or '').strip() or None
    log.info(f'  {lpa} · {ref}' + (f' ({site_name})' if site_name else ''))
    records = planit_search(ref, site_name=site_name, lpa_hint=lpa)
    match   = best_match(records, ref, lpa)

    if not match:
        cache_row = {
            'planning_authority':  lpa,
            'planning_ref':        ref,
            'fetch_status':        'not_found',
            'fetch_error':         f'no PlanIt record matched (returned {len(records)} candidates)',
        }
        log.info(f'    not found ({len(records)} candidates)')
    else:
        cache_row = build_cache_row_from_match(lpa, ref, match)
        log.info(f'    ↳ applicant: {cache_row.get("applicant_name") or "—"} '
                 f'· agent: {(match.get("other_fields") or {}).get("agent_company") or "—"}')

    try:
        client.table('planning_applications').upsert(
            cache_row, on_conflict='planning_authority,planning_ref'
        ).execute()
        return 'fetched' if cache_row['fetch_status'] == 'success' else 'not_found'
    except Exception as e:
        log.warning(f'    upsert failed: {e}')
        return 'error'


# ── Telemetry + main ──────────────────────────────────────────────────────

def _log_run(client, status: str, n_fetched: int, n_not_found: int,
             n_cached: int, n_error: int, error: str | None = None):
    try:
        client.table('ingestion_runs').insert({
            'pipeline':           'fetch_planning_applications',
            'status':             status,
            'started_at':         f'{date.today()}T00:00:00Z',
            'finished_at':        f'{date.today()}T00:00:01Z',
            'records_written':    n_fetched,
            'source_attribution': 'PlanIt UK planning aggregator (planit.org.uk)',
            'notes':              f'fetched {n_fetched} · not_found {n_not_found} · cached {n_cached} · error {n_error}',
            'error_message':      error,
        }).execute()
    except Exception as e:
        log.warning(f'telemetry write failed: {e}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit',     type=int, default=500, help='Max applications to process this run.')
    ap.add_argument('--refresh',   action='store_true',   help='Re-fetch even if cached.')
    ap.add_argument('--ref',       help='Process a single planning ref (filters incoming list).')
    ap.add_argument('--all-techs', action='store_true',
                    help='Process all REPD technologies, not just operational onshore wind ≥10 MW.')
    ap.add_argument('--newest', action='store_true',
                    help='Process newest-operational first (more likely in PlanIt) instead of largest-MW first.')
    ap.add_argument('--reextract', action='store_true',
                    help='Re-run extraction over cached raw_planit_response (no API hit). Use after fixing extraction logic.')
    args = ap.parse_args()

    client = get_supabase_client()

    # Re-extract mode — apply current extraction logic to cached responses; no API hit
    if args.reextract:
        n_up, n_skip = reextract_cached(client)
        log.info(f'=== re-extract complete: updated {n_up} · skipped {n_skip} ===')
        return

    # Pull the candidate list — operational onshore wind ≥10 MW with both LPA + ref present.
    q = client.table('repd_project_extras') \
        .select('repd_ref_id, site_name, local_planning_authority, planning_application_ref, '
                'technology_type, development_status_short, installed_capacity_mw') \
        .not_.is_('local_planning_authority', 'null') \
        .not_.is_('planning_application_ref',  'null')
    if not args.all_techs:
        q = q.eq('technology_type', 'Wind Onshore') \
             .ilike('development_status_short', '%operational%') \
             .gte('installed_capacity_mw', 10)
    if args.ref:
        q = q.eq('planning_application_ref', args.ref)
    if args.newest:
        q = q.order('operational_date', desc=True)
    else:
        q = q.order('installed_capacity_mw', desc=True)
    rows = q.limit(args.limit).execute().data or []

    log.info(f'=== Planning-applications fetcher · {len(rows)} candidates · {"refresh" if args.refresh else "cached-skip"} ===')
    n_fetched = n_not_found = n_cached = n_error = n_skipped = 0

    try:
        for r in rows:
            outcome = process_project(client, r, refresh=args.refresh)
            if   outcome == 'fetched':   n_fetched   += 1
            elif outcome == 'not_found': n_not_found += 1
            elif outcome == 'cached':    n_cached    += 1
            elif outcome == 'error':     n_error     += 1
            else:                        n_skipped   += 1
        log.info(f'=== complete: fetched {n_fetched} · not_found {n_not_found} · cached {n_cached} · error {n_error} · skipped {n_skipped} ===')
        _log_run(client, 'success' if n_error == 0 else 'partial',
                 n_fetched, n_not_found, n_cached, n_error)
    except Exception as e:
        log.exception('fetch aborted')
        _log_run(client, 'failure', n_fetched, n_not_found, n_cached, n_error, error=str(e))
        sys.exit(1)


if __name__ == '__main__':
    main()
