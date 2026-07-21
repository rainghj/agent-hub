# Sidex 终端架构参考

> 分析自 [sidex-main](https://github.com/sidex-main) 项目（Tauri 桌面编辑器），
> 重点考察其终端系统的前后端实现，供 agent-hub 项目借鉴。

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  前端 (WebView - TypeScript)                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  @xterm/xterm (xterm.js) 终端渲染器                    │   │
│  │  通过 addons: webgl, search, unicode11, ligatures,   │   │
│  │             serialize, image, clipboard               │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │  TauriTerminalBackend (tauriTerminalBackend.ts)       │   │
│  │  → 适配 VS Code 的 ITerminalBackend 接口              │   │
│  │  → 用 @tauri-apps/api/core.invoke 调 Rust 命令        │   │
│  │  → 用 @tauri-apps/api/event.listen 收事件             │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↕ Tauri IPC (invoke / events)       │
│  后端 (Rust - Tauri Commands)                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  terminal.rs (旧版 - 同步阻塞)                         │   │
│  │  sidex_terminal.rs (新版 - 带数据缓冲)                   │   │
│  └──────┬───────────────────────────────────────────────┘   │
│         ↕ 库调用                                              │
│  ┌──────┴───────────────────────────────────────────────┐   │
│  │  sidex-terminal crate (核心终端库)                     │   │
│  │  ┌─────────┐ ┌──────┐ ┌───────────┐ ┌────────────┐  │   │
│  │  │  pty.rs  │ │grid  │ │emulator.rs│ │  manager    │  │   │
│  │  │(PTY管理) │ │.rs   │ │(ANSI解析)  │ │  .rs       │  │   │
│  │  │          │ │(网格) │ │(VTE解析器) │ │ (实例管理)   │  │   │
│  │  ├─────────┤ ├──────┤ ├───────────┤ ├────────────┤  │   │
│  │  │exec.rs  │ │ansi  │ │renderer   │ │  selection  │  │   │
│  │  │(命令执) │ │.rs   │ │.rs        │ │  .rs       │  │   │
│  │  │         │ │(原始)│ │(GPU渲染)   │ │ (选择)      │  │   │
│  │  ├─────────┤ │ANSI) │ │           │ │            │  │   │
│  │  │shell    │ │      │ │           │ │ link_      │  │   │
│  │  │.rs      │ │      │ │           │ │ detection  │  │   │
│  │  │(shell  )│ │      │ │           │ │ .rs        │  │   │
│  │  │(检测)   │ │      │ │           │ │ (链接检测)   │  │   │
│  │  └─────────┘ └──────┘ └───────────┘ └─────┬──────┘  │   │
│  │                                            │           │   │
│  │  ┌──────────────────────────────────────────┘           │   │
│  │  │  shell_integration.rs (shell 集成: 命令追踪/cwd)     │   │
│  └──┴────────────────────────────────────────────────────┘   │
│         ↕ portable-pty crate                                  │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  操作系统 PTY (CONOUT/CONIN 或 /dev/pts)               │   │
│  └────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 核心依赖

| 层 | 依赖 | 用途 |
|---|---|---|
| Rust 后端 | `portable-pty` | 跨平台 PTY 创建（封装系统调用） |
| Rust 后端 | `vte` | ANSI 转义序列解析器 |
| Rust 后端 | `crossbeam` | 跨线程通信（PTY reader → dispatcher） |
| Rust 后端 | `which` | 查找可执行 shell 路径 |
| TypeScript 前端 | `@xterm/xterm` | 核心终端渲染器 |
| TypeScript 前端 | `@xterm/addon-webgl` | WebGL 加速渲染 |
| IPC | `@tauri-apps/api` | invoke(命令) / event.listen(事件) |

## 关键实现细节

### 1. 后端 Rust (`crates/sidex-terminal/`)

#### PTY 管理 (`pty.rs`)

- 用 `portable-pty` 的 `native_pty_system()` 创建伪终端
- 环形缓冲区（RingBuffer）存储输出，容量 10,000 行
- 独立 reader 线程从 PTY 读数据，经 crossbeam channel 分发
- 支持进程树杀（Unix: `SIGTERM`→`SIGKILL` / Windows: `taskkill /T /F`）
- 端子标题通过 OSC 序列获取

关键结构：

```rust
pub struct PtyProcess {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send>>>,
    alive: Arc<AtomicBool>,
    output: Arc<Mutex<RingBuffer>>,
    output_rx: Option<Receiver<OutputMessage>>,
    shell: String,
    cwd: PathBuf,
    cols: u16,
    rows: u16,
}
```

#### ANSI 模拟器 (`emulator.rs`)

- 实现 `vte::Perform` trait，逐字节解析 ANSI 序列
- 完整支持：SGR（颜色/样式）、CSI（光标/擦除）、OSC（标题/超链接）
- 备选屏幕缓冲（alternate screen buffer，vim 等全屏应用必用）
- 鼠标追踪模式、插入/删除字符、滚动区域

#### 网格 (`grid.rs`)

- `Cell`：字符 + 16 位 bitflag 属性（BOLD/DIM/ITALIC/UNDERLINE/BLINK 等）
- 颜色系统：`Named(16色)` + `Indexed(256色)` + `Rgb(真彩色)`
- 可配置制表位、CJK 宽字符、滚动回退（默认 10,000 行）

#### Shell 集成 (`shell_integration.rs`)

- 通过 ANSI OSC 标记追踪命令开始/结束、退出码、工作目录
- Shell init 脚本注入这些标记
- 支持 zsh/bash/fish/PowerShell/cmd

### 2. IPC 通信模式

**命令（前端 → 后端）：** 使用 Tauri `invoke`：

```typescript
// 前端 TS
const backendId = await invoke('terminal_spawn', {
    shell: "/bin/zsh", args: null, cwd: "/home/user",
    env: { TERM: "xterm-256color", ... },
    cols: 80, rows: 24
});
```

```rust
// 后端 Rust
#[tauri::command]
pub fn terminal_spawn(
    app: AppHandle,
    state: State<'_, Arc<TerminalStore>>,
    shell: Option<String>,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<u32, String> { ... }
```

**事件（后端 → 前端）：** 使用 Tauri `Emitter`：

```rust
// Rust 发事件
app.emit("terminal-data", TerminalDataEvent { terminal_id, data });
app.emit("terminal-exit", TerminalExitEvent { terminal_id, exit_code });
```

```typescript
// TS 收事件
await listen('terminal-data', event => {
    if (payload.terminal_id === this._backendId) {
        this._onProcessData.fire(payload.data);
    }
});
```

### 3. 完整数据流

```
用户键盘输入
    ↓
前端 xterm.js → onData()
    ↓
invoke('terminal_write', { terminalId, data })
    ↓
Rust: writer.write_all(data.as_bytes())
    ↓
Shell 进程 (zsh/bash)
    ↓
PTY 输出 → reader.read(&mut buf)
    ↓
String::from_utf8_lossy(&buf[..n])
    ↓
app.emit('terminal-data', { terminal_id, data })
    ↓
前端 listen('terminal-data') → this._onProcessData.fire(data)
    ↓
xterm.write(data)  → 渲染到屏幕
```

## 后端可注册的 Tauri 命令

| 命令 | 用途 |
|---|---|
| `terminal_spawn` | 创建 PTY 进程，返回 ID |
| `terminal_write` | 写输入到终端 |
| `terminal_resize` | 调整终端大小（cols/rows） |
| `terminal_kill` | 杀死终端进程 |
| `terminal_get_pid` | 获取终端进程 PID |
| `get_default_shell` | 获取默认 shell 路径 |
| `get_available_shells` | 列出可用 shell |
| `check_shell_exists` | 检查 shell 是否存在 |
| `get_shell_integration_dir` | 获取 shell 集成脚本目录 |
| `setup_zsh_dotdir` | 设置 zsh 集成环境 |
| `terminal_find_in_buffer` | 在终端缓冲区搜索 |

## Shell 检测逻辑摘要

- **Windows：** 依次尝试 pwsh.exe → powershell.exe → COMSPEC；检测 Git Bash
- **Unix：** 先读 `$SHELL` → 读 `/etc/shells` → 遍历已知路径回退
- 设置 `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=SideX`
- 登录 shell 参数：zsh/bash/sh/fish 加 `-l`，pwsh/powershell 加 `-NoExit`

## 可借鉴的点

### 可直接复用的模式

1. **portable-pty + Tauri IPC 组合**：跨平台 PTY + invoke/events 通信
2. **环形缓冲区设计**：`VecDeque<OutputChunk>` + 丢弃计数
3. **备选屏幕支持**：`alternate_grid` 机制（vim/less 等全屏应用）
4. **Shell 检测逻辑**：Windows 找 pwsh/powershell/cmd/Git Bash；Unix 读 `/etc/shells`
5. **Shell 集成注入**：通过环境变量（`ZDOTDIR`）注入 shell init 脚本

### 如果后端不是 Rust/Tauri

- 用 Node.js 的 `node-pty` 替代 `portable-pty`
- 用 Electron IPC 或 WebSocket 替代 Tauri invoke/events
- 前端 @xterm/xterm 是行业标准，直接复用
- ANSI 解析：可引入 `xterm-headless` 在服务端做，或前端用 xterm.js 自带解析
