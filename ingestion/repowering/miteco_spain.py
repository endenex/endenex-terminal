#!/usr/bin/env python3
"""
MITECO Spain (Tramita) + BOE/regional gazette → repowering_projects.

Spain has no single national register of permitted renewables projects.
The pipeline is fragmented across:

  • MITECO national portal (>50 MW projects, environmental impact phase):
      https://www.miteco.gob.es/es/calidad-y-evaluacion-ambiental/
      participacion-publica.html
    Public-consultation pages list project name + developer + capacity +
    location with a downloadable resolution PDF.

  • BOE (Boletín Oficial del Estado) for national-level decisions:
      https://www.boe.es/diario_boe/  (search "energía eólica/solar")

  • 17 regional gazettes (BOJA Andalucía, BOA Aragón, DOE Extremadura,
    DOG Galicia, DOGV Valencia, etc.) for sub-50 MW projects.

This script implements a pragmatic v1:
  1. Fetches the MITECO Tramita listings (HTML).
  2. Sends each listing's text to Claude Sonnet vision/text for structured
     extraction (project name, capacity, developer, location, stage).
  3. Upserts each into repowering_projects.

The regional-gazette fan-out is left as a TODO. Each gazette has its own
search interface; would benefit from per-region scrapers driven by the
same LLM-extraction harness.

Environment:
  ANTHROPIC_API_KEY required (LLM extraction).
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date

import requests

from base_ingestor import get_supabase_client, log
from repowering._base import (
    normalise_stage, normalise_asset_class,
    upsert_project, today_iso, parse_date,
)


ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY')
ANTHROPIC_MODEL   = 'claude-haiku-4-5'

# Anchor URLs — the public-consultation listing pages MITECO refreshes
# regularly. Add regional gazette URLs here as they're scraped.
MITECO_LISTING_URLS = [
    'https://www.miteco.gob.es/es/calidad-y-evaluacion-ambiental/participacion-publica/abierta.html',
    'https://www.miteco.gob.es/es/calidad-y-evaluacion-ambiental/participacion-publica/cerrada.html',
]


# Tool-use schema that forces structured extraction from each MITECO page.
EXTRACT_TOOL = {
    'name': 'submit_spain_renewable_projects',
    'description': (
        'Submit any wind, solar, or BESS renewable-energy project announcements / '
        'permit applications / approvals visible on this Spanish-government page. '
        'Skip non-renewable projects (gas, infrastructure, etc.).'
    ),
    'input_schema': {
        'type': 'object',
        'properties': {
            'projects': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'properties': {
                        'project_name':       {'type':'string'},
                        'asset_class':        {'type':'string','enum':['onshore_wind','offshore_wind','solar_pv','bess']},
                        'stage':              {'type':'string','enum':['announced','application_submitted','application_approved','permitted','ongoing']},
                        'capacity_mw':        {'type':'number'},
                        'developer':          {'type':'string','description':'Company / consortium developing the project. Empty if unknown.'},
                        'location':           {'type':'string','description':'Province, autonomous community, or municipality.'},
                        'reference':          {'type':'string','description':'Procedural / file reference if visible (e.g. "Expediente: ...").'},
                        'date':               {'type':'string','description':'Date of the resolution / submission as YYYY-MM-DD.'},
                    },
                    'required': ['project_name','asset_class','stage'],
                },
            },
        },
        'required': ['projects'],
    },
}


def fetch_text(url: str) -> str:
    r = requests.get(url, timeout=60, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; EndenexBot/1.0; +https://endenex.com)',
        'Accept': 'text/html',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    })
    r.raise_for_status()
    text = re.sub(r'<script.*?</script>', ' ', r.text, flags=re.S | re.I)
    text = re.sub(r'<style.*?</style>',   ' ', text, flags=re.S | re.I)
    text = re.sub(r'<[^>]+>',             ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:80_000]


def extract_with_claude(page_text: str, source_url: str) -> list[dict]:
    if not ANTHROPIC_API_KEY:
        log.error('  ANTHROPIC_API_KEY not set — MITECO ingestion needs LLM extraction')
        return []
    try:
        import anthropic
    except ImportError:
        log.error('anthropic required: pip install anthropic')
        return []
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    msg = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=4000,
        tools=[EXTRACT_TOOL],
        tool_choice={'type':'tool','name':'submit_spain_renewable_projects'},
        messages=[{
            'role':'user',
            'content': (
                f'Source: {source_url}\n\n'
                f'Spanish-government page text below. Extract any wind/solar/BESS '
                f'renewable energy project announcements, permit applications, '
                f'environmental impact assessments, or approvals you can find. '
                f'Return via the submit_spain_renewable_projects tool. Skip '
                f'gas, hydroelectric, or other non-renewable projects.\n\n'
                f'---\n{page_text}'
            ),
        }],
    )
    for block in msg.content:
        if getattr(block,'type',None) == 'tool_use' and block.name == 'submit_spain_renewable_projects':
            return block.input.get('projects', [])
    return []


def build_row(ext: dict, source_url: str, today: str) -> dict | None:
    project_name = (ext.get('project_name') or '').strip()
    if not project_name:
        return None
    asset_class = ext.get('asset_class')
    if asset_class not in {'onshore_wind','offshore_wind','solar_pv','bess'}:
        return None
    stage = ext.get('stage')
    if stage not in {'announced','application_submitted','application_approved','permitted','ongoing'}:
        stage = 'application_submitted'
    capacity_mw = ext.get('capacity_mw')
    try:
        capacity_mw = float(capacity_mw) if capacity_mw else None
    except (TypeError, ValueError):
        capacity_mw = None

    return {
        'project_name':        project_name,
        'country_code':        'ES',
        'asset_class':         asset_class,
        'stage':               stage,
        'stage_date':          parse_date(ext.get('date')) or today,
        'capacity_mw':         capacity_mw,
        'developer':           (ext.get('developer') or None) or None,
        'operator':            None,
        'planning_reference':  (ext.get('reference') or None) or None,
        'location_description': (ext.get('location') or 'Spain'),
        'source_url':          source_url,
        'notes':               'MITECO Tramita / BOE extraction (LLM)',
        'source_type':         'miteco_tramita',
        'source_date':         today,
        'confidence':          'Medium',
        'derivation':          'Inferred',
        'last_reviewed':       today,
        'external_source':     'miteco_tramita',
        'external_source_id':  (ext.get('reference') or None) or None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', action='append',
                    help='Override listing URL (repeatable). Default: MITECO open + closed consultations.')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    if not ANTHROPIC_API_KEY:
        log.error('ANTHROPIC_API_KEY not set — exiting (cannot extract without LLM)')
        sys.exit(0)   # exit 0 so workflow doesn't fail when secret unconfigured

    client = get_supabase_client()
    today = today_iso()
    log.info(f'=== MITECO Spain ingestion · {today} ===')

    urls = args.url or MITECO_LISTING_URLS
    inserted = skipped = 0
    for url in urls:
        log.info(f'  fetching {url}')
        try:
            text = fetch_text(url)
        except Exception as e:
            log.warning(f'    fetch failed: {e}')
            continue
        try:
            extractions = extract_with_claude(text, url)
        except Exception as e:
            log.warning(f'    LLM failed: {e}')
            continue
        log.info(f'    {len(extractions)} candidates extracted')
        for ext in extractions:
            row = build_row(ext, url, today)
            if not row:
                skipped += 1
                continue
            if args.dry_run:
                log.info(f'      {row["project_name"]} [{row["asset_class"]}/{row["stage"]}] · {row["capacity_mw"]} MW · {row["developer"] or "—"}')
                continue
            if upsert_project(client, row):
                inserted += 1
            else:
                skipped += 1

    if not args.dry_run:
        client.table('ingestion_runs').insert({
            'pipeline':           'miteco_spain_repowering',
            'status':             'success',
            'started_at':         f'{today}T00:00:00Z',
            'finished_at':        f'{today}T00:00:00Z',
            'records_written':    inserted,
            'source_attribution': 'MITECO Tramita + BOE (LLM-extracted)',
            'notes':              f'MITECO ingestion · {inserted} upserts · {skipped} skipped. TODO: 17 regional gazettes (BOJA / BOA / DOE / DOG / DOGV / etc.) not yet covered.',
        }).execute()

    log.info(f'=== complete: {inserted} upserted · {skipped} skipped ===')


if __name__ == '__main__':
    main()
