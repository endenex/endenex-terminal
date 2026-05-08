-- Migration 065 — Merge Stena Recycling group + UK arm into one row
--
-- Migration 054 inserted "Stena Recycling" (Stena Metall AB Nordic group,
-- 5,500 kt/yr group throughput across SE/NO/DK/FI/PL, 200+ sites).
-- Migration 055 then inserted "Stena Recycling UK" as a separate row for
-- the UK arm (~500 kt/yr, 12 sites). Both are the same group; the UK arm
-- is a subsidiary, not an independent counterparty.
--
-- This migration consolidates them into one row: extends the group entry's
-- country footprint to include GB, adds UK plants to the plant_count, and
-- removes the standalone UK row.

UPDATE scrap_offtakers
   SET countries     = ARRAY['SE','NO','DK','FI','PL','GB','DE','IT'],
       plant_count   = 220,    -- ~200 group + ~12-20 UK + DE/IT
       notes         = 'Family-controlled Stena Metall AB; Nordic dominant + EU presence + UK arm. Specialised in clean separation for SSAB / Outokumpu mill supply. UK sites: Sheffield, Halesowen, Newport, Felixstowe + others. Group throughput ~6,000 kt/yr.',
       intake_capacity_kt_year = 6000,
       last_verified = CURRENT_DATE
 WHERE name = 'Stena Recycling';

DELETE FROM scrap_offtakers
 WHERE name = 'Stena Recycling UK';

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_065_merge_stena_recycling', 'success', NOW(), NOW(),
  1,
  'Editorial cleanup',
  'Migration 065 — merged Stena Recycling group + Stena Recycling UK into one row. UK is the same group, not a separate counterparty.'
);
