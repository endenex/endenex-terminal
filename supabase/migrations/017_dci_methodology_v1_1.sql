-- Migration 017 — DCI Methodology v1.1 release
--
-- Records the v1.1 methodology version that ties together migrations 012-016:
--   • Scrap-basis pricing (not LME) — Argus / AMM / Fastmarkets
--   • Vintage-bucketed LCA intensities (4 vintages × full/repowering scope)
--   • Three-layer recovery model (metallurgical / contamination / broker margin)
--   • 8-component gross cost rate card with 15-country multipliers
--   • Blade gate fees by pathway (5 pathways)
--   • UK/US/CA pipeline data for fleet cohort modelling
--   • Solar PV + BESS material intensities for non-wind asset modelling
--
-- Closes the v1.0 methodology (effective_to = today - 1 day).

-- ── Close v1.0 ──────────────────────────────────────────────────────────────
UPDATE dci_methodology_versions
SET effective_to = CURRENT_DATE - INTERVAL '1 day'
WHERE version = '1.0' AND effective_to IS NULL;

-- ── Insert v1.1 ─────────────────────────────────────────────────────────────
INSERT INTO dci_methodology_versions (
  version, effective_from, base_period_date,
  reference_vintage, reference_capacity_mw, reference_turbine, reference_design_life,
  base_gross_cost_eur_mw,
  base_blade_transport_eur_mw, base_blade_gate_fees_eur_mw, base_scrap_haulage_eur_mw,
  cost_inflation_pct_yr,
  formula_summary,
  source_attributions
) VALUES (
  '1.1',
  CURRENT_DATE,
  '2025-01-01',
  2010,
  100,
  'Vestas V90 2.0 MW (geared, DFIG)',
  25,
  -- Sum of dci_gross_cost_components (8 categories): 18500+14200+3800+14500+6800+4400+8200+11600 = 82000
  82000,
  -- Blade transport: STGO Cat 2-3 abnormal load × distance × n blades (per-MW figure unchanged)
  4800,
  -- Blade gate fees: cement co-processing baseline (€150/t × ~10 t/MW)
  1500,
  -- Scrap metal haulage: €0.18/km/t base × distance × tonnage (per-MW figure unchanged)
  2200,
  3.5,

  -- Formula summary v1.1 — fully scrap-basis, vintage-aware, three-layer recovery
  'DCI Spot(t) = (Gross Cost(t) − Material Recovery(t) + Disposal Costs(t)) / Net Liability(base) × 100. ' ||
  'GROSS COST(t) is built from 8 work categories (crane mob/lift, dismantling crew, blade field cutting, ' ||
  'foundation, cables, grid disconnection, site restoration, soft costs) escalated at 3.5%/yr from base period; ' ||
  'normalised across 15 countries via labour/plant/haul/gate multipliers (UK = 1.00 baseline). ' ||
  'MATERIAL RECOVERY(t) is computed per vintage bracket (pre2005 / 2005-09 / 2010-14 / 2015+) with two scopes ' ||
  '(full = inter-turbine cables in scope; repowering = turbine only). For each material: scrap-assessed ' ||
  'commodity price (Argus / AMM / Fastmarkets — NEVER LME or COMEX) × LCA volume per MW, then deducted by ' ||
  'three sequential recovery layers: (1) metallurgical recovery rate (95% steel, 90% Cu, 92% Al — physics), ' ||
  '(2) merchant contamination yield (88% ferrous, 92% non-ferrous — haul-to-sold mass), and ' ||
  '(3) broker margin (15-45% range, 30% default — what owner actually receives). ' ||
  'DISPOSAL COSTS(t) = blade transport + blade gate fees (5 pathways: landfill / storage / mechanical / ' ||
  'cement co-processing / pyrolysis) + scrap haulage (€0.18/km/t base × access multiplier). ' ||
  'Headline DCI is always net of NRO. Confidence ranges (low/high) reflect ±8% (±1σ across observed merchant ' ||
  'quotes plus base assumption uncertainty). DCI Spot Europe is EUR-denominated, built on EU prices. ' ||
  'DCI Spot UK is GBP-denominated sub-series of DCI Europe. DCI Spot US is USD-denominated, constructed separately.',

  ARRAY[
    -- Asset registries
    'Bundesnetzagentur — Marktstammdatenregister (DL-DE-BY-2.0)',
    'BEIS / DESNZ — Renewable Energy Planning Database (Open Government Licence v3.0)',
    'DUKES — Digest of UK Energy Statistics',
    'USGS / DOE — US Wind Turbine Database (CC0)',
    'EIA Form 860 — US energy installations',
    'AWEA / ACP — Annual Market Reports',
    'GWEC — Global Wind Energy Council',
    'CanWEA / Natural Resources Canada — Canadian wind statistics',
    'Energistyrelsen — Stamdataregister for vindkraftanlæg',
    'ODRÉ — Open Data Réseaux Énergies',
    'Global Energy Monitor — Wind Power Tracker (CC BY 4.0)',
    'WindEurope — UK + EU country reports; decommissioning industry guidance',
    -- LCA volumes (wind)
    'Vestas LCA series (V47, V80, V82, V90-2.0/3.0, V100, V112, V117, V136) — ISO 14044, TU Berlin externally reviewed',
    'Enercon LCAs (E-66, E-82 E2, E-92, E-115, E-126) — TÜV Rheinland critical review',
    'Siemens Gamesa Sustainability Reports + LCA disclosures',
    'GE Renewable Energy LCA disclosures',
    'Nordex Group Sustainability Reports',
    'NREL REMPD (2023) — Reference for fleet-level vintage averages',
    'IRENA — Renewable Power Generation Costs',
    'DecomBlades consortium dataset',
    'Beauson et al. 2022 — blade composition reference',
    -- Solar + BESS LCA
    'IRENA / IEA-PVPS (2016) — End-of-Life Management: Solar PV Panels',
    'IEA PVPS Task 12 LCI report (T12-19:2020)',
    'NREL UPV LCA TP-7A40-87372 (2024)',
    'ITRPV 2024 — silver paste intensity trends',
    'Silver Institute — World Silver Survey (annual)',
    'Sander et al. 2019 — Si-based PV material content',
    'NREL ATB 2024 — battery storage cost & technology baseline',
    'Argonne BatPaC v5 — battery pack composition model',
    'BNEF LCOES 2023 — Levelised cost of energy storage',
    -- Commodity prices (scrap-basis)
    'Argus UK Ferrous Scrap Index (MB-STE-0077) — primary UK ferrous benchmark',
    'Argus Scrap Markets — UK + EEA copper, aluminium scrap-assessed rates',
    'Fastmarkets MB-STE-0169 — E3 Germany delivered mill (EEA ferrous reference)',
    'AMM Midwest Composite — primary US ferrous reference',
    'AMM US dealer composites — cast iron, aluminium, zinc, stainless',
    'COMEX — US copper/aluminium reference cross-check (NOT used as scrap proxy)',
    'Fastmarkets / Argus / OPIS NdPr Oxide — rare earth recovery references',
    -- FX and country
    'ECB — daily EUR reference rates (FX normalisation)',
    'Eurostat — Labour Cost Survey 2024 / Labour Cost Index 2025',
    'Turner & Townsend — International Construction Market Survey 2024 (country multipliers)',
    'IRU European Freight Cost Index',
    -- Disposal pathways
    'WindEurope industry guidance — cement co-processing, mechanical, landfill rates',
    'Holcim / Neocomp — published cement co-processing data (Bremen + Lägerdorf)',
    'Cambridge TEA — pyrolysis pathway technoeconomic assessment',
    -- Decom estimator rate sources
    'Ainscough / Sparrows / ALE / Mammoet UK — crane day-rate guides',
    'CIJC 2024 + 35% on-costs — UK dismantling crew rates',
    'Spons Civil Engineering Price Book; CDAS / NFDC; RSMeans — civils unit rates'
  ]
) ON CONFLICT (version) DO UPDATE SET
  effective_from              = EXCLUDED.effective_from,
  effective_to                = NULL,
  base_period_date            = EXCLUDED.base_period_date,
  reference_vintage           = EXCLUDED.reference_vintage,
  reference_capacity_mw       = EXCLUDED.reference_capacity_mw,
  reference_turbine           = EXCLUDED.reference_turbine,
  reference_design_life       = EXCLUDED.reference_design_life,
  base_gross_cost_eur_mw      = EXCLUDED.base_gross_cost_eur_mw,
  base_blade_transport_eur_mw = EXCLUDED.base_blade_transport_eur_mw,
  base_blade_gate_fees_eur_mw = EXCLUDED.base_blade_gate_fees_eur_mw,
  base_scrap_haulage_eur_mw   = EXCLUDED.base_scrap_haulage_eur_mw,
  cost_inflation_pct_yr       = EXCLUDED.cost_inflation_pct_yr,
  formula_summary             = EXCLUDED.formula_summary,
  source_attributions         = EXCLUDED.source_attributions;

-- ── Tag existing dci_publications with new methodology where appropriate ────
-- (Don't re-stamp historical publications; only flag forward.)
DO $$
BEGIN
  EXECUTE format(
    'COMMENT ON TABLE dci_publications IS %L',
    'Decommissioning Cost Index publications. Each row tagged with methodology_version. ' ||
    'Methodology v1.1 (effective ' || CURRENT_DATE::TEXT || ') uses scrap-basis pricing, ' ||
    'vintage-bucketed LCA, three-layer recovery model.'
  );
END $$;

-- ── Telemetry ───────────────────────────────────────────────────────────────
INSERT INTO ingestion_runs (
  pipeline, status, started_at, finished_at,
  records_written, source_attribution, notes
) VALUES (
  'methodology_v1_1_release', 'success', NOW(), NOW(),
  1,
  'Endenex DCI Methodology v1.1',
  'Migration 017 — released v1.1 methodology. Closes v1.0 (effective_to = ' || (CURRENT_DATE - 1)::TEXT || '). Ties together migrations 012-016: scrap-basis pricing, vintage LCA, 3-layer recovery, 8-component cost card, 15-country multipliers, 5-pathway blade fees, wind pipeline data, solar+BESS LCA.'
);
