// ── Chart B — DCI series comparison overlay ─────────────────────────────────
// Multi-line chart showing all live DCI series rebased to 100 at base period,
// so divergence between regions is visually obvious.

import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, ReferenceLine,
} from 'recharts'

interface Pub {
  series:           string
  publication_date: string
  index_value:      number | null
}

const SERIES_META: { key: string; label: string; color: string }[] = [
  { key: 'dci_wind_europe',        label: 'Wind Europe',         color: '#007B8A' },
  { key: 'dci_wind_north_america', label: 'Wind North America',  color: '#C4863A' },
]

function fmtMonth(d: string): string {
  try { return new Date(d).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) }
  catch { return d }
}

export function DciSeriesOverlay({ history }: { history: Pub[] }) {
  const data = useMemo(() => {
    // Wide format: { date, dci_wind_europe: 102.3, dci_wind_north_america: 99.8, ... }
    const byDate = new Map<string, Record<string, number | string>>()
    for (const p of history) {
      if (p.index_value == null) continue
      const row = byDate.get(p.publication_date) ?? { date: p.publication_date }
      row[p.series] = p.index_value
      byDate.set(p.publication_date, row)
    }
    return Array.from(byDate.values())
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  }, [history])

  if (data.length < 2) {
    return (
      <div className="h-56 flex items-center justify-center text-[12px] text-ink-3">
        Need at least two publications per series to compare
      </div>
    )
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E8EC" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtMonth} tick={{ fill: '#98A1AE', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis domain={['auto','auto']} tick={{ fill: '#98A1AE', fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
          <ReferenceLine y={100} stroke="#D0D5DB" strokeDasharray="4 2" label={{ value: 'Base', fill: '#98A1AE', fontSize: 10, position: 'right' }} />
          <Tooltip
            contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E8EC', borderRadius: 6, fontSize: 11, color: '#0A1628' }}
            labelFormatter={(label: unknown) => fmtMonth(label as string)}
            formatter={(v: unknown) => [(v as number).toFixed(2), 'Index']}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
          {SERIES_META.map(s => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                  stroke={s.color} strokeWidth={1.5}
                  dot={{ r: 2, fill: s.color, strokeWidth: 0 }}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
