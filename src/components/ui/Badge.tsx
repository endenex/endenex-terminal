import { clsx } from 'clsx'

type BadgeVariant =
  | 'high' | 'medium' | 'low'
  | 'confirmed' | 'active' | 'candidate' | 'watchlist'
  | 'phase1' | 'phase2' | 'phase3' | 'phase4'
  | 'observed' | 'inferred' | 'modelled'
  | 'neutral' | 'coming-soon'

// BNEF-style: pale fill, mid-saturation text and border. Readable on white.
const VARIANT_STYLES: Record<BadgeVariant, string> = {
  high:        'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium:      'bg-amber-50 text-amber-700 border-amber-200',
  low:         'bg-red-50 text-red-700 border-red-200',
  confirmed:   'bg-teal-50 text-teal-700 border-teal-200',
  active:      'bg-sky-50 text-sky-700 border-sky-200',
  candidate:   'bg-violet-50 text-violet-700 border-violet-200',
  watchlist:   'bg-canvas text-ink-3 border-border',
  phase1:      'bg-emerald-50 text-emerald-700 border-emerald-200',
  phase2:      'bg-canvas text-ink-3 border-border',
  phase3:      'bg-canvas text-ink-3 border-border',
  phase4:      'bg-canvas text-ink-3 border-border',
  observed:    'bg-sky-50 text-sky-700 border-sky-200',
  inferred:    'bg-amber-50 text-amber-700 border-amber-200',
  modelled:    'bg-violet-50 text-violet-700 border-violet-200',
  neutral:     'bg-canvas text-ink-3 border-border',
  'coming-soon':'bg-canvas text-ink-4 border-border',
}

interface BadgeProps {
  variant:    BadgeVariant
  children:   React.ReactNode
  className?: string
}

export function Badge({ variant, children, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-1.5 py-px rounded-sm text-[10.5px] font-semibold uppercase tracking-wide border',
        VARIANT_STYLES[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
