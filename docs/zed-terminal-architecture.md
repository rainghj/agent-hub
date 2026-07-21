# Zed 终端架构参考

> 分析自 [zed-main](https://github.com/zed-industries/zed) 项目（GPUI 桌面编辑器），
> 考察其终端系统的实现，供 agent-hub 项目借鉴。

---

## 整体架构

Zed 终端和 Sidex 最大的不同：**Zed 用自研 GPUI 渲染引擎，没有 WebView/浏览器层**。终端渲染直接用 GPUI 的 `Element` trait 画在 GPU 上，不走 DOM/CSS。

```
┌──────────────────────────────────────────────────────────────┐
│  GPUI 窗口 (Zed 自研 GPU 渲染引擎)                            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  TerminalView (Entity)                                │    │
│  │  - 实现 Render trait                                  │    │
│  │  - 处理键盘/鼠标/拖放事件                              │    │
│  │  - 管理聚焦、光标闪烁                                  │    │
│  ├──────────────────────────────────────────────────────┤    │
│  │  TerminalElement (自定义 GPUI Element)                 │    │
│  │  - layout_grid: 把 Cell 网格转 GPUI TextRuns          │    │
│  │  - paint: 直接调 window.text_system().shape_line()    │    │
│  │  - BatchedTextRun: 相邻同风格字符合并减少 draw call    │    │
│  ├──────────────────────────────────────────────────────┤    │
│  │  TerminalPanel (Dock Panel)                          │    │
│  │  - 管理多 Pane 布局（水平/垂直拆分）                    │    │
│  │  - 支持串行化/反串行化面板状态                          │    │
│  │  - 集成 Workspace dock 系统                           │    │
│  └──────────────────────┬───────────────────────────────┘    │
│                         ↕ Entity::update() + 事件订阅         │
│  ┌──────────────────────┴───────────────────────────────┐    │
│  │  Terminal (Entity - 核心终端逻辑)                     │    │
│  │                                                      │    │
│  │  pub struct Terminal {                               │    │
│  │      term: Arc<AlacrittyTermLock>,     // Alacritty   │    │
│  │      output_processor: Processor,      // VTE 解析    │    │
│  │      events: VecDeque<InternalEvent>,                 │    │
│  │      last_content: Content,            // 渲染缓存    │    │
│  │      event_loop_task: Task,            // PTY 事件循环  │    │
│  │      scroll_px: Pixels,               // 滚动偏移     │    │
│  │      ...                                              │    │
│  │  }                                                    │    │
│  └──────────────────────┬───────────────────────────────┘    │
│                         ↕ 库调用                              │
│  ┌──────────────────────┴───────────────────────────────┐    │
│  │  crates/terminal/ (终端核心库)                        │    │
│  │                                                      │    │
│  │  ┌────────────┐  ┌──────────────┐  ┌─────────────┐  │    │
│  │  │ alacritty  │  │  mappings/   │  │ pty_info.rs │  │    │
│  │  │ .rs        │  │  colors.rs   │  │ (进程ID/     │  │    │
│  │  │ (Alacritty │  │  keys.rs     │  │  信息获取)   │  │    │
│  │  │  终端适配) │  │  mouse.rs    │  │             │  │    │
│  │  │            │  │  mod.rs      │  │             │  │    │
│  │  ├────────────┤  └──────────────┘  └─────────────┘  │    │
│  │  │ hyperlinks │                                       │    │
│  │  │ .rs        │                                       │    │
│  │  └────────────┘                                       │    │
│  └──────────────────────┬───────────────────────────────┘    │
│                         ↕ alacritty_terminal crate           │
│  ┌──────────────────────┴───────────────────────────────┐    │
│  │  alacritty_terminal (Fork: zed-industries/alacritty) │    │
│  │  - Term<ZedListener> (核心终端模拟器)                  │    │
│  │  - Grid<Cell>, ANSI 解析, PTY, 备选屏幕, Vi 模式    │    │
│  │  - EventLoop (PTY read 事件循环)                     │    │
│  │  - Selection, Search, Hyperlink                      │    │
│  └──────────────────────┬───────────────────────────────┘    │
│                         ↕ 系统调用                             │
│  ┌──────────────────────┴───────────────────────────────┐    │
│  │  操作系统 PTY (Unix: /dev/pts, Windows: ConPTY)     │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

## 核心依赖

| 层 | 依赖 | 用途 |
|---|---|---|
| 终端核心 | `alacritty_terminal` (Zed fork) | 完整的终端模拟器 + PTY |
| ANSI 解析 | `vte` | 辅助处理 ANSI 转义序列 |
| 进程管理 | `sysinfo` | 进程信息查询 |
| 渲染引擎 | `gpui` (Zed 自研) | GPU 加速 UI 渲染 |
| 服务框架 | `workspace`/`project` | 面板集成、项目关联 |
| 任务系统 | `task` | Shell 配置、任务执行 |

## 架构特点

### 1. 直接复用 alacritty_terminal

Zed **没有自己实现**终端模拟器，而是直接 fork 了 Alacritty 的 `alacritty_terminal` crate 并做了少量定制（`ZedListener`）：

```rust
// crates/terminal/src/alacritty.rs
pub type AlacrittyTerm = Term<ZedListener>;      // Alacritty 终端实例
pub type AlacrittyTermLock = FairMutex<AlacrittyTerm>;  // 线程安全包装
pub type AlacrittyCell = AlacCell;               // 复用 Alacritty 的 Cell

struct ZedListener(UnboundedSender<PtyEvent>);   // 自定义事件监听器
```

Alacritty 提供了：Grid、Cell、ANSI 解析器、PTY 管理、Selection、Search、Vi 模式、Alt Screen 等全套能力。

### 2. 事件驱动模型

```
Alacritty EventLoop (PTY reader 线程)
    ↓
TerminalBackendEvent (通过 ZedListener 发送)
    ├─ PtyWrite(String)     ← 终端输出
    ├─ Title(String)        ← 标题变更
    ├─ ClipboardStore       ← OSC 52 剪贴板
    ├─ ClipboardLoad        ← 剪贴板读取请求
    ├─ Bell                 ← 响铃
    ├─ Exit / ChildExit     ← 进程退出
    ├─ MouseCursorDirty     ← 鼠标光标变化
    └─ Wakeup               ← 唤醒
    ↓
Terminal::update(...)  → 解析事件更新内部状态
    ↓
cx.notify()  → 触发 TerminalView 重新渲染
    ↓
TerminalElement::layout_grid()  → 从 Alacritty grid 读取 Cell
    ↓
TerminalElement::paint()  → 生成 BatchedTextRun → GPUI text_system
```

### 3. GPUI 自定义渲染 (TerminalElement)

Zed 核心渲染创新：实现了 GPUI 的 `Element` trait 来渲染终端网格。

**布局阶段 (`layout_grid`)**:
- 遍历 Alacritty 的 `GridIterator<Cell>`，每个 Cell 包含字符、前景色、背景色、样式
- 相邻的相同样式 Cell **合并成 BatchedTextRun**（减少 draw call）
- 同时构建 `LayoutRect`（背景色矩形）、`CursorLayout`（光标）

```rust
// 渲染流程 (terminal_element.rs)
pub struct BatchedTextRun {
    start_point: LayoutPoint,
    text: String,
    cell_count: usize,
    style: TextRun,          // 字体、颜色、背景、下划线等
    font_size: AbsoluteLength,
}
```

**绘制阶段 (`paint`)**:
- 用 `window.text_system().shape_line()` 将 BatchedTextRun 转换为 GPU 纹理
- 绘制背景色矩形（`LayoutRect`）
- 绘制光标
- 绘制选择区域高亮

> 相比 Sidex 用 xterm.js + WebGL，Zed 的方式更直接（没有 HTML/CSS 开销），但需要 GPUI 支持。

### 4. TerminalView ↔ Terminal 分离

- **`crates/terminal/`** (`Terminal` Entity): 纯终端逻辑。管理 Alacritty term、事件循环、滚动、选择、搜索。
- **`crates/terminal_view/`** (`TerminalView` Entity): UI 集成。渲染、键盘/鼠标事件处理、Task 运行、Context Menu。

```rust
pub struct TerminalView {
    terminal: Entity<Terminal>,       // 终端逻辑实体
    terminal_bounds: TerminalBounds,  // 像素尺寸 → 字符网格换算
    blink_manager: BlinkManager,      // 光标闪烁
    scroll_handle: TerminalScrollHandle,
    ...
}
```

### 5. TerminalPanel 面板系统

`TerminalPanel` 实现 `Panel` trait，可以 dock 在底部或侧边。支持：
- 多标签页（Pane 内）
- 水平/垂直拆分
- 串行化/反串行化（重启恢复）
- 任务输出自动显示

## 与 Sidex 终端对比

| 维度 | Sidex | Zed |
|------|-------|-----|
| **终端核心** | 自研 Rust (`vte` + `portable-pty`) | 直接复用 `alacritty_terminal` |
| **前端渲染** | xterm.js (WebView) | GPUI 自定义 Element |
| **事件传输** | Tauri IPC (invoke/events) | Rust 内部 channel + Entity::update |
| **Shell 检测** | 自研 (`shell.rs`) | Alacritty 内置 |
| **渲染方式** | HTML Canvas + WebGL | GPU 直接渲染 (wgpu) |
| **远程支持** | 有 (`sidex-remote` crate) | 有 (collab server + SSH) |
| **Vi 模式** | 无 | Alacritty 内置 Vi 模式 |
| **Shell 集成** | Shell init 脚本注入 | Alacritty 原生支持 |

## 可借鉴的点

### 直接可用的模式

1. **复用 alacritty_terminal**：成熟的 Rust 终端模拟器，如果项目也是 Rust 后端，这是最高效的方案（比自研 ANSI 解析器省 90% 工作量）
2. **BatchedTextRun 合并**：相同样式 Cell 合并减少 draw call，前端渲染终端时通用的性能优化
3. **TerminalView/Terminal 分离**：Entity 架构让终端逻辑和 UI 解耦，方便测试和复用
4. **终端渲染适配法**：不依赖 xterm.js 时，用 terminal_bounds (cell_width/height) 将逻辑坐标转为像素坐标

### 如果项目不是 Rust

- **核心思路一致**：找一个成熟的终端模拟器库（或直接嵌入 xterm.js），专注于前端集成和 UI
- **BatchedTextRun 合并**的通用性：在任何 Canvas/WebGL/Canvas2D 渲染中都适用
- **TerminalBounds 换算**：`cols × cell_width = 像素宽`，这个逻辑在 xterm.js 中由 xterm 自身完成；如果用自定义渲染需要自己实现
