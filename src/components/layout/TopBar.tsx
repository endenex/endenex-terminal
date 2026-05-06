// Page-level title strip used by some sub-pages.

export interface TopBarMeta {
  label: string
  value: string
}

interface TopBarProps {
  title:     string
  subtitle?: string
  meta?:     TopBarMeta[]
  actions?:  React.ReactNode
}

export function TopBar({ title, subtitle, meta, actions }: TopBarProps) {
  return (
    <header className="h-10 bg-canvas border-b border-border px-3 flex items-center justify-between flex-shrink-0 gap-4">
      <div className="min-w-0 flex items-baseline gap-2">
        <h1 className="text-[13px] font-semibold text-ink truncate uppercase tracking-wide">{title}</h1>
        {subtitle && <p className="text-[11.5px] text-ink-3 truncate">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        {meta && meta.length > 0 && (
          <div className="flex items-center text-[11px]">
            {meta.map((m, i) => (
              <span key={i} className="flex items-center">
                {i > 0 && <span className="cell-divider" />}
                <span className="text-ink-4 uppercase tracking-wide font-semibold">{m.label}</span>
                <span className="ml-1 text-ink tabular-nums">{m.value}</span>
              </span>
            ))}
          </div>
        )}

        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
