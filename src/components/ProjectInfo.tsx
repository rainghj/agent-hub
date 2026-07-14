import { useAgentProfiles } from '../hooks/useAgentProfiles'
import './ProjectInfo.css'

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

interface ProjectInfoProps {
  session: Session | null
}

function ProjectInfo({ session }: ProjectInfoProps) {
  const { profileById } = useAgentProfiles()

  const getAgentName = (agent: string) => {
    return profileById(agent)?.name || agent
  }

  const getStatusText = (status?: string) => {
    switch (status) {
      case 'running': return '运行中'
      case 'idle': return '空闲'
      case 'memory': return '已保存'
      default: return status || '未知'
    }
  }

  const formatTime = (time?: string) => {
    if (!time) return '-'
    return new Date(time).toLocaleString()
  }

  if (!session) {
    return (
      <div className="project-info">
        <div className="project-info-header">
          <h3>项目信息</h3>
        </div>
        <div className="project-info-content">
          <div className="empty-state">
            选择一个会话查看详细信息
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="project-info">
      <div className="project-info-header">
        <h3>会话信息</h3>
      </div>

      <div className="project-info-content">
        <div className="info-section">
          <div className="info-item">
            <span className="info-label">Agent</span>
            <span className="info-value">{getAgentName(session.agent)}</span>
          </div>

          <div className="info-item">
            <span className="info-label">会话 ID</span>
            <span className="info-value" title={session.session_id}>
              {session.session_id.slice(0, 16)}...
            </span>
          </div>

          {session.project && (
            <div className="info-item">
              <span className="info-label">项目</span>
              <span className="info-value" title={session.project}>
                {session.project.split('\\').pop() || session.project}
              </span>
            </div>
          )}

          <div className="info-item">
            <span className="info-label">状态</span>
            <span className="info-value">{getStatusText(session.status)}</span>
          </div>

          {session.message_count !== undefined && (
            <div className="info-item">
              <span className="info-label">消息数</span>
              <span className="info-value">{session.message_count}</span>
            </div>
          )}

          {session.started_at && (
            <div className="info-item">
              <span className="info-label">开始时间</span>
              <span className="info-value">{formatTime(session.started_at)}</span>
            </div>
          )}

          {session.updated_at && (
            <div className="info-item">
              <span className="info-label">更新时间</span>
              <span className="info-value">{formatTime(session.updated_at)}</span>
            </div>
          )}
        </div>

        <div className="info-section">
          <h4>快捷操作</h4>
          <div className="action-buttons">
            <button className="action-button">
              📋 复制会话 ID
            </button>
            <button className="action-button">
              🔍 搜索会话内容
            </button>
            <button className="action-button">
              📤 导出会话
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ProjectInfo
