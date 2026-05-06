-- Migration 027 — Signal Tape quality cleanup
--
-- Three problems with the current Signal Tape feed:
--   1. The same story appears multiple times when carried by different RSS
--      sources (reNEWS + Energy Voice + Wind Power Monthly all run a story
--      about the same UK wind decom contract).
--   2. Off-topic items leaked through the keyword filter — rooftop solar,
--      LV grid extensions, household PV explainers — none decom-relevant.
--   3. Editorial quality of headlines: "How to retrofit..." / "5 things you
--      need to know..." style listicles and explainers don't belong on a
--      signal tape.
--
-- This migration:
--   (a) Adds topic_signature column for deterministic cross-source dedup.
--   (b) Retroactively marks existing low-quality rows is_duplicate=true so
--       they disappear from the panel immediately (data is preserved).
--   (c) Collapses cross-source duplicates among existing rows.

-- ── (a) topic_signature column ─────────────────────────────────────────

ALTER TABLE watch_events
  ADD COLUMN IF NOT EXISTS topic_signature text;

CREATE INDEX IF NOT EXISTS watch_events_topic_signature_idx
  ON watch_events(topic_signature)
  WHERE topic_signature IS NOT NULL;

-- ── (b) Hide explainers / listicles / off-topic items ──────────────────

WITH offtopic AS (
  SELECT id FROM watch_events
  WHERE is_duplicate = false
    AND (
         lower(headline) ~ '^(how to|why |what is |what are |what does |guide to |explainer:|opinion:|comment:|analysis:)'
      OR lower(headline) ~ '\m(top 5|top 10|5 ways|10 ways|7 things|things you need to know|beginners?\s+guide)\M'
      OR lower(headline) ~ '\m(rooftop|domestic solar|home solar|home battery|low.voltage|lv extension)\M'
      OR lower(headline) ~ '\m(ev charg|electric vehicle char)\M'
      OR lower(headline) ~ '\m(price cap|household bills|energy bills|cost of living)\M'
      OR lower(headline) ~ '\moutlook 202[0-9]|forecast 202[0-9]\M'
    )
)
UPDATE watch_events
   SET is_duplicate = true
 WHERE id IN (SELECT id FROM offtopic);

-- ── (c) Backfill topic_signature for legacy rows ───────────────────────
-- Same hash recipe as Python: (event_type | scope | YYYY-MM | entity-key).
-- "entity-key" = sorted distinct lowercased proper-noun tokens, stopwords
-- stripped. Done in pure SQL via regexp_split + array filtering.

WITH scored AS (
  SELECT
    e.id,
    encode(
      digest(
        e.event_type || '|' || COALESCE(e.scope,'') || '|' ||
        to_char(COALESCE(e.event_date, current_date), 'YYYY-MM') || '|' ||
        COALESCE((
          SELECT string_agg(t, ' ' ORDER BY t)
          FROM (
            SELECT DISTINCT lower(t) AS t
            FROM regexp_split_to_table(COALESCE(e.headline,''), '[^A-Za-z0-9''\-]+') t
            WHERE length(t) > 2
              AND NOT (lower(t) = ANY (ARRAY[
                'the','and','or','for','of','in','at','on','to','a','an','as',
                'is','by','its','from','with','will','it','that','this','these',
                'those','plc','ltd','limited','llc','co','company',
                'wind','farm','project','power','energy'
              ]))
          ) z
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
 WHERE e.id = s.id
   AND (e.topic_signature IS NULL OR e.topic_signature <> substring(s.sig, 1, 16));

-- ── (c-cont) Collapse same-signature rows: keep oldest, hide rest ──────

WITH ranked AS (
  SELECT id, topic_signature, event_date, created_at,
         ROW_NUMBER() OVER (
           PARTITION BY topic_signature
           ORDER BY event_date ASC NULLS LAST,
                    created_at ASC NULLS LAST,
                    id ASC
         ) AS rn
  FROM watch_events
  WHERE topic_signature IS NOT NULL
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
)
SELECT
  'migration_027_signal_tape_cleanup', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM watch_events WHERE is_duplicate = true),
  'Migration 027 — signal-tape quality cleanup',
  'Added topic_signature column · retroactively hid explainers / off-topic / cross-source duplicates · cleanup count = total is_duplicate rows';
