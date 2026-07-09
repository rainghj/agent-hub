import { useState, useMemo } from 'react'
import type { Session } from '../App'
import './Sidebar.css'

interface SidebarProps {
  sessions: Session[]
  selectedProject: string | null
  onSelectProject: (project: string | null) => void
  onOpenShell: (projectPath: string) => void
  onOpenSession: (session: Session) => void
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
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())

  const toggleProject = (projectPath: string) => {
    const newExpanded = new Set(expandedProjects)
    if (newExpanded.has(projectPath)) {
      newExpanded.delete(projectPath)
    } else {
      newExpanded.add(projectPath)
    }
    setExpandedProjects(newExpanded)
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

  const projectGroups = useMemo<ProjectGroup[]>(() => {
    const map = new Map<string, Session[]>()
    for (const session of filteredSessions) {
      const project = session.project || '未分类'
      if (!map.has(project)) {
        map.set(project, [])
      }
      map.get(project)!.push(session)
    }

    const groups: ProjectGroup[] = []
    for (const [path, projectSessions] of map) {
      const sorted = [...projectSessions].sort(
        (a, b) =>
          new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
      )
      groups.push({
        path,
        sessions: sorted,
        lastUpdated: sorted[0]?.updated_at || null,
      })
    }

    // 按目录下最新会话的更新时间排序（活跃度）
    groups.sort(
      (a, b) =>
        new Date(b.lastUpdated || 0).getTime() - new Date(a.lastUpdated || 0).getTime()
    )

    return groups
  }, [filteredSessions])

  const getAgentIcon = (agent: string) => {
    switch (agent) {
      case 'claude':
        return '🟤'
      case 'mimo':
        return '🔴'
      case 'kimi':
        return '🟢'
      default:
        return '⚪'
    }
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
      </div>

      <div className="project-list">
        {projectGroups.map((group) => {
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
                <span className="project-name">{getProjectName(group.path)}</span>
                <span className="session-count">{group.sessions.length}</span>
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
                      <span className="session-icon">{getAgentIcon(session.agent)}</span>
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
