#!/usr/bin/env python3
"""
SEC EDGAR + LSE RNS material-event filings → repowering_projects.

Phase 3: catch repowering / decommissioning intent at the corporate
disclosure level — earlier than planning records, often before press.

Data sources:

  • SEC EDGAR (US-listed) — free Atom feed for 8-K material events:
      https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=8-K
      Filter to a curated set of CIK numbers for renewables-relevant
      issuers (NextEra, Berkshire Hathaway Energy, Pattern Energy
      successors, AES Corp, Avangrid, Constellation, Vistra, Xcel,
      Duke, Dominion, Iberdrola Renovables ADRs, etc.).

  • LSE RNS (UK-listed) — free public RNS reach via investegate.co.uk
      RSS feeds, filtered to Greencoat UK Wind / The Renewables
      Infrastructure Group / Foresight Solar / NextEnergy Solar / etc.

For each new filing fetched, we:
  1. Pull the filing text (8-K body / RNS announcement HTML).
  2. Send to Claude Sonnet via tool-use to extract any project-level
     repowering, decommissioning, or new-build mentions.
  3. Upsert each into repowering_projects with confidence='Medium'
     (corporate disclosure ≠ regulator filing, but is high-credibility).

LSE RNS dependency: investegate.co.uk hosts a free RSS feed per ticker.
Alternative: pay for RNS Direct API. This script uses the free path.
"""

from __future__ import annotations

import argparse
import os
import re
import sys

import requests

from base_ingestor import get_supabase_client, log
from repowering._base import (
    upsert_project, today_iso, parse_date, is_too_old, clean_project_name,
)


ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY')
ANTHROPIC_MODEL   = 'claude-haiku-4-5'

# Curated tracker — extend as your coverage grows. Each entry is the
# issuer's CIK (SEC EDGAR) or LSE ticker plus a country tag.
SEC_TRACKERS = [
    {'cik':'0000753308','name':'NextEra Energy','country':'US'},
    {'cik':'0000874761','name':'AES Corp','country':'US'},
    {'cik':'0001120295','name':'Xcel Energy','country':'US'},
    {'cik':'0001175454','name':'Avangrid','country':'US'},
    {'cik':'0000027419','name':'Duke Energy','country':'US'},
    {'cik':'0001326160','name':'Constellation Energy','country':'US'},
    {'cik':'0001692819','name':'Vistra Corp','country':'US'},
    {'cik':'0001137774','name':'Berkshire Hathaway Energy','country':'US'},
    {'cik':'0000066740','name':'Dominion Energy','country':'US'},
    {'cik':'0001104659','name':'Pattern Energy','country':'US'},
]
LSE_TRACKERS = [
    {'ticker':'UKW',  'name':'Greencoat UK Wind',                          'country':'GB'},
    {'ticker':'TRIG', 'name':'The Renewables Infrastructure Group',        'country':'GB'},
    {'ticker':'FSFL', 'name':'Foresight Solar Fund',                       'country':'GB'},
    {'ticker':'NESF', 'name':'NextEnergy Solar Fund',                      'country':'GB'},
    {'ticker':'BSIF', 'name':'Bluefield Solar Income Fund',                'country':'GB'},
    {'ticker':'JLEN', 'name':'JLEN Environmental Assets Group',            'country':'GB'},
    {'ticker':'SEIT', 'name':'SDCL Energy Efficiency Income Trust',        'country':'GB'},
]


EXTRACT_TOOL = {
    'name':'submit_corporate_filing_projects',
    'description':(
        'Extract ONLY repowering / decommissioning / dismantling project '
        'mentions from this corporate filing. STRICT criterion: the '
        'project must explicitly tear down or replace an existing '
        'renewable installation. Skip net-new builds, acquisitions of '
        'operating assets without retirement intent, capacity expansions, '
        'phase 2/3 additions, BESS hybridization on existing solar.'
    ),
    'input_schema': {
        'type':'object',
        'properties': {
            'projects': {
                'type':'array',
                'items': {
                    'type':'object',
                    'properties': {
                        'project_name':       {'type':'string',
                                               'description':'Installation name in standard English form: "{Place} Wind Farm" (or Solar Farm / BESS). DO NOT include capacity, year, or developer in the name. Examples: "Taylor County Wind Farm" (NOT "wind farm in Taylor County" or "AES Taylor County wind farm" or "Taylor County 200 MW Wind Farm"). Just the project as a developer would label it on a press release.'},
                        'country_code':       {'type':'string','description':'ISO-2'},
                        'asset_class':        {'type':'string','enum':['onshore_wind','offshore_wind','solar_pv','bess']},
                        'stage':              {'type':'string','enum':['announced','application_submitted','application_approved','permitted','ongoing']},
                        'capacity_mw':        {'type':'number'},
                        'developer':          {'type':'string'},
                        'event_summary':      {'type':'string','description':'1-line description of the event — must reference repowering, decommissioning, retirement, or replacement.'},
                        'is_repowering_or_decommissioning': {'type':'boolean','description':'TRUE only if the filing explicitly describes repowering, decommissioning, dismantling, or retirement of an existing installation. FALSE for new builds, acquisitions, expansions, hybridization. Drop the project entirely if FALSE.'},
                    },
                    'required': ['project_name','country_code','asset_class','stage','is_repowering_or_decommissioning'],
                },
            },
        },
        'required': ['projects'],
    },
}


# ── SEC EDGAR ──────────────────────────────────────────────────────────

def fetch_edgar_filings(cik: str, type_: str = '8-K', count: int = 20) -> list[dict]:
    """Returns recent EDGAR filings for a CIK as Atom feed entries."""
    url = (
        f'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}'
        f'&type={type_}&dateb=&owner=include&count={count}&output=atom'
    )
    r = requests.get(url, timeout=60, headers={
        'User-Agent': 'Endenex Research research@endenex.com',
    })
    if r.status_code != 200:
        log.warning(f'    EDGAR {cik} {r.status_code}')
        return []
    # Parse Atom XML — pull entries with title + link
    entries = re.findall(r'<entry>(.*?)</entry>', r.text, re.S)
    out = []
    for e in entries[:count]:
        title = re.search(r'<title>(.*?)</title>', e, re.S)
        link = re.search(r'<link[^>]*href="([^"]*)"', e)
        updated = re.search(r'<updated>([^<]+)</updated>', e)
        out.append({
            'title':   (title.group(1).strip() if title else ''),
            'url':     (link.group(1) if link else ''),
            'updated': (updated.group(1)[:10] if updated else ''),
        })
    return out


# ── LSE RNS via investegate.co.uk ──────────────────────────────────────

def fetch_lse_rns(ticker: str, count: int = 20) -> list[dict]:
    """Pulls recent RNS announcements for a ticker from investegate.co.uk."""
    url = f'https://www.investegate.co.uk/Articles/Default.aspx?Search={ticker}&LookupType=Code'
    r = requests.get(url, timeout=60, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; EndenexBot/1.0)',
    })
    if r.status_code != 200:
        return []
    # Crude HTML extract — investegate isn't super structured
    rows = re.findall(r'<tr.*?</tr>', r.text, re.S)[:count]
    out = []
    for row in rows:
        href = re.search(r'href="(/Article\.aspx\?id=\d+)"', row)
        title = re.search(r'<a[^>]*>([^<]+)</a>', row)
        date_m = re.search(r'(\d{2}/\d{2}/\d{4})', row)
        if href and title:
            out.append({
                'title':   title.group(1).strip(),
                'url':     'https://www.investegate.co.uk' + href.group(1),
                'updated': parse_date(date_m.group(1)) if date_m else '',
            })
    return out[:count]


# ── Filing body fetch + extract ────────────────────────────────────────

def fetch_text(url: str) -> str:
    r = requests.get(url, timeout=60, headers={
        'User-Agent': 'Endenex Research research@endenex.com',
    })
    r.raise_for_status()
    text = re.sub(r'<script.*?</script>', ' ', r.text, flags=re.S | re.I)
    text = re.sub(r'<style.*?</style>',   ' ', text, flags=re.S | re.I)
    text = re.sub(r'<[^>]+>',             ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:80_000]


def extract_with_claude(filing_text: str, source_url: str, issuer: str) -> list[dict]:
    if not ANTHROPIC_API_KEY:
        return []
    try:
        import anthropic
    except ImportError:
        return []
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    msg = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=3000,
        tools=[EXTRACT_TOOL],
        tool_choice={'type':'tool','name':'submit_corporate_filing_projects'},
        messages=[{
            'role':'user',
            'content':(
                f'Issuer: {issuer}\n'
                f'Source: {source_url}\n\n'
                f'Filing text below. Extract any specific renewable-energy '
                f'project mentions (wind/solar/BESS) — repowering, '
                f'decommissioning, acquisition, divestment, permit award, '
                f'commissioning. Skip strategy language without project names.'
                f'\n\n---\n{filing_text}'
            ),
        }],
    )
    for block in msg.content:
        if getattr(block,'type',None) == 'tool_use' and block.name == 'submit_corporate_filing_projects':
            return block.input.get('projects', [])
    return []


def build_row(ext: dict, source_url: str, issuer: str, today: str, src_type: str) -> dict | None:
    name = clean_project_name((ext.get('project_name') or '').strip())
    if not name:
        return None
    if ext.get('asset_class') not in {'onshore_wind','offshore_wind','solar_pv','bess'}:
        return None
    # Strict repowering filter — drop new builds, acquisitions, expansions
    if not ext.get('is_repowering_or_decommissioning'):
        return None
    capacity_mw = ext.get('capacity_mw')
    try:
        capacity_mw = float(capacity_mw) if capacity_mw else None
    except (TypeError, ValueError):
        capacity_mw = None

    return {
        'project_name':        name,
        'country_code':        ext.get('country_code') or 'US',
        'asset_class':         ext['asset_class'],
        'stage':               ext.get('stage') or 'announced',
        'stage_date':          today,
        'capacity_mw':         capacity_mw,
        'developer':           ext.get('developer') or issuer,
        'operator':            None,
        'planning_reference':  None,
        'location_description': None,
        'source_url':          source_url,
        'notes':               (ext.get('event_summary') or '') + f' (via {issuer})',
        'source_type':         src_type,
        'source_date':         today,
        'confidence':          'Medium',
        'derivation':          'Inferred',
        'last_reviewed':       today,
        'external_source':     src_type,
        'external_source_id':  None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', choices=['sec','lse','both'], default='both')
    ap.add_argument('--limit-per-tracker', type=int, default=10,
                    help='Most-recent filings per issuer (default 10)')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    if not ANTHROPIC_API_KEY:
        log.error('ANTHROPIC_API_KEY not set — cannot extract from filings')
        sys.exit(0)

    client = get_supabase_client()
    today = today_iso()
    log.info(f'=== SEC EDGAR + LSE RNS ingestion · {today} ===')

    inserted = skipped = 0

    if args.source in ('sec','both'):
        for tracker in SEC_TRACKERS:
            log.info(f'  SEC {tracker["name"]} (CIK {tracker["cik"]})')
            filings = fetch_edgar_filings(tracker['cik'], '8-K', args.limit_per_tracker)
            for f in filings:
                if not f.get('url'):
                    continue
                # 3-year cutoff — drop stale 8-K filings
                if is_too_old(f.get('updated'), today):
                    skipped += 1
                    continue
                try:
                    text = fetch_text(f['url'])
                    extractions = extract_with_claude(text, f['url'], tracker['name'])
                except Exception as e:
                    log.warning(f'    {f["url"]} → {e}')
                    continue
                for ext in extractions:
                    row = build_row(ext, f['url'], tracker['name'], today, 'sec_edgar')
                    if not row:
                        skipped += 1
                        continue
                    if args.dry_run:
                        log.info(f'      {row["project_name"]} [{row["asset_class"]}/{row["stage"]}] · {row["capacity_mw"]} MW')
                        continue
                    if upsert_project(client, row):
                        inserted += 1
                    else:
                        skipped += 1

    if args.source in ('lse','both'):
        for tracker in LSE_TRACKERS:
            log.info(f'  LSE {tracker["name"]} ({tracker["ticker"]})')
            filings = fetch_lse_rns(tracker['ticker'], args.limit_per_tracker)
            for f in filings:
                if not f.get('url'):
                    continue
                # 3-year cutoff — drop stale RNS filings
                if is_too_old(f.get('updated'), today):
                    skipped += 1
                    continue
                try:
                    text = fetch_text(f['url'])
                    extractions = extract_with_claude(text, f['url'], tracker['name'])
                except Exception as e:
                    log.warning(f'    {f["url"]} → {e}')
                    continue
                for ext in extractions:
                    row = build_row(ext, f['url'], tracker['name'], today, 'lse_rns')
                    if not row:
                        skipped += 1
                        continue
                    if args.dry_run:
                        log.info(f'      {row["project_name"]} [{row["asset_class"]}/{row["stage"]}]')
                        continue
                    if upsert_project(client, row):
                        inserted += 1
                    else:
                        skipped += 1

    if not args.dry_run:
        client.table('ingestion_runs').insert({
            'pipeline':           'sec_lse_filings_repowering',
            'status':             'success',
            'started_at':         f'{today}T00:00:00Z',
            'finished_at':        f'{today}T00:00:00Z',
            'records_written':    inserted,
            'source_attribution': 'SEC EDGAR + LSE RNS via investegate.co.uk (LLM-extracted)',
            'notes':              f'Filings ingestion · {inserted} upserts · {skipped} skipped. '
                                  f'{len(SEC_TRACKERS)} SEC issuers + {len(LSE_TRACKERS)} LSE tickers tracked.',
        }).execute()

    log.info(f'=== complete: {inserted} upserted · {skipped} skipped ===')


if __name__ == '__main__':
    main()
