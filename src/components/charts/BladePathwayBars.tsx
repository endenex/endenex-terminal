// ── Chart J — Blade gate fee pathway comparison ────────────────────────────
// Horizontal bars showing the 5 disposal pathways with cost per tonne.
// Sorted ascending so cheapest pathway appears at top.

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
  landfill:    '#C03939',  // worst environmentally + getting banned
  storage:     '#E89C2C',  // interim
  mechanical:  '#3D8A9A',  // viable
  cement:      '#2A8A4A',  // dominant commercial pathway
  pyrolysis:   '#6BAAB5',  // emerging, expensive
}

export function BladePathwayBars({ rows, region = 'EU' }: { rows: PathwayRow[]; region?: string }) {
  const data = rows
    .filter(r => r.region === region || r.region === 'GLOBAL')
    .filter((r, i, arr) => arr.findIndex(x => x.pathway === r.pathway) === i)  // unique pathways
    .sort((a, b) => a.eur_per_tonne - b.eur_per_tonne)
    .map(r => ({
      pathway_label: PATHWAY_LABEL[r.pathway] ?? r.pathway,
      pathway:       r.pathway,
      eur_per_tonne: Number(r.eur_per_tonne),
      basis:         r.basis,
    }))

  if (!data.length) {
    return <div className="h-56 flex items-center justify-center text-[12px] text-ink-3">No pathway data for {region}</div>
  }

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E8EC" horizontal={false} />
          <XAxis type="number" tick={{ fill: '#98A1AE', fontSize: 10 }} axisLine={false} tickLine={false}
                 tickFormatter={v => `€${v}`} />
          <YAxis type="category" dataKey="pathway_label" tick={{ fill: '#0A1628', fontSize: 11 }}
                 axisLine={false} tickLine={false} width={140} />
          <Tooltip
            contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E8EC', borderRadius: 6, fontSize: 11, color: '#0A1628' }}
            formatter={(v: unknown) => [`€${(v as number).toLocaleString('en-GB')}/t`, 'Gate fee']}
            labelFormatter={(label: unknown) => label as string}
          />
          <Bar dataKey="eur_per_tonne" isAnimationActive={false} radius={[0, 3, 3, 0]}>
            {data.map((row, i) => (
              <Cell key={i} fill={PATHWAY_COLOR[row.pathway] ?? '#007B8A'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
