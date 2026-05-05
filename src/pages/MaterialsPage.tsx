// ── Secondary Materials Intelligence — Tab 04 ────────────────────────────────
// Spec: Product Brief v1.0 §6.4
//
// Sub-tabs:
//   01 Commodity Refs    — live scrap metal spot prices with m/m move + sparkline
//   02 NRO Estimates     — net recovery offset (low / mid / high) by material
//   03 Material Flows    — volume flows by material class and region (pending)
//   04 Trade Flows       — cross-border scrap trade signals (pending)

import { useState, useEffect, useMemo, useCallback } from 'react'
import { clsx } from 'clsx'
import { ResponsiveContainer, AreaChart, Area, Tooltip } from 'recharts'
import { supabase } from '@/lib/supabase'
import { CommoditySparkGrid } from '@/components/charts/CommoditySparkGrid'
import { MaterialDonut } from '@/components/charts/MaterialDonut'
import { VintageCurveChart } from '@/components/charts/VintageCurveChart'

// ── Types ─────────────────────────────────────────────────────────────────────

type Region   = 'EU' | 'GB' | 'US'
type Currency = 'EUR' | 'GBP' | 'USD'
type SubTab   = 'prices' | 'nro' | 'solar' | 'bess' | 'flows' | 'trade'

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

// ── Constants ─────────────────────────────────────────────────────────────────

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'prices', label: 'Commodity Refs' },
  { id: 'nro',    label: 'NRO Estimates' },
  { id: 'solar',  label: 'Solar PV LCA' },
  { id: 'bess',   label: 'BESS LCA' },
  { id: 'flows',  label: 'Material Flows' },
  { id: 'trade',  label: 'Trade Flows' },
]

const REGIONS: { code: Region; label: string; currency: Currency }[] = [
  { code: 'EU', label: 'EU', currency: 'EUR' },
  { code: 'GB', label: 'UK', currency: 'GBP' },
  { code: 'US', label: 'US', currency: 'USD' },
]

const MATERIAL_LABELS: Record<string, string> = {
  steel_hms1:      'Steel HMS 1',
  steel_hms2:      'Steel HMS 2',
  steel_cast_iron: 'Cast Iron',
  steel_stainless: 'Stainless Steel',
  copper:          'Copper',
  aluminium:       'Aluminium',
  rare_earth:      'Nd-Pr Oxide',
}

const MATERIAL_COMPONENT: Record<string, string> = {
  steel_hms1:      'Tower sections, heavy structural plate',
  steel_hms2:      'Thinner structural sections',
  steel_cast_iron: 'Gearbox housing — geared turbines only',
  steel_stainless: 'Nacelle sub-components',
  copper:          'Generator windings, cabling',
  aluminium:       'Nacelle housing, small components',
  rare_earth:      'Permanent magnet generators only',
}

const MATERIAL_SOURCE: Record<string, string> = {
  steel_hms1:      'Fastmarkets',
  steel_hms2:      'Fastmarkets',
  steel_cast_iron: 'Fastmarkets',
  copper:          'LME',
  aluminium:       'LME',
  rare_earth:      'BMI',
}

const MATERIAL_ORDER = [
  'steel_hms1', 'steel_hms2', 'steel_cast_iron', 'steel_stainless',
  'copper', 'aluminium', 'rare_earth',
]

const CONFIDENCE_STYLE: Record<string, string> = {
  High:   'text-up',
  Medium: 'text-highlight',
  Low:    'text-down',
}

const CCY_SYMBOL: Record<Currency, string> = { EUR: '€', GBP: '£', USD: '$' }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null, symbol: string, decimals = 0): string {
  if (n == null) return '—'
  return `${symbol}${n.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try {
    return new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '—' }
}

function fmtRange(low: number | null, mid: number | null, high: number | null, symbol: string): string {
  if (mid == null) return '—'
  if (low == null || high == null) return fmt(mid, symbol)
  return `${fmt(low, symbol)} – ${fmt(high, symbol)}`
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function PriceSparkline({ data }: { data: { v: number }[] }) {
  if (data.length < 2) return <div className="w-20 h-7" />
  const up     = data[data.length - 1].v >= data[0].v
  const colour = up ? '#1F8A5C' : '#B53C3C'
  return (
    <div className="w-20 h-7">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <defs>
            <linearGradient id={`smi-${up ? 'up' : 'dn'}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={colour} stopOpacity={0.2} />
              <stop offset="95%" stopColor={colour} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone" dataKey="v"
            stroke={colour} strokeWidth={1.2}
            fill={`url(#smi-${up ? 'up' : 'dn'})`}
            dot={false} isAnimationActive={false}
          />
          <Tooltip contentStyle={{ display: 'none' }} cursor={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── m/m direction badge ───────────────────────────────────────────────────────

function MoM({ current, prev }: { current: number; prev: number | undefined }) {
  if (prev == null || prev === 0) return <span className="text-ink-4">—</span>
  const pct = ((current - prev) / prev) * 100
  if (Math.abs(pct) < 0.05) return <span className="text-ink-4">flat</span>
  const up = pct > 0
  return (
    <span className={clsx('tabular-nums font-medium', up ? 'text-up' : 'text-down')}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

// ── Region tab bar ────────────────────────────────────────────────────────────

function RegionTabs({ region, onChange }: { region: Region; onChange: (r: Region) => void }) {
  return (
    <div className="flex items-center gap-0 border-b border-border bg-panel flex-shrink-0 px-5">
      {REGIONS.map(r => (
        <button
          key={r.code}
          onClick={() => onChange(r.code)}
          className={clsx(
            'px-4 py-2.5 text-[11.5px] font-medium border-b-2 transition-colors',
            region === r.code
              ? 'border-teal text-teal'
              : 'border-transparent text-ink-3 hover:text-ink-2',
          )}
        >
          {r.label}
          <span className="ml-1.5 text-[10px] text-ink-4">{r.currency}</span>
        </button>
      ))}
    </div>
  )
}

// ── Multi-region spark grid (Chart F) ─────────────────────────────────────────

function MultiRegionSparkGrid() {
  const [series, setSeries] = useState<{ material: string; region: string; currency: string; history: { date: string; price: number }[] }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    supabase
      .from('commodity_prices')
      .select('material_type, region, price_per_tonne, currency, price_date')
      .order('price_date', { ascending: false })
      .then(({ data }) => {
        const rows = (data ?? []) as { material_type: string; region: string; price_per_tonne: number; currency: string; price_date: string }[]
        // Group by (material × region) → latest 13 prices
        const grouped = new Map<string, { material: string; region: string; currency: string; history: { date: string; price: number }[] }>()
        for (const r of rows) {
          const key = `${r.material_type}|${r.region}`
          if (!grouped.has(key)) {
            grouped.set(key, { material: r.material_type, region: r.region, currency: r.currency, history: [] })
          }
          const entry = grouped.get(key)!
          if (entry.history.length < 13) {
            entry.history.push({ date: r.price_date, price: r.price_per_tonne })
          }
        }
        setSeries(Array.from(grouped.values()))
        setLoading(false)
      })
  }, [])

  if (loading) return <div className="h-32 flex items-center justify-center text-[12px] text-ink-3">Loading commodity grid…</div>
  return <CommoditySparkGrid series={series} regions={['EU','GB','US']} />
}

// ── 01 Commodity Refs ─────────────────────────────────────────────────────────

function CommodityRefs() {
  const [region,     setRegion]     = useState<Region>('EU')
  const [prices,     setPrices]     = useState<CommodityPrice[]>([])
  const [prevPrices, setPrevPrices] = useState<Record<string, CommodityPrice>>({})
  const [historyMap, setHistoryMap] = useState<Record<string, { v: number }[]>>({})
  const [loading,    setLoading]    = useState(true)

  const load = useCallback(async (spinner = false) => {
    if (spinner) setLoading(true)
    const { data } = await supabase
      .from('commodity_prices')
      .select('material_type, region, price_per_tonne, currency, price_date, source_name, confidence, last_reviewed')
      .eq('region', region)
      .order('price_date', { ascending: false })

    const rows = (data ?? []) as CommodityPrice[]
    const latestMap:  Record<string, CommodityPrice> = {}
    const prevMap:    Record<string, CommodityPrice> = {}
    const hist:       Record<string, CommodityPrice[]> = {}

    for (const p of rows) {
      if (!latestMap[p.material_type])       latestMap[p.material_type] = p
      else if (!prevMap[p.material_type])    prevMap[p.material_type]   = p
      ;(hist[p.material_type] ??= []).push(p)
    }

    const hMap: Record<string, { v: number }[]> = {}
    for (const [mat, h] of Object.entries(hist)) {
      hMap[mat] = [...h].reverse().map(r => ({ v: r.price_per_tonne }))
    }

    setPrices(Object.values(latestMap))
    setPrevPrices(prevMap)
    setHistoryMap(hMap)
    if (spinner) setLoading(false)
  }, [region])

  useEffect(() => {
    load(true)
    const id = setInterval(() => load(false), 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [load])

  const currency = REGIONS.find(r => r.code === region)?.currency ?? 'EUR'
  const symbol   = CCY_SYMBOL[currency]
  const priceMap = Object.fromEntries(prices.map(p => [p.material_type, p]))

  const updatedAt = useMemo(() => {
    if (prices.length === 0) return null
    return prices.reduce((max, p) => p.price_date > max ? p.price_date : max, prices[0].price_date)
  }, [prices])

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <RegionTabs region={region} onChange={setRegion} />

      <div className="flex-1 overflow-auto">
        {/* Multi-region spark grid (Chart F) */}
        <div className="p-5 border-b border-border">
          <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide mb-2">
            13-month price trajectory · all regions
          </p>
          <MultiRegionSparkGrid />
        </div>

        {/* Updated-at strip */}
        {updatedAt && (
          <div className="px-5 py-2 border-b border-border text-[10.5px] text-ink-4 bg-page flex items-center gap-2">
            <span>Prices as of {fmtDate(updatedAt)}</span>
            <span className="text-border">·</span>
            <span>Updated daily · Sources: LME, Fastmarkets, BMI</span>
          </div>
        )}

        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="border-b border-border bg-page text-left sticky top-0">
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Material</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Component</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider text-right">Price / t</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider text-right">m/m</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Trend</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Source</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Date</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Conf.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 7 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="px-5 py-3">
                      <div className="h-3 bg-page rounded w-16" />
                    </td>
                  ))}
                </tr>
              ))
            ) : prices.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-[12px] text-ink-3">
                  No prices for {region} yet. Add records to the commodity_prices table.
                </td>
              </tr>
            ) : (
              MATERIAL_ORDER.map(mat => {
                const p    = priceMap[mat]
                const prev = prevPrices[mat]
                if (!p) return null
                return (
                  <tr key={mat} className="hover:bg-page transition-colors">
                    <td className="px-5 py-3 font-semibold text-ink">
                      {MATERIAL_LABELS[mat] ?? mat}
                    </td>
                    <td className="px-5 py-3 text-ink-3 max-w-[200px]">
                      {MATERIAL_COMPONENT[mat] ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-ink tabular-nums">
                      {fmt(p.price_per_tonne, symbol)}
                      <span className="text-[10px] text-ink-4 font-normal ml-0.5">/t</span>
                    </td>
                    <td className="px-5 py-3 text-right text-[11px] tabular-nums">
                      <MoM current={p.price_per_tonne} prev={prev?.price_per_tonne} />
                    </td>
                    <td className="px-4 py-2">
                      <PriceSparkline data={historyMap[mat] ?? []} />
                    </td>
                    <td className="px-5 py-3 text-ink-3">
                      {MATERIAL_SOURCE[mat] ?? p.source_name ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-ink-3 tabular-nums">
                      {fmtDate(p.price_date)}
                    </td>
                    <td className="px-5 py-3">
                      <span className={clsx('font-semibold text-[11px]', CONFIDENCE_STYLE[p.confidence] ?? 'text-ink-3')}>
                        {p.confidence}
                      </span>
                    </td>
                  </tr>
                )
              }).filter(Boolean)
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 02 NRO Estimates ──────────────────────────────────────────────────────────

function NroEstimates() {
  const [region,  setRegion]  = useState<Region>('EU')
  const [nro,     setNro]     = useState<NroEstimate[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    supabase
      .from('nro_estimates')
      .select('*')
      .eq('region', region)
      .order('reference_date', { ascending: false })
      .then(({ data }) => {
        const rows = (data ?? []) as NroEstimate[]
        const latestMap: Record<string, NroEstimate> = {}
        for (const n of rows) {
          if (!latestMap[n.material_type]) latestMap[n.material_type] = n
        }
        setNro(Object.values(latestMap))
        setLoading(false)
      })
  }, [region])

  const currency = REGIONS.find(r => r.code === region)?.currency ?? 'EUR'
  const symbol   = CCY_SYMBOL[currency]
  const nroMap   = Object.fromEntries(nro.map(n => [n.material_type, n]))

  const refDate = useMemo(() => {
    if (nro.length === 0) return null
    return nro.reduce((max, n) => n.reference_date > max ? n.reference_date : max, nro[0].reference_date)
  }, [nro])

  // ── Donut input: per-MW NRO mid by material (Chart D) ────────────────────
  const donutSlices = useMemo(() => {
    const PALETTE = ['#0A1628','#007B8A','#1C3D52','#4A9BAA','#C4863A','#2A7F8E','#6BAAB5']
    return nro
      .filter(n => n.net_per_mw_mid && n.net_per_mw_mid > 0)
      .map((n, i) => ({
        label: MATERIAL_LABELS[n.material_type] ?? n.material_type,
        value: Number(n.net_per_mw_mid),
        color: PALETTE[i % PALETTE.length],
      }))
      .sort((a, b) => b.value - a.value)
  }, [nro])
  const donutTotal = donutSlices.reduce((s, x) => s + x.value, 0)

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <RegionTabs region={region} onChange={setRegion} />

      <div className="flex-1 overflow-auto">
        {/* Donut summary panel (Chart D) */}
        <div className="grid grid-cols-2 gap-4 p-5 border-b border-border">
          <div className="bg-panel border border-border rounded-lg p-4">
            <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide mb-2">
              NRO attribution per MW · {region}
            </p>
            <MaterialDonut
              slices={donutSlices}
              total={donutTotal}
              currency={currency}
              centerLabel="Net / MW"
              height={240}
            />
          </div>
          <div className="bg-panel border border-border rounded-lg p-4 text-[11px] text-ink-2 leading-relaxed">
            <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide mb-2">Reading the donut</p>
            <p>For a fleet-average MW of decommissioned wind capacity in {region}, this shows the contribution of each material to net recovery (after broker margin + contamination yield).</p>
            <p className="mt-2 text-ink-3">
              Bigger slice = bigger share of the recovery story. Steel typically dominates by mass; copper dominates by value per tonne.
            </p>
            {refDate && <p className="mt-3 text-ink-4 text-[10px]">Reference date: {fmtDate(refDate)}</p>}
          </div>
        </div>

        {/* Methodology note */}
        <div className="px-5 py-3 border-b border-border bg-page text-[10.5px] text-ink-4 flex items-center gap-2">
          <span className="text-teal">ⓘ</span>
          <span>
            NRO = scrap price minus merchant handling cost. Shown as range (low – high).
            Merchant margin is commercially sensitive and not disclosed.
            {refDate && <span className="ml-2 text-border">·</span>}
            {refDate && <span className="ml-2">Reference date: {fmtDate(refDate)}</span>}
          </span>
        </div>

        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="border-b border-border bg-page text-left sticky top-0">
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Material</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider text-right">Net / tonne</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider text-right">Net / MW</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Ref. date</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Conf.</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Reviewed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 7 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-5 py-3"><div className="h-3 bg-page rounded w-20" /></td>
                  ))}
                </tr>
              ))
            ) : nro.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-[12px] text-ink-3">
                  No NRO estimates for {region} yet.
                </td>
              </tr>
            ) : (
              MATERIAL_ORDER.map(mat => {
                const n = nroMap[mat]
                return (
                  <tr key={mat} className="hover:bg-page transition-colors">
                    <td className="px-5 py-3 font-semibold text-ink">{MATERIAL_LABELS[mat] ?? mat}</td>
                    <td className="px-5 py-3 text-right font-semibold text-ink tabular-nums">
                      {n ? fmtRange(n.net_per_tonne_low, n.net_per_tonne_mid, n.net_per_tonne_high, symbol) : '—'}
                    </td>
                    <td className="px-5 py-3 text-right text-ink-2 tabular-nums">
                      {n ? fmtRange(n.net_per_mw_low, n.net_per_mw_mid, n.net_per_mw_high, symbol) : '—'}
                    </td>
                    <td className="px-5 py-3 text-ink-3 tabular-nums">
                      {n ? fmtDate(n.reference_date) : '—'}
                    </td>
                    <td className="px-5 py-3">
                      {n ? (
                        <span className={clsx('font-semibold text-[11px]', CONFIDENCE_STYLE[n.confidence] ?? 'text-ink-3')}>
                          {n.confidence}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3 text-ink-3 tabular-nums">
                      {n ? fmtDate(n.last_reviewed) : '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>

        {/* Per-MW methodology explainer */}
        {nro.length > 0 && (
          <div className="mx-5 my-5 bg-page border border-border rounded-lg px-5 py-4 text-[11px] text-ink-3 leading-relaxed max-w-2xl">
            <span className="font-semibold text-ink-2">Methodology · </span>
            Material volumes sourced from OEM Life Cycle Assessment (LCA) documents.
            Scrap prices sourced from LME, Fastmarkets, and AMM.
            Net Recovery Offset (NRO) = scrap price − merchant handling cost.
            Per-MW estimates use asset-class-specific material yield tables.
            Ranges reflect price and yield uncertainty; point estimate is mid-case.
          </div>
        )}
      </div>
    </div>
  )
}

// ── Placeholder sub-tab ───────────────────────────────────────────────────────

// ── 03 Solar PV LCA ───────────────────────────────────────────────────────────

interface SolarPanelRow {
  vintage:             'pre2012' | 'y2012' | 'y2020'
  material:            string
  intensity_t_per_mwp: number
  source_doc:          string
}

interface SolarTechRow {
  technology:       string
  mass_kg_per_kwp:  number
  has_frame:        boolean
  is_hazardous:     boolean
  notes:            string | null
}

interface SolarBopRow {
  mount_type:          string
  material:            string
  intensity_t_per_mwp: number
  notes:               string | null
}

const SOLAR_VINTAGE_LABEL: Record<string, string> = {
  pre2012: 'Pre-2012 (BSF)',
  y2012:   '2012–19 (PERC)',
  y2020:   '2020+ (PERC/TOPCon)',
}

function SolarLca() {
  const [panels, setPanels] = useState<SolarPanelRow[]>([])
  const [techs,  setTechs]  = useState<SolarTechRow[]>([])
  const [bop,    setBop]    = useState<SolarBopRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('solar_panel_intensities').select('vintage, material, intensity_t_per_mwp, source_doc'),
      supabase.from('solar_panel_technologies').select('technology, mass_kg_per_kwp, has_frame, is_hazardous, notes'),
      supabase.from('solar_bop_intensities').select('mount_type, material, intensity_t_per_mwp, notes'),
    ]).then(([p, t, b]) => {
      setPanels((p.data ?? []) as SolarPanelRow[])
      setTechs((t.data ?? []) as SolarTechRow[])
      setBop((b.data ?? []) as SolarBopRow[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="flex-1 flex items-center justify-center text-[12px] text-ink-3">Loading solar LCA…</div>

  // Pivot panels by material × vintage
  const materials = Array.from(new Set(panels.map(r => r.material)))
  const panelMap = new Map<string, number>()
  for (const r of panels) panelMap.set(`${r.material}|${r.vintage}`, r.intensity_t_per_mwp)

  // Silver decline curve (Chart E) — convert t/MWp to kg/MW for readability
  const silverPoints = (['pre2012','y2012','y2020'] as const).map(v => ({
    vintage: v,
    value: (panelMap.get(`silver|${v}`) ?? 0) * 1000,   // t → kg
  }))
  const siliconPoints = (['pre2012','y2012','y2020'] as const).map(v => ({
    vintage: v,
    value: panelMap.get(`silicon|${v}`) ?? 0,
  }))

  return (
    <div className="flex-1 overflow-auto p-5 space-y-5">
      {/* Vintage curve hero — silver collapse story (Chart E) */}
      <div className="bg-panel border border-border rounded-lg p-4">
        <div className="flex items-baseline justify-between mb-3">
          <p className="text-[11px] font-semibold text-ink-2">Silver paste collapse · vintage curve</p>
          <p className="text-[10px] text-ink-3">8× decline from BSF → PERC → TOPCon</p>
        </div>
        <VintageCurveChart
          series={[
            { name: 'Silver (kg/MW)', color: '#C5D9DE', points: silverPoints },
            { name: 'Silicon (t/MWp)', color: '#9BB5BB', points: siliconPoints },
          ]}
          vintageLabels={SOLAR_VINTAGE_LABEL}
          yLabel="intensity"
          decimals={2}
          height={220}
        />
      </div>

      {/* Vintage table */}
      <div className="bg-panel border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[11px] font-semibold text-ink-2">Solar PV panel intensities (t/MWp) — vintage-bucketed</p>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border bg-page">
              <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Material</th>
              {(['pre2012','y2012','y2020'] as const).map(v => (
                <th key={v} className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">{SOLAR_VINTAGE_LABEL[v]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {materials.map((m, i) => (
              <tr key={m} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                <td className="px-4 py-2 text-ink font-semibold capitalize">{m}</td>
                {(['pre2012','y2012','y2020'] as const).map(v => {
                  const val = panelMap.get(`${m}|${v}`)
                  return (
                    <td key={v} className="px-4 py-2 text-right tabular-nums text-ink-2">
                      {val != null ? val.toFixed(3) : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-3 text-[10px] text-ink-4 border-t border-border">
          Silver paste declined ~8× since 2005 (BSF → PERC → TOPCon). Bulk materials (glass, Al, Cu, steel) stable across vintages.
        </p>
      </div>

      {/* Panel tech */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-panel border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[11px] font-semibold text-ink-2">Panel mass by technology (kg/kWp)</p>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border bg-page">
                <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Tech</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">kg/kWp</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Hazardous</th>
              </tr>
            </thead>
            <tbody>
              {techs.map((t, i) => (
                <tr key={t.technology} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                  <td className="px-4 py-2 text-ink uppercase">{t.technology.replace('_', '-')}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-2">{t.mass_kg_per_kwp}</td>
                  <td className="px-4 py-2">
                    {t.is_hazardous
                      ? <span className="text-[10px] font-semibold text-down bg-down/10 px-2 py-0.5 rounded uppercase tracking-wide">RoHS / RCRA</span>
                      : <span className="text-[10px] text-ink-3">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-panel border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[11px] font-semibold text-ink-2">Balance of plant (t/MWp)</p>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border bg-page">
                <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Mount</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Material</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">t/MWp</th>
              </tr>
            </thead>
            <tbody>
              {bop.map((r, i) => (
                <tr key={`${r.mount_type}-${r.material}`} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                  <td className="px-4 py-2 text-ink-2">{r.mount_type.replace('_', ' ')}</td>
                  <td className="px-4 py-2 text-ink capitalize">{r.material}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-2">{r.intensity_t_per_mwp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10px] text-ink-4">
        Sources: IRENA / IEA-PVPS (2016); IEA PVPS Task 12 T12-19:2020; NREL UPV LCA TP-7A40-87372; ITRPV 2024; Silver Institute.
      </p>
    </div>
  )
}

// ── 04 BESS LCA ───────────────────────────────────────────────────────────────

interface BessRow {
  vintage:             'pre2018' | 'y2018' | 'y2022'
  material:            string
  intensity_t_per_mwh: number
}

interface BessRecoveryRow {
  chemistry:        string
  region:           string
  recovery_per_mwh: number
  currency:         string
  notes:            string | null
}

const BESS_VINTAGE_LABEL: Record<string, string> = {
  pre2018: 'Pre-2018 (NMC, ~1.5h)',
  y2018:   '2018–21 (NMC/LFP blend)',
  y2022:   '2022+ (LFP-dominant, ~3h)',
}

function BessLca() {
  const [intens, setIntens]     = useState<BessRow[]>([])
  const [recov,  setRecov]      = useState<BessRecoveryRow[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('bess_intensities').select('vintage, material, intensity_t_per_mwh'),
      supabase.from('bess_recovery_values').select('chemistry, region, recovery_per_mwh, currency, notes'),
    ]).then(([i, r]) => {
      setIntens((i.data ?? []) as BessRow[])
      setRecov((r.data ?? []) as BessRecoveryRow[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="flex-1 flex items-center justify-center text-[12px] text-ink-3">Loading BESS LCA…</div>

  // Pivot intensities by material × vintage
  const materials = Array.from(new Set(intens.map(r => r.material)))
  const intensMap = new Map<string, number>()
  for (const r of intens) intensMap.set(`${r.material}|${r.vintage}`, r.intensity_t_per_mwh)

  // Group recovery by chemistry
  const byChem = new Map<string, BessRecoveryRow[]>()
  for (const r of recov) {
    const arr = byChem.get(r.chemistry) ?? []
    arr.push(r)
    byChem.set(r.chemistry, arr)
  }

  // BESS chemistry-shift curve (Chart E) — show Co/Ni decline + Li rise
  const cobaltPoints = (['pre2018','y2018','y2022'] as const).map(v => ({
    vintage: v, value: intensMap.get(`cobalt|${v}`) ?? 0,
  }))
  const nickelPoints = (['pre2018','y2018','y2022'] as const).map(v => ({
    vintage: v, value: intensMap.get(`nickel|${v}`) ?? 0,
  }))
  const lithiumPoints = (['pre2018','y2018','y2022'] as const).map(v => ({
    vintage: v, value: intensMap.get(`lithium|${v}`) ?? 0,
  }))

  return (
    <div className="flex-1 overflow-auto p-5 space-y-5">
      {/* Chemistry shift hero (Chart E) */}
      <div className="bg-panel border border-border rounded-lg p-4">
        <div className="flex items-baseline justify-between mb-3">
          <p className="text-[11px] font-semibold text-ink-2">NMC → LFP chemistry shift · vintage curve</p>
          <p className="text-[10px] text-ink-3">Cobalt + nickel decline as LFP displaces NMC; lithium rises with longer-duration packs</p>
        </div>
        <VintageCurveChart
          series={[
            { name: 'Cobalt (t/MWh)',  color: '#8DC0C9', points: cobaltPoints },
            { name: 'Nickel (t/MWh)',  color: '#4A9BAA', points: nickelPoints },
            { name: 'Lithium (t/MWh)', color: '#2A7F8E', points: lithiumPoints },
          ]}
          vintageLabels={BESS_VINTAGE_LABEL}
          yLabel="intensity"
          decimals={2}
          height={220}
        />
      </div>

      <div className="bg-panel border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[11px] font-semibold text-ink-2">BESS material intensities (t/MWh) — vintage-bucketed</p>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border bg-page">
              <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Material</th>
              {(['pre2018','y2018','y2022'] as const).map(v => (
                <th key={v} className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">{BESS_VINTAGE_LABEL[v]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {materials.map((m, i) => (
              <tr key={m} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                <td className="px-4 py-2 text-ink font-semibold capitalize">{m}</td>
                {(['pre2018','y2018','y2022'] as const).map(v => {
                  const val = intensMap.get(`${m}|${v}`)
                  return (
                    <td key={v} className="px-4 py-2 text-right tabular-nums text-ink-2">
                      {val != null ? val.toFixed(2) : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-3 text-[10px] text-ink-4 border-t border-border">
          Chemistry shift NMC → LFP visible in cobalt/nickel decline (NMC: 0.20/0.60 → LFP-era 0.05/0.20).
          Lithium intensity rose with longer-duration LFP packs.
        </p>
      </div>

      <div className="bg-panel border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[11px] font-semibold text-ink-2">Net recovery values per MWh — by chemistry × region</p>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border bg-page">
              <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Chemistry</th>
              <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Region</th>
              <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">Recovery/MWh</th>
              <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Driver</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(byChem.entries()).flatMap(([chem, rows]) =>
              rows.map((r, i) => (
                <tr key={`${chem}-${r.region}`} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                  <td className="px-4 py-2 text-ink font-semibold uppercase">{chem}</td>
                  <td className="px-4 py-2 text-ink-2">{r.region}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-up font-semibold">
                    {r.currency === 'GBP' ? '£' : r.currency === 'EUR' ? '€' : r.currency === 'USD' ? '$' : 'A$'}{r.recovery_per_mwh.toLocaleString('en-GB')}
                  </td>
                  <td className="px-4 py-2 text-ink-3 text-[10.5px]">{r.notes ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-ink-4">
        Sources: NREL ATB 2024; Argonne BatPaC v5; BNEF LCOES 2023. LFP recovery driven by lithium (~$21,500/t Li₂CO₃);
        below ~$13,000/t the net return can go negative. NMC recovery driven by cobalt + nickel (Co ~$56k/t LME post DRC quota).
      </p>
    </div>
  )
}

function PlaceholderSubTab({
  title, description, signals,
}: {
  title:       string
  description: string
  signals:     string[]
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8 text-center">
      <div>
        <p className="text-[14px] font-semibold text-ink mb-2">{title}</p>
        <p className="text-[12px] text-ink-3 max-w-md leading-relaxed">{description}</p>
      </div>
      <div className="space-y-2 w-full max-w-sm text-left">
        {signals.map(s => (
          <div key={s} className="flex items-center gap-2.5 px-3 py-2 bg-panel border border-border rounded text-[11.5px] text-ink-3">
            <span className="w-1.5 h-1.5 rounded-full bg-border flex-shrink-0" />
            {s}
          </div>
        ))}
      </div>
      <span className="text-[10px] font-semibold text-ink-4 uppercase tracking-widest bg-page border border-border px-3 py-1 rounded">
        Ingestion in build
      </span>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function MaterialsPage() {
  const [subTab, setSubTab] = useState<SubTab>('prices')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-tab nav */}
      <div className="flex-shrink-0 flex items-stretch border-b border-border bg-panel">
        <div className="flex items-stretch px-5 gap-0">
          {SUB_TABS.map((t, i) => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={clsx(
                'relative px-4 py-3 text-[11.5px] font-medium border-b-2 transition-colors whitespace-nowrap',
                subTab === t.id
                  ? 'border-teal text-teal'
                  : 'border-transparent text-ink-3 hover:text-ink-2',
              )}
            >
              <span className="text-[9px] text-ink-4 mr-1.5">{String(i + 1).padStart(2, '0')}</span>
              {t.label}
            </button>
          ))}
        </div>
        {/* Coverage note */}
        <div className="ml-auto flex items-center pr-5 gap-2">
          <span className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest">Coverage</span>
          {['EU', 'GB', 'US'].map(s => (
            <span key={s} className="text-[9.5px] font-semibold px-1.5 py-px bg-page border border-border rounded text-ink-3">
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {subTab === 'prices' && <CommodityRefs />}
        {subTab === 'nro'    && <NroEstimates />}
        {subTab === 'solar'  && <SolarLca />}
        {subTab === 'bess'   && <BessLca />}

        {subTab === 'flows' && (
          <PlaceholderSubTab
            title="Material Flows"
            description="Volumetric flows of recovered materials by class and geography — steel, copper, aluminium, rare earths — from wind decommissioning events."
            signals={[
              'Annual scrap yield by asset class and vintage cohort',
              'Steel HMS 1 / HMS 2 separation by region',
              'Copper cable recovery volume estimates',
              'Rare earth recovery from permanent magnet generators',
              'Regional material balance: production vs. capacity',
            ]}
          />
        )}

        {subTab === 'trade' && (
          <PlaceholderSubTab
            title="Trade Flows"
            description="Cross-border scrap trade signals — export/import volumes, tariff exposure, and market access constraints affecting recovery value."
            signals={[
              'EU scrap export restrictions (Basel Convention)',
              'UK → EU scrap flow post-Brexit',
              'US Section 232 tariff exposure',
              'Japan scrap export regime — METI classification',
              'Turkey and India import demand signals',
            ]}
          />
        )}
      </div>
    </div>
  )
}
