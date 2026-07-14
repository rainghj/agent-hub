// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agents;
mod commands;
mod settings;

use agents::AgentRegistry;
use commands::TerminalState;
use settings::Settings;

fn main() {
    let settings = Settings::load().expect("Failed to load Agent Hub settings");
    let registry = AgentRegistry::from_profiles(settings.agents())
        .expect("Failed to create agent registry");

    tauri::Builder::default()
        .manage(settings)
        .manage(registry)
        .manage(TerminalState::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_projects,
            commands::get_sessions,
            commands::get_messages,
            commands::get_agent_profiles,
            commands::spawn_terminal,
            commands::spawn_shell,
            commands::send_to_terminal,
            commands::resize_terminal,
            commands::close_terminal,
            commands::open_in_terminal,
            commands::search_sessions,
            commands::list_directory,
            commands::read_file,
            commands::write_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
