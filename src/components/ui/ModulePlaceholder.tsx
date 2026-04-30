import type { LucideIcon } from 'lucide-react'
import { clsx } from 'clsx'

interface Signal {
  label: string
  status: 'building' | 'planned'
}

interface ModulePlaceholderProps {
  icon: LucideIcon
  label: string
  name: string
  description: string
  signals: Signal[]
}

export function ModulePlaceholder({ icon: Icon, label, name, description, signals }: ModulePlaceholderProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 py-16">
      <div className="max-w-lg w-full">
        {/* Icon + label */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 bg-terminal-surface border border-terminal-border rounded flex items-center justify-center">
            <Icon size={16} className="text-terminal-teal" />
          </div>
          <div>
            <div className="text-[10px] font-mono text-terminal-muted tracking-widest">{label}</div>
            <div className="text-sm font-semibold text-terminal-text">{name}</div>
          </div>
        </div>

        <p className="text-sm text-terminal-muted leading-relaxed mb-8">{description}</p>

        {/* Signals list */}
        <div className="border border-terminal-border rounded">
          <div className="px-4 py-2.5 border-b border-terminal-border">
            <span className="text-[10px] font-mono text-terminal-muted tracking-widest uppercase">
              Module includes
            </span>
          </div>
          <div className="divide-y divide-terminal-border">
            {signals.map(({ label: sLabel, status }) => (
              <div key={sLabel} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-xs text-terminal-muted">{sLabel}</span>
                <span className={clsx(
                  'text-[10px] font-mono',
                  status === 'building' ? 'text-terminal-teal' : 'text-terminal-muted'
                )}>
                  {status === 'building' ? 'IN BUILD' : 'PLANNED'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
