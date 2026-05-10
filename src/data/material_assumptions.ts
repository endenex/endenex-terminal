/**
 * Material intensity + first-degree recovery assumptions
 * ========================================================
 *
 * Single source of truth for the Waste Flow Forecast panel and any
 * downstream analytics. Mirrors the methodology used in the public
 * Endenex material-volumes calculator (Marketing/Website/.../tools/
 * material-volumes.html) but with three deliberate departures:
 *
 *   1) FIRST-DEGREE RECOVERY ONLY
 *      The website lists individual chemistry-grade outputs (Li, Ni,
 *      Co, Ag, Si) as if they're directly recoverable. They aren't.
 *      Asset owners and decommissioning operators realise FIRST-DEGREE
 *      streams: scrap metals, black mass, glass cullet. Specialist
 *      refiners further down the chain (Glencore, Umicore, ROSI,
 *      FRELP, Solvay) extract the chemistry-grade outputs and pocket
 *      that margin. Refiner bid prices for first-degree streams DO
 *      track second-degree commodity benchmarks (LME Li/Ni/Co,
 *      Fastmarkets solar Ag) but the asset owner only sees the
 *      first-degree output.
 *
 *   2) BESS = BLACK MASS, NOT INDIVIDUAL METALS
 *      The output of mechanical BESS recycling is a mixed
 *      cathode+anode powder ("black mass") plus casing scrap. The
 *      website's per-element split (Li, Ni, Co, graphite) is wrong at
 *      the operator layer. Single black mass line, weighted-average
 *      pricing.
 *
 *   3) HONEST SOLAR HAIRCUTS
 *      Glass cullet, silicon, and silver have weak commercial recovery
 *      markets despite strong theoretical recoverability. The website's
 *      90/70/65% rates are theoretical maxima; real first-degree rates
 *      are dramatically lower (40/5/10%). Polymer recovery is 0%.
 *
 *   4) WIND RARE EARTHS
 *      Website says 60% — fleet reality today is 10-20% (only Solvay,
 *      Less Common Metals, MP Materials handle commercial volumes).
 *      Set to 15%.
 *
 * VINTAGE COHORTS (Q1 = B, per user 2026-05-10)
 *   Material intensity per MW varies materially by commissioning
 *   vintage. Bigger modern turbines have lower steel/MW (more efficient
 *   conversion) but higher composite/MW (longer blades). Solar panels
 *   shrink in mass per MW as efficiency improves. BESS shifts from NMC
 *   heavy chemistry → LFP lighter cathode → next-gen denser packs.
 *
 *   Cohorts approximated to industry epochs; refine when public
 *   manufacturer disclosures permit.
 *
 * SOURCES (cited per material below)
 *   • IEA Wind Task 26 (onshore wind material flows)
 *   • IEA-PVPS Task 12 — End-of-Life PV (panel mass evolution + cullet)
 *   • IEA Battery Recycling Outlook 2024
 *   • BNEF Battery Recycling 2025
 *   • Fraunhofer ISI Battery Recycling Capacity 2025 update
 *   • WindEurope Decommissioning Outlook 2024-25
 *   • USGS Mineral Commodity Summaries 2024 (rare earth recycling)
 *   • SOLARCYCLE / ROSI / Veolia public disclosures
 *   • Glencore + Umicore public disclosures (black mass economics)
 *   • IRENA End-of-Life Solar PV Panels 2016 (heritage benchmark)
 */

// ── Vintage cohort definitions ──────────────────────────────────────

export interface VintageCohort {
  /** Inclusive lower bound, exclusive upper. e.g. {start: 2010, end: 2020} = 2010..2019 */
  start: number
  end:   number
  /** Display label for the cohort */
  label: string
}

export const WIND_COHORTS: VintageCohort[] = [
  { start: 1990, end: 2000, label: '1990s — early MW class' },
  { start: 2000, end: 2010, label: '2000s — medium 1.5-3 MW' },
  { start: 2010, end: 2020, label: '2010s — large 3-5 MW' },
  { start: 2020, end: 2050, label: '2020s+ — XL 4-7 MW direct-drive' },
]

export const SOLAR_COHORTS: VintageCohort[] = [
  { start: 2000, end: 2010, label: '2000s — heavy first-gen' },
  { start: 2010, end: 2020, label: '2010s — modern c-Si' },
  { start: 2020, end: 2050, label: '2020s+ — high-eff TOPCon/HJT' },
]

export const BESS_COHORTS: VintageCohort[] = [
  { start: 2015, end: 2020, label: '2015-19 — NMC dominant' },
  { start: 2020, end: 2025, label: '2020-24 — LFP shift' },
  { start: 2025, end: 2050, label: '2025+ — LFP / sodium-ion entering' },
]

/**
 * Resolve a commissioning year to its cohort label, with bound clamping.
 * Pre-1990 wind clamps to 1990s cohort; post-2050 clamps to latest.
 */
export function cohortForYear(
  cohorts: VintageCohort[],
  commissionYear: number,
): VintageCohort {
  for (const c of cohorts) {
    if (commissionYear >= c.start && commissionYear < c.end) return c
  }
  // Out of range — clamp
  if (commissionYear < cohorts[0].start) return cohorts[0]
  return cohorts[cohorts.length - 1]
}

// ── Material intensities (kg per MW for wind/solar; kg per MWh for BESS) ──

export type AssetClass = 'wind' | 'solar' | 'bess'

export interface MaterialIntensity {
  material:      string         // canonical material key (matches recovery table)
  display:       string         // human label
  kg_per_unit:   number         // intensity in kg/MW (wind/solar) or kg/MWh (BESS)
  source:        string         // citation token
}

/**
 * Wind onshore intensities by vintage cohort.
 * Foundation concrete is INCLUDED in volume but typically left in place
 * during decom — handled separately (see DECOM_COMPLETENESS below).
 *
 * Sources:
 *   - Wiser et al. 2016, NREL — early/medium fleet steel/copper
 *   - WindEurope 2024 — modern blade composite mass scaling
 *   - Vestas + Siemens-Gamesa LCAs — post-2020 turbine BoM
 *   - JRC 2020 critical materials report — rare earth (NdPr) loadings
 *     for direct-drive PMSG generators
 */
export const WIND_INTENSITIES: Record<string, MaterialIntensity[]> = {
  '1990s — early MW class': [
    { material: 'steel',        display: 'Steel (tower + nacelle)', kg_per_unit: 150_000, source: 'Wiser-NREL 2016' },
    { material: 'cast_iron',    display: 'Cast iron (hub + main shaft)', kg_per_unit: 30_000, source: 'Wiser-NREL 2016' },
    { material: 'copper',       display: 'Copper (cables + windings)', kg_per_unit: 3_000, source: 'Wiser-NREL 2016' },
    { material: 'aluminium',    display: 'Aluminium (nacelle housing)', kg_per_unit: 500, source: 'Wiser-NREL 2016' },
    { material: 'composite',    display: 'Composite (blades, GFRP)', kg_per_unit: 10_000, source: 'WindEurope 2024' },
    { material: 'rare_earth',   display: 'Rare earths (NdPr)', kg_per_unit: 0, source: 'JRC 2020 (induction generators dominant)' },
    { material: 'polymer',      display: 'Polymer (cabling, gaskets)', kg_per_unit: 1_500, source: 'Wiser-NREL 2016' },
  ],
  '2000s — medium 1.5-3 MW': [
    { material: 'steel',        display: 'Steel (tower + nacelle)', kg_per_unit: 120_000, source: 'Wiser-NREL 2016' },
    { material: 'cast_iron',    display: 'Cast iron (hub + main shaft)', kg_per_unit: 22_000, source: 'Wiser-NREL 2016' },
    { material: 'copper',       display: 'Copper (cables + windings)', kg_per_unit: 2_500, source: 'Wiser-NREL 2016' },
    { material: 'aluminium',    display: 'Aluminium (nacelle housing)', kg_per_unit: 600, source: 'Wiser-NREL 2016' },
    { material: 'composite',    display: 'Composite (blades, GFRP)', kg_per_unit: 15_000, source: 'WindEurope 2024' },
    { material: 'rare_earth',   display: 'Rare earths (NdPr)', kg_per_unit: 50, source: 'JRC 2020 (some PMSG entering)' },
    { material: 'polymer',      display: 'Polymer (cabling, gaskets)', kg_per_unit: 1_200, source: 'Wiser-NREL 2016' },
  ],
  '2010s — large 3-5 MW': [
    { material: 'steel',        display: 'Steel (tower + nacelle)', kg_per_unit: 100_000, source: 'IEA Wind Task 26 2020' },
    { material: 'cast_iron',    display: 'Cast iron (hub + main shaft)', kg_per_unit: 18_000, source: 'IEA Wind Task 26 2020' },
    { material: 'copper',       display: 'Copper (cables + windings)', kg_per_unit: 2_200, source: 'IEA Wind Task 26 2020' },
    { material: 'aluminium',    display: 'Aluminium (nacelle housing)', kg_per_unit: 700, source: 'IEA Wind Task 26 2020' },
    { material: 'composite',    display: 'Composite (blades, GFRP+CFRP)', kg_per_unit: 20_000, source: 'WindEurope 2024' },
    { material: 'rare_earth',   display: 'Rare earths (NdPr)', kg_per_unit: 200, source: 'JRC 2020 (PMSG common)' },
    { material: 'polymer',      display: 'Polymer (cabling, gaskets)', kg_per_unit: 1_000, source: 'IEA Wind Task 26 2020' },
  ],
  '2020s+ — XL 4-7 MW direct-drive': [
    { material: 'steel',        display: 'Steel (tower + nacelle)', kg_per_unit: 85_000, source: 'Vestas + Siemens-Gamesa LCAs 2023' },
    { material: 'cast_iron',    display: 'Cast iron (hub + main shaft)', kg_per_unit: 15_000, source: 'Vestas + Siemens-Gamesa LCAs 2023' },
    { material: 'copper',       display: 'Copper (cables + windings)', kg_per_unit: 2_000, source: 'IEA Wind Task 26 2020' },
    { material: 'aluminium',    display: 'Aluminium (nacelle housing)', kg_per_unit: 800, source: 'IEA Wind Task 26 2020' },
    { material: 'composite',    display: 'Composite (blades, GFRP+CFRP)', kg_per_unit: 25_000, source: 'WindEurope 2024 (longer blades)' },
    { material: 'rare_earth',   display: 'Rare earths (NdPr)', kg_per_unit: 300, source: 'JRC 2020 (most XL onshore is direct drive)' },
    { material: 'polymer',      display: 'Polymer (cabling, gaskets)', kg_per_unit: 900, source: 'IEA Wind Task 26 2020' },
  ],
}

/**
 * Solar PV intensities by vintage cohort, kg/MW (= 1000 × kg/Wp).
 * Sources:
 *   - IEA-PVPS Task 12 EOL Update 2024 — panel mass evolution
 *   - Frischknecht et al. 2020 — PV LCI (silicon + silver loading by gen)
 *   - SOLARCYCLE 2024 disclosures (US module composition)
 *   - IRENA End-of-Life Solar PV Panels 2016 (early vintage benchmark)
 */
export const SOLAR_INTENSITIES: Record<string, MaterialIntensity[]> = {
  '2000s — heavy first-gen': [
    { material: 'aluminium',    display: 'Aluminium frame', kg_per_unit: 75_000, source: 'IRENA 2016' },
    { material: 'glass',        display: 'Glass (front sheet)', kg_per_unit: 75_000, source: 'IRENA 2016' },
    { material: 'silicon',      display: 'Silicon (cells)', kg_per_unit: 5_000, source: 'Frischknecht 2020' },
    { material: 'silver',       display: 'Silver (paste contacts)', kg_per_unit: 25, source: 'Frischknecht 2020 (early high-Ag)' },
    { material: 'copper',       display: 'Copper (junction box + cable)', kg_per_unit: 5_000, source: 'IEA-PVPS Task 12 2024' },
    { material: 'polymer',      display: 'Polymer (EVA + backsheet)', kg_per_unit: 15_000, source: 'IEA-PVPS Task 12 2024' },
  ],
  '2010s — modern c-Si': [
    { material: 'aluminium',    display: 'Aluminium frame', kg_per_unit: 55_000, source: 'IEA-PVPS Task 12 2024' },
    { material: 'glass',        display: 'Glass (front sheet)', kg_per_unit: 65_000, source: 'IEA-PVPS Task 12 2024' },
    { material: 'silicon',      display: 'Silicon (cells)', kg_per_unit: 3_500, source: 'Frischknecht 2020' },
    { material: 'silver',       display: 'Silver (paste contacts)', kg_per_unit: 15, source: 'Frischknecht 2020' },
    { material: 'copper',       display: 'Copper (junction box + cable)', kg_per_unit: 3_000, source: 'IEA-PVPS Task 12 2024' },
    { material: 'polymer',      display: 'Polymer (EVA + backsheet)', kg_per_unit: 10_000, source: 'IEA-PVPS Task 12 2024' },
  ],
  '2020s+ — high-eff TOPCon/HJT': [
    { material: 'aluminium',    display: 'Aluminium frame', kg_per_unit: 45_000, source: 'SOLARCYCLE 2024 disclosures' },
    { material: 'glass',        display: 'Glass (front + bifacial back)', kg_per_unit: 55_000, source: 'IEA-PVPS Task 12 2024' },
    { material: 'silicon',      display: 'Silicon (cells)', kg_per_unit: 2_700, source: 'Frischknecht 2020 (thinner wafers)' },
    { material: 'silver',       display: 'Silver (paste contacts)', kg_per_unit: 8, source: 'Fraunhofer ISE 2024 (TOPCon Ag reduction)' },
    { material: 'copper',       display: 'Copper (junction box + cable)', kg_per_unit: 2_500, source: 'IEA-PVPS Task 12 2024' },
    { material: 'polymer',      display: 'Polymer (EVA + backsheet)', kg_per_unit: 8_000, source: 'IEA-PVPS Task 12 2024' },
  ],
}

/**
 * BESS intensities by vintage cohort, kg/MWh (storage capacity).
 * Black mass figures = mass of mixed cathode+anode powder OUTPUT
 * by mechanical recycling, not the in-pack active material mass.
 *
 * Sources:
 *   - IEA Battery Recycling Outlook 2024
 *   - BNEF Battery Recycling 2025 (LFP vs NMC mass per MWh)
 *   - Fraunhofer ISI Battery Recycling Capacity 2025
 *   - Glencore + Umicore disclosures (mechanical recycler outputs)
 */
export const BESS_INTENSITIES: Record<string, MaterialIntensity[]> = {
  '2015-19 — NMC dominant': [
    { material: 'steel',        display: 'Steel (container + racks)', kg_per_unit: 17_000, source: 'IEA 2024' },
    { material: 'aluminium',    display: 'Aluminium (pack housing)', kg_per_unit: 2_000, source: 'IEA 2024' },
    { material: 'copper',       display: 'Copper (busbars + foils)', kg_per_unit: 3_000, source: 'BNEF 2025' },
    { material: 'black_mass',   display: 'Black mass (NMC cathode + anode)', kg_per_unit: 3_500, source: 'Glencore disclosures + BNEF 2025' },
    { material: 'polymer',      display: 'Polymer (separator + binder)', kg_per_unit: 1_500, source: 'Fraunhofer ISI 2025' },
    { material: 'electrolyte',  display: 'Electrolyte (LiPF6 + solvents)', kg_per_unit: 1_500, source: 'IEA 2024' },
  ],
  '2020-24 — LFP shift': [
    { material: 'steel',        display: 'Steel (container + racks)', kg_per_unit: 17_000, source: 'IEA 2024' },
    { material: 'aluminium',    display: 'Aluminium (pack housing)', kg_per_unit: 2_000, source: 'IEA 2024' },
    { material: 'copper',       display: 'Copper (busbars + foils)', kg_per_unit: 3_000, source: 'BNEF 2025' },
    { material: 'black_mass',   display: 'Black mass (LFP cathode + anode)', kg_per_unit: 5_000, source: 'BNEF 2025 (LFP higher cathode mass)' },
    { material: 'polymer',      display: 'Polymer (separator + binder)', kg_per_unit: 1_500, source: 'Fraunhofer ISI 2025' },
    { material: 'electrolyte',  display: 'Electrolyte (LiPF6 + solvents)', kg_per_unit: 1_500, source: 'IEA 2024' },
  ],
  '2025+ — LFP / sodium-ion entering': [
    { material: 'steel',        display: 'Steel (container + racks)', kg_per_unit: 15_000, source: 'BNEF 2025 (denser packs)' },
    { material: 'aluminium',    display: 'Aluminium (pack housing)', kg_per_unit: 1_800, source: 'BNEF 2025' },
    { material: 'copper',       display: 'Copper (busbars + foils)', kg_per_unit: 2_700, source: 'BNEF 2025' },
    { material: 'black_mass',   display: 'Black mass (LFP + Na-ion mix)', kg_per_unit: 5_500, source: 'BNEF 2025 + IEA 2024' },
    { material: 'polymer',      display: 'Polymer (separator + binder)', kg_per_unit: 1_400, source: 'Fraunhofer ISI 2025' },
    { material: 'electrolyte',  display: 'Electrolyte (LiPF6 + solvents)', kg_per_unit: 1_400, source: 'IEA 2024' },
  ],
}

// ── First-degree recovery rates (% of raw mass actually marketable) ──

/**
 * What asset owners / decom operators ACTUALLY realise as scrap revenue.
 * Second-degree recovery (chemistry-grade outputs from refiners) is NOT
 * counted here. Refiner bid prices DO drive these rates' valuations,
 * but the material itself is the scrap stream sold by the operator.
 *
 * Sources:
 *   - Wind: WindEurope Decommissioning Outlook 2024-25; USGS 2024
 *     Mineral Commodity Summary on rare-earth recycling
 *   - Solar: IEA-PVPS Task 12 EOL Update 2024; ROSI/SOLARCYCLE 2024
 *     disclosures; Veolia public commentary
 *   - BESS: Fraunhofer ISI Battery Recycling Capacity 2025; BNEF
 *     Battery Recycling 2025; Glencore + Umicore disclosures
 *
 * Departures from public website assumptions documented in file header.
 */
export const FIRST_DEGREE_RECOVERY: Record<AssetClass, Record<string, number>> = {
  wind: {
    steel:        95,   // standard ferrous, near-total recovery
    cast_iron:    95,   // bulk, easy to extract
    copper:       85,   // blend: cable 90%, generator winding 80%
    aluminium:    92,   // standard non-ferrous recovery
    rare_earth:   15,   // FLEET REALITY 2025 — only Solvay / Less Common
                        // Metals / MP Materials handle commercial volumes;
                        // most retiring NdPr is downcycled or stockpiled
    composite:     0,   // GFRP/CFRP — cement co-processing is waste
                        // treatment, not material recovery; landfill or
                        // pyrolysis-experimental for the rest
    polymer:       0,   // cabling jackets, gaskets — no recovery market
  },
  solar: {
    aluminium:    92,   // frame removed clean; standard non-ferrous
    copper:       85,   // junction box + cable — minor stripping loss
    glass:        40,   // ACTUAL market reality — most recyclers landfill
                        // cullet; only specialist plants (Veolia, ROSI,
                        // SOLARCYCLE) do thermal-mechanical separation
    silicon:       5,   // downcycled to construction; almost no
                        // commodity-grade route at fleet scale
    silver:       10,   // requires acid leaching post-glass-separation;
                        // mainstream recyclers leave Ag in cullet
    polymer:       0,   // EVA / backsheet — no commercial recovery
  },
  bess: {
    steel:        95,   // standard ferrous
    aluminium:    92,   // standard non-ferrous
    copper:       85,   // busbars + foils after shredding
    black_mass:   95,   // nearly all collected from shredder; chemistry-
                        // priced separately by buyer
    polymer:       0,   // separator + binder — waste
    electrolyte:   0,   // LiPF6 + carbonates — waste / energy recovery
  },
}

// ── Headline first-degree pricing (USD/t for the scrap output) ──

/**
 * Indicative first-degree market prices, USD per tonne. Used for
 * back-of-envelope valuation in the panel — not a primary metric.
 * Move to scrap_price_benchmarks join when the panel matures.
 *
 * Sourced 2025-Q2:
 *   - Steel: HMS 1&2 80/20 (US Midwest, USGS / Fastmarkets)
 *   - Cast iron: foundry pig (Fastmarkets)
 *   - Copper: No.2 scrap (LME-linked, 95% of LME copper)
 *   - Aluminium: taint-tabor, P1020 base (Tabor smelter benchmark)
 *   - Glass cullet: solar-grade cullet (where market exists, ROSI
 *     disclosure)
 *   - Silver: refined at 90% LME silver (only realised by specialist
 *     refiners; quoted for second-degree comparison)
 *   - Black mass: weighted-average of LFP black mass (~$2,000/t) and
 *     NMC black mass (~$8,000/t) at fleet-mix ~70% LFP / 30% NMC
 *     for retiring 2025-2030 cohort
 *   - Rare earths: NdPr oxide from recycling (USGS commentary; thin
 *     market, indicative only)
 */
export const FIRST_DEGREE_PRICING_USD_PER_T: Record<string, number> = {
  steel:        330,
  cast_iron:    410,
  copper:     8_400,
  aluminium:  2_100,
  rare_earth: 60_000,    // NdPr oxide — recycled grade, indicative
  composite:      0,     // gate fee on disposal, not revenue
  polymer:        0,
  glass:         50,     // solar-grade cullet, where market exists
  silicon:      150,     // downcycled to construction grade
  silver:    750_000,    // refined silver — specialist refiner only
  black_mass: 4_500,     // weighted LFP+NMC fleet average 2025-30
  electrolyte:    0,
}

// ── Foundation / mounting structure handling ──

/**
 * What % of the asset's mass is typically left in place during decom
 * (foundation concrete, mounting structure, monopile sleeve below
 * mudline, etc). NOT the same as recovery rate — this is "doesn't
 * become a waste stream at all".
 *
 * Used to scale total volume estimate vs the per-MW intensity table
 * (which counts the full BoM). For wind in particular, the concrete
 * foundation (~600 t/MW) is usually capped + buried, never extracted.
 *
 * Material intensities above EXCLUDE these "left in place" components,
 * so this is here for documentation / future hybrid handling — not
 * applied to the current calculation.
 */
export const LEFT_IN_PLACE_NOTE = {
  wind:  'Concrete foundation (~600 t/MW) typically capped at -1m and left in place. Excluded from intensity table.',
  solar: 'Mounting structure + piles (~30-50 t/MW) often left in place at greenfield sites. Excluded from intensity table.',
  bess:  'BESS containers are skid-mounted; nothing left in place once skid removed.',
}

// ── Methodology disclaimer (used in panel footer) ──

export const METHODOLOGY_NOTE = `
First-degree recovery only. Black mass / scrap pricing reflects refiner bid prices,
which track second-degree commodity markets (LME Li/Ni/Co, Fastmarkets solar Ag) but
the material shown is the scrap stream the asset owner actually sells. Vintage cohort
intensities reflect commissioning year. Foundation concrete (wind) and mounting
structure (solar) excluded — typically left in place. Confidence: Medium.
`.trim()
