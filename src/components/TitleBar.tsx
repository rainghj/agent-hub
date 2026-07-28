import { LogoIcon, MinimizeIcon, MaximizeIcon, CloseIcon } from './Icons'
import './TitleBar.css'

const isTauri = typeof window !== 'undefined' && window.__TAURI__

function TitleBar() {
  const handleMinimize = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isTauri) return
    try {
      const { appWindow } = await import('@tauri-apps/api/window')
      await appWindow.minimize()
    } catch (err) {
      console.error('Minimize failed:', err)
    }
  }

  const handleMaximize = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isTauri) return
    try {
      const { appWindow } = await import('@tauri-apps/api/window')
      const isMaximized = await appWindow.isMaximized()
      if (isMaximized) {
        await appWindow.unmaximize()
      } else {
        await appWindow.maximize()
      }
    } catch (err) {
      console.error('Maximize failed:', err)
    }
  }

  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isTauri) return
    try {
      const { appWindow } = await import('@tauri-apps/api/window')
      await appWindow.close()
    } catch (err) {
      console.error('Close failed:', err)
    }
  }

  // 双击空白处切换最大化
  const handleDoubleClick = async () => {
    if (!isTauri) return
    try {
      const { appWindow } = await import('@tauri-apps/api/window')
      const isMaximized = await appWindow.isMaximized()
      if (isMaximized) {
        await appWindow.unmaximize()
      } else {
        await appWindow.maximize()
      }
    } catch (err) {
      console.error('Toggle maximize failed:', err)
    }
  }

  return (
    <div
      className="titlebar"
      data-tauri-drag-region
      onDoubleClick={handleDoubleClick}
    >
      <div className="titlebar-left" data-tauri-drag-region>
        <LogoIcon size={18} className="titlebar-logo" style={{ color: '#60A5FA' }} />
        <span className="titlebar-text">Agent Hub</span>
      </div>
      <div className="titlebar-right">
        <button
          className="titlebar-btn"
          onClick={handleMinimize}
          aria-label="Minimize"
          title="最小化"
        >
          <MinimizeIcon size={14} />
        </button>
        <button
          className="titlebar-btn"
          onClick={handleMaximize}
          aria-label="Maximize"
          title="最大化"
        >
          <MaximizeIcon size={14} />
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          onClick={handleClose}
          aria-label="Close"
          title="关闭"
        >
          <CloseIcon size={14} />
        </button>
      </div>
    </div>
  )
}

export default TitleBar