// ── Chart B — DCI series comparison overlay (light) ────────────────────────

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
  { key: 'dci_wind_europe',        label: 'WIND.EU', color: '#0E7A86' },
  { key: 'dci_wind_north_america', label: 'WIND.NA', color: '#D97706' },
]

function fmtMonth(d: string): string {
  try { return new Date(d).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) }
  catch { return d }
}

export function DciSeriesOverlay({ history }: { history: Pub[] }) {
  const data = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>()
    for (const p of history) {
      if (p.index_value == null) continue
      const row = byDate.get(p.publication_date) ?? { date: p.publication_date }
      row[p.series] = p.index_value
      byDate.set(p.publication_date, row)
    }
    return Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)))
  }, [history])

  if (data.length < 2) {
    return <div className="h-48 flex items-center justify-center text-[11.5px] text-ink-4">—</div>
  }

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#E5E8EC" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtMonth}
                 tick={{ fill: '#98A1AE', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis domain={['auto','auto']} tick={{ fill: '#98A1AE', fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
          <ReferenceLine y={100} stroke="#D6DBE0" strokeDasharray="3 2"
                         label={{ value: '100', fill: '#98A1AE', fontSize: 11, position: 'right' }} />
          <Tooltip
            contentStyle={{ background: '#FFFFFF', border: '1px solid #D6DBE0', borderRadius: 2, fontSize: 12, color: '#0A1628' }}
            labelFormatter={(label: unknown) => fmtMonth(label as string)}
            formatter={(v: unknown) => [(v as number).toFixed(2), 'Idx']}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: '#6B7585' }} iconSize={8} />
          {SERIES_META.map(s => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                  stroke={s.color} strokeWidth={1.6}
                  dot={{ r: 2, fill: s.color, strokeWidth: 0 }}
                  activeDot={{ r: 3.5 }}
                  isAnimationActive={false} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
