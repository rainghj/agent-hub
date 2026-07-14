# Zed 设计参考：可借鉴给 Agent Hub 的架构与模式

> 本文基于对 `C:\code\github\zed-main` 仓库的探索，整理 Zed 在终端、Agent、工作区、项目面板、CLI、设置系统等模块的设计，作为 Agent Hub 未来演进的参考。

---

## 1. 整体架构：按职责拆分为独立 Crate

Zed 不是单体 Rust 项目，而是按 **领域职责** 拆成大量 crate：

```
crates/
├── terminal/          # 终端核心：PTY、VTE、网格、事件
├── terminal_view/     # 终端 UI：渲染、面板、标签页、持久化
├── agent/             # Agent 核心：Thread、Tool、Sandbox、Store
├── agent_ui/          # Agent UI：面板、对话视图、消息编辑器
├── project_panel/     # 项目文件树
├── workspace/         # 工作区：Pane、Dock、持久化
├── cli/               # 独立 CLI 二进制
├── gpui/              # UI 框架
├── settings/          # 强类型设置系统
└── project/           # 项目/工作树抽象
```

### 对 Agent Hub 的启发

Agent Hub 当前结构：

```
src/                  # React 前端
src-tauri/src/        # Rust 后端（Tauri）
```

可以学习 Zed，在后端内部按职责进一步拆分模块（即使不拆 crate）：

```
src-tauri/src/
├── terminal/         # PTY 会话管理（ portable-pty 封装）
├── terminal_view/    # 终端状态、尺寸、事件转发
├── agent/            # agent 数据解析、profile、恢复命令
├── project_panel/    # 目录树、文件列表
├── workspace/        # 标签页、布局、持久化
├── cli/              # ah CLI 逻辑
└── settings/         # 强类型配置
```

这样前端只通过 Tauri command 与后端交互，后端内部边界清晰。

---

## 2. 终端：Core + View 两层 + alacritty_terminal

### 2.1 分层

Zed 的终端拆成两个 crate：

- **`crates/terminal`**：纯核心，无 GPUI 依赖
  - 引入 `alacritty_terminal` 做终端网格/VTE 状态
  - 引入 `vte` crate 做 ANSI 解析
  - 封装 PTY 创建、resize、输入输出、事件流
  - 定义 `TerminalSettings`、`Event`、`Point`、`Range` 等公共类型
  - 关键类型：`Terminal` 结构体（`crates/terminal/src/terminal.rs:1407`）
  - PTY 创建：`TerminalBuilder::new`（`terminal.rs:1019`）→ `pty_options()` → `open_pty()` → `spawn_event_loop()`（`crates/terminal/src/alacritty.rs:200`）
  - 事件处理：`process_pty_event`（`terminal.rs:1508`）
  - 进程信息：`PtyProcessInfo`（`crates/terminal/src/pty_info.rs:76`）

- **`crates/terminal_view`**：UI 层
  - `TerminalView`：作为 Workspace 的 Item 存在
  - `TerminalElement`：渲染终端内容（`crates/terminal_view/src/terminal_element.rs:327`）
  - `TerminalPanel`：管理多个终端标签页（`crates/terminal_view/src/terminal_panel.rs:77`）
  - `persistence.rs`：序列化/反序列化终端面板状态（`crates/terminal_view/src/persistence.rs:27`）

### 2.2 事件批处理

Zed 的 PTY reader 不会每读到一个字节就通知 UI，而是：

1. 通过 unbounded `mpsc` 接收 `PtyEvent::Event(TerminalBackendEvent)`。
2. 在 `TerminalBuilder::subscribe`（`terminal.rs:1315`）中用一个 **约 4 ms 的定时器** 合并事件。
3. 批量唤醒 UI，避免高频输出导致 UI 线程被拖垮。

这对 xterm.js + React 同样重要：如果每个字节都触发一次 state update，快速输出时前端会卡死。

### 2.2 对 Agent Hub 的启发

Agent Hub 现在用 **xterm.js + portable-pty**，终端网格和渲染都在前端。这个模式开发快、跨平台，但有两个长期风险：

1. Webview 的输入/IME/性能天花板（见 `docs/terminal-design-reference.md`）。
2. 终端状态全部在 JS 侧，Rust 后端只转发字节，难以做「会话恢复」「服务发现」「Agent 工具调用」。

**可借鉴的演进路线：**

| 阶段 | 后端职责 | 前端职责 | 复杂度 |
|------|---------|---------|--------|
| 当前 | `portable-pty` 转发 I/O | xterm.js 渲染 | 低 |
| 中期 | Rust 侧用 `alacritty_terminal`/`vte` 维护终端网格，暴露「当前屏幕内容、光标、标题」等状态 | 前端只负责展示后端同步过来的状态 | 中 |
| 长期 | Rust 侧完整终端 + 自主渲染 | 可选原生渲染或 WebGL 共享纹理 | 高 |

**短期可落地：**

- 在后端封装 `TerminalSession` struct，持有 PTY handle、尺寸、标题、当前工作目录。
- 暴露 Tauri command：`terminal_create`、`terminal_write`、`terminal_resize`、`terminal_kill`。
- 后端通过事件流向前端推送输出字节，前端 xterm.js 只负责显示。
- **关键优化**：PTY reader 线程批量读取，通过 channel 合并，设置一个 4-16 ms 的批处理定时器再一次性推给前端，避免 React 频繁 re-render。

关键文件参考：

- `crates/terminal/src/terminal.rs:1407` — `pub struct Terminal`
- `crates/terminal/src/terminal.rs:1019` — `TerminalBuilder::new`
- `crates/terminal/src/terminal.rs:1508` — `process_pty_event`
- `crates/terminal/src/terminal.rs:1315` — `subscribe`（4 ms 事件批处理）
- `crates/terminal/src/alacritty.rs:200` — `spawn_event_loop`
- `crates/terminal/src/pty_info.rs:76` — `PtyProcessInfo`
- `crates/terminal_view/src/terminal_view.rs:107-150` — TerminalView 注册为 Workspace Item
- `crates/terminal_view/src/terminal_element.rs:327` — `TerminalElement`
- `crates/terminal_view/src/terminal_panel.rs:77` — `TerminalPanel`
- `crates/terminal_view/src/persistence.rs:27` — `serialize_pane_group`

---

## 3. Agent 架构：Thread + Tool + Sandbox

### 3.1 核心模型

Zed 的 Agent 功能集中在 `crates/agent`：

- **`Thread`**：一次对话/任务会话（`crates/agent/src/thread.rs:1216`）
  - 持有 `messages: Vec<Arc<Message>>`，消息类型包括 `User`、`Agent`、`Resume`、`Compaction`（`thread.rs:182`）
  - 持有 `tools: BTreeMap<SharedString, Arc<dyn AnyAgentTool>>`
  - 持有 `running_turn`、`pending_message`、`action_log`、`project_context`、`sandbox_grants`

- **`ThreadEvent`**：事件驱动的 UI 更新（`crates/agent/src/thread.rs:869`）
  - `UserMessage`、`AgentText`、`ToolCall`、`ToolCallAuthorization`
  - `SubagentSpawned`、`Retry`、`ContextCompaction`、`Stop`
  - UI 通过回放事件流来渲染，而不是轮询完整历史

- **`AgentTool` trait**：强类型工具系统（`crates/agent/src/thread.rs:4974`）
  - 每个 Tool 定义 `Input`/`Output`，通过 `schemars` 生成 JSON Schema
  - 用 `tools!` 宏注册到 allowlist（`crates/agent/src/tools.rs:93`）
  - 内置工具：`ReadFileTool`、`EditFileTool`、`TerminalTool`、`FindPathTool`、`ListDirectoryTool` 等

- **`TerminalTool` / `SandboxedTerminalTool`**：
  - 在 shell 中执行一次性命令（`crates/agent/src/tools/terminal_tool.rs:258`）
  - 参数：`command`、`cd`、`timeout_ms`、`head_lines`/`tail_lines`、沙箱权限
  - 返回字符串输出，不是交互式会话

- **`ThreadStore`**：管理所有 Thread 的持久化（`crates/agent/src/thread_store.rs:12`）
  - 基于 SQLite 存储 `DbThreadMetadata`
  - 按 `updated_at` 排序

- **Sandboxing**：
  - `ThreadSandbox` 控制每个 Thread 能读写的路径
  - `decide_permission_from_settings` 根据用户设置决定工具权限
  - 文件：`crates/agent/src/sandboxing.rs`

- **Native Agent Server**：
  - 支持外部 Agent（如 Claude Code CLI）通过 ACP（Agent Client Protocol）接入
  - 文件：`crates/agent/src/native_agent_server.rs`

### 3.2 UI 层

`crates/agent_ui`：

- **`AgentPanel`**：右侧/侧边栏主面板
- **`ConversationView`**：消息列表 + 渲染
- **`MessageEditor`**：用户输入框
- **`Context`**：用户选中的文件/上下文
- **`InlineAssistant`**：编辑器内联助手
- 文件：`crates/agent_ui/src/agent_panel.rs`、`conversation_view.rs`、`message_editor.rs`

### 3.3 对 Agent Hub 的启发

Agent Hub 现在的定位是「统一管理 Claude / MiMo / Kimi 会话的容器」，而不是自己实现 Agent。但 Zed 的 Agent 架构仍有参考价值：

1. **Thread 模型 + 事件驱动 UI**：
   - 每个 agent 会话对应一个 Thread，持有 session ID、项目路径、启动命令、状态。
   - Agent Hub 的左侧目录树可以按 Thread（会话）组织，而不是只按项目目录。
   - 前端通过事件流（如 `ThreadEvent`）增量更新，不要每次轮询完整会话历史。

2. **强类型 Tool 注册表**：
   - 如果未来 Agent Hub 想支持「让 agent 调用本地工具」（如让 Claude 打开一个文件、运行一个测试），可以学习 Zed 的 `AgentTool` trait + `tools!` 注册表。
   - 每个 Tool 定义输入 schema、执行逻辑、输出格式，并集中控制 allowlist。

3. **Terminal Tool / Agent 与终端集成**：
   - Zed 的 Agent 可以直接在终端中执行命令，并读取输出作为 tool result。
   - Agent Hub 天然有终端，这是巨大优势：可以让 agent 在指定终端标签页中执行命令，UI 同步显示执行过程。
   - 区分「交互式 shell 标签页」和「一次性 tool 命令」两种模式。

4. **ThreadStore 持久化**：
   - 用 SQLite 存 Thread 元数据（标题、updated_at、项目、模型、token 使用）。
   - 消息体单独存表，懒加载。

5. **沙箱与权限**：
   - 如果 Agent Hub 未来支持 agent 自动读写文件，必须有沙箱控制。
   - 学习 Zed 的 `ThreadSandbox`，按 Thread 限制可写路径。

关键文件参考：

- `crates/agent/src/thread.rs:1216` — `pub struct Thread`
- `crates/agent/src/thread.rs:869` — `pub enum ThreadEvent`
- `crates/agent/src/thread.rs:4974` — `pub trait AgentTool`
- `crates/agent/src/thread.rs:3536` — `fn run_tool`
- `crates/agent/src/tools.rs:93` — `tools!` 宏 / allowlist
- `crates/agent/src/tools/terminal_tool.rs:258` — `TerminalTool`
- `crates/agent/src/thread_store.rs:12` — `ThreadStore`
- `crates/agent_ui/src/agent_panel.rs:105-120` — `KNOWN_TERMINAL_AGENT_COMMANDS`（claude、codex、aider 等）

---

## 4. 项目面板：Worktree + Entry + 虚拟列表

### 4.1 核心抽象

Zed 的项目面板不是直接遍历文件系统，而是基于 **`Project` / `Worktree` / `Entry`** 抽象：

- **`Project`**：代表一个打开的项目，包含多个 worktree。
- **`Worktree`**：一个根目录（通常是 git repo 根）。
- **`Entry`**：文件或目录条目，带 ID、路径、Git 状态、诊断状态。

文件面板使用 **`uniform_list`** 做虚拟化渲染，只渲染可见条目。

### 4.2 关键特性

- **Git 感知**：文件名颜色根据 git status 变化
- **诊断感知**：文件图标根据 LSP diagnostic severity 变化
- **Auto-fold dirs**：单孩子目录链自动折叠成 `a/b/c` 单条目（`state.ancestors`，`project_panel.rs:1080` 附近）
- **Undo manager**：新建/重命名/删除操作支持撤销
- **虚拟化渲染**：使用 `uniform_list` 只渲染可见条目
- 文件：`crates/project_panel/src/project_panel.rs`

### 4.3 对 Agent Hub 的启发

Agent Hub 当前右侧文件列表相对简单。可以借鉴：

1. **Worktree 抽象**：
   - 一个项目可能对应多个根目录（比如 monorepo 子包）。
   - Agent Hub 左侧目录树目前按「项目目录」聚合会话，可以升级为 Worktree 模型。

2. **目录展开状态管理**：
   - 用 `expanded_dir_ids: HashMap<WorktreeId, Vec<ProjectEntryId>>` 单独保存展开状态，不放在树数据里。
   - 增量更新时只改这个集合，性能更好。

3. **Auto-fold dirs**：
   - 单孩子目录链折叠成 `a/b/c` 一行，减少目录树深度。
   - 用户点击时再展开。

4. **Git 状态显示**：
   - 文件/目录显示 git 状态（modified、untracked 等），帮助用户快速定位改动。

5. **虚拟化列表**：
   - 如果项目文件很多，React 侧可以用 react-window 或虚拟列表优化。

6. **Agent 上下文标记**：
   - Zed 用诊断/GIT 给文件着色。
   - Agent Hub 可以给「当前 agent 会话关联的目录」「最近活跃的会话」加视觉标记。

关键文件参考：

- `crates/project_panel/src/project_panel.rs:137` — `pub struct ProjectPanel`
- `crates/project_panel/src/project_panel.rs:95` — `VisibleEntriesForWorktree`
- `crates/project_panel/src/project_panel.rs:112` — `expanded_dir_ids`
- `crates/project_panel/src/project_panel.rs:2797` — `sort_worktree_entries`
- `crates/project_panel/src/project_panel.rs:1080` — auto-fold dirs 相关逻辑
- `crates/project_panel/src/project_panel_settings.rs:15` — `ProjectPanelSettings`

---

## 5. 工作区：Pane / PaneGroup / Dock 模型

### 5.1 布局模型

Zed 的工作区布局模型非常清晰：

- **`Workspace`**：一个窗口，包含 center、left dock、right dock、bottom dock。
- **`Dock`**：侧边栏/底部栏，可停靠 Panel。
- **`Pane`**：标签页容器，一组 `Item`。
- **`Item`** trait：任何可放入标签页的内容（编辑器、终端、图片预览等）。
- **`PaneGroup`**：管理 Pane 的分割布局，支持 `PaneAxis`（水平/垂直）。
- 文件：
  - `crates/workspace/src/workspace.rs`
  - `crates/workspace/src/pane.rs`
  - `crates/workspace/src/pane_group.rs`
  - `crates/workspace/src/dock.rs`
  - `crates/workspace/src/item.rs`

### 5.2 序列化

Zed 的工作区状态可以完整保存到数据库：

- `SerializedWorkspace`（`crates/workspace/src/persistence/model.rs:129`）：窗口位置、打开的目录、dock 状态
- `SerializedPaneGroup`（`crates/workspace/src/persistence/model.rs:233`）：pane 分割布局，递归结构 `{ axis, children, flexes }`
- `SerializableItem` trait：每个 Item 自己定义如何序列化/反序列化
- **序列化节流**：Zed 在 `workspace.rs:173` 附近使用约 200 ms 的 throttle，避免 resize 时频繁写盘
- 文件：`crates/workspace/src/persistence.rs`、`crates/terminal_view/src/persistence.rs`

### 5.3 对 Agent Hub 的启发

Agent Hub 当前是固定三栏布局，未来如果要支持：

- 多标签页终端
- 终端分屏
- 可拖拽的 agent 面板
- 保存/恢复窗口布局

可以直接借鉴 Zed 的模型：

```rust
// 概念性伪代码
struct Workspace {
    left_dock: Dock<ProjectPanel>,
    center: PaneGroup<TerminalPane>,
    right_dock: Dock<FilePanel>,
}

enum Item {
    Terminal(TerminalView),
    File(FileViewer),
    Agent(AgentPanel),
}
```

**短期可落地：**

- 定义 `WorkspaceState` struct，保存当前窗口的：
  - 左侧展开的目录
  - 中间打开的标签页及激活项
  - 右侧选中的文件
- 保存到 `~/.agent-hub/workspace-state.json`。
- 启动时读取并恢复。
- **重要**：保存操作要做 throttle（如 200 ms-1 s），避免拖拽分屏时频繁写盘。

关键文件参考：

- `crates/workspace/src/workspace.rs:189` — `TerminalProvider` trait
- `crates/workspace/src/pane.rs:57` — `SelectedEntry`
- `crates/workspace/src/pane_group.rs:29` — `PaneGroup`
- `crates/workspace/src/pane_group.rs:290` — `pub enum Member { Axis(PaneAxis), Pane(Entity<Pane>) }`
- `crates/workspace/src/dock.rs:36` — `pub trait Panel`
- `crates/workspace/src/dock.rs:269` — `pub struct Dock`
- `crates/workspace/src/item.rs` — Item trait 定义
- `crates/workspace/src/persistence/model.rs:129` — `SerializedWorkspace`
- `crates/workspace/src/persistence/model.rs:233` — `SerializedPaneGroup`
- `crates/terminal_view/src/persistence.rs:27-90` — 序列化 PaneGroup 为 SerializedPaneGroup

---

## 6. CLI：独立二进制 + IPC 通信

### 6.1 Zed CLI 架构

Zed 的 `crates/cli` 是一个 **独立的可执行文件**，不是直接启动 Zed，而是：

1. 解析命令行参数（`clap`）。
2. 找到已安装的 Zed app。
3. 通过 **IPC one-shot server** 与运行中的 Zed 进程通信。
4. 支持打开路径、等待窗口关闭、版本查询等。

关键文件：`crates/cli/src/main.rs`

支持的命令示例：

```bash
zed                              # 打开 Zed
zed path-to-project              # 打开项目
zed -n path-to-file              # 在新窗口打开
zed --wait path-to-file          # 等待关闭
zed path:line:column             # 打开文件到指定行列
```

### 6.2 对 Agent Hub 的启发

Agent Hub 已有 `ah` CLI（`Cargo.toml` 中定义），但功能较基础。可以学习 Zed：

1. **CLI 作为独立二进制**：
   - 与 Tauri app 分离，避免启动整个 Webview 做简单操作。
   - `ah` 可以先实现纯命令行功能（如列出会话、恢复会话）。

2. **IPC 与运行中 App 通信**：
   - Zed CLI 创建 `IpcOneShotServer`，然后启动/连接 GUI，发送 `CliRequest::Open { paths, ... }`。
   - Agent Hub 可以设计类似的 `AhRequest`/`AhResponse`：
     - `ah open --agent claude --dir D:\project`
     - `ah --existing --agent kimi --session <id>`
     - `ah focus --session <id>`
     - `ah send --session <id> --text "npm run dev\n"`
   - Windows 用 named pipe，Unix 用 domain socket。

3. **路径解析**：
   - 支持 `path:line:column` 语法，对文件查看器很有用。

4. **平台检测**：
   - Zed CLI 会检测已安装的 app（Windows 找 exe，macOS 找 .app）。
   - Agent Hub 安装后，CLI 应能自动找到 Tauri app 位置。

关键文件参考：

- `crates/cli/src/main.rs:38` — `trait InstalledApp`
- `crates/cli/src/main.rs:470` — `fn main`
- `crates/cli/src/main.rs:713` — `CliRequest::Open`
- `crates/cli/src/main.rs:731` — `CliResponse` handling
- `crates/cli/src/main.rs:936` / `1183` / `1344` — platform `launch` implementations
- `crates/cli/src/cli.rs` — `CliRequest`、`CliResponse`、`IpcHandshake`

---

## 7. 设置系统：强类型 + JSON Schema + 分层合并

### 7.1 设计

Zed 的设置系统非常值得学习：

- 每个设置是强类型 struct，用 `Deserialize` + `JsonSchema` derive。
- `RegisterSetting` derive 宏自动注册到全局 SettingsStore。
- 支持 **用户设置** 和 **项目设置** 分层合并。
- 提供 `update_settings_file` 辅助函数安全修改设置文件。

示例：`TerminalSettings`

```rust
#[derive(Clone, Debug, Deserialize, RegisterSetting)]
pub struct TerminalSettings {
    pub shell: Shell,
    pub working_directory: WorkingDirectory,
    pub font_size: Option<Pixels>,
    pub env: HashMap<String, String>,
    pub cursor_shape: CursorShape,
    pub max_scroll_history_lines: Option<usize>,
    // ...
}
```

文件：`crates/terminal/src/terminal_settings.rs`

### 7.2 对 Agent Hub 的启发

Agent Hub 当前配置可能是硬编码或简单 JSON。可以升级为：

1. **强类型配置**：

```rust
#[derive(Debug, Deserialize, Serialize)]
pub struct AgentHubSettings {
    pub agents: Vec<AgentProfile>,
    pub terminal: TerminalSettings,
    pub ui: UiSettings,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AgentProfile {
    pub name: String,
    pub command: String,
    pub resume_args: String,
    pub icon: Option<String>,
}
```

2. **Agent Profile 配置化**：
   - 把 Claude / MiMo / Kimi 的启动/恢复命令放到 `~/.agent-hub/settings.json`。
   - 用户可自定义，新增 agent 无需改代码。

3. **设置热更新**：
   - 监听 `settings.json` 变化，无需重启应用。

---

## 8. GPUI 架构模式（给 Rust 后端的启示）

虽然 Agent Hub 用 Tauri 而非 GPUI，但 Zed 的 Rust 后端模式仍有参考价值：

### 8.1 Entity / Context / EventEmitter

```rust
pub struct TerminalView {
    terminal: Entity<Terminal>,
    focus_handle: FocusHandle,
    subscriptions: Vec<Subscription>,
}

impl EventEmitter<TerminalViewEvent> for TerminalView {}
```

模式：

- **`Entity<T>`**：可变状态的容器（`gpui/src/app/entity_map.rs:56`）。
- **`Context<T>`**：变更状态的能力（`gpui/src/app/context.rs:20`）。
- **`EventEmitter`**：向订阅者发送事件。
- **`Subscription`**：订阅其他 Entity 的事件，自动清理。
- **`notify()`**：状态变更后通知观察者重绘（`gpui/src/app/context.rs:229`）。
- **`spawn()`**：在 main executor 上跑 async task（`gpui/src/app/context.rs:237`）。

### 8.2 Action 系统

Zed 用 `actions!` 宏定义零大小的类型化命令：

```rust
actions!(terminal, [RerunTask]);

#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Action)]
#[action(namespace = terminal)]
pub struct SendText(String);
```

然后注册到 workspace：

```rust
workspace.register_action(TerminalView::deploy);
```

### 8.3 对 Agent Hub 的启发

在 Tauri 后端可以借鉴这些概念：

- 用 `Arc<Mutex<T>>` 或 `tokio::sync::RwLock<T>` 管理共享状态。
- 用 channel（`tokio::sync::mpsc`）在 PTY reader 线程和 Tauri command 之间通信。
- 定义类型化的事件枚举，而不是到处传字符串。
- 给每个终端标签页一个 ID，状态集中管理：

```rust
pub struct TerminalSession {
    pub id: Uuid,
    pub pty: Box<dyn PtyPair>,
    pub title: String,
    pub cwd: PathBuf,
    pub process_id: u32,
}

pub struct TerminalManager {
    sessions: HashMap<Uuid, TerminalSession>,
    event_tx: tokio::sync::mpsc::Sender<TerminalEvent>,
}
```

---

## 9. 短期可落地的改进清单

按优先级排序，结合 Zed 经验：

### 9.1 后端模块拆分

将 `src-tauri/src/` 按职责拆分：

```
src-tauri/src/
├── main.rs
├── commands.rs           # Tauri command 入口（保持薄）
├── terminal/
│   ├── mod.rs            # TerminalManager
│   ├── session.rs        # TerminalSession
│   └── settings.rs       # TerminalSettings
├── agent/
│   ├── mod.rs            # AgentProfile、已知 agents
│   ├── parser.rs         # 解析 .claude/ .kimi-code/ .mimocode/
│   └── profiles.rs       # 配置文件
├── workspace/
│   ├── mod.rs            # WorkspaceState
│   └── persistence.rs    # 保存/恢复
├── project_panel/
│   └── mod.rs            # 目录树、文件列表
└── cli/
    └── mod.rs            # ah CLI 逻辑
```

### 9.2 强类型设置系统

创建 `~/.agent-hub/settings.json`：

```json
{
  "agents": [
    {
      "name": "Claude",
      "command": "claude",
      "resume_args": "--resume {sessionId}",
      "data_dir": "~/.claude"
    },
    {
      "name": "MiMo",
      "command": "mimo",
      "resume_args": "--session {sessionId}",
      "data_dir": "~/.local/share/mimocode"
    },
    {
      "name": "Kimi",
      "command": "kimi",
      "resume_args": "--session {sessionId}",
      "data_dir": "~/.kimi-code"
    }
  ],
  "terminal": {
    "shell": "powershell",
    "default_cwd": "{selectedDir}"
  }
}
```

### 9.3 工作区持久化

保存：

```json
{
  "window": { "width": 1200, "height": 800 },
  "selected_project_dir": "C:/code/project",
  "expanded_dirs": ["C:/code/project/src"],
  "tabs": [
    { "id": "...", "type": "terminal", "cwd": "...", "agent": "Claude", "session_id": "..." },
    { "id": "...", "type": "terminal", "cwd": "...", "agent": null }
  ],
  "active_tab_id": "..."
}
```

### 9.4 CLI 增强

```powershell
ah --agent claude --dir D:\project
ah --agent kimi --session <id>
ah focus --session <id>
ah send --session <id> --text "npm run dev\n"
ah list
```

### 9.5 终端后端状态化

- `TerminalManager` 持有所有会话。
- 暴露 command：`terminal_create`、`terminal_write`、`terminal_resize`、`terminal_kill`。
- 后端维护每个会话的标题、CWD、进程 ID（通过 `portable-pty` 的 `PtyProcess::pid()`）。
- 前端订阅事件流，xterm.js 只负责渲染。

---

## 10. 最值得借鉴的 7 个设计（按收益排序）

| # | 设计 | Zed 位置 | Agent Hub 应用 |
|---|------|---------|---------------|
| 1 | **事件驱动的 Thread UI** | `crates/agent/src/thread.rs:869` (`ThreadEvent`) | Agent 会话前端通过事件流增量更新，不轮询完整历史 |
| 2 | **强类型 Tool 注册表 + Allowlist** | `crates/agent/src/tools.rs:93` (`tools!` 宏) | 集中注册 Claude/Kimi/MiMo 可调用的本地工具 |
| 3 | **递归 PaneGroup 持久化** | `crates/workspace/src/persistence/model.rs:233` | 保存三栏布局与未来分屏状态 |
| 4 | **PTY 事件批处理** | `crates/terminal/src/terminal.rs:1315` | 避免前端因高频输出频繁 re-render |
| 5 | **目录树 Auto-fold** | `crates/project_panel/src/project_panel.rs:1080` | 折叠 `src/a/b/c` 单孩子目录链 |
| 6 | **CLI IPC 启动协议** | `crates/cli/src/main.rs:470` | `ah .` 打开运行中的 Tauri 窗口 |
| 7 | **Entity/Context 状态模型** | `crates/gpui/src/app/context.rs:20` | Tauri 后端用 managed `AppState` + window emit |

---

## 11. 参考文件路径

| 模块 | 关键文件 |
|------|---------|
| 终端核心 | `crates/terminal/src/terminal.rs:1407` (`Terminal`) |
| 终端 PTY 封装 | `crates/terminal/src/alacritty.rs:200` (`spawn_event_loop`) |
| 终端 UI | `crates/terminal_view/src/terminal_view.rs:107` (`init`) |
| 终端面板 | `crates/terminal_view/src/terminal_panel.rs:77` (`TerminalPanel`) |
| 终端持久化 | `crates/terminal_view/src/persistence.rs:27` (`serialize_pane_group`) |
| 终端设置 | `crates/terminal/src/terminal_settings.rs:22` (`TerminalSettings`) |
| Agent Thread | `crates/agent/src/thread.rs:1216` (`Thread`) |
| Agent ThreadEvent | `crates/agent/src/thread.rs:869` (`ThreadEvent`) |
| Agent Tool trait | `crates/agent/src/thread.rs:4974` (`AgentTool`) |
| Agent Tool 注册 | `crates/agent/src/tools.rs:93` (`tools!`) |
| Agent TerminalTool | `crates/agent/src/tools/terminal_tool.rs:258` |
| Agent ThreadStore | `crates/agent/src/thread_store.rs:12` |
| Agent UI 面板 | `crates/agent_ui/src/agent_panel.rs:105` (`KNOWN_TERMINAL_AGENT_COMMANDS`) |
| 项目面板 | `crates/project_panel/src/project_panel.rs:137` (`ProjectPanel`) |
| 工作区 | `crates/workspace/src/workspace.rs:189` (`TerminalProvider`) |
| Pane | `crates/workspace/src/pane.rs:57` (`SelectedEntry`) |
| PaneGroup | `crates/workspace/src/pane_group.rs:29` (`PaneGroup`) / `:290` (`Member`) |
| Dock | `crates/workspace/src/dock.rs:36` (`Panel`) / `:269` (`Dock`) |
| Item trait | `crates/workspace/src/item.rs` |
| 工作区持久化 | `crates/workspace/src/persistence/model.rs:129` (`SerializedWorkspace`) / `:233` (`SerializedPaneGroup`) |
| CLI | `crates/cli/src/main.rs:470` (`fn main`) |
| GPUI Entity | `crates/gpui/src/app/entity_map.rs:56` (`EntityMap`) |
| GPUI Context | `crates/gpui/src/app/context.rs:20` (`Context`) |

---

## 总结

Zed 给 Agent Hub 最重要的三条启示：

1. **终端要做成 Core + View 两层**：Rust 后端维护会话与状态，前端只负责展示，这样才能做会话恢复、服务发现、Agent 工具集成。
2. **工作区用 Pane/Item/Dock 模型**：为未来的多标签页、分屏、拖拽、持久化打下基础。
3. **Agent 按 Thread + Tool + Sandbox 组织**：Agent Hub 未来如果要让 agent 调用本地能力，这是可扩展的架构。

建议优先落地：

1. 后端模块拆分
2. `~/.agent-hub/settings.json` Agent Profile 配置化
3. 工作区状态持久化
