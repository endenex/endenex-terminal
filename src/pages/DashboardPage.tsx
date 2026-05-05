// ── Home — Tab 01 ────────────────────────────────────────────────────────────
// Six-panel 3×2 gateway grid. Each panel is a live-data preview of one
// downstream module, with a "click to open" affordance.
// Spec: Product Brief v1.0 §6.1

import { useState, useEffect } from 'react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import { PanelShell } from '@/components/ui/PanelShell'
import { useWorkspace } from '@/context/WorkspaceContext'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try {
    return new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  } catch { return '—' }
}

function fmtCcy(n: number, sym: string): string {
  if (Math.abs(n) >= 1_000_000) return `${sym}${(n/1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000)     return `${sym}${(n/1_000).toFixed(0)}k`
  return `${sym}${Math.round(n)}`
}

const CCY_SYM: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' }

// ── DCI Indices panel ─────────────────────────────────────────────────────────

interface DciRow {
  series:           string
  publication_date: string
  index_value:      number | null
  net_liability:    number | null
  currency:         string
}

const DCI_INDICES: { label: string; ccy: string; series: string | null }[] = [
  { label: 'DCI Wind Europe',         ccy: '€', series: 'dci_wind_europe'         },
  { label: 'DCI Wind North America',  ccy: '$', series: 'dci_wind_north_america'  },
  { label: 'DCI Solar Europe',        ccy: '€', series: 'dci_solar_europe'        },
  { label: 'DCI Solar North America', ccy: '$', series: 'dci_solar_north_america' },
  { label: 'DCI Solar Japan',         ccy: '¥', series: 'dci_solar_japan'         },
]

function DciIndicesPanel() {
  const [byS, setByS] = useState<Map<string, { latest: DciRow; prior: DciRow | null }>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('dci_publications')
      .select('series, publication_date, index_value, net_liability, currency')
      .eq('is_published', true)
      .order('publication_date', { ascending: false })
      .then(({ data }) => {
        const map = new Map<string, { latest: DciRow; prior: DciRow | null }>()
        for (const row of (data ?? []) as DciRow[]) {
          const entry = map.get(row.series)
          if (!entry) {
            map.set(row.series, { latest: row, prior: null })
          } else if (entry.prior == null) {
            entry.prior = row
          }
        }
        setByS(map)
        setLoading(false)
      })
  }, [])

  return (
    <PanelShell sourceLabel="DCI Dashboard" title="Spot Indices" linkTo="dci">
      <div className="divide-y divide-border">
        {DCI_INDICES.map(({ label, ccy, series }) => {
          const entry = series ? byS.get(series) : null
          const latest = entry?.latest
          const prior  = entry?.prior
          const sym    = latest?.currency ? CCY_SYM[latest.currency] ?? ccy : ccy

          let pct: number | null = null
          if (latest?.net_liability != null && prior?.net_liability && prior.net_liability !== 0) {
            pct = ((latest.net_liability - prior.net_liability) / prior.net_liability) * 100
          }

          return (
            <div key={label} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-ink">{label}</p>
                <p className="text-[10px] text-ink-3 mt-0.5">{ccy} / MW · Monthly cadence</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {loading ? (
                  <span className="text-[10px] text-ink-4">Loading…</span>
                ) : latest?.net_liability != null ? (
                  <>
                    <span className="text-[13px] font-semibold text-ink tabular-nums">
                      {fmtCcy(latest.net_liability, sym)}
                    </span>
                    {pct != null && Math.abs(pct) >= 0.05 && (
                      <span className={clsx(
                        'text-[10px] font-semibold tabular-nums',
                        pct > 0 ? 'text-down' : 'text-up'
                      )}>
                        {pct > 0 ? '▲' : '▼'}{Math.abs(pct).toFixed(1)}%
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-[13px] font-semibold text-ink-3">—</span>
                    <span className="text-[10px] text-ink-4">Phase 2</span>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </PanelShell>
  )
}

// ── Signal Tape panel ─────────────────────────────────────────────────────────

type WatchCategory = 'market' | 'regulatory' | 'commodity' | 'supply_chain'

interface WatchEvent {
  id:         string
  category:   WatchCategory
  headline:   string
  event_date: string
  confidence: string
}

const CATEGORY_PILL: Record<WatchCategory, string> = {
  market:       'bg-blue-50 text-blue-700 border border-blue-200',
  regulatory:   'bg-amber-50 text-amber-700 border border-amber-200',
  commodity:    'bg-teal-50 text-teal-700 border border-teal-200',
  supply_chain: 'bg-violet-50 text-violet-700 border border-violet-200',
}
const CATEGORY_LABEL: Record<WatchCategory, string> = {
  market: 'Market', regulatory: 'Regulatory',
  commodity: 'Commodity', supply_chain: 'Supply Chain',
}

function SignalTapePanel() {
  const [events, setEvents]   = useState<WatchEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('watch_events')
      .select('id, category, headline, event_date, confidence')
      .eq('is_duplicate', false)
      .order('event_date', { ascending: false })
      .limit(5)
      .then(({ data }) => { setEvents((data as WatchEvent[]) ?? []); setLoading(false) })
  }, [])

  return (
    <PanelShell sourceLabel="Market Watch" title="Signal Tape" linkTo="watch">
      <div className="divide-y divide-border">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-4 py-3 space-y-1.5 animate-pulse">
              <div className="h-3 bg-page rounded w-1/3" />
              <div className="h-3.5 bg-page rounded w-3/4" />
            </div>
          ))
        ) : events.length === 0 ? (
          <p className="px-4 py-6 text-[12px] text-ink-3 text-center">Feed updates daily</p>
        ) : events.map(ev => (
          <div key={ev.id} className="px-4 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] text-ink-3">{fmtDate(ev.event_date)}</span>
              <span className={clsx('text-[9.5px] font-semibold px-1.5 py-px rounded', CATEGORY_PILL[ev.category])}>
                {CATEGORY_LABEL[ev.category]}
              </span>
            </div>
            <p className="text-[12px] font-medium text-ink leading-snug">{ev.headline}</p>
          </div>
        ))}
      </div>
    </PanelShell>
  )
}

// ── PCM Tightness panel ───────────────────────────────────────────────────────

function PcmTightnessPanel() {
  const { openPanel } = useWorkspace()
  return (
    <PanelShell sourceLabel="Processing Capacity Monitor" title="Tightness & Conversion" linkTo="pcm">
      <div className="px-4 py-6 flex flex-col items-center justify-center gap-3 h-full">
        <p className="text-[12px] text-ink-3 text-center leading-relaxed">
          Capacity tightness metrics across five processing categories.
        </p>
        <div className="space-y-2 w-full">
          {['Composite Blade Processing', 'Metals Recovery', 'PV Module Recycling'].map(cat => (
            <div key={cat} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
              <span className="text-[11.5px] font-medium text-ink-2">{cat}</span>
              <span className="text-[10px] text-ink-4 font-medium px-2 py-0.5 bg-page rounded border border-border">
                T{cat === 'Composite Blade Processing' ? '1' : '2'}
              </span>
            </div>
          ))}
        </div>
        <button
          onClick={() => openPanel('pcm')}
          className="text-[11px] text-teal font-medium hover:underline"
        >
          Open PCM →
        </button>
      </div>
    </PanelShell>
  )
}

// ── Retirement Waves panel ────────────────────────────────────────────────────

interface PipelineRow {
  install_year: number
  installed_gw: number
}

const HORIZONS = [
  { years: 1,  label: 'Near-term'  },
  { years: 3,  label: 'Medium-term' },
  { years: 5,  label: '5-year'     },
  { years: 10, label: '10-year'    },
]

function RetirementWavesPanel() {
  const [installs, setInstalls] = useState<PipelineRow[]>([])
  const [loading, setLoading]   = useState(true)
  const todayYear = new Date().getFullYear()

  useEffect(() => {
    supabase
      .from('wind_pipeline_annual_installations')
      .select('install_year, installed_gw')
      .eq('scope', 'onshore')
      .then(({ data }) => {
        setInstalls((data as PipelineRow[]) ?? [])
        setLoading(false)
      })
  }, [])

  // For each horizon, sum GW where install_year + 25 ≤ todayYear + horizon
  const waves = HORIZONS.map(h => {
    const cutoff = todayYear + h.years
    const eolGw = installs
      .filter(r => r.install_year + 25 <= cutoff && r.install_year + 25 >= todayYear)
      .reduce((s, r) => s + Number(r.installed_gw), 0)
    return { ...h, year: cutoff, gw: eolGw }
  })

  return (
    <PanelShell sourceLabel="Asset Retirement Intelligence" title="Retirement Waves" linkTo="ari">
      <div className="px-4 py-4 space-y-2">
        {waves.map(w => (
          <div key={w.years} className="flex items-center justify-between py-2 border-b border-border last:border-0">
            <div>
              <p className="text-[11.5px] font-medium text-ink-2">{w.label} ({w.year})</p>
            </div>
            <div className="text-right">
              <span className="text-[13px] font-semibold text-ink tabular-nums">
                {loading ? '…' : w.gw > 0 ? w.gw.toFixed(1) : '—'}
              </span>
              <span className="text-[10px] text-ink-3 ml-1">GW</span>
            </div>
          </div>
        ))}
        <p className="text-[10px] text-ink-4 pt-1">Onshore wind · UK + US + CA · 25-yr design life</p>
      </div>
    </PanelShell>
  )
}

// ── Commodity Reference panel ─────────────────────────────────────────────────

interface CommodityRow {
  material_type:  string
  price_per_tonne: number
  currency:       string
  price_date:     string
  region:         string
}

const MATERIAL_LABELS: Record<string, string> = {
  steel_hms1: 'Steel HMS 1',
  copper:     'Copper',
  aluminium:  'Aluminium',
  zinc:       'Zinc',
  rare_earth: 'Nd-Pr Oxide',
}

const MATERIAL_ORDER = ['steel_hms1', 'copper', 'aluminium', 'zinc', 'rare_earth']

const SOURCE_LABELS: Record<string, string> = {
  steel_hms1: 'Fastmarkets EU',
  copper:     'Argus Scrap',
  aluminium:  'Argus Scrap',
  zinc:       'LME-ref',
  rare_earth: 'Argus NdPr',
}

function CommodityReferencePanel() {
  const [prices, setPrices]   = useState<CommodityRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('commodity_prices')
      .select('material_type, price_per_tonne, currency, price_date, region')
      .eq('region', 'EU')
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
        setPrices(deduped.filter(p => MATERIAL_ORDER.includes(p.material_type)))
        setLoading(false)
      })
  }, [])

  return (
    <PanelShell sourceLabel="Secondary Materials Intelligence" title="Commodity Reference" linkTo="smi">
      <div className="divide-y divide-border">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-2.5 animate-pulse">
              <div className="h-3 bg-page rounded w-28" />
              <div className="h-3 bg-page rounded w-20" />
            </div>
          ))
        ) : prices.length === 0 ? (
          <p className="px-4 py-6 text-[12px] text-ink-3 text-center">Price data pending</p>
        ) : prices.map(row => (
          <div key={row.material_type} className="flex items-center justify-between px-4 py-2.5">
            <div>
              <p className="text-[11.5px] font-semibold text-ink-2">
                {MATERIAL_LABELS[row.material_type] ?? row.material_type}
              </p>
              <p className="text-[9.5px] text-ink-4">
                {SOURCE_LABELS[row.material_type] ?? ''} · scrap-basis
              </p>
            </div>
            <div className="text-right">
              <p className="text-[12px] font-semibold text-ink tabular-nums">
                {new Intl.NumberFormat('en-GB', {
                  style: 'currency', currency: row.currency, maximumFractionDigits: 0,
                }).format(row.price_per_tonne)}
                <span className="text-[10px] font-normal text-ink-3">/t</span>
              </p>
              <p className="text-[9.5px] text-ink-4">{fmtDate(row.price_date)}</p>
            </div>
          </div>
        ))}
      </div>
    </PanelShell>
  )
}

// ── Portfolio Workspace panel ─────────────────────────────────────────────────

const STORAGE_KEY = 'endenex_portfolio_v1'

function PortfolioWorkspacePanel() {
  const { openPanel } = useWorkspace()
  const [siteCount, setSiteCount] = useState<number>(0)
  const [totalMw,   setTotalMw]   = useState<number>(0)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const assets = JSON.parse(raw) as { capacity_mw: number }[]
      setSiteCount(assets.length)
      setTotalMw(assets.reduce((s, a) => s + (Number(a.capacity_mw) || 0), 0))
    } catch { /* */ }
  }, [])

  const hasPortfolio = siteCount > 0

  return (
    <PanelShell sourceLabel="Portfolio Analytics" title="Workspace" linkTo="portfolio">
      <div className="px-5 py-6 flex flex-col items-center justify-center gap-4 h-full text-center">
        <div className="w-10 h-10 rounded-full bg-active flex items-center justify-center">
          <span className="text-teal text-lg">⊞</span>
        </div>
        {hasPortfolio ? (
          <div className="space-y-1">
            <p className="text-[13px] font-semibold text-ink">{siteCount} site{siteCount !== 1 ? 's' : ''} loaded</p>
            <p className="text-[11.5px] text-ink-3">
              {totalMw >= 1000 ? `${(totalMw/1000).toFixed(1)} GW` : `${totalMw.toFixed(0)} MW`} portfolio capacity
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-[13px] font-semibold text-ink">No portfolio loaded</p>
            <p className="text-[11.5px] text-ink-3 leading-relaxed max-w-[220px]">
              Upload a CSV or enter assets manually to model decommissioning liability.
            </p>
          </div>
        )}
        <button
          onClick={() => openPanel('portfolio')}
          className="px-4 py-1.5 bg-teal text-white text-[11.5px] font-semibold rounded hover:bg-teal-deep transition-colors"
        >
          {hasPortfolio ? 'Open Portfolio →' : 'Open Portfolio Analytics'}
        </button>
        {!hasPortfolio && (
          <button className="text-[10.5px] text-ink-4 hover:text-ink-3 transition-colors">
            Skip — I'm not a portfolio user
          </button>
        )}
      </div>
    </PanelShell>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function DashboardPage() {
  return (
    <div className="h-full p-4 grid grid-cols-3 grid-rows-2 gap-3">
      {/* Row 1 */}
      <DciIndicesPanel />
      <SignalTapePanel />
      <PcmTightnessPanel />

      {/* Row 2 */}
      <RetirementWavesPanel />
      <CommodityReferencePanel />
      <PortfolioWorkspacePanel />
    </div>
  )
}
