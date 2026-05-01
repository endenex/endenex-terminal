import { useState, useEffect } from 'react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import { TopBar } from '@/components/layout/TopBar'
import { useWorkspace } from '@/context/WorkspaceContext'
import type { PanelId } from '@/components/layout/AppShell'

// ── Types ──────────────────────────────────────────────────────────────────────

type WatchCategory = 'market' | 'regulatory' | 'commodity' | 'supply_chain'

interface WatchEvent {
  id: string
  category: WatchCategory
  event_type: string
  scope: string
  headline: string
  notes: string | null
  event_date: string
  confidence: 'High' | 'Medium' | 'Low'
  source_count: number
  watch_sources: { name: string } | null
}

interface CommodityRow {
  material_type: string
  price_per_tonne: number
  currency: string
  price_date: string
}

interface RetirementRow {
  id: string
  project_name: string
  country_code: string
  stage: string
  capacity_mw: number | null
  developer: string | null
  stage_date: string | null
}

interface StageBucket {
  stage: string
  count: number
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CATEGORY_PILL: Record<WatchCategory, string> = {
  market:       'bg-blue-900/30 text-blue-400 border border-blue-700/50',
  regulatory:   'bg-amber-900/30 text-amber-400 border border-amber-700/50',
  commodity:    'bg-teal-900/30 text-teal-400 border border-teal-700/50',
  supply_chain: 'bg-violet-900/30 text-violet-400 border border-violet-700/50',
}

const CATEGORY_LABEL: Record<WatchCategory, string> = {
  market:       'Market',
  regulatory:   'Regulatory',
  commodity:    'Commodity',
  supply_chain: 'Supply Chain',
}

const MATERIAL_LABELS: Record<string, string> = {
  steel_hms1:      'Steel — HMS 1',
  steel_hms2:      'Steel — HMS 2',
  steel_cast_iron: 'Steel — Cast Iron',
  steel_stainless: 'Steel — Stainless',
  copper:          'Copper',
  aluminium:       'Aluminium',
  rare_earth:      'Rare Earths',
}

const MATERIAL_ORDER = [
  'steel_hms1', 'steel_hms2', 'steel_cast_iron', 'steel_stainless',
  'copper', 'aluminium', 'rare_earth',
]

const STAGE_LABELS: Record<string, string> = {
  announced:             'Announced',
  application_submitted: 'Application',
  application_approved:  'Approved',
  permitted:             'Permitted',
  ongoing:               'Ongoing',
}

const CONFIDENCE_COLOUR: Record<string, string> = {
  High:   'text-emerald-400',
  Medium: 'text-amber-400',
  Low:    'text-red-400',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try {
    return new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  } catch { return '—' }
}

function fmtPrice(val: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(val)
}

// ── Panel wrapper ──────────────────────────────────────────────────────────────

function Panel({
  label,
  panelId,
  children,
  loading,
}: {
  label: string
  panelId: PanelId
  children: React.ReactNode
  loading: boolean
}) {
  const { openPanel } = useWorkspace()
  return (
    <div className="flex flex-col border border-terminal-border rounded bg-terminal-surface overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-terminal-border flex-shrink-0">
        <span className="text-[10px] text-terminal-muted tracking-widest uppercase">{label}</span>
        <button
          onClick={() => openPanel(panelId)}
          className="text-[10px] text-terminal-teal hover:underline transition-colors"
        >
          View all →
        </button>
      </div>
      {loading ? (
        <div className="flex-1 flex items-center justify-center py-10 text-xs text-terminal-muted font-mono">
          Loading…
        </div>
      ) : (
        <div className="flex-1 overflow-auto">{children}</div>
      )}
    </div>
  )
}

// ── Watch feed panel ───────────────────────────────────────────────────────────

function WatchFeed() {
  const [events, setEvents] = useState<WatchEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('watch_events')
      .select('id, category, event_type, scope, headline, notes, event_date, confidence, source_count, watch_sources(name)')
      .eq('is_duplicate', false)
      .order('event_date', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        setEvents((data as WatchEvent[]) ?? [])
        setLoading(false)
      })
  }, [])

  return (
    <Panel label="Market Watch" panelId="watch" loading={loading}>
      <div className="divide-y divide-terminal-border">
        {events.length === 0 ? (
          <p className="px-5 py-8 text-xs text-terminal-muted text-center">
            No events yet — feed updates daily.
          </p>
        ) : events.map(ev => (
          <div key={ev.id} className="px-5 py-4">
            {/* Meta strip */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-[11px] font-mono text-terminal-muted">{fmtDate(ev.event_date)}</span>
              <span className="text-terminal-border">·</span>
              <span className={clsx('text-[10px] font-mono px-1.5 py-0.5 rounded', CATEGORY_PILL[ev.category])}>
                {CATEGORY_LABEL[ev.category]}
              </span>
              <span className="text-[11px] text-terminal-muted">{ev.event_type}</span>
              <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                <span className="text-[11px] font-mono text-terminal-muted">{ev.scope}</span>
                <span className={clsx('text-[11px] font-mono', CONFIDENCE_COLOUR[ev.confidence])}>
                  {ev.confidence}
                </span>
              </div>
            </div>
            {/* Headline */}
            <p className="text-[13px] font-semibold text-terminal-text leading-snug tracking-tight">
              {ev.headline}
            </p>
            {/* Summary — clamp to 2 lines */}
            {ev.notes && (
              <p className="mt-1.5 text-xs text-terminal-muted leading-relaxed line-clamp-2">
                {ev.notes}
              </p>
            )}
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── Recovery value panel ───────────────────────────────────────────────────────

function RecoveryValuePanel() {
  const [prices, setPrices] = useState<CommodityRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get the latest row per material_type for EU region
    supabase
      .from('commodity_prices')
      .select('material_type, price_per_tonne, currency, price_date')
      .eq('region', 'EU')
      .order('price_date', { ascending: false })
      .then(({ data }) => {
        if (!data) { setLoading(false); return }
        // Deduplicate: keep first (latest) per material_type
        const seen = new Set<string>()
        const deduped: CommodityRow[] = []
        for (const row of data as CommodityRow[]) {
          if (!seen.has(row.material_type)) {
            seen.add(row.material_type)
            deduped.push(row)
          }
        }
        // Sort by MATERIAL_ORDER
        deduped.sort((a, b) => {
          const ai = MATERIAL_ORDER.indexOf(a.material_type)
          const bi = MATERIAL_ORDER.indexOf(b.material_type)
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
        })
        setPrices(deduped)
        setLoading(false)
      })
  }, [])

  return (
    <Panel label="Recovery Value · EU" panelId="materials" loading={loading}>
      <div className="divide-y divide-terminal-border">
        {prices.length === 0 ? (
          <p className="px-5 py-6 text-xs text-terminal-muted text-center">No prices available.</p>
        ) : prices.map(row => (
          <div key={row.material_type} className="flex items-center justify-between px-5 py-3">
            <span className="text-xs text-terminal-text">
              {MATERIAL_LABELS[row.material_type] ?? row.material_type}
            </span>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="text-xs font-mono text-terminal-text">
                {fmtPrice(row.price_per_tonne, row.currency)} / t
              </span>
              <span className="text-[11px] font-mono text-terminal-muted">{fmtDate(row.price_date)}</span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── Retirement pipeline panel ──────────────────────────────────────────────────

function RetirementPanel() {
  const [stages, setStages] = useState<StageBucket[]>([])
  const [recent, setRecent] = useState<RetirementRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      // Stage counts
      supabase
        .from('repowering_projects')
        .select('stage'),
      // Latest 5 projects
      supabase
        .from('repowering_projects')
        .select('id, project_name, country_code, stage, capacity_mw, developer, stage_date')
        .order('stage_date', { ascending: false })
        .limit(5),
    ]).then(([stageRes, recentRes]) => {
      // Tally stage counts
      const tally: Record<string, number> = {}
      for (const row of (stageRes.data ?? []) as { stage: string }[]) {
        tally[row.stage] = (tally[row.stage] ?? 0) + 1
      }
      const STAGE_ORDER = ['announced', 'application_submitted', 'application_approved', 'permitted', 'ongoing']
      setStages(STAGE_ORDER.map(s => ({ stage: s, count: tally[s] ?? 0 })))
      setRecent((recentRes.data as RetirementRow[]) ?? [])
      setLoading(false)
    })
  }, [])

  const total = stages.reduce((s, r) => s + r.count, 0)

  return (
    <Panel label="Asset Retirement Pipeline" panelId="retirement" loading={loading}>
      <div>
        {/* Stage summary bar */}
        {total > 0 && (
          <div className="px-5 py-4 border-b border-terminal-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono text-terminal-muted uppercase tracking-widest">
                {total.toLocaleString()} projects tracked
              </span>
            </div>
            <div className="flex gap-3 flex-wrap">
              {stages.filter(s => s.count > 0).map(({ stage, count }) => (
                <div key={stage} className="flex flex-col items-center">
                  <span className="text-sm font-semibold text-terminal-text">{count}</span>
                  <span className="text-[10px] font-mono text-terminal-muted mt-0.5">
                    {STAGE_LABELS[stage] ?? stage}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent projects */}
        <div className="divide-y divide-terminal-border">
          {recent.map(p => (
            <div key={p.id} className="px-5 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-terminal-text truncate">{p.project_name}</p>
                  <p className="text-[11px] font-mono text-terminal-muted mt-0.5">
                    {p.country_code}
                    {p.capacity_mw != null ? ` · ${p.capacity_mw} MW` : ''}
                    {p.developer ? ` · ${p.developer}` : ''}
                  </p>
                </div>
                <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
                  <span className="text-[10px] font-mono text-terminal-teal bg-terminal-teal/10 px-1.5 py-0.5 rounded">
                    {STAGE_LABELS[p.stage] ?? p.stage}
                  </span>
                  <span className="text-[10px] font-mono text-terminal-muted">{fmtDate(p.stage_date)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  )
}

// ── DCI status panel ───────────────────────────────────────────────────────────

function DciStatusPanel() {
  const { openPanel } = useWorkspace()
  return (
    <div className="flex flex-col border border-terminal-border rounded bg-terminal-surface overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-terminal-border flex-shrink-0">
        <span className="text-[10px] text-terminal-muted tracking-widest uppercase">DCI</span>
        <button
          onClick={() => openPanel('dci')}
          className="text-[10px] text-terminal-teal hover:underline transition-colors"
        >
          View →
        </button>
      </div>
      <div className="divide-y divide-terminal-border">
        {[
          { index: 'DCI Europe · Spot', ccy: 'EUR / MW', status: 'Methodology in build' },
          { index: 'DCI US · Spot',     ccy: 'USD / MW', status: 'Methodology in build' },
          { index: 'DCI Forward',       ccy: '—',        status: 'Phase 2' },
        ].map(({ index, ccy, status }) => (
          <div key={index} className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="text-xs font-mono text-terminal-text">{index}</p>
              <p className="text-[11px] text-terminal-muted">{ccy}</p>
            </div>
            <span className="text-[11px] font-mono text-terminal-muted">{status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function DashboardPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      <TopBar
        title="Endenex Terminal"
        subtitle="Institutional intelligence for ageing clean energy assets"
      />

      <div className="flex-1 p-5 grid grid-cols-[1fr_380px] gap-4 min-h-0 overflow-auto">

        {/* Left — Watch feed (taller) */}
        <div className="flex flex-col min-h-0">
          <WatchFeed />
        </div>

        {/* Right — stacked panels */}
        <div className="flex flex-col gap-4 min-h-0">
          <RecoveryValuePanel />
          <RetirementPanel />
          <DciStatusPanel />
        </div>

      </div>
    </div>
  )
}
