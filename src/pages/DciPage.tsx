// ── DCI Dashboard — Tab 02 ───────────────────────────────────────────────────
// Spec: Product Brief v1.0 §6.2
//
// Decommissioning Cost Index — independent benchmark for onshore wind
// decommissioning liability. Published monthly (or quarterly).
//
// Layout:
//   Two headline index cards (Europe Wind, US Wind)
//   Index history line chart with series switcher
//   Cost component breakdown table (latest publication)
//   Intended use note

import { useState, useEffect, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

type DciSeries = 'europe_wind' | 'us_wind' | 'uk_wind' | 'eu_exuk_wind'

interface DciPublication {
  id:                    string
  series:                DciSeries
  publication_date:      string
  index_value:           number | null
  index_base_date:       string | null
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
  notes:                 string | null
  is_published:          boolean
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HEADLINE_SERIES: { series: DciSeries; label: string; sublabel: string; currency: string }[] = [
  { series: 'europe_wind', label: 'DCI Spot Europe Wind', sublabel: 'EUR / MW  ·  European onshore wind composite', currency: 'EUR' },
  { series: 'us_wind',     label: 'DCI Spot US Wind',     sublabel: 'USD / MW  ·  US onshore wind', currency: 'USD' },
]

const SUB_SERIES: { series: DciSeries; label: string }[] = [
  { series: 'europe_wind',  label: 'Europe Wind' },
  { series: 'us_wind',      label: 'US Wind' },
  { series: 'uk_wind',      label: 'UK sub-series' },
  { series: 'eu_exuk_wind', label: 'EU ex-UK sub-series' },
]

const CURRENCY_SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try {
    return new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '—' }
}

function fmtShortDate(val: string): string {
  try {
    return new Date(val).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
  } catch { return val }
}

function fmtMoney(val: number | null, currency: string): string {
  if (val == null) return '—'
  const sym = CURRENCY_SYMBOL[currency] ?? ''
  return `${sym}${Math.round(val).toLocaleString('en-GB')}`
}

function fmtIndex(val: number | null): string {
  if (val == null) return '—'
  return val.toFixed(2)
}

// ── Direction indicator ───────────────────────────────────────────────────────
// For a liability index: UP = cost rising = red; DOWN = cost falling = green

function Direction({ current, prior }: { current: number | null; prior: number | null }) {
  if (current == null || prior == null || prior === 0) return null
  const pct = ((current - prior) / prior) * 100
  if (Math.abs(pct) < 0.01) return <span className="text-ink-3 text-[12px]">—</span>
  const up = pct > 0
  return (
    <span className={clsx('inline-flex items-center gap-1 text-[13px] font-medium tabular-nums', up ? 'text-down' : 'text-up')}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

// ── Headline card ─────────────────────────────────────────────────────────────

function HeadlineCard({
  seriesDef, latest, prior, loading,
}: {
  seriesDef: typeof HEADLINE_SERIES[0]
  latest:    DciPublication | null
  prior:     DciPublication | null
  loading:   boolean
}) {
  const sym = CURRENCY_SYMBOL[seriesDef.currency] ?? ''

  return (
    <div className="flex-1 border border-border rounded-lg bg-panel p-6 min-w-0 shadow-panel">
      <div className="mb-4">
        <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-0.5">
          {seriesDef.label}
        </div>
        <div className="text-[11px] text-ink-3">{seriesDef.sublabel}</div>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-10 w-40 bg-page rounded" />
          <div className="h-4 w-28 bg-page rounded" />
        </div>
      ) : latest == null ? (
        <div className="space-y-2">
          <div className="text-[36px] font-semibold text-border tabular-nums leading-none">—</div>
          <p className="text-[11.5px] text-ink-3 leading-relaxed max-w-xs mt-2">
            First publication pending. The index will appear once the methodology is complete and the first observation is entered.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Index value */}
          <div className="flex items-end gap-4">
            <div>
              <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-1">Index</div>
              <div className="text-[36px] font-semibold text-ink tabular-nums leading-none">
                {fmtIndex(latest.index_value)}
              </div>
            </div>
            <div className="pb-1">
              <Direction current={latest.index_value} prior={prior?.index_value ?? null} />
            </div>
          </div>

          {/* Net liability + metadata */}
          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
            <div>
              <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-1">Net liability</div>
              <div className="text-[18px] font-semibold text-ink tabular-nums">
                {fmtMoney(latest.net_liability, latest.currency)}
                <span className="text-[11px] text-ink-3 font-normal ml-1">/MW</span>
              </div>
              {latest.net_liability_low != null && latest.net_liability_high != null && (
                <div className="text-[11px] text-ink-3 mt-0.5 tabular-nums">
                  {sym}{Math.round(latest.net_liability_low).toLocaleString('en-GB')} –{' '}
                  {sym}{Math.round(latest.net_liability_high).toLocaleString('en-GB')}
                </div>
              )}
            </div>
            <div>
              <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-1">Published</div>
              <div className="text-[13px] font-medium text-ink-2">{fmtDate(latest.publication_date)}</div>
              {latest.methodology_version && (
                <div className="text-[11px] text-ink-3 mt-0.5">v{latest.methodology_version}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Index chart ───────────────────────────────────────────────────────────────

function DciChart({
  history, activeSeries, loading,
}: {
  history:      DciPublication[]
  activeSeries: DciSeries
  loading:      boolean
}) {
  const seriesData = useMemo(() => {
    return history
      .filter(p => p.series === activeSeries && p.index_value != null)
      .sort((a, b) => a.publication_date.localeCompare(b.publication_date))
      .map(p => ({
        date:          p.publication_date,
        index:         p.index_value,
        net_liability: p.net_liability,
        currency:      p.currency,
      }))
  }, [history, activeSeries])

  const currency = HEADLINE_SERIES.find(s => s.series === activeSeries)?.currency ?? 'EUR'
  const sym      = CURRENCY_SYMBOL[currency] ?? ''

  if (loading) {
    return (
      <div className="h-56 flex items-center justify-center">
        <div className="w-full h-40 bg-page rounded animate-pulse" />
      </div>
    )
  }

  if (seriesData.length < 2) {
    return (
      <div className="h-56 flex flex-col items-center justify-center text-center gap-2">
        <div className="text-border text-2xl">◎</div>
        <p className="text-[11.5px] text-ink-3 max-w-xs leading-relaxed">
          Chart populates once at least two publications are entered. The index tracks cost movement against the base period (100).
        </p>
      </div>
    )
  }

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={seriesData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E8EC" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtShortDate}
            tick={{ fill: '#98A1AE', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#98A1AE', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={40}
            domain={['auto', 'auto']}
          />
          <ReferenceLine y={100} stroke="#D0D5DB" strokeDasharray="4 2" />
          <Tooltip
            contentStyle={{
              background: '#FFFFFF', border: '1px solid #E5E8EC',
              borderRadius: 6, fontSize: 11, color: '#0A1628',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}
            labelFormatter={(label: unknown) => fmtDate(label as string)}
            formatter={(val: unknown, name: unknown) => {
              const v = val as number
              return (name as string) === 'index'
                ? [`${v.toFixed(2)}`, 'Index']
                : [`${sym}${Math.round(v).toLocaleString('en-GB')}/MW`, 'Net liability']
            }}
          />
          <Line
            type="monotone"
            dataKey="index"
            stroke="#007B8A"
            strokeWidth={1.5}
            dot={{ r: 3, fill: '#007B8A', strokeWidth: 0 }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Cost component breakdown ──────────────────────────────────────────────────

function ComponentTable({ pub, loading }: { pub: DciPublication | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-3 px-5 py-4 animate-pulse">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex justify-between">
            <div className="h-3 bg-page rounded w-36" />
            <div className="h-3 bg-page rounded w-24" />
          </div>
        ))}
      </div>
    )
  }

  if (!pub) {
    return (
      <div className="px-5 py-6 text-[11.5px] text-ink-3 text-center">
        Component data will appear once the first publication is entered.
      </div>
    )
  }

  const sym = CURRENCY_SYMBOL[pub.currency] ?? ''

  const rows: {
    label: string; value: number | null;
    indent?: boolean; separator?: boolean; highlight?: boolean
  }[] = [
    { label: 'Gross cost',           value: pub.gross_cost },
    { separator: true, label: '', value: null },
    { label: 'Material recovery',    value: pub.material_recovery },
    { label: 'Ferrous steel',        value: pub.recovery_ferrous,   indent: true },
    { label: 'Copper',               value: pub.recovery_copper,    indent: true },
    { label: 'Aluminium',            value: pub.recovery_aluminium, indent: true },
    { separator: true, label: '', value: null },
    { label: 'Disposal costs',       value: pub.disposal_costs    ? -pub.disposal_costs    : null },
    { label: 'Blade transport',      value: pub.blade_transport   ? -pub.blade_transport   : null, indent: true },
    { label: 'Blade gate fees',      value: pub.blade_gate_fees   ? -pub.blade_gate_fees   : null, indent: true },
    { label: 'Scrap haulage',        value: pub.scrap_haulage     ? -pub.scrap_haulage     : null, indent: true },
    { separator: true, label: '', value: null },
    { label: 'Net material position', value: pub.net_material_position },
    { separator: true, label: '', value: null },
    { label: 'Net liability',        value: pub.net_liability, highlight: true },
  ]

  return (
    <div className="divide-y divide-border">
      {rows.map((row, i) => {
        if (row.separator) return <div key={i} className="h-px" />
        const isPos = (row.value ?? 0) >= 0
        return (
          <div
            key={i}
            className={clsx(
              'flex items-center justify-between px-5 py-2.5',
              row.highlight ? 'bg-page' : '',
            )}
          >
            <span className={clsx(
              'text-[11.5px]',
              row.indent    ? 'pl-4 text-ink-3' : 'text-ink-2',
              row.highlight ? 'font-semibold text-ink' : '',
            )}>
              {row.label}
            </span>
            <span className={clsx(
              'text-[11.5px] tabular-nums',
              row.highlight ? 'font-semibold text-ink' :
              !row.indent && row.value != null ? (isPos ? 'text-down' : 'text-up') :
              row.indent ? 'text-ink-3' : 'text-ink-2',
            )}>
              {row.value != null
                ? `${sym}${Math.abs(Math.round(row.value)).toLocaleString('en-GB')}`
                : '—'}
              {row.value != null && <span className="text-[10px] text-ink-4 ml-0.5">/MW</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function DciPage() {
  const [history,     setHistory]     = useState<DciPublication[]>([])
  const [loading,     setLoading]     = useState(true)
  const [chartSeries, setChartSeries] = useState<DciSeries>('europe_wind')

  useEffect(() => {
    supabase
      .from('dci_publications')
      .select('*')
      .eq('is_published', true)
      .order('publication_date', { ascending: false })
      .then(({ data }) => {
        setHistory((data as DciPublication[]) ?? [])
        setLoading(false)
      })
  }, [])

  const latestByS = useMemo(() => {
    const map: Partial<Record<DciSeries, DciPublication>> = {}
    for (const p of history) { if (!map[p.series]) map[p.series] = p }
    return map
  }, [history])

  const priorByS = useMemo(() => {
    const seen = new Set<DciSeries>()
    const map:  Partial<Record<DciSeries, DciPublication>> = {}
    for (const p of history) {
      if (!seen.has(p.series)) { seen.add(p.series); continue }
      if (!map[p.series]) map[p.series] = p
    }
    return map
  }, [history])

  const breakdownPub = latestByS['europe_wind'] ?? latestByS['us_wind'] ?? null
  const latestPub    = latestByS['europe_wind'] ?? latestByS['us_wind']

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header strip */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-border bg-panel flex items-center justify-between">
        <div>
          <h1 className="text-[13px] font-semibold text-ink">Decommissioning Cost Index</h1>
          <p className="text-[11px] text-ink-3 mt-0.5">
            Independent benchmark for onshore wind decommissioning liability
          </p>
        </div>
        {latestPub && (
          <div className="flex items-center gap-4 text-[11px] text-ink-3 flex-shrink-0">
            <span>Latest · <span className="font-medium text-ink-2">{fmtDate(latestPub.publication_date)}</span></span>
            {latestPub.methodology_version && (
              <span>Version · <span className="font-medium text-ink-2">v{latestPub.methodology_version}</span></span>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-5 space-y-4">

          {/* ── Headline cards ─────────────────────────────────────────── */}
          <div className="flex gap-4">
            {HEADLINE_SERIES.map(s => (
              <HeadlineCard
                key={s.series}
                seriesDef={s}
                latest={latestByS[s.series] ?? null}
                prior={priorByS[s.series] ?? null}
                loading={loading}
              />
            ))}
          </div>

          {/* ── Index chart ─────────────────────────────────────────────── */}
          <div className="border border-border rounded-lg bg-panel overflow-hidden shadow-panel">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <span className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest">
                Index history · Base = 100
              </span>
              <div className="flex items-center gap-0">
                {SUB_SERIES.map(s => {
                  const hasData = history.some(p => p.series === s.series)
                  return (
                    <button
                      key={s.series}
                      onClick={() => setChartSeries(s.series)}
                      disabled={!hasData}
                      className={clsx(
                        'px-3 py-1 text-[10.5px] font-medium rounded transition-colors',
                        chartSeries === s.series
                          ? 'bg-active text-teal'
                          : hasData
                            ? 'text-ink-3 hover:text-ink-2'
                            : 'text-border cursor-default',
                      )}
                    >
                      {s.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="px-5 py-4">
              <DciChart history={history} activeSeries={chartSeries} loading={loading} />
            </div>
          </div>

          {/* ── Cost component breakdown ─────────────────────────────────── */}
          <div className="border border-border rounded-lg bg-panel overflow-hidden shadow-panel">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <span className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest">
                Cost components
              </span>
              {breakdownPub && (
                <span className="text-[11px] text-ink-3 ml-1">
                  · {HEADLINE_SERIES.find(s => s.series === breakdownPub.series)?.label}
                  · {fmtDate(breakdownPub.publication_date)}
                </span>
              )}
            </div>
            <ComponentTable pub={breakdownPub} loading={loading} />
          </div>

          {/* ── Intended use ─────────────────────────────────────────────── */}
          <div className="border border-border rounded-lg bg-page px-5 py-4">
            <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-3">
              Intended use
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
              {[
                'Benchmark ARO / decommissioning provisions',
                'Assess reserve adequacy',
                'Support repowering decisions',
                'Inform M&A due diligence',
                'Support lender and IC review',
                'Track portfolio-level liability movement',
                'Evidence cost inflation in end-of-life obligations',
              ].map(use => (
                <div key={use} className="flex items-start gap-2">
                  <div className="w-1 h-1 rounded-full bg-teal mt-1.5 flex-shrink-0" />
                  <span className="text-[11.5px] text-ink-3">{use}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-ink-4 mt-4 pt-3 border-t border-border leading-relaxed">
              DCI Spot Wind tracks the market price of decommissioning a fixed onshore wind reference asset as the underlying cost drivers move. It is not a site-specific budget or contractor quote.
            </p>
          </div>

        </div>
      </div>
    </div>
  )
}
