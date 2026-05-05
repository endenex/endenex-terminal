// ── Asset Retirement Intelligence — Tab 03 ───────────────────────────────────
// Spec: Product Brief v1.0 §6.3
//
// Sub-tabs:
//   01 Fleet Cohorts       — vintage × country asset breakdown
//   02 Retirement Waves    — MW volume by EOL horizon (1/3/5/10 yr)
//   03 Retirement Intent   — curated decommissioning signals from Watch feed
//   04 Repowering Pipeline — stage-filtered project table (light theme)
//   05 Japan Cohort        — post-FIT decision wave (§6.3.1)

import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import { ExternalLink, ChevronDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTableSort } from '@/hooks/useTableSort'
import { SortableTh } from '@/components/ui/SortableHeader'
import type { RepoweringProject, RepoweringStage } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type SubTab = 'cohorts' | 'waves' | 'install_pipeline' | 'intent' | 'pipeline' | 'japan'

interface AssetRow {
  id:                  string
  asset_class:         string
  country_code:        string
  capacity_mw:         number | null
  commissioning_date:  string | null
  decommissioning_date: string | null
  site_name:           string | null
  operator:            string | null
}

interface CohortBucket {
  year:        number
  country:     string
  asset_class: string
  capacity_mw: number
  count:       number
  eol_year:    number     // commissioning_year + design_life
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
  liability_tags: string[]
  watch_sources: { name: string; url: string | null } | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'cohorts',         label: 'Fleet Cohorts' },
  { id: 'waves',           label: 'Retirement Waves' },
  { id: 'install_pipeline', label: 'Installation Pipeline' },
  { id: 'intent',          label: 'Retirement Intent' },
  { id: 'pipeline',        label: 'Repowering Pipeline' },
  { id: 'japan',           label: 'Japan Cohort' },
]

// Design life assumptions per asset class (years)
const DESIGN_LIFE: Record<string, number> = {
  onshore_wind:  25,
  offshore_wind: 25,
  solar_pv:      25,
  bess:          15,
}

const ASSET_CLASS_LABEL: Record<string, string> = {
  onshore_wind:  'Onshore Wind',
  offshore_wind: 'Offshore Wind',
  solar_pv:      'Solar PV',
  bess:          'BESS',
}

const ASSET_CLASS_COLOR: Record<string, string> = {
  onshore_wind:  'bg-teal-50 text-teal border-teal-200',
  offshore_wind: 'bg-blue-50 text-blue-700 border-blue-200',
  solar_pv:      'bg-amber-50 text-amber-700 border-amber-200',
  bess:          'bg-violet-50 text-violet-700 border-violet-200',
}

const COUNTRY_LABEL: Record<string, string> = {
  GB: 'UK', DE: 'Germany', US: 'United States', DK: 'Denmark',
  FR: 'France', ES: 'Spain', NL: 'Netherlands', SE: 'Sweden',
  IT: 'Italy', AU: 'Australia', JP: 'Japan', EU: 'EU', Global: 'Global',
}

// COUNTRY_LABEL is also used for scope display:
const SCOPE_LABEL = COUNTRY_LABEL

const STAGE_LABELS: Record<RepoweringStage | 'all', string> = {
  all:                    'All',
  announced:              'Announced',
  application_submitted:  'Application submitted',
  application_approved:   'Application approved',
  permitted:              'Permitted',
  ongoing:                'Ongoing',
}

const STAGE_ORDER: (RepoweringStage | 'all')[] = [
  'all', 'announced', 'application_submitted', 'application_approved', 'permitted', 'ongoing',
]

const STAGE_PILL: Record<RepoweringStage, string> = {
  announced:             'bg-sky-50 text-sky-700 border border-sky-200',
  application_submitted: 'bg-violet-50 text-violet-700 border border-violet-200',
  application_approved:  'bg-blue-50 text-blue-700 border border-blue-200',
  permitted:             'bg-teal-50 text-teal border border-teal-200',
  ongoing:               'bg-green-50 text-up border border-green-200',
}

const CONFIDENCE_STYLE: Record<string, string> = {
  High:   'text-up',
  Medium: 'text-highlight',
  Low:    'text-down',
}

const RETIREMENT_EVENT_TYPES = [
  'Decommissioning', 'End-of-life planning', 'Foundation removal',
  'Site restoration', 'Insolvency', 'FIT expiry', 'Post-FIT decision',
  'Japan cohort',
]

const COUNTRIES_PIPELINE = [
  { code: 'DE', label: 'Germany' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'US', label: 'United States' },
  { code: 'DK', label: 'Denmark' },
  { code: 'FR', label: 'France' },
  { code: 'ES', label: 'Spain' },
]

const PAGE_SIZE = 50

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try {
    return new Date(val).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch { return '—' }
}

function fmtMW(val: number | null | undefined): string {
  if (val == null) return '—'
  return val >= 1000
    ? `${(val / 1000).toFixed(1)} GW`
    : `${val.toLocaleString('en-GB', { maximumFractionDigits: 0 })} MW`
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

const EOL_FLAG_STYLE: Record<CohortBucket['eol_flag'], string> = {
  past: 'bg-down/10 text-down border-down/20',
  near: 'bg-red-50 text-red-700 border-red-200',
  mid:  'bg-amber-50 text-amber-700 border-amber-200',
  far:  'bg-page text-ink-3 border-border',
}

const EOL_FLAG_BAR: Record<CohortBucket['eol_flag'], string> = {
  past: 'bg-down',
  near: 'bg-red-400',
  mid:  'bg-highlight',
  far:  'bg-teal',
}

// ── Sub-tab nav ───────────────────────────────────────────────────────────────

function SubTabNav({
  active, onChange,
}: { active: SubTab; onChange: (t: SubTab) => void }) {
  return (
    <div className="flex-shrink-0 flex items-stretch border-b border-border bg-panel">
      <div className="flex items-stretch px-5 gap-0">
        {SUB_TABS.map((t, i) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={clsx(
              'relative px-4 py-3 text-[11.5px] font-medium border-b-2 transition-colors whitespace-nowrap',
              active === t.id
                ? 'border-teal text-teal'
                : 'border-transparent text-ink-3 hover:text-ink-2',
            )}
          >
            <span className="text-[9px] text-ink-4 mr-1.5">{String(i + 1).padStart(2, '0')}</span>
            {t.label}
          </button>
        ))}
      </div>
      {/* Coverage badges */}
      <div className="ml-auto flex items-center pr-5 gap-2">
        <span className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest">Coverage</span>
        {['EU', 'GB', 'US', 'JP'].map(s => (
          <span key={s} className="text-[9.5px] font-semibold px-1.5 py-px bg-page border border-border rounded text-ink-3">
            {s}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Country dropdown ──────────────────────────────────────────────────────────

function CountryDropdown({
  selected, onChange, countries,
}: {
  selected: string[]
  onChange: (codes: string[]) => void
  countries: { code: string; label: string }[]
}) {
  const [open, setOpen] = useState(false)

  const toggle = (code: string) =>
    onChange(selected.includes(code) ? selected.filter(c => c !== code) : [...selected, code])

  const label =
    selected.length === 0 ? 'All countries' :
    selected.length === 1 ? (countries.find(c => c.code === selected[0])?.label ?? selected[0]) :
    `${selected.length} countries`

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-medium bg-panel border border-border rounded hover:border-teal/40 text-ink-2 transition-colors min-w-[140px]"
      >
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown size={11} className="text-ink-4 flex-shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 left-0 z-20 bg-panel border border-border rounded shadow-panel-md min-w-[180px] py-1">
            {countries.map(({ code, label: cLabel }) => (
              <label key={code} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-page cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(code)}
                  onChange={() => toggle(code)}
                  className="accent-teal-500 w-3.5 h-3.5"
                />
                <span className="text-[11.5px] text-ink-2">{cLabel}</span>
                <span className="ml-auto text-[10px] text-ink-4">{code}</span>
              </label>
            ))}
            {selected.length > 0 && (
              <div className="border-t border-border mt-1 pt-1 px-3 pb-1">
                <button onClick={() => onChange([])} className="text-[11px] text-ink-3 hover:text-ink">
                  Clear
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── 01 Fleet Cohorts ──────────────────────────────────────────────────────────

function FleetCohorts() {
  const [assets,  setAssets]  = useState<AssetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [assetClass, setAssetClass] = useState<string>('all')

  useEffect(() => {
    setLoading(true)
    supabase
      .from('assets')
      .select('id, asset_class, country_code, capacity_mw, commissioning_date, decommissioning_date, site_name, operator')
      .not('commissioning_date', 'is', null)
      .order('commissioning_date', { ascending: true })
      .then(({ data }) => {
        setAssets((data as AssetRow[]) ?? [])
        setLoading(false)
      })
  }, [])

  const todayYear = new Date().getFullYear()

  // Build cohort buckets
  const buckets = useMemo(() => {
    const map = new Map<string, CohortBucket>()

    for (const a of assets) {
      if (assetClass !== 'all' && a.asset_class !== assetClass) continue
      const year = extractYear(a.commissioning_date)
      if (!year) continue

      const dl       = DESIGN_LIFE[a.asset_class] ?? 25
      const eolYear  = year + dl
      const flag     = eolFlag(eolYear, todayYear)
      const key      = `${year}|${a.country_code}|${a.asset_class}`

      const existing = map.get(key)
      if (existing) {
        existing.capacity_mw += a.capacity_mw ?? 0
        existing.count++
      } else {
        map.set(key, {
          year, country: a.country_code, asset_class: a.asset_class,
          capacity_mw: a.capacity_mw ?? 0, count: 1,
          eol_year: eolYear, eol_flag: flag,
        })
      }
    }

    return [...map.values()].sort((a, b) => a.year - b.year || a.country.localeCompare(b.country))
  }, [assets, assetClass, todayYear])

  const maxMW = useMemo(() => Math.max(...buckets.map(b => b.capacity_mw), 1), [buckets])

  const assetClasses = useMemo(
    () => ['all', ...new Set(assets.map(a => a.asset_class))],
    [assets],
  )

  if (loading) {
    return (
      <div className="flex-1 flex flex-col overflow-auto">
        <div className="px-5 py-3 border-b border-border bg-panel flex items-center gap-2 flex-shrink-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-7 w-20 bg-page rounded animate-pulse" />
          ))}
        </div>
        <div className="flex-1 overflow-auto divide-y divide-border">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="px-5 py-3 animate-pulse flex items-center gap-4">
              <div className="h-3 bg-page rounded w-12" />
              <div className="h-3 bg-page rounded w-16" />
              <div className="flex-1 h-3 bg-page rounded" />
              <div className="h-3 bg-page rounded w-20" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (assets.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
        <p className="text-[14px] font-semibold text-ink">No fleet data yet</p>
        <p className="text-[12px] text-ink-3 max-w-sm leading-relaxed">
          Asset records appear here once the assets table is populated. Run the
          asset ingestion pipeline to load commissioning dates.
        </p>
        <span className="text-[10px] font-semibold text-ink-4 uppercase tracking-widest bg-page border border-border px-3 py-1 rounded">
          Ingestion pending
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center gap-0 px-5 border-b border-border bg-panel flex-shrink-0">
        {assetClasses.map(cls => (
          <button
            key={cls}
            onClick={() => setAssetClass(cls)}
            className={clsx(
              'px-4 py-2.5 text-[11.5px] font-medium border-b-2 transition-colors capitalize',
              assetClass === cls
                ? 'border-teal text-teal'
                : 'border-transparent text-ink-3 hover:text-ink-2',
            )}
          >
            {cls === 'all' ? 'All classes' : (ASSET_CLASS_LABEL[cls] ?? cls)}
          </button>
        ))}
        <div className="ml-auto py-2 text-[11px] text-ink-4">
          {buckets.length} cohort buckets · design life 25 yr onshore / 15 yr BESS
        </div>
      </div>

      {/* Cohort list */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="border-b border-border bg-page text-left sticky top-0">
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Year</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Country</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Class</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider text-right">Cap. MW</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider text-right">Sites</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider text-right">EOL yr</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Volume</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Horizon</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {buckets.map(b => {
              const barPct = Math.round((b.capacity_mw / maxMW) * 100)
              return (
                <tr key={`${b.year}|${b.country}|${b.asset_class}`} className="hover:bg-page transition-colors">
                  <td className="px-5 py-2.5 font-semibold text-ink tabular-nums">{b.year}</td>
                  <td className="px-5 py-2.5 text-ink-2">
                    {COUNTRY_LABEL[b.country] ?? b.country}
                  </td>
                  <td className="px-5 py-2.5">
                    <span className={clsx(
                      'text-[9.5px] font-semibold px-1.5 py-px rounded border',
                      ASSET_CLASS_COLOR[b.asset_class] ?? 'bg-page text-ink-3 border-border',
                    )}>
                      {ASSET_CLASS_LABEL[b.asset_class] ?? b.asset_class}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-right font-semibold text-ink tabular-nums">
                    {b.capacity_mw.toLocaleString('en-GB', { maximumFractionDigits: 0 })}
                    <span className="text-[10px] text-ink-4 font-normal ml-0.5">MW</span>
                  </td>
                  <td className="px-5 py-2.5 text-right text-ink-3 tabular-nums">{b.count}</td>
                  <td className="px-5 py-2.5 text-right text-ink-2 tabular-nums">{b.eol_year}</td>
                  <td className="px-5 py-2.5">
                    <div className="w-24 h-2 bg-page rounded-full overflow-hidden">
                      <div
                        className={clsx('h-full rounded-full', EOL_FLAG_BAR[b.eol_flag])}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-5 py-2.5">
                    <span className={clsx(
                      'text-[9.5px] font-semibold px-1.5 py-px rounded border',
                      EOL_FLAG_STYLE[b.eol_flag],
                    )}>
                      {b.eol_flag === 'past' ? 'Past EOL' :
                       b.eol_flag === 'near' ? '≤5 yr' :
                       b.eol_flag === 'mid'  ? '5–10 yr' : '>10 yr'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 02 Retirement Waves ───────────────────────────────────────────────────────

interface WaveCard {
  label:    string
  horizonY: number
  total_mw: number
  by_class: Record<string, number>
}

function RetirementWaves() {
  const [assets,  setAssets]  = useState<AssetRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    supabase
      .from('assets')
      .select('asset_class, capacity_mw, commissioning_date, country_code')
      .not('commissioning_date', 'is', null)
      .then(({ data }) => {
        setAssets((data as AssetRow[]) ?? [])
        setLoading(false)
      })
  }, [])

  const todayYear = new Date().getFullYear()

  const waves = useMemo((): WaveCard[] => {
    const horizons = [1, 3, 5, 10]
    return horizons.map(h => {
      const cutoff   = todayYear + h
      let total_mw   = 0
      const by_class: Record<string, number> = {}

      for (const a of assets) {
        const year = extractYear(a.commissioning_date)
        if (!year || !a.capacity_mw) continue
        const dl      = DESIGN_LIFE[a.asset_class] ?? 25
        const eolYear = year + dl
        if (eolYear <= cutoff) {
          total_mw += a.capacity_mw
          by_class[a.asset_class] = (by_class[a.asset_class] ?? 0) + a.capacity_mw
        }
      }

      return {
        label:    h === 1 ? '12-month' : `${h}-year`,
        horizonY: cutoff,
        total_mw,
        by_class,
      }
    })
  }, [assets, todayYear])

  if (loading) {
    return (
      <div className="flex-1 flex items-start justify-center pt-12 gap-6 flex-wrap px-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="w-52 h-40 bg-page rounded-lg border border-border animate-pulse" />
        ))}
      </div>
    )
  }

  const hasData = waves.some(w => w.total_mw > 0)

  if (!hasData) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
        <p className="text-[14px] font-semibold text-ink">No asset data to project</p>
        <p className="text-[12px] text-ink-3 max-w-sm leading-relaxed">
          Retirement waves are derived from Fleet Cohorts. Populate the assets
          table with commissioning dates to see EOL volume projections.
        </p>
        <span className="text-[10px] font-semibold text-ink-4 uppercase tracking-widest bg-page border border-border px-3 py-1 rounded">
          Ingestion pending
        </span>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto px-8 py-8">
      {/* Info note */}
      <div className="mb-6 flex items-start gap-2 text-[11.5px] text-ink-3 bg-page border border-border rounded px-4 py-3 max-w-2xl">
        <span className="text-teal flex-shrink-0 mt-0.5">ⓘ</span>
        <span>
          Projections assume 25-year design life (onshore wind, offshore wind, solar PV) and
          15-year design life (BESS). Cumulative MW reaching EOL by each horizon date.
          Repowering decisions reduce the effective retirement volume.
        </span>
      </div>

      {/* 4 horizon cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 max-w-4xl">
        {waves.map(w => (
          <div key={w.label} className="bg-panel border border-border rounded-lg p-5 shadow-panel">
            <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-1">
              {w.label} horizon
            </div>
            <div className="text-[11px] text-ink-3 mb-3">by {w.horizonY}</div>
            <div className="text-[26px] font-semibold text-ink tabular-nums leading-none mb-3">
              {fmtMW(w.total_mw)}
            </div>
            <div className="space-y-1.5">
              {Object.entries(w.by_class)
                .sort((a, b) => b[1] - a[1])
                .map(([cls, mw]) => (
                  <div key={cls} className="flex items-center justify-between gap-2">
                    <span className="text-[10.5px] text-ink-3">
                      {ASSET_CLASS_LABEL[cls] ?? cls}
                    </span>
                    <span className="text-[10.5px] font-medium text-ink-2 tabular-nums">
                      {fmtMW(mw)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 03 Retirement Intent ──────────────────────────────────────────────────────

function RetirementIntent() {
  const [events,   setEvents]   = useState<WatchEvent[]>([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState<WatchEvent | null>(null)
  const [scope,    setScope]    = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('watch_events')
      .select('id, headline, notes, event_type, scope, site_name, company_name, developer, capacity_mw, event_date, confidence, source_url, liability_tags, watch_sources(name, url)')
      .in('event_type', RETIREMENT_EVENT_TYPES)
      .eq('is_duplicate', false)
      .order('event_date', { ascending: false })

    if (scope.length > 0) q = q.in('scope', scope)

    const { data } = await q
    setEvents((data as unknown as WatchEvent[]) ?? [])
    setLoading(false)
  }, [scope])

  useEffect(() => { load() }, [load])

  const AVAILABLE_SCOPES = ['GB', 'EU', 'DE', 'DK', 'FR', 'ES', 'NL', 'SE', 'US', 'JP', 'AU', 'Global']

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center gap-3 px-5 py-2 border-b border-border bg-panel flex-shrink-0">
        <span className="text-[11px] text-ink-3 font-medium">
          Curated signals: decommissioning · end-of-life · site restoration · insolvency
        </span>
        <div className="ml-auto flex items-center gap-2">
          {AVAILABLE_SCOPES.map(s => (
            <button
              key={s}
              onClick={() => setScope(prev =>
                prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
              )}
              className={clsx(
                'text-[10px] font-semibold px-1.5 py-0.5 rounded border transition-colors',
                scope.includes(s)
                  ? 'bg-teal text-white border-teal'
                  : 'bg-page border-border text-ink-3 hover:text-ink-2',
              )}
            >
              {s}
            </button>
          ))}
          {scope.length > 0 && (
            <button onClick={() => setScope([])} className="text-[10.5px] text-ink-4 hover:text-ink ml-1">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 overflow-auto divide-y divide-border">
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-5 py-4 animate-pulse space-y-2">
                <div className="h-3 bg-page rounded w-3/4" />
                <div className="h-3 bg-page rounded w-1/2" />
              </div>
            ))
          ) : events.length === 0 ? (
            <div className="px-5 py-12 text-center text-[12px] text-ink-3">
              No retirement signals found for the selected filters.
            </div>
          ) : events.map(ev => {
            const entity    = ev.site_name || ev.company_name || ev.developer
            const isSelected = selected?.id === ev.id
            return (
              <div
                key={ev.id}
                onClick={() => setSelected(s => s?.id === ev.id ? null : ev)}
                className={clsx(
                  'px-5 py-4 cursor-pointer transition-colors border-l-2',
                  isSelected
                    ? 'bg-active border-l-teal'
                    : 'hover:bg-page border-l-transparent',
                )}
              >
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-[10.5px] text-ink-3">{fmtDate(ev.event_date)}</span>
                  <span className="text-ink-4">·</span>
                  <span className="text-[11px] text-ink-3">{ev.event_type}</span>
                  <span className="text-ink-4">·</span>
                  <span className="text-[10.5px] font-medium text-ink-3">
                    {SCOPE_LABEL[ev.scope] ?? ev.scope}
                  </span>
                  <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                    <span className={clsx('text-[10.5px] font-semibold', CONFIDENCE_STYLE[ev.confidence])}>
                      {ev.confidence}
                    </span>
                    {ev.watch_sources?.name && (
                      <span className="text-[10.5px] text-ink-4 max-w-[140px] truncate">
                        {ev.watch_sources.name}
                      </span>
                    )}
                  </div>
                </div>
                <h3 className="text-[13px] font-semibold text-ink leading-snug mb-1.5">
                  {ev.headline}
                </h3>
                {ev.notes && (
                  <p className="text-[11.5px] text-ink-3 leading-relaxed line-clamp-2">{ev.notes}</p>
                )}
                {entity && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <div className="w-1 h-1 rounded-full bg-border flex-shrink-0" />
                    <span className="text-[10.5px] text-ink-4">
                      {[entity, ev.capacity_mw != null ? `${ev.capacity_mw} MW` : null].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Detail side panel */}
        {selected && (
          <div className="w-72 flex-shrink-0 border-l border-border bg-panel flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-[11px] font-semibold text-ink">{selected.event_type}</span>
              <button onClick={() => setSelected(null)} className="text-ink-3 hover:text-ink text-lg leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-[11.5px]">
              <p className="font-semibold text-ink leading-snug">{selected.headline}</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Region',     value: SCOPE_LABEL[selected.scope] ?? selected.scope },
                  { label: 'Date',       value: fmtDate(selected.event_date) },
                  { label: 'Confidence', value: selected.confidence, cls: CONFIDENCE_STYLE[selected.confidence] },
                  { label: 'Capacity',   value: fmtMW(selected.capacity_mw) },
                ].map(({ label, value, cls }) => (
                  <div key={label}>
                    <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-1">{label}</div>
                    <div className={clsx('font-medium text-ink-2', cls)}>{value}</div>
                  </div>
                ))}
              </div>
              {selected.notes && (
                <div>
                  <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-1">Notes</div>
                  <p className="text-ink-2 leading-relaxed">{selected.notes}</p>
                </div>
              )}
              {selected.watch_sources && (
                <div>
                  <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-1">Source</div>
                  <div className="text-ink-2">{selected.watch_sources.name}</div>
                  {(selected.source_url || selected.watch_sources.url) && (
                    <a
                      href={selected.source_url ?? selected.watch_sources.url ?? ''}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-teal hover:underline mt-1"
                    >
                      <ExternalLink size={10} /> View source
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 04 Repowering Pipeline ────────────────────────────────────────────────────

function RepoweringPipeline() {
  const [stage,     setStage]     = useState<RepoweringStage | 'all'>('all')
  const [countries, setCountries] = useState<string[]>([])
  const [projects,  setProjects]  = useState<RepoweringProject[]>([])
  const [total,     setTotal]     = useState(0)
  const [page,      setPage]      = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [selected,  setSelected]  = useState<RepoweringProject | null>(null)

  const fetchProjects = useCallback(async () => {
    setLoading(true)
    try {
      let q = supabase
        .from('repowering_projects')
        .select('*', { count: 'exact' })
        .order('stage_date', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

      if (stage !== 'all')      q = q.eq('stage', stage)
      if (countries.length > 0) q = q.in('country_code', countries)

      const { data, count } = await q
      setProjects(data ?? [])
      setTotal(count ?? 0)
    } finally {
      setLoading(false)
    }
  }, [stage, countries, page])

  useEffect(() => { setPage(0); setSelected(null) }, [stage, countries])
  useEffect(() => {
    fetchProjects()
    const id = setInterval(fetchProjects, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchProjects])

  type ProjKey = 'project_name' | 'country_code' | 'capacity_mw' | 'developer' | 'stage' | 'stage_date' | 'confidence'
  const { sorted, sort, toggle } = useTableSort<RepoweringProject, ProjKey>(
    projects,
    (row, key) => row[key] as string | number | null,
  )

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Stage filter tabs */}
      <div className="flex items-center gap-0 px-5 border-b border-border bg-panel flex-shrink-0">
        {STAGE_ORDER.map(s => (
          <button
            key={s}
            onClick={() => setStage(s)}
            className={clsx(
              'px-4 py-2.5 text-[11.5px] font-medium border-b-2 transition-colors whitespace-nowrap',
              stage === s
                ? 'border-teal text-teal'
                : 'border-transparent text-ink-3 hover:text-ink-2',
            )}
          >
            {STAGE_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Filter / count bar */}
      <div className="flex items-center gap-3 px-5 py-2 border-b border-border bg-panel flex-shrink-0">
        <CountryDropdown
          selected={countries}
          onChange={setCountries}
          countries={COUNTRIES_PIPELINE}
        />
        <div className="ml-auto text-[11px] text-ink-4">
          {loading ? '—' : `${total.toLocaleString()} project${total !== 1 ? 's' : ''}`}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="px-5 py-3 flex items-center gap-4 animate-pulse">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <div key={j} className="h-3 bg-page rounded w-20" />
                  ))}
                </div>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
              <p className="text-[13px] font-medium text-ink">No projects found</p>
              <p className="text-[11.5px] text-ink-3 max-w-xs">
                {stage !== 'all'
                  ? `No ${STAGE_LABELS[stage].toLowerCase()} projects in the selected markets.`
                  : 'No repowering projects in the selected filters.'}
              </p>
            </div>
          ) : (
            <>
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="border-b border-border bg-page text-left sticky top-0">
                    <SortableTh label="Project"   sortKey="project_name" sort={sort} onSort={toggle} className="text-left pl-5 py-2.5 pr-3" />
                    <SortableTh label="Country"   sortKey="country_code" sort={sort} onSort={toggle} className="text-left py-2.5 pr-3" />
                    <SortableTh label="Cap. MW"   sortKey="capacity_mw"  sort={sort} onSort={toggle} className="text-right py-2.5 pr-3" />
                    <SortableTh label="Developer" sortKey="developer"    sort={sort} onSort={toggle} className="text-left py-2.5 pr-3" />
                    <SortableTh label="Stage"     sortKey="stage"        sort={sort} onSort={toggle} className="text-left py-2.5 pr-3" />
                    <SortableTh label="Stage Date" sortKey="stage_date"  sort={sort} onSort={toggle} className="text-left py-2.5 pr-3" />
                    <SortableTh label="Confidence" sortKey="confidence"  sort={sort} onSort={toggle} className="text-left py-2.5 pr-5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sorted.map(p => (
                    <tr
                      key={p.id}
                      onClick={() => setSelected(s => s?.id === p.id ? null : p)}
                      className={clsx(
                        'cursor-pointer transition-colors border-l-2',
                        selected?.id === p.id
                          ? 'bg-active border-l-teal'
                          : 'hover:bg-page border-l-transparent',
                      )}
                    >
                      <td className="pl-5 py-3 pr-3 font-semibold text-ink max-w-[220px] truncate">
                        {p.project_name}
                      </td>
                      <td className="py-3 pr-3 text-ink-2">
                        {COUNTRIES_PIPELINE.find(c => c.code === p.country_code)?.label ?? p.country_code}
                      </td>
                      <td className="py-3 pr-3 text-right font-semibold text-ink tabular-nums">
                        {p.capacity_mw != null
                          ? <>{p.capacity_mw.toLocaleString('en-GB', { maximumFractionDigits: 1 })}<span className="text-[10px] text-ink-4 font-normal ml-0.5">MW</span></>
                          : <span className="text-ink-4">—</span>}
                      </td>
                      <td className="py-3 pr-3 text-ink-2 max-w-[160px] truncate">{p.developer ?? '—'}</td>
                      <td className="py-3 pr-3">
                        <span className={clsx(
                          'text-[9.5px] font-semibold px-1.5 py-px rounded',
                          STAGE_PILL[p.stage],
                        )}>
                          {STAGE_LABELS[p.stage]}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-ink-3 tabular-nums">{fmtDate(p.stage_date)}</td>
                      <td className="py-3 pr-5">
                        <span className={clsx('font-semibold', CONFIDENCE_STYLE[p.confidence])}>
                          {p.confidence}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-2.5 border-t border-border text-[11px] text-ink-3 bg-panel">
                  <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="px-3 py-1 border border-border rounded disabled:opacity-30 hover:text-ink"
                    >Prev</button>
                    <span>{page + 1} / {totalPages}</span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="px-3 py-1 border border-border rounded disabled:opacity-30 hover:text-ink"
                    >Next</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Project detail */}
        {selected && (
          <div className="w-72 flex-shrink-0 border-l border-border bg-panel flex flex-col overflow-hidden">
            <div className="flex items-start justify-between px-4 py-3 border-b border-border">
              <div className="flex-1 min-w-0 pr-3">
                <p className="text-[12px] font-semibold text-ink leading-snug">{selected.project_name}</p>
                <span className={clsx(
                  'text-[9.5px] font-semibold px-1.5 py-px rounded mt-1.5 inline-block',
                  STAGE_PILL[selected.stage],
                )}>
                  {STAGE_LABELS[selected.stage]}
                </span>
              </div>
              <button onClick={() => setSelected(null)} className="text-ink-3 hover:text-ink text-lg leading-none flex-shrink-0">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-[11.5px]">
              {[
                ['Country',    COUNTRIES_PIPELINE.find(c => c.code === selected.country_code)?.label ?? selected.country_code],
                ['Capacity',   fmtMW(selected.capacity_mw)],
                ['Developer',  selected.developer ?? '—'],
                ['Operator',   selected.operator ?? '—'],
                ['Stage date', fmtDate(selected.stage_date)],
                ['Confidence', selected.confidence],
                ['Turbine',    selected.turbine_make && selected.turbine_model ? `${selected.turbine_make} ${selected.turbine_model}` : selected.turbine_model ?? selected.turbine_make ?? '—'],
                ['Source',     selected.source_type ?? '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <span className="text-ink-3 flex-shrink-0">{label}</span>
                  <span className={clsx(
                    'font-medium text-ink-2 text-right',
                    label === 'Confidence' ? CONFIDENCE_STYLE[value] : '',
                  )}>{value}</span>
                </div>
              ))}
              {selected.notes && (
                <div className="border-t border-border pt-3">
                  <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-1">Notes</div>
                  <p className="text-ink-2 leading-relaxed">{selected.notes}</p>
                </div>
              )}
              {selected.source_url && (
                <a
                  href={selected.source_url}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-teal hover:underline"
                >
                  <ExternalLink size={10} /> View source
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 05 Japan Cohort ───────────────────────────────────────────────────────────

const JAPAN_HORIZON_ROWS = [
  { period: '2025–2028', mw: null, sites: null, note: 'FIT expiry wave starts — early 25-year cohorts' },
  { period: '2029–2031', mw: null, sites: null, note: 'Mid-wave: largest 2004–2006 cohort reaches EOL' },
  { period: '2032–2035', mw: null, sites: null, note: 'Peak wave — estimated volume TBC from METI registry' },
  { period: '2036–2040', mw: null, sites: null, note: 'Post-peak: newer pre-FIT fleet approaches EOL' },
]

const JAPAN_SOURCES = [
  { name: 'METI FIT Registry', tier: 'Official', description: 'Mandatory capacity and commissioning data for all FIT-registered plants.' },
  { name: 'Japan Wind Power Association', tier: 'Trade body', description: 'JWPA publishes annual capacity surveys and cohort breakdowns.' },
  { name: 'Renewable Energy Institute Japan', tier: 'Research', description: 'EOL policy analysis and post-FIT scenario modelling.' },
  { name: 'Market Watch — Japan signals', tier: 'In-app', description: 'METI disclosures, Post-FIT decisions, and Japan cohort events from the Watch feed.' },
]

function JapanCohort() {
  const [events,  setEvents]  = useState<WatchEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('watch_events')
      .select('id, headline, notes, event_type, scope, site_name, company_name, developer, capacity_mw, event_date, confidence, source_url, liability_tags, watch_sources(name, url)')
      .in('scope', ['JP'])
      .eq('is_duplicate', false)
      .order('event_date', { ascending: false })
      .limit(25)
      .then(({ data }) => {
        setEvents((data as unknown as WatchEvent[]) ?? [])
        setLoading(false)
      })
  }, [])

  return (
    <div className="flex-1 overflow-auto px-8 py-6">
      {/* Framing box — brief §6.3.1 */}
      <div className="max-w-2xl mb-6 bg-amber-50 border border-amber-200 rounded-lg px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="text-amber-600 text-[18px] flex-shrink-0 mt-0.5">⚠</span>
          <div>
            <p className="text-[12px] font-semibold text-amber-800 mb-1">
              Japan: FIT expiry wave — not a retirement wave
            </p>
            <p className="text-[11.5px] text-amber-700 leading-relaxed">
              Japan's wind fleet was largely commissioned under the 2012 FIT scheme with
              20-year contracts. As these expire from ~2030, operators face a <em>post-FIT decision</em>:
              continue at merchant rate, repower, or decommission. Unlike European markets,
              Japan's cohort risk is a <strong>policy-driven decision point</strong>, not
              purely an asset-life signal. Model as optionality, not liability.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Horizon table */}
        <div>
          <h3 className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest mb-3">
            Volume horizon (indicative)
          </h3>
          <div className="bg-panel border border-border rounded-lg overflow-hidden">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="border-b border-border bg-page">
                  <th className="px-4 py-2.5 text-left font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Period</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Est. MW</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {JAPAN_HORIZON_ROWS.map(row => (
                  <tr key={row.period} className="hover:bg-page transition-colors">
                    <td className="px-4 py-3 font-semibold text-ink tabular-nums">{row.period}</td>
                    <td className="px-4 py-3 text-right text-ink-3 tabular-nums">
                      {row.mw != null ? fmtMW(row.mw) : <span className="text-ink-4">TBC</span>}
                    </td>
                    <td className="px-4 py-3 text-ink-3 text-[11px]">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2.5 border-t border-border bg-page text-[10px] text-ink-4">
              Volume estimates pending METI registry ingestion. TBC = to be confirmed.
            </div>
          </div>
        </div>

        {/* Data sources */}
        <div>
          <h3 className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest mb-3">
            Data sources
          </h3>
          <div className="space-y-2">
            {JAPAN_SOURCES.map(s => (
              <div key={s.name} className="bg-panel border border-border rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11.5px] font-semibold text-ink">{s.name}</span>
                  <span className="text-[9.5px] font-semibold px-1.5 py-px bg-page border border-border rounded text-ink-3 ml-auto">
                    {s.tier}
                  </span>
                </div>
                <p className="text-[11px] text-ink-3 leading-relaxed">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Live Japan signals */}
      <div className="max-w-4xl mt-8">
        <h3 className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest mb-3">
          Live Japan signals from Watch
        </h3>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 bg-page rounded border border-border animate-pulse" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="bg-panel border border-border rounded-lg px-4 py-6 text-center text-[12px] text-ink-3">
            No Japan signals in the Watch feed yet. Run sync_airtable_watch.py to populate.
          </div>
        ) : (
          <div className="bg-panel border border-border rounded-lg divide-y divide-border">
            {events.map(ev => (
              <div key={ev.id} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10.5px] text-ink-3">{fmtDate(ev.event_date)}</span>
                  <span className="text-ink-4">·</span>
                  <span className="text-[11px] text-ink-3">{ev.event_type}</span>
                  <div className="ml-auto">
                    <span className={clsx('text-[10.5px] font-semibold', CONFIDENCE_STYLE[ev.confidence])}>
                      {ev.confidence}
                    </span>
                  </div>
                </div>
                <p className="text-[12px] font-semibold text-ink leading-snug">
                  {ev.headline}
                </p>
                {ev.notes && (
                  <p className="text-[11px] text-ink-3 mt-1 line-clamp-2">{ev.notes}</p>
                )}
                {ev.source_url && (
                  <a href={ev.source_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10.5px] text-teal hover:underline mt-1.5">
                    <ExternalLink size={9} /> View source
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

// ── 03 Installation Pipeline (wind_pipeline_annual_installations) ────────────

interface PipelineRow {
  country_code:  string
  sub_region:    string
  install_year:  number
  installed_gw:  number
}

function InstallationPipeline() {
  const [rows, setRows]       = useState<PipelineRow[]>([])
  const [loading, setLoading] = useState(true)
  const [country, setCountry] = useState<'GB' | 'US' | 'CA' | 'ALL'>('GB')

  useEffect(() => {
    setLoading(true)
    supabase
      .from('wind_pipeline_annual_installations')
      .select('country_code, sub_region, install_year, installed_gw')
      .eq('scope', 'onshore')
      .order('install_year', { ascending: true })
      .then(({ data }) => {
        setRows((data as PipelineRow[]) ?? [])
        setLoading(false)
      })
  }, [])

  // Filter by country
  const filtered = country === 'ALL' ? rows : rows.filter(r => r.country_code === country)

  // Aggregate by year (sum sub-regions)
  const byYear: Map<number, number> = new Map()
  for (const r of filtered) {
    byYear.set(r.install_year, (byYear.get(r.install_year) ?? 0) + Number(r.installed_gw))
  }
  const years = Array.from(byYear.keys()).sort((a, b) => a - b)
  const total = Array.from(byYear.values()).reduce((s, v) => s + v, 0)

  // Project decommissioning waves: install year + 25 yr design life
  const todayYear = new Date().getFullYear()
  const decomWaves = [10, 15, 20].map(h => {
    const cutoff = todayYear + h
    const eolGw = years
      .filter(y => y + 25 <= cutoff && y + 25 >= todayYear)
      .reduce((s, y) => s + (byYear.get(y) ?? 0), 0)
    return { horizon: h, cutoff, eolGw }
  })

  // Sub-region split (latest 5 years)
  const subRegions = country === 'ALL' ? new Map<string, number>() : (() => {
    const map = new Map<string, number>()
    for (const r of filtered) {
      map.set(r.sub_region, (map.get(r.sub_region) ?? 0) + Number(r.installed_gw))
    }
    return map
  })()

  // Find peak year
  const peakYear = years.reduce((peak, y) => (byYear.get(y) ?? 0) > (byYear.get(peak) ?? 0) ? y : peak, years[0])
  const peakGw = peakYear ? byYear.get(peakYear) ?? 0 : 0

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[12px] text-ink-3">Loading wind pipeline data…</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto p-5 space-y-5">

      {/* Header + country selector */}
      <div className="flex items-center gap-4">
        <div>
          <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Onshore Wind Installations</p>
          <p className="text-[12px] text-ink-3">Annual GW installed by region · 2000–2025 · drives 25-yr forward decommissioning waves</p>
        </div>
        <div className="ml-auto flex items-center gap-1 bg-panel border border-border rounded p-0.5">
          {(['GB','US','CA','ALL'] as const).map(c => (
            <button key={c} onClick={() => setCountry(c)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors ${country === c ? 'bg-teal text-white' : 'text-ink-3 hover:text-ink'}`}>
              {c === 'ALL' ? 'All' : c}
            </button>
          ))}
        </div>
      </div>

      {/* Headline cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-panel border border-border rounded-lg p-4">
          <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Total cohort 2000–2025</p>
          <p className="text-[22px] font-semibold text-ink tabular-nums mt-1">{total.toFixed(1)} GW</p>
          <p className="text-[10px] text-ink-4 mt-0.5">{country === 'ALL' ? 'Across UK, US, CA' : `${country} only`}</p>
        </div>
        <div className="bg-panel border border-border rounded-lg p-4">
          <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Peak install year</p>
          <p className="text-[22px] font-semibold text-ink tabular-nums mt-1">{peakYear ?? '—'}</p>
          <p className="text-[10px] text-ink-4 mt-0.5">{peakGw.toFixed(2)} GW added</p>
        </div>
        <div className="bg-panel border border-border rounded-lg p-4">
          <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Forward decommissioning</p>
          <div className="flex items-baseline gap-3 mt-1">
            {decomWaves.map(w => (
              <div key={w.horizon}>
                <p className="text-[14px] font-semibold text-ink tabular-nums">{w.eolGw.toFixed(1)}</p>
                <p className="text-[9px] text-ink-4">by {w.cutoff}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-ink-4 mt-1">GW reaching EOL @ 25yr life</p>
        </div>
      </div>

      {/* Sparkline-ish table — installations by year */}
      <div className="bg-panel border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <p className="text-[11px] font-semibold text-ink-2">Annual installations · {country === 'ALL' ? 'all regions' : country}</p>
          <p className="text-[10px] text-ink-3">{years.length} years · max {Math.max(...Array.from(byYear.values())).toFixed(2)} GW</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border bg-page">
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Year</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">GW</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase w-2/3">Distribution</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">EOL year</th>
              </tr>
            </thead>
            <tbody>
              {years.map((y, i) => {
                const gw = byYear.get(y) ?? 0
                const maxGw = Math.max(...Array.from(byYear.values()))
                const pct = (gw / maxGw) * 100
                const eol = y + 25
                const eolColor = eol < todayYear ? 'text-down'
                              : eol <= todayYear + 5 ? 'text-highlight'
                              : 'text-ink-3'
                return (
                  <tr key={y} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                    <td className="px-3 py-1.5 text-ink-2 tabular-nums">{y}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-ink font-semibold">{gw.toFixed(2)}</td>
                    <td className="px-3 py-1.5">
                      <div className="h-2 bg-page rounded-sm overflow-hidden">
                        <div className="h-full bg-teal" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${eolColor}`}>{eol}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sub-region split (when single country selected) */}
      {country !== 'ALL' && subRegions.size > 1 && (
        <div className="bg-panel border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[11px] font-semibold text-ink-2">{country} cohort by sub-region (2000–2025)</p>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border bg-page">
                <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Sub-region</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">Total GW</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">% of {country}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(subRegions.entries()).sort((a, b) => b[1] - a[1]).map(([sr, gw], i) => (
                <tr key={sr} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                  <td className="px-4 py-2 text-ink font-semibold">{sr}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-2">{gw.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-3">{((gw / total) * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-ink-4">
        Sources: BEIS/DESNZ REPD, DUKES, WindEurope (UK); EIA Form 860, AWEA/ACP, GWEC (US); CanWEA, NRCan (Canada).
        Decommissioning projection assumes 25-year design life, no repowering. Actual EOL dates shift with repowering decisions.
      </p>
    </div>
  )
}

export function RetirementPage() {
  const [subTab, setSubTab] = useState<SubTab>('cohorts')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SubTabNav active={subTab} onChange={setSubTab} />

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {subTab === 'cohorts'          && <FleetCohorts />}
        {subTab === 'waves'            && <RetirementWaves />}
        {subTab === 'install_pipeline' && <InstallationPipeline />}
        {subTab === 'intent'           && <RetirementIntent />}
        {subTab === 'pipeline'         && <RepoweringPipeline />}
        {subTab === 'japan'            && <JapanCohort />}
      </div>
    </div>
  )
}
