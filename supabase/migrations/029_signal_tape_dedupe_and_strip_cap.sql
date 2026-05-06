-- Migration 029 — Stronger Signal Tape dedup + drop CAP pills
--
-- Two issues addressed:
--
--  (a) Capacity (CAP/CAP_UP/CAP_DN) tags were redundant noise — every event
--      already implies a capacity direction via its event_type. Strip them.
--
--  (b) Existing dedup signature was (event_type | scope | YYYY-MM | tokens),
--      too narrow. Articles about the same project from different angles
--      (e.g. one calls it "Decommissioning", another "Repowering Plan",
--      one is filed in March one in April) failed to match. Recompute
--      signature using entity-key ONLY, with a broader stopword list, and
--      collapse same-key rows across a 90-day window.

-- ── (a) Strip capacity tags from every row ─────────────────────────────

UPDATE watch_events
   SET liability_tags = ARRAY(
     SELECT t FROM unnest(liability_tags) t
     WHERE t NOT IN ('CAP','CAP_UP','CAP_DN')
   )
 WHERE liability_tags && ARRAY['CAP','CAP_UP','CAP_DN'];

-- ── (b1) Reset is_duplicate so cleanup can run idempotently ────────────
-- We want to reconsider every row, not lock in earlier dedup decisions.

UPDATE watch_events
   SET is_duplicate = false
 WHERE is_duplicate = true
   AND topic_signature IS NOT NULL;

-- ── (b2) Re-flag explainers / off-topic (re-applied from migration 027) ─

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

-- ── (b3) Recompute topic_signature using entity-key alone ──────────────
--
-- Stopwords expanded to match the Python ingestor:
--   * Grammatical articles + corporate suffixes (Ltd, PLC, Group…)
--   * Domain-generic nouns (wind, farm, project, power, solar, turbine, battery…)
--   * Action verbs (announces, awards, plans, completes…)
--   * Calendar tokens (january, q1, h2…)
--   * Quantity tokens (mw, gw, million…)
-- Token min length raised from 3 to 4 (drops "new", "top", "old").

WITH scored AS (
  SELECT
    e.id,
    encode(
      digest(
        COALESCE((
          SELECT string_agg(t, ' ' ORDER BY t)
          FROM (
            SELECT DISTINCT lower(t) AS t
            FROM regexp_split_to_table(COALESCE(e.headline,''), '[^A-Za-z0-9''\-]+') t
            WHERE length(t) >= 4
              AND NOT (lower(t) = ANY (ARRAY[
                'the','and','or','for','of','in','at','on','to','an','as','is','by','its','from','with','will','it','that','this','these','those',
                'plc','ltd','limited','llc','co','company','corp','corporation','inc','holdings','group','renewables','renewable','energy','energies',
                'wind','farm','farms','project','projects','power','solar','park','plant','site','turbine','turbines','blade','blades','battery','storage','bess',
                'announces','announced','plans','planned','wins','won','awards','awarded','launches','launched','starts','started','begins','began',
                'completes','completed','opens','opened','signs','signed','says','said','reports','reported','after','before','was','were','has','have','had','been','being',
                'january','february','march','april','may','june','july','august','september','october','november','december','q1','q2','q3','q4','h1','h2',
                'million','billion','thousand'
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
 WHERE e.id = s.id;

-- ── (b4) Collapse same-signature rows across a 90-day window ───────────
--
-- Within each topic_signature group, keep the row with the highest
-- confidence (High > Medium > Low) and on tie the earliest event_date.
-- Hide the rest.

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
  'migration_029_signal_tape_dedupe', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM watch_events WHERE is_duplicate = false),
  'Migration 029 — strip CAP tags + entity-key dedup',
  'Stripped CAP / CAP_UP / CAP_DN from all rows. Recomputed topic_signature using entity-key only with broader stopword list. Collapsed same-key rows by (confidence DESC, date ASC).'
);
