import { useState, useEffect, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import { useWorkspaceState, SerializedTab, ProjectWorkspaceState, GlobalWorkspaceState } from './hooks/useWorkspaceState'
import TerminalTabs from './components/TerminalTabs'
import FilePanel from './components/FilePanel'
import ConfirmDialog from './components/ConfirmDialog'
import ErrorBoundary from './components/ErrorBoundary'
import './App.css'

// 检查是否在 Tauri 环境中
const isTauri = typeof window !== 'undefined' && window.__TAURI__

// 模拟数据用于开发测试
const mockSessions: Session[] = [
  // Claude 会话
  {
    agent: 'claude',
    session_id: '68bd13fb-1125-41fc-8936-5b89319e84ee',
    title: '看看日志，是不是gen-java 没生成',
    project: 'C:\\code',
    status: 'idle',
    updated_at: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    agent: 'claude',
    session_id: '9aa1ba67-b45e-47fc-b76a-108cb1dbaa23',
    title: 'git仓库，我叫什么好',
    project: 'C:\\code',
    status: 'idle',
    updated_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    agent: 'claude',
    session_id: '0d71362f-6510-4070-8250-f146022f52d6',
    title: '帮我查一下，最新的Claude code，怎么自定义增加状态栏',
    project: 'C:\\code\\newdao-ide-windows\\model',
    status: 'idle',
    updated_at: new Date(Date.now() - 172800000).toISOString(),
  },
  // MiMo 会话
  {
    agent: 'mimo',
    session_id: 'ses_0c9eafd14ffeU9dRcKJpvav46y',
    title: '统一AI Agent CLI会话管理工具（agent-hub）开发',
    status: 'memory',
    updated_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    agent: 'mimo',
    session_id: 'ses_0ca795ea8ffeh20niN0cqwyoJk',
    title: 'Git commit review - 供货单退回功能 & CI build failure analysis',
    status: 'memory',
    updated_at: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    agent: 'mimo',
    session_id: 'ses_0f20435e4ffeF4wBrLew7lMgll',
    title: 'ZED jdtls LSP 配置完成 & mimocode.json 搜索',
    status: 'memory',
    updated_at: new Date(Date.now() - 10800000).toISOString(),
  },
  {
    agent: 'mimo',
    session_id: 'ses_102811a83ffe6HaRffV0Y18LI1',
    title: '在牛刀平台实现 listReturnedIds 和 submitDeliver 接口',
    status: 'memory',
    updated_at: new Date(Date.now() - 14400000).toISOString(),
  },
  // Kimi 会话
  {
    agent: 'kimi',
    session_id: 'fc0726e7-9dcc-48a4-8939-c0318856608f',
    title: 'codebase-memory-mcp，测试一下',
    project: 'wd_code_c5493a70485d',
    status: 'unknown',
    updated_at: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    agent: 'kimi',
    session_id: '84f67ba3-b82b-4d1c-82ec-c58f32a1d66f',
    title: 'http://localhost:8088/#/order，帮我查一下，这个订单管理的数据',
    project: 'wd_code_c5493a70485d',
    status: 'unknown',
    updated_at: new Date(Date.now() - 86400000).toISOString(),
  },
]

export interface Project {
  name: string
  agent: string
  path?: string
  session_count: number
}

export interface Session {
  agent: string
  session_id: string
  title?: string
  project?: string
  status?: string
  started_at?: string
  updated_at?: string
  message_count?: number
}

export interface TerminalTab {
  id: string
  type: 'shell' | 'session' | 'file'
  title: string
  agent?: string
  sessionId?: string
  projectPath: string
  filePath?: string
  isDirty?: boolean
}

function serializeTab(tab: TerminalTab): SerializedTab {
  if (tab.type === 'shell') {
    return {
      type: 'shell',
      id: tab.id,
      title: tab.title,
      project_path: tab.projectPath,
    }
  }
  if (tab.type === 'session') {
    return {
      type: 'session',
      id: tab.id,
      title: tab.title,
      agent: tab.agent || '',
      session_id: tab.sessionId || '',
      project_path: tab.projectPath,
    }
  }
  return {
    type: 'file',
    id: tab.id,
    title: tab.title,
    file_path: tab.filePath || '',
    project_path: tab.projectPath,
  }
}

function deserializeTab(tab: SerializedTab): TerminalTab | null {
  if (tab.type === 'shell') {
    return {
      id: tab.id,
      type: 'shell',
      title: tab.title,
      projectPath: tab.project_path,
    }
  }
  if (tab.type === 'session') {
    return {
      id: tab.id,
      type: 'session',
      title: tab.title,
      agent: tab.agent,
      sessionId: tab.session_id,
      projectPath: tab.project_path,
    }
  }
  if (tab.type === 'file') {
    return {
      id: tab.id,
      type: 'file',
      title: tab.title,
      projectPath: tab.project_path,
      filePath: tab.file_path,
    }
  }
  return null
}

function buildProjectState(
  projectPath: string,
  tabs: TerminalTab[],
  activeTabId: string | null,
  expandedDirs: string[],
  expandedProjects: string[]
): ProjectWorkspaceState {
  return {
    version: 1,
    project_path: projectPath,
    expanded_dirs: expandedDirs,
    expanded_projects: expandedProjects,
    tabs: tabs.map(serializeTab),
    active_tab_id: activeTabId,
  }
}

function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // 记录文件标签页的当前编辑内容，用于关闭时保存
  const [fileContents, setFileContents] = useState<Record<string, string>>({})
  // 关闭未保存文件时的确认弹窗状态
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean
    tabId: string | null
    fileName: string
  }>({ isOpen: false, tabId: null, fileName: '' })

  const { loadProjectState, saveProjectState, loadGlobalState, saveGlobalState } = useWorkspaceState()
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())

  const restoreProjectState = (state: ProjectWorkspaceState) => {
    setExpandedDirs(new Set(state.expanded_dirs))
    setExpandedProjects(new Set(state.expanded_projects))

    const restoredTabs: TerminalTab[] = []
    for (const tab of state.tabs) {
      const restored = deserializeTab(tab)
      if (restored) {
        restoredTabs.push(restored)
      }
    }
    setTabs(restoredTabs)
    setActiveTabId(state.active_tab_id)
  }

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)

      let sessionsData: Session[] = []
      if (isTauri) {
        const { invoke } = await import('@tauri-apps/api/tauri')
        sessionsData = await invoke<Session[]>('get_sessions', {})
      } else {
        sessionsData = mockSessions
      }
      setSessions(sessionsData)

      if (isTauri) {
        const global = await loadGlobalState()
        const lastProject = global.last_project_path
        if (lastProject && sessionsData.some((s) => s.project === lastProject)) {
          setSelectedProject(lastProject)
          const projectState = await loadProjectState(lastProject)
          restoreProjectState(projectState)
        }
      }
    } catch (err) {
      console.error('Error loading data:', err)
      if (!isTauri) {
        setSessions(mockSessions)
      }
    } finally {
      setLoading(false)
    }
  }

  const selectProject = useCallback(async (path: string | null) => {
    const previousProject = selectedProject
    if (previousProject && isTauri) {
      const state = buildProjectState(
        previousProject,
        tabs,
        activeTabId,
        Array.from(expandedDirs),
        Array.from(expandedProjects)
      )
      await saveProjectState(state).catch((err) => console.error('Failed to save workspace state:', err))
    }

    setSelectedProject(path)

    if (path && isTauri) {
      const state = await loadProjectState(path)
      restoreProjectState(state)
    } else {
      setExpandedDirs(new Set())
      setExpandedProjects(new Set())
      setTabs([])
      setActiveTabId(null)
    }
  }, [selectedProject, tabs, activeTabId, expandedDirs, expandedProjects, saveProjectState, loadProjectState])

  useEffect(() => {
    if (!selectedProject || !isTauri) return

    const state = buildProjectState(
      selectedProject,
      tabs,
      activeTabId,
      Array.from(expandedDirs),
      Array.from(expandedProjects)
    )

    const timer = setTimeout(() => {
      saveProjectState(state).catch((err) => console.error('Failed to auto-save workspace state:', err))
    }, 500)

    return () => clearTimeout(timer)
  }, [selectedProject, tabs, activeTabId, expandedDirs, expandedProjects, saveProjectState])

  useEffect(() => {
    if (!isTauri) return

    let timer: ReturnType<typeof setTimeout> | null = null

    const handleResize = async () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        try {
          const { appWindow } = await import('@tauri-apps/api/window')
          const size = await appWindow.innerSize()
          const isMaximized = await appWindow.isMaximized()
          const current = await loadGlobalState()
          await saveGlobalState({
            ...current,
            window_width: size.width,
            window_height: size.height,
            window_maximized: isMaximized,
          })
        } catch (err) {
          console.error('Failed to save window size:', err)
        }
      }, 500)
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      if (timer) clearTimeout(timer)
    }
  }, [loadGlobalState, saveGlobalState])

  useEffect(() => {
    if (!isTauri) return

    const restoreWindow = async () => {
      try {
        const global = await loadGlobalState()
        const { appWindow, LogicalSize } = await import('@tauri-apps/api/window')
        if (global.window_maximized) {
          await appWindow.maximize()
        } else if (global.window_width && global.window_height) {
          await appWindow.setSize(new LogicalSize(global.window_width, global.window_height))
        }
      } catch (err) {
        console.error('Failed to restore window size:', err)
      }
    }

    restoreWindow()
  }, [loadGlobalState])

  // 关闭前保存状态：Tauri 下用 onCloseRequested，非 Tauri 用 beforeunload 兜底
  useEffect(() => {
    const saveOnClose = async () => {
      if (selectedProject) {
        const state = buildProjectState(
          selectedProject,
          tabs,
          activeTabId,
          Array.from(expandedDirs),
          Array.from(expandedProjects)
        )
        await saveProjectState(state).catch((err) => console.error('Failed to save project state on close:', err))
      }
      const global = await loadGlobalState()
      await saveGlobalState({
        ...global,
        last_project_path: selectedProject,
      }).catch((err) => console.error('Failed to save global state on close:', err))
    }

    let unlisten: (() => void) | null = null

    if (isTauri) {
      // Tauri onCloseRequested：阻止默认关闭，保存状态，再手动关闭
      import('@tauri-apps/api/window').then(async ({ appWindow }) => {
        unlisten = await appWindow.onCloseRequested(async (event) => {
          event.preventDefault()
          // 最多等 2s 保存
          await Promise.race([
            saveOnClose(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
          ]).catch((err) => console.error('Close save failed:', err))
          appWindow.close()
        })
      })
    } else {
      // 非 Tauri 环境用 beforeunload 兜底
      window.addEventListener('beforeunload', saveOnClose)
    }

    return () => {
      unlisten?.()
      window.removeEventListener('beforeunload', saveOnClose)
    }
  }, [selectedProject, tabs, activeTabId, expandedDirs, expandedProjects, saveProjectState, saveGlobalState, loadGlobalState])

  const generateTabId = (type: 'shell' | 'session' | 'file', identifier: string) => {
    return `${type}:${identifier}:${Date.now()}`
  }

  const openShellTab = useCallback((projectPath: string) => {
    const existingTab = tabs.find(
      (t) => t.type === 'shell' && t.projectPath === projectPath
    )
    if (existingTab) {
      setActiveTabId(existingTab.id)
      return
    }

    const id = generateTabId('shell', projectPath)
    const title = `Shell - ${projectPath.split('\\').pop() || projectPath.split('/').pop() || projectPath}`
    const newTab: TerminalTab = {
      id,
      type: 'shell',
      title,
      projectPath,
    }
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(id)
  }, [tabs])

  const openSessionTab = useCallback((session: Session) => {
    const existingTab = tabs.find(
      (t) => t.type === 'session' && t.sessionId === session.session_id && t.agent === session.agent
    )
    if (existingTab) {
      setActiveTabId(existingTab.id)
      return
    }

    const id = generateTabId('session', session.session_id)
    const title = session.title || session.session_id.slice(0, 12)
    const newTab: TerminalTab = {
      id,
      type: 'session',
      title,
      agent: session.agent,
      sessionId: session.session_id,
      projectPath: session.project || selectedProject || 'C:\\Users\\admin',
    }
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(id)
  }, [tabs, selectedProject])

  const openFileTab = useCallback((filePath: string) => {
    const existingTab = tabs.find(
      (t) => t.type === 'file' && t.filePath === filePath
    )
    if (existingTab) {
      setActiveTabId(existingTab.id)
      return
    }

    const id = generateTabId('file', filePath)
    const title = filePath.split('\\').pop() || filePath.split('/').pop() || filePath
    const newTab: TerminalTab = {
      id,
      type: 'file',
      title,
      projectPath: selectedProject || '',
      filePath,
    }
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(id)
  }, [tabs, selectedProject])

  const doCloseTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const index = prev.findIndex((t) => t.id === tabId)
      const next = prev.filter((t) => t.id !== tabId)

      if (activeTabId === tabId) {
        const nextActive = next[index]?.id ?? next[index - 1]?.id ?? next[0]?.id ?? null
        setActiveTabId(nextActive)
      }

      return next
    })
    // 清理对应文件内容缓存
    setFileContents((prev) => {
      const next = { ...prev }
      delete next[tabId]
      return next
    })
  }, [activeTabId])

  const closeTab = useCallback((tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab) return

    // 文件标签页且有未保存修改，弹出三按钮确认框
    if (tab.type === 'file' && tab.isDirty) {
      setConfirmDialog({
        isOpen: true,
        tabId,
        fileName: tab.title,
      })
      return
    }

    doCloseTab(tabId)
  }, [tabs])

  const handleConfirmSave = useCallback(async () => {
    const { tabId } = confirmDialog
    if (!tabId) return

    const tab = tabs.find((t) => t.id === tabId)
    if (tab?.type === 'file' && tab.filePath) {
      const content = fileContents[tabId]
      if (content !== undefined) {
        try {
          if (isTauri) {
            const { invoke } = await import('@tauri-apps/api/tauri')
            await invoke('write_file', { path: tab.filePath, content })
          }
        } catch (err) {
          console.error('Failed to save file:', err)
          return
        }
      }
    }

    setConfirmDialog({ isOpen: false, tabId: null, fileName: '' })
    doCloseTab(tabId)
  }, [confirmDialog, tabs, fileContents])

  const handleConfirmDiscard = useCallback(() => {
    const { tabId } = confirmDialog
    if (!tabId) return

    setConfirmDialog({ isOpen: false, tabId: null, fileName: '' })
    doCloseTab(tabId)
  }, [confirmDialog])

  const handleConfirmCancel = useCallback(() => {
    setConfirmDialog({ isOpen: false, tabId: null, fileName: '' })
  }, [])

  const selectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId)
  }, [])

  const handleFileDirtyChange = useCallback((tabId: string, isDirty: boolean, content: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, isDirty } : t))
    )
    setFileContents((prev) => ({ ...prev, [tabId]: content }))
  }, [])

  if (loading) {
    return <div className="loading">加载中...</div>
  }

  return (
    <div className="app">
      <Sidebar
        sessions={sessions}
        selectedProject={selectedProject}
        onSelectProject={selectProject}
        onOpenShell={openShellTab}
        onOpenSession={openSessionTab}
        expandedProjects={expandedProjects}
        onExpandedProjectsChange={setExpandedProjects}
      />
      <ErrorBoundary fallback={<div className="error-boundary-fallback"><h3>终端面板加载失败</h3><p>请刷新页面重试</p></div>}>
        <TerminalTabs
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={selectTab}
          onCloseTab={closeTab}
          onSetTabDirty={handleFileDirtyChange}
          onNewShell={() => {
            const projectPath = selectedProject || 'C:\\CODE\\AICode\\agent-hub'
            openShellTab(projectPath)
          }}
        />
      </ErrorBoundary>
      <ErrorBoundary fallback={<div className="error-boundary-fallback"><h3>文件面板加载失败</h3><p>请刷新页面重试</p></div>}>
        <FilePanel
          projectPath={selectedProject}
          onOpenFile={openFileTab}
          expandedDirs={expandedDirs}
          onExpandedDirsChange={setExpandedDirs}
        />
      </ErrorBoundary>

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title="未保存的修改"
        message={`「${confirmDialog.fileName}」有未保存的修改，是否保存？`}
        buttons={[
          { label: '保存', variant: 'primary', onClick: handleConfirmSave },
          { label: '不保存', variant: 'danger', onClick: handleConfirmDiscard },
          { label: '取消', variant: 'secondary', onClick: handleConfirmCancel },
        ]}
      />
    </div>
  )
}

export default App
