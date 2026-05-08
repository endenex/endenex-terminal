#!/usr/bin/env python3
"""
RTE France Open Data → repowering_projects.

RTE (Réseau de Transport d'Électricité) publishes the "Registre des
installations de production raccordées" (registered production
installations) via odre.opendatasoft.com — free, JSON API, no auth.

Dataset:
  registre-national-installation-production-stockage-electricite-agrege

Each row covers one production installation with codeINSEE, technology,
capacity, COD, status. We filter to wind/solar/storage and map status
→ five-stage enum. RTE's "raccordement" (grid connection) status is the
key signal — corresponds to "permitted" + "ongoing".

Note: RTE register covers connected installations. For pipeline /
pre-permit projects in France, the parallel source is the prefecture
ICPE (Installations Classées) decisions, which are scraped from BOE-
equivalent regional gazettes via miteco_spain.py pattern (TODO).
"""

from __future__ import annotations

import argparse
import sys
from datetime import date

import requests

from base_ingestor import get_supabase_client, log
from repowering._base import (
    normalise_stage, normalise_asset_class,
    upsert_project, today_iso, parse_date,
)


RTE_DATASET = 'registre-national-installation-production-stockage-electricite-agrege'
RTE_API = (
    'https://opendata.reseaux-energies.fr/api/explore/v2.1/catalog/datasets/'
    f'{RTE_DATASET}/records'
)

RTE_STAGE_MAP = {
    'en_construction':    'permitted',
    'en_service':         'ongoing',
    'mis_en_service':     'ongoing',
    'arrete':             None,            # decommissioned — drop
    'arrete_definitif':   None,
    'planifie':           'application_approved',
    'projete':            'application_submitted',
}


def fetch_rte_page(offset: int, limit: int = 100) -> list[dict]:
    params = {
        'limit':  limit,
        'offset': offset,
        'where': 'filiere in ("Eolien","Solaire","Stockage")',
    }
    r = requests.get(RTE_API, params=params, timeout=60,
                     headers={'User-Agent': 'endenex-terminal/1.0'})
    r.raise_for_status()
    return r.json().get('results', [])


def build_row(rec: dict, today: str) -> dict | None:
    filiere = (rec.get('filiere') or '').strip().lower()
    asset_class_map = {'eolien':'onshore_wind','solaire':'solar_pv','stockage':'bess'}
    asset_class = asset_class_map.get(filiere)
    if not asset_class:
        return None
    # Distinguish onshore vs offshore for wind via type_eolienne field
    if asset_class == 'onshore_wind':
        type_ = (rec.get('type_eolienne') or rec.get('eolien_type') or '').lower()
        if 'mer' in type_ or 'offshore' in type_:
            asset_class = 'offshore_wind'

    project_name = (rec.get('nom_installation') or rec.get('nom') or rec.get('site') or '').strip()
    if not project_name:
        return None

    stage_raw = rec.get('etat_installation') or rec.get('statut') or 'en_service'
    stage = normalise_stage(stage_raw, RTE_STAGE_MAP)
    if stage is None:
        return None

    capacity = rec.get('puis_max_kw') or rec.get('puissance_kw') or rec.get('puissance_mw')
    try:
        capacity_mw = float(capacity) / (1000 if 'kw' in str(rec.get('_unit','')).lower() else 1)
        # Heuristic: if value > 100,000 it's likely kW; convert to MW
        if capacity_mw > 100_000:
            capacity_mw = capacity_mw / 1000
    except (TypeError, ValueError):
        capacity_mw = None

    region = (rec.get('region') or rec.get('nom_region') or '').strip()
    cod = parse_date(rec.get('date_mise_en_service') or rec.get('mise_en_service'))
    install_id = (rec.get('idsite') or rec.get('id_installation') or '').strip()

    return {
        'project_name':        project_name,
        'country_code':        'FR',
        'asset_class':         asset_class,
        'stage':               stage,
        'stage_date':          cod or today,
        'capacity_mw':         capacity_mw,
        'developer':           (rec.get('producteur') or rec.get('exploitant') or None),
        'operator':            (rec.get('exploitant') or None),
        'planning_reference':  install_id or None,
        'location_description': f'{region}, France' if region else 'France',
        'source_url':          'https://opendata.reseaux-energies.fr/explore/dataset/' + RTE_DATASET,
        'notes':               'RTE registre national',
        'source_type':         'rte_open_data',
        'source_date':         today,
        'confidence':          'High',
        'derivation':          'Observed',
        'last_reviewed':       today,
        'external_source':     'rte_open_data',
        'external_source_id':  install_id or None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--limit', type=int, default=10000, help='Max records to fetch')
    args = ap.parse_args()

    client = get_supabase_client()
    today = today_iso()
    log.info(f'=== RTE France ingestion · {today} ===')

    inserted = skipped = 0
    offset = 0
    page_size = 100
    while offset < args.limit:
        page = fetch_rte_page(offset, page_size)
        if not page:
            break
        for rec in page:
            row = build_row(rec, today)
            if not row:
                skipped += 1
                continue
            if args.dry_run:
                log.info(f'    {row["project_name"]} [{row["asset_class"]}/{row["stage"]}] · {row["capacity_mw"]} MW')
                continue
            if upsert_project(client, row):
                inserted += 1
            else:
                skipped += 1
        offset += page_size
        if len(page) < page_size:
            break

    if not args.dry_run:
        client.table('ingestion_runs').insert({
            'pipeline':           'rte_france_repowering',
            'status':             'success',
            'started_at':         f'{today}T00:00:00Z',
            'finished_at':        f'{today}T00:00:00Z',
            'records_written':    inserted,
            'source_attribution': f'RTE Open Data ({RTE_API})',
            'notes':              f'RTE France ingestion · {inserted} upserts · {skipped} skipped.',
        }).execute()

    log.info(f'=== complete: {inserted} upserted · {skipped} skipped ===')


if __name__ == '__main__':
    main()
