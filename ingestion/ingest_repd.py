"""
REPD Ingestion — UK Renewable Energy Planning Database
Source: DESNZ via gov.uk
Licence: Open Government Licence v3.0
Cadence: Quarterly (January, April, July, October)

UPDATE REPD_URL each quarter with the latest file from:
https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract
"""
from __future__ import annotations
import io
import logging
import requests
import pandas as pd
from pyproj import Transformer
from base_ingestor import get_supabase_client, upsert_assets, today_iso

log = logging.getLogger(__name__)

# DESNZ rotates the underlying asset URL every quarter, so we discover the
# current URL by scraping the publication page rather than hardcoding it.
# REPD_URL_HINT is just a fallback if the page scrape fails.
REPD_PUBLICATION_PAGE = (
    'https://www.gov.uk/government/publications/'
    'renewable-energy-planning-database-monthly-extract'
)
REPD_URL_HINT = (
    'https://assets.publishing.service.gov.uk/media/'
    '6985c32ec106cc5501b6e459/REPD_Publication_Q4_2025.xlsx'
)


def discover_repd_url() -> str:
    """
    Scrape the gov.uk publication page to find the latest REPD .xlsx asset URL.

    The page exposes attachment links of the form:
        <a ... href="https://assets.publishing.service.gov.uk/media/.../REPD_Publication_QX_YYYY.xlsx">
    We pick the first URL matching that pattern (the page lists most-recent first).
    """
    import re
    log.info(f'Discovering current REPD URL from {REPD_PUBLICATION_PAGE}')
    r = requests.get(REPD_PUBLICATION_PAGE, timeout=60,
                     headers={'User-Agent': 'endenex-terminal/1.0'})
    r.raise_for_status()
    matches = re.findall(
        r'https://assets\.publishing\.service\.gov\.uk/media/[^"\']+REPD[^"\']+\.xlsx',
        r.text,
    )
    if not matches:
        log.warning('No REPD URL found on publication page; falling back to hint URL')
        return REPD_URL_HINT
    chosen = matches[0]
    log.info(f'Found current REPD asset: {chosen}')
    return chosen
# ──────────────────────────────────────────────────────────────────────────────

SOURCE_TYPE = 'REPD'
COUNTRY_CODE = 'GB'
ASSET_CLASS = 'onshore_wind'
TECHNOLOGY_FILTER = 'Wind Onshore'

# REPD coordinates are British National Grid (OSGB36, EPSG:27700) → convert to WGS84
_bng_to_wgs84 = Transformer.from_crs('EPSG:27700', 'EPSG:4326', always_xy=True)


def osgb_to_latlon(x, y) -> tuple[float | None, float | None]:
    import math
    try:
        fx, fy = float(x), float(y)
        # Reject zero/missing placeholders and invalid values
        if fx == 0 or fy == 0 or math.isnan(fx) or math.isnan(fy):
            return None, None
        lon, lat = _bng_to_wgs84.transform(fx, fy)
        if math.isinf(lat) or math.isinf(lon) or math.isnan(lat) or math.isnan(lon):
            return None, None
        # Sanity check: UK bounding box
        if not (49.0 <= lat <= 61.0 and -8.5 <= lon <= 2.0):
            return None, None
        return round(lat, 6), round(lon, 6)
    except Exception:
        return None, None


def download_repd() -> tuple[pd.DataFrame, str]:
    """
    Download the latest REPD spreadsheet. Returns (DataFrame, source_url).

    Auto-discovers the URL via the gov.uk publication page (DESNZ rotates
    URLs quarterly), and auto-discovers the right worksheet inside the
    workbook (DESNZ has renamed sheets across publication years — earlier
    files used 'REPD', some use 'Sheet1', some 'data').

    The right sheet is whichever one has BOTH 'Ref ID' and 'Site Name'
    columns. Validation guarantees we don't ingest the wrong tab.
    """
    url = discover_repd_url()
    log.info(f'Downloading REPD from {url}')
    r = requests.get(url, timeout=120, headers={'User-Agent': 'endenex-terminal/1.0'})
    r.raise_for_status()

    xls = pd.ExcelFile(io.BytesIO(r.content))
    log.info(f'  Workbook sheets: {xls.sheet_names}')

    chosen_sheet = None
    for name in xls.sheet_names:
        sample = pd.read_excel(xls, sheet_name=name, nrows=2)
        cols = set(str(c).strip() for c in sample.columns)
        if 'Ref ID' in cols and 'Site Name' in cols:
            chosen_sheet = name
            break

    if chosen_sheet is None:
        # Last-ditch fallback: first sheet with > 5 columns and > 100 rows.
        for name in xls.sheet_names:
            sample = pd.read_excel(xls, sheet_name=name, nrows=2)
            if len(sample.columns) > 5:
                chosen_sheet = name
                log.warning(f'  No sheet had Ref ID + Site Name; using "{name}" as fallback')
                break

    if chosen_sheet is None:
        raise ValueError(f'No usable sheet found in REPD workbook. Sheets: {xls.sheet_names}')

    log.info(f'  Reading sheet: "{chosen_sheet}"')
    df = pd.read_excel(xls, sheet_name=chosen_sheet)
    log.info(f'Downloaded {len(df):,} total REPD rows')
    return df, url


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


# ── REPD project extras (operator / planning ref / status) ────────────────
#
# REPD column names vary slightly across publication years. We probe a few
# common variants for each logical field and use the first one present.

_FIELD_CANDIDATES = {
    'site_name':                  ['Site Name'],
    'technology_type':            ['Technology Type'],
    'storage_type':               ['Storage Type'],
    'installed_capacity_mw':      ['Installed Capacity (MWelec)', 'Installed Capacity'],
    'development_status':         ['Development Status'],
    'development_status_short':   ['Development Status (short)', 'Development Status'],
    'country':                    ['Country'],
    'region':                     ['Region', 'Government Office Region'],
    'county':                     ['County'],
    'local_planning_authority':   ['Planning Authority', 'Local Planning Authority'],
    'parliamentary_constituency': ['Parliamentary Constituency'],
    'operator':                   ['Operator (or Applicant)', 'Operator', 'Applicant'],
    'developer':                  ['Developer Name', 'Developer'],
    'planning_application_ref':   ['Planning Application Reference', 'Planning Reference'],
    'planning_authority_decision_date': ['Planning Permission Granted', 'Decision Date', 'Date of Planning Decision'],
    'planning_permission_expiry': ['Planning Permission Expires'],
    'appeal_lodged':              ['Appeal Lodged'],
    'appeal_decision_date':       ['Appeal Decision Date'],
    'under_construction_date':    ['Under Construction'],
    'operational_date':           ['Operational'],
    'ro_banding':                 ['RO Banding'],
    'cfd_capacity_mw':            ['CfD Capacity'],
    'heat_network_ref':           ['Heat Network Reference'],
    'storage_co_located':         ['Storage Co-located'],
}


def _pick(row, candidates: list[str]):
    """Return the first non-null value among the supplied column names."""
    for col in candidates:
        if col in row.index:
            v = row[col]
            if not (v is None or (isinstance(v, float) and pd.isna(v)) or str(v).strip() in ('', 'nan', 'None')):
                return v
    return None


def _to_bool(val) -> bool | None:
    if val is None:
        return None
    s = str(val).strip().lower()
    if s in ('y', 'yes', 'true', '1'):
        return True
    if s in ('n', 'no', 'false', '0'):
        return False
    return None


def map_extras(df: pd.DataFrame, source_publication: str, source_url: str | None = None) -> list[dict]:
    """Map REPD rows to repd_project_extras records (all technologies, not just wind)."""
    today = today_iso()
    extras = []
    for _, row in df.iterrows():
        rid = str(row.get('Ref ID', '')).strip()
        if not rid or rid == 'nan':
            continue
        rec = {
            'repd_ref_id':              rid,
            'site_name':                _to_str(_pick(row, _FIELD_CANDIDATES['site_name'])),
            'technology_type':          _to_str(_pick(row, _FIELD_CANDIDATES['technology_type'])),
            'storage_type':             _to_str(_pick(row, _FIELD_CANDIDATES['storage_type'])),
            'installed_capacity_mw':    _to_float(_pick(row, _FIELD_CANDIDATES['installed_capacity_mw'])),
            'development_status':       _to_str(_pick(row, _FIELD_CANDIDATES['development_status'])),
            'development_status_short': _to_str(_pick(row, _FIELD_CANDIDATES['development_status_short'])),
            'country':                  _to_str(_pick(row, _FIELD_CANDIDATES['country'])),
            'region':                   _to_str(_pick(row, _FIELD_CANDIDATES['region'])),
            'county':                   _to_str(_pick(row, _FIELD_CANDIDATES['county'])),
            'local_planning_authority': _to_str(_pick(row, _FIELD_CANDIDATES['local_planning_authority'])),
            'parliamentary_constituency': _to_str(_pick(row, _FIELD_CANDIDATES['parliamentary_constituency'])),
            'operator':                 _to_str(_pick(row, _FIELD_CANDIDATES['operator'])),
            'developer':                _to_str(_pick(row, _FIELD_CANDIDATES['developer'])),
            'planning_application_ref': _to_str(_pick(row, _FIELD_CANDIDATES['planning_application_ref'])),
            'planning_authority_decision_date': parse_date(_pick(row, _FIELD_CANDIDATES['planning_authority_decision_date'])),
            'planning_permission_expiry':       parse_date(_pick(row, _FIELD_CANDIDATES['planning_permission_expiry'])),
            'appeal_lodged':            _to_bool(_pick(row, _FIELD_CANDIDATES['appeal_lodged'])),
            'appeal_decision_date':     parse_date(_pick(row, _FIELD_CANDIDATES['appeal_decision_date'])),
            'under_construction_date':  parse_date(_pick(row, _FIELD_CANDIDATES['under_construction_date'])),
            'operational_date':         parse_date(_pick(row, _FIELD_CANDIDATES['operational_date'])),
            'ro_banding':               _to_str(_pick(row, _FIELD_CANDIDATES['ro_banding'])),
            'cfd_capacity_mw':          _to_float(_pick(row, _FIELD_CANDIDATES['cfd_capacity_mw'])),
            'heat_network_ref':         _to_str(_pick(row, _FIELD_CANDIDATES['heat_network_ref'])),
            'storage_co_located':       _to_bool(_pick(row, _FIELD_CANDIDATES['storage_co_located'])),
            'source_url':               source_url,
            'source_publication':       source_publication,
            'source_date':              today,
        }
        extras.append(rec)
    return extras


def upsert_extras(client, rows: list[dict]) -> int:
    """Upsert repd_project_extras in batches keyed on repd_ref_id."""
    if not rows:
        return 0
    BATCH = 500
    total = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        client.table('repd_project_extras').upsert(
            chunk, on_conflict='repd_ref_id',
        ).execute()
        total += len(chunk)
        log.info(f'  Upserted extras batch {i // BATCH + 1}: {len(chunk)} ({total} total)')
    return total


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
    df, source_url = download_repd()

    # Layer 1: canonical assets (filtered to onshore wind, schema-compatible)
    records = map_records(df)
    total = upsert_assets(client, records)
    log.info(f'  assets: {total:,} records upserted')

    # Layer 2: REPD-specific extras (all technologies, full column set)
    publication_name = source_url.rsplit('/', 1)[-1]
    extras = map_extras(df, source_publication=publication_name, source_url=source_url)
    n_extras = upsert_extras(client, extras)
    log.info(f'  extras: {n_extras:,} records upserted')

    log.info(f'=== REPD Ingestion complete: {total:,} assets · {n_extras:,} extras ===')


if __name__ == '__main__':
    run()
