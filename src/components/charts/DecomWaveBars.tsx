// ── Chart H — Forward decommissioning wave (light) ─────────────────────────

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
    const byInstallYear = new Map<number, number>()
    for (const r of installs) {
      byInstallYear.set(r.install_year, (byInstallYear.get(r.install_year) ?? 0) + Number(r.installed_gw))
    }
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
    return <div className="h-48 flex items-center justify-center text-[11.5px] text-ink-4">—</div>
  }

  const fillFor = (eol: number): string => {
    if (eol < todayYear)        return '#C73838'
    if (eol <= todayYear + 5)   return '#D97706'
    if (eol <= todayYear + 10)  return '#0E7A86'
    return '#0A5C66'
  }

  return (
    <div className="h-60">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#E5E8EC" vertical={false} />
          <XAxis dataKey="eol_year" tick={{ fill: '#98A1AE', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#98A1AE', fontSize: 11 }} axisLine={false} tickLine={false} width={36}
                 label={{ value: 'GW EOL', angle: -90, position: 'insideLeft', fill: '#98A1AE', fontSize: 11 }} />
          <ReferenceLine x={todayYear} stroke="#0A1628" strokeDasharray="3 2" strokeOpacity={0.4}
                         label={{ value: 'Today', fill: '#0A1628', fontSize: 11, position: 'top', opacity: 0.6 }} />
          <Tooltip
            contentStyle={{ background: '#FFFFFF', border: '1px solid #D6DBE0', borderRadius: 2, fontSize: 12, color: '#0A1628' }}
            formatter={(v: unknown) => [`${(v as number).toFixed(2)} GW`, 'EOL']}
            labelFormatter={(label: unknown) => `Year ${label}`}
          />
          <Bar dataKey="eol_gw" isAnimationActive={false}>
            {data.map((row, i) => <Cell key={i} fill={fillFor(row.eol_year)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
