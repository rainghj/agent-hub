use anyhow::Result;
use chrono::Utc;
use colored::*;
use rusqlite::Connection;
use std::fs;

fn get_memory_db() -> Result<Connection> {
    let db_dir = dirs::home_dir()
        .unwrap_or_default()
        .join(".agent-hub");
    fs::create_dir_all(&db_dir)?;

    let db_path = db_dir.join("memory.db");
    let conn = Connection::open(&db_path)?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent TEXT NOT NULL,
            session_id TEXT,
            project TEXT,
            type TEXT NOT NULL DEFAULT 'note',
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, tokenize='unicode61');"
    )?;

    Ok(conn)
}

pub fn list(agent_filter: &Option<String>) -> Result<()> {
    let conn = get_memory_db()?;

    println!("{}", "Agent Hub - Memories".bold().cyan());
    println!();

    let mut all_rows = Vec::new();

    if let Some(ref agent) = agent_filter {
        let mut stmt = conn.prepare(
            "SELECT id, agent, type, content, created_at FROM memories WHERE agent = ?1 ORDER BY created_at DESC LIMIT 50"
        )?;
        let rows = stmt.query_map([agent], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?;
        for row in rows {
            all_rows.push(row?);
        }
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, agent, type, content, created_at FROM memories ORDER BY created_at DESC LIMIT 50"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?;
        for row in rows {
            all_rows.push(row?);
        }
    }

    if all_rows.is_empty() {
        println!("{}", "No memories found.".yellow());
        println!();
        println!("Use `ah memory add \"content\"` to add a memory.");
        return Ok(());
    }

    for (id, agent, r#type, content, created_at) in &all_rows {
        let content_display = if content.chars().count() > 80 {
            let truncated: String = content.chars().take(77).collect();
            format!("{}...", truncated)
        } else {
            content.clone()
        };

        println!(
            "{} [{}] {} - {}",
            id.to_string().dimmed(),
            agent.green(),
            r#type.yellow(),
            content_display
        );
        println!("  {}", created_at.dimmed());
    }

    println!();
    println!("{} memories found", all_rows.len().to_string().bold());

    Ok(())
}

pub fn search(query: &str) -> Result<()> {
    let conn = get_memory_db()?;

    println!(
        "{} '{}'",
        "Searching memories for".bold().cyan(),
        query.bold()
    );
    println!();

    let mut stmt = conn.prepare(
        "SELECT m.id, m.agent, m.type, m.content, m.created_at
         FROM memories m
         JOIN memories_fts f ON m.id = f.rowid
         WHERE memories_fts MATCH ?1
         ORDER BY m.created_at DESC
         LIMIT 50"
    )?;

    let rows = stmt.query_map([query], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
        ))
    })?;

    let mut count = 0;
    for row in rows {
        let (id, agent, r#type, content, created_at) = row?;
        count += 1;

        let content_display = if content.chars().count() > 100 {
            let truncated: String = content.chars().take(97).collect();
            format!("{}...", truncated)
        } else {
            content.clone()
        };

        println!(
            "{} [{}] {} - {}",
            id.to_string().dimmed(),
            agent.green(),
            r#type.yellow(),
            content_display
        );
        println!("  {}", created_at.dimmed());
    }

    if count == 0 {
        println!("{}", "No matching memories found.".yellow());
    } else {
        println!();
        println!("{} matches found", count.to_string().bold());
    }

    Ok(())
}

pub fn add(content: &str, r#type: &str) -> Result<()> {
    let conn = get_memory_db()?;

    conn.execute(
        "INSERT INTO memories (agent, type, content, created_at, updated_at) VALUES ('global', ?1, ?2, ?3, ?3)",
        rusqlite::params![r#type, content, Utc::now().to_rfc3339()],
    )?;

    // 同步到 FTS 索引
    let last_id: i64 = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO memories_fts (rowid, content) VALUES (?1, ?2)",
        rusqlite::params![last_id, content],
    )?;

    println!("{}: Memory added (id: {})", "OK".green().bold(), last_id);
    Ok(())
}

pub fn sync() -> Result<()> {
    println!("{}", "Syncing memories from agents...".bold().cyan());
    println!();

    let conn = get_memory_db()?;
    let mut synced = 0;

    // 从 MiMo 同步
    let mimo_memory_dir = dirs::home_dir()
        .unwrap_or_default()
        .join(".local")
        .join("share")
        .join("mimocode")
        .join("memory");

    // 同步全局记忆
    let global_memory = mimo_memory_dir.join("global").join("MEMORY.md");
    if global_memory.exists() {
        let content = fs::read_to_string(&global_memory)?;
        let existing: i64 = conn.query_row(
            "SELECT COUNT(*) FROM memories WHERE agent = 'mimo' AND content = ?1",
            [&content],
            |row| row.get(0),
        )?;

        if existing == 0 && !content.trim().is_empty() {
            conn.execute(
                "INSERT INTO memories (agent, type, content, created_at, updated_at) VALUES ('mimo', 'rule', ?1, ?2, ?2)",
                rusqlite::params![content, Utc::now().to_rfc3339()],
            )?;
            synced += 1;
            println!("  {} MiMo global memory", "+".green());
        }
    }

    // 同步会话检查点
    let sessions_dir = mimo_memory_dir.join("sessions");
    if sessions_dir.exists() {
        for entry in fs::read_dir(&sessions_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                let checkpoint = path.join("checkpoint.md");
                if checkpoint.exists() {
                    let content = fs::read_to_string(&checkpoint)?;
                    let session_id = path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string();

                    let existing: i64 = conn.query_row(
                        "SELECT COUNT(*) FROM memories WHERE session_id = ?1",
                        [&session_id],
                        |row| row.get(0),
                    )?;

                    if existing == 0 && !content.trim().is_empty() {
                        // 截取前 1000 字符作为摘要
                        let summary = if content.chars().count() > 1000 {
                            let truncated: String = content.chars().take(1000).collect();
                            format!("{}...", truncated)
                        } else {
                            content
                        };

                        conn.execute(
                            "INSERT INTO memories (agent, session_id, type, content, created_at, updated_at) VALUES ('mimo', ?1, 'context', ?2, ?3, ?3)",
                            rusqlite::params![session_id, summary, Utc::now().to_rfc3339()],
                        )?;
                        synced += 1;
                        println!("  {} MiMo session: {}", "+".green(), &session_id[..20.min(session_id.len())]);
                    }
                }
            }
        }
    }

    // 从 Claude 同步
    let claude_projects_dir = dirs::home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("projects");

    if claude_projects_dir.exists() {
        for entry in fs::read_dir(&claude_projects_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                let memory_dir = path.join("memory");
                if memory_dir.exists() {
                    for mem_entry in fs::read_dir(&memory_dir)? {
                        let mem_entry = mem_entry?;
                        let mem_path = mem_entry.path();
                        if mem_path.extension().and_then(|e| e.to_str()) == Some("md") {
                            let content = fs::read_to_string(&mem_path)?;
                            let filename = mem_path.file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("")
                                .to_string();

                            let existing: i64 = conn.query_row(
                                "SELECT COUNT(*) FROM memories WHERE agent = 'claude' AND content = ?1",
                                [&content],
                                |row| row.get(0),
                            )?;

                            if existing == 0 && !content.trim().is_empty() {
                                conn.execute(
                                    "INSERT INTO memories (agent, type, content, created_at, updated_at) VALUES ('claude', 'context', ?1, ?2, ?2)",
                                    rusqlite::params![content, Utc::now().to_rfc3339()],
                                )?;
                                synced += 1;
                                println!("  {} Claude memory: {}", "+".green(), filename);
                            }
                        }
                    }
                }
            }
        }
    }

    println!();
    println!("{} memories synced", synced.to_string().bold());

    Ok(())
}
