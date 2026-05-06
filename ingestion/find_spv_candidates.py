#!/usr/bin/env python3
"""
SPV candidate finder — Companies House search + charges register.

For each REPD project (operational onshore wind ≥10 MW by default), this
script searches Companies House for candidate SPVs using ~5 query variants,
fetches each candidate's charges register, and scores them by:

  • name_match_score  — token-set similarity between CH company name
                        and the REPD project name
  • charge_match_score — fraction of charges whose description references
                        project-name tokens (e.g. "Charge over Benbrack
                        Wind Farm assets including all turbines T1-T8…")
  • combined_confidence — 0.55 × name_match + 0.45 × charge_match

The top candidates per project are written to ch_spv_candidates and
surfaced via ch_spv_candidate_review_v for analyst review. The analyst
picks the right SPV and writes the final row to uk_wind_spv_universe.

This script does NOT auto-promote — it surfaces evidence-ranked candidates.
The bridge confidence written to uk_wind_spv_universe is the analyst's call.

Required env vars: CH_API_KEY · SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY

CLI:
  python3 find_spv_candidates.py
  python3 find_spv_candidates.py --limit 5 --newest
  python3 find_spv_candidates.py --project "Benbrack Wind Farm"
  python3 find_spv_candidates.py --refresh
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
import json
from datetime import date, datetime

import requests

from base_ingestor import get_supabase_client, log


CH_API_KEY = os.environ.get('CH_API_KEY', '').strip()
PUBLIC_API = 'https://api.company-information.service.gov.uk'
USER_AGENT = 'endenex-terminal/1.0 (UK SPV bridging research)'
REQUEST_SPACING_S = 0.6      # CH allows 600 req / 5 min — 0.6s pacing is safe

SEARCH_PAGE_SIZE   = 20
CANDIDATES_TO_KEEP = 5       # per project, keep top N by name match for charges fetch
TOP_RESULTS_PER_VARIANT = 5  # CH search returns 20; we scan top 5 per query


# ── HTTP helpers ───────────────────────────────────────────────────────────

def _ch_get(path: str, params: dict | None = None):
    time.sleep(REQUEST_SPACING_S)
    return requests.get(
        f'{PUBLIC_API}{path}',
        params=params,
        auth=(CH_API_KEY, ''),
        headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'},
        timeout=30,
    )


def ch_search_companies(query: str, items_per_page: int = SEARCH_PAGE_SIZE) -> list[dict]:
    """Wrapper for /search/companies. Returns the items array (may be empty)."""
    resp = _ch_get('/search/companies', {'q': query, 'items_per_page': items_per_page})
    if resp.status_code == 429:
        log.warning('  CH rate-limited; sleeping 30s')
        time.sleep(30)
        resp = _ch_get('/search/companies', {'q': query, 'items_per_page': items_per_page})
    if resp.status_code != 200:
        log.warning(f'  CH search HTTP {resp.status_code}: {resp.text[:120]}')
        return []
    return (resp.json() or {}).get('items') or []


def ch_get_charges(company_number: str) -> list[dict]:
    """Wrapper for /company/{n}/charges. Returns the items array (may be empty)."""
    resp = _ch_get(f'/company/{company_number}/charges', {'items_per_page': 100})
    if resp.status_code == 404:
        return []                # company has no charges register / doesn't exist
    if resp.status_code == 429:
        time.sleep(30)
        resp = _ch_get(f'/company/{company_number}/charges', {'items_per_page': 100})
    if resp.status_code != 200:
        return []
    return (resp.json() or {}).get('items') or []


# ── Name normalisation + tokenisation ──────────────────────────────────────

_CORP_SUFFIX_RE = re.compile(
    r'\b(?:limited|ltd\.?|plc|llp|llc|inc\.?|corporation|corp\.?|company|holdings|group|renewables?)\b',
    re.IGNORECASE,
)
_NON_WORD_RE = re.compile(r"[^\w'\-]+")
_STOP = {
    'wind','farm','farms','project','projects','power','solar','park','plant',
    'site','energy','the','and','of','for','at','on','in','to','a','an',
    'extension','phase','phases','northern','southern','eastern','western',
    'i','ii','iii','iv','v',     # roman-numeral phase markers
}


def _tokens(s: str) -> set[str]:
    """Lower-cased token set, suffix-stripped, stopword-stripped, length≥2."""
    if not s:
        return set()
    s = _CORP_SUFFIX_RE.sub(' ', s)
    s = _NON_WORD_RE.sub(' ', s)
    return {t for t in (tok.lower() for tok in s.split())
            if len(t) >= 2 and t not in _STOP}


def name_similarity(project_name: str, company_name: str) -> float:
    """
    Jaccard similarity between meaningful tokens, scaled 0–100.
    Boosts when the company_name contains the project's core token sequence.
    """
    p = _tokens(project_name)
    c = _tokens(company_name)
    if not p or not c:
        return 0.0
    overlap   = len(p & c)
    union     = len(p | c)
    jaccard   = overlap / union
    base      = jaccard * 100
    # Sequence-bonus: company name preserves project token order
    pn_lc = project_name.lower()
    cn_lc = company_name.lower()
    if all(t in cn_lc for t in pn_lc.split() if len(t) >= 4):
        base = min(100.0, base + 15)
    return round(base, 1)


def charge_describes_project(description: str | None, project_tokens: set[str]) -> bool:
    """TRUE if the charge description contains ≥2 project-name tokens."""
    if not description:
        return False
    d_tok = _tokens(description)
    return len(project_tokens & d_tok) >= 2


# ── Decom-security classifier ─────────────────────────────────────────────
#
# Most CH charges are project-finance debentures (banks securing loans).
# Those are NOT decom-relevant. We flag a charge as decom-security only if
# the description carries decom language OR persons_entitled is a surety
# provider. Banks acting as "security agent" are an explicit NEGATIVE
# signal — those are project finance, not ARO.

DECOM_DESC_TOKENS = (
    'decommission', 'decommissioning', 'dismantl',
    'restoration', 'reinstatement', 'site restoration',
    'asset retirement', 'rehabilitation',
    'dilapidation', 'environmental restoration',
    'restoration trust', 'restoration fund', 'restoration security',
    'decom security', 'decommissioning security',
    'performance bond', 'surety bond',
)

# Known surety / insurer counterparties that issue decom / restoration bonds.
# Substring match (case-insensitive) on persons_entitled name.
SURETY_COUNTERPARTIES = (
    'atradius', 'allianz trade', 'allianz global', 'coface',
    'aig europe', 'aig insurance', 'travelers', 'travelers casualty',
    'munich re', 'hannover re', 'swiss re',
    'liberty mutual', 'zurich insurance', 'zurich north',
    'qbe insurance', 'argo global', 'tokio marine',
    'chubb european', 'chubb insurance',
)

# Counterparty patterns that are positively project-finance (not decom).
# If matched, we suppress is_decom_security even if description has overlap
# (avoids false positives from boilerplate like "in respect of any losses
# including decommissioning costs" in a bank debenture).
PROJECT_FINANCE_NEGATIVE_HINTS = (
    'as security agent', 'as agent', 'as facility agent',
    'security trustee', 'agent and trustee',
)


def _person_names(persons_entitled) -> str:
    """Flatten persons_entitled (list of dicts or strings) to lowercase string."""
    if not persons_entitled:
        return ''
    if isinstance(persons_entitled, str):
        return persons_entitled.lower()
    parts: list[str] = []
    for p in persons_entitled:
        if isinstance(p, dict):
            n = p.get('name') or ''
            parts.append(str(n))
        else:
            parts.append(str(p))
    return ' | '.join(parts).lower()


def is_decom_security(description: str | None, persons_entitled) -> bool:
    """
    True only if the charge plausibly secures a decommissioning /
    restoration / ARO obligation. False for generic project-finance
    debentures held by syndicate banks acting as security agent.
    """
    desc = (description or '').lower()
    persons_lc = _person_names(persons_entitled)

    has_decom_lang = any(tok in desc for tok in DECOM_DESC_TOKENS)
    has_surety     = any(s in persons_lc for s in SURETY_COUNTERPARTIES)
    is_proj_fin_counterparty = any(h in persons_lc for h in PROJECT_FINANCE_NEGATIVE_HINTS)

    if has_surety:
        # Surety counterparty alone = strong decom signal regardless of description
        return True
    if has_decom_lang and not is_proj_fin_counterparty:
        return True
    return False


# ── Candidate generation ───────────────────────────────────────────────────

def search_strategies(project_name: str, applicant: str | None) -> list[tuple[str, str]]:
    """
    Return list of (strategy, query) tuples to try at CH search.
    Order matters — we score candidates from each variant.
    """
    p = (project_name or '').strip()
    out = []
    if p:
        out.append(('project_name_exact', p))
        out.append(('project_name_limited', f'{p} Limited'))
        # Strip "Wind Farm" / "Wind Park" suffix to broaden — sometimes the
        # SPV is "Benbrack Limited" not "Benbrack Wind Farm Limited"
        stripped = re.sub(r'\b(wind farm|wind park|wind power|wind|farm)s?\b\.?$', '', p, flags=re.IGNORECASE).strip()
        if stripped and stripped.lower() != p.lower():
            out.append(('project_name_stripped', stripped))
            out.append(('project_name_stripped_wind', f'{stripped} Wind'))
    if applicant:
        out.append(('applicant_name', applicant.strip()))
    # Dedupe while preserving order
    seen, uniq = set(), []
    for s, q in out:
        key = (s, q.lower())
        if key not in seen:
            seen.add(key)
            uniq.append((s, q))
    return uniq


def compute_combined_confidence(name_score: float, charge_score: float,
                                 n_charges: int, status: str | None) -> float:
    """
    Score reflecting how strong a candidate is for being THE SPV.

    A perfect-name SPV with charges is a near-certain match even if the
    charge descriptions are generic boilerplate (which most CH descriptions
    are — the asset-specific text lives in the charge document PDF, not
    in the brief description field).

    Formula:
      • base = 0.55 × name_score + 0.45 × charge_score
      • Floor: name ≥ 90 + has charges → at least 82 (real operating SPV
        with project finance — strong evidence regardless of description match)
      • Floor: name ≥ 90, no charges → at least 65 (likely right SPV, no
        debt visible — could be all-equity or pre-financing)
      • Floor: name ≥ 70 + has charges → at least 70
      • Status penalty: dissolved -15, liquidation -5
    """
    base = 0.55 * name_score + 0.45 * charge_score

    if name_score >= 90 and n_charges >= 1:
        base = max(base, 82)
    elif name_score >= 90:
        base = max(base, 65)
    elif name_score >= 70 and n_charges >= 1:
        base = max(base, 70)

    status_l = (status or '').lower()
    if status_l == 'dissolved':
        base -= 15
    elif status_l in ('liquidation', 'receivership', 'voluntary-arrangement'):
        base -= 5

    return max(0.0, round(base, 1))


# Below the score-confidence threshold, skip persisting — pure noise from
# broad searches (e.g. searching applicant company name returns the parent's
# entire wind-farm portfolio, only one of which is the project).
NAME_MATCH_THRESHOLD = 10.0


def score_candidate(project_name: str, project_tokens: set[str],
                    company_item: dict, charges: list[dict]) -> dict | None:
    """
    Compute scores. Returns None for candidates below the name-match noise
    threshold (caller skips them).
    """
    cn   = company_item.get('title') or company_item.get('company_name') or ''
    name_score = name_similarity(project_name, cn)
    if name_score < NAME_MATCH_THRESHOLD:
        return None

    matching_charges = [c for c in charges
                        if charge_describes_project(c.get('description'), project_tokens)]
    n_charges = len(charges)
    n_match   = len(matching_charges)
    charge_score = round(100 * n_match / n_charges, 1) if n_charges else 0.0
    status = company_item.get('company_status')

    combined = compute_combined_confidence(name_score, charge_score, n_charges, status)

    addr = company_item.get('address_snippet') or ''
    if isinstance(company_item.get('address'), dict):
        addr_obj = company_item['address']
        addr = ', '.join(filter(None, [
            addr_obj.get('premises'), addr_obj.get('address_line_1'),
            addr_obj.get('locality'), addr_obj.get('postal_code'),
        ]))

    best_charge_desc = ''
    if matching_charges:
        best_charge_desc = (matching_charges[0].get('description') or '')[:300]

    return {
        'ch_company_number':           company_item.get('company_number'),
        'ch_company_name':             cn,
        'ch_company_status':           company_item.get('company_status'),
        'ch_company_type':             company_item.get('company_type'),
        'date_of_creation':            company_item.get('date_of_creation'),
        'date_of_cessation':           company_item.get('date_of_cessation'),
        'registered_office_address':   addr or None,
        'name_match_score':            name_score,
        'charge_match_score':          charge_score,
        'charges_count':               n_charges,
        'charges_with_project_match':  n_match,
        'combined_confidence':         combined,
        'best_charge_description':     best_charge_desc or None,
    }


# ── Per-project pipeline ───────────────────────────────────────────────────

def process_project(client, row: dict, refresh: bool = False) -> int:
    """Returns count of candidates persisted for this project."""
    repd_id   = row['repd_ref_id']
    project   = row['site_name']
    applicant = row.get('planning_applicant')

    if not project:
        return 0

    if not refresh:
        existing = client.table('ch_spv_candidates').select('id') \
            .eq('repd_ref_id', repd_id).limit(1).execute()
        if existing.data:
            log.info(f'  {project} — already discovered; skipping (use --refresh to redo)')
            return 0

    log.info(f'  {project} (repd_id={repd_id}) — applicant: {applicant or "—"}')
    project_tokens = _tokens(project)

    # ── Step 1: search variants → collect unique candidate companies ─────
    seen_numbers: dict[str, str] = {}      # company_number → strategy that found it
    raw_candidates: list[dict] = []
    for strategy, query in search_strategies(project, applicant):
        items = ch_search_companies(query)
        for item in items[:TOP_RESULTS_PER_VARIANT]:
            num = (item.get('company_number') or '').strip()
            if not num or num in seen_numbers:
                continue
            seen_numbers[num] = strategy
            raw_candidates.append({**item, '_strategy': strategy, '_query': query})

    if not raw_candidates:
        log.info('    no CH candidates returned')
        return 0

    log.info(f'    {len(raw_candidates)} unique CH candidates from {len(set(c["_strategy"] for c in raw_candidates))} strategies')

    # ── Step 2: pre-rank by name match; keep top N for charges fetch ─────
    pre_scored = []
    for c in raw_candidates:
        s = name_similarity(project, c.get('title') or '')
        pre_scored.append((s, c))
    pre_scored.sort(key=lambda x: x[0], reverse=True)
    top_for_charges = pre_scored[:CANDIDATES_TO_KEEP]

    # ── Step 3: fetch charges, score, persist ────────────────────────────
    n_persisted = 0
    for _, c in top_for_charges:
        num = c['company_number']
        charges = ch_get_charges(num)
        scored  = score_candidate(project, project_tokens, c, charges)
        if scored is None:
            log.info(f'    ↳ {(c.get("title") or "?")[:60]} ({num}) · skipped (name match below threshold)')
            continue
        scored.update({
            'repd_ref_id':         repd_id,
            'search_strategy':     c['_strategy'],
            'search_query':        c['_query'],
            'raw_company_response': json.loads(json.dumps(c)),
        })

        try:
            up = client.table('ch_spv_candidates').upsert(
                scored, on_conflict='repd_ref_id,ch_company_number',
                returning='representation',
            ).execute()
            cand_id = (up.data or [{}])[0].get('id')
        except Exception as e:
            log.warning(f'    candidate upsert failed for {num}: {e}')
            continue

        # Persist charges
        if cand_id and charges:
            charge_rows = []
            for ch in charges:
                desc = (ch.get('description') or '').strip() or None
                charge_rows.append({
                    'candidate_id':       cand_id,
                    'ch_company_number':  num,
                    'ch_charge_id':       ch.get('charge_number') or ch.get('id') or f'{num}-{len(charge_rows)}',
                    'classification':     ((ch.get('classification') or {}).get('description')
                                           or ch.get('classification') if isinstance(ch.get('classification'), str)
                                           else None),
                    'status':             ch.get('status'),
                    'description':        desc,
                    'persons_entitled':   json.loads(json.dumps(ch.get('persons_entitled') or [])),
                    'charge_code':        ch.get('charge_code'),
                    'delivered_on':       ch.get('delivered_on'),
                    'created_on':         ch.get('created_on'),
                    'satisfied_on':       ch.get('satisfied_on'),
                    'references_project': charge_describes_project(desc, project_tokens),
                    'is_decom_security':  is_decom_security(desc, ch.get('persons_entitled')),
                    'raw_charge_response': json.loads(json.dumps(ch)),
                })
            try:
                client.table('ch_spv_candidate_charges').upsert(
                    charge_rows, on_conflict='candidate_id,ch_charge_id',
                ).execute()
            except Exception as e:
                log.warning(f'    charge upsert failed: {e}')

        n_persisted += 1
        log.info(f'    ↳ {scored["ch_company_name"]} ({num}) · '
                 f'name={scored["name_match_score"]} · '
                 f'charges={scored["charges_count"]} ({scored["charges_with_project_match"]} match) · '
                 f'conf={scored["combined_confidence"]}')

    return n_persisted


# ── Telemetry + main ───────────────────────────────────────────────────────

def _log_run(client, status, n_projects, n_candidates, error=None):
    try:
        client.table('ingestion_runs').insert({
            'pipeline':           'find_spv_candidates',
            'status':             status,
            'started_at':         f'{date.today()}T00:00:00Z',
            'finished_at':        f'{date.today()}T00:00:01Z',
            'records_written':    n_candidates,
            'source_attribution': 'Companies House /search/companies + /company/{n}/charges',
            'notes':              f'projects {n_projects} · candidates {n_candidates}',
            'error_message':      error,
        }).execute()
    except Exception as e:
        log.warning(f'telemetry write failed: {e}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit',    type=int, default=10, help='Max projects this run.')
    ap.add_argument('--project',  help='Restrict to projects whose site_name matches (ILIKE %X%).')
    ap.add_argument('--refresh',  action='store_true', help='Re-run on projects already discovered.')
    ap.add_argument('--newest',   action='store_true', help='Newest-operational first.')
    ap.add_argument('--rescore',  action='store_true',
                    help='Recompute combined_confidence on cached candidates (no CH API hit).')
    args = ap.parse_args()

    if not CH_API_KEY:
        sys.exit('CH_API_KEY missing')

    client = get_supabase_client()

    # ── Rescore mode: recompute confidence + decom flags on cached data ─
    if args.rescore:
        # Pass 1: candidate combined_confidence
        rows = client.table('ch_spv_candidates') \
            .select('id, name_match_score, charge_match_score, charges_count, '
                    'ch_company_status, combined_confidence') \
            .execute().data or []
        log.info(f'Rescoring {len(rows)} cached candidates with current formula…')
        n_changed = 0
        for r in rows:
            new_conf = compute_combined_confidence(
                float(r.get('name_match_score') or 0),
                float(r.get('charge_match_score') or 0),
                int(r.get('charges_count') or 0),
                r.get('ch_company_status'),
            )
            if abs(new_conf - float(r.get('combined_confidence') or 0)) >= 0.5:
                client.table('ch_spv_candidates').update(
                    {'combined_confidence': new_conf}
                ).eq('id', r['id']).execute()
                n_changed += 1
        log.info(f'  candidates: {n_changed} of {len(rows)} updated')

        # Pass 2: charges is_decom_security flag
        ch_rows = client.table('ch_spv_candidate_charges') \
            .select('id, description, persons_entitled, is_decom_security') \
            .execute().data or []
        log.info(f'Rescoring {len(ch_rows)} cached charges for decom flag…')
        n_charge_changed = 0
        for r in ch_rows:
            new_flag = is_decom_security(r.get('description'), r.get('persons_entitled'))
            if bool(r.get('is_decom_security')) != new_flag:
                client.table('ch_spv_candidate_charges').update(
                    {'is_decom_security': new_flag}
                ).eq('id', r['id']).execute()
                n_charge_changed += 1
        log.info(f'  charges: {n_charge_changed} flipped to is_decom_security={"true" if n_charge_changed else "—"}')
        log.info('=== rescore complete ===')
        return

    # Pull candidate REPD projects + their planning applicant (if known).
    # Use the convenience view directly; it's already filtered to operational
    # onshore wind ≥10 MW with both LPA + ref present.
    q = client.table('repd_operational_onshore_wind_v') \
        .select('repd_ref_id, project_name, mw, country, planning_applicant, repd_operator')
    if args.project:
        q = q.ilike('project_name', f'%{args.project}%')
    if args.newest:
        q = q.order('operational_date', desc=True)
    else:
        q = q.order('mw', desc=True)
    rows = q.limit(args.limit).execute().data or []

    # Map view fields → process_project's expected keys
    rows_norm = []
    for r in rows:
        rows_norm.append({
            'repd_ref_id':        r['repd_ref_id'],
            'site_name':          r.get('project_name'),
            'planning_applicant': r.get('planning_applicant') or r.get('repd_operator'),
        })

    log.info(f'=== SPV candidate finder · {len(rows_norm)} projects ===')
    n_proj, n_cand = 0, 0
    try:
        for r in rows_norm:
            n = process_project(client, r, refresh=args.refresh)
            if n:
                n_proj += 1
                n_cand += n
        log.info(f'=== complete: {n_proj} projects · {n_cand} candidates persisted ===')
        log.info('')
        log.info('Review candidates with:')
        log.info('  SELECT * FROM ch_spv_candidate_review_v ORDER BY mw DESC LIMIT 20;')
        _log_run(client, 'success', n_proj, n_cand)
    except Exception as e:
        log.exception('aborted')
        _log_run(client, 'failure', n_proj, n_cand, error=str(e))
        sys.exit(1)


if __name__ == '__main__':
    main()
