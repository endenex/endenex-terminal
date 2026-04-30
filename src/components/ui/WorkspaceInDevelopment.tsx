import type { LucideIcon } from 'lucide-react'
import { Clock } from 'lucide-react'

interface WorkspaceInDevelopmentProps {
  icon: LucideIcon
  name: string
  description: string
  features: string[]
  phase: string
}

export function WorkspaceInDevelopment({
  icon: Icon,
  name,
  description,
  features,
  phase,
}: WorkspaceInDevelopmentProps) {
  return (
    <div className="max-w-2xl">
      <div className="border border-terminal-border rounded-lg bg-terminal-surface">
        <div className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-10 h-10 bg-terminal-teal/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <Icon size={20} className="text-terminal-teal" />
            </div>
            <div>
              <h2 className="text-terminal-text font-semibold">{name}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <Clock size={11} className="text-terminal-muted" />
                <span className="text-xs text-terminal-muted">Module in development</span>
                <span className="text-[10px] font-mono text-terminal-teal border border-terminal-teal/30 rounded px-1.5 py-0.5">
                  {phase}
                </span>
              </div>
            </div>
          </div>

          <p className="text-terminal-muted text-sm leading-relaxed mb-6">{description}</p>

          <div>
            <div className="text-[10px] text-terminal-muted font-mono uppercase tracking-wider mb-3">
              This workspace will include
            </div>
            <ul className="space-y-2">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-terminal-muted">
                  <div className="w-1.5 h-1.5 rounded-full bg-terminal-teal flex-shrink-0 mt-1.5" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
