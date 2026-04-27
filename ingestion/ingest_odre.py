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

# ODRÉ OpenDataSoft API — filtered to wind installations above 36kW
ODRE_URL = (
    'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/'
    'registre-national-installation-production-stockage-electricite-simplifie/'
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


def parse_coords(coord_str: str) -> tuple[float | None, float | None]:
    """Parse 'lat,lon' or 'lat, lon' coordinate string."""
    try:
        parts = str(coord_str).split(',')
        return float(parts[0].strip()), float(parts[1].strip())
    except Exception:
        return None, None


def map_records(df: pd.DataFrame) -> list[dict]:
    today = today_iso()
    records = []

    for _, row in df.iterrows():
        # Use installation name + commune as composite external ID (no stable numeric ID in ODRÉ)
        name = _to_str(row.get('nomInstallation') or row.get('nom_installation'))
        commune = _to_str(row.get('commune') or row.get('Commune'))
        if not name:
            continue
        external_id = f"FR-{name}-{commune or 'unknown'}".replace(' ', '_')[:200]

        # Capacity in kW → MW
        cap_kw = _to_float(row.get('puissanceInstalleeKW') or row.get('puissance_installee'))
        capacity_mw = round(cap_kw / 1000, 4) if cap_kw else None

        # Coordinates — may be combined 'lat,lon' string
        lat, lon = None, None
        coord_raw = row.get('coordonneesGPS') or row.get('coordonnees_gps')
        if coord_raw and str(coord_raw).strip() not in ('', 'nan'):
            lat, lon = parse_coords(coord_raw)
        else:
            lat = _to_float(row.get('latitude') or row.get('Latitude'))
            lon = _to_float(row.get('longitude') or row.get('Longitude'))

        records.append({
            'asset_class': ASSET_CLASS,
            'country_code': COUNTRY_CODE,
            'external_id': external_id,
            'name': name,
            'capacity_mw': capacity_mw,
            'commissioning_date': _parse_date(
                row.get('dateMiseEnService') or row.get('date_mise_en_service')
            ),
            'latitude': lat,
            'longitude': lon,
            'source_type': SOURCE_TYPE,
            'source_date': today,
            'confidence': 'Medium',   # Site-level, not turbine-level
            'derivation': 'Observed',
            'last_reviewed': today,
        })

    log.info(f'Mapped {len(records):,} records for upsert')
    return records


def _parse_date(val) -> str | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        return pd.to_datetime(val, dayfirst=True).date().isoformat()
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
