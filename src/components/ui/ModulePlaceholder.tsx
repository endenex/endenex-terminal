interface Signal {
  label: string
  status: 'building' | 'planned'
}

interface ModulePlaceholderProps {
  label: string
  name: string
  description: string
  signals: Signal[]
}

export function ModulePlaceholder({ label, name, description, signals }: ModulePlaceholderProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 py-16">
      <div className="max-w-lg w-full">

        <div className="mb-6">
          <div className="text-[10px] text-terminal-muted tracking-widest uppercase mb-1">{label}</div>
          <div className="text-base font-semibold text-terminal-text">{name}</div>
        </div>

        <p className="text-sm text-terminal-muted leading-relaxed mb-8">{description}</p>

        <div className="border border-terminal-border rounded">
          <div className="px-4 py-2.5 border-b border-terminal-border">
            <span className="text-[10px] text-terminal-muted tracking-widest uppercase">
              Module includes
            </span>
          </div>
          <div className="divide-y divide-terminal-border">
            {signals.map(({ label: sLabel, status }) => (
              <div key={sLabel} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-xs text-terminal-muted">{sLabel}</span>
                <span className={status === 'building' ? 'text-[10px] text-terminal-teal' : 'text-[10px] text-terminal-muted'}>
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
