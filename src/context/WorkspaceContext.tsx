import { createContext, useContext } from 'react'
import type { PanelId } from '@/components/layout/AppShell'

interface WorkspaceContextValue {
  openPanel: (id: PanelId) => void
}

export const WorkspaceContext = createContext<WorkspaceContextValue>({
  openPanel: () => {},
})

export const useWorkspace = () => useContext(WorkspaceContext)
