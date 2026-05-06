#!/usr/bin/env python3
"""
Signal Tape headline rewriter — FT / Bloomberg editorial grade.

Walks watch_events looking for rows where:
  • headline_rewritten IS NULL (not yet rewritten)
  • headline_rewrite_unchanged IS NOT TRUE (we didn't already decide to skip)
  • is_duplicate = FALSE (no point rewriting hidden rows)

For each row, calls Claude Haiku with forced tool-use to produce either:
  • a rewritten headline that conforms to FT/Bloomberg conventions, OR
  • a no-rewrite signal (is_unchanged=TRUE) when the original is already
    FT-grade or rewriting would risk changing the meaning.

Why tool-use instead of plain text completion: forcing structured output
gives us deterministic JSON, sidesteps "Sure, here is the rewritten..."
preambles, and lets the model REFUSE to rewrite when appropriate.

Cost: ~$0.0001 per headline on Haiku. 50 headlines/day = $0.02/day = $7/year.

Required env vars: ANTHROPIC_API_KEY · SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY

CLI:
  python3 rewrite_headlines.py                     # process pending
  python3 rewrite_headlines.py --limit 10          # cap at N rewrites
  python3 rewrite_headlines.py --redo              # force re-run on rows
                                                    # already rewritten
  python3 rewrite_headlines.py --row <uuid>        # one specific row
  python3 rewrite_headlines.py --dry-run           # show pending; no API call
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import json
from datetime import date

from base_ingestor import get_supabase_client, log


ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '').strip()
MODEL_NAME        = 'claude-haiku-4-5'
MAX_OUTPUT_TOKENS = 256
MAX_HEADLINE_LEN  = 100   # FT/Bloomberg headlines rarely exceed 90 chars


# ── Style guide (baked into system prompt) ─────────────────────────────

SYSTEM_PROMPT = """You are a wire-service editor at the Financial Times. Your job is to rewrite raw RSS headlines from renewable-energy trade press into terse, factual headlines that match FT / Bloomberg house style.

HOUSE STYLE — DO:
• Subject-Verb-Object, active voice. Lead with the actor (operator / company / regulator), not the action.
• Use the past tense for completed events ("awarded", "filed", "secured"); present infinitive for plans ("to repower", "to dismantle").
• Specific numbers when available — capacity in MW or GW; count of turbines; £m or $m for sums.
• Country or region only when not obvious from the actor.
• Under 90 characters. Headlines fit on a single Terminal line.
• Sentence case for the body; capitalise proper nouns and place names.
• "as" subordinator is fine for compound headlines ("Iberdrola seeks contractor for Cádiz repower as fleet ages").

HOUSE STYLE — DON'T:
• No clickbait adjectives: "massive", "huge", "stunning", "shocking", "revealed", "exclusive".
• No questions, no exclamation marks, no editorialising.
• Don't paraphrase facts you can't verify from the original headline. If the original says "third repowering project", don't change it to "fourth".
• Don't add details (capacity, cost, dates) that aren't in the original.
• Don't strip details that ARE in the original (project name, place, count).
• Don't translate non-English place names ("Cádiz" stays "Cádiz", not "Cadiz").
• Don't use "we", "our", "you" — third-person only.

EXAMPLES (input → output):
• "Statkraft will reduce by more than 70% the number of turbines at two wind farms in Cádiz" → "Statkraft to cut Cádiz turbine count by 70% across two wind farms"
• "ScottishPower picks contractor for Hagshaw Hill repower" → unchanged (already FT-grade)
• "Hagshaw Hill: how a Scottish wind farm is being repowered" → unchanged is_unchanged=true (this is an explainer; don't try to rewrite into news)
• "Statkraft's wind repowering in Cádiz will reduce turbines from 34 to 9" → "Statkraft to replace 34 Cádiz turbines with 9 in repower"
• "Massive £200m blade-recycling deal struck with Vestas" → "Vestas wins £200m blade-recycling deal"

WHEN TO RETURN is_unchanged=true:
• The original headline is already FT-grade.
• The original lacks enough information for a meaningful rewrite (e.g. stub announcements without subject or action).
• Rewriting would risk changing the meaning or inventing facts.

Always call the `rewrite_headline` tool. Never produce free-form text.
"""

REWRITE_TOOL = {
    'name': 'rewrite_headline',
    'description': 'Return either a FT/Bloomberg-grade rewrite or signal that no rewrite is appropriate.',
    'input_schema': {
        'type': 'object',
        'properties': {
            'rewritten_headline': {
                'type': ['string', 'null'],
                'description': 'The rewritten headline. NULL if is_unchanged is true. Max 100 chars.',
            },
            'is_unchanged': {
                'type': 'boolean',
                'description': 'TRUE when no rewrite is appropriate (original already FT-grade, insufficient info, or rewriting risks changing meaning).',
            },
            'confidence': {
                'type': 'string',
                'enum': ['high', 'medium', 'low'],
                'description': 'Confidence in the rewrite (or in the decision to leave unchanged).',
            },
            'rationale': {
                'type': 'string',
                'description': 'One short sentence on the editorial decision (kept for audit).',
            },
        },
        'required': ['is_unchanged', 'confidence', 'rationale'],
    },
}


# ── Anthropic call ─────────────────────────────────────────────────────

def call_claude(headline: str, summary: str | None, scope: str | None,
                event_type: str | None) -> dict | None:
    try:
        import anthropic
    except ImportError:
        log.error('anthropic required: pip install anthropic')
        sys.exit(1)
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    user_msg = (
        f'Original headline: "{headline}"\n\n'
        f'Context (do NOT add facts to the rewrite — context is for editorial judgment only):\n'
        f'  Region: {scope or "—"}\n'
        f'  Event type: {event_type or "—"}\n'
        f'  Summary line from source: {summary or "—"}\n\n'
        f'Call rewrite_headline once.'
    )

    for attempt in range(3):
        try:
            msg = client.messages.create(
                model=MODEL_NAME,
                max_tokens=MAX_OUTPUT_TOKENS,
                system=SYSTEM_PROMPT,
                tools=[REWRITE_TOOL],
                tool_choice={'type': 'tool', 'name': 'rewrite_headline'},
                messages=[{'role': 'user', 'content': user_msg}],
            )
            for block in msg.content:
                if getattr(block, 'type', None) == 'tool_use' and block.name == 'rewrite_headline':
                    return block.input
            log.warning('  no tool_use returned')
            return None
        except Exception as e:
            wait = 2 ** attempt * 5
            log.warning(f'  Claude error (attempt {attempt + 1}): {e}; sleeping {wait}s')
            time.sleep(wait)
    return None


# ── Per-row pipeline ───────────────────────────────────────────────────

def process_row(client, row: dict, dry_run: bool = False) -> str:
    """Returns one of: 'rewrote', 'unchanged', 'failed', 'skipped'."""
    rid       = row['id']
    headline  = (row.get('headline') or '').strip()
    summary   = row.get('notes')
    scope     = row.get('scope')
    event_t   = row.get('event_type')
    if not headline:
        return 'skipped'

    if dry_run:
        log.info(f'  [dry] {headline[:80]}')
        return 'skipped'

    result = call_claude(headline, summary, scope, event_t)
    if not result:
        return 'failed'

    is_unchanged = bool(result.get('is_unchanged'))
    rewrite      = (result.get('rewritten_headline') or '').strip()
    confidence   = result.get('confidence') or 'low'
    rationale    = result.get('rationale')

    # Sanity guard: reject implausible rewrites
    if not is_unchanged:
        if not rewrite:
            is_unchanged = True
            rationale = (rationale or '') + ' [empty rewrite → treated as unchanged]'
        elif len(rewrite) > MAX_HEADLINE_LEN:
            log.info(f'    rewrite too long ({len(rewrite)} chars); marking unchanged')
            is_unchanged = True
        elif rewrite.lower() == headline.lower():
            is_unchanged = True

    update = {
        'headline_rewriter_model':    MODEL_NAME,
        'headline_rewritten_at':      __import__('datetime').datetime.utcnow().isoformat() + 'Z',
        'headline_rewrite_unchanged': is_unchanged,
    }
    if not is_unchanged:
        update['headline_rewritten'] = rewrite

    try:
        client.table('watch_events').update(update).eq('id', rid).execute()
        if is_unchanged:
            log.info(f'  ↳ unchanged · {rationale or ""}')
            return 'unchanged'
        log.info(f'  ↳ "{rewrite}" · conf={confidence}')
        return 'rewrote'
    except Exception as e:
        log.warning(f'    update failed: {e}')
        return 'failed'


# ── Telemetry + main ───────────────────────────────────────────────────

def _log_run(client, status: str, n_rewrote: int, n_unchanged: int,
             n_failed: int, error: str | None = None, notes: str = ''):
    try:
        client.table('ingestion_runs').insert({
            'pipeline':           'rewrite_headlines',
            'status':             status,
            'started_at':         f'{date.today()}T00:00:00Z',
            'finished_at':        f'{date.today()}T00:00:01Z',
            'records_written':    n_rewrote,
            'source_attribution': f'Anthropic {MODEL_NAME} · forced tool-use · FT/Bloomberg style guide',
            'notes':              notes or f'rewrote {n_rewrote} · left unchanged {n_unchanged} · failed {n_failed}',
            'error_message':      error,
        }).execute()
    except Exception as e:
        log.warning(f'telemetry write failed: {e}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit',    type=int, default=200, help='Max rewrites in one run (rate-limit guard).')
    ap.add_argument('--redo',     action='store_true',  help='Re-run on rows that already have a rewrite.')
    ap.add_argument('--row',      help='UUID of a single watch_events row.')
    ap.add_argument('--dry-run',  action='store_true',  help='List candidates without calling Claude.')
    args = ap.parse_args()

    if not args.dry_run and not ANTHROPIC_API_KEY:
        sys.exit('ANTHROPIC_API_KEY missing (or use --dry-run)')

    client = get_supabase_client()

    q = client.table('watch_events').select('id, headline, notes, scope, event_type') \
        .eq('is_duplicate', False) \
        .order('event_date', desc=True) \
        .limit(args.limit)
    if args.row:
        q = q.eq('id', args.row)
    elif not args.redo:
        # Default: only rows we haven't seen
        q = q.is_('headline_rewritten', 'null') \
             .is_('headline_rewrite_unchanged', 'null')
    rows = q.execute().data or []

    log.info(f'=== Headline rewriter · {len(rows)} candidates · model={MODEL_NAME} {"[DRY RUN]" if args.dry_run else ""} ===')
    n_rewrote = n_unchanged = n_failed = 0

    try:
        for r in rows:
            log.info(f'  {(r.get("headline") or "")[:80]}')
            outcome = process_row(client, r, dry_run=args.dry_run)
            if   outcome == 'rewrote':   n_rewrote += 1
            elif outcome == 'unchanged': n_unchanged += 1
            elif outcome == 'failed':    n_failed += 1
        log.info(f'=== complete: rewrote {n_rewrote} · unchanged {n_unchanged} · failed {n_failed} ===')
        _log_run(client, 'success' if n_failed == 0 else 'partial',
                 n_rewrote, n_unchanged, n_failed)
    except Exception as e:
        log.exception('rewrite aborted')
        _log_run(client, 'failure', n_rewrote, n_unchanged, n_failed, error=str(e))
        sys.exit(1)


if __name__ == '__main__':
    main()
