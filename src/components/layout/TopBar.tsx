interface TopBarProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export function TopBar({ title, subtitle, actions }: TopBarProps) {
  return (
    <header className="h-14 bg-terminal-surface border-b border-terminal-border px-6 flex items-center justify-between flex-shrink-0">
      <div>
        <h1 className="text-sm font-semibold text-terminal-text">{title}</h1>
        {subtitle && <p className="text-xs text-terminal-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </header>
  )
}
