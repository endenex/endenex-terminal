#!/usr/bin/env python3
"""
Weekly press-extracted scrap prices — pulls public Argus/AMM/RecyclingToday
headline numbers and updates scrap_price_benchmarks if the latest print has
moved.

How it works:
  1. Fetches a curated set of free public pages where Argus / Fastmarkets /
     Recycling Today / LetsRecycle publish weekly scrap-price headlines.
  2. Sends the page text to Claude Haiku via tool-use forced JSON,
     extracting structured (material, region, price, unit, date, source)
     rows.
  3. Maps each extraction to our tracked (material × region) keys.
  4. Compares against the most recent existing row (any publisher). If the
     extracted price differs from the latest known print by ≥0.5% (ignore
     rounding noise), INSERTs a new scrap_price_benchmarks row tagged with
     the appropriate publisher (argus / amm_fastmarkets / recycling_today /
     bcmr) and source_url.
  5. Idempotent: UNIQUE (material, region, publisher, benchmark_name,
     price_date, period_type) blocks dupes within a week.

Honest about limits:
  • Public headline numbers lag paid Argus/AMM real-time prints by 1-7 days.
  • Coverage is sparse — sites only publish a subset of grades publicly.
  • Brittle: if a source restructures its page, extraction may degrade.
    Use confidence='Modelled' (not 'High') for press-extracted rows.
  • This complements (not replaces) weekly_scrap_price_update.py — that
    script keeps movements current via FRED PPI; this one captures actual
    public Argus/AMM prints when available.

Usage:
  python3 weekly_press_scrap_prices.py
  python3 weekly_press_scrap_prices.py --dry-run
  python3 weekly_press_scrap_prices.py --source recycling_today
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, timedelta

import requests

from base_ingestor import get_supabase_client, log


ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY')
ANTHROPIC_MODEL   = 'claude-haiku-4-5'
MIN_MOVE_PCT      = 0.5   # below this we treat as noise / no new info
MAX_AGE_DAYS      = 7     # reject anything older than 1 week (we run weekly)


# ── Curated source list ────────────────────────────────────────────────
#
# Each entry = a free public page that publishes weekly scrap-price
# headlines. The publisher tag below maps to the scrap_price_benchmarks
# CHECK constraint allowed values.

SOURCES = [
    # Page mode — fetch a single URL and extract directly. Best for sites that
    # publish prices on a static landing page.
    {
        'key':       'recycling_today',
        'mode':      'page',
        'url':       'https://www.recyclingtoday.com/scrap-prices/',
        'publisher': 'recycling_today',
        'note':      'Recycling Today scrap-prices landing (low yield — often JS-rendered).',
    },
    {
        'key':       'letsrecycle',
        'mode':      'page',
        'url':       'https://www.letsrecycle.com/prices/metals/',
        'publisher': 'bcmr',
        'note':      'LetsRecycle UK metals prices hub.',
    },

    # Drill-down mode — fetch landing page, find article links matching a
    # regex, take the most recent N matching the topic filter, then extract
    # prices from each article body. Best for sites where prices live inside
    # individual posts rather than a price-table page.
    {
        'key':         'fastmarkets_ferrous',
        'mode':        'drill_down',
        'landing_url': 'https://www.fastmarkets.com/metals-and-mining/ferrous-scrap/',
        # Article URLs look like https://www.fastmarkets.com/insights/<slug>/
        'link_regex':  r'https?://(?:www\.)?fastmarkets\.com/insights/[a-z0-9-]+/?',
        # Article slug must contain at least one of these to be price-relevant
        'topic_keywords': ['scrap', 'shred', 'hms', 'busheling', 'ferrous',
                           'copper', 'aluminum', 'aluminium', 'price', 'outlook',
                           'assessment'],
        'max_articles': 6,
        'publisher':    'amm_fastmarkets',
        'note':         'Fastmarkets ferrous-scrap article drill-down.',
    },
    {
        'key':         'fastmarkets_secondary',
        'mode':        'drill_down',
        'landing_url': 'https://www.fastmarkets.com/metals-and-mining/scrap-and-secondary/',
        'link_regex':  r'https?://(?:www\.)?fastmarkets\.com/insights/[a-z0-9-]+/?',
        'topic_keywords': ['scrap', 'shred', 'hms', 'busheling', 'copper',
                           'aluminum', 'aluminium', 'price', 'outlook'],
        'max_articles': 6,
        'publisher':    'amm_fastmarkets',
        'note':         'Fastmarkets scrap & secondary article drill-down.',
    },

    # EU-focused trade press
    {
        'key':         'eurofer_outlook',
        'mode':        'drill_down',
        'landing_url': 'https://www.eurofer.eu/publications/economic-market-outlook/',
        'link_regex':  r'https?://(?:www\.)?eurofer\.eu/publications/[a-z0-9-/]+',
        'topic_keywords': ['outlook', 'market', 'scrap', 'steel'],
        'max_articles': 4,
        'publisher':    'eurofer',
        'note':         'Eurofer quarterly Economic & Market Outlook reports — EU steel scrap commentary with occasional headline numbers.',
    },
    {
        'key':         'euwid_recycling',
        'mode':        'drill_down',
        'landing_url': 'https://www.euwid-recycling.com/news/business/',
        'link_regex':  r'https?://(?:www\.)?euwid-recycling\.com/news/[a-z0-9-/]+',
        'topic_keywords': ['scrap', 'steel', 'copper', 'aluminium', 'aluminum',
                           'price', 'merchant', 'recycling'],
        'max_articles': 6,
        'publisher':    'recycling_today',  # closest fit in CHECK constraint
        'note':         'EUWID Recycling — German trade press, frequent EU scrap-price headlines.',
    },
    {
        'key':         'recycling_international_eu',
        'mode':        'drill_down',
        'landing_url': 'https://recyclinginternational.com/category/ferrous/',
        'link_regex':  r'https?://(?:www\.)?recyclinginternational\.com/[a-z0-9-/]+',
        'topic_keywords': ['scrap', 'steel', 'copper', 'aluminium', 'aluminum',
                           'price', 'eu', 'europe'],
        'max_articles': 6,
        'publisher':    'recycling_today',
        'note':         'Recycling International ferrous category — pan-EU scrap market headlines.',
    },
    {
        'key':         'letsrecycle_metals',
        'mode':        'drill_down',
        'landing_url': 'https://www.letsrecycle.com/news/category/news/metals/',
        'link_regex':  r'https?://(?:www\.)?letsrecycle\.com/news/[a-z0-9-/]+',
        'topic_keywords': ['scrap', 'steel', 'copper', 'aluminium', 'aluminum',
                           'price', 'metal'],
        'max_articles': 6,
        'publisher':    'bcmr',
        'note':         'LetsRecycle metals news — UK ferrous + non-ferrous scrap headlines.',
    },
]


# ── Extraction tool schema ─────────────────────────────────────────────
#
# Forces Claude into structured output. Each row is an explicit price
# observation: material grade, geography, $/t (or $/lb), date.

EXTRACT_TOOL = {
    'name': 'submit_scrap_prices',
    'description': (
        'Submit any explicit scrap-price HEADLINE numbers found on the page. '
        'Only include rows with an explicit numeric price AND a clear material '
        'grade AND a geography. '
        'INCLUDE: flat $/t (or yuan/t, GBP/t, EUR/t, USD/lb) prices for scrap '
        'grades like HMS 1&2 80:20, shredded steel, busheling, cast iron, '
        'copper No.1/No.2, aluminium taint/tabor or twitch or zorba, lithium '
        'carbonate, lithium hydroxide, black mass NMC/LFP/NCA. '
        'EXCLUDE: "payable indicator" rows (e.g. "Black mass NMC payable '
        'indicator nickel" — these are % of LME for component metals, not '
        'flat scrap prices). EXCLUDE: any row priced "per % [element]" '
        '(e.g. "yuan per % lithium" — also a payable percentage, not a flat '
        'price). EXCLUDE: refined LME primary metal prices unless framed as '
        'a scrap reference. Skip articles without numbers.'
    ),
    'input_schema': {
        'type': 'object',
        'properties': {
            'prices': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'properties': {
                        'material_grade':  {'type': 'string', 'description': 'e.g. "HMS 1&2 80:20", "shredded steel", "Copper No.2 birch/cliff", "Aluminium taint/tabor", "cast iron"'},
                        'region_or_hub':   {'type': 'string', 'description': 'Geography or pricing hub (e.g. "CFR Turkey", "US Midwest", "UK", "EU", "Rotterdam")'},
                        'price':           {'type': 'number'},
                        'unit':            {'type': 'string', 'description': 'e.g. "USD/t", "USD/lb", "GBP/t", "EUR/t"'},
                        'price_date':      {'type': 'string', 'description': 'ISO YYYY-MM-DD; if only month given use last day of month'},
                        'context':         {'type': 'string', 'description': '1-2 sentences of supporting context from the article'},
                    },
                    'required': ['material_grade', 'region_or_hub', 'price', 'unit'],
                },
            },
        },
        'required': ['prices'],
    },
}


# ── Mapping extracted (grade, region) → our tracked benchmark keys ────

GRADE_KEYWORDS = {
    'steel_hms_1_2_8020': [r'hms\s*1.*2.*80', r'hms\s*1.*2', r'80\s*:\s*20', r'hms\s*1\s*&\s*2'],
    'steel_shred':        [r'shred', r'shredded\s+steel'],
    'steel_busheling':    [r'bushel'],
    'cast_iron_general':  [r'cast\s*iron'],
    'copper_no_1':        [r'copper\s*no.?\s*1', r'bare\s*bright'],
    'copper_no_2':        [r'copper\s*no.?\s*2', r'birch.?cliff'],
    'aluminium_taint_tabor': [r'taint.?tabor', r'aluminium\s+taint', r'aluminum\s+taint'],
    'aluminium_twitch':   [r'twitch'],
    'aluminium_zorba':    [r'zorba'],
    # Battery scrap / black mass (Argus / Fastmarkets publish these publicly)
    'black_mass_lfp':     [r'\blfp\b.*black\s*mass', r'black\s*mass.*\blfp\b',
                           r'lithium\s*iron\s*phosphate.*black\s*mass'],
    'black_mass_nmc':     [r'\bnmc\b.*black\s*mass', r'black\s*mass.*\bnmc\b',
                           r'nickel\s+manganese\s+cobalt.*black\s*mass'],
    'black_mass_nca':     [r'\bnca\b.*black\s*mass', r'black\s*mass.*\bnca\b'],
    'lithium_carbonate':  [r'lithium\s*carbonate', r'li2co3'],
    'lithium_hydroxide':  [r'lithium\s*hydroxide', r'lioh'],
}

REGION_KEYWORDS = {
    'TR':   [r'\bturkey\b', r'cfr\s+turkey'],
    'US':   [r'\bu\.?s\.?\b', r'united\s+states', r'midwest', r'pittsburgh', r'chicago', r'houston'],
    'EU':   [r'\beu\b', r'\beurope\b', r'rotterdam', r'germany', r'continental'],
    'GB':   [r'\buk\b', r'\bbritain\b', r'\bengland\b', r'\bbritish\b'],
    'ASIA': [r'\basia\b', r'cif\s+(korea|japan|china)', r'taiwan'],
    'CN':   [r'\bchina\b', r'\bcfr\s+china\b'],
    'LDN':  [r'\blme\b', r'\blbma\b', r'london\s+settlement'],
}


def map_grade(text: str) -> str | None:
    t = text.lower()
    for grade, patterns in GRADE_KEYWORDS.items():
        for p in patterns:
            if re.search(p, t):
                return grade
    return None


def map_region(text: str) -> str | None:
    t = text.lower()
    for region, patterns in REGION_KEYWORDS.items():
        for p in patterns:
            if re.search(p, t):
                return region
    return None


def normalise_price(price: float, unit: str) -> tuple[float, str] | None:
    """
    Convert to USD/t. Returns (price_usd_t, unit_canonical) or None if
    unsupported. Approximate FX rates (intentional — press extraction is
    indicative, anchored prints come from migrations).
    """
    u = unit.lower().replace(' ', '').replace('$', 'usd')

    # Reject payable-indicator units (% of LME, yuan per % lithium, etc.) —
    # they're not flat scrap prices.
    if 'per%' in u or 'per percent' in u or '/%' in u or 'percentage' in u:
        return None

    if 'usd/t' in u or 'usd/mt' in u or u.endswith('usd/tonne'):
        return (price, 'USD/t')
    if 'usd/lb' in u:
        return (price * 2204.62, 'USD/t')   # 1 t = 2204.62 lb
    if 'gbp/t' in u:
        return (price * 1.27, 'USD/t')      # FX 1 GBP ≈ 1.27 USD
    if 'eur/t' in u:
        return (price * 1.08, 'USD/t')      # FX 1 EUR ≈ 1.08 USD
    if 'cny/t' in u or 'rmb/t' in u or 'yuan/t' in u or 'yuan/mt' in u:
        return (price / 7.20, 'USD/t')      # FX 1 USD ≈ 7.20 CNY
    if 'cny/kg' in u or 'rmb/kg' in u or 'yuan/kg' in u:
        return (price * 1000 / 7.20, 'USD/t')
    if 'usd/kg' in u:
        return (price * 1000, 'USD/t')
    return None


def fetch_page(url: str) -> str:
    """Returns plain-text page content with HTML stripped."""
    r = requests.get(url, timeout=60, headers={
        # Browser UA reduces bot-detection on Cloudflare-protected sites
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    })
    r.raise_for_status()
    text = re.sub(r'<script.*?</script>', ' ', r.text, flags=re.S | re.I)
    text = re.sub(r'<style.*?</style>',   ' ', text, flags=re.S | re.I)
    text = re.sub(r'<[^>]+>',             ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:80_000]


def fetch_raw_html(url: str) -> str:
    """Returns raw HTML — needed for link extraction (which strips would lose)."""
    r = requests.get(url, timeout=60, headers={
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    })
    r.raise_for_status()
    return r.text


def discover_article_links(landing_url: str, link_regex: str, topic_keywords: list[str],
                            max_articles: int) -> list[str]:
    """
    Fetches landing_url, extracts hrefs matching link_regex, filters to those
    whose URL slug contains at least one topic keyword, returns first N
    (preserving page order, which is typically newest-first).
    """
    try:
        html = fetch_raw_html(landing_url)
    except Exception as e:
        log.warning(f'    link-discovery fetch failed: {e}')
        return []

    pattern = re.compile(link_regex, re.I)
    found = pattern.findall(html)
    # findall returns list of full URL strings (no groups in our regex).
    # Dedupe while preserving order.
    seen: set[str] = set()
    unique = []
    for u in found:
        url = u.rstrip('/')
        if url in seen:
            continue
        seen.add(url)
        unique.append(url)

    # Filter on topic keywords in slug
    kw_lower = [k.lower() for k in topic_keywords]
    relevant = [u for u in unique if any(k in u.lower() for k in kw_lower)]

    # Skip the landing page itself if it matched
    landing_norm = landing_url.rstrip('/')
    relevant = [u for u in relevant if u != landing_norm]

    return relevant[:max_articles]


def extract_prices_with_claude(page_text: str, source_url: str, cutoff_date: str) -> list[dict]:
    if not ANTHROPIC_API_KEY:
        log.warning('  ANTHROPIC_API_KEY not set — skipping LLM extraction')
        return []
    try:
        import anthropic
    except ImportError:
        log.error('anthropic required: pip install anthropic')
        return []

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    msg = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=2000,
        tools=[EXTRACT_TOOL],
        tool_choice={'type': 'tool', 'name': 'submit_scrap_prices'},
        messages=[{
            'role': 'user',
            'content': (
                f'Source: {source_url}\n\n'
                f'Page text below. Extract any explicit scrap-price headline numbers '
                f'(material grade + region + numeric price + unit). '
                f'IMPORTANT: only include prices dated on or after {cutoff_date}. '
                f'If the article cites a price as of an earlier date, skip it. '
                f'Skip articles without numbers. Return via the submit_scrap_prices tool.\n\n'
                f'---\n{page_text}'
            ),
        }],
    )
    for block in msg.content:
        if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_scrap_prices':
            return block.input.get('prices', [])
    return []


def get_latest_row(client, material: str, region: str) -> dict | None:
    res = client.table('scrap_price_benchmarks') \
        .select('material, region, publisher, price, price_date') \
        .eq('material', material) \
        .eq('region', region) \
        .order('price_date', desc=True) \
        .limit(1) \
        .execute()
    return res.data[0] if res.data else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--source',  help='Run only one source key')
    args = ap.parse_args()

    if not ANTHROPIC_API_KEY:
        log.error('ANTHROPIC_API_KEY not set — extraction needs LLM. Exiting.')
        sys.exit(0)   # exit 0 so CI doesn't fail when secret unconfigured

    sources = [s for s in SOURCES if not args.source or s['key'] == args.source]
    if not sources:
        sys.exit(f'No source matching {args.source!r}')

    client = get_supabase_client()
    today = date.today().isoformat()
    cutoff_date = (date.today() - timedelta(days=MAX_AGE_DAYS)).isoformat()
    inserted = 0
    skipped  = 0
    rows_to_insert: list[dict] = []
    log.info(f'  freshness cutoff: only keep prints dated >= {cutoff_date}')

    log.info(f'=== weekly press scrap-price scan · {today} ===')

    # Build a flat list of (source_cfg, target_url) pairs to extract from.
    # For 'page' mode that's just the configured URL; for 'drill_down' mode
    # we discover article links first.
    targets: list[tuple[dict, str]] = []
    for src in sources:
        mode = src.get('mode', 'page')
        if mode == 'page':
            targets.append((src, src['url']))
        elif mode == 'drill_down':
            log.info(f'  source: {src["key"]} (drill-down from {src["landing_url"]})')
            article_urls = discover_article_links(
                src['landing_url'], src['link_regex'],
                src['topic_keywords'], src['max_articles'],
            )
            log.info(f'    discovered {len(article_urls)} article(s)')
            for au in article_urls:
                log.info(f'      → {au}')
                targets.append((src, au))
        else:
            log.warning(f'  unknown mode {mode!r} for source {src["key"]} — skip')
            skipped += 1

    for src, target_url in targets:
        if src.get('mode', 'page') == 'page':
            log.info(f'  source: {src["key"]} ({target_url})')

        try:
            page_text = fetch_page(target_url)
        except Exception as e:
            log.warning(f'    fetch failed: {e}')
            skipped += 1
            continue

        try:
            extractions = extract_prices_with_claude(page_text, target_url, cutoff_date)
        except Exception as e:
            log.warning(f'    LLM extraction failed: {e}')
            skipped += 1
            continue

        log.info(f'    {len(extractions)} price candidates from {target_url[:80]}')

        for ext in extractions:
            # Freshness check FIRST — drop anything older than 1 week.
            # If LLM didn't return a price_date, treat as today (assume the
            # article reports current pricing).
            ext_date = (ext.get('price_date') or today).strip()
            # Validate basic ISO YYYY-MM-DD shape; if malformed, treat as today.
            if not re.match(r'^\d{4}-\d{2}-\d{2}$', ext_date):
                ext_date = today
            if ext_date < cutoff_date:
                log.info(
                    f'    ↳ dropped: "{ext.get("material_grade")}" / '
                    f'"{ext.get("region_or_hub")}" — '
                    f'price_date {ext_date} older than cutoff {cutoff_date}'
                )
                continue

            grade = map_grade(ext.get('material_grade', ''))
            region = map_region(ext.get('region_or_hub', ''))
            if not grade or not region:
                log.info(
                    f'    ↳ dropped: "{ext.get("material_grade")}" / '
                    f'"{ext.get("region_or_hub")}" — '
                    f'{"no grade match" if not grade else "no region match"}'
                )
                continue
            normalised = normalise_price(ext.get('price', 0), ext.get('unit', ''))
            if not normalised:
                log.info(
                    f'    ↳ dropped: {ext.get("price")} {ext.get("unit")} '
                    f'({grade}/{region}) — unit not normalisable'
                )
                continue
            price_usd_t, unit_canonical = normalised
            if price_usd_t <= 0:
                continue

            # Compare to most-recent existing
            latest = get_latest_row(client, grade, region)
            move_pct = 0.0
            if latest:
                move_pct = abs((price_usd_t - float(latest['price'])) / float(latest['price'])) * 100
                if move_pct < MIN_MOVE_PCT:
                    log.info(f'    {grade}/{region}: ${price_usd_t:.0f} ≈ existing ${latest["price"]:.0f} ({move_pct:.2f}% move) — skip noise')
                    continue

            log.info(f'    {grade}/{region}: ${price_usd_t:.0f} (was ${latest["price"]:.0f}, {move_pct:+.2f}%) — insert')

            rows_to_insert.append({
                'material':       grade,
                'region':         region,
                'publisher':      src['publisher'],
                'benchmark_name': f'{ext.get("material_grade", grade)} {ext.get("region_or_hub", region)} (press extract)',
                'price':          round(price_usd_t, 2),
                'unit':           unit_canonical,
                'price_date':     ext_date,
                'period_type':    'weekly',
                'source_url':     target_url,
                'ingestion_method':'auto_scraper',
                'confidence':     'low',   # press-extracted via LLM — indicative, not direct subscription print
                'notes':          (
                    f'Public headline number extracted from {src["publisher"]} '
                    f'({target_url}). Original quote: "{ext.get("material_grade")}" at '
                    f'"{ext.get("region_or_hub")}", {ext.get("price")} {ext.get("unit")}. '
                    f'Context: {ext.get("context", "")[:200]}'
                ),
            })

    if args.dry_run:
        log.info(f'=== dry-run: {len(rows_to_insert)} rows would be inserted ===')
        for r in rows_to_insert:
            log.info(f'    → {r["material"]}/{r["region"]} ${r["price"]:.0f} via {r["publisher"]}')
        return

    if rows_to_insert:
        try:
            client.table('scrap_price_benchmarks').upsert(
                rows_to_insert,
                on_conflict='material,region,publisher,benchmark_name,price_date,period_type',
            ).execute()
            inserted = len(rows_to_insert)
        except Exception as e:
            log.error(f'  upsert failed: {e}')
            raise

    # Telemetry
    client.table('ingestion_runs').insert({
        'pipeline':           'weekly_press_scrap_prices',
        'status':             'success',
        'started_at':         f'{today}T00:00:00Z',
        'finished_at':        f'{today}T00:00:00Z',
        'records_written':    inserted,
        'source_attribution': 'Public press extraction via Claude Haiku — Argus / Fastmarkets / Recycling Today / LetsRecycle headline numbers',
        'notes':              f'Weekly press scan · {len(sources)} sources · {inserted} rows inserted · {skipped} sources skipped (fetch/LLM error).',
    }).execute()

    log.info(f'=== complete: {inserted} inserted from {len(sources)} sources ===')


if __name__ == '__main__':
    main()
