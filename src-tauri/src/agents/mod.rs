pub mod claude;
pub mod kimi;
pub mod mimo;

use crate::settings::AgentProfile;
use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// 统一的项目信息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub name: String,
    pub agent: String,
    pub path: Option<String>,
    pub session_count: usize,
}

/// 统一的会话信息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub agent: String,
    pub session_id: String,
    pub title: Option<String>,
    pub project: Option<String>,
    pub status: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub message_count: Option<usize>,
}

/// 统一的消息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
    pub timestamp: Option<DateTime<Utc>>,
}

/// Agent trait 定义
pub trait Agent: Send + Sync {
    /// 获取 agent 名称（即 profile id）
    fn name(&self) -> &str;

    /// 获取所有会话
    fn list_sessions(&self) -> Result<Vec<SessionInfo>>;

    /// 获取会话的消息
    fn get_messages(&self, session_id: &str) -> Result<Vec<Message>>;

    /// 获取项目列表
    fn list_projects(&self) -> Result<Vec<ProjectInfo>>;
}

/// Agent 注册表：根据配置创建对应的 Agent 实例
pub struct AgentRegistry {
    agents: Vec<Arc<dyn Agent>>,
    profiles: Vec<AgentProfile>,
}

impl AgentRegistry {
    /// 从 agent profiles 创建 registry
    pub fn from_profiles(profiles: &[AgentProfile]) -> Result<Self> {
        let mut agents: Vec<Arc<dyn Agent>> = Vec::new();
        let mut loaded_profiles = Vec::new();

        for profile in profiles {
            let agent: Arc<dyn Agent> = match profile.parser.as_str() {
                "claude" => Arc::new(claude::ClaudeAgent::new(profile.clone())),
                "kimi" => Arc::new(kimi::KimiAgent::new(profile.clone())),
                "mimo" => Arc::new(mimo::MimoAgent::new(profile.clone())),
                other => anyhow::bail!("Unknown agent parser: {}", other),
            };
            agents.push(agent);
            loaded_profiles.push(profile.clone());
        }

        Ok(Self { agents, profiles: loaded_profiles })
    }

    pub fn agents(&self) -> &[Arc<dyn Agent>] {
        &self.agents
    }

    pub fn profiles(&self) -> &[AgentProfile] {
        &self.profiles
    }

    pub fn profile_by_id(&self, id: &str) -> Option<&AgentProfile> {
        self.profiles.iter().find(|p| p.id == id)
    }

    pub fn agent_by_name(&self, name: &str) -> Option<&Arc<dyn Agent>> {
        self.agents.iter().find(|a| a.name() == name)
    }

    /// 获取所有 agent 名称
    #[allow(dead_code)]
    pub fn agent_names(&self) -> Vec<String> {
        self.agents.iter().map(|a| a.name().to_string()).collect()
    }
}

/// 方便从 agent profiles 直接构建 registry 的辅助函数
#[allow(dead_code)]
pub fn create_registry(profiles: &[AgentProfile]) -> Result<AgentRegistry> {
    AgentRegistry::from_profiles(profiles)
}
