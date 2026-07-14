// IPC 服务器：通过 localhost TCP 接收 ah CLI 的请求并转发给终端/工作区管理器
//
// 协议：JSON over TCP
//   请求 → { "cmd": "list" | "send", ... }
//   响应 → { "ok": true, "data": ... } | { "ok": false, "error": "..." }

use crate::terminal::TerminalManager;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::OnceLock;
use std::thread;

static IPC_MANAGER: OnceLock<IpcSharedState> = OnceLock::new();

pub struct IpcSharedState {
    pub terminal: TerminalManager,
}

pub fn init(terminal: TerminalManager) {
    if IPC_MANAGER.set(IpcSharedState { terminal }).is_err() {
        eprintln!("IpcSharedState already initialized");
    }
}

pub fn start_server(port: u16) {
    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr).expect("Failed to bind IPC server");
    eprintln!("IPC server listening on {}", addr);

    thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    thread::spawn(|| handle_connection(stream));
                }
                Err(e) => eprintln!("IPC connection error: {}", e),
            }
        }
    });
}

fn handle_connection(stream: TcpStream) {
    let _peer = stream.peer_addr().ok();
    let mut reader = BufReader::new(&stream);
    let mut writer = &stream;

    let mut line = String::new();
    match reader.read_line(&mut line) {
        Ok(0) | Err(_) => return,
        Ok(_) => {}
    }

    let response = match serde_json::from_str::<IpcRequest>(line.trim()) {
        Ok(req) => handle_request(req),
        Err(e) => IpcResponse::error(format!("Invalid request: {}", e)),
    };

    let json = serde_json::to_string(&response).unwrap_or_default();
    let _ = writeln!(writer, "{}", json);
    let _ = writer.flush();
}

fn handle_request(req: IpcRequest) -> IpcResponse {
    let state = match IPC_MANAGER.get() {
        Some(s) => s,
        None => return IpcResponse::error("IPC state not initialized"),
    };

    match req.cmd.as_str() {
        "list" => {
            match state.terminal.list_sessions() {
                Ok(sessions) => IpcResponse::ok(sessions),
                Err(e) => IpcResponse::error(e),
            }
        }
        "send" => {
            let id = match req.session_id {
                Some(id) => id,
                None => return IpcResponse::error("Missing session_id"),
            };
            let text = match req.text {
                Some(t) => t,
                None => return IpcResponse::error("Missing text"),
            };
            match state.terminal.write(&id, &text) {
                Ok(()) => IpcResponse::ok("sent"),
                Err(e) => IpcResponse::error(e),
            }
        }
        other => IpcResponse::error(format!("Unknown command: {}", other)),
    }
}

#[derive(Debug, Deserialize)]
struct IpcRequest {
    cmd: String,
    session_id: Option<String>,
    text: Option<String>,
}

#[derive(Debug, Serialize)]
struct IpcResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl IpcResponse {
    fn ok<T: Serialize>(data: T) -> Self {
        Self {
            ok: true,
            data: Some(serde_json::to_value(data).unwrap_or_default()),
            error: None,
        }
    }

    fn error(msg: impl ToString) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(msg.to_string()),
        }
    }
}

/// 查找可用端口并写入 `~/.agent-hub/ah-ipc.json`
pub fn find_port_and_save() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind IPC port");
    let port = listener.local_addr().unwrap().port();
    drop(listener); // 释放端口，start_server 会重新 bind

    let config_dir = dirs::home_dir()
        .map(|p| p.join(".agent-hub"))
        .expect("Failed to get home dir");
    let _ = std::fs::create_dir_all(&config_dir);
    let path = config_dir.join("ah-ipc.json");
    if let Ok(content) = serde_json::to_string_pretty(&serde_json::json!({ "port": port })) {
        let _ = std::fs::write(&path, content);
    }

    port
}
