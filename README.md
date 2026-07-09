# Agent Hub

统一管理 Claude Code / MiMo Code / Kimi Code 会话的桌面应用，内置多标签页终端与项目文件浏览器。

## 功能

- **三栏布局**：左侧目录树、中间标签页终端、右侧文件列表
- **目录树**：按项目目录聚合会话，按最近活跃时间排序
- **多标签页终端**：
  - 新建空终端：默认启动 PowerShell，进入所选目录
  - 打开已有会话：恢复 Claude / MiMo / Kimi 会话
  - 切换标签页时保持 PTY 运行，不会重启
- **文件列表**：选中目录后右侧显示该目录下的文件和文件夹
- **会话搜索**：按标题、会话 ID 或项目路径搜索
- **终端特性**：
  - 基于 xterm.js + portable-pty
  - 支持 ANSI 256 色输出
  - 中文输入法防重复输入

## 安装

### 前置要求

- Rust 1.70+
- Node.js 18+
- Windows 10/11（当前主要支持 Windows）
- Visual Studio Build Tools 2019+ 或 Visual Studio 2019+（带 C++ 桌面开发工作负载和 Windows 10 SDK）

### 开发模式

```powershell
# 克隆项目
git clone https://github.com/rainghj/agent-hub.git
cd agent-hub

# 安装前端依赖
npm install

# 启动开发模式
npm run tauri dev
```

也可以直接双击项目根目录下的 `dev.bat`。

### 打包生产版本

```powershell
npm run tauri build
```

打包产物位于：

```
src-tauri\target\release\bundle\
├── msi\Agent Hub_0.1.0_x64_en-US.msi
└── nsis\...
```

#### 离线打包（避免下载依赖）

Tauri 打包 Windows 安装包时需要 WiX Toolset 和 NSIS。如果网络不佳，可手动下载并放到对应目录：

- WiX Toolset v3.14：`%LOCALAPPDATA%\tauri\WixTools314\`
- NSIS 3：`%LOCALAPPDATA%\tauri\NSIS\`

## 项目结构

```
agent-hub/
├── src/                         # React 前端
│   ├── App.tsx                 # 主应用（目录、标签页、文件面板状态）
│   ├── main.tsx                # React 入口
│   ├── components/             # UI 组件
│   │   ├── Sidebar.tsx         # 左侧目录树 + 会话列表
│   │   ├── TerminalTabs.tsx    # 中间标签页容器
│   │   ├── EmbeddedTerminal.tsx# xterm.js 终端封装
│   │   └── FilePanel.tsx       # 右侧文件列表
│   └── agents/                 # Agent 数据解析器
├── src-tauri/                   # Rust 后端 (Tauri)
│   ├── icons/                  # 应用图标
│   └── src/
│       ├── main.rs             # Tauri 入口
│       ├── commands.rs         # Tauri 命令（spawn_shell、list_directory 等）
│       └── agents/             # Agent 数据解析器
├── dev.bat                      # 开发启动脚本
├── build.bat                    # 打包脚本
└── package.json                 # 前端依赖
```

## 支持的 Agent

| Agent | 数据目录 | 恢复命令 |
|-------|----------|----------|
| Claude Code | `~/.claude/` | `claude --resume <id>` |
| MiMo Code | `~/.local/share/mimocode/` | `mimo --session <id>` |
| Kimi Code | `~/.kimi-code/` | `kimi --session <id>` |

## 技术栈

- **后端**: Rust + Tauri 1.x
- **前端**: React 18 + TypeScript + Vite
- **终端**: @xterm/xterm 6.0 + portable-pty
- **默认 Shell**: PowerShell
- **数据**: 文件系统读取（SQLite 预留）

## 许可证

MIT
