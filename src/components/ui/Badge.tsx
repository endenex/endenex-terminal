import { clsx } from 'clsx'

type BadgeVariant =
  | 'high' | 'medium' | 'low'
  | 'confirmed' | 'active' | 'candidate' | 'watchlist'
  | 'phase1' | 'phase2' | 'phase3' | 'phase4'
  | 'observed' | 'inferred' | 'modelled'
  | 'neutral'

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  high: 'bg-green-100 text-green-800 border-green-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low: 'bg-red-100 text-red-800 border-red-200',
  confirmed: 'bg-teal-100 text-teal-800 border-teal-200',
  active: 'bg-blue-100 text-blue-800 border-blue-200',
  candidate: 'bg-purple-100 text-purple-800 border-purple-200',
  watchlist: 'bg-gray-100 text-gray-700 border-gray-200',
  phase1: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  phase2: 'bg-gray-100 text-gray-500 border-gray-200',
  phase3: 'bg-gray-100 text-gray-400 border-gray-200',
  phase4: 'bg-gray-100 text-gray-400 border-gray-200',
  observed: 'bg-blue-50 text-blue-700 border-blue-100',
  inferred: 'bg-yellow-50 text-yellow-700 border-yellow-100',
  modelled: 'bg-purple-50 text-purple-700 border-purple-100',
  neutral: 'bg-gray-100 text-gray-600 border-gray-200',
}

interface BadgeProps {
  variant: BadgeVariant
  children: React.ReactNode
  className?: string
}

export function Badge({ variant, children, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border font-mono',
        VARIANT_STYLES[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
