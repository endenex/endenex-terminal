// ── Asset Retirement Intelligence — Tab 03 ───────────────────────────────────
// 8 panels in a 12-col grid (no full-width content).
//   Row 1: Fleet Cohorts table (col-7) + Retirement Waves cards (col-5)
//   Row 2: Installation Pipeline chart (col-6) + Asset Map (col-6)
//   Row 3: Retirement Intent feed (col-8) + Japan Cohort (col-4)
//   Row 4: Repowering Pipeline (col-9) + Stage Funnel (col-3)

import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import { ExternalLink } from 'lucide-react'
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
    <Panel label="ARI" title="Retirement Intent" className="col-span-8"
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
      .select('*', { count: 'exact' }).order('stage_date', { ascending: false }).limit(40)
    if (stage !== 'all') q = q.eq('stage', stage)
    q.then(({ data, count }) => {
      setProjects(data ?? []); setTotal(count ?? 0); setLoading(false)
    })
  }, [stage])

  return (
    <Panel label="ARI" title="Repowering Pipeline" className="col-span-9"
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
  const [counts, setCounts] = useState<{ stage: RepoweringStage; count: number }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('repowering_projects').select('stage')
      .then(({ data }) => {
        const tally: Record<string, number> = {}
        for (const r of (data ?? []) as { stage: string }[]) {
          tally[r.stage] = (tally[r.stage] ?? 0) + 1
        }
        const order: RepoweringStage[] = ['announced', 'application_submitted', 'application_approved', 'permitted', 'ongoing']
        setCounts(order.map(s => ({ stage: s, count: tally[s] ?? 0 })))
        setLoading(false)
      })
  }, [])

  const max = Math.max(1, ...counts.map(c => c.count))

  return (
    <Panel label="ARI" title="Pipeline Funnel" className="col-span-3"
           meta={<span className="text-[10.5px] text-ink-4 tabular-nums">{counts.reduce((s, c) => s + c.count, 0)} total</span>}>
      <div className="p-2.5 space-y-1.5">
        {loading ? (
          <div className="px-2 py-2 text-[12px] text-ink-3 text-center">Loading…</div>
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
          <span className="text-[11.5px] text-ink-3">Cohorts · waves · pipeline · repowering · Japan</span>
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
        <div className="h-full grid grid-cols-12 grid-rows-4 gap-1.5">
          <FleetCohortsPanel />
          <RetirementWavesPanel />
          <InstallationPipelinePanel />
          <AssetMapPanel />
          <RetirementIntentPanel />
          <JapanCohortPanel />
          <RepoweringPipelinePanel />
          <StageFunnelPanel />
        </div>
      </div>

    </div>
  )
}
