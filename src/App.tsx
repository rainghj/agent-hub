import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import ProjectInfo from './components/ProjectInfo'
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

interface Message {
  role: string
  content: string
  timestamp?: string
}

function App() {
  const [projects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (selectedProject || selectedSession) {
      loadSessions()
    }
  }, [selectedProject, selectedSession])

  useEffect(() => {
    if (selectedSession) {
      loadMessages()
    }
  }, [selectedSession])

  const loadData = async () => {
    try {
      setLoading(true)

      if (isTauri) {
        // Tauri 环境：调用后端 API
        const { invoke } = await import('@tauri-apps/api/tauri')
        const projectsData = await invoke<Project[]>('get_projects')
        setProjects(projectsData)

        const sessionsData = await invoke<Session[]>('get_sessions', {})
        setSessions(sessionsData)

        if (sessionsData.length > 0) {
          setSelectedSession(sessionsData[0])
        }
      } else {
        // 浏览器环境：使用模拟数据
        setSessions(mockSessions)
        if (mockSessions.length > 0) {
          setSelectedSession(mockSessions[0])
        }
      }
    } catch (err) {
      console.error('Error loading data:', err)
      // 使用模拟数据作为后备
      setSessions(mockSessions)
      if (mockSessions.length > 0) {
        setSelectedSession(mockSessions[0])
      }
    } finally {
      setLoading(false)
    }
  }

  const loadSessions = async () => {
    try {
      if (isTauri) {
        const { invoke } = await import('@tauri-apps/api/tauri')
        const sessionsData = await invoke<Session[]>('get_sessions', {
          project: selectedProject,
          agent: selectedSession?.agent
        })
        setSessions(sessionsData)
      }
    } catch (err) {
      console.error('Error loading sessions:', err)
    }
  }

  const loadMessages = async () => {
    if (!selectedSession) return

    try {
      if (isTauri) {
        const { invoke } = await import('@tauri-apps/api/tauri')
        const messagesData = await invoke<Message[]>('get_messages', {
          sessionId: selectedSession.session_id,
          agent: selectedSession.agent
        })
        setMessages(messagesData)
      } else {
        // 浏览器环境：模拟消息
        setMessages([
          { role: 'user', content: selectedSession.title || '测试消息' },
          { role: 'assistant', content: '这是模拟的回复内容。在 Tauri 环境中，这里会显示真实的会话内容。' }
        ])
      }
    } catch (err) {
      console.error('Error loading messages:', err)
    }
  }

  const handleSessionSelect = (session: Session) => {
    setSelectedSession(session)
    setSelectedProject(session.project || null)
  }

  if (loading) {
    return <div className="loading">加载中...</div>
  }

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        sessions={sessions}
        selectedSession={selectedSession}
        onSelectSession={handleSessionSelect}
        onSelectProject={setSelectedProject}
      />
      <ChatView
        session={selectedSession}
        messages={messages}
      />
      <ProjectInfo
        session={selectedSession}
      />
    </div>
  )
}

export default App
