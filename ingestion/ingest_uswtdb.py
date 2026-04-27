"""
USWTDB Ingestion — US Wind Turbine Database
Source: USGS / Lawrence Berkeley National Laboratory / American Clean Power Association
Licence: Public domain
Cadence: Quarterly

Stable download URL — no update required between releases.
Separate decommissioned turbine dataset to be added in Materials Outlook module (Step 7).
"""
import io
import logging
import zipfile
import requests
import pandas as pd
from base_ingestor import get_supabase_client, upsert_assets, today_iso

log = logging.getLogger(__name__)

USWTDB_URL = 'https://eerscmap.usgs.gov/uswtdb/assets/data/uswtdbCSV.zip'

SOURCE_TYPE = 'USWTDB'
COUNTRY_CODE = 'US'
ASSET_CLASS = 'onshore_wind'

# USWTDB attribute confidence mapping (t_conf_atr field)
CONFIDENCE_MAP = {1: 'High', 2: 'Medium', 3: 'Low'}


def download_uswtdb() -> pd.DataFrame:
    log.info(f'Downloading USWTDB from {USWTDB_URL}')
    r = requests.get(USWTDB_URL, timeout=180)
    r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    csv_name = next(f for f in z.namelist() if f.endswith('.csv'))
    df = pd.read_csv(z.open(csv_name), low_memory=False)
    log.info(f'Downloaded {len(df):,} USWTDB turbine records')
    return df


def map_records(df: pd.DataFrame) -> list[dict]:
    today = today_iso()
    records = []

    for _, row in df.iterrows():
        case_id = str(row.get('case_id', '')).strip()
        if not case_id or case_id == 'nan':
            continue

        # Commissioning year → date (YYYY-01-01 approximation)
        p_year = _to_int(row.get('p_year'))
        commissioning_date = f'{p_year}-01-01' if p_year and p_year > 1900 else None

        # Turbine capacity: USWTDB stores in kW → convert to MW
        t_cap_kw = _to_float(row.get('t_cap'))
        capacity_mw = round(t_cap_kw / 1000, 4) if t_cap_kw else None

        # Confidence from USWTDB's own attribute confidence field
        conf_raw = _to_int(row.get('t_conf_atr'))
        confidence = CONFIDENCE_MAP.get(conf_raw, 'Medium')

        records.append({
            'asset_class': ASSET_CLASS,
            'country_code': COUNTRY_CODE,
            'external_id': case_id,
            'name': str(row.get('p_name', '')).strip() or None,
            'capacity_mw': capacity_mw,
            'commissioning_date': commissioning_date,
            'turbine_make': str(row.get('t_manu', '')).strip() or None,
            'turbine_model': str(row.get('t_model', '')).strip() or None,
            'hub_height_m': _to_float(row.get('t_hh')),
            'rotor_diameter_m': _to_float(row.get('t_rd')),
            'latitude': _to_float(row.get('ylat')),
            'longitude': _to_float(row.get('xlong')),
            # Source metadata — mandatory on every record
            'source_type': SOURCE_TYPE,
            'source_date': today,
            'confidence': confidence,
            'derivation': 'Observed',
            'last_reviewed': today,
        })

    log.info(f'Mapped {len(records):,} records for upsert')
    return records


def _to_float(val) -> float | None:
    try:
        f = float(val)
        import math
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _to_int(val) -> int | None:
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return None


def run():
    log.info('=== USWTDB Ingestion starting ===')
    client = get_supabase_client()
    df = download_uswtdb()
    records = map_records(df)
    total = upsert_assets(client, records)
    log.info(f'=== USWTDB Ingestion complete: {total:,} records ===')


if __name__ == '__main__':
    run()
