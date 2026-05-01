import { useClerk, useUser } from '@clerk/clerk-react'
export type PanelId = 'home' | 'dci' | 'retirement' | 'materials' | 'blades' | 'watch' | 'portfolio'

const NAV: { id: PanelId; label: string }[] = [
  { id: 'home',       label: 'HOME' },
  { id: 'dci',        label: 'DCI' },
  { id: 'retirement', label: 'RETIREMENT' },
  { id: 'materials',  label: 'MATERIALS' },
  { id: 'blades',     label: 'BLADES' },
  { id: 'watch',      label: 'WATCH' },
  { id: 'portfolio',  label: 'PORTFOLIO' },
]

interface SidebarProps {
  onOpen: (id: PanelId) => void
}

export function Sidebar({ onOpen }: SidebarProps) {
  const { signOut } = useClerk()
  const { user }    = useUser()

  const email = user?.primaryEmailAddress?.emailAddress ?? ''

  return (
    <aside className="w-36 flex flex-col flex-shrink-0 bg-terminal-navy border-r border-terminal-navy-border">

      {/* Wordmark */}
      <div className="px-4 py-4 border-b border-terminal-navy-border">
        <img src="/logo-white.png" alt="Endenex" className="h-4 w-auto" />
        <div className="text-[9px] text-gray-600 tracking-[0.25em] mt-1.5 uppercase">
          Terminal
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2">
        {NAV.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => onOpen(id)}
            className="w-full text-left px-4 py-2.5 text-[11px] font-medium tracking-wider text-gray-500 hover:text-gray-100 hover:bg-terminal-navy-light transition-colors"
          >
            {label}
          </button>
        ))}
      </nav>

      {/* User */}
      <div className="px-4 py-4 border-t border-terminal-navy-border">
        <div className="text-[10px] text-gray-600 truncate mb-2">{email}</div>
        <button
          onClick={() => signOut()}
          className="text-[10px] text-gray-600 hover:text-gray-300 transition-colors tracking-wider uppercase"
        >
          Sign out
        </button>
      </div>
    </aside>
  )
}
