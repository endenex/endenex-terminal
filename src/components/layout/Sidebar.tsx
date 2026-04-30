import { NavLink, useNavigate } from 'react-router-dom'
import { useClerk, useUser } from '@clerk/clerk-react'
import {
  LayoutDashboard, TrendingUp, Wind, Layers, Leaf,
  Radio, BarChart2, LogOut, ChevronRight
} from 'lucide-react'
import { clsx } from 'clsx'

const NAV_ITEMS = [
  { path: '/',          label: 'HOME',      icon: LayoutDashboard },
  { path: '/dci',       label: 'DCI',       icon: TrendingUp },
  { path: '/retirement',label: 'RETIREMENT',icon: Wind },
  { path: '/materials', label: 'MATERIALS', icon: Layers },
  { path: '/blades',    label: 'BLADES',    icon: Leaf },
  { path: '/watch',     label: 'WATCH',     icon: Radio },
  { path: '/portfolio', label: 'PORTFOLIO', icon: BarChart2 },
]

export function Sidebar() {
  const { signOut } = useClerk()
  const { user } = useUser()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/sign-in')
  }

  const displayName = user?.fullName || user?.primaryEmailAddress?.emailAddress || ''
  const email = user?.primaryEmailAddress?.emailAddress || ''

  return (
    <aside className="w-48 min-h-screen bg-terminal-navy flex flex-col border-r border-terminal-navy-border flex-shrink-0">
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
            end={path === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded text-xs font-mono font-medium tracking-wider transition-colors group',
                isActive
                  ? 'bg-terminal-teal/15 text-terminal-teal'
                  : 'text-gray-500 hover:text-gray-200 hover:bg-terminal-navy-light'
              )
            }
          >
            <Icon size={14} />
            <span>{label}</span>
            <ChevronRight
              size={10}
              className="ml-auto opacity-0 group-hover:opacity-30 transition-opacity"
            />
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div className="px-3 py-4 border-t border-terminal-navy-border">
        <div className="px-3 py-2 mb-1">
          <div className="text-gray-300 text-xs font-medium truncate">{displayName}</div>
          <div className="text-gray-500 text-xs truncate">{email}</div>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2 w-full rounded text-xs text-gray-500 hover:text-gray-200 hover:bg-terminal-navy-light transition-colors font-mono"
        >
          <LogOut size={13} />
          <span>SIGN OUT</span>
        </button>
      </div>
    </aside>
  )
}
