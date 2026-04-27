"""
GEM Ingestion — Global Energy Monitor Wind Power Tracker (Spain)
Source: Global Energy Monitor
Licence: CC BY 4.0
Cadence: Quarterly

Spain has no clean per-turbine national registry. GEM Wind Power Tracker is the
verified workaround, covering project-level capacity, status, and ownership.

IMPORTANT — Manual download required each quarter:
  1. Go to: https://globalenergymonitor.org/projects/global-wind-power-tracker/
  2. Click Download → select Excel
  3. Save the file to: ingestion/data/gem_wind_tracker.xlsx
  4. Commit and push — the GitHub Actions workflow will use the committed file.

For GitHub Actions: the file is read from the committed path in the repo.
"""
import logging
import pandas as pd
from pathlib import Path
from base_ingestor import get_supabase_client, upsert_assets, today_iso

log = logging.getLogger(__name__)

GEM_FILE = Path(__file__).parent / 'data' / 'gem_wind_tracker.xlsx'

SOURCE_TYPE = 'GEM Wind Power Tracker'
COUNTRY_CODE = 'ES'
ASSET_CLASS = 'onshore_wind'

SPAIN_LABELS = {'Spain', 'España', 'ES'}


def load_gem() -> pd.DataFrame:
    if not GEM_FILE.exists():
        raise FileNotFoundError(
            f'GEM file not found at {GEM_FILE}. '
            'Download from https://globalenergymonitor.org/projects/global-wind-power-tracker/ '
            'and save to ingestion/data/gem_wind_tracker.xlsx'
        )
    log.info(f'Loading GEM Wind Power Tracker from {GEM_FILE}')
    df = pd.read_excel(GEM_FILE, sheet_name=0)
    log.info(f'Loaded {len(df):,} total GEM records')
    return df


def filter_spain(df: pd.DataFrame) -> pd.DataFrame:
    for col in ['Country', 'country', 'País']:
        if col in df.columns:
            df = df[df[col].astype(str).str.strip().isin(SPAIN_LABELS)].copy()
            log.info(f'Filtered to {len(df):,} Spain records')
            return df
    log.warning('Country column not found — returning all records unfiltered')
    return df


def map_records(df: pd.DataFrame) -> list[dict]:
    today = today_iso()
    records = []

    for _, row in df.iterrows():
        name = _to_str(
            row.get('Project Name') or row.get('project_name') or row.get('Nombre')
        )
        if not name:
            continue

        # GEM uses project-level IDs where available
        gem_id = _to_str(row.get('GEM Unit ID') or row.get('GEM Project ID') or row.get('ID'))
        external_id = gem_id if gem_id else f'GEM-ES-{name.replace(" ", "_")[:100]}'

        # Commissioning year — GEM may have 'Start Year' or 'Commissioned Year'
        start_year = _to_int(
            row.get('Start Year') or row.get('Commissioned Year') or row.get('Year')
        )
        commissioning_date = f'{start_year}-01-01' if start_year and start_year > 1900 else None

        # Capacity already in MW in GEM
        capacity_mw = _to_float(
            row.get('Capacity (MW)') or row.get('Total Capacity (MW)') or row.get('MW')
        )

        records.append({
            'asset_class': ASSET_CLASS,
            'country_code': COUNTRY_CODE,
            'external_id': external_id,
            'name': name,
            'capacity_mw': capacity_mw,
            'commissioning_date': commissioning_date,
            'turbine_make': _to_str(row.get('Turbine Manufacturer') or row.get('OEM')),
            'turbine_model': _to_str(row.get('Turbine Model') or row.get('Model')),
            'hub_height_m': _to_float(row.get('Hub Height (m)') or row.get('Hub Height')),
            'rotor_diameter_m': _to_float(row.get('Rotor Diameter (m)') or row.get('Rotor Diameter')),
            'latitude': _to_float(row.get('Latitude') or row.get('Lat')),
            'longitude': _to_float(row.get('Longitude') or row.get('Lon')),
            'source_type': SOURCE_TYPE,
            'source_date': today,
            'confidence': 'Medium',   # Project-level, no clean national registry for Spain
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


def _to_int(val) -> int | None:
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return None


def _to_str(val) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return None if s in ('', 'nan', 'None') else s


def run():
    log.info('=== GEM (Spain) Ingestion starting ===')
    client = get_supabase_client()
    df = load_gem()
    df = filter_spain(df)
    records = map_records(df)
    total = upsert_assets(client, records)
    log.info(f'=== GEM (Spain) Ingestion complete: {total:,} records ===')


if __name__ == '__main__':
    run()
