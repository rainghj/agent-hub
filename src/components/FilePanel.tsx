import { useEffect, useState, useCallback } from 'react'
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
  // 每个目录路径对应的内容缓存
  const [dirEntries, setDirEntries] = useState<Map<string, DirEntry[]>>(new Map())
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  // 初始加载根目录并展开
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
      // 折叠
      const next = new Set(expandedDirs)
      next.delete(path)
      onExpandedDirsChange(next)
      return
    }

    // 展开：如果还没加载过，先加载
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

  if (!projectPath) {
    return (
      <div className="file-panel">
        <div className="file-panel-header">
          <h3>文件</h3>
        </div>
        <div className="file-panel-empty">选择一个目录查看文件</div>
      </div>
    )
  }

  const rootEntries = dirEntries.get(projectPath) || []

  return (
    <div className="file-panel">
      <div className="file-panel-header">
        <h3>文件</h3>
        <div className="file-panel-path" title={projectPath}>
          {projectPath.split('\\').pop() || projectPath.split('/').pop() || projectPath}
        </div>
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

  // 计算折叠链：如果当前目录只有一个子目录，向上折叠显示 a/b/c
  const folded = foldSingleChildChain(path, entry, dirEntries, depth)

  if (folded) {
    const [foldedPath, foldedName, foldedDepth] = folded
    return (
      <div className="file-tree-node-wrapper">
        <div
          className="file-tree-node file-tree-dir"
          style={{ paddingLeft: depth * 16 + 8 }}
        >
          <span
            className="file-tree-toggle"
            onClick={() => onToggleDir(foldedPath)}
          >
            {expandedDirs.has(foldedPath) ? '▾' : '▸'}
          </span>
          <span
            className="file-tree-icon"
            onClick={() => onToggleDir(foldedPath)}
          >
            📁
          </span>
          <span
            className="file-tree-name"
            onClick={() => onToggleDir(foldedPath)}
          >
            {foldedName}
          </span>
        </div>
        {expandedDirs.has(foldedPath) && (
          <TreeNode
            key={foldedPath}
            path={foldedPath}
            entry={{ name: foldedPath.split('\\').pop() || foldedPath, is_dir: true, size: 0 }}
            depth={foldedDepth}
            expandedDirs={expandedDirs}
            dirEntries={dirEntries}
            loadingDirs={loadingDirs}
            onToggleDir={onToggleDir}
            onOpenFile={onOpenFile}
          />
        )}
      </div>
    )
  }

  return (
    <div className="file-tree-node-wrapper">
      <div
        className={`file-tree-node ${entry.is_dir ? 'file-tree-dir' : 'file-tree-file'}`}
        style={{ paddingLeft: depth * 16 + 8 }}
      >
        {entry.is_dir ? (
          <span
            className="file-tree-toggle"
            onClick={() => onToggleDir(path)}
          >
            {isLoading ? '◌' : isExpanded ? '▾' : '▸'}
          </span>
        ) : (
          <span className="file-tree-toggle file-tree-toggle-placeholder" />
        )}
        <span
          className="file-tree-icon"
          onClick={() => {
            if (entry.is_dir) {
              onToggleDir(path)
            } else {
              onOpenFile(path)
            }
          }}
        >
          {entry.is_dir ? (isExpanded ? '📂' : '📁') : getFileIcon(entry.name)}
        </span>
        <span
          className="file-tree-name"
          onClick={() => {
            if (entry.is_dir) {
              onToggleDir(path)
            } else {
              onOpenFile(path)
            }
          }}
        >
          {entry.name}
        </span>
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

/**
 * 如果目录是单孩子链中的一环，返回折叠后的 [真实路径, 显示名, 链结束深度]。
 * 例如 src/tools/utils 折叠为 "src/tools/utils"，节点显示 src/tools/utils。
 */
function foldSingleChildChain(
  startPath: string,
  entry: DirEntry,
  dirEntries: Map<string, DirEntry[]>,
  currentDepth: number,
): [string, string, number] | null {
  if (!entry.is_dir) return null

  let currentPath = startPath
  let chainLength = 0
  const MAX_CHAIN = 5 // 最多折叠 5 层

  while (chainLength < MAX_CHAIN) {
    const kids = dirEntries.get(currentPath)
    if (!kids) return null // 未加载，不折叠

    // 筛选出目录项
    const subdirs = kids.filter((k) => k.is_dir)
    if (subdirs.length !== 1) break // 不是单孩子，停止

    const onlyChild = subdirs[0]
    const childPath = `${currentPath}\\${onlyChild.name}`

    // 如果孩子被展开了，说明用户想看到详情，停止折叠
    // 但这里我们只检查是否存在展开状态（这要求 expandedDirs 参数，此处不传，简化处理）

    currentPath = childPath
    chainLength++
  }

  if (chainLength === 0) return null

  // 计算显示名称：取链的起止节点名
  const parts = currentPath.split('\\')
  const startName = startPath.split('\\').pop() || startPath
  const endName = parts[parts.length - 1]
  const foldedName = chainLength === 1 ? `${startName}/${endName}` : `${startName}/.../${endName}`

  return [currentPath, foldedName, currentDepth + chainLength]
}

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const iconMap: Record<string, string> = {
    json: '📋',
    js: '📜',
    jsx: '⚛',
    ts: '🔷',
    tsx: '🔷',
    css: '🎨',
    html: '🌐',
    htm: '🌐',
    md: '📝',
    markdown: '📝',
    rs: '🦀',
    py: '🐍',
    toml: '⚙',
    yaml: '⚙',
    yml: '⚙',
    sh: '⌨',
    ps1: '⌨',
    exe: '⚙',
    lock: '🔒',
    java: '☕',
    c: '🔵',
    cpp: '🔵',
    h: '🔵',
    hpp: '🔵',
    cs: '🔷',
    go: '🐹',
    swift: '🐦',
    kt: '🟣',
    kts: '🟣',
    php: '🐘',
    sql: '🗃',
    graphql: '◈',
    gql: '◈',
    dockerfile: '🐳',
    nginx: '🌿',
    lua: '🌙',
    dart: '🎯',
    vue: '🟢',
    svelte: '🧡',
    ini: '⚙',
    cfg: '⚙',
    diff: '📑',
    patch: '📑',
    csv: '📊',
  }
  return iconMap[ext] || '📄'
}

export default FilePanel
