import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import './EmbeddedTerminal.css'

const isTauri = typeof window !== 'undefined' && window.__TAURI__

interface EmbeddedTerminalProps {
  type: 'shell' | 'session'
  agent?: string
  sessionId?: string
  shellId?: string
  projectPath: string
}

function EmbeddedTerminal({
  type,
  agent,
  sessionId,
  shellId,
  projectPath,
}: EmbeddedTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const terminalInstance = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const terminalIdRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  const disposedRef = useRef(false)
  const [isConnected, setIsConnected] = useState(false)

  const displayTerminalId = type === 'shell' ? shellId : `${agent}_${sessionId?.slice(0, 8)}`

  // ── 搜索状态 ──
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false)
  const [searchWholeWord, setSearchWholeWord] = useState(false)
  const [searchRegex, setSearchRegex] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const terminalElRef = useRef<HTMLDivElement>(null)

  const doSearch = (query: string) => {
    const addon = searchAddonRef.current
    if (!addon) return
    if (!query) {
      addon.findNext('', { caseSensitive: false, wholeWord: false, regex: false })
      return
    }
    addon.findNext(query, {
      caseSensitive: searchCaseSensitive,
      wholeWord: searchWholeWord,
      regex: searchRegex,
    })
  }

  useEffect(() => {
    if (!terminalRef.current) return
    if (!terminalRef.current) return

    mountedRef.current = true
    disposedRef.current = false

    const container = terminalRef.current
    // 确保容器有明确尺寸，避免 xterm 初始化时 dimensions 为 undefined
    container.style.width = '100%'
    container.style.height = '100%'

    const terminal = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#ffffff',
        selectionBackground: '#264f78',
      },
      fontFamily: 'Consolas, "Cascadia Code", "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorStyle: 'bar',
      cursorWidth: 2,
      cursorBlink: true,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    const webglAddon = new WebglAddon()
    const searchAddon = new SearchAddon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)
    // 临时禁用 WebGL 渲染器，排查 cursor 残影是否由 WebGL 层引起
    // WebGL addon 可能在某些 GPU/驱动上失败，静默回退到 Canvas
    /*
    try {
      terminal.loadAddon(webglAddon)
    } catch {
      console.warn('[Terminal] WebGL addon failed to load, falling back to canvas renderer')
    }
    */
    terminal.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon

    let initTimeoutId: number | null = null
    let ptyPromise: Promise<void> = Promise.resolve()

    // 处理窗口大小变化
    const handleResize = () => {
      if (disposedRef.current) return
      fitAddon.fit()
      const id = terminalIdRef.current
      if (id && isTauri) {
        resizePty(id, terminal.cols, terminal.rows)
      }
    }
    window.addEventListener('resize', handleResize)

    // 处理终端输入（与 VS Code / Sidex 一致：直接走 xterm 内置 onData，不做额外 IME 拦截）
    const sendInput = async (data: string) => {
      const id = terminalIdRef.current
      if (id && isTauri) {
        try {
          const { invoke } = await import('@tauri-apps/api/tauri')
          await invoke('send_to_terminal', {
            terminalId: id,
            input: data,
          })
        } catch (err) {
          console.error('Failed to send input:', err)
        }
      }
    }
    const inputDisposable = terminal.onData(sendInput)

    // 等容器有非零尺寸后再 open xterm，避免 RenderService dimensions 报错
    let hasOpened = false
    const doOpen = () => {
      if (disposedRef.current || !mountedRef.current || hasOpened) return
      hasOpened = true
      terminal.open(container)
      fitAddon.fit()
      fitAddonRef.current = fitAddon
      terminalInstance.current = terminal
      ptyPromise = startPtyTerminal(terminal, fitAddon)

      // Ctrl+Shift+F 打开搜索
      terminal.attachCustomKeyEventHandler((e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'f') {
          setSearchVisible(true)
          setTimeout(() => searchInputRef.current?.focus(), 50)
          return false
        }
        if (e.key === 'Escape' && searchVisible) {
          setSearchVisible(false)
          setSearchQuery('')
          return false
        }
        return true
      })
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) {
        if (!hasOpened) {
          doOpen()
        } else if (terminalInstance.current && fitAddonRef.current) {
          // 从 display:none 切换回来时重新适配尺寸
          fitAddonRef.current.fit()
        }
      }
    })
    resizeObserver.observe(container)

    if (container.clientWidth > 0 && container.clientHeight > 0) {
      doOpen()
    }
    // 兜底：最多等 500ms
    initTimeoutId = window.setTimeout(() => {
      doOpen()
    }, 500)

    // 窗口重新获得焦点或页面可见时，强制刷新整个 viewport，清除切换窗口可能留下的残影
    const handleFocusRefresh = () => {
      if (disposedRef.current || !terminalInstance.current) return
      terminalInstance.current.refresh(0, terminalInstance.current.rows - 1)
    }
    window.addEventListener('focus', handleFocusRefresh)
    document.addEventListener('visibilitychange', handleFocusRefresh)

    return () => {
      mountedRef.current = false
      disposedRef.current = true
      resizeObserver.disconnect()
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('focus', handleFocusRefresh)
      document.removeEventListener('visibilitychange', handleFocusRefresh)
      inputDisposable.dispose()
      if (initTimeoutId !== null) {
        window.clearTimeout(initTimeoutId)
      }
      terminalInstance.current = null
      terminal.dispose()
      // 关闭 PTY：等待启动完成后再关闭，确保不泄漏
      ptyPromise.then(() => {
        if (terminalIdRef.current) {
          closeTerminal()
          terminalIdRef.current = null
        }
      })
    }
  }, [type, agent, sessionId, shellId, projectPath])

  // 监听 PTY 输出事件
  useEffect(() => {
    if (!isTauri || !terminalInstance.current) return

    let unlisten: (() => void) | null = null

    const setupListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        unlisten = await listen<{ terminal_id: string; data: string }>(
          'terminal-output',
          (event) => {
            if (
              event.payload.terminal_id === terminalIdRef.current &&
              terminalInstance.current &&
              !disposedRef.current
            ) {
              terminalInstance.current.write(event.payload.data)
            }
          },
        )
      } catch (err) {
        console.error('Failed to setup terminal listener:', err)
      }
    }

    setupListener()

    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  }, [])

  const startPtyTerminal = async (terminal: Terminal, fitAddon: FitAddon) => {
    if (!isTauri) {
      showDemoMode(terminal)
      return
    }

    try {
      const { invoke } = await import('@tauri-apps/api/tauri')
      fitAddon.fit()

      let id: string
      if (type === 'shell') {
        id = await invoke<string>('spawn_shell', {
          shellId: shellId,
          projectPath,
          cols: terminal.cols,
          rows: terminal.rows,
        })
      } else {
        id = await invoke<string>('spawn_terminal', {
          agent,
          sessionId,
          projectPath,
          cols: terminal.cols,
          rows: terminal.rows,
        })
      }

      if (!mountedRef.current) {
        // 组件已卸载，关闭刚创建的 PTY
        await invoke('close_terminal', { terminalId: id })
        return
      }

      terminalIdRef.current = id
      setIsConnected(true)
    } catch (err) {
      terminal.writeln(`\x1b[31m连接失败: ${err}\x1b[0m`)
      terminal.writeln('')
      showDemoMode(terminal)
    }
  }

  const resizePty = async (id: string, cols: number, rows: number) => {
    if (isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri')
        await invoke('resize_terminal', {
          terminalId: id,
          cols,
          rows,
        })
      } catch (err) {
        console.error('Failed to resize PTY:', err)
      }
    }
  }

  const closeTerminal = async () => {
    const id = terminalIdRef.current
    if (id && isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri')
        await invoke('close_terminal', { terminalId: id })
      } catch (err) {
        console.error('Failed to close terminal:', err)
      }
    }
  }

  const showDemoMode = (terminal: Terminal) => {
    terminal.writeln('\x1b[1;36m╔══════════════════════════════════════════╗\x1b[0m')
    terminal.writeln('\x1b[1;36m║           Agent Hub Terminal            ║\x1b[0m')
    terminal.writeln('\x1b[1;36m╚══════════════════════════════════════════╝\x1b[0m')
    terminal.writeln('')
    terminal.writeln(`\x1b[33m类型:\x1b[0m ${type === 'shell' ? '空终端' : agent}`)
    terminal.writeln(`\x1b[33m目录:\x1b[0m ${projectPath}`)
    if (type === 'session') {
      terminal.writeln(`\x1b[33m会话:\x1b[0m ${sessionId}`)
    }
    terminal.writeln('')
    terminal.writeln('\x1b[90m注意: 当前为演示模式。需要在 Tauri 环境中运行。\x1b[0m')
  }

  return (
    <div className="embedded-terminal" ref={terminalElRef}>
      {searchVisible && (
        <div className="terminal-search-bar">
          <input
            ref={searchInputRef}
            className="terminal-search-input"
            type="text"
            placeholder="搜索..."
            value={searchQuery}
            onChange={(e) => {
              const q = e.target.value
              setSearchQuery(q)
              doSearch(q)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                doSearch(searchQuery)
              }
              if (e.key === 'Escape') {
                setSearchVisible(false)
                setSearchQuery('')
                terminalInstance.current?.focus()
              }
            }}
          />
          <button
            className={`terminal-search-option ${searchCaseSensitive ? 'active' : ''}`}
            onClick={() => setSearchCaseSensitive(!searchCaseSensitive)}
            title="区分大小写"
          >
            Aa
          </button>
          <button
            className={`terminal-search-option ${searchRegex ? 'active' : ''}`}
            onClick={() => setSearchRegex(!searchRegex)}
            title="正则表达式"
          >
            .*
          </button>
          <button
            className="terminal-search-close"
            onClick={() => {
              setSearchVisible(false)
              setSearchQuery('')
              terminalInstance.current?.focus()
            }}
          >
            ✕
          </button>
        </div>
      )}
      <div className="terminal-body" ref={terminalRef} />
    </div>
  )
}

export default EmbeddedTerminal
