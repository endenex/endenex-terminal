"""
DCI Compute Pipeline — Decommissioning Cost Index (v1.1)

Methodology v1.1
----------------
DCI Spot(t) = (Gross Cost(t) − Material Recovery(t) + Disposal Costs(t))
              / Net Liability(base) × 100

Differences from v1.0:
  • LCA volumes from wind_material_intensities (vintage = y2010 reference, scope = full)
  • Three-layer recovery: metallurgical × contamination yield × (1 − broker margin)
  • Gross cost from dci_gross_cost_components (8 work categories that sum to base)
  • Country multipliers (labour/plant/haul/gate composite) applied per series:
      europe_wind → DE multipliers as EEA proxy
      us_wind     → US multipliers
      uk_wind     → GB multipliers (= 1.00 baseline)
  • Scrap-basis prices only (is_scrap_basis = TRUE)

Run cadence: monthly.

Usage:
    python compute_dci.py [--asof YYYY-MM-DD] [--backfill 13] [--no-publish]
"""
from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass
from datetime import date

from dateutil.relativedelta import relativedelta

from base_ingestor import get_supabase_client, today_iso

log = logging.getLogger(__name__)
PIPELINE = 'compute_dci'

# series → (commodity region, output currency, country anchor for multipliers)
SERIES_CONFIG = {
    # Wind series (live in v1.1)
    'dci_wind_europe':         {'region': 'EU', 'currency': 'EUR', 'country_anchor': 'DE'},
    'dci_wind_north_america':  {'region': 'US', 'currency': 'USD', 'country_anchor': 'US'},
    # Solar series — Phase 2, separate methodology required (panel-mass scaling,
    # silver-driven recovery, very different gross-cost rate card). Not computed
    # by this pipeline yet.
}

# Material categories used by dci_publications cost-component columns
FERROUS_LCA   = ['steel', 'castiron']
COPPER_LCA    = ['copper']
ALUMINIUM_LCA = ['aluminium']

# Reference asset vintage for index construction
REFERENCE_VINTAGE = 'y2010'
REFERENCE_SCOPE   = 'full'

# Component weights for composite country multiplier
# Roughly proportional to category cost share in dci_gross_cost_components
WEIGHT_LABOUR = 0.45
WEIGHT_PLANT  = 0.30
WEIGHT_HAUL   = 0.10
WEIGHT_GATE   = 0.15

BASE_NET_LIABILITY_EUR = 78500.0   # v1.1 base net liability (matches migration 011)


# ── Methodology loader ──────────────────────────────────────────────────────────

@dataclass
class Methodology:
    version: str
    base_period_date: date
    base_blade_transport_eur_mw: float
    base_blade_gate_fees_eur_mw: float
    base_scrap_haulage_eur_mw: float
    cost_inflation_pct_yr: float


def load_methodology(client) -> Methodology:
    res = client.table('dci_methodology_versions').select('*') \
        .order('effective_from', desc=True).limit(1).execute()
    if not res.data:
        raise RuntimeError('No DCI methodology version found — run migrations 010–017 first.')
    m = res.data[0]
    return Methodology(
        version=m['version'],
        base_period_date=date.fromisoformat(m['base_period_date']),
        base_blade_transport_eur_mw=float(m['base_blade_transport_eur_mw']),
        base_blade_gate_fees_eur_mw=float(m['base_blade_gate_fees_eur_mw']),
        base_scrap_haulage_eur_mw=float(m['base_scrap_haulage_eur_mw']),
        cost_inflation_pct_yr=float(m['cost_inflation_pct_yr']),
    )


def base_gross_total(client) -> float:
    """Sum of dci_gross_cost_components — the methodology base gross cost in EUR/MW."""
    res = client.table('dci_gross_cost_components').select('base_rate_eur_mw').execute()
    return sum(float(r['base_rate_eur_mw']) for r in (res.data or [])) or 82000.0


def years_since(base: date, asof: date) -> float:
    return (asof - base).days / 365.25


def inflation_factor(meth: Methodology, asof: date) -> float:
    n = years_since(meth.base_period_date, asof)
    return (1 + meth.cost_inflation_pct_yr / 100.0) ** n


# ── FX ──────────────────────────────────────────────────────────────────────────

def fx_eur_to(client, currency: str, asof: date) -> float:
    if currency == 'EUR':
        return 1.0
    res = client.table('fx_rates').select('rate') \
        .eq('base_currency', 'EUR').eq('quote_currency', currency) \
        .lte('rate_date', asof.isoformat()) \
        .order('rate_date', desc=True).limit(1).execute()
    if not res.data:
        log.warning(f'No FX rate for EUR→{currency} on/before {asof} — defaulting to 1.0')
        return 1.0
    return float(res.data[0]['rate'])


# ── Country composite multiplier ────────────────────────────────────────────────

def country_composite_mult(client, country_code: str) -> float:
    res = client.table('country_cost_multipliers').select('labour_mult,plant_mult,haul_mult,gate_mult') \
        .eq('country_code', country_code).limit(1).execute()
    if not res.data:
        log.warning(f'No country multiplier for {country_code} — defaulting to 1.0')
        return 1.0
    r = res.data[0]
    return (
        WEIGHT_LABOUR * float(r['labour_mult']) +
        WEIGHT_PLANT  * float(r['plant_mult'])  +
        WEIGHT_HAUL   * float(r['haul_mult'])   +
        WEIGHT_GATE   * float(r['gate_mult'])
    )


# ── LCA volumes (vintage-bucketed) ─────────────────────────────────────────────

def lca_volume(client, material: str) -> float:
    """Reference-asset LCA volume per MW for the y2010 + full scope row."""
    res = client.table('wind_material_intensities').select('volume_per_mw') \
        .eq('vintage', REFERENCE_VINTAGE).eq('scope', REFERENCE_SCOPE) \
        .eq('material', material).limit(1).execute()
    if not res.data:
        return 0.0
    return float(res.data[0]['volume_per_mw'] or 0.0)


# ── Recovery layers ─────────────────────────────────────────────────────────────

def metallurgical_rate(client, material: str) -> float:
    res = client.table('metallurgical_recovery_rates').select('rate') \
        .eq('material', material).limit(1).execute()
    return float(res.data[0]['rate']) if res.data else 0.0


def contamination_yield_for(client, material: str) -> float:
    """ferrous (steel, castiron), non_ferrous (copper, aluminium, zinc), or rare_earth."""
    if material in ('steel', 'castiron'):
        cls = 'ferrous'
    elif material == 'rareearth':
        cls = 'rare_earth'
    else:
        cls = 'non_ferrous'
    res = client.table('merchant_contamination_yields').select('yield_rate') \
        .eq('region', 'GLOBAL').eq('material_class', cls).limit(1).execute()
    return float(res.data[0]['yield_rate']) if res.data else 1.0


def broker_margin_default(client, region: str) -> float:
    res = client.table('broker_margins').select('margin_default') \
        .eq('region', region).limit(1).execute()
    return float(res.data[0]['margin_default']) if res.data else 0.30


# ── Commodity prices (scrap-basis) ──────────────────────────────────────────────

def scrap_price(client, granular_material: str, region: str, asof: date) -> float | None:
    """Latest scrap-assessed commodity price on or before asof."""
    res = client.table('commodity_prices').select('price_per_tonne') \
        .eq('material_type', granular_material).eq('region', region) \
        .eq('is_scrap_basis', True) \
        .lte('price_date', asof.isoformat()) \
        .order('price_date', desc=True).limit(1).execute()
    return float(res.data[0]['price_per_tonne']) if res.data else None


def wind_material_price(client, lca_material: str, region: str, asof: date) -> float:
    """
    Maps website-taxonomy LCA material → granular commodity prices.
    'steel' = average(hms1, hms2). 'castiron' = cast_iron. etc.
    """
    if lca_material == 'steel':
        p1 = scrap_price(client, 'steel_hms1', region, asof) or 0
        p2 = scrap_price(client, 'steel_hms2', region, asof) or 0
        return (p1 + p2) / 2.0 if (p1 + p2) > 0 else 0.0
    if lca_material == 'castiron':
        return scrap_price(client, 'steel_cast_iron', region, asof) or 0.0
    if lca_material == 'rareearth':
        return scrap_price(client, 'rare_earth', region, asof) or 0.0
    return scrap_price(client, lca_material, region, asof) or 0.0


# ── Net recovery per MW (per material) ──────────────────────────────────────────

def net_recovery_per_mw(client, lca_material: str, region: str, asof: date) -> float:
    """v1.1 three-layer recovery: vol × metallurgical × contamination × price × (1 − broker)."""
    vol     = lca_volume(client, lca_material)
    met     = metallurgical_rate(client, lca_material)
    contam  = contamination_yield_for(client, lca_material)
    price   = wind_material_price(client, lca_material, region, asof)
    broker  = broker_margin_default(client, region)
    return vol * met * contam * price * (1 - broker)


def category_recovery(client, materials: list[str], region: str, asof: date) -> float:
    return round(sum(net_recovery_per_mw(client, m, region, asof) for m in materials), 2)


# ── Compute one publication ─────────────────────────────────────────────────────

def compute_publication(client, series: str, asof: date, meth: Methodology) -> dict:
    cfg      = SERIES_CONFIG[series]
    region   = cfg['region']
    currency = cfg['currency']
    anchor   = cfg['country_anchor']

    infl = inflation_factor(meth, asof)
    fx   = fx_eur_to(client, currency, asof)
    mult = country_composite_mult(client, anchor)
    base_gross = base_gross_total(client)

    gross_cost      = round(base_gross * infl * mult * fx, 2)
    blade_transport = round(meth.base_blade_transport_eur_mw * infl * mult * fx, 2)
    blade_gate_fees = round(meth.base_blade_gate_fees_eur_mw * infl * mult * fx, 2)
    scrap_haulage   = round(meth.base_scrap_haulage_eur_mw   * infl * mult * fx, 2)
    disposal_costs  = round(blade_transport + blade_gate_fees + scrap_haulage, 2)

    recovery_ferrous   = category_recovery(client, FERROUS_LCA,   region, asof)
    recovery_copper    = category_recovery(client, COPPER_LCA,    region, asof)
    recovery_aluminium = category_recovery(client, ALUMINIUM_LCA, region, asof)
    material_recovery  = round(recovery_ferrous + recovery_copper + recovery_aluminium, 2)

    net_material_position = round(material_recovery - disposal_costs, 2)
    net_liability         = round(gross_cost - net_material_position, 2)

    base_in_ccy = BASE_NET_LIABILITY_EUR * fx_eur_to(client, currency, meth.base_period_date)
    index_value = round((net_liability / base_in_ccy) * 100.0, 2) if base_in_ccy else None

    return {
        'series':                 series,
        'publication_date':       asof.isoformat(),
        'is_headline':            True,
        'index_value':            index_value,
        'index_base_date':        meth.base_period_date.isoformat(),
        'currency':               currency,
        'net_liability':          net_liability,
        'net_liability_low':      round(net_liability * 0.92, 2),
        'net_liability_high':     round(net_liability * 1.08, 2),
        'gross_cost':             gross_cost,
        'recovery_ferrous':       recovery_ferrous,
        'recovery_copper':        recovery_copper,
        'recovery_aluminium':     recovery_aluminium,
        'material_recovery':      material_recovery,
        'blade_transport':        blade_transport,
        'blade_gate_fees':        blade_gate_fees,
        'scrap_haulage':          scrap_haulage,
        'disposal_costs':         disposal_costs,
        'net_material_position':  net_material_position,
        'methodology_version':    meth.version,
        'is_published':           True,
        'notes':                  f'Computed v{meth.version} · 3-layer recovery · country mult {mult:.3f} · inflation {infl:.4f}',
    }


def upsert_publications(client, rows: list[dict]) -> int:
    if not rows:
        return 0
    client.table('dci_publications').upsert(rows, on_conflict='series,publication_date').execute()
    return len(rows)


def log_run(client, status: str, asof: date, written: int, error: str | None = None):
    client.table('ingestion_runs').insert({
        'pipeline':           PIPELINE,
        'status':             status,
        'started_at':         f'{date.today()}T00:00:00Z',
        'finished_at':        f'{date.today()}T00:00:01Z',
        'records_written':    written,
        'source_attribution': 'Endenex DCI Methodology v1.1',
        'notes':              f'asof={asof.isoformat()}',
        'error_message':      error,
    }).execute()


def run(asof: date, backfill_months: int = 0, publish: bool = True):
    log.info(f'=== compute_dci v1.1 starting (asof={asof}, backfill={backfill_months}) ===')
    client = get_supabase_client()
    meth = load_methodology(client)
    log.info(f'  methodology v{meth.version}, base={meth.base_period_date}')

    dates = [asof - relativedelta(months=m) for m in range(backfill_months + 1)] if backfill_months > 0 else [asof]

    total_written = 0
    try:
        for d in dates:
            rows = []
            for series in SERIES_CONFIG.keys():
                row = compute_publication(client, series, d, meth)
                row['is_published'] = publish
                rows.append(row)
            n = upsert_publications(client, rows)
            log.info(f'  [{d.isoformat()}] upserted {n} DCI publications')
            total_written += n
        log_run(client, 'success', asof, total_written)
        log.info(f'=== compute_dci complete: {total_written} rows ===')
    except Exception as e:
        log.exception('compute_dci failed')
        log_run(client, 'failure', asof, total_written, str(e))
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--asof', type=str, default=None)
    parser.add_argument('--backfill', type=int, default=0)
    parser.add_argument('--no-publish', action='store_true')
    args = parser.parse_args()
    asof_d = date.fromisoformat(args.asof) if args.asof else date.today()
    run(asof_d, args.backfill, publish=not args.no_publish)
