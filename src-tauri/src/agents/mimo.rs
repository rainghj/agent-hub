use super::{Agent, Message, ProjectInfo, SessionInfo};
use crate::settings::AgentProfile;
use anyhow::Result;
use chrono::{TimeZone, Utc};
use rusqlite::Connection;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

pub struct MimoAgent {
    profile: AgentProfile,
    db_path: PathBuf,
    memory_dir: PathBuf,
}

impl MimoAgent {
    pub fn new(profile: AgentProfile) -> Self {
        let base_dir = profile.resolved_data_dir();
        let db_path = base_dir.join("mimocode.db");
        let memory_dir = base_dir.join("memory");
        Self { profile, db_path, memory_dir }
    }

    fn agent_id(&self) -> String {
        self.profile.id.clone()
    }

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
        &self.profile.id
    }

    fn list_projects(&self) -> Result<Vec<ProjectInfo>> {
        let mut projects = Vec::new();
        let sessions_dir = self.memory_dir.join("sessions");

        if sessions_dir.exists() {
            // 从 checkpoint 中提取项目信息
            let mut project_sessions: std::collections::HashMap<String, HashSet<String>> = std::collections::HashMap::new();

            for entry in fs::read_dir(&sessions_dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_dir() {
                    let checkpoint = path.join("checkpoint.md");
                    if checkpoint.exists() {
                        if let Some(content) = fs::read_to_string(&checkpoint).ok() {
                            // 尝试从内容中提取项目信息
                            for line in content.lines().take(20) {
                                if line.contains("project") || line.contains("Project") {
                                    let project = line.trim().to_string();
                                    let session_id = path.file_name()
                                        .and_then(|n| n.to_str())
                                        .unwrap_or("")
                                        .to_string();
                                    project_sessions
                                        .entry(project)
                                        .or_insert_with(HashSet::new)
                                        .insert(session_id);
                                }
                            }
                        }
                    }
                }
            }

            // 如果没有找到项目信息，创建一个默认的
            if project_sessions.is_empty() {
                let session_count = fs::read_dir(&sessions_dir)?
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().is_dir())
                    .count();

                if session_count > 0 {
                    projects.push(ProjectInfo {
                        name: "MiMo Sessions".to_string(),
                        agent: self.agent_id(),
                        path: None,
                        session_count,
                    });
                }
            } else {
                for (project, sessions) in project_sessions {
                    projects.push(ProjectInfo {
                        name: project,
                        agent: self.agent_id(),
                        path: None,
                        session_count: sessions.len(),
                    });
                }
            }
        }

        Ok(projects)
    }

    fn list_sessions(&self) -> Result<Vec<SessionInfo>> {
        let mut sessions = Vec::new();

        // 从 memory 目录读取会话信息
        if self.memory_dir.exists() {
            let sessions_dir = self.memory_dir.join("sessions");
            if sessions_dir.exists() {
                for entry in fs::read_dir(&sessions_dir)? {
                    let entry = entry?;
                    let path = entry.path();
                    if path.is_dir() {
                        let session_id = path.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_string();

                        let checkpoint = path.join("checkpoint.md");
                        if checkpoint.exists() {
                            let title = Self::extract_topic(&checkpoint);
                            sessions.push(SessionInfo {
                                agent: self.agent_id(),
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

        // 也从 SQLite 数据库读取
        if self.db_path.exists() {
            if let Ok(conn) = Connection::open(&self.db_path) {
                let tables: Vec<String> = conn
                    .prepare("SELECT name FROM sqlite_master WHERE type='table'")?
                    .query_map([], |row| row.get(0))?
                    .filter_map(|r| r.ok())
                    .collect();

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
                        if !sessions.iter().any(|s| s.session_id == id) {
                            let checkpoint = self.memory_dir.join("sessions").join(&id).join("checkpoint.md");
                            let title = Self::extract_topic(&checkpoint);
                            sessions.push(SessionInfo {
                                agent: self.agent_id(),
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
                }
            }
        }

        Ok(sessions)
    }

    fn get_messages(&self, session_id: &str) -> Result<Vec<Message>> {
        let mut messages = Vec::new();

        // 从 checkpoint.md 读取
        let checkpoint = self.memory_dir
            .join("sessions")
            .join(session_id)
            .join("checkpoint.md");

        if checkpoint.exists() {
            let content = fs::read_to_string(&checkpoint)?;
            messages.push(Message {
                role: "system".to_string(),
                content,
                timestamp: None,
            });
        }

        // 从 SQLite 读取
        if self.db_path.exists() {
            if let Ok(conn) = Connection::open(&self.db_path) {
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
            }
        }

        Ok(messages)
    }
}
