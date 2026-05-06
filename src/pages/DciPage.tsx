// ── DCI Dashboard — Tab 02 ───────────────────────────────────────────────────
// BloombergNEF light. 12-col grid. Charts capped at 1/3 width.

import { useState, useEffect, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { DciCostWaterfall } from '@/components/charts/DciCostWaterfall'
import { DciSeriesOverlay } from '@/components/charts/DciSeriesOverlay'
import { Sparklines, SparklinesLine, SparklinesSpots } from '@/components/charts/Sparklines'

type DciSeries =
  | 'dci_wind_europe'
  | 'dci_wind_north_america'
  | 'dci_solar_europe'
  | 'dci_solar_north_america'
  | 'dci_solar_japan'

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

const HEADLINE_SERIES: { series: DciSeries; ticker: string; region: string; ccy: string; status: 'live' | 'pending' }[] = [
  { series: 'dci_wind_europe',         ticker: 'DCIW.EU',  region: 'EU + UK · DE anchor',    ccy: '€', status: 'live'    },
  { series: 'dci_wind_north_america',  ticker: 'DCIW.NA',  region: 'US + CA · US anchor',    ccy: '$', status: 'live'    },
  { series: 'dci_solar_europe',        ticker: 'DCIS.EU',  region: 'EU + UK · Phase 2',      ccy: '€', status: 'pending' },
  { series: 'dci_solar_north_america', ticker: 'DCIS.NA',  region: 'US + CA · Phase 2',      ccy: '$', status: 'pending' },
  { series: 'dci_solar_japan',         ticker: 'DCIS.JP',  region: 'JP only · Phase 2',      ccy: '¥', status: 'pending' },
]

const SUB_SERIES: { series: DciSeries; label: string }[] = [
  { series: 'dci_wind_europe',        label: 'WIND.EU' },
  { series: 'dci_wind_north_america', label: 'WIND.NA' },
]

const CURRENCY_SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' }

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try {
    return new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
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
  if (Math.abs(val) >= 1000) return `${sym}${(val / 1000).toFixed(1)}k`
  return `${sym}${Math.round(val).toLocaleString('en-GB')}`
}

function fmtIndex(val: number | null): string {
  if (val == null) return '—'
  return val.toFixed(2)
}

function Direction({ current, prior }: { current: number | null; prior: number | null }) {
  if (current == null || prior == null || prior === 0) return <span className="text-ink-4">—</span>
  const pct = ((current - prior) / prior) * 100
  if (Math.abs(pct) < 0.01) return <span className="text-ink-4">—</span>
  const up = pct > 0
  return (
    <span className={clsx('tabular-nums font-semibold text-[11.5px]', up ? 'text-down' : 'text-up')}>
      {up ? '▲' : '▼'}{Math.abs(pct).toFixed(2)}%
    </span>
  )
}

// Headline ticker row
function HeadlineRow({
  seriesDef, latest, prior, history, idx, total,
}: {
  seriesDef: typeof HEADLINE_SERIES[0]
  latest:    DciPublication | null
  prior:     DciPublication | null
  history:   DciPublication[]
  idx:       number
  total:     number
}) {
  const pending = seriesDef.status === 'pending'
  const sym     = CURRENCY_SYMBOL[latest?.currency ?? ''] ?? seriesDef.ccy

  const sparkValues = useMemo(() => {
    return history
      .filter(p => p.series === seriesDef.series && p.index_value != null)
      .sort((a, b) => a.publication_date.localeCompare(b.publication_date))
      .slice(-12)
      .map(p => p.index_value as number)
  }, [history, seriesDef.series])

  return (
    <div className={clsx(
      'flex items-center gap-3 px-3 py-2 hover:bg-raised transition-colors',
      idx < total - 1 && 'border-r border-border',
    )}>
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={clsx(
            'text-[11.5px] font-bold tracking-[0.06em]',
            pending ? 'text-ink-4' : 'text-teal',
          )}>
            {seriesDef.ticker}
          </span>
          {pending && (
            <span className="text-[9.5px] uppercase tracking-wider text-ink-4 border border-border px-1 py-px rounded-sm">PEND</span>
          )}
        </div>
        <span className="text-[10.5px] text-ink-3 leading-tight truncate mt-px">{seriesDef.region}</span>
      </div>

      <div className="flex flex-col items-end min-w-0">
        {pending ? (
          <span className="text-[16px] font-semibold text-ink-4 tabular-nums leading-none">—</span>
        ) : latest == null ? (
          <span className="text-[16px] font-semibold text-ink-4 tabular-nums leading-none">—</span>
        ) : (
          <>
            <span className="text-[16px] font-semibold text-ink tabular-nums leading-none">
              {fmtIndex(latest.index_value)}
            </span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <Direction current={latest.index_value} prior={prior?.index_value ?? null} />
              <span className="text-[10.5px] text-ink-3 tabular-nums">
                {sym}{fmtMoney(latest.net_liability, latest.currency).replace(sym, '')}<span className="text-ink-4">/MW</span>
              </span>
            </div>
          </>
        )}
      </div>

      {!pending && sparkValues.length >= 2 && (
        <div className="flex-shrink-0 ml-1">
          <Sparklines data={sparkValues} width={56} height={22}>
            <SparklinesLine color="#0E7A86" strokeWidth={1.3} />
            <SparklinesSpots color="#0E7A86" size={1.6} />
          </Sparklines>
        </div>
      )}
    </div>
  )
}

// Index history chart
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

  const currency = HEADLINE_SERIES.find(s => s.series === activeSeries)?.ccy ?? '€'

  if (loading) {
    return <div className="h-48 flex items-center justify-center text-[11px] text-ink-3 uppercase tracking-wider">loading</div>
  }
  if (seriesData.length < 2) {
    return <div className="h-48 flex items-center justify-center text-[11.5px] text-ink-4">—</div>
  }
  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={seriesData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#E5E8EC" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtShortDate}
                 tick={{ fill: '#98A1AE', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#98A1AE', fontSize: 11 }} axisLine={false} tickLine={false} width={36} domain={['auto','auto']} />
          <ReferenceLine y={100} stroke="#D6DBE0" strokeDasharray="3 2" />
          <Tooltip
            contentStyle={{ background: '#FFFFFF', border: '1px solid #D6DBE0', borderRadius: 2, fontSize: 12, color: '#0A1628' }}
            labelFormatter={(label: unknown) => fmtDate(label as string)}
            formatter={(val: unknown, name: unknown) => {
              const v = val as number
              return (name as string) === 'index'
                ? [v.toFixed(2), 'Idx']
                : [`${currency}${Math.round(v).toLocaleString('en-GB')}/MW`, 'Net']
            }}
          />
          <Line type="monotone" dataKey="index" stroke="#0E7A86" strokeWidth={1.6}
                dot={{ r: 2, fill: '#0E7A86', strokeWidth: 0 }}
                activeDot={{ r: 3.5, fill: '#14A4B4' }}
                isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// Cost component table
function ComponentTable({ pub }: { pub: DciPublication | null }) {
  if (!pub) {
    return <div className="px-3 py-4 text-[11.5px] text-ink-4 text-center">—</div>
  }
  const sym = CURRENCY_SYMBOL[pub.currency] ?? ''
  const rows: { label: string; value: number | null; indent?: boolean; sep?: boolean; sum?: boolean }[] = [
    { label: 'Gross cost',            value: pub.gross_cost },
    { sep: true, label: '', value: null },
    { label: 'Material recovery',     value: pub.material_recovery },
    { label: 'Ferrous',  value: pub.recovery_ferrous,   indent: true },
    { label: 'Copper',   value: pub.recovery_copper,    indent: true },
    { label: 'Aluminium',value: pub.recovery_aluminium, indent: true },
    { sep: true, label: '', value: null },
    { label: 'Disposal costs',        value: pub.disposal_costs    ? -pub.disposal_costs    : null },
    { label: 'Blade transport',       value: pub.blade_transport   ? -pub.blade_transport   : null, indent: true },
    { label: 'Gate fees',             value: pub.blade_gate_fees   ? -pub.blade_gate_fees   : null, indent: true },
    { label: 'Scrap haulage',         value: pub.scrap_haulage     ? -pub.scrap_haulage     : null, indent: true },
    { sep: true, label: '', value: null },
    { label: 'Net material position', value: pub.net_material_position },
    { sep: true, label: '', value: null },
    { label: 'Net liability',         value: pub.net_liability, sum: true },
  ]
  return (
    <div>
      {rows.map((row, i) => {
        if (row.sep) return <div key={i} className="h-px bg-border" />
        const isPos = (row.value ?? 0) >= 0
        return (
          <div key={i} className={clsx(
            'flex items-center justify-between px-3 py-1.5',
            row.sum && 'bg-titlebar',
          )}>
            <span className={clsx(
              'text-[12.5px]',
              row.indent  && 'pl-3 text-ink-3',
              !row.indent && (row.sum ? 'text-ink font-semibold' : 'text-ink-2'),
            )}>{row.label}</span>
            <span className={clsx(
              'text-[12.5px] tabular-nums',
              row.sum     ? 'text-ink font-semibold' :
              !row.indent && row.value != null ? (isPos ? 'text-down' : 'text-up') :
              row.indent  ? 'text-ink-3' : 'text-ink-2',
            )}>
              {row.value != null
                ? `${sym}${Math.abs(Math.round(row.value)).toLocaleString('en-GB')}`
                : '—'}
              {row.value != null && <span className="text-[10.5px] text-ink-4 ml-0.5">/MW</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// Local panel chrome with denser titlebar
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
        {meta && <div className="text-[10.5px] text-ink-3 flex items-center gap-2">{meta}</div>}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {children}
      </div>
    </div>
  )
}

// Main page
export function DciPage() {
  const [history,     setHistory]     = useState<DciPublication[]>([])
  const [loading,     setLoading]     = useState(true)
  const [chartSeries, setChartSeries] = useState<DciSeries>('dci_wind_europe')

  useEffect(() => {
    supabase
      .from('dci_publications').select('*')
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

  const breakdownPub = latestByS['dci_wind_europe'] ?? latestByS['dci_wind_north_america'] ?? null
  const latestPub    = latestByS['dci_wind_europe'] ?? latestByS['dci_wind_north_america']

  return (
    <div className="flex flex-col h-full overflow-hidden bg-page">

      {/* Page header strip */}
      <div className="flex-shrink-0 h-9 px-3 border-b border-border bg-canvas flex items-center justify-between">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[13px] font-semibold text-ink uppercase tracking-wide">Decommissioning Cost Index</h1>
          <span className="text-[11.5px] text-ink-3">Independent benchmark · onshore wind decommissioning liability</span>
        </div>
        <div className="flex items-center gap-3 text-[10.5px] text-ink-3 flex-shrink-0 uppercase tracking-wide">
          {latestPub && (
            <>
              <span>Latest <span className="text-ink ml-1 normal-case tabular-nums">{fmtDate(latestPub.publication_date)}</span></span>
              <span className="cell-divider" />
              <span>Method <span className="text-ink ml-1 normal-case">v{latestPub.methodology_version ?? '1.1'}</span></span>
              <span className="cell-divider" />
              <span>Cadence <span className="text-ink ml-1 normal-case">Monthly</span></span>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-1.5 space-y-1.5">

        {/* ── Row 1: 5 headline ticker rows ─────────────────────────────── */}
        <div className="bg-panel border border-border rounded-sm">
          <div className="h-6 px-3 flex items-center border-b border-border bg-titlebar">
            <span className="label-xs">DCI Spot Indices · 5-card lineup</span>
            <span className="ml-auto text-[10.5px] text-ink-3 uppercase tracking-wide">12-month sparkline</span>
          </div>
          <div className="grid grid-cols-5">
            {HEADLINE_SERIES.map((s, i) => (
              <HeadlineRow
                key={s.series}
                seriesDef={s}
                latest={latestByS[s.series] ?? null}
                prior={priorByS[s.series] ?? null}
                history={history}
                idx={i}
                total={HEADLINE_SERIES.length}
              />
            ))}
          </div>
        </div>

        {/* ── Row 2: 3 charts side-by-side at col-span-4 each ─────────────── */}
        <div className="grid grid-cols-12 gap-1.5">
          <Panel label="DCI" title="Series Comparison" className="col-span-4 min-h-[240px]"
                 meta={<span>Indexed · base 100</span>}>
            <div className="p-2">
              <DciSeriesOverlay history={history} />
            </div>
          </Panel>

          <Panel label="DCI" title="Cost Waterfall" className="col-span-4 min-h-[240px]"
                 meta={breakdownPub && <span>{HEADLINE_SERIES.find(s => s.series === breakdownPub.series)?.ticker} · {fmtDate(breakdownPub.publication_date)}</span>}>
            <div className="p-2">
              <DciCostWaterfall pub={breakdownPub} />
            </div>
          </Panel>

          <Panel label="DCI" title="Index History" className="col-span-4 min-h-[240px]"
                 meta={
                   <div className="flex items-center gap-px">
                     {SUB_SERIES.map(s => {
                       const has = history.some(p => p.series === s.series)
                       return (
                         <button key={s.series} onClick={() => setChartSeries(s.series)} disabled={!has}
                           className={clsx(
                             'px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase rounded-sm',
                             chartSeries === s.series ? 'bg-active text-teal' : has ? 'text-ink-3 hover:text-ink' : 'text-ink-4',
                           )}>
                           {s.label}
                         </button>
                       )
                     })}
                   </div>
                 }>
            <div className="p-2">
              <DciChart history={history} activeSeries={chartSeries} loading={loading} />
            </div>
          </Panel>
        </div>

        {/* ── Row 3: components table (col-6) + intended use (col-6) ─────── */}
        <div className="grid grid-cols-12 gap-1.5">
          <Panel label="DCI" title="Cost Components" className="col-span-6"
                 meta={breakdownPub && <span>{HEADLINE_SERIES.find(s => s.series === breakdownPub.series)?.ticker} · {fmtDate(breakdownPub.publication_date)}</span>}>
            <ComponentTable pub={breakdownPub} />
          </Panel>

          <Panel label="DCI" title="Intended Use" className="col-span-6">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 p-3">
              {[
                'Benchmark ARO / decommissioning provisions',
                'Assess reserve adequacy',
                'Support repowering decisions',
                'Inform M&A due diligence',
                'Support lender and IC review',
                'Track portfolio-level liability',
                'Evidence cost inflation in EOL obligations',
                'Stress-test for surety / IFRS IAS 37',
              ].map(use => (
                <div key={use} className="flex items-start gap-2">
                  <div className="w-1 h-1 rounded-full bg-teal mt-1.5 flex-shrink-0" />
                  <span className="text-[12px] text-ink-2 leading-snug">{use}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-3 py-2">
              <p className="text-[11.5px] text-ink-3 leading-relaxed">
                <span className="text-ink-2 font-semibold">DCI Spot Wind</span> tracks the market price of decommissioning a fixed onshore wind reference asset as cost drivers move. It is not a site-specific budget or contractor quote.
              </p>
            </div>
          </Panel>
        </div>

      </div>
    </div>
  )
}
