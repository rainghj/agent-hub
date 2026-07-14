import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import type { AgentProfile } from '../types/agent'

const isTauri = typeof window !== 'undefined' && window.__TAURI__

const defaultProfiles: AgentProfile[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    args_template: ['--resume', '{session_id}'],
    data_dir: '~/.claude',
    parser: 'claude',
    icon_color: '#cc785c',
  },
  {
    id: 'mimo',
    name: 'MiMo Code',
    command: 'mimo',
    args_template: ['--session', '{session_id}'],
    data_dir: '~/.local/share/mimocode',
    parser: 'mimo',
    icon_color: '#4f8cf7',
  },
  {
    id: 'kimi',
    name: 'Kimi Code',
    command: 'kimi',
    args_template: ['--session', '{session_id}'],
    data_dir: '~/.kimi-code',
    parser: 'kimi',
    icon_color: '#10b981',
  },
]

export function useAgentProfiles() {
  const [profiles, setProfiles] = useState<AgentProfile[]>(defaultProfiles)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isTauri) {
      setLoading(false)
      return
    }

    invoke<AgentProfile[]>('get_agent_profiles')
      .then((data) => {
        if (data && data.length > 0) {
          setProfiles(data)
        }
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load agent profiles:', err)
        setError(String(err))
        setLoading(false)
      })
  }, [])

  const profileById = (id: string) => profiles.find((p) => p.id === id)

  return { profiles, profileById, loading, error }
}
