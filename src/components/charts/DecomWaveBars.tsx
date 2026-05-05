// ── Chart H — Forward decommissioning wave ─────────────────────────────────
// Bars showing GW reaching EOL per year (install_year + 25yr design life).
// Colour-codes past / near / mid / far horizons.

import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer,
  ReferenceLine,
} from 'recharts'

interface InstallRow {
  install_year: number
  installed_gw: number
}

const DESIGN_LIFE = 25

export function DecomWaveBars({
  installs, todayYear = new Date().getFullYear(),
}: {
  installs: InstallRow[]
  todayYear?: number
}) {
  const data = useMemo(() => {
    // Aggregate installs by year
    const byInstallYear = new Map<number, number>()
    for (const r of installs) {
      byInstallYear.set(r.install_year,
        (byInstallYear.get(r.install_year) ?? 0) + Number(r.installed_gw))
    }
    // EOL year = install_year + design life
    const byEolYear = new Map<number, number>()
    for (const [iy, gw] of byInstallYear) {
      const eol = iy + DESIGN_LIFE
      byEolYear.set(eol, (byEolYear.get(eol) ?? 0) + gw)
    }
    return Array.from(byEolYear.entries())
      .filter(([eol]) => eol >= todayYear - 5 && eol <= todayYear + 25)
      .sort((a, b) => a[0] - b[0])
      .map(([eol_year, eol_gw]) => ({ eol_year, eol_gw }))
  }, [installs, todayYear])

  if (!data.length) {
    return <div className="h-56 flex items-center justify-center text-[12px] text-ink-3">No projection data</div>
  }

  const fillFor = (eol: number): string => {
    if (eol < todayYear)        return '#C03939'   // past
    if (eol <= todayYear + 5)   return '#E89C2C'   // near (≤5yr)
    if (eol <= todayYear + 10)  return '#3D8A9A'   // mid (5-10yr)
    return '#5A8A95'                               // far (>10yr)
  }

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E8EC" vertical={false} />
          <XAxis dataKey="eol_year" tick={{ fill: '#98A1AE', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#98A1AE', fontSize: 10 }} axisLine={false} tickLine={false} width={40}
                 label={{ value: 'GW reaching EOL', angle: -90, position: 'insideLeft', fill: '#98A1AE', fontSize: 10 }} />
          <ReferenceLine x={todayYear} stroke="#0A1628" strokeDasharray="4 2"
                         label={{ value: 'Today', fill: '#0A1628', fontSize: 10, position: 'top' }} />
          <Tooltip
            contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E8EC', borderRadius: 6, fontSize: 11, color: '#0A1628' }}
            formatter={(v: unknown) => [`${(v as number).toFixed(2)} GW`, 'EOL volume']}
            labelFormatter={(label: unknown) => `Year ${label}`}
          />
          <Bar dataKey="eol_gw" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {data.map((row, i) => (
              <Cell key={i} fill={fillFor(row.eol_year)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
