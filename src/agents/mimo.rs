use super::{Agent, Message, SessionInfo};
use anyhow::{Context, Result};
use chrono::{TimeZone, Utc};
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;

pub struct MimoAgent {
    db_path: PathBuf,
    memory_dir: PathBuf,
}

impl MimoAgent {
    pub fn new() -> Self {
        let base_dir = dirs::home_dir()
            .unwrap_or_default()
            .join(".local")
            .join("share")
            .join("mimocode");
        let db_path = base_dir.join("mimocode.db");
        let memory_dir = base_dir.join("memory");
        Self { db_path, memory_dir }
    }

    pub fn get_memory_dir(&self) -> &PathBuf {
        &self.memory_dir
    }

    /// 从 checkpoint.md 提取 Topic 作为标题
    fn extract_topic(checkpoint_path: &std::path::Path) -> Option<String> {
        let content = fs::read_to_string(checkpoint_path).ok()?;
        for line in content.lines().take(5) {
            if let Some(topic) = line.strip_prefix("Topic:") {
                return Some(topic.trim().to_string());
            }
        }
        None
    }
}

impl Agent for MimoAgent {
    fn name(&self) -> &str {
        "mimo"
    }

    fn list_sessions(&self) -> Result<Vec<SessionInfo>> {
        if !self.db_path.exists() {
            return Ok(Vec::new());
        }

        let conn = Connection::open(&self.db_path)
            .context("Failed to open MiMo database")?;

        // 尝试查询会话表
        let mut sessions = Vec::new();

        // MiMo 的 SQLite 可能有不同的表结构，先尝试常见表名
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")?
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        // 如果有 sessions 表
        if tables.contains(&"sessions".to_string()) {
            let mut stmt = conn.prepare(
                "SELECT id, project, status, started_at, updated_at FROM sessions ORDER BY updated_at DESC LIMIT 50"
            )?;

            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            })?;

            for row in rows {
                let (id, project, status, started, updated) = row?;
                // 尝试从 memory 目录获取 topic
                let checkpoint = self.memory_dir.join("sessions").join(&id).join("checkpoint.md");
                let title = Self::extract_topic(&checkpoint);
                sessions.push(SessionInfo {
                    agent: "mimo".to_string(),
                    session_id: id,
                    title,
                    project,
                    status,
                    started_at: started.and_then(|ts| Utc.timestamp_millis_opt(ts).single()),
                    updated_at: updated.and_then(|ts| Utc.timestamp_millis_opt(ts).single()),
                    message_count: None,
                });
            }
        }

        // 也从 memory 目录读取会话信息
        if self.memory_dir.exists() {
            let sessions_dir = self.memory_dir.join("sessions");
            if sessions_dir.exists() {
                for entry in std::fs::read_dir(&sessions_dir)? {
                    let entry = entry?;
                    let path = entry.path();
                    if path.is_dir() {
                        let session_id = path.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_string();

                        // 检查是否有 checkpoint.md
                        let checkpoint = path.join("checkpoint.md");
                        if checkpoint.exists() {
                            // 检查是否已在列表中
                            if !sessions.iter().any(|s| s.session_id == session_id) {
                                let title = Self::extract_topic(&checkpoint);
                                sessions.push(SessionInfo {
                                    agent: "mimo".to_string(),
                                    session_id,
                                    title,
                                    project: None,
                                    status: Some("memory".to_string()),
                                    started_at: None,
                                    updated_at: None,
                                    message_count: None,
                                });
                            }
                        }
                    }
                }
            }
        }

        Ok(sessions)
    }

    fn get_messages(&self, session_id: &str) -> Result<Vec<Message>> {
        if !self.db_path.exists() {
            return Ok(Vec::new());
        }

        let conn = Connection::open(&self.db_path)
            .context("Failed to open MiMo database")?;

        let mut messages = Vec::new();

        // 尝试查询消息表
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")?
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        if tables.contains(&"messages".to_string()) {
            let mut stmt = conn.prepare(
                "SELECT role, content, created_at FROM messages WHERE session_id = ?1 ORDER BY created_at"
            )?;

            let rows = stmt.query_map([session_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                ))
            })?;

            for row in rows {
                let (role, content, ts) = row?;
                messages.push(Message {
                    role,
                    content,
                    timestamp: ts.and_then(|t| Utc.timestamp_millis_opt(t).single()),
                });
            }
        }

        // 也读取 checkpoint.md 作为补充
        let checkpoint = self.memory_dir
            .join("sessions")
            .join(session_id)
            .join("checkpoint.md");

        if checkpoint.exists() {
            let content = std::fs::read_to_string(&checkpoint)?;
            if !messages.iter().any(|m| m.content.contains(&content[..100.min(content.len())])) {
                messages.push(Message {
                    role: "system".to_string(),
                    content,
                    timestamp: None,
                });
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
