# Agent Hub

统一管理 Claude Code / MiMo Code / Kimi Code 的桌面应用。

## 功能

- 三栏布局界面（类似 VSCode/Claude Code）
- 左侧：项目列表 + 会话列表（按 agent 分组）
- 中间：对话内容 / PTY 终端
- 右侧：会话信息
- 支持 Claude Code / MiMo Code / Kimi Code
- Agent 筛选按钮
- 搜索会话
- 打开终端恢复会话

## 安装

### 前置要求

- Rust 1.70+
- Node.js 18+
- MinGW-w64（Windows）

### 开发模式

```powershell
# 克隆项目
git clone https://github.com/rainghj/agent-hub.git
cd agent-hub

# 安装前端依赖
npm install

# 启动开发模式
# 方式1: 双击 dev.bat
# 方式2: 命令行
$env:PATH = "C:\Users\Administrator\.mingw64\mingw64\bin;" + $env:PATH
npx tauri dev
```

### 打包生产版本

```powershell
# 双击 build.bat 或运行
npx tauri build
```

生成的安装包在 `src-tauri\target\release\bundle\` 目录下。

## 项目结构

```
agent-hub/
├── src/                    # React 前端
│   ├── App.tsx            # 主应用
│   ├── components/        # UI 组件
│   │   ├── Sidebar.tsx    # 左侧栏
│   │   ├── ChatView.tsx   # 中间对话/终端
│   │   ├── ProjectInfo.tsx # 右侧信息
│   │   └── EmbeddedTerminal.tsx # PTY 终端
│   └── agents/            # Agent 数据解析器
├── src-tauri/              # Rust 后端 (Tauri)
│   └── src/
│       ├── main.rs        # Tauri 入口
│       ├── commands.rs    # Tauri 命令
│       └── agents/        # Agent 数据解析器
├── dev.bat                 # 开发启动脚本
├── build.bat              # 打包脚本
└── package.json           # 前端依赖
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
- **终端**: xterm.js + portable-pty
- **数据**: SQLite (rusqlite)

## 许可证

MIT
