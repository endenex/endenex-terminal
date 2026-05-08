#!/usr/bin/env python3
"""
Backfill 5-year LME refined-metal history into commodity_prices.

The existing fetch_lme_scrap_prices.py only pulls the latest close (period='5d',
last value), producing daily one-row updates. For the Historical Prices &
Basis panel we need multi-year daily history.

This script is a one-off backfill — runs once per material to load history.
Daily updates continue via fetch_lme_scrap_prices.py.

Yahoo Finance tickers used:
  HG=F  COMEX copper futures (USD/lb)        → LME copper (USD/t)
  ALI=F COMEX aluminium (USD/lb)             → LME aluminium (USD/t)
  LME-NIK NICKEL (where available)           → if not, derive from headlines
  PA=F  Palladium (proxy)                    [not needed for our use]

We insert with derivation='Observed' to distinguish from the modelled
scrap basis the daily script computes.

Usage:
    python3 backfill_lme_history.py                  # all materials, 5y
    python3 backfill_lme_history.py --years 10       # 10y instead
    python3 backfill_lme_history.py --material copper
    python3 backfill_lme_history.py --dry-run        # show counts only
"""

from __future__ import annotations

import argparse
import sys
from datetime import date

from base_ingestor import get_supabase_client, log


LB_TO_TONNE = 2204.62

# Yahoo tickers for LME refined metals (refined-metal benchmark prices,
# not scrap). yfinance returns OHLC daily history.
# FRED's IMF mirror series for primary metal prices — kept current monthly,
# delivered via the same authless CSV endpoint as FRED PPI. Replaces direct
# World Bank Pink Sheet downloads (which were stale).
#
# fred_id      → FRED series for primary metal monthly history
# unit_conv    → multiplier to convert raw value to USD/tonne
#                (silver is in USD/troy oz; everything else USD/mt)
TICKERS = {
    'copper':    {'fred_id': 'PCOPPUSDM',    'unit_conv': 1.0,     'note': 'IMF/WB Global Copper $/mt monthly'},
    'aluminium': {'fred_id': 'PALUMUSDM',    'unit_conv': 1.0,     'note': 'IMF/WB Global Aluminum $/mt monthly'},
    'iron_ore':  {'fred_id': 'PIORECRUSDM',  'unit_conv': 1.0,     'note': 'IMF/WB Iron Ore CFR China $/mt monthly (steel input cost proxy)'},
    # Kept commented for future expansion if needed:
    # 'nickel':    {'fred_id': 'PNICKUSDM',    'unit_conv': 1.0,     'note': 'IMF/WB Nickel $/mt'},
    # 'silver':    {'fred_id': 'PSLVUSDQ',     'unit_conv': 32150.7, 'note': 'IMF/WB Silver $/troy oz × 32150.7 oz/t'},
    # 'lead':      {'fred_id': 'PLEADUSDM',    'unit_conv': 1.0,     'note': 'IMF/WB Lead $/mt'},
    # 'zinc':      {'fred_id': 'PZINCUSDM',    'unit_conv': 1.0,     'note': 'IMF/WB Zinc $/mt'},
    # 'tin':       {'fred_id': 'PTINUSDM',     'unit_conv': 1.0,     'note': 'IMF/WB Tin $/mt'},
}

# COMEX → LME ratio (LME copper trades ~5% discount to COMEX historically).
# Use 0.95 to translate. For aluminium the relationship is closer to 1:1.
COMEX_TO_LME = {
    'copper':    0.95,
    'aluminium': 1.00,
    'nickel':    1.00,
    'silver':    1.00,
    'lead':      1.00,
    'zinc':      1.00,
    'tin':       1.00,
}

# Region multipliers — same scrap discount logic as fetch_lme_scrap_prices.py.
# But for raw LME 'Observed' rows we insert ONE row per date as the
# canonical refined price (no regional split). Region label = 'GLOBAL'.

BATCH = 500


FRED_CSV_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}'


def fetch_fred_history(fred_id: str, years: int) -> list[tuple[str, float]]:
    """Return list of (YYYY-MM-DD, value) for the past N years from a FRED series."""
    import io
    import requests
    try:
        import pandas as pd
    except ImportError:
        log.error('pandas required: pip install pandas')
        return []

    log.info(f'  fetching FRED {fred_id} (last {years}y)…')
    url = FRED_CSV_URL.format(series_id=fred_id)
    try:
        r = requests.get(url, timeout=60, headers={'User-Agent': 'endenex-terminal/1.0'})
        r.raise_for_status()
    except Exception as e:
        log.warning(f'    FRED fetch failed: {e}')
        return []

    df = pd.read_csv(io.StringIO(r.text))
    if len(df.columns) < 2:
        log.warning(f'    unexpected CSV shape: {df.columns.tolist()}')
        return []
    date_col = df.columns[0]
    val_col  = df.columns[1]
    df = df[[date_col, val_col]].rename(columns={date_col: 'd', val_col: 'v'})

    cutoff = (date.today() - timedelta(days=years * 365)).isoformat()
    out: list[tuple[str, float]] = []
    for _, row in df.iterrows():
        d = str(row['d']).strip()
        if d < cutoff:
            continue
        try:
            v = float(row['v'])
        except (TypeError, ValueError):
            continue
        if v != v or v <= 0:
            continue
        out.append((d, v))
    if out:
        log.info(f'    {len(out)} monthly rows ({out[0][0]} → {out[-1][0]})')
    else:
        log.warning(f'    no rows after cutoff {cutoff}')
    return out


def to_lme_usd_per_tonne(material: str, raw_value: float) -> float | None:
    """Convert raw ticker units to LME USD/t."""
    cfg = TICKERS[material]
    v = raw_value
    if cfg['lb_to_t']:
        v = v * LB_TO_TONNE
    ratio = COMEX_TO_LME.get(material, 1.0)
    v = v * ratio
    return round(v, 2)


# ── World Bank Pink Sheet fallback ─────────────────────────────────────────
#
# When yfinance is unavailable (Yahoo API issues, delisted tickers, etc.),
# pull primary metal monthly history from the World Bank Pink Sheet — free,
# rock-solid, multi-decade coverage. Excel format, single workbook per
# release.
#
# Pink Sheet URL pattern (live link from World Bank Commodity Markets page):
#   https://thedocs.worldbank.org/en/doc/.../CMO-Historical-Data-Monthly.xlsx
# We use the durable redirector at thedocs.worldbank.org which World Bank
# maintains across publication updates.
#
# Sheet "Monthly Prices" contains:
#   • COPPER (col: Copper $/mt)
#   • ALUMINUM (col: Aluminum $/mt)
#   • NICKEL (col: Nickel $/mt)
#   • IRON ORE
#   • etc.

WB_PINK_SHEET_URL = (
    'https://thedocs.worldbank.org/en/doc/'
    '5d903e848db1d1b83e0ec8f744e55570-0350012021/related/CMO-Historical-Data-Monthly.xlsx'
)

# Substring patterns for the metal columns. WB Pink Sheet labels columns like
# "Copper" / "Aluminum" / "Nickel" (American spelling) and sometimes appends
# units in parentheses. We do case-insensitive substring matching against
# all columns to find the right one.
WB_MATERIAL_PATTERNS = {
    'copper':    ['copper'],
    'aluminium': ['aluminum', 'aluminium'],     # WB uses American spelling
    'nickel':    ['nickel'],
    'silver':    ['silver'],
    'lead':      ['lead'],
    'zinc':      ['zinc'],
    'tin':       ['tin'],
    'iron_ore':  ['iron ore'],
}


def _find_wb_column(columns: list[str], patterns: list[str]) -> str | None:
    """Case-insensitive substring lookup. Returns first matching column name."""
    for col in columns:
        col_lower = str(col).lower()
        for pat in patterns:
            if pat in col_lower:
                # Skip lead/iron/nickel-iron etc. when looking for a clean metal
                # (e.g. "Iron ore, cfr" mustn't match for nickel)
                return col
    return None


def fetch_wb_history(material: str, years: int) -> list[tuple[str, float]]:
    """Fetch monthly price history for a material from World Bank Pink Sheet."""
    import io
    import requests
    try:
        import pandas as pd
    except ImportError:
        log.error('pandas required: pip install pandas')
        return []

    log.info(f'  WB Pink Sheet fallback for {material}…')
    try:
        r = requests.get(WB_PINK_SHEET_URL, timeout=120,
                         headers={'User-Agent': 'endenex-terminal/1.0'})
        r.raise_for_status()
    except Exception as e:
        log.warning(f'    WB Pink Sheet download failed: {e}')
        return []

    try:
        xls = pd.ExcelFile(io.BytesIO(r.content))
        sheet = 'Monthly Prices' if 'Monthly Prices' in xls.sheet_names else xls.sheet_names[0]
        df = pd.read_excel(xls, sheet_name=sheet, header=4)
        first = df.columns[0]
        df = df.rename(columns={first: 'period'})

        patterns = WB_MATERIAL_PATTERNS.get(material, [material])
        col = _find_wb_column([c for c in df.columns if c != 'period'], patterns)
        if col is None:
            cols_preview = [c for c in df.columns if c != 'period'][:30]
            log.warning(f'    WB Pink Sheet: no column matching {patterns}; first 30 columns: {cols_preview}')
            return []
        log.info(f'    matched WB column: "{col}"')
        df = df[['period', col]].dropna()

        # Convert YYYYMmm → YYYY-MM-15 (month midpoint)
        out: list[tuple[str, float]] = []
        cutoff_year = date.today().year - years
        for _, row in df.iterrows():
            p = str(row['period']).strip()
            if 'M' not in p or len(p) < 7:
                continue
            try:
                y, m = p.split('M')
                y_int = int(y)
                m_int = int(m)
                if y_int < cutoff_year:
                    continue
                d = f'{y_int:04d}-{m_int:02d}-15'
                v = float(row[col])
                if v != v:
                    continue
                out.append((d, v))
            except (ValueError, TypeError):
                continue
        log.info(f'    {len(out)} monthly rows from WB Pink Sheet (since {cutoff_year}-01)')
        return out
    except Exception as e:
        log.warning(f'    WB Pink Sheet parse failed: {e}')
        return []


def upsert_batch(client, rows: list[dict]) -> int:
    if not rows:
        return 0
    total = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        client.table('commodity_prices').upsert(
            chunk, on_conflict='material_type,region,price_date'
        ).execute()
        total += len(chunk)
        log.info(f'    upserted {total}/{len(rows)}')
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--material', help='Restrict to one material (copper/aluminium)')
    ap.add_argument('--years',    type=int, default=5)
    ap.add_argument('--dry-run',  action='store_true')
    args = ap.parse_args()

    materials = [args.material] if args.material else list(TICKERS.keys())
    materials = [m for m in materials if m in TICKERS]
    if not materials:
        sys.exit('No matching materials in TICKERS')

    client = get_supabase_client()
    log.info(f'=== LME history backfill · {len(materials)} materials · {args.years}y · {"[DRY RUN]" if args.dry_run else ""} ===')
    today = date.today().isoformat()
    grand_total = 0

    for material in materials:
        cfg = TICKERS[material]
        history = fetch_fred_history(cfg['fred_id'], args.years)
        source_name = f'FRED {cfg["fred_id"]} (IMF/WB primary metal mirror)'
        if not history:
            log.warning(f'  {material}: no data from FRED — skipping')
            continue

        rows = []
        for d, raw in history:
            usd_per_t = round(raw * cfg.get('unit_conv', 1.0), 2)
            rows.append({
                'material_type':   material,
                'region':          'GLOBAL',
                'price_per_tonne': usd_per_t,
                'currency':        'USD',
                'price_date':      d,
                'source_name':     source_name,
                'source_date':     today,
                'confidence':      'High',
                'derivation':      'Observed',
                'last_reviewed':   today,
            })

        log.info(f'  {material}: prepared {len(rows)} rows ({source_name})')
        if args.dry_run:
            grand_total += len(rows)
            continue
        n = upsert_batch(client, rows)
        grand_total += n

    log.info(f'=== complete: {grand_total} total rows {"prepared" if args.dry_run else "upserted"} ===')


if __name__ == '__main__':
    main()
