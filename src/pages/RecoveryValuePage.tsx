import { useState, useEffect, useMemo } from 'react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import { TopBar } from '@/components/layout/TopBar'
import type { TopBarMeta } from '@/components/layout/TopBar'
import { SkeletonTableRow } from '@/components/ui/Skeleton'

// ── Types ─────────────────────────────────────────────────────────────────────

type Region = 'EU' | 'GB' | 'US'
type Currency = 'EUR' | 'GBP' | 'USD'

interface CommodityPrice {
  material_type: string
  region: Region
  price_per_tonne: number
  currency: Currency
  price_date: string
  source_name: string
  confidence: string
  last_reviewed: string
}

interface NroEstimate {
  material_type: string
  region: Region
  currency: Currency
  reference_date: string
  net_per_tonne_low: number
  net_per_tonne_mid: number
  net_per_tonne_high: number
  net_per_mw_low: number | null
  net_per_mw_mid: number | null
  net_per_mw_high: number | null
  confidence: string
  last_reviewed: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const REGIONS: { code: Region; label: string; currency: Currency }[] = [
  { code: 'EU', label: 'Europe', currency: 'EUR' },
  { code: 'GB', label: 'United Kingdom', currency: 'GBP' },
  { code: 'US', label: 'United States', currency: 'USD' },
]

const MATERIAL_LABELS: Record<string, string> = {
  steel_hms1:      'Steel — HMS 1',
  steel_hms2:      'Steel — HMS 2',
  steel_cast_iron: 'Steel — Cast Iron',
  steel_stainless: 'Steel — Stainless',
  copper:          'Copper',
  aluminium:       'Aluminium',
  rare_earth:      'Rare Earths',
}

const MATERIAL_ORDER = [
  'steel_hms1',
  'steel_hms2',
  'steel_cast_iron',
  'steel_stainless',
  'copper',
  'aluminium',
  'rare_earth',
]

const MATERIAL_NOTES: Record<string, string> = {
  steel_hms1:      'Tower sections, heavy structural plate',
  steel_hms2:      'Thinner structural sections',
  steel_cast_iron: 'Gearbox housing — geared turbines only',
  steel_stainless: 'Smaller nacelle components',
  copper:          'Generator windings, cabling',
  aluminium:       'Nacelle housing, components',
  rare_earth:      'Permanent magnet generators only',
}

const CONFIDENCE_COLOUR: Record<string, string> = {
  High:   'text-emerald-400',
  Medium: 'text-amber-400',
  Low:    'text-red-400',
}

const CURRENCY_SYMBOL: Record<Currency, string> = {
  EUR: '€',
  GBP: '£',
  USD: '$',
}

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
  if (low == null && high == null) return fmt(mid, symbol)
  return `${fmt(low, symbol)} – ${fmt(high, symbol)}`
}

// Direction indicator ▲/▼ with percentage change
function PriceDirection({ current, prev }: { current: number; prev: number | undefined }) {
  if (prev == null || prev === 0) return null
  const pct = ((current - prev) / prev) * 100
  if (Math.abs(pct) < 0.05) return null  // effectively flat
  const up = pct > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-mono ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      {up ? '▲' : '▼'}
      {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptySection({ label, cols = 7 }: { label: string; cols?: number }) {
  return (
    <tr>
      <td colSpan={cols} className="px-6 py-8 text-center text-xs text-terminal-muted">
        No {label} data for this region yet. Prices are entered manually — check back after the next update.
      </td>
    </tr>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function RecoveryValuePage() {
  const [region, setRegion] = useState<Region>('EU')
  const [prices, setPrices] = useState<CommodityPrice[]>([])
  const [prevPrices, setPrevPrices] = useState<Record<string, CommodityPrice>>({})
  const [nro, setNro] = useState<NroEstimate[]>([])
  const [loading, setLoading] = useState(true)

  const currency = REGIONS.find(r => r.code === region)?.currency ?? 'EUR'
  const symbol = CURRENCY_SYMBOL[currency]

  useEffect(() => {
    const fetch = async () => {
      setLoading(true)
      try {
        // Latest price per material for this region
        const [priceRes, nroRes] = await Promise.all([
          supabase
            .from('commodity_prices')
            .select('*')
            .eq('region', region)
            .order('price_date', { ascending: false }),
          supabase
            .from('nro_estimates')
            .select('*')
            .eq('region', region)
            .order('reference_date', { ascending: false }),
        ])

        // Keep latest and second-latest per material for direction indicator
        const latestPrices: Record<string, CommodityPrice>  = {}
        const prevPricesMap: Record<string, CommodityPrice> = {}
        for (const p of priceRes.data ?? []) {
          if (!latestPrices[p.material_type])       latestPrices[p.material_type]  = p
          else if (!prevPricesMap[p.material_type]) prevPricesMap[p.material_type] = p
        }
        setPrices(Object.values(latestPrices))
        setPrevPrices(prevPricesMap)

        // Deduplicate: keep latest NRO per material
        const latestNro: Record<string, NroEstimate> = {}
        for (const n of nroRes.data ?? []) {
          if (!latestNro[n.material_type]) latestNro[n.material_type] = n
        }
        setNro(Object.values(latestNro))
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [region])

  const priceMap = Object.fromEntries(prices.map(p => [p.material_type, p]))
  const nroMap   = Object.fromEntries(nro.map(n => [n.material_type, n]))
  const prevMap  = prevPrices   // already a Record<string, CommodityPrice>

  // Most recent price_date and source for the current region
  const priceMeta = useMemo((): TopBarMeta[] => {
    if (prices.length === 0) return []
    const sorted  = [...prices].sort((a, b) => b.price_date.localeCompare(a.price_date))
    const latest  = sorted[0]
    // Collect unique source names
    const sources = [...new Set(prices.map(p => p.source_name).filter(Boolean))].join(' · ')
    return [
      { label: 'Source', value: sources || '—' },
      { label: 'Prices as of', value: fmtDate(latest.price_date) },
    ]
  }, [prices])

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      <TopBar
        title="Recovery Value"
        subtitle="Scrap metal prices and net recovery offset by material and region"
        meta={priceMeta}
      />

      {/* Region tabs */}
      <div className="border-b border-terminal-border bg-terminal-surface px-6">
        <div className="flex items-center gap-0">
          {REGIONS.map(r => (
            <button
              key={r.code}
              onClick={() => setRegion(r.code)}
              className={clsx(
                'px-5 py-3 text-xs font-medium border-b-2 transition-colors',
                region === r.code
                  ? 'border-terminal-teal text-terminal-teal'
                  : 'border-transparent text-terminal-muted hover:text-gray-800'
              )}
            >
              {r.label}
              <span className="ml-1.5 text-[10px] font-mono opacity-60">{r.currency}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 space-y-6">

        {/* ── Scrap Prices ─────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-terminal-text">Scrap Metal Prices</h2>
              <p className="text-xs text-terminal-muted mt-0.5">
                Published market prices — source attributed. Updated daily.
              </p>
            </div>
          </div>

          <div className="border border-terminal-border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-terminal-black border-b border-terminal-border">
                  {[
                    ['Material', 'text-left pl-5 py-2.5 pr-3'],
                    ['Component', 'text-left py-2.5 pr-3 text-terminal-muted'],
                    ['Price / tonne', 'text-right py-2.5 pr-3 font-mono'],
                    ['Change', 'text-right py-2.5 pr-3 font-mono'],
                    ['Source', 'text-left py-2.5 pr-3'],
                    ['Price Date', 'text-left py-2.5 pr-3 font-mono'],
                    ['Confidence', 'text-left py-2.5 pr-5'],
                  ].map(([label, cls]) => (
                    <th key={label} className={clsx(
                      'text-[10px] text-terminal-muted font-medium tracking-wide uppercase', cls
                    )}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 7 }).map((_, i) => <SkeletonTableRow key={i} cols={7} />)
                ) : prices.length === 0 ? (
                  <EmptySection label="scrap price" />
                ) : (
                  MATERIAL_ORDER.map(mat => {
                    const p    = priceMap[mat]
                    const prev = prevMap[mat]
                    return (
                      <tr key={mat} className="border-b border-terminal-border last:border-0">
                        <td className="pl-5 py-3 pr-3 font-medium text-terminal-text">
                          {MATERIAL_LABELS[mat]}
                        </td>
                        <td className="py-3 pr-3 text-terminal-muted">
                          {MATERIAL_NOTES[mat]}
                        </td>
                        <td className="py-3 pr-3 text-right font-mono text-terminal-text font-medium">
                          {p ? fmt(p.price_per_tonne, symbol) : '—'}
                        </td>
                        <td className="py-3 pr-3 text-right">
                          {p && prev
                            ? <PriceDirection current={p.price_per_tonne} prev={prev.price_per_tonne} />
                            : <span className="text-[11px] font-mono text-terminal-border">—</span>
                          }
                        </td>
                        <td className="py-3 pr-3 text-terminal-muted font-mono">
                          {p?.source_name ?? '—'}
                        </td>
                        <td className="py-3 pr-3 text-terminal-muted font-mono">
                          {p ? fmtDate(p.price_date) : '—'}
                        </td>
                        <td className="py-3 pr-5">
                          {p ? (
                            <span className={clsx('font-mono', CONFIDENCE_COLOUR[p.confidence])}>
                              {p.confidence}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── NRO Estimates ────────────────────────────────────────── */}
        <div>
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-terminal-text">Net Recovery Offset (NRO)</h2>
            <p className="text-xs text-terminal-muted mt-0.5">
              Net recovery value after merchant costs. Shown as a range (low – high).
              Merchant margin is not disclosed.
            </p>
          </div>

          <div className="border border-terminal-border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-terminal-black border-b border-terminal-border">
                  {[
                    ['Material', 'text-left pl-5 py-2.5 pr-3'],
                    ['Net / tonne', 'text-right py-2.5 pr-3 font-mono'],
                    ['Net / MW', 'text-right py-2.5 pr-3 font-mono'],
                    ['Reference Date', 'text-left py-2.5 pr-3 font-mono'],
                    ['Confidence', 'text-left py-2.5 pr-3'],
                    ['Last Reviewed', 'text-left py-2.5 pr-5 font-mono'],
                  ].map(([label, cls]) => (
                    <th key={label} className={clsx(
                      'text-[10px] text-terminal-muted font-medium tracking-wide uppercase', cls
                    )}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 7 }).map((_, i) => <SkeletonTableRow key={i} cols={6} />)
                ) : nro.length === 0 ? (
                  <EmptySection label="NRO estimate" />
                ) : (
                  MATERIAL_ORDER.map(mat => {
                    const n = nroMap[mat]
                    return (
                      <tr key={mat} className="border-b border-terminal-border last:border-0">
                        <td className="pl-5 py-3 pr-3 font-medium text-terminal-text">
                          {MATERIAL_LABELS[mat]}
                        </td>
                        <td className="py-3 pr-3 text-right font-mono text-terminal-text">
                          {n ? fmtRange(n.net_per_tonne_low, n.net_per_tonne_mid, n.net_per_tonne_high, symbol) : '—'}
                        </td>
                        <td className="py-3 pr-3 text-right font-mono text-gray-700">
                          {n ? fmtRange(n.net_per_mw_low, n.net_per_mw_mid, n.net_per_mw_high, symbol) : '—'}
                        </td>
                        <td className="py-3 pr-3 text-terminal-muted font-mono">
                          {n ? fmtDate(n.reference_date) : '—'}
                        </td>
                        <td className="py-3 pr-3">
                          {n ? (
                            <span className={clsx('font-mono', CONFIDENCE_COLOUR[n.confidence])}>
                              {n.confidence}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="py-3 pr-5 text-terminal-muted font-mono">
                          {n ? fmtDate(n.last_reviewed) : '—'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Methodology note */}
        <div className="bg-terminal-black border border-terminal-border rounded-lg px-5 py-4">
          <div className="text-[10px] text-terminal-muted font-mono tracking-widest uppercase mb-2">
            Methodology
          </div>
          <p className="text-xs text-terminal-muted leading-relaxed">
            Material volumes sourced from OEM Life Cycle Assessment (LCA) documents.
            Scrap prices sourced from published market indices (LME, Fastmarkets, AMM).
            Net Recovery Offset (NRO) = scrap price minus merchant handling cost.
            Merchant margins are commercially sensitive and not disclosed.
            NRO estimates are published as ranges reflecting price and volume uncertainty.
          </p>
        </div>
      </div>
    </div>
  )
}
