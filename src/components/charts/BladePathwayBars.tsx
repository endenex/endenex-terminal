// ── Chart J — Blade gate fee pathway comparison (light) ────────────────────

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts'

interface PathwayRow {
  pathway:        string
  region:         string
  eur_per_tonne:  number
  basis:          string | null
}

const PATHWAY_LABEL: Record<string, string> = {
  landfill:    'Landfill',
  storage:     'Storage',
  mechanical:  'Mechanical',
  cement:      'Cement co-processing',
  pyrolysis:   'Pyrolysis',
}

const PATHWAY_COLOR: Record<string, string> = {
  landfill:    '#C73838',
  storage:     '#D97706',
  mechanical:  '#0E7A86',
  cement:      '#0F8B58',
  pyrolysis:   '#7C3AED',
}

export function BladePathwayBars({ rows, region = 'EU' }: { rows: PathwayRow[]; region?: string }) {
  const data = rows
    .filter(r => r.region === region || r.region === 'GLOBAL')
    .filter((r, i, arr) => arr.findIndex(x => x.pathway === r.pathway) === i)
    .sort((a, b) => a.eur_per_tonne - b.eur_per_tonne)
    .map(r => ({
      pathway_label: PATHWAY_LABEL[r.pathway] ?? r.pathway,
      pathway:       r.pathway,
      eur_per_tonne: Number(r.eur_per_tonne),
      basis:         r.basis,
    }))

  if (!data.length) {
    return <div className="h-48 flex items-center justify-center text-[11.5px] text-ink-4">No pathway data for {region}</div>
  }

  return (
    <div className="h-60">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#E5E8EC" horizontal={false} />
          <XAxis type="number" tick={{ fill: '#98A1AE', fontSize: 11 }} axisLine={false} tickLine={false}
                 tickFormatter={v => `€${v}`} />
          <YAxis type="category" dataKey="pathway_label" tick={{ fill: '#3D4759', fontSize: 12 }}
                 axisLine={false} tickLine={false} width={140} />
          <Tooltip
            contentStyle={{ background: '#FFFFFF', border: '1px solid #D6DBE0', borderRadius: 2, fontSize: 12, color: '#0A1628' }}
            formatter={(v: unknown) => [`€${(v as number).toLocaleString('en-GB')}/t`, 'Gate fee']}
            labelFormatter={(label: unknown) => label as string}
          />
          <Bar dataKey="eur_per_tonne" isAnimationActive={false} radius={[0, 2, 2, 0]}>
            {data.map((row, i) => (
              <Cell key={i} fill={PATHWAY_COLOR[row.pathway] ?? '#0E7A86'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
