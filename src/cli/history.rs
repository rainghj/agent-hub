use crate::agents::{claude::ClaudeAgent, kimi::KimiAgent, mimo::MimoAgent, Agent};
use anyhow::Result;
use colored::*;

pub fn run(
    agent_filter: &Option<String>,
    project_filter: &Option<String>,
    search: &Option<String>,
    limit: usize,
) -> Result<()> {
    println!("{}", "Agent Hub - History".bold().cyan());
    println!();

    let agents: Vec<Box<dyn Agent>> = vec![
        Box::new(ClaudeAgent::new()),
        Box::new(MimoAgent::new()),
        Box::new(KimiAgent::new()),
    ];

    let mut all_sessions = Vec::new();

    for agent in &agents {
        // 应用 agent 过滤
        if let Some(ref filter) = agent_filter {
            if agent.name() != filter.as_str() {
                continue;
            }
        }

        match agent.list_sessions() {
            Ok(sessions) => {
                for session in sessions {
                    // 应用 project 过滤
                    if let Some(ref filter) = project_filter {
                        match &session.project {
                            Some(p) if p.contains(filter.as_str()) => {},
                            _ => continue,
                        }
                    }

                    // 应用搜索过滤
                    if let Some(ref query) = search {
                        if let Ok(messages) = agent.get_messages(&session.session_id) {
                            let has_match = messages.iter().any(|m| {
                                m.content.to_lowercase().contains(&query.to_lowercase())
                            });
                            if !has_match {
                                continue;
                            }
                        }
                    }

                    all_sessions.push(session);
                }
            }
            Err(e) => {
                eprintln!("{}: {}", agent.name().red(), e);
            }
        }
    }

    // 按更新时间排序
    all_sessions.sort_by(|a, b| {
        b.updated_at
            .unwrap_or_default()
            .cmp(&a.updated_at.unwrap_or_default())
    });

    // 限制数量
    all_sessions.truncate(limit);

    if all_sessions.is_empty() {
        println!("{}", "No sessions found.".yellow());
        return Ok(());
    }

    // 表头
    println!(
        "{:<10} {:<50} {:<15} {:<10}",
        "Agent".bold(),
        "Title / Session ID".bold(),
        "Updated".bold(),
        "Status".bold()
    );
    println!("{}", "-".repeat(85));

    for session in &all_sessions {
        // 优先显示 title，否则显示 session_id
        let display_name = if let Some(ref title) = session.title {
            if title.chars().count() > 48 {
                let truncated: String = title.chars().take(45).collect();
                format!("{}...", truncated)
            } else {
                title.clone()
            }
        } else {
            if session.session_id.len() > 48 {
                format!("...{}", &session.session_id[session.session_id.len()-45..])
            } else {
                session.session_id.clone()
            }
        };

        let updated = session.updated_at
            .map(|t| {
                let now = chrono::Utc::now();
                let diff = now - t;
                if diff.num_days() > 0 {
                    format!("{}d ago", diff.num_days())
                } else if diff.num_hours() > 0 {
                    format!("{}h ago", diff.num_hours())
                } else {
                    format!("{}m ago", diff.num_minutes())
                }
            })
            .unwrap_or_else(|| "-".to_string());

        let status = session.status.as_deref().unwrap_or("unknown");

        println!(
            "{:<10} {:<50} {:<15} {:<10}",
            session.agent.green(),
            display_name,
            updated,
            status
        );
    }

    println!();
    println!("{} sessions found", all_sessions.len().to_string().bold());

    Ok(())
}
