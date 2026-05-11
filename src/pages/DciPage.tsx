// ── DCI Dashboard — Tab 02 ───────────────────────────────────────────────────
//
// Second-degree view of the DCI index family. The Home page Spot Indices
// panel is the first-degree headline (G/NRO/Net + sparkline). This page
// is for users who want to understand the mechanics:
//   - Indices Strip (top, full width): master selector
//   - 3×3 grid below:
//       Row 1: Hero (2-wide)             | Contributor Coverage
//       Row 2: Cost Waterfall (2-wide)   | Reference Archetype + Weights
//       Row 3: Variable Basket | Scope   | Placeholder
//
// Bloomberg-density. All panels visible simultaneously. Publication
// schedule lives in a footer modal (not a panel — static reference info).

import { useState, useEffect, useMemo } from 'react'
import { clsx } from 'clsx'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine } from 'recharts'
import { supabase } from '@/lib/supabase'
import {
  DCI_INDICES, DCI_ARCHETYPES, DCI_SCOPE, DCI_VARIABLES,
  DCI_PUBLICATION, DCI_REBALANCE_SOURCE,
  type DciSeries, type DciCategory,
} from '@/data/dci_meta'
import { AXIS_TICK, AXIS_LINE, GRID_PROPS, TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE } from '@/lib/chartStyle'

// ── Types from Supabase (existing dci_publications schema) ───────────

interface DciPublication {
  series:                DciSeries
  publication_date:      string
  index_value:           number | null
  currency:              string
  net_liability:         number | null
  net_liability_low:     number | null
  net_liability_high:    number | null
  gross_cost:            number | null
  material_recovery:     number | null
  disposal_costs:        number | null
  net_material_position: number | null
  recovery_ferrous:      number | null
  recovery_copper:       number | null
  recovery_aluminium:    number | null
  blade_transport:       number | null
  blade_gate_fees:       number | null
  scrap_haulage:         number | null
  methodology_version:   string | null
  is_published:          boolean
}

// ── Page shell ───────────────────────────────────────────────────────

export function DciPage() {
  const [pubs,     setPubs]     = useState<DciPublication[]>([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState<DciSeries>('dci_wind_europe')

  useEffect(() => {
    setLoading(true)
    supabase.from('dci_publications')
      .select('*')
      .eq('is_published', true)
      .order('publication_date', { ascending: true })
      .then(({ data }) => {
        setPubs((data ?? []) as DciPublication[])
        setLoading(false)
      })
  }, [])

  return (
    <div className="flex flex-col h-full overflow-hidden bg-page">

      {/* Page header */}
      <div className="flex-shrink-0 h-9 px-3 border-b border-border bg-canvas flex items-center justify-between">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[13px] font-semibold text-ink uppercase tracking-wide">DCI · Decommissioning Cost Index Family</h1>
          <span className="text-[11.5px] text-ink-3">
            {DCI_INDICES.filter(i => i.status === 'live').length} live · {DCI_INDICES.filter(i => i.status === 'pending').length} pending · {DCI_PUBLICATION.cadence} · spot benchmark, net of recovery
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10.5px] text-ink-3 flex-shrink-0 uppercase tracking-wide">
          <span>Methodology {DCI_PUBLICATION.methodology_version}</span>
          {DCI_PUBLICATION.iosco_compliant && (
            <span className="px-1.5 py-px bg-canvas border border-[#0A1628]/30 rounded-sm text-[#0A1628] normal-case font-semibold">IOSCO</span>
          )}
        </div>
      </div>

      {/* Content grid — 3×3 with row 2 spanning full width:
            Row 1: Indices Strip (col-span-2) | Series Routing
            Row 2: Cost Waterfall (col-span-3, full width)
            Row 3: Variable Basket | Scope | Reference Archetype
          Series Routing sits up top because the use-case → series
          mapping calibrates how a user reads the headline numbers
          right next to it. Reference Archetype is reference detail
          and lives in the row-3 reference cluster.
          Contributor Coverage moved into the DCI Publication footer
          modal — it's reference info about index governance, not a
          live workspace panel. */}
      <div className="flex-1 min-h-0 overflow-hidden p-1.5">
        <div className="h-full grid grid-cols-3 grid-rows-3 gap-1.5">

          <IndicesStripPanel pubs={pubs} loading={loading} selected={selected} onSelect={setSelected} />
          <SeriesRoutingPanel />

          <CostWaterfallPanel pubs={pubs} loading={loading} selected={selected} />

          <VariableBasketPanel />
          <ScopePanel selected={selected} />
          <ReferenceArchetypePanel selected={selected} />
        </div>
      </div>

    </div>
  )
}

// ── Format helpers ───────────────────────────────────────────────────

const fmtCurrency = (n: number | null | undefined, sym: string): string => {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000)     return `${sym}${(n / 1_000).toFixed(0)},${String(Math.round(n) % 1000).padStart(3, '0')}`
  return `${sym}${n.toFixed(0)}`
}
const fmtPct = (n: number | null | undefined): string => {
  if (n == null) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}
const pctClass = (n: number | null | undefined): string =>
  n == null ? 'text-ink-4' : n > 0 ? 'text-rose-700' : n < 0 ? 'text-emerald-700' : 'text-ink-3'

interface IndexAggregate {
  current?:  DciPublication
  previous?: DciPublication
  history:   DciPublication[]
}

function aggregateForSeries(pubs: DciPublication[], series: DciSeries): IndexAggregate {
  const filtered = pubs.filter(p => p.series === series)
  return {
    current:  filtered[filtered.length - 1],
    previous: filtered[filtered.length - 2],
    history:  filtered,
  }
}

// ── Panel: Indices Strip ─────────────────────────────────────────────

interface IndicesStripProps {
  pubs:     DciPublication[]
  loading:  boolean
  selected: DciSeries
  onSelect: (s: DciSeries) => void
}

function IndicesStripPanel({ pubs, loading, selected, onSelect }: IndicesStripProps) {
  return (
    <div className="col-span-2 bg-panel border border-border rounded-sm flex flex-col overflow-hidden">
      <div className="h-7 px-3 flex items-center justify-between border-b border-border bg-titlebar flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="label-xs">DCI</span>
          <span className="text-ink-4 text-[10px]">·</span>
          <span className="text-[12.5px] font-semibold text-ink">Indices</span>
        </div>
        <span className="text-[10px] text-ink-4">Net headline · Gross + NRO constituents</span>
      </div>
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        <div className="flex divide-x divide-border min-w-max h-full">
          {DCI_INDICES.map(idx => {
            const agg = aggregateForSeries(pubs, idx.series)
            const isSel = selected === idx.series
            const gross = agg.current?.gross_cost ?? null
            const nro   = agg.current?.material_recovery ?? null
            const net   = (gross != null && nro != null) ? gross - nro : null
            // Net is the spot benchmark — Q/Q tracks net, not gross.
            const netPrev = (agg.previous?.gross_cost != null && agg.previous?.material_recovery != null)
              ? agg.previous.gross_cost - agg.previous.material_recovery
              : null
            const netDelta = (net != null && netPrev != null && netPrev !== 0)
              ? ((net - netPrev) / netPrev) * 100
              : null
            return (
              <button key={idx.series}
                      onClick={() => onSelect(idx.series)}
                      className={clsx(
                        'w-[148px] flex-shrink-0 text-left px-2.5 py-1.5 border-l-2 transition-colors',
                        isSel ? 'bg-active border-l-[#0A1628]' : 'hover:bg-raised border-l-transparent',
                      )}>
                <div className="flex items-baseline justify-between mb-1">
                  <span className={clsx('text-[11px] font-bold tabular-nums tracking-wide', isSel ? 'text-[#0A1628]' : 'text-ink')}>{idx.ticker}</span>
                  {idx.status === 'pending' && (
                    <span className="text-[8px] font-bold tracking-wider text-[#C4863A] bg-[#C4863A]/10 border border-[#C4863A]/30 px-1 rounded-sm">PEND</span>
                  )}
                </div>
                {/* NET — hero (spot benchmark) */}
                <div className="flex justify-between items-baseline">
                  <span className="text-ink-4 uppercase tracking-wider text-[8.5px]">Net</span>
                  <span className="text-[13px] font-bold text-[#0A1628] tabular-nums">{fmtCurrency(net, idx.ccy_symbol)}</span>
                </div>
                <div className="flex justify-between items-baseline mt-0.5">
                  <span className="text-ink-4 uppercase tracking-wider text-[8.5px]">Q/Q</span>
                  <span className={clsx('text-[10px] tabular-nums font-semibold', pctClass(netDelta))}>{fmtPct(netDelta)}</span>
                </div>
                {/* Constituents — equal weight, smaller */}
                <div className="border-t border-border/50 mt-1 pt-1 space-y-0 text-[10px] leading-tight">
                  <div className="flex justify-between items-baseline">
                    <span className="text-ink-4 uppercase tracking-wider text-[8.5px]">Gross</span>
                    <span className="text-[10.5px] text-ink-2 tabular-nums">{fmtCurrency(gross, idx.ccy_symbol)}</span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-ink-4 uppercase tracking-wider text-[8.5px]">NRO</span>
                    <span className="text-[10.5px] text-[#007B8A] tabular-nums">{fmtCurrency(nro, idx.ccy_symbol)}</span>
                  </div>
                </div>
              </button>
            )
          })}
          {loading && <div className="px-4 py-2 text-[11px] text-ink-3 flex items-center">Loading…</div>}
        </div>
      </div>
    </div>
  )
}

// ── Panel: Cost Waterfall ────────────────────────────────────────────
//
// Builds UP from individual cost components → Gross,
// then deducts DOWN by NRO → Net.
// Implemented via stacked bars where the first bar is invisible "base"
// (offset from zero) and the second bar is the visible segment.

interface WaterfallStep {
  name:      string
  base:      number   // invisible offset
  value:     number   // visible bar height
  color:     string
  isTotal?:  boolean
  displayValue: number  // what to show in tooltip / label
}

function CostWaterfallPanel({ pubs, loading, selected }: { pubs: DciPublication[]; loading: boolean; selected: DciSeries }) {
  const meta = DCI_INDICES.find(i => i.series === selected)!
  const agg  = aggregateForSeries(pubs, selected)
  const cur  = agg.current

  const steps: WaterfallStep[] = useMemo(() => {
    if (!cur || !cur.gross_cost) return []

    // Cost components from schema:
    const transport = (cur.blade_transport ?? 0) + (cur.scrap_haulage ?? 0)
    const gateFees  = cur.blade_gate_fees ?? 0
    const disposal  = cur.disposal_costs ?? 0
    const known     = transport + gateFees + disposal
    // "Labour & other" = everything else (labour isn't broken out yet)
    const labour    = Math.max(0, cur.gross_cost - known)
    const gross     = cur.gross_cost
    const nro       = cur.material_recovery ?? 0
    const net       = gross - nro

    let cum = 0
    const out: WaterfallStep[] = []

    if (labour > 0) {
      out.push({ name: 'Labour', base: cum, value: labour, color: '#0A1628', displayValue: labour })
      cum += labour
    }
    if (transport > 0) {
      out.push({ name: 'Transport', base: cum, value: transport, color: '#1C3D52', displayValue: transport })
      cum += transport
    }
    if (gateFees > 0) {
      out.push({ name: 'Gate fees', base: cum, value: gateFees, color: '#2A7F8E', displayValue: gateFees })
      cum += gateFees
    }
    if (disposal > 0) {
      out.push({ name: 'Disposal', base: cum, value: disposal, color: '#3D6E7A', displayValue: disposal })
      cum += disposal
    }
    // GROSS — intermediate sub-total (muted slate, not the hero)
    out.push({ name: 'GROSS', base: 0, value: gross, color: '#5B6B7A', isTotal: true, displayValue: gross })
    // NRO deduction (from gross down to net)
    if (nro > 0) {
      out.push({ name: '(–) NRO', base: net, value: nro, color: '#007B8A', displayValue: -nro })
    }
    // NET — terminal hero (deep navy, spot benchmark)
    out.push({ name: 'NET', base: 0, value: net, color: '#0A1628', isTotal: true, displayValue: net })
    return out
  }, [cur])

  return (
    <Panel label="DCI" title={`Cost Waterfall · ${meta.ticker}`} className="col-span-3">
      {loading ? (
        <div className="h-full flex items-center justify-center text-[12px] text-ink-3">Loading…</div>
      ) : steps.length === 0 ? (
        <div className="h-full flex items-center justify-center px-4 text-[11px] text-ink-3 text-center">
          No published cost decomposition yet. Next publication: {DCI_PUBLICATION.next_publication}.
        </div>
      ) : (
        <div className="h-full px-2 pt-2 pb-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={steps} margin={{ top: 16, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval={0} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false}
                     tickFormatter={(v: number) => fmtCurrency(v, meta.ccy_symbol)} />
              <Tooltip
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                formatter={((v: any, _name: any, item: any) => {
                  if (item?.dataKey === 'value' && item?.payload) {
                    const p = item.payload as WaterfallStep
                    return [fmtCurrency(p.displayValue, meta.ccy_symbol), p.name]
                  }
                  return ['', '']
                }) as any}
                labelFormatter={() => ''}
              />
              <ReferenceLine y={0} stroke={AXIS_LINE.stroke} />
              {/* Invisible base bar */}
              <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
              {/* Visible value bar */}
              <Bar dataKey="value" stackId="wf" isAnimationActive={false}>
                {steps.map((s, i) => (
                  <Cell key={i} fill={s.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  )
}

// ── Panel: Reference Archetype + Weights ─────────────────────────────

function ReferenceArchetypePanel({ selected }: { selected: DciSeries }) {
  const meta = DCI_INDICES.find(i => i.series === selected)!
  const archetypes = DCI_ARCHETYPES.filter(a => a.series === selected)

  return (
    <Panel label="DCI" title={`Reference Archetype · ${meta.ticker}`}>
      <div className="overflow-y-auto h-full px-3 py-2 space-y-2">
        {archetypes.map(a => (
          <div key={a.code} className="border border-border rounded-sm p-2 bg-canvas/40">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[11px] font-bold text-[#0A1628] tabular-nums tracking-wide">{a.code}</span>
              <span className="text-[10px] font-semibold tabular-nums text-[#007B8A] bg-[#007B8A]/10 border border-[#007B8A]/30 px-1.5 py-px rounded-sm">
                {a.weight_pct}% weight
              </span>
            </div>
            <div className="text-[11px] text-ink leading-snug">
              {a.unit_count.toLocaleString()} × {a.unit_model}
              {a.hub_height_m && <> · {a.hub_height_m}m hub</>} · {a.project_size_mw} MW
            </div>
            <div className="text-[10px] text-ink-3 mt-0.5">
              {a.geography} · ~{a.vintage_circa} · {a.operator_typology}
            </div>
          </div>
        ))}
        <div className="text-[9px] text-ink-4 italic mt-2 leading-snug">
          Weights rebalanced {DCI_PUBLICATION.rebalance_date}. Source: {DCI_REBALANCE_SOURCE[meta.asset_class]}
        </div>
      </div>
    </Panel>
  )
}

// ── Panel: Variable Basket (compressed list view) ───────────────────

function VariableBasketPanel() {
  const grouped = useMemo(() => {
    const out: Record<DciCategory, typeof DCI_VARIABLES> = {
      'Crane': [], 'Labour': [], 'Transport': [], 'Gate fees': [], 'Material recovery': [],
    }
    for (const v of DCI_VARIABLES) out[v.category].push(v)
    return out
  }, [])
  const order: DciCategory[] = ['Crane', 'Labour', 'Transport', 'Gate fees', 'Material recovery']

  return (
    <Panel label="DCI" title="Variable Basket">
      <div className="overflow-y-auto h-full">
        {order.map(cat => (
          <div key={cat} className="border-b border-border/60">
            <div className="bg-canvas/50 px-2 py-1 text-[10px] font-bold text-[#0A1628] uppercase tracking-wider">
              {cat} · {grouped[cat].length}
            </div>
            {grouped[cat].map((v, i) => (
              <div key={i} className="px-2 py-1 flex items-start gap-1.5 text-[10.5px] hover:bg-raised">
                <span className={clsx(
                  'text-[8.5px] font-bold px-1 py-px rounded-sm tracking-wider border flex-shrink-0 mt-0.5',
                  v.sourcing === 'PRIMARY'
                    ? 'bg-[#C4863A]/10 text-[#C4863A] border-[#C4863A]/40'
                    : 'bg-[#007B8A]/10 text-[#007B8A] border-[#007B8A]/40',
                )}>
                  {v.sourcing === 'PRIMARY' ? 'PRI' : 'PUB'}
                </span>
                <div className="flex-1 min-w-0 leading-tight">
                  <div className="text-ink truncate" title={v.variable}>{v.variable}</div>
                  <div className="text-[9px] text-ink-4 truncate" title={v.source_type}>{v.source_type}</div>
                </div>
              </div>
            ))}
          </div>
        ))}
        <div className="px-2 py-1 text-[9px] text-ink-4 leading-snug">
          <span className="font-semibold text-[#C4863A] mr-1">PRI</span> contributor data ·
          <span className="font-semibold text-[#007B8A] mx-1">PUB</span> public benchmark
        </div>
      </div>
    </Panel>
  )
}

// ── Panel: Scope ────────────────────────────────────────────────────

function ScopePanel({ selected }: { selected: DciSeries }) {
  const meta  = DCI_INDICES.find(i => i.series === selected)!
  const scope = DCI_SCOPE.find(s => s.asset_class === meta.asset_class)!

  return (
    <Panel label="DCI" title={`Scope · ${meta.asset_class}`}>
      <div className="overflow-y-auto h-full px-3 py-2 space-y-3">
        <div>
          <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider mb-1">In scope</div>
          <ul className="space-y-0.5">
            {scope.in_scope.map((s, i) => (
              <li key={i} className="text-[10.5px] text-ink-2 leading-snug flex gap-1.5">
                <span className="text-emerald-700 flex-shrink-0">✓</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[10px] font-bold text-rose-800 uppercase tracking-wider mb-1">Out of scope</div>
          <ul className="space-y-0.5">
            {scope.out_of_scope.map((s, i) => (
              <li key={i} className="text-[10.5px] text-ink-2 leading-snug flex gap-1.5">
                <span className="text-rose-700 flex-shrink-0">✗</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  )
}

// ── Panel: Series Routing ────────────────────────────────────────────
//
// The three-series structure (Net headline + Gross/NRO constituents)
// only works if users know which series to point at which question.
// This panel makes that mapping load-bearing on the page itself, not
// just buried in the methodology PDF.

const SERIES_ROUTING: Array<{
  use_case: string
  series:   'GROSS' | 'NET' | 'EITHER'
  why:      string
}> = [
  { use_case: 'ARO understatement',          series: 'GROSS',  why: 'IFRS IAS 37 — provision recorded gross of expected salvage' },
  { use_case: 'Surety bond pricing',         series: 'GROSS',  why: 'Underwriter cannot rely on future scrap prices' },
  { use_case: 'Lender residual liability',   series: 'NET',    why: 'Realistic cash outflow at today\'s prices' },
  { use_case: 'Operator cash-flow planning', series: 'NET',    why: 'Both outflow and salvage credit settle in same period' },
  { use_case: 'Cross-region cost spreads',   series: 'EITHER', why: 'Gross for purity, Net for relevance' },
]

function SeriesRoutingPanel() {
  return (
    <Panel label="DCI" title="Series Routing">
      <div className="overflow-y-auto h-full px-2 py-1.5 space-y-1.5">
        {SERIES_ROUTING.map((r, i) => (
          <div key={i} className="border-b border-border/50 last:border-b-0 pb-1.5 last:pb-0">
            <div className="flex items-baseline justify-between gap-2 mb-0.5">
              <span className="text-[10.5px] text-ink leading-tight font-medium">{r.use_case}</span>
              <span className={clsx(
                'text-[8.5px] font-bold tracking-wider px-1 py-px rounded-sm border flex-shrink-0',
                r.series === 'GROSS'  ? 'bg-[#5B6B7A]/10 text-[#3D5560] border-[#5B6B7A]/40' :
                r.series === 'NET'    ? 'bg-[#0A1628]/10 text-[#0A1628] border-[#0A1628]/40' :
                                        'bg-[#C4863A]/10 text-[#C4863A] border-[#C4863A]/40',
              )}>
                {r.series}
              </span>
            </div>
            <div className="text-[9.5px] text-ink-3 leading-snug">{r.why}</div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── Panel shell ──────────────────────────────────────────────────────

function Panel({ label, title, children, className }: {
  label:    string
  title:    string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={clsx('bg-panel border border-border rounded-sm flex flex-col overflow-hidden', className)}>
      <div className="h-7 px-3 flex items-center gap-2 border-b border-border bg-titlebar flex-shrink-0">
        <span className="label-xs">{label}</span>
        <span className="text-ink-4 text-[10px]">·</span>
        <span className="text-[12.5px] font-semibold text-ink truncate">{title}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
