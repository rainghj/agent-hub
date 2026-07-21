# Agent Hub 终端问题排查记录

> 记录 2026-07 期间终端模块遇到的光标/渲染/输入问题、根因和修复方式，方便后续回顾。

---

## 1. Claude Code TUI / Shell 中出现白色方块残影

### 现象

在 Agent Hub 的 xterm.js 终端中运行 Claude Code CLI 或普通 Shell 时，输入行边缘出现白色/反色方块：

```text
> |11111|       ← 方块在 prompt 后或行尾
```

按 Enter 提交时，shell 实际没有这些方块对应的字符。

### 根因（最初误诊，后修正）

- **最初以为**是 Claude Code 上游 bug（claude-code#46898），认为是 TUI 局部重绘时不清除行边缘单元格。
- **实际根因**：`EmbeddedTerminal.tsx` 的 xterm.js 构造参数里设置了 `convertEol: true`。在 PTY 后端环境中，PTY 层已经负责 EOL 转换，xterm.js 再开启 `convertEol` 会造成**双重转换**，干扰 alt 缓冲区渲染，产生幽灵文本/光标残影。
- VS Code / Sidex 的终端都不设置 `convertEol`。

### 修复

`src/components/EmbeddedTerminal.tsx`：

```diff
- convertEol: true,
```

同时避免在 PTY 后端场景下设置 `scrollOnOutput: true`。

---

## 2. 窗口顶部出现白色横条

### 现象

应用窗口顶部有一条白色横条，与下方深色内容不协调。

### 根因

Tauri 窗口未指定主题，默认跟随系统主题。系统在浅色模式下会把原生标题栏渲染成白色。

### 修复

`src-tauri/tauri.conf.json`：

```json
{
  "label": "main",
  ...
  "theme": "Dark"
}
```

---

## 3. 切换窗口后 Backspace 删除不了第一个字符

### 现象

输入数字/字符后按 `Alt+Tab` 切到别的窗口再切回来，按 Backspace 删不掉第一个字符。

### 根因

为了修复中文输入法重复输入，我们在 `EmbeddedTerminal.tsx` 里写了一个 `attachIMEFix`：

- 在 `compositionstart/update/end` 上阻止事件传播
- 在 `keydown` 上拦截 `keyCode === 229` 或 `isComposing` 的所有按键

这个拦截过于激进，会把窗口切回后某些 IME/系统键盘事件（包括 Backspace）也吞掉，导致删除失效。

VS Code / Sidex 的终端**没有自定义 IME 拦截**，直接走 `terminal.onData`。

### 修复

移除 `attachIMEFix` 函数，改回最简单的输入方式：

```ts
const inputDisposable = terminal.onData(sendInput)
```

---

## 4. 切换窗口后出现残留字符（如 “2”）

### 现象

输入数字后切换窗口再回来，屏幕上残留一个多余的字符（如 “2”），但提交时 shell 并没有它。

### 根因

xterm.js 在窗口失焦期间停止刷新，切回焦点时某些单元格的脏区没有触发重绘，导致上一帧的字符残留在屏幕上。这是一个**前端渲染问题**，不是后端 PTY 数据问题。

### 修复

在 `EmbeddedTerminal.tsx` 中监听 `focus` 和 `visibilitychange`，切回窗口/标签页时强制刷新整个 viewport：

```ts
const handleFocusRefresh = () => {
  if (disposedRef.current || !terminalInstance.current) return
  terminalInstance.current.refresh(0, terminalInstance.current.rows - 1)
}
window.addEventListener('focus', handleFocusRefresh)
document.addEventListener('visibilitychange', handleFocusRefresh)
```

---

## 5. WebGL 渲染器导致的 cursor 残影

### 现象

光标移动后旧位置留下白色方块，疑似 cursor 残影。

### 根因

`@xterm/addon-webgl` 在某些 GPU/驱动/尺寸组合下，旧光标单元格不会被正确清除。

### 修复

临时禁用 `WebglAddon`，让 xterm.js 回退到 DOM/Canvas 渲染器：

```ts
// 临时禁用 WebGL 渲染器，排查 cursor 残影是否由 WebGL 层引起
/*
try {
  terminal.loadAddon(webglAddon)
} catch {
  console.warn('[Terminal] WebGL addon failed to load, falling back to canvas renderer')
}
*/
```

---

## 6. 与 VS Code / Sidex 终端的关键差异（经验总结）

| 配置/行为 | Agent Hub（问题期间） | VS Code / Sidex 做法 |
|---|---|---|
| `convertEol` | 错误地设为 `true` | 不设置 |
| 渲染器 | 默认加载 `WebglAddon` | 默认 DOM renderer，WebGL 按需开启 |
| IME 处理 | 自定义 `attachIMEFix` 拦截事件 | 不拦截，直接 `term.onData` |
| 窗口主题 | 未指定 | 暗色主题 |
| `TERM_PROGRAM` | 未设置 | 设为 `SideX` / `vscode` |
| 焦点刷新 | 未处理 | 依赖自身事件体系 |

### 后续建议

1. **保持当前最小修复**：去掉 `convertEol`、禁用 WebGL、去掉自定义 IME 拦截、加 focus refresh。
2. **加 `TERM_PROGRAM=AgentHub`**：让后端 shell 知道运行环境，便于 shell integration 和问题排查。
3. **如需长期演进**：可参考 Sidex 把后端命令统一为 `terminal_spawn/write/resize/kill/get_pid`，用 `which` crate 做 shell 检测。

---

## 当前已修改文件

- `src/components/EmbeddedTerminal.tsx`
  - 移除 `convertEol: true`
  - 移除 `attachIMEFix`，改用 `terminal.onData`
  - 注释禁用 `WebglAddon`
  - 增加 `focus` / `visibilitychange` 刷新逻辑
- `src-tauri/tauri.conf.json`
  - 窗口加 `"theme": "Dark"`
