//! Operator connection management, context commands, and streaming.

use crate::config::{
    bridge_port, construct_data_dir, is_dev_instance, new_client_id, operator_address,
    operator_port, BRIDGE_TOKEN, MESSAGE_ID, OPERATOR_HOST, SPAWN_LOCK,
};

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{Shutdown, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Emitter;

pub struct ContextState {
    pub socket: Option<TcpStream>,
    pub host: String,
    pub port: u16,
    pub client_id: String,
    pub address: Option<String>,
    pub child: Option<Child>,
    pub active_streams: HashMap<String, TcpStream>,
}

pub type SharedContextState = Arc<Mutex<ContextState>>;

pub fn new_state() -> SharedContextState {
    Arc::new(Mutex::new(ContextState {
        socket: None,
        host: OPERATOR_HOST.to_string(),
        port: 0,
        client_id: new_client_id(),
        address: None,
        child: None,
        active_streams: HashMap::new(),
    }))
}

#[derive(Clone, Serialize, Deserialize)]
struct ContextRequest {
    id: String,
    #[serde(rename = "type")]
    request_type: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    client_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<serde_json::Value>,
}

#[derive(Clone, Serialize, Deserialize)]
struct ContextResponse {
    id: Option<String>,
    success: Option<bool>,
    data: Option<serde_json::Value>,
    error: Option<String>,
    #[serde(rename = "type")]
    message_type: Option<String>,
}

/// Resolve path to the operator binary.
fn resolve_operator_path(_app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let target = if cfg!(target_arch = "aarch64") {
        "aarch64-apple-darwin"
    } else if cfg!(target_arch = "x86_64") && cfg!(target_os = "macos") {
        "x86_64-apple-darwin"
    } else if cfg!(target_arch = "x86_64") && cfg!(target_os = "linux") {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(target_os = "windows") {
        "x86_64-pc-windows-msvc"
    } else {
        "unknown"
    };

    let sidecar_name = if cfg!(target_os = "windows") {
        format!("construct-operator-{}.exe", target)
    } else {
        format!("construct-operator-{}", target)
    };

    let exe_dir = std::env::current_exe()
        .map_err(|e| format!("Failed to get exe path: {}", e))?
        .parent()
        .ok_or_else(|| "Failed to get exe dir".to_string())?
        .to_path_buf();

    let search_paths = [
        // Tauri bundles externalBin as bare name in .app/Contents/MacOS/
        exe_dir.join("construct-operator"),
        // Dev mode: target-triple name in desktop/bin/
        exe_dir.join(&sidecar_name),
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("bin")
            .join(&sidecar_name),
    ];

    for path in &search_paths {
        if path.exists() {
            eprintln!("[operator] Using bundled operator: {}", path.display());
            return Ok(path.clone());
        }
    }

    let tried: Vec<_> = search_paths.iter().map(|p| p.display().to_string()).collect();
    Err(format!(
        "Operator binary not found. Searched: {}",
        tried.join(", ")
    ))
}

#[tauri::command]
pub async fn start_context_service(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedContextState>,
) -> Result<String, String> {
    let op_addr = operator_address();
    let selected_operator_port = operator_port();
    let selected_bridge_port = bridge_port();

    if let Ok(ctx) = state.lock() {
        if let Some(addr) = ctx.address.clone() {
            if TcpStream::connect(&addr).is_ok() {
                return Ok(addr);
            }
        }
    }

    let _guard = SPAWN_LOCK.lock().await;

    if let Ok(ctx) = state.lock() {
        if let Some(addr) = ctx.address.clone() {
            if TcpStream::connect(&addr).is_ok() {
                return Ok(addr);
            }
        }
    }

    eprintln!(
        "[operator] start_context_service: trying well-known port {}...",
        op_addr
    );
    if let Ok(socket) = TcpStream::connect(&op_addr) {
        eprintln!(
            "[operator] start_context_service: connected to Operator at {}",
            op_addr
        );
        let mut ctx = state.lock().map_err(|_| "Lock error".to_string())?;
        ctx.host = OPERATOR_HOST.to_string();
        ctx.port = selected_operator_port;
        ctx.address = Some(op_addr.clone());
        ctx.socket = Some(socket);
        return Ok(op_addr);
    }
    eprintln!(
        "[operator] start_context_service: {} not available, will spawn",
        op_addr
    );

    {
        let mut ctx = state.lock().map_err(|_| "Lock error".to_string())?;
        ctx.socket = None;
        ctx.address = None;
        if let Some(mut old_child) = ctx.child.take() {
            let _ = old_child.kill();
            let _ = old_child.wait();
        }
    }

    let operator_path = resolve_operator_path(&app)?;
    eprintln!(
        "[operator] start_context_service: spawning operator from {} (exists: {})",
        operator_path.display(),
        operator_path.exists()
    );

    let mut cmd = Command::new(&operator_path);
    cmd.arg("--port")
        .arg(selected_operator_port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    cmd.env("CONSTRUCT_BRIDGE_TOKEN", BRIDGE_TOKEN.as_str());
    cmd.env("CONSTRUCT_BRIDGE_PORT", selected_bridge_port.to_string());

    let data_dir = construct_data_dir()?;
    cmd.env("CONSTRUCT_DATA_DIR", &data_dir);
    cmd.env("CONSTRUCT_PARENT_PID", std::process::id().to_string());

    if is_dev_instance() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let spaces_path = std::path::Path::new(manifest_dir)
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("frontend")
            .join("spaces");
        if spaces_path.exists() {
            eprintln!(
                "[operator] start_context_service: setting CONSTRUCT_SPACES_PATH={}",
                spaces_path.display()
            );
            cmd.env("CONSTRUCT_SPACES_PATH", &spaces_path);
        }
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn operator: {}", e))?;

    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    eprintln!("[operator] {}", line);
                }
            }
        });
    }

    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        if let Ok(socket) = TcpStream::connect(&op_addr) {
            eprintln!(
                "[operator] start_context_service: connected to {}",
                op_addr
            );
            let child_running = matches!(child.try_wait(), Ok(None));
            let mut ctx = state.lock().map_err(|_| "Lock error".to_string())?;
            ctx.host = OPERATOR_HOST.to_string();
            ctx.port = selected_operator_port;
            ctx.address = Some(op_addr.clone());
            ctx.socket = Some(socket);
            ctx.child = if child_running { Some(child) } else { None };
            return Ok(op_addr);
        }

        if let Ok(Some(status)) = child.try_wait() {
            eprintln!(
                "[operator] start_context_service: spawned child exited before connect: {}",
                status
            );
            let _ = child.wait();
            if let Ok(socket) = TcpStream::connect(&op_addr) {
                eprintln!(
                    "[operator] start_context_service: connected to existing operator at {}",
                    op_addr
                );
                let mut ctx = state.lock().map_err(|_| "Lock error".to_string())?;
                ctx.host = OPERATOR_HOST.to_string();
                ctx.port = selected_operator_port;
                ctx.address = Some(op_addr.clone());
                ctx.socket = Some(socket);
                ctx.child = None;
                return Ok(op_addr);
            }
            return Err(format!(
                "Operator exited immediately with status: {}. Check logs for details.",
                status
            ));
        }

        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Operator startup timed out (15s)".to_string());
        }

        thread::sleep(Duration::from_millis(100));
    }
}

#[tauri::command]
pub fn connect_context(
    state: tauri::State<'_, SharedContextState>,
    address: String,
) -> Result<(), String> {
    {
        let ctx = state.lock().map_err(|_| "Lock error".to_string())?;
        if ctx.socket.is_some() && ctx.address.as_ref() == Some(&address) {
            return Ok(());
        }
    }

    let parts: Vec<&str> = address.split(':').collect();
    if parts.len() != 2 {
        return Err("Invalid address format".to_string());
    }

    let host = parts[0].to_string();
    let port: u16 = parts[1]
        .parse()
        .map_err(|_| "Invalid port number".to_string())?;

    let socket = TcpStream::connect(&address).map_err(|e| format!("Connection failed: {}", e))?;

    let mut ctx = state.lock().map_err(|_| "Lock error".to_string())?;
    ctx.socket = Some(socket);
    ctx.host = host;
    ctx.port = port;
    ctx.address = Some(address);

    Ok(())
}

#[tauri::command]
pub fn is_connected(state: tauri::State<'_, SharedContextState>) -> bool {
    state
        .lock()
        .map(|ctx| ctx.socket.is_some())
        .unwrap_or(false)
}

fn get_request_timeout(request_type: &str) -> Duration {
    if request_type.starts_with("ai.")
        || request_type.starts_with("agents.")
        || request_type.starts_with("oauth.")
    {
        Duration::from_secs(300)
    } else {
        Duration::from_secs(30)
    }
}

fn send_request_internal(
    socket: &mut TcpStream,
    client_id: &str,
    request_type: String,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let id = MESSAGE_ID.fetch_add(1, Ordering::SeqCst).to_string();

    let request = ContextRequest {
        id: id.clone(),
        request_type: request_type.clone(),
        client_id: client_id.to_string(),
        payload,
    };

    let timeout = get_request_timeout(&request_type);
    let _ = socket.set_read_timeout(Some(timeout));

    let request_json = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    socket
        .write_all(format!("{}\n", request_json).as_bytes())
        .map_err(|e| format!("Write failed: {}", e))?;

    let mut reader = BufReader::new(socket.try_clone().map_err(|e| e.to_string())?);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => return Err("Connection closed".to_string()),
            Ok(_) => {}
            Err(e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                return Err(format!("Request timeout after {:?}", timeout));
            }
            Err(e) => return Err(format!("Read failed: {}", e)),
        }

        if line.trim().is_empty() {
            continue;
        }

        let response: ContextResponse =
            serde_json::from_str(&line).map_err(|e| format!("Parse failed: {}", e))?;

        if response.id.as_ref() == Some(&id) {
            if response.success.unwrap_or(false) {
                return Ok(response.data.unwrap_or(serde_json::Value::Null));
            } else {
                return Err(response
                    .error
                    .unwrap_or_else(|| "Unknown error".to_string()));
            }
        }
    }
}

#[tauri::command]
pub fn send_context_request(
    state: tauri::State<'_, SharedContextState>,
    request_type: String,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let mut ctx = state.lock().map_err(|_| "Lock error".to_string())?;

    let address = ctx.address.clone();
    let client_id = ctx.client_id.clone();

    let socket = ctx
        .socket
        .as_mut()
        .ok_or_else(|| "Not connected".to_string())?;

    match send_request_internal(socket, &client_id, request_type.clone(), payload.clone()) {
        Ok(result) => Ok(result),
        Err(e) if e.contains("Broken pipe") || e.contains("Connection reset") => {
            eprintln!("[Context] Connection lost, attempting reconnect...");

            if let Some(addr) = address {
                match TcpStream::connect(&addr) {
                    Ok(new_socket) => {
                        ctx.socket = Some(new_socket);
                        eprintln!("[Context] Reconnected successfully");
                        let socket = ctx.socket.as_mut().unwrap();
                        send_request_internal(socket, &client_id, request_type, payload)
                    }
                    Err(reconnect_err) => {
                        ctx.socket = None;
                        Err(format!(
                            "Connection lost and reconnect failed: {}",
                            reconnect_err
                        ))
                    }
                }
            } else {
                ctx.socket = None;
                Err("Connection lost and no address available for reconnect".to_string())
            }
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn context_get(
    state: tauri::State<'_, SharedContextState>,
) -> Result<serde_json::Value, String> {
    send_context_request(state, "context.get".to_string(), None)
}

#[tauri::command]
pub fn context_set_mode(
    state: tauri::State<'_, SharedContextState>,
    mode: String,
) -> Result<serde_json::Value, String> {
    send_context_request(
        state,
        "context.set_mode".to_string(),
        Some(serde_json::json!({ "mode": mode })),
    )
}

#[tauri::command]
pub fn context_set_component(
    state: tauri::State<'_, SharedContextState>,
    component: serde_json::Value,
) -> Result<serde_json::Value, String> {
    send_context_request(state, "context.set_component".to_string(), Some(component))
}

#[tauri::command]
pub fn context_set_project(
    state: tauri::State<'_, SharedContextState>,
    project: serde_json::Value,
) -> Result<serde_json::Value, String> {
    send_context_request(state, "context.set_project".to_string(), Some(project))
}

#[tauri::command]
pub fn context_set_selection(
    state: tauri::State<'_, SharedContextState>,
    selection: serde_json::Value,
) -> Result<serde_json::Value, String> {
    send_context_request(state, "context.set_selection".to_string(), Some(selection))
}

#[tauri::command]
pub fn context_ping(
    state: tauri::State<'_, SharedContextState>,
) -> Result<serde_json::Value, String> {
    send_context_request(state, "system.ping".to_string(), None)
}

#[tauri::command]
pub fn list_models(
    state: tauri::State<'_, SharedContextState>,
) -> Result<serde_json::Value, String> {
    send_context_request(state, "ai.models".to_string(), None)
}

#[tauri::command]
pub fn list_providers(
    state: tauri::State<'_, SharedContextState>,
) -> Result<serde_json::Value, String> {
    send_context_request(state, "ai.providers".to_string(), None)
}

#[tauri::command]
pub fn list_agents(
    state: tauri::State<'_, SharedContextState>,
) -> Result<serde_json::Value, String> {
    send_context_request(state, "agents.list".to_string(), None)
}

#[tauri::command]
pub fn chat_direct(
    state: tauri::State<'_, SharedContextState>,
    model: String,
    messages: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    send_context_request(
        state,
        "ai.chat_direct".to_string(),
        Some(serde_json::json!({
            "model": model,
            "messages": messages
        })),
    )
}

#[derive(Clone, Serialize, Deserialize)]
struct ModelRoute {
    tier: Option<String>,
    model: Option<String>,
    reason: Option<String>,
    #[serde(rename = "hasVision")]
    has_vision: Option<bool>,
    complexity: Option<String>,
}

#[derive(Clone, Serialize)]
struct StreamChunk {
    content: String,
    done: bool,
    error: Option<String>,
    #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
    #[serde(rename = "type")]
    message_type: Option<String>,
    route: Option<ModelRoute>,
    data: Option<serde_json::Value>,
}

/// Helper: run a streaming command on a dedicated TCP connection, emitting chunks on the given event name.
fn run_stream(
    app: tauri::AppHandle,
    host: String,
    port: u16,
    client_id: String,
    request_type: String,
    payload: Option<serde_json::Value>,
    event_name: &'static str,
    request_id: Option<String>,
    stream_state: Option<SharedContextState>,
) {
    thread::spawn(move || {
        let address = format!("{}:{}", host, port);
        let mut socket = match TcpStream::connect(&address) {
            Ok(s) => s,
            Err(e) => {
                let _ = app.emit(
                    event_name,
                    StreamChunk {
                        content: String::new(),
                        done: true,
                        error: Some(format!("Connection failed: {}", e)),
                        request_id: request_id.clone(),
                        message_type: None,
                        route: None,
                        data: None,
                    },
                );
                return;
            }
        };

        // Store stream handle for cancellation if needed
        if let (Some(req_id), Some(ref ss)) = (request_id.as_ref(), &stream_state) {
            match socket.try_clone() {
                Ok(stream_handle) => {
                    if let Ok(mut ctx) = ss.lock() {
                        ctx.active_streams.insert(req_id.clone(), stream_handle);
                    }
                }
                Err(e) => {
                    let _ = app.emit(
                        event_name,
                        StreamChunk {
                            content: String::new(),
                            done: true,
                            error: Some(format!("Stream setup failed: {}", e)),
                            request_id: request_id.clone(),
                            message_type: None,
                            route: None,
                            data: None,
                        },
                    );
                    return;
                }
            }
        }

        let _ = socket.set_read_timeout(Some(Duration::from_secs(300)));
        let id = MESSAGE_ID.fetch_add(1, Ordering::SeqCst).to_string();

        let request = ContextRequest {
            id: id.clone(),
            request_type,
            client_id,
            payload,
        };

        let request_json = match serde_json::to_string(&request) {
            Ok(json) => json,
            Err(e) => {
                cleanup_stream(&stream_state, &request_id);
                let _ = app.emit(
                    event_name,
                    StreamChunk {
                        content: String::new(),
                        done: true,
                        error: Some(format!("Serialize failed: {}", e)),
                        request_id: request_id.clone(),
                        message_type: None,
                        route: None,
                        data: None,
                    },
                );
                return;
            }
        };

        if let Err(e) = socket.write_all(format!("{}\n", request_json).as_bytes()) {
            cleanup_stream(&stream_state, &request_id);
            let _ = app.emit(
                event_name,
                StreamChunk {
                    content: String::new(),
                    done: true,
                    error: Some(format!("Write failed: {}", e)),
                    request_id: request_id.clone(),
                    message_type: None,
                    route: None,
                    data: None,
                },
            );
            return;
        }

        let mut reader = BufReader::new(socket);
        let mut line = String::new();

        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    let _ = app.emit(
                        event_name,
                        StreamChunk {
                            content: String::new(),
                            done: true,
                            error: Some("Connection closed".to_string()),
                            request_id: request_id.clone(),
                            message_type: None,
                            route: None,
                            data: None,
                        },
                    );
                    break;
                }
                Ok(_) => {}
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                {
                    let _ = app.emit(
                        event_name,
                        StreamChunk {
                            content: String::new(),
                            done: true,
                            error: Some("Request timeout".to_string()),
                            request_id: request_id.clone(),
                            message_type: None,
                            route: None,
                            data: None,
                        },
                    );
                    break;
                }
                Err(e) => {
                    let _ = app.emit(
                        event_name,
                        StreamChunk {
                            content: String::new(),
                            done: true,
                            error: Some(format!("Read failed: {}", e)),
                            request_id: request_id.clone(),
                            message_type: None,
                            route: None,
                            data: None,
                        },
                    );
                    break;
                }
            }

            if line.trim().is_empty() {
                continue;
            }

            if let Ok(response) = serde_json::from_str::<serde_json::Value>(&line) {
                if response.get("id").and_then(|v| v.as_str()) == Some(&id) {
                    let content = response
                        .get("content")
                        .and_then(|v| v.as_str())
                        .or_else(|| {
                            response
                                .get("data")
                                .and_then(|d| d.get("text"))
                                .and_then(|v| v.as_str())
                        })
                        .unwrap_or("")
                        .to_string();
                    let done = response
                        .get("done")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    let error_str = response
                        .get("error")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .or_else(|| {
                            response
                                .get("data")
                                .and_then(|d| d.get("error"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                        });
                    let message_type = response
                        .get("type")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let route = response
                        .get("route")
                        .and_then(|r| serde_json::from_value::<ModelRoute>(r.clone()).ok());
                    let data = response.get("data").cloned();

                    let _ = app.emit(
                        event_name,
                        StreamChunk {
                            content,
                            done,
                            error: error_str.clone(),
                            request_id: request_id.clone(),
                            message_type,
                            route,
                            data,
                        },
                    );

                    if done || error_str.is_some() {
                        break;
                    }
                }
            }
        }

        cleanup_stream(&stream_state, &request_id);
    });
}

fn cleanup_stream(stream_state: &Option<SharedContextState>, request_id: &Option<String>) {
    if let (Some(req_id), Some(ss)) = (request_id.as_ref(), stream_state.as_ref()) {
        if let Ok(mut ctx) = ss.lock() {
            ctx.active_streams.remove(req_id);
        }
    }
}

#[tauri::command]
pub async fn chat_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedContextState>,
    model: String,
    messages: Vec<serde_json::Value>,
    token: Option<String>,
    agent_id: Option<String>,
    space: Option<String>,
    local_data: Option<serde_json::Value>,
    max_iterations: Option<i32>,
) -> Result<(), String> {
    let (host, port, client_id) = {
        let ctx = state.lock().map_err(|_| "Lock error".to_string())?;
        if ctx.socket.is_none() {
            return Err("Not connected".to_string());
        }
        (ctx.host.clone(), ctx.port, ctx.client_id.clone())
    };

    run_stream(
        app,
        host,
        port,
        client_id,
        "ai.chat_stream".to_string(),
        Some(serde_json::json!({
            "model": model,
            "messages": messages,
            "token": token.unwrap_or_default(),
            "agent_id": agent_id.unwrap_or_default(),
            "space": space.unwrap_or_default(),
            "local_data": local_data,
            "max_iterations": max_iterations.unwrap_or(0)
        })),
        "chat-stream-chunk",
        None,
        None,
    );

    Ok(())
}

#[tauri::command]
pub async fn architect_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedContextState>,
    model: String,
    mode: String,
    description: String,
    answers: Option<serde_json::Value>,
    current_question: Option<serde_json::Value>,
    clarification: Option<String>,
    plan_json: Option<String>,
    installed_spaces: Option<Vec<serde_json::Value>>,
) -> Result<(), String> {
    let (host, port, client_id) = {
        let ctx = state.lock().map_err(|_| "Lock error".to_string())?;
        if ctx.socket.is_none() {
            return Err("Not connected".to_string());
        }
        (ctx.host.clone(), ctx.port, ctx.client_id.clone())
    };

    run_stream(
        app,
        host,
        port,
        client_id,
        "ai.architect_stream".to_string(),
        Some(serde_json::json!({
            "model": model,
            "mode": mode,
            "description": description,
            "answers": answers,
            "current_question": current_question,
            "clarification": clarification,
            "plan_json": plan_json,
            "installed_spaces": installed_spaces,
        })),
        "architect-stream-chunk",
        None,
        None,
    );

    Ok(())
}

#[tauri::command]
pub async fn vibe_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedContextState>,
    model: String,
    messages: Vec<serde_json::Value>,
    source: Option<String>,
    goal: Option<String>,
    session_id: Option<String>,
    local_data: Option<serde_json::Value>,
    max_iterations: Option<i32>,
) -> Result<(), String> {
    let (host, port, client_id) = {
        let ctx = state.lock().map_err(|_| "Lock error".to_string())?;
        if ctx.socket.is_none() {
            return Err("Not connected".to_string());
        }
        (ctx.host.clone(), ctx.port, ctx.client_id.clone())
    };

    run_stream(
        app,
        host,
        port,
        client_id,
        "ai.vibe_stream".to_string(),
        Some(serde_json::json!({
            "model": model,
            "messages": messages,
            "source": source,
            "goal": goal,
            "session_id": session_id,
            "local_data": local_data,
            "max_iterations": max_iterations.unwrap_or(0)
        })),
        "vibe-stream-chunk",
        None,
        None,
    );

    Ok(())
}

#[tauri::command]
pub async fn operator_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedContextState>,
    request_type: String,
    payload: Option<serde_json::Value>,
    request_id: Option<String>,
) -> Result<(), String> {
    let (host, port, client_id) = {
        let ctx = state.lock().map_err(|_| "Lock error".to_string())?;
        if ctx.socket.is_none() {
            return Err("Not connected".to_string());
        }
        (ctx.host.clone(), ctx.port, ctx.client_id.clone())
    };

    run_stream(
        app,
        host,
        port,
        client_id,
        request_type,
        payload,
        "operator-stream-chunk",
        request_id,
        Some(state.inner().clone()),
    );

    Ok(())
}

#[tauri::command]
pub fn operator_stop_stream(
    state: tauri::State<'_, SharedContextState>,
    request_id: String,
) -> Result<(), String> {
    let stream = {
        let mut ctx = state.lock().map_err(|_| "Lock error".to_string())?;
        ctx.active_streams.remove(&request_id)
    };

    if let Some(stream) = stream {
        let _ = stream.shutdown(Shutdown::Both);
    }

    Ok(())
}

#[tauri::command]
pub async fn vision_analyze(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedContextState>,
    model: String,
    image_url: String,
    detail_level: String,
    canvas_context: Option<serde_json::Value>,
) -> Result<(), String> {
    eprintln!(
        "[vision_analyze] Called with model: {}, detail_level: {}",
        model, detail_level
    );

    let (host, port, client_id) = {
        let ctx = state.lock().map_err(|_| "Lock error".to_string())?;
        if ctx.socket.is_none() {
            eprintln!("[vision_analyze] Error: Not connected");
            return Err("Not connected".to_string());
        }
        (ctx.host.clone(), ctx.port, ctx.client_id.clone())
    };

    run_stream(
        app,
        host,
        port,
        client_id,
        "ai.vision_analyze".to_string(),
        Some(serde_json::json!({
            "model": model,
            "image_url": image_url,
            "detail_level": detail_level,
            "canvas_context": canvas_context,
        })),
        "vision-stream-chunk",
        None,
        None,
    );

    Ok(())
}

/// Shutdown: gracefully stop operator and close streams.
pub fn shutdown(state: &SharedContextState) {
    if let Ok(mut ctx) = state.lock() {
        if let Some(mut child) = ctx.child.take() {
            match child.try_wait() {
                Ok(Some(_)) => {
                    eprintln!("[app] Operator already exited");
                }
                _ => {
                    let pid = child.id();
                    eprintln!("[app] Sending SIGTERM to operator (pid={})", pid);
                    let _ = std::process::Command::new("kill")
                        .args(["-s", "TERM", &pid.to_string()])
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .status();
                    let deadline = std::time::Instant::now() + Duration::from_secs(3);
                    loop {
                        match child.try_wait() {
                            Ok(Some(_)) => {
                                eprintln!("[app] Operator exited gracefully");
                                break;
                            }
                            _ => {
                                if std::time::Instant::now() >= deadline {
                                    eprintln!("[app] Operator didn't exit in 3s, force killing");
                                    let _ = child.kill();
                                    let _ = child.wait();
                                    break;
                                }
                                std::thread::sleep(Duration::from_millis(100));
                            }
                        }
                    }
                }
            }
        }
        ctx.socket = None;
        ctx.address = None;
    }
}
