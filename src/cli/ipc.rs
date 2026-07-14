use anyhow::{Context, Result};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;

/// 连接到运行中的 Tauri 进程的 IPC 端口
fn connect() -> Result<TcpStream> {
    let config_path = dirs::home_dir()
        .context("Failed to get home dir")?
        .join(".agent-hub")
        .join("ah-ipc.json");

    let content = std::fs::read_to_string(&config_path)
        .context("Agent Hub 未启动（未找到 IPC 配置文件）")?;
    let json: Value = serde_json::from_str(&content)
        .context("IPC 配置文件格式错误")?;
    let port = json["port"]
        .as_u64()
        .context("IPC 配置缺少 port 字段")?;

    let addr = format!("127.0.0.1:{}", port);
    TcpStream::connect(&addr)
        .with_context(|| format!("无法连接到 Agent Hub (127.0.0.1:{})", port))
}

/// 发送 JSON 请求并读取响应
pub fn request(cmd: &str, session_id: Option<&str>, text: Option<&str>) -> Result<Value> {
    let mut stream = connect()?;

    let req = serde_json::json!({
        "cmd": cmd,
        "session_id": session_id,
        "text": text,
    });

    let line = serde_json::to_string(&req)?;
    stream.write_all(line.as_bytes())?;
    stream.write_all(b"\n")?;
    stream.flush()?;

    let mut reader = BufReader::new(&stream);
    let mut response = String::new();
    reader.read_line(&mut response)?;

    let value: Value = serde_json::from_str(response.trim())
        .context("IPC 响应格式错误")?;

    if value["ok"] == false {
        anyhow::bail!("{}", value["error"].as_str().unwrap_or("未知错误"));
    }

    Ok(value)
}
