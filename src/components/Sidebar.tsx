import { useState, useMemo, type CSSProperties } from 'react'
import type { Session } from '../App'
import { useAgentProfiles } from '../hooks/useAgentProfiles'
import './Sidebar.css'

interface SidebarProps {
  sessions: Session[]
  selectedProject: string | null
  onSelectProject: (project: string | null) => void
  onOpenShell: (projectPath: string) => void
  onOpenSession: (session: Session) => void
  expandedProjects: Set<string>
  onExpandedProjectsChange: (expanded: Set<string>) => void
  recentProjects: string[]
  onOpenProjectFolder?: () => void
  onRemoveRecentProject: (path: string) => void
  runningSessions: Set<string>
  outputtingSessions: Set<string>
}

interface ProjectGroup {
  path: string
  sessions: Session[]
  lastUpdated: string | null
}

function Sidebar({
  sessions,
  selectedProject,
  onSelectProject,
  onOpenShell,
  onOpenSession,
  expandedProjects,
  onExpandedProjectsChange,
  recentProjects,
  onOpenProjectFolder,
  onRemoveRecentProject,
  runningSessions,
  outputtingSessions,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const { profileById } = useAgentProfiles()

  const toggleProject = (projectPath: string) => {
    const newExpanded = new Set(expandedProjects)
    if (newExpanded.has(projectPath)) {
      newExpanded.delete(projectPath)
    } else {
      newExpanded.add(projectPath)
    }
    onExpandedProjectsChange(newExpanded)
  }

  const filteredSessions = sessions.filter((session) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      session.title?.toLowerCase().includes(query) ||
      session.session_id.toLowerCase().includes(query) ||
      session.project?.toLowerCase().includes(query)
    )
  })

  const sessionsByProject = useMemo(() => {
    const map = new Map<string, Session[]>()
    for (const session of filteredSessions) {
      const project = session.project || '未分类'
      if (!map.has(project)) {
        map.set(project, [])
      }
      map.get(project)!.push(session)
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
      )
    }
    return map
  }, [filteredSessions])

  // 列表以最近打开的项目为主（最近的在前）；
  // 有会话但不在最近列表里的项目按活跃度追加在末尾（兜底）
  const projectGroups = useMemo<ProjectGroup[]>(() => {
    const groups: ProjectGroup[] = []
    const seen = new Set<string>()

    for (const path of recentProjects) {
      if (seen.has(path)) continue
      seen.add(path)
      const projectSessions = sessionsByProject.get(path) || []
      groups.push({
        path,
        sessions: projectSessions,
        lastUpdated: projectSessions[0]?.updated_at || null,
      })
    }

    const rest: ProjectGroup[] = []
    for (const [path, projectSessions] of sessionsByProject) {
      if (seen.has(path)) continue
      rest.push({
        path,
        sessions: projectSessions,
        lastUpdated: projectSessions[0]?.updated_at || null,
      })
    }
    rest.sort(
      (a, b) =>
        new Date(b.lastUpdated || 0).getTime() - new Date(a.lastUpdated || 0).getTime()
    )

    return [...groups, ...rest]
  }, [recentProjects, sessionsByProject])

  // 搜索时只展示有匹配会话的项目
  const visibleGroups = searchQuery
    ? projectGroups.filter((g) => g.sessions.length > 0)
    : projectGroups

  const getAgentIcon = (agent: string, isRunning: boolean, isOutputting: boolean) => {
    if (!isRunning) {
      return <span className="agent-color-dot idle" />
    }
    const color = profileById(agent)?.icon_color || '#71717a'
    return (
      <span
        className={`agent-color-dot running${isOutputting ? ' outputting' : ''}`}
        style={{ backgroundColor: color } as CSSProperties}
      />
    )
  }

  const formatTime = (time?: string) => {
    if (!time) return ''
    const date = new Date(time)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    return '刚刚'
  }

  const getProjectName = (path: string) => {
    if (path === '未分类') return path
    return path.split('\\').pop() || path.split('/').pop() || path
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title">
          <h2>Agent Hub</h2>
        </div>

        <input
          type="text"
          className="search-input"
          placeholder="搜索会话..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {onOpenProjectFolder && (
          <button className="open-project-btn" onClick={onOpenProjectFolder}>
            📂 打开项目...
          </button>
        )}
      </div>

      <div className="project-list">
        {visibleGroups.length === 0 && (
          <div className="project-list-empty">
            {searchQuery ? '没有匹配的会话' : '还没有项目，点击「打开项目」开始'}
          </div>
        )}
        {visibleGroups.map((group) => {
          const isExpanded = expandedProjects.has(group.path)
          const isSelected = selectedProject === group.path

          return (
            <div key={group.path} className="project-group">
              <div
                className={`project-item ${isSelected ? 'active' : ''}`}
                onClick={() => {
                  onSelectProject(group.path)
                  toggleProject(group.path)
                }}
              >
                <span className="project-icon">{isExpanded ? '📂' : '📁'}</span>
                <span className="project-name" title={group.path}>{getProjectName(group.path)}</span>
                {group.sessions.length > 0 && (
                  <span className="session-count">{group.sessions.length}</span>
                )}
                {recentProjects.includes(group.path) && (
                  <span
                    className="remove-btn"
                    title="从最近列表移除"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveRecentProject(group.path)
                    }}
                  >
                    ✕
                  </span>
                )}
              </div>

              {isExpanded && (
                <div className="session-list">
                  <div
                    className="session-item new-shell"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenShell(group.path)
                    }}
                  >
                    <span className="session-icon">➕</span>
                    <span className="session-title">新建空终端</span>
                  </div>
                  {group.sessions.map((session) => (
                    <div
                      key={session.session_id}
                      className="session-item"
                      onClick={() => onOpenSession(session)}
                    >
                      <span className="session-icon">{getAgentIcon(session.agent, runningSessions.has(session.session_id), outputtingSessions.has(session.session_id))}</span>
                      <span className="session-title">
                        {session.title || session.session_id.slice(0, 20)}
                      </span>
                      <span className="session-time">{formatTime(session.updated_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default Sidebar
