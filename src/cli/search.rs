use crate::agents::{claude::ClaudeAgent, kimi::KimiAgent, mimo::MimoAgent, Agent};
use anyhow::Result;
use chrono::NaiveDate;
use colored::*;

pub fn run(
    query: &str,
    agent_filter: &Option<String>,
    after: &Option<String>,
    before: &Option<String>,
) -> Result<()> {
    println!(
        "{} '{}'",
        "Searching for".bold().cyan(),
        query.bold()
    );
    println!();

    let agents: Vec<Box<dyn Agent>> = vec![
        Box::new(ClaudeAgent::new()),
        Box::new(MimoAgent::new()),
        Box::new(KimiAgent::new()),
    ];

    let after_date = after
        .as_ref()
        .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());

    let before_date = before
        .as_ref()
        .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());

    let mut total_matches = 0;

    for agent in &agents {
        if let Some(ref filter) = agent_filter {
            if agent.name() != filter.as_str() {
                continue;
            }
        }

        let sessions = agent.list_sessions()?;
        let mut agent_matches = 0;

        for session in &sessions {
            // 时间过滤
            if let Some(after_d) = after_date {
                if let Some(updated) = session.updated_at {
                    if updated.date_naive() < after_d {
                        continue;
                    }
                }
            }
            if let Some(before_d) = before_date {
                if let Some(updated) = session.updated_at {
                    if updated.date_naive() > before_d {
                        continue;
                    }
                }
            }

            if let Ok(messages) = agent.get_messages(&session.session_id) {
                for msg in &messages {
                    if msg.content.to_lowercase().contains(&query.to_lowercase()) {
                        agent_matches += 1;
                        total_matches += 1;

                        let project = session.project.as_deref().unwrap_or("-");
                        println!(
                            "[{}] {} - {}",
                            agent.name().green(),
                            session.session_id[..20.min(session.session_id.len())].yellow(),
                            project.blue()
                        );

                        // 显示匹配上下文
                        let content = &msg.content;
                        let query_lower = query.to_lowercase();
                        if let Some(pos) = content.to_lowercase().find(&query_lower) {
                            let start = pos.saturating_sub(40);
                            let end = (pos + query.len() + 40).min(content.len());
                            let snippet = if start > 0 || end < content.len() {
                                format!("...{}...", &content[start..end])
                            } else {
                                content.to_string()
                            };
                            println!("  {}", snippet.dimmed());
                        }
                        println!();

                        if agent_matches >= 10 {
                            break;
                        }
                    }
                }
            }

            if agent_matches >= 10 {
                break;
            }
        }
    }

    println!("{}", "=".repeat(60));
    println!("{} matches found", total_matches.to_string().bold());

    Ok(())
}
