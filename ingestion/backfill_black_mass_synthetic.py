#!/usr/bin/env python3
"""
Synthetic black-mass payable backfill — derives monthly $/t history from the
underlying contained-metal price series (LME Ni + Co for NMC; lithium
carbonate spot for LFP). No free time-series exists for black mass itself
(Mysteel/BMI/Argus/Fastmarkets all paywalled), so we model it.

Methodology (consistent with public BMI / Fastmarkets / Argus payable
indicator definitions):

  NMC 622 black mass payable ($/t) =
        Ni_payable_pct × Ni_LME ($/t) × Ni_content_kg/t / 1000
      + Co_payable_pct × Co_LME ($/t) × Co_content_kg/t / 1000
      + Li_payable_pct × LCE_spot ($/t) × Li_content_kg/t / 1000

  LFP black mass payable ($/t) =
        Li_payable_pct × LCE_spot ($/t) × Li_content_kg/t / 1000
      − processing_cost ($/t)        # LFP processing is more costly than NMC

Default coefficients (anchored to public BMI/Fastmarkets indicator
methodologies, mid-2024):
  Ni payable  = 60% of LME Ni
  Co payable  = 60% of LME Co
  Li payable  = 35% of Li carbonate spot
  Ni content  = 100 kg/t (NMC 622 typical)
  Co content  =  50 kg/t (NMC 622 typical)
  Li content  =  30 kg/t Li2CO3-equivalent (NMC); 25 kg/t (LFP)
  LFP processing cost = $1,500/t (Asia gate fee context dependent)

Sources:
  Ni LME monthly  → FRED PNICKUSDM (IMF/WB Global Nickel $/mt monthly)
  Co LME monthly  → no free FRED/IMF mirror; curated reference table
                    (LME official monthly mid, approximate). Coverage 2021-01 → 2026-05.
  Li carbonate    → no free time series; curated reference table built
                    from public news mentions, linearly interpolated.
                    Coverage: 2021-01 → 2026-05.

Confidence flag = low (modelled from components, not a transacted print).

Result: black_mass_nmc/ASIA and black_mass_lfp/ASIA monthly history rows
in scrap_price_benchmarks. Renders as a continuous curve in the Historical
Prices panel; weekly press extraction will overlay real prints when found.

Usage:
  python3 backfill_black_mass_synthetic.py --years 5 --dry-run
  python3 backfill_black_mass_synthetic.py --years 5
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from io import StringIO

import requests

from base_ingestor import get_supabase_client, log


FRED_CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}'

# ── Cobalt LME monthly reference (no free FRED/IMF mirror)
# Anchor points; missing months linearly interpolated. USD/tonne, LME
# official cash mid. Sources: LME public press, Reuters cobalt coverage.
CO_REFERENCES: dict[str, float] = {
    '2021-01': 33000,
    '2021-06': 49000,
    '2021-12': 70000,
    '2022-03': 80000,    # cycle peak
    '2022-06': 72000,
    '2022-09': 52000,
    '2022-12': 51000,
    '2023-03': 38000,
    '2023-06': 33000,
    '2023-09': 33000,
    '2023-12': 30000,
    '2024-03': 28000,
    '2024-06': 27000,
    '2024-09': 24000,
    '2024-12': 23500,
    '2025-03': 24000,
    '2025-06': 28000,
    '2025-09': 31000,
    '2025-12': 33000,
    '2026-03': 34000,
    '2026-05': 33000,
}

# ── Lithium carbonate spot history (manually curated from public news)
# Anchor points; missing months linearly interpolated. Values in USD/tonne
# Li carbonate equivalent (LCE), CIF/spot China benchmark.
# Sources: BMI updates, SMM headlines, Reuters/Bloomberg public pieces.
LCE_REFERENCES: dict[str, float] = {
    '2021-01': 9000,
    '2021-06': 14000,
    '2021-12': 30000,
    '2022-03': 70000,
    '2022-06': 70000,
    '2022-09': 75000,
    '2022-11': 85000,    # cycle peak
    '2023-03': 50000,
    '2023-06': 35000,
    '2023-09': 25000,
    '2023-12': 14500,
    '2024-03': 13500,
    '2024-06': 13000,
    '2024-09': 11000,
    '2024-12': 10500,
    '2025-03': 12000,
    '2025-06': 14500,
    '2025-09': 17000,
    '2025-12': 20000,
    '2026-03': 23000,
    '2026-05': 24000,
}

# ── Coefficients ────────────────────────────────────────────────────────
NMC = {
    'ni_payable_pct': 0.60,
    'co_payable_pct': 0.60,
    'li_payable_pct': 0.35,
    'ni_content_kg_t': 100,
    'co_content_kg_t': 50,
    'li_content_kg_t': 30,    # LCE-equivalent
    'processing_cost': 0,     # negligible at typical NMC payable terms
    'anchor_target_usd_t': None,   # if None, use raw model; else scale to match
}
LFP = {
    'ni_payable_pct': 0,
    'co_payable_pct': 0,
    'li_payable_pct': 0.35,
    'ni_content_kg_t': 0,
    'co_content_kg_t': 0,
    'li_content_kg_t': 25,    # LCE-equivalent
    'processing_cost': 1500,  # LFP recovery is cost-heavier
    'anchor_target_usd_t': None,
}

BATCH = 500


def fetch_fred(series_id: str) -> dict[str, float]:
    """Returns {YYYY-MM-01: value} from FRED CSV."""
    r = requests.get(FRED_CSV_URL.format(series_id=series_id), timeout=60,
                     headers={'User-Agent': 'endenex-terminal/1.0'})
    r.raise_for_status()
    out: dict[str, float] = {}
    for line in StringIO(r.text):
        parts = line.strip().split(',')
        if len(parts) < 2:
            continue
        d, v = parts[0], parts[1]
        try:
            out[d] = float(v)
        except ValueError:
            continue
    return out


def interpolate_monthly(refs: dict[str, float]) -> dict[str, float]:
    """Linearly interpolate a {YYYY-MM: value} reference table to a full monthly series."""
    keys = sorted(refs.keys())
    if not keys:
        return {}
    from datetime import datetime
    start = datetime.strptime(keys[0], '%Y-%m')
    end = datetime.strptime(keys[-1], '%Y-%m')
    months: list[str] = []
    cur = start
    while cur <= end:
        months.append(cur.strftime('%Y-%m'))
        cur = cur.replace(year=cur.year + 1, month=1) if cur.month == 12 \
              else cur.replace(month=cur.month + 1)

    out: dict[str, float] = {}
    for m in months:
        if m in refs:
            out[m] = refs[m]
            continue
        before = max((k for k in keys if k <= m), default=None)
        after  = min((k for k in keys if k >= m), default=None)
        if before is None or after is None:
            out[m] = refs[before or after]   # type: ignore
            continue
        if before == after:
            out[m] = refs[before]
            continue
        b_dt = datetime.strptime(before, '%Y-%m')
        a_dt = datetime.strptime(after, '%Y-%m')
        m_dt = datetime.strptime(m, '%Y-%m')
        total = (a_dt.year - b_dt.year) * 12 + (a_dt.month - b_dt.month)
        offset = (m_dt.year - b_dt.year) * 12 + (m_dt.month - b_dt.month)
        frac = offset / total if total else 0
        out[m] = refs[before] + frac * (refs[after] - refs[before])
    return out


def model_payable(coef: dict, ni_t: float, co_t: float, lce_t: float) -> float:
    """Synthetic payable $/t given component prices ($/tonne)."""
    ni_rev = coef['ni_payable_pct'] * ni_t  * coef['ni_content_kg_t'] / 1000
    co_rev = coef['co_payable_pct'] * co_t  * coef['co_content_kg_t'] / 1000
    li_rev = coef['li_payable_pct'] * lce_t * coef['li_content_kg_t'] / 1000
    return max(0, ni_rev + co_rev + li_rev - coef['processing_cost'])


def build_rows(material: str, coef: dict, ni_hist: dict[str, float],
               co_hist: dict[str, float], li_hist: dict[str, float],
               anchor_price: float, anchor_date: str, cutoff: str) -> list[dict]:
    """Generate monthly synthetic rows + scale to match anchor on its date."""
    # Raw modelled price at the anchor's date (use closest available month)
    def closest(d: dict[str, float], target: str) -> float | None:
        prefix = target[:7]
        if prefix in d: return d[prefix]
        # fall back to last available
        keys = sorted([k for k in d.keys() if k <= target])
        if keys: return d[keys[-1]]
        return None

    ni_at_anchor  = closest(ni_hist, anchor_date)
    co_at_anchor  = closest(co_hist, anchor_date)
    lce_at_anchor = closest(li_hist, anchor_date[:7])
    if ni_at_anchor is None or co_at_anchor is None or lce_at_anchor is None:
        log.warning(f'  cannot find component prices at anchor date {anchor_date} for {material}')
        return []

    raw_at_anchor = model_payable(coef, ni_at_anchor, co_at_anchor, lce_at_anchor)
    if raw_at_anchor <= 0:
        log.warning(f'  raw model produces non-positive value at anchor for {material}; skipping')
        return []
    scale = anchor_price / raw_at_anchor
    log.info(f'  {material}: raw model ${raw_at_anchor:.0f}/t at anchor → scale ×{scale:.4f} to match anchor ${anchor_price:.0f}/t')

    rows: list[dict] = []
    # Iterate months between cutoff and anchor (exclusive of anchor date)
    for m, lce in sorted(li_hist.items()):
        d = f'{m}-01'
        if d < cutoff or d >= anchor_date:
            continue
        ni = ni_hist.get(m)
        co = co_hist.get(m)
        if ni is None or co is None:
            continue
        raw = model_payable(coef, ni, co, lce)
        modelled = round(raw * scale, 2)
        rows.append({
            'material':         material,
            'region':           'ASIA',
            'publisher':        'manual',
            'benchmark_name':   f'{material} synthetic (Ni+Co LME + Li carb spot)',
            'price':            modelled,
            'unit':             'USD/t',
            'price_date':       d,
            'period_type':      'monthly',
            'source_url':       'https://fred.stlouisfed.org/series/PNICKUSDM',
            'ingestion_method': 'rpc_compute',
            'confidence':       'low',
            'notes':            (
                f'Synthetic payable derived from Ni LME ({ni:.0f}/t) + Co LME '
                f'({co:.0f}/t) + Li carbonate spot ({lce:.0f}/t LCE), with '
                f'payable percentages (Ni {coef["ni_payable_pct"]*100:.0f}%, '
                f'Co {coef["co_payable_pct"]*100:.0f}%, Li {coef["li_payable_pct"]*100:.0f}%) '
                f'and contents (Ni {coef["ni_content_kg_t"]} kg/t, Co {coef["co_content_kg_t"]} kg/t, '
                f'Li {coef["li_content_kg_t"]} kg/t LCE). Scale factor {scale:.3f} to match '
                f'anchor ${anchor_price:.0f}/t at {anchor_date}.'
            ),
        })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--years',   type=int, default=5)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    client = get_supabase_client()
    today  = date.today().isoformat()
    cutoff = (date.today() - timedelta(days=args.years * 365)).isoformat()
    log.info(f'=== black mass synthetic backfill · {args.years}y · cutoff {cutoff} ===')

    log.info('  fetching FRED PNICKUSDM (Ni LME monthly)…')
    ni_hist = {k[:7]: v for k, v in fetch_fred('PNICKUSDM').items()}
    log.info(f'    {len(ni_hist)} monthly Ni rows')

    log.info('  building Co LME interpolated history (no free FRED mirror)…')
    co_hist = interpolate_monthly(CO_REFERENCES)
    log.info(f'    {len(co_hist)} monthly Co rows ({sorted(co_hist.keys())[0]} → {sorted(co_hist.keys())[-1]})')

    log.info('  building Li carbonate (LCE) interpolated history…')
    lce_hist = interpolate_monthly(LCE_REFERENCES)
    log.info(f'    {len(lce_hist)} monthly LCE rows ({sorted(lce_hist.keys())[0]} → {sorted(lce_hist.keys())[-1]})')

    if not (ni_hist and co_hist and lce_hist):
        log.error('  missing one or more component series — abort')
        sys.exit(1)

    # Anchors (existing rows in scrap_price_benchmarks)
    def anchor_for(mat: str) -> dict | None:
        res = client.table('scrap_price_benchmarks') \
            .select('material, region, publisher, price, unit, price_date') \
            .eq('material', mat).eq('region', 'ASIA') \
            .neq('ingestion_method', 'rpc_compute') \
            .order('price_date', desc=True).limit(1).execute()
        return res.data[0] if res.data else None

    rows: list[dict] = []
    for mat, coef in [('black_mass_nmc', NMC), ('black_mass_lfp', LFP)]:
        anchor = anchor_for(mat)
        if anchor is None:
            log.warning(f'  no anchor for {mat}/ASIA — skip')
            continue
        log.info(f'  anchor {mat}: ${float(anchor["price"]):.2f}/t @ {anchor["price_date"]} ({anchor["publisher"]})')
        rows += build_rows(mat, coef, ni_hist, co_hist, lce_hist,
                           float(anchor['price']), anchor['price_date'], cutoff)

    log.info(f'  prepared {len(rows)} synthetic monthly rows')
    if args.dry_run:
        log.info('=== dry-run: nothing inserted ===')
        return

    inserted = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        client.table('scrap_price_benchmarks').upsert(
            chunk,
            on_conflict='material,region,publisher,benchmark_name,price_date,period_type',
        ).execute()
        inserted += len(chunk)

    client.table('ingestion_runs').insert({
        'pipeline':           'backfill_black_mass_synthetic',
        'status':             'success',
        'started_at':         f'{today}T00:00:00Z',
        'finished_at':        f'{today}T00:00:00Z',
        'records_written':    inserted,
        'source_attribution': 'Synthetic — FRED Ni + Co + manual LCE reference table',
        'notes':              f'Synthetic black mass · {args.years}y · {inserted} rows for NMC + LFP / ASIA.',
    }).execute()
    log.info(f'=== complete: {inserted} rows inserted ===')


if __name__ == '__main__':
    main()
