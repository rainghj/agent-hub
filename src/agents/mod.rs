pub mod claude;
pub mod kimi;
pub mod mimo;

use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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
pub trait Agent {
    /// 获取 agent 名称
    fn name(&self) -> &str;

    /// 获取所有会话
    fn list_sessions(&self) -> Result<Vec<SessionInfo>>;

    /// 获取会话的消息
    fn get_messages(&self, session_id: &str) -> Result<Vec<Message>>;

    /// 获取用户输入历史
    fn get_user_history(&self, session_id: &str) -> Result<Vec<String>>;
}
