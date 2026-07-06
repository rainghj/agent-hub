import { useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import 'xterm/css/xterm.css'
import './EmbeddedTerminal.css'

const isTauri = typeof window !== 'undefined' && window.__TAURI__

interface EmbeddedTerminalProps {
  agent: string
  sessionId: string
  onClose: () => void
}

function EmbeddedTerminal({ agent, sessionId, onClose }: EmbeddedTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const terminalInstance = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (!terminalRef.current) return

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
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)

    terminal.open(terminalRef.current)
    fitAddon.fit()
    fitAddonRef.current = fitAddon

    terminalInstance.current = terminal

    // 启动 PTY 终端
    startPtyTerminal(terminal, fitAddon)

    // 处理窗口大小变化
    const handleResize = () => {
      fitAddon.fit()
      // 通知后端调整 PTY 大小
      if (terminalId && isTauri) {
        resizePty(terminal.cols, terminal.rows)
      }
    }
    window.addEventListener('resize', handleResize)

    // 处理终端输入
    const inputDisposable = terminal.onData(async (data) => {
      if (terminalId && isTauri) {
        try {
          const { invoke } = await import('@tauri-apps/api/tauri')
          await invoke('send_to_terminal', {
            terminalId,
            input: data,
          })
        } catch (err) {
          console.error('Failed to send input:', err)
        }
      }
    })

    return () => {
      window.removeEventListener('resize', handleResize)
      inputDisposable.dispose()
      terminal.dispose()
      if (terminalId) {
        closeTerminal()
      }
    }
  }, [agent, sessionId])

  // 监听 PTY 输出事件
  useEffect(() => {
    if (!isTauri || !terminalInstance.current) return

    let unlisten: (() => void) | null = null

    const setupListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        unlisten = await listen<string>('terminal-output', (event) => {
          if (terminalInstance.current) {
            terminalInstance.current.write(event.payload)
          }
        })
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
  }, [terminalId])

  const startPtyTerminal = async (terminal: Terminal, fitAddon: FitAddon) => {
    if (isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri')
        fitAddon.fit()
        const id = await invoke<string>('spawn_terminal', {
          agent,
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        })
        setTerminalId(id)
        setIsConnected(true)
      } catch (err) {
        terminal.writeln(`\x1b[31m连接失败: ${err}\x1b[0m`)
        terminal.writeln('')
        showDemoMode(terminal)
      }
    } else {
      showDemoMode(terminal)
    }
  }

  const resizePty = async (cols: number, rows: number) => {
    if (terminalId && isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri')
        await invoke('resize_terminal', {
          terminalId,
          cols,
          rows,
        })
      } catch (err) {
        console.error('Failed to resize PTY:', err)
      }
    }
  }

  const showDemoMode = (terminal: Terminal) => {
    terminal.writeln('\x1b[1;36m╔══════════════════════════════════════════╗\x1b[0m')
    terminal.writeln('\x1b[1;36m║           Agent Hub Terminal            ║\x1b[0m')
    terminal.writeln('\x1b[1;36m╚══════════════════════════════════════════╝\x1b[0m')
    terminal.writeln('')
    terminal.writeln(`\x1b[33mAgent:\x1b[0m ${agent}`)
    terminal.writeln(`\x1b[33mSession:\x1b[0m ${sessionId}`)
    terminal.writeln('')
    const cmd = getAgentCommand(agent, sessionId)
    terminal.writeln(`\x1b[32m$\x1b[0m ${cmd}`)
    terminal.writeln('')
    terminal.writeln('\x1b[90m注意: 当前为演示模式。需要在 Tauri 环境中运行。\x1b[0m')
  }

  const closeTerminal = async () => {
    if (terminalId && isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri')
        await invoke('close_terminal', { terminalId })
      } catch (err) {
        console.error('Failed to close terminal:', err)
      }
    }
  }

  const getAgentCommand = (agent: string, sessionId: string) => {
    switch (agent) {
      case 'claude': return `claude --resume ${sessionId}`
      case 'mimo': return `mimo --session ${sessionId}`
      case 'kimi': return `kimi --session ${sessionId}`
      default: return `# Unknown agent: ${agent}`
    }
  }

  return (
    <div className="embedded-terminal">
      <div className="terminal-header">
        <div className="terminal-tabs">
          <div className={`terminal-tab active ${isConnected ? 'connected' : ''}`}>
            <span className="terminal-tab-icon">▶</span>
            <span>{agent} - {sessionId.slice(0, 12)}...</span>
            {isConnected && <span className="connected-dot"></span>}
          </div>
        </div>
        <button className="terminal-close" onClick={onClose}>✕</button>
      </div>
      <div className="terminal-body" ref={terminalRef} />
    </div>
  )
}

export default EmbeddedTerminal
