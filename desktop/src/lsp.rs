//! LSP language server management: start, stop, message routing, install, detect.

use crate::config::get_user_shell_path;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::Emitter;

// LSP Server state
struct LspServer {
    process: Child,
    #[allow(dead_code)]
    language_id: String,
    stdin: Option<BufWriter<std::process::ChildStdin>>,
}

pub struct LspState {
    servers: HashMap<String, LspServer>,
}

pub type SharedLspState = Arc<Mutex<LspState>>;

pub fn new_state() -> SharedLspState {
    Arc::new(Mutex::new(LspState {
        servers: HashMap::new(),
    }))
}

fn validate_lsp_server(command: &str, args: &[String], root_path: &str) -> Result<(), String> {
    let command = command.trim();
    if command.is_empty()
        || command.contains('/')
        || command.contains('\\')
        || command.contains('\0')
    {
        return Err("LSP server command is not allowed".to_string());
    }

    const ALLOWED_SERVERS: &[&str] = &[
        "css-languageserver",
        "gopls",
        "html-languageserver",
        "json-languageserver",
        "pyright-langserver",
        "rust-analyzer",
        "tailwindcss-language-server",
        "typescript-language-server",
        "vue-language-server",
        "vscode-css-language-server",
        "vscode-html-language-server",
        "vscode-json-language-server",
    ];
    if !ALLOWED_SERVERS.contains(&command) {
        return Err(format!("LSP server '{}' is not allowed", command));
    }
    if root_path.is_empty() || root_path.contains('\0') || !Path::new(root_path).is_absolute() {
        return Err("LSP root path is not allowed".to_string());
    }
    if !Path::new(root_path).is_dir() {
        return Err("LSP root path does not exist".to_string());
    }
    if args
        .iter()
        .any(|arg| arg.contains('\0') || arg.len() > 8192)
    {
        return Err("LSP server argument is not allowed".to_string());
    }
    Ok(())
}

// LSP Message structures
#[derive(Clone, Serialize, Deserialize, Debug)]
struct LspMessage {
    jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<serde_json::Value>,
}

#[derive(Clone, Serialize)]
pub(crate) struct LspServerInfo {
    language_id: String,
    running: bool,
}

#[tauri::command]
pub async fn lsp_start_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedLspState>,
    language_id: String,
    server_command: String,
    server_args: Vec<String>,
    root_path: String,
) -> Result<bool, String> {
    validate_lsp_server(&server_command, &server_args, &root_path)?;
    let mut lsp_state = state.lock().map_err(|_| "Lock error")?;

    if lsp_state.servers.contains_key(&language_id) {
        return Ok(true);
    }

    eprintln!(
        "[LSP] Starting server for {}: {} {:?}",
        language_id, server_command, server_args
    );

    let mut child = Command::new(&server_command)
        .args(&server_args)
        .current_dir(&root_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PATH", get_user_shell_path())
        .spawn()
        .map_err(|e| format!("Failed to spawn LSP server: {}", e))?;

    let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to get stderr")?;

    let stdin_writer = BufWriter::new(stdin);

    lsp_state.servers.insert(
        language_id.clone(),
        LspServer {
            process: child,
            language_id: language_id.clone(),
            stdin: Some(stdin_writer),
        },
    );

    // Spawn thread to read stdout and emit events
    let app_clone = app.clone();
    let lang_id = language_id.clone();
    thread::spawn(move || {
        use std::io::Read;
        let mut reader = BufReader::new(stdout);

        loop {
            let mut content_length: Option<usize> = None;

            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) => {
                        eprintln!("[LSP {}] EOF while reading headers", lang_id);
                        return;
                    }
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            break;
                        }
                        if let Some(len_str) = trimmed.strip_prefix("Content-Length:") {
                            content_length = len_str.trim().parse().ok();
                        }
                    }
                    Err(e) => {
                        eprintln!("[LSP {}] Error reading header: {}", lang_id, e);
                        return;
                    }
                }
            }

            if let Some(len) = content_length {
                let mut body = vec![0u8; len];
                match reader.read_exact(&mut body) {
                    Ok(_) => {
                        if let Ok(json_str) = String::from_utf8(body) {
                            if let Ok(msg) = serde_json::from_str::<LspMessage>(&json_str) {
                                eprintln!(
                                    "[LSP {}] Received: {} (id: {:?})",
                                    lang_id,
                                    msg.method.as_deref().unwrap_or("response"),
                                    msg.id
                                );
                                let _ = app_clone.emit(&format!("lsp-message-{}", lang_id), msg);
                            } else {
                                eprintln!(
                                    "[LSP {}] Failed to parse JSON: {}",
                                    lang_id,
                                    &json_str[..json_str.len().min(200)]
                                );
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[LSP {}] Error reading body: {}", lang_id, e);
                        return;
                    }
                }
            } else {
                eprintln!("[LSP {}] No Content-Length in headers", lang_id);
            }
        }
    });

    // Spawn thread to read stderr
    let lang_id_err = language_id.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(line) => eprintln!("[LSP {} stderr] {}", lang_id_err, line),
                Err(_) => break,
            }
        }
    });

    eprintln!("[LSP] Server started for {}", language_id);
    Ok(true)
}

#[tauri::command]
pub fn lsp_send_message(
    state: tauri::State<'_, SharedLspState>,
    language_id: String,
    message: serde_json::Value,
) -> Result<(), String> {
    let mut lsp_state = state.lock().map_err(|_| "Lock error")?;

    let server = lsp_state
        .servers
        .get_mut(&language_id)
        .ok_or_else(|| format!("No LSP server for {}", language_id))?;

    let stdin = server.stdin.as_mut().ok_or("Server stdin not available")?;

    let json = serde_json::to_string(&message).map_err(|e| e.to_string())?;
    let content = format!("Content-Length: {}\r\n\r\n{}", json.len(), json);

    stdin
        .write_all(content.as_bytes())
        .map_err(|e| format!("Write error: {}", e))?;
    stdin.flush().map_err(|e| format!("Flush error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn lsp_next_id() -> u64 {
    crate::config::LSP_MESSAGE_ID.fetch_add(1, Ordering::SeqCst)
}

#[tauri::command]
pub fn lsp_stop_server(
    state: tauri::State<'_, SharedLspState>,
    language_id: String,
) -> Result<(), String> {
    let mut lsp_state = state.lock().map_err(|_| "Lock error")?;

    if let Some(mut server) = lsp_state.servers.remove(&language_id) {
        let _ = server.process.kill();
        eprintln!("[LSP] Stopped server for {}", language_id);
    }

    Ok(())
}

#[tauri::command]
pub fn lsp_stop_all(state: tauri::State<'_, SharedLspState>) -> Result<(), String> {
    let mut lsp_state = state.lock().map_err(|_| "Lock error")?;

    for (lang_id, mut server) in lsp_state.servers.drain() {
        let _ = server.process.kill();
        eprintln!("[LSP] Stopped server for {}", lang_id);
    }

    Ok(())
}

#[tauri::command]
pub fn lsp_list_servers(
    state: tauri::State<'_, SharedLspState>,
) -> Result<Vec<LspServerInfo>, String> {
    let lsp_state = state.lock().map_err(|_| "Lock error")?;

    let servers: Vec<LspServerInfo> = lsp_state
        .servers
        .keys()
        .map(|lang_id| LspServerInfo {
            language_id: lang_id.clone(),
            running: true,
        })
        .collect();

    Ok(servers)
}

#[tauri::command]
pub fn lsp_check_command(command: String) -> bool {
    Command::new("which")
        .arg(&command)
        .env("PATH", get_user_shell_path())
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[tauri::command]
pub async fn lsp_install_server(language_id: String) -> Result<String, String> {
    let (install_cmd, args): (&str, Vec<&str>) = match language_id.as_str() {
        "typescript" | "javascript" => (
            "bun",
            vec!["install", "-g", "typescript-language-server", "typescript"],
        ),
        "vue" => ("bun", vec!["install", "-g", "@vue/language-server"]),
        "json" => ("bun", vec!["install", "-g", "vscode-langservers-extracted"]),
        "css" | "html" => ("bun", vec!["install", "-g", "vscode-langservers-extracted"]),
        "python" => ("pip3", vec!["install", "--user", "python-lsp-server"]),
        "go" => ("go", vec!["install", "golang.org/x/tools/gopls@latest"]),
        "rust" => {
            return Err(
                "Install rust-analyzer via: rustup component add rust-analyzer".to_string(),
            );
        }
        _ => return Err(format!("No install command for language: {}", language_id)),
    };

    eprintln!(
        "[LSP Install] Installing {} server: {} {:?}",
        language_id, install_cmd, args
    );

    let output = Command::new(install_cmd)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run install command: {}", e))?;

    if output.status.success() {
        let msg = format!("Successfully installed LSP server for {}", language_id);
        eprintln!("[LSP Install] {}", msg);
        Ok(msg)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let msg = format!("Failed to install {}: {}", language_id, stderr);
        eprintln!("[LSP Install] {}", msg);
        Err(msg)
    }
}

#[tauri::command]
pub fn lsp_detect_languages(root_path: String) -> Vec<String> {
    let mut languages = HashSet::new();

    let config_indicators = [
        ("go.mod", "go"),
        ("Cargo.toml", "rust"),
        ("package.json", "typescript"),
        ("tsconfig.json", "typescript"),
        ("pyproject.toml", "python"),
        ("requirements.txt", "python"),
        ("setup.py", "python"),
    ];

    for (file, lang) in config_indicators.iter() {
        let path = std::path::Path::new(&root_path).join(file);
        if path.exists() {
            languages.insert(lang.to_string());
        }
    }

    fn scan_dir(dir: &std::path::Path, languages: &mut HashSet<String>, depth: u32) {
        if depth > 3 {
            return;
        }

        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };

        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            if name.starts_with('.')
                || name == "node_modules"
                || name == "vendor"
                || name == "target"
                || name == "dist"
                || name == "build"
            {
                continue;
            }

            if path.is_dir() {
                scan_dir(&path, languages, depth + 1);
            } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                match ext {
                    "go" => {
                        languages.insert("go".to_string());
                    }
                    "rs" => {
                        languages.insert("rust".to_string());
                    }
                    "ts" | "tsx" => {
                        languages.insert("typescript".to_string());
                    }
                    "js" | "jsx" | "mjs" => {
                        languages.insert("typescript".to_string());
                    }
                    "vue" => {
                        languages.insert("vue".to_string());
                    }
                    "py" => {
                        languages.insert("python".to_string());
                    }
                    "json" => {
                        languages.insert("json".to_string());
                    }
                    "css" | "scss" | "less" => {
                        languages.insert("css".to_string());
                    }
                    "html" | "htm" => {
                        languages.insert("html".to_string());
                    }
                    _ => {}
                }
            }
        }
    }

    scan_dir(std::path::Path::new(&root_path), &mut languages, 0);

    eprintln!("[LSP] Detected languages in {}: {:?}", root_path, languages);
    languages.into_iter().collect()
}

/// Shutdown: kill all running LSP servers.
pub fn shutdown_servers(state: &SharedLspState) {
    if let Ok(mut lsp_state) = state.lock() {
        for (lang_id, mut server) in lsp_state.servers.drain() {
            eprintln!("[app] Killing LSP server for {}", lang_id);
            let _ = server.process.kill();
        }
    }
}
