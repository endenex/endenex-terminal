import type { LucideIcon } from 'lucide-react'
import { Clock } from 'lucide-react'
import { Card } from './Card'
import { Badge } from './Badge'

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
      <Card>
        <div className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-10 h-10 bg-terminal-teal/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <Icon size={20} className="text-terminal-teal" />
            </div>
            <div>
              <h2 className="text-gray-900 font-semibold">{name}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <Clock size={11} className="text-gray-400" />
                <span className="text-xs text-gray-500">Module in development</span>
                <Badge variant="phase1">{phase}</Badge>
              </div>
            </div>
          </div>

          <p className="text-gray-600 text-sm leading-relaxed mb-6">{description}</p>

          <div>
            <div className="text-xs text-gray-400 font-mono uppercase tracking-wider mb-3">
              This workspace will include
            </div>
            <ul className="space-y-2">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-gray-700">
                  <div className="w-1.5 h-1.5 rounded-full bg-terminal-teal flex-shrink-0 mt-1.5" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  )
}
