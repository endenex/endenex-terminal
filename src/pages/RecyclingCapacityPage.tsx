// ── Processing Capacity Monitor — Tab 05 ─────────────────────────────────────
// 5 panels in a 12-col grid (no full-width content):
//   Row 1: Composite Blades stats (col-6) + Pathway gate-fee bars (col-6)
//   Row 2: Gate Fees table (col-6) + Landfill Tracker (col-6)
//   Row 3: Capacity Signals feed (col-8) + Recycling Pathway summary (col-4)

import { useState, useEffect } from 'react'
import { clsx } from 'clsx'
import { ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BladePathwayBars } from '@/components/charts/BladePathwayBars'

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

interface GateFeeRow {
  pathway: string; region: string; low: string; high: string; unit: string; source: string
}

const GATE_FEE_TABLE: GateFeeRow[] = [
  { pathway: 'Cement',     region: 'EU', low: '€130', high: '€200', unit: '/t', source: 'WindEurope' },
  { pathway: 'Cement',     region: 'UK', low: '£120', high: '£180', unit: '/t', source: 'Industry' },
  { pathway: 'Mechanical', region: 'EU', low: '€80',  high: '€150', unit: '/t', source: 'Industry' },
  { pathway: 'Mechanical', region: 'US', low: '$75',  high: '$130', unit: '/t', source: 'GFS' },
  { pathway: 'Pyrolysis',  region: 'EU', low: '€200', high: '€400', unit: '/t', source: 'Pilot' },
  { pathway: 'Landfill',   region: 'US', low: '$50',  high: '$120', unit: '/t', source: 'State surveys' },
]

const LANDFILL_BAN_TABLE = [
  { jur: 'EU27',         status: 'Banned',     date: '2025',           scope: 'All composite/GRP blade waste' },
  { jur: 'Germany',      status: 'Banned',     date: '2021',           scope: 'Preceded EU directive' },
  { jur: 'France',       status: 'Banned',     date: '2022',           scope: 'Hazardous classification' },
  { jur: 'Netherlands',  status: 'Banned',     date: '2023',           scope: 'Strict GRP ban' },
  { jur: 'UK',           status: 'Restricted', date: 'No formal ban',  scope: 'High gate fees; under review' },
  { jur: 'Illinois',     status: 'Banned',     date: '2024',           scope: 'First US state ban' },
  { jur: 'Colorado',     status: 'Banned',     date: '2023',           scope: 'Composite blade ban' },
  { jur: 'US (federal)', status: 'Permitted',  date: '—',              scope: 'State-level bans only' },
]

const STATUS_STYLE: Record<string, string> = {
  Banned:     'bg-red-50 text-red-700 border-red-200',
  Restricted: 'bg-amber-50 text-amber-700 border-amber-200',
  Permitted:  'bg-canvas text-ink-3 border-border',
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

// ── 01 Composite Blades stats panel ───────────────────────────────────────────

function CompositeBladesPanel() {
  return (
    <Panel label="PCM" title="GRP Blade Waste · Global EOL Wave" className="col-span-6">
      <div className="p-3 space-y-3">
        {/* Hero numbers */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-canvas border border-border rounded-sm p-2">
            <div className="text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold">EU 2030/yr</div>
            <div className="text-[20px] font-semibold text-ink tabular-nums leading-none mt-1">~43</div>
            <div className="text-[10.5px] text-ink-4 mt-1">kt GRP/yr</div>
          </div>
          <div className="bg-canvas border border-border rounded-sm p-2">
            <div className="text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold">EU thru 2025</div>
            <div className="text-[20px] font-semibold text-ink tabular-nums leading-none mt-1">~220</div>
            <div className="text-[10.5px] text-ink-4 mt-1">kt cumulative</div>
          </div>
          <div className="bg-canvas border border-border rounded-sm p-2">
            <div className="text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold">Per blade</div>
            <div className="text-[20px] font-semibold text-ink tabular-nums leading-none mt-1">14</div>
            <div className="text-[10.5px] text-ink-4 mt-1">t (2 MW onshore)</div>
          </div>
        </div>

        {/* By-region table */}
        <div className="border border-border rounded-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-titlebar border-b border-border">
                <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Region</th>
                <th className="px-2.5 py-1 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Blades</th>
                <th className="px-2.5 py-1 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">GRP kt</th>
                <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Horizon</th>
              </tr>
            </thead>
            <tbody>
              {BLADE_REGIONS.map(r => (
                <tr key={r.region} className="border-b border-border/70 hover:bg-raised">
                  <td className="px-2.5 py-1 text-[12px] text-ink font-semibold">{r.label}</td>
                  <td className="px-2.5 py-1 text-right text-[12px] tabular-nums text-ink-2">{r.blade_count}</td>
                  <td className="px-2.5 py-1 text-right text-[12px] tabular-nums text-ink-2">{r.grp_kt}</td>
                  <td className="px-2.5 py-1 text-[11.5px] text-ink-3">{r.horizon}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[10.5px] text-ink-4">Source: IRENA (2023) · WindEurope · MAKE Consulting</div>
      </div>
    </Panel>
  )
}

// ── 02 Pathway gate-fee chart panel ───────────────────────────────────────────

function PathwayChartPanel() {
  const [pathwayRows, setPathwayRows] = useState<{ pathway: string; region: string; eur_per_tonne: number; basis: string | null }[]>([])
  const [region, setRegion] = useState<'EU'|'GB'|'US'>('EU')

  useEffect(() => {
    supabase.from('blade_gate_fees').select('pathway, region, eur_per_tonne, basis')
      .then(({ data }) => setPathwayRows(((data ?? []) as { pathway: string; region: string; eur_per_tonne: number; basis: string | null }[])))
  }, [])

  return (
    <Panel label="PCM" title="Pathway Gate Fees" className="col-span-6"
           meta={
             <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
               {(['EU','GB','US'] as const).map(r => (
                 <button key={r} onClick={() => setRegion(r)}
                         className={clsx(
                           'px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm',
                           region === r ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                         )}>
                   {r}
                 </button>
               ))}
             </div>
           }>
      <div className="p-2">
        <BladePathwayBars rows={pathwayRows} region={region} />
      </div>
    </Panel>
  )
}

// ── 03 Gate Fees table panel ──────────────────────────────────────────────────

function GateFeesTablePanel() {
  return (
    <Panel label="PCM" title="Gate Fees by Pathway" className="col-span-6"
           meta={<span className="text-[10.5px] text-ink-3">Indicative · quarterly refresh</span>}>
      <table className="w-full">
        <thead>
          <tr className="bg-titlebar border-b border-border sticky top-0 z-10">
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Pathway</th>
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Region</th>
            <th className="px-2.5 py-1 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Low</th>
            <th className="px-2.5 py-1 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">High</th>
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Source</th>
          </tr>
        </thead>
        <tbody>
          {GATE_FEE_TABLE.map((r, i) => (
            <tr key={i} className="border-b border-border/70 hover:bg-raised">
              <td className="px-2.5 py-1 text-[12px] text-ink font-medium">{r.pathway}</td>
              <td className="px-2.5 py-1 text-[12px] text-ink-2">{r.region}</td>
              <td className="px-2.5 py-1 text-right text-[12px] text-down font-semibold tabular-nums">
                {r.low}<span className="text-[10.5px] text-ink-4 font-normal">{r.unit}</span>
              </td>
              <td className="px-2.5 py-1 text-right text-[12px] text-down font-semibold tabular-nums">
                {r.high}<span className="text-[10.5px] text-ink-4 font-normal">{r.unit}</span>
              </td>
              <td className="px-2.5 py-1 text-[11.5px] text-ink-4">{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

// ── 04 Landfill Ban Tracker panel ─────────────────────────────────────────────

function LandfillTrackerPanel() {
  return (
    <Panel label="PCM" title="Landfill Ban Tracker" className="col-span-6">
      <table className="w-full">
        <thead>
          <tr className="bg-titlebar border-b border-border sticky top-0 z-10">
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Jurisdiction</th>
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Status</th>
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Eff.</th>
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Scope</th>
          </tr>
        </thead>
        <tbody>
          {LANDFILL_BAN_TABLE.map(r => (
            <tr key={r.jur} className="border-b border-border/70 hover:bg-raised">
              <td className="px-2.5 py-1 text-[12px] text-ink font-semibold">{r.jur}</td>
              <td className="px-2.5 py-1">
                <span className={clsx('text-[10px] font-bold px-1 py-px rounded-sm border tracking-wider', STATUS_STYLE[r.status])}>
                  {r.status}
                </span>
              </td>
              <td className="px-2.5 py-1 text-[11.5px] text-ink-3 tabular-nums">{r.date}</td>
              <td className="px-2.5 py-1 text-[11.5px] text-ink-3">{r.scope}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

// ── 05 Capacity Signals panel ─────────────────────────────────────────────────

function CapacitySignalsPanel() {
  const [events, setEvents]   = useState<WatchEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<WatchEvent | null>(null)

  useEffect(() => {
    supabase.from('watch_events')
      .select('id, headline, notes, event_type, scope, company_name, capacity_mw, event_date, confidence, source_url, watch_sources(name, url)')
      .eq('category', 'supply_chain').eq('is_duplicate', false)
      .order('event_date', { ascending: false })
      .then(({ data }) => { setEvents((data as unknown as WatchEvent[]) ?? []); setLoading(false) })
  }, [])

  return (
    <Panel label="PCM" title="Capacity Signals" className="col-span-8"
           meta={<span className="text-[10.5px] text-ink-4 tabular-nums">{events.length}</span>}>
      <div className="flex h-full">
        <div className="flex-1 overflow-auto divide-y divide-border/70 min-w-0">
          {loading ? (
            <div className="px-3 py-4 text-[12px] text-ink-3 text-center">Loading…</div>
          ) : events.length === 0 ? (
            <div className="px-3 py-6 text-[12px] text-ink-3 text-center">No supply-chain signals yet</div>
          ) : events.map(ev => {
            const isSelected = selected?.id === ev.id
            return (
              <div
                key={ev.id}
                onClick={() => setSelected(s => s?.id === ev.id ? null : ev)}
                className={clsx(
                  'px-2.5 py-1.5 cursor-pointer transition-colors border-l-2',
                  isSelected ? 'bg-active border-l-teal' : 'hover:bg-raised border-l-transparent',
                )}
              >
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
                {ev.company_name && (
                  <p className="text-[10.5px] text-ink-4 mt-0.5">
                    {[ev.company_name, ev.capacity_mw != null ? `${ev.capacity_mw} MW` : null].filter(Boolean).join(' · ')}
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
                  <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-wider">Date</div>
                  <div className="text-ink-2">{fmtDate(selected.event_date)}</div>
                </div>
                {selected.company_name && (
                  <div className="col-span-2">
                    <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-wider">Company</div>
                    <div className="text-ink-2">{selected.company_name}</div>
                  </div>
                )}
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

// ── 06 Pathway summary panel ──────────────────────────────────────────────────

function PathwaySummaryPanel() {
  return (
    <Panel label="PCM" title="Recycling Pathways" className="col-span-4">
      <div className="divide-y divide-border/70">
        {PATHWAYS.map(p => (
          <div key={p.name} className="px-2.5 py-1.5">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[12px] font-semibold text-ink truncate">{p.name}</span>
              <span className={clsx('text-[10px] font-bold px-1 py-px rounded-sm border tracking-wider ml-auto flex-shrink-0', PATHWAY_PILL[p.type])}>
                TRL {p.trl}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 text-[11px]">
              <div className="text-ink-3"><span className="text-ink-4">Cost · </span>{p.cost}</div>
              <div className="text-ink-3 truncate"><span className="text-ink-4">Players · </span>{p.players}</div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function BladesPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden bg-page">

      <div className="flex-shrink-0 h-9 px-3 border-b border-border bg-canvas flex items-center justify-between">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[13px] font-semibold text-ink uppercase tracking-wide">Processing Capacity Monitor</h1>
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
          <CompositeBladesPanel />
          <PathwayChartPanel />
          <GateFeesTablePanel />
          <LandfillTrackerPanel />
          <CapacitySignalsPanel />
          <PathwaySummaryPanel />
        </div>
      </div>

    </div>
  )
}
