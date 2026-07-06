use super::{Agent, Message, SessionInfo};
use anyhow::{Context, Result};
use chrono::{TimeZone, Utc};
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;

pub struct KimiAgent {
    base_dir: PathBuf,
}

#[derive(Deserialize)]
struct SessionIndexEntry {
    session_id: Option<String>,
    workspace: Option<String>,
    created_at: Option<i64>,
    #[serde(flatten)]
    extra: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Deserialize)]
struct SessionState {
    session_id: Option<String>,
    status: Option<String>,
    created_at: Option<i64>,
    updated_at: Option<i64>,
}

#[derive(Deserialize)]
struct WireMessage {
    r#type: Option<String>,
    role: Option<String>,
    content: Option<String>,
    input: Option<Vec<WireInput>>,
    origin: Option<WireOrigin>,
    time: Option<i64>,
    #[serde(flatten)]
    extra: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Deserialize)]
struct WireInput {
    r#type: Option<String>,
    text: Option<String>,
}

#[derive(Deserialize)]
struct WireOrigin {
    kind: Option<String>,
}

impl KimiAgent {
    pub fn new() -> Self {
        let base_dir = dirs::home_dir()
            .unwrap_or_default()
            .join(".kimi-code");
        Self { base_dir }
    }

    fn list_workspaces(&self) -> Result<Vec<(String, PathBuf)>> {
        let sessions_dir = self.base_dir.join("sessions");
        let mut workspaces = Vec::new();

        if !sessions_dir.exists() {
            return Ok(workspaces);
        }

        for entry in fs::read_dir(&sessions_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                workspaces.push((name, path));
            }
        }

        Ok(workspaces)
    }
}

impl Agent for KimiAgent {
    fn name(&self) -> &str {
        "kimi"
    }

    fn list_sessions(&self) -> Result<Vec<SessionInfo>> {
        let mut sessions = Vec::new();
        let workspaces = self.list_workspaces()?;

        for (_ws_name, ws_path) in workspaces {
            for entry in fs::read_dir(&ws_path)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_dir() {
                    let session_name = path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string();

                    if session_name.starts_with("session_") {
                        let session_id = session_name.strip_prefix("session_").unwrap_or(&session_name).to_string();

                        // 读取 state.json
                        let state_path = path.join("state.json");
                        let mut status = None;
                        let mut created_at = None;
                        let mut updated_at = None;

                        if state_path.exists() {
                            if let Ok(content) = fs::read_to_string(&state_path) {
                                if let Ok(state) = serde_json::from_str::<SessionState>(&content) {
                                    status = state.status;
                                    created_at = state.created_at;
                                    updated_at = state.updated_at;
                                }
                            }
                        }

                        // 获取 wire.jsonl 的消息数和第一条用户消息作为 title
                        let wire_path = path.join("agents").join("main").join("wire.jsonl");
                        let mut message_count = 0;
                        let mut title = None;

                        if wire_path.exists() {
                            if let Ok(content) = fs::read_to_string(&wire_path) {
                                message_count = content.lines().count();
                                // 获取第一条用户消息作为 title
                                // Kimi 格式: type="turn.prompt", origin.kind="user", input=[{text:"..."}]
                                for line in content.lines() {
                                    if let Ok(msg) = serde_json::from_str::<WireMessage>(line) {
                                        // 检查是否是用户消息
                                        let is_user = msg.role.as_deref() == Some("user")
                                            || msg.origin.as_ref().map(|o| o.kind.as_deref()) == Some(Some("user"));

                                        if is_user {
                                            // 尝试从 input 字段获取文本
                                            if let Some(inputs) = &msg.input {
                                                for inp in inputs {
                                                    if inp.r#type.as_deref() == Some("text") {
                                                        if let Some(text) = &inp.text {
                                                            title = Some(text.clone());
                                                            break;
                                                        }
                                                    }
                                                }
                                            }
                                            // 如果没有 input，尝试从 content 字段获取
                                            if title.is_none() {
                                                if let Some(content) = &msg.content {
                                                    title = Some(content.clone());
                                                }
                                            }
                                            if title.is_some() {
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        sessions.push(SessionInfo {
                            agent: "kimi".to_string(),
                            session_id,
                            title,
                            project: Some(_ws_name.clone()),
                            status,
                            started_at: created_at.and_then(|ts| Utc.timestamp_millis_opt(ts).single()),
                            updated_at: updated_at.and_then(|ts| Utc.timestamp_millis_opt(ts).single()),
                            message_count: Some(message_count),
                        });
                    }
                }
            }
        }

        Ok(sessions)
    }

    fn get_messages(&self, session_id: &str) -> Result<Vec<Message>> {
        let workspaces = self.list_workspaces()?;
        let mut messages = Vec::new();

        for (_ws_name, ws_path) in &workspaces {
            let session_dir = ws_path.join(format!("session_{}", session_id));
            let wire_path = session_dir.join("agents").join("main").join("wire.jsonl");

            if wire_path.exists() {
                let content = fs::read_to_string(&wire_path)
                    .context("Failed to read Kimi wire.jsonl")?;

                for line in content.lines() {
                    if let Ok(msg) = serde_json::from_str::<WireMessage>(line) {
                        if let (Some(role), Some(content)) = (msg.role, msg.content) {
                            messages.push(Message {
                                role,
                                content,
                                timestamp: msg.time.and_then(|ts| Utc.timestamp_millis_opt(ts).single()),
                            });
                        }
                    }
                }
                break;
            }
        }

        Ok(messages)
    }

    fn get_user_history(&self, session_id: &str) -> Result<Vec<String>> {
        let messages = self.get_messages(session_id)?;
        Ok(messages
            .into_iter()
            .filter(|m| m.role == "user")
            .map(|m| m.content)
            .collect())
    }
}
