// ── Chart D — NRO material attribution donut ───────────────────────────────
// Reusable donut chart for material/category breakdowns. Used in SMI and
// Portfolio. Pass `slices` as label/value/color tuples.

import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

export interface DonutSlice {
  label: string
  value: number
  color: string
}

const PALETTE = [
  '#0A1628', '#007B8A', '#1C3D52', '#4A9BAA', '#C4863A',
  '#2A7F8E', '#3D6E7A', '#5A8A95', '#6BAAB5', '#9BB5BB',
]

const CCY: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' }

export function MaterialDonut({
  slices, total, currency = 'EUR', height = 260, centerLabel,
}: {
  slices: DonutSlice[]
  total: number
  currency?: string
  height?: number
  centerLabel?: string
}) {
  const sym = CCY[currency] ?? ''
  const fmt = (v: number) => v >= 1_000_000
    ? `${sym}${(v/1_000_000).toFixed(2)}M`
    : v >= 1_000
    ? `${sym}${(v/1_000).toFixed(0)}k`
    : `${sym}${v.toFixed(0)}`

  if (!slices.length || total <= 0) {
    return (
      <div className="flex items-center justify-center text-[12px] text-ink-3" style={{ height }}>
        No data to attribute
      </div>
    )
  }

  return (
    <div style={{ height }} className="relative">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="label"
               cx="50%" cy="50%" innerRadius="55%" outerRadius="85%"
               paddingAngle={1.5} stroke="none" isAnimationActive={false}>
            {slices.map((s, i) => (
              <Cell key={i} fill={s.color || PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E8EC', borderRadius: 6, fontSize: 11, color: '#0A1628' }}
            formatter={(v: unknown, name: unknown) => [
              `${fmt(v as number)} (${(((v as number) / total) * 100).toFixed(1)}%)`,
              name as string,
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} verticalAlign="bottom" />
        </PieChart>
      </ResponsiveContainer>
      {/* Center label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ paddingBottom: 28 }}>
        <p className="text-[9px] font-semibold text-ink-4 uppercase tracking-widest">{centerLabel ?? 'Total'}</p>
        <p className="text-[18px] font-semibold text-ink tabular-nums">{fmt(total)}</p>
      </div>
    </div>
  )
}
