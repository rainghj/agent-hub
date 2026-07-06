import { useState } from 'react'
import './Sidebar.css'

interface Project {
  name: string
  agent: string
  path?: string
  session_count: number
}

interface Session {
  agent: string
  session_id: string
  title?: string
  project?: string
  status?: string
  started_at?: string
  updated_at?: string
  message_count?: number
}

interface SidebarProps {
  projects: Project[]
  sessions: Session[]
  selectedSession: Session | null
  onSelectSession: (session: Session) => void
  onSelectProject: (project: string | null) => void
}

function Sidebar({ projects, sessions, selectedSession, onSelectSession, onSelectProject }: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set(['C:\\code', '未分类', 'wd_code_c5493a70485d']))
  const [agentFilter, setAgentFilter] = useState<string | null>(null)

  const toggleProject = (projectName: string) => {
    const newExpanded = new Set(expandedProjects)
    if (newExpanded.has(projectName)) {
      newExpanded.delete(projectName)
    } else {
      newExpanded.add(projectName)
    }
    setExpandedProjects(newExpanded)
  }

  const filteredSessions = sessions.filter(session => {
    // Agent 过滤
    if (agentFilter && session.agent !== agentFilter) return false
    // 搜索过滤
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      session.title?.toLowerCase().includes(query) ||
      session.session_id.toLowerCase().includes(query) ||
      session.project?.toLowerCase().includes(query)
    )
  })

  // 按项目分组会话
  const sessionsByProject = new Map<string, Session[]>()
  for (const session of filteredSessions) {
    const project = session.project || '未分类'
    if (!sessionsByProject.has(project)) {
      sessionsByProject.set(project, [])
    }
    sessionsByProject.get(project)!.push(session)
  }

  const getAgentIcon = (agent: string) => {
    switch (agent) {
      case 'claude': return '🟤'
      case 'mimo': return '🔴'
      case 'kimi': return '🟢'
      default: return '⚪'
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

  const agentButtons = [
    { id: null, label: '全部', icon: '📋' },
    { id: 'claude', label: 'Claude', icon: '🟤' },
    { id: 'mimo', label: 'MiMo', icon: '🔴' },
    { id: 'kimi', label: 'Kimi', icon: '🟢' },
  ]

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title">
          <h2>Agent Hub</h2>
        </div>

        <div className="agent-filters">
          {agentButtons.map(btn => (
            <button
              key={btn.id || 'all'}
              className={`agent-filter-btn ${agentFilter === btn.id ? 'active' : ''}`}
              onClick={() => setAgentFilter(btn.id)}
            >
              <span className="agent-filter-icon">{btn.icon}</span>
              <span className="agent-filter-label">{btn.label}</span>
            </button>
          ))}
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
        {Array.from(sessionsByProject.entries()).map(([project, projectSessions]) => (
          <div key={project} className="project-group">
            <div
              className={`project-item ${expandedProjects.has(project) ? 'active' : ''}`}
              onClick={() => toggleProject(project)}
            >
              <span className="project-icon">
                {expandedProjects.has(project) ? '📂' : '📁'}
              </span>
              <span className="project-name">{project}</span>
              <span className="session-count">{projectSessions.length}</span>
            </div>

            {expandedProjects.has(project) && (
              <div className="session-list">
                {projectSessions.map(session => (
                  <div
                    key={session.session_id}
                    className={`session-item ${selectedSession?.session_id === session.session_id ? 'active' : ''}`}
                    onClick={() => onSelectSession(session)}
                  >
                    <span className="session-icon">
                      {getAgentIcon(session.agent)}
                    </span>
                    <span className="session-title">
                      {session.title || session.session_id.slice(0, 20)}
                    </span>
                    <span className="session-time">
                      {formatTime(session.updated_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default Sidebar
