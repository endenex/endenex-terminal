"""
Energistyrelsen Ingestion — Danish Energy Agency wind turbine register
Source: Energistyrelsen (Danish Energy Agency)
Licence: Open (ens.dk)
Cadence: Quarterly

Denmark has the oldest installed wind fleet in Europe — leading repowering market by vintage.
Data is at individual turbine level with GSRN as the stable unique identifier.

UPDATE ENS_URL if the download link changes:
https://ens.dk/service/statistik-data-noegletal-og-kort/data-oversigt-over-energisektoren
"""
import io
import logging
import requests
import pandas as pd
from base_ingestor import get_supabase_client, upsert_assets, today_iso

log = logging.getLogger(__name__)

# Direct download — check ens.dk if this URL changes
ENS_URL = 'https://ens.dk/sites/ens.dk/files/Statistik/anlaeg_med_storrelse.xls'

SOURCE_TYPE = 'Energistyrelsen'
COUNTRY_CODE = 'DK'
ASSET_CLASS = 'onshore_wind'

# Danish field: Placering = 'Land' (onshore), 'Hav' (offshore)
ONSHORE_LABEL = 'Land'


def download_ens() -> pd.DataFrame:
    log.info(f'Downloading Energistyrelsen data from {ENS_URL}')
    r = requests.get(ENS_URL, timeout=120)
    r.raise_for_status()
    # Try both xls and xlsx engines
    try:
        df = pd.read_excel(io.BytesIO(r.content), sheet_name=0)
    except Exception:
        df = pd.read_excel(io.BytesIO(r.content), sheet_name=0, engine='openpyxl')
    log.info(f'Downloaded {len(df):,} Energistyrelsen rows')
    return df


def filter_onshore(df: pd.DataFrame) -> pd.DataFrame:
    # Try common column name variants for placement field
    for col in ['Placering', 'placering', 'Type']:
        if col in df.columns:
            df = df[df[col].astype(str).str.strip() == ONSHORE_LABEL].copy()
            log.info(f'Filtered to {len(df):,} onshore records using column "{col}"')
            return df
    log.warning('No placement column found — returning all records unfiltered')
    return df


def map_records(df: pd.DataFrame) -> list[dict]:
    today = today_iso()
    records = []

    for _, row in df.iterrows():
        # GSRN is the stable turbine identifier
        gsrn = _to_str(row.get('GSRN') or row.get('gsrn'))
        if not gsrn:
            continue

        # Capacity in kW → MW
        cap_kw = _to_float(row.get('Kapacitet (kW)') or row.get('Kapacitet'))
        capacity_mw = round(cap_kw / 1000, 4) if cap_kw else None

        records.append({
            'asset_class': ASSET_CLASS,
            'country_code': COUNTRY_CODE,
            'external_id': gsrn,
            'capacity_mw': capacity_mw,
            'commissioning_date': _parse_date(row.get('Nettilsluttet') or row.get('Tilslutningsdato')),
            'decommissioning_date': _parse_date(row.get('Afmeldt') or row.get('Afmeldingsdato')),
            'turbine_make': _to_str(row.get('Fabrikat') or row.get('Mærke')),
            'turbine_model': _to_str(row.get('Type') or row.get('Model')),
            'hub_height_m': _to_float(row.get('Navhøjde (m)') or row.get('Navhøjde')),
            'rotor_diameter_m': _to_float(row.get('Rotordiameter (m)') or row.get('Rotordiameter')),
            'latitude': _to_float(row.get('Latitude') or row.get('WGS84_Bredde')),
            'longitude': _to_float(row.get('Longitude') or row.get('WGS84_Længde')),
            'source_type': SOURCE_TYPE,
            'source_date': today,
            'confidence': 'High',
            'derivation': 'Observed',
            'last_reviewed': today,
        })

    log.info(f'Mapped {len(records):,} records for upsert')
    return records


def _parse_date(val) -> str | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        return pd.to_datetime(val).date().isoformat()
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
    log.info('=== Energistyrelsen Ingestion starting ===')
    client = get_supabase_client()
    df = download_ens()
    df = filter_onshore(df)
    records = map_records(df)
    total = upsert_assets(client, records)
    log.info(f'=== Energistyrelsen Ingestion complete: {total:,} records ===')


if __name__ == '__main__':
    run()
