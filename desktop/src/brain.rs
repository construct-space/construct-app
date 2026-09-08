//! Brain sidecar lifecycle. Spawns the `construct-brain` binary on a
//! loopback TCP port + an HTTP+SSE port the frontend uses. Replaces the
//! operator sidecar for the 1.1 experiment branch; operator.rs stays in
//! the tree but its `start_context_service` is no longer wired in lib.rs.
//!
//! The frontend reaches brain two ways:
//!   1. IPC — `frontend/brain/client.ts` invokes `brain_request` /
//!      `brain_stream` / `brain_tool_response`; Rust does the loopback HTTP
//!      POST to brain. This is the path the packaged app uses: the webview
//!      runs in a secure (`tauri://`) origin where WebKit auto-upgrades a
//!      plain `http://127.0.0.1` fetch to `https://`, which fails the TLS
//!      handshake against brain's plaintext server. Rust isn't subject to
//!      that mixed-content upgrade, so it proxies the request cleanly.
//!      (Browser dev — insecure `http://localhost:60200` origin — keeps
//!      using direct fetch; there's no Tauri host to invoke.)
//!   2. TCP — same protocol as operator, in case we later swap useOperator
//!      to use this transport via a thin Rust IPC command.
//!
//! Ports live in `crate::config`; brain uses operator's port so existing
//! operator IPC commands could be retargeted later without changing the
//! frontend.
use crate::config::{bridge_port, get_profile_data_dir, operator_port, BRIDGE_TOKEN};

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const BRAIN_HTTP_PORT: u16 = 60182;

pub struct BrainState {
    pub child: Option<Child>,
    pub tcp_port: u16,
    pub http_port: u16,
}

pub type SharedBrainState = Arc<Mutex<BrainState>>;

pub fn new_state() -> SharedBrainState {
    Arc::new(Mutex::new(BrainState {
        child: None,
        tcp_port: 0,
        http_port: 0,
    }))
}

fn resolve_brain_path() -> Result<PathBuf, String> {
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
        format!("construct-brain-{}.exe", target)
    } else {
        format!("construct-brain-{}", target)
    };

    let bundled_name = if cfg!(target_os = "windows") {
        "construct-brain.exe"
    } else {
        "construct-brain"
    };

    let exe_dir = std::env::current_exe()
        .map_err(|e| format!("Failed to get exe path: {}", e))?
        .parent()
        .ok_or_else(|| "Failed to get exe dir".to_string())?
        .to_path_buf();

    let candidates = [
        exe_dir.join(bundled_name),
        exe_dir.join(&sidecar_name),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("bin")
            .join(&sidecar_name),
    ];

    for (i, path) in candidates.iter().enumerate() {
        if path.exists() {
            let source = match i {
                0 => "sibling sidecar",
                1 => "target sidecar",
                _ => "desktop/bin sidecar",
            };
            eprintln!("[brain] binary ({source}): {}", path.display());
            return Ok(path.clone());
        }
    }
    Err(format!(
        "construct-brain binary not found. Searched: {}",
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

/// Spawn brain in the background. Idempotent: if a child is already
/// alive, returns the existing ports. Logs to stderr like operator.rs.
/// Kill orphaned construct-brain processes left over from a previous run
/// (desktop hard-killed before its shutdown hook ran). Best-effort; matches
/// the brain binary by name so it never touches the desktop process itself.
fn kill_stale_brain() {
    #[cfg(unix)]
    {
        let _ = Command::new("pkill").arg("-f").arg("construct-brain").output();
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", "construct-brain.exe"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}

pub fn ensure_running(state: &SharedBrainState) -> Result<(u16, u16), String> {
    {
        let mut s = state.lock().map_err(|_| "Lock error".to_string())?;
        if let Some(child) = s.child.as_mut() {
            match child.try_wait() {
                Ok(None) => return Ok((s.tcp_port, s.http_port)),
                _ => {
                    // dead — fall through and respawn
                    let _ = child.kill();
                    let _ = child.wait();
                    s.child = None;
                }
            }
        }
    }

    let brain_path = resolve_brain_path()?;
    let tcp = operator_port();
    let http = BRAIN_HTTP_PORT;

    // We have no live tracked child, but the port may still be held by an
    // orphaned brain from a previous run — Tauri's shutdown hook doesn't fire
    // on a hard kill (e.g. `bun run dev` SIGKILL), so the sidecar survives.
    // Without clearing it, the fresh brain can't bind 60100/60182 and the
    // desktop spawn-loops on "address already in use" — which breaks the
    // prompt stream and leaves tool cards spinning forever. Kill the orphan so
    // our fresh brain (current code) can bind.
    if std::net::TcpStream::connect(("127.0.0.1", tcp)).is_ok() {
        eprintln!("[brain] port {} busy — clearing stale brain before respawn", tcp);
        kill_stale_brain();
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while std::time::Instant::now() < deadline {
            if std::net::TcpStream::connect(("127.0.0.1", tcp)).is_err() {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    // Per-profile data dir so brain shares auth.json / providers/auth.json
    // with the rest of the app. `get_profile_data_dir` is guaranteed to
    // return a valid profile path — fresh installs auto-create a Default
    // profile so brain never writes to the root data dir.
    let data_dir = PathBuf::from(get_profile_data_dir()?);

    eprintln!(
        "[brain] launching: {} --port {} --http-port {}",
        brain_path.display(),
        tcp,
        http
    );

    // Bridge wiring — brain calls back into the desktop via the same
    // 60101 listener operator uses. desktop/src/bridge.rs forwards
    // space.run_action etc. to the Vue frontend, so reusing it is the
    // shortest path to getting tool execution working again.
    let selected_bridge_port = bridge_port();

    let mut cmd = Command::new(&brain_path);
    cmd.arg("--port")
        .arg(tcp.to_string())
        .arg("--http-port")
        .arg(http.to_string())
        .env("CONSTRUCT_DATA_DIR", &data_dir)
        .env("CONSTRUCT_BRIDGE_PORT", selected_bridge_port.to_string())
        .env("CONSTRUCT_BRIDGE_TOKEN", BRIDGE_TOKEN.as_str())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Windows: brain is a console-subsystem Go binary, so spawning it via
    // std::process::Command pops a visible console window (titled with the
    // exe's full path, e.g. ...\Construct\construct-brain.exe) every launch.
    // CREATE_NO_WINDOW keeps it headless, matching the desktop's own
    // windows_subsystem="windows" in main.rs.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn brain: {}", e))?;

    // Forward stderr so brain's [brain] lines show up alongside Tauri's.
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines().flatten() {
                eprintln!("[brain] {}", line);
            }
        });
    }
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines().flatten() {
                eprintln!("[brain·out] {}", line);
            }
        });
    }

    // Best-effort: wait briefly for brain to bind. Don't fail boot if it's
    // slow — caller can retry HTTP fetch.
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while std::time::Instant::now() < deadline {
        if std::net::TcpStream::connect(("127.0.0.1", tcp)).is_ok() {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    let mut s = state.lock().map_err(|_| "Lock error".to_string())?;
    s.child = Some(child);
    s.tcp_port = tcp;
    s.http_port = http;
    Ok((tcp, http))
}

#[tauri::command]
pub fn brain_ports(state: tauri::State<'_, SharedBrainState>) -> Result<(u16, u16), String> {
    let s = state.lock().map_err(|_| "Lock error".to_string())?;
    Ok((s.tcp_port, s.http_port))
}

/// Shared secret the frontend must send as `Authorization: Bearer <token>`
/// on every brain HTTP request. Same value brain receives via
/// CONSTRUCT_BRIDGE_TOKEN, so the loopback HTTP transport can reject
/// drive-by requests from any web page the user happens to have open.
#[tauri::command]
pub fn brain_token() -> String {
    BRIDGE_TOKEN.clone()
}

#[tauri::command]
pub fn brain_start(state: tauri::State<'_, SharedBrainState>) -> Result<(u16, u16), String> {
    ensure_running(&state)
}

// Frontend boot calls operator::start_context_service. That function
// connects to whatever's already on the operator port and returns early
// without spawning if it finds one. Our setup thread starts brain on
// that port before the frontend gets a chance to invoke, so the existing
// command path transparently lands on brain. No name override needed.

/// Resolve brain's loopback HTTP base URL. Prefers the live bound port from
/// state; falls back to the compile-time default when state hasn't recorded
/// one yet (e.g. a request races ahead of `ensure_running` finishing).
fn brain_base_url(state: &SharedBrainState) -> Result<String, String> {
    let port = {
        let s = state.lock().map_err(|_| "Lock error".to_string())?;
        if s.http_port != 0 {
            s.http_port
        } else {
            BRAIN_HTTP_PORT
        }
    };
    Ok(format!("http://127.0.0.1:{}", port))
}

/// Build the bearer auth header brain requires on every HTTP request
/// (same shared secret it receives via CONSTRUCT_BRIDGE_TOKEN).
fn brain_auth() -> String {
    format!("Bearer {}", BRIDGE_TOKEN.as_str())
}

/// brain_request — one-shot wire op proxied through Rust to brain's
/// `POST /v1/request`. Returns brain's raw response envelope JSON; the
/// frontend (`client.ts request()`) unwraps `success`/`error`/`data` exactly
/// as it did for the direct-fetch path, so callers are unchanged.
#[tauri::command]
pub async fn brain_request(
    state: tauri::State<'_, SharedBrainState>,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/v1/request", brain_base_url(&state)?);
    let res = reqwest::Client::new()
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", brain_auth())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("brain_request: {}", e))?;
    res.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("brain_request decode: {}", e))
}

/// brain_tool_response — relays a tool result back to brain's
/// `POST /v1/tool_response`. Fire-and-forget; brain times the call out via
/// its own context if this never lands.
#[tauri::command]
pub async fn brain_tool_response(
    state: tauri::State<'_, SharedBrainState>,
    body: serde_json::Value,
) -> Result<(), String> {
    let url = format!("{}/v1/tool_response", brain_base_url(&state)?);
    reqwest::Client::new()
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", brain_auth())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("brain_tool_response: {}", e))?;
    Ok(())
}

/// Locate the first occurrence of `needle` in `haystack`. SSE frames are
/// delimited by a blank line (`\n\n`); we scan on raw bytes so a multibyte
/// UTF-8 sequence split across two network chunks is never decoded mid-char.
fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|w| w == needle)
}

/// brain_stream — proxies brain's `POST /v1/stream` SSE response into a Tauri
/// channel. Each parsed JSON frame is forwarded to the frontend via `on_event`;
/// the command resolves when brain closes the stream (normal completion, or
/// after the frontend sends a `cancel` wire op through `brain_request`, which
/// makes brain end the SSE early). Mirrors the framing in `client.ts stream()`.
#[tauri::command]
pub async fn brain_stream(
    state: tauri::State<'_, SharedBrainState>,
    body: serde_json::Value,
    on_event: tauri::ipc::Channel<serde_json::Value>,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let url = format!("{}/v1/stream", brain_base_url(&state)?);
    let res = reqwest::Client::new()
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", brain_auth())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("brain_stream: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("brain_stream: HTTP {}", res.status()));
    }

    let mut stream = res.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("brain_stream read: {}", e))?;
        buf.extend_from_slice(&bytes);
        // Drain every complete `\n\n`-terminated frame currently buffered.
        while let Some(idx) = find_subslice(&buf, b"\n\n") {
            let frame: Vec<u8> = buf.drain(..idx).collect();
            buf.drain(..2); // discard the delimiter
            let frame_str = String::from_utf8_lossy(&frame);
            let line = frame_str.strip_prefix("data: ").unwrap_or(&frame_str);
            if line.is_empty() {
                continue;
            }
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
                on_event
                    .send(val)
                    .map_err(|e| format!("brain_stream emit: {}", e))?;
            }
        }
    }
    Ok(())
}

pub fn shutdown(state: &SharedBrainState) {
    if let Ok(mut s) = state.lock() {
        if let Some(mut child) = s.child.take() {
            let pid = child.id();
            eprintln!("[brain] terminating sidecar pid={}", pid);
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
