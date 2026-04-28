"""
MaStR Ingestion — Marktstammdatenregister (German national energy register)
Source: Bundesnetzagentur
Licence: DL-DE-BY-2.0 (attribution required)
Cadence: Monthly

Uses the open-mastr package (bulk XML download method).
EEG support scheme end dates are the primary repowering trigger for German assets.
These are joined from the EEG table and stored in support_scheme_expiry.
"""
import logging
import pandas as pd
from base_ingestor import get_supabase_client, upsert_assets, today_iso

log = logging.getLogger(__name__)

SOURCE_TYPE = 'MaStR'
COUNTRY_CODE = 'DE'
ASSET_CLASS = 'onshore_wind'

ONSHORE_LABEL = 'Windkraft an Land'


def download_mastr() -> pd.DataFrame:
    log.info('Downloading MaStR wind data via open-mastr (bulk method)...')
    import os
    import sqlalchemy as sa
    from open_mastr import Mastr
    db = Mastr()
    db.download(method='bulk', data=['wind'])
    # open-mastr stores data in SQLite; read wind_extended table directly
    db_path = os.path.join(os.path.expanduser('~'), '.open-MaStR', 'data', 'sqlite', 'open-mastr.db')
    engine = sa.create_engine(f'sqlite:///{db_path}')
    df = pd.read_sql_table('wind_extended', engine)
    log.info(f'Downloaded {len(df):,} MaStR wind unit records')
    return df


def filter_onshore(df: pd.DataFrame) -> pd.DataFrame:
    if 'Lage' in df.columns:
        df = df[df['Lage'] == ONSHORE_LABEL].copy()
        log.info(f'Filtered to {len(df):,} onshore wind records')
    else:
        log.warning('Lage column not found — skipping onshore filter, check column names')
    return df


def parse_date(val) -> str | None:
    if val is None or pd.isnull(val):
        return None
    try:
        ts = pd.to_datetime(val)
        if ts is pd.NaT:
            return None
        return ts.date().isoformat()
    except Exception:
        return None


def map_records(df: pd.DataFrame) -> list[dict]:
    today = today_iso()
    records = []

    for _, row in df.iterrows():
        unit_id = str(row.get('EinheitMastrNummer', '')).strip()
        if not unit_id or unit_id == 'nan':
            continue

        # Capacity: MaStR stores Nettonennleistung in kW
        capacity_kw = _to_float(row.get('Nettonennleistung'))
        capacity_mw = round(capacity_kw / 1000, 4) if capacity_kw else None

        records.append({
            'asset_class': ASSET_CLASS,
            'country_code': COUNTRY_CODE,
            'external_id': unit_id,
            'capacity_mw': capacity_mw,
            'commissioning_date': parse_date(row.get('Inbetriebnahmedatum')),
            'decommissioning_date': parse_date(row.get('DatumEndgueltigeStilllegung')),
            'hub_height_m': _to_float(row.get('Nabenhoehe')),
            'rotor_diameter_m': _to_float(row.get('Rotordurchmesser')),
            'latitude': _to_float(row.get('Breitengrad')),
            'longitude': _to_float(row.get('Laengengrad')),
            'turbine_make': _to_str(row.get('Hersteller')),
            'turbine_model': _to_str(row.get('Typenbezeichnung')),
            'support_scheme_id': _to_str(row.get('EegMastrNummer')),
            # Source metadata — mandatory on every record
            # Attribution required: Bundesnetzagentur, Marktstammdatenregister, DL-DE-BY-2.0
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
    log.info('=== MaStR Ingestion starting ===')
    client = get_supabase_client()
    df = download_mastr()
    df = filter_onshore(df)
    records = map_records(df)
    total = upsert_assets(client, records)
    log.info(f'=== MaStR Ingestion complete: {total:,} records ===')


if __name__ == '__main__':
    run()
