import { useCallback } from 'react'

const isTauri = typeof window !== 'undefined' && window.__TAURI__

export interface SerializedTabShell {
  type: 'shell'
  id: string
  title: string
  project_path: string
}

export interface SerializedTabSession {
  type: 'session'
  id: string
  title: string
  agent: string
  session_id: string
  project_path: string
}

export interface SerializedTabFile {
  type: 'file'
  id: string
  title: string
  file_path: string
  project_path: string
}

export type SerializedTab = SerializedTabShell | SerializedTabSession | SerializedTabFile

export interface ProjectWorkspaceState {
  version: number
  project_path: string
  expanded_dirs: string[]
  expanded_projects: string[]
  tabs: SerializedTab[]
  active_tab_id: string | null
}

export interface GlobalWorkspaceState {
  version: number
  last_project_path: string | null
  window_width: number | null
  window_height: number | null
  window_maximized: boolean | null
}

export interface WorkspaceStateAPI {
  loadProjectState: (projectPath: string) => Promise<ProjectWorkspaceState>
  saveProjectState: (state: ProjectWorkspaceState) => Promise<void>
  loadGlobalState: () => Promise<GlobalWorkspaceState>
  saveGlobalState: (state: GlobalWorkspaceState) => Promise<void>
}

const defaultProjectState = (projectPath: string): ProjectWorkspaceState => ({
  version: 1,
  project_path: projectPath,
  expanded_dirs: [],
  expanded_projects: [],
  tabs: [],
  active_tab_id: null,
})

const defaultGlobalState = (): GlobalWorkspaceState => ({
  version: 1,
  last_project_path: null,
  window_width: null,
  window_height: null,
  window_maximized: null,
})

export function useWorkspaceState(): WorkspaceStateAPI {
  const loadProjectState = useCallback(async (projectPath: string): Promise<ProjectWorkspaceState> => {
    if (!isTauri) {
      return defaultProjectState(projectPath)
    }
    const { invoke } = await import('@tauri-apps/api/tauri')
    return await invoke<ProjectWorkspaceState>('load_workspace_state', { project_path: projectPath })
  }, [])

  const saveProjectState = useCallback(async (state: ProjectWorkspaceState): Promise<void> => {
    if (!isTauri) {
      return
    }
    try {
      const { invoke } = await import('@tauri-apps/api/tauri')
      await invoke('save_workspace_state', { state })
    } catch (err) {
      console.error('Failed to save project state:', err)
    }
  }, [])

  const loadGlobalState = useCallback(async (): Promise<GlobalWorkspaceState> => {
    if (!isTauri) {
      return defaultGlobalState()
    }
    const { invoke } = await import('@tauri-apps/api/tauri')
    return await invoke<GlobalWorkspaceState>('load_global_workspace_state')
  }, [])

  const saveGlobalState = useCallback(async (state: GlobalWorkspaceState): Promise<void> => {
    if (!isTauri) {
      return
    }
    try {
      const { invoke } = await import('@tauri-apps/api/tauri')
      await invoke('save_global_workspace_state', { state })
    } catch (err) {
      console.error('Failed to save global state:', err)
    }
  }, [])

  return {
    loadProjectState,
    saveProjectState,
    loadGlobalState,
    saveGlobalState,
  }
}
