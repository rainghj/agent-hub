use crate::agents::AgentRegistry;
use portable_pty::{Child, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tauri::{State, Window};

// ── Data types ──────────────────────────────────────────────────

/// 终端会话的完整状态
pub struct TerminalSession {
    pub id: String,
    pub title: String,
    pub cwd: PathBuf,
    pub agent: Option<String>,
    pub session_id: Option<String>,
    pub created_at: SystemTime,
    pub pty: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send>,
}

/// 终端会话的元数据（向前端暴露）
#[derive(Debug, Clone, Serialize)]
pub struct TerminalSessionInfo {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub agent: Option<String>,
    pub session_id: Option<String>,
    pub created_at: String,
}

/// 终端管理器
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 创建一个指向同一内部状态的新句柄（用于 IPC 共享）
    pub fn clone_for_ipc(&self) -> Self {
        Self {
            sessions: self.sessions.clone(),
        }
    }

    /// 检查会话是否存在
    pub fn has_session(&self, id: &str) -> Result<bool, String> {
        self.sessions
            .lock()
            .map(|map| map.contains_key(id))
            .map_err(|e| e.to_string())
    }

    /// 获取所有会话的信息
    pub fn list_sessions(&self) -> Result<Vec<TerminalSessionInfo>, String> {
        let map = self.sessions.lock().map_err(|e| e.to_string())?;
        let mut list: Vec<TerminalSessionInfo> = map
            .values()
            .map(|s| TerminalSessionInfo {
                id: s.id.clone(),
                title: s.title.clone(),
                cwd: s.cwd.to_string_lossy().to_string(),
                agent: s.agent.clone(),
                session_id: s.session_id.clone(),
                created_at: format!("{:?}", s.created_at),
            })
            .collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(list)
    }

    /// 向终端写入输入
    pub fn write(&self, id: &str, input: &str) -> Result<(), String> {
        let mut map = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = map.get_mut(id).ok_or_else(|| "Terminal not found".to_string())?;
        session
            .writer
            .write_all(input.as_bytes())
            .map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())
    }

    /// 调整终端尺寸
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let mut map = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = map.get_mut(id).ok_or_else(|| "Terminal not found".to_string())?;
        session
            .pty
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    /// 关闭并移除会话（先杀进程树，再杀主进程）
    pub fn close(&self, id: &str) -> Result<(), String> {
        let mut map = self.sessions.lock().map_err(|e| e.to_string())?;
        if let Some(mut session) = map.remove(id) {
            // 先杀子进程树
            if let Some(pid) = session.child.process_id() {
                kill_process_tree(pid);
            }
            // 再杀主进程
            let _ = session.child.kill();
        }
        Ok(())
    }

    /// 插入新会话（由内部 PTY 创建函数调用）
    fn insert(&self, session: TerminalSession) -> Result<(), String> {
        let mut map = self.sessions.lock().map_err(|e| e.to_string())?;
        map.insert(session.id.clone(), session);
        Ok(())
    }
}

// ── PTY 创建函数 ────────────────────────────────────────────────

/// 创建 PTY pair，返回 master、writer、reader、child
fn create_pty(
    cmd: CommandBuilder,
    cols: u16,
    rows: u16,
) -> Result<(Box<dyn MasterPty + Send>, Box<dyn Write + Send>, Box<dyn Read + Send>, Box<dyn Child + Send>), String>
{
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {}", e))?;
    drop(pair.slave);

    let master = pair.master;
    let writer = master.take_writer().map_err(|e| e.to_string())?;
    let reader = master.try_clone_reader().map_err(|e| e.to_string())?;

    Ok((master, writer, reader, child))
}

/// 杀死进程及其所有子进程（跨平台，无需额外依赖）
fn kill_process_tree(pid: u32) {
    #[cfg(unix)]
    {
        // Unix: 递归杀子进程 → 杀自己
        if let Ok(output) = std::process::Command::new("pgrep")
            .args(["-P", &pid.to_string()])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if let Ok(child_pid) = line.trim().parse::<u32>() {
                    kill_process_tree(child_pid);
                }
            }
        }
        // 用 kill 命令发 SIGTERM（避免依赖 libc）
        let _ = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output();
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }

    #[cfg(not(any(unix, windows)))]
    {}
}
fn spawn_reader_thread(mut reader: Box<dyn Read + Send>, terminal_id: String, window: Window) {
    std::thread::spawn(move || {
        use std::time::{Duration, Instant};

        let mut buf = [0u8; 4096];
        let batch_interval = Duration::from_millis(8);
        let mut pending = String::new();
        let mut last_flush = Instant::now();

        loop {
            // 非阻塞读取（reader 是 blocking 的，但我们会用超时控制批处理）
            match reader.read(&mut buf) {
                Ok(0) => {
                    // EOF：flush 剩余数据后退出
                    if !pending.is_empty() {
                        let _ = window.emit(
                            "terminal-output",
                            serde_json::json!({
                                "terminal_id": terminal_id,
                                "data": pending,
                            }),
                        );
                    }
                    break;
                }
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    pending.push_str(&chunk);

                    let now = Instant::now();
                    if now.duration_since(last_flush) >= batch_interval {
                        let _ = window.emit(
                            "terminal-output",
                            serde_json::json!({
                                "terminal_id": terminal_id,
                                "data": pending,
                            }),
                        );
                        pending.clear();
                        last_flush = now;
                    }
                }
                Err(_) => {
                    if !pending.is_empty() {
                        let _ = window.emit(
                            "terminal-output",
                            serde_json::json!({
                                "terminal_id": terminal_id,
                                "data": pending,
                            }),
                        );
                    }
                    break;
                }
            }
        }
    });
}

fn build_agent_command(
    agent: &str,
    session_id: &str,
    project_path: &Option<String>,
    registry: &AgentRegistry,
) -> Result<CommandBuilder, String> {
    let profile = registry
        .profile_by_id(agent)
        .ok_or_else(|| format!("Unknown agent: {}", agent))?;

    let mut cmd = CommandBuilder::new(&profile.command);
    for arg in profile.args_for_session(session_id) {
        cmd.arg(arg);
    }
    if let Some(path) = project_path {
        cmd.cwd(path);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("CLICOLOR", "1");
    cmd.env("FORCE_COLOR", "1");
    Ok(cmd)
}

/// 检测系统默认 shell（跨平台）
fn detect_default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        // 搜索 PATH 找 pwsh / powershell
        fn find_in_path(name: &str) -> Option<String> {
            let path = std::env::var_os("PATH")?;
            for dir in std::env::split_paths(&path) {
                let candidate = dir.join(name);
                if candidate.exists() {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
            None
        }
        for candidate in ["pwsh.exe", "powershell.exe"] {
            if let Some(path) = find_in_path(candidate) {
                return path;
            }
        }
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        // 1. 读 $SHELL
        if let Ok(shell) = std::env::var("SHELL") {
            if !shell.is_empty() && shell != "/bin/false" {
                return shell;
            }
        }
        // 2. 读 /etc/shells
        if let Ok(contents) = std::fs::read_to_string("/etc/shells") {
            let shells: Vec<&str> = contents
                .lines()
                .filter(|l| {
                    let t = l.trim();
                    !t.is_empty() && !t.starts_with('#') && std::path::Path::new(t).exists()
                })
                .collect();
            if !shells.is_empty() {
                return shells[0].to_string();
            }
        }
        // 3. 回退
        for fb in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
            if std::path::Path::new(fb).exists() {
                return fb.to_string();
            }
        }
        "/bin/sh".to_string()
    }
}

fn build_shell_command(project_path: &str) -> CommandBuilder {
    let shell = detect_default_shell();

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let basename = std::path::Path::new(&shell)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        let mut c = CommandBuilder::new(&shell);
        // PowerShell 需要 -NoExit 避免启动后就退出
        if basename.eq_ignore_ascii_case("powershell.exe")
            || basename.eq_ignore_ascii_case("pwsh.exe")
        {
            c.arg("-NoExit");
        }
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let basename = std::path::Path::new(&shell)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        let mut c = CommandBuilder::new(&shell);
        // 登录 shell
        if matches!(basename, "zsh" | "bash" | "sh" | "fish") {
            c.arg("-l");
        }
        c
    };

    cmd.cwd(project_path);
    cmd.env("TERM", "xterm-256color");
    cmd.env("CLICOLOR", "1");
    cmd.env("FORCE_COLOR", "1");
    cmd
}

// ── Tauri commands ──────────────────────────────────────────────

#[tauri::command]
pub fn spawn_terminal(
    agent: String,
    session_id: String,
    project_path: Option<String>,
    cols: u16,
    rows: u16,
    window: Window,
    manager: State<'_, TerminalManager>,
    registry: State<'_, AgentRegistry>,
) -> Result<String, String> {
    let terminal_id = format!("{}_{}", agent, &session_id[..8.min(session_id.len())]);

    if manager.has_session(&terminal_id)? {
        return Ok(terminal_id);
    }

    let cmd = build_agent_command(&agent, &session_id, &project_path, &registry)?;
    let cwd = project_path.clone().unwrap_or_default();

    let (_master, writer, reader, child) = create_pty(cmd, cols, rows)?;

    spawn_reader_thread(reader, terminal_id.clone(), window);

    let session = TerminalSession {
        id: terminal_id.clone(),
        title: format!("Agent - {}", agent),
        cwd: PathBuf::from(&cwd),
        agent: Some(agent),
        session_id: Some(session_id),
        created_at: SystemTime::now(),
        pty: _master,
        writer,
        child,
    };
    manager.insert(session)?;

    Ok(terminal_id)
}

#[tauri::command]
pub fn spawn_shell(
    shell_id: String,
    project_path: String,
    cols: u16,
    rows: u16,
    window: Window,
    manager: State<'_, TerminalManager>,
) -> Result<String, String> {
    if manager.has_session(&shell_id)? {
        return Ok(shell_id);
    }

    let cmd = build_shell_command(&project_path);

    let (_master, writer, reader, child) = create_pty(cmd, cols, rows)?;

    spawn_reader_thread(reader, shell_id.clone(), window);

    let session = TerminalSession {
        id: shell_id.clone(),
        title: format!("Shell - {}", project_path.split('\\').last().unwrap_or(&project_path)),
        cwd: PathBuf::from(&project_path),
        agent: None,
        session_id: None,
        created_at: SystemTime::now(),
        pty: _master,
        writer,
        child,
    };
    manager.insert(session)?;

    Ok(shell_id)
}

#[tauri::command]
pub fn send_to_terminal(
    terminal_id: String,
    input: String,
    manager: State<'_, TerminalManager>,
) -> Result<(), String> {
    manager.write(&terminal_id, &input)
}

#[tauri::command]
pub fn resize_terminal(
    terminal_id: String,
    cols: u16,
    rows: u16,
    manager: State<'_, TerminalManager>,
) -> Result<(), String> {
    manager.resize(&terminal_id, cols, rows)
}

#[tauri::command]
pub fn close_terminal(
    terminal_id: String,
    manager: State<'_, TerminalManager>,
) -> Result<(), String> {
    manager.close(&terminal_id)
}

#[tauri::command]
pub fn list_terminals(
    manager: State<'_, TerminalManager>,
) -> Result<Vec<TerminalSessionInfo>, String> {
    manager.list_sessions()
}
