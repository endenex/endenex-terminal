// ── Secondary Materials Intelligence — Tab 04 ────────────────────────────────
// 6 panels in a 12-col grid (no full-width content):
//   Row 1: Commodity Refs table (col-7) + NRO Donut (col-5)
//   Row 2: Solar PV LCA (col-6) + BESS LCA (col-6)
//   Row 3: Material Flows (col-6) + Trade Flows (col-6)

import { useState, useEffect, useMemo, useCallback } from 'react'
import { clsx } from 'clsx'
import { ResponsiveContainer, AreaChart, Area, Tooltip } from 'recharts'
import { supabase } from '@/lib/supabase'
import { MaterialDonut } from '@/components/charts/MaterialDonut'
import { VintageCurveChart } from '@/components/charts/VintageCurveChart'

// ── Types ─────────────────────────────────────────────────────────────────────

type Region   = 'EU' | 'GB' | 'US'
type Currency = 'EUR' | 'GBP' | 'USD'

interface CommodityPrice {
  material_type:  string
  region:         Region
  price_per_tonne: number
  currency:       Currency
  price_date:     string
  source_name:    string
  confidence:     string
  last_reviewed:  string
}

interface NroEstimate {
  material_type:     string
  region:            Region
  currency:          Currency
  reference_date:    string
  net_per_tonne_low: number
  net_per_tonne_mid: number
  net_per_tonne_high: number
  net_per_mw_low:    number | null
  net_per_mw_mid:    number | null
  net_per_mw_high:   number | null
  confidence:        string
  last_reviewed:     string
}

interface SolarPanelRow {
  vintage:             'pre2012' | 'y2012' | 'y2020'
  material:            string
  intensity_t_per_mwp: number
}

interface BessRow {
  vintage:             'pre2018' | 'y2018' | 'y2022'
  material:            string
  intensity_t_per_mwh: number
}

const REGIONS: { code: Region; currency: Currency; sym: string }[] = [
  { code: 'EU', currency: 'EUR', sym: '€' },
  { code: 'GB', currency: 'GBP', sym: '£' },
  { code: 'US', currency: 'USD', sym: '$' },
]

const MATERIAL_LABELS: Record<string, string> = {
  steel_hms1:      'Steel HMS1',
  steel_hms2:      'Steel HMS2',
  steel_cast_iron: 'Cast Iron',
  steel_stainless: 'Stainless',
  copper:          'Copper',
  aluminium:       'Aluminium',
  rare_earth:      'NdPr Oxide',
}

const MATERIAL_ORDER = [
  'steel_hms1', 'steel_hms2', 'steel_cast_iron', 'steel_stainless',
  'copper', 'aluminium', 'rare_earth',
]

const MATERIAL_SOURCE: Record<string, string> = {
  steel_hms1:      'Fastmkt',
  steel_hms2:      'Fastmkt',
  steel_cast_iron: 'Fastmkt',
  copper:          'LME',
  aluminium:       'LME',
  rare_earth:      'BMI',
}

const CONFIDENCE_STYLE: Record<string, string> = {
  High:   'text-up',
  Medium: 'text-amber',
  Low:    'text-down',
}

const SOLAR_VINTAGE_LABEL: Record<string, string> = {
  pre2012: 'Pre-2012 BSF',
  y2012:   '2012-19 PERC',
  y2020:   '2020+ TOPCon',
}

const BESS_VINTAGE_LABEL: Record<string, string> = {
  pre2018: 'Pre-2018 NMC',
  y2018:   '2018-21 blend',
  y2022:   '2022+ LFP',
}

function fmt(n: number | null, sym: string): string {
  if (n == null) return '—'
  return `${sym}${n.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`
}

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try {
    return new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
  } catch { return '—' }
}

function fmtRange(low: number | null, mid: number | null, high: number | null, sym: string): string {
  if (mid == null) return '—'
  if (low == null || high == null) return fmt(mid, sym)
  return `${fmt(low, sym)} – ${fmt(high, sym)}`
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

// ── Tiny inline sparkline ─────────────────────────────────────────────────────

function PriceSparkline({ data }: { data: { v: number }[] }) {
  if (data.length < 2) return <div className="w-16 h-6" />
  const up     = data[data.length - 1].v >= data[0].v
  const colour = up ? '#0F8B58' : '#C73838'
  return (
    <div className="w-16 h-6">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 1, right: 0, left: 0, bottom: 1 }}>
          <defs>
            <linearGradient id={`smi-${up ? 'up' : 'dn'}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={colour} stopOpacity={0.3} />
              <stop offset="95%" stopColor={colour} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={colour} strokeWidth={1.2}
                fill={`url(#smi-${up ? 'up' : 'dn'})`} dot={false} isAnimationActive={false} />
          <Tooltip contentStyle={{ display: 'none' }} cursor={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function MoM({ current, prev }: { current: number; prev: number | undefined }) {
  if (prev == null || prev === 0) return <span className="text-ink-4">—</span>
  const pct = ((current - prev) / prev) * 100
  if (Math.abs(pct) < 0.05) return <span className="text-ink-4">flat</span>
  const up = pct > 0
  return (
    <span className={clsx('tabular-nums font-semibold', up ? 'text-up' : 'text-down')}>
      {up ? '▲' : '▼'}{Math.abs(pct).toFixed(1)}%
    </span>
  )
}

// ── 01 Commodity Refs panel ───────────────────────────────────────────────────

function CommodityRefsPanel() {
  const [region, setRegion]         = useState<Region>('EU')
  const [prices, setPrices]         = useState<CommodityPrice[]>([])
  const [prevPrices, setPrevPrices] = useState<Record<string, CommodityPrice>>({})
  const [historyMap, setHistoryMap] = useState<Record<string, { v: number }[]>>({})
  const [loading, setLoading]       = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('commodity_prices')
      .select('material_type, region, price_per_tonne, currency, price_date, source_name, confidence, last_reviewed')
      .eq('region', region)
      .order('price_date', { ascending: false })

    const rows = (data ?? []) as CommodityPrice[]
    const latestMap: Record<string, CommodityPrice> = {}
    const prevMap:   Record<string, CommodityPrice> = {}
    const hist:      Record<string, CommodityPrice[]> = {}
    for (const p of rows) {
      if (!latestMap[p.material_type])    latestMap[p.material_type] = p
      else if (!prevMap[p.material_type]) prevMap[p.material_type]   = p
      ;(hist[p.material_type] ??= []).push(p)
    }
    const hMap: Record<string, { v: number }[]> = {}
    for (const [mat, h] of Object.entries(hist)) {
      hMap[mat] = [...h].reverse().map(r => ({ v: r.price_per_tonne }))
    }
    setPrices(Object.values(latestMap))
    setPrevPrices(prevMap)
    setHistoryMap(hMap)
    setLoading(false)
  }, [region])

  useEffect(() => { load() }, [load])

  const sym = REGIONS.find(r => r.code === region)?.sym ?? '€'
  const priceMap = Object.fromEntries(prices.map(p => [p.material_type, p]))

  const updatedAt = useMemo(() => {
    if (prices.length === 0) return null
    return prices.reduce((max, p) => p.price_date > max ? p.price_date : max, prices[0].price_date)
  }, [prices])

  return (
    <Panel label="SMI" title="Commodity Refs" className="col-span-7"
           meta={
             <>
               <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
                 {REGIONS.map(r => (
                   <button key={r.code} onClick={() => setRegion(r.code)}
                           className={clsx(
                             'px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm',
                             region === r.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                           )}>
                     {r.code}
                   </button>
                 ))}
               </div>
               {updatedAt && <span className="text-[10.5px] text-ink-4 tabular-nums">{fmtDate(updatedAt)}</span>}
             </>
           }>
      <table className="w-full">
        <thead>
          <tr className="bg-titlebar border-b border-border sticky top-0 z-10">
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Material</th>
            <th className="px-2.5 py-1 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">{sym}/t</th>
            <th className="px-2.5 py-1 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">m/m</th>
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide w-20">Trend</th>
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Source</th>
            <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Conf</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={6} className="px-2.5 py-3 text-[12px] text-ink-3 text-center">Loading…</td></tr>
          ) : prices.length === 0 ? (
            <tr><td colSpan={6} className="px-2.5 py-3 text-[12px] text-ink-3 text-center">No prices for {region}</td></tr>
          ) : MATERIAL_ORDER.map(mat => {
            const p = priceMap[mat]
            if (!p) return null
            const prev = prevPrices[mat]
            return (
              <tr key={mat} className="border-b border-border/70 hover:bg-raised">
                <td className="px-2.5 py-1 text-[12px] text-ink font-medium">{MATERIAL_LABELS[mat] ?? mat}</td>
                <td className="px-2.5 py-1 text-right text-[12.5px] tabular-nums text-ink font-semibold">
                  {fmt(p.price_per_tonne, sym)}<span className="text-[10.5px] text-ink-4 font-normal ml-px">/t</span>
                </td>
                <td className="px-2.5 py-1 text-right text-[11px] tabular-nums">
                  <MoM current={p.price_per_tonne} prev={prev?.price_per_tonne} />
                </td>
                <td className="px-2.5 py-0.5"><PriceSparkline data={historyMap[mat] ?? []} /></td>
                <td className="px-2.5 py-1 text-[11px] text-ink-3">{MATERIAL_SOURCE[mat] ?? p.source_name}</td>
                <td className="px-2.5 py-1">
                  <span className={clsx('text-[11px] font-semibold', CONFIDENCE_STYLE[p.confidence])}>{p.confidence}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Panel>
  )
}

// ── 02 NRO Donut + table panel ────────────────────────────────────────────────

function NroAttributionPanel() {
  const [region, setRegion]   = useState<Region>('EU')
  const [nro, setNro]         = useState<NroEstimate[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    supabase.from('nro_estimates').select('*').eq('region', region).order('reference_date', { ascending: false })
      .then(({ data }) => {
        const rows = (data ?? []) as NroEstimate[]
        const map: Record<string, NroEstimate> = {}
        for (const n of rows) { if (!map[n.material_type]) map[n.material_type] = n }
        setNro(Object.values(map)); setLoading(false)
      })
  }, [region])

  const sym = REGIONS.find(r => r.code === region)?.sym ?? '€'
  const ccy = REGIONS.find(r => r.code === region)?.currency ?? 'EUR'

  const slices = useMemo(() => {
    const PALETTE = ['#0E7A86', '#14A4B4', '#D97706', '#0F8B58', '#7C3AED', '#0A5C66', '#6B7585']
    return nro
      .filter(n => n.net_per_mw_mid && n.net_per_mw_mid > 0)
      .map((n, i) => ({
        label: MATERIAL_LABELS[n.material_type] ?? n.material_type,
        value: Number(n.net_per_mw_mid),
        color: PALETTE[i % PALETTE.length],
      }))
      .sort((a, b) => b.value - a.value)
  }, [nro])
  const total = slices.reduce((s, x) => s + x.value, 0)

  return (
    <Panel label="SMI" title="NRO Attribution" className="col-span-5"
           meta={
             <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
               {REGIONS.map(r => (
                 <button key={r.code} onClick={() => setRegion(r.code)}
                         className={clsx(
                           'px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm',
                           region === r.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                         )}>
                   {r.code}
                 </button>
               ))}
             </div>
           }>
      {loading ? (
        <div className="px-3 py-6 text-[12px] text-ink-3 text-center">Loading…</div>
      ) : (
        <div className="p-2 space-y-2">
          <MaterialDonut slices={slices} total={total} currency={ccy} centerLabel="Net / MW" height={170} />
          <div className="border border-border rounded-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-titlebar border-b border-border">
                  <th className="px-2 py-1 text-left text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Material</th>
                  <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase tracking-wide">{sym}/t (range)</th>
                  <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase tracking-wide">{sym}/MW</th>
                </tr>
              </thead>
              <tbody>
                {nro.length === 0 ? (
                  <tr><td colSpan={3} className="px-2 py-2 text-[11.5px] text-ink-3 text-center">No NRO data</td></tr>
                ) : MATERIAL_ORDER.map(mat => {
                  const n = nro.find(x => x.material_type === mat)
                  if (!n) return null
                  return (
                    <tr key={mat} className="border-b border-border/70 hover:bg-raised">
                      <td className="px-2 py-0.5 text-[11.5px] text-ink font-medium">{MATERIAL_LABELS[mat]}</td>
                      <td className="px-2 py-0.5 text-right text-[11px] tabular-nums text-ink-2">
                        {fmtRange(n.net_per_tonne_low, n.net_per_tonne_mid, n.net_per_tonne_high, sym)}
                      </td>
                      <td className="px-2 py-0.5 text-right text-[11px] tabular-nums text-ink-2">
                        {fmt(n.net_per_mw_mid, sym)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  )
}

// ── 03 Solar PV LCA panel ─────────────────────────────────────────────────────

function SolarLcaPanel() {
  const [panels, setPanels] = useState<SolarPanelRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('solar_panel_intensities').select('vintage, material, intensity_t_per_mwp')
      .then(({ data }) => { setPanels((data ?? []) as SolarPanelRow[]); setLoading(false) })
  }, [])

  const panelMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of panels) m.set(`${r.material}|${r.vintage}`, r.intensity_t_per_mwp)
    return m
  }, [panels])

  const silverPoints = (['pre2012','y2012','y2020'] as const).map(v => ({
    vintage: v, value: (panelMap.get(`silver|${v}`) ?? 0) * 1000,
  }))
  const siliconPoints = (['pre2012','y2012','y2020'] as const).map(v => ({
    vintage: v, value: panelMap.get(`silicon|${v}`) ?? 0,
  }))

  return (
    <Panel label="SMI" title="Solar PV LCA · Vintage Curve" className="col-span-6"
           meta={<span className="text-[10.5px] text-ink-3">Silver collapse · BSF→PERC→TOPCon</span>}>
      {loading ? (
        <div className="px-3 py-6 text-[12px] text-ink-3 text-center">Loading…</div>
      ) : (
        <div className="p-2">
          <VintageCurveChart
            series={[
              { name: 'Silver kg/MW',  color: '#D97706', points: silverPoints },
              { name: 'Silicon t/MWp', color: '#0E7A86', points: siliconPoints },
            ]}
            vintageLabels={SOLAR_VINTAGE_LABEL}
            yLabel="intensity"
            decimals={2}
            height={210}
          />
        </div>
      )}
    </Panel>
  )
}

// ── 04 BESS LCA panel ─────────────────────────────────────────────────────────

function BessLcaPanel() {
  const [intens, setIntens]   = useState<BessRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('bess_intensities').select('vintage, material, intensity_t_per_mwh')
      .then(({ data }) => { setIntens((data ?? []) as BessRow[]); setLoading(false) })
  }, [])

  const intensMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of intens) m.set(`${r.material}|${r.vintage}`, r.intensity_t_per_mwh)
    return m
  }, [intens])

  const cobaltPoints = (['pre2018','y2018','y2022'] as const).map(v => ({ vintage: v, value: intensMap.get(`cobalt|${v}`) ?? 0 }))
  const nickelPoints = (['pre2018','y2018','y2022'] as const).map(v => ({ vintage: v, value: intensMap.get(`nickel|${v}`) ?? 0 }))
  const lithiumPoints = (['pre2018','y2018','y2022'] as const).map(v => ({ vintage: v, value: intensMap.get(`lithium|${v}`) ?? 0 }))

  return (
    <Panel label="SMI" title="BESS LCA · Chemistry Shift" className="col-span-6"
           meta={<span className="text-[10.5px] text-ink-3">NMC→LFP · Co/Ni decline, Li rise</span>}>
      {loading ? (
        <div className="px-3 py-6 text-[12px] text-ink-3 text-center">Loading…</div>
      ) : (
        <div className="p-2">
          <VintageCurveChart
            series={[
              { name: 'Cobalt',  color: '#7C3AED', points: cobaltPoints },
              { name: 'Nickel',  color: '#0E7A86', points: nickelPoints },
              { name: 'Lithium', color: '#D97706', points: lithiumPoints },
            ]}
            vintageLabels={BESS_VINTAGE_LABEL}
            yLabel="t/MWh"
            decimals={2}
            height={210}
          />
        </div>
      )}
    </Panel>
  )
}

// ── 05 Material Flows placeholder ─────────────────────────────────────────────

function MaterialFlowsPanel() {
  return (
    <Panel label="SMI" title="Material Flows" className="col-span-6"
           meta={<span className="text-[10px] uppercase tracking-wider text-amber font-semibold">In build</span>}>
      <div className="p-3 space-y-2 text-[12px]">
        <p className="text-ink-3 leading-snug">
          Volumetric flows of recovered materials by class and geography from wind decommissioning events.
        </p>
        <ul className="space-y-1 mt-2">
          {[
            'Annual scrap yield by asset class & vintage cohort',
            'HMS 1 / HMS 2 separation by region',
            'Copper cable recovery volume estimates',
            'Rare earth recovery from PMG turbines',
            'Regional material balance: production vs. capacity',
          ].map(s => (
            <li key={s} className="flex items-start gap-2">
              <div className="w-1 h-1 rounded-full bg-border mt-1.5 flex-shrink-0" />
              <span className="text-ink-2 text-[11.5px]">{s}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}

// ── 06 Trade Flows placeholder ────────────────────────────────────────────────

function TradeFlowsPanel() {
  return (
    <Panel label="SMI" title="Trade Flows" className="col-span-6"
           meta={<span className="text-[10px] uppercase tracking-wider text-amber font-semibold">In build</span>}>
      <div className="p-3 space-y-2 text-[12px]">
        <p className="text-ink-3 leading-snug">
          Cross-border scrap trade signals — export/import volumes, tariff exposure, market access constraints.
        </p>
        <ul className="space-y-1 mt-2">
          {[
            'EU scrap export restrictions (Basel Convention)',
            'UK → EU scrap flow post-Brexit',
            'US Section 232 tariff exposure',
            'Japan METI scrap export classification',
            'Turkey & India import demand signals',
          ].map(s => (
            <li key={s} className="flex items-start gap-2">
              <div className="w-1 h-1 rounded-full bg-border mt-1.5 flex-shrink-0" />
              <span className="text-ink-2 text-[11.5px]">{s}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function MaterialsPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden bg-page">

      <div className="flex-shrink-0 h-9 px-3 border-b border-border bg-canvas flex items-center justify-between">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[13px] font-semibold text-ink uppercase tracking-wide">Secondary Materials Intelligence</h1>
          <span className="text-[11.5px] text-ink-3">Scrap prices · NRO · LCA intensities · cross-asset</span>
        </div>
        <div className="flex items-center gap-3 text-[10.5px] text-ink-3 flex-shrink-0 uppercase tracking-wide">
          <span>Coverage</span>
          <div className="flex items-center gap-1">
            {['EU', 'GB', 'US'].map(s => (
              <span key={s} className="px-1.5 py-px bg-canvas border border-border rounded-sm text-ink-3 normal-case font-semibold">
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden p-1.5">
        <div className="h-full grid grid-cols-12 grid-rows-3 gap-1.5">
          <CommodityRefsPanel />
          <NroAttributionPanel />
          <SolarLcaPanel />
          <BessLcaPanel />
          <MaterialFlowsPanel />
          <TradeFlowsPanel />
        </div>
      </div>

    </div>
  )
}
