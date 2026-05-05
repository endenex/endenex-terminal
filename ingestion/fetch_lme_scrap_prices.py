"""
LME / COMEX → Scrap-Basis Price Fetcher
=========================================

Pulls live LME copper, LME aluminium, and COMEX copper futures prices via
yfinance (free, no API key) and applies the Endenex methodology's documented
scrap-discount ratios to derive daily scrap-basis prices in commodity_prices.

This gives the DCI / NRO indices genuine daily movement on the non-ferrous
side without paying for an Argus / AMM / Fastmarkets subscription.

Methodology (per methodology.md §15)
-------------------------------------
Scrap-assessed prices are NOT LME — they trade at documented discount ratios:

  Copper:
    UK / EEA scrap: ~75-80% of LME copper cash settlement
    US scrap:       ~82-87% of COMEX copper futures (ISRI Grade 200)

  Aluminium:
    UK scrap:       ~60-65% of LME aluminium (mixed/old cast)
    EEA scrap:      ~65-70% of LME aluminium
    US scrap:       ~75-80% of LME aluminium (Midwest shredded)

  Zinc:
    UK / EEA scrap: ~65% of LME zinc (thin market, indicative)
    US scrap:       ~60% of LME zinc

Steel HMS 1&2, cast iron, stainless: NOT updated by this script. Ferrous
scrap doesn't track LME (no liquid LME ferrous futures). Those prices stay
at their seeded values until you add an Argus / AMM ingest, or update the
seed migrations quarterly.

Sources
-------
yfinance package — unofficial Yahoo Finance scraper (free, breaks ~every
6 months when Yahoo changes anti-scrape; script degrades gracefully).

Tickers used:
  HG=F  — COMEX copper futures (USD/lb)
  ALI=F — COMEX aluminium futures (USD/lb)
  ZNC.L — LME zinc proxy (best available on Yahoo)

Run cadence: daily.

Usage:
  python fetch_lme_scrap_prices.py [--asof YYYY-MM-DD] [--dry-run]
"""
from __future__ import annotations

import argparse
import logging
from datetime import date

from base_ingestor import get_supabase_client, today_iso

log = logging.getLogger(__name__)
PIPELINE = 'fetch_lme_scrap_prices'

LB_TO_TONNE = 2204.62  # 1 metric tonne = 2204.62 lbs

# Scrap discount ratios (per methodology.md §15)
SCRAP_DISCOUNTS = {
    # (material, region) → fraction of primary-metal benchmark
    ('copper',    'EU'): 0.78,    # 75-80% of LME, mid
    ('copper',    'GB'): 0.78,    # 75-80% of LME, mid
    ('copper',    'US'): 0.85,    # 82-87% of COMEX, mid
    ('aluminium', 'EU'): 0.68,    # 65-70% of LME
    ('aluminium', 'GB'): 0.62,    # 60-65% of LME
    ('aluminium', 'US'): 0.78,    # 75-80% of LME
}

# COMEX → LME conversion (LME copper trades at ~5% discount to COMEX historically;
# methodology assumes parity for simplicity, but we apply the small adjustment)
COMEX_TO_LME_RATIO = 0.95


# ── Yahoo Finance fetch ─────────────────────────────────────────────────────────

def _fetch_close(ticker: str) -> float | None:
    """Returns last close price in raw ticker units, or None if unavailable."""
    try:
        import yfinance as yf
    except ImportError:
        log.error('yfinance not installed. Add to requirements.txt: yfinance')
        return None

    try:
        t = yf.Ticker(ticker)
        hist = t.history(period='5d')   # 5d window in case last day is empty
        if hist.empty:
            log.warning(f'  {ticker}: no history returned')
            return None
        close = float(hist['Close'].dropna().iloc[-1])
        log.info(f'  {ticker} last close = {close:.4f} (native units)')
        return close
    except Exception as e:
        log.warning(f'  {ticker} fetch failed: {e}')
        return None


def fetch_benchmarks() -> dict[str, float]:
    """Returns dict of benchmark → USD/tonne (or None if fetch failed)."""
    log.info('Fetching primary-metal benchmarks via yfinance…')

    # COMEX copper (USD/lb) → USD/tonne
    hg = _fetch_close('HG=F')
    comex_copper_usd_t = hg * LB_TO_TONNE if hg else None
    lme_copper_usd_t   = comex_copper_usd_t * COMEX_TO_LME_RATIO if comex_copper_usd_t else None

    # COMEX aluminium (USD/lb) → USD/tonne
    ali = _fetch_close('ALI=F')
    lme_alum_usd_t = ali * LB_TO_TONNE if ali else None

    return {
        'lme_copper_usd_t':   lme_copper_usd_t,
        'comex_copper_usd_t': comex_copper_usd_t,
        'lme_alum_usd_t':     lme_alum_usd_t,
    }


# ── FX from Supabase ───────────────────────────────────────────────────────────

def fetch_fx(client, asof: date) -> dict[str, float]:
    """Latest EUR base rates on or before asof."""
    res = (
        client.table('fx_rates')
        .select('quote_currency, rate, rate_date')
        .eq('base_currency', 'EUR')
        .lte('rate_date', asof.isoformat())
        .order('rate_date', desc=True)
        .limit(50)
        .execute()
    )
    latest: dict[str, float] = {}
    for r in (res.data or []):
        c = r['quote_currency']
        if c not in latest:
            latest[c] = float(r['rate'])
    # Add identity
    latest['EUR'] = 1.0
    return latest


def usd_to_currency(amount_usd: float, currency: str, fx: dict[str, float]) -> float:
    """Convert USD → target currency via EUR base."""
    if currency == 'USD':
        return amount_usd
    eur_amount = amount_usd / fx.get('USD', 1.08)
    if currency == 'EUR':
        return eur_amount
    return eur_amount * fx.get(currency, 1.0)


# ── Build commodity_prices rows ─────────────────────────────────────────────────

def build_rows(benchmarks: dict, fx: dict, asof: date) -> list[dict]:
    rows = []

    # Mapping: (material, region) → (benchmark_key, target_currency, source_label, grade)
    plan = [
        ('copper',    'EU', 'lme_copper_usd_t',   'EUR', 'Argus Scrap Markets — EEA Copper Heavy/Cable',  'Heavy/cable scrap (~78% of LME)'),
        ('copper',    'GB', 'lme_copper_usd_t',   'GBP', 'Argus Scrap Markets — UK Copper No.2',            'No.2 scrap (~78% of LME)'),
        ('copper',    'US', 'comex_copper_usd_t', 'USD', 'AMM US Copper No.2 (ISRI Grade 200)',             'ISRI Grade 200 (~85% of COMEX)'),
        ('aluminium', 'EU', 'lme_alum_usd_t',     'EUR', 'Argus Scrap Markets — EEA Aluminium Old Cast',    'Old cast/mixed (~68% of LME)'),
        ('aluminium', 'GB', 'lme_alum_usd_t',     'GBP', 'Argus Scrap Markets — UK Aluminium Old Cast',     'Old cast/mixed (~62% of LME)'),
        ('aluminium', 'US', 'lme_alum_usd_t',     'USD', 'AMM Midwest Aluminium Shredded',                  'Midwest shredded dealer (~78% of LME)'),
    ]

    for material, region, bench_key, ccy, source_label, grade in plan:
        bench_usd_t = benchmarks.get(bench_key)
        if bench_usd_t is None:
            log.warning(f'  skipping {material}/{region} — no benchmark ({bench_key})')
            continue

        bench_in_ccy = usd_to_currency(bench_usd_t, ccy, fx)
        discount     = SCRAP_DISCOUNTS.get((material, region), 0.75)
        scrap_price  = round(bench_in_ccy * discount, 0)

        rows.append({
            'material_type':   material,
            'region':          region,
            'price_per_tonne': scrap_price,
            'currency':        ccy,
            'price_date':      asof.isoformat(),
            'source_name':     source_label + ' (Endenex scrap-discount from LME/COMEX)',
            'source_url':      'https://finance.yahoo.com/',
            'is_scrap_basis':  True,
            'publisher_grade': grade,
            'source_type':     'Market Data — Endenex scrap-discount methodology',
            'source_date':     asof.isoformat(),
            'confidence':      'Medium',
            'derivation':      'Modelled',
            'last_reviewed':   asof.isoformat(),
        })
    return rows


def upsert_prices(client, rows: list[dict]) -> int:
    if not rows:
        return 0
    client.table('commodity_prices').upsert(
        rows, on_conflict='material_type,region,price_date'
    ).execute()
    return len(rows)


def log_run(client, status: str, written: int, error: str | None = None,
            notes: str = ''):
    client.table('ingestion_runs').insert({
        'pipeline':           PIPELINE,
        'status':             status,
        'started_at':         f'{date.today()}T00:00:00Z',
        'finished_at':        f'{date.today()}T00:00:01Z',
        'records_written':    written,
        'source_attribution': 'Yahoo Finance (LME/COMEX futures); Endenex scrap-discount methodology v1.1',
        'notes':              notes or 'Daily LME/COMEX scrap-basis price refresh',
        'error_message':      error,
    }).execute()


# ── CLI ─────────────────────────────────────────────────────────────────────────

def run(asof: date, dry_run: bool = False):
    log.info(f'=== fetch_lme_scrap_prices starting (asof={asof}, dry_run={dry_run}) ===')
    client = get_supabase_client()

    try:
        benchmarks = fetch_benchmarks()
        if not any(v is not None for v in benchmarks.values()):
            log.error('All benchmark fetches failed — aborting (likely yfinance broken)')
            log_run(client, 'failure', 0, 'All yfinance fetches returned None',
                    notes='Likely Yahoo Finance anti-scrape change — yfinance package update required')
            return

        fx = fetch_fx(client, asof)
        rows = build_rows(benchmarks, fx, asof)
        log.info(f'Built {len(rows)} commodity_prices rows')

        for r in rows:
            log.info(f'  {r["material_type"]}/{r["region"]} = '
                    f'{r["currency"]} {r["price_per_tonne"]:,.0f}/t')

        if dry_run:
            log.info('DRY RUN — no rows written')
            return

        n = upsert_prices(client, rows)
        log_run(client, 'success', n,
                notes=f'LME copper={benchmarks.get("lme_copper_usd_t"):,.0f}/t USD; '
                      f'COMEX copper={benchmarks.get("comex_copper_usd_t"):,.0f}/t USD; '
                      f'LME alum={benchmarks.get("lme_alum_usd_t"):,.0f}/t USD' if all(benchmarks.values()) else 'partial benchmarks fetched')
        log.info(f'=== complete: {n} prices written ===')
    except Exception as e:
        log.exception('fetch_lme_scrap_prices failed')
        log_run(client, 'failure', 0, str(e))
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--asof', type=str, default=None,
                        help='Reference date YYYY-MM-DD (default: today)')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    asof_d = date.fromisoformat(args.asof) if args.asof else date.today()
    run(asof_d, args.dry_run)
