//! Desktop bridge HTTP server: operator → frontend communication.

use crate::config::{bridge_address, BRIDGE_PENDING, BRIDGE_TOKEN, MESSAGE_ID};

use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::Emitter;

const DEFAULT_FRONTEND_TIMEOUT_MS: u64 = 30_000;
const MIN_FRONTEND_TIMEOUT_MS: u64 = 1_000;
const MAX_FRONTEND_TIMEOUT_MS: u64 = 300_000;

/// Upper bound on a bridge request body. Envelopes are small JSON-RPC
/// messages; this only exists to stop a hostile Content-Length from forcing
/// a giant pre-allocation.
const MAX_BRIDGE_BODY_BYTES: usize = 16 * 1024 * 1024;

/// Length-checked, branch-free byte comparison. Returns false fast on a
/// length mismatch (which leaks only length, not content), then ORs every
/// byte diff so the loop runs the same regardless of where the first
/// mismatch is.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Start the desktop bridge HTTP server on the current instance's bridge port.
pub async fn start_desktop_bridge(app_handle: tauri::AppHandle) {
    use tokio::net::TcpListener;

    let addr = bridge_address();
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => {
            eprintln!("[bridge] listening on {}", addr);
            l
        }
        Err(e) => {
            eprintln!("[bridge] failed to bind {}: {}", addr, e);
            return;
        }
    };

    let token = BRIDGE_TOKEN.clone();

    loop {
        let (stream, _) = match listener.accept().await {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[bridge] accept error: {}", e);
                continue;
            }
        };

        let token = token.clone();
        let app = app_handle.clone();

        tokio::spawn(async move {
            if let Err(e) = handle_bridge_request(stream, &token, &app).await {
                eprintln!("[bridge] request error: {}", e);
            }
        });
    }
}

async fn handle_bridge_request(
    stream: tokio::net::TcpStream,
    expected_token: &str,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let (reader, mut writer) = stream.into_split();
    let mut buf_reader = BufReader::new(reader);

    let mut request_line = String::new();
    buf_reader
        .read_line(&mut request_line)
        .await
        .map_err(|e| e.to_string())?;

    let mut content_length: usize = 0;
    let mut auth_token = String::new();
    loop {
        let mut line = String::new();
        buf_reader
            .read_line(&mut line)
            .await
            .map_err(|e| e.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        let lower = trimmed.to_lowercase();
        if lower.starts_with("content-length:") {
            content_length = trimmed[15..].trim().parse().unwrap_or(0);
            // Cap the declared length so a malformed/hostile (but somehow
            // authed) client can't make us pre-allocate gigabytes below.
            // Bridge payloads are small JSON-RPC envelopes; 16 MiB is ample.
            if content_length > MAX_BRIDGE_BODY_BYTES {
                let body = r#"{"error":"payload too large"}"#;
                let resp = format!(
                    "HTTP/1.1 413 Payload Too Large\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = writer.write_all(resp.as_bytes()).await;
                return Ok(());
            }
        } else if lower.starts_with("authorization:") {
            let val = trimmed[14..].trim();
            if let Some(tok) = val.strip_prefix("Bearer ") {
                auth_token = tok.to_string();
            }
        }
    }

    let is_post_bridge = request_line.starts_with("POST /bridge");

    // Constant-time compare so a wrong token can't be recovered byte-by-byte
    // via response timing. Both are hex of the same length in practice; the
    // length check short-circuits before the loop.
    if !constant_time_eq(auth_token.as_bytes(), expected_token.as_bytes()) {
        let body = r#"{"error":"unauthorized"}"#;
        let resp = format!(
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = writer.write_all(resp.as_bytes()).await;
        return Ok(());
    }

    if !is_post_bridge {
        let body = r#"{"error":"not found"}"#;
        let resp = format!(
            "HTTP/1.1 404 Not Found\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = writer.write_all(resp.as_bytes()).await;
        return Ok(());
    }

    let mut body_buf = vec![0u8; content_length];
    tokio::io::AsyncReadExt::read_exact(&mut buf_reader, &mut body_buf)
        .await
        .map_err(|e| e.to_string())?;

    let body_str = String::from_utf8_lossy(&body_buf).to_string();

    let bridge_req: serde_json::Value =
        serde_json::from_str(&body_str).unwrap_or(serde_json::Value::Null);

    let req_id = bridge_req
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let method = bridge_req
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let params = bridge_req
        .get("params")
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    let result = dispatch_bridge_method(&method, &params, app).await;

    let resp_json = match result {
        Ok(data) => serde_json::json!({
            "id": req_id,
            "result": data,
        }),
        Err(e) => serde_json::json!({
            "id": req_id,
            "error": {
                "code": e.0,
                "message": e.1,
            },
        }),
    };

    let resp_body = resp_json.to_string();
    let http_resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        resp_body.len(),
        resp_body
    );
    writer
        .write_all(http_resp.as_bytes())
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

async fn dispatch_bridge_method(
    method: &str,
    params: &serde_json::Value,
    app: &tauri::AppHandle,
) -> Result<serde_json::Value, (String, String)> {
    match method {
        "ping" => Ok(serde_json::json!({"status": "ok"})),

        // Keep in sync with hostBridgeMethod in brain/bridge/bridge.go —
        // a method listed there but missing here dead-ends as not_found
        // (brain skips the SSE channel for host methods, so this arm is
        // the only route to the frontend handler).
        "space.snapshot"
        | "space.directory"
        | "space.list_actions"
        | "space.run_action"
        | "space.agent"
        | "space.navigate"
        | "space.context_request"
        | "space.open_runner"
        | "space.open_preview"
        | "project.create_modal"
        | "org.members"
        | "org.projects"
        | "org.my_role" => dispatch_to_frontend(app, method, params).await,

        "construct.mouse_move" => crate::automation::construct_mouse_move(params).await,
        "construct.mouse_click" => crate::automation::construct_mouse_click(params).await,

        "browser.tabs" | "browser.open" | "browser.close" | "browser.navigate"
        | "browser.snapshot" | "browser.click" | "browser.type" | "browser.press_key"
        | "browser.wait_for" | "browser.screenshot" | "browser.close_window" => {
            crate::browser_bridge::dispatch(app, method, params).await
        }

        "space.screenshot" | "space.list_windows" => {
            crate::space_screenshot::dispatch(app, method, params).await
        }

        _ => Err((
            "not_found".to_string(),
            format!("Unknown bridge method: {}", method),
        )),
    }
}

/// Forward a space.* request to the frontend via Tauri events and await the response.
async fn dispatch_to_frontend(
    app: &tauri::AppHandle,
    method: &str,
    params: &serde_json::Value,
) -> Result<serde_json::Value, (String, String)> {
    use tokio::sync::oneshot;

    let req_id = format!("bridge_{}", MESSAGE_ID.fetch_add(1, Ordering::Relaxed));

    let (tx, rx) = oneshot::channel::<serde_json::Value>();

    {
        let mut pending = BRIDGE_PENDING.lock().unwrap();
        pending.insert(req_id.clone(), tx);
    }

    let payload = serde_json::json!({
        "id": req_id,
        "method": method,
        "params": params,
    });

    app.emit_to(
        tauri::EventTarget::webview_window("main"),
        "bridge:request",
        &payload,
    )
    .map_err(|e| {
        let mut pending = BRIDGE_PENDING.lock().unwrap();
        pending.remove(&req_id);
        (
            "handler_error".to_string(),
            format!("Failed to emit event: {}", e),
        )
    })?;

    let timeout = frontend_timeout(params);
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(response)) => {
            if let Some(err) = response.get("error").and_then(|e| e.as_str()) {
                Err(("handler_error".to_string(), err.to_string()))
            } else {
                Ok(response)
            }
        }
        Ok(Err(_)) => Err((
            "handler_error".to_string(),
            "Response channel dropped".to_string(),
        )),
        Err(_) => {
            let mut pending = BRIDGE_PENDING.lock().unwrap();
            pending.remove(&req_id);
            Err((
                "timeout".to_string(),
                format!(
                    "Frontend did not respond within {}ms for {}",
                    timeout.as_millis(),
                    method
                ),
            ))
        }
    }
}

fn frontend_timeout(params: &serde_json::Value) -> Duration {
    let requested = params
        .get("bridge_timeout_ms")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(DEFAULT_FRONTEND_TIMEOUT_MS);
    Duration::from_millis(requested.clamp(MIN_FRONTEND_TIMEOUT_MS, MAX_FRONTEND_TIMEOUT_MS))
}

/// Frontend calls this to respond to a bridge:request event.
#[tauri::command]
pub fn bridge_respond(id: String, result: serde_json::Value) -> Result<(), String> {
    let tx = {
        let mut pending = BRIDGE_PENDING.lock().map_err(|e| e.to_string())?;
        pending.remove(&id)
    };
    match tx {
        Some(sender) => {
            let _ = sender.send(result);
            Ok(())
        }
        None => {
            // Stale response — request already timed out or was handled.
            // This commonly happens during HMR when the frontend listener restarts.
            eprintln!("[bridge] Ignoring stale response for id: {}", id);
            Ok(())
        }
    }
}
