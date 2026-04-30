import { clsx } from 'clsx'

type BadgeVariant =
  | 'high' | 'medium' | 'low'
  | 'confirmed' | 'active' | 'candidate' | 'watchlist'
  | 'phase1' | 'phase2' | 'phase3' | 'phase4'
  | 'observed' | 'inferred' | 'modelled'
  | 'neutral' | 'coming-soon'

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  high:        'bg-emerald-900/30 text-emerald-400 border-emerald-700/50',
  medium:      'bg-amber-900/30 text-amber-400 border-amber-700/50',
  low:         'bg-red-900/30 text-red-400 border-red-700/50',
  confirmed:   'bg-teal-900/30 text-teal-400 border-teal-700/50',
  active:      'bg-blue-900/30 text-blue-400 border-blue-700/50',
  candidate:   'bg-violet-900/30 text-violet-400 border-violet-700/50',
  watchlist:   'bg-terminal-border text-terminal-muted border-terminal-border',
  phase1:      'bg-emerald-900/30 text-emerald-400 border-emerald-700/50',
  phase2:      'bg-terminal-border text-terminal-muted border-terminal-border',
  phase3:      'bg-terminal-border text-terminal-muted border-terminal-border',
  phase4:      'bg-terminal-border text-terminal-muted border-terminal-border',
  observed:    'bg-blue-900/30 text-blue-400 border-blue-700/50',
  inferred:    'bg-amber-900/30 text-amber-400 border-amber-700/50',
  modelled:    'bg-violet-900/30 text-violet-400 border-violet-700/50',
  neutral:     'bg-terminal-border text-terminal-muted border-terminal-border',
  'coming-soon': 'bg-terminal-border text-terminal-muted border-terminal-border',
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
