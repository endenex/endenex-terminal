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

# Keyword classifier with associated event_type. Only decom-relevant signals.
# We deliberately dropped 'Commodity Move' (handled by commodity_prices scraper)
# and weakened 'Policy Update' to require decom-coupled framing — generic FiT
# / subsidy chatter is not a decom signal.
#
# Tag direction is assigned downstream by `_direction_tags()` based on
# event_type + headline-token analysis (see lexicons below). The base
# classifier just returns the event_type — direction is derived from context
# so a "decommissioning" article gets CAP▼+PROV▲ while a "repowering" article
# gets CAP▲, and a recovery-economics article gets REC▲ or REC▼ depending on
# whether the headline talks about prices climbing or falling.
KEYWORD_CLASSIFIERS = [
    (['repower', 'repowering', 'life extension'],            'Repowering Announcement'),
    (['decommission', 'decommissioning', 'dismantl', 'demolition', 'end of life', 'end-of-life'],
                                                             'Decommissioning'),
    (['blade recycl', 'turbine recycl', 'blade landfill', 'blade waste', 'wind blade'],
                                                             'Material Recovery Update'),
    (['decom tender', 'dismantling contract', 'dismantling tender', 'decommissioning tender',
      'decommissioning contract', 'repowering contract', 'repowering tender'],
                                                             'Contractor Awarded'),
    (['administration', 'chapter 11', 'insolvency', 'bankruptcy', 'liquidation', 'receivership'],
                                                             'Insolvency'),
]

# ── Directional lexicons ────────────────────────────────────────────────────
# When the headline carries one of these tokens, the direction is unambiguous.
# If neither up nor down lexicon hits, we fall through to the event_type
# default (e.g. "decommissioning" defaults to CAP▼+PROV▲ because the act of
# decommissioning by definition removes capacity and recognises a provision).

REC_UP_TOKENS = (
    'scrap rally', 'scrap surge', 'scrap climb', 'scrap up', 'scrap higher',
    'steel surge', 'steel rally', 'steel up', 'steel climb', 'steel higher',
    'copper surge', 'copper rally', 'copper up', 'copper higher',
    'metal rally', 'metal surge', 'price gain', 'prices gain', 'price climb',
    'prices climb', 'price rise', 'prices rise', 'price jump', 'prices jump',
    'recovery rate up', 'recycling premium', 'salvage value up',
)

REC_DN_TOKENS = (
    'scrap rout', 'scrap collapse', 'scrap glut', 'scrap fall', 'scrap slip',
    'steel slump', 'steel rout', 'steel fall', 'steel slip',
    'copper slump', 'copper rout', 'copper fall', 'copper slip',
    'metal rout', 'metal slump', 'price fall', 'prices fall', 'price slip',
    'prices slip', 'price drop', 'prices drop', 'price plunge', 'prices plunge',
    'recovery rate down', 'salvage value down', 'oversupply', 'glut of',
)

CAP_UP_TOKENS = (
    'commissioned', 'inaugurated', 'energised', 'energized', 'goes live',
    'comes online', 'online', 'first power', 'fully operational',
    'capacity added', 'expansion', 'extension', 'phase ii', 'phase 2',
    'repower', 'repowered', 'uprated', 'uprate',
)

CAP_DN_TOKENS = (
    'shut down', 'shutdown', 'taken offline', 'retired', 'retirement',
    'mothballed', 'mothball', 'closed', 'closure', 'decommission',
    'dismantl', 'demolition', 'end of life', 'end-of-life',
    'permanent outage', 'fleet retirement',
)

PROV_UP_TOKENS = (
    'provision recognised', 'provision recognized', 'provision booked',
    'provision raised', 'provision increased', 'topped up', 'top-up',
    'aro recognised', 'aro recognized', 'aro increase', 'liability recognised',
    'liability recognized', 'impairment', 'writedown', 'write-down',
    'exceptional charge', 'restructuring charge',
)

PROV_DN_TOKENS = (
    'bond returned', 'bond released', 'bond drawdown',
    'provision settled', 'provision released', 'provision reversal',
    'liability settled', 'liability extinguished',
)


def _has_any(t: str, tokens: tuple[str, ...]) -> bool:
    return any(tok in t for tok in tokens)


def _direction_tags(event_type: str, headline: str, summary: str = '') -> list[str]:
    """
    Decide directional liability tags from event_type + headline language.

    We assign:
      - PROV_UP / PROV_DN — provision recognised vs released
      - REC_UP  / REC_DN  — recovery economics direction (only if explicit)

    We deliberately do NOT assign capacity-direction tags. Every event_type
    already implies a capacity direction (decommissioning ⇒ down, repowering
    ⇒ up); a CAP pill on top would be redundant noise.

    Material Recovery articles with no directional token get NO tag —
    we'd rather drop the pill than guess.
    """
    text = f'{headline} {summary}'.lower()
    tags: list[str] = []

    # Recovery direction — only assigned if explicit
    if event_type == 'Material Recovery Update':
        if _has_any(text, REC_UP_TOKENS):
            tags.append('REC_UP')
        elif _has_any(text, REC_DN_TOKENS):
            tags.append('REC_DN')
        # else: no tag — recovery direction is ambiguous from headline alone
        return tags

    # Provision direction
    if _has_any(text, PROV_DN_TOKENS):
        tags.append('PROV_DN')
    elif _has_any(text, PROV_UP_TOKENS):
        tags.append('PROV_UP')
    elif event_type in ('Decommissioning', 'Insolvency'):
        # By definition both raise the recognised liability
        tags.append('PROV_UP')

    return tags

# Hard-reject: any of these tokens in the headline = drop the row entirely.
# Catches explainer/listicle/how-to formats and content categories that
# never carry decom signal (rooftop solar, domestic, EV charging, tariff
# politics divorced from decom, prosumer / community-owned micro projects).
NEGATIVE_HEADLINE_TOKENS = (
    # Format clickbait — explainers and listicles are not signals
    'how to ', 'why ', 'what is ', 'what are ', 'what does ',
    'guide to ', 'explainer:', 'opinion:', 'comment:', 'analysis:',
    'top 5', 'top 10', '5 ways', '10 ways', '7 things', 'things you',
    'beginner', 'beginners',
    # Off-topic / micro-scale / not utility-scale
    'rooftop', 'domestic solar', 'home solar', 'home battery',
    'low voltage', 'low-voltage', 'lv extension',
    'ev charg', 'electric vehicle char',
    'community-owned micro', 'agri-pv pilot',
    # Pure-policy / political noise without decom hook
    'price cap', 'energy bills', 'household bills', 'cost of living',
    'general election', 'manifesto', 'queen\'s speech', 'kings speech',
    # Forecasts / outlooks (not events)
    'outlook 202', 'forecast 202', 'pipeline grows', 'capacity hits',
)


def _is_explainer_or_offtopic(title: str) -> bool:
    """Hard-reject titles that are explainers, listicles, or off-topic."""
    t = title.lower().strip()
    return any(tok in t for tok in NEGATIVE_HEADLINE_TOKENS)


def _classify(text: str, title: str) -> str | None:
    """Match against decom-relevant keywords only. Reject explainers/off-topic.

    Returns the event_type string. Direction tags are assigned separately
    by `_direction_tags(event_type, headline, summary)`.
    """
    if _is_explainer_or_offtopic(title):
        return None
    t = text.lower()
    # Must mention a renewable asset class. Bare "battery" alone is too noisy
    # (consumer batteries, EV batteries) — require BESS/utility framing.
    asset_hit = any(k in t for k in (
        'wind', 'turbine', 'solar farm', 'solar park', 'solar plant',
        ' pv ', 'photovoltaic', 'utility-scale', 'utility scale',
        'bess', 'grid-scale battery', 'battery storage',
    ))
    if not asset_hit:
        return None
    for keywords, event_type in KEYWORD_CLASSIFIERS:
        if any(kw in t for kw in keywords):
            return event_type
    return None


# ── Cross-source dedup ─────────────────────────────────────────────────────
#
# Two RSS rows about the same event (e.g. the Hagshaw Hill repowering covered
# by reNEWS, Energy Voice, and Wind Power Monthly on the same day) get
# collapsed to one. We hash a (event_type, scope, week, entity-tokens) tuple.
# If two new rows share that signature, only the first is kept; a row that
# matches an already-stored signature is dropped before upsert.
import hashlib

import unicodedata

# Stopwords for proper-noun extraction. We're keeping ONLY capitalised tokens
# (proper nouns) so this list only needs to cover capitalised-but-generic
# words that frequently appear at the start of headlines or as section
# labels — not the broader vocabulary list used previously.
_STOP = {
    # Generic capitalised noise: domain nouns + corporate suffixes
    'wind','solar','farm','farms','project','projects','power','energy','energies',
    'turbine','turbines','blade','blades','battery','storage','park','plant','site',
    'plc','ltd','limited','llc','co','company','corp','corporation','inc','holdings',
    'group','renewables','renewable',
    # Calendar
    'january','february','march','april','may','june','july','august','september',
    'october','november','december','q1','q2','q3','q4','h1','h2',
    # Sentence-start capitalised function words
    'the','a','an','of','for','at','in','on','to','from','with',
    # Frequent capitalised verbs at headline start
    'plans','planned','wins','won','awards','awarded','announces','announced',
    'launches','launched','signs','signed','starts','started','completes','completed',
    'opens','opened','says','said','reports','reported',
}


def _strip_accents(s: str) -> str:
    """'Cádiz' → 'Cadiz', 'Ørsted' → 'Orsted'. Drops combining marks."""
    return ''.join(
        c for c in unicodedata.normalize('NFKD', s)
        if not unicodedata.combining(c)
    )


# Match a single token: letter (Unicode), then more letters/digits/' / -
# Using re.UNICODE so 'Cádiz' is captured. We then accent-strip per token.
_TOKEN_RE = re.compile(r"[^\W\d_][\w'\-]*", re.UNICODE)


def _entity_key(headline: str) -> str:
    """
    Proper-noun token set extracted from the headline.

    A token is kept iff:
      • Its FIRST character is uppercase in the original headline (proper-noun
        heuristic — Statkraft, Cádiz, RWE, NextEra all qualify; verbs and
        articles do not).
      • After accent-stripping + apostrophe-stripping + lowercasing it is
        not in the generic-noise stopword list and is at least 3 chars.

    Returns a sorted space-separated string. Sorted so equivalent token
    sets in different word orders hash to the same value.
    """
    keep: set[str] = set()
    for m in _TOKEN_RE.finditer(headline):
        raw = m.group(0)
        if not raw[0].isupper():
            continue                                  # skip non-capitalised
        norm = _strip_accents(raw).lower()            # cádiz → cadiz
        norm = norm.rstrip("'s").rstrip("'")          # statkraft's → statkraft
        norm = norm.replace("'", '').replace('-', '') # tidy any leftover punct
        if len(norm) < 3 or norm in _STOP:
            continue
        keep.add(norm)
    return ' '.join(sorted(keep))[:160]


def _topic_signature(row: dict) -> str:
    """
    Deterministic signature for cross-source dedup. Uses entity-key only —
    NOT event_type, NOT scope, NOT month-bucket. Two rows about the same
    project should collapse regardless of how the source framed the event
    or when within a 90-day window each source picked it up.
    """
    return hashlib.sha1(_entity_key(row.get('headline','')).encode()).hexdigest()[:16]


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
            event_type = _classify(full, title)
            if not event_type:
                continue
            tags = _direction_tags(event_type, title, summary)

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

    # ── Cross-source dedup, in-batch ──────────────────────────────────────
    # If two RSS rows in the same batch resolve to the same topic_signature,
    # keep the one with the longer summary (more substance), discard others.
    by_sig: dict[str, dict] = {}
    for r in rows:
        sig = _topic_signature(r)
        existing = by_sig.get(sig)
        if existing is None or len(r.get('notes') or '') > len(existing.get('notes') or ''):
            by_sig[sig] = r
    deduped = list(by_sig.values())
    log.info(f'  dedup: {len(rows)} → {len(deduped)} (collapsed {len(rows)-len(deduped)} cross-source duplicates)')

    # ── Cross-source dedup, vs already-stored events ──────────────────────
    # Pull recent topic_signatures from the DB (last 60 days) and skip any
    # incoming row whose signature is already present.
    seen: set[str] = set()
    try:
        recent_cutoff = (date.today() - timedelta(days=90)).isoformat()
        existing = client.table('watch_events').select('topic_signature') \
            .gte('event_date', recent_cutoff).execute()
        seen = {r['topic_signature'] for r in (existing.data or []) if r.get('topic_signature')}
    except Exception as e:
        log.warning(f'  could not preload existing signatures (column may be missing): {e}')

    fresh: list[dict] = []
    for r in deduped:
        feed = r.pop('_source_feed', None)
        if feed:
            if feed not in source_cache:
                source_cache[feed] = ensure_source_id(client, feed) or ''
            r['source_id'] = source_cache[feed] or None

        sig = _topic_signature(r)
        r['topic_signature'] = sig
        # Stable synthetic ID for upsert dedup (per-source URL fingerprint)
        url_sig = f"{(r.get('source_url') or r['headline'])}".encode('utf-8')
        r['airtable_record_id'] = f'TP:{abs(hash(url_sig)) % 10**12}'

        if sig in seen:
            continue   # already covered by an earlier source
        fresh.append(r)
        seen.add(sig)

    log.info(f'  vs existing: {len(deduped)} → {len(fresh)} (skipped {len(deduped)-len(fresh)} already-stored topics)')

    # Batch upsert
    BATCH = 200
    total = 0
    for i in range(0, len(fresh), BATCH):
        chunk = fresh[i:i+BATCH]
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
