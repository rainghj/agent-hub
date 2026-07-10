use crate::agents::{claude::ClaudeAgent, kimi::KimiAgent, mimo::MimoAgent, Agent, ProjectInfo, SessionInfo, Message};
use anyhow::Result;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{State, Window};

// 存储运行中的终端 PTY
pub struct TerminalState {
    pub terminals: Mutex<HashMap<String, PtySession>>,
}

pub struct PtySession {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn portable_pty::Child + Send>,
}

impl TerminalState {
    pub fn new() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
        }
    }
}

#[tauri::command]
pub fn get_projects() -> Result<Vec<ProjectInfo>, String> {
    let agents: Vec<Box<dyn Agent>> = vec![
        Box::new(ClaudeAgent::new()),
        Box::new(MimoAgent::new()),
        Box::new(KimiAgent::new()),
    ];

    let mut all_projects = Vec::new();
    for agent in &agents {
        match agent.list_projects() {
            Ok(projects) => all_projects.extend(projects),
            Err(e) => eprintln!("Error listing projects for {}: {}", agent.name(), e),
        }
    }
    Ok(all_projects)
}

#[tauri::command]
pub fn get_sessions(project: Option<String>, agent_filter: Option<String>) -> Result<Vec<SessionInfo>, String> {
    let agents: Vec<Box<dyn Agent>> = vec![
        Box::new(ClaudeAgent::new()),
        Box::new(MimoAgent::new()),
        Box::new(KimiAgent::new()),
    ];

    let mut all_sessions = Vec::new();
    for agent in &agents {
        if let Some(ref filter) = agent_filter {
            if agent.name() != filter.as_str() {
                continue;
            }
        }
        match agent.list_sessions() {
            Ok(sessions) => {
                for session in sessions {
                    if let Some(ref proj) = project {
                        if session.project.as_ref() != Some(proj) {
                            continue;
                        }
                    }
                    all_sessions.push(session);
                }
            }
            Err(e) => eprintln!("Error listing sessions for {}: {}", agent.name(), e),
        }
    }

    all_sessions.sort_by(|a, b| {
        b.updated_at.unwrap_or_default().cmp(&a.updated_at.unwrap_or_default())
    });
    Ok(all_sessions)
}

#[tauri::command]
pub fn get_messages(session_id: String, agent: String) -> Result<Vec<Message>, String> {
    let agent_impl: Box<dyn Agent> = match agent.as_str() {
        "claude" => Box::new(ClaudeAgent::new()),
        "mimo" => Box::new(MimoAgent::new()),
        "kimi" => Box::new(KimiAgent::new()),
        _ => return Err(format!("Unknown agent: {}", agent)),
    };
    agent_impl.get_messages(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn spawn_terminal(
    agent: String,
    session_id: String,
    project_path: Option<String>,
    cols: u16,
    rows: u16,
    window: Window,
    state: State<'_, TerminalState>,
) -> Result<String, String> {
    let terminal_id = format!("{}_{}", agent, &session_id[..8.min(session_id.len())]);

    // 检查是否已经在运行
    {
        let terminals = state.terminals.lock().map_err(|e| e.to_string())?;
        if terminals.contains_key(&terminal_id) {
            return Ok(terminal_id);
        }
    }

    // 创建 PTY 系统
    let pty_system = NativePtySystem::default();

    // 创建 PTY 对
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // 构建命令
    let mut cmd = match agent.as_str() {
        "claude" => CommandBuilder::new("claude"),
        "mimo" => CommandBuilder::new("mimo"),
        "kimi" => CommandBuilder::new("kimi"),
        _ => return Err(format!("Unknown agent: {}", agent)),
    };

    // 添加参数
    match agent.as_str() {
        "claude" => {
            cmd.arg("--resume");
            cmd.arg(&session_id);
        }
        "mimo" => {
            cmd.arg("--session");
            cmd.arg(&session_id);
        }
        "kimi" => {
            cmd.arg("--session");
            cmd.arg(&session_id);
        }
        _ => {}
    }

    // 设置工作目录，让 agent 进入正确的项目目录
    if let Some(path) = &project_path {
        cmd.cwd(path);
    }

    // 启用 ANSI 颜色输出
    cmd.env("TERM", "xterm-256color");
    cmd.env("CLICOLOR", "1");
    cmd.env("FORCE_COLOR", "1");

    // 启动子进程
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {}", e))?;
    drop(pair.slave);

    // 获取 master、writer 和 reader
    let master = pair.master;
    let writer = master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;

    // 在新线程中读取 PTY 输出并发送到前端
    let window_clone = window.clone();
    let terminal_id_clone = terminal_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let output = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = window_clone.emit(
                        "terminal-output",
                        serde_json::json!({
                            "terminal_id": terminal_id_clone,
                            "data": output,
                        }),
                    );
                }
                Err(_) => break,
            }
        }
    });

    // 存储终端会话
    {
        let mut terminals = state.terminals.lock().map_err(|e| e.to_string())?;
        terminals.insert(
            terminal_id.clone(),
            PtySession { master, writer, child },
        );
    }

    Ok(terminal_id)
}

#[tauri::command]
pub fn send_to_terminal(
    terminal_id: String,
    input: String,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().map_err(|e| e.to_string())?;

    if let Some(session) = terminals.get_mut(&terminal_id) {
        session.writer.write_all(input.as_bytes()).map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())?;
        return Ok(());
    }

    Err("Terminal not found".to_string())
}

#[tauri::command]
pub fn resize_terminal(
    terminal_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().map_err(|e| e.to_string())?;

    if let Some(session) = terminals.get_mut(&terminal_id) {
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    Err("Terminal not found".to_string())
}

#[tauri::command]
pub fn close_terminal(
    terminal_id: String,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().map_err(|e| e.to_string())?;

    if let Some(mut session) = terminals.remove(&terminal_id) {
        let _ = session.child.kill();
    }

    Ok(())
}

/// 目录条目
#[derive(Debug, Clone, serde::Serialize)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "." || name == ".." {
            continue;
        }
        entries.push(DirEntry {
            name,
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }
    // 文件夹在前，文件在后；同类型按名称排序
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
    Ok(entries)
}

#[tauri::command]
pub fn spawn_shell(
    shell_id: String,
    project_path: String,
    cols: u16,
    rows: u16,
    window: Window,
    state: State<'_, TerminalState>,
) -> Result<String, String> {
    // 检查是否已经在运行
    {
        let terminals = state.terminals.lock().map_err(|e| e.to_string())?;
        if terminals.contains_key(&shell_id) {
            return Ok(shell_id);
        }
    }

    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // 使用系统默认 shell
    #[cfg(target_os = "windows")]
    let mut cmd = CommandBuilder::new("powershell.exe");
    #[cfg(not(target_os = "windows"))]
    let mut cmd = CommandBuilder::new("/bin/sh");

    cmd.cwd(&project_path);
    cmd.env("TERM", "xterm-256color");
    cmd.env("CLICOLOR", "1");
    cmd.env("FORCE_COLOR", "1");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {}", e))?;
    drop(pair.slave);

    let master = pair.master;
    let writer = master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;

    let window_clone = window.clone();
    let shell_id_clone = shell_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let output = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = window_clone.emit(
                        "terminal-output",
                        serde_json::json!({
                            "terminal_id": shell_id_clone,
                            "data": output,
                        }),
                    );
                }
                Err(_) => break,
            }
        }
    });

    {
        let mut terminals = state.terminals.lock().map_err(|e| e.to_string())?;
        terminals.insert(
            shell_id.clone(),
            PtySession { master, writer, child },
        );
    }

    Ok(shell_id)
}

#[tauri::command]
pub fn open_in_terminal(agent: String, session_id: String) -> Result<(), String> {
    let (cmd, args) = match agent.as_str() {
        "claude" => ("claude", vec!["--resume", &session_id]),
        "mimo" => ("mimo", vec!["--session", &session_id]),
        "kimi" => ("kimi", vec!["--session", &session_id]),
        _ => return Err(format!("Unknown agent: {}", agent)),
    };

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "cmd", "/k", cmd])
            .args(&args)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("x-terminal-emulator")
            .args(["-e", cmd])
            .args(&args)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn search_sessions(query: String) -> Result<Vec<SessionInfo>, String> {
    let agents: Vec<Box<dyn Agent>> = vec![
        Box::new(ClaudeAgent::new()),
        Box::new(MimoAgent::new()),
        Box::new(KimiAgent::new()),
    ];

    let mut results = Vec::new();
    let query_lower = query.to_lowercase();

    for agent in &agents {
        if let Ok(sessions) = agent.list_sessions() {
            for session in sessions {
                if let Some(ref title) = session.title {
                    if title.to_lowercase().contains(&query_lower) {
                        results.push(session);
                    }
                } else if session.session_id.to_lowercase().contains(&query_lower) {
                    results.push(session);
                }
            }
        }
    }

    Ok(results)
}
