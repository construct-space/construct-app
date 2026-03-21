//! PTY terminal session management: spawn, write, resize, kill, list.

use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::Emitter;

struct PtySession {
    pair: PtyPair,
    writer: Box<dyn std::io::Write + Send>,
}

pub struct PtyState {
    sessions: HashMap<String, PtySession>,
}

pub type SharedPtyState = Arc<Mutex<PtyState>>;

pub fn new_state() -> SharedPtyState {
    Arc::new(Mutex::new(PtyState {
        sessions: HashMap::new(),
    }))
}

// Dock folder-open state (macOS RunEvent::Opened)
pub struct DockOpenState {
    pub pending_folders: Vec<String>,
    pub listener_ready: bool,
}

pub type SharedDockOpenState = Arc<Mutex<DockOpenState>>;

pub fn new_dock_state() -> SharedDockOpenState {
    Arc::new(Mutex::new(DockOpenState {
        pending_folders: Vec::new(),
        listener_ready: false,
    }))
}

#[derive(Clone, Serialize)]
struct PtyOutput {
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    session_id: String,
    code: i32,
}

#[tauri::command]
pub async fn pty_spawn(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedPtyState>,
    session_id: String,
    shell: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<bool, String> {
    eprintln!(
        "[PTY] Spawning session {} with shell {} in {}",
        session_id, shell, cwd
    );

    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to create PTY: {}", e))?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&cwd);

    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("LANG", "en_US.UTF-8");
    cmd.env("LC_ALL", "en_US.UTF-8");
    cmd.env("CLICOLOR", "1");
    cmd.env("CLICOLOR_FORCE", "1");
    cmd.env("LSCOLORS", "GxFxCxDxBxegedabagaced");
    cmd.env("LS_COLORS", "di=1;36:ln=1;35:so=1;32:pi=1;33:ex=1;31:bd=34;46:cd=34;43:su=30;41:sg=30;46:tw=30;42:ow=30;43");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

    {
        let mut pty_state = state.lock().map_err(|_| "Lock error")?;
        pty_state
            .sessions
            .insert(session_id.clone(), PtySession { pair, writer });
    }

    // Spawn thread to read PTY output
    let app_clone = app.clone();
    let session_id_clone = session_id.clone();
    thread::spawn(move || {
        use std::io::Read;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    eprintln!("[PTY {}] EOF", session_id_clone);
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(
                        "pty-output",
                        PtyOutput {
                            session_id: session_id_clone.clone(),
                            data,
                        },
                    );
                }
                Err(e) => {
                    eprintln!("[PTY {}] Read error: {}", session_id_clone, e);
                    break;
                }
            }
        }
    });

    // Spawn thread to wait for process exit
    let app_exit = app.clone();
    let session_id_exit = session_id.clone();
    let state_clone = state.inner().clone();
    thread::spawn(move || {
        let exit_status = child.wait();
        let code = match exit_status {
            Ok(status) => {
                if status.success() {
                    0
                } else {
                    1
                }
            }
            Err(_) => -1,
        };

        eprintln!(
            "[PTY {}] Process exited with code {}",
            session_id_exit, code
        );

        let _ = app_exit.emit(
            "pty-exit",
            PtyExit {
                session_id: session_id_exit.clone(),
                code,
            },
        );

        if let Ok(mut pty_state) = state_clone.lock() {
            pty_state.sessions.remove(&session_id_exit);
        }
    });

    eprintln!("[PTY] Session {} started", session_id);
    Ok(true)
}

#[tauri::command]
pub fn pty_write(
    state: tauri::State<'_, SharedPtyState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut pty_state = state.lock().map_err(|_| "Lock error")?;

    let session = pty_state
        .sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("Session {} not found", session_id))?;

    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write error: {}", e))?;

    session
        .writer
        .flush()
        .map_err(|e| format!("Flush error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    state: tauri::State<'_, SharedPtyState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let pty_state = state.lock().map_err(|_| "Lock error")?;

    let session = pty_state
        .sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session {} not found", session_id))?;

    session
        .pair
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize error: {}", e))?;

    eprintln!("[PTY {}] Resized to {}x{}", session_id, cols, rows);
    Ok(())
}

#[tauri::command]
pub fn pty_kill(state: tauri::State<'_, SharedPtyState>, session_id: String) -> Result<(), String> {
    let mut pty_state = state.lock().map_err(|_| "Lock error")?;

    if pty_state.sessions.remove(&session_id).is_some() {
        eprintln!("[PTY] Killed session {}", session_id);
    }

    Ok(())
}

#[tauri::command]
pub fn pty_list(state: tauri::State<'_, SharedPtyState>) -> Result<Vec<String>, String> {
    let pty_state = state.lock().map_err(|_| "Lock error")?;
    Ok(pty_state.sessions.keys().cloned().collect())
}

#[tauri::command]
pub fn dock_set_listener_ready(
    state: tauri::State<'_, SharedDockOpenState>,
) -> Result<Vec<String>, String> {
    let mut dock_state = state.lock().map_err(|_| "Lock error")?;
    dock_state.listener_ready = true;
    Ok(std::mem::take(&mut dock_state.pending_folders))
}

/// Shutdown: drop all PTY sessions.
pub fn shutdown_sessions(state: &SharedPtyState) {
    if let Ok(mut pty_state) = state.lock() {
        let sessions = std::mem::take(&mut pty_state.sessions);
        let count = sessions.len();
        drop(pty_state);
        drop(sessions);
        if count > 0 {
            eprintln!("[app] Cleaned up {} PTY sessions", count);
        }
    }
}
