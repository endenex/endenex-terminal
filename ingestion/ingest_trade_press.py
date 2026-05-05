"""
Trade Press Monitor — RSS feed scraper (best-effort, low confidence)
=====================================================================

Pulls headlines from a curated set of renewable-energy trade publications via
their public RSS feeds, keyword-filters for repowering / decommissioning /
blade recycling content, and writes to watch_events with confidence='Low'
(operators should treat as a signal to investigate, not as fact).

This is intentionally separated from the procurement and registry pipelines
because trade-press signals are inherently noisier — broken links, paraphrased
headlines, embargoed content — and shouldn't be promoted to repowering_projects
without manual curation through Airtable first.

Required: feedparser library (install via `pip install feedparser`).

Sources (all public RSS):
  • reNEWS                      https://renews.biz/feed/
  • WindEurope                  https://windeurope.org/newsroom/feed/
  • Recharge News               https://www.rechargenews.com/rss/
  • Wind Power Monthly          https://www.windpowermonthly.com/rss/news
  • Windbranche.de (DE)         https://www.windbranche.de/news/rss
  • PV Magazine                 https://www.pv-magazine.com/feed/
  • Energy Voice                https://www.energyvoice.com/feed/

If a feed errors (404 / changed URL), the script logs and continues.

Usage:
  python ingest_trade_press.py [--days 14]
"""
from __future__ import annotations

import argparse
import logging
from datetime import date, timedelta, datetime
import re

from base_ingestor import get_supabase_client, today_iso

log = logging.getLogger(__name__)
PIPELINE = 'ingest_trade_press'

FEEDS = [
    {'name': 'reNEWS',                 'url': 'https://renews.biz/feed/',                            'scope': 'EU'},
    {'name': 'WindEurope',             'url': 'https://windeurope.org/newsroom/feed/',               'scope': 'EU'},
    {'name': 'Recharge News',          'url': 'https://www.rechargenews.com/rss/',                   'scope': 'Global'},
    {'name': 'Wind Power Monthly',     'url': 'https://www.windpowermonthly.com/rss/news',           'scope': 'Global'},
    {'name': 'Windbranche.de',         'url': 'https://www.windbranche.de/news/rss',                 'scope': 'DE'},
    {'name': 'PV Magazine',            'url': 'https://www.pv-magazine.com/feed/',                   'scope': 'Global'},
    {'name': 'Energy Voice',           'url': 'https://www.energyvoice.com/feed/',                   'scope': 'GB'},
]

# Keyword classifier with associated event_type
KEYWORD_CLASSIFIERS = [
    (['repower', 'repowering'],                    'Repowering Announcement', ['CAP']),
    (['decommission', 'decommissioning', 'dismantl'], 'Decommissioning',     ['CAP', 'PROV']),
    (['blade recycl', 'wind blade waste', 'blade landfill'], 'Material Recovery Update', ['REC_UP', 'REC_DN']),
    (['planning application', 'consent granted', 'permit'], 'Planning Application', ['POL']),
    (['tender awarded', 'contract awarded'],        'Contractor Awarded',     ['CAP']),
    (['scrap price', 'steel price', 'copper price'],'Commodity Move',          ['REC_UP', 'REC_DN']),
    (['eeg', 'feed-in tariff', 'fit', 'subsidy'],   'Policy Update',           ['POL']),
]


def _classify(text: str) -> tuple[str, list[str]] | None:
    t = text.lower()
    if 'wind' not in t and 'turbine' not in t and 'solar' not in t and 'pv' not in t and 'battery' not in t and 'bess' not in t:
        return None
    for keywords, event_type, tags in KEYWORD_CLASSIFIERS:
        if any(kw in t for kw in keywords):
            return event_type, tags
    return None


def _parse_date(struct_time) -> str | None:
    if not struct_time:
        return None
    try:
        return datetime(*struct_time[:6]).date().isoformat()
    except Exception:
        return None


def _strip_html(s: str | None) -> str:
    if not s:
        return ''
    return re.sub(r'<[^>]+>', '', s).strip()


def fetch_feeds(days: int) -> list[dict]:
    """Fetch all feeds, classify, return watch_events-ready rows."""
    try:
        import feedparser
    except ImportError:
        log.error('feedparser not installed. Run: pip install feedparser')
        return []

    cutoff = date.today() - timedelta(days=days)
    rows: list[dict] = []

    for feed_cfg in FEEDS:
        try:
            log.info(f'  → {feed_cfg["name"]}')
            parsed = feedparser.parse(feed_cfg['url'])
            if parsed.bozo and parsed.bozo_exception:
                log.warning(f'     {feed_cfg["name"]}: {parsed.bozo_exception}')
                continue
        except Exception as e:
            log.warning(f'     {feed_cfg["name"]} fetch error: {e}')
            continue

        matched = 0
        for entry in parsed.entries[:200]:   # guard against unbounded feeds
            title    = _strip_html(entry.get('title'))
            summary  = _strip_html(entry.get('summary') or entry.get('description'))
            full     = f'{title} {summary}'
            classification = _classify(full)
            if not classification:
                continue
            event_type, tags = classification

            published = _parse_date(entry.get('published_parsed') or entry.get('updated_parsed'))
            if published:
                try:
                    if date.fromisoformat(published) < cutoff:
                        continue
                except Exception:
                    pass

            rows.append({
                'category':         (
                    'commodity'    if event_type == 'Commodity Move' else
                    'regulatory'   if event_type == 'Policy Update' else
                    'supply_chain' if event_type == 'Contractor Awarded' else
                    'market'
                ),
                'event_type':       event_type,
                'scope':            feed_cfg['scope'],
                'headline':         title[:255],
                'notes':            summary[:500] if summary else None,
                'site_name':        None,
                'company_name':     None,
                'developer':        None,
                'capacity_mw':      None,
                'event_date':       published or date.today().isoformat(),
                'confidence':       'Low',
                'source_url':       entry.get('link'),
                'liability_tags':   tags,
                '_source_feed':     feed_cfg['name'],   # used for source_id resolution
            })
            matched += 1
        log.info(f'     matched {matched}/{len(parsed.entries[:200])} entries')

    log.info(f'Trade-press total: {len(rows)} rows across {len(FEEDS)} feeds')
    return rows


def ensure_source_id(client, name: str) -> str | None:
    res = client.table('watch_sources').select('id').eq('name', name).limit(1).execute()
    if res.data:
        return res.data[0]['id']
    ins = client.table('watch_sources').insert({
        'name': name,
        'source_type': 'trade press',
    }).execute()
    return (ins.data or [{}])[0].get('id')


def upsert_watch_events(client, rows: list[dict]) -> int:
    if not rows:
        return 0
    source_cache: dict[str, str] = {}
    for r in rows:
        feed = r.pop('_source_feed', None)
        if feed:
            if feed not in source_cache:
                source_cache[feed] = ensure_source_id(client, feed) or ''
            r['source_id'] = source_cache[feed] or None
        # Stable synthetic ID for upsert dedup
        sig = f"{(r.get('source_url') or r['headline'])}".encode('utf-8')
        r['airtable_record_id'] = f'TP:{abs(hash(sig)) % 10**12}'

    # Batch upsert
    BATCH = 200
    total = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i+BATCH]
        client.table('watch_events').upsert(chunk, on_conflict='airtable_record_id').execute()
        total += len(chunk)
    return total


def log_run(client, status: str, written: int, error: str | None = None):
    client.table('ingestion_runs').insert({
        'pipeline':           PIPELINE,
        'status':             status,
        'started_at':         f'{date.today()}T00:00:00Z',
        'finished_at':        f'{date.today()}T00:00:01Z',
        'records_written':    written,
        'source_attribution': 'reNEWS, WindEurope, Recharge News, Wind Power Monthly, Windbranche.de, PV Magazine, Energy Voice (RSS)',
        'notes':              'Trade-press signal monitor — confidence Low, manual review required before promotion',
        'error_message':      error,
    }).execute()


def run(days: int = 14):
    log.info(f'=== ingest_trade_press starting ({days}-day window) ===')
    client = get_supabase_client()
    rows = fetch_feeds(days)
    try:
        n = upsert_watch_events(client, rows)
        log_run(client, 'success', n)
        log.info(f'=== complete: {n} trade-press signals upserted ===')
    except Exception as e:
        log.exception('ingest_trade_press failed')
        log_run(client, 'failure', 0, str(e))
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--days', type=int, default=14)
    args = parser.parse_args()
    run(args.days)
