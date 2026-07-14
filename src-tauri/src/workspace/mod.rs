use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::State;

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
        let hash = stable_hash_hex(&normalized);
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
            .and_then(|s| serde_json::from_str::<ProjectWorkspaceState>(&s).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e)))
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

fn stable_hash_hex(input: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    // 使用 std::collections::hash_map::DefaultHasher 生成稳定的十六进制哈希，
    // 用于派生文件系统安全的文件名（不是 SHA-256）。
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

// ── Tauri commands ──────────────────────────────────────────────

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
