#!/usr/bin/env python3
"""
Operator-PDF + LLM ARO extraction (structural redesign).

For every UK company in ch_companies_watch:
  1. Download the most recent annual-accounts PDF from CH Document API.
  2. Run the structural locator (pdf_structure.py) to find the three
     accounting-invariant artefacts:
        a. Provisions note (IAS 37 disclosure)
        b. Property, Plant & Equipment note (IAS 16.16(c) — capitalised
           decom cost lives here)
        c. Provisions accounting-policy paragraph
  3. Hand all three to Claude with a structural classification task:
     "Identify the column of the Provisions roll-forward that represents
     end-of-asset-life obligations." — not a keyword search.
  4. Persist structured tool-use output to aro_extractions, status='pending'.

Why this beats the lexical keyword approach: operators name the obligation
differently (Decommissioning, Restoration, Asset retirement, Dilapidations,
Environmental), but the structural location is invariant. Reading the
Provisions note table directly catches obligations our keyword filter
would miss, and the LLM does what it's good at — interpreting accounting
context — instead of being asked to find pages we should have found
ourselves.

Required env vars:
  CH_API_KEY                  Companies House API key
  ANTHROPIC_API_KEY           Anthropic API key (Claude)
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

CLI:
  python3 extract_aro_from_pdfs.py
  python3 extract_aro_from_pdfs.py --company 05566064
  python3 extract_aro_from_pdfs.py --dry-run
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


# ── Configuration ──────────────────────────────────────────────────────────

CH_API_KEY        = os.environ.get('CH_API_KEY', '').strip()
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '').strip()
PUBLIC_API        = 'https://api.company-information.service.gov.uk'
REQUEST_SPACING_S = 0.6

MODEL_NAME        = 'claude-haiku-4-5'
MAX_OUTPUT_TOKENS = 1024
MAX_PROMPT_CHARS  = 80_000          # ≈20k input tokens; sanity guard


# ── Tool-use schema ───────────────────────────────────────────────────────

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
            'period_end':                       {'type': 'string',  'description': 'YYYY-MM-DD reporting-period end.'},
            'prior_period_end':                 {'type': ['string','null']},
            'currency':                         {'type': 'string',  'enum': ['GBP','EUR','USD','DKK','SEK','NOK','PLN']},
            'scale':                            {'type': 'string',  'enum': ['raw','thousands','millions']},

            # The headline answer
            'decom_provision_amount':           {'type': ['number','null'], 'description': 'Closing balance of the decom-flavoured column of the Provisions note table, in displayed scale.'},
            'prior_decom_provision_amount':     {'type': ['number','null']},

            # Movement (optional, often visible in the same table)
            'movement_recognised_in_year':      {'type': ['number','null']},
            'movement_settled_in_year':         {'type': ['number','null']},
            'movement_unwinding_discount':      {'type': ['number','null']},
            'movement_fx':                      {'type': ['number','null']},

            # Disclosure-quality flags — these tell us *what kind* of disclosure exists
            'decom_concept_label':              {'type': ['string','null'], 'description': 'Verbatim column header used in the Provisions note table — e.g. "Decommissioning", "Site restoration", "Asset retirement obligations", "Dilapidations".'},
            'is_separately_disclosed':          {'type': 'boolean', 'description': 'TRUE if the Provisions roll-forward has a dedicated decom-flavoured COLUMN (not buried in "Other").'},
            'is_aggregated_in_other':           {'type': 'boolean', 'description': 'TRUE if decom is bundled inside "Other provisions" with no standalone figure.'},
            'no_decom_provision_found':         {'type': 'boolean', 'description': 'TRUE only if the Provisions note has no decom-flavoured column AND the AR contains no other ARO disclosure (e.g. IFRS-10 investment-entity exemption).'},

            # PP&E cross-check (IAS 16.16(c) — capitalised decom cost in PP&E)
            'ppe_decom_addition_present':       {'type': ['boolean','null'], 'description': 'TRUE if the PP&E note shows additions for capitalised decommissioning / restoration cost. NULL if PP&E note unavailable.'},

            # Provenance — verbatim only
            'source_quote':                     {'type': 'string', 'description': '1–3 sentences copied verbatim from the Provisions note (or PP&E note if more authoritative). NEVER paraphrased.'},
            'source_page':                      {'type': ['integer','null']},

            'confidence':                       {'type': 'string', 'enum': ['high','medium','low']},
            'notes':                            {'type': ['string','null']},
        },
        'required': ['period_end', 'currency', 'scale',
                     'is_separately_disclosed', 'is_aggregated_in_other',
                     'no_decom_provision_found',
                     'source_quote', 'confidence'],
    },
}


SYSTEM_PROMPT = """You are an audit-grade financial-analyst assistant.

Your task: read the supplied STRUCTURAL EXTRACTS from a single company's annual report and call `record_aro_provision` exactly once with the closing-balance figure for any end-of-asset-life obligation.

You will be given up to three extracts:
  1. The PROVISIONS NOTE (IAS 37 disclosure). Look for a roll-forward table whose columns are labelled by category — Decommissioning, Site restoration, Asset retirement obligations, Dilapidations, Environmental, Restoration. The DECOM COLUMN is the answer; its closing balance row (typically "At 31 December 20XX") is the figure.
  2. The PROPERTY, PLANT & EQUIPMENT NOTE (IAS 16.16(c)). Capitalised decom cost first appears here. If the PP&E note shows additions for "Decommissioning" or similar, that confirms (1) and you should set ppe_decom_addition_present=true.
  3. The ACCOUNTING POLICIES paragraph on Provisions / ARO. This DEFINES what the company calls the obligation — anchor your concept matching to the policy language.

Rules:
  • Identify the decom-flavoured COLUMN of the Provisions roll-forward by what it represents (end-of-asset-life obligation), not by exact phrasing. Companies use different labels for the same concept.
  • If the Provisions note has NO decom-flavoured column, set is_separately_disclosed=false. If it's bundled in "Other provisions" with no standalone figure, set is_aggregated_in_other=true. If the AR is genuinely silent on decom AND no PP&E decom additions are visible, set no_decom_provision_found=true.
  • Investment-entity YieldCos (Greencoat-style under IFRS 10) typically don't recognise ARO at the holding level — recognise that pattern from policy language and set no_decom_provision_found=true.
  • Use the figure as PRESENTED. Header "£m" → scale="millions"; "£000" → scale="thousands". Do not pre-multiply.
  • source_quote is a verbatim copy of 1–3 sentences from the extracts — never paraphrased. If you cite a table cell, quote the cell's row label and value verbatim.
  • confidence="high" only when the Provisions note has an explicit decom-flavoured column with a closing balance row. "medium" when bundled or implied. "low" when uncertain.
"""


# ── HTTP helpers ───────────────────────────────────────────────────────────

def _ch_get(url: str, accept: str = 'application/json', stream: bool = False):
    time.sleep(REQUEST_SPACING_S)
    return requests.get(
        url, auth=(CH_API_KEY, ''),
        headers={'Accept': accept, 'User-Agent': 'endenex-terminal/1.0'},
        stream=stream, timeout=120, allow_redirects=True,
    )


def find_latest_accounts_filing(company_number: str) -> dict | None:
    resp = _ch_get(f'{PUBLIC_API}/company/{company_number}/filing-history?category=accounts&items_per_page=10')
    if resp.status_code != 200:
        return None
    items = [i for i in (resp.json().get('items') or []) if i.get('links', {}).get('document_metadata')]
    return items[0] if items else None


def fetch_pdf(metadata_url: str) -> bytes | None:
    meta = _ch_get(metadata_url)
    if meta.status_code != 200:
        return None
    if 'application/pdf' not in (meta.json().get('resources') or {}):
        return None
    resp = _ch_get(metadata_url + '/content', accept='application/pdf', stream=True)
    if resp.status_code != 200:
        return None
    return resp.content


# ── Anthropic call ─────────────────────────────────────────────────────────

def call_claude(company_name: str, company_number: str, period_end_hint: str | None,
                extracts: list[str]) -> dict | None:
    try:
        import anthropic
    except ImportError:
        log.error('anthropic required: pip install anthropic')
        sys.exit(1)

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    body = '\n\n'.join(extracts)[:MAX_PROMPT_CHARS]

    user_msg = (
        f'Company: {company_name} (Companies House #{company_number})\n'
        f'Period-end hint from filing metadata: {period_end_hint or "unknown"}\n\n'
        f'STRUCTURAL EXTRACTS FROM THE ANNUAL REPORT BELOW.\n'
        f'Identify the decom-flavoured column of the Provisions roll-forward and '
        f'return its closing balance via record_aro_provision.\n\n'
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
            log.warning('  Claude returned no tool_use block')
            return None
        except Exception as e:
            wait = 2 ** attempt * 5
            log.warning(f'  Claude error (attempt {attempt + 1}): {e}; sleeping {wait}s')
            time.sleep(wait)
    return None


# ── Currency normalisation ─────────────────────────────────────────────────

_SCALE = {'raw': 1, 'thousands': 1_000, 'millions': 1_000_000}

def to_raw(amount: float | None, scale: str | None) -> float | None:
    if amount is None or scale not in _SCALE:
        return None
    return float(amount) * _SCALE[scale]


# ── Per-company pipeline ───────────────────────────────────────────────────

def process_company(client, watch: dict, dry_run: bool = False, debug_pages: bool = False) -> bool:
    cn = watch['company_number']
    name = watch['company_name']
    log.info(f'  {cn} {name}')

    f = find_latest_accounts_filing(cn)
    if not f:
        log.info('    no accounts filings found')
        return False

    txn_id     = f.get('transaction_id')
    period_end = (f.get('description_values') or {}).get('made_up_date')
    date_filed = f.get('date')
    meta_url   = (f.get('links') or {}).get('document_metadata')
    if not meta_url or not txn_id:
        log.info('    filing has no document_metadata link')
        return False

    # Skip if already extracted with this model
    existing = client.table('aro_pdf_filings').select('id') \
        .eq('company_number', cn).eq('transaction_id', txn_id).limit(1).execute()
    if existing.data:
        filing_id = existing.data[0]['id']
        prev = client.table('aro_extractions').select('id') \
            .eq('filing_id', filing_id).eq('model_name', MODEL_NAME).limit(1).execute()
        if prev.data:
            log.info(f'    already extracted (filing_id={filing_id}); skipping')
            return False
    else:
        filing_id = None

    log.info('    downloading PDF…')
    pdf_bytes = fetch_pdf(meta_url)
    if not pdf_bytes:
        log.warning('    PDF unavailable from CH Document API')
        return False

    # ── Structural extraction (replaces keyword filter) ─────────────────
    log.info('    locating notes…')
    art = extract_structural_artefacts(pdf_bytes)
    if debug_pages and not art['provisions_note']:
        # Dump samples of what pdfplumber actually returned so we can see
        # whether text extraction is succeeding and the regex is the problem,
        # or text extraction itself is failing on this PDF.
        from pdf_structure import extract_pages_text_and_tables
        ptext, _ = extract_pages_text_and_tables(pdf_bytes)
        log.info(f'    [debug] dumping first 500 chars of first 10 pages of {cn}:')
        for i in range(min(10, len(ptext))):
            sample = (ptext[i] or '').replace('\n', ' ⏎ ')[:500]
            log.info(f'    [debug] p{i+1:>3}: {sample!r}')
    pn: NoteSpan | None = art['provisions_note']
    pp: NoteSpan | None = art['ppe_note']
    pc: NoteSpan | None = art['policy_note']

    found_summary = ' · '.join(filter(None, [
        f'Provisions={pn.number}@p{pn.start_page + 1}-{pn.end_page + 1}' if pn else 'Provisions=NOT FOUND',
        f'PP&E={pp.number}@p{pp.start_page + 1}-{pp.end_page + 1}'         if pp else None,
        f'Policy={pc.number}@p{pc.start_page + 1}-{pc.end_page + 1}'       if pc else None,
    ]))
    log.info(f'    {art["num_pages"]} pages, {len(art["headings_seen"])} note headings · {found_summary}')

    relevant_pages: list[int] = []
    if pn: relevant_pages += list(range(pn.start_page + 1, pn.end_page + 2))   # 1-indexed
    if pp: relevant_pages += list(range(pp.start_page + 1, pp.end_page + 2))
    if pc: relevant_pages += list(range(pc.start_page + 1, pc.end_page + 2))

    # Persist filing row with note locations recorded
    filing_row = {
        'company_number': cn,
        'transaction_id': txn_id,
        'period_end':     period_end,
        'date_filed':     date_filed,
        'document_url':   meta_url,
        'num_pages':      art['num_pages'],
        'relevant_pages': sorted(set(relevant_pages)),
    }
    if filing_id:
        client.table('aro_pdf_filings').update(filing_row).eq('id', filing_id).execute()
    else:
        up = client.table('aro_pdf_filings').upsert(
            filing_row, on_conflict='company_number,transaction_id', returning='representation',
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

    result = call_claude(name, cn, period_end, extracts)
    if not result:
        log.warning('    no extraction returned')
        return False

    ti = result['tool_input']
    extraction = {
        'filing_id':                        filing_id,
        'company_number':                   cn,
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
        client.table('aro_extractions').upsert(
            extraction, on_conflict='filing_id,model_name',
        ).execute()
        amount = ti.get('decom_provision_amount')
        scale  = ti.get('scale', 'raw')
        ccy    = ti.get('currency', '')
        if ti.get('no_decom_provision_found'):
            log.info(f'    NO decom provision disclosed (confidence={ti.get("confidence")})')
        elif amount is not None:
            log.info(f'    {ccy} {amount:,} ({scale}) · "{ti.get("decom_concept_label") or "—"}" · confidence={ti.get("confidence")}')
        else:
            log.info(f'    aggregated/unclear · confidence={ti.get("confidence")}')
        return True
    except Exception as e:
        log.warning(f'    extraction upsert failed: {e}')
        return False


# ── Telemetry + main ───────────────────────────────────────────────────────

def _log_run(client, status, n_filings, n_extracted, error=None, notes=''):
    try:
        client.table('ingestion_runs').insert({
            'pipeline':        'extract_aro_from_pdfs',
            'status':          status,
            'started_at':      f'{date.today()}T00:00:00Z',
            'finished_at':     f'{date.today()}T00:00:01Z',
            'records_written': n_extracted,
            'source_attribution': 'CH Document API (PDF) → pdf_structure → Claude tool-use',
            'notes':           notes or f'{n_filings} filings · {n_extracted} extractions',
            'error_message':   error,
        }).execute()
    except Exception as e:
        log.warning(f'telemetry write failed: {e}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--company',  help='Restrict to a single company_number')
    ap.add_argument('--dry-run',  action='store_true', help='Skip LLM call (cost-free)')
    ap.add_argument('--debug-pages', action='store_true',
                    help='When Provisions note not found, dump first 500 chars of first 10 pages so we can see what pdfplumber actually returned.')
    args = ap.parse_args()

    if not CH_API_KEY:
        sys.exit('CH_API_KEY missing')
    if not args.dry_run and not ANTHROPIC_API_KEY:
        sys.exit('ANTHROPIC_API_KEY missing (or use --dry-run)')

    client = get_supabase_client()
    q = client.table('ch_companies_watch').select('*').order('company_name')
    if args.company:
        q = q.eq('company_number', args.company)
    watch = q.execute().data or []

    log.info(f'=== ARO PDF extraction (structural) · {len(watch)} companies · model={MODEL_NAME} {"[DRY RUN]" if args.dry_run else ""} ===')
    n_filings, n_extracted = 0, 0
    failures: list[str] = []

    try:
        for w in watch:
            try:
                ok = process_company(client, w, dry_run=args.dry_run, debug_pages=args.debug_pages)
                if ok:
                    n_filings += 1
                    if not args.dry_run:
                        n_extracted += 1
            except Exception as e:
                log.exception(f'  failed: {w.get("company_number")}')
                failures.append(f'{w.get("company_number")} ({type(e).__name__})')

        notes = f'{n_filings} filings processed · {n_extracted} extractions written'
        if failures:
            notes += f' · failures: {", ".join(failures)}'
        log.info(f'=== complete: {notes} ===')
        _log_run(client, 'success' if not failures else 'partial', n_filings, n_extracted, notes=notes)
    except Exception as e:
        log.exception('extraction aborted')
        _log_run(client, 'failure', n_filings, n_extracted, error=str(e))
        sys.exit(1)


if __name__ == '__main__':
    main()
