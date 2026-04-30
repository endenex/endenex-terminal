-- ── Watch module: Airtable sync fields ────────────────────────────────────────
-- Adds columns needed for Airtable → Supabase sync and duplicate detection.

alter table watch_events
  add column if not exists airtable_record_id text unique,
  add column if not exists is_duplicate       boolean not null default false,
  add column if not exists source_count       integer not null default 1,
  add column if not exists asset_type         text,
  add column if not exists stakeholder_type   text,
  add column if not exists activity_types     text[];

create index if not exists watch_events_is_duplicate_idx on watch_events(is_duplicate);
create index if not exists watch_events_airtable_id_idx  on watch_events(airtable_record_id);
