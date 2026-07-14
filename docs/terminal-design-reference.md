# 终端设计参考：Microsoft Terminal & AI Agent Terminal 项目复盘

> 本文整理自对 [Microsoft Terminal](https://github.com/microsoft/terminal) 官方仓库以及同类 AI Agent 终端项目 Paneflow 的复盘，作为 Agent Hub 未来终端与会话管理设计的参考。

---

## 1. 架构分层：UI 与 PTY Server 解耦

Microsoft Terminal 将 **Terminal UI** 与 **Console Host / ConPTY Server** 拆分为两个可复用层。这种分层带来的好处：

- UI 可以独立迭代（WinUI、标签页、主题等）。
- PTY Server 可被其他应用复用（例如 VS Code 的终端也基于 ConPTY）。
- 接口清晰后，测试和跨平台适配更容易。

Agent Hub 当前采用 Rust 后端 + Webview 前端（Tauri），终端渲染交给前端的 xterm.js，后端通过 `portable-pty` 驱动 PTY。这与 WT 的分层思路一致，但前端渲染层与后端 PTY 层之间隔了一层 Webview/JS Bridge。

### 对 Agent Hub 的启发

- 将 PTY 相关能力抽象为稳定接口：`spawn_shell`、`write_pty`、`resize_pty`、`kill_pty`。
- 把「会话生命周期管理」与「UI 展示」解耦，方便后续支持多窗格、会话恢复、外部控制等。
- `portable-pty` 已经做了跨平台抽象，方向正确，后续可在其上再封装一层内部服务。

---

## 2. ConPTY 的发展趋势：关注 In-Process ConPTY

Microsoft Terminal 正在推进 [In-process ConPTY](https://github.com/microsoft/terminal/blob/main/doc/specs/%2313000%20-%20In-process%20ConPTY.md)。

当前跨进程 ConPTY 的痛点：

- 终端与 ConPTY 的 buffer 内容可能不同步。
- 某些 Windows Console API 没有对应的 VT 转义序列。
- 异步 resize、滚动、文本回流等行为存在一致性问题。

### 对 Agent Hub 的启发

- 当前使用 `portable-pty`（Windows 下底层即 ConPTY）已能满足大部分场景。
- 如果未来在 Windows 上遇到以下现象，应意识到是 ConPTY 的已知限制，而非应用 bug：
  - 光标位置/窗口标题同步异常
  - 某些颜色或 gridline 属性丢失
  - resize 后内容错位
- 长期可关注 Windows 是否开放更稳定的进程内 ConPTY API。

---

## 3. Profile（配置档案）模型

Windows Terminal 使用 `profiles.json` 定义多个 shell 配置，每个 profile 包含：

```json
{
  "profiles": [
    {
      "name": "PowerShell 7",
      "commandline": "pwsh.exe",
      "startingDirectory": "C:\\Projects",
      "colorScheme": "Campbell"
    }
  ]
}
```

### 对 Agent Hub 的启发

Agent Hub 当前管理三种 agent 会话：Claude Code、MiMo Code、Kimi Code。可以借鉴 Profile 模型，将 agent 启动逻辑配置化：

```json
{
  "profiles": [
    { "name": "Claude", "command": "claude --resume {sessionId}", "cwd": "{projectDir}" },
    { "name": "MiMo",   "command": "mimo --session {sessionId}",   "cwd": "{projectDir}" },
    { "name": "Kimi",   "command": "kimi --session {sessionId}",   "cwd": "{projectDir}" }
  ]
}
```

收益：

- 新增 agent 不需要修改代码，改配置即可。
- 用户可自定义启动命令、环境变量、工作目录。
- 为 CLI 启动和会话恢复提供统一入口。

---

## 4. 命令行启动与布局

Windows Terminal 支持通过命令行直接构造窗口布局：

```powershell
wt -p "Command Prompt" `; split-pane -p "PowerShell" `; split-pane -H wsl.exe
```

### 对 Agent Hub 的启发

当前 CLI `ah` 功能较基础，未来可扩展为：

```powershell
# 打开指定 agent
ah --agent claude --dir D:\project

# 恢复已有会话
ah --agent kimi --session <session-id>

# 多 agent 分屏布局（远期）
ah --layout split --agents claude,kimi --dir D:\project
```

收益：

- 支持从外部工具/脚本快速拉起 Agent Hub。
- 与 IDE、文件管理器、启动器等集成更自然。
- 为会话恢复和自动化测试打下基础。

---

## 5. Tauri + Webview 的潜在天花板

同类项目 Paneflow 最初采用 Tauri，后切换为原生 GPUI。作者给出的核心理由：

> Webview API 表面对终端多路复用器所需的低层键盘、IME、窗格焦点管理来说太窄。每个按键都要经 JS 中转，亚帧延迟和输入法体验很难做好。

Agent Hub 当前使用 Tauri 1.x + xterm.js，对当前需求够用，但如果未来要支持：

- 复杂多窗格分屏
- 原生级 IME（中文、日文、韩文输入）
- 120fps 终端渲染
- 窗格拖拽、撕裂标签页

则需要评估是否继续依赖 Webview 渲染终端。

### 可选演进方向

| 阶段 | 方案 | 复杂度 | 适用场景 |
|------|------|--------|----------|
| 当前 | Tauri + xterm.js | 低 | 单标签页/简单终端 |
| 中期 | Rust 侧做 VTE 解析，前端只负责展示格式化输出 | 中 | 多标签页、性能要求提升 |
| 长期 | Rust 侧完整终端渲染（如 `alacritty_terminal` + 自定义绘制） | 高 | 专业级终端体验 |

建议：当前保持 Tauri + xterm.js，但在架构上预留 PTY 服务接口，便于未来替换渲染层。

---

## 6. Agent 工作流功能启发

Paneflow 作为面向 AI Agent 的终端工作区，有几个功能对 Agent Hub 直接有价值：

### 6.1 会话持久化

> 关闭应用后恢复布局是终端多路复用器的入场券，而不是附加功能。

Agent Hub 当前从 agent 数据目录读取会话，但标签页布局、打开的目录、每个标签的状态并未保存。

建议：

- 保存工作区状态到 `~/.agent-hub/workspace-state.json`。
- 启动时恢复目录树展开状态、打开的标签页、当前选中目录。
- 与 agent 自身的会话 ID 解耦，避免版本升级后状态不兼容。

### 6.2 Dev Server 检测

Paneflow 同时采用两种策略检测运行中的服务：

1. **终端输出正则匹配**：快速、即时，但不稳定（输出滚动、被管道重定向会丢失）。
2. **内核级端口扫描**：在 Linux 上解析 `/proc/net/tcp`，通过 PID 树关联到当前工作区的 shell 进程。

Agent Hub 当前右侧是文件列表，未来可扩展为「运行中服务」面板：

- 显示当前工作区下各 shell 子进程监听的端口。
- 一键在浏览器打开 `http://localhost:xxxx`。
- Windows 下可用 `GetExtendedTcpTable` 实现类似能力。

### 6.3 JSON-RPC / 本地控制面

Paneflow 暴露本地 JSON-RPC 接口，让外部工具和 AI agent 可以：

- 创建/切换工作区
- 向指定窗格发送文本
- 发布 agent 生命周期事件（session_start、tool_use、stop 等）

Agent Hub 的 `ah` CLI 可以朝这个方向演进：

```bash
# 向活动标签页发送命令
ah send --text "npm run dev\n"

# 通知 UI agent 开始工作
ah notify --agent claude --event session_start --session <id>
```

实现建议：

- 使用本地 Unix domain socket / Windows named pipe。
- 所有状态操作转发到 Tauri 主线程，避免并发问题。
- 权限校验通过文件系统模式或 peer credentials。

### 6.4 多窗格布局：N-ary 树优于二叉树

Paneflow 早期使用二叉 `SplitNode`，发现三列等分、拖拽调整等场景很难做好。后来改为 N-ary 树：

```rust
pub enum LayoutTree {
    Leaf(Entity<Pane>),
    Container {
        direction: SplitDirection,
        children: Vec<LayoutChild>,
        ...
    },
}
```

对 Agent Hub 的启发：

- 如果未来做多窗格，不要从零实现二叉 split。
- 使用 N-ary 容器，ratio 用 `Rc<Cell<f32>>` 存储，拖拽时只调整相邻兄弟节点。

---

## 7. 渲染性能

Windows Terminal 使用 GPU 加速的 DirectWrite/Atlas 渲染引擎，Paneflow 也强调「UI 框架必须 own glyph rasterization」。

Agent Hub 使用 xterm.js（DOM/Canvas 混合渲染），优点是跨平台、开发快，缺点是：

- 高分屏快速输出时帧率有限。
- 全屏 TUI（如 `nvim`、`btop`、`htop`）体验不如原生终端。
- 大量 DOM 节点时内存占用较高。

建议：

- 短期：继续使用 xterm.js，并通过 `@xterm/addon-fit`、合理限制 scrollback buffer 等方式优化。
- 中期：评估是否需要把终端网格解析下沉到 Rust，前端只做轻量展示。
- 长期：若终端是核心卖点，考虑基于 `alacritty_terminal` 做 Rust 侧 VTE 解析与渲染。

---

## 8. 短期可落地的改进清单

按优先级排序：

1. **Agent Profile 配置化**
   - 将 Claude / MiMo / Kimi 的启动命令、恢复命令抽象到配置文件。
   - 文件：`src-tauri/src/agents/profiles.json` 或 `~/.agent-hub/profiles.json`。

2. **CLI 增强**
   - 支持 `ah --agent <name> --dir <path> [--session <id>]`。
   - 为后续自动化集成和外部启动提供入口。

3. **工作区会话持久化**
   - 保存标签页状态、当前选中目录、目录树展开状态。
   - 文件：`~/.agent-hub/workspace-state.json`。

4. **运行中服务面板**
   - 在右侧或底部增加面板，展示当前工作区子进程监听的端口。
   - Windows 下使用 `GetExtendedTcpTable`。

5. **预留 PTY 服务接口**
   - 将 `spawn_shell`、`write_pty`、`resize`、`kill` 等封装为内部 trait/service。
   - 为未来替换渲染层或支持多后端做准备。

---

## 参考链接

- [Microsoft Terminal 仓库](https://github.com/microsoft/terminal)
- [In-process ConPTY 设计文档](https://github.com/microsoft/terminal/blob/main/doc/specs/%2313000%20-%20In-process%20ConPTY.md)
- [Windows Terminal 官方文档](https://aka.ms/terminal-docs)
- [Building a native terminal for AI coding agents in Rust + GPUI](https://dev.to/arthurj-dev/building-a-native-terminal-for-ai-coding-agents-in-rust-gpui-2bg4)
