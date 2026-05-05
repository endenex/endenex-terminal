// ── Workspace controls strip ────────────────────────────────────────────────
// Thin strip below tab nav — layout presets (left) + utility actions (right).
// Spec: Product Brief v1.0 §5.3
// MVP: Layouts selector renders visually but is not functional.

const LAYOUT_PRESETS = ['Default', 'Compact', 'Lender focus']

export function WorkspaceControls() {
  return (
    <div className="flex-shrink-0 h-8 bg-canvas border-b border-border flex items-center justify-between px-4 select-none">

      {/* Layout presets */}
      <div className="flex items-center gap-1">
        {LAYOUT_PRESETS.map(preset => (
          <button
            key={preset}
            className={`px-2.5 py-0.5 text-[10px] font-medium rounded transition-colors
              ${preset === 'Default'
                ? 'bg-active text-teal border border-teal/30'
                : 'text-ink-3 hover:text-ink-2 hover:bg-active/50'
              }`}
          >
            {preset}
          </button>
        ))}
        <span className="w-px h-3 bg-border mx-1" />
        <button className="px-2.5 py-0.5 text-[10px] font-medium text-ink-4 hover:text-ink-3 transition-colors">
          + Save layout
        </button>
      </div>

      {/* Utility actions */}
      <div className="flex items-center gap-4">
        {['Reset positions', 'Pop out', 'Search'].map(action => (
          <button
            key={action}
            className="text-[10px] font-medium text-ink-4 hover:text-ink-2 transition-colors"
          >
            {action}
          </button>
        ))}
      </div>

    </div>
  )
}
