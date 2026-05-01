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
  steel_hms1:      'Steel HMS 1',
  steel_hms2:      'Steel HMS 2',
  steel_cast_iron: 'Cast Iron',
  steel_stainless: 'Stainless',
  copper:          'Copper',
  aluminium:       'Aluminium',
  rare_earth:      'Rare Earths',
}

const MATERIAL_ORDER = [
  'steel_hms1', 'steel_hms2', 'steel_cast_iron', 'steel_stainless',
  'copper', 'aluminium', 'rare_earth',
]

type RvRegion = 'EU' | 'GB' | 'US'
const RV_REGIONS: { code: RvRegion; label: string; currency: string }[] = [
  { code: 'EU', label: 'EU', currency: 'EUR' },
  { code: 'GB', label: 'GB', currency: 'GBP' },
  { code: 'US', label: 'US', currency: 'USD' },
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
    style: 'currency', currency,
    maximumFractionDigits: 0,
  }).format(val)
}

// ── Shared panel shell ─────────────────────────────────────────────────────────

function Panel({
  label,
  panelId,
  action,
  asOf,
  viewLabel = 'View all →',
  children,
  loading,
  className,
}: {
  label:      string
  panelId:    PanelId
  action?:    React.ReactNode
  asOf?:      string | null      // "as of" date string shown right of label
  viewLabel?: string
  children:   React.ReactNode
  loading?:   boolean
  className?: string
}) {
  const { openPanel } = useWorkspace()
  return (
    <div className={clsx('flex flex-col border border-terminal-border rounded bg-terminal-surface overflow-hidden', className)}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-terminal-border flex-shrink-0 gap-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          <span className="text-[10px] text-terminal-muted tracking-widest uppercase whitespace-nowrap flex-shrink-0">{label}</span>
          {asOf && (
            <span className="text-[10px] font-mono text-terminal-border whitespace-nowrap truncate">
              · {asOf}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {action}
          <button
            onClick={() => openPanel(panelId)}
            className="text-[10px] text-terminal-teal hover:underline transition-colors whitespace-nowrap"
          >
            {viewLabel}
          </button>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-terminal-muted font-mono">
          Loading…
        </div>
      ) : (
        children
      )}
    </div>
  )
}

// ── Planned-module panel (no live data) ────────────────────────────────────────

function PlannedPanel({
  label,
  panelId,
  description,
  signals,
}: {
  label: string
  panelId: PanelId
  description: string
  signals: string[]
}) {
  const { openPanel } = useWorkspace()
  return (
    <div className="flex flex-col border border-terminal-border rounded bg-terminal-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-terminal-border flex-shrink-0">
        <span className="text-[10px] text-terminal-muted tracking-widest uppercase">{label}</span>
        <button
          onClick={() => openPanel(panelId)}
          className="text-[10px] text-terminal-teal hover:underline transition-colors"
        >
          View →
        </button>
      </div>
      <div className="px-4 py-4 space-y-3">
        <p className="text-xs text-terminal-muted leading-relaxed">{description}</p>
        <div className="space-y-1.5">
          {signals.map(s => (
            <div key={s} className="flex items-start gap-2">
              <div className="w-1 h-1 rounded-full bg-terminal-border mt-1.5 flex-shrink-0" />
              <span className="text-[11px] font-mono text-terminal-muted">{s}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Watch feed ─────────────────────────────────────────────────────────────────

function WatchFeed() {
  const [events, setEvents] = useState<WatchEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('watch_events')
      .select('id, category, event_type, scope, headline, notes, event_date, confidence, source_count, watch_sources(name)')
      .eq('is_duplicate', false)
      .order('event_date', { ascending: false })
      .limit(12)
      .then(({ data }) => {
        setEvents((data as WatchEvent[]) ?? [])
        setLoading(false)
      })
  }, [])

  const latestDate = events.length > 0 ? fmtDate(events[0].event_date) : null

  return (
    <Panel label="Market Watch" panelId="watch" loading={loading} asOf={latestDate}>
      <div className="divide-y divide-terminal-border overflow-auto">
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

// ── Recovery Value ─────────────────────────────────────────────────────────────

function RecoveryValuePanel() {
  const [region, setRegion] = useState<RvRegion>('EU')
  const [prices, setPrices] = useState<CommodityRow[]>([])
  const [loading, setLoading] = useState(true)

  const currency = RV_REGIONS.find(r => r.code === region)?.currency ?? 'EUR'

  useEffect(() => {
    setLoading(true)
    supabase
      .from('commodity_prices')
      .select('material_type, price_per_tonne, currency, price_date')
      .eq('region', region)
      .order('price_date', { ascending: false })
      .then(({ data }) => {
        if (!data) { setLoading(false); return }
        const seen = new Set<string>()
        const deduped: CommodityRow[] = []
        for (const row of data as CommodityRow[]) {
          if (!seen.has(row.material_type)) {
            seen.add(row.material_type)
            deduped.push(row)
          }
        }
        deduped.sort((a, b) => {
          const ai = MATERIAL_ORDER.indexOf(a.material_type)
          const bi = MATERIAL_ORDER.indexOf(b.material_type)
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
        })
        setPrices(deduped)
        setLoading(false)
      })
  }, [region])

  const latestPriceDate = prices.length > 0
    ? fmtDate([...prices].sort((a, b) => b.price_date.localeCompare(a.price_date))[0].price_date)
    : null

  const regionTabs = (
    <div className="flex items-center gap-0 flex-1">
      {RV_REGIONS.map(r => (
        <button
          key={r.code}
          onClick={() => setRegion(r.code)}
          className={clsx(
            'px-2.5 py-1 text-[10px] font-mono rounded transition-colors',
            region === r.code
              ? 'bg-terminal-teal/15 text-terminal-teal'
              : 'text-terminal-muted hover:text-terminal-text'
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  )

  return (
    <Panel label="Recovery Value" panelId="materials" action={regionTabs} loading={loading} asOf={latestPriceDate}>
      <div className="divide-y divide-terminal-border">
        {prices.length === 0 ? (
          <p className="px-4 py-5 text-xs text-terminal-muted text-center">
            No prices for {region} yet.
          </p>
        ) : prices.map(row => (
          <div key={row.material_type} className="flex items-center justify-between px-4 py-2.5">
            <span className="text-xs text-terminal-text">
              {MATERIAL_LABELS[row.material_type] ?? row.material_type}
            </span>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="text-xs font-mono text-terminal-text">
                {fmtPrice(row.price_per_tonne, currency)}<span className="text-terminal-muted text-[10px]"> /t</span>
              </span>
              <span className="text-[10px] font-mono text-terminal-muted w-12 text-right">{fmtDate(row.price_date)}</span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── Asset Retirement Pipeline ──────────────────────────────────────────────────

function RetirementPanel() {
  const [stages, setStages] = useState<StageBucket[]>([])
  const [recent, setRecent] = useState<RetirementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [lastReviewed, setLastReviewed] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      supabase.from('repowering_projects').select('stage'),
      supabase
        .from('repowering_projects')
        .select('id, project_name, country_code, stage, capacity_mw, developer, stage_date')
        .order('stage_date', { ascending: false })
        .limit(5),
      supabase
        .from('repowering_projects')
        .select('last_reviewed')
        .order('last_reviewed', { ascending: false })
        .limit(1)
        .single(),
    ]).then(([stageRes, recentRes, reviewedRes]) => {
      const tally: Record<string, number> = {}
      for (const row of (stageRes.data ?? []) as { stage: string }[]) {
        tally[row.stage] = (tally[row.stage] ?? 0) + 1
      }
      const ORDER = ['announced', 'application_submitted', 'application_approved', 'permitted', 'ongoing']
      setStages(ORDER.map(s => ({ stage: s, count: tally[s] ?? 0 })))
      setRecent((recentRes.data as RetirementRow[]) ?? [])
      const reviewedDate = (reviewedRes.data as { last_reviewed: string } | null)?.last_reviewed ?? null
      setLastReviewed(reviewedDate)
      setLoading(false)
    })
  }, [])

  const total = stages.reduce((s, r) => s + r.count, 0)

  return (
    <Panel
      label="Asset Retirement Pipeline"
      panelId="retirement"
      loading={loading}
      asOf={lastReviewed ? fmtDate(lastReviewed) : null}
    >
      <div>
        {/* Stage summary */}
        {total > 0 && (
          <div className="flex items-center gap-4 px-4 py-3 border-b border-terminal-border flex-wrap">
            {stages.filter(s => s.count > 0).map(({ stage, count }) => (
              <div key={stage} className="flex flex-col items-center min-w-0">
                <span className="text-sm font-semibold text-terminal-text leading-none">{count}</span>
                <span className="text-[10px] font-mono text-terminal-muted mt-1 whitespace-nowrap">
                  {STAGE_LABELS[stage] ?? stage}
                </span>
              </div>
            ))}
            <span className="ml-auto text-[10px] font-mono text-terminal-muted">{total} total</span>
          </div>
        )}
        {/* Recent projects */}
        <div className="divide-y divide-terminal-border">
          {recent.map(p => (
            <div key={p.id} className="flex items-center justify-between px-4 py-2.5 gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-terminal-text truncate">{p.project_name}</p>
                <p className="text-[10px] font-mono text-terminal-muted mt-0.5">
                  {p.country_code}{p.capacity_mw != null ? ` · ${p.capacity_mw} MW` : ''}{p.developer ? ` · ${p.developer}` : ''}
                </p>
              </div>
              <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
                <span className="text-[10px] font-mono text-terminal-teal bg-terminal-teal/10 px-1.5 py-0.5 rounded">
                  {STAGE_LABELS[p.stage] ?? p.stage}
                </span>
                <span className="text-[10px] font-mono text-terminal-muted">{fmtDate(p.stage_date)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  )
}

// ── DCI Status ─────────────────────────────────────────────────────────────────

function DciStatusPanel() {
  const { openPanel } = useWorkspace()
  const indices = [
    { index: 'DCI Europe · Spot', ccy: 'EUR / MW', status: 'Methodology in build' },
    { index: 'DCI US · Spot',     ccy: 'USD / MW', status: 'Methodology in build' },
    { index: 'DCI Forward',       ccy: 'EUR & USD', status: 'Phase 2' },
    { index: 'DCI Reserve',       ccy: '—',        status: 'Phase 2' },
  ]
  return (
    <div className="flex flex-col border border-terminal-border rounded bg-terminal-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-terminal-border flex-shrink-0">
        <span className="text-[10px] text-terminal-muted tracking-widest uppercase">Decommissioning Cost Index</span>
        <button
          onClick={() => openPanel('dci')}
          className="text-[10px] text-terminal-teal hover:underline transition-colors"
        >
          View →
        </button>
      </div>
      <div className="divide-y divide-terminal-border">
        {indices.map(({ index, ccy, status }) => (
          <div key={index} className="flex items-center justify-between px-4 py-2.5">
            <div>
              <p className="text-xs font-mono text-terminal-text">{index}</p>
              <p className="text-[10px] text-terminal-muted">{ccy}</p>
            </div>
            <span className="text-[10px] font-mono text-terminal-muted">{status}</span>
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

      {/*
        Three-column layout:
          Left  (flex-1):  Market Watch feed — taller, denser
          Mid   (340px):   Recovery Value + Retirement pipeline
          Right (300px):   DCI + Blade Waste + Portfolio
      */}
      <div className="flex-1 p-4 grid grid-cols-[1fr_340px_300px] gap-3 min-h-0 overflow-auto items-start">

        {/* ── Left: Watch feed ────────────────────────────────────── */}
        <WatchFeed />

        {/* ── Centre: Recovery Value + Retirement ─────────────────── */}
        <div className="flex flex-col gap-3">
          <RecoveryValuePanel />
          <RetirementPanel />
        </div>

        {/* ── Right: DCI + Blades + Portfolio ─────────────────────── */}
        <div className="flex flex-col gap-3">
          <DciStatusPanel />
          <PlannedPanel
            label="Blade Waste Intelligence"
            panelId="blades"
            description="GRP and composite blade volumes by region and year, recycling pathway availability, and end-of-life cost modelling."
            signals={[
              'Blade inventory by region and turbine model',
              'GRP / composite volume estimates',
              'Recycling pathway availability by geography',
              'End-of-life cost modelling',
              'Processor and contractor directory',
            ]}
          />
          <PlannedPanel
            label="Portfolio Analytics"
            panelId="portfolio"
            description="Model aggregate decommissioning liability exposure, attribute NRO by site, run sensitivity scenarios, and export for boards, lenders, and sureties."
            signals={[
              'Portfolio upload and site configuration',
              'Aggregate liability vs DCI benchmark',
              'NRO attribution by site and material',
              'Sensitivity analysis — price and timing',
              'Board memo and surety pack export',
            ]}
          />
        </div>

      </div>
    </div>
  )
}
