# Agent Hub (ah)

统一管理 Claude Code / MiMo Code / Kimi Code 的 CLI 工具。

## 安装

```powershell
# 克隆项目
git clone <repo-url> C:\code\agent-hub
cd C:\code\agent-hub

# 编译
$env:PATH = "C:\Users\Administrator\.mingw64\mingw64\bin;" + $env:PATH
cargo build --release --target x86_64-pc-windows-gnu

# 添加到 PATH（仅需执行一次）
$ahPath = "C:\code\agent-hub\target\x86_64-pc-windows-gnu\release"
$currentPath = [System.Environment]::GetEnvironmentVariable("PATH", "User")
[System.Environment]::SetEnvironmentVariable("PATH", "$ahPath;$currentPath", "User")
```

## 使用

```powershell
# 查看所有 agent 状态
ah status

# 查看历史会话
ah history
ah history --agent claude
ah history --project code
ah history --search "关键词"

# 查看会话详情
ah show <session-id>

# 跨 agent 搜索
ah search "关键词"

# 统一记忆管理
ah memory list
ah memory search "关键词"
ah memory add "内容"
ah memory sync
```

## 命令说明

| 命令 | 说明 |
|------|------|
| `ah status` | 显示所有 agent 的活跃会话状态表格 |
| `ah history` | 列出历史会话，支持按 agent、项目、关键词过滤 |
| `ah show <id>` | 显示指定会话的完整对话内容 |
| `ah search <query>` | 跨所有 agent 全文搜索 |
| `ah memory list` | 列出统一记忆库中的所有记忆 |
| `ah memory search` | 在记忆库中搜索 |
| `ah memory add` | 添加新记忆（所有 agent 可见） |
| `ah memory sync` | 从各 agent 导入记忆到统一库 |

## 支持的 Agent

| Agent | 数据目录 | 数据格式 |
|-------|----------|----------|
| Claude Code | `~/.claude/` | JSONL + JSON |
| MiMo Code | `~/.local/share/mimocode/` | SQLite + Markdown |
| Kimi Code | `~/.kimi-code/` | JSONL + JSON |

## 统一记忆系统

记忆存储在 `~/.agent-hub/memory.db` (SQLite)，支持：
- 从各 agent 同步记忆
- 全文搜索（FTS5）
- 跨 agent 记忆共享

## 开发

```powershell
# 调试构建
cargo build

# 运行测试
cargo test

# 代码检查
cargo clippy
```

## 依赖

- Rust 1.70+
- MinGW-w64（用于 GNU 工具链编译）

## 许可证

MIT
