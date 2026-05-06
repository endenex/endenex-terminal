// ── Tab navigation strip ────────────────────────────────────────────────────
// Light strip below top chrome — function-key style with role tags.

import { clsx } from 'clsx'
import { PANELS, PANEL_ORDER, type PanelId } from '@/config/panels'

interface TabNavProps {
  active:   PanelId
  onSelect: (id: PanelId) => void
}

const ROLE_COLOUR: Record<string, string> = {
  default: 'text-ink-4',
  product: 'text-amber',
  moat:    'text-teal',
}

export function TabNav({ active, onSelect }: TabNavProps) {
  return (
    <div className="flex-shrink-0 h-10 bg-canvas border-b border-border flex items-stretch select-none">
      {PANEL_ORDER.map((id, idx) => {
        const meta     = PANELS[id]
        const isActive = id === active
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={clsx(
              'relative flex items-center gap-2 px-3 h-full border-r border-border text-left transition-colors',
              isActive
                ? 'bg-panel'
                : 'bg-canvas hover:bg-raised',
            )}
          >
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-teal" />
            )}

            <span className={clsx(
              'text-[10px] font-semibold tabular-nums tracking-widest',
              isActive ? 'text-teal' : 'text-ink-4',
            )}>
              F{idx + 1}
            </span>

            <div className="flex flex-col items-start">
              <span className={clsx(
                'text-[12.5px] font-semibold leading-none whitespace-nowrap',
                isActive ? 'text-ink' : 'text-ink-2',
              )}>
                {meta.title}
              </span>
              <span className={clsx(
                'text-[9.5px] font-semibold tracking-[0.08em] mt-0.5 whitespace-nowrap uppercase',
                ROLE_COLOUR[meta.roleColor],
              )}>
                {meta.role}
              </span>
            </div>
          </button>
        )
      })}

      <div className="flex-1 flex items-center justify-end pr-3 gap-3">
        <span className="text-[10.5px] text-ink-3 tracking-wider uppercase font-medium">⌘K · Search</span>
      </div>
    </div>
  )
}
