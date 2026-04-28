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

# Direct download — check ens.dk if this URL changes:
# https://ens.dk/analyser-og-statistik/data-oversigt-over-energisektoren
ENS_URL = 'https://ens.dk/media/7828/download'

SOURCE_TYPE = 'Energistyrelsen'
COUNTRY_CODE = 'DK'
ASSET_CLASS = 'onshore_wind'

# Type af placering: 'LAND' = onshore, 'HAV' = offshore
ONSHORE_LABEL = 'LAND'

# Coordinates are UTM Zone 32N EUREF89 (EPSG:25832) → WGS84
from pyproj import Transformer
_utm32_to_wgs84 = Transformer.from_crs('EPSG:25832', 'EPSG:4326', always_xy=True)


def utm32_to_latlon(x, y) -> tuple[float | None, float | None]:
    import math
    try:
        fx, fy = float(x), float(y)
        if fx == 0 or fy == 0 or math.isnan(fx) or math.isnan(fy):
            return None, None
        lon, lat = _utm32_to_wgs84.transform(fx, fy)
        if math.isinf(lat) or math.isinf(lon) or math.isnan(lat) or math.isnan(lon):
            return None, None
        # Denmark bounding box
        if not (54.5 <= lat <= 58.0 and 8.0 <= lon <= 15.5):
            return None, None
        return round(lat, 6), round(lon, 6)
    except Exception:
        return None, None


def download_ens() -> pd.DataFrame:
    log.info(f'Downloading Energistyrelsen data from {ENS_URL}')
    r = requests.get(ENS_URL, timeout=120)
    r.raise_for_status()
    # Headers are at row 10 (0-indexed), sheet is 'Vindmølledata'
    df = pd.read_excel(io.BytesIO(r.content), sheet_name='Vindmølledata',
                       engine='openpyxl', skiprows=10)
    log.info(f'Downloaded {len(df):,} Energistyrelsen rows')
    return df


def filter_onshore(df: pd.DataFrame) -> pd.DataFrame:
    col = 'Type af placering'
    if col in df.columns:
        df = df[df[col].astype(str).str.strip().str.upper() == ONSHORE_LABEL].copy()
        log.info(f'Filtered to {len(df):,} onshore records')
    else:
        log.warning('Placement column not found — returning all records unfiltered')
    return df


def map_records(df: pd.DataFrame) -> list[dict]:
    today = today_iso()
    records = []

    for _, row in df.iterrows():
        # GSRN is the stable turbine identifier
        gsrn = _to_str(row.get('Møllenummer (GSRN)'))
        if not gsrn:
            continue

        # Capacity in kW → MW
        cap_kw = _to_float(row.get('Kapacitet (kW)'))
        capacity_mw = round(cap_kw / 1000, 4) if cap_kw else None

        # Coordinates: UTM32 EUREF89 → WGS84
        lat, lon = utm32_to_latlon(
            row.get('X (øst) koordinat \nUTM 32 Euref89'),
            row.get('Y (nord) koordinat \nUTM 32 Euref89'),
        )

        records.append({
            'asset_class': ASSET_CLASS,
            'country_code': COUNTRY_CODE,
            'external_id': gsrn,
            'capacity_mw': capacity_mw,
            'commissioning_date': _parse_date(row.get('Dato for oprindelig nettilslutning')),
            'decommissioning_date': _parse_date(row.get('Dato for afmeldning')),
            'turbine_make': _to_str(row.get('Fabrikat')),
            'turbine_model': _to_str(row.get('Typebetegnelse')),
            'hub_height_m': _to_float(row.get('Navhøjde (m)')),
            'rotor_diameter_m': _to_float(row.get('Rotor-diameter (m)')),
            'latitude': lat,
            'longitude': lon,
            'source_type': SOURCE_TYPE,
            'source_date': today,
            'confidence': 'High',
            'derivation': 'Observed',
            'last_reviewed': today,
        })

    log.info(f'Mapped {len(records):,} records for upsert')
    return records


def _parse_date(val) -> str | None:
    if val is None or pd.isnull(val):
        return None
    try:
        ts = pd.to_datetime(val)
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
    log.info('=== Energistyrelsen Ingestion starting ===')
    client = get_supabase_client()
    df = download_ens()
    df = filter_onshore(df)
    records = map_records(df)
    total = upsert_assets(client, records)
    log.info(f'=== Energistyrelsen Ingestion complete: {total:,} records ===')


if __name__ == '__main__':
    run()
