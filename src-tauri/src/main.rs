// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agents;
mod commands;

use commands::TerminalState;

fn main() {
    tauri::Builder::default()
        .manage(TerminalState::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_projects,
            commands::get_sessions,
            commands::get_messages,
            commands::spawn_terminal,
            commands::send_to_terminal,
            commands::resize_terminal,
            commands::close_terminal,
            commands::open_in_terminal,
            commands::search_sessions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
