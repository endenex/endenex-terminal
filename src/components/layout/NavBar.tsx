import { useState, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import { useClerk, useUser } from '@clerk/clerk-react'
import type { DockviewApi } from 'dockview'
import { PANELS, type PanelId } from './AppShell'

interface NavBarProps {
  api: DockviewApi | null
  onOpen: (id: PanelId) => void
}

export function NavBar({ api, onOpen }: NavBarProps) {
  const { signOut }  = useClerk()
  const { user }     = useUser()
  const [openPanels,  setOpenPanels]  = useState<string[]>([])
  const [activePanel, setActivePanel] = useState<string | null>(null)
  const [launcher,    setLauncher]    = useState(false)
  const launcherRef = useRef<HTMLDivElement>(null)

  // Sync tab state from dockview API
  useEffect(() => {
    if (!api) return

    const update = () => {
      setOpenPanels(api.panels.map(p => p.id))
      setActivePanel(api.activePanel?.id ?? null)
    }

    update()

    const subs = [
      api.onDidAddPanel(update),
      api.onDidRemovePanel(update),
      api.onDidActivePanelChange(update),
    ]
    return () => subs.forEach(s => s.dispose())
  }, [api])

  // Close launcher on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (launcherRef.current && !launcherRef.current.contains(e.target as Node)) {
        setLauncher(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const focusPanel = (id: string) => {
    api?.getPanel(id)?.api.setActive()
  }

  const closePanel = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    api?.getPanel(id)?.api.close()
  }

  const available = (Object.keys(PANELS) as PanelId[]).filter(id => !openPanels.includes(id))
  const email     = user?.primaryEmailAddress?.emailAddress ?? ''

  return (
    <header className="h-9 flex items-stretch flex-shrink-0 bg-terminal-navy border-b border-terminal-navy-border select-none">

      {/* Wordmark */}
      <div className="flex items-center px-4 border-r border-terminal-navy-border flex-shrink-0">
        <img src="/logo-white.png" alt="Endenex" className="h-3.5 w-auto" />
      </div>

      {/* Module tabs */}
      <div className="flex items-stretch flex-1 overflow-x-auto min-w-0">
        {openPanels.map(id => {
          const isActive = id === activePanel
          const title    = PANELS[id as PanelId]?.title ?? id
          return (
            <button
              key={id}
              onClick={() => focusPanel(id)}
              className={clsx(
                'group relative flex items-center gap-2.5 px-5 text-[11px] font-medium border-r border-terminal-navy-border whitespace-nowrap transition-colors',
                isActive
                  ? 'bg-terminal-black text-terminal-text'
                  : 'text-gray-500 hover:text-gray-200 hover:bg-terminal-navy-light'
              )}
            >
              {/* Active indicator */}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-terminal-teal" />
              )}
              {title}
              <span
                onClick={(e) => closePanel(e, id)}
                className="text-gray-600 hover:text-gray-200 leading-none opacity-0 group-hover:opacity-100 transition-opacity text-sm"
              >
                ×
              </span>
            </button>
          )
        })}

        {/* Add module */}
        <div className="relative flex items-center" ref={launcherRef}>
          <button
            onClick={() => setLauncher(o => !o)}
            className="flex items-center gap-1 px-4 h-full text-[11px] text-gray-600 hover:text-gray-300 transition-colors"
          >
            <span className="text-base leading-none">+</span>
            <span>Module</span>
          </button>

          {launcher && (
            <div className="absolute top-full left-0 z-50 mt-px bg-terminal-surface border border-terminal-border rounded shadow-xl min-w-[180px] py-1">
              {available.length === 0 ? (
                <div className="px-4 py-2.5 text-xs text-terminal-muted">All modules open</div>
              ) : (
                available.map(id => (
                  <button
                    key={id}
                    onClick={() => { onOpen(id); setLauncher(false) }}
                    className="w-full text-left px-4 py-2.5 text-xs text-terminal-text hover:bg-terminal-black transition-colors"
                  >
                    {PANELS[id].title}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* User */}
      <div className="flex items-center gap-4 px-4 border-l border-terminal-navy-border flex-shrink-0">
        <span className="text-[10px] text-gray-600 hidden md:block">{email}</span>
        <button
          onClick={() => signOut()}
          className="text-[10px] text-gray-600 hover:text-gray-300 transition-colors tracking-wider uppercase"
        >
          Sign out
        </button>
      </div>

    </header>
  )
}
