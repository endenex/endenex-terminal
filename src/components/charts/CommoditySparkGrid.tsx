// ── Chart F — Commodity price multi-spark grid (light) ─────────────────────

import { Sparklines, SparklinesLine, SparklinesSpots } from './Sparklines'

export interface PriceSeries {
  material:    string
  region:      string
  currency:    string
  history:     { date: string; price: number }[]
}

const CCY: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' }

const MATERIAL_LABELS: Record<string, string> = {
  steel_hms1:      'Steel HMS1',
  steel_hms2:      'Steel HMS2',
  steel_cast_iron: 'Cast Iron',
  steel_stainless: 'Stainless',
  copper:          'Copper',
  aluminium:       'Aluminium',
  zinc:            'Zinc',
  rare_earth:      'NdPr',
}

function fmtShort(n: number, sym: string): string {
  if (n >= 10_000) return `${sym}${(n/1000).toFixed(1)}k`
  return `${sym}${n.toFixed(0)}`
}

export function CommoditySparkGrid({ series, regions = ['EU', 'GB', 'US'] }: {
  series:  PriceSeries[]
  regions?: string[]
}) {
  const materialKeys = Object.keys(MATERIAL_LABELS).filter(m => series.some(s => s.material === m))
  const lookup = new Map<string, PriceSeries>()
  for (const s of series) lookup.set(`${s.material}|${s.region}`, s)

  return (
    <div className="bg-panel border border-border rounded-sm overflow-hidden">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-border bg-titlebar">
            <th className="px-2.5 py-1.5 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Material</th>
            {regions.map(r => (
              <th key={r} className="px-2.5 py-1.5 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide" colSpan={2}>
                {r}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {materialKeys.map(m => (
            <tr key={m} className="border-b border-border/70 hover:bg-raised">
              <td className="px-2.5 py-1.5 text-ink font-medium">{MATERIAL_LABELS[m]}</td>
              {regions.map(r => {
                const s = lookup.get(`${m}|${r}`)
                if (!s || s.history.length === 0) {
                  return (
                    <>
                      <td key={`${r}-spark`} className="px-2.5 py-1.5 text-ink-4">—</td>
                      <td key={`${r}-val`}   className="px-2.5 py-1.5 text-ink-4">—</td>
                    </>
                  )
                }
                const sortedAsc = [...s.history].sort((a, b) => a.date.localeCompare(b.date))
                const values = sortedAsc.map(h => h.price)
                const last = values[values.length - 1] ?? 0
                const prev = values[values.length - 2] ?? last
                const pct = prev !== 0 ? ((last - prev) / prev) * 100 : 0
                const sym = CCY[s.currency] ?? ''
                const up = pct > 0
                const flat = Math.abs(pct) < 0.05
                return (
                  <>
                    <td key={`${r}-spark`} className="px-2.5 py-1.5 w-16">
                      <Sparklines data={values} width={60} height={18}>
                        <SparklinesLine color={up ? '#C73838' : '#0F8B58'} strokeWidth={1.2} />
                        <SparklinesSpots color={up ? '#C73838' : '#0F8B58'} size={1.4} />
                      </Sparklines>
                    </td>
                    <td key={`${r}-val`} className="px-2.5 py-1.5 tabular-nums">
                      <span className="text-ink font-semibold">{fmtShort(last, sym)}</span>
                      <span className={`ml-1 text-[10.5px] ${flat ? 'text-ink-4' : up ? 'text-down' : 'text-up'}`}>
                        {flat ? '' : (up ? '▲' : '▼')}{Math.abs(pct).toFixed(1)}%
                      </span>
                    </td>
                  </>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
