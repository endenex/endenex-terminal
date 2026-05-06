// ── Chart D — NRO material donut (light) ───────────────────────────────────

import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

export interface DonutSlice {
  label: string
  value: number
  color: string
}

const PALETTE = [
  '#0E7A86', '#14A4B4', '#D97706', '#0F8B58', '#7C3AED',
  '#0A5C66', '#6B7585', '#3D4759', '#F59E0B', '#1B6B45',
]

const CCY: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' }

export function MaterialDonut({
  slices, total, currency = 'EUR', height = 220, centerLabel,
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
    : v >= 1_000 ? `${sym}${(v/1_000).toFixed(0)}k` : `${sym}${v.toFixed(0)}`

  if (!slices.length || total <= 0) {
    return <div className="flex items-center justify-center text-[11.5px] text-ink-4" style={{ height }}>—</div>
  }

  return (
    <div style={{ height }} className="relative">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="label"
               cx="50%" cy="50%" innerRadius="55%" outerRadius="85%"
               paddingAngle={1} stroke="none" isAnimationActive={false}>
            {slices.map((s, i) => (
              <Cell key={i} fill={s.color || PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: '#FFFFFF', border: '1px solid #D6DBE0', borderRadius: 2, fontSize: 12, color: '#0A1628' }}
            formatter={(v: unknown, name: unknown) => [
              `${fmt(v as number)} (${(((v as number) / total) * 100).toFixed(1)}%)`,
              name as string,
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: '#6B7585' }} iconSize={8} verticalAlign="bottom" />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ paddingBottom: 28 }}>
        <p className="text-[10px] font-semibold text-ink-4 uppercase tracking-widest">{centerLabel ?? 'Total'}</p>
        <p className="text-[16px] font-semibold text-ink tabular-nums">{fmt(total)}</p>
      </div>
    </div>
  )
}
