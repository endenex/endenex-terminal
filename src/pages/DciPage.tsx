// ── DCI Dashboard — Tab 02 ───────────────────────────────────────────────────
//
// Second-degree view of the DCI index family. The Home page Spot Indices
// panel is the first-degree view (headline numbers + sparklines). This
// page is for users who want to understand the mechanics:
//   - Indices Strip: master selector, all indices visible at once
//   - Selected Index Detail: history + cost decomposition + sub-archetype
//   - Reference Assets & Scope: what each index is measuring (with scope
//     promoted to its own prominent section)
//   - Variable Baskets: what feeds the indices (sourcing PUBLIC/PRIMARY
//     + generic source type — vendor names deliberately omitted)
//   - Contributor Coverage + Publication Schedule
//
// Bloomberg-density aesthetic. All panels visible simultaneously.

import { useState, useEffect, useMemo } from 'react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import {
  DCI_INDICES, DCI_ARCHETYPES, DCI_SCOPE, DCI_VARIABLES,
  DCI_CONTRIBUTOR_COVERAGE, DCI_CONTRIBUTOR_THRESHOLD,
  DCI_PUBLICATION, DCI_REBALANCE_SOURCE,
  type DciSeries, type DciAssetClass, type DciCategory,
} from '@/data/dci_meta'

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
            {DCI_INDICES.filter(i => i.status === 'live').length} live · {DCI_INDICES.filter(i => i.status === 'pending').length} pending · {DCI_PUBLICATION.cadence}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10.5px] text-ink-3 flex-shrink-0 uppercase tracking-wide">
          <span>Methodology {DCI_PUBLICATION.methodology_version}</span>
          {DCI_PUBLICATION.iosco_compliant && (
            <span className="px-1.5 py-px bg-canvas border border-[#0A1628]/30 rounded-sm text-[#0A1628] normal-case font-semibold">
              IOSCO
            </span>
          )}
        </div>
      </div>

      {/* Content grid — 12-col × 4-row */}
      <div className="flex-1 min-h-0 overflow-hidden p-1.5">
        <div className="h-full grid grid-cols-12 grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5">
          <IndicesStripPanel pubs={pubs} loading={loading} selected={selected} onSelect={setSelected} />
          <SelectedIndexDetailPanel pubs={pubs} loading={loading} selected={selected} />
          <ReferenceAssetsPanel selected={selected} />
          <VariableBasketsPanel />
          <ContributorCoveragePanel />
          {/* Publication Schedule moved to footer modal — accessible via
              "DCI Publication" link in the bottom footer next to Method v1.1.
              Static reference info doesn't deserve a workspace panel. */}
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
// (For decommissioning COST: positive = cost up = bad, so red. Inverted vs equities.)

// ── Panel: Indices Strip ─────────────────────────────────────────────
//
// Master selector. Horizontal scroll on small viewports. Each card
// shows Gross / NRO / Net + q/q delta + sparkline-or-history-grid.

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

interface IndicesStripProps {
  pubs:     DciPublication[]
  loading:  boolean
  selected: DciSeries
  onSelect: (s: DciSeries) => void
}

function IndicesStripPanel({ pubs, loading, selected, onSelect }: IndicesStripProps) {
  return (
    <div className="col-span-12 bg-panel border border-border rounded-sm overflow-hidden flex-shrink-0">
      <div className="h-7 px-3 flex items-center justify-between border-b border-border bg-titlebar">
        <div className="flex items-center gap-2">
          <span className="label-xs">DCI</span>
          <span className="text-ink-4 text-[10px]">·</span>
          <span className="text-[12.5px] font-semibold text-ink">Indices</span>
        </div>
        <span className="text-[10px] text-ink-4">Click to select · Gross / NRO / Net</span>
      </div>
      <div className="overflow-x-auto">
        <div className="flex divide-x divide-border min-w-max">
          {DCI_INDICES.map(idx => {
            const agg = aggregateForSeries(pubs, idx.series)
            const isSel = selected === idx.series
            const gross = agg.current?.gross_cost ?? null
            const nro   = agg.current?.material_recovery ?? null
            const net   = (gross != null && nro != null) ? gross - nro : null
            const grossPrev = agg.previous?.gross_cost ?? null
            const grossDelta = (gross != null && grossPrev != null && grossPrev !== 0)
              ? ((gross - grossPrev) / grossPrev) * 100
              : null
            const sparkValues = agg.history.map(p => p.gross_cost).filter((v): v is number => v != null)

            return (
              <button key={idx.series}
                      onClick={() => onSelect(idx.series)}
                      className={clsx(
                        'w-[200px] flex-shrink-0 text-left px-3 py-2 border-l-2 transition-colors',
                        isSel ? 'bg-active border-l-[#0A1628]' : 'hover:bg-raised border-l-transparent',
                      )}>
                {/* Ticker + status */}
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className={clsx('text-[12px] font-bold tabular-nums tracking-wide', isSel ? 'text-[#0A1628]' : 'text-ink')}>
                    {idx.ticker}
                  </span>
                  {idx.status === 'pending' && (
                    <span className="text-[8.5px] font-bold tracking-wider text-[#C4863A] bg-[#C4863A]/10 border border-[#C4863A]/30 px-1 py-px rounded-sm">
                      PENDING
                    </span>
                  )}
                </div>

                {/* Gross / NRO / Net stack */}
                <div className="space-y-0.5 text-[10.5px] leading-tight">
                  <div className="flex justify-between">
                    <span className="text-ink-4 uppercase tracking-wider text-[9px]">Gross</span>
                    <span className="text-[14px] font-bold text-[#0A1628] tabular-nums">{fmtCurrency(gross, idx.ccy_symbol)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-4 uppercase tracking-wider text-[9px]">NRO</span>
                    <span className="text-[11px] text-[#007B8A] tabular-nums font-semibold">{fmtCurrency(nro, idx.ccy_symbol)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-4 uppercase tracking-wider text-[9px]">Net</span>
                    <span className="text-[11px] text-ink-2 tabular-nums">{fmtCurrency(net, idx.ccy_symbol)}</span>
                  </div>
                </div>

                {/* q/q delta */}
                <div className="mt-1.5 text-[10px] flex items-baseline gap-1">
                  <span className="text-ink-4 uppercase tracking-wider text-[9px]">Q/Q</span>
                  <span className={clsx('tabular-nums font-semibold', pctClass(grossDelta))}>{fmtPct(grossDelta)}</span>
                </div>

                {/* Spark / history-building */}
                <div className="mt-1 h-5">
                  {sparkValues.length >= 4 ? (
                    <MiniSpark values={sparkValues} />
                  ) : (
                    <div className="h-full text-[9px] text-ink-4 italic flex items-center">
                      history building · {sparkValues.length} pt{sparkValues.length === 1 ? '' : 's'}
                    </div>
                  )}
                </div>
              </button>
            )
          })}
          {loading && (
            <div className="px-4 py-4 text-[11px] text-ink-3 flex items-center">Loading…</div>
          )}
        </div>
      </div>
    </div>
  )
}

// Tiny inline sparkline using SVG. Bypasses Recharts overhead for these
// micro-charts; fine for ≥4 data points.
function MiniSpark({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const W = 180, H = 20
  const step = W / (values.length - 1)
  const points = values.map((v, i) => `${i * step},${H - ((v - min) / range) * H}`).join(' ')
  const last = values[values.length - 1]
  const first = values[0]
  const up = last >= first
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polyline fill="none" stroke={up ? '#0F8B58' : '#C73838'} strokeWidth={1.2} points={points} />
    </svg>
  )
}

// ── Panel: Selected Index Detail ─────────────────────────────────────

interface SelectedDetailProps {
  pubs:     DciPublication[]
  loading:  boolean
  selected: DciSeries
}

function SelectedIndexDetailPanel({ pubs, loading, selected }: SelectedDetailProps) {
  const meta = DCI_INDICES.find(i => i.series === selected)!
  const agg = aggregateForSeries(pubs, selected)
  const history = agg.history

  const subArchetypes = DCI_ARCHETYPES.filter(a => a.series === selected)

  return (
    <Panel label="DCI" title={`${meta.ticker} · Detail`} className="col-span-7">
      {loading ? (
        <div className="h-full flex items-center justify-center text-[12px] text-ink-3">Loading…</div>
      ) : (
        <div className="px-3 py-2 space-y-3 overflow-y-auto h-full">

          {/* Hero — Gross / NRO / Net */}
          <div className="grid grid-cols-3 gap-3 pb-3 border-b border-border">
            <HeroStat label="Gross cost" value={agg.current?.gross_cost} ccy={meta.ccy_symbol} bold />
            <HeroStat label="NRO"        value={agg.current?.material_recovery} ccy={meta.ccy_symbol} accent />
            <HeroStat label="Net"        value={(agg.current?.gross_cost != null && agg.current?.material_recovery != null) ? agg.current.gross_cost - agg.current.material_recovery : null} ccy={meta.ccy_symbol} />
          </div>

          {/* History — number grid until ≥4 quarters */}
          <div>
            <div className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider mb-1">
              Publication history · {history.length} pt{history.length === 1 ? '' : 's'}
            </div>
            {history.length === 0 ? (
              <div className="text-[11px] text-ink-3 italic px-2 py-3 bg-canvas border border-border rounded-sm">
                No publications yet. Next scheduled: {DCI_PUBLICATION.next_publication}.
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {history.slice(-8).map(p => (
                  <div key={p.publication_date} className="bg-canvas border border-border px-2 py-1 rounded-sm">
                    <div className="text-[9px] text-ink-4 uppercase tracking-wide">{p.publication_date}</div>
                    <div className="text-[12px] tabular-nums font-bold text-[#0A1628]">{fmtCurrency(p.gross_cost, meta.ccy_symbol)}</div>
                    <div className="text-[9px] tabular-nums text-[#007B8A]">NRO {fmtCurrency(p.material_recovery, meta.ccy_symbol)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cost decomposition */}
          {agg.current && (
            <div>
              <div className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider mb-1">
                Cost decomposition · {agg.current.publication_date}
              </div>
              <DecompositionBar current={agg.current} ccy={meta.ccy_symbol} />
            </div>
          )}

          {/* Sub-archetype weights */}
          <div>
            <div className="text-[10px] font-semibold text-ink-4 uppercase tracking-wider mb-1">
              Sub-archetype weights · {DCI_PUBLICATION.rebalance_date.split(' ').slice(-1)[0]} rebalance
            </div>
            <div className="space-y-1">
              {subArchetypes.map(a => (
                <div key={a.code} className="flex items-center gap-2 text-[10.5px]">
                  <span className="text-ink font-semibold tabular-nums w-24">{a.code}</span>
                  <div className="flex-1 h-2 bg-canvas border border-border rounded-sm overflow-hidden">
                    <div className="h-full bg-[#007B8A]" style={{ width: `${a.weight_pct}%` }} />
                  </div>
                  <span className="text-ink-2 tabular-nums w-10 text-right">{a.weight_pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Panel>
  )
}

function HeroStat({ label, value, ccy, bold = false, accent = false }: { label: string; value: number | null | undefined; ccy: string; bold?: boolean; accent?: boolean }) {
  return (
    <div>
      <div className="text-[9.5px] text-ink-4 uppercase tracking-wider">{label}</div>
      <div className={clsx(
        'tabular-nums leading-none mt-0.5',
        bold ? 'text-[22px] font-bold text-[#0A1628]'
             : accent ? 'text-[16px] font-semibold text-[#007B8A]'
                      : 'text-[16px] font-semibold text-ink-2',
      )}>
        {fmtCurrency(value, ccy)}
      </div>
      <div className="text-[8.5px] text-ink-4 uppercase tracking-wider mt-0.5">per MW</div>
    </div>
  )
}

function DecompositionBar({ current, ccy }: { current: DciPublication; ccy: string }) {
  // Sum the available cost segments
  const segments = [
    { label: 'Labour',     value: 0, color: '#0A1628' },  // not stored separately — placeholder
    { label: 'Transport',  value: current.blade_transport ?? current.scrap_haulage ?? 0, color: '#1C3D52' },
    { label: 'Gate fees',  value: current.blade_gate_fees ?? 0, color: '#2A7F8E' },
    { label: 'Disposal',   value: current.disposal_costs ?? 0, color: '#3D6E7A' },
  ].filter(s => s.value > 0)
  const total = segments.reduce((s, sg) => s + sg.value, 0)
  if (total === 0) {
    return <div className="text-[10px] text-ink-4 italic">Decomposition data not yet published for this publication.</div>
  }
  return (
    <div>
      <div className="flex h-3 rounded-sm overflow-hidden border border-border mb-1">
        {segments.map(s => (
          <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label}: ${fmtCurrency(s.value, ccy)}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9.5px] text-ink-3">
        {segments.map(s => (
          <span key={s.label} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />
            {s.label} {fmtCurrency(s.value, ccy)}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Panel: Reference Assets & Scope ─────────────────────────────────

function ReferenceAssetsPanel({ selected }: { selected: DciSeries }) {
  const meta = DCI_INDICES.find(i => i.series === selected)!
  const archetypes = DCI_ARCHETYPES.filter(a => a.series === selected)
  const scope = DCI_SCOPE.find(s => s.asset_class === meta.asset_class)!

  return (
    <Panel label="DCI" title={`Reference Assets & Scope · ${meta.ticker}`} className="col-span-5">
      <div className="overflow-y-auto h-full">

        {/* Scope — promoted to top, prominent */}
        <div className="px-3 py-2 border-b border-border bg-canvas/30">
          <div className="grid grid-cols-2 gap-3">
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
        </div>

        {/* Reference archetypes */}
        <div className="px-3 py-2 space-y-2">
          <div className="text-[10px] font-bold text-ink-4 uppercase tracking-wider">Reference archetypes</div>
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
                {a.hub_height_m && <> · {a.hub_height_m}m hub</>} · {a.project_size_mw} MW project
              </div>
              <div className="text-[10px] text-ink-3 mt-0.5">
                {a.geography} · ~{a.vintage_circa} vintage · {a.operator_typology}
              </div>
            </div>
          ))}
          <div className="text-[9px] text-ink-4 italic mt-1">
            Weights rebalanced {DCI_PUBLICATION.rebalance_date}. Source: {DCI_REBALANCE_SOURCE[meta.asset_class]}
          </div>
        </div>
      </div>
    </Panel>
  )
}

// ── Panel: Variable Baskets ─────────────────────────────────────────

function VariableBasketsPanel() {
  const grouped = useMemo(() => {
    const out: Record<DciCategory, typeof DCI_VARIABLES> = {
      'Crane': [], 'Labour': [], 'Transport': [], 'Gate fees': [], 'Material recovery': [],
    }
    for (const v of DCI_VARIABLES) out[v.category].push(v)
    return out
  }, [])
  const order: DciCategory[] = ['Crane', 'Labour', 'Transport', 'Gate fees', 'Material recovery']

  return (
    <Panel label="DCI" title="Variable Baskets" className="col-span-12">
      <div className="overflow-y-auto h-full">
        <table className="w-full">
          <thead>
            <tr className="bg-titlebar border-b border-border sticky top-0 z-10">
              <th className="px-2.5 py-1 text-left  text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide" style={{ width: '28%' }}>Variable</th>
              <th className="px-2.5 py-1 text-left  text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide" style={{ width: '15%' }}>Applies to</th>
              <th className="px-2.5 py-1 text-left  text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide" style={{ width: '12%' }}>Sourcing</th>
              <th className="px-2.5 py-1 text-left  text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide" style={{ width: '20%' }}>Type</th>
              <th className="px-2.5 py-1 text-left  text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide" style={{ width: '10%' }}>Refresh</th>
              <th className="px-2.5 py-1 text-left  text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Note</th>
            </tr>
          </thead>
          <tbody>
            {order.flatMap(cat => [
              <tr key={`hdr-${cat}`} className="bg-canvas/50 border-b border-border/60">
                <td colSpan={6} className="px-2.5 py-0.5 text-[10px] font-bold text-[#0A1628] uppercase tracking-wider">
                  {cat} ({grouped[cat].length})
                </td>
              </tr>,
              ...grouped[cat].map((v, i) => (
                <tr key={`${cat}-${i}`} className="border-b border-border/70 hover:bg-raised">
                  <td className="px-2.5 py-1 text-[11px] text-ink font-medium">{v.variable}</td>
                  <td className="px-2.5 py-1 text-[10px] text-ink-3 uppercase tracking-wide">{v.applies_to.join(' · ')}</td>
                  <td className="px-2.5 py-1">
                    <span className={clsx(
                      'text-[9px] font-bold px-1.5 py-px rounded-sm tracking-wider border',
                      v.sourcing === 'PRIMARY'
                        ? 'bg-[#C4863A]/10 text-[#C4863A] border-[#C4863A]/40'
                        : 'bg-[#007B8A]/10 text-[#007B8A] border-[#007B8A]/40',
                    )}>
                      {v.sourcing}
                    </span>
                  </td>
                  <td className="px-2.5 py-1 text-[10.5px] text-ink-2">{v.source_type}</td>
                  <td className="px-2.5 py-1 text-[10.5px] text-ink-3">{v.refresh_cadence}</td>
                  <td className="px-2.5 py-1 text-[10px] text-ink-4 leading-snug">{v.note ?? ''}</td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
        <div className="px-3 py-1.5 border-t border-border bg-canvas/30 text-[9.5px] text-ink-4 leading-snug">
          <span className="font-semibold text-[#C4863A] mr-1">PRIMARY</span> = contributor data (Endenex moat, no public benchmark) ·
          <span className="font-semibold text-[#007B8A] mx-1">PUBLIC</span> = independently verifiable benchmark (vendor names omitted to protect strategic positioning)
        </div>
      </div>
    </Panel>
  )
}

// ── Panel: Contributor Coverage ──────────────────────────────────────

function ContributorCoveragePanel() {
  return (
    <Panel label="DCI" title="Contributor Coverage" className="col-span-12">
      <div className="px-3 py-2">
        <div className="space-y-1">
          {DCI_CONTRIBUTOR_COVERAGE.map(c => {
            const meta = DCI_INDICES.find(i => i.series === c.series)!
            const aboveAt = c.contributors >= DCI_CONTRIBUTOR_THRESHOLD
            return (
              <div key={c.series} className="flex items-center gap-3 text-[10.5px] py-1 border-b border-border/50 last:border-b-0">
                <span className="font-bold text-[#0A1628] tabular-nums w-20">{meta.ticker}</span>
                <span className="text-ink-2 flex-1 truncate">{meta.label}</span>
                <span className="text-ink tabular-nums font-semibold">{c.contributors}</span>
                <span className="text-ink-4 text-[9.5px] uppercase tracking-wider w-24">
                  {aboveAt ? (
                    <span className="text-emerald-700">✓ above threshold</span>
                  ) : (
                    <span className="text-amber-700">⚠ pre-threshold</span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
        <div className="mt-2 pt-2 border-t border-border text-[9.5px] text-ink-4 leading-snug">
          Anonymisation threshold = {DCI_CONTRIBUTOR_THRESHOLD} contributors per index. Below threshold an index builds quietly until coverage is sufficient to publish without re-identification risk.
        </div>
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
