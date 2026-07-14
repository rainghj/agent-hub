// commands.rs — re-export hub for all Tauri commands and public types
//
// Each command is defined in its own module (terminal.rs, agent.rs, files.rs, workspace.rs).
// main.rs imports directly from those modules for generate_handler! (Tauri needs the __cmd__*
// macros in the same namespace as the function), while this file serves as a single-pane-of-glass
// for discovering what commands exist.

#![allow(unused_imports)]
pub use crate::agent::{
    get_agent_profiles, get_messages, get_projects, get_sessions, open_in_terminal,
    search_sessions,
};
pub use crate::files::{
    list_directory, read_file, write_file, DirEntry,
};
pub use crate::terminal::{
    close_terminal, list_terminals, resize_terminal, send_to_terminal, spawn_shell,
    spawn_terminal, TerminalManager, TerminalSessionInfo,
};
pub use crate::workspace::{
    load_global_workspace_state, load_workspace_state, save_global_workspace_state,
    save_workspace_state,
};
