// ── Chart A — DCI cost waterfall (light) ───────────────────────────────────

import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

interface Pub {
  gross_cost:         number | null
  recovery_ferrous:   number | null
  recovery_copper:    number | null
  recovery_aluminium: number | null
  blade_transport:    number | null
  blade_gate_fees:    number | null
  scrap_haulage:      number | null
  net_liability:      number | null
  currency:           string
}

const CCY: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' }

export function DciCostWaterfall({ pub }: { pub: Pub | null }) {
  const data = useMemo(() => {
    if (!pub) return []
    const gross = Number(pub.gross_cost) || 0
    const fe    = Number(pub.recovery_ferrous) || 0
    const cu    = Number(pub.recovery_copper) || 0
    const al    = Number(pub.recovery_aluminium) || 0
    const bt    = Number(pub.blade_transport) || 0
    const bg    = Number(pub.blade_gate_fees) || 0
    const sh    = Number(pub.scrap_haulage) || 0
    const net   = Number(pub.net_liability) || 0

    const rows: { label: string; base: number; value: number; total: number; tone: 'pos' | 'neg' | 'sum' }[] = []
    let running = 0

    rows.push({ label: 'Gross', base: 0, value: gross, total: gross, tone: 'pos' }); running = gross
    if (fe > 0) { rows.push({ label: 'Fe',  base: running - fe, value: fe, total: running - fe, tone: 'neg' }); running -= fe }
    if (cu > 0) { rows.push({ label: 'Cu',  base: running - cu, value: cu, total: running - cu, tone: 'neg' }); running -= cu }
    if (al > 0) { rows.push({ label: 'Al',  base: running - al, value: al, total: running - al, tone: 'neg' }); running -= al }
    const disposal = bt + bg + sh
    if (disposal > 0) { rows.push({ label: 'Disp', base: running, value: disposal, total: running + disposal, tone: 'pos' }); running += disposal }
    rows.push({ label: 'Net', base: 0, value: net, total: net, tone: 'sum' })
    return rows
  }, [pub])

  if (!pub || !data.length) {
    return <div className="h-48 flex items-center justify-center text-[11.5px] text-ink-4">—</div>
  }

  const sym = CCY[pub.currency] ?? ''
  const fmtAxis = (v: number) => `${sym}${(v / 1000).toFixed(0)}k`

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#E5E8EC" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: '#6B7585', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={fmtAxis} tick={{ fill: '#98A1AE', fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
          <ReferenceLine y={0} stroke="#D6DBE0" />
          <Tooltip
            cursor={{ fill: 'rgba(14,122,134,0.06)' }}
            contentStyle={{ background: '#FFFFFF', border: '1px solid #D6DBE0', borderRadius: 2, fontSize: 12, color: '#0A1628' }}
            formatter={(_v: unknown, _name: unknown, item: { payload?: { value?: number; tone?: string } }) => {
              const p = item.payload
              if (!p) return ['—', '']
              return [`${sym}${Math.round(p.value ?? 0).toLocaleString('en-GB')}/MW`,
                      p.tone === 'neg' ? 'Recovery' : p.tone === 'pos' ? 'Cost' : 'Net']
            }}
          />
          <Bar dataKey="base"  stackId="wf" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="value" stackId="wf" isAnimationActive={false}>
            {data.map((row, i) => (
              <Cell key={i} fill={
                row.tone === 'sum' ? '#0E7A86' :
                row.tone === 'neg' ? '#0F8B58' :
                                     '#C73838'
              } />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
