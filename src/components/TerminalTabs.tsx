import type { TerminalTab } from '../App'
import EmbeddedTerminal from './EmbeddedTerminal'
import FileViewer from './FileViewer'
import './TerminalTabs.css'

interface TerminalTabsProps {
  tabs: TerminalTab[]
  activeTabId: string | null
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void | Promise<void>
  onSetTabDirty?: (tabId: string, isDirty: boolean, content: string) => void
  onNewShell?: () => void
}

function TerminalTabs({ tabs, activeTabId, onSelectTab, onCloseTab, onSetTabDirty, onNewShell }: TerminalTabsProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId)

  return (
    <div className="terminal-tabs-container">
      <div className="terminal-tabs-bar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`terminal-tab ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => onSelectTab(tab.id)}
          >
            <span className="terminal-tab-icon">
              {tab.type === 'shell' ? '⌨' : tab.type === 'file' ? '📄' : '▶'}
            </span>
            <span className="terminal-tab-title">
              {tab.title}
              {tab.isDirty && <span className="terminal-tab-dirty" />}
            </span>
            <button
              className="terminal-tab-close"
              onClick={async (e) => {
                e.stopPropagation()
                await onCloseTab(tab.id)
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="terminal-tab-new"
          title="新建空终端"
          onClick={() => onNewShell?.()}
        >
          +
        </button>
      </div>

      <div className="terminal-tabs-content">
        {tabs.length > 0 ? (
          tabs.map((tab) => (
            <div
              key={tab.id}
              className={`terminal-tab-panel ${tab.id === activeTabId ? 'active' : ''}`}
            >
              {tab.type === 'file' && tab.filePath ? (
                <FileViewer
                  tabId={tab.id}
                  filePath={tab.filePath}
                  onDirtyChange={onSetTabDirty}
                />
              ) : tab.type !== 'file' ? (
                <EmbeddedTerminal
                  type={tab.type}
                  agent={tab.agent}
                  sessionId={tab.sessionId}
                  shellId={tab.id}
                  projectPath={tab.projectPath}
                />
              ) : null}
            </div>
          ))
        ) : (
          <div className="terminal-empty">
            <div className="terminal-empty-icon">⌨</div>
            <div className="terminal-empty-text">
              选择一个目录，新建空终端或打开已有会话
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default TerminalTabs
