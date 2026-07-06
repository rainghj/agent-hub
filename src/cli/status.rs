use crate::agents::{claude::ClaudeAgent, kimi::KimiAgent, mimo::MimoAgent, Agent};
use anyhow::Result;
use colored::*;

pub fn run() -> Result<()> {
    println!("{}", "Agent Hub - Status".bold().cyan());
    println!();

    let agents: Vec<Box<dyn Agent>> = vec![
        Box::new(ClaudeAgent::new()),
        Box::new(MimoAgent::new()),
        Box::new(KimiAgent::new()),
    ];

    // 表头
    println!(
        "{:<10} {:<10} {:<40} {:<20} {:<10}",
        "Agent".bold(),
        "Status".bold(),
        "Project".bold(),
        "Started".bold(),
        "Messages".bold()
    );
    println!("{}", "-".repeat(90));

    for agent in &agents {
        match agent.list_sessions() {
            Ok(sessions) => {
                for session in sessions.iter().take(3) {
                    let status = session.status.as_deref().unwrap_or("unknown");
                    let status_colored = match status {
                        "running" | "active" => status.green(),
                        "idle" | "completed" => status.yellow(),
                        "memory" => status.blue(),
                        _ => status.normal(),
                    };

                    let project = session.project.as_deref().unwrap_or("-");
                    let project_display = if project.len() > 38 {
                        format!("...{}", &project[project.len()-35..])
                    } else {
                        project.to_string()
                    };

                    let started = session.started_at
                        .map(|t| {
                            let now = chrono::Utc::now();
                            let diff = now - t;
                            if diff.num_hours() > 24 {
                                format!("{}d ago", diff.num_days())
                            } else if diff.num_hours() > 0 {
                                format!("{}h ago", diff.num_hours())
                            } else {
                                format!("{}m ago", diff.num_minutes())
                            }
                        })
                        .unwrap_or_else(|| "-".to_string());

                    let messages = session.message_count
                        .map(|c| c.to_string())
                        .unwrap_or_else(|| "-".to_string());

                    println!(
                        "{:<10} {:<10} {:<40} {:<20} {:<10}",
                        agent.name().green(),
                        status_colored,
                        project_display,
                        started,
                        messages
                    );
                }
            }
            Err(e) => {
                println!(
                    "{:<10} {:<10}",
                    agent.name().green(),
                    format!("error: {}", e).red()
                );
            }
        }
    }

    Ok(())
}
