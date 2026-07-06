import { useEffect, useRef, useState } from 'react'
import EmbeddedTerminal from './EmbeddedTerminal'
import './ChatView.css'

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

interface Message {
  role: string
  content: string
  timestamp?: string
}

interface ChatViewProps {
  session: Session | null
  messages: Message[]
}

function ChatView({ session, messages }: ChatViewProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [showTerminal, setShowTerminal] = useState(false)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 切换会话时关闭终端
  useEffect(() => {
    setShowTerminal(false)
  }, [session?.session_id])

  const getAgentName = (agent: string) => {
    switch (agent) {
      case 'claude': return 'Claude'
      case 'mimo': return 'MiMo'
      case 'kimi': return 'Kimi'
      default: return agent
    }
  }

  const getRoleName = (role: string) => {
    switch (role) {
      case 'user': return '用户'
      case 'assistant': return '助手'
      case 'system': return '系统'
      default: return role
    }
  }

  if (!session) {
    return (
      <div className="chat-view">
        <div className="chat-empty">
          <div className="chat-empty-icon">💬</div>
          <div className="chat-empty-text">选择一个会话开始</div>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-view">
      <div className="chat-header">
        <div className="chat-title">
          {session.title || session.session_id}
        </div>
        <span className={`agent-badge ${session.agent}`}>
          {getAgentName(session.agent)}
        </span>
        <button
          className={`open-button ${showTerminal ? 'active' : ''}`}
          onClick={() => setShowTerminal(!showTerminal)}
        >
          {showTerminal ? '返回对话' : '打开终端'}
        </button>
      </div>

      {showTerminal ? (
        <EmbeddedTerminal
          agent={session.agent}
          sessionId={session.session_id}
          onClose={() => setShowTerminal(false)}
        />
      ) : (
        <div className="chat-messages">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <div className="chat-empty-icon">📭</div>
              <div className="chat-empty-text">暂无消息</div>
            </div>
          ) : (
            messages.map((message, index) => (
              <div key={index} className={`message ${message.role}`}>
                <div className="message-role">
                  {getRoleName(message.role)}
                  {message.timestamp && (
                    <span className="message-time">
                      {new Date(message.timestamp).toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="message-content">
                  {message.content}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      )}
    </div>
  )
}

export default ChatView
