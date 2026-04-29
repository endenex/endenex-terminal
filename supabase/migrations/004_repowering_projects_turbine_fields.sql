-- Migration 004 — Add turbine specification fields to repowering_projects
-- turbine_make, turbine_model, hub_height_m, rotor_diameter_m inform material recovery volumes.

ALTER TABLE repowering_projects
  ADD COLUMN IF NOT EXISTS turbine_make     TEXT,
  ADD COLUMN IF NOT EXISTS turbine_model    TEXT,
  ADD COLUMN IF NOT EXISTS hub_height_m     NUMERIC,
  ADD COLUMN IF NOT EXISTS rotor_diameter_m NUMERIC;
