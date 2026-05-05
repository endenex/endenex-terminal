// ── Panel chrome shell ──────────────────────────────────────────────────────
// Wraps every panel with titlebar, drag handle, source label, controls.
// Spec: Product Brief v1.0 §3.4
// Controls render visually at MVP; drag/resize/pop-out wired in Phase 2.

import { type ReactNode } from 'react'
import { clsx } from 'clsx'
import { useWorkspace } from '@/context/WorkspaceContext'
import type { PanelId } from '@/config/panels'

interface PanelShellProps {
  sourceLabel:  string          // e.g. "DCI DASHBOARD" — rendered in small caps
  title:        string          // e.g. "Spot Indices"
  linkTo?:      PanelId         // clicking title navigates to this tab
  children:     ReactNode
  className?:   string
  bodyClassName?: string
}

export function PanelShell({
  sourceLabel,
  title,
  linkTo,
  children,
  className,
  bodyClassName,
}: PanelShellProps) {
  const { openPanel } = useWorkspace()

  return (
    <div className={clsx('panel-shell flex flex-col overflow-hidden', className)}>

      {/* Titlebar */}
      <div className="panel-titlebar gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Drag handle (visual only at MVP) */}
          <span className="text-ink-4 text-[13px] leading-none cursor-grab select-none flex-shrink-0">
            ⋮⋮
          </span>

          {/* Source label */}
          <span className="text-[9.5px] font-semibold tracking-widest uppercase text-ink-3 flex-shrink-0">
            {sourceLabel}
          </span>

          <span className="text-ink-4 text-[9px]">·</span>

          {/* Panel title */}
          {linkTo ? (
            <button
              onClick={() => openPanel(linkTo)}
              className="text-[12px] font-semibold text-ink hover:text-teal transition-colors truncate"
            >
              {title}
            </button>
          ) : (
            <span className="text-[12px] font-semibold text-ink truncate">{title}</span>
          )}
        </div>

        {/* Window controls (visual only at MVP) */}
        <div className="flex items-center gap-2 text-ink-4 flex-shrink-0">
          <span className="text-[13px] cursor-default select-none hover:text-ink-2 transition-colors" title="Minimise">⊟</span>
          <span className="text-[13px] cursor-default select-none hover:text-ink-2 transition-colors" title="Maximise">⊞</span>
          <span className="text-[12px] cursor-default select-none hover:text-ink-2 transition-colors" title="Close">×</span>
        </div>
      </div>

      {/* Body */}
      <div className={clsx('flex-1 min-h-0 overflow-auto', bodyClassName)}>
        {children}
      </div>

    </div>
  )
}
