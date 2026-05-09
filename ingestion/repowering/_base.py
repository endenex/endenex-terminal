"""
Shared helpers for all repowering-projects ingestion scripts (Phase 1-3).

  • Stage normalisation — map upstream-specific status values to the
    five-stage enum used by the Terminal panel.
  • Asset-class normalisation — handle "wind" vs "onshore_wind" vs "WIND"
    naming differences across regulators.
  • Upsert helper — does ON CONFLICT (dedupe_key) DO UPDATE so a re-run
    of any ingestion script overwrites stale stage/status data without
    duplicating rows.
  • Date-cutoff helper — drops announcements older than MAX_AGE_YEARS
    (default 3). Applied across all ingestion scripts.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any

from base_ingestor import get_supabase_client, log


# Drop any announcement / mention older than this. The repowering panel
# is forward-looking; a 2010 wind farm's planning application doesn't
# represent current intent. Per user 2026-05-09: 3 years.
MAX_AGE_YEARS = 3
_OLDEST_ALLOWED = (date.today() - timedelta(days=365 * MAX_AGE_YEARS)).isoformat()


def is_too_old(date_str: str | None, today: str | None = None) -> bool:
    """True if date_str is older than MAX_AGE_YEARS. Handles None / parse
    failures by returning False (don't drop on missing date — let the
    caller decide).
    """
    if not date_str:
        return False
    parsed = parse_date(date_str)
    if not parsed:
        return False
    cutoff = (
        (datetime.fromisoformat(today).date() if today else date.today())
        - timedelta(days=365 * MAX_AGE_YEARS)
    ).isoformat()
    return parsed < cutoff


# ── Five-stage enum, matches CHECK constraint in migration 003 ──────────
VALID_STAGES = {
    'announced',
    'application_submitted',
    'application_approved',
    'permitted',
    'ongoing',
}

# ── Source-type enum values used in repowering_projects.source_type ─────
SOURCE_TYPES = {
    'repd', 'planning_application', 'planning_consent', 'permit_submission',
    'mastr', 'eeg_register',
    'ercot_giinr', 'caiso_queue', 'miso_queue', 'pjm_queue', 'nyiso_queue', 'spp_queue',
    'eia_form_860', 'boem_lease', 'blm_permit',
    'aemo_giinr', 'rte_open_data', 'terna_anagrafica', 'energistyrelsen',
    'rvo_sde', 'eirgrid_tso', 'meti_anre_fit', 'kepco_rps',
    'miteco_tramita', 'boe_gazette', 'regional_gazette',
    'sec_edgar', 'lse_rns', 'euronext_disclosure',
    'company_filing', 'investor_disclosure', 'company_press_release',
    'trade_press', 'regulator_announcement', 'industry_association',
    'airtable', 'manual',
}

# ── Stage mapping from common upstream values to enum ───────────────────
# Override per-source in each script if needed.
COMMON_STAGE_MAP: dict[str, str] = {
    # Generic
    'announced':              'announced',
    'announcement':           'announced',
    'pre-application':        'announced',
    'scoping':                'announced',
    'application_submitted':  'application_submitted',
    'submitted':              'application_submitted',
    'pending':                'application_submitted',
    'application_approved':   'application_approved',
    'approved':               'application_approved',
    'consented':              'application_approved',
    'permitted':              'permitted',
    'permit_issued':          'permitted',
    'awaiting_construction':  'permitted',
    'under_construction':     'ongoing',
    'commissioning':          'ongoing',
    'in_planning':            'application_submitted',
    'in_construction':        'ongoing',
    'ongoing':                'ongoing',
    # ERCOT / CAISO / AEMO interconnection-queue stages
    'study':                  'application_submitted',
    'feasibility':            'application_submitted',
    'system_impact':          'application_submitted',
    'facilities_study':       'application_approved',
    'ia_executed':            'permitted',
    'ia_signed':              'permitted',
    'commercial_operation':   'ongoing',          # construction underway
}

ASSET_CLASS_MAP: dict[str, str] = {
    'wind':           'onshore_wind',
    'onshore wind':   'onshore_wind',
    'onshore_wind':   'onshore_wind',
    'offshore wind':  'offshore_wind',
    'offshore_wind':  'offshore_wind',
    'solar':          'solar_pv',
    'solar pv':       'solar_pv',
    'solar_pv':       'solar_pv',
    'photovoltaic':   'solar_pv',
    'pv':             'solar_pv',
    'storage':        'bess',
    'battery':        'bess',
    'bess':           'bess',
    'energy storage': 'bess',
}


def normalise_stage(raw: str | None, mapping: dict[str, str] | None = None) -> str | None:
    if not raw:
        return None
    s = raw.strip().lower().replace(' ', '_').replace('-', '_')
    m = (mapping or {}) | COMMON_STAGE_MAP
    return m.get(s)


def normalise_asset_class(raw: str | None) -> str | None:
    if not raw:
        return None
    s = raw.strip().lower()
    return ASSET_CLASS_MAP.get(s)


# ── Project-name scrubber ────────────────────────────────────────────────
# Applied to LLM-emitted names BEFORE upsert. Mirrors the regex passes in
# migration 082 (capacity / year / expediente strip) and migration 083
# (English-form normalisation), plus Spanish/French anglicisation from
# migration 081. Defence-in-depth: even if the LLM slips on a prompt
# instruction, the row still lands clean.

_CAP_RE        = re.compile(r'\s*(de\s+|of\s+)?\d+(\.\d+)?\s*(mw(p|h)?|kw)\b', re.I)
_AREA_RE       = re.compile(r'\s*(de\s+)?\d+(\.\d+)?\s*(hectáreas|hectares|ha)\b', re.I)
_YEAR_PAREN_RE = re.compile(r'\s*\(\s*(años?\s+)?\d{4}([-–]\d{4})?\s*\)', re.I)
_EXPTE_RE      = re.compile(r'\s*(expediente|expte\.?|ref(\.|erencia)?\s+|dossier\s+)\s*\S+', re.I)

# Spanish / French → English form (subset of migration 081's regexes;
# applied here so re-ingestion produces the canonical form even if the
# LLM emits the original-language name). Named groups for clarity:
# "place" always captures the installation name itself.
_ES_EOLICO_RE  = re.compile(
    r'^parque\s+eólico(?:\s+de\s+(?:la|los|las)?\s*|\s+del\s+|\s+de\s+|\s+)(?P<place>.+)$', re.I,
)
_ES_SOLAR_RE   = re.compile(
    r'^planta\s+(?:solar|fotovoltaica)(?:\s+de\s+(?:la|los|las)?\s*|\s+del\s+|\s+de\s+|\s+)(?P<place>.+)$', re.I,
)
_FR_EOLIEN_RE  = re.compile(
    r"^parc\s+éolien(?:\s+(?:de\s+l'|de\s+la\s+|du\s+|de\s+|en\s+mer\s+de\s+l'|en\s+mer\s+))?(?P<place>.+)$", re.I,
)
_FR_SOLAR_RE   = re.compile(
    r"^(?:centrale\s+photovoltaïque|parc\s+solaire|centrale\s+solaire)(?:\s+(?:de\s+l'|de\s+la\s+|du\s+|de\s+))?(?P<place>.+)$", re.I,
)

# English-form reorder: "wind farm in X" → "X Wind Farm"
_EN_PREFIX_RE  = re.compile(
    r'^(?:the\s+)?(?P<class>wind|solar)\s+(?:farm|park|plant|project)\s+(?:in|at|of|around|near)\s+(?P<place>.+)$', re.I,
)
_EN_THE_RE     = re.compile(
    r'^the\s+(?P<place>.+?)\s+(?P<class>wind|solar)\s+(?:farm|park|plant|project)\s*$', re.I,
)


def clean_project_name(name: str) -> str:
    """Scrub LLM-emitted name to canonical "{Place} {Class} Farm" form.
    Handles capacity / year / expediente strip, multilingual prefix
    reorder, and trailing whitespace tidy. Idempotent: safe to call on
    already-clean names.
    """
    if not name:
        return name
    s = name.strip()

    # Anglicise Spanish / French prefixes (order matters — match longest
    # prefix first to avoid e.g. "Parc Solaire" being matched twice)
    for pat, suffix in (
        (_FR_SOLAR_RE,  'Solar Farm'),
        (_FR_EOLIEN_RE, 'Wind Farm'),
        (_ES_SOLAR_RE,  'Solar Farm'),
        (_ES_EOLICO_RE, 'Wind Farm'),
    ):
        m = pat.match(s)
        if m:
            s = f'{m.group("place").strip()} {suffix}'
            break  # one prefix at most

    # English-form reorder
    m = _EN_PREFIX_RE.match(s)
    if m:
        s = f'{m.group("place").strip()} {m.group("class").title()} Farm'
    else:
        m = _EN_THE_RE.match(s)
        if m:
            s = f'{m.group("place").strip()} {m.group("class").title()} Farm'

    # Strip embedded capacity / area / year / expediente
    s = _CAP_RE.sub('', s)
    s = _AREA_RE.sub('', s)
    s = _YEAR_PAREN_RE.sub('', s)
    s = _EXPTE_RE.sub('', s)

    # Tidy whitespace + leftover punctuation
    s = re.sub(r'\s+', ' ', s).strip(' ,.;:-')
    return s


def make_dedupe_key(project_name: str, country_code: str, asset_class: str) -> str:
    """Mirrors the Postgres trigger _normalise_project_name() / migration 079.

    Strips common renewable-industry suffixes ("wind farm", "solar park",
    "energy storage", etc.) and the leading "the" article BEFORE the
    alphanumeric strip, so "Tahivilla" and "Tahivilla wind farm" produce
    the same key.
    """
    s = (project_name or '').lower()
    # Two-word industry suffixes (longest first to avoid greedy mismatch)
    s = re.sub(
        r'\s+(wind\s+farm|wind\s+park|wind\s+project|wind\s+centre|wind\s+center|'
        r'solar\s+farm|solar\s+park|solar\s+plant|solar\s+pv|pv\s+plant|'
        r'battery\s+storage|energy\s+storage|battery\s+facility|bess|'
        r'energy\s+complex|energy\s+center|energy\s+centre)$',
        '', s,
    )
    # Single-word generic suffixes
    s = re.sub(r'\s+(farm|park|plant|project|facility|complex|centre|center)$', '', s)
    # Leading article
    s = re.sub(r'^the\s+', '', s)
    # Final alphanumeric strip
    norm = re.sub(r'[^a-zA-Z0-9]', '', s)
    return f'{norm}|{country_code}|{asset_class}'


def upsert_project(client, row: dict[str, Any]) -> bool:
    """
    Idempotent upsert keyed on dedupe_key. Returns True if inserted/updated.

    Rows MUST contain: project_name, country_code, asset_class, stage,
    source_type, source_date, confidence, derivation, last_reviewed.
    Optional: capacity_mw, developer, planning_reference, source_url,
    location_description, external_source_id, external_source.
    """
    required = ('project_name','country_code','asset_class','stage','source_type',
                'source_date','confidence','derivation','last_reviewed')
    missing = [k for k in required if k not in row]
    if missing:
        log.warning(f'    skipping row — missing required fields: {missing}')
        return False
    if row['stage'] not in VALID_STAGES:
        log.warning(f'    skipping row — invalid stage {row["stage"]!r}')
        return False
    if row['source_type'] not in SOURCE_TYPES:
        log.warning(f'    skipping row — unknown source_type {row["source_type"]!r}')
        return False

    # Dedupe-key trigger handles the column itself; just upsert.
    try:
        client.table('repowering_projects').upsert(
            row, on_conflict='dedupe_key',
        ).execute()
        return True
    except Exception as e:
        log.error(f'    upsert failed for {row.get("project_name")}: {e}')
        return False


def today_iso() -> str:
    return date.today().isoformat()


def parse_date(s: Any) -> str | None:
    """Best-effort date parse → ISO YYYY-MM-DD or None."""
    if s is None:
        return None
    if isinstance(s, (date, datetime)):
        return s.isoformat()[:10]
    s = str(s).strip()
    if not s:
        return None
    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%Y-%m', '%Y'):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None
