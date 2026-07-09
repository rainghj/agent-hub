import type { TerminalTab } from '../App'
import EmbeddedTerminal from './EmbeddedTerminal'
import './TerminalTabs.css'

interface TerminalTabsProps {
  tabs: TerminalTab[]
  activeTabId: string | null
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
}

function TerminalTabs({ tabs, activeTabId, onSelectTab, onCloseTab }: TerminalTabsProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId)

  return (
    <div className="terminal-tabs-container">
      {tabs.length > 0 && (
        <div className="terminal-tabs-bar">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`terminal-tab ${tab.id === activeTabId ? 'active' : ''}`}
              onClick={() => onSelectTab(tab.id)}
            >
              <span className="terminal-tab-icon">{tab.type === 'shell' ? '⌨' : '▶'}</span>
              <span className="terminal-tab-title">{tab.title}</span>
              <button
                className="terminal-tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(tab.id)
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="terminal-tabs-content">
        {tabs.length > 0 ? (
          tabs.map((tab) => (
            <div
              key={tab.id}
              className={`terminal-tab-panel ${tab.id === activeTabId ? 'active' : ''}`}
            >
              <EmbeddedTerminal
                type={tab.type}
                agent={tab.agent}
                sessionId={tab.sessionId}
                shellId={tab.id}
                projectPath={tab.projectPath}
              />
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
