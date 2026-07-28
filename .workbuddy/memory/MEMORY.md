# Agent Hub 项目长期记忆

## 架构决策

### 中间区域：保留终端，不做原生聊天 UI（2026-07-28）
- 中间区域保持 xterm.js 终端 + PTY（spawn `claude --resume` / `mimo --session` / `kimi --session`）
- 不改造为 Codex/WorkBuddy 式原生聊天气泡 + 输入框
- 理由：agent-hub 定位是统一管理 CLI agent 会话，CLI 的工具调用/流式/交互确认能力都在终端里；气泡 UI 会丢能力，直连 API 成本高且 Kimi/MiMo 无公开 API
- 待做：左侧会话列表加"运行中"动态状态图标（需 Rust 端 PTY 进程状态跟踪 + 前端 Sidebar 联动）

## 项目约定
- AGENTS.md 规定：不要自己启动（dev/build），让用户手动
- 参考项目：D:\CODE\AICode\nezha-main、C:\code\github\sidex-main
- 技术栈：Tauri 1.x + React 18 + TypeScript + Vite；终端 @xterm/xterm 6.0 + portable-pty
- 三栏布局：左侧会话列表(Sidebar) / 中间标签页终端(TerminalTabs+EmbeddedTerminal) / 右侧文件列表(FilePanel)
