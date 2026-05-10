/**
 * Shared waste-flow compute. Used by:
 *   - PCM Waste Flow Forecast (specialist recycling streams)
 *   - SMI Decom Material Volume (scrap-merchant streams)
 *
 * Same retirement model + cohort-aware intensities + ARI-slider linkage.
 * Differs only in the bucket filter applied to the materials shown.
 */

import {
  WIND_COHORTS, SOLAR_COHORTS, BESS_COHORTS, cohortForYear,
  WIND_INTENSITIES, SOLAR_INTENSITIES, BESS_INTENSITIES,
  FIRST_DEGREE_RECOVERY, FIRST_DEGREE_PRICING_USD_PER_T,
  BESS_CHEMISTRY_MIX, bessChemistryWeightedPrice,
  applyUncertainty, UNCERTAINTY_PCT,
  MATERIAL_BUCKET,
  type AssetClass, type MaterialIntensity, type VintageCohort,
  type MaterialBucket,
} from '@/data/material_assumptions'

export type WFFAssetClass = AssetClass | 'all'

export interface InstallHistoryRow {
  asset_class:  'wind_onshore' | 'wind_offshore' | 'solar' | 'bess'
  country:      string
  region:       string | null
  year:         number
  capacity_mw:  number
  duration_h:   number | null
}

export interface YearMaterialBand {
  year:                  number
  total_t:               number
  recovered_t:           number
  recoverable_value_usd: number
  [material_key:         string]: number
}

export interface MaterialDetailRow {
  material:             string
  recovery_pct:         number
  unit_price_usd_t:     number
  total_t_2030:         number
  recovered_t_2030:     number
  recovered_t_2030_p10: number
  recovered_t_2030_p90: number
  total_t_2035:         number
  recovered_t_2035:     number
  source:               string
}

export interface ComputeResult {
  chartData:            YearMaterialBand[]
  detailRows:           MaterialDetailRow[]
  materialKeys:         string[]
  bessChemistryBlend:   { nmc: number; lfp: number; nca: number; na_ion: number; avg_price: number } | null
  totalRange2030:       { p10: number; p50: number; p90: number }
}

export const WFF_RETIRE_YEARS = Array.from({ length: 10 }, (_, i) => 2026 + i)  // 2026-2035

/** Same triangular distribution as ARI panels — median ±2y window. */
export function triangularAnnualRetirement(age: number, median: number): number {
  if (age < 0) return 0
  const offset = Math.abs(Math.round(age) - median)
  if (offset > 2) return 0
  return (3 - offset) / 9
}

function getCohortsFor(ac: AssetClass): VintageCohort[] {
  return ac === 'wind' ? WIND_COHORTS : ac === 'solar' ? SOLAR_COHORTS : BESS_COHORTS
}

function getIntensitiesFor(ac: AssetClass): Record<string, MaterialIntensity[]> {
  return ac === 'wind' ? WIND_INTENSITIES : ac === 'solar' ? SOLAR_INTENSITIES : BESS_INTENSITIES
}

export function dbAssetClassFilter(ac: AssetClass): string[] {
  if (ac === 'wind')  return ['wind_onshore', 'wind_offshore']
  if (ac === 'solar') return ['solar']
  return ['bess']
}

export function parentAssetClass(dbAc: string): AssetClass {
  if (dbAc === 'wind_onshore' || dbAc === 'wind_offshore') return 'wind'
  if (dbAc === 'solar')                                     return 'solar'
  return 'bess'
}

export function classesForSelection(sel: WFFAssetClass): AssetClass[] {
  return sel === 'all' ? ['wind', 'solar', 'bess'] : [sel]
}

interface ComputeOpts {
  rows:         InstallHistoryRow[]
  assetClass:   WFFAssetClass
  windMedian:   number
  solarMedian:  number
  bessMedian:   number
  /** Restrict the material universe to one bucket. Materials in other
   *  buckets are excluded entirely from chart + table. */
  bucket:       MaterialBucket
}

/**
 * Core compute: rows × triangular distribution × cohort intensities ×
 * recovery % → per-year per-material recovered tonnes + detail rows.
 */
export function computeWasteFlow(opts: ComputeOpts): ComputeResult {
  const { rows, assetClass, windMedian, solarMedian, bessMedian, bucket } = opts

  const medianFor = (ac: AssetClass): number =>
    ac === 'wind' ? windMedian : ac === 'solar' ? solarMedian : bessMedian

  const byYear:                Record<number, Record<string, number>> = {}
  const byMaterial:            Record<string, { source: string }> = {}
  const recoveryByMaterial:    Record<string, number> = {}
  const tonnageByClass:        Record<AssetClass, number> = { wind: 0, solar: 0, bess: 0 }
  const bessCohortMwTotals:    Record<string, number> = {}
  let bmPriceWeightedSum = 0
  let bmPriceWeightedDen = 0

  for (const r of rows) {
    const parentAc = parentAssetClass(r.asset_class)
    if (!classesForSelection(assetClass).includes(parentAc)) continue

    const median      = medianFor(parentAc)
    const cohorts     = getCohortsFor(parentAc)
    const intensities = getIntensitiesFor(parentAc)
    const recovery    = FIRST_DEGREE_RECOVERY[parentAc]

    // BESS uses MWh; wind/solar use MW
    const mw_or_mwh = (parentAc === 'bess' && r.duration_h != null)
      ? r.capacity_mw * r.duration_h
      : r.capacity_mw

    const cohort = cohortForYear(cohorts, r.year)
    const matsAll = intensities[cohort.label] ?? []
    // Apply bucket filter — only materials in the requested bucket
    const mats = matsAll.filter(m => MATERIAL_BUCKET[m.material] === bucket)
    if (mats.length === 0) continue   // entire cohort skipped if no materials

    for (const retireY of WFF_RETIRE_YEARS) {
      const age  = retireY - r.year
      const frac = triangularAnnualRetirement(age, median)
      if (frac === 0) continue
      const retiringThisYear = mw_or_mwh * frac

      for (const m of mats) {
        const tonnes = (retiringThisYear * m.kg_per_unit) / 1000
        if (!byYear[retireY]) byYear[retireY] = {}
        byYear[retireY][m.material] = (byYear[retireY][m.material] ?? 0) + tonnes
        if (!byMaterial[m.material]) byMaterial[m.material] = { source: m.source }
        if (recoveryByMaterial[m.material] === undefined) {
          recoveryByMaterial[m.material] = recovery[m.material] ?? 0
        }
        tonnageByClass[parentAc] += tonnes
      }

      if (parentAc === 'bess' && bucket === 'specialist') {
        bessCohortMwTotals[cohort.label] = (bessCohortMwTotals[cohort.label] ?? 0) + retiringThisYear
        const price = bessChemistryWeightedPrice(cohort)
        bmPriceWeightedSum += price * retiringThisYear
        bmPriceWeightedDen += retiringThisYear
      }
    }
  }

  // Materials present across selected classes ∩ this bucket
  const materialKeys = Array.from(new Set(
    classesForSelection(assetClass).flatMap(ac =>
      Object.values(getIntensitiesFor(ac))
        .flat()
        .filter(m => MATERIAL_BUCKET[m.material] === bucket)
        .map(m => m.material),
    ),
  ))

  const totalTonnageAcrossClasses =
    tonnageByClass.wind + tonnageByClass.solar + tonnageByClass.bess

  const applyEffectiveUncertainty = (central: number) => {
    if (assetClass !== 'all') return applyUncertainty(central, assetClass)
    if (totalTonnageAcrossClasses === 0) return applyUncertainty(central, 'bess')
    const weightedPct =
      (tonnageByClass.wind  * UNCERTAINTY_PCT.wind  +
       tonnageByClass.solar * UNCERTAINTY_PCT.solar +
       tonnageByClass.bess  * UNCERTAINTY_PCT.bess) / totalTonnageAcrossClasses
    const u = weightedPct / 100
    return { p10: central * (1 - u), p50: central, p90: central * (1 + u) }
  }

  const chartData: YearMaterialBand[] = Object.entries(byYear)
    .map(([year, mats]) => {
      const row: YearMaterialBand = { year: +year, total_t: 0, recovered_t: 0, recoverable_value_usd: 0 }
      for (const k of materialKeys) {
        const t      = mats[k] ?? 0
        row[k]       = Math.round(t)
        row.total_t += t
        row.recovered_t += t * (recoveryByMaterial[k] ?? 0) / 100
      }
      return row
    })
    .sort((a, b) => a.year - b.year)

  const total2030 = chartData.find(c => c.year === 2030)?.total_t ?? 0
  const totalRange2030 = applyEffectiveUncertainty(total2030)

  const bessChemistryBlend = (() => {
    if (bucket !== 'specialist') return null
    if (!classesForSelection(assetClass).includes('bess')) return null
    const mixWeighted = { nmc: 0, lfp: 0, nca: 0, na_ion: 0 }
    let totalMw = 0
    for (const [label, mw] of Object.entries(bessCohortMwTotals)) {
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

  const detailRows: MaterialDetailRow[] = materialKeys.map(k => {
    const t30 = byYear[2030]?.[k] ?? 0
    const t35 = byYear[2035]?.[k] ?? 0
    const recPct = recoveryByMaterial[k] ?? 0
    const rec30 = t30 * recPct / 100
    const band30 = applyEffectiveUncertainty(rec30)
    const unitPrice = (k === 'black_mass' && bessChemistryBlend)
      ? bessChemistryBlend.avg_price
      : (FIRST_DEGREE_PRICING_USD_PER_T[k] ?? 0)
    return {
      material:             k,
      recovery_pct:         recPct,
      unit_price_usd_t:     unitPrice,
      total_t_2030:         Math.round(t30),
      recovered_t_2030:     Math.round(rec30),
      recovered_t_2030_p10: Math.round(band30.p10),
      recovered_t_2030_p90: Math.round(band30.p90),
      total_t_2035:         Math.round(t35),
      recovered_t_2035:     Math.round(t35 * recPct / 100),
      source:               byMaterial[k]?.source ?? '—',
    }
  }).sort((a, b) => b.total_t_2030 - a.total_t_2030)

  return { chartData, detailRows, materialKeys, bessChemistryBlend, totalRange2030 }
}

// ── Display helpers ─────────────────────────────────────────────────

const MATERIAL_DISPLAY: Record<string, string> = {
  steel:        'Steel',
  cast_iron:    'Cast iron',
  copper:       'Copper',
  aluminium:    'Aluminium',
  zinc:         'Zinc',
  rare_earth:   'Rare earths',
  composite:    'Composite',
  polymer:      'Polymer',
  glass:        'Glass',
  silicon:      'Silicon',
  silver:       'Silver',
  black_mass:   'Black mass',
  electrolyte:  'Electrolyte',
}

export function materialName(key: string): string {
  return MATERIAL_DISPLAY[key] ?? key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
}

export const MATERIAL_COLORS: Record<string, string> = {
  steel:        '#6b7280',
  cast_iron:    '#9ca3af',
  copper:       '#b87333',
  aluminium:    '#94a3b8',
  zinc:         '#a1a1aa',
  rare_earth:   '#9333ea',
  composite:    '#dc2626',
  polymer:      '#9b9b9b',
  glass:        '#06b6d4',
  silicon:      '#1e293b',
  silver:       '#d4d4d8',
  black_mass:   '#000000',
  electrolyte:  '#7c7c7c',
}
