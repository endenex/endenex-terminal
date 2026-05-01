import { useState, useEffect, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { TopBar } from '@/components/layout/TopBar'
import type { TopBarMeta } from '@/components/layout/TopBar'
import { SkeletonBar } from '@/components/ui/Skeleton'

// ── Types ──────────────────────────────────────────────────────────────────────

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

// ── Constants ──────────────────────────────────────────────────────────────────

const HEADLINE_SERIES: { series: DciSeries; label: string; sublabel: string; currency: string }[] = [
  { series: 'europe_wind', label: 'DCI Spot Europe Wind', sublabel: 'EUR / MW  ·  European onshore wind composite', currency: 'EUR' },
  { series: 'us_wind',     label: 'DCI Spot US Wind',     sublabel: 'USD / MW  ·  US onshore wind',                currency: 'USD' },
]

const SUB_SERIES: { series: DciSeries; label: string }[] = [
  { series: 'europe_wind', label: 'Europe Wind' },
  { series: 'us_wind',     label: 'US Wind' },
  { series: 'uk_wind',     label: 'UK sub-series' },
  { series: 'eu_exuk_wind', label: 'EU ex-UK sub-series' },
]

const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: '€', USD: '$', GBP: '£',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try {
    return new Date(val).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
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

// ── Direction indicator ────────────────────────────────────────────────────────

function Direction({ current, prior }: { current: number | null; prior: number | null }) {
  if (current == null || prior == null || prior === 0) return null
  const pct = ((current - prior) / prior) * 100
  if (Math.abs(pct) < 0.01) return (
    <span className="text-terminal-muted text-xs font-mono">—</span>
  )
  const up = pct > 0
  return (
    <span className={clsx('inline-flex items-center gap-1 text-sm font-mono', up ? 'text-red-400' : 'text-emerald-400')}>
      {up ? '▲' : '▼'}
      <span>{Math.abs(pct).toFixed(1)}%</span>
    </span>
  )
}
// Note: for a liability index, UP is red (cost rising) and DOWN is green (cost falling)

// ── Headline card ──────────────────────────────────────────────────────────────

function HeadlineCard({
  seriesDef,
  latest,
  prior,
  loading,
}: {
  seriesDef:  typeof HEADLINE_SERIES[0]
  latest:     DciPublication | null
  prior:      DciPublication | null
  loading:    boolean
}) {
  const sym = CURRENCY_SYMBOL[seriesDef.currency] ?? ''

  return (
    <div className="flex-1 border border-terminal-border rounded bg-terminal-surface p-6 min-w-0">
      {/* Series label */}
      <div className="mb-4">
        <div className="text-[10px] font-mono text-terminal-muted tracking-widest uppercase mb-0.5">
          {seriesDef.label}
        </div>
        <div className="text-[11px] text-terminal-muted">{seriesDef.sublabel}</div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <SkeletonBar className="h-10 w-40" />
          <SkeletonBar className="h-4 w-28" />
        </div>
      ) : latest == null ? (
        <div className="space-y-2">
          <div className="text-3xl font-semibold text-terminal-border font-mono tracking-tight">—</div>
          <p className="text-xs text-terminal-muted leading-relaxed max-w-xs">
            First publication pending. Index values will appear here once the methodology is complete and the first observation is entered.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Index value (big number) */}
          <div className="flex items-end gap-4">
            <div>
              <div className="text-[10px] font-mono text-terminal-muted tracking-widest uppercase mb-0.5">
                Index
              </div>
              <div className="text-3xl font-semibold text-terminal-text font-mono tracking-tight">
                {fmtIndex(latest.index_value)}
              </div>
            </div>
            <div className="pb-1">
              <Direction current={latest.index_value} prior={prior?.index_value ?? null} />
            </div>
          </div>

          {/* Net liability */}
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-terminal-border">
            <div>
              <div className="text-[10px] font-mono text-terminal-muted tracking-widest uppercase mb-1">
                Net liability
              </div>
              <div className="text-lg font-semibold font-mono text-terminal-text">
                {fmtMoney(latest.net_liability, latest.currency)}
                <span className="text-[11px] text-terminal-muted font-normal ml-1">/MW</span>
              </div>
              {latest.net_liability_low != null && latest.net_liability_high != null && (
                <div className="text-[11px] font-mono text-terminal-muted mt-0.5">
                  {sym}{Math.round(latest.net_liability_low).toLocaleString('en-GB')} – {sym}{Math.round(latest.net_liability_high).toLocaleString('en-GB')}
                </div>
              )}
            </div>
            <div>
              <div className="text-[10px] font-mono text-terminal-muted tracking-widest uppercase mb-1">
                Published
              </div>
              <div className="text-sm font-mono text-terminal-text">{fmtDate(latest.publication_date)}</div>
              {latest.methodology_version && (
                <div className="text-[11px] font-mono text-terminal-muted mt-0.5">
                  v{latest.methodology_version}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Chart ──────────────────────────────────────────────────────────────────────

function DciChart({
  history,
  activeSeries,
  loading,
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
        date:           p.publication_date,
        index:          p.index_value,
        net_liability:  p.net_liability,
        currency:       p.currency,
      }))
  }, [history, activeSeries])

  const currency = HEADLINE_SERIES.find(s => s.series === activeSeries)?.currency ?? 'EUR'
  const sym      = CURRENCY_SYMBOL[currency] ?? ''

  if (loading) {
    return (
      <div className="h-56 flex items-center justify-center">
        <SkeletonBar className="h-40 w-full" />
      </div>
    )
  }

  if (seriesData.length < 2) {
    return (
      <div className="h-56 flex flex-col items-center justify-center text-center gap-2">
        <div className="text-terminal-border text-2xl">◎</div>
        <p className="text-xs text-terminal-muted max-w-xs leading-relaxed">
          Chart will populate once at least two publications are entered. The index tracks cost movement against the base period (100).
        </p>
      </div>
    )
  }

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={seriesData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#21262D" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtShortDate}
            tick={{ fill: '#7D8590', fontSize: 10, fontFamily: 'monospace' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#7D8590', fontSize: 10, fontFamily: 'monospace' }}
            axisLine={false}
            tickLine={false}
            width={40}
            domain={['auto', 'auto']}
          />
          <ReferenceLine y={100} stroke="#21262D" strokeDasharray="4 2" />
          <Tooltip
            contentStyle={{
              background: '#161B22', border: '1px solid #21262D',
              borderRadius: 4, fontSize: 11, fontFamily: 'monospace', color: '#E6EDF3',
            }}
            labelFormatter={fmtDate}
            formatter={(val: number, name: string) =>
              name === 'index'
                ? [`${val.toFixed(2)}`, 'Index']
                : [`${sym}${Math.round(val).toLocaleString('en-GB')}/MW`, 'Net liability']
            }
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

// ── Component breakdown ────────────────────────────────────────────────────────

function ComponentTable({
  pub,
  loading,
}: {
  pub:     DciPublication | null
  loading: boolean
}) {
  if (loading) return (
    <div className="space-y-2 px-5 py-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex justify-between">
          <SkeletonBar className="h-3 w-36" />
          <SkeletonBar className="h-3 w-24" />
        </div>
      ))}
    </div>
  )

  if (!pub) return (
    <div className="px-5 py-6 text-xs text-terminal-muted text-center">
      Component data will appear once the first publication is entered.
    </div>
  )

  const sym = CURRENCY_SYMBOL[pub.currency] ?? ''

  const rows: { label: string; value: number | null; indent?: boolean; separator?: boolean; highlight?: boolean }[] = [
    { label: 'Gross cost',             value: pub.gross_cost,             highlight: false },
    { separator: true, label: '', value: null },
    { label: 'Material recovery',      value: pub.material_recovery },
    { label: 'Ferrous steel',          value: pub.recovery_ferrous,   indent: true },
    { label: 'Copper',                 value: pub.recovery_copper,    indent: true },
    { label: 'Aluminium',              value: pub.recovery_aluminium, indent: true },
    { separator: true, label: '', value: null },
    { label: 'Disposal costs',         value: pub.disposal_costs ? -pub.disposal_costs : null },
    { label: 'Blade transport',        value: pub.blade_transport  ? -pub.blade_transport  : null, indent: true },
    { label: 'Blade gate fees',        value: pub.blade_gate_fees  ? -pub.blade_gate_fees  : null, indent: true },
    { label: 'Scrap haulage',          value: pub.scrap_haulage    ? -pub.scrap_haulage    : null, indent: true },
    { separator: true, label: '', value: null },
    { label: 'Net material position',  value: pub.net_material_position },
    { separator: true, label: '', value: null },
    { label: 'Net liability',          value: pub.net_liability, highlight: true },
  ]

  return (
    <div className="divide-y divide-terminal-border">
      {rows.map((row, i) => {
        if (row.separator) return <div key={i} className="h-px" />
        const isPos = (row.value ?? 0) >= 0
        return (
          <div
            key={i}
            className={clsx(
              'flex items-center justify-between px-5 py-2',
              row.highlight ? 'bg-terminal-black' : '',
            )}
          >
            <span className={clsx(
              'text-xs',
              row.indent     ? 'pl-4 text-terminal-muted' : 'text-terminal-text',
              row.highlight  ? 'font-semibold' : '',
            )}>
              {row.label}
            </span>
            <span className={clsx(
              'num text-xs',
              row.highlight  ? 'font-semibold text-terminal-text' : '',
              !row.highlight && row.value != null && !row.indent
                ? (isPos ? 'text-emerald-400' : 'text-red-400')
                : 'text-terminal-text',
              row.indent ? 'text-terminal-muted' : '',
            )}>
              {row.value != null
                ? `${sym}${Math.abs(Math.round(row.value)).toLocaleString('en-GB')}`
                : '—'
              }
              {row.value != null && <span className="unit">/MW</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function DciPage() {
  const [history, setHistory] = useState<DciPublication[]>([])
  const [loading, setLoading] = useState(true)
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

  // Latest and prior per headline series
  const latestByS = useMemo(() => {
    const map: Partial<Record<DciSeries, DciPublication>> = {}
    for (const p of history) {
      if (!map[p.series]) map[p.series] = p
    }
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

  const topBarMeta = useMemo((): TopBarMeta[] => {
    const latest = latestByS['europe_wind'] ?? latestByS['us_wind']
    if (!latest) return [{ label: 'Status', value: 'First publication pending' }]
    return [
      { label: 'Latest publication', value: fmtDate(latest.publication_date) },
      { label: 'Version', value: latest.methodology_version ? `v${latest.methodology_version}` : '—' },
    ]
  }, [latestByS])

  // Active breakdown: whichever headline series has data (prefer Europe)
  const breakdownPub = latestByS['europe_wind'] ?? latestByS['us_wind'] ?? null

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      <TopBar
        title="Decommissioning Cost Index"
        subtitle="Independent benchmark for onshore wind decommissioning liability"
        meta={topBarMeta}
      />

      <div className="flex-1 p-5 space-y-4 min-h-0">

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

        {/* ── Chart ──────────────────────────────────────────────────── */}
        <div className="border border-terminal-border rounded bg-terminal-surface overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-terminal-border">
            <span className="text-[10px] font-mono text-terminal-muted tracking-widest uppercase">
              Index history · Base = 100
            </span>
            {/* Series switcher */}
            <div className="flex items-center gap-0">
              {SUB_SERIES.map(s => {
                const hasData = history.some(p => p.series === s.series)
                return (
                  <button
                    key={s.series}
                    onClick={() => setChartSeries(s.series)}
                    disabled={!hasData}
                    className={clsx(
                      'px-3 py-1 text-[10px] font-mono rounded transition-colors',
                      chartSeries === s.series
                        ? 'bg-terminal-teal/15 text-terminal-teal'
                        : hasData
                          ? 'text-terminal-muted hover:text-terminal-text'
                          : 'text-terminal-border cursor-default',
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

        {/* ── Cost component breakdown ────────────────────────────────── */}
        <div className="border border-terminal-border rounded bg-terminal-surface overflow-hidden">
          <div className="px-5 py-3 border-b border-terminal-border">
            <span className="text-[10px] font-mono text-terminal-muted tracking-widest uppercase">
              Cost components
              {breakdownPub && (
                <span className="ml-2 text-terminal-border">
                  · {HEADLINE_SERIES.find(s => s.series === breakdownPub.series)?.label}
                  · {fmtDate(breakdownPub.publication_date)}
                </span>
              )}
            </span>
          </div>
          <ComponentTable pub={breakdownPub} loading={loading} />
        </div>

        {/* ── Use cases ───────────────────────────────────────────────── */}
        <div className="border border-terminal-border rounded bg-terminal-black px-5 py-4">
          <div className="text-[10px] font-mono text-terminal-muted tracking-widest uppercase mb-3">
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
                <div className="w-1 h-1 rounded-full bg-terminal-teal mt-1.5 flex-shrink-0" />
                <span className="text-xs text-terminal-muted">{use}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] font-mono text-terminal-border mt-4 pt-3 border-t border-terminal-border">
            DCI Spot Wind tracks the market price of decommissioning a fixed onshore wind reference asset as the underlying cost drivers move. It is not a site-specific budget or contractor quote.
          </p>
        </div>

      </div>
    </div>
  )
}
