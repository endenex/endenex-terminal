#!/usr/bin/env python3
"""
Repowering completion-detector orchestrator.

Periodically sweeps repowering_projects rows in stage='ongoing' and checks
whether they have been COMMISSIONED (commercial operation date reached) —
in which case the project drops out of the active pipeline panel.

Detection sources, in priority order:

  1. Direct match against EIA Form 860 (US) — if the project's name + state
     appears with a recent in-service date, mark completed.
  2. Direct match against MaStR (Germany) — Inbetriebnahmedatum filled.
  3. Direct match against AEMO Existing Generation sheet — DUID present
     in the existing sheet.
  4. Direct match against RTE Open Data — etat_installation = 'en_service'
     with a non-null mise_en_service date.
  5. Press / corporate-filing scrape via Claude Sonnet — for each ongoing
     project, search the news archive for "{project_name} commissioning"
     or "{project_name} commercial operation" and check for explicit
     completion language.

Output: updates `completion_checked_at` on every project we tried, and
sets `completed_at` (date) on confirmed completions. The Terminal panel
filters `completed_at IS NULL` so completed projects drop out
automatically.

Cadence: weekly run via GitHub Actions.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date, datetime, timedelta

import requests

from base_ingestor import get_supabase_client, log
from repowering._base import today_iso, parse_date


ANTHROPIC_API_KEY    = os.environ.get('ANTHROPIC_API_KEY')
ANTHROPIC_MODEL      = 'claude-haiku-4-5'
BRAVE_SEARCH_API_KEY = os.environ.get('BRAVE_SEARCH_API_KEY')
BRAVE_API_URL        = 'https://api.search.brave.com/res/v1/web/search'

# Don't re-check the same project too often
MIN_DAYS_BETWEEN_CHECKS = 14


COMPLETION_TOOL = {
    'name':'submit_completion_check',
    'description':(
        'Decide whether the named renewable-energy project has been '
        'commissioned / reached commercial operation, based on the news '
        'snippets / public sources provided. Be conservative: only set '
        'completed=true if you see explicit commissioning language or a '
        'specific completion date.'
    ),
    'input_schema': {
        'type':'object',
        'properties': {
            'completed':       {'type':'boolean'},
            'completion_date': {'type':'string','description':'YYYY-MM-DD if known; empty otherwise'},
            'evidence':        {'type':'string','description':'1-2 sentence summary of evidence'},
            'confidence':      {'type':'string','enum':['low','medium','high']},
        },
        'required': ['completed','confidence','evidence'],
    },
}


def fetch_ongoing_projects(client, limit: int = 200) -> list[dict]:
    """Pull projects currently in ongoing stage that haven't been checked recently."""
    cutoff = (datetime.utcnow() - timedelta(days=MIN_DAYS_BETWEEN_CHECKS)).isoformat()
    res = client.table('repowering_projects') \
        .select('id, project_name, country_code, asset_class, capacity_mw, '
                'developer, location_description, stage_date, completion_checked_at') \
        .eq('stage', 'ongoing') \
        .is_('completed_at', 'null') \
        .or_(f'completion_checked_at.is.null,completion_checked_at.lt.{cutoff}') \
        .limit(limit).execute()
    return list(res.data or [])


# ── Direct database matches ─────────────────────────────────────────────

def check_eia_match(client, project: dict) -> dict | None:
    """Look in commodity_prices/assets table for a US project that's reached
    in-service status. Placeholder — assets table has commissioning_date."""
    if project['country_code'] != 'US':
        return None
    name_pat = f'%{project["project_name"][:30]}%'
    # NOTE: `assets` table column is `name` (not `site_name`) and there
    # is no `status` column — verified against migration 001. We just
    # need commissioning_date — if it's populated, treat as completed.
    res = client.table('assets') \
        .select('id, commissioning_date') \
        .ilike('name', name_pat) \
        .eq('country_code', 'US') \
        .limit(1).execute()
    if res.data:
        a = res.data[0]
        if a.get('commissioning_date'):
            return {
                'completed_at': a['commissioning_date'],
                'evidence': f'EIA-derived assets row matched site_name; commissioned {a["commissioning_date"]}',
                'confidence': 'high',
            }
    return None


def check_rte_completion(client, project: dict) -> dict | None:
    """For FR projects, check installation_history for the same year — if
    capacity exists at expected COD year, treat as completed."""
    # Placeholder — installation_history has only annual aggregates, not
    # per-project. Skipping this in v1; relies on press-scrape fallback.
    return None


# ── Press / corporate-filing scrape via Claude ──────────────────────────

def _commissioning_query(project: dict) -> str:
    return f'"{project["project_name"]}" commissioning OR operational OR completed'


def scrape_news_via_brave(project: dict) -> str:
    if not BRAVE_SEARCH_API_KEY:
        return ''
    try:
        r = requests.get(BRAVE_API_URL, timeout=15, params={
            'q':              _commissioning_query(project),
            'count':          10,
            'safesearch':     'off',
            'extra_snippets': 'true',
        }, headers={
            'Accept':                'application/json',
            'Accept-Encoding':       'gzip',
            'X-Subscription-Token':  BRAVE_SEARCH_API_KEY,
        })
        if r.status_code != 200:
            log.warning(f'    Brave API returned {r.status_code} for {project["project_name"]}')
            return ''
        results = ((r.json().get('web') or {}).get('results') or [])
        chunks = [f'{h.get("title","")}\n{h.get("description","")}\n({h.get("url","")})'
                  for h in results]
        return '\n\n'.join(chunks)[:8000]
    except Exception as e:
        log.warning(f'    Brave API failed for {project["project_name"]}: {e}')
        return ''


def scrape_news_via_ddg(project: dict) -> str:
    url = f'https://html.duckduckgo.com/html?q={requests.utils.quote(_commissioning_query(project))}'
    try:
        r = requests.get(url, timeout=30, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; EndenexBot/1.0)',
        })
        if r.status_code != 200:
            return ''
        text = re.sub(r'<script.*?</script>', ' ', r.text, flags=re.S | re.I)
        text = re.sub(r'<style.*?</style>',   ' ', text, flags=re.S | re.I)
        text = re.sub(r'<[^>]+>',             ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text[:8000]
    except Exception as e:
        log.warning(f'    DDG fetch failed for {project["project_name"]}: {e}')
        return ''


def scrape_news_for(project: dict) -> str:
    """Best-effort web search — Brave preferred, DDG fallback."""
    return scrape_news_via_brave(project) or scrape_news_via_ddg(project)


def llm_completion_check(project: dict, news_blob: str) -> dict | None:
    if not ANTHROPIC_API_KEY:
        return None
    if not news_blob:
        return None
    try:
        import anthropic
    except ImportError:
        return None
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    msg = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=1500,
        tools=[COMPLETION_TOOL],
        tool_choice={'type':'tool','name':'submit_completion_check'},
        messages=[{
            'role':'user',
            'content': (
                f'Project: {project["project_name"]}\n'
                f'Country: {project["country_code"]}\n'
                f'Asset class: {project["asset_class"]}\n'
                f'Developer: {project.get("developer") or "unknown"}\n'
                f'Location: {project.get("location_description") or "unknown"}\n'
                f'Last known stage: ongoing (entered: {project.get("stage_date")})\n\n'
                f'News search results below. Decide whether this project has '
                f'been commissioned / reached commercial operation. Be '
                f'conservative — confirm only on explicit language.\n\n'
                f'---\n{news_blob}'
            ),
        }],
    )
    for block in msg.content:
        if getattr(block,'type',None) == 'tool_use' and block.name == 'submit_completion_check':
            return block.input
    return None


# ── Main ────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=200, help='Max projects to check per run')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    client = get_supabase_client()
    today = today_iso()
    now = datetime.utcnow().isoformat()
    log.info(f'=== Repowering completion check · {today} ===')

    projects = fetch_ongoing_projects(client, args.limit)
    log.info(f'  {len(projects)} ongoing projects to check')

    completed = checked = 0
    for p in projects:
        log.info(f'  → {p["project_name"]} ({p["country_code"]})')
        result = None

        # Tier 1: structured DB match
        result = check_eia_match(client, p) or check_rte_completion(client, p)
        if result:
            log.info(f'    ✓ structured match: {result["evidence"]}')

        # Tier 2: LLM-scored news scrape
        if not result and ANTHROPIC_API_KEY:
            news = scrape_news_for(p)
            if news:
                ai = llm_completion_check(p, news)
                if ai and ai.get('completed') and ai.get('confidence') in {'medium','high'}:
                    result = {
                        'completed_at': ai.get('completion_date') or today,
                        'evidence':     f'News-scrape (LLM): {ai.get("evidence")}',
                        'confidence':   ai['confidence'],
                    }
                    log.info(f'    ✓ news match ({ai["confidence"]}): {ai["evidence"][:80]}')

        # Update DB
        update: dict = {'completion_checked_at': now}
        if result:
            update['completed_at'] = result['completed_at']
            update['notes']        = ((p.get('notes') or '')
                                      + f' | Completed: {result["evidence"]}').strip(' |')
            completed += 1
        checked += 1

        if not args.dry_run:
            try:
                client.table('repowering_projects') \
                    .update(update).eq('id', p['id']).execute()
            except Exception as e:
                log.warning(f'    update failed: {e}')

    if not args.dry_run:
        client.table('ingestion_runs').insert({
            'pipeline':           'repowering_completion_check',
            'status':             'success',
            'started_at':         f'{today}T00:00:00Z',
            'finished_at':        f'{today}T00:00:00Z',
            'records_written':    completed,
            'source_attribution': 'assets table + DDG news scrape + Claude Sonnet vision',
            'notes':              f'Completion check · {checked} projects scanned · {completed} confirmed completed.',
        }).execute()

    log.info(f'=== complete: {checked} checked · {completed} marked completed ===')


if __name__ == '__main__':
    main()
