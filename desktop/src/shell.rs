//! Shell command execution: run, spawn, kill, input, list.

use crate::config::get_user_shell_path;

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Emitter;

pub struct ProcessState {
    processes: HashMap<String, Child>,
}

pub type SharedProcessState = Arc<Mutex<ProcessState>>;

pub fn new_state() -> SharedProcessState {
    Arc::new(Mutex::new(ProcessState {
        processes: HashMap::new(),
    }))
}

#[derive(Clone, Serialize)]
struct ProcessOutput {
    process_id: String,
    stream: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct ProcessExit {
    process_id: String,
    code: Option<i32>,
    success: bool,
}

#[tauri::command]
pub async fn run_shell_command(
    command: String,
    args: Vec<String>,
    cwd: String,
) -> Result<serde_json::Value, String> {
    let output = Command::new(&command)
        .args(&args)
        .current_dir(&cwd)
        .env("PATH", get_user_shell_path())
        .output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    Ok(serde_json::json!({
        "success": output.status.success(),
        "code": output.status.code(),
        "stdout": stdout,
        "stderr": stderr
    }))
}

#[tauri::command]
pub async fn spawn_shell_command(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedProcessState>,
    process_id: String,
    command: String,
    args: Vec<String>,
    cwd: String,
) -> Result<serde_json::Value, String> {
    eprintln!(
        "[Shell] Spawning: {} {:?} in {} (id: {})",
        command, args, cwd, process_id
    );

    let mut child = Command::new(&command)
        .args(&args)
        .current_dir(&cwd)
        .env("PATH", get_user_shell_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("TERM", "dumb")
        .env("CI", "true")
        .env("FLUTTER_SUPPRESS_ANALYTICS", "true")
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    let pid = child.id();
    eprintln!("[Shell] Spawned process with PID: {}", pid);

    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to get stderr")?;

    {
        let mut proc_state = state.lock().map_err(|_| "Lock error")?;
        proc_state.processes.insert(process_id.clone(), child);
    }

    // Spawn thread to read stdout
    let app_stdout = app.clone();
    let pid_stdout = process_id.clone();
    thread::spawn(move || {
        let mut reader = BufReader::with_capacity(256, stdout);
        let mut buffer = [0u8; 1024];
        let mut line_buffer = String::new();

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buffer[..n]);
                    line_buffer.push_str(&chunk);

                    while let Some(newline_pos) = line_buffer.find('\n') {
                        let line = line_buffer[..newline_pos].to_string();
                        line_buffer = line_buffer[newline_pos + 1..].to_string();

                        if !line.is_empty() {
                            let _ = app_stdout.emit(
                                "process-output",
                                ProcessOutput {
                                    process_id: pid_stdout.clone(),
                                    stream: "stdout".to_string(),
                                    data: line,
                                },
                            );
                        }
                    }

                    if !line_buffer.is_empty() && line_buffer.len() > 80 {
                        let partial = std::mem::take(&mut line_buffer);
                        let _ = app_stdout.emit(
                            "process-output",
                            ProcessOutput {
                                process_id: pid_stdout.clone(),
                                stream: "stdout".to_string(),
                                data: partial,
                            },
                        );
                    }
                }
                Err(_) => break,
            }
        }

        if !line_buffer.is_empty() {
            let _ = app_stdout.emit(
                "process-output",
                ProcessOutput {
                    process_id: pid_stdout.clone(),
                    stream: "stdout".to_string(),
                    data: line_buffer,
                },
            );
        }
    });

    // Spawn thread to read stderr
    let app_stderr = app.clone();
    let pid_stderr = process_id.clone();
    thread::spawn(move || {
        let mut reader = BufReader::with_capacity(256, stderr);
        let mut buffer = [0u8; 1024];
        let mut line_buffer = String::new();

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buffer[..n]);
                    line_buffer.push_str(&chunk);

                    while let Some(newline_pos) = line_buffer.find('\n') {
                        let line = line_buffer[..newline_pos].to_string();
                        line_buffer = line_buffer[newline_pos + 1..].to_string();

                        if !line.is_empty() {
                            let _ = app_stderr.emit(
                                "process-output",
                                ProcessOutput {
                                    process_id: pid_stderr.clone(),
                                    stream: "stderr".to_string(),
                                    data: line,
                                },
                            );
                        }
                    }

                    if !line_buffer.is_empty() && line_buffer.len() > 80 {
                        let partial = std::mem::take(&mut line_buffer);
                        let _ = app_stderr.emit(
                            "process-output",
                            ProcessOutput {
                                process_id: pid_stderr.clone(),
                                stream: "stderr".to_string(),
                                data: partial,
                            },
                        );
                    }
                }
                Err(_) => break,
            }
        }

        if !line_buffer.is_empty() {
            let _ = app_stderr.emit(
                "process-output",
                ProcessOutput {
                    process_id: pid_stderr.clone(),
                    stream: "stderr".to_string(),
                    data: line_buffer,
                },
            );
        }
    });

    // Spawn thread to wait for process exit
    let app_exit = app.clone();
    let pid_exit = process_id.clone();
    let state_clone = state.inner().clone();
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_millis(500));

            let mut proc_state = match state_clone.lock() {
                Ok(s) => s,
                Err(_) => break,
            };

            if let Some(child) = proc_state.processes.get_mut(&pid_exit) {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        let code = status.code();
                        let success = status.success();
                        eprintln!("[Shell] Process {} exited with code: {:?}", pid_exit, code);

                        let _ = app_exit.emit(
                            "process-exit",
                            ProcessExit {
                                process_id: pid_exit.clone(),
                                code,
                                success,
                            },
                        );

                        proc_state.processes.remove(&pid_exit);
                        break;
                    }
                    Ok(None) => {}
                    Err(e) => {
                        eprintln!("[Shell] Error waiting for process {}: {}", pid_exit, e);
                        break;
                    }
                }
            } else {
                break;
            }
        }
    });

    Ok(serde_json::json!({
        "success": true,
        "pid": pid,
        "process_id": process_id
    }))
}

#[tauri::command]
pub fn kill_shell_process(
    state: tauri::State<'_, SharedProcessState>,
    process_id: String,
) -> Result<bool, String> {
    let mut proc_state = state.lock().map_err(|_| "Lock error")?;

    if let Some(mut child) = proc_state.processes.remove(&process_id) {
        eprintln!("[Shell] Killing process: {}", process_id);
        match child.kill() {
            Ok(_) => {
                let _ = child.wait();
                Ok(true)
            }
            Err(e) => Err(format!("Failed to kill process: {}", e)),
        }
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub fn send_process_input(
    state: tauri::State<'_, SharedProcessState>,
    process_id: String,
    input: String,
) -> Result<bool, String> {
    eprintln!(
        "[Shell] Sending input '{}' to process: {}",
        input, process_id
    );

    let mut proc_state = state.lock().map_err(|_| "Lock error")?;

    eprintln!(
        "[Shell] Available processes: {:?}",
        proc_state.processes.keys().collect::<Vec<_>>()
    );

    if let Some(child) = proc_state.processes.get_mut(&process_id) {
        if let Some(stdin) = child.stdin.as_mut() {
            use std::io::Write;
            let input_with_newline = if input.ends_with('\n') {
                input
            } else {
                format!("{}\n", input)
            };
            eprintln!("[Shell] Writing to stdin: {:?}", input_with_newline);
            stdin
                .write_all(input_with_newline.as_bytes())
                .map_err(|e| format!("Write error: {}", e))?;
            stdin.flush().map_err(|e| format!("Flush error: {}", e))?;
            eprintln!("[Shell] Input sent successfully");
            return Ok(true);
        } else {
            eprintln!("[Shell] No stdin available for process");
        }
    } else {
        eprintln!("[Shell] Process not found: {}", process_id);
    }

    Ok(false)
}

#[tauri::command]
pub fn list_shell_processes(
    state: tauri::State<'_, SharedProcessState>,
) -> Result<Vec<String>, String> {
    let proc_state = state.lock().map_err(|_| "Lock error")?;
    Ok(proc_state.processes.keys().cloned().collect())
}

/// Shutdown: kill all running shell processes.
pub fn shutdown_processes(state: &SharedProcessState) {
    if let Ok(mut proc_state) = state.lock() {
        for (id, mut child) in proc_state.processes.drain() {
            eprintln!("[app] Killing shell process {}", id);
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
