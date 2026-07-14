# Workspace 状态持久化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现按项目持久化 Agent Hub 的 UI 状态（选中项目、文件树展开节点、会话列表展开项、标签页、窗口尺寸），并在应用重启后恢复。

**Architecture:** 后端新增 `src-tauri/src/workspace/` 模块管理 `~/.agent-hub/workspaces/<hash>.json` 和 `~/.agent-hub/global-workspace-state.json`；前端通过 `useWorkspaceState` hook 与 Tauri command 交互，在 `App.tsx` 中集中控制加载/保存/节流逻辑；`Sidebar` 和 `FilePanel` 的展开状态提升到 `App.tsx` 统一持久化。

**Tech Stack:** Rust (Tauri v1), React + TypeScript, serde_json, @tauri-apps/api.

## Global Constraints

- Tauri v1 已启用 `window-all` 和 `shell-all` feature。
- `serde` 和 `serde_json` 已存在于 `src-tauri/Cargo.toml`。
- 所有新增 Rust 代码必须通过 `cargo check`。
- 所有新增 TypeScript 代码必须通过 `npx tsc --noEmit` 和 `npm run build`。
- 不要修改现有业务逻辑（如 agent 解析、PTY 创建、文件读写）。
- 非 Tauri 环境下前端不能崩溃，应优雅降级。
- 错误处理原则：保存失败不阻塞用户，只打日志。
- Auto permission mode 开启，执行阶段不要调用 `AskUserQuestion`。

---

## File Structure

| 文件 | 职责 |
|------|------|
| `src-tauri/src/workspace/mod.rs` | 新增：WorkspaceManager、状态 struct、读写逻辑 |
| `src-tauri/src/commands.rs` | 修改：新增 4 个 workspace 相关 Tauri command，并在 `TauriBuilder` 中注册 |
| `src-tauri/src/main.rs` | 修改：初始化 WorkspaceManager 并注册为 managed state |
| `src/hooks/useWorkspaceState.ts` | 新增：封装 Tauri invoke，提供 TS 类型 |
| `src/App.tsx` | 修改：启动加载、项目切换、自动保存、窗口尺寸、关闭保存 |
| `src/components/Sidebar.tsx` | 修改：`expandedProjects` 改为 prop，由 App 控制 |
| `src/components/FilePanel.tsx` | 修改：`expandedDirs` 改为 prop，由 App 控制 |

---

### Task 1: 后端 Workspace 模块（数据模型 + 管理器）

**Files:**
- Create: `src-tauri/src/workspace/mod.rs`

**Interfaces:**
- Produces: `ProjectWorkspaceState`, `GlobalWorkspaceState`, `SerializedTab`, `WorkspaceManager`
- Produces: `WorkspaceManager::load_project_state`, `WorkspaceManager::save_project_state`, `WorkspaceManager::load_global_state`, `WorkspaceManager::save_global_state`

- [ ] **Step 1: 创建模块文件与数据类型**

Create `src-tauri/src/workspace/mod.rs`:

```rust
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

fn default_version() -> u32 {
    1
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ProjectWorkspaceState {
    #[serde(default = "default_version")]
    pub version: u32,
    pub project_path: String,
    #[serde(default)]
    pub expanded_dirs: Vec<String>,
    #[serde(default)]
    pub expanded_projects: Vec<String>,
    #[serde(default)]
    pub tabs: Vec<SerializedTab>,
    pub active_tab_id: Option<String>,
}

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

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct GlobalWorkspaceState {
    #[serde(default = "default_version")]
    pub version: u32,
    pub last_project_path: Option<String>,
    pub window_width: Option<u32>,
    pub window_height: Option<u32>,
    pub window_maximized: Option<bool>,
}

pub struct WorkspaceManager {
    config_dir: PathBuf,
}

impl WorkspaceManager {
    pub fn new(config_dir: PathBuf) -> Result<Self> {
        let workspaces_dir = config_dir.join("workspaces");
        fs::create_dir_all(&workspaces_dir)
            .with_context(|| format!("Failed to create workspaces dir {:?}", workspaces_dir))?;
        Ok(Self { config_dir })
    }

    fn project_state_path(&self, project_path: &str) -> PathBuf {
        let normalized = normalize_project_path(project_path);
        let hash = sha256_hex(&normalized);
        self.config_dir.join("workspaces").join(format!("{}.json", hash))
    }

    fn global_state_path(&self) -> PathBuf {
        self.config_dir.join("global-workspace-state.json")
    }

    pub fn load_project_state(&self, project_path: &str) -> ProjectWorkspaceState {
        let path = self.project_state_path(project_path);
        if !path.exists() {
            return ProjectWorkspaceState {
                project_path: project_path.to_string(),
                ..Default::default()
            };
        }
        match fs::read_to_string(&path)
            .and_then(|s| serde_json::from_str(&s).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e)))
        {
            Ok(mut state) => {
                // 校验路径是否匹配
                if state.project_path != project_path {
                    state.project_path = project_path.to_string();
                }
                state
            }
            Err(e) => {
                eprintln!("Failed to load project workspace state from {:?}: {}", path, e);
                ProjectWorkspaceState {
                    project_path: project_path.to_string(),
                    ..Default::default()
                }
            }
        }
    }

    pub fn save_project_state(&self, state: &ProjectWorkspaceState) -> Result<()> {
        let path = self.project_state_path(&state.project_path);
        let content = serde_json::to_string_pretty(state).context("Failed to serialize project workspace state")?;
        // 写前对比，避免无意义写入
        if let Ok(existing) = fs::read_to_string(&path) {
            if existing == content {
                return Ok(());
            }
        }
        fs::write(&path, content).with_context(|| format!("Failed to write {:?}", path))
    }

    pub fn load_global_state(&self) -> GlobalWorkspaceState {
        let path = self.global_state_path();
        if !path.exists() {
            return GlobalWorkspaceState::default();
        }
        match fs::read_to_string(&path)
            .and_then(|s| serde_json::from_str(&s).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e)))
        {
            Ok(state) => state,
            Err(e) => {
                eprintln!("Failed to load global workspace state from {:?}: {}", path, e);
                GlobalWorkspaceState::default()
            }
        }
    }

    pub fn save_global_state(&self, state: &GlobalWorkspaceState) -> Result<()> {
        let path = self.global_state_path();
        let content = serde_json::to_string_pretty(state).context("Failed to serialize global workspace state")?;
        if let Ok(existing) = fs::read_to_string(&path) {
            if existing == content {
                return Ok(());
            }
        }
        fs::write(&path, content).with_context(|| format!("Failed to write {:?}", path))
    }
}

fn normalize_project_path(path: &str) -> String {
    let mut normalized = path.replace('\\', "/");
    while normalized.ends_with('/') && normalized.len() > 1 {
        normalized.pop();
    }
    // Windows 盘符转大写
    if normalized.len() >= 2 && normalized.as_bytes()[1] == b':' {
        let first = normalized.chars().next().unwrap().to_ascii_uppercase();
        normalized.replace_range(0..1, &first.to_string());
    }
    normalized
}

fn sha256_hex(input: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    // 先用标准库哈希避免引入 sha2 crate；若后续需要真 SHA-256 可替换
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}
```

- [ ] **Step 2: 注册 workspace 模块**

Modify `src-tauri/src/main.rs` to add `mod workspace;`:

```rust
mod agents;
mod commands;
mod settings;
mod workspace;
```

- [ ] **Step 3: 编译检查**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS with no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/workspace/mod.rs src-tauri/src/main.rs
git commit -m "feat: add workspace state manager and data models"
```

---

### Task 2: 暴露 Workspace Tauri Commands

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

**Interfaces:**
- Consumes: `WorkspaceManager`, `ProjectWorkspaceState`, `GlobalWorkspaceState` from Task 1
- Produces: `load_workspace_state`, `save_workspace_state`, `load_global_workspace_state`, `save_global_workspace_state` Tauri commands

- [ ] **Step 1: 添加 Tauri commands**

Add to `src-tauri/src/commands.rs` (near the top, after existing imports):

```rust
use crate::workspace::{GlobalWorkspaceState, ProjectWorkspaceState, WorkspaceManager};
```

Add the following commands to `src-tauri/src/commands.rs` (at the end of the file):

```rust
#[tauri::command]
pub fn load_workspace_state(
    project_path: String,
    manager: State<'_, WorkspaceManager>,
) -> Result<ProjectWorkspaceState, String> {
    Ok(manager.load_project_state(&project_path))
}

#[tauri::command]
pub fn save_workspace_state(
    state: ProjectWorkspaceState,
    manager: State<'_, WorkspaceManager>,
) -> Result<(), String> {
    manager.save_project_state(&state).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_global_workspace_state(
    manager: State<'_, WorkspaceManager>,
) -> Result<GlobalWorkspaceState, String> {
    Ok(manager.load_global_state())
}

#[tauri::command]
pub fn save_global_workspace_state(
    state: GlobalWorkspaceState,
    manager: State<'_, WorkspaceManager>,
) -> Result<(), String> {
    manager.save_global_state(&state).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: 注册 managed state 和 commands**

Modify `src-tauri/src/main.rs`:

```rust
use agent_hub_gui::commands::{
    close_terminal, get_agent_profiles, get_messages, get_projects, get_sessions,
    list_directory, open_in_terminal, read_file, resize_terminal, search_sessions,
    send_to_terminal, spawn_shell, spawn_terminal, write_file,
    load_workspace_state, save_workspace_state, load_global_workspace_state, save_global_workspace_state,
};
use agent_hub_gui::settings::Settings;
use agent_hub_gui::workspace::WorkspaceManager;

fn main() {
    let settings = Settings::load().expect("Failed to load settings");
    let workspace_manager = WorkspaceManager::new(settings.config_dir.clone())
        .expect("Failed to initialize workspace manager");

    tauri::Builder::default()
        .manage(TerminalState::new())
        .manage(AgentRegistry::from_settings(&settings))
        .manage(workspace_manager)
        .invoke_handler(tauri::generate![
            get_projects,
            get_sessions,
            get_messages,
            get_agent_profiles,
            spawn_terminal,
            send_to_terminal,
            resize_terminal,
            close_terminal,
            read_file,
            write_file,
            list_directory,
            spawn_shell,
            open_in_terminal,
            search_sessions,
            load_workspace_state,
            save_workspace_state,
            load_global_workspace_state,
            save_global_workspace_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: 编译检查**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat: expose workspace state Tauri commands"
```

---

### Task 3: 前端 useWorkspaceState Hook

**Files:**
- Create: `src/hooks/useWorkspaceState.ts`

**Interfaces:**
- Consumes: Tauri commands `load_workspace_state`, `save_workspace_state`, `load_global_workspace_state`, `save_global_workspace_state`
- Produces: `WorkspaceStateAPI` object with `loadProjectState`, `saveProjectState`, `loadGlobalState`, `saveGlobalState`

- [ ] **Step 1: 创建 hook 文件**

Create `src/hooks/useWorkspaceState.ts`:

```typescript
import { useCallback } from 'react'

const isTauri = typeof window !== 'undefined' && window.__TAURI__

export interface SerializedTabShell {
  type: 'shell'
  id: string
  title: string
  project_path: string
}

export interface SerializedTabSession {
  type: 'session'
  id: string
  title: string
  agent: string
  session_id: string
  project_path: string
}

export interface SerializedTabFile {
  type: 'file'
  id: string
  title: string
  file_path: string
  project_path: string
}

export type SerializedTab = SerializedTabShell | SerializedTabSession | SerializedTabFile

export interface ProjectWorkspaceState {
  version: number
  project_path: string
  expanded_dirs: string[]
  expanded_projects: string[]
  tabs: SerializedTab[]
  active_tab_id: string | null
}

export interface GlobalWorkspaceState {
  version: number
  last_project_path: string | null
  window_width: number | null
  window_height: number | null
  window_maximized: boolean | null
}

export interface WorkspaceStateAPI {
  loadProjectState: (projectPath: string) => Promise<ProjectWorkspaceState>
  saveProjectState: (state: ProjectWorkspaceState) => Promise<void>
  loadGlobalState: () => Promise<GlobalWorkspaceState>
  saveGlobalState: (state: GlobalWorkspaceState) => Promise<void>
}

const defaultProjectState = (projectPath: string): ProjectWorkspaceState => ({
  version: 1,
  project_path: projectPath,
  expanded_dirs: [],
  expanded_projects: [],
  tabs: [],
  active_tab_id: null,
})

const defaultGlobalState = (): GlobalWorkspaceState => ({
  version: 1,
  last_project_path: null,
  window_width: null,
  window_height: null,
  window_maximized: null,
})

export function useWorkspaceState(): WorkspaceStateAPI {
  const loadProjectState = useCallback(async (projectPath: string): Promise<ProjectWorkspaceState> => {
    if (!isTauri) {
      return defaultProjectState(projectPath)
    }
    const { invoke } = await import('@tauri-apps/api/tauri')
    return await invoke<ProjectWorkspaceState>('load_workspace_state', { project_path: projectPath })
  }, [])

  const saveProjectState = useCallback(async (state: ProjectWorkspaceState): Promise<void> => {
    if (!isTauri) {
      return
    }
    const { invoke } = await import('@tauri-apps/api/tauri')
    await invoke('save_workspace_state', { state })
  }, [])

  const loadGlobalState = useCallback(async (): Promise<GlobalWorkspaceState> => {
    if (!isTauri) {
      return defaultGlobalState()
    }
    const { invoke } = await import('@tauri-apps/api/tauri')
    return await invoke<GlobalWorkspaceState>('load_global_workspace_state')
  }, [])

  const saveGlobalState = useCallback(async (state: GlobalWorkspaceState): Promise<void> => {
    if (!isTauri) {
      return
    }
    const { invoke } = await import('@tauri-apps/api/tauri')
    await invoke('save_global_workspace_state', { state })
  }, [])

  return {
    loadProjectState,
    saveProjectState,
    loadGlobalState,
    saveGlobalState,
  }
}
```

- [ ] **Step 2: TypeScript 检查**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useWorkspaceState.ts
git commit -m "feat: add useWorkspaceState hook"
```

---

### Task 4: App.tsx 集成 Workspace 状态

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useWorkspaceState` from Task 3, `ProjectWorkspaceState`, `SerializedTab`, `GlobalWorkspaceState`
- Produces: `App.tsx` 启动时恢复、切换项目时保存/恢复、tabs 变化自动保存

- [ ] **Step 1: 引入 hook 和类型**

Add to imports in `src/App.tsx`:

```typescript
import { useWorkspaceState, SerializedTab, ProjectWorkspaceState, GlobalWorkspaceState } from './hooks/useWorkspaceState'
```

- [ ] **Step 2: 添加状态转换函数**

Add helper functions in `src/App.tsx` (after the `TerminalTab` interface):

```typescript
function serializeTab(tab: TerminalTab): SerializedTab {
  if (tab.type === 'shell') {
    return {
      type: 'shell',
      id: tab.id,
      title: tab.title,
      project_path: tab.projectPath,
    }
  }
  if (tab.type === 'session') {
    return {
      type: 'session',
      id: tab.id,
      title: tab.title,
      agent: tab.agent || '',
      session_id: tab.sessionId || '',
      project_path: tab.projectPath,
    }
  }
  return {
    type: 'file',
    id: tab.id,
    title: tab.title,
    file_path: tab.filePath || '',
    project_path: tab.projectPath,
  }
}

function deserializeTab(tab: SerializedTab): TerminalTab | null {
  if (tab.type === 'shell') {
    return {
      id: tab.id,
      type: 'shell',
      title: tab.title,
      projectPath: tab.project_path,
    }
  }
  if (tab.type === 'session') {
    return {
      id: tab.id,
      type: 'session',
      title: tab.title,
      agent: tab.agent,
      sessionId: tab.session_id,
      projectPath: tab.project_path,
    }
  }
  if (tab.type === 'file') {
    return {
      id: tab.id,
      type: 'file',
      title: tab.title,
      projectPath: tab.project_path,
      filePath: tab.file_path,
    }
  }
  return null
}

function buildProjectState(
  projectPath: string,
  tabs: TerminalTab[],
  activeTabId: string | null,
  expandedDirs: string[],
  expandedProjects: string[]
): ProjectWorkspaceState {
  return {
    version: 1,
    project_path: projectPath,
    expanded_dirs: expandedDirs,
    expanded_projects: expandedProjects,
    tabs: tabs.map(serializeTab),
    active_tab_id: activeTabId,
  }
}
```

- [ ] **Step 3: 修改 App 组件**

Inside `App()` function, after existing state declarations, add:

```typescript
const { loadProjectState, saveProjectState, loadGlobalState, saveGlobalState } = useWorkspaceState()
const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
```

Add `restoreProjectState` function inside `App()` (before `loadData`):

```typescript
const restoreProjectState = (state: ProjectWorkspaceState) => {
  setExpandedDirs(new Set(state.expanded_dirs))
  setExpandedProjects(new Set(state.expanded_projects))

  const restoredTabs: TerminalTab[] = []
  for (const tab of state.tabs) {
    const restored = deserializeTab(tab)
    if (restored) {
      restoredTabs.push(restored)
    }
  }
  setTabs(restoredTabs)
  setActiveTabId(state.active_tab_id)
}
```

Modify `loadData` to load global state first and then project state:

```typescript
const loadData = async () => {
  try {
    setLoading(true)

    let sessionsData: Session[] = []
    if (isTauri) {
      const { invoke } = await import('@tauri-apps/api/tauri')
      sessionsData = await invoke<Session[]>('get_sessions', {})
    } else {
      sessionsData = mockSessions
    }
    setSessions(sessionsData)

    if (isTauri) {
      const global = await loadGlobalState()
      const lastProject = global.last_project_path
      if (lastProject && sessionsData.some((s) => s.project === lastProject)) {
        setSelectedProject(lastProject)
        const projectState = await loadProjectState(lastProject)
        restoreProjectState(projectState)
      }
    }
  } catch (err) {
    console.error('Error loading data:', err)
    if (!isTauri) {
      setSessions(mockSessions)
    }
  } finally {
    setLoading(false)
  }
}
```

- [ ] **Step 4: 处理项目切换和自动保存**

Replace the existing `selectProject` callback with:

```typescript
const selectProject = useCallback(async (path: string | null) => {
  const previousProject = selectedProject
  if (previousProject && isTauri) {
    const state = buildProjectState(
      previousProject,
      tabs,
      activeTabId,
      Array.from(expandedDirs),
      Array.from(expandedProjects)
    )
    await saveProjectState(state).catch((err) => console.error('Failed to save workspace state:', err))
  }

  setSelectedProject(path)

  if (path && isTauri) {
    const state = await loadProjectState(path)
    restoreProjectState(state)
  } else {
    setExpandedDirs(new Set())
    setExpandedProjects(new Set())
    setTabs([])
    setActiveTabId(null)
  }
}, [selectedProject, tabs, activeTabId, expandedDirs, expandedProjects, saveProjectState, loadProjectState])
```

Add auto-save effect for tabs/activeTabId/expandedDirs/expandedProjects:

```typescript
useEffect(() => {
  if (!selectedProject || !isTauri) return

  const state = buildProjectState(
    selectedProject,
    tabs,
    activeTabId,
    Array.from(expandedDirs),
    Array.from(expandedProjects)
  )

  const timer = setTimeout(() => {
    saveProjectState(state).catch((err) => console.error('Failed to auto-save workspace state:', err))
  }, 500)

  return () => clearTimeout(timer)
}, [selectedProject, tabs, activeTabId, expandedDirs, expandedProjects, saveProjectState])
```

- [ ] **Step 5: TypeScript 检查**

Run: `npx tsc --noEmit`
Expected: PASS. Fix any missing dependencies in `useCallback`/`useEffect` dependency arrays.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: integrate workspace persistence into App"
```

---

### Task 5: Sidebar 状态提升

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `expandedProjects` Set from App
- Produces: Sidebar no longer owns `expandedProjects`; it receives as prop and calls `onExpandedProjectsChange`

- [ ] **Step 1: 修改 Sidebar props**

Change `SidebarProps` in `src/components/Sidebar.tsx`:

```typescript
interface SidebarProps {
  sessions: Session[]
  selectedProject: string | null
  onSelectProject: (project: string | null) => void
  onOpenShell: (projectPath: string) => void
  onOpenSession: (session: Session) => void
  expandedProjects: Set<string>
  onExpandedProjectsChange: (expanded: Set<string>) => void
}
```

Remove the local state:

```typescript
// Remove this line:
// const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
```

Update `toggleProject` to use the prop callback:

```typescript
const toggleProject = (projectPath: string) => {
  const newExpanded = new Set(expandedProjects)
  if (newExpanded.has(projectPath)) {
    newExpanded.delete(projectPath)
  } else {
    newExpanded.add(projectPath)
  }
  onExpandedProjectsChange(newExpanded)
}
```

Update function signature and destructuring:

```typescript
function Sidebar({
  sessions,
  selectedProject,
  onSelectProject,
  onOpenShell,
  onOpenSession,
  expandedProjects,
  onExpandedProjectsChange,
}: SidebarProps) {
```

- [ ] **Step 2: App.tsx 传入新 props**

Modify the `<Sidebar>` usage in `src/App.tsx`:

```tsx
<Sidebar
  sessions={sessions}
  selectedProject={selectedProject}
  onSelectProject={selectProject}
  onOpenShell={openShellTab}
  onOpenSession={openSessionTab}
  expandedProjects={expandedProjects}
  onExpandedProjectsChange={setExpandedProjects}
/>
```

- [ ] **Step 3: TypeScript 检查**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx
git commit -m "refactor: lift expandedProjects state from Sidebar to App"
```

---

### Task 6: FilePanel 状态提升

**Files:**
- Modify: `src/components/FilePanel.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `expandedDirs` Set from App
- Produces: FilePanel no longer owns `expandedDirs`; it receives as prop and calls `onExpandedDirsChange`

- [ ] **Step 1: 修改 FilePanel props**

Change `FilePanelProps` in `src/components/FilePanel.tsx`:

```typescript
interface FilePanelProps {
  projectPath: string | null
  onOpenFile?: (filePath: string) => void
  expandedDirs: Set<string>
  onExpandedDirsChange: (expanded: Set<string>) => void
}
```

Remove local state and update component signature:

```typescript
function FilePanel({ projectPath, onOpenFile, expandedDirs, onExpandedDirsChange }: FilePanelProps) {
  // Remove: const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [dirEntries, setDirEntries] = useState<Map<string, DirEntry[]>>(new Map())
  // ... rest unchanged
```

In the root loading effect, replace:

```typescript
setExpandedDirs((prev) => {
  const next = new Set(prev)
  next.add(projectPath)
  return next
})
```
with:

```typescript
onExpandedDirsChange(new Set(expandedDirs).add(projectPath))
```

In `toggleDir`, replace the collapse branch:

```typescript
setExpandedDirs((prev) => {
  const next = new Set(prev)
  next.delete(path)
  return next
})
```
with:

```typescript
onExpandedDirsChange(() => {
  const next = new Set(expandedDirs)
  next.delete(path)
  return next
}())
```

Or more simply:

```typescript
const next = new Set(expandedDirs)
next.delete(path)
onExpandedDirsChange(next)
```

And replace the final expand branch:

```typescript
setExpandedDirs((prev) => {
  const next = new Set(prev)
  next.add(path)
  return next
})
```
with:

```typescript
onExpandedDirsChange(new Set(expandedDirs).add(path))
```

Also update the effect cleanup when `projectPath` is null:

```typescript
if (!projectPath || projectPath === '未分类') {
  setExpandedDirs(new Set())
  setDirEntries(new Map())
  setError(null)
  return
}
```
becomes:

```typescript
if (!projectPath || projectPath === '未分类') {
  onExpandedDirsChange(new Set())
  setDirEntries(new Map())
  setError(null)
  return
}
```

- [ ] **Step 2: App.tsx 传入新 props**

Modify the `<FilePanel>` usage in `src/App.tsx`:

```tsx
<FilePanel
  projectPath={selectedProject}
  onOpenFile={openFileTab}
  expandedDirs={expandedDirs}
  onExpandedDirsChange={setExpandedDirs}
/>
```

- [ ] **Step 3: TypeScript 检查**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/FilePanel.tsx src/App.tsx
git commit -m "refactor: lift expandedDirs state from FilePanel to App"
```

---

### Task 7: 窗口尺寸与关闭保存

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Tauri window API, `saveGlobalState`
- Produces: global state auto-save on resize and close

- [ ] **Step 1: 添加窗口 resize 监听**

Add inside `App()` after existing effects:

```typescript
useEffect(() => {
  if (!isTauri) return

  let timer: ReturnType<typeof setTimeout> | null = null

  const handleResize = async () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      try {
        const { appWindow } = await import('@tauri-apps/api/window')
        const size = await appWindow.innerSize()
        const isMaximized = await appWindow.isMaximized()
        const current = await loadGlobalState()
        await saveGlobalState({
          ...current,
          window_width: size.width,
          window_height: size.height,
          window_maximized: isMaximized,
        })
      } catch (err) {
        console.error('Failed to save window size:', err)
      }
    }, 500)
  }

  window.addEventListener('resize', handleResize)
  return () => {
    window.removeEventListener('resize', handleResize)
    if (timer) clearTimeout(timer)
  }
}, [loadGlobalState, saveGlobalState])
```

- [ ] **Step 2: 启动时恢复窗口尺寸**

Add effect to restore window size on mount:

```typescript
useEffect(() => {
  if (!isTauri) return

  const restoreWindow = async () => {
    try {
      const global = await loadGlobalState()
      const { appWindow, LogicalSize } = await import('@tauri-apps/api/window')
      if (global.window_maximized) {
        await appWindow.maximize()
      } else if (global.window_width && global.window_height) {
        await appWindow.setSize(new LogicalSize(global.window_width, global.window_height))
      }
    } catch (err) {
      console.error('Failed to restore window size:', err)
    }
  }

  restoreWindow()
}, [loadGlobalState])
```

- [ ] **Step 3: 关闭前保存全局状态**

Add effect:

```typescript
useEffect(() => {
  if (!isTauri) return

  const handleBeforeUnload = async () => {
    if (selectedProject) {
      const state = buildProjectState(
        selectedProject,
        tabs,
        activeTabId,
        Array.from(expandedDirs),
        Array.from(expandedProjects)
      )
      await saveProjectState(state).catch((err) => console.error('Failed to save project state on close:', err))
    }
    const global = await loadGlobalState()
    await saveGlobalState({
      ...global,
      last_project_path: selectedProject,
    }).catch((err) => console.error('Failed to save global state on close:', err))
  }

  window.addEventListener('beforeunload', handleBeforeUnload)
  return () => window.removeEventListener('beforeunload', handleBeforeUnload)
}, [selectedProject, tabs, activeTabId, expandedDirs, expandedProjects, saveProjectState, saveGlobalState, loadGlobalState])
```

- [ ] **Step 4: TypeScript 检查**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: persist window size and save state on close"
```

---

### Task 8: 全局验证

**Files:**
- All modified files

- [ ] **Step 1: Rust 编译检查**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS with no errors or warnings.

- [ ] **Step 2: TypeScript 检查**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: 生产构建**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: 功能验证（手动）**

1. 启动应用，选择一个项目。
2. 在文件树中展开几个目录。
3. 打开一个 shell 标签页和一个文件标签页。
4. 调整窗口大小。
5. 关闭应用。
6. 重新启动应用，确认：
   - 窗口尺寸恢复
   - 上次选中的项目被选中
   - 文件树展开目录恢复
   - 标签页恢复，激活标签正确
7. 检查 `~/.agent-hub/workspaces/` 下生成了对应文件。

- [ ] **Step 5: Commit any final fixes and finish**

```bash
git add -A
git commit -m "feat: workspace state persistence per project"
```

---

## Self-Review Checklist

- [ ] Spec coverage: 每个需求都有对应任务。
- [ ] Placeholder scan: 无 "TBD"/"TODO"/"implement later"。
- [ ] Type consistency: `ProjectWorkspaceState` / `GlobalWorkspaceState` / `SerializedTab` 在前端和后端字段名一致。
- [ ] Dependency check: 没有新增 Cargo/npm 依赖。
- [ ] Error handling: 保存失败不阻塞用户。
