"""
NRO Compute Pipeline — Net Recovery Offset per material × region (v1.1)

Methodology v1.1
----------------
For each material × region × reference_date, compute the operator-net recovery
per tonne and per MW, applying the three-layer recovery model:

  net_per_tonne = scrap_price × metallurgical_rate × contamination_yield × (1 − broker_margin)
  net_per_mw    = net_per_tonne × LCA_volume_per_mw

Three layers:
  1. Metallurgical recovery (physics yield from smelter)         — metallurgical_recovery_rates
  2. Merchant contamination yield (haul-to-sold mass)            — merchant_contamination_yields
  3. Broker margin (what owner actually receives vs broker price) — broker_margins

Confidence range:
  low  → broker margin × 1.2 (worst-case operator)
  mid  → broker margin × 1.0
  high → broker margin × 0.8 (best-case operator)

Cadence: weekly (or after any commodity_prices / merchant data refresh).

Usage:
    python compute_nro.py [--asof YYYY-MM-DD] [--backfill 13]
"""
from __future__ import annotations

import argparse
import logging
from datetime import date

from dateutil.relativedelta import relativedelta

from base_ingestor import get_supabase_client, today_iso

log = logging.getLogger(__name__)
PIPELINE = 'compute_nro'

# Granular commodity material → website-taxonomy LCA material
LCA_MAP = {
    'steel_hms1':       'steel',
    'steel_hms2':       'steel',
    'steel_stainless':  'steel',
    'steel_cast_iron':  'castiron',
    'copper':           'copper',
    'aluminium':        'aluminium',
    'rare_earth':       'rareearth',
}

GRANULAR_MATERIALS = list(LCA_MAP.keys())
REGIONS = ['EU', 'GB', 'US']
REGION_CURRENCY = {'EU': 'EUR', 'GB': 'GBP', 'US': 'USD'}

REFERENCE_VINTAGE = 'y2010'
REFERENCE_SCOPE   = 'full'


# ── Lookups ─────────────────────────────────────────────────────────────────────

def latest_price(client, material: str, region: str, asof: date):
    res = client.table('commodity_prices') \
        .select('price_per_tonne, currency, price_date, source_name, confidence') \
        .eq('material_type', material).eq('region', region) \
        .eq('is_scrap_basis', True) \
        .lte('price_date', asof.isoformat()) \
        .order('price_date', desc=True).limit(1).execute()
    return res.data[0] if res.data else None


def metallurgical_rate(client, lca_material: str) -> float:
    res = client.table('metallurgical_recovery_rates').select('rate') \
        .eq('material', lca_material).limit(1).execute()
    return float(res.data[0]['rate']) if res.data else 0.0


def contamination_yield(client, lca_material: str) -> float:
    if lca_material in ('steel', 'castiron'):
        cls = 'ferrous'
    elif lca_material == 'rareearth':
        cls = 'rare_earth'
    else:
        cls = 'non_ferrous'
    res = client.table('merchant_contamination_yields').select('yield_rate') \
        .eq('region', 'GLOBAL').eq('material_class', cls).limit(1).execute()
    return float(res.data[0]['yield_rate']) if res.data else 1.0


def broker_margin(client, region: str) -> float:
    res = client.table('broker_margins').select('margin_default') \
        .eq('region', region).limit(1).execute()
    return float(res.data[0]['margin_default']) if res.data else 0.30


def lca_volume(client, lca_material: str) -> float:
    res = client.table('wind_material_intensities').select('volume_per_mw') \
        .eq('vintage', REFERENCE_VINTAGE).eq('scope', REFERENCE_SCOPE) \
        .eq('material', lca_material).limit(1).execute()
    return float(res.data[0]['volume_per_mw'] or 0.0) if res.data else 0.0


# ── Compute one row ─────────────────────────────────────────────────────────────

def compute_one(client, granular_material: str, region: str, asof: date) -> dict | None:
    price = latest_price(client, granular_material, region, asof)
    if not price:
        return None

    p = float(price['price_per_tonne'])
    currency = price['currency']
    confidence = price.get('confidence', 'Medium')

    lca_mat = LCA_MAP[granular_material]
    met     = metallurgical_rate(client, lca_mat)
    contam  = contamination_yield(client, lca_mat)
    broker  = broker_margin(client, region)
    vol     = lca_volume(client, lca_mat)

    net_per_t_mid  = p * met * contam * (1 - broker)
    net_per_t_low  = p * met * contam * (1 - min(broker * 1.2, 1.0))
    net_per_t_high = p * met * contam * (1 - max(broker * 0.8, 0.0))

    return {
        'material_type':      granular_material,
        'region':             region,
        'currency':           currency,
        'reference_date':     asof.isoformat(),
        'net_per_tonne_low':  round(net_per_t_low,  2),
        'net_per_tonne_mid':  round(net_per_t_mid,  2),
        'net_per_tonne_high': round(net_per_t_high, 2),
        'net_per_mw_low':     round(net_per_t_low  * vol, 2) if vol > 0 else None,
        'net_per_mw_mid':     round(net_per_t_mid  * vol, 2) if vol > 0 else None,
        'net_per_mw_high':    round(net_per_t_high * vol, 2) if vol > 0 else None,
        'source_type':        'Endenex Recovery Model v1.1',
        'source_date':        today_iso(),
        'confidence':         confidence,
        'derivation':         'Modelled',
        'last_reviewed':      today_iso(),
    }


def upsert_nro(client, rows: list[dict]) -> int:
    if not rows:
        return 0
    client.table('nro_estimates').upsert(rows, on_conflict='material_type,region,reference_date').execute()
    return len(rows)


def log_run(client, status: str, asof: date, written: int, error: str | None = None):
    client.table('ingestion_runs').insert({
        'pipeline':           PIPELINE,
        'status':             status,
        'started_at':         f'{date.today()}T00:00:00Z',
        'finished_at':        f'{date.today()}T00:00:01Z',
        'records_written':    written,
        'source_attribution': 'Argus / AMM / Fastmarkets (scrap); OEM LCAs (volumes); merchant direct (markups); v1.1 three-layer recovery',
        'notes':              f'asof={asof.isoformat()}',
        'error_message':      error,
    }).execute()


def run(asof: date, backfill_months: int = 0):
    log.info(f'=== compute_nro v1.1 starting (asof={asof}, backfill={backfill_months}) ===')
    client = get_supabase_client()

    dates = [asof - relativedelta(months=m) for m in range(backfill_months + 1)] if backfill_months > 0 else [asof]

    total_written = 0
    try:
        for d in dates:
            rows = []
            for mat in GRANULAR_MATERIALS:
                for reg in REGIONS:
                    r = compute_one(client, mat, reg, d)
                    if r:
                        rows.append(r)
            n = upsert_nro(client, rows)
            log.info(f'  [{d.isoformat()}] upserted {n} NRO rows')
            total_written += n
        log_run(client, 'success', asof, total_written)
        log.info(f'=== compute_nro complete: {total_written} rows ===')
    except Exception as e:
        log.exception('compute_nro failed')
        log_run(client, 'failure', asof, total_written, str(e))
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--asof', type=str, default=None)
    parser.add_argument('--backfill', type=int, default=0)
    args = parser.parse_args()
    asof_d = date.fromisoformat(args.asof) if args.asof else date.today()
    run(asof_d, args.backfill)
