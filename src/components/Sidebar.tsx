import { useState, useMemo, type CSSProperties } from 'react'
import type { Session } from '../App'
import { useAgentProfiles } from '../hooks/useAgentProfiles'
import { SearchIcon, FolderIcon, PlusIcon, ChevronDownIcon, ChevronRightIcon } from './Icons'
import './Sidebar.css'

const RECENT_THRESHOLD_MS = 5 * 24 * 60 * 60 * 1000 // 5 天
const OLDER_PAGE_SIZE = 10
const MAX_VISIBLE_PROJECTS = 10 // 非搜索时最多显示的项目数

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
  const [olderCounts, setOlderCounts] = useState<Record<string, number>>({})
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

  const visibleGroups = searchQuery
    ? projectGroups.filter((g) => g.sessions.length > 0)
    : projectGroups.slice(0, MAX_VISIBLE_PROJECTS)

  const getAgentIcon = (agent: string, isRunning: boolean, isOutputting: boolean) => {
    if (!isRunning) {
      return <span className="agent-color-dot idle" />
    }
    const color = profileById(agent)?.icon_color || '#71717A'
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

  const isRecent = (session: Session) => {
    if (!session.updated_at) return true
    return Date.now() - new Date(session.updated_at).getTime() < RECENT_THRESHOLD_MS
  }

  const getProjectName = (path: string) => {
    if (path === '未分类') return path
    return path.split('\\').pop() || path.split('/').pop() || path
  }

  return (
    <div className="sidebar">
      {/* 搜索框 */}
      <div className="sidebar-search">
        <SearchIcon size={14} className="sidebar-search-icon" />
        <input
          type="text"
          className="sidebar-search-input"
          placeholder="搜索会话..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* 打开项目按钮 */}
      {onOpenProjectFolder && (
        <button className="sidebar-open-btn" onClick={onOpenProjectFolder}>
          <FolderIcon size={14} className="sidebar-open-btn-icon" />
          <span>打开项目...</span>
        </button>
      )}

      {/* 最近项目分组标题 */}
      <div className="sidebar-section-header">最近项目</div>
      <div className="sidebar-divider" />

      {/* 项目列表 */}
      <div className="sidebar-list">
        {visibleGroups.length === 0 && (
          <div className="sidebar-list-empty">
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
                <FolderIcon size={14} className="project-item-icon" filled={isSelected} style={{ color: isSelected ? '#FAFAFA' : '#A1A1AA' }} />
                <span className="project-item-name" title={group.path}>
                  {getProjectName(group.path)}
                </span>
                {group.sessions.length > 0 && (
                  <span className="project-item-badge">{group.sessions.length}</span>
                )}
                {recentProjects.includes(group.path) && (
                  <button
                    className="project-item-remove"
                    title="从最近列表移除"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveRecentProject(group.path)
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {isExpanded && (
                <div className="session-list">
                  <div
                    className="session-item session-item-new"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenShell(group.path)
                    }}
                  >
                    <PlusIcon size={12} className="session-item-icon" />
                    <span className="session-item-title">新建空终端</span>
                  </div>
                  {(() => {
                    const isSearching = !!searchQuery
                    const recent = isSearching
                      ? group.sessions
                      : group.sessions.filter((s) => isRecent(s))
                    const older = isSearching
                      ? []
                      : group.sessions.filter((s) => !isRecent(s))
                    const loaded = olderCounts[group.path] || 0
                    const visibleOlder = older.slice(0, loaded)
                    const remaining = older.length - loaded

                    const renderSession = (session: Session) => (
                      <div
                        key={session.session_id}
                        className="session-item"
                        onClick={() => onOpenSession(session)}
                      >
                        <span className="session-item-icon">
                          {getAgentIcon(session.agent, runningSessions.has(session.session_id), outputtingSessions.has(session.session_id))}
                        </span>
                        <span className="session-item-title">
                          {session.title || session.session_id.slice(0, 20)}
                        </span>
                        <span className="session-item-time">{formatTime(session.updated_at)}</span>
                      </div>
                    )

                    return (
                      <>
                        {recent.map(renderSession)}
                        {visibleOlder.map(renderSession)}
                        {!isSearching && remaining > 0 && (
                          <div
                            className="session-item session-item-more"
                            onClick={(e) => {
                              e.stopPropagation()
                              setOlderCounts((prev) => ({
                                ...prev,
                                [group.path]: (prev[group.path] || 0) + OLDER_PAGE_SIZE,
                              }))
                            }}
                          >
                            <span className="session-item-icon">···</span>
                            <span className="session-item-title">显示更多（剩余 {remaining} 条）</span>
                          </div>
                        )}
                      </>
                    )
                  })()}
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