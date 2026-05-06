// ── Home — Tab 01 ────────────────────────────────────────────────────────────
// Six-panel 3×2 gateway grid. BloombergNEF light, dense, readable.

import { useState, useEffect } from 'react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import { PanelShell } from '@/components/ui/PanelShell'
import { useWorkspace } from '@/context/WorkspaceContext'

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

const DCI_INDICES: { ticker: string; label: string; ccy: string; series: string | null }[] = [
  { ticker: 'DCIW.EU',  label: 'Wind Europe',         ccy: '€', series: 'dci_wind_europe'         },
  { ticker: 'DCIW.NA',  label: 'Wind North America',  ccy: '$', series: 'dci_wind_north_america'  },
  { ticker: 'DCIS.EU',  label: 'Solar Europe',        ccy: '€', series: 'dci_solar_europe'        },
  { ticker: 'DCIS.NA',  label: 'Solar North America', ccy: '$', series: 'dci_solar_north_america' },
  { ticker: 'DCIS.JP',  label: 'Solar Japan',         ccy: '¥', series: 'dci_solar_japan'         },
]

function DciIndicesPanel() {
  const [byS, setByS] = useState<Map<string, { latest: DciRow; prior: DciRow | null }>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('dci_publications')
      .select('series, publication_date, index_value, net_liability, currency')
      .eq('is_published', true)
      .order('publication_date', { ascending: false })
      .then(({ data }) => {
        const map = new Map<string, { latest: DciRow; prior: DciRow | null }>()
        for (const row of (data ?? []) as DciRow[]) {
          const entry = map.get(row.series)
          if (!entry) map.set(row.series, { latest: row, prior: null })
          else if (entry.prior == null) entry.prior = row
        }
        setByS(map); setLoading(false)
      })
  }, [])

  return (
    <PanelShell sourceLabel="DCI" title="Spot Indices" linkTo="dci">
      <table className="w-full">
        <thead>
          <tr className="bg-titlebar border-b border-border">
            <th className="px-2.5 py-1.5 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Ticker</th>
            <th className="px-2.5 py-1.5 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Series</th>
            <th className="px-2.5 py-1.5 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Net/MW</th>
            <th className="px-2.5 py-1.5 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">m/m</th>
          </tr>
        </thead>
        <tbody>
          {DCI_INDICES.map(({ ticker, label, ccy, series }) => {
            const entry = series ? byS.get(series) : null
            const latest = entry?.latest
            const prior  = entry?.prior
            const sym    = latest?.currency ? CCY_SYM[latest.currency] ?? ccy : ccy
            let pct: number | null = null
            if (latest?.net_liability != null && prior?.net_liability && prior.net_liability !== 0) {
              pct = ((latest.net_liability - prior.net_liability) / prior.net_liability) * 100
            }
            return (
              <tr key={ticker} className="border-b border-border/70 hover:bg-raised">
                <td className="px-2.5 py-1.5 text-[12px] font-bold text-teal tracking-wide">{ticker}</td>
                <td className="px-2.5 py-1.5 text-[12.5px] text-ink-2">{label}</td>
                <td className="px-2.5 py-1.5 text-right text-[13px] tabular-nums text-ink font-semibold">
                  {loading ? '—' : latest?.net_liability != null ? fmtCcy(latest.net_liability, sym) : <span className="text-ink-4">—</span>}
                </td>
                <td className="px-2.5 py-1.5 text-right text-[11.5px] tabular-nums">
                  {pct != null && Math.abs(pct) >= 0.05
                    ? <span className={clsx('font-semibold', pct > 0 ? 'text-down' : 'text-up')}>{pct > 0 ? '▲' : '▼'}{Math.abs(pct).toFixed(1)}%</span>
                    : <span className="text-ink-4">—</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
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
  market:       'text-sky-700 bg-sky-50 border-sky-200',
  regulatory:   'text-amber-700 bg-amber-50 border-amber-200',
  commodity:    'text-teal-700 bg-teal-50 border-teal-200',
  supply_chain: 'text-violet-700 bg-violet-50 border-violet-200',
}
const CATEGORY_LABEL: Record<WatchCategory, string> = {
  market: 'MKT', regulatory: 'REG', commodity: 'CMD', supply_chain: 'SC',
}

function SignalTapePanel() {
  const [events, setEvents]   = useState<WatchEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('watch_events')
      .select('id, category, headline, event_date, confidence')
      .eq('is_duplicate', false)
      .order('event_date', { ascending: false })
      .limit(8)
      .then(({ data }) => { setEvents((data as WatchEvent[]) ?? []); setLoading(false) })
  }, [])

  return (
    <PanelShell sourceLabel="WATCH" title="Signal Tape" linkTo="watch">
      <div className="divide-y divide-border/70">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="px-2.5 py-1.5 space-y-1 animate-pulse">
              <div className="h-2.5 bg-page rounded-sm w-1/3" />
              <div className="h-3 bg-page rounded-sm w-3/4" />
            </div>
          ))
        ) : events.length === 0 ? (
          <p className="px-3 py-4 text-[11.5px] text-ink-3 text-center">No signals · feed updates daily</p>
        ) : events.map(ev => (
          <div key={ev.id} className="px-2.5 py-1.5 hover:bg-raised cursor-pointer">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[11px] text-ink-3 tabular-nums">{fmtDate(ev.event_date)}</span>
              <span className={clsx('text-[10px] font-bold px-1 py-px rounded-sm border tracking-wider', CATEGORY_PILL[ev.category])}>
                {CATEGORY_LABEL[ev.category]}
              </span>
            </div>
            <p className="text-[12px] text-ink leading-snug line-clamp-2">{ev.headline}</p>
          </div>
        ))}
      </div>
    </PanelShell>
  )
}

// ── PCM Tightness panel ───────────────────────────────────────────────────────

function PcmTightnessPanel() {
  const { openPanel } = useWorkspace()
  const ROWS = [
    { cat: 'Composite Blade Processing', tier: 'T1', util: 92 },
    { cat: 'Metals Recovery',            tier: 'T2', util: 67 },
    { cat: 'PV Module Recycling',        tier: 'T2', util: 54 },
    { cat: 'BESS Cell Recycling',        tier: 'T3', util: 31 },
  ]
  return (
    <PanelShell sourceLabel="PCM" title="Tightness" linkTo="pcm">
      <div className="divide-y divide-border/70">
        {ROWS.map(r => (
          <div key={r.cat} className="px-2.5 py-2 flex items-center gap-2.5">
            <div className="flex-1 min-w-0">
              <span className="text-[12px] text-ink-2 truncate block">{r.cat}</span>
              <div className="h-1.5 bg-page rounded-full overflow-hidden mt-1">
                <div className={clsx(
                  'h-full',
                  r.util > 85 ? 'bg-down' : r.util > 65 ? 'bg-amber' : 'bg-teal',
                )} style={{ width: `${r.util}%` }} />
              </div>
            </div>
            <span className="text-[12px] tabular-nums text-ink font-semibold flex-shrink-0">{r.util}%</span>
            <span className={clsx(
              'text-[10px] font-bold px-1.5 py-px rounded-sm border tracking-wider flex-shrink-0',
              r.tier === 'T1' ? 'text-down border-down/40 bg-down-dim' :
              r.tier === 'T2' ? 'text-amber border-amber/40 bg-amber-dim' :
              'text-teal border-teal/40 bg-teal-dim',
            )}>{r.tier}</span>
          </div>
        ))}
      </div>
      <div className="px-2.5 py-1.5 border-t border-border bg-titlebar">
        <button onClick={() => openPanel('pcm')} className="text-[11px] uppercase tracking-wider text-teal font-semibold hover:text-teal-bright">
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
  { years: 1,  label: '+1Y'  },
  { years: 3,  label: '+3Y'  },
  { years: 5,  label: '+5Y'  },
  { years: 10, label: '+10Y' },
]

function RetirementWavesPanel() {
  const [installs, setInstalls] = useState<PipelineRow[]>([])
  const [loading, setLoading]   = useState(true)
  const todayYear = new Date().getFullYear()

  useEffect(() => {
    supabase.from('wind_pipeline_annual_installations')
      .select('install_year, installed_gw').eq('scope', 'onshore')
      .then(({ data }) => { setInstalls((data as PipelineRow[]) ?? []); setLoading(false) })
  }, [])

  const waves = HORIZONS.map(h => {
    const cutoff = todayYear + h.years
    const eolGw = installs
      .filter(r => r.install_year + 25 <= cutoff && r.install_year + 25 >= todayYear)
      .reduce((s, r) => s + Number(r.installed_gw), 0)
    return { ...h, year: cutoff, gw: eolGw }
  })

  const max = Math.max(0.01, ...waves.map(w => w.gw))

  return (
    <PanelShell sourceLabel="ARI" title="Retirement Waves" linkTo="ari">
      <table className="w-full">
        <thead>
          <tr className="bg-titlebar border-b border-border">
            <th className="px-2.5 py-1.5 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Horizon</th>
            <th className="px-2.5 py-1.5 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Year</th>
            <th className="px-2.5 py-1.5 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">EOL GW</th>
            <th className="px-2.5 py-1.5 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide w-[36%]">Mass</th>
          </tr>
        </thead>
        <tbody>
          {waves.map(w => (
            <tr key={w.years} className="border-b border-border/70 hover:bg-raised">
              <td className="px-2.5 py-1.5 text-[12px] text-teal font-bold tracking-wide">{w.label}</td>
              <td className="px-2.5 py-1.5 text-[12px] text-ink-3 tabular-nums">{w.year}</td>
              <td className="px-2.5 py-1.5 text-right text-[13px] tabular-nums text-ink font-semibold">
                {loading ? '—' : w.gw > 0 ? w.gw.toFixed(1) : <span className="text-ink-4">—</span>}
              </td>
              <td className="px-2.5 py-1.5">
                <div className="h-1.5 bg-page rounded-sm overflow-hidden">
                  <div className="h-full bg-teal" style={{ width: `${(w.gw / max) * 100}%` }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-2.5 py-1.5 border-t border-border bg-titlebar text-[10.5px] text-ink-3 uppercase tracking-wide">
        Onshore wind · UK + US + CA · 25-yr design life
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
  steel_hms1: 'Steel HMS1',
  copper:     'Copper',
  aluminium:  'Aluminium',
  zinc:       'Zinc',
  rare_earth: 'NdPr Oxide',
}

const MATERIAL_ORDER = ['steel_hms1', 'copper', 'aluminium', 'zinc', 'rare_earth']

const SOURCE_LABELS: Record<string, string> = {
  steel_hms1: 'Fastmkt EU',
  copper:     'Argus',
  aluminium:  'Argus',
  zinc:       'LME-ref',
  rare_earth: 'Argus NdPr',
}

function CommodityReferencePanel() {
  const [prices, setPrices]   = useState<CommodityRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('commodity_prices')
      .select('material_type, price_per_tonne, currency, price_date, region')
      .eq('region', 'EU').order('price_date', { ascending: false })
      .then(({ data }) => {
        if (!data) { setLoading(false); return }
        const seen = new Set<string>()
        const deduped: CommodityRow[] = []
        for (const row of data as CommodityRow[]) {
          if (!seen.has(row.material_type)) { seen.add(row.material_type); deduped.push(row) }
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
    <PanelShell sourceLabel="SMI" title="Commodity Refs · EU" linkTo="smi">
      <table className="w-full">
        <thead>
          <tr className="bg-titlebar border-b border-border">
            <th className="px-2.5 py-1.5 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Material</th>
            <th className="px-2.5 py-1.5 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Source</th>
            <th className="px-2.5 py-1.5 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">€/t</th>
            <th className="px-2.5 py-1.5 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Date</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b border-border/70">
                <td colSpan={4} className="px-2.5 py-2"><div className="h-3 bg-page rounded-sm animate-pulse" /></td>
              </tr>
            ))
          ) : prices.length === 0 ? (
            <tr><td colSpan={4} className="px-2.5 py-4 text-[11.5px] text-ink-3 text-center">Price data pending</td></tr>
          ) : prices.map(row => (
            <tr key={row.material_type} className="border-b border-border/70 hover:bg-raised">
              <td className="px-2.5 py-1.5 text-[12.5px] text-ink font-medium">
                {MATERIAL_LABELS[row.material_type] ?? row.material_type}
              </td>
              <td className="px-2.5 py-1.5 text-[11px] text-ink-3">
                {SOURCE_LABELS[row.material_type] ?? ''}
              </td>
              <td className="px-2.5 py-1.5 text-right text-[13px] tabular-nums text-ink font-semibold">
                {new Intl.NumberFormat('en-GB', {
                  maximumFractionDigits: 0,
                }).format(row.price_per_tonne)}
              </td>
              <td className="px-2.5 py-1.5 text-right text-[11px] tabular-nums text-ink-3">{fmtDate(row.price_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

  const has = siteCount > 0

  return (
    <PanelShell sourceLabel="PORTFOLIO" title="Workspace" linkTo="portfolio">
      <div className="p-2.5 space-y-2">
        <div className="grid grid-cols-2 gap-1.5">
          <div className="bg-canvas border border-border rounded-sm p-2">
            <div className="text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold">Sites</div>
            <div className="text-[18px] font-semibold text-ink tabular-nums leading-none mt-1">
              {siteCount}
            </div>
          </div>
          <div className="bg-canvas border border-border rounded-sm p-2">
            <div className="text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold">Capacity</div>
            <div className="text-[18px] font-semibold text-ink tabular-nums leading-none mt-1">
              {totalMw >= 1000 ? `${(totalMw/1000).toFixed(1)}` : `${totalMw.toFixed(0)}`}
              <span className="text-[11px] text-ink-3 ml-1 font-normal">{totalMw >= 1000 ? 'GW' : 'MW'}</span>
            </div>
          </div>
        </div>

        <div className="bg-canvas border border-border rounded-sm p-2">
          <div className="text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold mb-1">Net liability · est.</div>
          {has ? (
            <div className="flex items-baseline gap-2">
              <span className="text-[18px] font-semibold text-ink tabular-nums">€{((totalMw * 95000)/1_000_000).toFixed(1)}M</span>
              <span className="text-[10.5px] text-ink-3 uppercase tracking-wider">DCIW.EU benchmark</span>
            </div>
          ) : (
            <p className="text-[11.5px] text-ink-3">Upload a CSV or enter assets manually to model liability</p>
          )}
        </div>

        <button
          onClick={() => openPanel('portfolio')}
          className="w-full px-2 py-1.5 bg-teal text-white text-[11.5px] font-bold uppercase tracking-wider rounded-sm hover:bg-teal-bright"
        >
          {has ? 'Open Portfolio →' : 'Open Portfolio Workspace'}
        </button>
      </div>
    </PanelShell>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function DashboardPage() {
  return (
    <div className="h-full p-1.5 grid grid-cols-3 grid-rows-2 gap-1.5 bg-page">
      <DciIndicesPanel />
      <SignalTapePanel />
      <PcmTightnessPanel />
      <RetirementWavesPanel />
      <CommodityReferencePanel />
      <PortfolioWorkspacePanel />
    </div>
  )
}
