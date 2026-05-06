// ── Workspace controls strip ────────────────────────────────────────────────

const LAYOUT_PRESETS = ['Default', 'Compact', 'Lender focus']

export function WorkspaceControls() {
  return (
    <div className="flex-shrink-0 h-8 bg-canvas border-b border-border flex items-center justify-between px-3 select-none">

      <div className="flex items-center gap-1">
        {LAYOUT_PRESETS.map(preset => (
          <button
            key={preset}
            className={`px-2 py-px text-[10.5px] font-semibold uppercase tracking-wide rounded-sm transition-colors
              ${preset === 'Default'
                ? 'bg-active text-teal border border-teal/30'
                : 'text-ink-3 hover:text-ink hover:bg-raised border border-transparent'
              }`}
          >
            {preset}
          </button>
        ))}
        <span className="cell-divider" />
        <button className="px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide text-ink-4 hover:text-ink-2 transition-colors">
          + Save layout
        </button>
      </div>

      <div className="flex items-center gap-3">
        {['Reset positions', 'Pop out', 'Export'].map(action => (
          <button
            key={action}
            className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-3 hover:text-ink transition-colors"
          >
            {action}
          </button>
        ))}
      </div>

    </div>
  )
}
