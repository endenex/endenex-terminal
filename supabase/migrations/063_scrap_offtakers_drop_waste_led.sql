-- Migration 063 — Drop waste-led operators + rename Renewi
--
-- Panel renamed to "Metal Scrap Merchants" — confidence rating column dropped
-- from UI. Without confidence flags, operators that are not real scrap
-- merchants must be dropped to keep the directory honest.
--
-- Drops:
--   • Suez Recycling & Recovery — waste-led; ferrous shred subcontracted
--   • Veolia ES Recycling — same; metals desk inside broader environmental services
--
-- Renames:
--   • "Van Gansewinkel (Renewi)" → "Renewi"
--     The Van Gansewinkel name was retained from the 2017 Shanks merger; the
--     current trading entity is just Renewi. Renewi has real metals capability
--     via the ex-Van Gansewinkel desk + Renewi E-Waste division — kept in.

DELETE FROM scrap_offtakers
 WHERE name IN (
   'Suez Recycling & Recovery',
   'Veolia ES Recycling'
 );

UPDATE scrap_offtakers
   SET name          = 'Renewi',
       last_verified = CURRENT_DATE
 WHERE name = 'Van Gansewinkel (Renewi)';

-- ── Telemetry ──────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_063_scrap_offtakers_drop_waste_led', 'success', NOW(), NOW(),
  (SELECT COUNT(*) FROM scrap_offtakers),
  'Editorial cleanup',
  'Migration 063 — dropped Suez + Veolia (waste-led, not metal scrap merchants). Renamed Van Gansewinkel (Renewi) → Renewi (current trading name). Panel renamed to "Metal Scrap Merchants".'
);
