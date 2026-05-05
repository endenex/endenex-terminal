// ── Tab navigation strip ────────────────────────────────────────────────────
// Light strip below top chrome — seven tabs with role labels.
// Spec: Product Brief v1.0 §4.1, §4.2

import { clsx } from 'clsx'
import { PANELS, PANEL_ORDER, type PanelId } from '@/config/panels'

interface TabNavProps {
  active:   PanelId
  onSelect: (id: PanelId) => void
}

const ROLE_COLOUR: Record<string, string> = {
  default: 'text-ink-3',
  product: 'text-highlight',
  moat:    'text-teal',
}

export function TabNav({ active, onSelect }: TabNavProps) {
  return (
    <div className="flex-shrink-0 bg-panel border-b border-border flex items-stretch select-none">
      {PANEL_ORDER.map((id, idx) => {
        const meta   = PANELS[id]
        const isActive = id === active
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={clsx(
              'relative flex flex-col items-start justify-center px-5 py-2 border-r border-border text-left transition-colors',
              'hover:bg-active/50',
              isActive ? 'bg-page' : 'bg-panel',
            )}
          >
            {/* Active indicator */}
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-teal" />
            )}

            {/* Index number */}
            <span className="text-[9px] font-semibold text-ink-4 tabular-nums mb-0.5">
              {String(idx + 1).padStart(2, '0')}
            </span>

            {/* Tab title */}
            <span className={clsx(
              'text-[11.5px] font-semibold leading-tight whitespace-nowrap',
              isActive ? 'text-ink' : 'text-ink-2',
            )}>
              {meta.title}
            </span>

            {/* Role label */}
            <span className={clsx(
              'text-[9px] font-semibold tracking-wide mt-0.5 whitespace-nowrap',
              ROLE_COLOUR[meta.roleColor],
            )}>
              {meta.role}
            </span>
          </button>
        )
      })}
    </div>
  )
}
