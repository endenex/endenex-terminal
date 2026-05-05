// ── Chart A — DCI cost waterfall ─────────────────────────────────────────────
// Shows how Net Liability is built from Gross Cost − (Material Recovery split
// by Fe / Cu / Al) + Disposal Costs. Single-glance visual answer to
// "where does the headline figure come from?"

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

    // Waterfall using "invisible base" trick
    const rows: { label: string; base: number; value: number; total: number; tone: 'pos' | 'neg' | 'sum' }[] = []
    let running = 0

    rows.push({ label: 'Gross Cost', base: 0, value: gross, total: gross, tone: 'pos' })
    running = gross

    if (fe > 0) {
      rows.push({ label: 'Recovery (Fe)', base: running - fe, value: fe, total: running - fe, tone: 'neg' })
      running -= fe
    }
    if (cu > 0) {
      rows.push({ label: 'Recovery (Cu)', base: running - cu, value: cu, total: running - cu, tone: 'neg' })
      running -= cu
    }
    if (al > 0) {
      rows.push({ label: 'Recovery (Al)', base: running - al, value: al, total: running - al, tone: 'neg' })
      running -= al
    }
    const disposal = bt + bg + sh
    if (disposal > 0) {
      rows.push({ label: 'Disposal', base: running, value: disposal, total: running + disposal, tone: 'pos' })
      running += disposal
    }
    rows.push({ label: 'Net Liability', base: 0, value: net, total: net, tone: 'sum' })
    return rows
  }, [pub])

  if (!pub || !data.length) {
    return (
      <div className="h-56 flex items-center justify-center text-[12px] text-ink-3">
        No publication available for waterfall view
      </div>
    )
  }

  const sym = CCY[pub.currency] ?? ''
  const fmtAxis = (v: number) => `${sym}${(v / 1000).toFixed(0)}k`

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E8EC" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: '#4A5560', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={fmtAxis} tick={{ fill: '#98A1AE', fontSize: 10 }} axisLine={false} tickLine={false} width={56} />
          <ReferenceLine y={0} stroke="#D0D5DB" />
          <Tooltip
            cursor={{ fill: 'rgba(0,123,138,0.06)' }}
            contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E8EC', borderRadius: 6, fontSize: 11, color: '#0A1628', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
            formatter={(_v: unknown, _name: unknown, item: { payload?: { value?: number; total?: number; tone?: string } }) => {
              const p = item.payload
              if (!p) return ['—', '']
              return [
                `${sym}${Math.round(p.value ?? 0).toLocaleString('en-GB')}/MW${p.tone === 'sum' ? ' (net)' : ''}`,
                p.tone === 'neg' ? 'Recovery' : p.tone === 'pos' ? 'Cost' : 'Net',
              ]
            }}
          />
          {/* Invisible base bar to lift the visible bar */}
          <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="value" stackId="wf" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {data.map((row, i) => (
              <Cell key={i} fill={
                row.tone === 'sum' ? '#0A1628' :
                row.tone === 'neg' ? '#2A8A4A' :   // green = recovery (good)
                                     '#C03939'      // red = cost (bad)
              } />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
