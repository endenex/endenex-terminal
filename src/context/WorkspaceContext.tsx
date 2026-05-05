import { createContext, useContext } from 'react'
import type { PanelId } from '@/config/panels'

interface WorkspaceContextValue {
  activeTab:  PanelId
  openPanel:  (id: PanelId) => void
}

export const WorkspaceContext = createContext<WorkspaceContextValue>({
  activeTab: 'home',
  openPanel: () => {},
})

export const useWorkspace = () => useContext(WorkspaceContext)
