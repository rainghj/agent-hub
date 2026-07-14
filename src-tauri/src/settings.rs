use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Agent 配置档案
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentProfile {
    /// 唯一标识，如 claude / mimo / kimi
    pub id: String,
    /// 显示名称，如 "Claude Code"
    pub name: String,
    /// 可执行命令，如 "claude"
    pub command: String,
    /// 恢复/启动会话时的参数模板，用 {session_id} 占位
    pub args_template: Vec<String>,
    /// 数据目录，支持 ~ 表示用户主目录
    pub data_dir: String,
    /// 解析器类型，决定如何读取该 agent 的会话数据
    pub parser: String,
    /// 前端徽标颜色（可选）
    pub icon_color: Option<String>,
}

impl AgentProfile {
    /// 解析数据目录中的 ~ 为用户主目录
    pub fn resolved_data_dir(&self) -> PathBuf {
        if let Some(home) = dirs::home_dir() {
            if self.data_dir.starts_with("~/") || self.data_dir == "~" {
                return home.join(&self.data_dir.trim_start_matches("~/"));
            }
        }
        PathBuf::from(&self.data_dir)
    }

    /// 用 session_id 填充参数模板
    pub fn args_for_session(&self, session_id: &str) -> Vec<String> {
        self.args_template
            .iter()
            .map(|arg| arg.replace("{session_id}", session_id))
            .collect()
    }
}

/// Agent Hub 顶层配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentHubSettings {
    #[serde(default = "default_agents")]
    pub agents: Vec<AgentProfile>,
}

fn default_agents() -> Vec<AgentProfile> {
    vec![
        AgentProfile {
            id: "claude".to_string(),
            name: "Claude Code".to_string(),
            command: "claude".to_string(),
            args_template: vec!["--resume".to_string(), "{session_id}".to_string()],
            data_dir: "~/.claude".to_string(),
            parser: "claude".to_string(),
            icon_color: Some("#cc785c".to_string()),
        },
        AgentProfile {
            id: "mimo".to_string(),
            name: "MiMo Code".to_string(),
            command: "mimo".to_string(),
            args_template: vec!["--session".to_string(), "{session_id}".to_string()],
            data_dir: "~/.local/share/mimocode".to_string(),
            parser: "mimo".to_string(),
            icon_color: Some("#4f8cf7".to_string()),
        },
        AgentProfile {
            id: "kimi".to_string(),
            name: "Kimi Code".to_string(),
            command: "kimi".to_string(),
            args_template: vec!["--session".to_string(), "{session_id}".to_string()],
            data_dir: "~/.kimi-code".to_string(),
            parser: "kimi".to_string(),
            icon_color: Some("#10b981".to_string()),
        },
    ]
}

/// 设置管理器
pub struct Settings {
    pub settings: AgentHubSettings,
    #[allow(dead_code)]
    pub config_dir: PathBuf,
}

impl Settings {
    /// 加载或创建默认配置
    pub fn load() -> Result<Self> {
        let config_dir = dirs::home_dir()
            .context("Failed to get home directory")?
            .join(".agent-hub");

        fs::create_dir_all(&config_dir)
            .with_context(|| format!("Failed to create config dir {:?}", config_dir))?;

        let config_path = config_dir.join("agents.json");

        let settings = if config_path.exists() {
            let content = fs::read_to_string(&config_path)
                .with_context(|| format!("Failed to read {:?}", config_path))?;
            serde_json::from_str(&content)
                .with_context(|| format!("Failed to parse {:?}", config_path))?
        } else {
            let default = AgentHubSettings { agents: default_agents() };
            let content = serde_json::to_string_pretty(&default)
                .context("Failed to serialize default settings")?;
            fs::write(&config_path, content)
                .with_context(|| format!("Failed to write default config to {:?}", config_path))?;
            default
        };

        Ok(Self { settings, config_dir })
    }

    pub fn agents(&self) -> &[AgentProfile] {
        &self.settings.agents
    }

    #[allow(dead_code)]
    pub fn agent_by_id(&self, id: &str) -> Option<&AgentProfile> {
        self.settings.agents.iter().find(|a| a.id == id)
    }
}
