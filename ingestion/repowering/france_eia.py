#!/usr/bin/env python3
"""
France EIA / public-consultation scraper → repowering_projects.

Replaces the disabled rte_france.py (commune-aggregated dataset, no
project-level rows). Pulls France project-level repowering data from
the Ministry of Ecological Transition's public-consultation portal:

  https://www.consultations-publiques.developpement-durable.gouv.fr/

This portal lists every active environmental-impact assessment (EIA)
consultation, including ICPE wind-farm authorizations, ground-mount
solar EIAs, and BESS connection authorizations. Each consultation
corresponds to a real permitted-or-pending repowering pipeline
project.

Strategy:
  1. Fetch the portal's search results for renewable keywords
     ("parc eolien", "centrale photovoltaique", "stockage batterie"),
     paginated.
  2. Filter to project-level pages (URL slug starts with /projet- or
     contains a city/department reference); drop generic regulatory
     consultations (rule modifications, decree drafts).
  3. For each project page, fetch its content and LLM-extract:
     project name, asset class, capacity, developer, location, stage.
  4. Upsert each into repowering_projects with source_type=
     'regional_gazette', confidence='Medium', derivation='Inferred'.

Cadence: weekly (same Tuesday slot as the disabled MITECO).
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from datetime import date

import requests

from base_ingestor import get_supabase_client, log
from repowering._base import (
    upsert_project, today_iso, parse_date, is_too_old,
)


ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY')
ANTHROPIC_MODEL   = 'claude-haiku-4-5'

# Anthropic starter tier caps inputs at 50k tokens/min. Each project
# page is ~2.5k tokens (10k chars). Sleep 4s between LLM calls to
# stay under the cap.
LLM_THROTTLE_SECONDS = 4
MAX_BODY_CHARS       = 10_000

PORTAL = 'https://www.consultations-publiques.developpement-durable.gouv.fr'

# Keywords whose search results we'll iterate. Each gets paginated.
SEARCH_KEYWORDS = [
    'parc eolien',          # onshore wind
    'eolien en mer',        # offshore wind
    'centrale photovoltaique',  # solar PV
    'parc photovoltaique',  # solar PV (alt phrasing)
    'stockage batterie',    # BESS
]

# How many pages of results to walk back per keyword. Each page = 10
# results; 5 pages = 50 results per keyword × 5 keywords = 250 max.
MAX_PAGES_PER_KEYWORD = 5


# ── HTML parsing ──────────────────────────────────────────────────────

# Iterate by title-link occurrences and look ahead in a fixed window for
# description + date. The portal nests cards inconsistently across types
# (HTML projects vs PDF attachments) so a single closing-div boundary
# regex misses ~70% of cards.
TITLE_LINK_RE = re.compile(
    r"<h2 class='recherche-card__title[^']*'[^>]*>"
    r"<a href='(?P<href>[^']+)'[^>]*title='(?P<title>[^']+)'",
    re.S,
)
DESC_RE = re.compile(
    r"<p class='recherche-card__desc[^']*'[^>]*>(?P<desc>.*?)</p>",
    re.S,
)
DATE_RE = re.compile(r"<time datetime='(?P<d>\d{4}-\d{2}-\d{2})'")


def fetch_search_page(keyword: str, start: int) -> list[dict]:
    """Fetch one page of search results. start is the offset (0, 10, 20…)."""
    url = (
        f'{PORTAL}/spip.php?page=recherche&recherche={requests.utils.quote(keyword)}'
        f'&tri=datedesc&r_start={start}'
    )
    try:
        r = requests.get(url, timeout=45, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; EndenexBot/1.0)',
        })
        if r.status_code != 200:
            log.warning(f'    portal returned {r.status_code} for {keyword}/{start}')
            return []
    except Exception as e:
        log.warning(f'    portal fetch failed: {e}')
        return []

    html = r.text
    cards: list[dict] = []
    title_matches = list(TITLE_LINK_RE.finditer(html))
    for i, m in enumerate(title_matches):
        href  = m.group('href').strip()
        title = m.group('title').strip()
        if href.startswith('/'):
            href = PORTAL + href
        # Skip non-HTML attachments (PDF/DOC/XLS) — usually supporting
        # files, not the consultation page itself.
        if re.search(r'\.(pdf|docx?|xlsx?|odt)(\?|$)', href, re.I):
            continue
        # Window between this title and the next title (or +2000 chars
        # if last) — pick up description + date from this card only.
        end = title_matches[i+1].start() if i+1 < len(title_matches) else m.end() + 2000
        window = html[m.end():end]
        m_desc = DESC_RE.search(window)
        desc = re.sub(r'<[^>]+>', ' ', m_desc.group('desc')).strip() if m_desc else ''
        m_date = DATE_RE.search(window)
        d = m_date.group('d') if m_date else None
        cards.append({'href': href, 'title': title, 'desc': desc, 'date': d})
    return cards


def fetch_project_page(url: str) -> str:
    """Fetch a single project consultation page; return stripped text."""
    try:
        r = requests.get(url, timeout=45, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; EndenexBot/1.0)',
            'Accept-Language': 'fr-FR,fr;q=0.9',
        })
        if r.status_code != 200:
            return ''
        text = re.sub(r'<script.*?</script>', ' ', r.text, flags=re.S | re.I)
        text = re.sub(r'<style.*?</style>',   ' ', text, flags=re.S | re.I)
        text = re.sub(r'<[^>]+>',             ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text[:30_000]
    except Exception as e:
        log.warning(f'    page fetch failed for {url}: {e}')
        return ''


# ── LLM extraction ────────────────────────────────────────────────────

EXTRACT_TOOL = {
    'name': 'submit_france_renewable_project',
    'description': (
        'Extract structured metadata from a French environmental-impact '
        'consultation page. TWO independent filters: '
        '(1) is_specific_project=false drops generic regulations. '
        '(2) is_repowering_or_decommissioning=false drops net-new '
        'greenfield builds. Both must be true for inclusion.'
    ),
    'input_schema': {
        'type': 'object',
        'properties': {
            'is_specific_project': {'type': 'boolean',
                                    'description': 'True if this page concerns ONE named installation. False for sector rules, decree drafts, PPE consultations.'},
            'is_repowering_or_decommissioning': {'type': 'boolean',
                                                  'description': 'True ONLY if the consultation explicitly describes renouvellement (replacement) of existing turbines/panels, démantèlement, dépose, or remplacement of an existing renewable installation. False for new builds, extensions, augmentations de puissance, or modifications that add capacity without retiring existing units.'},
            'project_name':       {'type': 'string'},
            'asset_class':        {'type': 'string', 'enum': ['onshore_wind','offshore_wind','solar_pv','bess']},
            'stage':              {'type': 'string', 'enum': ['announced','application_submitted','application_approved','permitted','ongoing']},
            'capacity_mw':        {'type': 'number'},
            'developer':          {'type': 'string'},
            'commune':            {'type': 'string'},
            'departement':        {'type': 'string'},
            'reference':          {'type': 'string', 'description': 'Procedural / file reference if visible'},
        },
        'required': ['is_specific_project', 'is_repowering_or_decommissioning'],
    },
}


def llm_extract(title: str, desc: str, body: str, url: str) -> dict | None:
    if not ANTHROPIC_API_KEY:
        return None
    try:
        import anthropic
    except ImportError:
        return None
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    try:
        msg = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=1500,
            tools=[EXTRACT_TOOL],
            tool_choice={'type': 'tool', 'name': 'submit_france_renewable_project'},
            messages=[{
                'role': 'user',
                'content': (
                    f'Source URL: {url}\n'
                    f'Title: {title}\n'
                    f'Description: {desc}\n\n'
                    f'Page text follows. The repowering_projects table is '
                    f'STRICTLY for projects that tear down an existing '
                    f'renewable installation and replace it. TWO filters:\n'
                    f'  is_specific_project=false → drop generic regulations\n'
                    f'  is_repowering_or_decommissioning=false → drop NEW '
                    f'BUILDS, extensions, augmentations de puissance, '
                    f'capacity additions on existing sites that don\'t '
                    f'retire existing units.\n'
                    f'Both must be true to persist.\n\n'
                    f'For qualifying repowering projects, fill the fields. '
                    f'Stage maps roughly:\n'
                    f'  - "consultation préalable" / "phase amont" → announced\n'
                    f'  - "enquête publique en cours" → application_submitted\n'
                    f'  - "avis favorable de l\'AE" / "déclaration utilité publique" → application_approved\n'
                    f'  - "arrêté préfectoral d\'autorisation" / "permis de construire délivré" → permitted\n'
                    f'  - "mise en service" / "raccordement" → ongoing\n\n'
                    f'---\n{body[:MAX_BODY_CHARS]}'
                ),
            }],
        )
    except anthropic.RateLimitError as e:
        log.warning(f'    LLM rate-limited on {url[:60]} — skipping (will retry next run): {str(e)[:120]}')
        return None
    except Exception as e:
        log.warning(f'    LLM failed on {url[:60]}: {str(e)[:120]}')
        return None
    for block in msg.content:
        if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_france_renewable_project':
            return block.input
    return None


# ── Main ──────────────────────────────────────────────────────────────

def build_row(ext: dict, source_url: str, today: str, card_date: str | None = None) -> dict | None:
    if not ext.get('is_specific_project'):
        return None
    if not ext.get('is_repowering_or_decommissioning'):
        return None
    # 3-year cutoff — drop announcements older than MAX_AGE_YEARS
    if is_too_old(card_date, today):
        return None
    project_name = (ext.get('project_name') or '').strip()
    if not project_name:
        return None
    asset_class = ext.get('asset_class')
    if asset_class not in {'onshore_wind','offshore_wind','solar_pv','bess'}:
        return None
    stage = ext.get('stage') or 'application_submitted'
    if stage not in {'announced','application_submitted','application_approved','permitted','ongoing'}:
        stage = 'application_submitted'
    cap = ext.get('capacity_mw')
    try:
        capacity_mw = float(cap) if cap else None
    except (TypeError, ValueError):
        capacity_mw = None
    location_parts = [ext.get('commune'), ext.get('departement'), 'France']
    location = ', '.join(p.strip() for p in location_parts if p and p.strip())

    return {
        'project_name':        project_name,
        'country_code':        'FR',
        'asset_class':         asset_class,
        'stage':               stage,
        'stage_date':          today,
        'capacity_mw':         capacity_mw,
        'developer':           (ext.get('developer') or None) or None,
        'operator':            None,
        'planning_reference':  (ext.get('reference') or None) or None,
        'location_description': location or 'France',
        'source_url':          source_url,
        'notes':               'Consultations publiques (LLM-extracted)',
        'source_type':         'regional_gazette',
        'source_date':         today,
        'confidence':          'Medium',
        'derivation':          'Inferred',
        'last_reviewed':       today,
        'external_source':     'fr_consultations_publiques',
        'external_source_id':  (ext.get('reference') or None) or None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--keyword', action='append',
                    help='Override search keyword (repeatable). Default: 5 renewable keywords.')
    ap.add_argument('--max-pages', type=int, default=MAX_PAGES_PER_KEYWORD,
                    help=f'Max pages of results per keyword (default {MAX_PAGES_PER_KEYWORD})')
    args = ap.parse_args()

    if not ANTHROPIC_API_KEY:
        log.error('ANTHROPIC_API_KEY not set — cannot LLM-extract')
        sys.exit(0)

    client = get_supabase_client()
    today = today_iso()
    log.info(f'=== France EIA scrape · {today} ===')

    keywords = args.keyword or SEARCH_KEYWORDS
    seen_urls: set[str] = set()
    candidates: list[dict] = []

    for kw in keywords:
        log.info(f'  searching "{kw}"')
        for page_idx in range(args.max_pages):
            cards = fetch_search_page(kw, page_idx * 10)
            if not cards:
                break
            for c in cards:
                if c['href'] in seen_urls:
                    continue
                seen_urls.add(c['href'])
                candidates.append(c)
            if len(cards) < 10:
                break
        log.info(f'    {len(candidates)} unique candidates so far')

    log.info(f'  {len(candidates)} unique candidate pages → LLM extract')

    inserted = skipped = generic_filtered = rate_limited = 0
    for c in candidates:
        if args.dry_run:
            log.info(f'    [dry-run] {c["title"][:80]}')
            continue
        body = fetch_project_page(c['href'])
        if not body:
            skipped += 1
            continue
        ext = llm_extract(c['title'], c['desc'], body, c['href'])
        # Throttle to keep under 50k tokens/min (Anthropic starter cap)
        time.sleep(LLM_THROTTLE_SECONDS)
        if ext is None:
            rate_limited += 1
            continue
        if not ext.get('is_specific_project'):
            generic_filtered += 1
            continue
        row = build_row(ext, c['href'], today, c.get('date'))
        if not row:
            skipped += 1
            continue
        if upsert_project(client, row):
            inserted += 1
            log.info(f'    ✓ {row["project_name"]} ({row["asset_class"]}/{row["stage"]}) {row["capacity_mw"] or "?"} MW')
        else:
            skipped += 1

    if not args.dry_run:
        client.table('ingestion_runs').insert({
            'pipeline':           'france_eia_repowering',
            'status':             'success',
            'started_at':         f'{today}T00:00:00Z',
            'finished_at':        f'{today}T00:00:00Z',
            'records_written':    inserted,
            'source_attribution': PORTAL,
            'notes':              f'France EIA · {inserted} upserts · {skipped} skipped · {generic_filtered} filtered as generic · {rate_limited} rate-limited.',
        }).execute()

    log.info(f'=== complete: {inserted} upserted · {generic_filtered} generic-filtered · {skipped} skipped · {rate_limited} rate-limited ===')


if __name__ == '__main__':
    main()
