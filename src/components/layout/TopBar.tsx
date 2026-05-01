export interface TopBarMeta {
  label: string
  value: string
}

interface TopBarProps {
  title:    string
  subtitle?: string
  meta?:    TopBarMeta[]        // right-aligned label · value pairs (source, last updated, etc.)
  actions?: React.ReactNode
}

export function TopBar({ title, subtitle, meta, actions }: TopBarProps) {
  return (
    <header className="h-14 bg-terminal-surface border-b border-terminal-border px-6 flex items-center justify-between flex-shrink-0 gap-6">
      <div className="min-w-0">
        <h1 className="text-sm font-semibold text-terminal-text truncate">{title}</h1>
        {subtitle && <p className="text-xs text-terminal-muted mt-0.5 truncate">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-5 flex-shrink-0">
        {/* Freshness / source metadata */}
        {meta && meta.length > 0 && (
          <div className="flex items-center text-[11px] font-mono">
            {meta.map((m, i) => (
              <span key={i} className="flex items-center">
                {i > 0 && <span className="mx-3 text-terminal-border select-none">·</span>}
                <span className="text-terminal-muted">{m.label}</span>
                <span className="ml-1.5 text-terminal-text">{m.value}</span>
              </span>
            ))}
          </div>
        )}

        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    </header>
  )
}
