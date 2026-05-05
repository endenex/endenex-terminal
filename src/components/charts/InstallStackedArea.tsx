// ── Chart G — Installation pipeline stacked area ───────────────────────────
// Stacked area: GW installed per year by sub-region.

import { useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

interface Row {
  install_year:  number
  sub_region:    string
  installed_gw:  number
}

const SUBREGION_COLORS: Record<string, string> = {
  Scotland:           '#0A1628',
  England:            '#007B8A',
  Wales:              '#C4863A',
  'Northern Ireland': '#4A9BAA',
  Total:              '#007B8A',
}

export function InstallStackedArea({
  rows, regions,
}: {
  rows: Row[]
  /** Ordered list of sub-regions to stack (top to bottom) */
  regions: string[]
}) {
  const data = useMemo(() => {
    const byYear = new Map<number, Record<string, number | string>>()
    for (const r of rows) {
      const yr = byYear.get(r.install_year) ?? { year: r.install_year }
      yr[r.sub_region] = (Number(yr[r.sub_region]) || 0) + Number(r.installed_gw)
      byYear.set(r.install_year, yr)
    }
    return Array.from(byYear.values()).sort((a, b) => Number(a.year) - Number(b.year))
  }, [rows])

  if (data.length === 0) {
    return <div className="h-56 flex items-center justify-center text-[12px] text-ink-3">No installation data</div>
  }

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E8EC" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: '#98A1AE', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#98A1AE', fontSize: 10 }} axisLine={false} tickLine={false} width={40}
                 label={{ value: 'GW', angle: -90, position: 'insideLeft', fill: '#98A1AE', fontSize: 10 }} />
          <Tooltip
            contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E8EC', borderRadius: 6, fontSize: 11, color: '#0A1628' }}
            formatter={(v: unknown, name: unknown) => [`${(v as number).toFixed(2)} GW`, name as string]}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
          {regions.map(r => (
            <Area key={r} type="monotone" dataKey={r} stackId="1"
                  stroke={SUBREGION_COLORS[r] ?? '#007B8A'}
                  fill={SUBREGION_COLORS[r] ?? '#007B8A'}
                  fillOpacity={0.85} isAnimationActive={false} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
