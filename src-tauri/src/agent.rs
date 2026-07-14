use crate::agents::{AgentRegistry, Message, ProjectInfo, SessionInfo};
use crate::settings::AgentProfile;
use tauri::State;

#[tauri::command]
pub fn get_projects(registry: State<'_, AgentRegistry>) -> Result<Vec<ProjectInfo>, String> {
    let mut all_projects = Vec::new();
    for agent in registry.agents() {
        match agent.list_projects() {
            Ok(projects) => all_projects.extend(projects),
            Err(e) => eprintln!("Error listing projects for {}: {}", agent.name(), e),
        }
    }
    Ok(all_projects)
}

#[tauri::command]
pub fn get_sessions(
    project: Option<String>,
    agent_filter: Option<String>,
    registry: State<'_, AgentRegistry>,
) -> Result<Vec<SessionInfo>, String> {
    let mut all_sessions = Vec::new();
    for agent in registry.agents() {
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
        b.updated_at
            .unwrap_or_default()
            .cmp(&a.updated_at.unwrap_or_default())
    });
    Ok(all_sessions)
}

#[tauri::command]
pub fn get_messages(
    session_id: String,
    agent: String,
    registry: State<'_, AgentRegistry>,
) -> Result<Vec<Message>, String> {
    let agent_impl = registry
        .agent_by_name(&agent)
        .ok_or_else(|| format!("Unknown agent: {}", agent))?;
    agent_impl
        .get_messages(&session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_agent_profiles(
    registry: State<'_, AgentRegistry>,
) -> Result<Vec<AgentProfile>, String> {
    Ok(registry.profiles().to_vec())
}

#[tauri::command]
pub fn open_in_terminal(
    agent: String,
    session_id: String,
    registry: State<'_, AgentRegistry>,
) -> Result<(), String> {
    let profile = registry
        .profile_by_id(&agent)
        .ok_or_else(|| format!("Unknown agent: {}", agent))?;

    let cmd = profile.command.as_str();
    let args: Vec<String> = profile.args_for_session(&session_id);
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "cmd", "/k", cmd])
            .args(&arg_refs)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("x-terminal-emulator")
            .args(["-e", cmd])
            .args(&arg_refs)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn search_sessions(
    query: String,
    registry: State<'_, AgentRegistry>,
) -> Result<Vec<SessionInfo>, String> {
    let mut results = Vec::new();
    let query_lower = query.to_lowercase();

    for agent in registry.agents() {
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
