-- Migration 037 — Decom-security flag on candidate charges
--
-- The CH charges register is not a uniform thing. Most charges on UK
-- onshore wind SPVs are PROJECT FINANCE debentures held by syndicate
-- banks (Lloyds, Barclays, NatWest, RBS, AIB, etc.) — useful for
-- confirming the SPV's identity and operating status, NOT for measuring
-- ARO. ARO-relevant charges are rarer and look different:
--
--   • description mentions decommissioning / restoration / reinstatement
--     / asset retirement / rehabilitation / dilapidation / environmental
--   • persons_entitled is a surety / insurer (Atradius, Allianz Trade,
--     Coface, AIG, Travelers, Munich Re, etc.) — NOT a bank acting as
--     "security agent" / "agent" (those are project finance signals)
--
-- This migration adds is_decom_security on ch_spv_candidate_charges and
-- a view that surfaces only those charges. The script recomputes the
-- flag for cached charges via --rescore (no new CH API calls).

ALTER TABLE ch_spv_candidate_charges
  ADD COLUMN IF NOT EXISTS is_decom_security boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS ch_spv_charges_decom_idx
  ON ch_spv_candidate_charges(is_decom_security)
  WHERE is_decom_security = true;

-- View — only decom-relevant charges, joined back to the SPV candidate
DROP VIEW IF EXISTS ch_decom_security_charges_v;

CREATE VIEW ch_decom_security_charges_v AS
SELECT
  c.repd_ref_id,
  e.site_name                        AS project_name,
  c.ch_company_number,
  c.ch_company_name,
  c.combined_confidence              AS spv_confidence,
  ch.classification,
  ch.status                          AS charge_status,
  ch.description,
  ch.persons_entitled,
  ch.delivered_on,
  ch.satisfied_on
FROM ch_spv_candidate_charges ch
JOIN ch_spv_candidates       c ON c.id = ch.candidate_id
JOIN repd_project_extras     e ON e.repd_ref_id = c.repd_ref_id
WHERE ch.is_decom_security = true
ORDER BY c.combined_confidence DESC, ch.delivered_on DESC;

INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'migration_037_decom_security_flag', 'success', NOW(), NOW(),
  0,
  'Migration 037 — is_decom_security flag + ch_decom_security_charges_v',
  'Schema-only. Run find_spv_candidates.py --rescore to populate flags from cached charges.'
);
