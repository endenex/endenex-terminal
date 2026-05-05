// ── Chart E — Vintage decline / chemistry shift curve ──────────────────────
// Generic line chart for showing how a single metric (e.g. silver intensity,
// cobalt content) evolves across vintage buckets.

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

export interface VintageSeries {
  /** Display name in legend, e.g. 'Silver', 'Cobalt' */
  name: string
  color: string
  /** Per-vintage value: { vintage: 'pre2012', value: 0.10 } */
  points: { vintage: string; value: number }[]
}

export function VintageCurveChart({
  series, vintageLabels, yLabel, height = 260, decimals = 2,
}: {
  series: VintageSeries[]
  /** Ordered vintage codes → display labels, e.g. { pre2012: 'pre-2012 BSF' } */
  vintageLabels: Record<string, string>
  yLabel: string
  height?: number
  decimals?: number
}) {
  const vintages = Object.keys(vintageLabels)

  // Wide format for Recharts: { vintage_label, [series_name]: value }
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
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E8EC" vertical={false} />
          <XAxis dataKey="vintage_label" tick={{ fill: '#4A5560', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: '#98A1AE', fontSize: 10 }}
                 tick={{ fill: '#98A1AE', fontSize: 10 }} axisLine={false} tickLine={false} width={56} />
          <Tooltip
            contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E8EC', borderRadius: 6, fontSize: 11, color: '#0A1628' }}
            formatter={(v: unknown, name: unknown) => [(v as number).toFixed(decimals), name as string]}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
          {series.map(s => (
            <Line key={s.name} type="monotone" dataKey={s.name} stroke={s.color}
                  strokeWidth={2}
                  dot={{ r: 4, fill: s.color, strokeWidth: 0 }}
                  activeDot={{ r: 6 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
