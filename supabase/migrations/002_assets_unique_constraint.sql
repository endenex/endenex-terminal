-- Endenex Terminal — Migration 002
-- Adds unique constraint on (external_id, source_type) to support upserts from ingestion pipelines.
-- Run in Supabase SQL Editor after migration 001.

ALTER TABLE assets
  ADD CONSTRAINT assets_external_id_source_unique UNIQUE (external_id, source_type);
