# Workspace 状态持久化设计（按项目）

## 目标

让 Agent Hub 记住每个项目的 UI 状态：当前选中目录、文件树展开节点、打开的标签页、激活的标签页、窗口尺寸。关闭并重新打开应用后，能恢复到上次离开时的状态。

参考 Zed 的 `SerializedWorkspace` / `SerializedPaneGroup` 思路，但保持实现最小化。

---

## 背景

当前前端状态全部在内存中：

- `App.tsx`：`selectedProject`、`tabs`、`activeTabId`
- `FilePanel.tsx`：`expandedDirs`
- `Sidebar.tsx`：`expandedProjects`（会话列表展开状态）
- Tauri 窗口：尺寸、最大化状态

关闭应用后全部丢失。需要把这些状态按项目持久化到本地文件。

---

## 数据模型

### ProjectWorkspaceState

每个项目一个状态文件：

```rust
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ProjectWorkspaceState {
    /// Schema 版本，用于未来迁移
    #[serde(default = "default_version")]
    pub version: u32,

    /// 项目根目录（冗余保存，用于校验）
    pub project_path: String,

    /// 文件树中展开的目录路径
    #[serde(default)]
    pub expanded_dirs: Vec<String>,

    /// 会话列表中展开的项目路径
    #[serde(default)]
    pub expanded_projects: Vec<String>,

    /// 打开的标签页
    #[serde(default)]
    pub tabs: Vec<SerializedTab>,

    /// 当前激活的标签页 ID
    pub active_tab_id: Option<String>,
}
```

### SerializedTab

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SerializedTab {
    Shell {
        id: String,
        title: String,
        project_path: String,
    },
    Session {
        id: String,
        title: String,
        agent: String,
        session_id: String,
        project_path: String,
    },
    File {
        id: String,
        title: String,
        file_path: String,
        project_path: String,
    },
}
```

### GlobalWorkspaceState

窗口级别状态，单独一个文件：

```rust
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct GlobalWorkspaceState {
    /// Schema 版本，用于未来迁移
    #[serde(default = "default_version")]
    pub version: u32,

    /// 最后活跃的项目路径
    pub last_project_path: Option<String>,

    /// 窗口尺寸
    pub window_width: Option<u32>,
    pub window_height: Option<u32>,
    pub window_maximized: Option<bool>,
}
```

---

## 文件存储

```
~/.agent-hub/
├── agents.json
├── global-workspace-state.json
└── workspaces/
    ├── <sha256("C:/code/agent-hub")>.json
    └── <sha256("C:/code/other-project")>.json
```

- 项目状态文件用 `stable_hash_hex`（基于 `std::hash::DefaultHasher` 的 64 位哈希，输出 16 位十六进制）对规范化路径求哈希作为文件名，避免特殊字符问题。
- 规范化规则：统一使用正斜杠 `/`，去掉尾部斜杠，Windows 路径保持盘符大写（如 `C:/code/agent-hub`）。
- 示例：`C:\code\agent-hub` → `C:/code/agent-hub` → `stable_hash_hex` → `a1b2c3d4e5f67890`。
- 全局状态文件记录最后活跃项目，启动时用它来决定加载哪个项目状态。
- 两个文件都是 pretty-printed JSON，方便手动查看/调试。

---

## 后端职责

新增 `src-tauri/src/workspace/` 模块：

- `src-tauri/src/workspace/mod.rs`
  - `WorkspaceManager`：管理器 struct，持有配置目录路径
  - `load_project_state(project_path) -> ProjectWorkspaceState`
  - `save_project_state(state) -> Result<()>`
  - `load_global_state() -> GlobalWorkspaceState`
  - `save_global_state(state) -> Result<()>`
  - 自动创建 `~/.agent-hub/workspaces/` 目录
- 暴露四个 Tauri command：
  - `load_workspace_state(project_path: String) -> Result<ProjectWorkspaceState, String>`
  - `save_workspace_state(project_path: String, state: ProjectWorkspaceState) -> Result<(), String>`
  - `load_global_workspace_state() -> Result<GlobalWorkspaceState, String>`
  - `save_global_workspace_state(state: GlobalWorkspaceState) -> Result<(), String>`

`src-tauri/src/main.rs`：
- 在 `main()` 中初始化 `WorkspaceManager` 并作为 managed state 注册。

---

## 前端职责

新增 `src/hooks/useWorkspaceState.ts`：

- 提供 `loadWorkspaceState(projectPath)` / `saveWorkspaceState(projectPath, state)` 两个封装。
- 在非 Tauri 环境返回 mock 数据或空对象，不影响浏览器开发。

修改 `App.tsx`：

1. 启动时：
   - 先加载 `global-workspace-state.json` 得到 `last_project_path`。
   - 如果存在，设为 `selectedProject`。
   - 加载对应项目状态，恢复 `tabs`、`activeTabId`。
2. 当 `selectedProject` 变化时：
   - 加载新项目状态。
   - 切换项目前，保存旧项目当前状态。
3. `tabs`、`activeTabId` 变化时：
   - 用 `useEffect` + `setTimeout` 做节流保存（500 ms）。
4. 关闭前：
   - 监听 `beforeunload`，保存当前项目状态和全局状态。

修改 `FilePanel.tsx`：

- `expandedDirs` 变化时同步保存到 workspace state。
- 加载项目状态时，用保存的 `expanded_dirs` 初始化展开集合。

修改 `Sidebar.tsx`：

- 将 `expandedProjects` 状态从 Sidebar 内部提升到 `App.tsx`，通过 prop 传入，便于保存到 workspace state。
- `expandedProjects` 变化时同步保存。
- 加载项目状态时恢复。

---

## 自动保存策略

- **节流（throttle）**：状态变化后 500 ms 内不再变化才写入磁盘。避免拖拽窗口、快速切换标签时频繁写盘。
- **防抖合并**：同一时刻只保留一个待执行的 save 任务。
- **写前对比**：序列化后先与磁盘现有内容做字符串对比，无变化则跳过写入。
- **错误降级**：保存失败只打 `console.error`，不阻塞用户操作。

---

## 窗口尺寸保存

- 在 `App.tsx` 监听 `window.resize` 事件，节流保存到 global state。
- 启动时通过 Tauri API `appWindow.innerSize()` 读取当前尺寸，并尝试恢复为保存的尺寸。
- 如果保存的是最大化状态，启动时调用 `appWindow.maximize()`。
- 应用关闭前通过 Tauri `onCloseRequested` 事件（或 `beforeunload` 作为兜底）保存当前状态。

> Tauri v1 中通过 `@tauri-apps/api/window` 的 `appWindow` 操作。

---

## 错误与边界情况

| 场景 | 处理 |
|------|------|
| 项目目录已被删除 | 加载时若路径不存在，清空对应状态，不恢复 |
| 保存文件损坏 | 解析失败时返回默认空状态，不崩溃 |
| 项目路径含特殊字符 | 用哈希作为文件名，避免问题 |
| 非 Tauri 环境 | hook 返回 mock/空对象，不调用 invoke |
| 同时切换多个项目 | 切换前保存旧项目，加载新项目；若保存失败也不阻塞 |
| 恢复的会话/文件已不存在 | Session tab 保留元数据但启动时不自动重连；File tab 若文件不存在则跳过恢复 |
| `last_project_path` 不在当前会话列表中 | 回退到不选中任何项目（`selectedProject = null`） |

---

## 不包含在本期

- 终端内容/滚动位置恢复（只恢复标签元数据）。
- 多窗口布局 / Pane 分屏（当前只有三栏固定布局）。
- 标签页拖拽顺序持久化（当前不支持拖拽）。
- 文件编辑器 undo/redo 历史。
- SQLite 迁移（如果未来项目状态变复杂再考虑）。

---

## 验收标准

1. 打开一个项目，展开几个目录、打开几个标签页、调整窗口大小，关闭应用后重新打开，能恢复到关闭前的状态。
2. 切换项目时，旧项目的展开目录和标签页被保存，新项目的上一次状态被恢复。
3. 非 Tauri 环境下前端不报错，行为与之前一致。
4. `cargo check`、`npx tsc --noEmit`、`npm run build` 全部通过。
