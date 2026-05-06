-- Migration 028 — Directional liability tags
--
-- The existing liability_tags column carries blunt CAP / PROV / REC_UP+REC_DN
-- codes that don't tell the user which way the underlying balance moves.
-- Particularly bad: every Material Recovery story was tagged with BOTH
-- REC_UP and REC_DN, which is logically incoherent.
--
-- This migration replaces non-directional tags with directional ones based
-- on the event_type + headline content of each row:
--
--   Repowering Announcement         → CAP_UP
--   Decommissioning                 → CAP_DN, PROV_UP
--   Contractor Awarded (decom)      → CAP_DN
--   Contractor Awarded (repower)    → CAP_UP
--   Insolvency                      → PROV_UP
--   Material Recovery Update        → REC_UP   if headline mentions price up
--                                     REC_DN   if headline mentions price down
--                                     (else: drop the tag — direction unknown)
--
-- Rows where the lexicons can't determine direction keep the legacy
-- non-directional tag (CAP / PROV) as a fallback.

-- Helper: token-bag check on lowercased text. Inlined to avoid creating a
-- function we'd then have to clean up.

-- Set the liability_tags array per-row by event_type + headline analysis.

UPDATE watch_events e
   SET liability_tags = sub.new_tags
  FROM (
    SELECT
      e.id,
      ARRAY(
        SELECT DISTINCT t FROM unnest(
          ARRAY[
            -- Capacity direction
            CASE
              WHEN lower(coalesce(e.headline,'')||' '||coalesce(e.notes,'')) ~* '\m(shut[-\s]?down|taken offline|retired|retirement|mothballed?|closed|closure|decommission|dismantl|demolition|end[-\s]?of[-\s]?life|fleet retirement)\M'
                THEN 'CAP_DN'
              WHEN lower(coalesce(e.headline,'')||' '||coalesce(e.notes,'')) ~* '\m(commissioned|inaugurated|energi[sz]ed|goes live|comes online|first power|fully operational|capacity added|expansion|extension|phase ii|phase 2|repower|repowered|uprated|uprate)\M'
                THEN 'CAP_UP'
              WHEN e.event_type = 'Repowering Announcement' THEN 'CAP_UP'
              WHEN e.event_type = 'Decommissioning'         THEN 'CAP_DN'
              WHEN e.event_type = 'Contractor Awarded' AND
                   lower(coalesce(e.headline,'')||' '||coalesce(e.notes,'')) ~* '\m(decom|dismantl)\M' THEN 'CAP_DN'
              WHEN e.event_type = 'Contractor Awarded' AND
                   lower(coalesce(e.headline,'')||' '||coalesce(e.notes,'')) ~* '\mrepower\M' THEN 'CAP_UP'
              ELSE NULL
            END,
            -- Provision direction
            CASE
              WHEN lower(coalesce(e.headline,'')||' '||coalesce(e.notes,'')) ~* '\m(bond returned|bond released|bond drawdown|provision settled|provision released|provision reversal|liability settled|liability extinguished)\M'
                THEN 'PROV_DN'
              WHEN lower(coalesce(e.headline,'')||' '||coalesce(e.notes,'')) ~* '\m(provision recogni[sz]ed|provision booked|provision raised|provision increased|topped up|top-up|aro recogni[sz]ed|aro increase|liability recogni[sz]ed|impairment|writedown|write-down|exceptional charge|restructuring charge)\M'
                THEN 'PROV_UP'
              WHEN e.event_type IN ('Decommissioning','Insolvency') THEN 'PROV_UP'
              ELSE NULL
            END,
            -- Recovery direction (only if explicit; no event_type fallback)
            CASE
              WHEN e.event_type = 'Material Recovery Update' AND
                   lower(coalesce(e.headline,'')||' '||coalesce(e.notes,'')) ~* '\m(scrap (rally|surge|climb|up|higher)|steel (surge|rally|up|climb|higher)|copper (surge|rally|up|higher)|metal (rally|surge)|price[s]? (gain|climb|rise|jump)|recovery rate up|recycling premium|salvage value up)\M'
                THEN 'REC_UP'
              WHEN e.event_type = 'Material Recovery Update' AND
                   lower(coalesce(e.headline,'')||' '||coalesce(e.notes,'')) ~* '\m(scrap (rout|collapse|glut|fall|slip)|steel (slump|rout|fall|slip)|copper (slump|rout|fall|slip)|metal (rout|slump)|price[s]? (fall|slip|drop|plunge)|recovery rate down|salvage value down|oversupply|glut of)\M'
                THEN 'REC_DN'
              ELSE NULL
            END,
            -- Policy: keep where it was already attached
            CASE WHEN 'POL' = ANY(coalesce(e.liability_tags, ARRAY[]::text[])) THEN 'POL' ELSE NULL END
          ]
        ) AS t
        WHERE t IS NOT NULL
      ) AS new_tags
    FROM watch_events e
  ) sub
 WHERE e.id = sub.id
   AND sub.new_tags IS NOT NULL;

-- Telemetry
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_028_directional_liability_tags', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM watch_events WHERE liability_tags && ARRAY['CAP_UP','CAP_DN','PROV_UP','PROV_DN','REC_UP','REC_DN']),
  'Migration 028 — directional liability tags',
  'Replaced non-directional CAP/PROV with CAP_UP/CAP_DN/PROV_UP/PROV_DN; recovery tags only assigned when headline carries explicit price-direction language.'
);
