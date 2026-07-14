// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent;
mod agents;
mod commands;
mod files;
mod ipc;
mod settings;
mod terminal;
mod workspace;

use agent::{
    get_agent_profiles, get_messages, get_projects, get_sessions, open_in_terminal,
    search_sessions,
};
use agents::AgentRegistry;
use commands::TerminalManager;
use files::{list_directory, read_file, write_file};
use settings::Settings;
use terminal::{close_terminal, list_terminals, resize_terminal, send_to_terminal, spawn_shell, spawn_terminal};
use workspace::{
    load_global_workspace_state, load_workspace_state, save_global_workspace_state,
    save_workspace_state, WorkspaceManager,
};

fn main() {
    let settings = Settings::load().expect("Failed to load Agent Hub settings");
    let registry = AgentRegistry::from_profiles(settings.agents())
        .expect("Failed to create agent registry");
    let workspace_manager = WorkspaceManager::new(settings.config_dir.clone())
        .expect("Failed to initialize workspace manager");
    let terminal_manager = TerminalManager::new();

    // 启动 IPC 服务器（ah CLI 通过 TCP 通信）
    ipc::init(terminal_manager.clone_for_ipc());
    let port = ipc::find_port_and_save();
    ipc::start_server(port);

    tauri::Builder::default()
        .manage(settings)
        .manage(registry)
        .manage(terminal_manager)
        .manage(workspace_manager)
        .invoke_handler(tauri::generate_handler![
            get_projects,
            get_sessions,
            get_messages,
            get_agent_profiles,
            spawn_terminal,
            spawn_shell,
            send_to_terminal,
            resize_terminal,
            close_terminal,
            list_terminals,
            open_in_terminal,
            search_sessions,
            list_directory,
            read_file,
            write_file,
            load_workspace_state,
            save_workspace_state,
            load_global_workspace_state,
            save_global_workspace_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
