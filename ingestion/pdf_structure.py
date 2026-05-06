"""
pdf_structure.py — Note-aware PDF reader for IFRS / FRS-102 annual reports.

The decommissioning / asset-retirement liability lives in three structurally
invariant places:

  1. The Provisions note (IAS 37 disclosure)
  2. The Property, Plant & Equipment note (IAS 16.16(c) — capitalised decom cost)
  3. The Provisions accounting-policy paragraph (note 1 / 2)

Operators name the obligation differently — "Decommissioning", "Site
restoration", "Asset retirement", "Dilapidations", "Environmental" — but
the structural location is fixed. This module locates those three artefacts
by note heading + numbered-section pattern, not by lexical search across
the whole report.

Public entry point: extract_structural_artefacts(pdf_bytes) → dict.
"""

from __future__ import annotations

import re
import tempfile
from dataclasses import dataclass, field
from typing import Iterable

# pdfplumber import is deferred so callers can still import this module
# without the dep installed (e.g. for type checking).


# ── Note-heading regex ──────────────────────────────────────────────────────
#
# Matches lines that look like a note heading. We allow:
#   "Note 22 Provisions"
#   "22. Provisions for liabilities and charges"
#   "1.5 Significant accounting policies"
#   "22 PROVISIONS"
#
# We DON'T require trailing punctuation — many ARs put the heading on its
# own line followed by a blank line, with no period.

NOTE_HEADING_RE = re.compile(
    r"""^[ \t]*                              # optional leading whitespace
        (?:Note\s+)?                         # optional "Note " prefix
        (\d{1,2}(?:\.\d{1,2})?)              # capture: 1, 22, 1.5
        \.?[ \t]+                            # optional period, then space
        ([A-Z][A-Za-z][\w,\s\-\(\)\&\/'’]{2,80}?)  # capture: title
        [ \t]*$                              # end of line
    """,
    re.VERBOSE | re.MULTILINE,
)


@dataclass
class NoteSpan:
    """A located note within an annual report."""
    number: str                  # "22" or "1.5"
    title: str                   # "Provisions for liabilities and charges"
    start_page: int              # 0-indexed
    end_page: int                # 0-indexed (inclusive)
    body_text: str               # concatenated text, start_page..end_page
    tables_md: list[str] = field(default_factory=list)   # markdown-rendered tables


# ── Page text + table extraction ────────────────────────────────────────────

def extract_pages_text_and_tables(pdf_bytes: bytes) -> tuple[list[str], list[list[list[list[str]]]]]:
    """
    Return (pages_text, pages_tables) where:
      pages_text[i]   = full text of page i
      pages_tables[i] = list of tables on page i; each table = list of rows;
                        each row = list of cell strings.

    Text extraction is layered:
      1. pdfplumber.extract_text — works for most computer-generated PDFs.
      2. pypdfium2 fallback — used per-page when pdfplumber returns empty.
         Many CH filings use accounting-software PDFs with custom font
         encodings that defeat pdfplumber but pypdfium2 (Chrome's PDF
         engine) handles fine.

    Tables continue to come from pdfplumber (its table-detection is the
    main reason we use it).
    """
    import pdfplumber

    pages_text: list[str] = []
    pages_tables: list[list[list[list[str]]]] = []

    with tempfile.NamedTemporaryFile(suffix='.pdf') as tmp:
        tmp.write(pdf_bytes)
        tmp.flush()
        with pdfplumber.open(tmp.name) as pdf:
            for p in pdf.pages:
                try:
                    pages_text.append(p.extract_text() or '')
                except Exception:
                    pages_text.append('')
                try:
                    raw_tables = p.extract_tables() or []
                    cleaned = []
                    for tbl in raw_tables:
                        rows = [[(c or '').strip() for c in row] for row in tbl if row]
                        if rows and any(any(c for c in row) for row in rows):
                            cleaned.append(rows)
                    pages_tables.append(cleaned)
                except Exception:
                    pages_tables.append([])

    # Fallback for pages where pdfplumber returned empty: try pypdfium2.
    # Triggered when ≥50% of pages have no extractable text.
    n_empty = sum(1 for t in pages_text if not (t or '').strip())
    if n_empty >= max(1, int(0.5 * len(pages_text))):
        try:
            import pypdfium2 as pdfium
        except ImportError:
            return pages_text, pages_tables
        try:
            doc = pdfium.PdfDocument(pdf_bytes)
            for i in range(len(doc)):
                if (pages_text[i] or '').strip():
                    continue                # pdfplumber got it; don't overwrite
                try:
                    page = doc[i]
                    tp = page.get_textpage()
                    txt = tp.get_text_range() or ''
                    pages_text[i] = txt
                    tp.close()
                    page.close()
                except Exception:
                    pass
            doc.close()
        except Exception:
            pass

    return pages_text, pages_tables


def render_table_md(table: list[list[str]]) -> str:
    """Render a 2D string table as a GitHub-flavoured markdown table."""
    if not table:
        return ''
    # Normalise: pad rows to widest row
    width = max(len(r) for r in table)
    rows = [r + [''] * (width - len(r)) for r in table]
    # First row = header (best guess; many AR tables don't really separate)
    header = rows[0]
    body = rows[1:] if len(rows) > 1 else []
    md = ['| ' + ' | '.join(c.replace('\n', ' ').strip() for c in header) + ' |']
    md.append('| ' + ' | '.join(['---'] * width) + ' |')
    for r in body:
        md.append('| ' + ' | '.join(c.replace('\n', ' ').strip() for c in r) + ' |')
    return '\n'.join(md)


# ── Note discovery ──────────────────────────────────────────────────────────

# Plausible IFRS / FRS-102 note headings, normalised to lowercase. We match
# substrings of the located note title against any of these. Order matters
# only insofar as we report which match was used.
_KNOWN_NOTE_KEYWORDS: dict[str, tuple[str, ...]] = {
    'provisions': (
        'provisions for liabilities and charges',
        'provisions for liabilities',
        'provisions',
    ),
    'ppe': (
        'property, plant and equipment',
        'property plant and equipment',
        'tangible fixed assets',
        'tangible assets',
    ),
    'policies': (
        'significant accounting policies',
        'accounting policies',
        'summary of significant accounting policies',
        'material accounting policies',     # IFRS amendment Jan-2023
    ),
}


def _find_all_note_headings(pages_text: list[str]) -> list[tuple[int, str, str]]:
    """
    Return list of (page_idx, note_number, note_title) for every line that
    looks like a numbered-note heading. Ordered by page.
    """
    out: list[tuple[int, str, str]] = []
    for i, page in enumerate(pages_text):
        if not page:
            continue
        # We deliberately don't strip — preserve indentation cues
        for m in NOTE_HEADING_RE.finditer(page):
            num   = m.group(1).strip()
            title = m.group(2).strip().rstrip('.,;:')
            # Filter obvious false positives: title is mostly digits / units
            if re.fullmatch(r'[\d\s,.\-\$£€%]+', title):
                continue
            # Title shouldn't start with a verb-ish lowercase form
            if title and title[0].islower():
                continue
            out.append((i, num, title))
    return out


def _slice_note(pages_text: list[str],
                pages_tables: list[list[list[list[str]]]],
                start_page: int,
                end_page: int,
                max_pages: int = 10) -> tuple[str, list[str]]:
    """Concatenate body text + render tables for a note's page range."""
    end_page = min(end_page, start_page + max_pages - 1, len(pages_text) - 1)
    body_parts: list[str] = []
    table_parts: list[str] = []
    for i in range(start_page, end_page + 1):
        body_parts.append(f'\n[Page {i + 1}]\n{pages_text[i] or ""}')
        for t in pages_tables[i]:
            md = render_table_md(t)
            if md:
                table_parts.append(f'[Page {i + 1} — table]\n{md}')
    return '\n'.join(body_parts).strip(), table_parts


def find_note(pages_text: list[str],
              pages_tables: list[list[list[list[str]]]],
              keywords: Iterable[str]) -> NoteSpan | None:
    """
    Locate the FIRST note whose title contains any of the supplied keywords.

    The note's end_page is set to the page just before the next numbered
    note heading (or to the doc end if none found). Capped at 10 pages.
    """
    keywords_l = [k.lower() for k in keywords]
    headings = _find_all_note_headings(pages_text)
    if not headings:
        return None

    target_idx = None
    for k, (page_idx, num, title) in enumerate(headings):
        if any(kw in title.lower() for kw in keywords_l):
            target_idx = k
            break
    if target_idx is None:
        return None

    page_start, num, title = headings[target_idx]
    # End of section = page of next heading - 1 (or doc end)
    if target_idx + 1 < len(headings):
        page_end = max(page_start, headings[target_idx + 1][0] - 1)
    else:
        page_end = len(pages_text) - 1

    body, tables = _slice_note(pages_text, pages_tables, page_start, page_end)
    return NoteSpan(
        number=num, title=title,
        start_page=page_start, end_page=min(page_end, page_start + 9),
        body_text=body, tables_md=tables,
    )


# ── Public entry point ──────────────────────────────────────────────────────

def extract_structural_artefacts(pdf_bytes: bytes) -> dict:
    """
    Locate the three structural artefacts a real accountant would consult.
    Returns a dict with keys: provisions_note, ppe_note, policy_note,
    plus diagnostic info (page counts, headings_seen).

    Each note (when found) is a NoteSpan. Missing notes are None.
    """
    pages_text, pages_tables = extract_pages_text_and_tables(pdf_bytes)

    provisions_note = find_note(pages_text, pages_tables, _KNOWN_NOTE_KEYWORDS['provisions'])
    ppe_note        = find_note(pages_text, pages_tables, _KNOWN_NOTE_KEYWORDS['ppe'])
    policy_note     = find_note(pages_text, pages_tables, _KNOWN_NOTE_KEYWORDS['policies'])

    return {
        'num_pages':       len(pages_text),
        'headings_seen':   _find_all_note_headings(pages_text),
        'provisions_note': provisions_note,
        'ppe_note':        ppe_note,
        'policy_note':     policy_note,
    }


def format_note_for_llm(note: NoteSpan, label: str) -> str:
    """Build a labelled markdown block representing one note for the LLM."""
    head = (f'\n=========================\n'
            f'{label} — Note {note.number}: {note.title}\n'
            f'(pages {note.start_page + 1}–{note.end_page + 1})\n'
            f'=========================\n')
    body = note.body_text
    tables = ('\n\n--- TABLES ---\n\n' + '\n\n'.join(note.tables_md)) if note.tables_md else ''
    return head + body + tables
