import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import './EmbeddedTerminal.css'

const isTauri = typeof window !== 'undefined' && window.__TAURI__

/**
 * 修复 xterm.js 在 WebView 中中文输入法重复输入的问题。
 * 在 composition 期间屏蔽 term.onData，只在 compositionend 时发送最终文本，
 * 并跳过 compositionend 后 xterm 可能再次触发的相同 onData。
 */
function attachIMEFix(
  term: Terminal,
  onDataCallback: (data: string) => void
): { dispose: () => void } {
  const textarea = term.textarea
  if (!textarea) {
    const disposable = term.onData(onDataCallback)
    return { dispose: () => disposable.dispose() }
  }

  let isComposing = false
  let compositionText = ''
  let justEndedComposition = false
  let lastCompositionText = ''

  const sendText = (text: string | null | undefined) => {
    if (!text) return
    onDataCallback(text)
  }

  const handleCompositionStart = (event: CompositionEvent) => {
    isComposing = true
    compositionText = ''
    textarea.value = ''
    event.stopImmediatePropagation()
  }

  const handleCompositionUpdate = (event: CompositionEvent) => {
    compositionText = event.data ?? ''
    event.stopImmediatePropagation()
  }

  const handleCompositionEnd = (event: CompositionEvent) => {
    const text = event.data || compositionText
    isComposing = false
    compositionText = ''
    textarea.value = ''
    event.stopImmediatePropagation()
    lastCompositionText = text
    justEndedComposition = true
    sendText(text)
    // 下一帧清除标志，避免阻塞后续正常输入
    window.requestAnimationFrame(() => {
      justEndedComposition = false
      lastCompositionText = ''
    })
  }

  const handleBeforeInput = (event: InputEvent) => {
    if (event.inputType === 'insertCompositionText') {
      compositionText = event.data ?? compositionText
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (isComposing) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.keyCode === 229 || isComposing) {
      event.stopImmediatePropagation()
    }
  }

  const disposable = term.onData((data) => {
    if (justEndedComposition && data === lastCompositionText) {
      return
    }
    onDataCallback(data)
  })

  textarea.addEventListener('compositionstart', handleCompositionStart, true)
  textarea.addEventListener('compositionupdate', handleCompositionUpdate, true)
  textarea.addEventListener('compositionend', handleCompositionEnd, true)
  textarea.addEventListener('beforeinput', handleBeforeInput, true)
  textarea.addEventListener('keydown', handleKeyDown, true)

  return {
    dispose: () => {
      textarea.removeEventListener('compositionstart', handleCompositionStart, true)
      textarea.removeEventListener('compositionupdate', handleCompositionUpdate, true)
      textarea.removeEventListener('compositionend', handleCompositionEnd, true)
      textarea.removeEventListener('beforeinput', handleBeforeInput, true)
      textarea.removeEventListener('keydown', handleKeyDown, true)
      disposable.dispose()
    },
  }
}

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

  useEffect(() => {
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
      cursorBlink: true,
      convertEol: true,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)

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

    // 处理终端输入（带 IME 修复）
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
    const inputDisposable = attachIMEFix(terminal, sendInput)

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

    return () => {
      mountedRef.current = false
      disposedRef.current = true
      resizeObserver.disconnect()
      window.removeEventListener('resize', handleResize)
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
    <div className="embedded-terminal">
      <div className="terminal-body" ref={terminalRef} />
    </div>
  )
}

export default EmbeddedTerminal
