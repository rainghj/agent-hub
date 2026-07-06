use crate::agents::{claude::ClaudeAgent, kimi::KimiAgent, mimo::MimoAgent, Agent};
use anyhow::{Context, Result};
use colored::*;

pub fn run(session_id: &str, format: &str) -> Result<()> {
    let agents: Vec<Box<dyn Agent>> = vec![
        Box::new(ClaudeAgent::new()),
        Box::new(MimoAgent::new()),
        Box::new(KimiAgent::new()),
    ];

    for agent in &agents {
        let messages = agent.get_messages(session_id)
            .context(format!("Failed to get messages from {}", agent.name()))?;

        if !messages.is_empty() {
            println!(
                "{} {} ({})",
                "Session".bold().cyan(),
                session_id.bold(),
                agent.name().green()
            );
            println!("{}", "=".repeat(60));
            println!();

            for msg in &messages {
                match format {
                    "markdown" => {
                        let role_colored = match msg.role.as_str() {
                            "user" => msg.role.blue().bold(),
                            "assistant" => msg.role.green().bold(),
                            "system" => msg.role.yellow().bold(),
                            _ => msg.role.normal(),
                        };
                        println!("### {}", role_colored);
                        if let Some(ts) = msg.timestamp {
                            println!("*{}*", ts.format("%Y-%m-%d %H:%M:%S UTC"));
                        }
                        println!();
                        println!("{}", msg.content);
                        println!();
                    }
                    _ => {
                        let role_colored = match msg.role.as_str() {
                            "user" => msg.role.blue().bold(),
                            "assistant" => msg.role.green().bold(),
                            "system" => msg.role.yellow().bold(),
                            _ => msg.role.normal(),
                        };
                        println!("[{}] {}", role_colored, msg.content);
                        println!();
                    }
                }
            }

            println!("{}", "-".repeat(60));
            println!("{} messages", messages.len().to_string().bold());
            return Ok(());
        }
    }

    eprintln!("{}: Session '{}' not found", "Error".red().bold(), session_id);
    Ok(())
}
