import { useState, useEffect } from 'react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import { TopBar } from '@/components/layout/TopBar'

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
  High:   'text-emerald-600',
  Medium: 'text-amber-600',
  Low:    'text-red-500',
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

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptySection({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={6} className="px-6 py-8 text-center text-xs text-gray-400">
        No {label} data for this region yet. Prices are entered manually — check back after the next update.
      </td>
    </tr>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function RecoveryValuePage() {
  const [region, setRegion] = useState<Region>('EU')
  const [prices, setPrices] = useState<CommodityPrice[]>([])
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

        // Deduplicate: keep latest price per material
        const latestPrices: Record<string, CommodityPrice> = {}
        for (const p of priceRes.data ?? []) {
          if (!latestPrices[p.material_type]) latestPrices[p.material_type] = p
        }
        setPrices(Object.values(latestPrices))

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
  const nroMap = Object.fromEntries(nro.map(n => [n.material_type, n]))

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      <TopBar
        title="Recovery Value"
        subtitle="Scrap metal prices and net recovery offset by material and region"
      />

      {/* Region tabs */}
      <div className="border-b border-gray-200 bg-white px-6">
        <div className="flex items-center gap-0">
          {REGIONS.map(r => (
            <button
              key={r.code}
              onClick={() => setRegion(r.code)}
              className={clsx(
                'px-5 py-3 text-xs font-medium border-b-2 transition-colors',
                region === r.code
                  ? 'border-terminal-teal text-terminal-teal'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
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
              <h2 className="text-sm font-semibold text-gray-900">Scrap Metal Prices</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Published market prices — source attributed. Updated daily.
              </p>
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {[
                    ['Material', 'text-left pl-5 py-2.5 pr-3'],
                    ['Component', 'text-left py-2.5 pr-3 text-gray-400'],
                    ['Price / tonne', 'text-right py-2.5 pr-3 font-mono'],
                    ['Source', 'text-left py-2.5 pr-3'],
                    ['Price Date', 'text-left py-2.5 pr-3 font-mono'],
                    ['Confidence', 'text-left py-2.5 pr-5'],
                  ].map(([label, cls]) => (
                    <th key={label} className={clsx(
                      'text-[10px] text-gray-400 font-medium tracking-wide uppercase', cls
                    )}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-xs text-gray-400 font-mono">
                      Loading…
                    </td>
                  </tr>
                ) : prices.length === 0 ? (
                  <EmptySection label="scrap price" />
                ) : (
                  MATERIAL_ORDER.map(mat => {
                    const p = priceMap[mat]
                    return (
                      <tr key={mat} className="border-b border-gray-100 last:border-0">
                        <td className="pl-5 py-3 pr-3 font-medium text-gray-900">
                          {MATERIAL_LABELS[mat]}
                        </td>
                        <td className="py-3 pr-3 text-gray-400">
                          {MATERIAL_NOTES[mat]}
                        </td>
                        <td className="py-3 pr-3 text-right font-mono text-gray-900 font-medium">
                          {p ? fmt(p.price_per_tonne, symbol) : '—'}
                        </td>
                        <td className="py-3 pr-3 text-gray-500 font-mono">
                          {p?.source_name ?? '—'}
                        </td>
                        <td className="py-3 pr-3 text-gray-500 font-mono">
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
            <h2 className="text-sm font-semibold text-gray-900">Net Recovery Offset (NRO)</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Net recovery value after merchant costs. Shown as a range (low – high).
              Merchant margin is not disclosed.
            </p>
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {[
                    ['Material', 'text-left pl-5 py-2.5 pr-3'],
                    ['Net / tonne', 'text-right py-2.5 pr-3 font-mono'],
                    ['Net / MW', 'text-right py-2.5 pr-3 font-mono'],
                    ['Reference Date', 'text-left py-2.5 pr-3 font-mono'],
                    ['Confidence', 'text-left py-2.5 pr-3'],
                    ['Last Reviewed', 'text-left py-2.5 pr-5 font-mono'],
                  ].map(([label, cls]) => (
                    <th key={label} className={clsx(
                      'text-[10px] text-gray-400 font-medium tracking-wide uppercase', cls
                    )}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-xs text-gray-400 font-mono">
                      Loading…
                    </td>
                  </tr>
                ) : nro.length === 0 ? (
                  <EmptySection label="NRO estimate" />
                ) : (
                  MATERIAL_ORDER.map(mat => {
                    const n = nroMap[mat]
                    return (
                      <tr key={mat} className="border-b border-gray-100 last:border-0">
                        <td className="pl-5 py-3 pr-3 font-medium text-gray-900">
                          {MATERIAL_LABELS[mat]}
                        </td>
                        <td className="py-3 pr-3 text-right font-mono text-gray-900">
                          {n ? fmtRange(n.net_per_tonne_low, n.net_per_tonne_mid, n.net_per_tonne_high, symbol) : '—'}
                        </td>
                        <td className="py-3 pr-3 text-right font-mono text-gray-700">
                          {n ? fmtRange(n.net_per_mw_low, n.net_per_mw_mid, n.net_per_mw_high, symbol) : '—'}
                        </td>
                        <td className="py-3 pr-3 text-gray-500 font-mono">
                          {n ? fmtDate(n.reference_date) : '—'}
                        </td>
                        <td className="py-3 pr-3">
                          {n ? (
                            <span className={clsx('font-mono', CONFIDENCE_COLOUR[n.confidence])}>
                              {n.confidence}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="py-3 pr-5 text-gray-500 font-mono">
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
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-5 py-4">
          <div className="text-[10px] text-gray-400 font-mono tracking-widest uppercase mb-2">
            Methodology
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
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
