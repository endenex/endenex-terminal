// ── Recycling Capacity Monitor — Tab 05 ──────────────────────────────────────
// 5 panels in a 12-col grid (no full-width content):
//   Row 1: Composite Blades stats (col-6) + Pathway gate-fee bars (col-6)
//   Row 2: Gate Fees table (col-6) + Landfill Tracker (col-6)
//   Row 3: Capacity Signals feed (col-8) + Recycling Pathway summary (col-4)

import { useState, useEffect, useMemo } from 'react'
import { clsx } from 'clsx'
import { ExternalLink } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend } from 'recharts'
import { supabase } from '@/lib/supabase'
import { BladePathwayBars } from '@/components/charts/BladePathwayBars'
import {
  WIND_COHORTS, SOLAR_COHORTS, BESS_COHORTS, cohortForYear,
  WIND_INTENSITIES, SOLAR_INTENSITIES, BESS_INTENSITIES,
  FIRST_DEGREE_RECOVERY, FIRST_DEGREE_PRICING_USD_PER_T,
  METHODOLOGY_NOTE,
  BESS_CHEMISTRY_MIX, bessChemistryWeightedPrice,
  applyUncertainty, UNCERTAINTY_PCT,
  type AssetClass, type MaterialIntensity, type VintageCohort,
} from '@/data/material_assumptions'
import { useDesignLife } from '@/store/designLife'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WatchEvent {
  id:           string
  headline:     string
  notes:        string | null
  event_type:   string
  scope:        string
  company_name: string | null
  capacity_mw:  number | null
  event_date:   string
  confidence:   'High' | 'Medium' | 'Low'
  source_url:   string | null
  watch_sources: { name: string; url: string | null } | null
}

const CONFIDENCE_STYLE: Record<string, string> = {
  High:   'text-up',
  Medium: 'text-amber',
  Low:    'text-down',
}

const SCOPE_LABEL: Record<string, string> = {
  GB: 'UK', EU: 'EU', US: 'US', JP: 'Japan', DE: 'Germany',
  DK: 'Denmark', FR: 'France', ES: 'Spain', NL: 'Netherlands',
  SE: 'Sweden', AU: 'Australia', Global: 'Global',
}

interface BladeRegionRow {
  region:       string
  label:        string
  blade_count:  string
  grp_kt:       string
  horizon:      string
}

const BLADE_REGIONS: BladeRegionRow[] = [
  { region: 'EU', label: 'Europe',         blade_count: '~36,000', grp_kt: '~360',  horizon: '2025-2030' },
  { region: 'GB', label: 'United Kingdom', blade_count: '~10,500', grp_kt: '~90',   horizon: '2025-2032' },
  { region: 'US', label: 'United States',  blade_count: '~24,000', grp_kt: '~190',  horizon: '2024-2030' },
  { region: 'JP', label: 'Japan',          blade_count: 'TBC',     grp_kt: 'TBC',   horizon: '2030-2040' },
]

interface PathwayRow {
  name:        string
  type:        'thermal' | 'mechanical' | 'chemical' | 'cement' | 'landfill'
  trl:         string
  cost:        string
  players:     string
}

const PATHWAYS: PathwayRow[] = [
  { name: 'Cement co-processing',  type: 'cement',     trl: '9 (commercial)', cost: '€130-200/t', players: 'Holcim, Heidelberg, CEMEX' },
  { name: 'Mechanical shredding',  type: 'mechanical', trl: '8-9',            cost: '€80-150/t',  players: 'GFS (US), EU operators' },
  { name: 'Pyrolysis',             type: 'thermal',    trl: '5-7',            cost: '€200-400/t', players: 'Siemens Gamesa, Carbon Rivers' },
  { name: 'Solvolysis',            type: 'chemical',   trl: '3-6',            cost: 'n/a',        players: 'Universities, Olin' },
  { name: 'Landfill (EU restricted)', type: 'landfill', trl: 'n/a',           cost: '€50-120/t',  players: '—' },
]

const PATHWAY_PILL: Record<PathwayRow['type'], string> = {
  thermal:    'bg-amber-50 text-amber-700 border-amber-200',
  mechanical: 'bg-sky-50 text-sky-700 border-sky-200',
  chemical:   'bg-violet-50 text-violet-700 border-violet-200',
  cement:     'bg-teal-50 text-teal-700 border-teal-200',
  landfill:   'bg-red-50 text-red-700 border-red-200',
}

type GateAssetClass = 'wind' | 'solar' | 'bess'
type GateStatus    = 'cost' | 'banned' | 'restricted' | 'payable' | 'na'
type GateRegion    = 'EU' | 'UK' | 'US' | 'AsiaPac'
type GateCurrency  = 'USD' | 'EUR' | 'GBP' | 'CNY'
type GateConfidence = 'confident' | 'plausible' | 'low'

interface GateFeeRow {
  asset_classes: GateAssetClass[]
  pathway:       string
  region:        string         // display label
  region_group:  GateRegion
  status:        GateStatus
  currency:      GateCurrency
  median_local:  number | null  // in `currency` units; null for non-cost
  range:         string         // e.g. "€350-650/t" — shown in tooltip on cell hover
  confidence:    GateConfidence
  notes:         string
  source:        string         // primary-source URL
}

// FX rates (consistent with the press-extraction script)
const GATE_FX_TO_USD: Record<GateCurrency, number> = {
  USD: 1.00,
  EUR: 1.08,
  GBP: 1.27,
  CNY: 1 / 7.20,
}

const GATE_CURRENCY_SYMBOL: Record<GateCurrency, string> = {
  USD: '$', EUR: '€', GBP: '£', CNY: '¥',
}

const medianUsd = (r: GateFeeRow): number | null =>
  r.median_local != null ? r.median_local * GATE_FX_TO_USD[r.currency] : null

// Triangulated against verified regulatory context (REGULATIONS array):
//
//   • Wind landfill bans are MEMBER-STATE ONLY in the EU — DE/NL/SE/AT/
//     FI/DK have effective bans via TOC limits or combustible-waste rules.
//     EU27 has NO statutory blade landfill ban (WindEurope 2026 pledge is
//     voluntary).
//   • France wind has no landfill ban — Arrêté 22 Jun 2020 sets recycling
//     targets (45% 2022 → 55% 2025).
//   • Solar landfill is restricted (not "banned") in EU via WEEE collection
//     mandate; in US it's permitted in most states.
//   • BESS landfill IS banned in EU (Battery Reg 2023/1542 explicit).
//   • US has no statutory blade landfill bans (IL / CO claims were wrong).
//
// All medians shown in USD/t equivalent for sortable comparison.
// FX approx: 1 EUR ≈ 1.08 USD; 1 GBP ≈ 1.27 USD; 1 USD ≈ 7.20 CNY.
// VERIFIED via May-2026 deep research pass. Median values triangulated
// from primary sources (regulator data + industry studies + recycler PR);
// each row carries a confidence flag and a primary-source URL.
const GATE_FEE_TABLE: GateFeeRow[] = [
  // ── WIND blade ──
  { asset_classes:['wind'],  pathway:'Cement co-processing',         region:'EU',                region_group:'EU',      status:'cost',       currency:'EUR', median_local: 165,  range:'€120-210/t',  confidence:'plausible',
    notes:'Holcim Lägerdorf, Heidelberg Materials, CEMEX kilns. Range from EU LCA literature.',
    source:'https://environment.ec.europa.eu/news/more-circular-less-carbon-chemical-recycling-holds-promise-wind-turbine-blade-waste-2023-10-19_en' },
  { asset_classes:['wind'],  pathway:'Cement co-processing',         region:'UK',                region_group:'UK',      status:'cost',       currency:'GBP', median_local: 150,  range:'£140-180/t',  confidence:'plausible',
    notes:'Geocycle UK / Hanson Padeswood. Constrained by UK landfill tax £130.75/t (2026/27).',
    source:'https://www.gov.uk/government/publications/landfill-tax-rates-for-2026-to-2027/landfill-tax-increase-in-rates-from-1-april-2026' },
  { asset_classes:['wind'],  pathway:'Cement co-processing',         region:'US',                region_group:'US',      status:'cost',       currency:'USD', median_local: 180,  range:'$150-250/t',  confidence:'plausible',
    notes:'LafargeHolcim Joppa IL + emerging West Coast capacity. ACP white-paper range.',
    source:'https://cleanpower.org/wp-content/uploads/gateway/2023/01/ACP_BladeRecycling_WhitePaper_230130.pdf' },
  { asset_classes:['wind'],  pathway:'Mechanical shredding',         region:'EU',                region_group:'EU',      status:'cost',       currency:'EUR', median_local: 115,  range:'€90-140/t',   confidence:'confident',
    notes:'GFRP shred for low-grade fillers / road infill. ACS 2024 techno-economic assessment.',
    source:'https://pubs.acs.org/doi/full/10.1021/acssusresmgt.4c00256' },
  { asset_classes:['wind'],  pathway:'Mechanical shredding',         region:'US',                region_group:'US',      status:'cost',       currency:'USD', median_local: 103,  range:'$80-130/t',   confidence:'plausible',
    notes:'Global Fiberglass Solutions, Veolia Missouri. Cement-grade aggregate output.',
    source:'https://acmanet.org/a-second-life-for-wind-blades/' },
  { asset_classes:['wind'],  pathway:'Pyrolysis',                    region:'EU',                region_group:'EU',      status:'cost',       currency:'EUR', median_local: 450,  range:'€350-650/t',  confidence:'plausible',
    notes:'Continuum DK (opened 2024), REGEN Fiber, Siemens Gamesa pilot. Higher than 2023 estimates.',
    source:'https://www.mdpi.com/1996-1073/18/4/782' },
  { asset_classes:['wind'],  pathway:'Pyrolysis',                    region:'US',                region_group:'US',      status:'cost',       currency:'USD', median_local: 350,  range:'$300-500/t',  confidence:'low',
    notes:'Carbon Rivers TN scaling to 50 kt/yr (DOE-supported). No public price disclosure yet.',
    source:'https://www.energy.gov/eere/wind/articles/carbon-rivers-makes-wind-turbine-blade-recycling-and-upcycling-reality-support' },
  { asset_classes:['wind'],  pathway:'Solvolysis',                   region:'EU',                region_group:'EU',      status:'na',         currency:'EUR', median_local: null, range:'pre-commercial',  confidence:'confident',
    notes:'TRL 3-6 — EuReComp + DecomBlades targeting TRL 6-7 by 2027. No commercial fee.',
    source:'https://environment.ec.europa.eu/news/more-circular-less-carbon-chemical-recycling-holds-promise-wind-turbine-blade-waste-2023-10-19_en' },
  { asset_classes:['wind'],  pathway:'Landfill',                     region:'DE / NL / SE / AT / FI / DK', region_group:'EU', status:'banned', currency:'EUR', median_local: null, range:'banned', confidence:'confident',
    notes:'Effective national bans via TOC limits / combustible-waste rules — see Regulatory Context.',
    source:'https://www.gesetze-im-internet.de/depv_2009/' },
  { asset_classes:['wind'],  pathway:'Landfill',                     region:'France',            region_group:'EU',      status:'restricted', currency:'EUR', median_local: null, range:'45-55% recycle',  confidence:'confident',
    notes:'Arrêté 22 Jun 2020 mandates 45% recycling rate (55% from 2025); landfill rare in practice.',
    source:'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000042056089' },
  { asset_classes:['wind'],  pathway:'Landfill',                     region:'UK',                region_group:'UK',      status:'cost',       currency:'GBP', median_local: 155,  range:'£140-180/t',   confidence:'confident',
    notes:'Landfill tax £130.75/t (FY2026/27) + ~£20-40/t base gate fee. No formal blade ban.',
    source:'https://www.gov.uk/government/publications/landfill-tax-rates-for-2026-to-2027/landfill-tax-increase-in-rates-from-1-april-2026' },
  { asset_classes:['wind'],  pathway:'Landfill',                     region:'ES / IT / PL',      region_group:'EU',      status:'cost',       currency:'EUR', median_local: 100,  range:'€40-200/t',   confidence:'plausible',
    notes:'Wide spread by country: ES landfill tax €20-40/t (regional), IT €25.82/t, PL €95/t. Range reflects 3x variance.',
    source:'https://www.eea.europa.eu/en/analysis/maps-and-charts/overview-of-landfill-taxes-on' },
  { asset_classes:['wind'],  pathway:'Landfill',                     region:'US',                region_group:'US',      status:'cost',       currency:'USD', median_local:  62,  range:'$32-125/t',   confidence:'confident',
    notes:'EREF 2024 national MSW average $62.28/t. State variance ~4x (TX $36 → MA $125+).',
    source:'https://erefdn.org/product/2024-analysis-of-municipal-solid-waste-msw-landfill-tipping-fees/' },

  // ── SOLAR PV ──
  { asset_classes:['solar'], pathway:'Mechanical (frame + glass)',   region:'EU',                region_group:'EU',      status:'cost',       currency:'EUR', median_local:  60,  range:'€15-150/t',   confidence:'plausible',
    notes:'Producer eco-fees prepaid (€50-200/t); recyclers still charge €40-100/t at gate. Lower end DE/NL with high-purity flowsheets.',
    source:'https://lighthief.energy/solar-panel-recycling-in-europe-weee-rules-costs-and-end-of-life-strategies/' },
  { asset_classes:['solar'], pathway:'Mechanical (frame + glass)',   region:'UK',                region_group:'UK',      status:'cost',       currency:'GBP', median_local:  20,  range:'£0-60/t',     confidence:'low',
    notes:'PV Cycle UK collective scheme — gate fee suppressed by producer-funded WEEE collection.',
    source:'https://www.theecoexperts.co.uk/solar-panels/solar-panel-recycling' },
  { asset_classes:['solar'], pathway:'Mechanical (frame + glass)',   region:'US',                region_group:'US',      status:'cost',       currency:'USD', median_local: 200,  range:'$150-400/t',  confidence:'plausible',
    notes:'No producer-funded levy — recyclers charge $15-45/panel ≈ $750-2,250/t residential. SOLARCYCLE bulk industrial $150-400/t.',
    source:'https://www.empirecenter.org/publications/renewable-solar-comes-with-recurring-waste-costs/' },
  { asset_classes:['solar'], pathway:'Mechanical (frame + glass)',   region:'CN',                region_group:'AsiaPac', status:'cost',       currency:'CNY', median_local: 500,  range:'¥400-700/t',  confidence:'low',
    notes:'MIIT pilot facilities — figure represents marginal mechanical step only; full processing higher.',
    source:'https://english.www.gov.cn/news/202307/12/content_WS64aea90dc6d0868f4e8ddb9a.html' },
  { asset_classes:['solar'], pathway:'Specialty (Si + Ag recovery)', region:'EU',                region_group:'EU',      status:'cost',       currency:'EUR', median_local: 100,  range:'€80-150/t',   confidence:'confident',
    notes:'Reiling Münster (50 kt/yr), Veolia Rousset. Thin-film (CdTe) higher at €200-350/t — separate.',
    source:'https://lighthief.energy/solar-panel-recycling-in-europe-weee-rules-costs-and-end-of-life-strategies/' },
  { asset_classes:['solar'], pathway:'Specialty (Si + Ag recovery)', region:'US',                region_group:'US',      status:'cost',       currency:'USD', median_local: 140,  range:'$120-250/t',  confidence:'plausible',
    notes:'SOLARCYCLE Texas Phase 1, We Recycle Solar AZ. RWE 2025 deal + Prologis announcement.',
    source:'https://www.pv-tech.org/solarcycle-prologis-sign-solar-pv-module-recycling-deal/' },
  { asset_classes:['solar'], pathway:'Specialty (Si + Ag recovery)', region:'CN',                region_group:'AsiaPac', status:'cost',       currency:'CNY', median_local: 550,  range:'¥400-800/t',  confidence:'low',
    notes:'Five-region MIIT pilot scheme. 2023 cost ¥75/module against ¥56 recovered value (net ~¥800/t).',
    source:'https://www.chinadaily.com.cn/a/202306/05/WS647d343ba31033ad3f7ba63f.html' },
  { asset_classes:['solar'], pathway:'Landfill',                     region:'EU',                region_group:'EU',      status:'restricted', currency:'EUR', median_local: null, range:'restricted',  confidence:'confident',
    notes:'WEEE Directive forces collection + treatment; direct landfill not a legal route.',
    source:'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32012L0019' },
  { asset_classes:['solar'], pathway:'Landfill',                     region:'US',                region_group:'US',      status:'cost',       currency:'USD', median_local:  62,  range:'$32-125/t',   confidence:'confident',
    notes:'EREF 2024 national MSW average. PV non-hazardous in most states (CA reclassified 2024).',
    source:'https://erefdn.org/product/2024-analysis-of-municipal-solid-waste-msw-landfill-tipping-fees/' },
  { asset_classes:['solar'], pathway:'Landfill',                     region:'Australia (VIC)',   region_group:'AsiaPac', status:'banned',     currency:'USD', median_local: null, range:'banned',      confidence:'confident',
    notes:'Victorian e-waste landfill ban from Jul 2019 covers PV.',
    source:'https://www.vic.gov.au/e-waste-ban' },

  // ── BESS / batteries ──
  { asset_classes:['bess'],  pathway:'Pre-treatment to black mass',  region:'EU',                region_group:'EU',      status:'cost',       currency:'EUR', median_local: 1800, range:'€1,200-3,000/t', confidence:'plausible',
    notes:'Hydrovolt, Accurec, BASF Schwarzheide. Fraunhofer ISI 2025 notes overcapacity compressing fees.',
    source:'https://www.isi.fraunhofer.de/en/blog/themen/batterie-update/batterie-recycling_europa_kapazitaeten_bedarf_update_2025.html' },
  { asset_classes:['bess'],  pathway:'Pre-treatment to black mass',  region:'UK',                region_group:'UK',      status:'cost',       currency:'GBP', median_local: 2000, range:'£1,400-2,400/t', confidence:'plausible',
    notes:'Veolia, Recycling Lives battery line. Tracks EU mainland with ~10% transport premium.',
    source:'https://www.canarymedia.com/articles/recycling-renewables/ev-battery-recycling-had-a-rough-2024' },
  { asset_classes:['bess'],  pathway:'Pre-treatment to black mass',  region:'US',                region_group:'US',      status:'cost',       currency:'USD', median_local: 2000, range:'$1,500-3,000/t', confidence:'plausible',
    notes:'Li-Cycle (Glencore-acquired Aug 2025), Redwood Materials NV. Pricing compressed post-merger.',
    source:'https://www.canarymedia.com/articles/recycling-renewables/ev-battery-recycling-had-a-rough-2024' },
  { asset_classes:['bess'],  pathway:'Pre-treatment to black mass',  region:'CN',                region_group:'AsiaPac', status:'cost',       currency:'CNY', median_local: 3500, range:'¥2,500-4,500/t', confidence:'plausible',
    notes:'Whitelisted recyclers — CATL, GEM, Brunp. NMC inputs often payable; LFP/pack-format scrap takes a fee.',
    source:'https://www.fastmarkets.com/insights/launch-of-china-ev-battery-scrap-black-mass-prices/' },
  { asset_classes:['bess'],  pathway:'Pre-treatment to black mass',  region:'KR',                region_group:'AsiaPac', status:'cost',       currency:'USD', median_local: 1650, range:'$1,300-2,000/t', confidence:'plausible',
    notes:'SungEel HiTech, Posco GS. Cost economics ~70-80% of US level.',
    source:'https://www.fastmarkets.com/insights/launch-of-south-korean-black-mass-payable-indicators-pricing-notice/' },
  { asset_classes:['bess'],  pathway:'Pyrometallurgical',            region:'EU',                region_group:'EU',      status:'cost',       currency:'EUR', median_local: 1400, range:'€1,200-1,800/t', confidence:'plausible',
    notes:'Umicore Hoboken (7 kt/yr Li-ion). Pure-pyro figure synthetic — Umicore integrates pyro+hydro.',
    source:'https://www.umicore.com/en/about/battery-materials-solutions/battery-recycling-solutions/pyro-hydro-technology' },
  { asset_classes:['bess'],  pathway:'Hydrometallurgical refining',  region:'CN',                region_group:'AsiaPac', status:'payable',    currency:'CNY', median_local: null, range:'75-85% payable',  confidence:'confident',
    notes:'Payable 75-85% of NiSO4 / CoSO4 / Li2CO3 prices for NMC black mass (Fastmarkets ddp China, Nov 2025).',
    source:'https://www.fastmarkets.com/insights/launch-of-china-ev-battery-scrap-black-mass-prices/' },
  { asset_classes:['bess'],  pathway:'Hydrometallurgical refining',  region:'EU',                region_group:'EU',      status:'cost',       currency:'EUR', median_local:  900, range:'€600-1,400/t',  confidence:'plausible',
    notes:'Hydrovolt, Eramet, Revolt-acquired assets. Capacity overshoot has cut fees ~25-35% since 2023.',
    source:'https://www.capgemini.com/de-de/wp-content/uploads/sites/8/2025/07/POV-Battery-Recycling_Capgemini-Engineering_2025-07.pdf' },
  { asset_classes:['bess'],  pathway:'Hydrometallurgical refining',  region:'US',                region_group:'US',      status:'cost',       currency:'USD', median_local:  900, range:'$700-1,200/t',  confidence:'plausible',
    notes:'Redwood Nevada, Li-Cycle (Glencore) hubs. IRA-funded capacity scale-up still bringing fees down.',
    source:'https://www.canarymedia.com/articles/recycling-renewables/ev-battery-recycling-had-a-rough-2024' },
  { asset_classes:['bess'],  pathway:'Landfill',                     region:'EU',                region_group:'EU',      status:'banned',     currency:'EUR', median_local: null, range:'banned',      confidence:'confident',
    notes:'Battery Regulation 2023/1542 prohibits landfill of waste batteries.',
    source:'https://eur-lex.europa.eu/eli/reg/2023/1542/oj' },
  { asset_classes:['bess'],  pathway:'Landfill',                     region:'US',                region_group:'US',      status:'restricted', currency:'USD', median_local: null, range:'restricted',  confidence:'confident',
    notes:'State-level restrictions; large-format Li batteries generally classed hazardous (RCRA Subtitle C).',
    source:'https://www.epa.gov/hw' },
]

const GATE_STATUS_LABEL: Record<GateStatus, string> = {
  cost:       '',           // shown as numeric
  banned:     'BANNED',
  restricted: 'RESTRICTED',
  payable:    'PAYABLE',
  na:         'n/a',
}

const GATE_STATUS_STYLE: Record<GateStatus, string> = {
  cost:       'text-ink tabular-nums',
  banned:     'text-red-700 font-bold tracking-wider',
  restricted: 'text-amber-700 font-bold tracking-wider',
  payable:    'text-emerald-700 font-bold tracking-wider',
  na:         'text-ink-4 italic',
}

// Regulatory context table — multi-asset-class. Covers landfill bans,
// waste restrictions, EPR (extended producer responsibility) regimes, and
// recycling/recovery requirements across EU / UK / US / Asia for wind
// blades + solar PV + BESS battery streams.
type RegAssetClass = 'wind' | 'solar' | 'bess'
type RegType   = 'landfill_ban' | 'restriction' | 'epr' | 'requirement' | 'hazardous' | 'no_regulation'
type RegStatus = 'in_force' | 'phased' | 'proposed' | 'voluntary' | 'no_rule'

interface RegulationRow {
  jurisdiction:   string
  asset_classes:  RegAssetClass[]
  reg_type:       RegType
  status:         RegStatus
  effective:      string
  detail:         string
}

interface RegulationRowExt extends RegulationRow {
  source_url: string
}

// VERIFIED via primary sources (regulator websites + legislative texts).
// Critical corrections from earlier draft:
//   • EU27 blade landfill ban DOES NOT EXIST — WindEurope's pledge is voluntary
//     (effective 1 Jan 2026) and not statutory. Asking Commission to enshrine
//     in 2026 Circular Economy Act, but as of May 2026 it is industry-only.
//   • France wind blade rule is recycling-rate targets via Arrêté 22 Jun 2020
//     (45% from 2022 → 55% from 2025), NOT hazardous classification.
//   • Germany blade landfill exclusion dates from 2005 (DepV / AbfAblV TOC limit),
//     not 2021.
//   • Illinois / Colorado have NO statutory blade landfill ban — corrected.
//   • Multiple EU member-state bans verified at correct dates (NL 1995, SE 2002,
//     AT 2004, FI 2016, DK 1997).
const REGULATIONS: RegulationRowExt[] = [
  // ===== EU level =====
  { jurisdiction: 'EU27',          asset_classes: ['wind'],            reg_type: 'no_regulation', status: 'voluntary', effective: '2026',
    detail: 'WindEurope industry pledge: zero blades to landfill from 1 Jan 2026. Voluntary, not statutory.',
    source_url: 'https://windeurope.org/newsroom/news/wind-industry-calls-for-europe-wide-ban-on-landfilling-turbine-blades/' },
  { jurisdiction: 'EU27',          asset_classes: ['solar'],           reg_type: 'epr',           status: 'in_force',  effective: '2012',
    detail: 'WEEE Directive 2012/19/EU: PV in Cat.4; producer-funded collection; 80% recovery, 70% recycling targets.',
    source_url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32012L0019' },
  { jurisdiction: 'EU27',          asset_classes: ['bess'],            reg_type: 'epr',           status: 'phased',    effective: '2024',
    detail: 'Battery Regulation 2023/1542 in force Feb 2024; waste-battery duties from Aug 2025; LMT collection 51% by 2028.',
    source_url: 'https://eur-lex.europa.eu/eli/reg/2023/1542/oj' },
  { jurisdiction: 'EU27',          asset_classes: ['bess'],            reg_type: 'requirement',   status: 'phased',    effective: '2025',
    detail: 'Lithium-battery recycling-efficiency target 65% by Dec 2025, 70% by Dec 2030 under Reg 2023/1542.',
    source_url: 'https://eur-lex.europa.eu/eli/reg/2023/1542/oj' },
  { jurisdiction: 'EU27',          asset_classes: ['wind','solar','bess'], reg_type: 'restriction', status: 'in_force', effective: '1999',
    detail: 'Landfill Directive 1999/31/EC + 2018 amendment cap municipal landfill at 10% by 2035; pre-treatment required.',
    source_url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:31999L0031' },

  // ===== Member states =====
  { jurisdiction: 'Germany',       asset_classes: ['wind'],            reg_type: 'landfill_ban',  status: 'in_force',  effective: '2005',
    detail: 'DepV / AbfAblV TOC limit 3% (5% waiver) effectively excludes GRP/CFRP blades from landfill since 2005.',
    source_url: 'https://www.gesetze-im-internet.de/depv_2009/' },
  { jurisdiction: 'Germany',       asset_classes: ['solar','bess'],    reg_type: 'epr',           status: 'in_force',  effective: '2015',
    detail: 'ElektroG transposes WEEE; PV producers register with stiftung-ear and finance take-back.',
    source_url: 'https://www.gesetze-im-internet.de/elektrog_2015/' },
  { jurisdiction: 'France',        asset_classes: ['wind'],            reg_type: 'requirement',   status: 'in_force',  effective: '2020',
    detail: 'Arrêté 22 Jun 2020: full dismantling, foundation excavation; blade recycling 45% from 2022, 55% from 2025.',
    source_url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000042056089' },
  { jurisdiction: 'France',        asset_classes: ['solar'],           reg_type: 'epr',           status: 'in_force',  effective: '2014',
    detail: 'Soren (ex-PV Cycle France) operates accredited PV EPR scheme under Code de l\'environnement L541-10.',
    source_url: 'https://www.soren.eco/' },
  { jurisdiction: 'France',        asset_classes: ['wind','solar','bess'], reg_type: 'requirement', status: 'in_force', effective: '2020',
    detail: 'Loi AGEC (n°2020-105): anti-waste framework, recycled-content + dismantling-info duties via REP schemes.',
    source_url: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000041553759' },
  { jurisdiction: 'Netherlands',   asset_classes: ['wind'],            reg_type: 'landfill_ban',  status: 'in_force',  effective: '1995',
    detail: 'Besluit stortplaatsen / LAP3: combustible & recyclable waste banned from landfill incl. composites; €205/t exemption.',
    source_url: 'https://lap3.nl/' },
  { jurisdiction: 'Netherlands',   asset_classes: ['solar','bess'],    reg_type: 'epr',           status: 'in_force',  effective: '2014',
    detail: 'Regeling AEEA implements WEEE; PV via Stichting OPEN/Weeelabex, batteries via Stibat.',
    source_url: 'https://wetten.overheid.nl/BWBR0034782' },
  { jurisdiction: 'Italy',         asset_classes: ['solar'],           reg_type: 'epr',           status: 'in_force',  effective: '2014',
    detail: 'D.Lgs. 49/2014 (WEEE transposition): GSE retains end-of-life guarantee for incentivised PV plants.',
    source_url: 'https://www.gazzettaufficiale.it/eli/id/2014/04/14/14G00064/sg' },
  { jurisdiction: 'Spain',         asset_classes: ['solar','bess'],    reg_type: 'epr',           status: 'in_force',  effective: '2015',
    detail: 'RD 110/2015 transposes WEEE; PV included; producers fund collection via authorised SRAPs.',
    source_url: 'https://www.boe.es/eli/es/rd/2015/02/20/110' },
  { jurisdiction: 'Denmark',       asset_classes: ['wind'],            reg_type: 'landfill_ban',  status: 'in_force',  effective: '1997',
    detail: 'Danish landfill ban on combustible waste >TOC threshold; blades typically incinerated/cement-coprocessed.',
    source_url: 'https://mst.dk/affald-jord/affald/affaldslovgivning' },
  { jurisdiction: 'Sweden',        asset_classes: ['wind'],            reg_type: 'landfill_ban',  status: 'in_force',  effective: '2002',
    detail: 'Förordning 2001:512: combustible-waste landfill ban (2002) + organic-waste ban (2005) covers composites.',
    source_url: 'https://www.riksdagen.se/sv/dokument-lagar/dokument/svensk-forfattningssamling/forordning-2001512-om-deponering-av-avfall_sfs-2001-512' },
  { jurisdiction: 'Austria',       asset_classes: ['wind'],            reg_type: 'landfill_ban',  status: 'in_force',  effective: '2004',
    detail: 'Deponieverordnung 2008 + earlier 2004 rules: TOC limit excludes blade composites from landfill.',
    source_url: 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=20005653' },
  { jurisdiction: 'Finland',       asset_classes: ['wind'],            reg_type: 'landfill_ban',  status: 'in_force',  effective: '2016',
    detail: 'Government Decree 331/2013: organic waste with TOC >10% banned from landfill from 2016.',
    source_url: 'https://www.finlex.fi/fi/laki/alkup/2013/20130331' },
  { jurisdiction: 'Poland',        asset_classes: ['solar','bess'],    reg_type: 'epr',           status: 'in_force',  effective: '2015',
    detail: 'Ustawa o ZSEiE (2015) transposes WEEE; PV covered; GIOŚ register; collection-rate targets.',
    source_url: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20150001688' },
  { jurisdiction: 'Ireland',       asset_classes: ['solar'],           reg_type: 'epr',           status: 'in_force',  effective: '2014',
    detail: 'WEEE Regulations SI 149/2014 include PV; WEEE Ireland & ERP Ireland operate take-back.',
    source_url: 'https://www.irishstatutebook.ie/eli/2014/si/149/' },

  // ===== UK =====
  { jurisdiction: 'United Kingdom', asset_classes: ['wind'],           reg_type: 'restriction',   status: 'in_force',  effective: '2002',
    detail: 'Landfill (England & Wales) Regs 2002 + WM3 guidance: WAC tests typically exclude GRP from non-haz cells.',
    source_url: 'https://www.gov.uk/government/publications/waste-classification-technical-guidance' },
  { jurisdiction: 'United Kingdom', asset_classes: ['solar','bess'],   reg_type: 'epr',           status: 'in_force',  effective: '2014',
    detail: 'WEEE Regulations 2013 (SI 2013/3113) cover PV from Jan 2014; producer compliance schemes finance recycling.',
    source_url: 'https://www.legislation.gov.uk/uksi/2013/3113/contents' },
  { jurisdiction: 'United Kingdom', asset_classes: ['bess'],           reg_type: 'epr',           status: 'in_force',  effective: '2009',
    detail: 'Waste Batteries & Accumulators Regs 2009 (SI 2009/890): producer take-back; industrial Li-ion covered.',
    source_url: 'https://www.legislation.gov.uk/uksi/2009/890/contents/made' },

  // ===== USA =====
  { jurisdiction: 'US Federal',    asset_classes: ['solar'],           reg_type: 'hazardous',     status: 'in_force',  effective: '1976',
    detail: 'RCRA Subtitle C: PV modules failing TCLP (Pb, Cd) classed hazardous; otherwise Subtitle D solid waste.',
    source_url: 'https://www.epa.gov/hw/solar-panel-recycling' },
  { jurisdiction: 'US Federal',    asset_classes: ['wind'],            reg_type: 'no_regulation', status: 'no_rule',   effective: '—',
    detail: 'No federal rule on blade disposal; governed by state solid-waste programs under RCRA Subtitle D.',
    source_url: 'https://www.epa.gov/rcra' },
  { jurisdiction: 'California',    asset_classes: ['solar'],           reg_type: 'hazardous',     status: 'in_force',  effective: '2021',
    detail: 'DTSC universal-waste rule (1 Jan 2021): hazardous PV modules managed under streamlined universal-waste standards.',
    source_url: 'https://dtsc.ca.gov/photovoltaic-modules-pv-modules-universal-waste-management-regulations/' },
  { jurisdiction: 'Washington',    asset_classes: ['solar'],           reg_type: 'epr',           status: 'phased',    effective: '2031',
    detail: 'SB 5939 (2017) PV stewardship; manufacturer plan deadline delayed by 2025 amendment to 31 Jan 2031.',
    source_url: 'https://ecology.wa.gov/waste-toxics/reducing-recycling-waste/our-recycling-programs/solar-panels' },
  { jurisdiction: 'New Jersey',    asset_classes: ['solar'],           reg_type: 'requirement',   status: 'proposed',  effective: '—',
    detail: 'S3399 (2024-25 session): mandatory end-of-life recycling for solar facilities; not yet enacted.',
    source_url: 'https://www.njleg.state.nj.us/bill-search/2024/S3399' },
  { jurisdiction: 'Illinois',      asset_classes: ['wind','solar'],    reg_type: 'requirement',   status: 'in_force',  effective: '2023',
    detail: 'PA 102-1123 (HB4412): uniform siting incl. decommissioning + financial-assurance duties; no blade landfill ban.',
    source_url: 'https://www.ilga.gov/legislation/publicacts/102/PDF/102-1123.pdf' },
  { jurisdiction: 'Colorado',      asset_classes: ['wind'],            reg_type: 'no_regulation', status: 'no_rule',   effective: '—',
    detail: 'No statutory blade landfill ban; decommissioning handled via county-level WECS permits.',
    source_url: 'https://cdphe.colorado.gov/hm/solid-waste' },
  { jurisdiction: 'New York',      asset_classes: ['solar'],           reg_type: 'requirement',   status: 'proposed',  effective: '—',
    detail: 'NYSERDA + DEC PV stewardship study (2023); A6353 producer-responsibility bill still in committee.',
    source_url: 'https://www.nysenate.gov/legislation/bills/2023/A6353' },
  { jurisdiction: 'Texas',         asset_classes: ['wind','solar'],    reg_type: 'no_regulation', status: 'no_rule',   effective: '—',
    detail: 'No specific end-of-life PV/blade rules; TCEQ Subtitle D permits govern; private decommissioning agreements.',
    source_url: 'https://www.tceq.texas.gov/permitting/waste_permits' },

  // ===== Asia-Pacific =====
  { jurisdiction: 'China',         asset_classes: ['wind','solar'],    reg_type: 'requirement',   status: 'in_force',  effective: '2023',
    detail: 'NDRC Aug 2023 Guidelines on Recycling Decommissioned Wind & PV Equipment; draft 2024 standards forbid blade landfill/burning.',
    source_url: 'https://www.gov.cn/zhengce/zhengceku/202308/content_6898728.htm' },
  { jurisdiction: 'Japan',         asset_classes: ['solar'],           reg_type: 'requirement',   status: 'proposed',  effective: '—',
    detail: 'METI/MOE bill for mandatory PV recycling submitted 2025; takes effect within 18 months of promulgation.',
    source_url: 'https://www.meti.go.jp/policy/safety_security/industrial_safety/sangyo/electric/detail/solar_recycle.html' },
  { jurisdiction: 'Japan',         asset_classes: ['bess'],            reg_type: 'epr',           status: 'in_force',  effective: '2001',
    detail: 'Law for Promotion of Effective Utilisation of Resources: producer take-back of small rechargeable batteries via JBRC.',
    source_url: 'https://www.meti.go.jp/policy/recycle/main/english/law/promotion.html' },
  { jurisdiction: 'South Korea',   asset_classes: ['solar'],           reg_type: 'epr',           status: 'in_force',  effective: '2023',
    detail: 'PV modules added to EPR scheme 1 Jan 2023 under Resource Recycling Act; manufacturer recycling-fee obligations.',
    source_url: 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=240688' },
  { jurisdiction: 'South Korea',   asset_classes: ['bess'],            reg_type: 'epr',           status: 'in_force',  effective: '2008',
    detail: 'Resource Recycling Act EPR for portable & industrial batteries incl. Li-ion; KECO administers.',
    source_url: 'https://www.keco.or.kr/en/lay1/S295T386C400/contents.do' },
  { jurisdiction: 'Australia (Victoria)', asset_classes: ['solar','bess'], reg_type: 'landfill_ban', status: 'in_force', effective: '2019',
    detail: 'Victorian e-waste landfill ban from 1 Jul 2019 covers PV modules and batteries.',
    source_url: 'https://www.vic.gov.au/e-waste-ban' },
  { jurisdiction: 'Australia',     asset_classes: ['bess'],            reg_type: 'epr',           status: 'voluntary', effective: '2022',
    detail: 'B-cycle: ACCC-authorised voluntary battery stewardship scheme; Li-ion EV/ESS in scope from 2022.',
    source_url: 'https://bcycle.com.au/' },
  { jurisdiction: 'Australia',     asset_classes: ['solar'],           reg_type: 'requirement',   status: 'proposed',  effective: '—',
    detail: 'Federal A$24.7m National Solar Panel Recycling Pilot (2024) precursor to national stewardship scheme.',
    source_url: 'https://www.dcceew.gov.au/environment/protection/waste/product-stewardship/products-schemes/solar-systems' },
]

// Region grouping for sort/filter
type RegRegion = 'EU' | 'UK' | 'US' | 'AsiaPac'
const REG_REGION_OF: Record<string, RegRegion> = {
  'EU27': 'EU', 'Germany': 'EU', 'France': 'EU', 'Netherlands': 'EU',
  'Italy': 'EU', 'Spain': 'EU', 'Denmark': 'EU', 'Sweden': 'EU',
  'Austria': 'EU', 'Finland': 'EU', 'Poland': 'EU', 'Ireland': 'EU',
  'United Kingdom': 'UK',
  'US Federal': 'US', 'California': 'US', 'Washington': 'US', 'New Jersey': 'US',
  'Illinois': 'US', 'Colorado': 'US', 'New York': 'US', 'Texas': 'US',
  'China': 'AsiaPac', 'Japan': 'AsiaPac', 'South Korea': 'AsiaPac',
  'Australia': 'AsiaPac', 'Australia (Victoria)': 'AsiaPac',
}

const REG_TYPE_LABEL: Record<RegType, string> = {
  landfill_ban:  'Landfill ban',
  restriction:   'Restriction',
  epr:           'EPR',
  requirement:   'Requirement',
  hazardous:     'Hazardous classification',
  no_regulation: 'No regulation',
}

const REG_TYPE_STYLE: Record<RegType, string> = {
  landfill_ban:  'bg-red-50 text-red-700 border-red-200',
  restriction:   'bg-amber-50 text-amber-700 border-amber-200',
  hazardous:     'bg-red-50 text-red-700 border-red-200',
  epr:           'bg-blue-50 text-blue-700 border-blue-200',
  requirement:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  no_regulation: 'bg-canvas text-ink-4 border-border',
}

const REG_STATUS_LABEL: Record<RegStatus, string> = {
  in_force:  'In force',
  phased:    'Phased',
  proposed:  'Proposed',
  voluntary: 'Voluntary',
  no_rule:   'No rule',
}

const REG_STATUS_STYLE: Record<RegStatus, string> = {
  in_force:  'text-ink',
  phased:    'text-blue-700',
  proposed:  'text-amber-700',
  voluntary: 'text-ink-3',
  no_rule:   'text-ink-4 italic',
}

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try { return new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) }
  catch { return '—' }
}

// ── Panel chrome ──────────────────────────────────────────────────────────────

function Panel({
  label, title, meta, children, className,
}: {
  label:    string
  title:    string
  meta?:    React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={clsx('bg-panel border border-border rounded-sm flex flex-col overflow-hidden', className)}>
      <div className="h-7 px-3 flex items-center justify-between border-b border-border bg-titlebar flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="label-xs">{label}</span>
          <span className="text-ink-4 text-[10px]">·</span>
          <span className="text-[12.5px] font-semibold text-ink truncate">{title}</span>
        </div>
        {meta && <div className="text-[10.5px] text-ink-3 flex items-center gap-2 flex-shrink-0">{meta}</div>}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  )
}

// ── 01 Endenex Eye — satellite capacity surveillance (2-row tall) ────────────
//
// Reads from satellite_facilities + satellite_observations. For each
// facility, surfaces the most-recent imagery + AI capacity-tightness
// assessment.

interface SatelliteFacility {
  id:                number
  name:              string
  operator_name:     string | null
  asset_class:       'wind' | 'solar' | 'bess'
  facility_type:     string
  country:           string | null
  region:            string | null
  lat:               number
  lng:               number
  capacity_kt_year:  number | null
  status:            string
  source_url:        string | null
}

interface SatelliteObservation {
  id:                       number
  facility_id:              number
  observation_date:         string
  image_url:                string | null
  imagery_provider:         string
  resolution_m:             number | null
  cloud_cover_pct:          number | null
  stockpile_area_m2:        number | null
  stockpile_change_pct:     number | null
  capacity_tightness_pct:   number | null
  blade_count_estimate:     number | null
  ai_assessment:            string | null
  ai_model:                 string | null
  confidence:               'low' | 'medium' | 'high' | null
}

const tightnessTone = (pct: number | null): { label: string; cls: string } => {
  if (pct == null)          return { label: '—',          cls: 'text-ink-4' }
  if (pct >= 100)           return { label: 'BOTTLENECK', cls: 'text-red-700 font-bold' }
  if (pct >=  85)           return { label: 'SATURATED',  cls: 'text-red-600 font-bold' }
  if (pct >=  70)           return { label: 'TIGHT',      cls: 'text-amber-700 font-bold' }
  if (pct >=  50)           return { label: 'MODERATE',   cls: 'text-amber-600 font-semibold' }
  return                       { label: 'SLACK',         cls: 'text-emerald-700 font-semibold' }
}

function BladeOutlookPanel() {
  const [facilities,   setFacilities]   = useState<SatelliteFacility[]>([])
  const [observations, setObservations] = useState<Record<number, SatelliteObservation>>({})
  const [selectedId,   setSelectedId]   = useState<number | null>(null)
  const [loading,      setLoading]      = useState(true)

  // Load facilities + latest observation per facility
  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      supabase.from('satellite_facilities').select('*').eq('status', 'active'),
      supabase.from('satellite_observations').select('*')
        .order('observation_date', { ascending: false })
        .order('id', { ascending: false }),
    ]).then(([facRes, obsRes]) => {
      if (!alive) return
      const fac = ((facRes.data ?? []) as SatelliteFacility[]).sort((a, b) => a.name.localeCompare(b.name))
      const latestPerFacility: Record<number, SatelliteObservation> = {}
      for (const o of (obsRes.data ?? []) as SatelliteObservation[]) {
        if (!latestPerFacility[o.facility_id]) latestPerFacility[o.facility_id] = o
      }
      setFacilities(fac)
      setObservations(latestPerFacility)
      setSelectedId(prev => prev ?? fac[0]?.id ?? null)
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  const selected     = facilities.find(f => f.id === selectedId) ?? null
  const selectedObs  = selected ? observations[selected.id] : undefined
  const tone         = tightnessTone(selectedObs?.capacity_tightness_pct ?? null)

  return (
    <Panel label="PCM" title="Endenex Eye" className="col-span-6 row-span-2"
           meta={<span className="text-[10.5px] text-ink-4 uppercase tracking-wide">Satellite surveillance</span>}>
      {/* 3-column layout: facility list (25%) · imagery (50%) · assessment (25%) */}
      <div className="grid grid-cols-4 h-full min-h-0">

        {/* Col 1: facility list */}
        <div className="col-span-1 border-r border-border overflow-y-auto bg-canvas/30">
          {loading ? (
            <div className="px-3 py-4 text-[11px] text-ink-3 text-center">Loading…</div>
          ) : facilities.length === 0 ? (
            <div className="px-3 py-4 text-[11px] text-ink-3 text-center leading-snug">
              No facilities seeded.<br/>Run migration 069.
            </div>
          ) : facilities.map(f => {
            const obs = observations[f.id]
            const t = tightnessTone(obs?.capacity_tightness_pct ?? null)
            const isSel = selectedId === f.id
            return (
              <div key={f.id}
                   onClick={() => setSelectedId(f.id)}
                   className={clsx(
                     'px-2 py-1.5 cursor-pointer border-b border-border/60 border-l-2',
                     isSel ? 'bg-active border-l-teal' : 'hover:bg-raised border-l-transparent',
                   )}>
                <div className="text-[10.5px] text-ink font-semibold leading-tight truncate">
                  {f.name}
                </div>
                <div className="text-[9px] text-ink-4 truncate">
                  {f.country} · {f.facility_type.replace(/_/g, ' ')}
                </div>
                <div className="flex items-center gap-1 mt-0.5 text-[10px]">
                  <span className={t.cls}>{obs?.capacity_tightness_pct != null ? `${obs.capacity_tightness_pct}%` : '—'}</span>
                  <span className="text-ink-4">·</span>
                  <span className={clsx('text-[8.5px] tracking-wider', t.cls)}>{t.label}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Col 2: imagery (50% of panel) */}
        <div className="col-span-2 bg-slate-900 flex items-center justify-center relative overflow-hidden border-r border-border">
          {!selected ? (
            <div className="text-[11.5px] text-slate-300">Select a facility</div>
          ) : selectedObs?.image_url ? (
            <img src={selectedObs.image_url}
                 alt={`${selected.name} on ${selectedObs.observation_date}`}
                 className="max-h-full max-w-full object-contain" />
          ) : (
            <div className="text-center px-4">
              <div className="text-[11px] font-semibold text-slate-200 uppercase tracking-wider mb-1">
                No imagery yet
              </div>
              <div className="text-[10px] text-slate-400 leading-snug max-w-xs">
                Run <code className="bg-slate-800 px-1 rounded">fetch_satellite_imagery.py</code> to pull imagery + AI assessment for this facility.
              </div>
            </div>
          )}
          {selected && selectedObs?.observation_date && (
            <div className="absolute top-1.5 left-1.5 text-[9.5px] text-white bg-black/60 px-1.5 py-0.5 rounded-sm font-mono">
              {selectedObs.observation_date} · {selectedObs.imagery_provider} · {selectedObs.resolution_m ?? '—'} m/px
            </div>
          )}
        </div>

        {/* Col 3: assessment + meta */}
        <div className="col-span-1 overflow-y-auto bg-canvas/40">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-[11.5px] text-ink-3 px-3 text-center">
              Select a facility for assessment
            </div>
          ) : (
            <div className="px-2.5 py-2.5 space-y-2.5">
              {/* Headline */}
              <div>
                <div className="text-[12px] text-ink font-semibold leading-tight">{selected.name}</div>
                <div className="text-[9.5px] text-ink-3 leading-snug mt-0.5">
                  {selected.operator_name ?? '—'}
                </div>
                {selected.capacity_kt_year && (
                  <div className="text-[9.5px] text-ink-4 mt-0.5">
                    {selected.capacity_kt_year} kt/yr nameplate
                  </div>
                )}
              </div>

              {/* Tightness hero */}
              <div className="bg-canvas border border-border rounded-sm p-2">
                <div className="text-[9px] uppercase tracking-wider text-ink-4 font-semibold">
                  Capacity tightness
                </div>
                <div className={clsx('text-[22px] tabular-nums leading-none mt-1', tone.cls)}>
                  {selectedObs?.capacity_tightness_pct != null
                    ? `${selectedObs.capacity_tightness_pct}%`
                    : '—'}
                </div>
                <div className={clsx('text-[9.5px] tracking-wider mt-0.5', tone.cls)}>
                  {tone.label}
                </div>
              </div>

              {/* AI commentary */}
              <div>
                <div className="text-[9px] uppercase tracking-wider text-ink-4 font-semibold mb-1">
                  AI assessment
                </div>
                {selectedObs?.ai_assessment ? (
                  <div className="text-[10.5px] text-ink-2 leading-snug italic">
                    “{selectedObs.ai_assessment}”
                  </div>
                ) : (
                  <div className="text-[10.5px] text-ink-4 italic">
                    No AI assessment yet.
                  </div>
                )}
              </div>

              {/* Detail metrics */}
              <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                {selectedObs?.stockpile_area_m2 != null && (
                  <div>
                    <div className="text-[9px] uppercase tracking-wide text-ink-4">Stockpile</div>
                    <div className="text-ink tabular-nums">{Math.round(selectedObs.stockpile_area_m2).toLocaleString()} m²</div>
                  </div>
                )}
                {selectedObs?.blade_count_estimate != null && (
                  <div>
                    <div className="text-[9px] uppercase tracking-wide text-ink-4">Blades</div>
                    <div className="text-ink tabular-nums">~{selectedObs.blade_count_estimate}</div>
                  </div>
                )}
                {selectedObs?.confidence && (
                  <div>
                    <div className="text-[9px] uppercase tracking-wide text-ink-4">Confidence</div>
                    <div className="text-ink-2 capitalize">{selectedObs.confidence}</div>
                  </div>
                )}
                {selectedObs?.ai_model && (
                  <div>
                    <div className="text-[9px] uppercase tracking-wide text-ink-4">Model</div>
                    <div className="text-ink-2 truncate">{selectedObs.ai_model}</div>
                  </div>
                )}
              </div>

              {selected.source_url && (
                <div className="pt-1 border-t border-border/60">
                  <a href={selected.source_url} target="_blank" rel="noreferrer"
                     className="text-[10px] text-teal hover:underline">
                    Facility website ↗
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}

// ── 03 Gate Fees panel ────────────────────────────────────────────────────────

const GATE_ASSET_TABS: { code: GateAssetClass | 'all'; label: string }[] = [
  { code: 'all',   label: 'All'   },
  { code: 'wind',  label: 'Wind'  },
  { code: 'solar', label: 'Solar' },
  { code: 'bess',  label: 'BESS'  },
]

const GATE_REGION_TABS: { code: GateRegion | 'all'; label: string }[] = [
  { code: 'all',     label: 'All'      },
  { code: 'EU',      label: 'EU'       },
  { code: 'UK',      label: 'UK'       },
  { code: 'US',      label: 'US'       },
  { code: 'AsiaPac', label: 'Asia-Pac' },
]

type GateSort = 'none' | 'cost_asc' | 'cost_desc'

function GateFeesTablePanel() {
  const [assetClass, setAssetClass] = useState<GateAssetClass | 'all'>('all')
  const [region,     setRegion]     = useState<GateRegion | 'all'>('all')
  const [sort,       setSort]       = useState<GateSort>('none')

  const filtered = GATE_FEE_TABLE
    .filter(r => assetClass === 'all' || r.asset_classes.includes(assetClass))
    .filter(r => region === 'all' || r.region_group === region)

  // Cost rows always above non-cost (banned/restricted/payable/na).
  // When a sort direction is active, cost rows sort by USD-equivalent.
  const sorted = filtered.slice().sort((a, b) => {
    const aCost = a.status === 'cost'
    const bCost = b.status === 'cost'
    if (aCost && !bCost) return -1
    if (!aCost && bCost) return 1
    if (sort !== 'none' && aCost && bCost) {
      const dir = sort === 'cost_asc' ? 1 : -1
      return ((medianUsd(a) ?? 0) - (medianUsd(b) ?? 0)) * dir
    }
    return 0
  })

  const cycleSort = () =>
    setSort(s => s === 'none' ? 'cost_asc' : s === 'cost_asc' ? 'cost_desc' : 'none')
  const sortArrow = sort === 'cost_asc' ? ' ↑' : sort === 'cost_desc' ? ' ↓' : ''

  return (
    <Panel label="PCM" title="Gate Fees" className="col-span-6"
           meta={
             <div className="flex items-center gap-1.5">
               <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
                 {GATE_ASSET_TABS.map(t => (
                   <button key={t.code} onClick={() => setAssetClass(t.code)}
                           className={clsx(
                             'px-1.5 py-0.5 text-[10px] font-semibold tracking-wide rounded-sm',
                             assetClass === t.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                           )}>
                     {t.label}
                   </button>
                 ))}
               </div>
               <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
                 {GATE_REGION_TABS.map(t => (
                   <button key={t.code} onClick={() => setRegion(t.code)}
                           className={clsx(
                             'px-1.5 py-0.5 text-[10px] font-semibold tracking-wide rounded-sm',
                             region === t.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                           )}>
                     {t.label}
                   </button>
                 ))}
               </div>
             </div>
           }>
      <table className="w-full table-fixed">
        <colgroup>
          <col style={{ width: '30%' }} />
          <col style={{ width: '12.5%' }} />
          <col style={{ width: '12.5%' }} />
          <col style={{ width: '45%' }} />
        </colgroup>
        <thead>
          <tr className="bg-titlebar border-b border-border sticky top-0 z-10">
            <th className="px-2 py-1 text-left  text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Pathway</th>
            <th className="px-2 py-1 text-left  text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Region</th>
            <th onClick={cycleSort}
                title={
                  sort === 'none'     ? 'Click to sort low → high'
                  : sort === 'cost_asc' ? 'Sorted low → high · click for high → low'
                  :                     'Sorted high → low · click to clear sort'
                }
                className="px-2 py-1 text-right text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide cursor-pointer hover:text-teal select-none whitespace-nowrap">
              Median{sortArrow}
            </th>
            <th className="px-2 py-1 text-left  text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Notes</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} className="border-b border-border/70 hover:bg-raised align-top">
              <td className="px-2 py-1">
                <div className="text-[11px] text-ink font-medium leading-tight">{r.pathway}</div>
                {assetClass === 'all' && (
                  <div className="text-[9px] text-ink-4 uppercase tracking-wide mt-0.5">
                    {r.asset_classes.join(' · ')}
                  </div>
                )}
              </td>
              <td className="px-2 py-1 text-[10.5px] text-ink-2 leading-snug break-words">
                {/* Insert zero-width spaces after slashes so long lists like
                    "DE / NL / SE / AT / FI / DK" wrap cleanly to two rows */}
                {r.region.replace(/\s*\/\s*/g, ' /​')}
              </td>
              <td className={clsx('px-2 py-1 text-right text-[11px] whitespace-nowrap', GATE_STATUS_STYLE[r.status])}
                  title={`Range: ${r.range}\nConfidence: ${r.confidence}`}>
                {r.status === 'cost' && r.median_local != null
                  ? <>{GATE_CURRENCY_SYMBOL[r.currency]}{r.median_local.toLocaleString('en-US', { maximumFractionDigits: 0 })}<span className="text-[9.5px] text-ink-4 font-normal">/t</span></>
                  : GATE_STATUS_LABEL[r.status]}
                <div className={clsx('text-[8.5px] font-normal mt-0.5 uppercase tracking-wide',
                  r.confidence === 'confident' ? 'text-emerald-700'
                  : r.confidence === 'plausible' ? 'text-amber-700'
                  : 'text-ink-4')}>
                  {r.confidence}
                </div>
              </td>
              <td className="px-2 py-1 text-[10.5px] text-ink-3 leading-snug">
                {r.notes}
                {r.source && (
                  <> · <a href={r.source} target="_blank" rel="noreferrer"
                          className="text-ink-4 hover:text-teal hover:underline italic">source</a></>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

// ── 04 Regulatory Context panel ───────────────────────────────────────────────

const REG_ASSET_TABS: { code: RegAssetClass | 'all'; label: string }[] = [
  { code: 'all',   label: 'All'   },
  { code: 'wind',  label: 'Wind'  },
  { code: 'solar', label: 'Solar' },
  { code: 'bess',  label: 'BESS'  },
]

const REG_REGION_TABS: { code: RegRegion | 'all'; label: string }[] = [
  { code: 'all',     label: 'All'        },
  { code: 'EU',      label: 'EU'         },
  { code: 'UK',      label: 'UK'         },
  { code: 'US',      label: 'US'         },
  { code: 'AsiaPac', label: 'Asia-Pac'   },
]
const REG_REGION_ORDER: Record<RegRegion, number> = {
  EU: 0, UK: 1, US: 2, AsiaPac: 3,
}

function RegulatoryContextPanel() {
  const [assetClass, setAssetClass] = useState<RegAssetClass | 'all'>('all')
  const [region,     setRegion]     = useState<RegRegion | 'all'>('all')

  const filtered = REGULATIONS
    .filter(r => assetClass === 'all' || r.asset_classes.includes(assetClass))
    .filter(r => region === 'all' || REG_REGION_OF[r.jurisdiction] === region)

  // Sort: by region first (EU → UK → US → AsiaPac), then status (in_force →
  // phased → proposed → voluntary → no_rule), then jurisdiction alphabetical.
  const STATUS_ORDER: Record<RegStatus, number> = {
    in_force: 0, phased: 1, proposed: 2, voluntary: 3, no_rule: 4,
  }
  const sorted = filtered.slice().sort((a, b) => {
    const ra = REG_REGION_ORDER[REG_REGION_OF[a.jurisdiction]] ?? 9
    const rb = REG_REGION_ORDER[REG_REGION_OF[b.jurisdiction]] ?? 9
    if (ra !== rb) return ra - rb
    const sa = STATUS_ORDER[a.status]
    const sb = STATUS_ORDER[b.status]
    if (sa !== sb) return sa - sb
    return a.jurisdiction.localeCompare(b.jurisdiction)
  })

  return (
    <Panel label="PCM" title="Regulatory Context" className="col-span-6"
           meta={
             <div className="flex items-center gap-1.5">
               <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
                 {REG_ASSET_TABS.map(t => (
                   <button key={t.code} onClick={() => setAssetClass(t.code)}
                           className={clsx(
                             'px-1.5 py-0.5 text-[10px] font-semibold tracking-wide rounded-sm',
                             assetClass === t.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                           )}>
                     {t.label}
                   </button>
                 ))}
               </div>
               <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
                 {REG_REGION_TABS.map(t => (
                   <button key={t.code} onClick={() => setRegion(t.code)}
                           className={clsx(
                             'px-1.5 py-0.5 text-[10px] font-semibold tracking-wide rounded-sm',
                             region === t.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                           )}>
                     {t.label}
                   </button>
                 ))}
               </div>
             </div>
           }>
      <table className="w-full table-fixed">
        <colgroup>
          <col style={{ width: '20%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '45%' }} />
        </colgroup>
        <thead>
          <tr className="bg-titlebar border-b border-border sticky top-0 z-10">
            <th className="px-2 py-1 text-left text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Jurisdiction</th>
            <th className="px-2 py-1 text-left text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Type</th>
            <th className="px-2 py-1 text-left text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Status</th>
            <th className="px-2 py-1 text-left text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Eff.</th>
            <th className="px-2 py-1 text-left text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Detail</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={`${r.jurisdiction}-${r.reg_type}-${i}`} className="border-b border-border/70 hover:bg-raised align-top">
              <td className="px-2 py-1">
                <a href={r.source_url} target="_blank" rel="noreferrer"
                   className="text-[11.5px] text-ink font-semibold leading-tight hover:text-teal hover:underline"
                   title="Open primary source">
                  {r.jurisdiction}
                </a>
                {assetClass === 'all' && (
                  <div className="text-[9px] text-ink-4 uppercase tracking-wide mt-0.5">
                    {r.asset_classes.join(' · ')}
                  </div>
                )}
              </td>
              <td className="px-2 py-1">
                <span className={clsx(
                  'text-[9px] font-bold px-1 py-px rounded-sm border tracking-wide',
                  REG_TYPE_STYLE[r.reg_type],
                )}>
                  {REG_TYPE_LABEL[r.reg_type]}
                </span>
              </td>
              <td className="px-2 py-1 text-[10.5px]">
                <span className={REG_STATUS_STYLE[r.status]}>
                  {REG_STATUS_LABEL[r.status]}
                </span>
              </td>
              <td className="px-2 py-1 text-[10.5px] text-ink-3 tabular-nums">{r.effective}</td>
              <td className="px-2 py-1 text-[10.5px] text-ink-2 leading-snug">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

// ── 05 Waste Flow Forecast panel ─────────────────────────────────────────────
//
// First-degree material recovery forecast. Pipes:
//   1. retirement_schedule_v (migration 053): retiring MW × year × country ×
//      asset_class × commission_year (preserves vintage cohort)
//   2. material_assumptions.ts: cohort-aware kg/MW intensities + first-degree
//      recovery rates
//   3. Aggregate by year × material → stacked area chart + detail table
//
// Asset class + region toggles match the rest of the PCM page aesthetic.
// Methodology note in footer documents the first-degree convention.

const WFF_REGIONS: { code: string; label: string; countries: string[] | null }[] = [
  { code: 'EU',     label: 'EU',     countries: ['DE','FR','ES','IT','NL','DK','SE','PL','PT','BE','AT','CZ','GR','IE','FI'] },
  { code: 'UK',     label: 'UK',     countries: ['GB'] },
  { code: 'US',     label: 'US',     countries: ['US'] },
  { code: 'GLOBAL', label: 'Global', countries: null }, // null = no filter
]

const WFF_ASSET_CLASSES: { code: AssetClass; label: string }[] = [
  { code: 'wind',  label: 'Wind' },
  { code: 'solar', label: 'Solar PV' },
  { code: 'bess',  label: 'BESS' },
]

// Stacked-area band colors. Standard 8-color industrial palette,
// muted to match the panel aesthetic. Materials map deterministically.
const MATERIAL_COLORS: Record<string, string> = {
  steel:        '#6b7280',  // grey
  cast_iron:    '#9ca3af',  // light grey
  copper:       '#b87333',  // copper
  aluminium:    '#94a3b8',  // slate
  zinc:         '#a1a1aa',  // zinc grey
  rare_earth:   '#9333ea',  // purple
  composite:    '#dc2626',  // red (waste)
  polymer:      '#9b9b9b',  // dim grey (waste)
  glass:        '#06b6d4',  // cyan
  silicon:      '#1e293b',  // dark slate
  silver:       '#d4d4d8',  // silver
  black_mass:   '#000000',  // black (literal)
  electrolyte:  '#7c7c7c',  // mid grey (waste)
}

interface InstallHistoryRow {
  asset_class:  'wind_onshore' | 'wind_offshore' | 'solar' | 'bess'
  country:      string
  region:       string | null
  year:         number       // commission year
  capacity_mw:  number
  duration_h:   number | null  // BESS only — used to derive MWh
}

/** Same triangular distribution as ARI panels — median ±2y window. */
function triangularAnnualRetirement(age: number, median: number): number {
  if (age < 0) return 0
  const offset = Math.abs(Math.round(age) - median)
  if (offset > 2) return 0
  return (3 - offset) / 9
}

interface YearMaterialBand {
  year:            number
  total_t:         number
  recovered_t:     number
  recoverable_value_usd: number
  // Plus dynamic per-material columns set on the object
  [material_key:   string]: number
}

interface MaterialDetailRow {
  material:           string
  display:            string
  recovery_pct:       number
  unit_price_usd_t:   number      // central estimate (chemistry-weighted for BESS black mass)
  total_t_2030:       number      // P50 central
  recovered_t_2030:   number      // P50 central
  recovered_t_2030_p10: number
  recovered_t_2030_p90: number
  total_t_2035:       number
  recovered_t_2035:   number
  source:             string
}

function getCohortsFor(ac: AssetClass): VintageCohort[] {
  return ac === 'wind' ? WIND_COHORTS : ac === 'solar' ? SOLAR_COHORTS : BESS_COHORTS
}

function getIntensitiesFor(ac: AssetClass): Record<string, MaterialIntensity[]> {
  return ac === 'wind' ? WIND_INTENSITIES : ac === 'solar' ? SOLAR_INTENSITIES : BESS_INTENSITIES
}

// Map our AssetClass (wind/solar/bess) to the installation_history
// asset_class enum values (wind_onshore, wind_offshore, solar, bess).
function dbAssetClassFilter(ac: AssetClass): string[] {
  if (ac === 'wind')  return ['wind_onshore', 'wind_offshore']
  if (ac === 'solar') return ['solar']
  return ['bess']
}

const RETIRE_YEARS_WFF = Array.from({ length: 10 }, (_, i) => 2026 + i)  // 2026-2035 (matches ARI panels)

function WasteFlowForecastPanel() {
  const [assetClass, setAssetClass] = useState<AssetClass>('wind')
  const [region, setRegion]         = useState('GLOBAL')
  const [rows, setRows]             = useState<InstallHistoryRow[]>([])
  const [loading, setLoading]       = useState(true)

  // Median design life — read from shared store so ARI sliders drive
  // this panel too. When user drags slider in ARI, this panel updates.
  const median = useDesignLife(s => assetClass === 'wind'  ? s.windMedianYears
                                  : assetClass === 'solar' ? s.solarMedianYears
                                  :                          s.bessMedianYears)

  useEffect(() => {
    setLoading(true)
    let q = supabase
      .from('installation_history')
      .select('asset_class, country, region, year, capacity_mw, duration_h')
      .in('asset_class', dbAssetClassFilter(assetClass))

    const cfg = WFF_REGIONS.find(r => r.code === region)
    if (cfg?.countries) q = q.in('country', cfg.countries)

    q.then(({ data }) => {
      setRows((data ?? []) as InstallHistoryRow[])
      setLoading(false)
    })
  }, [assetClass, region])

  // Compute chart series + detail rows + chemistry-weighted BESS pricing
  // + confidence bands. Mirrors ARI panels' triangular-distribution
  // retirement model with the SAME slider-driven median design life
  // (sourced from the shared design-life store).
  //
  // Pipeline:
  //   installation_history (commission year × country × MW)
  //     × triangular distribution(age, median)
  //     × cohort-aware intensity per MW
  //     × first-degree recovery %
  //   = recovered tonnes per (retire year × material)
  const { chartData, detailRows, materialKeys, bessChemistryBlend, totalRange2030 } = useMemo(() => {
    const cohorts     = getCohortsFor(assetClass)
    const intensities = getIntensitiesFor(assetClass)
    const recovery    = FIRST_DEGREE_RECOVERY[assetClass]

    // Tally by retire-year × material
    const byYear: Record<number, Record<string, number>> = {}
    // Detail accumulator (per material)
    const byMaterial: Record<string, { source: string; display: string }> = {}
    // BESS-only: track chemistry-weighted black mass price by retiring MW
    let bmPriceWeightedSum = 0
    let bmPriceWeightedDen = 0
    // Cohort retiring-MW totals — used for chemistry blend display
    const cohortMwTotals: Record<string, number> = {}

    for (const r of rows) {
      // Convert capacity to the right unit. Wind/solar = MW; BESS = MWh
      // (capacity_mw × duration_h, same as ARI BESS panel).
      const mw_or_mwh = (assetClass === 'bess' && r.duration_h != null)
        ? r.capacity_mw * r.duration_h
        : r.capacity_mw

      const cohort = cohortForYear(cohorts, r.year)
      const mats   = intensities[cohort.label] ?? []

      // For each retire year in window, what fraction of this cohort retires?
      for (const retireY of RETIRE_YEARS_WFF) {
        const age = retireY - r.year
        const frac = triangularAnnualRetirement(age, median)
        if (frac === 0) continue
        const retiringThisYear = mw_or_mwh * frac

        cohortMwTotals[cohort.label] = (cohortMwTotals[cohort.label] ?? 0) + retiringThisYear

        for (const m of mats) {
          const tonnes = (retiringThisYear * m.kg_per_unit) / 1000
          if (!byYear[retireY]) byYear[retireY] = {}
          byYear[retireY][m.material] = (byYear[retireY][m.material] ?? 0) + tonnes
          if (!byMaterial[m.material]) byMaterial[m.material] = { source: m.source, display: m.display }
        }

        if (assetClass === 'bess') {
          const price = bessChemistryWeightedPrice(cohort)
          bmPriceWeightedSum += price * retiringThisYear
          bmPriceWeightedDen += retiringThisYear
        }
      }
    }

    // Materials present in any cohort
    const materialKeys = Array.from(new Set(
      Object.values(intensities).flat().map(m => m.material),
    ))

    // Chart data: sorted by year, one column per material (P50 / central)
    const chartData: YearMaterialBand[] = Object.entries(byYear)
      .map(([year, mats]) => {
        const row: YearMaterialBand = { year: +year, total_t: 0, recovered_t: 0, recoverable_value_usd: 0 }
        for (const k of materialKeys) {
          const t      = mats[k] ?? 0
          row[k]       = Math.round(t)
          row.total_t += t
          const rec    = t * (recovery[k] ?? 0) / 100
          row.recovered_t += rec
        }
        return row
      })
      .sort((a, b) => a.year - b.year)

    // Total range for 2030 (P10 → P90 across all materials combined)
    const total2030 = chartData.find(c => c.year === 2030)?.total_t ?? 0
    const totalRange2030 = applyUncertainty(total2030, assetClass)

    // BESS chemistry blend (for footer display)
    const bessChemistryBlend = (() => {
      if (assetClass !== 'bess') return null
      const mixWeighted: { nmc: number; lfp: number; nca: number; na_ion: number } =
        { nmc: 0, lfp: 0, nca: 0, na_ion: 0 }
      let totalMw = 0
      for (const [label, mw] of Object.entries(cohortMwTotals)) {
        const mix = BESS_CHEMISTRY_MIX[label]
        if (!mix) continue
        mixWeighted.nmc    += mix.nmc    * mw
        mixWeighted.lfp    += mix.lfp    * mw
        mixWeighted.nca    += mix.nca    * mw
        mixWeighted.na_ion += mix.na_ion * mw
        totalMw += mw
      }
      if (totalMw === 0) return null
      const norm = (n: number) => Math.round((n / totalMw) * 100)
      return {
        nmc:    norm(mixWeighted.nmc),
        lfp:    norm(mixWeighted.lfp),
        nca:    norm(mixWeighted.nca),
        na_ion: norm(mixWeighted.na_ion),
        avg_price: bmPriceWeightedDen > 0 ? Math.round(bmPriceWeightedSum / bmPriceWeightedDen) : 0,
      }
    })()

    // Detail rows for the table — with confidence bands on recovered tonnage
    const detailRows: MaterialDetailRow[] = materialKeys.map(k => {
      const acc = byMaterial[k]
      const t30 = byYear[2030]?.[k] ?? 0
      const t35 = byYear[2035]?.[k] ?? 0
      const recPct = recovery[k] ?? 0
      const rec30 = t30 * recPct / 100
      const band30 = applyUncertainty(rec30, assetClass)

      // BESS black mass uses chemistry-weighted price; everything else
      // uses the static FIRST_DEGREE_PRICING table.
      const unitPrice = (assetClass === 'bess' && k === 'black_mass' && bessChemistryBlend)
        ? bessChemistryBlend.avg_price
        : (FIRST_DEGREE_PRICING_USD_PER_T[k] ?? 0)

      return {
        material:             k,
        display:              acc?.display ?? k,
        recovery_pct:         recPct,
        unit_price_usd_t:     unitPrice,
        total_t_2030:         Math.round(t30),
        recovered_t_2030:     Math.round(rec30),
        recovered_t_2030_p10: Math.round(band30.p10),
        recovered_t_2030_p90: Math.round(band30.p90),
        total_t_2035:         Math.round(t35),
        recovered_t_2035:     Math.round(t35 * recPct / 100),
        source:               acc?.source ?? '—',
      }
    }).sort((a, b) => b.total_t_2030 - a.total_t_2030)

    return { chartData, detailRows, materialKeys, bessChemistryBlend, totalRange2030 }
  }, [rows, assetClass, median])

  const fmtT = (n: number) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}Mt`
                            : n >= 1_000     ? `${(n/1_000).toFixed(0)}kt`
                            : `${n.toFixed(0)}t`
  const fmtUsd = (n: number) => n >= 1_000_000_000 ? `$${(n/1_000_000_000).toFixed(1)}B`
                              : n >= 1_000_000     ? `$${(n/1_000_000).toFixed(0)}M`
                              : n >= 1_000         ? `$${(n/1_000).toFixed(0)}k`
                              : `$${n.toFixed(0)}`

  return (
    <Panel label="PCM" title="Waste Flow Forecast" className="col-span-6"
           meta={
             <div className="flex items-center gap-1.5">
               <span className="text-[10px] text-ink-4 tabular-nums"
                     title="Median design life — set in the Asset Retirement Intelligence panel sliders. Drag the matching ARI slider to update both panels in lockstep.">
                 {median}y design life
               </span>
               <span className="text-ink-4 text-[10px]">·</span>
               <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
                 {WFF_ASSET_CLASSES.map(a => (
                   <button key={a.code} onClick={() => setAssetClass(a.code)}
                           className={clsx(
                             'px-1.5 py-0.5 text-[10px] font-semibold tracking-wide rounded-sm',
                             assetClass === a.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                           )}>
                     {a.label}
                   </button>
                 ))}
               </div>
               <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
                 {WFF_REGIONS.map(r => (
                   <button key={r.code} onClick={() => setRegion(r.code)}
                           className={clsx(
                             'px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm',
                             region === r.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                           )}>
                     {r.label}
                   </button>
                 ))}
               </div>
             </div>
           }>
      <div className="flex flex-col h-full">
        {/* Chart */}
        <div className="flex-shrink-0 h-[180px] px-2 pt-2">
          {loading ? (
            <div className="h-full flex items-center justify-center text-[12px] text-ink-3">Loading…</div>
          ) : chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[12px] text-ink-3">
              No retiring assets in this region for {assetClass}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="year"
                       tick={{ fontSize: 9, fill: '#6b7280' }}
                       axisLine={{ stroke: '#d1d5db' }}
                       tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: '#6b7280' }}
                       axisLine={false}
                       tickLine={false}
                       tickFormatter={(v: number) => fmtT(v)} />
                <RTooltip contentStyle={{ fontSize: 9, padding: '4px 6px', borderRadius: 2 }}
                          labelStyle={{ fontSize: 9, fontWeight: 600 }}
                          itemStyle={{ fontSize: 9 }}
                          formatter={(v: any) => fmtT(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 9, paddingTop: 2 }} iconSize={7} />
                {materialKeys.map(k => (
                  <Area key={k}
                        type="monotone"
                        dataKey={k}
                        stackId="materials"
                        stroke={MATERIAL_COLORS[k] ?? '#9ca3af'}
                        fill={MATERIAL_COLORS[k] ?? '#9ca3af'}
                        fillOpacity={0.75}
                        name={detailRows.find(r => r.material === k)?.display ?? k} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Total-range indicator (P10 / P50 / P90) + BESS chemistry blend */}
        {!loading && chartData.length > 0 && (
          <div className="flex-shrink-0 px-3 py-1 border-t border-border bg-canvas flex items-center justify-between gap-3">
            <div className="text-[10px] text-ink-3">
              <span className="text-ink-4 uppercase tracking-wider font-semibold mr-1.5">2030 total range</span>
              <span className="text-ink tabular-nums font-semibold">
                {fmtT(totalRange2030.p10)} – {fmtT(totalRange2030.p90)}
              </span>
              <span className="text-ink-4 ml-1">
                (P10 / P50 {fmtT(totalRange2030.p50)} / P90 · ±{UNCERTAINTY_PCT[assetClass]}%)
              </span>
            </div>
            {bessChemistryBlend && (
              <div className="text-[10px] text-ink-3 flex items-center gap-2">
                <span className="text-ink-4 uppercase tracking-wider font-semibold">Chemistry blend</span>
                <span className="text-ink tabular-nums">
                  LFP {bessChemistryBlend.lfp}% · NMC {bessChemistryBlend.nmc}%
                  {bessChemistryBlend.nca > 0 && ` · NCA ${bessChemistryBlend.nca}%`}
                  {bessChemistryBlend.na_ion > 0 && ` · Na-ion ${bessChemistryBlend.na_ion}%`}
                </span>
                <span className="text-ink-4 tabular-nums">
                  → black mass ${bessChemistryBlend.avg_price.toLocaleString('en-GB')}/t
                </span>
              </div>
            )}
          </div>
        )}

        {/* Detail table */}
        <div className="flex-1 min-h-0 overflow-auto border-t border-border">
          <table className="w-full">
            <thead>
              <tr className="bg-titlebar border-b border-border sticky top-0 z-10">
                <th className="px-2.5 py-1 text-left text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Material</th>
                <th className="px-2.5 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Recovery</th>
                <th className="px-2.5 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Unit price</th>
                <th className="px-2.5 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase tracking-wide">2030 total</th>
                <th className="px-2.5 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase tracking-wide">
                  2030 recovered
                  <span className="ml-1 text-[9px] font-normal normal-case text-ink-4">P10–P90</span>
                </th>
                <th className="px-2.5 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase tracking-wide">2035 recovered</th>
                <th className="px-2.5 py-1 text-left text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Source</th>
              </tr>
            </thead>
            <tbody>
              {detailRows.map(r => (
                <tr key={r.material} className="border-b border-border/70 hover:bg-raised">
                  <td className="px-2.5 py-1">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm flex-shrink-0"
                            style={{ background: MATERIAL_COLORS[r.material] ?? '#9ca3af' }} />
                      <span className="text-[11.5px] text-ink font-medium">{r.display}</span>
                    </div>
                  </td>
                  <td className={clsx('px-2.5 py-1 text-right text-[11.5px] tabular-nums',
                                      r.recovery_pct === 0 ? 'text-ink-4' : 'text-ink')}>
                    {r.recovery_pct}%
                  </td>
                  <td className="px-2.5 py-1 text-right text-[11.5px] tabular-nums text-ink-2">
                    {r.unit_price_usd_t > 0 ? fmtUsd(r.unit_price_usd_t) + '/t' : '—'}
                  </td>
                  <td className="px-2.5 py-1 text-right text-[11.5px] tabular-nums text-ink-2">{fmtT(r.total_t_2030)}</td>
                  <td className="px-2.5 py-1 text-right text-[11.5px] tabular-nums">
                    <span className="text-ink font-semibold">{fmtT(r.recovered_t_2030)}</span>
                    {r.recovery_pct > 0 && (
                      <span className="text-ink-4 text-[10px] ml-1">
                        ({fmtT(r.recovered_t_2030_p10)}–{fmtT(r.recovered_t_2030_p90)})
                      </span>
                    )}
                  </td>
                  <td className="px-2.5 py-1 text-right text-[11.5px] tabular-nums text-ink font-semibold">{fmtT(r.recovered_t_2035)}</td>
                  <td className="px-2.5 py-1 text-[10px] text-ink-4 max-w-[180px] truncate" title={r.source}>{r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer note */}
        <div className="flex-shrink-0 px-3 py-1 border-t border-border bg-canvas">
          <p className="text-[9.5px] text-ink-4 leading-snug">{METHODOLOGY_NOTE}</p>
        </div>
      </div>
    </Panel>
  )
}

// ── 06 Capacity Tightness panel ───────────────────────────────────────────────
//
// Shows estimated utilisation (% of installed capacity in active demand) per
// pathway × region for each asset class. Higher % = tighter capacity =
// asset owners face longer queues and higher gate fees. Sources:
//   • Wind: WindEurope 2024-25 capacity reports + ETIPWind
//   • Solar: IEA-PVPS Task 12 + SolarPower Europe annual capacity reviews
//   • BESS: Fraunhofer ISI 2025 + BNEF / BMI battery recycling outlook
// Numbers are MODELLED estimates for visualisation — confidence is "low/
// plausible" across the board. Real-world utilisation varies by month and
// is rarely disclosed by recyclers.

type TightnessAssetClass = 'wind' | 'solar' | 'bess'
type TightnessRegion     = 'EU' | 'UK' | 'US' | 'CN' | 'KR'

interface TightnessRow {
  asset_class:     TightnessAssetClass
  region:          TightnessRegion
  pathway:         string
  utilisation_pct: number   // 0-150 (>100 = demand exceeds capacity = bottleneck)
}

// REALISTIC capacity utilisation = (annual demand / nameplate capacity) × 100.
// Only includes pathways that have >=1 commercial-scale operator in the
// region. Pre-commercial routes (solvolysis, US wind pyrolysis < TRL7,
// CN solar specialty pilot scheme) are excluded — they don't yet form a
// market-relevant pathway.
//
// Source triangulation:
//   • WindEurope Decommissioning Outlook 2024-25 (EU/UK blade volumes + kiln
//     capacity); ACP / Cleanpower US Wind Decom white paper (US blade volumes)
//   • IEA-PVPS Task 12 EOL Update 2024 (EU PV recycler capacity); SolarPower
//     Europe annual reviews; SOLARCYCLE 2024 disclosures (US)
//   • Fraunhofer ISI Battery Recycling Capacity 2025 update (EU); BNEF
//     Battery Recycling 2025 (global); SMM / Mysteel (CN); Korea Herald
//     2025 (KR)
const CAPACITY_TIGHTNESS: TightnessRow[] = [
  // ── WIND blade — EU/US blade decom hasn't peaked yet; capacity slack
  // EU cement: Holcim Lägerdorf + Heidelberg + CEMEX ~150 kt/yr nominal kiln
  // intake. EU blade decom 2025 ~50 kt → ~33% utilised
  { asset_class:'wind',  region:'EU', pathway:'Cement co-processing',     utilisation_pct: 30 },
  // UK cement: Hanson Padeswood + Geocycle UK only accept limited blade
  // volumes; ~5-10 kt/yr capacity for blades; UK blade decom small
  { asset_class:'wind',  region:'UK', pathway:'Cement co-processing',     utilisation_pct: 30 },
  // US cement: LafargeHolcim Joppa IL is the main blade-acceptor; ~25 kt/yr
  // nominal vs ~20 kt/yr current US blade decom
  { asset_class:'wind',  region:'US', pathway:'Cement co-processing',     utilisation_pct: 50 },
  // EU mechanical shredding: Roche, Conenor, Anmet; ~100 kt/yr aggregate
  { asset_class:'wind',  region:'EU', pathway:'Mechanical shredding',     utilisation_pct: 30 },
  // US mechanical shredding: GFS Sweetwater TX + Veolia Missouri ~50 kt/yr
  { asset_class:'wind',  region:'US', pathway:'Mechanical shredding',     utilisation_pct: 35 },
  // EU pyrolysis: Continuum DK opened 2024 ~25 kt/yr; Siemens Gamesa pilot;
  // barely loaded — premium pathway, asset owners default to cement first
  { asset_class:'wind',  region:'EU', pathway:'Pyrolysis',                utilisation_pct: 15 },

  // ── SOLAR PV — capacity broadly slack vs incoming waves
  // EU mechanical: Veolia / SUEZ / national WEEE network ~100 kt/yr.
  // EU panel waste 2024 ~50 kt; collection rate ~40% → ~20 kt actually flowing
  { asset_class:'solar', region:'EU', pathway:'Mechanical (frame + glass)',  utilisation_pct: 40 },
  // UK mechanical: PV Cycle UK + smaller; UK panel waste tiny <5 kt/yr
  { asset_class:'solar', region:'UK', pathway:'Mechanical (frame + glass)',  utilisation_pct: 25 },
  // US mechanical: SOLARCYCLE TX 30 kt + We Recycle Solar AZ 10 kt = 40 kt
  // vs ~25 kt panel waste. Genuinely tightening.
  { asset_class:'solar', region:'US', pathway:'Mechanical (frame + glass)',  utilisation_pct: 60 },
  // CN mechanical: emerging recyclers + MIIT pilots; large headroom
  { asset_class:'solar', region:'CN', pathway:'Mechanical (frame + glass)',  utilisation_pct: 30 },
  // EU specialty Si+Ag: Reiling Münster ~50 kt/yr is the main player; demand
  // for high-recovery is ~15 kt/yr currently — overcapacity
  { asset_class:'solar', region:'EU', pathway:'Specialty (Si + Ag recovery)', utilisation_pct: 30 },
  // US specialty: SOLARCYCLE high-recovery line ramping; Prologis + RWE deals
  { asset_class:'solar', region:'US', pathway:'Specialty (Si + Ag recovery)', utilisation_pct: 45 },

  // ── BESS — EU/UK/US still slack; CN is the only tight market
  // EU pre-treatment: Hydrovolt 12 kt + Accurec ~4 kt + BASF Schwarzheide
  // ~15 kt + smaller = ~50 kt/yr nameplate. EV battery waste 2025 ~25 kt;
  // BESS contribution still <5 kt. Heavily under-utilised.
  { asset_class:'bess',  region:'EU', pathway:'Pre-treatment to black mass', utilisation_pct: 30 },
  // UK pre-treatment: Veolia + Recycling Lives small lines, low demand
  { asset_class:'bess',  region:'UK', pathway:'Pre-treatment to black mass', utilisation_pct: 25 },
  // US pre-treatment: Li-Cycle (Glencore) NY/AL spokes ~50 kt + Redwood NV
  // ~30 kt = ~80 kt/yr. EV+BESS waste ~40 kt 2025
  { asset_class:'bess',  region:'US', pathway:'Pre-treatment to black mass', utilisation_pct: 45 },
  // CN pre-treatment: CATL Brunp 120 kt + GEM 50 kt + 100s of small whitelist
  // recyclers ~300 kt. Demand 250+ kt/yr. Tight but not bottleneck.
  { asset_class:'bess',  region:'CN', pathway:'Pre-treatment to black mass', utilisation_pct: 85 },
  // KR pre-treatment: SungEel 40 kt + Posco-GS 20 kt; rising EV waste
  { asset_class:'bess',  region:'KR', pathway:'Pre-treatment to black mass', utilisation_pct: 55 },
  // EU pyrometallurgical: Umicore Hoboken Li-ion line ~7 kt; integrated
  // operation, treated as part of broader smelter throughput
  { asset_class:'bess',  region:'EU', pathway:'Pyrometallurgical',           utilisation_pct: 60 },
  // EU hydromet: Hydrovolt Li recovery + Eramet pilot ~20 kt operational.
  // Fraunhofer 2025 explicitly notes overcapacity.
  { asset_class:'bess',  region:'EU', pathway:'Hydrometallurgical',          utilisation_pct: 25 },
  // US hydromet: Redwood NV ~15-20 kt operating; Li-Cycle hub paused 2024
  { asset_class:'bess',  region:'US', pathway:'Hydrometallurgical',          utilisation_pct: 35 },
  // CN hydromet: dominant globally; 100+ recyclers, payable indicator high
  { asset_class:'bess',  region:'CN', pathway:'Hydrometallurgical',          utilisation_pct: 85 },
]

const TIGHTNESS_TABS: { code: TightnessAssetClass | 'all'; label: string }[] = [
  { code:'all',   label:'All'   },
  { code:'wind',  label:'Wind'  },
  { code:'solar', label:'Solar' },
  { code:'bess',  label:'BESS'  },
]

const ASSET_CLASS_LABEL: Record<TightnessAssetClass, string> = {
  wind: 'Wind', solar: 'Solar', bess: 'BESS',
}

// Three-tier classification (mirrors the Bloomberg-style T1/T2/T3 visual)
type TightnessTier = 'T1' | 'T2' | 'T3'

const tightnessTier = (pct: number): TightnessTier => {
  if (pct >= 85) return 'T1'   // saturated / bottleneck
  if (pct >= 50) return 'T2'   // moderate / tight
  return 'T3'                  // slack
}

const TIER_BAR_COLOR: Record<TightnessTier, string> = {
  T1: 'bg-red-500',
  T2: 'bg-amber-500',
  T3: 'bg-teal-600',
}

const TIER_PILL_STYLE: Record<TightnessTier, string> = {
  T1: 'bg-red-50 text-red-700 border-red-200',
  T2: 'bg-amber-50 text-amber-700 border-amber-200',
  T3: 'bg-teal-50 text-teal-700 border-teal-200',
}

type TightnessRegionFilter = 'all' | 'EU' | 'UK' | 'US' | 'AsiaPac'
const TIGHTNESS_REGION_TABS: { code: TightnessRegionFilter; label: string }[] = [
  { code:'all',     label:'All'      },
  { code:'EU',      label:'EU'       },
  { code:'UK',      label:'UK'       },
  { code:'US',      label:'US'       },
  { code:'AsiaPac', label:'Asia-Pac' },
]
const TIGHTNESS_REGION_GROUP: Record<TightnessRegion, TightnessRegionFilter> = {
  EU: 'EU', UK: 'UK', US: 'US', CN: 'AsiaPac', KR: 'AsiaPac',
}

function CapacityTightnessPanel() {
  const [assetClass, setAssetClass] = useState<TightnessAssetClass | 'all'>('all')
  const [region,     setRegion]     = useState<TightnessRegionFilter>('all')

  const rows = useMemo(() => {
    return CAPACITY_TIGHTNESS
      .filter(r => assetClass === 'all' || r.asset_class === assetClass)
      .filter(r => region === 'all' || TIGHTNESS_REGION_GROUP[r.region] === region)
      .map(r => ({
        label: assetClass === 'all'
          ? `${ASSET_CLASS_LABEL[r.asset_class]} · ${r.pathway} · ${r.region}`
          : `${r.pathway} · ${r.region}`,
        value: r.utilisation_pct,
        tier:  tightnessTier(r.utilisation_pct),
      }))
      .sort((a, b) => b.value - a.value)
  }, [assetClass, region])

  return (
    <Panel label="PCM" title="Capacity Tightness" className="col-span-6"
           meta={
             <div className="flex items-center gap-1.5">
               <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
                 {TIGHTNESS_TABS.map(t => (
                   <button key={t.code} onClick={() => setAssetClass(t.code)}
                           className={clsx(
                             'px-1.5 py-0.5 text-[10px] font-semibold tracking-wide rounded-sm',
                             assetClass === t.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                           )}>
                     {t.label}
                   </button>
                 ))}
               </div>
               <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
                 {TIGHTNESS_REGION_TABS.map(t => (
                   <button key={t.code} onClick={() => setRegion(t.code)}
                           className={clsx(
                             'px-1.5 py-0.5 text-[10px] font-semibold tracking-wide rounded-sm',
                             region === t.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                           )}>
                     {t.label}
                   </button>
                 ))}
               </div>
             </div>
           }>
      <div className="flex-1 min-h-0 overflow-auto divide-y divide-border/60">
        {rows.length === 0 ? (
          <div className="px-3 py-4 text-[11px] text-ink-3 text-center">No pathways for this filter.</div>
        ) : rows.map(r => {
          const widthPct = Math.min(100, r.value)
          return (
            <div key={r.label} className="px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 text-[11.5px] text-ink font-medium truncate" title={r.label}>
                  {r.label}
                </span>
                <span className="text-[11px] text-ink tabular-nums font-semibold w-10 text-right">
                  {r.value}%
                </span>
              </div>
              <div className="mt-1 h-1.5 bg-canvas rounded-full overflow-hidden">
                <div className={clsx('h-full rounded-full', TIER_BAR_COLOR[r.tier])}
                     style={{ width: `${widthPct}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function RecyclingCapacityPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden bg-page">

      <div className="flex-shrink-0 h-9 px-3 border-b border-border bg-canvas flex items-center justify-between">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[13px] font-semibold text-ink uppercase tracking-wide">Recycling Capacity Monitor</h1>
          <span className="text-[11.5px] text-ink-3">Composite blade processing · pathways · capacity</span>
        </div>
        <div className="flex items-center gap-3 text-[10.5px] text-ink-3 flex-shrink-0 uppercase tracking-wide">
          <span>Coverage</span>
          <div className="flex items-center gap-1">
            {['EU', 'GB', 'US', 'JP'].map(s => (
              <span key={s} className="px-1.5 py-px bg-canvas border border-border rounded-sm text-ink-3 normal-case font-semibold">
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden p-1.5">
        <div className="h-full grid grid-cols-12 grid-rows-3 gap-1.5">
          <WasteFlowForecastPanel />
          <BladeOutlookPanel />
          <GateFeesTablePanel />
          <RegulatoryContextPanel />
          <CapacityTightnessPanel />
        </div>
      </div>

    </div>
  )
}
