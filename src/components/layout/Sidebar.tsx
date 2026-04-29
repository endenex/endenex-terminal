import { NavLink, useNavigate } from 'react-router-dom'
import { useClerk, useUser } from '@clerk/clerk-react'
import { Activity, GitBranch, Calculator, LayoutDashboard, LogOut, ChevronRight, Recycle } from 'lucide-react'
import { clsx } from 'clsx'

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { path: '/repowering-pipeline', label: 'Repowering Pipeline', icon: GitBranch },
  { path: '/recovery-value', label: 'Recovery Value', icon: Recycle },
  { path: '/market-monitor', label: 'Market Monitor', icon: Activity },
  { path: '/workbench', label: 'Workbench', icon: Calculator },
]

export function Sidebar() {
  const { signOut } = useClerk()
  const { user } = useUser()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/sign-in')
  }

  const displayName =
    user?.fullName || user?.primaryEmailAddress?.emailAddress || ''
  const email = user?.primaryEmailAddress?.emailAddress || ''

  return (
    <aside className="w-56 min-h-screen bg-terminal-navy flex flex-col border-r border-terminal-navy-border flex-shrink-0">
      {/* Wordmark */}
      <div className="px-5 py-4 border-b border-terminal-navy-border">
        <img src="/logo-white.png" alt="Endenex" className="h-5 w-auto" />
        <div className="text-gray-500 font-mono text-[10px] tracking-[0.2em] mt-2">
          TERMINAL
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded text-sm transition-colors group',
                isActive
                  ? 'bg-terminal-teal/15 text-terminal-teal'
                  : 'text-gray-400 hover:text-white hover:bg-terminal-navy-light'
              )
            }
          >
            <Icon size={15} />
            <span>{label}</span>
            <ChevronRight
              size={11}
              className="ml-auto opacity-0 group-hover:opacity-40 transition-opacity"
            />
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div className="px-3 py-4 border-t border-terminal-navy-border">
        <div className="px-3 py-2 mb-1">
          <div className="text-white text-xs font-medium truncate">{displayName}</div>
          <div className="text-gray-500 text-xs truncate">{email}</div>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2 w-full rounded text-sm text-gray-400 hover:text-white hover:bg-terminal-navy-light transition-colors"
        >
          <LogOut size={14} />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  )
}
