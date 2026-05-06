interface Signal {
  label:  string
  status: 'building' | 'planned'
}

interface ModulePlaceholderProps {
  label:       string
  name:        string
  description: string
  signals:     Signal[]
}

export function ModulePlaceholder({ label, name, description, signals }: ModulePlaceholderProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
      <div className="max-w-md w-full">

        <div className="mb-3">
          <div className="label-xs mb-1">{label}</div>
          <div className="text-[16px] font-semibold text-ink">{name}</div>
        </div>

        <p className="text-[12.5px] text-ink-3 leading-relaxed mb-4">{description}</p>

        <div className="border border-border rounded-sm bg-panel">
          <div className="px-2.5 h-7 flex items-center border-b border-border bg-titlebar">
            <span className="label-xs">Module includes</span>
          </div>
          <div className="divide-y divide-border">
            {signals.map(({ label: sLabel, status }) => (
              <div key={sLabel} className="flex items-center justify-between px-2.5 py-1.5">
                <span className="text-[12.5px] text-ink-2">{sLabel}</span>
                <span className={status === 'building' ? 'text-[10.5px] uppercase tracking-wide text-teal font-semibold' : 'text-[10.5px] uppercase tracking-wide text-ink-4 font-semibold'}>
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
