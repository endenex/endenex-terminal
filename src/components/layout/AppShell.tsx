import { useState, useCallback, useRef } from 'react'
import { DockviewReact, DockviewReadyEvent, DockviewApi, IDockviewPanelProps } from 'dockview'
import 'dockview/dist/styles/dockview.css'
import { Sidebar, PanelId } from './Sidebar'
import { DashboardPage }  from '@/pages/DashboardPage'
import { DciPage }        from '@/pages/DciPage'
import { RetirementPage } from '@/pages/RetirementPage'
import { MaterialsPage }  from '@/pages/MaterialsPage'
import { BladesPage }     from '@/pages/BladesPage'
import { WatchPage }      from '@/pages/WatchPage'
import { PortfolioPage }  from '@/pages/PortfolioPage'

// ── Panel registry ─────────────────────────────────────────────────────────────

export const PANELS: Record<PanelId, { title: string }> = {
  home:       { title: 'Home' },
  dci:        { title: 'DCI' },
  retirement: { title: 'Asset Retirement' },
  materials:  { title: 'Recovery Value' },
  blades:     { title: 'Blade Intelligence' },
  watch:      { title: 'Market Watch' },
  portfolio:  { title: 'Portfolio' },
}

// Dockview requires components typed as FC<IDockviewPanelProps>
const COMPONENTS: Record<string, React.FC<IDockviewPanelProps>> = {
  home:       () => <DashboardPage />,
  dci:        () => <DciPage />,
  retirement: () => <RetirementPage />,
  materials:  () => <MaterialsPage />,
  blades:     () => <BladesPage />,
  watch:      () => <WatchPage />,
  portfolio:  () => <PortfolioPage />,
}

const LAYOUT_KEY = 'endenex-terminal-layout'

function defaultLayout(api: DockviewApi) {
  api.addPanel({ id: 'watch', component: 'watch', title: 'Market Watch' })
}

// ── AppShell ───────────────────────────────────────────────────────────────────

export function AppShell() {
  const apiRef = useRef<DockviewApi | null>(null)

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api

    // Save layout on any change
    event.api.onDidLayoutChange(() => {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(event.api.toJSON()))
      } catch { /* ignore */ }
    })

    // Restore saved layout or use default
    const saved = localStorage.getItem(LAYOUT_KEY)
    if (saved) {
      try {
        event.api.fromJSON(JSON.parse(saved))
        return
      } catch { /* fall through to default */ }
    }
    defaultLayout(event.api)
  }, [])

  const openPanel = useCallback((id: PanelId) => {
    const api = apiRef.current
    if (!api) return
    const existing = api.getPanel(id)
    if (existing) {
      existing.api.setActive()
      return
    }
    api.addPanel({ id, component: id, title: PANELS[id].title })
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-terminal-black">
      <Sidebar onOpen={openPanel} />
      <div className="flex-1 min-w-0 h-full">
        <DockviewReact
          className="endenex-dockview"
          components={COMPONENTS}
          onReady={onReady}
        />
      </div>
    </div>
  )
}
