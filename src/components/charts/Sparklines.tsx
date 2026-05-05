// ── Pure-SVG sparkline components ──────────────────────────────────────────
// Tiny no-dependency replacement for the react-sparklines library.

import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'

interface Ctx {
  points: { x: number; y: number; v: number }[]
  width:  number
  height: number
  min:    number
  max:    number
}

const SparkCtx = createContext<Ctx | null>(null)

export function Sparklines({
  data, width = 80, height = 24, margin = 2, children,
}: {
  data:    number[]
  width?:  number
  height?: number
  margin?: number
  children: ReactNode
}) {
  if (!data.length) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const innerW = width  - margin * 2
  const innerH = height - margin * 2
  const points = data.map((v, i) => ({
    v,
    x: margin + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW),
    y: margin + innerH - ((v - min) / range) * innerH,
  }))
  return (
    <SparkCtx.Provider value={{ points, width, height, min, max }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>{children}</svg>
    </SparkCtx.Provider>
  )
}

export function SparklinesLine({ color = '#007B8A', strokeWidth = 1 }: { color?: string; strokeWidth?: number }) {
  const ctx = useContext(SparkCtx)
  if (!ctx) return null
  const d = ctx.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  return <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} />
}

export function SparklinesSpots({ color = '#007B8A', size = 1.5 }: { color?: string; size?: number }) {
  const ctx = useContext(SparkCtx)
  if (!ctx) return null
  const last = ctx.points[ctx.points.length - 1]
  return <circle cx={last.x} cy={last.y} r={size} fill={color} />
}
