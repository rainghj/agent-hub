import { useEffect, useState } from 'react'
import './FilePanel.css'

interface DirEntry {
  name: string
  is_dir: boolean
  size: number
}

interface FilePanelProps {
  projectPath: string | null
}

function FilePanel({ projectPath }: FilePanelProps) {
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectPath || projectPath === '未分类') {
      setEntries([])
      setError(null)
      return
    }

    const loadEntries = async () => {
      setLoading(true)
      setError(null)
      try {
        const isTauri = typeof window !== 'undefined' && window.__TAURI__
        if (isTauri) {
          const { invoke } = await import('@tauri-apps/api/tauri')
          const data = await invoke<DirEntry[]>('list_directory', { path: projectPath })
          setEntries(data)
        } else {
          // 浏览器环境模拟数据
          setEntries([
            { name: 'README.md', is_dir: false, size: 2048 },
            { name: 'src', is_dir: true, size: 0 },
            { name: 'package.json', is_dir: false, size: 1024 },
          ])
        }
      } catch (err) {
        console.error('Failed to load directory:', err)
        setError(String(err))
        setEntries([])
      } finally {
        setLoading(false)
      }
    }

    loadEntries()
  }, [projectPath])

  const formatSize = (size: number) => {
    if (size === 0) return ''
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  if (!projectPath) {
    return (
      <div className="file-panel">
        <div className="file-panel-header">
          <h3>文件列表</h3>
        </div>
        <div className="file-panel-empty">选择一个目录查看文件</div>
      </div>
    )
  }

  return (
    <div className="file-panel">
      <div className="file-panel-header">
        <h3>文件列表</h3>
        <div className="file-panel-path" title={projectPath}>
          {projectPath.split('\\').pop() || projectPath.split('/').pop() || projectPath}
        </div>
      </div>
      <div className="file-panel-content">
        {loading && <div className="file-panel-loading">加载中...</div>}
        {error && <div className="file-panel-error">{error}</div>}
        {!loading && !error && (
          <div className="file-tree">
            {entries.length === 0 ? (
              <div className="file-panel-empty">空目录</div>
            ) : (
              entries.map((entry) => (
                <div key={entry.name} className="file-item">
                  <span className="file-icon">{entry.is_dir ? '📁' : '📄'}</span>
                  <span className="file-name">{entry.name}</span>
                  <span className="file-size">{formatSize(entry.size)}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default FilePanel
