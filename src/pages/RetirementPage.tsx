// ── Asset Retirement Intelligence — Tab 03 ───────────────────────────────────
// 8 panels in a 12-col grid (no full-width content).
//   Row 1: Fleet Cohorts table (col-7) + Retirement Waves cards (col-5)
//   Row 2: Installation Pipeline chart (col-6) + Asset Map (col-6)
//   Row 3: Retirement Intent feed (col-8) + Japan Cohort (col-4)
//   Row 4: Repowering Pipeline (col-9) + Stage Funnel (col-3)

import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import { ExternalLink } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend } from 'recharts'
import { supabase } from '@/lib/supabase'
import { InstallStackedArea } from '@/components/charts/InstallStackedArea'
import { DecomWaveBars }      from '@/components/charts/DecomWaveBars'
import { WorldAssetMap, type AssetPin } from '@/components/charts/WorldAssetMap'
import type { RepoweringProject, RepoweringStage } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AssetRow {
  id:                  string
  asset_class:         string
  country_code:        string
  capacity_mw:         number | null
  commissioning_date:  string | null
}

interface CohortBucket {
  year:        number
  country:     string
  asset_class: string
  capacity_mw: number
  count:       number
  eol_year:    number
  eol_flag:    'past' | 'near' | 'mid' | 'far'
}

interface WatchEvent {
  id:           string
  headline:     string
  notes:        string | null
  event_type:   string
  scope:        string
  site_name:    string | null
  company_name: string | null
  developer:    string | null
  capacity_mw:  number | null
  event_date:   string
  confidence:   'High' | 'Medium' | 'Low'
  source_url:   string | null
  watch_sources: { name: string; url: string | null } | null
}

interface PipelineRow {
  country_code: string
  sub_region:   string
  install_year: number
  installed_gw: number
}

const DESIGN_LIFE: Record<string, number> = {
  onshore_wind:  25, offshore_wind: 25, solar_pv: 25, bess: 15,
}

const ASSET_CLASS_LABEL: Record<string, string> = {
  onshore_wind:  'Onshore',
  offshore_wind: 'Offshore',
  solar_pv:      'Solar',
  bess:          'BESS',
}

const ASSET_CLASS_PILL: Record<string, string> = {
  onshore_wind:  'bg-teal-50 text-teal-700 border-teal-200',
  offshore_wind: 'bg-sky-50 text-sky-700 border-sky-200',
  solar_pv:      'bg-amber-50 text-amber-700 border-amber-200',
  bess:          'bg-violet-50 text-violet-700 border-violet-200',
}

const COUNTRY_LABEL: Record<string, string> = {
  GB: 'UK', DE: 'Germany', US: 'United States', DK: 'Denmark',
  FR: 'France', ES: 'Spain', NL: 'Netherlands', SE: 'Sweden',
  IT: 'Italy', AU: 'Australia', JP: 'Japan', CA: 'Canada',
}

const SCOPE_LABEL = COUNTRY_LABEL

const STAGE_LABEL: Record<RepoweringStage, string> = {
  announced:             'Announced',
  application_submitted: 'App. Submitted',
  application_approved:  'App. Approved',
  permitted:             'Permitted',
  ongoing:               'Ongoing',
}

const STAGE_PILL: Record<RepoweringStage, string> = {
  announced:             'bg-sky-50 text-sky-700 border-sky-200',
  application_submitted: 'bg-violet-50 text-violet-700 border-violet-200',
  application_approved:  'bg-blue-50 text-blue-700 border-blue-200',
  permitted:             'bg-teal-50 text-teal-700 border-teal-200',
  ongoing:               'bg-emerald-50 text-emerald-700 border-emerald-200',
}

const EOL_FLAG_PILL: Record<CohortBucket['eol_flag'], string> = {
  past: 'bg-red-50 text-red-700 border-red-200',
  near: 'bg-red-50 text-red-700 border-red-200',
  mid:  'bg-amber-50 text-amber-700 border-amber-200',
  far:  'bg-canvas text-ink-3 border-border',
}

const EOL_FLAG_BAR: Record<CohortBucket['eol_flag'], string> = {
  past: 'bg-down', near: 'bg-down', mid: 'bg-amber', far: 'bg-teal',
}

const CONFIDENCE_STYLE: Record<string, string> = {
  High: 'text-up', Medium: 'text-amber', Low: 'text-down',
}

const RETIREMENT_EVENT_TYPES = [
  'Decommissioning', 'End-of-life planning', 'Foundation removal',
  'Site restoration', 'Insolvency', 'FIT expiry', 'Post-FIT decision',
  'Japan cohort',
]

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try { return new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) }
  catch { return '—' }
}

// Human-readable label for repowering project's source_type. Maps the
// raw values used by ingestion scripts (REPD, EEG MaStR, Airtable, trade
// press extraction) to friendly text.
const SOURCE_LABEL_MAP: Record<string, string> = {
  'repd':                       'BEIS REPD',
  'planning_application':       'Planning application',
  'planning_consent':           'Planning consent',
  'permit_submission':          'Permit submission',
  'mastr':                      'BNetzA MaStR',
  'eeg_register':               'EEG register',
  'airtable':                   'Internal curation',
  'company_filing':             'Company filing',
  'investor_disclosure':        'Investor disclosure',
  'company_press_release':      'Company press release',
  'trade_press':                'Trade press',
  'regulator_announcement':     'Regulator announcement',
  'industry_association':       'Industry association',
  'manual':                     'Manual entry',
}

function sourceLabel(t: string | null | undefined): string {
  if (!t) return '—'
  return SOURCE_LABEL_MAP[t] ?? t.replace(/_/g, ' ')
}

function fmtMW(val: number | null | undefined): string {
  if (val == null) return '—'
  return val >= 1000 ? `${(val / 1000).toFixed(1)} GW` : `${val.toLocaleString('en-GB', { maximumFractionDigits: 0 })} MW`
}

function extractYear(date: string | null): number | null {
  if (!date) return null
  try { return new Date(date).getFullYear() } catch { return null }
}

function eolFlag(eolYear: number, today: number): CohortBucket['eol_flag'] {
  const delta = eolYear - today
  if (delta <= 0)  return 'past'
  if (delta <= 5)  return 'near'
  if (delta <= 10) return 'mid'
  return 'far'
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

// ── 01 Fleet Cohorts panel ────────────────────────────────────────────────────

// ── Retirement panels (Wind / Solar / BESS) — Weibull cohort projection ─────
//
// Each panel reads installation_history (annual MW per country/region) for
// its asset class, then projects retirements 2026-2035 using a Weibull
// distribution parameterised by user-adjustable median life. For BESS
// duration_h is also pulled and we display MWh rather than MW.

interface InstallRow {
  asset_class:  string
  country:      string
  region:       string | null
  year:         number
  capacity_mw:  number
  duration_h:   number | null
}

type RetKey = 'wind' | 'solar' | 'bess'

interface RetSpec {
  key:           RetKey
  assetClasses:  string[]                // DB filter (wind = onshore + offshore combined)
  title:         string
  unitLabel:     string                  // 'MW' or 'MWh'
  sliderMin:     number
  sliderMax:     number
  sliderDefault: number
  sliderLabel:   string
}

// Retirement model: triangular distribution centred on the slider's median
// life, with zero retirement outside median±2 years. Annual retirement
// fractions are 1/9, 2/9, 3/9, 2/9, 1/9 across (median-2, -1, 0, +1, +2).
// This avoids the long-tail distortion of a Weibull curve where young /
// very-old cohorts contribute fictitious early/late retirements.
const RET_SPECS: Record<RetKey, RetSpec> = {
  wind:  { key:'wind',  assetClasses:['wind_onshore','wind_offshore'], title:'Wind — Retirement Pipeline 2026-2035',  unitLabel:'MW',  sliderMin:18, sliderMax:25, sliderDefault:22, sliderLabel:'Median design life (yrs)' },
  solar: { key:'solar', assetClasses:['solar'],                        title:'Solar PV — Retirement Pipeline 2026-2035', unitLabel:'MW',  sliderMin:20, sliderMax:30, sliderDefault:25, sliderLabel:'Median design life (yrs)' },
  bess:  { key:'bess',  assetClasses:['bess'],                         title:'BESS — Retirement Pipeline 2026-2035',     unitLabel:'MWh', sliderMin:11, sliderMax:15, sliderDefault:12, sliderLabel:'Median design life (yrs)' },
}

const RETIRE_YEARS = Array.from({ length: 10 }, (_, i) => 2026 + i)   // 2026-2035

// Endenex brand palette — navy + teal family + gold accent.
// Source: Endenex marketing-site CSS tokens (--navy / --teal / --teal-l /
// --acc / state colours from uk-wind-pipeline + us-canada-wind-pipeline).
const RET_PALETTE = [
  '#0A1628',  // navy (primary brand)
  '#007B8A',  // teal (primary accent)
  '#C4863A',  // gold accent
  '#4A9BAA',  // light teal
  '#1C3D52',  // dark teal-navy
  '#2A7F8E',  // mid teal
  '#3D6E7A',  // teal-grey
  '#5A8A95',  // soft teal
  '#6BAAB5',  // pale teal
  '#1E5060',  // deep navy-teal
  '#345F6A',  // medium navy-teal
  '#9BB5BB',  // very pale teal
  '#007B60',  // teal-green
  '#8C8880',  // warm grey
  '#9B3A3A',  // red (sparing — last-resort distinct hue)
]

// Triangular retirement distribution centred on `median` with hard cutoff
// at median±2. Annual fractions:
//   age = median-2  →  1/9 (~11%)
//   age = median-1  →  2/9 (~22%)
//   age = median    →  3/9 (~33%)  ← peak
//   age = median+1  →  2/9 (~22%)
//   age = median+2  →  1/9 (~11%)
// Outside median±2: zero. Sum = 9/9 = 100% of cohort retires within ±2y.
function triangularAnnualRetirement(age: number, median: number): number {
  if (age < 0) return 0
  const offset = Math.abs(Math.round(age) - median)
  if (offset > 2) return 0
  return (3 - offset) / 9
}

interface RetirementPanelProps {
  spec:       RetSpec
  className?: string
}

function RetirementPanel({ spec, className }: RetirementPanelProps) {
  const [rows,    setRows]    = useState<InstallRow[]>([])
  const [loading, setLoading] = useState(true)
  const [median,  setMedian]  = useState(spec.sliderDefault)
  const [selected,setSelected]= useState<Set<string>>(new Set())   // selected countries; empty = ALL

  // Load installation history for this asset class (or set of classes for wind)
  useEffect(() => {
    let alive = true
    setLoading(true)
    supabase.from('installation_history')
      .select('asset_class, country, region, year, capacity_mw, duration_h')
      .in('asset_class', spec.assetClasses)
      .order('year', { ascending: true })
      .then(({ data }) => {
        if (!alive) return
        setRows((data ?? []) as InstallRow[])
        setLoading(false)
      })
    return () => { alive = false }
  }, [spec.assetClasses])

  // Distinct countries (display labels)
  const countries = useMemo(() => {
    const set = new Set<string>()
    rows.forEach(r => set.add(r.country))
    return Array.from(set).sort()
  }, [rows])

  // Apply country filter (empty selection = all)
  const filtered = useMemo(() => {
    if (selected.size === 0) return rows
    return rows.filter(r => selected.has(r.country))
  }, [rows, selected])

  // Project retirements per (country, year)
  const { chartData, seriesKeys } = useMemo(() => {
    // Aggregate to country-level annual capacity (across regions + sub-asset-classes)
    const byCountryYear = new Map<string, Map<number, number>>()
    for (const r of filtered) {
      const mw = spec.unitLabel === 'MWh' && r.duration_h != null
        ? r.capacity_mw * r.duration_h
        : r.capacity_mw
      const inner = byCountryYear.get(r.country) ?? new Map<number, number>()
      inner.set(r.year, (inner.get(r.year) ?? 0) + mw)
      byCountryYear.set(r.country, inner)
    }

    const data: Record<string, any>[] = RETIRE_YEARS.map(Y => {
      const row: Record<string, any> = { year: Y }
      for (const [country, yearMap] of byCountryYear.entries()) {
        let retiring = 0
        for (const [installYear, capacity] of yearMap.entries()) {
          const age = Y - installYear
          retiring += capacity * triangularAnnualRetirement(age, median)
        }
        row[country] = Math.round(retiring)
      }
      return row
    })

    const keys = Array.from(byCountryYear.keys())
      .filter(c => data.some(d => (d[c] ?? 0) >= 1))
      .sort((a, b) => {
        const ba = data.reduce((s, d) => s + (d[b] ?? 0), 0)
        const aa = data.reduce((s, d) => s + (d[a] ?? 0), 0)
        return ba - aa
      })

    return { chartData: data, seriesKeys: keys }
  }, [filtered, median, spec.unitLabel])

  const toggleCountry = (c: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  }

  return (
    <Panel label="ARI" title={spec.title} className={className}
           meta={
             <div className="flex items-center gap-2 text-[10.5px] text-[#8C8880]">
               <span className="uppercase tracking-wider">{spec.sliderLabel}</span>
               <input
                 type="range"
                 min={spec.sliderMin} max={spec.sliderMax}
                 step={1}
                 value={median}
                 onChange={e => setMedian(parseInt(e.target.value))}
                 className={clsx(
                   'w-24 h-1 rounded-sm cursor-pointer appearance-none bg-[#D8D3CB] outline-none',
                   '[&::-webkit-slider-thumb]:appearance-none',
                   '[&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5',
                   '[&::-webkit-slider-thumb]:rounded-full',
                   '[&::-webkit-slider-thumb]:bg-[#0A1628]',
                   '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white',
                   '[&::-webkit-slider-thumb]:shadow-sm',
                   '[&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5',
                   '[&::-moz-range-thumb]:rounded-full',
                   '[&::-moz-range-thumb]:bg-[#0A1628]',
                   '[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white',
                 )}
               />
               <span className="tabular-nums font-semibold text-[#0A1628] w-7 text-right">{median}y</span>
             </div>
           }>
      <div className="flex flex-col h-full">
        {/* Country chips — Endenex palette */}
        <div className="flex-shrink-0 px-2 pt-2 pb-1.5 flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setSelected(new Set())}
            className={clsx(
              'text-[9.5px] font-semibold tracking-wide px-1.5 py-0.5 rounded-sm border transition-colors',
              selected.size === 0
                ? 'bg-[#0A1628] text-white border-[#0A1628]'
                : 'bg-[#F7F4EF] text-[#8C8880] border-[#D8D3CB] hover:text-[#007B8A] hover:border-[#007B8A]/60',
            )}>
            All
          </button>
          {countries.map(c => (
            <button key={c}
                    onClick={() => toggleCountry(c)}
                    className={clsx(
                      'text-[9.5px] font-semibold tracking-wide px-1.5 py-0.5 rounded-sm border transition-colors',
                      selected.has(c)
                        ? 'bg-[#0A1628] text-white border-[#0A1628]'
                        : 'bg-[#F7F4EF] text-[#8C8880] border-[#D8D3CB] hover:text-[#007B8A] hover:border-[#007B8A]/60',
                    )}>
              {c}
            </button>
          ))}
        </div>

        {/* Chart */}
        <div className="flex-1 min-h-0 px-1 pb-1">
          {loading ? (
            <div className="h-full flex items-center justify-center text-[11.5px] text-ink-3">Loading…</div>
          ) : seriesKeys.length === 0 ? (
            <div className="h-full flex items-center justify-center px-4 text-[11.5px] text-ink-3 text-center">
              No installation history for this asset class yet.<br/>Run migration 071 (Phase 1) and 072 (full Tier 1).
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }} barCategoryGap="15%">
                <CartesianGrid stroke="#E5E7EB" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="year"
                       tick={{ fontSize: 9, fill: '#6B7280' }}
                       axisLine={{ stroke: '#E5E7EB' }}
                       tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: '#6B7280' }}
                       width={50}
                       tickFormatter={v => {
                         const gwUnit = spec.unitLabel === 'MWh' ? 'GWh' : 'GW'
                         const mwUnit = spec.unitLabel === 'MWh' ? 'MWh' : 'MW'
                         if (v >= 1000) {
                           const gw = v / 1000
                           return `${gw % 1 === 0 ? gw.toFixed(0) : gw.toFixed(1)} ${gwUnit}`
                         }
                         return `${v} ${mwUnit}`
                       }}
                       axisLine={{ stroke: '#E5E7EB' }}
                       tickLine={false} />
                <RTooltip
                  cursor={{ fill: 'rgba(0,123,138,0.08)' }}
                  contentStyle={{ fontSize: 9, padding: '3px 6px', border: '1px solid #D8D3CB', background: '#FDFCFA', lineHeight: '11px', color: '#2A2A2A' }}
                  labelStyle={{ fontSize: 9, fontWeight: 600, color: '#0A1628', marginBottom: 1 }}
                  itemStyle={{ fontSize: 9, padding: 0, lineHeight: '11px' }}
                  formatter={(v: any, name: any) => {
                    const num = typeof v === 'number' ? v : 0
                    return [`${num.toLocaleString('en-US')} ${spec.unitLabel}`, String(name ?? '')]
                  }} />
                <Legend wrapperStyle={{ fontSize: 9.5, paddingTop: 2, lineHeight: '12px' }}
                        iconSize={8} iconType="square"
                        align="left" verticalAlign="bottom" />
                {seriesKeys.map((c, i) => (
                  <Bar key={c}
                       dataKey={c}
                       stackId="ret"
                       fill={RET_PALETTE[i % RET_PALETTE.length]}
                       isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-border px-2.5 py-1 text-[9.5px] text-ink-4 leading-snug">
          Triangular retirement · centred on median, ±2 years · 11%/22%/33%/22%/11% per year. Source: installation_history (BEIS REPD, EIA, IRENA, IEA-PVPS, BNEF). China excluded.
        </div>
      </div>
    </Panel>
  )
}

function WindRetirementPanel()  { return <RetirementPanel spec={RET_SPECS.wind}  className="col-start-1 row-start-1" /> }
function SolarRetirementPanel() { return <RetirementPanel spec={RET_SPECS.solar} className="col-start-1 row-start-2" /> }
function BessRetirementPanel()  { return <RetirementPanel spec={RET_SPECS.bess}  className="col-start-1 row-start-3" /> }

function FleetCohortsPanel() {
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [assetClass, setAssetClass] = useState<string>('all')

  useEffect(() => {
    supabase.from('assets')
      .select('id, asset_class, country_code, capacity_mw, commissioning_date')
      .not('commissioning_date', 'is', null)
      .order('commissioning_date', { ascending: true })
      .then(({ data }) => { setAssets((data as AssetRow[]) ?? []); setLoading(false) })
  }, [])

  const todayYear = new Date().getFullYear()

  const buckets = useMemo(() => {
    const map = new Map<string, CohortBucket>()
    for (const a of assets) {
      if (assetClass !== 'all' && a.asset_class !== assetClass) continue
      const year = extractYear(a.commissioning_date)
      if (!year) continue
      const dl = DESIGN_LIFE[a.asset_class] ?? 25
      const eolYear = year + dl
      const key = `${year}|${a.country_code}|${a.asset_class}`
      const existing = map.get(key)
      if (existing) {
        existing.capacity_mw += a.capacity_mw ?? 0
        existing.count++
      } else {
        map.set(key, {
          year, country: a.country_code, asset_class: a.asset_class,
          capacity_mw: a.capacity_mw ?? 0, count: 1,
          eol_year: eolYear, eol_flag: eolFlag(eolYear, todayYear),
        })
      }
    }
    return [...map.values()].sort((a, b) => a.year - b.year || a.country.localeCompare(b.country))
  }, [assets, assetClass, todayYear])

  const maxMW = useMemo(() => Math.max(...buckets.map(b => b.capacity_mw), 1), [buckets])
  const assetClasses = useMemo(() => ['all', ...new Set(assets.map(a => a.asset_class))], [assets])

  return (
    <Panel label="ARI" title="Fleet Cohorts" className="col-span-7"
           meta={
             <>
               <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
                 {assetClasses.map(cls => (
                   <button key={cls} onClick={() => setAssetClass(cls)}
                           className={clsx(
                             'px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm uppercase',
                             assetClass === cls ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                           )}>
                     {cls === 'all' ? 'All' : ASSET_CLASS_LABEL[cls] ?? cls}
                   </button>
                 ))}
               </div>
               <span className="text-[10.5px] text-ink-4 tabular-nums">{buckets.length}</span>
             </>
           }>
      <table className="w-full">
        <thead>
          <tr className="bg-titlebar border-b border-border sticky top-0 z-10">
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Year</th>
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Country</th>
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Class</th>
            <th className="px-2.5 py-1 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">MW</th>
            <th className="px-2.5 py-1 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Sites</th>
            <th className="px-2.5 py-1 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">EOL</th>
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide w-[18%]">Vol</th>
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Horizon</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={8} className="px-2.5 py-3 text-[12px] text-ink-3 text-center">Loading…</td></tr>
          ) : buckets.length === 0 ? (
            <tr><td colSpan={8} className="px-2.5 py-3 text-[12px] text-ink-3 text-center">No fleet data</td></tr>
          ) : buckets.map(b => {
            const barPct = Math.round((b.capacity_mw / maxMW) * 100)
            return (
              <tr key={`${b.year}|${b.country}|${b.asset_class}`} className="border-b border-border/70 hover:bg-raised">
                <td className="px-2.5 py-1 text-[12px] font-semibold text-ink tabular-nums">{b.year}</td>
                <td className="px-2.5 py-1 text-[11.5px] text-ink-2">{COUNTRY_LABEL[b.country] ?? b.country}</td>
                <td className="px-2.5 py-1">
                  <span className={clsx('text-[10px] font-bold px-1 py-px rounded-sm border tracking-wider', ASSET_CLASS_PILL[b.asset_class])}>
                    {ASSET_CLASS_LABEL[b.asset_class] ?? b.asset_class}
                  </span>
                </td>
                <td className="px-2.5 py-1 text-right text-[12px] tabular-nums text-ink font-semibold">
                  {b.capacity_mw.toLocaleString('en-GB', { maximumFractionDigits: 0 })}
                </td>
                <td className="px-2.5 py-1 text-right text-[11.5px] text-ink-3 tabular-nums">{b.count}</td>
                <td className="px-2.5 py-1 text-right text-[11.5px] text-ink-2 tabular-nums">{b.eol_year}</td>
                <td className="px-2.5 py-1">
                  <div className="h-1.5 bg-page rounded-sm overflow-hidden">
                    <div className={clsx('h-full', EOL_FLAG_BAR[b.eol_flag])} style={{ width: `${barPct}%` }} />
                  </div>
                </td>
                <td className="px-2.5 py-1">
                  <span className={clsx('text-[10px] font-bold px-1 py-px rounded-sm border tracking-wider', EOL_FLAG_PILL[b.eol_flag])}>
                    {b.eol_flag === 'past' ? 'Past' : b.eol_flag === 'near' ? '≤5y' : b.eol_flag === 'mid' ? '5-10y' : '>10y'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Panel>
  )
}

// ── 02 Retirement Waves panel ─────────────────────────────────────────────────

function RetirementWavesPanel() {
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('assets').select('asset_class, capacity_mw, commissioning_date')
      .not('commissioning_date', 'is', null)
      .then(({ data }) => { setAssets((data as AssetRow[]) ?? []); setLoading(false) })
  }, [])

  const todayYear = new Date().getFullYear()
  const waves = useMemo(() => {
    return [1, 3, 5, 10].map(h => {
      const cutoff = todayYear + h
      let total_mw = 0
      const by_class: Record<string, number> = {}
      for (const a of assets) {
        const year = extractYear(a.commissioning_date)
        if (!year || !a.capacity_mw) continue
        const eolYear = year + (DESIGN_LIFE[a.asset_class] ?? 25)
        if (eolYear <= cutoff) {
          total_mw += a.capacity_mw
          by_class[a.asset_class] = (by_class[a.asset_class] ?? 0) + a.capacity_mw
        }
      }
      return { label: h === 1 ? '+1Y' : `+${h}Y`, year: cutoff, total_mw, by_class }
    })
  }, [assets, todayYear])

  return (
    <Panel label="ARI" title="Retirement Waves" className="col-span-5"
           meta={<span className="text-[10.5px] text-ink-3">Cumulative MW @ EOL · 25y / 15y</span>}>
      {loading ? (
        <div className="px-3 py-6 text-[12px] text-ink-3 text-center">Loading…</div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 p-1.5">
          {waves.map(w => (
            <div key={w.label} className="bg-canvas border border-border rounded-sm p-2.5">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[12px] font-bold text-teal tracking-wide">{w.label}</span>
                <span className="text-[10.5px] text-ink-3 tabular-nums">{w.year}</span>
              </div>
              <div className="text-[18px] font-semibold text-ink tabular-nums leading-none mb-1.5">
                {w.total_mw > 0 ? fmtMW(w.total_mw) : <span className="text-ink-4">—</span>}
              </div>
              <div className="space-y-0.5">
                {Object.entries(w.by_class).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cls, mw]) => (
                  <div key={cls} className="flex items-center justify-between text-[11px]">
                    <span className="text-ink-3">{ASSET_CLASS_LABEL[cls] ?? cls}</span>
                    <span className="text-ink-2 tabular-nums">{fmtMW(mw)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

// ── 03 Installation Pipeline panel ────────────────────────────────────────────

function InstallationPipelinePanel() {
  const [rows, setRows] = useState<PipelineRow[]>([])
  const [loading, setLoading] = useState(true)
  const [country, setCountry] = useState<'GB' | 'US' | 'CA'>('GB')

  useEffect(() => {
    supabase.from('wind_pipeline_annual_installations')
      .select('country_code, sub_region, install_year, installed_gw')
      .eq('scope', 'onshore').order('install_year', { ascending: true })
      .then(({ data }) => { setRows((data as PipelineRow[]) ?? []); setLoading(false) })
  }, [])

  const filtered = rows.filter(r => r.country_code === country)
  const subRegions = Array.from(new Set(filtered.map(r => r.sub_region)))
  const total = filtered.reduce((s, r) => s + Number(r.installed_gw), 0)

  return (
    <Panel label="ARI" title="Installation Pipeline" className="col-span-6"
           meta={
             <>
               <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
                 {(['GB','US','CA'] as const).map(c => (
                   <button key={c} onClick={() => setCountry(c)}
                           className={clsx(
                             'px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm',
                             country === c ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                           )}>
                     {c}
                   </button>
                 ))}
               </div>
               <span className="text-[10.5px] text-ink-4 tabular-nums">{total.toFixed(1)} GW total</span>
             </>
           }>
      {loading ? (
        <div className="px-3 py-6 text-[12px] text-ink-3 text-center">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="px-3 py-6 text-[12px] text-ink-3 text-center">No pipeline data for {country}</div>
      ) : (
        <div className="p-2">
          {subRegions.length > 1 ? (
            <InstallStackedArea rows={filtered} regions={subRegions} />
          ) : (
            <DecomWaveBars installs={filtered.map(r => ({ install_year: r.install_year, installed_gw: Number(r.installed_gw) }))} />
          )}
        </div>
      )}
    </Panel>
  )
}

// ── 04 Asset Map panel ────────────────────────────────────────────────────────

function AssetMapPanel() {
  const [pins, setPins] = useState<AssetPin[]>([])
  const [metrics, setMetrics] = useState<{ country_code: string; value: number; label: string }[]>([])
  const [mode, setMode] = useState<'dots' | 'choropleth'>('dots')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('assets')
        .select('id, name, country_code, asset_class, capacity_mw, commissioning_date, latitude, longitude')
        .not('latitude', 'is', null).not('longitude', 'is', null).limit(2000),
      supabase.from('wind_pipeline_annual_installations')
        .select('country_code, install_year, installed_gw').eq('scope', 'onshore'),
    ]).then(([aRes, pRes]) => {
      const today = new Date().getFullYear()
      const assets = (aRes.data ?? []) as { id: string; name: string | null; country_code: string; asset_class: string; capacity_mw: number | null; commissioning_date: string | null; latitude: number | null; longitude: number | null }[]
      setPins(assets.map(a => {
        const yr = a.commissioning_date ? parseInt(a.commissioning_date.slice(0, 4)) : null
        const dl = DESIGN_LIFE[a.asset_class] ?? 25
        return {
          id: a.id, site_name: a.name, country_code: a.country_code,
          lat: Number(a.latitude), lon: Number(a.longitude),
          capacity_mw: a.capacity_mw, asset_class: a.asset_class,
          eol_year: yr ? yr + dl : null,
        }
      }))
      const byCountry = new Map<string, number>()
      for (const r of (pRes.data ?? []) as { country_code: string; install_year: number; installed_gw: number }[]) {
        const eol = r.install_year + 25
        if (eol >= today && eol <= today + 10) {
          byCountry.set(r.country_code, (byCountry.get(r.country_code) ?? 0) + Number(r.installed_gw))
        }
      }
      setMetrics(Array.from(byCountry.entries()).map(([cc, v]) => ({
        country_code: cc, value: v, label: `${v.toFixed(1)} GW EOL ≤ ${today + 10}`,
      })))
      setLoading(false)
    })
  }, [])

  return (
    <Panel label="ARI" title="Asset Map" className="col-span-6"
           meta={
             <>
               <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
                 <button onClick={() => setMode('dots')}
                         className={clsx('px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm',
                           mode === 'dots' ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink')}>
                   Pins
                 </button>
                 <button onClick={() => setMode('choropleth')}
                         className={clsx('px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm',
                           mode === 'choropleth' ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink')}>
                   Density
                 </button>
               </div>
               <span className="text-[10.5px] text-ink-4 tabular-nums">{pins.length}</span>
             </>
           }>
      {loading ? (
        <div className="px-3 py-6 text-[12px] text-ink-3 text-center">Loading…</div>
      ) : (
        <WorldAssetMap pins={pins} metrics={metrics} mode={mode} height={300} />
      )}
    </Panel>
  )
}

// ── 05 Retirement Intent feed panel ───────────────────────────────────────────

function RetirementIntentPanel() {
  const [events, setEvents] = useState<WatchEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<WatchEvent | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('watch_events')
      .select('id, headline, notes, event_type, scope, site_name, company_name, developer, capacity_mw, event_date, confidence, source_url, watch_sources(name, url)')
      .in('event_type', RETIREMENT_EVENT_TYPES)
      .eq('is_duplicate', false)
      .order('event_date', { ascending: false }).limit(40)
    setEvents((data as unknown as WatchEvent[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <Panel label="ARI" title="Retirement Intent" className="col-start-2 row-start-1"
           meta={<span className="text-[10.5px] text-ink-4 tabular-nums">{events.length} signals</span>}>
      <div className="flex h-full">
        <div className="flex-1 overflow-auto divide-y divide-border/70 min-w-0">
          {loading ? (
            <div className="px-3 py-4 text-[12px] text-ink-3 text-center">Loading…</div>
          ) : events.length === 0 ? (
            <div className="px-3 py-6 text-[12px] text-ink-3 text-center">No retirement signals yet</div>
          ) : events.map(ev => {
            const isSelected = selected?.id === ev.id
            const entity = ev.site_name || ev.company_name || ev.developer
            return (
              <div key={ev.id}
                   onClick={() => setSelected(s => s?.id === ev.id ? null : ev)}
                   className={clsx(
                     'px-2.5 py-1.5 cursor-pointer transition-colors border-l-2',
                     isSelected ? 'bg-active border-l-teal' : 'hover:bg-raised border-l-transparent',
                   )}>
                <div className="flex items-center gap-1.5 mb-0.5 text-[10.5px]">
                  <span className="text-ink-3 tabular-nums">{fmtDate(ev.event_date)}</span>
                  <span className="text-ink-4">·</span>
                  <span className="text-ink-3">{ev.event_type}</span>
                  <span className="text-ink-4">·</span>
                  <span className="text-ink-3">{SCOPE_LABEL[ev.scope] ?? ev.scope}</span>
                  <span className={clsx('ml-auto font-semibold', CONFIDENCE_STYLE[ev.confidence])}>
                    {ev.confidence}
                  </span>
                </div>
                <p className="text-[12px] text-ink leading-snug font-medium">{ev.headline}</p>
                {entity && (
                  <p className="text-[10.5px] text-ink-4 mt-0.5">
                    {[entity, ev.capacity_mw != null ? fmtMW(ev.capacity_mw) : null].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {selected && (
          <div className="w-56 flex-shrink-0 border-l border-border bg-canvas overflow-y-auto">
            <div className="px-2.5 py-1.5 border-b border-border flex items-center justify-between">
              <span className="text-[11px] font-semibold text-ink truncate">{selected.event_type}</span>
              <button onClick={() => setSelected(null)} className="text-ink-3 hover:text-ink text-[14px] leading-none">×</button>
            </div>
            <div className="p-2.5 space-y-2 text-[11.5px]">
              <p className="font-semibold text-ink leading-snug">{selected.headline}</p>
              {selected.notes && <p className="text-ink-2 leading-snug">{selected.notes}</p>}
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <div>
                  <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-wider">Region</div>
                  <div className="text-ink-2">{SCOPE_LABEL[selected.scope] ?? selected.scope}</div>
                </div>
                <div>
                  <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-wider">Capacity</div>
                  <div className="text-ink-2">{fmtMW(selected.capacity_mw)}</div>
                </div>
              </div>
              {(selected.source_url || selected.watch_sources) && (
                <a href={selected.source_url ?? selected.watch_sources?.url ?? ''}
                   target="_blank" rel="noreferrer"
                   className="flex items-center gap-1 text-teal hover:underline text-[11px]">
                  <ExternalLink size={10} /> {selected.watch_sources?.name ?? 'View source'}
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}

// ── 06 Japan Cohort panel ─────────────────────────────────────────────────────

const JAPAN_HORIZONS = [
  { period: '2025-2028', note: 'FIT expiry begins · early 25-yr cohorts' },
  { period: '2029-2031', note: '2004-2006 cohort reaches EOL' },
  { period: '2032-2035', note: 'Peak wave · TBC from METI' },
  { period: '2036-2040', note: 'Post-peak · pre-FIT fleet' },
]

function JapanCohortPanel() {
  const [events, setEvents] = useState<WatchEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('watch_events')
      .select('id, headline, event_type, event_date, confidence')
      .in('scope', ['JP']).eq('is_duplicate', false)
      .order('event_date', { ascending: false }).limit(8)
      .then(({ data }) => { setEvents((data as unknown as WatchEvent[]) ?? []); setLoading(false) })
  }, [])

  return (
    <Panel label="ARI" title="Japan Cohort · Post-FIT" className="col-span-4"
           meta={<span className="text-[10px] uppercase tracking-wider text-amber font-semibold">Optionality</span>}>
      <div className="p-2 space-y-2">
        <div className="bg-amber-50 border border-amber-200 rounded-sm px-2 py-1.5">
          <p className="text-[11px] text-amber-700 leading-snug">
            <strong>FIT expiry ≠ retirement.</strong> 20-yr contracts from 2012; expiry triggers operator decision: continue, repower, or decommission.
          </p>
        </div>

        <div className="border border-border rounded-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-titlebar border-b border-border">
                <th className="px-2 py-1 text-left text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Period</th>
                <th className="px-2 py-1 text-left text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Note</th>
              </tr>
            </thead>
            <tbody>
              {JAPAN_HORIZONS.map(r => (
                <tr key={r.period} className="border-b border-border/70">
                  <td className="px-2 py-1 text-[11.5px] text-ink font-semibold tabular-nums">{r.period}</td>
                  <td className="px-2 py-1 text-[11px] text-ink-3">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div className="label-xs mb-1">Live JP signals</div>
          <div className="border border-border rounded-sm">
            {loading ? (
              <div className="px-2 py-2 text-[11px] text-ink-3 text-center">Loading…</div>
            ) : events.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-ink-3 text-center">No JP signals yet</div>
            ) : events.map(ev => (
              <div key={ev.id} className="px-2 py-1 border-b border-border/70 last:border-0 hover:bg-raised">
                <div className="flex items-center gap-1 text-[10px] text-ink-3 mb-0.5">
                  <span className="tabular-nums">{fmtDate(ev.event_date)}</span>
                  <span className="text-ink-4">·</span>
                  <span>{ev.event_type}</span>
                </div>
                <p className="text-[11.5px] text-ink leading-snug line-clamp-2">{ev.headline}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  )
}

// ── 07 Repowering Pipeline panel ──────────────────────────────────────────────

const STAGE_ORDER: (RepoweringStage | 'all')[] = [
  'all', 'announced', 'application_submitted', 'application_approved', 'permitted', 'ongoing',
]

const STAGE_SHORT: Record<RepoweringStage | 'all', string> = {
  all: 'All', announced: 'Anno', application_submitted: 'Subm',
  application_approved: 'Appr', permitted: 'Perm', ongoing: 'Ong',
}

function RepoweringPipelinePanel() {
  const [stage, setStage] = useState<RepoweringStage | 'all'>('all')
  const [projects, setProjects] = useState<RepoweringProject[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    let q = supabase.from('repowering_projects')
      .select('*', { count: 'exact' })
      .is('completed_at', null)            // hide projects confirmed completed
      .order('stage_date', { ascending: false }).limit(40)
    if (stage !== 'all') q = q.eq('stage', stage)
    q.then(({ data, count }) => {
      setProjects(data ?? []); setTotal(count ?? 0); setLoading(false)
    })
  }, [stage])

  return (
    <Panel label="ARI" title="Repowering Pipeline" className="col-start-2 row-start-2"
           meta={
             <>
               <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
                 {STAGE_ORDER.map(s => (
                   <button key={s} onClick={() => setStage(s)}
                           className={clsx(
                             'px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm',
                             stage === s ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                           )}>
                     {STAGE_SHORT[s]}
                   </button>
                 ))}
               </div>
               <span className="text-[10.5px] text-ink-4 tabular-nums">{total.toLocaleString()}</span>
             </>
           }>
      <table className="w-full">
        <thead>
          <tr className="bg-titlebar border-b border-border sticky top-0 z-10">
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Project</th>
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Country</th>
            <th className="px-2.5 py-1 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">MW</th>
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Developer</th>
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Stage</th>
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Stage Date</th>
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Conf</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={7} className="px-2.5 py-3 text-[12px] text-ink-3 text-center">Loading…</td></tr>
          ) : projects.length === 0 ? (
            <tr><td colSpan={7} className="px-2.5 py-3 text-[12px] text-ink-3 text-center">No projects in this stage</td></tr>
          ) : projects.map(p => (
            <tr key={p.id} className="border-b border-border/70 hover:bg-raised">
              <td className="px-2.5 py-1 text-[12px] text-ink font-semibold max-w-[200px] truncate">{p.project_name}</td>
              <td className="px-2.5 py-1 text-[11.5px] text-ink-2">{COUNTRY_LABEL[p.country_code] ?? p.country_code}</td>
              <td className="px-2.5 py-1 text-right text-[12px] tabular-nums text-ink font-semibold">
                {p.capacity_mw != null ? p.capacity_mw.toLocaleString('en-GB', { maximumFractionDigits: 1 }) : '—'}
              </td>
              <td className="px-2.5 py-1 text-[11.5px] text-ink-2 max-w-[140px] truncate">{p.developer ?? '—'}</td>
              <td className="px-2.5 py-1">
                <span className={clsx('text-[10px] font-bold px-1 py-px rounded-sm border tracking-wider', STAGE_PILL[p.stage])}>
                  {STAGE_LABEL[p.stage]}
                </span>
              </td>
              <td className="px-2.5 py-1 text-[11px] text-ink-3 tabular-nums">{fmtDate(p.stage_date)}</td>
              <td className="px-2.5 py-1">
                <span className={clsx('text-[11px] font-semibold', CONFIDENCE_STYLE[p.confidence])}>{p.confidence}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

// ── 08 Stage Funnel panel ─────────────────────────────────────────────────────

function StageFunnelPanel() {
  // Pull all rows once with both stage + country, then derive both the
  // funnel counts and the country list client-side. Keeps it to a single
  // round-trip and lets the country filter be instant on click.
  const [rows, setRows] = useState<{ stage: RepoweringStage; country: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [country, setCountry] = useState<string>('ALL')

  useEffect(() => {
    supabase.from('repowering_projects').select('stage, country_code')
      .then(({ data }) => {
        setRows(((data ?? []) as { stage: RepoweringStage; country_code: string }[])
          .map(r => ({ stage: r.stage, country: r.country_code })))
        setLoading(false)
      })
  }, [])

  // Available countries sorted by row-count desc (most projects first)
  const availableCountries = useMemo(() => {
    const tally: Record<string, number> = {}
    for (const r of rows) tally[r.country] = (tally[r.country] ?? 0) + 1
    return Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .map(([cc]) => cc)
  }, [rows])

  // Filtered rows + per-stage counts
  const counts = useMemo(() => {
    const filtered = country === 'ALL' ? rows : rows.filter(r => r.country === country)
    const tally: Record<string, number> = {}
    for (const r of filtered) tally[r.stage] = (tally[r.stage] ?? 0) + 1
    const order: RepoweringStage[] = ['announced', 'application_submitted', 'application_approved', 'permitted', 'ongoing']
    return order.map(s => ({ stage: s, count: tally[s] ?? 0 }))
  }, [rows, country])

  const max   = Math.max(1, ...counts.map(c => c.count))
  const total = counts.reduce((s, c) => s + c.count, 0)

  return (
    <Panel label="ARI" title="Pipeline Funnel" className="col-start-2 row-start-3"
           meta={
             <div className="flex items-center gap-1.5">
               <select
                 value={country}
                 onChange={(e) => setCountry(e.target.value)}
                 className="bg-canvas border border-border rounded-sm px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-2 hover:text-ink cursor-pointer focus:outline-none focus:ring-1 focus:ring-teal"
                 title="Filter funnel by country"
               >
                 <option value="ALL">All countries</option>
                 {availableCountries.map(cc => (
                   <option key={cc} value={cc}>
                     {COUNTRY_LABEL[cc] ?? cc}
                   </option>
                 ))}
               </select>
               <span className="text-[10.5px] text-ink-4 tabular-nums">{total} total</span>
             </div>
           }>
      <div className="p-2.5 space-y-1.5">
        {loading ? (
          <div className="px-2 py-2 text-[12px] text-ink-3 text-center">Loading…</div>
        ) : total === 0 ? (
          <div className="px-2 py-2 text-[12px] text-ink-3 text-center">
            No projects in {COUNTRY_LABEL[country] ?? country}
          </div>
        ) : counts.map(c => (
          <div key={c.stage}>
            <div className="flex items-center justify-between text-[11px] mb-0.5">
              <span className={clsx('text-[10px] font-bold px-1 py-px rounded-sm border tracking-wider', STAGE_PILL[c.stage])}>
                {STAGE_LABEL[c.stage]}
              </span>
              <span className="text-[12px] font-semibold text-ink tabular-nums">{c.count}</span>
            </div>
            <div className="h-2 bg-page rounded-sm overflow-hidden">
              <div className="h-full bg-teal" style={{ width: `${(c.count / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function RetirementPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden bg-page">

      <div className="flex-shrink-0 h-9 px-3 border-b border-border bg-canvas flex items-center justify-between">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[13px] font-semibold text-ink uppercase tracking-wide">Asset Retirement Intelligence</h1>
          <span className="text-[11.5px] text-ink-3">Retirement pipeline · intent · repowering</span>
        </div>
        <div className="flex items-center gap-3 text-[10.5px] text-ink-3 flex-shrink-0 uppercase tracking-wide">
          <span>Coverage</span>
          <div className="flex items-center gap-1">
            {['EU', 'GB', 'US', 'CA'].map(s => (
              <span key={s} className="px-1.5 py-px bg-canvas border border-border rounded-sm text-ink-3 normal-case font-semibold">
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden p-1.5">
        <div className="h-full grid grid-cols-2 grid-rows-3 gap-1.5">
          <WindRetirementPanel />
          <SolarRetirementPanel />
          <BessRetirementPanel />
          <RetirementIntentPanel />
          <StageFunnelPanel />
          <RepoweringPipelinePanel />
        </div>
      </div>

    </div>
  )
}
