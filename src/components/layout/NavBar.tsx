import { useState, useEffect } from 'react'
import { clsx } from 'clsx'
import { useClerk, useUser } from '@clerk/clerk-react'
import type { DockviewApi } from 'dockview'
import { PANELS, type PanelId } from '@/config/panels'

const ALL_PANELS = Object.keys(PANELS) as PanelId[]

interface NavBarProps {
  api:     DockviewApi | null
  onOpen:  (id: PanelId) => void
  onReset: () => void
}

export function NavBar({ api, onOpen, onReset }: NavBarProps) {
  const { signOut } = useClerk()
  const { user }    = useUser()
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    if (!api) return
    const update = () => setActive(api.activePanel?.id ?? null)
    update()
    const subs = [
      api.onDidAddPanel(update),
      api.onDidRemovePanel(update),
      api.onDidActivePanelChange(update),
    ]
    return () => subs.forEach(s => s.dispose())
  }, [api])

  const handleClick = (id: PanelId) => {
    const existing = api?.getPanel(id)
    if (existing) {
      existing.api.setActive()
    } else {
      onOpen(id)
    }
  }

  return (
    <header className="h-9 flex items-stretch flex-shrink-0 bg-terminal-navy border-b border-terminal-navy-border select-none">

      {/* Wordmark */}
      <div className="flex items-center px-4 border-r border-terminal-navy-border flex-shrink-0">
        <img src="/logo-white.png" alt="Endenex" className="h-3.5 w-auto" />
      </div>

      {/* All module tabs — always visible */}
      <nav className="flex items-stretch flex-1 min-w-0">
        {ALL_PANELS.map(id => {
          const isActive = id === active
          return (
            <button
              key={id}
              onClick={() => handleClick(id)}
              className={clsx(
                'relative flex items-center px-5 h-full text-[11px] font-medium border-r border-terminal-navy-border whitespace-nowrap transition-colors',
                isActive
                  ? 'bg-terminal-black text-terminal-text'
                  : 'text-gray-500 hover:text-gray-200 hover:bg-terminal-navy-light'
              )}
            >
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-terminal-teal" />
              )}
              {PANELS[id].title}
            </button>
          )
        })}
      </nav>

      {/* User + controls */}
      <div className="flex items-center gap-4 px-4 border-l border-terminal-navy-border flex-shrink-0">
        <span className="text-[10px] text-gray-600 hidden lg:block">
          {user?.primaryEmailAddress?.emailAddress}
        </span>
        <button
          onClick={onReset}
          title="Reset workspace to default layout"
          className="text-[10px] text-gray-600 hover:text-gray-300 transition-colors tracking-wider uppercase"
        >
          Reset layout
        </button>
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
