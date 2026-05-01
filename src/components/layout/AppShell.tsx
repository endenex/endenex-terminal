import { useState, useCallback, useRef } from 'react'
import { DockviewReact, DockviewReadyEvent, DockviewApi, IDockviewPanelProps } from 'dockview'
import 'dockview/dist/styles/dockview.css'
import { NavBar } from './NavBar'
import { DashboardPage }  from '@/pages/DashboardPage'
import { DciPage }        from '@/pages/DciPage'
import { RetirementPage } from '@/pages/RetirementPage'
import { MaterialsPage }  from '@/pages/MaterialsPage'
import { BladesPage }     from '@/pages/BladesPage'
import { WatchPage }      from '@/pages/WatchPage'
import { PortfolioPage }  from '@/pages/PortfolioPage'

// ── Panel registry ─────────────────────────────────────────────────────────────

export type PanelId = 'home' | 'dci' | 'retirement' | 'materials' | 'blades' | 'watch' | 'portfolio'

export const PANELS: Record<PanelId, { title: string }> = {
  home:       { title: 'Home' },
  dci:        { title: 'DCI' },
  retirement: { title: 'Asset Retirement' },
  materials:  { title: 'Recovery Value' },
  blades:     { title: 'Blade Intelligence' },
  watch:      { title: 'Market Watch' },
  portfolio:  { title: 'Portfolio' },
}

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
  const [api, setApi] = useState<DockviewApi | null>(null)
  const apiRef        = useRef<DockviewApi | null>(null)

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api
    setApi(event.api)

    event.api.onDidLayoutChange(() => {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(event.api.toJSON()))
      } catch { /* ignore */ }
    })

    const saved = localStorage.getItem(LAYOUT_KEY)
    if (saved) {
      try { event.api.fromJSON(JSON.parse(saved)); return } catch { /* fall through */ }
    }
    defaultLayout(event.api)
  }, [])

  const openPanel = useCallback((id: PanelId) => {
    const a = apiRef.current
    if (!a) return
    const existing = a.getPanel(id)
    if (existing) { existing.api.setActive(); return }
    a.addPanel({ id, component: id, title: PANELS[id].title })
  }, [])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-terminal-black">
      <NavBar api={api} onOpen={openPanel} />
      <div className="flex-1 min-h-0">
        <DockviewReact
          className="endenex-dockview"
          components={COMPONENTS}
          onReady={onReady}
        />
      </div>
    </div>
  )
}
