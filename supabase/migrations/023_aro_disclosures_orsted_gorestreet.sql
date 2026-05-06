-- Migration 023 — Add Ørsted (offshore wind) + Gore Street (BESS data gap)
--
-- Two more verified ARO disclosures researched from FY-end annual reports:
--
--   Ørsted — provision-style operator with a clean segment-level disclosure.
--   Their Offshore segment publishes a discrete decom obligation for offshore
--   wind only (the segment also includes development-stage hydrogen, but no
--   operational hydrogen assets yet so the figure is materially pure offshore
--   wind). Onshore segment (wind + solar + storage mixed) and Bioenergy &
--   Other segment (CHP plants, Nybro gas, oil/gas pipes) excluded entirely.
--
--   Gore Street Energy Storage — researched and confirmed they recognise NO
--   decommissioning provision in their FY25 financial statements. This is
--   itself a meaningful data point: BESS operators typically do not record
--   ARO under IAS 37 because (i) battery components have positive residual
--   value, (ii) site obligations are bundled in lease commitments not
--   ARO, and (iii) short asset lives often align with land lease terms.
--   Recorded with total_aro_m = 0 and notes explaining the norm.
--
-- NextEnergy Solar Fund (NESF) was researched but has no per-site bond
-- schedule equivalent to Greencoat's Note 10. They bundle decom into NAV.
-- Not seeded — would be misleading to invent a number.

-- ── Idempotent re-seed ──────────────────────────────────────────────────────

DELETE FROM aro_provisions
WHERE source_url IN (
  'https://cdn.orsted.com/-/media/annual2024/orsted-annual-report-2024.pdf',
  'https://www.gsenergystoragefund.com/docs/librariesprovider22/archive/reports/annual-report-2025.pdf'
);

-- ── Insert: Ørsted Offshore segment FY24 ────────────────────────────────────
-- Source: 2024 Annual Report, Note 3.9 (Provisions and contingent liabilities), p.193
-- Reported figure: DKK 9,347m for Offshore segment decommissioning obligations
-- Capacity reference: ~10.6 GW operational offshore at end-2024 (per Q4 2024
-- investor presentation)

INSERT INTO aro_provisions (
  operator, ticker, jurisdiction, asset_class,
  framework, fy, filing_date,
  total_aro_m, currency, capacity_mw,
  attribution, attribution_notes,
  source_name, source_url, filing_page,
  notes
) VALUES (
  'Ørsted A/S', 'ORSTED.CO', 'DK', 'offshore_wind',
  'CSRD', 'FY2024', '2025-02-06',
  9347, 'DKK', 10600,
  'derived', 'Segment-level disclosure: Offshore segment decom obligation only. Onshore (wind+solar+storage mixed) and Bioenergy & Other (CHP/gas) segments excluded. Offshore segment also includes development-stage hydrogen, no operational hydrogen yet so figure is materially pure offshore wind. Decom obligations are net of partner share — Ørsted only recognises its ownership interest portion.',
  'Ørsted A/S 2024 Annual Report · Note 3.9',
  'https://cdn.orsted.com/-/media/annual2024/orsted-annual-report-2024.pdf',
  193,
  'Per-MW = ~DKK 882k/MW (~€118k/MW). Capacity reference: 10.6 GW operational offshore at end-2024 per Q4 2024 investor presentation.'
);

-- ── Insert: Gore Street Energy Storage FY25 — DATA GAP ──────────────────────
-- Source: Annual Report year ended 31 March 2025, Note 22 Guarantees and
-- Capital commitments, p.82 — NO decommissioning provision recognised.
-- Only guarantees disclosed are debt-service guarantees on Santander £100m
-- facility (£56.5m drawn at year-end).
--
-- This row is included to surface the disclosure gap explicitly. It signals
-- the broader BESS-operator pattern of not recognising ARO under IAS 37.

INSERT INTO aro_provisions (
  operator, ticker, jurisdiction, asset_class,
  framework, fy, filing_date,
  total_aro_m, currency, capacity_mw,
  attribution, attribution_notes,
  source_name, source_url, filing_page,
  notes
) VALUES (
  'Gore Street Energy Storage Fund plc', 'GSF.L', 'GB', 'bess',
  'IFRS', 'FY24-25', '2025-07-17',
  0, 'GBP', 832,
  'disclosed', 'NO decommissioning provision recognised in FY25 financial statements. Note 22 lists only debt-service guarantees for £100m Santander facility (£56.5m drawn). Battery residual value (esp. LFP cells) is expected to exceed decom cost — operators treat this as economically self-funding.',
  'Gore Street Energy Storage Fund plc · Annual Report FY24-25 · Note 22',
  'https://www.gsenergystoragefund.com/docs/librariesprovider22/archive/reports/annual-report-2025.pdf',
  82,
  'Sector pattern: BESS operators rarely recognise ARO. Land-lease terms typically match asset life; lease provisions absorb site-restoration. Capacity reference: 832 MW operational across GB / IE / DE / US at 31 Mar 2025.'
);

-- ── Telemetry ──────────────────────────────────────────────────────────────

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_023_aro_provisions_orsted_gorestreet', 'success', NOW(), NOW(),
  2,
  'Ørsted A/S 2024 AR Note 3.9; Gore Street Energy Storage Fund plc FY25 AR Note 22',
  'Migration 023 — added 2 verified provision-style ARO disclosures: Ørsted offshore wind segment (DKK 9,347m, derived attribution), Gore Street Energy Storage Fund (£0 — confirmed no provision recognised, surfacing BESS sector pattern). NESF researched but excluded — no per-site bond schedule to extract.'
);
