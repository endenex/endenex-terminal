#!/usr/bin/env python3
"""
Endenex Eye satellite-surveillance ingestion (Phase 1 scaffold).

For each facility in satellite_facilities:
  1. Fetch a recent true-colour Sentinel-2 L2A scene over the facility's
     bounding box (free; uses Sentinel Hub Process API).
  2. Upload the image to Supabase Storage public bucket 'satellite-imagery'.
  3. Send the image to Claude Sonnet vision API for a structured
     assessment: stockpile area, blade count estimate, capacity tightness,
     1-3 sentence narrative.
  4. Insert/upsert a row into satellite_observations.

Env vars required:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (already used by other ingest)
  ANTHROPIC_API_KEY                         (vision assessment)
  SENTINELHUB_CLIENT_ID + SENTINELHUB_CLIENT_SECRET   (free-tier API)

Phase-1 fallbacks (if any of the above is unset):
  • If SH credentials missing → script falls back to a placeholder URL
    (existing image_url on the facility's most recent observation, if any)
    so the LLM assessment can still run on a manually-uploaded image.
  • If ANTHROPIC_API_KEY missing → image is uploaded but no assessment
    written (capacity_tightness_pct = NULL, ai_assessment = NULL).

Usage:
  python3 fetch_satellite_imagery.py
  python3 fetch_satellite_imagery.py --facility "Holcim Lägerdorf"
  python3 fetch_satellite_imagery.py --dry-run

Honest scope note:
  Sentinel-2 is 10 m/pixel — fine for spotting stockpile-scale changes but
  too coarse to count individual blades. For blade-counting / facility-
  perimeter analysis, swap in Planet (3 m) or Maxar (30 cm) once budget
  allows. The script's Provider plumbing is provider-agnostic; adapt
  fetch_imagery() for whichever vendor.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from datetime import date, timedelta
from io import BytesIO
from typing import Any

import requests

from base_ingestor import get_supabase_client, log


ANTHROPIC_API_KEY  = os.environ.get('ANTHROPIC_API_KEY')
ANTHROPIC_MODEL    = 'claude-sonnet-4-5'   # vision-capable
SH_CLIENT_ID       = os.environ.get('SENTINELHUB_CLIENT_ID')
SH_CLIENT_SECRET   = os.environ.get('SENTINELHUB_CLIENT_SECRET')

# Endpoints. Defaults to Copernicus Data Space Ecosystem (CDSE) — permanent
# free tier of 30k PU/month. For paid commercial Sentinel Hub set
# SH_ENDPOINT=https://services.sentinel-hub.com instead.
SH_ENDPOINT        = os.environ.get('SH_ENDPOINT', 'https://sh.dataspace.copernicus.eu')
IS_CDSE            = 'dataspace.copernicus' in SH_ENDPOINT
# CDSE token endpoint is Keycloak-based (different from commercial Sentinel Hub).
SH_TOKEN_URL       = (
    'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token'
    if IS_CDSE else
    'https://services.sentinel-hub.com/oauth/token'
)
SH_PROCESS_URL     = f'{SH_ENDPOINT}/api/v1/process'

# How wide the bounding box around each facility (degrees, ~ at mid-lats)
BBOX_HALF_DEG      = 0.005    # ~500 m on a side at 45°N
IMAGE_PIXELS       = 1024     # output PNG side
LOOKBACK_DAYS      = 60       # search Sentinel-2 catalogue this far back
MAX_CLOUD_PCT      = 30


# ── Sentinel Hub OAuth ────────────────────────────────────────────────────

def sh_token() -> str | None:
    if not (SH_CLIENT_ID and SH_CLIENT_SECRET):
        return None
    r = requests.post(
        SH_TOKEN_URL,
        data={
            'grant_type':    'client_credentials',
            'client_id':     SH_CLIENT_ID,
            'client_secret': SH_CLIENT_SECRET,
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json()['access_token']


# ── Imagery fetch via Sentinel Hub Process API (true colour, 10 m) ───────

EVALSCRIPT_TRUECOLOR = """
//VERSION=3
function setup() {
  return {
    input:  [{ bands: ['B02','B03','B04'] }],
    output: { bands: 3 }
  }
}
function evaluatePixel(s) {
  return [s.B04 * 2.5, s.B03 * 2.5, s.B02 * 2.5]
}
"""


def fetch_imagery(token: str, lat: float, lng: float,
                  cutoff: str) -> tuple[bytes, str] | None:
    """
    Returns (png_bytes, observation_date) or None if no usable scene.
    Searches the Sentinel-2 L2A catalogue for the most recent scene with
    cloud cover <= MAX_CLOUD_PCT in the LOOKBACK_DAYS window.
    """
    bbox = [
        lng - BBOX_HALF_DEG,
        lat - BBOX_HALF_DEG,
        lng + BBOX_HALF_DEG,
        lat + BBOX_HALF_DEG,
    ]
    today = date.today().isoformat()

    # Process API: fetch true-colour PNG for the bbox over the time interval;
    # SH automatically picks the best (least-cloudy) scene.
    body: dict[str, Any] = {
        'input': {
            'bounds': {
                'bbox': bbox,
                'properties': { 'crs': 'http://www.opengis.net/def/crs/EPSG/0/4326' },
            },
            'data': [{
                'type': 'sentinel-2-l2a',
                'dataFilter': {
                    'timeRange': { 'from': f'{cutoff}T00:00:00Z', 'to': f'{today}T23:59:59Z' },
                    'maxCloudCoverage': MAX_CLOUD_PCT,
                    'mosaickingOrder': 'mostRecent',
                },
            }],
        },
        'output': {
            'width':    IMAGE_PIXELS,
            'height':   IMAGE_PIXELS,
            'responses':[{ 'identifier':'default', 'format': { 'type':'image/png' } }],
        },
        'evalscript': EVALSCRIPT_TRUECOLOR,
    }
    r = requests.post(
        SH_PROCESS_URL,
        headers={'Authorization': f'Bearer {token}', 'Accept': 'image/png'},
        json=body, timeout=120,
    )
    if r.status_code != 200:
        log.warning(f'    SH Process API {r.status_code}: {r.text[:200]}')
        return None
    # We don't get the precise scene date back from Process API — best-effort
    # is "today" as the observation date. Phase-2 should switch to Catalog
    # API + per-scene Process call to capture exact dates.
    return r.content, today


# ── Storage upload ───────────────────────────────────────────────────────

BUCKET = 'satellite-imagery'

def upload_image(client, png_bytes: bytes, key: str) -> str | None:
    """Upload to Supabase Storage; return public URL."""
    try:
        # supabase-py 2.x storage API
        client.storage.from_(BUCKET).upload(
            path=key, file=png_bytes, file_options={'content-type': 'image/png', 'upsert': 'true'},
        )
        return f'{client.supabase_url}/storage/v1/object/public/{BUCKET}/{key}'
    except Exception as e:
        log.warning(f'    upload failed: {e}')
        return None


# ── Claude Vision assessment ─────────────────────────────────────────────

ASSESSMENT_TOOL = {
    'name': 'submit_satellite_assessment',
    'description': (
        'Submit a structured assessment of a satellite image of a wind-blade / '
        'PV / battery recycling facility. The objective is to estimate the '
        'visible build-up of waste material on site (e.g. wind blade stockpiles) '
        'as a proxy for capacity tightness — high stockpile = inflow > outflow '
        '= facility tightening.'
    ),
    'input_schema': {
        'type':'object',
        'properties': {
            'stockpile_area_m2': {'type':'number','description':'Estimated area of visible waste/stockpile in square metres. 0 if none visible.'},
            'blade_count_estimate': {'type':'integer','description':'Estimated number of distinct wind-blade sections visible on site, 0 if not applicable or not visible.'},
            'capacity_tightness_pct': {'type':'integer','description':'Estimated capacity utilisation 0-150. >=85 = saturated/bottleneck. Base on stockpile size relative to typical facility footprint.'},
            'confidence': {'type':'string','enum':['low','medium','high']},
            'narrative': {'type':'string','description':'1-3 sentence plain-English assessment of what the imagery shows. Note any anomalies (new construction, expansion, fire damage, idle plant).'},
        },
        'required': ['stockpile_area_m2','capacity_tightness_pct','confidence','narrative'],
    },
}


def assess_with_claude(png_bytes: bytes, facility: dict) -> dict | None:
    if not ANTHROPIC_API_KEY:
        return None
    try:
        import anthropic
    except ImportError:
        log.error('anthropic required: pip install anthropic')
        return None
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    img_b64 = base64.standard_b64encode(png_bytes).decode('ascii')
    msg = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=1500,
        tools=[ASSESSMENT_TOOL],
        tool_choice={'type':'tool','name':'submit_satellite_assessment'},
        messages=[{
            'role':'user',
            'content':[
                {
                    'type':'image',
                    'source': {'type':'base64','media_type':'image/png','data':img_b64},
                },
                {
                    'type':'text',
                    'text': (
                        f"Satellite imagery of: {facility['name']} ({facility['operator_name']}). "
                        f"Facility type: {facility['facility_type']}. "
                        f"Asset class focus: {facility['asset_class']} (wind blades). "
                        f"Country: {facility['country']}. "
                        f"Nameplate capacity: {facility.get('capacity_kt_year') or 'unknown'} kt/yr. "
                        f"\n\nAnalyse the visible stockpile / waste-buildup signature. Submit your "
                        f"structured assessment via the submit_satellite_assessment tool. Note: this is "
                        f"Sentinel-2 imagery (10 m/pixel) — individual blades likely not distinguishable. "
                        f"Report what you can defensibly observe; flag confidence as 'low' if image is "
                        f"unclear or insufficient resolution for the question."
                    ),
                },
            ],
        }],
    )
    for block in msg.content:
        if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_satellite_assessment':
            return block.input
    return None


# ── Main ─────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--facility', help='Restrict to one facility name (substring match)')
    ap.add_argument('--dry-run',  action='store_true', help='Skip storage upload + DB insert')
    ap.add_argument('--image-path',
                    help='Use this LOCAL image file instead of pulling Sentinel-2. '
                         'Combine with --facility and --provider to assess a manually-'
                         'sourced high-res scene (Maxar / Planet / Pléiades Neo etc.).')
    ap.add_argument('--image-url',
                    help='Use an image already hosted at this URL (e.g. an existing '
                         'Supabase Storage public URL). Skips upload; just downloads the '
                         'bytes to send to the AI vision model and stores the URL in the '
                         'observation row.')
    ap.add_argument('--provider', default='manual',
                    help='Imagery provider tag for --image-path (sentinel-2 / planet / '
                         'maxar / pleiades / pleiades-neo / skysat / capella-sar / manual).')
    ap.add_argument('--resolution-m', type=float,
                    help='Resolution in metres for the manual image (e.g. 0.3 for Maxar).')
    ap.add_argument('--obs-date',
                    help='Observation date for the manual image (YYYY-MM-DD); defaults to today.')
    args = ap.parse_args()

    client = get_supabase_client()
    today  = date.today().isoformat()
    cutoff = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()

    log.info(f'=== Endenex Eye satellite ingestion · {today} ===')

    # Pull facility list
    q = client.table('satellite_facilities').select('*').eq('status','active')
    res = q.execute()
    facilities: list[dict] = list(res.data or [])
    if args.facility:
        facilities = [f for f in facilities if args.facility.lower() in f['name'].lower()]
    log.info(f'  {len(facilities)} facility/ies in scope')
    if not facilities:
        log.warning('  no facilities matched; exiting')
        return

    # Sentinel Hub auth (optional)
    token = None
    if SH_CLIENT_ID and SH_CLIENT_SECRET:
        try:
            token = sh_token()
            log.info('  Sentinel Hub auth ok')
        except Exception as e:
            log.warning(f'  SH auth failed: {e}')
    else:
        log.warning('  SENTINELHUB_CLIENT_ID/SECRET not set — skipping imagery pull '
                    '(Phase-1 manual seed mode; assessment will not run on new images)')

    inserted = 0
    skipped  = 0

    for f in facilities:
        log.info(f'  → {f["name"]} ({f["country"]}, {f["facility_type"]}) lat={f["lat"]} lng={f["lng"]}')

        png_bytes: bytes | None  = None
        obs_date: str            = args.obs_date or today
        image_url: str | None    = None
        provider: str            = args.provider
        resolution: float | None = args.resolution_m

        # Manual high-res image — already hosted at a URL (e.g. Supabase Storage)
        if args.image_url:
            try:
                r = requests.get(args.image_url, timeout=60)
                r.raise_for_status()
                png_bytes = r.content
                image_url = args.image_url
                log.info(f'    using image at {args.image_url} ({len(png_bytes)/1024:.0f} KB) '
                         f'· {provider} · {resolution or "?"} m/px')
            except Exception as e:
                log.error(f'    failed to download image: {e}')
                skipped += 1
                continue
        # Manual high-res image override (local file → upload to storage)
        elif args.image_path:
            try:
                with open(args.image_path, 'rb') as fh:
                    png_bytes = fh.read()
                log.info(f'    using manual image {args.image_path} ({len(png_bytes)/1024:.0f} KB) '
                         f'· {provider} · {resolution or "?"} m/px')
                ext = os.path.splitext(args.image_path)[1].lstrip('.') or 'png'
                key = f'{f["id"]}/{obs_date}-{provider}.{ext}'
                if not args.dry_run:
                    image_url = upload_image(client, png_bytes, key)
            except Exception as e:
                log.error(f'    failed to read image: {e}')
                skipped += 1
                continue
        # 1. fetch imagery
        elif token:
            result = fetch_imagery(token, float(f['lat']), float(f['lng']), cutoff)
            if result:
                png_bytes, obs_date = result
                provider = 'sentinel-2'
                resolution = 10
                key = f'{f["id"]}/{obs_date}-sentinel2.png'
                if not args.dry_run:
                    image_url = upload_image(client, png_bytes, key)
                log.info(f'    imagery fetched ({len(png_bytes)/1024:.0f} KB) · {obs_date}')
            else:
                log.warning('    no usable Sentinel-2 scene in lookback window')

        # 2. assess with Claude (if image + key)
        assessment: dict | None = None
        if png_bytes and ANTHROPIC_API_KEY:
            try:
                assessment = assess_with_claude(png_bytes, f)
                if assessment:
                    log.info(f'    AI: tightness {assessment.get("capacity_tightness_pct")}% '
                             f'· {assessment.get("confidence")} · "{assessment.get("narrative","")[:80]}…"')
            except Exception as e:
                log.warning(f'    Claude vision failed: {e}')

        # 3. write observation row
        if not args.dry_run and (image_url or assessment):
            row = {
                'facility_id':           f['id'],
                'observation_date':      obs_date,
                'image_url':             image_url,
                'imagery_provider':      provider,
                'resolution_m':          resolution,
                'cloud_cover_pct':       None,
                'stockpile_area_m2':     assessment.get('stockpile_area_m2') if assessment else None,
                'capacity_tightness_pct':assessment.get('capacity_tightness_pct') if assessment else None,
                'blade_count_estimate':  assessment.get('blade_count_estimate') if assessment else None,
                'ai_assessment':         assessment.get('narrative') if assessment else None,
                'ai_model':              ANTHROPIC_MODEL if assessment else None,
                'confidence':            assessment.get('confidence') if assessment else None,
                'source_url':            'https://www.sentinel-hub.com',
            }
            try:
                client.table('satellite_observations').upsert(
                    row, on_conflict='facility_id,observation_date,imagery_provider',
                ).execute()
                inserted += 1
            except Exception as e:
                log.error(f'    upsert failed: {e}')
                skipped += 1
        else:
            skipped += 1

    if not args.dry_run:
        client.table('ingestion_runs').insert({
            'pipeline':           'fetch_satellite_imagery',
            'status':             'success',
            'started_at':         f'{today}T00:00:00Z',
            'finished_at':        f'{today}T00:00:00Z',
            'records_written':    inserted,
            'source_attribution': 'Sentinel-2 L2A via Sentinel Hub Process API + Claude Sonnet vision',
            'notes':              f'Endenex Eye Phase-1 · {inserted} observations · {skipped} skipped.',
        }).execute()

    log.info(f'=== complete: {inserted} observations · {skipped} skipped ===')


if __name__ == '__main__':
    main()
