import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-terminal-grey">
      <Sidebar />
      <main className="flex-1 overflow-auto flex flex-col">
        <Outlet />
      </main>
    </div>
  )
}
