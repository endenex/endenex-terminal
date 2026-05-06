// ── Chart E — Vintage decline / chemistry shift curve (light) ──────────────

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

export interface VintageSeries {
  name: string
  color: string
  points: { vintage: string; value: number }[]
}

export function VintageCurveChart({
  series, vintageLabels, yLabel, height = 220, decimals = 2,
}: {
  series: VintageSeries[]
  vintageLabels: Record<string, string>
  yLabel: string
  height?: number
  decimals?: number
}) {
  const vintages = Object.keys(vintageLabels)
  const data = vintages.map(v => {
    const row: Record<string, number | string> = { vintage_label: vintageLabels[v] }
    for (const s of series) {
      const pt = s.points.find(p => p.vintage === v)
      if (pt) row[s.name] = pt.value
    }
    return row
  })

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#E5E8EC" vertical={false} />
          <XAxis dataKey="vintage_label" tick={{ fill: '#6B7585', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: '#98A1AE', fontSize: 11 }}
                 tick={{ fill: '#98A1AE', fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
          <Tooltip
            contentStyle={{ background: '#FFFFFF', border: '1px solid #D6DBE0', borderRadius: 2, fontSize: 12, color: '#0A1628' }}
            formatter={(v: unknown, name: unknown) => [(v as number).toFixed(decimals), name as string]}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: '#6B7585' }} iconSize={8} />
          {series.map(s => (
            <Line key={s.name} type="monotone" dataKey={s.name} stroke={s.color}
                  strokeWidth={1.8}
                  dot={{ r: 3, fill: s.color, strokeWidth: 0 }}
                  activeDot={{ r: 5 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
