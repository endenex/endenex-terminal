/**
 * DCI methodology metadata.
 *
 * Static configuration that complements the live DCI publications
 * data in Supabase. Captures the parts of the methodology that are
 * editorial / structural rather than computed:
 *
 *   - Index family: code, label, region, currency, status
 *   - Reference archetypes: turbine model, hub, project size, vintage,
 *     operator typology + capacity weight in current rebalance year
 *   - Scope: what's IN / what's OUT for each asset class
 *   - Variable basket: list of inputs feeding each index, with sourcing
 *     pill (PUBLIC / PRIMARY) and generic source type ("Freight
 *     benchmark" not "DAT")
 *   - Contributor coverage: count by index (anonymisation threshold = 3)
 *   - Publication cadence + methodology version
 *
 * IOSCO transparency principle: methodology should be reproducible
 * from the published inputs + version-controlled methodology document.
 * The vendor names ARE deliberately omitted — generic source-types
 * preserve transparency without giving competitors a buyer's guide.
 */

// ── Index family ─────────────────────────────────────────────────────

export type DciSeries =
  | 'dci_wind_europe'
  | 'dci_wind_north_america'
  | 'dci_solar_europe'
  | 'dci_solar_north_america'
  | 'dci_solar_japan'

export type DciAssetClass = 'wind' | 'solar' | 'bess'
export type DciStatus     = 'live' | 'pending'

export interface DciIndexMeta {
  series:         DciSeries
  ticker:         string         // Bloomberg-style: DCIW.EU, DCIS.JP
  label:          string         // human-readable name
  asset_class:    DciAssetClass
  region:         string         // display label e.g. "EU + UK"
  currency:       string         // 'EUR' | 'USD' | 'JPY'
  ccy_symbol:     string         // '€' | '$' | '¥'
  status:         DciStatus
}

export const DCI_INDICES: DciIndexMeta[] = [
  { series: 'dci_wind_europe',         ticker: 'DCIW.EU', label: 'DCI Wind · Europe',          asset_class: 'wind',  region: 'EU + UK',          currency: 'EUR', ccy_symbol: '€', status: 'live'    },
  { series: 'dci_wind_north_america',  ticker: 'DCIW.US', label: 'DCI Wind · United States',   asset_class: 'wind',  region: 'United States',     currency: 'USD', ccy_symbol: '$', status: 'live'    },
  { series: 'dci_solar_europe',        ticker: 'DCIS.EU', label: 'DCI Solar · Europe',         asset_class: 'solar', region: 'EU + UK',          currency: 'EUR', ccy_symbol: '€', status: 'pending' },
  { series: 'dci_solar_north_america', ticker: 'DCIS.US', label: 'DCI Solar · United States',  asset_class: 'solar', region: 'United States',     currency: 'USD', ccy_symbol: '$', status: 'pending' },
  { series: 'dci_solar_japan',         ticker: 'DCIS.JP', label: 'DCI Solar · Japan',          asset_class: 'solar', region: 'Japan',             currency: 'JPY', ccy_symbol: '¥', status: 'pending' },
]

// ── Reference archetypes ─────────────────────────────────────────────
// Discrete projects, NOT parameter ranges. The methodology commits to
// a specific reference (e.g. 12 × Vestas V80) and the index tracks
// the cost of decommissioning THAT project. Per-archetype capacity
// weights belong to the headline aggregate (e.g. EUR-WIND headline is
// weighted across N/IB/UK sub-archetypes by prior-year decommissioned
// MW share).

export interface DciArchetype {
  /** Sub-archetype code (e.g. 'EUR-WIND-N'). Headlines may reference
   *  one or more sub-archetypes, weighted. */
  code:               string
  series:             DciSeries
  /** Headline weight in the latest rebalance year. Sum within a series
   *  should equal 100 (within rounding). */
  weight_pct:         number
  /** Display fields */
  unit_count:         number    // e.g. 12 (turbines), or panel count for solar
  unit_model:         string    // e.g. "Vestas V80-2.0 MW"
  hub_height_m:       number | null
  project_size_mw:    number    // total project nameplate
  geography:          string    // "Northern Germany agricultural"
  vintage_circa:      number    // ~year first commissioned
  operator_typology:  string    // "IPP", "utility", etc.
}

export const DCI_ARCHETYPES: DciArchetype[] = [
  // ── EUR-WIND family
  { code: 'EUR-WIND-N',  series: 'dci_wind_europe',        weight_pct: 60, unit_count: 12,  unit_model: 'Vestas V80-2.0 MW',     hub_height_m: 80, project_size_mw: 24,    geography: 'Northern Germany agricultural', vintage_circa: 2003, operator_typology: 'IPP' },
  { code: 'EUR-WIND-IB', series: 'dci_wind_europe',        weight_pct: 25, unit_count: 30,  unit_model: 'Gamesa G52-850 kW',     hub_height_m: 65, project_size_mw: 25.5,  geography: 'Spanish ridge',                 vintage_circa: 2002, operator_typology: 'Utility' },
  { code: 'EUR-WIND-UK', series: 'dci_wind_europe',        weight_pct: 15, unit_count: 15,  unit_model: 'Vestas V66-1.65 MW',    hub_height_m: 70, project_size_mw: 24.75, geography: 'Scottish upland',               vintage_circa: 2004, operator_typology: 'IPP' },
  // ── US-WIND
  { code: 'US-WIND',     series: 'dci_wind_north_america', weight_pct: 100, unit_count: 100, unit_model: 'GE 1.5 SLE',           hub_height_m: 80, project_size_mw: 150,   geography: 'Texas / Plains',                vintage_circa: 2008, operator_typology: 'IPP / utility-scale' },
  // ── EUR-SOLAR family (pending publication; archetypes specified)
  { code: 'EUR-SOLAR-N', series: 'dci_solar_europe',       weight_pct: 65, unit_count: 90_000, unit_model: 'c-Si 250 Wp ground-mount', hub_height_m: null, project_size_mw: 22.5, geography: 'Northern Germany / NL',      vintage_circa: 2012, operator_typology: 'IPP' },
  { code: 'EUR-SOLAR-IB',series: 'dci_solar_europe',       weight_pct: 35, unit_count: 100_000, unit_model: 'c-Si 280 Wp single-axis tracker', hub_height_m: null, project_size_mw: 28, geography: 'Iberian plateau', vintage_circa: 2013, operator_typology: 'Utility' },
  // ── US-SOLAR
  { code: 'US-SOLAR',    series: 'dci_solar_north_america', weight_pct: 100, unit_count: 350_000, unit_model: 'c-Si 320 Wp single-axis tracker', hub_height_m: null, project_size_mw: 100, geography: 'Texas / Southwest', vintage_circa: 2014, operator_typology: 'Utility-scale' },
  // ── JPN-SOLAR
  { code: 'JPN-SOLAR',   series: 'dci_solar_japan',        weight_pct: 100, unit_count: 11_000, unit_model: 'c-Si 250 Wp fixed-tilt rooftop-replicate', hub_height_m: null, project_size_mw: 2.75, geography: 'Honshu mid-latitude', vintage_circa: 2014, operator_typology: 'Mix (FIT-era IPP)' },
]

// ── Scope ────────────────────────────────────────────────────────────

export interface DciScope {
  asset_class:  DciAssetClass
  in_scope:     string[]
  out_of_scope: string[]
}

export const DCI_SCOPE: DciScope[] = [
  {
    asset_class: 'wind',
    in_scope: [
      'Above-ground tower + nacelle dismantling',
      'Blade removal and on-site cutting',
      'Optional foundation top-cut (1m below grade)',
      'Crane mobilisation + demobilisation',
      'Site-to-processor transport (blades + metals)',
      'Recycler gate fees on dominant pathway',
      'Material recovery credit (steel / copper / aluminium)',
    ],
    out_of_scope: [
      'Foundation extraction below 1m',
      'Cable removal below grade',
      'Land restoration / reseeding',
      'Soft costs (permits, environmental, legal)',
      'Substation / step-up transformer decommissioning',
    ],
  },
  {
    asset_class: 'solar',
    in_scope: [
      'Module removal (panel-by-panel or pallet-bulk)',
      'Inverter + combiner box decommissioning',
      'Above-grade racking + tracker dismantling',
      'Site-to-processor transport (modules + scrap)',
      'Module recycling gate fee',
      'Material recovery credit (tracker steel + cable copper)',
    ],
    out_of_scope: [
      'Pile / driven-post foundation extraction',
      'Underground DC cable removal',
      'Land restoration / reseeding',
      'Soft costs (permits, environmental, legal)',
      'Substation / step-up transformer decommissioning',
    ],
  },
  {
    asset_class: 'bess',
    in_scope: [
      'Cell-pack / module removal',
      'Hazardous-classification packaging',
      'Specialist battery-handling labour',
      'Hazmat-rated transport to recycler',
      'Recycler gate fee (chemistry-differentiated)',
      'Material recovery credit (cathode metals via specialist offtake)',
    ],
    out_of_scope: [
      'Container shell + skid removal (often re-purposed)',
      'BoP / inverter + EMS hardware',
      'Foundation pad extraction',
      'Land restoration',
      'Soft costs',
    ],
  },
]

// ── Variable basket ─────────────────────────────────────────────────
// Each variable feeds the cost computation for one or more asset
// classes. Sourcing pill = PUBLIC (anyone can replicate) or PRIMARY
// (Endenex contributor data — the moat). Generic source TYPE shown
// instead of vendor name (preserves IOSCO transparency without giving
// competitors a vendor list).

export type DciSourcing = 'PUBLIC' | 'PRIMARY'
export type DciCadence  = 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Annual'
export type DciCategory = 'Crane' | 'Labour' | 'Transport' | 'Gate fees' | 'Material recovery'

export interface DciVariable {
  category:           DciCategory
  variable:           string
  /** Asset classes this variable feeds into. */
  applies_to:         DciAssetClass[]
  sourcing:           DciSourcing
  /** Generic source-type description — NOT the specific vendor name.
   *  e.g. "Freight benchmark" not "DAT"; "Wage statistics" not "ASHE". */
  source_type:        string
  refresh_cadence:    DciCadence
  /** Optional brief note about what the variable captures. */
  note?:              string
}

export const DCI_VARIABLES: DciVariable[] = [
  // ── Crane
  { category: 'Crane',     variable: '750-1000t main lift', applies_to: ['wind'],         sourcing: 'PRIMARY', source_type: 'Contributor quotation', refresh_cadence: 'Quarterly', note: 'No public benchmark globally for heavy-lift crane day rates.' },
  { category: 'Crane',     variable: '400-500t main lift',  applies_to: ['wind'],         sourcing: 'PRIMARY', source_type: 'Contributor quotation', refresh_cadence: 'Quarterly' },
  { category: 'Crane',     variable: '100-150t support',    applies_to: ['wind'],         sourcing: 'PRIMARY', source_type: 'Contributor quotation', refresh_cadence: 'Quarterly' },
  { category: 'Crane',     variable: '30-50t support',      applies_to: ['wind'],         sourcing: 'PRIMARY', source_type: 'Contractor framework rates', refresh_cadence: 'Quarterly' },
  // ── Labour
  { category: 'Labour',    variable: 'Crane operator',      applies_to: ['wind'],         sourcing: 'PUBLIC',  source_type: 'National wage statistics',     refresh_cadence: 'Annual', note: 'Annual public wage anchor (US OEWS / UK ASHE / EU SES) plus quarterly LCI movements.' },
  { category: 'Labour',    variable: 'Rigger',              applies_to: ['wind'],         sourcing: 'PUBLIC',  source_type: 'National wage statistics',     refresh_cadence: 'Annual' },
  { category: 'Labour',    variable: 'Steel cutter',        applies_to: ['wind','bess'],  sourcing: 'PUBLIC',  source_type: 'National wage statistics',     refresh_cadence: 'Annual' },
  { category: 'Labour',    variable: 'Composite cutter',    applies_to: ['wind'],         sourcing: 'PRIMARY', source_type: 'Contributor quotation',        refresh_cadence: 'Quarterly', note: 'No public occupational code for blade-composite cutting.' },
  { category: 'Labour',    variable: 'PV dismantling',      applies_to: ['solar'],        sourcing: 'PUBLIC',  source_type: 'National wage statistics',     refresh_cadence: 'Annual' },
  { category: 'Labour',    variable: 'Battery technician',  applies_to: ['bess'],         sourcing: 'PRIMARY', source_type: 'Contributor quotation',        refresh_cadence: 'Quarterly', note: 'Specialist Li-ion handling certification — no public series.' },
  { category: 'Labour',    variable: 'Contractor markup',   applies_to: ['wind','solar','bess'], sourcing: 'PRIMARY', source_type: 'Contributor disclosure', refresh_cadence: 'Quarterly', note: 'Markup over base wage — capacity-tightness signal. Endenex moat data.' },
  // ── Transport
  { category: 'Transport', variable: 'Flatbed (general)',   applies_to: ['wind','solar','bess'], sourcing: 'PUBLIC',  source_type: 'Freight benchmark',        refresh_cadence: 'Weekly', note: 'Public freight indices — US weekly, EU quarterly publication.' },
  { category: 'Transport', variable: 'Abnormal load',       applies_to: ['wind'],         sourcing: 'PRIMARY', source_type: 'Quotation-driven', refresh_cadence: 'Quarterly', note: 'Long-blade / nacelle transport — non-standard, no benchmark.' },
  { category: 'Transport', variable: 'Roll-off scrap container', applies_to: ['solar','bess'], sourcing: 'PUBLIC', source_type: 'Freight benchmark',         refresh_cadence: 'Weekly' },
  { category: 'Transport', variable: 'Hazmat-rated transport', applies_to: ['bess'],     sourcing: 'PRIMARY', source_type: 'Contributor quotation',         refresh_cadence: 'Quarterly' },
  // ── Gate fees
  { category: 'Gate fees', variable: 'Blade pathway gate',  applies_to: ['wind'],         sourcing: 'PRIMARY', source_type: 'Recycler quotation',           refresh_cadence: 'Quarterly', note: 'Cement co-process / pyrolysis / mechanical shred (regional dominant).' },
  { category: 'Gate fees', variable: 'Module pathway gate', applies_to: ['solar'],        sourcing: 'PRIMARY', source_type: 'Recycler quotation',           refresh_cadence: 'Quarterly', note: 'Mechanical (frame + glass) or Specialty (Si + Ag recovery).' },
  { category: 'Gate fees', variable: 'Battery pathway gate',applies_to: ['bess'],         sourcing: 'PRIMARY', source_type: 'Recycler quotation',           refresh_cadence: 'Quarterly', note: 'Pre-treatment to black mass; chemistry-differentiated.' },
  // ── Material recovery
  { category: 'Material recovery', variable: 'Steel scrap (HMS 1&2)',  applies_to: ['wind','bess'], sourcing: 'PUBLIC',  source_type: 'Metal exchange / scrap index', refresh_cadence: 'Daily' },
  { category: 'Material recovery', variable: 'Copper scrap (No.2)',    applies_to: ['wind','solar','bess'], sourcing: 'PUBLIC',  source_type: 'Metal exchange data',           refresh_cadence: 'Daily' },
  { category: 'Material recovery', variable: 'Aluminium scrap (T-T)',  applies_to: ['wind','solar','bess'], sourcing: 'PUBLIC',  source_type: 'Metal exchange data',           refresh_cadence: 'Daily' },
  { category: 'Material recovery', variable: 'Black mass payable',     applies_to: ['bess'],         sourcing: 'PRIMARY', source_type: 'Refiner offtake disclosure',    refresh_cadence: 'Quarterly', note: 'Chemistry-weighted: NMC vs LFP vs Na-ion.' },
  { category: 'Material recovery', variable: 'Merchant margin (Fe)',   applies_to: ['wind','bess'], sourcing: 'PRIMARY', source_type: 'Contributor disclosure',       refresh_cadence: 'Quarterly', note: 'Site-to-realisation margin — Endenex moat data.' },
]

// ── Contributor coverage ─────────────────────────────────────────────
// Anonymisation threshold = 3 contributors per (asset_class × region)
// for an index to publish separately. Below threshold, the index
// builds quietly until the threshold is met.

export interface DciContributorCoverage {
  series:         DciSeries
  contributors:   number
  /** True when we have ≥3 contributors and can publish separately. */
  above_threshold: boolean
}

export const DCI_CONTRIBUTOR_COVERAGE: DciContributorCoverage[] = [
  { series: 'dci_wind_europe',        contributors: 12, above_threshold: true },
  { series: 'dci_wind_north_america', contributors: 7,  above_threshold: true },
  { series: 'dci_solar_europe',       contributors: 4,  above_threshold: true },
  { series: 'dci_solar_north_america',contributors: 3,  above_threshold: true },
  { series: 'dci_solar_japan',        contributors: 3,  above_threshold: true },
]

export const DCI_CONTRIBUTOR_THRESHOLD = 3

// ── Publication cadence + methodology version ───────────────────────

export interface DciPublicationMeta {
  cadence:                 string         // human-readable
  methodology_version:     string
  methodology_effective:   string         // ISO date
  next_publication:        string         // ISO date or quarter label
  last_publication:        string         // ISO date
  rebalance_date:          string         // human-readable, e.g. "1 January annually"
  iosco_compliant:         boolean
}

export const DCI_PUBLICATION: DciPublicationMeta = {
  cadence:               'Quarterly headline · monthly intra-quarter input refresh',
  methodology_version:   'v1.1',
  methodology_effective: '2026-04-01',
  next_publication:      '2026-Q3',
  last_publication:      '2026-Q2',
  rebalance_date:        '1 January annually',
  iosco_compliant:       true,
}

// ── Rebalance source attribution (per asset class) ──────────────────

export const DCI_REBALANCE_SOURCE: Record<DciAssetClass, string> = {
  wind:  'Prior-year decommissioned MW from regional industry bodies (WindEurope EU; DOE / NREL / AWEA US).',
  solar: 'Prior-year decommissioned MW from regional sources (IEA-PVPS Task 12; METI Japan).',
  bess:  'Pending — first BESS index expected 2027 (KEEI Korea + GB BESS launch).',
}
