// ── Secondary Materials Intelligence — Tab 04 ────────────────────────────────
// 6 panels in a 12-col grid (no full-width content):
//   Row 1: Commodity Refs table (col-7) + NRO Donut (col-5)
//   Row 2: Solar PV LCA (col-6) + BESS LCA (col-6)
//   Row 3: Material Flows (col-6) + Trade Flows (col-6)

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { clsx } from 'clsx'
import { ResponsiveContainer, AreaChart, Area, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, ReferenceArea, ComposedChart } from 'recharts'
import { supabase } from '@/lib/supabase'
import { METHODOLOGY_NOTE } from '@/data/material_assumptions'
import {
  computeWasteFlow, classesForSelection, dbAssetClassFilter,
  materialName, MATERIAL_COLORS, type WFFAssetClass, type InstallHistoryRow,
} from '@/lib/wasteFlowCompute'
import { useDesignLife } from '@/store/designLife'
import { MaterialDonut } from '@/components/charts/MaterialDonut'
import { VintageCurveChart } from '@/components/charts/VintageCurveChart'
import { ScrapMerchantMapModal } from '@/components/overlays/ScrapMerchantMapModal'
import type { MapOperator } from '@/components/overlays/ScrapMerchantMapModal'

// ── Types ─────────────────────────────────────────────────────────────────────

type Region   = 'EU' | 'GB' | 'US'
type Currency = 'EUR' | 'GBP' | 'USD'

interface CommodityPrice {
  material_type:  string
  region:         Region
  price_per_tonne: number
  currency:       Currency
  price_date:     string
  source_name:    string
  confidence:     string
  last_reviewed:  string
}

interface NroEstimate {
  material_type:     string
  region:            Region
  currency:          Currency
  reference_date:    string
  net_per_tonne_low: number
  net_per_tonne_mid: number
  net_per_tonne_high: number
  net_per_mw_low:    number | null
  net_per_mw_mid:    number | null
  net_per_mw_high:   number | null
  confidence:        string
  last_reviewed:     string
}

interface SolarPanelRow {
  vintage:             'pre2012' | 'y2012' | 'y2020'
  material:            string
  intensity_t_per_mwp: number
}

interface BessRow {
  vintage:             'pre2018' | 'y2018' | 'y2022'
  material:            string
  intensity_t_per_mwh: number
}

const REGIONS: { code: Region; currency: Currency; sym: string }[] = [
  { code: 'EU', currency: 'EUR', sym: '€' },
  { code: 'GB', currency: 'GBP', sym: '£' },
  { code: 'US', currency: 'USD', sym: '$' },
]

const MATERIAL_LABELS: Record<string, string> = {
  steel_hms1:      'Steel HMS1',
  steel_hms2:      'Steel HMS2',
  steel_cast_iron: 'Cast Iron',
  steel_stainless: 'Stainless',
  copper:          'Copper',
  aluminium:       'Aluminium',
  rare_earth:      'NdPr Oxide',
}

const MATERIAL_ORDER = [
  'steel_hms1', 'steel_hms2', 'steel_cast_iron', 'steel_stainless',
  'copper', 'aluminium', 'rare_earth',
]

const MATERIAL_SOURCE: Record<string, string> = {
  steel_hms1:      'Fastmkt',
  steel_hms2:      'Fastmkt',
  steel_cast_iron: 'Fastmkt',
  copper:          'LME',
  aluminium:       'LME',
  rare_earth:      'BMI',
}

const CONFIDENCE_STYLE: Record<string, string> = {
  High:   'text-up',
  Medium: 'text-amber',
  Low:    'text-down',
}

const SOLAR_VINTAGE_LABEL: Record<string, string> = {
  pre2012: 'Pre-2012 BSF',
  y2012:   '2012-19 PERC',
  y2020:   '2020+ TOPCon',
}

const BESS_VINTAGE_LABEL: Record<string, string> = {
  pre2018: 'Pre-2018 NMC',
  y2018:   '2018-21 blend',
  y2022:   '2022+ LFP',
}

function fmt(n: number | null, sym: string): string {
  if (n == null) return '—'
  return `${sym}${n.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`
}

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try {
    return new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
  } catch { return '—' }
}

function fmtRange(low: number | null, mid: number | null, high: number | null, sym: string): string {
  if (mid == null) return '—'
  if (low == null || high == null) return fmt(mid, sym)
  return `${fmt(low, sym)} – ${fmt(high, sym)}`
}

// ── Panel chrome ──────────────────────────────────────────────────────────────

function Panel({
  label, title, meta, children, className, status,
}: {
  label:    string
  title:    string
  meta?:    React.ReactNode
  children: React.ReactNode
  className?: string
  status?:  'in-build' | 'beta' | 'preview'
}) {
  const statusLabel = status === 'in-build' ? 'IN BUILD'
                    : status === 'beta'     ? 'BETA'
                    : status === 'preview'  ? 'PREVIEW'
                    : null
  return (
    <div className={clsx('bg-panel border border-border rounded-sm flex flex-col overflow-hidden', className)}>
      <div className="h-7 px-3 flex items-center justify-between border-b border-border bg-titlebar flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="label-xs">{label}</span>
          <span className="text-ink-4 text-[10px]">·</span>
          <span className="text-[12.5px] font-semibold text-ink truncate">{title}</span>
          {statusLabel && (
            <span
              className="px-1.5 py-px text-[9px] font-bold tracking-wider rounded-sm flex-shrink-0"
              style={{
                color: '#C4863A',                       // Endenex gold
                backgroundColor: 'rgba(196, 134, 58, 0.12)',
                border: '1px solid rgba(196, 134, 58, 0.35)',
              }}
              title="This panel is under active development. Data + visuals may change."
            >
              {statusLabel}
            </span>
          )}
        </div>
        {meta && <div className="text-[10.5px] text-ink-3 flex items-center gap-2 flex-shrink-0">{meta}</div>}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  )
}

// ── Tiny inline sparkline ─────────────────────────────────────────────────────

function PriceSparkline({ data }: { data: { v: number }[] }) {
  if (data.length < 2) return <div className="w-16 h-6" />
  const up     = data[data.length - 1].v >= data[0].v
  const colour = up ? '#0F8B58' : '#C73838'
  return (
    <div className="w-16 h-6">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 1, right: 0, left: 0, bottom: 1 }}>
          <defs>
            <linearGradient id={`smi-${up ? 'up' : 'dn'}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={colour} stopOpacity={0.3} />
              <stop offset="95%" stopColor={colour} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={colour} strokeWidth={1.2}
                fill={`url(#smi-${up ? 'up' : 'dn'})`} dot={false} isAnimationActive={false} />
          <Tooltip contentStyle={{ display: 'none' }} cursor={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function MoM({ current, prev }: { current: number; prev: number | undefined }) {
  if (prev == null || prev === 0) return <span className="text-ink-4">—</span>
  const pct = ((current - prev) / prev) * 100
  if (Math.abs(pct) < 0.05) return <span className="text-ink-4">flat</span>
  const up = pct > 0
  return (
    <span className={clsx('tabular-nums font-semibold', up ? 'text-up' : 'text-down')}>
      {up ? '▲' : '▼'}{Math.abs(pct).toFixed(1)}%
    </span>
  )
}

// ── 01 Scrap Prices panel ────────────────────────────────────────────────────
//
// Reads from scrap_price_benchmarks — latest-available prices from public
// Argus / AMM / BCMR / LME / WB Pink Sheet sources. Each row carries
// publisher + price_date for full provenance.
//
// Region filter is asset-owner physical regions (EU / UK / US / Asia). Global
// benchmarks (LDN, TR, EX-CN, GLOBAL) bucket into the regions they're
// relevant to — TR HMS reads through to EU/UK ferrous, EX-CN poly reads
// through to US/EU, LDN refined metals read through everywhere.

type AssetRegion = 'ALL' | 'EU' | 'US' | 'ASIA'

interface ScrapBenchmarkRow {
  material:        string
  region:          string
  publisher:       string
  benchmark_name:  string
  price:           number
  unit:            string
  price_date:      string
  period_type:     string
  source_url:      string | null
  confidence:      string
  notes:           string | null
}

// Display order — group materials in a sensible product hierarchy
const SCRAP_MATERIAL_GROUP_ORDER = [
  'Ferrous',
  'Non-ferrous',
  'Solar PV',
  'Battery / black mass',
  'Specialty / composite',
] as const
type ScrapGroup = typeof SCRAP_MATERIAL_GROUP_ORDER[number]

const SCRAP_MATERIAL_GROUP: Record<string, ScrapGroup> = {
  steel_hms_1: 'Ferrous', steel_hms_2: 'Ferrous', steel_hms_1_2_8020: 'Ferrous',
  steel_busheling: 'Ferrous', steel_shred: 'Ferrous', cast_iron_general: 'Ferrous',

  copper_no_1: 'Non-ferrous', copper_no_2: 'Non-ferrous', copper_birch_cliff: 'Non-ferrous',
  aluminium_taint_tabor: 'Non-ferrous', aluminium_zorba: 'Non-ferrous',
  aluminium_twitch: 'Non-ferrous', aluminium_tense: 'Non-ferrous', aluminium_alloy_356: 'Non-ferrous',

  silicon_solar: 'Solar PV', silver_solar_grade: 'Solar PV', glass_pv_cullet: 'Solar PV',

  lithium_carbonate: 'Battery / black mass', lithium_hydroxide: 'Battery / black mass',
  cobalt_metal: 'Battery / black mass', nickel_class_1: 'Battery / black mass',
  manganese_ore: 'Battery / black mass', graphite_synthetic: 'Battery / black mass',
  black_mass_nmc: 'Battery / black mass', black_mass_lfp: 'Battery / black mass',
  black_mass_nca: 'Battery / black mass',

  rare_earth_neodymium: 'Specialty / composite',
  composite_blade_glass_fibre: 'Specialty / composite',
  composite_blade_carbon_fibre: 'Specialty / composite',
}

// Proper editorial labels — replaces snake_case → spaces with industry-standard
// notation. Falls back to title-cased material name for grades not in the map.
const SCRAP_GRADE_LABEL: Record<string, string> = {
  steel_hms_1:                   'Steel HMS 1',
  steel_hms_2:                   'Steel HMS 2',
  steel_hms_1_2_8020:            'Steel HMS 1&2 80:20',
  steel_busheling:               'Steel busheling',
  steel_shred:                   'Steel shred',
  cast_iron_general:             'Cast iron',
  copper_no_1:                   'Copper No.1 bare bright',
  copper_no_2:                   'Copper No.2 birch/cliff',
  copper_birch_cliff:            'Copper birch/cliff',
  aluminium_taint_tabor:         'Aluminium taint/tabor',
  aluminium_zorba:               'Aluminium zorba',
  aluminium_twitch:              'Aluminium twitch',
  aluminium_tense:               'Aluminium tense',
  aluminium_alloy_356:           'Aluminium alloy 356',
  silicon_solar:                 'Polysilicon (solar)',
  silver_solar_grade:            'Silver',
  glass_pv_cullet:               'PV glass cullet',
  lithium_carbonate:             'Lithium carbonate',
  lithium_hydroxide:             'Lithium hydroxide',
  cobalt_metal:                  'Cobalt',
  nickel_class_1:                'Nickel Class 1',
  manganese_ore:                 'Manganese ore 44%',
  graphite_synthetic:            'Synthetic graphite',
  rare_earth_neodymium:          'Neodymium',
  composite_blade_glass_fibre:   'GFRP wind blade (disposal)',
  composite_blade_carbon_fibre:  'CFRP wind blade',
  black_mass_nmc:                'Black mass (NMC)',
  black_mass_lfp:                'Black mass (LFP)',
  black_mass_nca:                'Black mass (NCA)',
}

// Technology filter — which scrap grades does each tech actually generate?
// (No onshore/offshore split — wind is wind for material-output purposes.)
type TechFilter = 'all' | 'wind' | 'solar' | 'bess'

const TECH_GRADES: Record<Exclude<TechFilter, 'all'>, Set<string>> = {
  wind: new Set([
    'steel_hms_1_2_8020', 'steel_hms_1', 'steel_hms_2',
    'cast_iron_general',
    'copper_no_2',
    'aluminium_taint_tabor',
    'composite_blade_glass_fibre',
    'composite_blade_carbon_fibre',
    'rare_earth_neodymium',
  ]),
  solar: new Set([
    'aluminium_taint_tabor',
    'silicon_solar',
    'silver_solar_grade',
    'glass_pv_cullet',
    'copper_no_2',
  ]),
  bess: new Set([
    'steel_shred',
    'copper_no_1',
    'aluminium_twitch',
    'black_mass_nmc',
    'black_mass_lfp',
    'black_mass_nca',
  ]),
}

const TECH_TABS: { code: TechFilter; label: string }[] = [
  { code: 'all',   label: 'All'   },
  { code: 'wind',  label: 'Wind'  },
  { code: 'solar', label: 'Solar' },
  { code: 'bess',  label: 'BESS'  },
]

const PUBLISHER_LABEL: Record<string, string> = {
  argus:           'Argus',
  amm_fastmarkets: 'AMM',
  platts:          'Platts',
  lme:             'LME',
  comex:           'COMEX',
  fred:            'FRED',
  world_bank_pink_sheet: 'WB Pink Sheet',
  usgs:            'USGS',
  eurofer:         'EUROFER',
  euric:           'EuRIC',
  bcmr:            'BCMR',
  bir:             'BIR',
  irsi_recycling:  'IRSI',
  recycling_today: 'Recycling Today',
  airtable_curated:'Airtable',
  manual:          'Manual',
}

// Region toggles — three asset-owner regions only. UK rolls into Europe;
// LME/LBMA London settlements are excluded entirely (they're refined metal
// prices, not scrap). TR (CFR Turkey HMS) is the global ferrous export proxy
// for Europe + US. EX-CN polysilicon → non-China demand (US + EU). CN → Asia.
const ASSET_REGIONS: { code: AssetRegion; label: string }[] = [
  { code: 'ALL',  label: 'All'    },
  { code: 'EU',   label: 'Europe' },
  { code: 'US',   label: 'US'     },
  { code: 'ASIA', label: 'Asia'   },
]

const REGION_BUCKETS: Record<Exclude<AssetRegion, 'ALL'>, string[]> = {
  EU:   ['EU',   'GB',  'TR',    'GLOBAL'],
  US:   ['US',   'EX-CN', 'GLOBAL'],
  ASIA: ['ASIA', 'CN',  'GLOBAL'],
}

// Map each (db region) to its display region — used for Historical chart
// when grouping series by region.
const REGION_DISPLAY: Record<string, AssetRegion | null> = {
  EU: 'EU', GB: 'EU', TR: 'EU',
  US: 'US', 'EX-CN': 'US',
  ASIA: 'ASIA', CN: 'ASIA',
  GLOBAL: 'EU',   // arbitrary; only matters when ALL filter is off
  LDN: null,      // refined metal — exclude
}

function fmtPrice(price: number, unit: string): string {
  const sign = price < 0 ? '-' : ''
  const abs = Math.abs(price)
  const num = abs >= 1000 ? abs.toLocaleString('en-US', { maximumFractionDigits: 0 })
                          : abs.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return `${sign}$${num} ${unit.replace('USD/', '/').replace('/', '/')}`
}

function CommodityRefsPanel() {
  const [tech, setTech]     = useState<TechFilter>('all')
  const [region, setRegion] = useState<AssetRegion>('ALL')
  const [rows, setRows]     = useState<ScrapBenchmarkRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    let q = supabase
      .from('scrap_price_benchmarks')
      .select('material, region, publisher, benchmark_name, price, unit, price_date, period_type, source_url, confidence, notes')
      .gte('price', 0)                          // exclude gate fees (negative = disposal cost)
      .neq('publisher', 'lme')                  // LME = refined metal, not scrap
      .neq('region', 'LDN')                     // LDN = LBMA/LME settlements, not scrap
      .order('price_date', { ascending: false })
    if (region !== 'ALL') q = q.in('region', REGION_BUCKETS[region])
    q.then(({ data }) => {
      if (!alive) return
      // Dedupe to LATEST row per (material, region, publisher) — most recent only
      const seen = new Set<string>()
      const latest: ScrapBenchmarkRow[] = []
      for (const r of (data ?? []) as ScrapBenchmarkRow[]) {
        const key = `${r.material}|${r.region}|${r.publisher}`
        if (seen.has(key)) continue
        seen.add(key)
        latest.push(r)
      }
      setRows(latest)
      setLoading(false)
    })
    return () => { alive = false }
  }, [region])

  // Apply tech filter on the client side (cheap; data set is small)
  const techFiltered = useMemo(() => {
    if (tech === 'all') return rows
    const allowed = TECH_GRADES[tech]
    return rows.filter(r => allowed.has(r.material))
  }, [rows, tech])

  // Group by material category for display
  const grouped = useMemo(() => {
    const g: Record<ScrapGroup, ScrapBenchmarkRow[]> = {
      'Ferrous': [], 'Non-ferrous': [], 'Solar PV': [],
      'Battery / black mass': [], 'Specialty / composite': [],
    }
    for (const r of techFiltered) {
      const cat = SCRAP_MATERIAL_GROUP[r.material] ?? 'Specialty / composite'
      g[cat].push(r)
    }
    for (const cat of SCRAP_MATERIAL_GROUP_ORDER) {
      g[cat].sort((a, b) => (a.material + a.region).localeCompare(b.material + b.region))
    }
    return g
  }, [techFiltered])

  const latestDate = techFiltered.length > 0
    ? techFiltered.reduce((max, r) => r.price_date > max ? r.price_date : max, techFiltered[0].price_date)
    : null

  return (
    <Panel
      label="SMI"
      title="Scrap Prices"
      meta={
        <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
          {TECH_TABS.map(t => (
            <button key={t.code} onClick={() => setTech(t.code)}
                    className={clsx(
                      'px-1.5 py-0.5 text-[10px] font-semibold tracking-wide rounded-sm',
                      tech === t.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                    )}>
              {t.label}
            </button>
          ))}
        </div>
      }>
      <div className="flex flex-col h-full">

        {/* Region strip + latest-as-of */}
        <div className="flex-shrink-0 border-b border-border bg-canvas px-2.5 py-1 flex items-center justify-between gap-2">
          <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
            {ASSET_REGIONS.map(r => (
              <button key={r.code} onClick={() => setRegion(r.code)}
                      className={clsx(
                        'px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm',
                        region === r.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                      )}>
                {r.label}
              </button>
            ))}
          </div>
          {latestDate && <span className="text-[10px] text-ink-4 tabular-nums">latest available {fmtDate(latestDate)}</span>}
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          {loading ? (
            <div className="px-3 py-4 text-[12px] text-ink-3 text-center">Loading…</div>
          ) : techFiltered.length === 0 ? (
            <div className="px-3 py-4 text-[11.5px] text-ink-3 text-center leading-snug">
              No prices match these filters.<br />
              <span className="text-ink-4">
                {rows.length === 0
                  ? 'Run migration 042 + 043 to seed May 2026 latest-available prices.'
                  : 'Try a different tech / region.'}
              </span>
            </div>
          ) : (
            <table className="w-full table-fixed">
              <colgroup>
                <col style={{ width: '38%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '16%' }} />
              </colgroup>
              <thead>
                <tr className="bg-titlebar border-b border-border sticky top-0 z-10">
                  <th className="px-2 py-1 text-left  text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Grade</th>
                  <th className="px-2 py-1 text-left  text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Region</th>
                  <th className="px-2 py-1 text-right text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Spot</th>
                  <th className="px-2 py-1 text-left  text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Source</th>
                  <th className="px-2 py-1 text-left  text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Date</th>
                </tr>
              </thead>
              <tbody>
                {SCRAP_MATERIAL_GROUP_ORDER.map(group => {
                  const groupRows = grouped[group]
                  if (groupRows.length === 0) return null
                  return (
                    <Fragment key={group}>
                      <tr className="bg-canvas">
                        <td colSpan={5} className="px-2 py-0.5 text-[9.5px] font-bold text-ink-4 uppercase tracking-wider">
                          {group}
                        </td>
                      </tr>
                      {groupRows.map(r => {
                        const label = SCRAP_GRADE_LABEL[r.material] ?? r.material.replace(/_/g, ' ')
                        return (
                          <tr key={`${r.material}-${r.region}-${r.publisher}`}
                              className="border-b border-border/70 hover:bg-raised">
                            <td className="px-2 py-0.5">
                              <div className="text-[11px] text-ink font-medium leading-tight truncate"
                                   title={`${label} · ${r.benchmark_name}${r.notes ? ' · ' + r.notes : ''}`}>
                                {label}
                              </div>
                            </td>
                            <td className="px-2 py-0.5 text-[10.5px] text-ink-2 tabular-nums">{r.region}</td>
                            <td className="px-2 py-0.5 text-right text-[12px] tabular-nums font-semibold text-ink whitespace-nowrap">
                              {fmtPrice(r.price, r.unit)}
                            </td>
                            <td className="px-2 py-0.5 text-[10.5px] text-ink-3 truncate">
                              {r.source_url ? (
                                <a href={r.source_url} target="_blank" rel="noopener noreferrer"
                                   className="hover:text-teal hover:underline"
                                   onClick={e => e.stopPropagation()}>
                                  {PUBLISHER_LABEL[r.publisher] ?? r.publisher}
                                </a>
                              ) : (PUBLISHER_LABEL[r.publisher] ?? r.publisher)}
                            </td>
                            <td className="px-2 py-0.5 text-[10.5px] text-ink-3 tabular-nums whitespace-nowrap">{fmtDate(r.price_date)}</td>
                          </tr>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex-shrink-0 border-t border-border px-2.5 py-1 text-[9.5px] text-ink-4 leading-snug">
          Hand-curated from public Argus / AMM / LME / Benchmark Minerals / OPIS · Argus PDF auto-ingester pending
        </div>
      </div>
    </Panel>
  )
}

// ── 02 NRO Donut + table panel ────────────────────────────────────────────────

function NroAttributionPanel() {
  const [region, setRegion]   = useState<Region>('EU')
  const [nro, setNro]         = useState<NroEstimate[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    supabase.from('nro_estimates').select('*').eq('region', region).order('reference_date', { ascending: false })
      .then(({ data }) => {
        const rows = (data ?? []) as NroEstimate[]
        const map: Record<string, NroEstimate> = {}
        for (const n of rows) { if (!map[n.material_type]) map[n.material_type] = n }
        setNro(Object.values(map)); setLoading(false)
      })
  }, [region])

  const sym = REGIONS.find(r => r.code === region)?.sym ?? '€'
  const ccy = REGIONS.find(r => r.code === region)?.currency ?? 'EUR'

  const slices = useMemo(() => {
    const PALETTE = ['#0E7A86', '#14A4B4', '#D97706', '#0F8B58', '#7C3AED', '#0A5C66', '#6B7585']
    return nro
      .filter(n => n.net_per_mw_mid && n.net_per_mw_mid > 0)
      .map((n, i) => ({
        label: MATERIAL_LABELS[n.material_type] ?? n.material_type,
        value: Number(n.net_per_mw_mid),
        color: PALETTE[i % PALETTE.length],
      }))
      .sort((a, b) => b.value - a.value)
  }, [nro])
  const total = slices.reduce((s, x) => s + x.value, 0)

  return (
    <Panel label="SMI" title="NRO Attribution" className="col-span-5"
           meta={
             <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
               {REGIONS.map(r => (
                 <button key={r.code} onClick={() => setRegion(r.code)}
                         className={clsx(
                           'px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm',
                           region === r.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                         )}>
                   {r.code}
                 </button>
               ))}
             </div>
           }>
      {loading ? (
        <div className="px-3 py-6 text-[12px] text-ink-3 text-center">Loading…</div>
      ) : (
        <div className="p-2 space-y-2">
          <MaterialDonut slices={slices} total={total} currency={ccy} centerLabel="Net / MW" height={170} />
          <div className="border border-border rounded-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-titlebar border-b border-border">
                  <th className="px-2 py-1 text-left text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Material</th>
                  <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase tracking-wide">{sym}/t (range)</th>
                  <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase tracking-wide">{sym}/MW</th>
                </tr>
              </thead>
              <tbody>
                {nro.length === 0 ? (
                  <tr><td colSpan={3} className="px-2 py-2 text-[11.5px] text-ink-3 text-center">No NRO data</td></tr>
                ) : MATERIAL_ORDER.map(mat => {
                  const n = nro.find(x => x.material_type === mat)
                  if (!n) return null
                  return (
                    <tr key={mat} className="border-b border-border/70 hover:bg-raised">
                      <td className="px-2 py-0.5 text-[11.5px] text-ink font-medium">{MATERIAL_LABELS[mat]}</td>
                      <td className="px-2 py-0.5 text-right text-[11px] tabular-nums text-ink-2">
                        {fmtRange(n.net_per_tonne_low, n.net_per_tonne_mid, n.net_per_tonne_high, sym)}
                      </td>
                      <td className="px-2 py-0.5 text-right text-[11px] tabular-nums text-ink-2">
                        {fmt(n.net_per_mw_mid, sym)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  )
}

// ── 03 Solar PV LCA panel ─────────────────────────────────────────────────────

function SolarLcaPanel() {
  const [panels, setPanels] = useState<SolarPanelRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('solar_panel_intensities').select('vintage, material, intensity_t_per_mwp')
      .then(({ data }) => { setPanels((data ?? []) as SolarPanelRow[]); setLoading(false) })
  }, [])

  const panelMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of panels) m.set(`${r.material}|${r.vintage}`, r.intensity_t_per_mwp)
    return m
  }, [panels])

  const silverPoints = (['pre2012','y2012','y2020'] as const).map(v => ({
    vintage: v, value: (panelMap.get(`silver|${v}`) ?? 0) * 1000,
  }))
  const siliconPoints = (['pre2012','y2012','y2020'] as const).map(v => ({
    vintage: v, value: panelMap.get(`silicon|${v}`) ?? 0,
  }))

  return (
    <Panel label="SMI" title="Solar PV LCA · Vintage Curve" className="col-span-6"
           meta={<span className="text-[10.5px] text-ink-3">Silver collapse · BSF→PERC→TOPCon</span>}>
      {loading ? (
        <div className="px-3 py-6 text-[12px] text-ink-3 text-center">Loading…</div>
      ) : (
        <div className="p-2">
          <VintageCurveChart
            series={[
              { name: 'Silver kg/MW',  color: '#D97706', points: silverPoints },
              { name: 'Silicon t/MWp', color: '#0E7A86', points: siliconPoints },
            ]}
            vintageLabels={SOLAR_VINTAGE_LABEL}
            yLabel="intensity"
            decimals={2}
            height={210}
          />
        </div>
      )}
    </Panel>
  )
}

// ── 04 BESS LCA panel ─────────────────────────────────────────────────────────

function BessLcaPanel() {
  const [intens, setIntens]   = useState<BessRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('bess_intensities').select('vintage, material, intensity_t_per_mwh')
      .then(({ data }) => { setIntens((data ?? []) as BessRow[]); setLoading(false) })
  }, [])

  const intensMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of intens) m.set(`${r.material}|${r.vintage}`, r.intensity_t_per_mwh)
    return m
  }, [intens])

  const cobaltPoints = (['pre2018','y2018','y2022'] as const).map(v => ({ vintage: v, value: intensMap.get(`cobalt|${v}`) ?? 0 }))
  const nickelPoints = (['pre2018','y2018','y2022'] as const).map(v => ({ vintage: v, value: intensMap.get(`nickel|${v}`) ?? 0 }))
  const lithiumPoints = (['pre2018','y2018','y2022'] as const).map(v => ({ vintage: v, value: intensMap.get(`lithium|${v}`) ?? 0 }))

  return (
    <Panel label="SMI" title="BESS LCA · Chemistry Shift" className="col-span-6"
           meta={<span className="text-[10.5px] text-ink-3">NMC→LFP · Co/Ni decline, Li rise</span>}>
      {loading ? (
        <div className="px-3 py-6 text-[12px] text-ink-3 text-center">Loading…</div>
      ) : (
        <div className="p-2">
          <VintageCurveChart
            series={[
              { name: 'Cobalt',  color: '#7C3AED', points: cobaltPoints },
              { name: 'Nickel',  color: '#0E7A86', points: nickelPoints },
              { name: 'Lithium', color: '#D97706', points: lithiumPoints },
            ]}
            vintageLabels={BESS_VINTAGE_LABEL}
            yLabel="t/MWh"
            decimals={2}
            height={210}
          />
        </div>
      )}
    </Panel>
  )
}

// ── 05 Material Intensity Calculator ──────────────────────────────────────────
//
// Interactive: user picks asset class → model → sees per-unit material breakdown
// with recoverability %. Powered by oem_models + material_intensities_v
// (seeded in migration 039 from public LCAs / EPDs / agency studies).

type AssetClass = 'onshore_wind' | 'offshore_wind' | 'solar_pv' | 'bess'

const ASSET_CLASS_TABS: { code: AssetClass; label: string }[] = [
  { code: 'onshore_wind',  label: 'Wind onshore'  },
  { code: 'offshore_wind', label: 'Wind offshore' },
  { code: 'solar_pv',      label: 'Solar PV'      },
  { code: 'bess',          label: 'BESS'          },
]

interface OemModelRow {
  id:                   number
  asset_class:          AssetClass
  manufacturer:         string
  model_name:           string
  technology:           string | null
  rated_capacity_value: number
  rated_capacity_unit:  string
  rotor_diameter_m:     number | null
  default_hub_height_m: number | null
  hub_height_options_m: number[] | null
  cell_technology:      string | null
  cathode_chemistry:    string | null
  introduction_year:    number | null
  status:               string | null
}

interface MaterialIntensityRow {
  oem_model_id:                 number
  material:                     string
  material_subclass:            string | null
  scrap_grade:                  string | null
  intensity_value:              number
  intensity_unit:               string
  recoverability_pct:           number | null
  recoverability_basis:         string | null
  recoverable_intensity_value:  number | null
  source_publication:           string
  source_year:                  number | null
  confidence:                   string
}

// Sort priority by material category: ferrous → non-ferrous → solar →
// battery → composite/specialty (last). Within a category, by descending
// intensity_value (largest content first).
const MIC_CATEGORY_ORDER: Record<string, number> = {
  'Ferrous': 0, 'Non-ferrous': 1, 'Solar PV': 2, 'Battery / black mass': 3,
  'Specialty / composite': 4,
}
const micCategoryOf = (material: string): string => {
  const m = material.toLowerCase()
  if (m.includes('composite') || m.includes('gfrp') || m.includes('cfrp'))
    return 'Specialty / composite'
  return SCRAP_MATERIAL_GROUP[material] ?? 'Specialty / composite'
}

function MaterialIntensityCalculatorPanel() {
  const [assetClass, setAssetClass] = useState<AssetClass>('onshore_wind')
  const [models,     setModels]     = useState<OemModelRow[]>([])
  const [modelId,    setModelId]    = useState<number | null>(null)
  const [intensities,setIntensities]= useState<MaterialIntensityRow[]>([])
  const [loading,    setLoading]    = useState(false)
  const [hubHeight,  setHubHeight]  = useState<number | null>(null)

  // Load models for the selected asset class
  useEffect(() => {
    let alive = true
    setLoading(true)
    supabase.from('oem_models').select('*')
      .eq('asset_class', assetClass)
      .order('introduction_year', { ascending: false, nullsFirst: false })
      .order('manufacturer', { ascending: true })
      .then(({ data }) => {
        if (!alive) return
        const rows = (data ?? []) as OemModelRow[]
        setModels(rows)
        setModelId(rows[0]?.id ?? null)
        setLoading(false)
      })
    return () => { alive = false }
  }, [assetClass])

  // Load intensities for the selected model
  useEffect(() => {
    if (modelId == null) { setIntensities([]); return }
    let alive = true
    supabase.from('material_intensities_v').select('*')
      .eq('oem_model_id', modelId)
      .order('intensity_value', { ascending: false })
      .then(({ data }) => {
        if (!alive) return
        setIntensities(((data ?? []) as MaterialIntensityRow[])
          .filter(r => r.material))   // view returns NULL row for models with no intensity yet
      })
    return () => { alive = false }
  }, [modelId])

  const selectedModel = models.find(m => m.id === modelId) ?? null

  // Reset hub-height to model default whenever the selected model changes
  useEffect(() => {
    setHubHeight(selectedModel?.default_hub_height_m ?? null)
  }, [selectedModel?.id, selectedModel?.default_hub_height_m])

  // Tower steel scales linearly with hub height. We scale rows whose
  // material_subclass is "tower" (case-insensitive substring match) by
  // (selectedHubHeight / defaultHubHeight).
  const scaledIntensities = useMemo(() => {
    const def = selectedModel?.default_hub_height_m ?? null
    const factor = (def && hubHeight && def !== hubHeight) ? hubHeight / def : 1
    const scaled = intensities.map(r => {
      if (factor === 1) return r
      const sub = (r.material_subclass ?? '').toLowerCase()
      const isTower = sub.includes('tower')
      if (!isTower) return r
      return {
        ...r,
        intensity_value: r.intensity_value * factor,
        recoverable_intensity_value: r.recoverable_intensity_value != null
          ? r.recoverable_intensity_value * factor
          : null,
      }
    })
    // Sort: category order → intensity desc within category
    return scaled.slice().sort((a, b) => {
      const ca = MIC_CATEGORY_ORDER[micCategoryOf(a.material)] ?? 9
      const cb = MIC_CATEGORY_ORDER[micCategoryOf(b.material)] ?? 9
      if (ca !== cb) return ca - cb
      return b.intensity_value - a.intensity_value
    })
  }, [intensities, hubHeight, selectedModel?.default_hub_height_m])

  const basisLabel = (basis: string | null): string =>
    basis === 'observed_demolition' ? 'LCA' : 'Estimated'

  const fmtKg = (kg: number | null | undefined) => {
    if (kg == null) return '—'
    if (kg >= 1000) return `${(kg / 1000).toFixed(1)}t`
    if (kg >= 1)    return `${kg.toFixed(0)} kg`
    if (kg > 0)     return `${(kg * 1000).toFixed(0)} g`
    return '0'
  }

  const BASIS_PILL: Record<string, string> = {
    observed_demolition: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    industry_avg:        'bg-blue-50 text-blue-700 border-blue-200',
    target:              'bg-amber-50 text-amber-700 border-amber-200',
    theoretical:         'bg-slate-50 text-slate-700 border-slate-200',
  }
  const CONF_STYLE: Record<string, string> = {
    high:   'text-emerald-700',
    medium: 'text-amber-700',
    low:    'text-down',
  }

  return (
    <Panel
      label="SMI"
      title="Material Intensity Calculator"
      meta={
        <div className="flex items-center gap-1.5">
          <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
            {ASSET_CLASS_TABS.map(t => (
              <button key={t.code}
                      onClick={() => setAssetClass(t.code)}
                      className={clsx(
                        'px-1.5 py-0.5 text-[10px] font-semibold tracking-wide rounded-sm',
                        assetClass === t.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                      )}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      }>

      <div className="flex flex-col h-full">
        {/* Model picker + headline strip */}
        <div className="flex-shrink-0 border-b border-border bg-canvas">
          <div className="px-2.5 py-1.5 flex items-center gap-2">
            <span className="text-[10px] font-semibold text-ink-4 uppercase tracking-wide">Model</span>
            <select value={modelId ?? ''}
                    onChange={e => setModelId(e.target.value ? Number(e.target.value) : null)}
                    className="flex-1 min-w-0 text-[11.5px] font-semibold text-ink bg-canvas border border-border rounded-sm px-1.5 py-0.5">
              {loading && <option>Loading…</option>}
              {!loading && models.length === 0 && <option>No models seeded for this asset class</option>}
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.manufacturer} · {m.model_name}
                  {m.introduction_year ? ` (${m.introduction_year})` : ''}
                </option>
              ))}
            </select>
          </div>

          {selectedModel && (
            <div className="px-2.5 pb-1.5 flex items-center gap-2 text-[10.5px] text-ink-3 tabular-nums flex-wrap">
              <span><span className="text-ink-4">Rated:</span> {selectedModel.rated_capacity_value} {selectedModel.rated_capacity_unit}</span>
              {selectedModel.rotor_diameter_m && (
                <><span className="text-ink-4">·</span>
                  <span><span className="text-ink-4">Rotor:</span> {selectedModel.rotor_diameter_m} m</span></>
              )}
              {selectedModel.default_hub_height_m && (
                <><span className="text-ink-4">·</span>
                  <span className="flex items-center gap-1">
                    <span className="text-ink-4">Hub:</span>
                    {selectedModel.hub_height_options_m && selectedModel.hub_height_options_m.length > 0 ? (
                      <select value={hubHeight ?? selectedModel.default_hub_height_m}
                              onChange={e => setHubHeight(Number(e.target.value))}
                              className="text-[10.5px] tabular-nums text-ink bg-canvas border border-border rounded-sm px-1 py-px focus:outline-none focus:border-teal">
                        {selectedModel.hub_height_options_m.map(h => (
                          <option key={h} value={h}>{h} m</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="number" min={40} max={200} step={1}
                        value={hubHeight ?? selectedModel.default_hub_height_m}
                        onChange={e => setHubHeight(Number(e.target.value))}
                        className="w-12 text-[10.5px] tabular-nums text-ink bg-canvas border border-border rounded-sm px-1 py-px focus:outline-none focus:border-teal"
                      />
                    )}
                    <span className="text-ink-4">m</span>
                    {hubHeight !== selectedModel.default_hub_height_m && (
                      <button onClick={() => setHubHeight(selectedModel.default_hub_height_m)}
                              className="text-[9px] text-ink-4 hover:text-teal underline">reset</button>
                    )}
                  </span></>
              )}
              {selectedModel.cell_technology && (
                <><span className="text-ink-4">·</span>
                  <span><span className="text-ink-4">Cell:</span> {selectedModel.cell_technology}</span></>
              )}
              {selectedModel.cathode_chemistry && (
                <><span className="text-ink-4">·</span>
                  <span><span className="text-ink-4">Chemistry:</span> {selectedModel.cathode_chemistry.toUpperCase()}</span></>
              )}
            </div>
          )}

        </div>

        {/* Material breakdown table */}
        <div className="flex-1 min-h-0 overflow-auto">
          {intensities.length === 0 ? (
            <div className="px-3 py-6 text-[11.5px] text-ink-3 text-center leading-snug">
              {selectedModel
                ? 'No material intensity rows for this model yet.'
                : 'Select an asset class and model to see breakdown.'}
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-titlebar border-b border-border sticky top-0 z-10">
                  <th className="px-2 py-1 text-left  text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Material</th>
                  <th className="px-2 py-1 text-left  text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Scrap grade</th>
                  <th className="px-2 py-1 text-right text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Content</th>
                  <th className="px-2 py-1 text-right text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Recoverable</th>
                  <th className="px-2 py-1 text-right text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Rec %</th>
                  <th className="px-2 py-1 text-left  text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Basis</th>
                </tr>
              </thead>
              <tbody>
                {scaledIntensities.map(r => {
                  const matLabel = r.material
                    .replace(/_/g, ' ')
                    .replace(/^./, c => c.toUpperCase())
                  const subLabel = r.material_subclass
                    ? r.material_subclass.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
                    : null
                  const gradeLabel = r.scrap_grade
                    ? (SCRAP_GRADE_LABEL[r.scrap_grade] ?? r.scrap_grade.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()))
                    : null
                  return (
                  <tr key={`${r.material}-${r.material_subclass ?? ''}`}
                      className="border-b border-border/70 hover:bg-raised">
                    <td className="px-2 py-0.5">
                      <div className="text-[11px] text-ink font-medium leading-tight">
                        {matLabel}
                      </div>
                      {subLabel && (
                        <div className="text-[9.5px] text-ink-4 leading-tight">{subLabel}</div>
                      )}
                    </td>
                    <td className="px-2 py-0.5">
                      {gradeLabel ? (
                        <span className="text-[10px] text-ink-2 tracking-tight"
                              title={`Joins to scrap_price_benchmarks.material = '${r.scrap_grade}'`}>
                          {gradeLabel}
                        </span>
                      ) : (
                        <span className="text-[10px] text-ink-4 italic" title="No open-market scrap grade — waste, hazardous, or closed-loop fraction">
                          n/a
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-0.5 text-right text-[11px] tabular-nums text-ink">
                      {fmtKg(r.intensity_value)}
                    </td>
                    <td className="px-2 py-0.5 text-right text-[11px] tabular-nums text-emerald-700">
                      {fmtKg(r.recoverable_intensity_value)}
                    </td>
                    <td className="px-2 py-0.5 text-right text-[10.5px] tabular-nums">
                      <span className={clsx(CONF_STYLE[r.confidence] ?? 'text-ink-3')}>
                        {r.recoverability_pct != null ? `${r.recoverability_pct}%` : '—'}
                      </span>
                    </td>
                    <td className="px-2 py-0.5">
                      <span className="text-[10px] text-ink-3"
                            title={`${r.source_publication}${r.source_year ? ` (${r.source_year})` : ''}`}>
                        {basisLabel(r.recoverability_basis)}
                      </span>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Source footer */}
        {intensities.length > 0 && (
          <div className="flex-shrink-0 border-t border-border px-2.5 py-1 text-[9.5px] text-ink-4 leading-snug truncate"
               title={Array.from(new Set(intensities.map(r => r.source_publication))).join(' · ')}>
            Sources: {Array.from(new Set(intensities.map(r => r.source_publication))).slice(0, 2).join(' · ')}
            {new Set(intensities.map(r => r.source_publication)).size > 2 ? ' · …' : ''}
          </div>
        )}
      </div>
    </Panel>
  )
}

// ── 06 Historical Prices ─────────────────────────────────────────────────────
//
// Multi-line historical chart of scrap_price_benchmarks rows over time.
// Same grade + region taxonomy as the Scrap Prices panel — tech filter
// scopes to grades relevant to that asset class; region filter uses the
// same REGION_BUCKETS so e.g. selecting "EU" includes EU + LDN + TR +
// GLOBAL benchmarks.
//
// Time-range toggle: 1Y / 3Y / 5Y / MAX.

type HpRange = '1Y' | '3Y' | '5Y'

const HP_RANGES: { code: HpRange; days: number }[] = [
  { code: '1Y', days: 365  },
  { code: '3Y', days: 1095 },
  { code: '5Y', days: 1825 },
]

const HP_MIN_POINTS = 6   // hide series with fewer points than this — avoids
                          // legend entries for anchor-only grades that have
                          // no history yet (e.g. PV glass, Polysilicon)

interface HpRow { material: string; region: string; price: number; price_date: string; publisher: string }

// Map each scrap grade to a broad metal category used for Historical chart
// grouping — collapses multiple grades that share the same FRED proxy
// (e.g. all steel grades use WPU101211) into a single line per category.
const HP_CATEGORY: Record<string, string> = {
  steel_hms_1:        'Steel',
  steel_hms_2:        'Steel',
  steel_hms_1_2_8020: 'Steel',
  steel_busheling:    'Steel',
  steel_shred:        'Steel',
  cast_iron_general:  'Steel',
  copper_no_1:        'Copper',
  copper_no_2:        'Copper',
  copper_birch_cliff: 'Copper',
  aluminium_taint_tabor: 'Aluminium',
  aluminium_zorba:    'Aluminium',
  aluminium_twitch:   'Aluminium',
  aluminium_tense:    'Aluminium',
  aluminium_alloy_356:'Aluminium',
  silicon_solar:      'Polysilicon',
  silver_solar_grade: 'Silver',
  glass_pv_cullet:    'PV glass',
  lithium_carbonate:  'Lithium',
  lithium_hydroxide:  'Lithium',
  black_mass_nmc:     'Black mass',
  black_mass_lfp:     'Black mass',
  black_mass_nca:     'Black mass',
}

// Deterministic colour palette for lines. Series get assigned colours in
// alphabetical order of (material|region) key.
const HP_COLORS = [
  '#0B7285', '#0F8B58', '#B45309', '#C73838', '#7C3AED',
  '#DB2777', '#0891B2', '#65A30D', '#9333EA', '#DC2626',
  '#2563EB', '#EA580C',
]

const HP_MAX_SERIES = 10   // chart legibility cap

function HistoricalPricesPanel() {
  const [tech,    setTech]    = useState<TechFilter>('all')
  const [region,  setRegion]  = useState<AssetRegion>('ALL')
  const [range,   setRange]   = useState<HpRange>('5Y')
  const [rows,    setRows]    = useState<HpRow[]>([])
  const [loading, setLoading] = useState(true)

  // Pull all scrap_price_benchmarks rows for the selected region bucket,
  // excluding LME refined-metal entries (not scrap).
  useEffect(() => {
    let alive = true
    setLoading(true)
    let q = supabase
      .from('scrap_price_benchmarks')
      .select('material, region, price, price_date, publisher')
      .gte('price', 0)
      .neq('publisher', 'lme')
      .neq('region', 'LDN')
      .order('price_date', { ascending: true })
    if (region !== 'ALL') q = q.in('region', REGION_BUCKETS[region])
    q.then(({ data }) => {
      if (!alive) return
      setRows((data ?? []) as HpRow[])
      setLoading(false)
    })
    return () => { alive = false }
  }, [region])

  // Tech filter — restrict to grades relevant to the selected asset class.
  const techFiltered = useMemo(() => {
    if (tech === 'all') return rows
    const allowed = TECH_GRADES[tech]
    return rows.filter(r => allowed.has(r.material))
  }, [rows, tech])

  // Time-range cutoff
  const rangeFiltered = useMemo(() => {
    const r = HP_RANGES.find(x => x.code === range)
    if (!r) return techFiltered
    const cutoffMs = Date.now() - r.days * 86400_000
    return techFiltered.filter(d => new Date(d.price_date).getTime() >= cutoffMs)
  }, [techFiltered, range])

  // Pivot — group by (metal category × display region), then rebase each
  // resulting series to % change from its earliest value within the visible
  // range. Grouping by category collapses grades that share the same FRED
  // proxy (e.g. all steel grades) into one line, so identical curves don't
  // stack on top of each other in the chart.
  const { chartData, seriesKeys, baseRefs, seriesLabels } = useMemo(() => {
    // Step 1: count distinct dates per (actual_region, grade) — NOT per
    // display bucket — so we can drop sparse-history (region, grade) pairs
    // even when another region in the same display bucket has rich history.
    // E.g. HMS_TR has 59 dates of FRED backfill; HMS_EU has only 1 anchor
    // date. Both bucket into "Steel · Europe" but only HMS_TR should
    // contribute to the rebased curve.
    type SubRow = { date: string; price: number; grade: string }
    const dbRegionGradeDates = new Map<string, Set<string>>()  // "region|grade" → dates
    for (const r of rangeFiltered) {
      const gk = `${r.region}|${r.material}`
      const set = dbRegionGradeDates.get(gk) ?? new Set<string>()
      set.add(r.price_date)
      dbRegionGradeDates.set(gk, set)
    }

    // Step 2: bucket rows into (display category × display region), keeping
    // only rows whose specific (db region, grade) has >= HP_MIN_POINTS dates.
    const seriesRows = new Map<string, SubRow[]>()
    for (const r of rangeFiltered) {
      const cat = HP_CATEGORY[r.material]
      const reg = REGION_DISPLAY[r.region]
      if (!cat || !reg) continue
      const gk = `${r.region}|${r.material}`
      if ((dbRegionGradeDates.get(gk)?.size ?? 0) < HP_MIN_POINTS) continue
      const bk = `${cat}|${reg}`
      const arr = seriesRows.get(bk) ?? []
      arr.push({ date: r.price_date, price: Number(r.price), grade: r.material })
      seriesRows.set(bk, arr)
    }

    // Step 3: keep buckets with enough distinct dates overall
    const distinctDateCount = (rows: SubRow[]) => new Set(rows.map(r => r.date)).size
    const keys = Array.from(seriesRows.entries())
      .filter(([, rows]) => distinctDateCount(rows) >= HP_MIN_POINTS)
      .sort((a, b) => distinctDateCount(b[1]) - distinctDateCount(a[1]))
      .slice(0, HP_MAX_SERIES)
      .map(([k]) => k)
      .sort()

    // Step 3: per series, collapse to one price per date by averaging across
    // all grades within that (category, region). Then take the earliest value
    // as base for rebasing.
    const bases = new Map<string, { price: number; date: string; sampleGrade: string }>()
    const seriesByDate = new Map<string, Map<string, number>>()    // key → date → avg price
    for (const k of keys) {
      const rows = seriesRows.get(k) ?? []
      // Group by date, average prices across grades
      const byDate = new Map<string, number[]>()
      const grades = new Set<string>()
      for (const sr of rows) {
        const arr = byDate.get(sr.date) ?? []
        arr.push(sr.price)
        byDate.set(sr.date, arr)
        grades.add(sr.grade)
      }
      const dateAvgs = new Map<string, number>()
      for (const [d, prices] of byDate.entries()) {
        const avg = prices.reduce((s, x) => s + x, 0) / prices.length
        dateAvgs.set(d, avg)
      }
      seriesByDate.set(k, dateAvgs)
      // Earliest date = base
      const sortedDates = Array.from(dateAvgs.keys()).sort()
      if (sortedDates.length > 0) {
        const baseDate = sortedDates[0]
        const basePrice = dateAvgs.get(baseDate)!
        if (basePrice > 0) {
          bases.set(k, { price: basePrice, date: baseDate, sampleGrade: Array.from(grades)[0] ?? '' })
        }
      }
    }

    // Step 4a: compute per-series rebased values keyed by date
    const allDates = new Set<string>()
    for (const m of seriesByDate.values()) for (const d of m.keys()) allDates.add(d)
    const sortedDates = Array.from(allDates).sort()
    const seriesPct = new Map<string, Map<string, number>>()
    for (const k of keys) {
      const base = bases.get(k)?.price
      if (!base) continue
      const m = new Map<string, number>()
      const dateAvgs = seriesByDate.get(k)
      if (!dateAvgs) continue
      for (const [d, px] of dateAvgs.entries()) {
        m.set(d, ((px / base) - 1) * 100)
      }
      seriesPct.set(k, m)
    }

    // Step 4b: merge series that produce identical curves (within rounding
    // tolerance). Hash each series by its rounded-pct values across the
    // sorted date range, group keys by hash, and emit one merged series per
    // group with the regions concatenated in the legend label.
    const fingerprintOf = (k: string) => {
      const m = seriesPct.get(k) ?? new Map()
      return sortedDates.map(d => {
        const v = m.get(d)
        return v == null ? '_' : v.toFixed(1)
      }).join(',')
    }
    const groups = new Map<string, string[]>()   // fingerprint → original keys
    for (const k of keys) {
      const fp = fingerprintOf(k)
      const arr = groups.get(fp) ?? []
      arr.push(k)
      groups.set(fp, arr)
    }
    // For each group, choose a representative key (alphabetical first) and
    // build a combined label. Stable order = alphabetical of representative.
    const mergedKeys: string[] = []
    const mergedLabels = new Map<string, string>()
    const mergedBaseRefs = new Map<string, { price: number; date: string; sampleGrade: string }>()
    for (const groupKeys of groups.values()) {
      groupKeys.sort()
      const rep = groupKeys[0]
      mergedKeys.push(rep)
      const [category] = rep.split('|')
      const regions = groupKeys.map(k => {
        const code = k.split('|')[1]
        return ASSET_REGIONS.find(r => r.code === code)?.label ?? code
      })
      mergedLabels.set(rep, `${category} · ${regions.join(' + ')}`)
      // Use the representative's base price for tooltip $/t computation.
      const baseRef = bases.get(rep)
      if (baseRef) mergedBaseRefs.set(rep, baseRef)
    }
    mergedKeys.sort()

    // Step 4c: pivot to { date, [repKey]: pctChange }, only for merged reps
    const data = sortedDates.map(date => {
      const row: Record<string, any> = { date }
      for (const k of mergedKeys) {
        const v = seriesPct.get(k)?.get(date)
        if (v != null) row[k] = v
      }
      return row
    })

    return { chartData: data, seriesKeys: mergedKeys, baseRefs: mergedBaseRefs, seriesLabels: mergedLabels }
  }, [rangeFiltered])

  return (
    <Panel
      label="SMI"
      title="Historical Prices"
      meta={
        <div className="flex items-center gap-1.5">
          <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
            {TECH_TABS.map(t => (
              <button key={t.code} onClick={() => setTech(t.code)}
                      className={clsx(
                        'px-1.5 py-0.5 text-[10px] font-semibold tracking-wide rounded-sm',
                        tech === t.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                      )}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
            {HP_RANGES.map(r => (
              <button key={r.code} onClick={() => setRange(r.code)}
                      className={clsx(
                        'px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm',
                        range === r.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                      )}>
                {r.code}
              </button>
            ))}
          </div>
        </div>
      }>
      <div className="flex flex-col h-full">

        {/* Region strip — same buckets as Scrap Prices panel */}
        <div className="flex-shrink-0 border-b border-border bg-canvas px-2.5 py-1 flex items-center justify-between gap-2">
          <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
            {ASSET_REGIONS.map(r => (
              <button key={r.code} onClick={() => setRegion(r.code)}
                      className={clsx(
                        'px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm',
                        region === r.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                      )}>
                {r.label}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-ink-4 tabular-nums">
            {seriesKeys.length} series · {chartData.length} dates
          </span>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-[12px] text-ink-3">Loading…</div>
        ) : chartData.length === 0 || seriesKeys.length === 0 ? (
          <div className="flex-1 flex items-center justify-center px-4 text-[11.5px] text-ink-3 text-center leading-snug">
            No price history for these filters yet.<br />
            <span className="text-ink-4 mt-1 block">Weekly FRED + press jobs will populate this over time.</span>
          </div>
        ) : (
          <div className="flex-1 min-h-0 px-1 pt-1">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#E5E7EB" strokeDasharray="3 3" vertical={false} />
                <ReferenceArea y1={0} y2={0} stroke="#9CA3AF" strokeOpacity={0.6} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: '#6B7280' }}
                  tickFormatter={d => d.slice(0, 7)}
                  minTickGap={50}
                  axisLine={{ stroke: '#E5E7EB' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: '#6B7280' }}
                  tickFormatter={v => `${v >= 0 ? '+' : ''}${Math.round(v)}%`}
                  width={42}
                  axisLine={{ stroke: '#E5E7EB' }}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(v: any, name: any, item: any) => {
                    const pct = typeof v === 'number' ? v : 0
                    const sign = pct >= 0 ? '+' : ''
                    const dk = item && (item as any).dataKey ? String((item as any).dataKey) : ''
                    const base = baseRefs.get(dk)?.price
                    const live = base != null ? base * (1 + pct / 100) : null
                    const liveStr = live != null
                      ? ` (≈$${live.toLocaleString('en-US', { maximumFractionDigits: 0 })}/t)`
                      : ''
                    return [`${sign}${pct.toFixed(1)}%${liveStr}`, String(name ?? '')]
                  }}
                  labelFormatter={d => `${d}`}
                  contentStyle={{ fontSize: 9, padding: '3px 6px', border: '1px solid #E5E7EB', background: 'white', lineHeight: '12px' }}
                  labelStyle={{ fontSize: 9, fontWeight: 600, color: '#374151', marginBottom: 1 }}
                  itemStyle={{ fontSize: 9, padding: 0, lineHeight: '11px' }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 9.5, paddingTop: 2, lineHeight: '12px' }}
                  iconSize={7}
                  iconType="plainline"
                  align="left"
                  verticalAlign="bottom"
                />
                {seriesKeys.map((key, i) => {
                  const label = seriesLabels.get(key) ?? key
                  return (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={label}
                      stroke={HP_COLORS[i % HP_COLORS.length]}
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )
                })}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="flex-shrink-0 border-t border-border px-2.5 py-1 text-[9.5px] text-ink-4 leading-snug">
          Each series rebased to 0% at the start of the visible range — Y axis shows % change from that base.
          Source: scrap_price_benchmarks (Argus / Fastmarkets / FRED-modelled / press extracts).
        </div>
      </div>
    </Panel>
  )
}

// ── 07 Decom Material Volume Forecast — SCRAP MERCHANT STREAMS ───────────────
//
// Standard commodity scrap streams: steel, cast iron, copper, aluminium,
// zinc, glass cullet. Pathway = call a scrap merchant, get an LME-linked
// bid, sell. Multiple bidders, transparent pricing.
//
// Specialist recycling streams (composite, black mass, rare earths,
// silver, silicon) live in PCM Waste Flow Forecast — those need bespoke
// processors. Polymer + electrolyte (no recovery) hidden from both.
//
// Compute is shared with PCM panel via src/lib/wasteFlowCompute.ts —
// only difference is the bucket filter.

const SMI_REGIONS: { code: string; label: string; countries: string[] | null }[] = [
  { code: 'EU',     label: 'EU',     countries: ['DE','FR','ES','IT','NL','DK','SE','PL','PT','BE','AT','CZ','GR','IE','FI'] },
  { code: 'UK',     label: 'UK',     countries: ['GB'] },
  { code: 'US',     label: 'US',     countries: ['US'] },
  { code: 'GLOBAL', label: 'Global', countries: null },
]

const SMI_ASSET_CLASSES: { code: WFFAssetClass; label: string }[] = [
  { code: 'all',   label: 'All' },
  { code: 'wind',  label: 'Wind' },
  { code: 'solar', label: 'Solar PV' },
  { code: 'bess',  label: 'BESS' },
]

function DecomVolumeForecastPanel() {
  const [assetClass, setAssetClass] = useState<WFFAssetClass>('all')
  const [region, setRegion]         = useState('GLOBAL')
  const [rows, setRows]             = useState<InstallHistoryRow[]>([])
  const [loading, setLoading]       = useState(true)

  const windMedian  = useDesignLife(s => s.windMedianYears)
  const solarMedian = useDesignLife(s => s.solarMedianYears)
  const bessMedian  = useDesignLife(s => s.bessMedianYears)

  useEffect(() => {
    setLoading(true)
    const dbClasses = classesForSelection(assetClass).flatMap(dbAssetClassFilter)
    let q = supabase
      .from('installation_history')
      .select('asset_class, country, region, year, capacity_mw, duration_h')
      .in('asset_class', dbClasses)
    const cfg = SMI_REGIONS.find(r => r.code === region)
    if (cfg?.countries) q = q.in('country', cfg.countries)
    q.then(({ data }) => {
      setRows((data ?? []) as InstallHistoryRow[])
      setLoading(false)
    })
  }, [assetClass, region])

  const { chartData, materialKeys } = useMemo(
    () => computeWasteFlow({
      rows, assetClass, windMedian, solarMedian, bessMedian,
      bucket: 'scrap_merchant',     // ← THIS panel = scrap merchant streams only
    }),
    [rows, assetClass, windMedian, solarMedian, bessMedian],
  )

  const fmtT = (n: number) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}Mt`
                            : n >= 1_000     ? `${(n/1_000).toFixed(0)}kt`
                            : `${n.toFixed(0)}t`

  return (
    <Panel
      label="SMI"
      title="Decom Material Volume · scrap merchant streams"
      meta={
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-ink-4 tabular-nums"
                title="Median design life per asset class — set in the Asset Retirement Intelligence panel sliders.">
            {assetClass === 'all'
              ? `${windMedian}/${solarMedian}/${bessMedian}y W·S·B`
              : `${assetClass === 'wind' ? windMedian : assetClass === 'solar' ? solarMedian : bessMedian}y design life`}
          </span>
          <span className="text-ink-4 text-[10px]">·</span>
          <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
            {SMI_ASSET_CLASSES.map(a => (
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
            {SMI_REGIONS.map(r => (
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
        <div className="flex-1 min-h-0 px-2 pt-2">
          {loading ? (
            <div className="h-full flex items-center justify-center text-[12px] text-ink-3">Loading…</div>
          ) : chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[12px] text-ink-3">
              No retiring assets in this region {assetClass !== 'all' ? `for ${assetClass}` : ''}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 9, fill: '#6b7280' }}
                       axisLine={{ stroke: '#d1d5db' }} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: '#6b7280' }} axisLine={false} tickLine={false}
                       tickFormatter={(v: number) => fmtT(v)} />
                <Tooltip contentStyle={{ fontSize: 9, padding: '4px 6px', borderRadius: 2 }}
                         labelStyle={{ fontSize: 9, fontWeight: 600 }}
                         itemStyle={{ fontSize: 9 }}
                         formatter={(v: any) => fmtT(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 9, paddingTop: 2 }} iconSize={7} />
                {materialKeys.map(k => (
                  <Area key={k} type="monotone" dataKey={k} stackId="materials"
                        stroke={MATERIAL_COLORS[k] ?? '#9ca3af'}
                        fill={MATERIAL_COLORS[k] ?? '#9ca3af'}
                        fillOpacity={0.75}
                        name={materialName(k)} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Footer note — single line. Detail table removed per user
            (kept on PCM Waste Flow Forecast where the per-row
            P10/P50/P90 + sources are more useful for specialist
            recycling-pathway evaluation). */}
        <div className="flex-shrink-0 px-3 py-1 border-t border-border bg-canvas">
          <p className="text-[9.5px] text-ink-4 truncate"
             title={METHODOLOGY_NOTE.replace(/\n/g, ' ')}>
            First-degree recovery only · scrap merchant streams ·
            ARI design life · 2026-2035 · ±{assetClass === 'all' ? '15-35' : assetClass === 'wind' ? '15' : assetClass === 'solar' ? '25' : '35'}% confidence band · hover for full methodology
          </p>
        </div>
      </div>
    </Panel>
  )
}

// ── 08 Material Flows placeholder ─────────────────────────────────────────────

function MaterialFlowsPanel() {
  return (
    <Panel label="SMI" title="Material Flows"
           meta={<span className="text-[10px] uppercase tracking-wider text-amber font-semibold">In build</span>}>
      <div className="p-3 space-y-2 text-[12px]">
        <p className="text-ink-3 leading-snug">
          Volumetric flows of recovered materials by class and geography from wind decommissioning events.
        </p>
        <ul className="space-y-1 mt-2">
          {[
            'Annual scrap yield by asset class & vintage cohort',
            'HMS 1 / HMS 2 separation by region',
            'Copper cable recovery volume estimates',
            'Rare earth recovery from PMG turbines',
            'Regional material balance: production vs. capacity',
          ].map(s => (
            <li key={s} className="flex items-start gap-2">
              <div className="w-1 h-1 rounded-full bg-border mt-1.5 flex-shrink-0" />
              <span className="text-ink-2 text-[11.5px]">{s}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}

// ── 06 Scrap Off-takers Directory panel ──────────────────────────────────────
//
// Replaces the earlier Trade Flows panel. Asset-owner-facing list of scrap
// counterparties (merchants + integrated yards), filterable by country and
// wind-decom confidence rating. Source: scrap_offtakers + 060/061 diligence.

interface ScrapOfftakerRow {
  id:                       number
  name:                     string
  parent_company:           string | null
  hq_country:               string | null
  countries:                string[]
  offtaker_type:            'merchant' | 'integrated' | 'smelter' | 'mill'
  intake_capacity_kt_year:  number | null
  capacity_basis:           string | null
  plant_count:              number | null
  plants:                   { city: string; country: string; specialty?: string }[] | null
  website:                  string | null
  source_url:               string | null
  status:                   'active' | 'distressed' | 'defunct' | 'pending_acquisition' | null
  wind_decom_confidence:    'HIGH' | 'MEDIUM' | 'LOW' | null
  solar_decom_confidence:   'HIGH' | 'MEDIUM' | 'LOW' | null
  bess_decom_confidence:    'HIGH' | 'MEDIUM' | 'LOW' | null
  notes:                    string | null
}

type OfftakerAssetClass = 'wind' | 'solar' | 'bess'

const OFFTAKER_ASSET_TABS: { code: OfftakerAssetClass; label: string }[] = [
  { code: 'wind',  label: 'Wind'  },
  { code: 'solar', label: 'Solar' },
  { code: 'bess',  label: 'BESS'  },
]

const CONFIDENCE_TIP: Record<OfftakerAssetClass, Record<'HIGH' | 'MEDIUM' | 'LOW', string>> = {
  wind: {
    HIGH:   'Bulk ferrous capacity at ~1Mt+/yr OR documented wind-decom track record OR port-side handling for offshore lots.',
    MEDIUM: 'Capable regional merchant, sized for 5–10 kt lots; no specific wind track record but appropriate scale.',
    LOW:    'Sub-scale, wrong geography, captive-only mill feed, or specialty — not a typical wind-decom counterparty.',
  },
  solar: {
    HIGH:   'Multi-Mt operator with established aluminium taint/tabor + copper segregation; can absorb large solar Al frame lots.',
    MEDIUM: 'Capable regional merchant for Al frame + Cu cable lots; no solar specialism but appropriate scale.',
    LOW:    'Waste-led, wind-specialist, or sub-scale for solar Al frame volumes.',
  },
  bess: {
    HIGH:   'Integrated battery dismantling line — handles BESS residuals (steel casings, Cu/Al busbars) alongside black-mass routing.',
    MEDIUM: 'Can absorb post-black-mass residuals; black mass itself routed separately to specialty processors.',
    LOW:    'Sub-scale or wrong specialty for battery residuals.',
  },
}

const CONFIDENCE_PILL: Record<'HIGH' | 'MEDIUM' | 'LOW', string> = {
  HIGH:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
  LOW:    'bg-slate-100 text-slate-600 border-slate-300',
}

const STATUS_PILL_OFFTAKER: Record<string, string> = {
  distressed:          'bg-red-50 text-red-700 border-red-200',
  pending_acquisition: 'bg-blue-50 text-blue-700 border-blue-200',
  defunct:             'bg-slate-100 text-slate-500 border-slate-300',
}

function ScrapOfftakersPanel() {
  const [rows,     setRows]     = useState<ScrapOfftakerRow[]>([])
  const [loading,  setLoading]  = useState(true)
  const [country,  setCountry]  = useState<string>('ALL')
  const [mapOpen,  setMapOpen]  = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    supabase.from('scrap_offtakers')
      .select('id, name, parent_company, hq_country, countries, offtaker_type, intake_capacity_kt_year, capacity_basis, plant_count, plants, website, source_url, status, wind_decom_confidence, solar_decom_confidence, bess_decom_confidence, notes')
      .neq('status', 'defunct')
      .then(res => {
        if (!alive) return
        setRows((res.data ?? []) as ScrapOfftakerRow[])
        setLoading(false)
      })
    return () => { alive = false }
  }, [])

  // Distinct countries (union of countries[] arrays)
  const countryOptions = useMemo(() => {
    const set = new Set<string>()
    rows.forEach(r => r.countries?.forEach(c => set.add(c)))
    return Array.from(set).sort()
  }, [rows])

  const filtered = useMemo(() => {
    return rows
      .filter(r => country === 'ALL' || r.countries?.includes(country))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, country])

  const fmtCapacity = (kt: number | null) => {
    if (kt == null) return '—'
    if (kt >= 1000) return `${(kt / 1000).toFixed(1)} Mt`
    return `${kt.toFixed(0)} kt`
  }

  return (
    <Panel
      label="SMI"
      title="Metal Scrap Merchants"
      meta={
        <div className="flex items-center gap-1.5">
          <button onClick={() => setMapOpen(true)}
                  className="px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-ink-3 hover:text-teal bg-canvas border border-border rounded-sm">
            View on map
          </button>
          <select
            value={country}
            onChange={e => setCountry(e.target.value)}
            className="bg-canvas border border-border rounded-sm px-1.5 py-0.5 text-[10px] text-ink font-semibold tracking-wide focus:outline-none focus:border-teal">
            <option value="ALL">All countries</option>
            {countryOptions.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      }>

      {loading ? (
        <div className="h-full flex items-center justify-center text-[12px] text-ink-3">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="h-full flex items-center justify-center text-[11.5px] text-ink-3">No off-takers match these filters.</div>
      ) : (
        <table className="w-full table-fixed">
          <colgroup>
            <col style={{ width: '30%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '17%' }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-titlebar/95 backdrop-blur">
            <tr className="border-b border-border/60">
              <th className="px-2 py-1 text-left text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Operator</th>
              <th className="px-2 py-1 text-left text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Parent</th>
              <th className="px-2 py-1 text-left text-[9px] font-semibold text-ink-4 uppercase tracking-wide">HQ</th>
              <th className="px-2 py-1 text-left text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Type</th>
              <th className="px-2 py-1 text-right text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Capacity / yr</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-raised">
                <td className="px-2 py-0.5">
                  <div className="text-[11px] text-ink font-medium leading-tight flex items-center gap-1.5">
                    {r.website ? (
                      <a href={r.website} target="_blank" rel="noreferrer"
                         className="hover:text-teal hover:underline">
                        {r.name}
                      </a>
                    ) : r.name}
                    {r.status && r.status !== 'active' && (
                      <span className={clsx(
                        'text-[8.5px] font-bold px-1 py-px rounded-sm border tracking-wide uppercase',
                        STATUS_PILL_OFFTAKER[r.status] ?? 'bg-canvas text-ink-3 border-border',
                      )}>
                        {r.status === 'pending_acquisition' ? 'M&A' : r.status}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-2 py-0.5 text-[10.5px] text-ink-3 truncate" title={r.parent_company ?? undefined}>
                  {r.parent_company ?? '—'}
                </td>
                <td className="px-2 py-0.5 text-[10.5px] text-ink-2 tabular-nums">
                  {r.hq_country ?? '—'}
                </td>
                <td className="px-2 py-0.5 text-[10.5px] text-ink-3 capitalize">
                  {r.offtaker_type}
                </td>
                <td className="px-2 py-0.5 text-right text-[10.5px] tabular-nums text-ink whitespace-nowrap"
                    title={r.capacity_basis ? `Basis: ${r.capacity_basis}` : undefined}>
                  {fmtCapacity(r.intake_capacity_kt_year)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {mapOpen && (
        <ScrapMerchantMapModal
          operators={rows as unknown as MapOperator[]}
          country={country}
          onClose={() => setMapOpen(false)}
        />
      )}
    </Panel>
  )
}

// (legacy Trade Flows types retained below in case referenced elsewhere)
type TradeMaterial = 'ferrous_scrap' | 'copper_scrap' | 'aluminium_scrap' | 'battery_black_mass'

const TRADE_MATERIAL_TABS: { code: TradeMaterial; label: string; assetClass: string }[] = [
  { code: 'ferrous_scrap',     label: 'Ferrous',     assetClass: 'Wind'  },
  { code: 'copper_scrap',      label: 'Copper',      assetClass: 'Wind'  },
  { code: 'aluminium_scrap',   label: 'Aluminium',   assetClass: 'Solar' },
  { code: 'battery_black_mass',label: 'Black mass',  assetClass: 'BESS'  },
]

interface TradeFlowRow {
  material:         TradeMaterial
  exporter:         string
  importer:         string
  volume_tonnes:    number
  year:             number
  yoy_change_pct:   number | null
  source_publisher: string | null
  source_url:       string | null
  notes:            string | null
}

interface TradePolicyRow {
  event_date:         string
  jurisdiction:       string
  event_type:         string
  status:             string
  title:              string
  description:        string | null
  affected_materials: string[] | null
  source_url:         string | null
}

function TradeFlowsPanel() {
  const [material, setMaterial] = useState<TradeMaterial>('ferrous_scrap')
  const [flows,    setFlows]    = useState<TradeFlowRow[]>([])
  const [events,   setEvents]   = useState<TradePolicyRow[]>([])
  const [loading,  setLoading]  = useState(true)

  // Latest year flows for selected material
  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      supabase.from('trade_flows')
        .select('material, exporter, importer, volume_tonnes, year, yoy_change_pct, source_publisher, source_url, notes')
        .eq('material', material)
        .order('year', { ascending: false })
        .order('volume_tonnes', { ascending: false }),
      supabase.from('trade_policy_events')
        .select('event_date, jurisdiction, event_type, status, title, description, affected_materials, source_url')
        .order('event_date', { ascending: false })
        .limit(40),
    ]).then(([flowsRes, eventsRes]) => {
      if (!alive) return
      setFlows((flowsRes.data ?? []) as TradeFlowRow[])
      setEvents((eventsRes.data ?? []) as TradePolicyRow[])
      setLoading(false)
    })
    return () => { alive = false }
  }, [material])

  // Filter flows to most-recent year, compute % of total
  const { topFlows, latestYear, totalVolume } = useMemo(() => {
    if (flows.length === 0) return { topFlows: [], latestYear: null, totalVolume: 0 }
    const ly = Math.max(...flows.map(f => f.year))
    const yearRows = flows.filter(f => f.year === ly)
    const total = yearRows.reduce((s, r) => s + Number(r.volume_tonnes), 0)
    const top = yearRows.slice(0, 6)
    return { topFlows: top, latestYear: ly, totalVolume: total }
  }, [flows])

  // Filter policy events relevant to selected material; show last 24m + next 24m
  const relevantEvents = useMemo(() => {
    const matKey = material.replace('_scrap', '').replace('battery_', '').replace('lithium_', '')
    const wanted = matKey === 'black_mass' ? ['battery', 'plastic'] : [matKey]
    return events.filter(e => {
      if (!e.affected_materials || e.affected_materials.length === 0) return true
      return e.affected_materials.some(m => wanted.includes(m) || m === 'plastic')
    })
  }, [events, material])

  const fmtVolume = (t: number) => {
    if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(2)}Mt`
    if (t >= 1_000)     return `${(t / 1_000).toFixed(0)}kt`
    return `${t.toFixed(0)}t`
  }

  const STATUS_PILL: Record<string, string> = {
    effective:    'bg-emerald-50 text-emerald-700 border-emerald-200',
    announced:    'bg-amber-50 text-amber-700 border-amber-200',
    proposed:     'bg-slate-50 text-slate-700 border-slate-200',
    consultation: 'bg-blue-50 text-blue-700 border-blue-200',
    superseded:   'bg-red-50 text-red-700 border-red-200',
  }
  const JURISDICTION_LABEL: Record<string, string> = {
    EU: 'EU', CN: 'China', US: 'US', UK: 'UK', IN: 'India', GLOBAL: 'Global',
  }

  return (
    <Panel
      label="SMI"
      title="Trade Flows"
      meta={
        <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
          {TRADE_MATERIAL_TABS.map(t => (
            <button key={t.code} onClick={() => setMaterial(t.code)}
                    title={`${t.assetClass} primary stream`}
                    className={clsx(
                      'px-1.5 py-0.5 text-[10px] font-semibold tracking-wide rounded-sm',
                      material === t.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                    )}>
              {t.label}
              <span className="text-[8.5px] text-ink-4 ml-1 normal-case">{t.assetClass[0]}</span>
            </button>
          ))}
        </div>
      }>

      <div className="flex flex-col h-full">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-[12px] text-ink-3">Loading…</div>
        ) : (
          <>
            {/* Top corridors table */}
            <div className="flex-shrink-0 border-b border-border">
              <div className="px-2.5 py-1 bg-titlebar/50 flex items-center justify-between">
                <div className="text-[9.5px] font-bold text-ink-4 uppercase tracking-wider">
                  Top corridors {latestYear ? `· ${latestYear}` : ''}
                </div>
                <div className="text-[9.5px] text-ink-4 tabular-nums">
                  total {fmtVolume(totalVolume)}
                </div>
              </div>
              {topFlows.length === 0 ? (
                <div className="px-3 py-3 text-[11.5px] text-ink-3 text-center leading-snug">
                  No flow data for {material.replace('_', ' ')} yet.
                </div>
              ) : (
                <table className="w-full table-fixed">
                  <colgroup>
                    <col style={{ width: '40%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '13%' }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-border/60">
                      <th className="px-2 py-1 text-left text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Corridor</th>
                      <th className="px-2 py-1 text-right text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Volume</th>
                      <th className="px-2 py-1 text-right text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Share</th>
                      <th className="px-2 py-1 text-right text-[9px] font-semibold text-ink-4 uppercase tracking-wide">YoY</th>
                      <th className="px-2 py-1 text-left text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topFlows.map(f => {
                      const share = totalVolume > 0 ? (Number(f.volume_tonnes) / totalVolume * 100) : 0
                      const yoy = f.yoy_change_pct
                      return (
                        <tr key={`${f.exporter}-${f.importer}-${f.year}`}
                            className="border-b border-border/40 last:border-0 hover:bg-raised">
                          <td className="px-2 py-0.5">
                            <div className="text-[11px] text-ink font-medium leading-tight"
                                 title={f.notes ?? undefined}>
                              {f.exporter} → {f.importer}
                            </div>
                          </td>
                          <td className="px-2 py-0.5 text-right text-[11px] tabular-nums text-ink font-semibold whitespace-nowrap">
                            {fmtVolume(Number(f.volume_tonnes))}
                          </td>
                          <td className="px-2 py-0.5 text-right text-[10.5px] tabular-nums text-ink-3">
                            {share.toFixed(0)}%
                          </td>
                          <td className={clsx(
                            'px-2 py-0.5 text-right text-[10.5px] tabular-nums whitespace-nowrap',
                            yoy == null ? 'text-ink-4' : yoy >= 0 ? 'text-emerald-700' : 'text-down',
                          )}>
                            {yoy == null ? '—' : `${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}%`}
                          </td>
                          <td className="px-2 py-0.5 text-[10px] text-ink-3 truncate">
                            {f.source_url ? (
                              <a href={f.source_url} target="_blank" rel="noreferrer"
                                 className="hover:text-teal hover:underline"
                                 onClick={e => e.stopPropagation()}>
                                {f.source_publisher}
                              </a>
                            ) : f.source_publisher}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Policy events timeline */}
            <div className="flex-1 min-h-0 overflow-auto">
              <div className="px-2.5 py-1 bg-titlebar/50 sticky top-0 z-10 border-b border-border/60">
                <div className="text-[9.5px] font-bold text-ink-4 uppercase tracking-wider">
                  Policy timeline · {relevantEvents.length} events
                </div>
              </div>
              {relevantEvents.length === 0 ? (
                <div className="px-3 py-3 text-[11.5px] text-ink-3 text-center">No relevant policy events.</div>
              ) : (
                <ul className="divide-y divide-border/60">
                  {relevantEvents.map(e => (
                    <li key={`${e.event_date}-${e.title}`} className="px-2.5 py-1 hover:bg-raised">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <span className="text-[10px] text-ink-3 tabular-nums font-semibold">{e.event_date}</span>
                        <span className="text-[9.5px] font-bold px-1 py-px rounded-sm border tracking-wider bg-canvas text-ink-2 border-border">
                          {JURISDICTION_LABEL[e.jurisdiction] ?? e.jurisdiction}
                        </span>
                        <span className={clsx(
                          'text-[9px] font-bold px-1 py-px rounded-sm border tracking-wide uppercase',
                          STATUS_PILL[e.status] ?? 'bg-canvas text-ink-3 border-border',
                        )}>
                          {e.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-ink font-medium leading-tight">
                        {e.source_url ? (
                          <a href={e.source_url} target="_blank" rel="noreferrer"
                             className="hover:text-teal hover:underline"
                             onClick={ev => ev.stopPropagation()}>
                            {e.title}
                          </a>
                        ) : e.title}
                      </div>
                      {e.description && (
                        <div className="text-[10px] text-ink-3 leading-snug mt-0.5">{e.description}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex-shrink-0 border-t border-border px-2.5 py-1 text-[9.5px] text-ink-4 leading-snug">
              Sources: BIR World Mirror · Eurostat · GMK Center · UN Comtrade · European Commission · India BIS
            </div>
          </>
        )}
      </div>
    </Panel>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function MaterialsPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden bg-page">

      <div className="flex-shrink-0 h-9 px-3 border-b border-border bg-canvas flex items-center justify-between">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[13px] font-semibold text-ink uppercase tracking-wide">Secondary Materials Intelligence</h1>
          <span className="text-[11.5px] text-ink-3">Decom volumes · OEM material intensities · scrap prices · cross-asset</span>
        </div>
        <div className="flex items-center gap-3 text-[10.5px] text-ink-3 flex-shrink-0 uppercase tracking-wide">
          <span>Coverage</span>
          <div className="flex items-center gap-1">
            {['EU', 'GB', 'US'].map(s => (
              <span key={s} className="px-1.5 py-px bg-canvas border border-border rounded-sm text-ink-3 normal-case font-semibold">
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 3x2 grid — equal column widths, two rows. Panels scroll internally. */}
      <div className="flex-1 min-h-0 overflow-hidden p-1.5">
        <div className="h-full grid grid-cols-3 grid-rows-2 gap-1.5">
          <CommodityRefsPanel />
          <MaterialIntensityCalculatorPanel />
          <HistoricalPricesPanel />
          <DecomVolumeForecastPanel />
          <MaterialFlowsPanel />
          <ScrapOfftakersPanel />
        </div>
      </div>

    </div>
  )
}
