import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import Editor from 'react-simple-code-editor'
import Prism from 'prismjs'

// 按需加载常用语言高亮（注意：有依赖关系的语言必须按顺序加载）

// 基础核心
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-markup-templating'
import 'prismjs/components/prism-css'

// Web 前端
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-markdown'

// 脚本与配置
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-powershell'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-toml'
import 'prismjs/components/prism-ini'
import 'prismjs/components/prism-diff'

// 后端与编译型语言
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-c'
import 'prismjs/components/prism-cpp'
import 'prismjs/components/prism-csharp'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-swift'
import 'prismjs/components/prism-kotlin'
import 'prismjs/components/prism-php'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-graphql'
import 'prismjs/components/prism-docker'
import 'prismjs/components/prism-nginx'
import 'prismjs/components/prism-lua'
import 'prismjs/components/prism-dart'
import 'prismjs/components/prism-regex'
import 'prismjs/components/prism-csv'

import 'prismjs/themes/prism-tomorrow.css'
import './FileViewer.css'

interface FileViewerProps {
  tabId: string
  filePath: string
  onDirtyChange?: (tabId: string, isDirty: boolean, content: string) => void
}

const languageMap: Record<string, string> = {
  json: 'json',
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  css: 'css',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  md: 'markdown',
  markdown: 'markdown',
  rs: 'rust',
  py: 'python',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  ps1: 'powershell',
  ps: 'powershell',
  // 更多常用语言
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  go: 'go',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  php: 'php',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'docker',
  nginx: 'nginx',
  conf: 'nginx',
  lua: 'lua',
  dart: 'dart',
  vue: 'markup',
  svelte: 'markup',
  regex: 'regex',
  ini: 'ini',
  cfg: 'ini',
  diff: 'diff',
  patch: 'diff',
  csv: 'csv',
}

function getLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return languageMap[ext] || 'plaintext'
}

function FileViewer({ tabId, filePath, onDirtyChange }: FileViewerProps) {
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)

  const language = useMemo(() => getLanguage(filePath), [filePath])

  // 加载文件内容
  useEffect(() => {
    let cancelled = false

    const loadContent = async () => {
      setLoading(true)
      setError(null)
      setContent('')
      setOriginalContent('')

      try {
        const isTauri = typeof window !== 'undefined' && window.__TAURI__
        if (isTauri) {
          const { invoke } = await import('@tauri-apps/api/tauri')
          const data = await invoke<string>('read_file', { path: filePath })
          if (!cancelled) {
            setContent(data)
            setOriginalContent(data)
          }
        } else {
          if (!cancelled) {
            const data = `// 模拟文件内容: ${filePath}`
            setContent(data)
            setOriginalContent(data)
          }
        }
      } catch (err) {
        if (!cancelled) setError(String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadContent()

    return () => {
      cancelled = true
    }
  }, [filePath])

  // 同步 dirty 状态和内容
  useEffect(() => {
    const isDirty = content !== originalContent
    onDirtyChange?.(tabId, isDirty, content)
  }, [content, originalContent, tabId, onDirtyChange])

  const handleChange = (newContent: string) => {
    setContent(newContent)
  }

  const highlightCode = useCallback(
    (code: string) => {
      const lang = Prism.languages[language]
      if (!lang) return code
      return Prism.highlight(code, lang, language)
    },
    [language]
  )

  const saveFile = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const isTauri = typeof window !== 'undefined' && window.__TAURI__
      if (isTauri) {
        const { invoke } = await import('@tauri-apps/api/tauri')
        await invoke('write_file', { path: filePath, content })
      }
      setOriginalContent(content)
      onDirtyChange?.(tabId, false, content)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }, [content, filePath, tabId, onDirtyChange])

  // Ctrl+S / Cmd+S 保存
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveFile()
      }
    }

    editor.addEventListener('keydown', handleKeyDown)
    return () => {
      editor.removeEventListener('keydown', handleKeyDown)
    }
  }, [saveFile])

  return (
    <div className="file-viewer">
      {saving && <div className="file-viewer-saving-indicator">保存中...</div>}
      <div className="file-viewer-content" ref={editorRef}>
        {loading && <div className="file-viewer-loading">加载中...</div>}
        {error && <div className="file-viewer-error">{error}</div>}
        {!loading && !error && (
          <Editor
            value={content}
            onValueChange={handleChange}
            highlight={highlightCode}
            padding={16}
            className="file-viewer-editor"
            textareaClassName="file-viewer-textarea"
            preClassName="file-viewer-pre"
            tabSize={2}
            insertSpaces
          />
        )}
      </div>
    </div>
  )
}

export default FileViewer
