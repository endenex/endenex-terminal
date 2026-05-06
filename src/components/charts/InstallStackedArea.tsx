// ── Chart G — Installation pipeline stacked area (light) ───────────────────

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
  Scotland:           '#0E7A86',
  England:            '#14A4B4',
  Wales:              '#D97706',
  'Northern Ireland': '#0F8B58',
  Total:              '#0E7A86',
}

export function InstallStackedArea({
  rows, regions,
}: {
  rows: Row[]
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
    return <div className="h-48 flex items-center justify-center text-[11.5px] text-ink-4">—</div>
  }

  return (
    <div className="h-60">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#E5E8EC" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: '#98A1AE', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#98A1AE', fontSize: 11 }} axisLine={false} tickLine={false} width={36}
                 label={{ value: 'GW', angle: -90, position: 'insideLeft', fill: '#98A1AE', fontSize: 11 }} />
          <Tooltip
            contentStyle={{ background: '#FFFFFF', border: '1px solid #D6DBE0', borderRadius: 2, fontSize: 12, color: '#0A1628' }}
            formatter={(v: unknown, name: unknown) => [`${(v as number).toFixed(2)} GW`, name as string]}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: '#6B7585' }} iconSize={8} />
          {regions.map(r => (
            <Area key={r} type="monotone" dataKey={r} stackId="1"
                  stroke={SUBREGION_COLORS[r] ?? '#0E7A86'}
                  fill={SUBREGION_COLORS[r] ?? '#0E7A86'}
                  fillOpacity={0.75} isAnimationActive={false} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
