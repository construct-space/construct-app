//! Hardened notification stream.
//!
//! Owns a long-lived WebSocket through my.construct.space to delivery-api's
//! notifications channel (`/api/notifications/ws?token=...`). The Vue
//! webview was previously responsible for this connection (see
//! frontend/composables/useNotifications.ts), but a webview reload, HMR
//! cycle, or App Nap would silently drop the stream. Running it here in
//! Rust survives webview reloads and keeps firing OS notifications + dock
//! badge updates while the window is hidden in the tray.
//!
//! Wire protocol — server sends one JSON message per frame, three shapes:
//!
//!   { "type": "notification",  "notification": { ... AppNotification ... } }
//!   { "type": "unread_count",  "unread_count": 7 }
//!   { "type": "device.command","command": { "cmd": "...", "payload": ... } }
//!
//! Each is re-emitted as a Tauri event (`construct://notification`,
//! `construct://unread-count`, `construct://device-command`) and the
//! frontend listens via `@tauri-apps/api/event`.

use std::sync::Arc;
use std::time::{Duration, SystemTime};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::{Mutex, Notify};
use tokio::time::{sleep, timeout};
use tokio_tungstenite::tungstenite::Message;

const PING_INTERVAL_SECS: u64 = 25;
const PONG_TIMEOUT_SECS: u64 = 60;
const MAX_BACKOFF_SECS: u64 = 30;

#[derive(Default)]
struct Inner {
    token: Option<String>,
    base_url: Option<String>, // e.g. https://my.construct.space/api
    connected: bool,
    last_connect_at: Option<SystemTime>,
    last_error: Option<String>,
    retry_count: u32,
}

pub struct NotificationsState {
    inner: Mutex<Inner>,
    /// Pinged when token / base_url change so the worker drops its current
    /// connection and reconnects with the new credentials immediately.
    reconnect: Notify,
}

impl NotificationsState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
            reconnect: Notify::new(),
        }
    }
}

#[derive(Serialize)]
pub struct DebugState {
    connected: bool,
    has_token: bool,
    base_url: Option<String>,
    last_connect_at_ms: Option<u128>,
    last_error: Option<String>,
    retry_count: u32,
}

#[derive(Deserialize)]
struct WsEnvelope {
    #[serde(rename = "type")]
    kind: Option<String>,
    notification: Option<Value>,
    unread_count: Option<u64>,
    command: Option<Value>,
}

/// Spawn the connection worker. Idempotent — `setup` calls this once.
pub fn spawn(app: AppHandle, state: Arc<NotificationsState>) {
    tauri::async_runtime::spawn(async move {
        worker(app, state).await;
    });
}

async fn worker(app: AppHandle, state: Arc<NotificationsState>) {
    loop {
        // Wait for credentials.
        let (token, base_url) = match read_creds(&state).await {
            Some(c) => c,
            None => {
                state.reconnect.notified().await;
                continue;
            }
        };

        let url = match build_ws_url(&base_url, &token) {
            Ok(u) => u,
            Err(e) => {
                set_error(&state, Some(format!("bad url: {e}"))).await;
                // Wait for new creds before retrying.
                state.reconnect.notified().await;
                continue;
            }
        };

        log::debug!("[notifications] connecting to {}", redact_token(&url));
        match tokio_tungstenite::connect_async(&url).await {
            Ok((ws, _resp)) => {
                set_connected(&state).await;
                let disconnect_reason = run_session(&app, &state, ws).await;
                set_disconnected(&state, disconnect_reason).await;
            }
            Err(e) => {
                set_error(&state, Some(format!("connect failed: {e}"))).await;
            }
        }

        // Backoff with jitter; interruptible by reconnect signal (creds change).
        let attempt = bump_retry(&state).await;
        let delay = backoff_delay(attempt);
        tokio::select! {
            _ = sleep(delay) => {}
            _ = state.reconnect.notified() => {
                // Reset retry count when creds change — fresh token deserves a fresh try.
                reset_retry(&state).await;
            }
        }

        // Bail out if creds were cleared during the backoff.
        if read_creds(&state).await.is_none() {
            continue;
        }
    }
}

async fn run_session(
    app: &AppHandle,
    state: &Arc<NotificationsState>,
    ws: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Option<String> {
    let (mut sink, mut stream) = ws.split();
    let mut ping_timer = tokio::time::interval(Duration::from_secs(PING_INTERVAL_SECS));
    ping_timer.tick().await; // first tick is immediate — discard.

    loop {
        tokio::select! {
            // Outbound ping.
            _ = ping_timer.tick() => {
                if let Err(e) = sink.send(Message::Ping(Vec::new().into())).await {
                    return Some(format!("ping send failed: {e}"));
                }
            }

            // Incoming message — bounded so we detect dead peers.
            frame = timeout(Duration::from_secs(PONG_TIMEOUT_SECS), stream.next()) => {
                match frame {
                    Ok(Some(Ok(msg))) => {
                        match msg {
                            Message::Text(text) => {
                                handle_text(app, &text);
                            }
                            Message::Binary(_) => { /* server doesn't send binary */ }
                            Message::Pong(_) | Message::Ping(_) => { /* ack — tungstenite auto-pongs */ }
                            Message::Close(reason) => {
                                return Some(format!("server closed: {reason:?}"));
                            }
                            Message::Frame(_) => { /* raw — tungstenite handles */ }
                        }
                    }
                    Ok(Some(Err(e))) => return Some(format!("ws error: {e}")),
                    Ok(None) => return Some("stream ended".into()),
                    Err(_) => return Some("idle timeout (no pong)".into()),
                }
            }

            // Creds changed — drop and reconnect with new token.
            _ = state.reconnect.notified() => {
                let _ = sink.send(Message::Close(None)).await;
                return Some("credentials changed".into());
            }
        }
    }
}

fn handle_text(app: &AppHandle, text: &str) {
    let env: WsEnvelope = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("[notifications] malformed frame: {e}");
            return;
        }
    };

    match env.kind.as_deref() {
        Some("notification") => {
            if let Some(n) = env.notification {
                // OS banner if the window isn't focused — fires even when
                // the webview is suspended in tray mode. The in-app bell
                // listens for the same event to update its inbox state.
                if should_show_os_banner(app) && is_unread(&n) {
                    let title = n
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Notification");
                    let body = n.get("body").and_then(|v| v.as_str()).unwrap_or("");
                    if let Err(e) = app.notification().builder().title(title).body(body).show() {
                        log::warn!("[notifications] os banner failed: {e}");
                    }
                }
                let _ = app.emit("construct://notification", &n);
            }
        }
        Some("unread_count") => {
            if let Some(c) = env.unread_count {
                update_dock_badge(app, c);
                let _ = app.emit("construct://unread-count", c);
            }
        }
        Some("device.command") => {
            if let Some(cmd) = env.command {
                let _ = app.emit("construct://device-command", &cmd);
            }
        }
        // Ignore unknown shapes — server may add more.
        _ => {}
    }
}

fn should_show_os_banner(app: &AppHandle) -> bool {
    // Suppress the banner if the user already has the main window
    // focused — the in-app bell is enough. If the window can't be
    // found (closed to tray) or focus check fails, default to showing
    // the banner since that's the case the OS notification exists for.
    match app.get_webview_window("main") {
        Some(win) => !win.is_focused().unwrap_or(false),
        None => true,
    }
}

fn is_unread(n: &Value) -> bool {
    // Treat missing/null `read_at` as unread. Anything else (a server-
    // stamped ISO string) means the user already saw it elsewhere.
    n.get("read_at").map_or(true, |v| v.is_null())
}

fn update_dock_badge(app: &AppHandle, count: u64) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let value = if count == 0 { None } else { Some(count as i64) };
    if let Err(e) = win.set_badge_count(value) {
        log::debug!("[notifications] set_badge_count failed: {e}");
    }
}

// ── State helpers ──────────────────────────────────────────────────────────

async fn read_creds(state: &Arc<NotificationsState>) -> Option<(String, String)> {
    let g = state.inner.lock().await;
    match (g.token.as_ref(), g.base_url.as_ref()) {
        (Some(t), Some(u)) if !t.is_empty() && !u.is_empty() => Some((t.clone(), u.clone())),
        _ => None,
    }
}

async fn set_connected(state: &Arc<NotificationsState>) {
    let mut g = state.inner.lock().await;
    g.connected = true;
    g.last_connect_at = Some(SystemTime::now());
    g.last_error = None;
    g.retry_count = 0;
}

async fn set_disconnected(state: &Arc<NotificationsState>, reason: Option<String>) {
    let mut g = state.inner.lock().await;
    g.connected = false;
    if reason.is_some() {
        g.last_error = reason;
    }
}

async fn set_error(state: &Arc<NotificationsState>, err: Option<String>) {
    let mut g = state.inner.lock().await;
    g.last_error = err;
}

async fn bump_retry(state: &Arc<NotificationsState>) -> u32 {
    let mut g = state.inner.lock().await;
    g.retry_count = g.retry_count.saturating_add(1);
    g.retry_count
}

async fn reset_retry(state: &Arc<NotificationsState>) {
    let mut g = state.inner.lock().await;
    g.retry_count = 0;
}

fn backoff_delay(attempt: u32) -> Duration {
    // 1s, 2s, 4s, 8s, 16s, capped at 30s. Jittered ±25%.
    let base = 2u64.saturating_pow(attempt.min(5)).min(MAX_BACKOFF_SECS);
    let jitter_pct = (rand_u32() % 50) as i64 - 25;
    let secs = (base as i64 + (base as i64 * jitter_pct / 100)).max(1) as u64;
    Duration::from_secs(secs)
}

// Tiny PRNG (no extra dep — getrandom is already pulled in).
fn rand_u32() -> u32 {
    let mut buf = [0u8; 4];
    if getrandom::getrandom(&mut buf).is_ok() {
        u32::from_le_bytes(buf)
    } else {
        // Fall back to time-based — backoff jitter is best-effort.
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0)
    }
}

fn build_ws_url(base_url: &str, token: &str) -> Result<String, String> {
    let trimmed = base_url.trim_end_matches('/');
    let upgraded = if let Some(rest) = trimmed.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        return Err(format!("unexpected scheme: {base_url}"));
    };

    let ws_url = if upgraded.ends_with("/notifications/ws") {
        upgraded
    } else if upgraded.ends_with("/api/notifications") {
        format!("{upgraded}/ws")
    } else if upgraded.ends_with("/api") {
        format!("{upgraded}/notifications/ws")
    } else {
        format!("{upgraded}/api/notifications/ws")
    };

    Ok(format!("{ws_url}?token={}", urlencoding::encode(token)))
}

fn redact_token(url: &str) -> String {
    if let Some((head, _)) = url.split_once("token=") {
        format!("{head}token=***")
    } else {
        url.into()
    }
}

#[cfg(test)]
mod tests {
    use super::build_ws_url;

    #[test]
    fn builds_ws_url_from_gateway_api_base() {
        let url = build_ws_url("https://my.construct.space/api", "cat_token").unwrap();
        assert_eq!(
            url,
            "wss://my.construct.space/api/notifications/ws?token=cat_token"
        );
    }

    #[test]
    fn builds_ws_url_from_notifications_base() {
        let url =
            build_ws_url("https://my.construct.space/api/notifications", "cat_token").unwrap();
        assert_eq!(
            url,
            "wss://my.construct.space/api/notifications/ws?token=cat_token"
        );
    }

    #[test]
    fn keeps_existing_ws_endpoint() {
        let url = build_ws_url(
            "https://my.construct.space/api/notifications/ws",
            "cat_token",
        )
        .unwrap();
        assert_eq!(
            url,
            "wss://my.construct.space/api/notifications/ws?token=cat_token"
        );
    }
}

// ── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn notifications_set_token(
    token: String,
    base_url: String,
    state: State<'_, Arc<NotificationsState>>,
) -> Result<(), String> {
    {
        let mut g = state.inner.lock().await;
        let changed = g.token.as_deref() != Some(token.as_str())
            || g.base_url.as_deref() != Some(base_url.as_str());
        g.token = Some(token);
        g.base_url = Some(base_url);
        if changed {
            g.retry_count = 0;
            g.last_error = None;
        }
    }
    state.reconnect.notify_one();
    Ok(())
}

#[tauri::command]
pub async fn notifications_clear_token(
    state: State<'_, Arc<NotificationsState>>,
) -> Result<(), String> {
    {
        let mut g = state.inner.lock().await;
        g.token = None;
        g.base_url = None;
        g.retry_count = 0;
    }
    state.reconnect.notify_one();
    Ok(())
}

#[tauri::command]
pub async fn notifications_debug_state(
    state: State<'_, Arc<NotificationsState>>,
) -> Result<DebugState, String> {
    let g = state.inner.lock().await;
    Ok(DebugState {
        connected: g.connected,
        has_token: g.token.as_ref().is_some_and(|t| !t.is_empty()),
        base_url: g.base_url.clone(),
        last_connect_at_ms: g.last_connect_at.and_then(|t| {
            t.duration_since(SystemTime::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_millis())
        }),
        last_error: g.last_error.clone(),
        retry_count: g.retry_count,
    })
}
