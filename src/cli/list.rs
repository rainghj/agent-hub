use anyhow::Result;
use colored::Colorize;

pub fn run() -> Result<()> {
    let res = crate::cli::ipc::request("list", None, None)?;

    if let Some(sessions) = res["data"].as_array() {
        if sessions.is_empty() {
            println!("当前没有运行中的终端会话。");
            return Ok(());
        }

        println!("{}", "运行中的终端会话:".bold());
        println!();
        for session in sessions {
            let id = session["id"].as_str().unwrap_or("?");
            let title = session["title"].as_str().unwrap_or("?");
            let cwd = session["cwd"].as_str().unwrap_or("?");
            let agent = session["agent"].as_str().unwrap_or("-");
            println!("  {} {} (agent: {}, cwd: {})", "●".green(), title.cyan(), agent, cwd);
            println!("    ID: {}", id.dimmed());
        }
    }

    Ok(())
}
