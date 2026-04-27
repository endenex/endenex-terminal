"""
REPD Ingestion — UK Renewable Energy Planning Database
Source: DESNZ via gov.uk
Licence: Open Government Licence v3.0
Cadence: Quarterly (January, April, July, October)

UPDATE REPD_URL each quarter with the latest file from:
https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract
"""
import io
import logging
import requests
import pandas as pd
from pyproj import Transformer
from base_ingestor import get_supabase_client, upsert_assets, today_iso

log = logging.getLogger(__name__)

# ── Update this URL each quarter ──────────────────────────────────────────────
REPD_URL = (
    'https://assets.publishing.service.gov.uk/media/'
    '6985c32ec106cc5501b6e459/REPD_Publication_Q4_2025.xlsx'
)
# ──────────────────────────────────────────────────────────────────────────────

SOURCE_TYPE = 'REPD'
COUNTRY_CODE = 'GB'
ASSET_CLASS = 'onshore_wind'
TECHNOLOGY_FILTER = 'Wind Onshore'

# REPD coordinates are British National Grid (OSGB36, EPSG:27700) → convert to WGS84
_bng_to_wgs84 = Transformer.from_crs('EPSG:27700', 'EPSG:4326', always_xy=True)


def osgb_to_latlon(x, y) -> tuple[float | None, float | None]:
    try:
        lon, lat = _bng_to_wgs84.transform(float(x), float(y))
        return round(lat, 6), round(lon, 6)
    except Exception:
        return None, None


def download_repd() -> pd.DataFrame:
    log.info(f'Downloading REPD from {REPD_URL}')
    r = requests.get(REPD_URL, timeout=120)
    r.raise_for_status()
    df = pd.read_excel(io.BytesIO(r.content), sheet_name='REPD')
    log.info(f'Downloaded {len(df):,} total REPD rows')
    return df


def parse_date(val) -> str | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        return pd.to_datetime(val).date().isoformat()
    except Exception:
        return None


def map_records(df: pd.DataFrame) -> list[dict]:
    df = df[df['Technology Type'] == TECHNOLOGY_FILTER].copy()
    log.info(f'Filtered to {len(df):,} onshore wind records')

    today = today_iso()
    records = []

    for _, row in df.iterrows():
        external_id = str(row.get('Ref ID', '')).strip()
        if not external_id or external_id == 'nan':
            continue

        lat, lon = osgb_to_latlon(row.get('X-coordinate'), row.get('Y-coordinate'))

        records.append({
            'asset_class': ASSET_CLASS,
            'country_code': COUNTRY_CODE,
            'external_id': external_id,
            'name': _to_str(row.get('Site Name')),
            'capacity_mw': _to_float(row.get('Installed Capacity (MWelec)')),
            'commissioning_date': parse_date(row.get('Operational')),
            'hub_height_m': _to_float(row.get('Height of Turbines (m)')),
            'latitude': lat,
            'longitude': lon,
            # Source metadata — mandatory on every record
            'source_type': SOURCE_TYPE,
            'source_date': today,
            'confidence': 'High',
            'derivation': 'Observed',
            'last_reviewed': today,
        })

    log.info(f'Mapped {len(records):,} records for upsert')
    return records


def _to_float(val) -> float | None:
    try:
        f = float(val)
        return None if pd.isna(f) else f
    except (TypeError, ValueError):
        return None


def _to_str(val) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return None if s in ('', 'nan', 'None') else s


def run():
    log.info('=== REPD Ingestion starting ===')
    client = get_supabase_client()
    df = download_repd()
    records = map_records(df)
    total = upsert_assets(client, records)
    log.info(f'=== REPD Ingestion complete: {total:,} records ===')


if __name__ == '__main__':
    run()
