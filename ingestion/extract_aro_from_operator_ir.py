#!/usr/bin/env python3
"""
Operator IR-site PDF → ARO extraction.

For each operator in operator_ir_sources with a populated latest_ar_url,
download the consolidated annual report PDF, run the structural locator
(Provisions note + PP&E note + Accounting Policies), hand to Claude
with the same forced tool-use schema we use for CH filings, and persist
to aro_extractions (linked via ir_pdf_filing_id, not filing_id).

Why this beats the CH-SPV path:
  • IR PDFs are publication-grade — always have a text layer.
  • Consolidated AR has a proper Provisions note (group-level IAS 37).
  • One PDF covers the operator's entire fleet → high information density.
  • No SPV bridging required — we go straight to the entity that discloses.

Reuses pdf_structure.py and the same EXTRACTION_TOOL schema as the CH
extractor (extract_aro_from_pdfs.py) so analyst review is uniform across
both source types via aro_extractions.

Required env vars: ANTHROPIC_API_KEY · SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY

CLI:
  python3 extract_aro_from_operator_ir.py
  python3 extract_aro_from_operator_ir.py --operator "Greencoat UK Wind PLC"
  python3 extract_aro_from_operator_ir.py --dry-run    # download + locate, no LLM
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import json
from datetime import date

import requests

from base_ingestor import get_supabase_client, log
from pdf_structure import extract_structural_artefacts, format_note_for_llm, NoteSpan


ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '').strip()
USER_AGENT        = 'endenex-terminal/1.0 (operator IR PDF research)'
MODEL_NAME        = 'claude-haiku-4-5'
MAX_OUTPUT_TOKENS = 1024
MAX_PROMPT_CHARS  = 80_000


# Reuse the same tool-use schema as the CH extractor.
# (Could refactor into a shared module; keeping inline for clarity.)
EXTRACTION_TOOL = {
    'name': 'record_aro_provision',
    'description': (
        'Record the closing balance of any end-of-asset-life obligation '
        '(decommissioning / asset retirement / site restoration / '
        'environmental / dilapidations) disclosed in the Provisions note. '
        'Must be supported by a verbatim source_quote.'
    ),
    'input_schema': {
        'type': 'object',
        'properties': {
            'period_end':                       {'type': 'string'},
            'prior_period_end':                 {'type': ['string','null']},
            'currency':                         {'type': 'string', 'enum': ['GBP','EUR','USD','DKK','SEK','NOK','PLN']},
            'scale':                            {'type': 'string', 'enum': ['raw','thousands','millions']},
            'decom_provision_amount':           {'type': ['number','null']},
            'prior_decom_provision_amount':     {'type': ['number','null']},
            'movement_recognised_in_year':      {'type': ['number','null']},
            'movement_settled_in_year':         {'type': ['number','null']},
            'movement_unwinding_discount':      {'type': ['number','null']},
            'movement_fx':                      {'type': ['number','null']},
            'decom_concept_label':              {'type': ['string','null']},
            'is_separately_disclosed':          {'type': 'boolean'},
            'is_aggregated_in_other':           {'type': 'boolean'},
            'no_decom_provision_found':         {'type': 'boolean'},
            'ppe_decom_addition_present':       {'type': ['boolean','null']},
            'source_quote':                     {'type': 'string'},
            'source_page':                      {'type': ['integer','null']},
            'confidence':                       {'type': 'string', 'enum': ['high','medium','low']},
            'notes':                            {'type': ['string','null']},
        },
        'required': ['period_end','currency','scale','is_separately_disclosed',
                     'is_aggregated_in_other','no_decom_provision_found',
                     'source_quote','confidence'],
    },
}

SYSTEM_PROMPT = """You are an audit-grade financial-analyst assistant.

Your task: read the supplied STRUCTURAL EXTRACTS from a single operator's CONSOLIDATED annual report and call `record_aro_provision` exactly once with the closing-balance figure for end-of-asset-life obligations recognised at the GROUP level.

You will be given up to three extracts:
  1. The PROVISIONS NOTE (IAS 37). Look for a roll-forward table whose columns are labelled by category — Decommissioning, Site restoration, Asset retirement obligations, Dilapidations, Environmental, Restoration. The DECOM COLUMN is the answer; closing balance row is the figure.
  2. The PROPERTY, PLANT & EQUIPMENT NOTE (IAS 16.16(c)). Capitalised decom cost first appears here. If PP&E shows additions for "Decommissioning" or similar, set ppe_decom_addition_present=true.
  3. The ACCOUNTING POLICIES paragraph on Provisions / ARO.

Rules:
  • Identify the decom-flavoured COLUMN by what it represents, not by exact phrasing. Operators use different labels for the same concept.
  • If a roll-forward separates renewable assets from other (e.g. nuclear, hydrocarbons), report the RENEWABLE-related figure; note the segmentation in `notes`.
  • Use the figure as PRESENTED. Header "£m" → scale="millions"; "DKK 'm" → scale="millions". Don't pre-multiply.
  • source_quote is verbatim from the extract — never paraphrased.
  • confidence="high" only when the Provisions roll-forward has an explicit decom-flavoured column with a closing balance row.
  • Some operators (Greencoat-style investment entities under IFRS 10) don't recognise ARO at the holding level — set no_decom_provision_found=true if you see investment-entity exemption language.
"""


# ── HTTP / extraction helpers ─────────────────────────────────────────────

def fetch_pdf(url: str) -> bytes | None:
    try:
        resp = requests.get(url, timeout=180,
                            headers={'User-Agent': USER_AGENT})
        if resp.status_code != 200:
            log.warning(f'    HTTP {resp.status_code} on PDF download')
            return None
        ct = (resp.headers.get('content-type') or '').lower()
        if 'pdf' not in ct and not resp.content[:4] == b'%PDF':
            log.warning(f'    response is not a PDF (content-type={ct})')
            return None
        return resp.content
    except Exception as e:
        log.warning(f'    PDF fetch failed: {e}')
        return None


def call_claude(operator_name: str, country: str, period_hint: int | None,
                extracts: list[str]) -> dict | None:
    try:
        import anthropic
    except ImportError:
        log.error('anthropic required: pip install anthropic')
        sys.exit(1)
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    body = '\n\n'.join(extracts)[:MAX_PROMPT_CHARS]

    user_msg = (
        f'Operator: {operator_name} ({country})\n'
        f'Reporting year hint: {period_hint or "unknown"}\n\n'
        f'STRUCTURAL EXTRACTS BELOW.\n'
        f'Identify the decom-flavoured column of the Provisions roll-forward '
        f'and call record_aro_provision once.\n\n'
        f'{body}'
    )

    for attempt in range(3):
        try:
            msg = client.messages.create(
                model=MODEL_NAME,
                max_tokens=MAX_OUTPUT_TOKENS,
                system=SYSTEM_PROMPT,
                tools=[EXTRACTION_TOOL],
                tool_choice={'type': 'tool', 'name': 'record_aro_provision'},
                messages=[{'role': 'user', 'content': user_msg}],
            )
            usage = getattr(msg, 'usage', None)
            for block in msg.content:
                if getattr(block, 'type', None) == 'tool_use' and block.name == 'record_aro_provision':
                    return {
                        'tool_input':        block.input,
                        'prompt_tokens':     getattr(usage, 'input_tokens',  None),
                        'completion_tokens': getattr(usage, 'output_tokens', None),
                    }
            return None
        except Exception as e:
            wait = 2 ** attempt * 5
            log.warning(f'  Claude error (attempt {attempt + 1}): {e}; sleeping {wait}s')
            time.sleep(wait)
    return None


_SCALE = {'raw': 1, 'thousands': 1_000, 'millions': 1_000_000}

def to_raw(amount, scale):
    if amount is None or scale not in _SCALE:
        return None
    return float(amount) * _SCALE[scale]


# ── Per-operator pipeline ─────────────────────────────────────────────────

def process_operator(client, op: dict, dry_run: bool = False) -> bool:
    name = op['operator_name']
    url  = (op.get('latest_ar_url') or '').strip()
    if not url:
        log.info(f'  {name}: no latest_ar_url set — skipping (visit ir_landing_url to find current AR)')
        return False

    log.info(f'  {name} ({op.get("country")}) · AR {op.get("latest_ar_year") or "?"}')

    # Skip if already extracted
    existing = client.table('ir_pdf_filings').select('id') \
        .eq('operator_ir_source_id', op['id']).eq('document_url', url).limit(1).execute()
    if existing.data:
        filing_id = existing.data[0]['id']
        prev = client.table('aro_extractions').select('id') \
            .eq('ir_pdf_filing_id', filing_id).eq('model_name', MODEL_NAME).limit(1).execute()
        if prev.data:
            log.info(f'    already extracted (filing_id={filing_id}); skipping')
            return False
    else:
        filing_id = None

    log.info(f'    downloading PDF ({url[:80]}…)')
    pdf_bytes = fetch_pdf(url)
    if not pdf_bytes:
        return False

    log.info(f'    locating notes…')
    art = extract_structural_artefacts(pdf_bytes)
    pn: NoteSpan | None = art['provisions_note']
    pp: NoteSpan | None = art['ppe_note']
    pc: NoteSpan | None = art['policy_note']

    found_summary = ' · '.join(filter(None, [
        f'Provisions={pn.number}@p{pn.start_page+1}-{pn.end_page+1}' if pn else 'Provisions=NOT FOUND',
        f'PP&E={pp.number}@p{pp.start_page+1}-{pp.end_page+1}'         if pp else None,
        f'Policy={pc.number}@p{pc.start_page+1}-{pc.end_page+1}'       if pc else None,
    ]))
    log.info(f'    {art["num_pages"]} pages, {len(art["headings_seen"])} note headings · {found_summary}')

    relevant_pages: list[int] = []
    if pn: relevant_pages += list(range(pn.start_page+1, pn.end_page+2))
    if pp: relevant_pages += list(range(pp.start_page+1, pp.end_page+2))
    if pc: relevant_pages += list(range(pc.start_page+1, pc.end_page+2))

    filing_row = {
        'operator_ir_source_id': op['id'],
        'document_url':          url,
        'reporting_period':      f'FY{op.get("latest_ar_year")}' if op.get('latest_ar_year') else None,
        'reporting_period_end':  op.get('latest_ar_published_date'),
        'num_pages':             art['num_pages'],
        'relevant_pages':        sorted(set(relevant_pages)),
        'download_status':       'success',
    }
    if filing_id:
        client.table('ir_pdf_filings').update(filing_row).eq('id', filing_id).execute()
    else:
        up = client.table('ir_pdf_filings').upsert(
            filing_row, on_conflict='operator_ir_source_id,document_url',
            returning='representation',
        ).execute()
        filing_id = (up.data or [{}])[0].get('id')

    if not pn:
        log.info('    Provisions note not located — skipping LLM call')
        return True

    if dry_run:
        log.info('    [dry-run] skipping Claude call')
        return True

    extracts = [format_note_for_llm(pn, 'PROVISIONS NOTE')]
    if pp: extracts.append(format_note_for_llm(pp, 'PROPERTY, PLANT & EQUIPMENT NOTE'))
    if pc: extracts.append(format_note_for_llm(pc, 'ACCOUNTING POLICIES NOTE'))

    result = call_claude(name, op.get('country'), op.get('latest_ar_year'), extracts)
    if not result:
        log.warning('    no extraction returned')
        return False

    ti = result['tool_input']
    extraction = {
        'ir_pdf_filing_id':                 filing_id,
        'period_end':                       ti.get('period_end'),
        'prior_period_end':                 ti.get('prior_period_end'),
        'currency':                         ti.get('currency'),
        'scale':                            ti.get('scale'),
        'decom_provision_amount':           ti.get('decom_provision_amount'),
        'decom_provision_amount_raw':       to_raw(ti.get('decom_provision_amount'),       ti.get('scale')),
        'prior_decom_provision_amount':     ti.get('prior_decom_provision_amount'),
        'prior_decom_provision_amount_raw': to_raw(ti.get('prior_decom_provision_amount'), ti.get('scale')),
        'movement_recognised_in_year':      ti.get('movement_recognised_in_year'),
        'movement_settled_in_year':         ti.get('movement_settled_in_year'),
        'movement_unwinding_discount':      ti.get('movement_unwinding_discount'),
        'movement_fx':                      ti.get('movement_fx'),
        'is_separately_disclosed':          ti.get('is_separately_disclosed'),
        'is_aggregated_in_other':           ti.get('is_aggregated_in_other'),
        'no_decom_provision_found':         ti.get('no_decom_provision_found'),
        'decom_concept_label':              ti.get('decom_concept_label'),
        'source_quote':                     ti.get('source_quote'),
        'source_page':                      ti.get('source_page'),
        'confidence':                       ti.get('confidence'),
        'notes':                            ti.get('notes'),
        'model_name':                       MODEL_NAME,
        'raw_tool_input':                   json.loads(json.dumps(ti)),
        'prompt_token_count':               result.get('prompt_tokens'),
        'completion_token_count':           result.get('completion_tokens'),
    }

    try:
        client.table('aro_extractions').insert(extraction).execute()
        amt = ti.get('decom_provision_amount')
        ccy = ti.get('currency', '')
        if ti.get('no_decom_provision_found'):
            log.info(f'    NO decom provision disclosed (confidence={ti.get("confidence")})')
        elif amt is not None:
            log.info(f'    {ccy} {amt:,} ({ti.get("scale")}) · "{ti.get("decom_concept_label") or "—"}" · confidence={ti.get("confidence")}')
        else:
            log.info(f'    aggregated/unclear · confidence={ti.get("confidence")}')
        return True
    except Exception as e:
        log.warning(f'    extraction insert failed: {e}')
        return False


# ── Telemetry + main ──────────────────────────────────────────────────────

def _log_run(client, status, n_processed, n_extracted, error=None):
    try:
        client.table('ingestion_runs').insert({
            'pipeline':           'extract_aro_from_operator_ir',
            'status':             status,
            'started_at':         f'{date.today()}T00:00:00Z',
            'finished_at':        f'{date.today()}T00:00:01Z',
            'records_written':    n_extracted,
            'source_attribution': 'Operator IR-site PDFs (consolidated annual reports) → pdf_structure → Claude tool-use',
            'notes':              f'{n_processed} operators processed · {n_extracted} extractions written',
            'error_message':      error,
        }).execute()
    except Exception as e:
        log.warning(f'telemetry write failed: {e}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--operator', help='Restrict to a single operator (ILIKE %X% on operator_name).')
    ap.add_argument('--dry-run',  action='store_true', help='Skip LLM call (cost-free).')
    args = ap.parse_args()

    if not args.dry_run and not ANTHROPIC_API_KEY:
        sys.exit('ANTHROPIC_API_KEY missing (or use --dry-run)')

    client = get_supabase_client()
    q = client.table('operator_ir_sources').select('*').order('operator_name')
    if args.operator:
        q = q.ilike('operator_name', f'%{args.operator}%')
    try:
        ops = q.execute().data or []
    except Exception as e:
        # Migration 038 may not be applied to this Supabase project.
        # Log + exit cleanly so the daily pipeline doesn't show a red
        # failure for a dormant feature.
        msg = str(e)
        if 'PGRST205' in msg or 'operator_ir_sources' in msg or 'schema cache' in msg:
            log.warning('operator_ir_sources table missing — apply migration 038 to enable this feature. Exiting cleanly.')
            try:
                _log_run(client, 'partial', 0, 0, error='operator_ir_sources table missing (migration 038 not applied)')
            except Exception:
                pass
            sys.exit(0)
        raise

    log.info(f'=== Operator IR ARO extraction · {len(ops)} operators · model={MODEL_NAME} {"[DRY RUN]" if args.dry_run else ""} ===')
    n_proc, n_ext = 0, 0
    failures: list[str] = []
    try:
        for op in ops:
            try:
                ok = process_operator(client, op, dry_run=args.dry_run)
                if ok:
                    n_proc += 1
                    if not args.dry_run:
                        n_ext += 1
            except Exception as e:
                log.exception(f'  failed: {op.get("operator_name")}')
                failures.append(f'{op.get("operator_name")} ({type(e).__name__})')
        log.info(f'=== complete: {n_proc} operators · {n_ext} extractions ===')
        _log_run(client, 'success' if not failures else 'partial', n_proc, n_ext)
    except Exception as e:
        log.exception('aborted')
        _log_run(client, 'failure', n_proc, n_ext, error=str(e))
        sys.exit(1)


if __name__ == '__main__':
    main()
