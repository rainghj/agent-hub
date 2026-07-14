mod agents;
mod cli;
mod memory;

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "ah", about = "统一管理 AI Agent 会话的 CLI 工具")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// 查看所有 agent 的活跃会话状态
    Status,
    /// 查看历史会话列表
    History {
        /// 按 agent 过滤: claude, mimo, kimi
        #[arg(short, long)]
        agent: Option<String>,
        /// 按项目过滤
        #[arg(short, long)]
        project: Option<String>,
        /// 搜索关键词
        #[arg(short, long)]
        search: Option<String>,
        /// 显示数量限制
        #[arg(short, long, default_value = "20")]
        limit: usize,
    },
    /// 查看会话详情
    Show {
        /// 会话 ID
        session_id: String,
        /// 输出格式: text, markdown
        #[arg(short, long, default_value = "text")]
        format: String,
    },
    /// 跨 agent 全文搜索
    Search {
        /// 搜索关键词
        query: String,
        /// 按 agent 过滤
        #[arg(short, long)]
        agent: Option<String>,
        /// 搜索日期之后 (YYYY-MM-DD)
        #[arg(long)]
        after: Option<String>,
        /// 搜索日期之前 (YYYY-MM-DD)
        #[arg(long)]
        before: Option<String>,
    },
    /// 统一记忆管理
    Memory {
        #[command(subcommand)]
        action: MemoryAction,
    },
    /// 列出运行中的终端会话（需要 Tauri 已启动）
    List,
    /// 向指定终端发送文本（需要 Tauri 已启动）
    Send {
        /// 会话 ID
        session_id: String,
        /// 要发送的文本
        text: String,
    },
}

#[derive(Subcommand)]
enum MemoryAction {
    /// 列出所有记忆
    List {
        #[arg(short, long)]
        agent: Option<String>,
    },
    /// 搜索记忆
    Search {
        /// 搜索关键词
        query: String,
    },
    /// 添加记忆
    Add {
        /// 记忆内容
        content: String,
        /// 类型: rule, decision, context, note
        #[arg(short, long, default_value = "note")]
        r#type: String,
    },
    /// 从各 agent 同步记忆
    Sync,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Status => cli::status::run(),
        Commands::History { agent, project, search, limit } => {
            cli::history::run(&agent, &project, &search, limit)
        }
        Commands::Show { session_id, format } => cli::show::run(&session_id, &format),
        Commands::Search { query, agent, after, before } => {
            cli::search::run(&query, &agent, &after, &before)
        }
        Commands::Memory { action } => match action {
            MemoryAction::List { agent } => cli::memory::list(&agent),
            MemoryAction::Search { query } => cli::memory::search(&query),
            MemoryAction::Add { content, r#type } => cli::memory::add(&content, &r#type),
            MemoryAction::Sync => cli::memory::sync(),
        },
        Commands::List => cli::list::run(),
        Commands::Send { session_id, text } => cli::send::run(&session_id, &text),
    }
}
