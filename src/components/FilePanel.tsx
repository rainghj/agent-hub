import { useEffect, useState, useCallback } from 'react'
import { FolderIcon, FileIcon, ChevronRightIcon, ChevronDownIcon } from './Icons'
import './FilePanel.css'

interface DirEntry {
  name: string
  is_dir: boolean
  size: number
}

interface FilePanelProps {
  projectPath: string | null
  onOpenFile?: (filePath: string) => void
  expandedDirs: Set<string>
  onExpandedDirsChange: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void
}

const isTauri = typeof window !== 'undefined' && window.__TAURI__

function FilePanel({ projectPath, onOpenFile, expandedDirs, onExpandedDirsChange }: FilePanelProps) {
  const [dirEntries, setDirEntries] = useState<Map<string, DirEntry[]>>(new Map())
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectPath || projectPath === '未分类') {
      onExpandedDirsChange(new Set())
      setDirEntries(new Map())
      setError(null)
      return
    }

    const loadRoot = async () => {
      setError(null)
      const entries = await fetchDirEntries(projectPath)
      if (entries) {
        setDirEntries((prev) => {
          const next = new Map(prev)
          next.set(projectPath, entries)
          return next
        })
        onExpandedDirsChange((prev: Set<string>) => new Set(prev).add(projectPath))
      }
    }

    loadRoot()
  }, [projectPath])

  const fetchDirEntries = async (path: string): Promise<DirEntry[] | null> => {
    try {
      if (isTauri) {
        const { invoke } = await import('@tauri-apps/api/tauri')
        return await invoke<DirEntry[]>('list_directory', { path })
      } else {
        return [
          { name: 'README.md', is_dir: false, size: 2048 },
          { name: 'src', is_dir: true, size: 0 },
          { name: 'package.json', is_dir: false, size: 1024 },
        ]
      }
    } catch (err) {
      console.error('Failed to load directory:', err)
      setError(String(err))
      return null
    }
  }

  const toggleDir = useCallback(async (path: string) => {
    if (!projectPath) return

    const isExpanded = expandedDirs.has(path)

    if (isExpanded) {
      const next = new Set(expandedDirs)
      next.delete(path)
      onExpandedDirsChange(next)
      return
    }

    if (!dirEntries.has(path)) {
      setLoadingDirs((prev) => {
        const next = new Set(prev)
        next.add(path)
        return next
      })
      const entries = await fetchDirEntries(path)
      setLoadingDirs((prev) => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
      if (entries) {
        setDirEntries((prev) => {
          const next = new Map(prev)
          next.set(path, entries)
          return next
        })
      }
    }

    onExpandedDirsChange(new Set(expandedDirs).add(path))
  }, [expandedDirs, dirEntries, projectPath, onExpandedDirsChange])

  const handleFileClick = useCallback((filePath: string) => {
    onOpenFile?.(filePath)
  }, [onOpenFile])

  const projectName = projectPath
    ? projectPath.split('\\').pop() || projectPath.split('/').pop() || projectPath
    : ''

  if (!projectPath) {
    return (
      <div className="file-panel">
        <div className="file-panel-header">
          <span className="file-panel-title">文件</span>
        </div>
        <div className="file-panel-empty">选择一个目录查看文件</div>
      </div>
    )
  }

  const rootEntries = dirEntries.get(projectPath) || []

  return (
    <div className="file-panel">
      <div className="file-panel-header">
        <span className="file-panel-title">文件</span>
        <span className="file-panel-path" title={projectPath}>{projectName}</span>
      </div>
      <div className="file-panel-content">
        {error && <div className="file-panel-error">{error}</div>}
        <div className="file-tree">
          {rootEntries.length === 0 ? (
            <div className="file-panel-empty">空目录</div>
          ) : (
            rootEntries.map((entry) => (
              <TreeNode
                key={`${projectPath}\\${entry.name}`}
                path={`${projectPath}\\${entry.name}`}
                entry={entry}
                depth={0}
                expandedDirs={expandedDirs}
                dirEntries={dirEntries}
                loadingDirs={loadingDirs}
                onToggleDir={toggleDir}
                onOpenFile={handleFileClick}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

interface TreeNodeProps {
  path: string
  entry: DirEntry
  depth: number
  expandedDirs: Set<string>
  dirEntries: Map<string, DirEntry[]>
  loadingDirs: Set<string>
  onToggleDir: (path: string) => void
  onOpenFile: (filePath: string) => void
}

function TreeNode({
  path,
  entry,
  depth,
  expandedDirs,
  dirEntries,
  loadingDirs,
  onToggleDir,
  onOpenFile,
}: TreeNodeProps) {
  const isExpanded = expandedDirs.has(path)
  const isLoading = loadingDirs.has(path)
  const children = dirEntries.get(path)

  const handleClick = () => {
    if (entry.is_dir) {
      onToggleDir(path)
    } else {
      onOpenFile(path)
    }
  }

  return (
    <div className="file-tree-node-wrapper">
      <div
        className={`file-tree-row ${entry.is_dir ? 'is-dir' : 'is-file'}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={handleClick}
      >
        {entry.is_dir ? (
          <span className="file-tree-toggle">
            {isLoading ? (
              <span className="file-tree-toggle-loading">◌</span>
            ) : isExpanded ? (
              <ChevronDownIcon size={10} />
            ) : (
              <ChevronRightIcon size={10} />
            )}
          </span>
        ) : (
          <span className="file-tree-toggle-placeholder" />
        )}
        <span className="file-tree-icon">
          {entry.is_dir ? (
            <FolderIcon size={14} style={{ color: '#A1A1AA' }} />
          ) : (
            <FileIcon size={14} style={{ color: '#A1A1AA' }} />
          )}
        </span>
        <span className="file-tree-name">{entry.name}</span>
      </div>
      {entry.is_dir && isExpanded && children && (
        <div className="file-tree-children">
          {children.map((child) => (
            <TreeNode
              key={`${path}\\${child.name}`}
              path={`${path}\\${child.name}`}
              entry={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              dirEntries={dirEntries}
              loadingDirs={loadingDirs}
              onToggleDir={onToggleDir}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default FilePanel