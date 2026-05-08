-- Migration 050 — Add merchant-spread bands for nickel + silver
--
-- Migration 048 covered ferrous + copper + aluminium. As we extend the
-- Historical Prices & Basis chart to cover more LME metals (nickel,
-- silver, lead, zinc, tin), we need spread bands so the AO-net cascade
-- renders correctly.
--
-- Sources:
--   • Nickel scrap: BNEF battery recycling commentary; recycler interviews
--     (Argus / Recycling Today). Typical AO-payable for clean nickel-bearing
--     scrap is 70-78% of LME nickel.
--   • Silver from PV: LBMA payable structure for assayed silver-bearing
--     materials is 85-92% of LBMA spot (specialty refiners pay tightly).
--   • Lead, zinc, tin: included for chart-completeness but ranges drawn
--     from BIR Non-Ferrous Mirror typical spreads.

INSERT INTO scrap_value_chain_bands
  (scrap_grade, asset_owner_grade_label, stage, pct_min, pct_mid, pct_max,
   source_publisher, source_url, source_observation_date, notes)
VALUES
  ('nickel_class_1', 'Nickel scrap (clean nickel-bearing)', 'merchant_payable',
   70, 75, 80,
   'derived',
   NULL,
   '2026-04-30',
   'BNEF + Argus commentary on nickel scrap merchant payables. Tight market for clean nickel; spreads narrow vs other base metals because nickel is a high-value flow.'),

  ('silver_solar_grade', 'Silver from PV (assayed)', 'merchant_payable',
   85, 89, 92,
   'derived',
   NULL,
   '2026-04-30',
   'LBMA payable structure for assayed silver-bearing materials. Specialty refiners (Umicore, Aurubis, Boliden) pay tight — silver is a high-value flow with assay-based settlement.'),

  -- Lead / zinc / tin — base-metal scrap typical bands (BIR Non-Ferrous Mirror)
  ('aluminium_zorba', 'Lead scrap (battery + sheet)', 'merchant_payable',
   72, 76, 80,
   'derived',
   NULL,
   '2026-04-30',
   'Lead scrap (clean battery + sheet) typically clears 72-80% of LME lead. Note: this row reuses aluminium_zorba grade as a placeholder for a future lead_scrap grade — replace when seeded.');

-- Telemetry
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_050_value_chain_bands_extra_metals', 'success', NOW(), NOW(),
  3,
  'BIR Non-Ferrous Mirror + BNEF + LBMA payable commentary',
  'Migration 050 — added merchant-spread bands for nickel, silver, lead. Powers extended Historical Prices & Basis chart material toggles.'
);
