"""
ODRÉ Ingestion — French national electricity production register
Source: RTE via ODRÉ platform (OpenDataSoft)
Licence: Open data, RTE
Cadence: Monthly (ODRÉ updates monthly)

Data is at installation/wind farm level, not individual turbine level.
This is the verified workaround for France — no per-turbine national registry exists.
Functional for signal-stack classification at site level.
"""
import logging
import requests
import pandas as pd
from base_ingestor import get_supabase_client, upsert_assets, today_iso

log = logging.getLogger(__name__)

# ODRÉ OpenDataSoft API — filtered to wind installations (updated to current dataset)
ODRE_URL = (
    'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/'
    'registre-national-installation-production-stockage-electricite-agrege/'
    'exports/csv'
    '?where=filiere%3D%22Eolien%22'
    '&timezone=UTC'
    '&delimiter=%3B'
)

SOURCE_TYPE = 'ODRÉ'
COUNTRY_CODE = 'FR'
ASSET_CLASS = 'onshore_wind'


def download_odre() -> pd.DataFrame:
    log.info('Downloading ODRÉ wind installation data...')
    r = requests.get(ODRE_URL, timeout=180)
    r.raise_for_status()
    df = pd.read_csv(
        pd.io.common.BytesIO(r.content),
        sep=';',
        low_memory=False,
    )
    log.info(f'Downloaded {len(df):,} ODRÉ wind records')
    return df


def map_records(df: pd.DataFrame) -> list[dict]:
    today = today_iso()
    records = []

    for _, row in df.iterrows():
        # EIC code is the stable installation identifier in the aggregated register
        eic = _to_str(row.get('codeeicresourceobject'))
        name = _to_str(row.get('nominstallation'))
        if not eic and not name:
            continue
        commune = _to_str(row.get('commune'))
        external_id = (eic or f"FR-{name}-{commune or 'unknown'}").replace(' ', '_')[:200]

        # Capacity in kW → MW (puismaxinstallee column)
        cap_kw = _to_float(row.get('puismaxinstallee'))
        capacity_mw = round(cap_kw / 1000, 4) if cap_kw else None

        # Aggregated register does not include coordinates
        records.append({
            'asset_class': ASSET_CLASS,
            'country_code': COUNTRY_CODE,
            'external_id': external_id,
            'name': name,
            'capacity_mw': capacity_mw,
            'commissioning_date': _parse_date(row.get('datemiseenservice')),
            'latitude': None,
            'longitude': None,
            'source_type': SOURCE_TYPE,
            'source_date': today,
            'confidence': 'Medium',   # Site-level, not turbine-level
            'derivation': 'Observed',
            'last_reviewed': today,
        })

    # Deduplicate by external_id — keep highest capacity where EIC appears >1 time
    seen: dict[str, dict] = {}
    for rec in records:
        eid = rec['external_id']
        if eid not in seen:
            seen[eid] = rec
        else:
            existing_cap = seen[eid]['capacity_mw'] or 0
            new_cap = rec['capacity_mw'] or 0
            if new_cap > existing_cap:
                seen[eid] = rec
    deduped = list(seen.values())
    if len(deduped) < len(records):
        log.info(f'Deduplicated {len(records) - len(deduped):,} duplicate EIC records')
    log.info(f'Mapped {len(deduped):,} records for upsert')
    return deduped


def _parse_date(val) -> str | None:
    if val is None or pd.isnull(val):
        return None
    try:
        ts = pd.to_datetime(val, dayfirst=True)
        if ts is pd.NaT:
            return None
        return ts.date().isoformat()
    except Exception:
        return None


def _to_float(val) -> float | None:
    try:
        import math
        f = float(val)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _to_str(val) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return None if s in ('', 'nan', 'None') else s


def run():
    log.info('=== ODRÉ Ingestion starting ===')
    client = get_supabase_client()
    df = download_odre()
    records = map_records(df)
    total = upsert_assets(client, records)
    log.info(f'=== ODRÉ Ingestion complete: {total:,} records ===')


if __name__ == '__main__':
    run()
