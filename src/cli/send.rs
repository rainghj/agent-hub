use anyhow::Result;

pub fn run(session_id: &str, text: &str) -> Result<()> {
    crate::cli::ipc::request("send", Some(session_id), Some(text))?;
    println!("已发送到 {}: {}", session_id, text);
    Ok(())
}
