#!/usr/bin/env python3
"""
Spain BOE (Boletín Oficial del Estado) scraper → repowering_projects.

Replaces the disabled miteco_spain.py (Tramita URLs 404'd). Pulls
Spain project-level repowering data directly from the national gazette
which publishes every:

  - Wind/solar/BESS administrative-authorization request and grant
  - Environmental-impact (DIA / EIA) resolution
  - Public-utility declaration tied to a specific energy project

These appear primarily in Section V.B ("Otros anuncios oficiales")
and Section III ("Otras disposiciones"). Volume is ~3-10 renewable
items per BOE issue.

Strategy:
  1. Walk back N days (default 30) of BOE Sumario XML — free, no auth.
  2. Filter items by title regex matching renewable-project language.
  3. For each match, fetch the item HTML at
     https://www.boe.es/diario_boe/txt.php?id=BOE-B-YYYY-NNNN
  4. LLM-extract project name, capacity, asset class, location,
     developer, stage.
  5. Upsert with source_type='boe_gazette', confidence='Medium'.

Cadence: weekly (Tuesday — same slot as the disabled MITECO).
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import date, timedelta

import requests

from base_ingestor import get_supabase_client, log
from repowering._base import (
    upsert_project, today_iso, parse_date, is_too_old,
)


ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY')
ANTHROPIC_MODEL   = 'claude-haiku-4-5'

# Anthropic free / starter tier caps inputs at 50k tokens/min. Each BOE
# item we send is ~2.5k tokens (10k chars). Sleep 4s between LLM calls
# → 15 calls/min × 2.5k = 37k tokens/min, safely under the cap.
LLM_THROTTLE_SECONDS = 4

# Per-item body length sent to Claude. Project name + capacity + dev
# almost always appears in first paragraph; 10k chars covers the full
# notice header without burning the token budget.
MAX_BODY_CHARS = 10_000

BOE_SUMARIO_URL = 'https://boe.es/datosabiertos/api/boe/sumario/{date}'
BOE_ITEM_URL    = 'https://www.boe.es/diario_boe/txt.php?id={id}'

DEFAULT_DAYS_BACK = 30   # one month of issues per run; idempotent on re-run

# Title-level filter — keep items whose title hints at a specific
# renewable-energy project. Generic regulatory items get caught by the
# LLM step's `is_specific_project=false` path; this is just first-pass
# noise reduction.
TITLE_RE = re.compile(
    r'\b('
    r'eólic\w*|eolic\w*|'
    r'fotovoltaic\w*|'
    r'parque\s+(?:eólic\w*|solar)|'
    r'(?:planta|central)\s+(?:fotovoltaica|solar|eólica)|'
    r'almacenamient\w+\s+energétic\w+|'
    r'BESS|baterí\w+\s+de\s+almacenamient\w+|'
    r'repotenciación|repotenciado'
    r')\b',
    re.I,
)

# Sections worth scanning. III = ministerial decisions; V.B = public
# notices (most renewable EIAs land here).
INTERESTING_SECTIONS = {
    'III. Otras disposiciones',
    'V. Anuncios. - B. Otros anuncios oficiales',
}


# ── Sumario fetch ─────────────────────────────────────────────────────

def fetch_sumario(d: date) -> ET.Element | None:
    url = BOE_SUMARIO_URL.format(date=d.strftime('%Y%m%d'))
    try:
        r = requests.get(url, timeout=30, headers={
            'User-Agent': 'EndenexBot/1.0',
            'Accept':     'application/xml',
        })
        if r.status_code != 200:
            return None
        return ET.fromstring(r.content)
    except Exception as e:
        log.warning(f'    sumario fetch failed for {d}: {e}')
        return None


def scan_sumario(root: ET.Element) -> list[dict]:
    """Return list of {id, title, section, date} hits."""
    hits: list[dict] = []
    fecha = root.findtext('.//fecha_publicacion') or ''
    iso_date = (
        f'{fecha[:4]}-{fecha[4:6]}-{fecha[6:8]}' if len(fecha) >= 8 else None
    )
    for sec in root.iter('seccion'):
        sname = sec.attrib.get('nombre', '')
        if sname not in INTERESTING_SECTIONS:
            continue
        for item in sec.iter('item'):
            title = (item.findtext('titulo') or '').strip()
            if not TITLE_RE.search(title):
                continue
            ident = (item.findtext('identificador') or '').strip()
            if not ident:
                continue
            hits.append({
                'id':      ident,
                'title':   title,
                'section': sname,
                'date':    iso_date,
            })
    return hits


# ── Item full-text fetch ──────────────────────────────────────────────

def fetch_item_text(item_id: str) -> str:
    url = BOE_ITEM_URL.format(id=item_id)
    try:
        r = requests.get(url, timeout=45, headers={
            'User-Agent':       'Mozilla/5.0 (compatible; EndenexBot/1.0)',
            'Accept-Language':  'es-ES,es;q=0.9',
        })
        if r.status_code != 200:
            return ''
        text = re.sub(r'<script.*?</script>', ' ', r.text, flags=re.S | re.I)
        text = re.sub(r'<style.*?</style>',   ' ', text, flags=re.S | re.I)
        text = re.sub(r'<[^>]+>', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text[:30_000]
    except Exception as e:
        log.warning(f'    item fetch failed for {item_id}: {e}')
        return ''


# ── LLM extraction ────────────────────────────────────────────────────

EXTRACT_TOOL = {
    'name': 'submit_spain_renewable_project',
    'description': (
        'Extract project metadata from a Spanish BOE notice or resolution. '
        'TWO independent boolean filters control inclusion: '
        '(1) is_specific_project=false drops generic policy instruments. '
        '(2) is_repowering_or_decommissioning=false drops net-new '
        'greenfield projects. Both must be true for the row to be '
        'persisted.'
    ),
    'input_schema': {
        'type': 'object',
        'properties': {
            'is_specific_project':  {'type': 'boolean',
                                     'description': 'True if this notice concerns ONE named installation. False for sector-wide rules, decrees, ministerial orders not tied to a specific facility.'},
            'is_repowering_or_decommissioning': {'type': 'boolean',
                                                  'description': 'True ONLY if the notice explicitly describes repotenciación, repotenciado, desmantelamiento, sustitución de aerogeneradores/paneles, or retirada de servicio of an existing renewable installation. False for net-new greenfield projects, capacity expansions, phase 2/3 additions, or hybridización (adding BESS to existing solar).'},
            'project_name':         {'type': 'string',
                                     'description': 'Installation name in standard English format: "{Place} Wind Farm" for onshore_wind / offshore_wind, "{Place} Solar Farm" for solar_pv, "{Place} BESS" for bess. Preserve local accents on the place name (Mudarra, Cabeza del Caballo, Saint-Crépin). Examples: "Mudarra Wind Farm" (not "Parque Eólico Mudarra" or "Modificación del parque eólico Mudarra"), "Cabeza del Caballo Solar Farm" (not "Planta Solar de Cabeza del Caballo"), "Asturias BESS" (not "Sistema de almacenamiento de Asturias"). Strip the BOE notice prefix entirely; output the project as a developer would label it on a press release.'},
            'asset_class':          {'type': 'string', 'enum': ['onshore_wind','offshore_wind','solar_pv','bess']},
            'stage':                {'type': 'string', 'enum': ['announced','application_submitted','application_approved','permitted','ongoing']},
            'capacity_mw':          {'type': 'number'},
            'developer':            {'type': 'string'},
            'municipio':            {'type': 'string'},
            'provincia':            {'type': 'string'},
            'comunidad_autonoma':   {'type': 'string'},
            'reference':            {'type': 'string', 'description': 'Procedural / file reference (e.g. "Expediente: ...")'},
        },
        'required': ['is_specific_project', 'is_repowering_or_decommissioning'],
    },
}


def llm_extract(item: dict, body: str) -> dict | None:
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
            tool_choice={'type': 'tool', 'name': 'submit_spain_renewable_project'},
            messages=[{
                'role': 'user',
                'content': (
                    f'Source: BOE {item["id"]} ({item["date"]})\n'
                    f'Section: {item["section"]}\n'
                    f'Title: {item["title"]}\n\n'
                    f'BOE item full text follows. The repowering_projects '
                    f'table is STRICTLY for projects that tear down an '
                    f'existing renewable installation and replace it. '
                    f'TWO filters: \n'
                    f'  is_specific_project=false → drop generic regulations\n'
                    f'  is_repowering_or_decommissioning=false → drop '
                    f'NET-NEW greenfield builds, capacity expansions, '
                    f'phase 2/3 additions, BESS hybridización on existing '
                    f'solar.\n'
                    f'Both must be true for the project to be persisted.\n\n'
                    f'Stage mapping (Spanish administrative process):\n'
                    f'  - "información pública" / "consulta previa" → application_submitted\n'
                    f'  - "DIA favorable" / "declaración impacto ambiental" → application_approved\n'
                    f'  - "autorización administrativa" / "utilidad pública" → permitted\n'
                    f'  - "puesta en servicio" / "acta de puesta en marcha" → ongoing\n\n'
                    f'---\n{body[:MAX_BODY_CHARS]}'
                ),
            }],
        )
    except anthropic.RateLimitError as e:
        log.warning(f'    LLM rate-limited on {item["id"]} — skipping (will retry next run): {str(e)[:120]}')
        return None
    except Exception as e:
        log.warning(f'    LLM failed on {item["id"]}: {str(e)[:120]}')
        return None
    for block in msg.content:
        if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_spain_renewable_project':
            return block.input
    return None


# ── Main ──────────────────────────────────────────────────────────────

def build_row(ext: dict, item: dict, today: str) -> dict | None:
    if not ext.get('is_specific_project'):
        return None
    if not ext.get('is_repowering_or_decommissioning'):
        return None
    # 3-year cutoff — drop announcements older than MAX_AGE_YEARS
    if is_too_old(item.get('date'), today):
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
    location_parts = [
        ext.get('municipio'), ext.get('provincia'), ext.get('comunidad_autonoma'), 'Spain',
    ]
    location = ', '.join(p.strip() for p in location_parts if p and p.strip())
    source_url = BOE_ITEM_URL.format(id=item['id'])

    return {
        'project_name':        project_name,
        'country_code':        'ES',
        'asset_class':         asset_class,
        'stage':               stage,
        'stage_date':          item['date'] or today,
        'capacity_mw':         capacity_mw,
        'developer':           (ext.get('developer') or None) or None,
        'operator':            None,
        'planning_reference':  (ext.get('reference') or item['id']) or None,
        'location_description': location or 'Spain',
        'source_url':          source_url,
        'notes':               f'BOE {item["id"]} · {item["section"]} (LLM-extracted)',
        'source_type':         'boe_gazette',
        'source_date':         today,
        'confidence':          'Medium',
        'derivation':          'Inferred',
        'last_reviewed':       today,
        'external_source':     'boe_gazette',
        'external_source_id':  item['id'],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=DEFAULT_DAYS_BACK,
                    help=f'Days of BOE history to scan (default {DEFAULT_DAYS_BACK})')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    if not ANTHROPIC_API_KEY:
        log.error('ANTHROPIC_API_KEY not set — cannot LLM-extract')
        sys.exit(0)

    client = get_supabase_client()
    today = today_iso()
    log.info(f'=== Spain BOE scrape · {today} ({args.days}-day window) ===')

    all_hits: list[dict] = []
    for offset in range(args.days):
        d = date.today() - timedelta(days=offset)
        # BOE doesn't publish on Sundays; skip
        if d.weekday() == 6:
            continue
        root = fetch_sumario(d)
        if root is None:
            continue
        hits = scan_sumario(root)
        if hits:
            log.info(f'  {d}: {len(hits)} renewable hits')
            all_hits.extend(hits)

    log.info(f'  total: {len(all_hits)} BOE items to LLM-extract')

    inserted = skipped = generic_filtered = rate_limited = 0
    for h in all_hits:
        if args.dry_run:
            log.info(f'    [dry-run] {h["id"]} · {h["title"][:90]}')
            continue
        body = fetch_item_text(h['id'])
        if not body:
            skipped += 1
            continue
        ext = llm_extract(h, body)
        # Throttle to keep under 50k tokens/min (Anthropic starter cap)
        time.sleep(LLM_THROTTLE_SECONDS)
        if ext is None:
            rate_limited += 1
            continue
        if not ext.get('is_specific_project'):
            generic_filtered += 1
            continue
        row = build_row(ext, h, today)
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
            'pipeline':           'spain_boe_repowering',
            'status':             'success',
            'started_at':         f'{today}T00:00:00Z',
            'finished_at':        f'{today}T00:00:00Z',
            'records_written':    inserted,
            'source_attribution': 'BOE.es Sumario API',
            'notes':              f'Spain BOE · {inserted} upserts · {skipped} skipped · {generic_filtered} filtered as generic · {rate_limited} rate-limited.',
        }).execute()

    log.info(f'=== complete: {inserted} upserted · {generic_filtered} generic-filtered · {skipped} skipped · {rate_limited} rate-limited ===')


if __name__ == '__main__':
    main()
