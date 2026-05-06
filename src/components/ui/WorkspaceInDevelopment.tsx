import type { LucideIcon } from 'lucide-react'
import { Clock } from 'lucide-react'

interface WorkspaceInDevelopmentProps {
  icon:        LucideIcon
  name:        string
  description: string
  features:    string[]
  phase:       string
}

export function WorkspaceInDevelopment({
  icon: Icon,
  name,
  description,
  features,
  phase,
}: WorkspaceInDevelopmentProps) {
  return (
    <div className="max-w-xl">
      <div className="border border-border rounded-sm bg-panel">
        <div className="p-3">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-teal-dim border border-teal/30 rounded-sm flex items-center justify-center flex-shrink-0">
              <Icon size={16} className="text-teal" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-ink leading-tight">{name}</h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Clock size={10} className="text-ink-4" />
                <span className="text-[11px] text-ink-3">Module in development</span>
                <span className="text-[10.5px] font-semibold text-teal border border-teal/30 rounded-sm px-1 py-px uppercase tracking-wide bg-teal-dim">
                  {phase}
                </span>
              </div>
            </div>
          </div>

          <p className="text-ink-3 text-[12.5px] leading-relaxed mb-3">{description}</p>

          <div>
            <div className="label-xs mb-2">This workspace will include</div>
            <ul className="space-y-1.5">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-[12.5px] text-ink-2">
                  <div className="w-1 h-1 rounded-full bg-teal flex-shrink-0 mt-1.5" />
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
