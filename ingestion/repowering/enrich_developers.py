#!/usr/bin/env python3
"""
Developer-enrichment orchestrator.

Fills the `developer` column on repowering_projects rows where it's NULL.
Without a developer name, the panel "looks silly" (per user) — a row that
just says "Tahivilla / wind / Spain / 50 MW / permitted" but no operator
isn't actionable.

Strategy:

  1. Pull rows where developer IS NULL (and we haven't already burnt
     `developer_enrichment_attempts >= 3` budget on them).
  2. For each, run a parallel web search for the project name via the
     same DDG-HTML pattern used in check_completions.py.
  3. Send the search-results blob to Claude Sonnet with a focused tool-use
     schema asking only for the developer / operator company name.
  4. If Claude returns a name with confidence >= medium, update the row.
  5. Increment developer_enrichment_attempts and stamp _at on every try
     (success or fail) so we don't re-process losers forever.

Cadence: weekly, after the source-ingestion scripts have run (so newly
ingested rows missing a developer get enriched).
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import datetime

import requests

from base_ingestor import get_supabase_client, log
from repowering._base import today_iso


ANTHROPIC_API_KEY     = os.environ.get('ANTHROPIC_API_KEY')
ANTHROPIC_MODEL       = 'claude-haiku-4-5'

# Brave Search API — preferred over DDG because:
#   - free tier: 2,000 queries/month (well above our 50/run × 4 runs/mo)
#   - real Google-grade results without IP rate-limits
#   - returns structured JSON instead of HTML scraping
# Falls back to DDG if BRAVE_SEARCH_API_KEY isn't set.
BRAVE_SEARCH_API_KEY  = os.environ.get('BRAVE_SEARCH_API_KEY')
BRAVE_API_URL         = 'https://api.search.brave.com/res/v1/web/search'

MAX_ATTEMPTS = 3   # don't retry forever

# Sources where the developer is structurally confidential during the
# pre-commissioning phase — running DDG searches against codenames like
# "GNARLY OSAGE" or "PLUOT" is hopeless because no public source has the
# attribution. These projects will get developers from EIA Form 860
# (~12-month lag) or post-IA FERC filings, not from press scraping.
SKIP_SOURCES = {
    'caiso_queue',
    'ercot_giinr',
    'miso_queue',
    'pjm_queue',
    'nyiso_queue',
    'spp_queue',
    'aemo_giinr',
}

# Stop the run after this many consecutive DDG failures. Once DDG starts
# rate-limiting the runner IP, every subsequent search waits 30s for the
# timeout — capping prevents 13-minute zombie runs. Telemetry row still
# gets written so the partial-run shows up.
MAX_CONSECUTIVE_DDG_FAILS = 5


DEV_TOOL = {
    'name':'submit_developer_match',
    'description':(
        'Identify the developer / operator / sponsor company behind the named '
        'renewable-energy project, based on the news/web snippets provided. '
        'Be conservative: only return a name if the search results explicitly '
        'attribute the project to a company. If multiple companies are '
        'mentioned (e.g. JV partners), return the lead developer.'
    ),
    'input_schema': {
        'type':'object',
        'properties': {
            'developer':       {'type':'string','description':'Lead developer / operator company name. Empty if unknown.'},
            'operator':        {'type':'string','description':'Operating company if different from developer. Empty if same / unknown.'},
            'confidence':      {'type':'string','enum':['low','medium','high']},
            'evidence':        {'type':'string','description':'1-2 sentence summary of where the attribution came from'},
        },
        'required': ['developer','confidence','evidence'],
    },
}


def fetch_unenriched(client, limit: int = 50) -> list[dict]:
    """Pull projects that need a developer name, excluding queue-stage
    sources where developer attribution is confidential.
    """
    # PostgREST `not.in.(...)` for the source filter; values must be quoted
    skip_csv = ','.join(f'"{s}"' for s in SKIP_SOURCES)
    res = client.table('repowering_projects') \
        .select('id, project_name, country_code, asset_class, capacity_mw, '
                'location_description, stage, source_type, '
                'developer_enrichment_attempts') \
        .is_('developer', 'null') \
        .lt('developer_enrichment_attempts', MAX_ATTEMPTS) \
        .not_.in_('source_type', f'({skip_csv})') \
        .order('developer_enrichment_attempts', desc=False) \
        .limit(limit).execute()
    return list(res.data or [])


def _build_query(project: dict) -> str:
    location = (project.get('location_description') or '').replace(',', ' ')
    return (
        f'"{project["project_name"]}" {project["country_code"]} '
        f'{location} developer OR operator OR "owned by"'
    )


def scrape_via_brave(project: dict) -> str:
    """Brave Search API — preferred when BRAVE_SEARCH_API_KEY is set.

    Returns a flattened text blob of title + description from the top
    10 results, suitable for sending to Claude as evidence.
    """
    if not BRAVE_SEARCH_API_KEY:
        return ''
    query = _build_query(project)
    try:
        r = requests.get(BRAVE_API_URL, timeout=15, params={
            'q':           query,
            'count':       10,
            'safesearch':  'off',
            'extra_snippets': 'true',
        }, headers={
            'Accept':                'application/json',
            'Accept-Encoding':       'gzip',
            'X-Subscription-Token':  BRAVE_SEARCH_API_KEY,
        })
        if r.status_code != 200:
            log.warning(f'    Brave API returned {r.status_code} for {project["project_name"]}')
            return ''
        data = r.json()
        results = (data.get('web') or {}).get('results') or []
        chunks: list[str] = []
        for hit in results:
            title = hit.get('title') or ''
            desc  = hit.get('description') or ''
            url_  = hit.get('url') or ''
            chunks.append(f'{title}\n{desc}\n({url_})')
        return '\n\n'.join(chunks)[:8000]
    except Exception as e:
        log.warning(f'    Brave API failed for {project["project_name"]}: {e}')
        return ''


def scrape_via_ddg(project: dict) -> str:
    """DuckDuckGo HTML — fallback when Brave isn't configured."""
    query = _build_query(project)
    url = f'https://html.duckduckgo.com/html?q={requests.utils.quote(query)}'
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


def scrape_for_developer(project: dict) -> str:
    """Best-effort web search — Brave preferred, DDG fallback."""
    return scrape_via_brave(project) or scrape_via_ddg(project)


def llm_developer_match(project: dict, news_blob: str) -> dict | None:
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
        tools=[DEV_TOOL],
        tool_choice={'type':'tool','name':'submit_developer_match'},
        messages=[{
            'role':'user',
            'content':(
                f'Project: {project["project_name"]}\n'
                f'Country: {project["country_code"]}\n'
                f'Asset class: {project["asset_class"]}\n'
                f'Capacity: {project.get("capacity_mw") or "unknown"} MW\n'
                f'Location: {project.get("location_description") or "unknown"}\n'
                f'Stage: {project.get("stage")}\n\n'
                f'Web search results below. Identify the lead developer / '
                f'operator. Be conservative — only return a name with '
                f'medium/high confidence if the attribution is explicit.\n\n'
                f'---\n{news_blob}'
            ),
        }],
    )
    for block in msg.content:
        if getattr(block,'type',None) == 'tool_use' and block.name == 'submit_developer_match':
            return block.input
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=50, help='Max rows to enrich per run')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    client = get_supabase_client()
    now = datetime.utcnow().isoformat()
    today = today_iso()
    log.info(f'=== Developer enrichment · {today} ===')

    projects = fetch_unenriched(client, args.limit)
    log.info(f'  {len(projects)} projects need a developer name')

    if not ANTHROPIC_API_KEY:
        log.error('  ANTHROPIC_API_KEY not set — cannot enrich')
        sys.exit(0)

    enriched = attempted = consecutive_ddg_fails = 0
    ddg_blocked = False
    for p in projects:
        if ddg_blocked:
            break
        log.info(f'  → {p["project_name"]} ({p["country_code"]})')
        attempted += 1
        news = scrape_for_developer(p)
        if not news:
            consecutive_ddg_fails += 1
            if consecutive_ddg_fails >= MAX_CONSECUTIVE_DDG_FAILS:
                log.warning(f'  DDG appears rate-limited ({consecutive_ddg_fails} consecutive empty/failed fetches) — stopping early')
                ddg_blocked = True
                # Still increment attempts on this project so it counts
                # toward the 3-strike limit and we move on next week.
        else:
            consecutive_ddg_fails = 0
        result = llm_developer_match(p, news) if news else None

        update: dict = {
            'developer_enrichment_at':       now,
            'developer_enrichment_attempts': (p.get('developer_enrichment_attempts') or 0) + 1,
        }
        if result and (result.get('developer') or '').strip() and result.get('confidence') in {'medium','high'}:
            update['developer'] = result['developer'].strip()
            if (result.get('operator') or '').strip():
                update['operator'] = result['operator'].strip()
            log.info(f'    ✓ {result["developer"]} ({result["confidence"]})')
            enriched += 1
        else:
            log.info('    ✗ no confident match')

        if not args.dry_run:
            try:
                client.table('repowering_projects') \
                    .update(update).eq('id', p['id']).execute()
            except Exception as e:
                log.warning(f'    update failed: {e}')

    if not args.dry_run:
        client.table('ingestion_runs').insert({
            'pipeline':           'repowering_developer_enrichment',
            'status':             'success',
            'started_at':         f'{today}T00:00:00Z',
            'finished_at':        f'{today}T00:00:00Z',
            'records_written':    enriched,
            'source_attribution': 'DDG news scrape + Claude Sonnet vision',
            'notes':              f'Developer enrichment · {attempted} attempts · {enriched} confidently matched.',
        }).execute()

    log.info(f'=== complete: {attempted} attempted · {enriched} enriched ===')


if __name__ == '__main__':
    main()
