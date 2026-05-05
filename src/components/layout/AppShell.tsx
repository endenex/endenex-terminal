// ── AppShell ────────────────────────────────────────────────────────────────
// Fixed panel layout — dockview removed per Product Brief v1.0 §10.1.
// Floating draggable panels are Phase 2 (§10.2).

import { useState, useCallback, useMemo } from 'react'
import { TopChrome }        from './TopChrome'
import { TabNav }           from './TabNav'
import { WorkspaceControls } from './WorkspaceControls'
import { BottomFooter }     from './BottomFooter'
import { WorkspaceContext } from '@/context/WorkspaceContext'
import { PANELS, type PanelId } from '@/config/panels'

// ── Page components ──────────────────────────────────────────────────────────

import { DashboardPage }  from '@/pages/DashboardPage'
import { DciPage }        from '@/pages/DciPage'
import { RetirementPage } from '@/pages/RetirementPage'
import { MaterialsPage }  from '@/pages/MaterialsPage'
import { BladesPage }     from '@/pages/BladesPage'
import { WatchPage }      from '@/pages/WatchPage'
import { PortfolioPage }  from '@/pages/PortfolioPage'

// Re-export PanelId for legacy imports
export type { PanelId }

const PAGE: Record<PanelId, React.FC> = {
  home:      DashboardPage,
  dci:       DciPage,
  ari:       RetirementPage,
  smi:       MaterialsPage,
  pcm:       BladesPage,
  portfolio: PortfolioPage,
  watch:     WatchPage,
}

// ── AppShell ─────────────────────────────────────────────────────────────────

export function AppShell() {
  const [activeTab, setActiveTab] = useState<PanelId>('home')

  const openPanel = useCallback((id: PanelId) => setActiveTab(id), [])

  const ctxValue = useMemo(
    () => ({ activeTab, openPanel }),
    [activeTab, openPanel],
  )

  const ActivePage = PAGE[activeTab]

  return (
    <WorkspaceContext.Provider value={ctxValue}>
      <div className="flex flex-col h-screen overflow-hidden bg-page">

        {/* Dark navy top chrome — wordmark + DCI ticker */}
        <TopChrome />

        {/* Light tab navigation — 7 tabs with role labels */}
        <TabNav active={activeTab} onSelect={setActiveTab} />

        {/* Workspace controls strip — layout presets + utility actions */}
        <WorkspaceControls />

        {/* Active tab content */}
        <main className="flex-1 min-h-0 overflow-auto bg-page">
          <ActivePage />
        </main>

        {/* Utility footer — Alerts · Methodology · Coverage · Account · Logout */}
        <BottomFooter />

      </div>
    </WorkspaceContext.Provider>
  )
}
