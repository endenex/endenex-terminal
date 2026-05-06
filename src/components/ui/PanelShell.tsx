// ── Panel chrome shell ──────────────────────────────────────────────────────
// Sharp 1px border, dense titlebar, no shadow. BNEF-grade light.

import { type ReactNode } from 'react'
import { clsx } from 'clsx'
import { useWorkspace } from '@/context/WorkspaceContext'
import type { PanelId } from '@/config/panels'

interface PanelShellProps {
  sourceLabel:    string
  title:          string
  linkTo?:        PanelId
  meta?:          ReactNode
  children:       ReactNode
  className?:     string
  bodyClassName?: string
}

export function PanelShell({
  sourceLabel,
  title,
  linkTo,
  meta,
  children,
  className,
  bodyClassName,
}: PanelShellProps) {
  const { openPanel } = useWorkspace()

  return (
    <div className={clsx('panel-shell', className)}>

      {/* Titlebar — h-7, dense */}
      <div className="panel-titlebar">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="label-xs flex-shrink-0">{sourceLabel}</span>
          <span className="text-ink-4 text-[10px]">·</span>
          {linkTo ? (
            <button
              onClick={() => openPanel(linkTo)}
              className="text-[12.5px] font-semibold text-ink hover:text-teal transition-colors truncate"
            >
              {title}
            </button>
          ) : (
            <span className="text-[12.5px] font-semibold text-ink truncate">{title}</span>
          )}
        </div>
        {meta && (
          <div className="flex items-center gap-2 text-[11px] text-ink-3 flex-shrink-0">
            {meta}
          </div>
        )}
      </div>

      <div className={clsx('panel-body', bodyClassName)}>
        {children}
      </div>

    </div>
  )
}
