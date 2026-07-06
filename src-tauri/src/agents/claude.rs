use super::{Agent, Message, ProjectInfo, SessionInfo};
use anyhow::{Context, Result};
use chrono::{TimeZone, Utc};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

pub struct ClaudeAgent {
    base_dir: PathBuf,
}

#[derive(Deserialize)]
struct HistoryEntry {
    display: String,
    timestamp: Option<i64>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    project: Option<String>,
}

#[derive(Deserialize)]
struct SessionFile {
    pid: Option<u32>,
    session_id: Option<String>,
    cwd: Option<String>,
    started_at: Option<i64>,
    status: Option<String>,
    updated_at: Option<i64>,
}

impl ClaudeAgent {
    pub fn new() -> Self {
        let base_dir = dirs::home_dir()
            .unwrap_or_default()
            .join(".claude");
        Self { base_dir }
    }
}

impl Agent for ClaudeAgent {
    fn name(&self) -> &str {
        "claude"
    }

    fn list_projects(&self) -> Result<Vec<ProjectInfo>> {
        let mut projects: HashMap<String, ProjectInfo> = HashMap::new();
        let history_path = self.base_dir.join("history.jsonl");

        if history_path.exists() {
            let content = fs::read_to_string(&history_path)?;
            let mut project_sessions: HashMap<String, HashSet<String>> = HashMap::new();

            for line in content.lines() {
                if let Ok(entry) = serde_json::from_str::<HistoryEntry>(line) {
                    if let (Some(project), Some(sid)) = (&entry.project, &entry.session_id) {
                        project_sessions
                            .entry(project.clone())
                            .or_insert_with(HashSet::new)
                            .insert(sid.clone());
                    }
                }
            }

            for (project_path, sessions) in project_sessions {
                let name = project_path
                    .rsplit('\\')
                    .next()
                    .unwrap_or(&project_path)
                    .to_string();

                projects.insert(project_path.clone(), ProjectInfo {
                    name,
                    agent: "claude".to_string(),
                    path: Some(project_path),
                    session_count: sessions.len(),
                });
            }
        }

        Ok(projects.into_values().collect())
    }

    fn list_sessions(&self) -> Result<Vec<SessionInfo>> {
        let mut sessions = Vec::new();
        let mut seen_sessions: HashSet<String> = HashSet::new();

        let history_path = self.base_dir.join("history.jsonl");
        if history_path.exists() {
            let content = fs::read_to_string(&history_path)?;
            let mut session_map: HashMap<String, (String, Option<String>, i64)> = HashMap::new();

            for line in content.lines() {
                if let Ok(entry) = serde_json::from_str::<HistoryEntry>(line) {
                    if let Some(sid) = &entry.session_id {
                        let timestamp = entry.timestamp.unwrap_or(0);
                        if !session_map.contains_key(sid) {
                            session_map.insert(sid.clone(), (entry.display, entry.project, timestamp));
                        } else if let Some(existing) = session_map.get_mut(sid) {
                            if timestamp > existing.2 {
                                existing.2 = timestamp;
                            }
                        }
                    }
                }
            }

            for (sid, (title, project, timestamp)) in session_map {
                seen_sessions.insert(sid.clone());
                sessions.push(SessionInfo {
                    agent: "claude".to_string(),
                    session_id: sid,
                    title: Some(title),
                    project,
                    status: None,
                    started_at: None,
                    updated_at: Utc.timestamp_millis_opt(timestamp).single(),
                    message_count: None,
                });
            }
        }

        let sessions_dir = self.base_dir.join("sessions");
        if sessions_dir.exists() {
            for entry in fs::read_dir(&sessions_dir)? {
                let entry = entry?;
                let path = entry.path();

                if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    let content = fs::read_to_string(&path)?;
                    if let Ok(file) = serde_json::from_str::<SessionFile>(&content) {
                        let sid = file.session_id.unwrap_or_default();
                        if !seen_sessions.contains(&sid) {
                            sessions.push(SessionInfo {
                                agent: "claude".to_string(),
                                session_id: sid,
                                title: None,
                                project: file.cwd,
                                status: file.status,
                                started_at: file.started_at.and_then(|ts| Utc.timestamp_millis_opt(ts).single()),
                                updated_at: file.updated_at.and_then(|ts| Utc.timestamp_millis_opt(ts).single()),
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
        let history_path = self.base_dir.join("history.jsonl");
        if !history_path.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(&history_path)
            .context("Failed to read Claude history")?;
        let mut messages = Vec::new();

        for line in content.lines() {
            if let Ok(entry) = serde_json::from_str::<HistoryEntry>(line) {
                if entry.session_id.as_deref() == Some(session_id) {
                    messages.push(Message {
                        role: "user".to_string(),
                        content: entry.display,
                        timestamp: entry.timestamp.and_then(|ts| Utc.timestamp_millis_opt(ts).single()),
                    });
                }
            }
        }

        Ok(messages)
    }
}
