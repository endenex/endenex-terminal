-- Migration 030 — Proper-noun-only entity_key dedup
--
-- Migration 029's entity_key kept all non-stopword tokens length≥4. Failed
-- on the Statkraft Cádiz example: three articles about the same project
-- got three different signatures because (a) the regex dropped accented
-- characters so 'Cádiz' was lost, (b) "Statkraft" vs "Statkraft's" were
-- treated as different tokens, (c) common verbs like 'reduce', 'plans',
-- 'third' inflated the token sets so exact-match dedup failed.
--
-- This migration switches to PROPER-NOUN-ONLY extraction:
--   • Keep only tokens whose first character was UPPERCASE in the original
--     headline (proper-noun heuristic).
--   • Strip diacritics so 'Cádiz' = 'cadiz', 'Ørsted' = 'orsted'.
--   • Strip apostrophes & possessives so 'Statkraft's' = 'statkraft'.
--   • Sort + space-join + sha1 → 16-char hex signature.
--
-- Requires the unaccent extension. Idempotent.

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- for digest()

-- ── Reset is_duplicate so re-grouping is fresh ─────────────────────────

UPDATE watch_events
   SET is_duplicate = false
 WHERE is_duplicate = true
   AND topic_signature IS NOT NULL;

-- ── Re-flag explainers / off-topic (stable filter from migration 027) ───

UPDATE watch_events
   SET is_duplicate = true
 WHERE is_duplicate = false
   AND (
        lower(headline) ~ '^(how to|why |what is |what are |what does |guide to |explainer:|opinion:|comment:|analysis:)'
     OR lower(headline) ~ '\m(top 5|top 10|5 ways|10 ways|7 things|things you need to know|beginners?\s+guide)\M'
     OR lower(headline) ~ '\m(rooftop|domestic solar|home solar|home battery|low.voltage|lv extension)\M'
     OR lower(headline) ~ '\m(ev charg|electric vehicle char)\M'
     OR lower(headline) ~ '\m(price cap|household bills|energy bills|cost of living)\M'
     OR lower(headline) ~ '\moutlook 202[0-9]|forecast 202[0-9]\M'
   );

-- ── Recompute topic_signature using proper-noun-only extraction ────────
--
-- Postgres regex matches against ORIGINAL-case headline to find capitalised
-- tokens, then per-token: unaccent → lowercase → strip 's → strip ' and -
-- → drop if in stopwords or length < 3.

WITH scored AS (
  SELECT
    e.id,
    encode(
      digest(
        COALESCE((
          SELECT string_agg(t, ' ' ORDER BY t)
          FROM (
            SELECT DISTINCT
              -- Per-token normalisation pipeline
              regexp_replace(
                regexp_replace(
                  rtrim(rtrim(lower(unaccent(raw)), 's'), ''''),
                  '''', '', 'g'
                ),
                '-', '', 'g'
              ) AS t
            FROM (
              -- Capitalised tokens only: starts with an uppercase letter
              -- (incl. accented uppercase via Unicode \p{Lu} — but Postgres
              -- doesn't support \p, so we use a manual character class
              -- covering ASCII A-Z plus common Latin-1 accented uppercase).
              SELECT (regexp_matches(
                COALESCE(e.headline, ''),
                '[A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ][\w''\-]*',
                'g'
              ))[1] AS raw
            ) caps
            WHERE raw IS NOT NULL
          ) z
          WHERE length(t) >= 3
            AND NOT (t = ANY (ARRAY[
              'wind','solar','farm','farms','project','projects','power','energy','energies',
              'turbine','turbines','blade','blades','battery','storage','park','plant','site',
              'plc','ltd','limited','llc','company','corp','corporation','inc','holdings',
              'group','renewables','renewable',
              'january','february','march','april','may','june','july','august','september',
              'october','november','december',
              'the','for','from','with',
              'plans','planned','wins','awards','awarded','announces','announced',
              'launches','launched','signs','signed','starts','started','completes','completed',
              'opens','opened','says','said','reports','reported'
            ]))
        ),''),
        'sha1'
      ),
      'hex'
    ) AS sig
  FROM watch_events e
)
UPDATE watch_events e
   SET topic_signature = substring(s.sig, 1, 16)
  FROM scored s
 WHERE e.id = s.id;

-- ── Collapse same-signature rows (keep highest-confidence + earliest) ───

WITH ranked AS (
  SELECT id, topic_signature,
         ROW_NUMBER() OVER (
           PARTITION BY topic_signature
           ORDER BY
             CASE confidence WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
             event_date ASC NULLS LAST,
             created_at ASC NULLS LAST,
             id ASC
         ) AS rn
  FROM watch_events
  WHERE topic_signature IS NOT NULL
    AND topic_signature <> ''
    AND topic_signature <> 'da39a3ee5e6b4b0d'   -- empty-string sha1 prefix
    AND is_duplicate = false
)
UPDATE watch_events e
   SET is_duplicate = true
  FROM ranked r
 WHERE e.id = r.id
   AND r.rn > 1;

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_030_proper_noun_dedupe', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM watch_events WHERE is_duplicate = false),
  'Migration 030 — proper-noun entity_key dedup',
  'Switched topic_signature to extract only capitalised tokens, accent-stripped, apostrophe-stripped. Statkraft / Cádiz / Ørsted style names now collapse correctly across language variants.'
);
