import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { useUser } from '@clerk/clerk-react'
import { DockviewReact, DockviewReadyEvent, DockviewApi, IDockviewPanelProps } from 'dockview'
import 'dockview/dist/styles/dockview.css'
import { NavBar } from './NavBar'
import { StatusBar } from './StatusBar'
import { WorkspaceContext } from '@/context/WorkspaceContext'
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

const LAYOUT_PREFIX = 'endenex-layout'

function layoutKey(userId: string) {
  return `${LAYOUT_PREFIX}-${userId}`
}

function defaultLayout(api: DockviewApi) {
  const ids = Object.keys(PANELS) as PanelId[]
  api.addPanel({ id: ids[0], component: ids[0], title: PANELS[ids[0]].title })
  for (let i = 1; i < ids.length; i++) {
    api.addPanel({
      id:        ids[i],
      component: ids[i],
      title:     PANELS[ids[i]].title,
      position:  { referencePanel: ids[0], direction: 'within' },
    })
  }
  api.getPanel('watch')?.api.setActive()
}

// ── AppShell ───────────────────────────────────────────────────────────────────

export function AppShell() {
  const { user } = useUser()

  // Keep userId in a ref so stable callbacks can read the latest value
  const userIdRef = useRef<string>('default')
  useEffect(() => {
    if (user?.id) userIdRef.current = user.id
  }, [user?.id])

  const [api, setApi] = useState<DockviewApi | null>(null)
  const apiRef        = useRef<DockviewApi | null>(null)

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api
    setApi(event.api)

    // ── Restore saved layout (per user) or fall back to default ──────────────
    const key   = layoutKey(userIdRef.current)
    const saved = localStorage.getItem(key)
    let restored = false

    if (saved) {
      try {
        event.api.fromJSON(JSON.parse(saved))
        restored = true
      } catch {
        // Saved layout is stale/corrupt — clear it and use default
        localStorage.removeItem(key)
      }
    }

    if (!restored) defaultLayout(event.api)

    // ── Debounced save on every layout change ─────────────────────────────────
    let saveTimer: ReturnType<typeof setTimeout>
    event.api.onDidLayoutChange(() => {
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        try {
          const k = layoutKey(userIdRef.current)
          localStorage.setItem(k, JSON.stringify(event.api.toJSON()))
        } catch { /* storage full or unavailable */ }
      }, 800)
    })
  }, [])  // stable — reads userIdRef via ref

  const openPanel = useCallback((id: PanelId) => {
    const a = apiRef.current
    if (!a) return
    const existing = a.getPanel(id)
    if (existing) { existing.api.setActive(); return }
    a.addPanel({ id, component: id, title: PANELS[id].title })
  }, [])

  // Reset layout: clear saved state and re-apply default
  const resetLayout = useCallback(() => {
    const a = apiRef.current
    if (!a) return
    localStorage.removeItem(layoutKey(userIdRef.current))

    // Close all panels then re-apply default
    a.panels.forEach(p => p.api.close())
    defaultLayout(a)
  }, [])

  const ctxValue = useMemo(() => ({ openPanel }), [openPanel])

  return (
    <WorkspaceContext.Provider value={ctxValue}>
      <div className="flex flex-col h-screen overflow-hidden bg-terminal-black">
        <NavBar api={api} onOpen={openPanel} onReset={resetLayout} />
        <div className="flex-1 min-h-0">
          <DockviewReact
            className="endenex-dockview"
            components={COMPONENTS}
            onReady={onReady}
          />
        </div>
        <StatusBar />
      </div>
    </WorkspaceContext.Provider>
  )
}
